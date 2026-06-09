
"""Fixer router — trigger metadata cleaning pipeline and stream progress."""

import asyncio
import json
import uuid
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from backend.app.models import FixRequest
from backend.app.services.fixer import fix_track
from backend.app.database import get_db
from backend.app.services.job_registry import registry

# 123
router = APIRouter(prefix="/api/fixer", tags=["fixer"])

# Active job tasks for abortion tracking
_active_fix_tasks: dict[str, asyncio.Task] = {}

class PreviewRequest(BaseModel):
    track_ids: list[int]

@router.post("/preview")
async def preview_fix(request: PreviewRequest):
    """Dry-run the local fix pipeline using a full mock write to ensure 100% accuracy."""
    db = await get_db()
    from backend.app.services.scanner import fetch_raw_tags, scan_file
    from backend.app.services.local_cleaner import pre_clean_tags
    from backend.app.services.tagger import write_tags, append_language_genre, _get_full_lang
    import shutil
    import tempfile
    import os
    
    results = []
    
    for track_id in request.track_ids:
        cursor = await db.execute("SELECT path, filename FROM tracks WHERE id = ?", (track_id,))
        row = await cursor.fetchone()
        if not row: continue
        
        path = row["path"]
        raw_before = fetch_raw_tags(path).get("tags", {})
        
        ext = os.path.splitext(path)[1]
        temp_fd, temp_path = tempfile.mkstemp(suffix=ext)
        os.close(temp_fd)
        
        try:
            shutil.copy2(path, temp_path)
            
            final_summary = scan_file(temp_path)
            if not final_summary: raise Exception("Scan failed")
            
            cleaned_tags = pre_clean_tags(final_summary)
            IGNORE_KEYS = {"has_junk", "has_lyrics", "last_scanned", "path", "filename", "duration", "suggested_filename", "current_filename", "parent_folder", "discovery_result", "research_context"}
            tags_to_write = {k: v for k, v in cleaned_tags.items() if k not in IGNORE_KEYS}
            
            # Aggressive raw tag purge match
            from backend.app.services.scanner import _check_junk
            raw_tags_to_purge = {}
            for k, val in raw_before.items():
                k_str = str(k)
                v_str = str(val[0]) if isinstance(val, list) and val else str(val)
                if _check_junk(k_str) or _check_junk(v_str):
                    if k_str.lower() not in ["title", "artist", "album", "genre", "year", "composer", "comment", "language"]:
                        raw_tags_to_purge[k_str] = ""
            
            language = final_summary.get("language")
            write_tags(temp_path, tags_to_write, final_summary.get("lyrics", ""), language, raw_tags=raw_tags_to_purge)
            
            if full_lang := _get_full_lang(language):
                append_language_genre(temp_path, full_lang)
                
            raw_after = fetch_raw_tags(temp_path).get("tags", {})
            
            # Unflatten lists for easy diff string comparison
            diffs = {}
            all_keys = set(raw_before.keys()).union(raw_after.keys())
            
            # Inject Scanner Diagnostics so the UI displays what matched!
            from backend.app.services.scanner import _check_junk
            diagnostics = []
            for k in raw_before.keys():
                k_str = str(k)
                orig_val = raw_before.get(k, [])
                v_str = str(orig_val[0]) if isinstance(orig_val, list) and orig_val else str(orig_val) if orig_val else ""
                
                if _check_junk(k_str): diagnostics.append(f"Key trigger: '{k_str}'")
                if _check_junk(v_str): diagnostics.append(f"Value trigger: '{v_str}'")
                
            if diagnostics:
                diffs["[Scanner Diagnostics]"] = {
                    "old": "Triggered JUNK flag because:\n" + "\n".join(diagnostics),
                    "new": "Will be physically purged from container"
                }

            for k in all_keys:
                orig_val = raw_before.get(k, [])
                new_val = raw_after.get(k, [])
                
                orig_str = str(orig_val[0]) if isinstance(orig_val, list) and orig_val else str(orig_val) if orig_val else ""
                new_str = str(new_val[0]) if isinstance(new_val, list) and new_val else str(new_val) if new_val else ""
                
                if orig_str != new_str:
                    diffs[k] = {"old": orig_str, "new": new_str}
                    
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
                
        results.append({
            "track_id": track_id,
            "filename": row["filename"],
            "diffs": diffs
        })
        
    return {"success": True, "results": results}

