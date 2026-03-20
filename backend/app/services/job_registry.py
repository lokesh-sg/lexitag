import asyncio
import time
from typing import Dict, List, Any, Optional

class JobRegistry:
    def __init__(self):
        self._jobs: Dict[str, Dict[str, Any]] = {}
        self._active_sse: Dict[str, asyncio.Event] = {}

    def start_job(self, job_id: str, track_ids: List[int], job_type: str = "fix", settings: dict = None):
        self._jobs[job_id] = {
            "job_id": job_id,
            "type": job_type,
            "track_count": len(track_ids),
            "queue": list(track_ids), # List of tracks remaining
            "settings": settings or {},
            "progress": [],
            "done": False,
            "start_time": time.time()
        }
        self._active_sse[job_id] = asyncio.Event()

    def add_to_job(self, job_id: str, track_ids: List[int]):
        """Append new tracks to an existing active job."""
        if job_id in self._jobs and not self._jobs[job_id]["done"]:
            current_queue = set(self._jobs[job_id]["queue"])
            processed_so_far = {p["track_id"] for p in self._jobs[job_id]["progress"] if "track_id" in p}
            
            new_tracks = [tid for tid in track_ids if tid not in current_queue and tid not in processed_so_far]
            
            if new_tracks:
                self._jobs[job_id]["queue"].extend(new_tracks)
                self._jobs[job_id]["track_count"] += len(new_tracks)
                return True
        return False

    def get_next_track(self, job_id: str) -> Optional[int]:
        """Atomic pop from the queue."""
        if job_id in self._jobs and self._jobs[job_id]["queue"]:
            return self._jobs[job_id]["queue"].pop(0)
        return None

    def add_progress(self, job_id: str, event: dict):
        if job_id in self._jobs:
            self._jobs[job_id]["progress"].append(event)
            if event.get("done"):
                self._jobs[job_id]["done"] = True
                self._active_sse[job_id].set()

    def get_progress(self, job_id: str) -> List[dict]:
        return self._jobs.get(job_id, {}).get("progress", [])

    def get_active_jobs(self) -> List[dict]:
        """Returns jobs that are not yet finished."""
        return [
            {
                "job_id": jid, 
                "type": job["type"], 
                "track_count": job["track_count"],
                "settings": job.get("settings", {})
            }
            for jid, job in self._jobs.items() if not job["done"]
        ]

    def clear_job(self, job_id: str):
        self._jobs.pop(job_id, None)
        self._active_sse.pop(job_id, None)

# Global Instance
registry = JobRegistry()
