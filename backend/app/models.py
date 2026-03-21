"""Pydantic schemas for API request/response models."""

from __future__ import annotations
from pydantic import BaseModel
from typing import Optional


class TrackBase(BaseModel):
    id: int
    path: str
    filename: str
    title: str = ""
    artist: str = ""
    album: str = ""
    genre: str = ""
    year: str = ""
    composer: str = ""
    duration: float = 0.0
    bitrate: int = 0
    has_lyrics: bool = False
    language: str = ""
    has_junk: bool = False
    format: str = ""
    lyrics: str = ""
    comment: str = ""
    last_scanned: str = ""
    local_fix_count: int = 0
    llm_fix_count: int = 0
    last_fix_type: Optional[str] = None
    last_fixed_at: Optional[str] = None
    last_ai_fix_duration: float = 0.0


class TrackUpdateModel(BaseModel):
    track_ids: list[int]
    tags: dict  # title, artist, album, genre, year, composer, comment
    lyrics: Optional[str] = None
    language: Optional[str] = None
    raw_tags: Optional[dict] = None
    new_path: Optional[str] = None


class RawTagsResponse(BaseModel):
    id: int
    filename: str
    format: str
    tags: dict  # Every single tag mutagen found


class TrackList(BaseModel):
    tracks: list[TrackBase]
    total: int
    page: int
    page_size: int


class TagHistoryEntry(BaseModel):
    id: int
    track_id: int
    track_path: str
    original_tags: dict
    changed_tags: dict
    timestamp: str
    reverted: bool = False
    duration_seconds: float = 0.0
    raw_before: dict = {}
    raw_after: dict = {}


class TagHistoryList(BaseModel):
    entries: list[TagHistoryEntry]
    total: int
    page: int
    page_size: int


class FixRequest(BaseModel):
    track_ids: list[int]
    clean_filenames: bool = False
    lyrics_only: bool = False
    local_only: bool = False
    filenames_only: bool = False
    job_id: Optional[str] = None


class LocalFixRequest(BaseModel):
    track_ids: list[int]


class FixProgress(BaseModel):
    track_id: int
    track_name: str
    step: str  # read | backup | sanitize | lyrics | language | write
    status: str  # pending | running | done | error
    message: str = ""
    duration: float = 0.0


class UPnPRenderer(BaseModel):
    name: str
    location: str
    udn: str


class CastRequest(BaseModel):
    renderer_udn: str
    track_id: int


class ScanResponse(BaseModel):
    total_scanned: int
    new_tracks: int
    updated_tracks: int


class MessageResponse(BaseModel):
    message: str
    success: bool = True
