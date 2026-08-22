"""LexiTag — FastAPI entry point."""

from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import os
import logging

# Initialize Logging
import logging.handlers
LOG_DIR = Path("data")
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE_PATH = LOG_DIR / "lexitag.log"

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    force=True  # Ensure we override any default uvicorn handlers
)

# File Handler for persistent app logging & browser download
file_handler = logging.handlers.RotatingFileHandler(
    LOG_FILE_PATH, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
)
file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))

root_logger = logging.getLogger()
root_logger.addHandler(file_handler)

# Explicitly enable verbose debugging for UPnP library
logging.getLogger('async_upnp_client').setLevel(logging.DEBUG)

from backend.app.config import settings

# Filter out high-frequency polling logs to keep production output clean
class PollingLogFilter(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        # Define high-frequency paths that clutter logs
        silenced_paths = [
            "/api/health",
            "/api/settings/llm/quota",
            "/api/tracks/scan/progress",
        ]
        return not any(path in msg for path in silenced_paths)

# Apply filter to uvicorn access logger
logging.getLogger("uvicorn.access").addFilter(PollingLogFilter())

logger = logging.getLogger("lexitag")

from backend.app.database import get_db, close_db
from backend.app.security import verify_token
from backend.app.routers import tracks, fixer, history, player, settings as app_settings

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle."""
    await get_db()
    logger.info("Database initialized")
    from backend.app.security import migrate_unencrypted_keys
    await migrate_unencrypted_keys()
    yield
    await close_db()
    logger.info("Database closed")

# Load version from VERSION file
try:
    _version_path = Path(__file__).resolve().parent.parent.parent / "VERSION"
    VERSION = _version_path.read_text().strip()
except:
    VERSION = "0.1.6"


app = FastAPI(
    title="LexiTag API",
    description="Music Metadata & Lyrics Management System",
    version=VERSION,
    lifespan=lifespan,
    docs_url="/docs" if settings.ENV != "production" else None,
    redoc_url="/redoc" if settings.ENV != "production" else None,
)

@app.get("/favicon.ico", include_in_schema=False)
async def favicon_ico():
    return FileResponse(Path(__file__).resolve().parent / "static" / "favicon.svg")

@app.get("/favicon.svg", include_in_schema=False)
async def favicon_png():
    return FileResponse(Path(__file__).resolve().parent / "static" / "favicon.svg")

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
