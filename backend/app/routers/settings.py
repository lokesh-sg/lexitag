"""Unified settings router — handles system paths (Music Dir) and LLM providers."""

import time
import aiohttp
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend.app.database import get_db
from backend.app.services.llm import quota_info, PROVIDER_PRESETS
from backend.app.security import encrypt_value

router = APIRouter(prefix="/api/settings", tags=["Settings"])

_TIMEOUT = aiohttp.ClientTimeout(total=15)


# ── System Settings ──

class SystemSettings(BaseModel):
    music_dir: str

class LibrarySource(BaseModel):
    id: int
    path: str
    enabled: bool

class LibrarySourceList(BaseModel):
    sources: list[LibrarySource]

class CreateSourceReq(BaseModel):
    path: str

class UpdateSourceReq(BaseModel):
    enabled: bool | None = None
    path: str | None = None


@router.get("/system", response_model=SystemSettings)
async def get_system_settings():
    """Fetch global system settings (e.g. music directory)."""
    db = await get_db()
    cursor = await db.execute("SELECT value FROM settings WHERE key = 'music_dir'")
    row = await cursor.fetchone()
    return SystemSettings(music_dir=row["value"] if row else "")


@router.post("/system")
async def update_system_settings(req: SystemSettings):
    """Update global system settings (Legacy compatibility)."""
    db = await get_db()
    await db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('music_dir', ?)",
        (req.music_dir,)
    )
    # Also sync to new library_sources table if they don't exist
    for d in [d.strip() for d in req.music_dir.split('\n') if d.strip()]:
        await db.execute("INSERT OR IGNORE INTO library_sources (path, enabled) VALUES (?, 1)", (d,))
    
    await db.commit()
    return {"message": "System settings updated"}

@router.get("/sources", response_model=LibrarySourceList)
async def list_sources():
    """List all managed music directories."""
    db = await get_db()
    cursor = await db.execute("SELECT * FROM library_sources")
    rows = await cursor.fetchall()
    return LibrarySourceList(sources=[
        LibrarySource(id=row["id"], path=row["path"], enabled=bool(row["enabled"]))
        for row in rows
    ])

@router.post("/sources")
async def add_source(req: CreateSourceReq):
    """Add a new music directory."""
    db = await get_db()
    try:
        await db.execute("INSERT INTO library_sources (path, enabled) VALUES (?, ?)", (req.path, 1))
        await db.commit()
    except Exception as e:
        raise HTTPException(status_code=400, detail="Path already exists or invalid")
    return {"message": "Source added"}

@router.patch("/sources/{source_id}")
async def update_source(source_id: int, req: UpdateSourceReq):
    """Enable/Disable or update a source path."""
    db = await get_db()
    updates = {k: v for k, v in req.dict().items() if v is not None}
    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        await db.execute(f"UPDATE library_sources SET {set_clause} WHERE id = ?", list(updates.values()) + [source_id])
        await db.commit()
    return {"message": "Source updated"}

class RelocateRequest(BaseModel):
    old_base_path: str
    new_base_path: str

@router.post("/sources/relocate")
async def relocate_library(req: RelocateRequest):
    """
    Bulk update all library paths from an old base to a new base.
    Useful when moving from Mac (/Volumes/...) to Ubuntu (/mnt/...) 
    or inside Docker (/app/music).
    """
    import os
    db = await get_db()
    
    # 1. Basic Validation
    new_base = req.new_base_path.rstrip(os.path.sep)
    old_base = req.old_base_path.rstrip(os.path.sep)
    
    if not os.path.isdir(new_base):
        raise HTTPException(status_code=400, detail=f"New path '{new_base}' is not a valid directory or not accessible.")

    # 2. Sample Check: Verify files exist at the new location
    cursor = await db.execute(
        "SELECT path FROM tracks WHERE path LIKE ? LIMIT 10", 
        (f"{old_base}%",)
    )
    samples = await cursor.fetchall()
    
    if not samples:
        raise HTTPException(status_code=404, detail=f"No tracks found in database starting with '{old_base}'.")

    found_count = 0
    for sample in samples:
        potential_new_path = sample["path"].replace(old_base, new_base)
        if os.path.exists(potential_new_path):
            found_count += 1
            
    if found_count == 0:
        raise HTTPException(
            status_code=400, 
            detail=f"Validation failed: None of the sample files from '{old_base}' were found at '{new_base}'. Please check your mapping."
        )

    # 3. Execution
    try:
        # Update Sources
        await db.execute(
            "UPDATE library_sources SET path = REPLACE(path, ?, ?) WHERE path LIKE ?",
            (old_base, new_base, f"{old_base}%")
        )
        
        # Update Tracks
        cursor = await db.execute(
            "UPDATE tracks SET path = REPLACE(path, ?, ?) WHERE path LIKE ?",
            (old_base, new_base, f"{old_base}%")
        )
        tracks_updated = cursor.rowcount
        
        # Update History
        cursor = await db.execute(
            "UPDATE tag_history SET track_path = REPLACE(track_path, ?, ?) WHERE track_path LIKE ?",
            (old_base, new_base, f"{old_base}%")
        )
        history_updated = cursor.rowcount
        
        # 4. Optional: Clean up duplicates if a scan was already partially run on new location
        # This keeps the most recently scanned or lowest ID entry
        await db.execute("""
            DELETE FROM tracks 
            WHERE id NOT IN (
                SELECT MIN(id) FROM tracks GROUP BY path
            )
        """)
        
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Relocation failed: {str(e)}")

    return {
        "message": "Library relocated successfully",
        "tracks_updated": tracks_updated,
        "history_updated": history_updated,
        "sample_match_percentage": (found_count / len(samples)) * 100
    }

