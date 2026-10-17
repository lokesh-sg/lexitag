"""Real-Time Filesystem Watcher for LexiTag.

Monitors enabled library_sources directories for media file changes:
- Newly added audio files -> scanned immediately and inserted/updated in SQLite.
- Deleted audio files -> marked as missing (or soft-deleted) in SQLite.
- Modified audio files -> optionally re-scanned (when mode == 'all') after file write settles,
  while strictly ignoring LexiTag's own internal tag/cover/rename writes.

Guardrails:
1. Strict Media-Only Filtering:
   Only inspects files matching SUPPORTED_EXTENSIONS (.mp3, .flac, .m4a, .mp4, .ogg, .opus, .wma, .aac, .wav).
   Completely ignores cover art (.jpg, .png, .webp), .lrc sidecar lyrics, .nfo, hidden dotfiles, and temp files.
2. External Media Server Protection (Jellyfin / Navidrome):
   Supports 'add_delete' mode (strictly tracks file additions and deletions only, ignoring metadata/mtime touches
   from external servers) and 'all' mode (tracks Additions, Deletions, and settled Modifications).
3. Self-Write Suppression Registry:
   Whenever LexiTag itself modifies, retags, embeds cover art, or renames a file, `suppress_path()` registers
   the path in an ignore window and refreshes its baseline stat snapshot so LexiTag's own writes never trigger
   false filesystem re-scans.
"""

import asyncio
import logging
import os
import time
from collections import deque
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

from backend.app.database import get_db, get_setting, set_setting
from backend.app.services.scanner import SUPPORTED_EXTENSIONS, scan_file

logger = logging.getLogger("lexitag.fs_watcher")

# Ignored temporary / partial download suffixes
IGNORED_SUFFIXES = {".part", ".tmp", ".crdownload", ".remux.mp3", ".fix-tmp", ".bak"}

# Global Self-Write Suppression Registry:
# Normalized absolute path -> expiration monotonic timestamp
_SELF_WRITE_SUPPRESS: Dict[str, float] = {}
# Recently renamed by LexiTag: old_path -> (new_path, expiration_monotonic)
_SELF_RENAME_SUPPRESS: Dict[str, float] = {}


def suppress_path(filepath: str, ttl_seconds: float = 25.0) -> None:
    """
    Register a file path modified by LexiTag itself so the filesystem watcher
    will not treat it as an external modification.
    Also updates the in-memory baseline snapshot immediately if the watcher is running.
    """
    if not filepath:
        return
    try:
        norm = os.path.abspath(filepath)
        now = time.monotonic()
        _SELF_WRITE_SUPPRESS[norm] = now + ttl_seconds
        # Also update the watcher's known snapshot if the file exists on disk
        if fs_watcher and fs_watcher.snapshot_ready:
            fs_watcher.refresh_single_snapshot(norm)
    except Exception:
        pass


def suppress_rename(old_path: str, new_path: str, ttl_seconds: float = 25.0) -> None:
    """
    Register a file rename performed by LexiTag itself so neither the old path deletion
    nor the new path addition triggers a redundant watcher scan.
    """
    now = time.monotonic()
    if old_path:
        norm_old = os.path.abspath(old_path)
        _SELF_RENAME_SUPPRESS[norm_old] = now + ttl_seconds
        _SELF_WRITE_SUPPRESS[norm_old] = now + ttl_seconds
        if fs_watcher and fs_watcher.snapshot_ready:
            fs_watcher.remove_from_snapshot(norm_old)
    if new_path:
        norm_new = os.path.abspath(new_path)
        _SELF_WRITE_SUPPRESS[norm_new] = now + ttl_seconds
        if fs_watcher and fs_watcher.snapshot_ready:
            fs_watcher.refresh_single_snapshot(norm_new)


def _is_suppressed(filepath: str) -> bool:
    """Return True if filepath is currently within LexiTag's self-write suppression window."""
    now = time.monotonic()
    # Prune expired entries opportunistically
    expired = [p for p, exp in _SELF_WRITE_SUPPRESS.items() if exp < now]
    for p in expired:
        _SELF_WRITE_SUPPRESS.pop(p, None)
    expired_ren = [p for p, exp in _SELF_RENAME_SUPPRESS.items() if exp < now]
    for p in expired_ren:
        _SELF_RENAME_SUPPRESS.pop(p, None)

    norm = os.path.abspath(filepath)
    exp = _SELF_WRITE_SUPPRESS.get(norm)
    return bool(exp and exp >= now)


