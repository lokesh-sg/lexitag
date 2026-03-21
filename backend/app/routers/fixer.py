
"""Fixer router — trigger metadata cleaning pipeline and stream progress."""

import asyncio
import json
import uuid
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from ..models import FixRequest
from ..services.fixer import fix_track
from ..database import get_db
from ..services.job_registry import registry

# 123
router = APIRouter(prefix="/api/fixer", tags=["fixer"])

# Active job tasks for abortion tracking
_active_fix_tasks: dict[str, asyncio.Task] = {}

@router.post("/fix")
async def start_fix(request: FixRequest):
    """
    Start the Fixer pipeline for a list of track IDs.
    If job_id is provided and the job is active, tracks are appended to its queue.
    """
    db = await get_db()
    
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
        "filenames_only": request.filenames_only
    }
    registry.start_job(job_id, request.track_ids, settings=settings)

    batch_id = str(uuid.uuid4())

    async def run_batch():
        from ..services.local_cleaner import load_dynamic_patterns
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
                    filenames_only=job_cfg.get("filenames_only", False)
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