@router.delete("/sources/{source_id}")
async def delete_source(source_id: int):
    """Delete a library source."""
    db = await get_db()
    await db.execute("DELETE FROM library_sources WHERE id = ?", (source_id,))
    await db.commit()
    return {"message": "Source deleted"}


# ── LLM Provider Models ──

class ProviderInfo(BaseModel):
    id: int
    name: str
    provider: str
    api_base: str
    api_key_set: bool
    model: str
    is_active: bool
    created_at: str


class ProviderListResponse(BaseModel):
    providers: list[ProviderInfo]
    presets: dict


class CreateProviderRequest(BaseModel):
    name: str
    provider: str
    api_base: str
    api_key: str
    model: str = ""


class UpdateProviderRequest(BaseModel):
    name: str | None = None
    api_base: str | None = None
    api_key: str | None = None
    model: str | None = None


class ModelInfo(BaseModel):
    id: str
    name: str
    description: str = ""


class QuotaResponse(BaseModel):
    remaining_requests: int | None = None
    remaining_tokens: int | None = None
    limit_requests: int | None = None
    limit_tokens: int | None = None
    retry_after_seconds: float | None = None
    last_updated: str | None = None
    last_error: str | None = None
    provider_name: str | None = None
    daily_limit_reached: bool = False


# ── LLM Provider Router ──

@router.get("/llm/providers", response_model=ProviderListResponse)
async def list_providers():
    """List all configured LLM providers."""
    db = await get_db()
    cursor = await db.execute("SELECT * FROM llm_providers ORDER BY is_active DESC, created_at DESC")
    rows = await cursor.fetchall()

    providers = [
        ProviderInfo(
            id=row["id"],
            name=row["name"],
            provider=row["provider"],
            api_base=row["api_base"],
            api_key_set=bool(row["api_key"]), # Still true if key is encrypted/exists
            model=row["model"],
            is_active=bool(row["is_active"]),
            created_at=row["created_at"],
        )
        for row in rows
    ]

    presets = {k: {"label": v["label"], "api_base": v["api_base"], "default_model": v["default_model"]}
               for k, v in PROVIDER_PRESETS.items()}

    return ProviderListResponse(providers=providers, presets=presets)


