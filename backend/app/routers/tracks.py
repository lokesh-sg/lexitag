"""Tracks router — library scanning and track listing API."""

from typing import Optional, List, Dict, Any, Union
from fastapi import APIRouter, Query, HTTPException, Request
from fastapi.responses import StreamingResponse
from pathlib import Path
from backend.app.database import get_db
from backend.app.models import (
    TrackBase, TrackList, ScanResponse, TrackUpdateModel, RawTagsResponse,
    LocalFixRequest, CoverSearchResponse, CoverSearchRequest, CoverApplyRequest, GroupSyncCoverRequest
)
from backend.app.services.scanner import scan_directory
from backend.app.config import settings
import json
import time
import os
import uuid
import asyncio
import logging
from backend.app.services.fast_refresh import start_fast_refresh
from backend.app.security import validate_path

logger = logging.getLogger("tracks")

router = APIRouter(prefix="/api/tracks", tags=["tracks"])


from collections import OrderedDict

# Memory-capped LRU Cover Cache
# Strictly prevents server memory overrun:
# - Max total memory: 50MB
# - Max item count: 250 items
# - Max single image size: 4MB (larger images stream directly without consuming RAM cache)
_COVER_CACHE: OrderedDict[int, dict] = OrderedDict()
_COVER_CACHE_MAX_BYTES = 50 * 1024 * 1024  # 50 MB max RAM budget
_COVER_CACHE_MAX_ITEMS = 250
_COVER_CACHE_MAX_SINGLE_BYTES = 4 * 1024 * 1024  # 4 MB
_cover_cache_total_bytes = 0

def _cache_cover(track_id: int, mtime: float, content: bytes, media_type: str) -> str:
    global _cover_cache_total_bytes
    etag = f'"{track_id}-{int(mtime)}"'
    content_size = len(content) if content else 0

    # Skip caching in RAM if single image is too large (>4MB)
    if content_size > _COVER_CACHE_MAX_SINGLE_BYTES or content_size == 0:
        return etag

    # If already cached, subtract old size
    if track_id in _COVER_CACHE:
        old_item = _COVER_CACHE.pop(track_id)
        _cover_cache_total_bytes -= old_item.get("size", 0)

    # Evict oldest until within memory and count limits
    while _COVER_CACHE and (
        len(_COVER_CACHE) >= _COVER_CACHE_MAX_ITEMS or 
        (_cover_cache_total_bytes + content_size) > _COVER_CACHE_MAX_BYTES
    ):
        _, evicted = _COVER_CACHE.popitem(last=False)
        _cover_cache_total_bytes -= evicted.get("size", 0)

    _COVER_CACHE[track_id] = {
        "mtime": mtime,
        "content": content,
        "media_type": media_type,
        "etag": etag,
        "size": content_size,
    }
    _cover_cache_total_bytes += content_size
    return etag

def invalidate_cover_cache(track_id: Optional[int] = None):
    global _cover_cache_total_bytes
    if track_id is None:
        _COVER_CACHE.clear()
        _cover_cache_total_bytes = 0
    elif track_id in _COVER_CACHE:
        evicted = _COVER_CACHE.pop(track_id)
        _cover_cache_total_bytes = max(0, _cover_cache_total_bytes - evicted.get("size", 0))

# In-memory latest progress for scans (job_id -> progress_dict)
_scan_progress: dict[str, dict] = {}
# Active scan tasks for cleanup on reload/abort
_active_scan_tasks: dict[str, asyncio.Task] = {}

@router.post("/scan", response_model=dict)
async def scan_library():
    """Start a background library scan and return a job_id."""
    import uuid
    import asyncio
    from backend.app.database import get_setting

    job_id = str(uuid.uuid4())[:8]
    _scan_progress[job_id] = {"current": 0, "total": 0, "status": "initializing"}
    
    db = await get_db()
    cursor = await db.execute("SELECT path FROM library_sources WHERE enabled = 1")
    enabled_paths = [row["path"] for row in await cursor.fetchall()]
    music_dirs_str = "\n".join(enabled_paths)
    
    async def run_scan_job():
        # Re-get DB connection for the background task
        db = await get_db()
        queue = asyncio.Queue(maxsize=10)
        loop = asyncio.get_event_loop()
        scan_start_ts = time.strftime("%Y-%m-%d %H:%M:%S")

        def producer():
            """Runs in a separate thread."""
            try:
                for res in scan_directory(music_dirs_str):
                    asyncio.run_coroutine_threadsafe(queue.put(res), loop).result()
                asyncio.run_coroutine_threadsafe(queue.put(None), loop).result()
            except Exception as e:
                print(f"[tracks] Scan producer error: {e}")
                asyncio.run_coroutine_threadsafe(queue.put(None), loop).result()

        import threading
        threading.Thread(target=producer, daemon=True).start()
        
        root_dirs = [d.strip() for d in music_dirs_str.split('\n') if d.strip()]
        batch_count = 0
        last_update_count = 0
        total_seen = 0
        
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                    
                current, total, track = item
                if not track:
                    continue
                
                # Upsert
                cursor = await db.execute("SELECT id FROM tracks WHERE path = ?", (track["path"],))
                existing = await cursor.fetchone()
                if existing:
                    await db.execute(
                        """UPDATE tracks SET
                            filename=?, title=?, artist=?, album=?, genre=?, year=?, composer=?, comment=?,
                            duration=?, bitrate=?, has_lyrics=?, has_cover=?, language=?, has_junk=?, format=?, lyrics=?, last_scanned=?, is_missing=0, raw_tags_json=?
                           WHERE path=?""",
                        (
                            track["filename"], track["title"], track["artist"],
                            track["album"], track["genre"], track["year"], track["composer"],
                            track.get("comment", ""),
                            track["duration"], track.get("bitrate", 0), 1 if track["has_lyrics"] else 0,
                            1 if track.get("has_cover") else 0,
                            track.get("language", ""),
                            1 if track["has_junk"] else 0, track["format"],
                            "", track["last_scanned"], track.get("raw_tags_json", "{}"), track["path"],
                        ),
                    )
                else:
                    await db.execute(
                        """INSERT INTO tracks
                            (path, filename, title, artist, album, genre, year, composer, comment,
                             duration, bitrate, has_lyrics, has_cover, language, has_junk, format, lyrics, last_scanned, is_missing, raw_tags_json)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)""",
                        (
                            track["path"], track["filename"], track["title"],
                            track["artist"], track["album"], track["genre"],
                            track["year"], track["composer"], track.get("comment", ""),
                            track["duration"], track.get("bitrate", 0), 1 if track["has_lyrics"] else 0,
                            1 if track.get("has_cover") else 0,
                            track.get("language", ""),
                            1 if track["has_junk"] else 0, track["format"], "", track["last_scanned"],
                            track.get("raw_tags_json", "{}")
                        ),
                    )

                
                total_seen += 1
                batch_count += 1
                
                if batch_count >= 50:
                    await db.commit()
                    batch_count = 0
                
                # Throttle
                if current - last_update_count >= 20 or current == total:
                    _scan_progress[job_id] = {
                        "current": current,
                        "total": total,
                        "filename": track["filename"],
                        "status": "scanning"
                    }
                    last_update_count = current
                
                await asyncio.sleep(0.001)

            await db.commit()

            # Flush any new junk suggestions discovered during this scan
            try:
                from backend.app.services.discovery_engine import discovery_engine
                await discovery_engine.flush_suggestions()
            except Exception as e:
                print(f"[tracks] Discovery flush failed: {e}")



            # Safe Cleanup (Soft-Deleting / Pruning)
            # Only prune if we actually saw files, which proves the volume is mounted.
            if total_seen > 0:
                print(f"[tracks] Scan finished. Seen {total_seen} files. Starting soft-delete prune...")
                cursor = await db.execute("SELECT id, path FROM tracks")
                all_tracks = await cursor.fetchall()
                
                pruned_count = 0
                for tr in all_tracks:
                    # Check if the track's path falls under any of our scanned root directories
                    if any(tr["path"].startswith(rdir) for rdir in root_dirs):
                        if not os.path.exists(tr["path"]):
                            await db.execute("UPDATE tracks SET is_missing = 1 WHERE id = ?", (tr["id"],))
                            pruned_count += 1
                        else:
                            await db.execute("UPDATE tracks SET is_missing = 0 WHERE id = ?", (tr["id"],))
                
                if pruned_count > 0:
                    await db.commit()
                    print(f"[tracks] Marked {pruned_count} orphaned database entries as missing.")
            
            _scan_progress[job_id]["done"] = True

            
        except Exception as e:
            print(f"[tracks] Background scan job error: {e}")
            _scan_progress[job_id]["error"] = str(e)
        finally:
            _active_scan_tasks.pop(job_id, None)

    task = asyncio.create_task(run_scan_job())
    _active_scan_tasks[job_id] = task
    return {"job_id": job_id}


