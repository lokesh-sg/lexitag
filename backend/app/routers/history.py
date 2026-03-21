"""History router — view tag change logs and revert changes."""

import json
from fastapi import APIRouter, Query, HTTPException
from ..database import get_db
from ..models import TagHistoryEntry, TagHistoryList, MessageResponse
from ..services.fixer import revert_track

router = APIRouter(prefix="/api/history", tags=["history"])


@router.get("", response_model=TagHistoryList)
async def list_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    track_id: int = Query(None),
    search: str = Query(None),
):
    """Get paginated tag change history."""
    db = await get_db()

    # Get enabled source paths
    cursor = await db.execute("SELECT path FROM library_sources WHERE enabled = 1")
    enabled_paths = [row["path"] for row in await cursor.fetchall()]
    
    where_clauses = []
    params = []

    if enabled_paths:
        path_filters = []
        for p in enabled_paths:
            path_filters.append("track_path LIKE ?")
            params.append(f"{p}%")
        where_clauses.append("(" + " OR ".join(path_filters) + ")")
    else:
        # No enabled sources!
        return TagHistoryList(entries=[], total=0, page=page, page_size=page_size)

    if track_id:
        where_clauses.append("track_id = ?")
        params.append(track_id)

    if search:
        where_clauses.append("(track_path LIKE ? OR original_tags LIKE ? OR changed_tags LIKE ?)")
        s = f"%{search}%"
        params.extend([s, s, s])

    where = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
    
    # Base query
    query = f"SELECT * FROM tag_history {where}"
    count_query = f"SELECT COUNT(*) as cnt FROM tag_history {where}"

    # Count
    count_cursor = await db.execute(count_query, params)
    count_row = await count_cursor.fetchone()
    total = count_row["cnt"] if count_row else 0

    # Fetch page (newest first)
    offset = (page - 1) * page_size
    query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
    params.extend([page_size, offset])
    
    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()

    entries = []
    for row in rows:
        entries.append(TagHistoryEntry(
            id=row["id"],
            track_id=row["track_id"],
            track_path=row["track_path"],
            original_tags=json.loads(row["original_tags"]),
            changed_tags=json.loads(row["changed_tags"]),
            timestamp=row["timestamp"],
            reverted=bool(row["reverted"]),
            raw_before=json.loads(row["raw_before"] or "{}"),
            raw_after=json.loads(row["raw_after"] or "{}"),
        ))

    return TagHistoryList(entries=entries, total=total, page=page, page_size=page_size)


@router.post("/{history_id}/revert", response_model=MessageResponse)
async def revert_change(history_id: int):
    """Revert a tag change to the original pre-flight backup state."""
    result = await revert_track(history_id)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error", "Revert failed"))
    return MessageResponse(message=result.get("message", "Tags reverted"), success=True)


@router.post("/batch/{batch_id}/revert", response_model=MessageResponse)
async def revert_batch(batch_id: str):
    """Revert all tag changes in a batch."""
    db = await get_db()
    cursor = await db.execute("SELECT id FROM tag_history WHERE batch_id = ? AND reverted = 0", (batch_id,))
    rows = await cursor.fetchall()

    if not rows:
        return MessageResponse(message="No pending changes in this batch", success=True)

    errors = []
    for row in rows:
        res = await revert_track(row["id"])
        if not res["success"]:
            errors.append(f"ID {row['id']}: {res.get('error')}")

    if errors:
        raise HTTPException(status_code=400, detail="Partial failure: " + "; ".join(errors))

    return MessageResponse(message=f"Batch {batch_id} reverted successfully", success=True)


@router.post("/bulk-revert", response_model=MessageResponse)
async def bulk_revert(req: dict):
    """Revert a list of history IDs."""
    ids = req.get("history_ids", [])
    if not ids:
        return MessageResponse(message="No IDs provided", success=True)

    errors = []
    for hid in ids:
        res = await revert_track(hid)
        if not res["success"]:
            errors.append(f"ID {hid}: {res.get('error')}")

    if errors:
        raise HTTPException(status_code=400, detail="Partial failure: " + "; ".join(errors))

    return MessageResponse(message=f"{len(ids)} changes reverted successfully", success=True)