@router.post("/fix")
async def start_fix(request: FixRequest):
    """
    Start the Fixer pipeline for a list of track IDs.
    If job_id is provided and the job is active, tracks are appended to its queue.
    """
    db = await get_db()
    
    if request.all_tracks:
        cursor = await db.execute("SELECT id FROM tracks WHERE is_missing = 0")
        rows = await cursor.fetchall()
        request.track_ids = list(set(request.track_ids + [r["id"] for r in rows]))
    
    # CASE A: Append to existing job
    if request.job_id and request.job_id in _active_fix_tasks:
        if registry.add_to_job(request.job_id, request.track_ids):
            new_total = registry._jobs[request.job_id]["track_count"]
            return {"job_id": request.job_id, "appended": True, "track_count": new_total}

    # CASE B: Start new job
    job_id = str(uuid.uuid4())[:8]
    settings = {
        "clean_filenames": request.clean_filenames,
        "lyrics_only": request.lyrics_only,
        "local_only": request.local_only,
        "filenames_only": request.filenames_only,
        "language_only": request.language_only
    }
    registry.start_job(job_id, request.track_ids, settings=settings)

    batch_id = str(uuid.uuid4())

    async def run_batch():
        from backend.app.services.local_cleaner import load_dynamic_patterns
        await load_dynamic_patterns()
        
        try:
            while True:
                tid = registry.get_next_track(job_id)
                if tid is None:
                    break
                
                # Resolve name for notification
                cursor = await db.execute("SELECT filename FROM tracks WHERE id = ?", (tid,))
                row = await cursor.fetchone()
                track_name = row["filename"] if row else f"Track {tid}"

                async def progress_cb(track_id, step, status, message="", duration=0.0):
                    event = {
                        "track_id": track_id,
                        "track_name": track_name,
                        "step": step,
                        "status": status,
                        "message": message,
                        "duration": duration,
                    }
                    registry.add_progress(job_id, event)

                # Use settings from the registry (they were saved at start)
                job_cfg = registry._jobs[job_id]["settings"]
                await fix_track(
                    tid, 
                    batch_id=batch_id, 
                    progress_callback=progress_cb, 
                    clean_filenames=job_cfg.get("clean_filenames", False), 
                    lyrics_only=job_cfg.get("lyrics_only", False), 
                    local_only=job_cfg.get("local_only", False),
                    filenames_only=job_cfg.get("filenames_only", False),
                    language_only=job_cfg.get("language_only", False)
                )
                await asyncio.sleep(0.4) # Consistent delay
            
            # Signal completion with actual counts
            final_job = registry._jobs.get(job_id, {})
            processed_count = final_job.get("track_count", 0) - len(final_job.get("queue", []))
            registry.add_progress(job_id, {"done": True, "processed": processed_count, "total": final_job.get("track_count", 0)})
        except asyncio.CancelledError:
            final_job = registry._jobs.get(job_id, {})
            # When cancelled, the track that was currently being processed is considered "in progress" but not completed.
            processed_count = final_job.get("track_count", 0) - len(final_job.get("queue", []))
            registry.add_progress(job_id, {
                "status": "aborted", 
                "done": True, 
                "message": "Job aborted by user",
                "processed": max(0, processed_count - 1),  # Subtract the one that was cancelled mid-air
                "total": final_job.get("track_count", 0)
            })
        finally:
            _active_fix_tasks.pop(job_id, None)

    task = asyncio.create_task(run_batch())
    _active_fix_tasks[job_id] = task
    
    return {"job_id": job_id, "track_count": len(request.track_ids)}

@router.post("/abort/{job_id}")
async def abort_fix(job_id: str):
    """Abort an ongoing fix job."""
    task = _active_fix_tasks.get(job_id)
    if not task:
        return {"message": "Job not found or already finished"}
    
    task.cancel()
    return {"message": "Abort signal sent"}

@router.get("/active")
async def get_active_fix_jobs():
    """Retrieve currently running fix jobs (useful for recovery after refresh)."""
    return {"jobs": registry.get_active_jobs()}

@router.get("/progress/{job_id}")
async def stream_progress(job_id: str, request: Request):
    """SSE endpoint streaming fixer progress events."""

    async def event_generator():
        sent = 0
        while True:
            if await request.is_disconnected():
                break

            events = registry.get_progress(job_id)

            while sent < len(events):
                event = events[sent]
                sent += 1

                if event.get("done"):
                    yield f"data: {json.dumps(event)}\n\n"
                    return

                yield f"data: {json.dumps(event)}\n\n"

            await asyncio.sleep(0.3)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