@router.get("/active")
async def get_active_scan_jobs():
    """Retrieve currently running scan jobs (useful for recovery after refresh)."""
    jobs = []
    for job_id, state in _scan_progress.items():
        if not state.get("done") and not state.get("error"):
            jobs.append({
                "job_id": job_id,
                "type": state.get("type", "scan"),
                "status": state.get("status")
            })
    return {"jobs": jobs}


@router.post("/refresh-status", response_model=dict)
async def refresh_junk_status():
    """Trigger a fast background refresh of the junk status for all tracks in DB."""
    import uuid
    job_id = str(uuid.uuid4())[:8]
    _scan_progress[job_id] = {"current": 0, "total": 0, "status": "initializing", "type": "refresh"}
    
    task = asyncio.create_task(start_fast_refresh(job_id, _scan_progress[job_id]))
    _active_scan_tasks[job_id] = task
    return {"job_id": job_id}


@router.get("/scan/progress/{job_id}")
async def stream_scan_progress(job_id: str, request: Request):
    """SSE endpoint for scan progress."""
    async def event_generator():
        last_sent = None
        while True:
            if await request.is_disconnected():
                break
            
            state = _scan_progress.get(job_id)
            if not state:
                break
                
            # Only send if state has changed
            if state != last_sent:
                yield f"data: {json.dumps(state)}\n\n"
                last_sent = state.copy()
                
                if state.get("done") or state.get("error"):
                    # Cleanup after a few seconds to let frontend see it
                    await asyncio.sleep(5)
                    _scan_progress.pop(job_id, None)
                    return
            
            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/groups")
async def list_track_groups(
    group_by: str = Query("album", regex="^(album|artist|folder)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(48, ge=1, le=500),
    search: str = Query(""),
    filter: str = Query(""),
):
    """
    List track groups (albums, artists, or folders) with true group-level pagination and counts.
    """
    db = await get_db()

    # Get enabled source paths
    cursor = await db.execute("SELECT path FROM library_sources WHERE enabled = 1")
    enabled_paths = [row["path"] for row in await cursor.fetchall()]
    if not enabled_paths:
        return {"groups": [], "total_groups": 0, "total_tracks": 0, "page": page, "page_size": page_size}

    where_clauses = ["is_missing = 0"]
    params = []

    path_filters = ["path LIKE ?" for _ in enabled_paths]
    params.extend([f"{p}%" for p in enabled_paths])
    where_clauses.append("(" + " OR ".join(path_filters) + ")")

    if search:
        s = f"%{search}%"
        where_clauses.append("(album LIKE ? OR artist LIKE ? OR title LIKE ? OR filename LIKE ?)")
        params.extend([s, s, s, s])

    where_sql = "WHERE " + " AND ".join(where_clauses)

    query = f"""
        SELECT id, path, filename, title, artist, album, year, format, has_cover
        FROM tracks
        {where_sql}
        ORDER BY album ASC, artist ASC, title ASC
    """
    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()

    if not rows:
        return {"groups": [], "total_groups": 0, "total_tracks": 0, "page": page, "page_size": page_size}

    grouped_map = {}
    for r in rows:
        track_dict = dict(r)
        if group_by == "album":
            album_name = (r["album"] or "").strip()
            key = album_name.lower() if album_name else f"__dir_{Path(r['path']).parent.name.lower()}"
            title = album_name or Path(r["path"]).parent.name or "Unknown Album"
            subtitle = r["artist"] or (f"Year: {r['year']}" if r["year"] else "")
        elif group_by == "artist":
            artist_name = (r["artist"] or "").strip()
            key = artist_name.lower() if artist_name else "__unknown_artist"
            title = artist_name or "Unknown Artist"
            subtitle = r["album"] or ""
        elif group_by == "folder":
            parent = Path(r["path"]).parent
            folder_name = parent.name or "Root"
            key = str(parent).lower()
            title = folder_name
            subtitle = f"{r['album'] or ''} • {r['artist'] or ''}".strip(" •")

        if key not in grouped_map:
            grouped_map[key] = {
                "key": key,
                "title": title,
                "subtitle": subtitle,
                "year": r["year"] or "",
                "representative_track": track_dict,
                "track_count": 0,
                "has_cover_count": 0,
                "missing_cover_count": 0,
                "tracks": [],
            }

        g = grouped_map[key]
        g["tracks"].append(track_dict)
        g["track_count"] += 1
        if r["has_cover"]:
            g["has_cover_count"] += 1
            if not g["representative_track"].get("has_cover"):
                g["representative_track"] = track_dict
        else:
            g["missing_cover_count"] += 1

    all_groups = list(grouped_map.values())

    if filter == "missing_cover":
        all_groups = [g for g in all_groups if g["missing_cover_count"] > 0]
        total_tracks = sum(g["missing_cover_count"] for g in all_groups)
    elif filter == "has_cover":
        all_groups = [g for g in all_groups if g["has_cover_count"] > 0]
        total_tracks = sum(g["has_cover_count"] for g in all_groups)
    else:
        total_tracks = sum(g["track_count"] for g in all_groups)

    total_groups = len(all_groups)

    start_idx = (page - 1) * page_size
    end_idx = start_idx + page_size
    page_groups = all_groups[start_idx:end_idx]

    return {
        "groups": page_groups,
        "total_groups": total_groups,
        "total_tracks": total_tracks,
        "page": page,
        "page_size": page_size,
    }


@router.get("", response_model=TrackList)
async def list_tracks(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=2000),
    search: str = Query("", description="Search term"),
    search_field: str = Query("all", description="Field to search in: all, title, artist, album, filename"),
    filter: str = Query("", description="Filter: missing_lyrics, has_junk, missing_language"),
    sort_by: str = Query("title", description="Sort field"),
    sort_dir: str = Query("asc", description="Sort direction: asc or desc"),
):
    """List tracks with pagination, search, and filtering."""
    db = await get_db()
    
    # Get enabled source paths
    cursor = await db.execute("SELECT path FROM library_sources WHERE enabled = 1")
    enabled_paths = [row["path"] for row in await cursor.fetchall()]
    
    where_clauses = []
    params = []

    if enabled_paths:
        path_filters = []
        for p in enabled_paths:
            path_filters.append("path LIKE ?")
            params.append(f"{p}%")
        where_clauses.append("(" + " OR ".join(path_filters) + ")")
    else:
        # No enabled sources!
        return TrackList(tracks=[], total=0, page=page, page_size=page_size)

    # Filter out missing tracks from the UI list
    where_clauses.append("is_missing = 0")

    if search:
        s = f"%{search}%"
        if search_field == "title":
            where_clauses.append("title LIKE ?")
            params.append(s)
        elif search_field == "artist":
            where_clauses.append("artist LIKE ?")
            params.append(s)
        elif search_field == "album":
            where_clauses.append("album LIKE ?")
            params.append(s)
        elif search_field == "filename":
            where_clauses.append("filename LIKE ?")
            params.append(s)
        elif search_field == "raw_tags":
            where_clauses.append("raw_tags_json LIKE ?")
            params.append(s)
        else:
            where_clauses.append(
                "(title LIKE ? OR artist LIKE ? OR album LIKE ? OR filename LIKE ? OR raw_tags_json LIKE ?)"
            )
            params.extend([s, s, s, s, s])

    if filter == "missing_lyrics":
        where_clauses.append("has_lyrics = 0")
    elif filter == "has_junk":
        where_clauses.append("has_junk = 1")
    elif filter == "missing_language":
        where_clauses.append("(language = '' OR language IS NULL OR language = 'und' OR language = 'Undetermined' OR language = 'unk')")
    elif filter == "missing_cover":
        where_clauses.append("has_cover = 0")
    elif filter == "has_cover":
        where_clauses.append("has_cover = 1")
    elif filter == "untouched":
        where_clauses.append("local_fix_count = 0 AND llm_fix_count = 0")
    elif filter == "local_fixed":
        where_clauses.append("local_fix_count > 0")
    elif filter == "llm_fixed":
        where_clauses.append("llm_fix_count > 0")

    where = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""

    # Sanitize sort field
    allowed_sorts = {"title", "artist", "album", "genre", "year", "duration",
                     "filename", "format", "last_scanned", "composer", "language",
                     "last_fixed_at", "last_fix_type", "bitrate", "comment", "path", "has_cover"}
    if sort_by not in allowed_sorts:
        sort_by = "title"
    direction = "DESC" if sort_dir.lower() == "desc" else "ASC"

    # Count
    count_cursor = await db.execute(
        f"SELECT COUNT(*) as cnt FROM tracks {where}", params
    )
    count_row = await count_cursor.fetchone()
    total = count_row["cnt"] if count_row else 0

    # Fetch page
    offset = (page - 1) * page_size
    cursor = await db.execute(
        f"SELECT * FROM tracks {where} ORDER BY {sort_by} {direction} LIMIT ? OFFSET ?",
        params + [page_size, offset],
    )
    rows = await cursor.fetchall()

    tracks = []
    for row in rows:
        tracks.append(TrackBase(
            id=row["id"],
            path=row["path"],
            filename=row["filename"],
            title=row["title"] or "",
            artist=row["artist"] or "",
            album=row["album"] or "",
            genre=row["genre"] or "",
            year=row["year"] or "",
            composer=row["composer"] or "",
            duration=row["duration"] or 0.0,
            bitrate=row["bitrate"] if "bitrate" in row.keys() else 0,
            has_lyrics=bool(row["has_lyrics"]),
            has_cover=bool(row["has_cover"]),
            language=row["language"] or "",
            has_junk=bool(row["has_junk"]),
            format=row["format"] or "",
            lyrics="", 
            comment=row["comment"] if "comment" in row.keys() else "",
            last_scanned=row["last_scanned"] or "",
            local_fix_count=row["local_fix_count"] or 0,
            llm_fix_count=row["llm_fix_count"] or 0,
            last_fix_type=row["last_fix_type"],
            last_fixed_at=row["last_fixed_at"],
            last_ai_fix_duration=row["last_ai_fix_duration"] if "last_ai_fix_duration" in row.keys() else 0.0,
        ))

    return TrackList(tracks=tracks, total=total, page=page, page_size=page_size)