@router.post("/llm/providers")
async def create_provider(req: CreateProviderRequest):
    """Add a new LLM provider."""
    db = await get_db()
    ts = time.strftime("%Y-%m-%d %H:%M:%S")

    cursor = await db.execute("SELECT COUNT(*) as cnt FROM llm_providers")
    count = (await cursor.fetchone())["cnt"]
    is_active = 1 if count == 0 else 0

    encrypted_key = encrypt_value(req.api_key)

    await db.execute(
        """INSERT INTO llm_providers (name, provider, api_base, api_key, model, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (req.name, req.provider, req.api_base, encrypted_key, req.model, is_active, ts),
    )
    await db.commit()
    return {"message": "Provider created"}


@router.put("/llm/providers/{provider_id}")
async def update_provider(provider_id: int, req: UpdateProviderRequest):
    """Update provider settings."""
    db = await get_db()
    updates = {k: v for k, v in req.dict().items() if v is not None}
    if "api_key" in updates:
        updates["api_key"] = encrypt_value(updates["api_key"])
        
    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        await db.execute(f"UPDATE llm_providers SET {set_clause} WHERE id = ?", list(updates.values()) + [provider_id])
        await db.commit()
    return {"message": "Provider updated"}


@router.delete("/llm/providers/{provider_id}")
async def delete_provider(provider_id: int):
    """Delete a provider."""
    db = await get_db()
    await db.execute("DELETE FROM llm_providers WHERE id = ?", (provider_id,))
    await db.commit()
    return {"message": "Provider deleted"}


@router.post("/llm/providers/{provider_id}/activate")
async def activate_provider(provider_id: int):
    """Set provider as active."""
    db = await get_db()
    await db.execute("UPDATE llm_providers SET is_active = 0")
    await db.execute("UPDATE llm_providers SET is_active = 1 WHERE id = ?", (provider_id,))
    await db.commit()
    return {"message": "Provider activated"}


@router.get("/llm/providers/{provider_id}/models")
async def get_provider_models(provider_id: int):
    """Fetch available models for a provider directly from its API."""
    from backend.app.services import llm
    models = await llm.fetch_models(provider_id)
    return {"models": models}


@router.get("/llm/quota", response_model=QuotaResponse)
async def get_quota():
    """Fetch latest rate limit info."""
    retry_seconds = None
    if quota_info.get("retry_after_ts"):
        remaining = quota_info["retry_after_ts"] - time.time()
        retry_seconds = max(0, round(remaining, 1))

    return QuotaResponse(
        remaining_requests=quota_info.get("remaining_requests"),
        remaining_tokens=quota_info.get("remaining_tokens"),
        limit_requests=quota_info.get("limit_requests"),
        limit_tokens=quota_info.get("limit_tokens"),
        retry_after_seconds=retry_seconds if retry_seconds and retry_seconds > 0 else None,
        last_updated=quota_info.get("last_updated"),
        last_error=quota_info.get("last_error"),
        provider_name=quota_info.get("provider_name"),
        daily_limit_reached=quota_info.get("daily_limit_reached", False),
    )


# ── Cleanup Patterns ──

class CleanupPattern(BaseModel):
    id: int
    pattern: str
    category: str
    is_regex: bool
    created_at: str

class CleanupPatternList(BaseModel):
    patterns: list[CleanupPattern]

class CreateCleanupPattern(BaseModel):
    pattern: str
    category: str = "junk"
    is_regex: bool = False

class CleanupSuggestion(BaseModel):
    id: int
    pattern: str
    frequency: int
    sample_value: str | None
    source_field: str | None
    status: str
    created_at: str

class CleanupSuggestionList(BaseModel):
    suggestions: list[CleanupSuggestion]

@router.get("/cleanup-patterns", response_model=CleanupPatternList)
async def list_cleanup_patterns():
    """List all dynamic cleanup patterns."""
    db = await get_db()
    cursor = await db.execute("SELECT * FROM cleanup_patterns ORDER BY category DESC, pattern ASC")
    rows = await cursor.fetchall()
    return CleanupPatternList(patterns=[
        CleanupPattern(
            id=row["id"],
            pattern=row["pattern"],
            category=row["category"],
            is_regex=bool(row["is_regex"]),
            created_at=row["created_at"]
        ) for row in rows
    ])

@router.post("/cleanup-patterns")
async def add_cleanup_pattern(req: CreateCleanupPattern):
    """Add a new dynamic cleanup pattern."""
    db = await get_db()
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    try:
        await db.execute(
            "INSERT INTO cleanup_patterns (pattern, category, is_regex, created_at) VALUES (?, ?, ?, ?)",
            (req.pattern, req.category, 1 if req.is_regex else 0, ts)
        )
        await db.commit()
    except Exception:
        raise HTTPException(status_code=400, detail="Pattern already exists")
    
    # Reload cleaner patterns in-memory
    from backend.app.services.local_cleaner import load_dynamic_patterns
    await load_dynamic_patterns()
    
    return {"message": "Pattern added"}

@router.delete("/cleanup-patterns/{pattern_id}")
async def delete_cleanup_pattern(pattern_id: int):
    """Delete a cleanup pattern."""
    db = await get_db()
    await db.execute("DELETE FROM cleanup_patterns WHERE id = ?", (pattern_id,))
    await db.commit()
    
    # Reload cleaner patterns in-memory
    from backend.app.services.local_cleaner import load_dynamic_patterns
    await load_dynamic_patterns()
    
    return {"message": "Pattern deleted"}


# ── Cleanup Suggestions (Auto-Discovery) ──

@router.get("/cleanup-suggestions", response_model=CleanupSuggestionList)
async def list_cleanup_suggestions():
    """Retrieve discovered junk candidates for user review."""
    db = await get_db()
    cursor = await db.execute("""
        SELECT * FROM cleanup_suggestions 
        WHERE status = 'pending' 
        ORDER BY frequency DESC, created_at DESC
    """)
    rows = await cursor.fetchall()
    return CleanupSuggestionList(suggestions=[
        CleanupSuggestion(
            id=row["id"],
            pattern=row["pattern"],
            frequency=row["frequency"],
            sample_value=row["sample_value"],
            source_field=row["source_field"],
            status=row["status"],
            created_at=row["created_at"]
        ) for row in rows
    ])

@router.post("/cleanup-suggestions/{suggestion_id}/accept")
async def accept_cleanup_suggestion(suggestion_id: int):
    """Promote a suggestion to a permanent global cleanup pattern."""
    db = await get_db()
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    
    # 1. Get the suggestion
    cursor = await db.execute("SELECT * FROM cleanup_suggestions WHERE id = ?", (suggestion_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Suggestion not found")
        
    pattern = row["pattern"]
    
    # 2. Add to permanent patterns
    try:
        await db.execute(
            "INSERT OR IGNORE INTO cleanup_patterns (pattern, category, is_regex, created_at) VALUES (?, 'junk', 0, ?)",
            (pattern, ts)
        )
        # 3. Mark as accepted
        await db.execute("UPDATE cleanup_suggestions SET status = 'accepted' WHERE id = ?", (suggestion_id,))
        await db.commit()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to accept suggestion: {e}")
        
    # 4. Reload cleaner patterns in-memory
    from backend.app.services.local_cleaner import load_dynamic_patterns
    await load_dynamic_patterns()
    
    return {"message": "Suggestion accepted and patterns reloaded"}

@router.post("/cleanup-suggestions/{suggestion_id}/dismiss")
async def dismiss_cleanup_suggestion(suggestion_id: int):
    """Dismiss a suggestion so it no longer appears in the dashboard."""
    db = await get_db()
    await db.execute("UPDATE cleanup_suggestions SET status = 'dismissed' WHERE id = ?", (suggestion_id,))
    await db.commit()
    return {"message": "Suggestion dismissed"}


# ── System Logs & Debug Management ──

import logging
from pathlib import Path
from fastapi.responses import FileResponse

LOG_FILE_PATH = Path("data/lexitag.log")

@router.get("/logs/view")
async def get_system_logs(lines: int = 500):
    """View recent log entries."""
    if not LOG_FILE_PATH.exists():
        return {"logs": [], "level": logging.getLevelName(logging.getLogger().level)}
    try:
        with open(LOG_FILE_PATH, "r", encoding="utf-8", errors="ignore") as f:
            all_lines = f.readlines()
            recent = [line.strip() for line in all_lines[-lines:] if line.strip()]
            return {"logs": recent, "level": logging.getLevelName(logging.getLogger().level)}
    except Exception as e:
        return {"logs": [f"Error reading log file: {e}"], "level": "INFO"}

@router.get("/logs/download")
async def download_system_logs():
    """Download the full system log file directly."""
    if not LOG_FILE_PATH.exists():
        LOG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE_PATH, "w", encoding="utf-8") as f:
            f.write(f"=== LexiTag System Log Started at {time.strftime('%Y-%m-%d %H:%M:%S')} ===\n")
    
    return FileResponse(
        path=str(LOG_FILE_PATH),
        filename=f"lexitag_system_log_{time.strftime('%Y%m%d_%H%M%S')}.log",
        media_type="text/plain"
    )

@router.post("/logs/toggle")
async def toggle_debug_logging(enabled: bool | None = None):
    """Toggle DEBUG level logging ON/OFF at runtime."""
    root_logger = logging.getLogger()
    if enabled is None:
        new_level = logging.INFO if root_logger.level == logging.DEBUG else logging.DEBUG
    else:
        new_level = logging.DEBUG if enabled else logging.INFO
    
    root_logger.setLevel(new_level)
    for handler in root_logger.handlers:
        handler.setLevel(new_level)
        
    db = await get_db()
    await db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('debug_logging', ?)",
        ("1" if new_level == logging.DEBUG else "0",)
    )
    await db.commit()
    level_name = logging.getLevelName(new_level)
    root_logger.info(f"Log level updated to {level_name}")
    return {"debug_logging": new_level == logging.DEBUG, "level": level_name}

@router.post("/logs/clear")
async def clear_system_logs():
    """Clear/truncate the system log file."""
    if LOG_FILE_PATH.exists():
        with open(LOG_FILE_PATH, "w", encoding="utf-8") as f:
            f.write(f"=== LexiTag System Log Reset at {time.strftime('%Y-%m-%d %H:%M:%S')} ===\n")
    return {"message": "Logs cleared successfully"}