def _is_valid_media_filename(name: str) -> bool:
    """
    Fast filename filter before any stat() call:
    - Ignores hidden dotfiles (., .DS_Store, ._*)
    - Ignores partial/temporary files
    - Strictly allows only SUPPORTED_EXTENSIONS audio files (excludes .jpg, .png, .lrc, .nfo, etc.)
    """
    if not name or name.startswith("."):
        return False
    lower = name.lower()
    for bad in IGNORED_SUFFIXES:
        if lower.endswith(bad):
            return False
    ext = os.path.splitext(lower)[1]
    return ext in SUPPORTED_EXTENSIONS


def _scan_filesystem_tree(directories: List[str]) -> Dict[str, Tuple[int, int]]:
    """
    Recursively walk enabled directories using fast C-level os.scandir.
    Returns a dict mapping:
        filepath -> (mtime_ns, size_bytes)
    Strictly for supported audio files only.
    """
    snapshot: Dict[str, Tuple[int, int]] = {}
    stack = list(directories)

    while stack:
        current_dir = stack.pop()
        try:
            with os.scandir(current_dir) as it:
                for entry in it:
                    name = entry.name
                    if name.startswith("."):
                        continue
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            stack.append(entry.path)
                        elif entry.is_file(follow_symlinks=False) and _is_valid_media_filename(name):
                            st = entry.stat(follow_symlinks=False)
                            # Ignore 0-byte empty placeholder files still being created
                            if st.st_size > 0:
                                snapshot[entry.path] = (st.st_mtime_ns, st.st_size)
                    except OSError:
                        continue
        except OSError:
            continue

    return snapshot