@router.get("/{track_id}", response_model=TrackBase)
async def get_track(track_id: int):
    """Get a single track by ID."""
    db = await get_db()
    cursor = await db.execute("SELECT * FROM tracks WHERE id = ?", (track_id,))
    row = await cursor.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Track not found")

    return TrackBase(
        id=row["id"],
        path=row["path"],
        filename=row["filename"],
        title=row["title"] or "",
        artist=row["artist"] or "",
        album=row["album"] or "",
        genre=row["genre"] or "",
        year=row["year"] or "",
        composer=row["composer"] or "",
        duration=row["duration"] or 0.0,
        bitrate=row["bitrate"] if "bitrate" in row.keys() else 0,
        has_lyrics=bool(row["has_lyrics"]),
        has_cover=bool(row["has_cover"]),
        language=row["language"] or "",
        has_junk=bool(row["has_junk"]),
        format=row["format"] or "",
        lyrics="", 
        comment=row["comment"] if "comment" in row.keys() else "",
        last_scanned=row["last_scanned"] or "",
        local_fix_count=row["local_fix_count"] or 0,
        llm_fix_count=row["llm_fix_count"] or 0,
        last_fix_type=row["last_fix_type"],
        last_fixed_at=row["last_fixed_at"],
        last_ai_fix_duration=row["last_ai_fix_duration"] if "last_ai_fix_duration" in row.keys() else 0.0,
    )


