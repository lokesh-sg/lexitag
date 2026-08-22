"""Tracks router — library scanning and track listing API."""

from fastapi import APIRouter, Query, HTTPException, Request
from fastapi.responses import StreamingResponse
from pathlib import Path
from backend.app.database import get_db
from backend.app.models import TrackBase, TrackList, ScanResponse, TrackUpdateModel, RawTagsResponse, LocalFixRequest
from backend.app.services.scanner import scan_directory
from backend.app.config import settings
import json
import time
import os
import uuid
import asyncio
from backend.app.services.fast_refresh import start_fast_refresh
from backend.app.security import validate_path

router = APIRouter(prefix="/api/tracks", tags=["tracks"])


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
                            duration=?, bitrate=?, has_lyrics=?, language=?, has_junk=?, format=?, lyrics=?, last_scanned=?, is_missing=0, raw_tags_json=?
                           WHERE path=?""",
                        (
                            track["filename"], track["title"], track["artist"],
                            track["album"], track["genre"], track["year"], track["composer"],
                            track.get("comment", ""),
                            track["duration"], track.get("bitrate", 0), 1 if track["has_lyrics"] else 0,
                            track.get("language", ""),
                            1 if track["has_junk"] else 0, track["format"],
                            "", track["last_scanned"], track.get("raw_tags_json", "{}"), track["path"],
                        ),
                    )
                else:
                    await db.execute(
                        """INSERT INTO tracks
                            (path, filename, title, artist, album, genre, year, composer, comment,
                             duration, bitrate, has_lyrics, language, has_junk, format, lyrics, last_scanned, is_missing, raw_tags_json)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)""",
                        (
                            track["path"], track["filename"], track["title"],
                            track["artist"], track["album"], track["genre"],
                            track["year"], track["composer"], track.get("comment", ""),
                            track["duration"], track.get("bitrate", 0), 1 if track["has_lyrics"] else 0,
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
                     "last_fixed_at", "last_fix_type", "bitrate", "comment", "path"}
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

        # Extract target values (supporting both top-level and nested tags)
        target_lyrics = update.lyrics if update.lyrics is not None else update.tags.get("lyrics")
        target_lang = update.language if update.language is not None else update.tags.get("language")

        # Write to file
        success = write_tags(path, update.tags, target_lyrics or "", target_lang or "", update.raw_tags)
        
        if success:
            timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
            changed_tags = {k: v for k, v in update.tags.items() if v != original_tags.get(k)}
            
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
                # PRIORITIZE update.tags/lyrics/language over re-scan for standard fields
                # to avoid issues where re-scan fails to read back tags immediately after write.
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
                        update.tags.get("title") or new_data.get("title") or original_tags["title"],
                        update.tags.get("artist") or new_data.get("artist") or original_tags["artist"],
                        update.tags.get("album") or new_data.get("album") or original_tags["album"],
                        update.tags.get("genre") or new_data.get("genre") or original_tags["genre"],
                        update.tags.get("year") or new_data.get("year") or original_tags["year"],
                        update.tags.get("composer") or new_data.get("composer") or original_tags["composer"],
                        update.tags.get("comment") or new_data.get("comment") or original_tags["comment"],
                        1 if (target_lyrics or new_data.get("has_lyrics")) else 0,
                        "", # Lyrics are not stored in database
                        target_lang or new_data.get("language") or original_tags["language"],
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
                await db.execute(
                    """UPDATE tracks SET
                        title=?, artist=?, album=?, genre=?, year=?, composer=?, comment=?,
                        language=?, local_fix_count = local_fix_count + 1,
                        last_fix_type='manual', last_fixed_at=?
                       WHERE id=?""",
                    (
                        update.tags.get("title", original_tags["title"]),
                        update.tags.get("artist", original_tags["artist"]),
                        update.tags.get("album", original_tags["album"]),
                        update.tags.get("genre", original_tags["genre"]),
                        update.tags.get("year", original_tags["year"]),
                        update.tags.get("composer", original_tags["composer"]),
                        update.tags.get("comment", original_tags["comment"]),
                        target_lang or original_tags["language"],
                        timestamp,
                        track_id
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
    """Fetch lyrics directly from the file on disk (Single Source of Truth)."""
    from backend.app.services.scanner import scan_file
    db = await get_db()
    cursor = await db.execute("SELECT path FROM tracks WHERE id = ?", (track_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Track not found")
        
    try:
        data = scan_file(row["path"])
        if not data:
            raise HTTPException(status_code=500, detail="Could not read file")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Audio file not found on disk. Is the volume mounted?")
        
    return {"lyrics": data.get("lyrics", "")}


@router.get("/{track_id}/cover")
async def get_track_cover(track_id: int):
    """Retrieve embedded cover art for a track."""
    from mutagen import File as MutagenFile
    from fastapi import Response
    import io

    db = await get_db()
    cursor = await db.execute("SELECT path FROM tracks WHERE id = ?", (track_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Track not found")

    audio = MutagenFile(row["path"])
    if audio is None:
        raise HTTPException(status_code=404, detail="Could not read file")
        
    tags = getattr(audio, "tags", audio)
    if not tags:
        raise HTTPException(status_code=404, detail="No tags found")

    # Handle ID3 (MP3, WAV)
    tag_keys = str(tags.keys())
    if "APIC:" in tag_keys or any(k.startswith("APIC") for k in tags.keys()):
        # Find the first APIC frame
        for key in tags.keys():
            if key.startswith("APIC"):
                frame = tags[key]
                return Response(content=frame.data, media_type=frame.mime)

    # Handle MP4 (M4A)
    if "covr" in tags:
        data = tags["covr"][0]
        # Mutagen returns bytes for covr
        # We need to guess the mime type or use a default
        # MP4 covers are usually JPEG or PNG
        mime = "image/jpeg" 
        if data.startswith(b"\x89PNG"):
            mime = "image/png"
        return Response(content=data, media_type=mime)

    raise HTTPException(status_code=404, detail="No cover art found in file")

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