class FileSystemWatcherService:
    """Background service that actively monitors library folders for media file changes."""

    def __init__(self):
        self._task: Optional[asyncio.Task] = None
        self._running: bool = False
        self._wake_event: asyncio.Event = asyncio.Event()

        # Configuration (persisted in SQLite settings table)
        self.enabled: bool = False
        # Mode: 'add_delete' (strictly add & delete only - safest for Jellyfin/Navidrome)
        #    or 'all' (add, delete, and external modifications)
        self.mode: str = "add_delete"
        self.poll_seconds: int = 10

        # State & Telemetry
        self.snapshot: Dict[str, Tuple[int, int]] = {}
        self.snapshot_ready: bool = False
        self.watched_dirs: List[str] = []
        # Pending added/modified files waiting to verify size/mtime stability (prevents reading half-copied files)
        # path -> (mtime_ns, size_bytes, action_type)
        self._pending_settle: Dict[str, Tuple[int, int, str]] = {}

        self.stats = {
            "added_count": 0,
            "modified_count": 0,
            "deleted_count": 0,
            "suppressed_self_count": 0,
            "last_event_at": None,
            "last_check_at": None,
        }
        # Keep recent 25 events for UI visibility
        self.recent_events: deque = deque(maxlen=25)

    def refresh_single_snapshot(self, filepath: str) -> None:
        """Update baseline snapshot for a single path after LexiTag writes to it."""
        try:
            if os.path.isfile(filepath) and _is_valid_media_filename(os.path.basename(filepath)):
                st = os.stat(filepath)
                self.snapshot[filepath] = (st.st_mtime_ns, st.st_size)
                self._pending_settle.pop(filepath, None)
        except OSError:
            pass

    def remove_from_snapshot(self, filepath: str) -> None:
        """Remove a path from the baseline snapshot (e.g. when renamed by LexiTag)."""
        self.snapshot.pop(filepath, None)
        self._pending_settle.pop(filepath, None)

    async def load_config(self) -> dict:
        """Load watcher settings from the database."""
        enabled_raw = await get_setting("fs_watcher_enabled", "0")
        mode_raw = await get_setting("fs_watcher_mode", "add_delete")
        poll_raw = await get_setting("fs_watcher_poll_seconds", "10")

        self.enabled = str(enabled_raw).lower() in ("1", "true", "yes")
        self.mode = mode_raw if mode_raw in ("add_delete", "all") else "add_delete"
        try:
            self.poll_seconds = max(5, min(300, int(poll_raw or 10)))
        except ValueError:
            self.poll_seconds = 10

        return await self.get_status()

    async def update_config(
        self,
        enabled: bool,
        mode: str = "add_delete",
        poll_seconds: int = 10,
    ) -> dict:
        """Persist updated watcher configuration and immediately wake the loop."""
        was_enabled = self.enabled
        self.enabled = bool(enabled)
        self.mode = mode if mode in ("add_delete", "all") else "add_delete"
        self.poll_seconds = max(5, min(300, int(poll_seconds or 10)))

        await set_setting("fs_watcher_enabled", "1" if self.enabled else "0")
        await set_setting("fs_watcher_mode", self.mode)
        await set_setting("fs_watcher_poll_seconds", str(self.poll_seconds))

        if self.enabled and not was_enabled:
            # Force fresh baseline sync on enable
            self.snapshot_ready = False
            self._pending_settle.clear()
        elif not self.enabled:
            self.snapshot.clear()
            self.snapshot_ready = False
            self._pending_settle.clear()

        self._wake_event.set()
        logger.info(
            f"[FSWatcher] Config updated: enabled={self.enabled}, mode={self.mode}, poll_seconds={self.poll_seconds}s"
        )
        return await self.get_status()

    async def get_status(self) -> dict:
        """Return current watcher configuration and live telemetry."""
        return {
            "enabled": self.enabled,
            "mode": self.mode,
            "poll_seconds": self.poll_seconds,
            "snapshot_ready": self.snapshot_ready,
            "watched_files_count": len(self.snapshot),
            "watched_dirs": self.watched_dirs,
            "pending_settle_count": len(self._pending_settle),
            "stats": dict(self.stats),
            "recent_events": list(self.recent_events),
        }

    def start(self):
        """Start the background filesystem watcher loop."""
        if self._task is None or self._task.done():
            self._running = True
            self._task = asyncio.create_task(self._run_loop())
            logger.info("[FSWatcher] Background filesystem monitor initialized.")

    def stop(self):
        """Stop the background filesystem watcher loop."""
        self._running = False
        self._wake_event.set()
        if self._task and not self._task.done():
            self._task.cancel()

    async def _get_enabled_directories(self) -> List[str]:
        """Return normalized, deduplicated list of enabled library source directories that exist on disk."""
        db = await get_db()
        cursor = await db.execute("SELECT path FROM library_sources WHERE enabled = 1")
        rows = await cursor.fetchall()
        raw_dirs = [
            os.path.abspath(r["path"].strip()).rstrip(os.path.sep)
            for r in rows
            if r["path"] and r["path"].strip() and os.path.isdir(r["path"].strip())
        ]
        raw_dirs = sorted(list(set(raw_dirs)))
        deduped = []
        for d in raw_dirs:
            if not any(d.startswith(parent + os.path.sep) for parent in deduped):
                deduped.append(d)
        return deduped

    async def _initial_baseline_sync(self, directories: List[str]) -> None:
        """
        Build the initial filesystem snapshot and reconcile any files added or deleted
        while the watcher or server was offline.
        """
        self.watched_dirs = directories
        if not directories:
            self.snapshot = {}
            self.snapshot_ready = True
            return

        disk_snapshot = await asyncio.to_thread(_scan_filesystem_tree, directories)
        self.snapshot = disk_snapshot
        self.snapshot_ready = True
        self.stats["last_check_at"] = time.strftime("%Y-%m-%d %H:%M:%S")

        # Reconcile against DB: find any files on disk not yet in DB (or marked is_missing=1),
        # and any DB active tracks under watched_dirs that are no longer on disk.
        db = await get_db()
        cursor = await db.execute("SELECT id, path, is_missing FROM tracks")
        db_rows = await cursor.fetchall()

        db_map = {r["path"]: (r["id"], bool(r["is_missing"])) for r in db_rows if r["path"]}

        # 1. Check for brand-new files on disk that aren't in DB or were marked missing
        new_or_restored = []
        for fpath in disk_snapshot.keys():
            if fpath not in db_map or db_map[fpath][1]:
                new_or_restored.append(fpath)

        # 2. Check for active DB tracks under watched directories that were deleted from disk
        deleted_ids = []
        if len(disk_snapshot) > 0:  # Safety check: only mark missing if volume is mounted & non-empty
            for db_path, (tid, is_missing) in db_map.items():
                if not is_missing and any(db_path.startswith(d + os.path.sep) for d in directories):
                    if db_path not in disk_snapshot and not _is_suppressed(db_path):
                        deleted_ids.append((tid, db_path))

        if new_or_restored:
            logger.info(f"[FSWatcher] Baseline sync found {len(new_or_restored)} new/restored audio file(s). Indexing...")
            for fpath in new_or_restored[:200]:  # Cap initial burst per cycle
                await self._index_single_file(fpath, event_type="added")

        if deleted_ids:
            logger.info(f"[FSWatcher] Baseline sync found {len(deleted_ids)} deleted audio file(s). Marking missing...")
            for tid, db_path in deleted_ids:
                await self._handle_deleted_file( db_path, track_id=tid)

        logger.info(
            f"[FSWatcher] Baseline snapshot ready: watching {len(self.snapshot)} audio files across {len(directories)} folder(s)."
        )

    async def _index_single_file(self, filepath: str, event_type: str = "added") -> None:
        """Scan a single added or modified audio file and upsert into the database."""
        try:
            track = await asyncio.to_thread(scan_file, filepath)
            if not track:
                return

            db = await get_db()
            cursor = await db.execute("SELECT id FROM tracks WHERE path = ?", (track["path"],))
            existing = await cursor.fetchone()

            if existing:
                await db.execute(
                    """UPDATE tracks SET
                        filename=?, title=?, artist=?, album=?, genre=?, year=?, composer=?, comment=?,
                        duration=?, bitrate=?, has_lyrics=?, lyrics_source=?, has_cover=?, language=?,
                        has_junk=?, format=?, lyrics='', last_scanned=?, is_missing=0, raw_tags_json=?
                       WHERE path=?""",
                    (
                        track["filename"], track["title"], track["artist"],
                        track["album"], track["genre"], track["year"], track["composer"],
                        track.get("comment", ""),
                        track["duration"], track.get("bitrate", 0),
                        1 if track["has_lyrics"] else 0,
                        track.get("lyrics_source", "embedded" if track["has_lyrics"] else ""),
                        1 if track.get("has_cover") else 0,
                        track.get("language", ""),
                        1 if track["has_junk"] else 0,
                        track["format"],
                        track["last_scanned"],
                        track.get("raw_tags_json", "{}"),
                        track["path"],
                    ),
                )
            else:
                await db.execute(
                    """INSERT INTO tracks
                        (path, filename, title, artist, album, genre, year, composer, comment,
                         duration, bitrate, has_lyrics, lyrics_source, has_cover, language,
                         has_junk, format, lyrics, last_scanned, is_missing, raw_tags_json)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, 0, ?)""",
                    (
                        track["path"], track["filename"], track["title"],
                        track["artist"], track["album"], track["genre"],
                        track["year"], track["composer"], track.get("comment", ""),
                        track["duration"], track.get("bitrate", 0),
                        1 if track["has_lyrics"] else 0,
                        track.get("lyrics_source", "embedded" if track["has_lyrics"] else ""),
                        1 if track.get("has_cover") else 0,
                        track.get("language", ""),
                        1 if track["has_junk"] else 0,
                        track["format"],
                        track["last_scanned"],
                        track.get("raw_tags_json", "{}"),
                    ),
                )
            await db.commit()

            ts = time.strftime("%Y-%m-%d %H:%M:%S")
            if event_type == "added":
                self.stats["added_count"] += 1
            else:
                self.stats["modified_count"] += 1
            self.stats["last_event_at"] = ts
            self.recent_events.appendleft({
                "type": event_type,
                "filename": track["filename"],
                "path": filepath,
                "timestamp": ts,
            })
            logger.info(f"[FSWatcher] Auto-{event_type} media file: {track['filename']}")
        except Exception as e:
            logger.error(f"[FSWatcher] Failed indexing {filepath}: {e}")

    async def _handle_deleted_file(self, filepath: str, track_id: Optional[int] = None) -> None:
        """Mark a deleted audio file as missing in the database so it disappears from active library views."""
        try:
            db = await get_db()
            if track_id is not None:
                cur = await db.execute("UPDATE tracks SET is_missing = 1 WHERE id = ? AND is_missing = 0", (track_id,))
            else:
                cur = await db.execute("UPDATE tracks SET is_missing = 1 WHERE path = ? AND is_missing = 0", (filepath,))
            if cur.rowcount > 0:
                await db.commit()
                ts = time.strftime("%Y-%m-%d %H:%M:%S")
                self.stats["deleted_count"] += 1
                self.stats["last_event_at"] = ts
                fname = os.path.basename(filepath)
                self.recent_events.appendleft({
                    "type": "deleted",
                    "filename": fname,
                    "path": filepath,
                    "timestamp": ts,
                })
                logger.info(f"[FSWatcher] Media file removed from disk, marked missing: {fname}")
        except Exception as e:
            logger.error(f"[FSWatcher] Failed marking deleted file {filepath}: {e}")

    async def _poll_once(self) -> None:
        """Perform a single delta check across enabled library directories."""
        from backend.app.routers.tracks import _active_scan_tasks

        # Pause delta checks while a full manual or scheduled scan is actively running
        if _active_scan_tasks:
            return

        directories = await self._get_enabled_directories()
        if directories != self.watched_dirs or not self.snapshot_ready:
            await self._initial_baseline_sync(directories)
            return

        if not directories:
            return

        current_disk = await asyncio.to_thread(_scan_filesystem_tree, directories)
        self.stats["last_check_at"] = time.strftime("%Y-%m-%d %H:%M:%S")

        # Safety check: if all files vanished simultaneously, the mount/volume may have disconnected
        if len(current_disk) == 0 and len(self.snapshot) > 10:
            logger.warning("[FSWatcher] Volume appears unmounted (0 files found); skipping deletion pass.")
            return

        old_snapshot = self.snapshot

        # 1. Detect newly added files and modified files
        for fpath, (mtime_ns, size) in current_disk.items():
            if fpath not in old_snapshot:
                # Newly added file
                if _is_suppressed(fpath):
                    old_snapshot[fpath] = (mtime_ns, size)
                    self.stats["suppressed_self_count"] += 1
                    continue

                # Check settle buffer: wait 1 cycle (or verify size/mtime hasn't changed over 1.5s)
                prev_pending = self._pending_settle.get(fpath)
                if prev_pending and prev_pending[0] == mtime_ns and prev_pending[1] == size:
                    # File has finished copying/writing!
                    self._pending_settle.pop(fpath, None)
                    old_snapshot[fpath] = (mtime_ns, size)
                    await self._index_single_file(fpath, event_type="added")
                else:
                    # First time seeing this new file — verify if it settles quickly (1.5s)
                    self._pending_settle[fpath] = (mtime_ns, size, "added")

            else:
                old_mtime_ns, old_size = old_snapshot[fpath]
                if mtime_ns != old_mtime_ns or size != old_size:
                    # File stat changed
                    if _is_suppressed(fpath):
                        # LexiTag itself modified this file! Update snapshot silently.
                        old_snapshot[fpath] = (mtime_ns, size)
                        self._pending_settle.pop(fpath, None)
                        self.stats["suppressed_self_count"] += 1
                        continue

                    if self.mode == "add_delete":
                        # In Jellyfin/Navidrome safe mode ('add_delete'), ignore external metadata touches
                        old_snapshot[fpath] = (mtime_ns, size)
                        continue

                    # In 'all' mode, wait for write to settle before re-scanning
                    prev_pending = self._pending_settle.get(fpath)
                    if prev_pending and prev_pending[0] == mtime_ns and prev_pending[1] == size:
                        self._pending_settle.pop(fpath, None)
                        old_snapshot[fpath] = (mtime_ns, size)
                        await self._index_single_file(fpath, event_type="modified")
                    else:
                        self._pending_settle[fpath] = (mtime_ns, size, "modified")

        # 2. Fast settle check for newly queued files so additions appear within ~2 seconds
        if self._pending_settle:
            await asyncio.sleep(1.5)
            settled_items = list(self._pending_settle.items())
            for fpath, (p_mtime, p_size, action_type) in settled_items:
                try:
                    if not os.path.isfile(fpath):
                        self._pending_settle.pop(fpath, None)
                        continue
                    st = os.stat(fpath)
                    if st.st_mtime_ns == p_mtime and st.st_size == p_size and st.st_size > 0:
                        self._pending_settle.pop(fpath, None)
                        old_snapshot[fpath] = (st.st_mtime_ns, st.st_size)
                        if not _is_suppressed(fpath):
                            await self._index_single_file(fpath, event_type=action_type)
                except OSError:
                    self._pending_settle.pop(fpath, None)

        # 3. Detect deleted files
        deleted_paths = [fpath for fpath in list(old_snapshot.keys()) if fpath not in current_disk]
        for fpath in deleted_paths:
            old_snapshot.pop(fpath, None)
            self._pending_settle.pop(fpath, None)
            if _is_suppressed(fpath):
                self.stats["suppressed_self_count"] += 1
                continue
            await self._handle_deleted_file(fpath)

    async def _run_loop(self):
        """Main background loop for the filesystem watcher."""
        await asyncio.sleep(2)
        await self.load_config()

        while self._running:
            try:
                self._wake_event.clear()

                if not self.enabled:
                    await self._wake_event.wait()
                    continue

                await self._poll_once()

                try:
                    await asyncio.wait_for(self._wake_event.wait(), timeout=self.poll_seconds)
                except asyncio.TimeoutError:
                    pass
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[FSWatcher] Unexpected error in watcher loop: {e}")
                await asyncio.sleep(10)


# Global singleton instance
fs_watcher = FileSystemWatcherService()
