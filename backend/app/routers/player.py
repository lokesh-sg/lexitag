"""Player router — audio streaming and UPnP cast control."""

import os
import mimetypes
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse, Response
from ..database import get_db
from ..models import UPnPRenderer, CastRequest, MessageResponse
from ..services import upnp

router = APIRouter(prefix="/api/player", tags=["player"])


@router.get("/stream/{track_id}")
async def stream_audio(track_id: int, request: Request):
    """Stream an audio file with range request support."""
    db = await get_db()
    cursor = await db.execute("SELECT path, format FROM tracks WHERE id = ?", (track_id,))
    row = await cursor.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Track not found")

    filepath = row["path"]
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Audio file not found on disk")

    file_size = os.path.getsize(filepath)
    content_type, _ = mimetypes.guess_type(filepath)
    if not content_type:
        content_type = "application/octet-stream"
    # Normalize for browser compatibility - some prefer 'audio/flac' over 'audio/x-flac'
    if content_type == "audio/x-flac":
        content_type = "audio/flac"

    from fastapi.responses import FileResponse
    return FileResponse(
        filepath,
        media_type=content_type
    )


@router.get("/upnp/renderers")
async def list_renderers():
    """Discover UPnP/DLNA media renderers on the local network."""
    renderers = await upnp.discover_renderers(timeout=5)
    return {"renderers": renderers}


@router.post("/upnp/play", response_model=MessageResponse)
async def upnp_play(cast: CastRequest, request: Request):
    """Command a UPnP renderer to play the selected track."""
    db = await get_db()
    cursor = await db.execute("SELECT path FROM tracks WHERE id = ?", (cast.track_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Track not found")

    # Build the media URL that the renderer can access
    host = request.headers.get("host", "localhost:8080")
    scheme = "http"
    media_url = f"{scheme}://{host}/api/player/stream/{cast.track_id}"

    try:
        success = await upnp.play_on_renderer(cast.renderer_udn, media_url)
        if success:
            return MessageResponse(message="Playback started", success=True)
        else:
            raise HTTPException(status_code=500, detail="Failed to start playback")
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/upnp/stop", response_model=MessageResponse)
async def upnp_stop(renderer_udn: str):
    """Stop playback on a UPnP renderer."""
    success = await upnp.stop_renderer(renderer_udn)
    if success:
        return MessageResponse(message="Playback stopped", success=True)
    raise HTTPException(status_code=500, detail="Failed to stop playback")