@router.post("/update")
async def update_tracks(update: TrackUpdateModel):
    """Manually update metadata for one or more tracks."""
    from backend.app.services.tagger import write_tags
    from backend.app.services.scanner import scan_file

    import json
    import time
    db = await get_db()
    updated = []
    errors = []

    for track_id in update.track_ids:
        # Get current state for history and path
        cursor = await db.execute("SELECT * FROM tracks WHERE id = ?", (track_id,))
        row = await cursor.fetchone()
        if not row:
            errors.append(f"Track {track_id} not found")
            continue

        current_path = row["path"]
        validate_path(current_path)
        
        # Capture original tags for history
        original_tags = {
            "title": row["title"],
            "artist": row["artist"],
            "album": row["album"],
            "genre": row["genre"],
            "year": row["year"],
            "composer": row["composer"],
            "comment": row["comment"],
            "lyrics": row["lyrics"],
            "language": row["language"]
        }
        
        # Get raw tags for backup (if possible)
        raw_before = {}
        try:
            from backend.app.services.scanner import fetch_raw_tags
            raw_data = fetch_raw_tags(current_path)
            raw_before = raw_data.get("tags", {})
        except Exception:
            pass

        if not Path(current_path).exists():
            errors.append(f"File not found on disk: {current_path}")
            continue

        path = current_path
        # Physical Migration Logic
        if update.new_path and update.new_path != current_path:
            validate_path(update.new_path)
            try:
                dest = Path(update.new_path)
                dest.parent.mkdir(parents=True, exist_ok=True)
                import shutil
                shutil.move(current_path, update.new_path)
                path = update.new_path
            except Exception as e:
                print(f"[tracks] Failed to move file from {current_path} to {update.new_path}: {e}")
                if not Path(update.new_path).exists():
                    path = current_path

        # In bulk mode, preserve existing fields if empty string is supplied
        is_bulk = len(update.track_ids) > 1
        tags_to_write = {}
        for k, v in update.tags.items():
            if is_bulk and (v is None or v == ""):
                tags_to_write[k] = original_tags.get(k, "")
            else:
                tags_to_write[k] = v

        # Extract target values (supporting both top-level and nested tags)
        target_lyrics = update.lyrics if update.lyrics is not None else update.tags.get("lyrics")
        if is_bulk and (target_lyrics is None or target_lyrics == ""):
            target_lyrics = original_tags.get("lyrics", "")

        target_lang = update.language if update.language is not None else update.tags.get("language")
        if is_bulk and (target_lang is None or target_lang == ""):
            target_lang = original_tags.get("language", "")

        # Write to file
        try:
            success = write_tags(path, tags_to_write, target_lyrics or "", target_lang or "", update.raw_tags)
        except Exception as e:
            logger.error(f"[tracks] Exception writing tags to {path}: {e}")
            success = False
            errors.append(f"{Path(path).name}: {e}")
        
        if success:
            timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
            changed_tags = {k: v for k, v in tags_to_write.items() if v != original_tags.get(k)}
            
            if target_lyrics is not None and target_lyrics != original_tags["lyrics"]:
                changed_tags["lyrics"] = target_lyrics
            if target_lang is not None and target_lang != original_tags["language"]:
                changed_tags["language"] = target_lang

            # 1. Record History (Always, if writing bits to disk succeeded)
            await db.execute(
                """INSERT INTO tag_history (track_id, track_path, original_tags, changed_tags, timestamp, raw_before, raw_after)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    track_id, path, 
                    json.dumps(original_tags), 
                    json.dumps(changed_tags), 
                    timestamp,
                    json.dumps(raw_before),
                    json.dumps(update.raw_tags or {})
                )
            )

            # 2. Re-scan for DB update
            new_data = scan_file(path)
            
            if new_data:
                # Update tracks table with fresh scan data
                final_title = tags_to_write.get("title") or (new_data.get("title") or original_tags["title"])
                final_artist = tags_to_write.get("artist") or (new_data.get("artist") or original_tags["artist"])
                final_album = tags_to_write.get("album") or (new_data.get("album") or original_tags["album"])
                final_genre = tags_to_write.get("genre") or (new_data.get("genre") or original_tags["genre"])
                final_year = tags_to_write.get("year") or (new_data.get("year") or original_tags["year"])
                final_composer = tags_to_write.get("composer") or (new_data.get("composer") or original_tags["composer"])
                final_comment = tags_to_write.get("comment") or (new_data.get("comment") or original_tags["comment"])
                final_lang = target_lang if target_lang is not None else (new_data.get("language") or original_tags["language"])
                has_lyr = 1 if (target_lyrics and target_lyrics.strip()) else 0

                await db.execute(
                    """UPDATE tracks SET
                        title=?, artist=?, album=?, genre=?, year=?, composer=?, comment=?,
                        has_lyrics=?, lyrics=?, language=?, has_junk=?, bitrate=?, last_scanned=?,
                        path=?, filename=?, raw_tags_json=?,
                        local_fix_count = local_fix_count + 1,
                        last_fix_type='manual',
                        last_fixed_at=?
                       WHERE id=?""",
                    (
                        final_title,
                        final_artist,
                        final_album,
                        final_genre,
                        final_year,
                        final_composer,
                        final_comment,
                        has_lyr,
                        "", # Lyrics are not stored in database
                        final_lang,
                        1 if new_data.get("has_junk", False) else 0,
                        new_data.get("bitrate", row["bitrate"]),
                        new_data.get("last_scanned", timestamp),
                        path, Path(path).name, new_data.get("raw_tags_json", "{}"),
                        timestamp,
                        track_id
                    )
                )
            else:
                # Fallback: update DB with request data even if re-scan failed
                final_title = update.tags["title"] if ("title" in update.tags and update.tags["title"] is not None) else original_tags["title"]
                final_artist = update.tags["artist"] if ("artist" in update.tags and update.tags["artist"] is not None) else original_tags["artist"]
                final_album = update.tags["album"] if ("album" in update.tags and update.tags["album"] is not None) else original_tags["album"]
                final_genre = update.tags["genre"] if ("genre" in update.tags and update.tags["genre"] is not None) else original_tags["genre"]
                final_year = update.tags["year"] if ("year" in update.tags and update.tags["year"] is not None) else original_tags["year"]
                final_composer = update.tags["composer"] if ("composer" in update.tags and update.tags["composer"] is not None) else original_tags["composer"]
                final_comment = update.tags["comment"] if ("comment" in update.tags and update.tags["comment"] is not None) else original_tags["comment"]
                final_lang = target_lang if target_lang is not None else original_tags["language"]
                has_lyr = 1 if (target_lyrics and target_lyrics.strip()) else 0

                await db.execute(
                    """UPDATE tracks SET
                        title=?, artist=?, album=?, genre=?, year=?, composer=?, comment=?,
                        language=?, has_lyrics=?, local_fix_count = local_fix_count + 1,
                        last_fix_type='manual', last_fixed_at=?
                       WHERE id=?""",
                    (
                        final_title, final_artist, final_album, final_genre, final_year,
                        final_composer, final_comment, final_lang, has_lyr, timestamp, track_id
                    )
                )
            updated.append(track_id)
        else:
            errors.append(f"Failed to write to {path}")

    await db.commit()
    
    if not updated and errors:
        raise HTTPException(status_code=500, detail=f"Update failed: {'; '.join(errors)}")
        
    return {"success": True, "updated_ids": updated, "errors": errors}


@router.post("/local-fix")
async def local_fix_tracks(update: LocalFixRequest):
    """
    Standardize metadata for one or more tracks on disk without LLM.
    Uses current file tags as source of truth, but writes them back
    using the latest standardized LexiTag mapping conventions.
    """
    from backend.app.services.tagger import write_tags
    from backend.app.services.scanner import scan_file

    db = await get_db()
    updated = []
    errors = []

    for track_id in update.track_ids:
        cursor = await db.execute("SELECT path FROM tracks WHERE id = ?", (track_id,))
        row = await cursor.fetchone()
        if not row:
            errors.append(f"Track {track_id} not found")
            continue

        path = row["path"]
        validate_path(path)

        # 1. Read existing file with robust scanner
        file_data = scan_file(path)
        if not file_data:
            errors.append(f"Could not read {path}")
            continue

        # 2. Extract and Deep-Clean tags using Local Heuristics
        from backend.app.services.local_cleaner import pre_clean_tags, clean_value
        from backend.app.services.scanner import fetch_raw_tags, _check_junk
        
        raw_before_audit = fetch_raw_tags(path).get("tags", {})
        
        # AGGRESSIVE RAW TAG JUNK PURGE
        # Deliberately locate custom raw fields with junk and pass them as deletions
        raw_tags_to_purge = {}
        for k_raw, val_raw in raw_before_audit.items():
            k_str = str(k_raw)
            v_str = str(val_raw[0]) if isinstance(val_raw, list) and val_raw else str(val_raw)
            if _check_junk(k_str) or _check_junk(v_str):
                # Standard fields are already handled by the cleaned dictionary
                if k_str.lower() not in ["title", "artist", "album", "genre", "year", "composer", "comment", "language"]:
                    raw_tags_to_purge[k_str] = ""
        
        raw_tags = {
            "title": file_data["title"],
            "artist": file_data["artist"],
            "album": file_data["album"],
            "genre": file_data["genre"],
            "year": file_data["year"],
            "composer": file_data["composer"],
            "comment": file_data.get("comment", ""),
        }
        tags = pre_clean_tags(raw_tags)
        
        # Also clean lyrics if present
        raw_lyrics = file_data.get("lyrics", "")
        clean_lyrics = ""
        if raw_lyrics:
            clean_lyrics = clean_value(raw_lyrics, "USLT")
        
        # 3. Write back with standardized tagger
        success = write_tags(
            path, 
            tags, 
            clean_lyrics, 
            file_data.get("language", ""),
            raw_tags=raw_tags_to_purge
        )
        
        if success:
            # Record History and Re-scan to update DB
            try:
                from backend.app.services.scanner import fetch_raw_tags
                import time, json
                
                # Fetch original tags for history before re-scan
                cursor = await db.execute("SELECT * FROM tracks WHERE id = ?", (track_id,))
                orig_row = await cursor.fetchone()
                original_tags = {
                    "title": orig_row["title"],
                    "artist": orig_row["artist"],
                    "album": orig_row["album"],
                    "genre": orig_row["genre"],
                    "year": orig_row["year"],
                    "composer": orig_row["composer"],
                    "comment": orig_row["comment"],
                    "lyrics": orig_row["lyrics"],
                    "language": orig_row["language"]
                }
                
                raw_before = {}
                try:
                    raw_data = fetch_raw_tags(path)
                    raw_before = raw_data.get("tags", {})
                except Exception: pass

                new_data = scan_file(path)
                if new_data:
                    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
                    changed_tags = {k: v for k, v in tags.items() if v != original_tags.get(k)}
                    
                    # Record history
                    raw_after_audit = fetch_raw_tags(path).get("tags", {})
                    await db.execute(
                        """INSERT INTO tag_history (track_id, track_path, original_tags, changed_tags, timestamp, raw_before, raw_after)
                           VALUES (?, ?, ?, ?, ?, ?, ?)""",
                        (
                            track_id, path, 
                            json.dumps(original_tags), 
                            json.dumps(changed_tags), 
                            timestamp,
                            json.dumps(raw_before),
                            json.dumps(raw_after_audit)
                        )
                    )
                    
                    # Update tracks table with fresh raw_tags_json
                    await db.execute(
                        """UPDATE tracks SET
                            title=?, artist=?, album=?, genre=?, year=?, composer=?, comment=?,
                            has_lyrics=?, lyrics=?, language=?, has_junk=?, last_scanned=?,
                            local_fix_count = local_fix_count + 1, last_fix_type = 'local',
                            last_fixed_at=?, raw_tags_json=?
                           WHERE id=?""",
                        (
                            new_data["title"], new_data["artist"], new_data["album"],
                            new_data["genre"], new_data["year"], new_data["composer"],
                            new_data["comment"],
                            1 if new_data["has_lyrics"] else 0,
                            "", # Stop saving lyrics to DB
                            new_data["language"],
                            1 if new_data["has_junk"] else 0,
                            new_data["last_scanned"],
                            timestamp,
                            json.dumps(raw_after_audit),
                            track_id
                        )
                    )
                updated.append(track_id)
            except Exception as e:
                import traceback
                traceback.print_exc()
                errors.append(f"{Path(path).name}: DB update failed ({str(e)})")
                updated.append(track_id)
        else:
            errors.append(f"{Path(path).name}: Tag write failed")

    await db.commit()
    
    if not updated and errors:
        raise HTTPException(status_code=500, detail=f"Local fix failed: {'; '.join(errors)}")
        
    return {"success": True, "updated_ids": updated, "errors": errors}


@router.get("/{track_id}/raw", response_model=RawTagsResponse)
async def get_raw_tags(track_id: int):
    """Get every single raw tag mutagen found in the file."""
    from mutagen import File as MutagenFile
    
    db = await get_db()
    cursor = await db.execute("SELECT path, filename, format FROM tracks WHERE id = ?", (track_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Track not found")

    try:
        audio = MutagenFile(row["path"])
        if audio is None:
            raise HTTPException(status_code=400, detail="Could not read file tags")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Audio file not found on disk. Is the volume mounted?")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading file: {str(e)}")

    # Serialize tags as string-indexed dict
    raw_tags = {}
    tags = getattr(audio, "tags", audio)
    if tags:
        for key, val in tags.items():
            # APIC (ID3) or covr (MP4) are binary image data
            if key.startswith("APIC") or key == "covr":
                raw_tags[str(key)] = "__ALBUM_ART__"
                continue

            # Clean up key/val for JSON
            if isinstance(val, list):
                raw_tags[str(key)] = [str(v) for v in val]
            else:
                raw_tags[str(key)] = str(val)

    return RawTagsResponse(
        id=track_id,
        filename=row["filename"],
        format=row["format"],
        tags=raw_tags
    )


@router.get("/{track_id}/lyrics")
async def get_track_lyrics(track_id: int):
    """Fetch lyrics directly from file on disk, with fallback to history."""
    from backend.app.services.scanner import scan_file
    db = await get_db()
    cursor = await db.execute("SELECT path FROM tracks WHERE id = ?", (track_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Track not found")
        
    lyrics = ""
    try:
        data = scan_file(row["path"])
        if data:
            lyrics = data.get("lyrics", "")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Audio file not found on disk. Is the volume mounted?")
    except Exception:
        pass
        
    if not lyrics or not lyrics.strip():
        h_cursor = await db.execute(
            "SELECT changed_tags, original_tags FROM tag_history WHERE (track_id = ? OR track_path = ?) ORDER BY id DESC",
            (track_id, row["path"])
        )
        history_rows = await h_cursor.fetchall()
        for h in history_rows:
            try:
                ct = json.loads(h["changed_tags"]) if h["changed_tags"] else {}
                ot = json.loads(h["original_tags"]) if h["original_tags"] else {}
                if "lyrics" in ct:
                    val = ct["lyrics"]
                    if val == "" or val is None:
                        # User explicitly cleared lyrics in latest edit
                        lyrics = ""
                        break
                    elif val and val.strip() and "LYRICS_NOT_FOUND" not in val:
                        lyrics = val.strip()
                        break
                elif "lyrics" in ot:
                    val = ot["lyrics"]
                    if val and val.strip() and "LYRICS_NOT_FOUND" not in val:
                        lyrics = val.strip()
                        break
            except Exception:
                pass

    return {"lyrics": lyrics}


@router.get("/{track_id}/cover")
async def get_track_cover(track_id: int, request: Request):
    """Retrieve embedded cover art for a track with multi-format and directory fallback support."""
    from mutagen import File as MutagenFile
    from fastapi import Response
    import base64

    db = await get_db()
    cursor = await db.execute("SELECT path, filename FROM tracks WHERE id = ?", (track_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Track not found")

    filepath = row["path"]
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Audio file not found on disk")

    try:
        mtime = os.path.getmtime(filepath)
    except Exception:
        mtime = 0.0

    # 1. Fast in-memory cache check (< 1ms, zero disk I/O, zero mutagen parsing)
    cached = _COVER_CACHE.get(track_id)
    if cached and cached["mtime"] == mtime:
        _COVER_CACHE.move_to_end(track_id)
        if_none_match = request.headers.get("if-none-match")
        if if_none_match and if_none_match.strip('"') == cached["etag"].strip('"'):
            return Response(status_code=304)
        return Response(
            content=cached["content"],
            media_type=cached["media_type"],
            headers={"Cache-Control": "public, max-age=86400", "ETag": cached["etag"]}
        )

    async def _record_cover():
        try:
            await db.execute("UPDATE tracks SET has_cover = 1 WHERE id = ? AND has_cover = 0", (track_id,))
            await db.commit()
        except Exception:
            pass

    audio = MutagenFile(filepath)
    if audio is not None:
        # 1. Handle FLAC pictures
        if hasattr(audio, "pictures") and audio.pictures:
            pic = audio.pictures[0]
            asyncio.create_task(_record_cover())
            etag = _cache_cover(track_id, mtime, pic.data, pic.mime or "image/jpeg")
            return Response(
                content=pic.data,
                media_type=pic.mime or "image/jpeg",
                headers={"Cache-Control": "public, max-age=86400", "ETag": etag}
            )

        tags = getattr(audio, "tags", audio)
        if tags:
            # 2. Handle ID3 (MP3, WAV)
            for key in getattr(tags, "keys", lambda: [])():
                if str(key).startswith("APIC"):
                    frame = tags[key]
                    asyncio.create_task(_record_cover())
                    etag = _cache_cover(track_id, mtime, frame.data, frame.mime or "image/jpeg")
                    return Response(
                        content=frame.data,
                        media_type=frame.mime or "image/jpeg",
                        headers={"Cache-Control": "public, max-age=86400", "ETag": etag}
                    )

            # 3. Handle MP4 (M4A)
            if "covr" in tags and tags["covr"]:
                data = tags["covr"][0]
                mime = "image/png" if data.startswith(b"\x89PNG") else "image/jpeg"
                asyncio.create_task(_record_cover())
                etag = _cache_cover(track_id, mtime, data, mime)
                return Response(
                    content=data,
                    media_type=mime,
                    headers={"Cache-Control": "public, max-age=86400", "ETag": etag}
                )

            # 4. Handle OGG / Opus metadata_block_picture
            if "metadata_block_picture" in tags and tags["metadata_block_picture"]:
                try:
                    from mutagen.flac import Picture
                    b64_data = tags["metadata_block_picture"][0]
                    pic = Picture(base64.b64decode(b64_data))
                    asyncio.create_task(_record_cover())
                    etag = _cache_cover(track_id, mtime, pic.data, pic.mime or "image/jpeg")
                    return Response(
                        content=pic.data,
                        media_type=pic.mime or "image/jpeg",
                        headers={"Cache-Control": "public, max-age=86400", "ETag": etag}
                    )
                except Exception:
                    pass

    # 5. Fallback: check parent directory for standard cover image files
    try:
        parent_dir = Path(filepath).parent
        for candidate in ("cover.jpg", "cover.png", "cover.jpeg", "folder.jpg", "folder.png", "albumart.jpg", "front.jpg", "front.png"):
            art_path = parent_dir / candidate
            if art_path.is_file():
                with open(art_path, "rb") as f:
                    data = f.read()
                mime = "image/png" if candidate.endswith(".png") else "image/jpeg"
                asyncio.create_task(_record_cover())
                etag = _cache_cover(track_id, mtime, data, mime)
                return Response(
                    content=data,
                    media_type=mime,
                    headers={"Cache-Control": "public, max-age=86400", "ETag": etag}
                )
    except Exception:
        pass

    raise HTTPException(status_code=404, detail="No cover art found in file")


@router.post("/batch/cover/search-ai")
async def batch_search_apply_cover_ai(req: CoverApplyRequest):
    """
    Batch retrieve and embed cover art for multiple selected tracks using Google AI.
    Groups tracks by album to minimize duplicate AI queries and network calls.
    """
    from backend.app.services.cover_art_service import search_cover_art_ai, download_image, apply_cover_to_track

    track_ids = req.track_ids or []
    if not track_ids:
        raise HTTPException(status_code=400, detail="No track_ids provided")

    db = await get_db()
    placeholders = ",".join("?" for _ in track_ids)
    cursor = await db.execute(
        f"SELECT id, path, filename, title, artist, album, year FROM tracks WHERE id IN ({placeholders})",
        track_ids
    )
    rows = await cursor.fetchall()
    if not rows:
        raise HTTPException(status_code=404, detail="No matching tracks found")

    # Group tracks strictly by album to execute ONE AI query per album and preserve tokens
    groups = {}
    for r in rows:
        album_val = (r["album"] or "").strip()
        if album_val:
            key = f"album::{album_val.lower()}"
        else:
            # Fallback for tracks without an album tag: group by parent folder
            parent_dir = Path(r["path"]).parent.name if r["path"] else ""
            key = f"folder::{parent_dir.lower()}" if parent_dir else f"track::{r['id']}"
        groups.setdefault(key, []).append(r)

    updated_count = 0
    failed_count = 0
    details = []

    for key, tracks in groups.items():
        # Select best sample track for query (prefer track with year and artist)
        sample = tracks[0]
        for t in tracks:
            if t["year"] and t["artist"]:
                sample = t
                break
            elif t["artist"]:
                sample = t

        parent_folder = Path(sample["path"]).parent.name if sample["path"] else ""
        album_name = sample["album"] or ""
        logger.info(f"[BatchCover] Processing group '{key}' ({len(tracks)} tracks, album='{album_name}')...")

        # If user explicitly provided a specific image_url to apply across batch
        if req.image_url:
            search_res = {"success": True, "image_url": req.image_url, "source": "User Selected"}
        else:
            try:
                search_res = await search_cover_art_ai(
                    title=sample["title"] or "",
                    artist=sample["artist"] or "",
                    album=sample["album"] or "",
                    year=sample["year"] or "",
                    filename=sample["filename"] or "",
                    parent_folder=parent_folder,
                )
            except Exception as e:
                logger.error(f"[BatchCover] Error searching artwork for group '{key}': {e}")
                search_res = {"success": False, "error": str(e)}

        if not search_res.get("success") or not search_res.get("image_url"):
            logger.warning(f"[BatchCover] No artwork located for group '{key}'")
            for t in tracks:
                failed_count += 1
                details.append({
                    "track_id": t["id"],
                    "filename": t["filename"],
                    "success": False,
                    "error": search_res.get("error", "No artwork found")
                })
            continue

        try:
            logger.info(f"[BatchCover] Downloading artwork: {search_res['image_url']}")
            image_bytes, mime_type = await download_image(search_res["image_url"])
            for t in tracks:
                res = await apply_cover_to_track(t["id"], image_bytes, mime_type, search_res["image_url"])
                if res.get("success"):
                    updated_count += 1
                    details.append({"track_id": t["id"], "filename": t["filename"], "success": True})
                else:
                    failed_count += 1
                    details.append({"track_id": t["id"], "filename": t["filename"], "success": False, "error": res.get("error")})
        except Exception as e:
            logger.error(f"[BatchCover] Failed applying image for group '{key}': {e}")
            for t in tracks:
                failed_count += 1
                details.append({"track_id": t["id"], "filename": t["filename"], "success": False, "error": str(e)})

    return {
        "total": len(rows),
        "updated": updated_count,
        "failed": failed_count,
        "details": details
    }


def _scan_and_match_folders(folder_track_map: dict[str, list[int]], candidates_set: set[str]) -> tuple[list[int], int]:
    """Scan directories fast using os.scandir in a worker thread."""
    matched_ids = []
    art_folder_count = 0
    for folder_str, track_ids in folder_track_map.items():
        if not os.path.isdir(folder_str):
            continue
        found = False
        try:
            with os.scandir(folder_str) as it:
                for entry in it:
                    if entry.is_file():
                        name_lower = entry.name.lower()
                        if name_lower in candidates_set:
                            found = True
                            break
                        if name_lower.endswith((".jpg", ".jpeg", ".png")):
                            if any(k in name_lower for k in ("cover", "folder", "front", "album")):
                                found = True
                                break
        except Exception:
            pass

        if found:
            art_folder_count += 1
            matched_ids.extend(track_ids)

    return matched_ids, art_folder_count


def _check_track_embedded_cover(item: tuple[int, str]) -> int | None:
    """Check if an individual audio file contains embedded cover art."""
    track_id, filepath = item
    if not filepath:
        return None
    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(filepath)
        if audio is not None:
            if hasattr(audio, "pictures") and audio.pictures:
                return track_id
            tags = getattr(audio, "tags", audio)
            if tags and hasattr(tags, "keys"):
                for k in tags.keys():
                    ks = str(k)
                    if ks.startswith("APIC") or ks == "covr" or ks.lower() == "metadata_block_picture":
                        return track_id
        ext = os.path.splitext(filepath)[1].lower()
        if ext in (".wav", ".flac"):
            from mutagen.id3 import ID3
            id3_obj = ID3(filepath)
            for k in id3_obj.keys():
                if str(k).startswith("APIC"):
                    return track_id
    except Exception:
        pass
    return None


def _scan_and_match_all(rows: list, folder_track_map: dict[str, list[int]], candidates_set: set[str]) -> tuple[list[int], int, int]:
    """Check both folder artwork and embedded audio tags across all tracks."""
    folder_matched_ids, folders_with_art = _scan_and_match_folders(folder_track_map, candidates_set)
    matched_set = set(folder_matched_ids)

    unmatched_items = [(r["id"], r["path"]) for r in rows if r["id"] not in matched_set and r["path"]]
    embedded_matched_ids = []

    if unmatched_items:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=24) as executor:
            for res in executor.map(_check_track_embedded_cover, unmatched_items, chunksize=50):
                if res is not None:
                    embedded_matched_ids.append(res)

    all_matched = folder_matched_ids + embedded_matched_ids
    return all_matched, folders_with_art, len(embedded_matched_ids)


@router.post("/batch/cover/sync-folder-art")
async def sync_folder_cover_art(request: Request):
    """
    Launch background scan across folders and audio files to detect existing artwork
    (folder images and embedded audio tags) and update has_cover flags in database.
    Streams live progress via SSE /api/tracks/scan/progress/{job_id}.
    """
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass

    track_ids = body.get("track_ids") if isinstance(body, dict) else None

    db = await get_db()
    if track_ids and isinstance(track_ids, list) and len(track_ids) > 0:
        placeholders = ",".join("?" for _ in track_ids)
        query = f"SELECT id, path FROM tracks WHERE id IN ({placeholders}) AND is_missing = 0"
        cursor = await db.execute(query, track_ids)
    else:
        # Scan only tracks from currently enabled library sources that are marked missing cover art
        cursor_sources = await db.execute("SELECT path FROM library_sources WHERE enabled = 1")
        enabled_paths = [row["path"] for row in await cursor_sources.fetchall()]

        where_clauses = ["has_cover = 0", "is_missing = 0"]
        params = []
        if enabled_paths:
            path_filters = ["path LIKE ?" for _ in enabled_paths]
            params.extend([f"{p}%" for p in enabled_paths])
            where_clauses.append("(" + " OR ".join(path_filters) + ")")

        query = f"SELECT id, path FROM tracks WHERE {' AND '.join(where_clauses)}"
        cursor = await db.execute(query, params)

    rows = await cursor.fetchall()
    total_tracks = len(rows)
    if total_tracks == 0:
        return {"success": True, "job_id": None, "tracks_updated": 0, "total": 0, "message": "No missing covers found"}

    # Convert rows to plain dicts for thread safety
    row_data = [{"id": r["id"], "path": r["path"]} for r in rows]

    folder_track_map: dict[str, list[int]] = {}
    for r in row_data:
        p = r["path"]
        if p:
            parent = os.path.dirname(p)
            folder_track_map.setdefault(parent, []).append(r["id"])

    CANDIDATES_SET = {
        "cover.jpg", "cover.png", "cover.jpeg",
        "folder.jpg", "folder.png",
        "albumart.jpg", "front.jpg", "front.png",
        "folder.jpeg", "albumart.png",
    }

    job_id = f"art-{uuid.uuid4().hex[:8]}"
    _scan_progress[job_id] = {
        "current": 0,
        "total": total_tracks,
        "status": "Starting artwork sync...",
        "filename": "Initializing...",
        "type": "cover_sync",
        "found": 0,
        "done": False,
    }

    async def _run_cover_sync():
        db = await get_db()
        try:
            # Step 1: Folders
            _scan_progress[job_id]["status"] = "Checking folder artwork..."
            _scan_progress[job_id]["filename"] = f"Scanning {len(folder_track_map)} folders..."
            folder_matched_ids, folders_with_art = await asyncio.to_thread(_scan_and_match_folders, folder_track_map, CANDIDATES_SET)
            matched_set = set(folder_matched_ids)
            found_count = len(matched_set)
            processed_count = len(folder_matched_ids)

            # Commit folder matches to DB immediately
            if folder_matched_ids:
                for i in range(0, len(folder_matched_ids), 500):
                    chunk = folder_matched_ids[i:i + 500]
                    placeholders = ",".join("?" for _ in chunk)
                    await db.execute(f"UPDATE tracks SET has_cover = 1 WHERE id IN ({placeholders})", chunk)
                await db.commit()

            _scan_progress[job_id]["current"] = min(processed_count, total_tracks)
            _scan_progress[job_id]["found"] = found_count
            _scan_progress[job_id]["status"] = f"Found {found_count} covers in folders. Inspecting audio files..."

            # Step 2: Unmatched files
            unmatched_items = [(r["id"], r["path"]) for r in row_data if r["id"] not in matched_set and r["path"]]
            batch_to_update = []
            
            if unmatched_items:
                from concurrent.futures import ThreadPoolExecutor
                executor = ThreadPoolExecutor(max_workers=20)
                CHUNK_SIZE = 40

                for i in range(0, len(unmatched_items), CHUNK_SIZE):
                    chunk = unmatched_items[i:i + CHUNK_SIZE]
                    results = await asyncio.to_thread(lambda: list(executor.map(_check_track_embedded_cover, chunk)))
                    matched_in_chunk = [res for res in results if res is not None]
                    if matched_in_chunk:
                        found_count += len(matched_in_chunk)
                        batch_to_update.extend(matched_in_chunk)

                    processed_count += len(chunk)
                    last_fname = os.path.basename(chunk[-1][1]) if chunk and chunk[-1][1] else ""

                    _scan_progress[job_id]["current"] = min(processed_count, total_tracks)
                    _scan_progress[job_id]["found"] = found_count
                    _scan_progress[job_id]["filename"] = last_fname
                    _scan_progress[job_id]["status"] = f"Scanning tags ({found_count} covers found)"

                    if len(batch_to_update) >= 200:
                        placeholders = ",".join("?" for _ in batch_to_update)
                        await db.execute(f"UPDATE tracks SET has_cover = 1 WHERE id IN ({placeholders})", batch_to_update)
                        await db.commit()
                        batch_to_update.clear()

                    await asyncio.sleep(0.002)

                executor.shutdown(wait=False)

            if batch_to_update:
                placeholders = ",".join("?" for _ in batch_to_update)
                await db.execute(f"UPDATE tracks SET has_cover = 1 WHERE id IN ({placeholders})", batch_to_update)
                await db.commit()
                batch_to_update.clear()

            _scan_progress[job_id] = {
                "current": total_tracks,
                "total": total_tracks,
                "status": "completed",
                "filename": "Completed",
                "type": "cover_sync",
                "found": found_count,
                "done": True,
            }
        except Exception as e:
            print(f"[cover_sync] Error in background sync: {e}")
            _scan_progress[job_id] = {
                "current": total_tracks,
                "total": total_tracks,
                "status": f"Error: {e}",
                "filename": "Error",
                "type": "cover_sync",
                "error": str(e),
                "done": True,
            }

    task = asyncio.create_task(_run_cover_sync())
    _active_scan_tasks[job_id] = task

    return {
        "success": True,
        "job_id": job_id,
        "status": "started",
        "total": total_tracks,
        "folders_to_check": len(folder_track_map),
    }


@router.post("/groups/sync-cover")
async def sync_group_cover_art(req: GroupSyncCoverRequest):
    """
    Sync cover art from a track (or folder) to all specified target tracks in a group/album.
    """
    from backend.app.services.cover_art_service import extract_cover_bytes, apply_cover_to_track

    db = await get_db()
    source_track_id = req.source_track_id
    target_track_ids = list(req.target_track_ids) if req.target_track_ids else []

    # If target_track_ids was not explicitly passed, resolve automatically from source_track_id or group_key
    if not target_track_ids and source_track_id:
        cursor = await db.execute("SELECT id, path, album FROM tracks WHERE id = ?", (source_track_id,))
        source_row = await cursor.fetchone()
        if source_row:
            album_name = (source_row["album"] or "").strip()
            parent_dir = str(Path(source_row["path"]).parent)
            if album_name:
                c2 = await db.execute("SELECT id FROM tracks WHERE album = ?", (album_name,))
                target_track_ids = [r["id"] for r in await c2.fetchall()]
            else:
                c2 = await db.execute("SELECT id, path FROM tracks")
                target_track_ids = [r["id"] for r in await c2.fetchall() if str(Path(r["path"]).parent) == parent_dir]

    if not target_track_ids and not source_track_id:
        raise HTTPException(status_code=400, detail="Must provide target_track_ids or source_track_id")

    image_bytes = None
    mime_type = "image/jpeg"

    # 0. If image_url provided, download directly
    if req.image_url:
        from backend.app.services.cover_art_service import download_image
        try:
            image_bytes, mime_type = await download_image(req.image_url)
        except Exception as e:
            logger.warning(f"[SyncGroup] Failed to download image from {req.image_url}: {e}")

    # 1. If source_track_id provided, attempt extraction
    if not image_bytes and source_track_id:
        cursor = await db.execute("SELECT id, path FROM tracks WHERE id = ?", (source_track_id,))
        source_row = await cursor.fetchone()
        if source_row:
            image_bytes, mime_type = extract_cover_bytes(source_row["path"])

    # 2. If not found, try any track in target_track_ids that has cover art
    if not image_bytes and target_track_ids:
        placeholders = ",".join("?" for _ in target_track_ids)
        cursor = await db.execute(
            f"SELECT id, path FROM tracks WHERE id IN ({placeholders}) AND has_cover = 1",
            target_track_ids
        )
        for r in await cursor.fetchall():
            img, mime = extract_cover_bytes(r["path"])
            if img:
                image_bytes, mime_type = img, mime
                source_track_id = r["id"]
                break

    # 3. If still not found, check folder of first target track
    if not image_bytes and target_track_ids:
        cursor = await db.execute("SELECT path FROM tracks WHERE id = ?", (target_track_ids[0],))
        first_row = await cursor.fetchone()
        if first_row and first_row["path"]:
            img, mime = extract_cover_bytes(first_row["path"])
            if img:
                image_bytes, mime_type = img, mime

    if not image_bytes:
        raise HTTPException(status_code=400, detail="No cover art found in the source track or folder to sync.")

    updated_ids = []
    failed_ids = []
    for tid in target_track_ids:
        res = await apply_cover_to_track(tid, image_bytes, mime_type, f"Synced from track {source_track_id or 'group'}")
        if res.get("success"):
            updated_ids.append(tid)
            invalidate_cover_cache(tid)
        else:
            failed_ids.append(tid)

    return {
        "success": True,
        "updated": len(updated_ids),
        "failed": len(failed_ids),
        "updated_track_ids": updated_ids,
        "source_track_id": source_track_id,
    }


@router.post("/batch/cover/remove")
async def batch_remove_cover(request: Request):
    """Remove embedded cover art from multiple tracks at once."""
    from backend.app.services.tagger import remove_cover_art

    body = {}
    try:
        body = await request.json()
    except Exception:
        pass

    track_ids = body.get("track_ids", [])
    if not track_ids:
        raise HTTPException(status_code=400, detail="track_ids list is required")

    db = await get_db()
    placeholders = ",".join("?" for _ in track_ids)
    cursor = await db.execute(f"SELECT id, path FROM tracks WHERE id IN ({placeholders})", track_ids)
    rows = await cursor.fetchall()

    removed_ids = []
    failed_ids = []
    cleaned_dirs = set()
    for r in rows:
        try:
            remove_cover_art(r["path"])
            removed_ids.append(r["id"])
            invalidate_cover_cache(r["id"])
            parent_dir = Path(r["path"]).parent
            if parent_dir not in cleaned_dirs:
                cleaned_dirs.add(parent_dir)
                for candidate in ("cover.jpg", "cover.png", "cover.jpeg", "folder.jpg", "folder.png", "albumart.jpg", "front.jpg", "front.png"):
                    art_file = parent_dir / candidate
                    if art_file.is_file():
                        try:
                            art_file.unlink()
                        except Exception:
                            pass
        except Exception as e:
            print(f"[batch_remove_cover] Error removing art from {r['path']}: {e}")
            failed_ids.append(r["id"])

    if removed_ids:
        rem_placeholders = ",".join("?" for _ in removed_ids)
        await db.execute(f"UPDATE tracks SET has_cover = 0 WHERE id IN ({rem_placeholders})", removed_ids)
        await db.commit()

    return {
        "success": True,
        "removed": len(removed_ids),
        "failed": len(failed_ids),
        "removed_ids": removed_ids,
    }


@router.post("/{track_id}/cover/search-ai")
async def search_track_cover_ai(track_id: int, req: Optional[CoverSearchRequest] = None):
    """Query Google AI and verified music sources to find high-resolution album cover art using rich metadata and user guidance."""
    from backend.app.services.cover_art_service import search_cover_art_ai

    db = await get_db()
    cursor = await db.execute(
        "SELECT id, path, filename, title, artist, album, year, composer, language FROM tracks WHERE id = ?",
        (track_id,)
    )
    track = await cursor.fetchone()
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    parent_folder = Path(track["path"]).parent.name

    # Apply overrides from request if specified
    search_album = (req.album if req and req.album else (req.query if req and req.query else track["album"])) or ""
    search_artist = (req.artist if req and req.artist else track["artist"]) or ""
    search_year = (req.year if req and req.year else track["year"]) or ""
    search_title = track["title"] if not (req and req.query and not req.album) else req.query
    custom_prompt = req.prompt if req and req.prompt else ""

    try:
        result = await search_cover_art_ai(
            title=search_title,
            artist=search_artist,
            album=search_album,
            year=search_year,
            filename=track["filename"],
            parent_folder=parent_folder,
            composer=track["composer"] or "",
            language=track["language"] or "",
            custom_prompt=custom_prompt,
        )
        return result
    except Exception as e:
        logger.exception(f"[CoverArt] Search failed for track {track_id}: {e}")
        return {"success": False, "error": f"Search failed: {e}", "candidates": []}


@router.post("/{track_id}/cover/apply")
async def apply_track_cover(track_id: int, req: CoverApplyRequest):
    """Download and embed cover art into the track's audio file."""
    import base64
    from backend.app.services.cover_art_service import download_image, apply_cover_to_track

    image_bytes = None
    mime_type = req.mime_type or "image/jpeg"
    source_url = req.image_url or ""

    if req.base64_data:
        try:
            # Handle data:image/jpeg;base64,... prefix
            raw_b64 = req.base64_data
            if "," in raw_b64:
                header, raw_b64 = raw_b64.split(",", 1)
                if "image/png" in header:
                    mime_type = "image/png"
            image_bytes = base64.b64decode(raw_b64)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid base64 image data: {e}")
    elif req.image_url:
        try:
            image_bytes, detected_mime = await download_image(req.image_url)
            mime_type = detected_mime
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to download image: {e}")
    else:
        raise HTTPException(status_code=400, detail="Must provide either image_url or base64_data")

    result = await apply_cover_to_track(track_id, image_bytes, mime_type, source_url)
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Failed to embed cover art"))

    invalidate_cover_cache(track_id)
    return result


@router.delete("/{track_id}/cover")
async def delete_track_cover(track_id: int):
    """Remove embedded cover art from a track's audio file."""
    from backend.app.services.tagger import remove_cover_art

    db = await get_db()
    cursor = await db.execute("SELECT id, path, filename FROM tracks WHERE id = ?", (track_id,))
    track = await cursor.fetchone()
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    filepath = track["path"]
    remove_cover_art(filepath)
    invalidate_cover_cache(track_id)

    parent_dir = Path(filepath).parent
    for candidate in ("cover.jpg", "cover.png", "cover.jpeg", "folder.jpg", "folder.png", "albumart.jpg", "front.jpg", "front.png"):
        art_file = parent_dir / candidate
        if art_file.is_file():
            try:
                art_file.unlink()
            except Exception:
                pass

    await db.execute("UPDATE tracks SET has_cover = 0 WHERE id = ?", (track_id,))
    await db.commit()

    return {"success": True, "track_id": track_id, "has_cover": False}

@router.post("/{track_id}/refresh-local")
async def refresh_local_metadata(track_id: str):
    """
    Rerun local cleaner on a single track by reading raw tags again 
    and applying current patterns.
    """
    db = await get_db()
    cursor = await db.execute("SELECT path FROM tracks WHERE id = ?", (track_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Track not found")
        
    # Import scanner and cleaner here to avoid circulars if any
    from backend.app.services.scanner import scan_file
    data = scan_file(row["path"])
    if not data:
        raise HTTPException(status_code=500, detail="Failed to re-scan file")
        
    # Update DB with new cleaned values
    # We follow the schema of scan_file return
    await db.execute("""
        UPDATE tracks SET 
            title = ?, artist = ?, album = ?, genre = ?, year = ?, 
            composer = ?, comment = ?, has_junk = ?, format = ?
        WHERE id = ?
    """, (
        data["title"], data["artist"], data["album"], data["genre"], data["year"],
        data["composer"], data["comment"], data["has_junk"], data["format"],
        track_id
    ))
    await db.commit()
    
    return {"message": "Local cleanup refreshed", "data": data}
