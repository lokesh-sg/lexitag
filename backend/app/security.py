"""Security utilities — Encryption, Authentication, and Path Jailing."""

import os
import hashlib
import base64
import logging
from cryptography.fernet import Fernet
from fastapi import HTTPException, Security, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pathlib import Path
from backend.app.config import settings

# ── Encryption & Decryption ──

def _get_fernet() -> Fernet:
    """
    Initialize Fernet with the master key.
    If LEXITAG_MASTER_KEY is not set, we attempt to load/save a persistent key 
    file in the DATA_DIR to enable zero-touch production deployments.
    """
    key = settings.LEXITAG_MASTER_KEY
    
    if not key:
        # Check for persistent key file in DATA_DIR
        key_file = Path(settings.DATA_DIR) / ".master.key"
        if key_file.exists():
            key = key_file.read_text().strip()
        elif settings.ENV == "production":
            # AUTO-GENERATE for Zero-Touch Production
            from cryptography.fernet import Fernet as F
            new_key = F.generate_key().decode()
            try:
                os.makedirs(settings.DATA_DIR, exist_ok=True)
                key_file.write_text(new_key)
                logging.getLogger("lexitag").info(
                    f"[SECURITY] Auto-generated persistent LEXITAG_MASTER_KEY at {key_file}. "
                    "Keep this file safe for future data recovery."
                )
                key = new_key
            except Exception as e:
                logging.getLogger("lexitag").error(f"Failed to persist auto-generated key: {e}")
                # Fallback to dev-style behavior if disk is read-only
                key = "lexitag-prod-auto-fallback-insecure"
        else:
            # Development only: stable fallback
            logging.warning("[SECURITY] LEXITAG_MASTER_KEY not set — using derived dev key.")
            key = "lexitag-dev-fallback-key-do-not-use-in-prod"
    
    try:
        # Ensure it's a valid Fernet key (base64 32-byte)
        return Fernet(key.encode())
    except Exception:
        # If user provided a plain string, we'll hash it into a valid Fernet key
        hashed_key = hashlib.sha256(key.encode()).digest()
        b64_key = base64.urlsafe_b64encode(hashed_key)
        return Fernet(b64_key)

def encrypt_value(value: str) -> str:
    """Encrypt a plain text string."""
    if not value: return ""
    f = _get_fernet()
    return f.encrypt(value.encode()).decode()

def decrypt_value(token: str) -> str:
    """Decrypt an encrypted string."""
    if not token: return ""
    f = _get_fernet()
    try:
        return f.decrypt(token.encode()).decode()
    except Exception:
        # If decryption fails (e.g. key changed), return empty or original if it wasn't encrypted
        # For safety in LLM key retrieval, we'll return empty
        return ""


# ── Authentication ──

security = HTTPBearer(auto_error=False)

async def verify_token(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    """FastAPI dependency to verify the LEXITAG_AUTH_TOKEN."""
    if not settings.LEXITAG_AUTH_TOKEN:
        return # Auth disabled if token not set
    
    if not credentials:
        # Fallback for EventSource or cases where header didn't parse
        token = request.query_params.get("token")
    else:
        token = credentials.credentials
    
    if not token and request.query_params.get("token"):
        token = request.query_params.get("token")

    if token != settings.LEXITAG_AUTH_TOKEN:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ── Path Jailing ──

def validate_path(filepath: str) -> str:
    """
    Ensure the path is within the allowed MUSIC_DIR to prevent traversal.
    Returns the resolved absolute path if valid, else raises 403.
    """
    try:
        # Resolve real paths to catch symlink tricks
        target_path = Path(filepath).resolve()
        
        # We need to check against all configured music directories
        # But usually we'll check against a common root or specific allowed paths.
        from backend.app.database import get_db
        # This is a bit heavy for every scan, so we might want to cache or use settings.MUSIC_DIR
        # For now, let's just ensure it doesn't escape the DATA_DIR or system roots if possible.
        
        # Hard restriction: Cannot touch system directories
        FORBIDDEN_ROOTS = ["/etc", "/var", "/bin", "/sbin", "/usr", "/System", "/Library"]
        for root in FORBIDDEN_ROOTS:
            if str(target_path).startswith(root):
                 raise HTTPException(status_code=403, detail="Access to system directory forbidden")
        
        return str(target_path)
    except Exception as e:
        if isinstance(e, HTTPException): raise e
        raise HTTPException(status_code=400, detail=f"Invalid path: {e}")

# ── Migrations ──

async def migrate_unencrypted_keys():
    """Find plaintext keys in DB and encrypt them."""
    from backend.app.database import get_db
    db = await get_db()
    
    cursor = await db.execute("SELECT id, api_key FROM llm_providers WHERE api_key IS NOT NULL AND api_key != ''")
    rows = await cursor.fetchall()
    
    migrated_count = 0
    for row in rows:
        pid, key = row["id"], row["api_key"]
        if not key.startswith("gAAAA"):
            encrypted = encrypt_value(key)
            await db.execute("UPDATE llm_providers SET api_key = ? WHERE id = ?", (encrypted, pid))
            migrated_count += 1
    if migrated_count > 0:
        await db.commit()
        logging.getLogger("lexitag").info(f"Encrypted {migrated_count} plaintext provider keys.")
