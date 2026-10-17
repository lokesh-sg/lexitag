"""Fast Junk Refresh — re-evaluates junk status of all tracks in the DB without a full disk scan."""

import sqlite3
import asyncio
import time
from pathlib import Path
from backend.app.services.scanner import scan_file
from backend.app.database import get_db

async def start_fast_refresh(job_id: str, progress_dict: dict):
    """
    Bg task to refresh has_junk status for all active tracks in DB.
    Updates progress_dict in-place.
    """
    db = await get_db()

    # Only refresh tracks belonging to enabled library_sources and not marked missing
    cursor = await db.execute("SELECT path FROM library_sources WHERE enabled = 1")
    enabled_paths = [row["path"] for row in await cursor.fetchall()]

    where_clauses = ["is_missing = 0"]
    params = []
    if enabled_paths:
        path_filters = ["path LIKE ?" for _ in enabled_paths]
        params.extend([f"{p}%" for p in enabled_paths])
        where_clauses.append("(" + " OR ".join(path_filters) + ")")
    else:
        progress_dict["done"] = True
        progress_dict["total"] = 0
        return

    where_sql = "WHERE " + " AND ".join(where_clauses)

    # 1. Count active tracks
    cursor = await db.execute(f"SELECT COUNT(*) as cnt FROM tracks {where_sql}", params)
    row = await cursor.fetchone()
    total = row["cnt"] if row else 0
    
    if total == 0:
        progress_dict["done"] = True
        progress_dict["total"] = 0
        return

    progress_dict["total"] = total
    progress_dict["status"] = "refreshing"
    progress_dict["type"] = "refresh" # Ensure type is sticky

    # 2. Page through tracks to avoid huge memory/locking
    LIMIT = 100
    offset = 0
    processed = 0
    
    while offset < total:
        cursor = await db.execute(
            f"SELECT id, path, filename FROM tracks {where_sql} LIMIT ? OFFSET ?", 
            params + [LIMIT, offset]
        )
        rows = await cursor.fetchall()
        if not rows:
            break
            
        for row in rows:
            track_id = row["id"]
            path = row["path"]
            
            # Update progress status
            processed += 1
            if processed % 10 == 0 or processed == total:
                progress_dict["current"] = processed
                progress_dict["filename"] = row["filename"]

            # Re-scan file (Deep Scan logic is already in scanner.scan_file)
            try:
                data = scan_file(path)
                if data:
                    print(f"[fast_refresh] Track {track_id} junk: {data['has_junk']} | {path}")
                    await db.execute(
                        "UPDATE tracks SET has_junk = ?, has_cover = ? WHERE id = ?",
                        (1 if data["has_junk"] else 0, 1 if data.get("has_cover") else 0, track_id)
                    )
            except Exception as e:
                print(f"[fast_refresh] Error on {path}: {e}")

        # Commit batch
        await db.commit()
        offset += LIMIT
        await asyncio.sleep(0.02) # Yield a bit more for UI

    progress_dict["done"] = True
    progress_dict["status"] = "completed"
    print(f"[fast_refresh] Finished refresh of {total} tracks.")

