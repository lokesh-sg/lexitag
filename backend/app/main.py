"""LexiTag — FastAPI entry point."""

from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import os
import logging
from .config import settings

# Filter out high-frequency polling logs to keep production output clean
class PollingLogFilter(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        # Define high-frequency paths that clutter logs
        silenced_paths = [
            "/api/health",
            "/api/settings/llm/quota",
            "/api/tracks/scan/progress",
            "/api/settings/cleanup-suggestions",
            "/api/settings/cleanup-patterns",
            "/api/settings/sources",
            "/api/settings/llm/providers"
        ]
        return not any(path in msg for path in silenced_paths)

# Apply filter to uvicorn access logger
logging.getLogger("uvicorn.access").addFilter(PollingLogFilter())

logger = logging.getLogger("lexitag")

from .database import get_db, close_db
from .security import verify_token
from .routers import tracks, fixer, history, player, settings as app_settings

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle."""
    await get_db()
    logger.info("Database initialized")
    from .security import migrate_unencrypted_keys
    await migrate_unencrypted_keys()
    yield
    await close_db()
    logger.info("Database closed")

# Load version from VERSION file
try:
    _version_path = Path(__file__).resolve().parent.parent.parent / "VERSION"
    VERSION = _version_path.read_text().strip()
except Exception:
    VERSION = "0.1.2.dev"

app = FastAPI(
    title="LexiTag API",
    description="Music Metadata & Lyrics Management System",
    version=VERSION,
    lifespan=lifespan,
    docs_url="/api/docs" if settings.ENV != "production" else None,
    redoc_url="/api/redoc" if settings.ENV != "production" else None,
)

# CORS — restrict to allowed origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.effective_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routers with global auth
app.include_router(tracks.router, dependencies=[Depends(verify_token)])
app.include_router(fixer.router, dependencies=[Depends(verify_token)])
app.include_router(history.router, dependencies=[Depends(verify_token)])
app.include_router(player.router, dependencies=[Depends(verify_token)])
app.include_router(app_settings.router, dependencies=[Depends(verify_token)])

@app.get("/api/health")
async def health_check():
    """Health check endpoint for Docker/Load Balancer."""
    return {
        "status": "ok",
        "service": "LexiTag",
        "version": VERSION
    }

# Serve frontend static files
# In production, the Dockerfile copies built frontend to /app/static
prod_static = Path("/app/static")
static_dir = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

if prod_static.exists():
    app.mount("/", StaticFiles(directory=str(prod_static), html=True), name="static")
elif static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
