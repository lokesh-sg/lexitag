"""Lyrics fetcher — queries LRCLIB for lyrics."""

import aiohttp
import urllib.parse

LRCLIB_BASE = "https://lrclib.net/api"
_TIMEOUT = aiohttp.ClientTimeout(total=15)


async def fetch_lyrics(artist: str, title: str, album: str = "", duration: float = 0) -> str:
    """
    Fetch lyrics from LRCLIB. Tries exact match first, then falls back to search.

    Returns:
        Lyrics text (plain or synced), or empty string if not found.
    """
    if not artist or not title:
        return ""

    # Try exact match first
    lyrics = await _try_get(artist, title, album, duration)
    if lyrics:
        return lyrics

    # Fallback: search
    lyrics = await _try_search(artist, title)
    return lyrics


async def _try_get(artist: str, title: str, album: str, duration: float) -> str:
    """Try the LRCLIB /api/get endpoint for an exact match."""
    params = {
        "artist_name": artist,
        "track_name": title,
    }
    if album:
        params["album_name"] = album
    if duration > 0:
        params["duration"] = str(int(duration))

    url = f"{LRCLIB_BASE}/get?{urllib.parse.urlencode(params)}"

    try:
        async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
            async with session.get(url) as resp:
                if resp.status != 200:
                    return ""
                data = await resp.json()

        # User requested: Primary Source (LRCLIB) ONLY if it has syncedLyrics
        return data.get("syncedLyrics") or ""
    except Exception:
        return ""


async def _try_search(artist: str, title: str) -> str:
    """Fallback: use the LRCLIB /api/search endpoint."""
    query = f"{artist} {title}"
    url = f"{LRCLIB_BASE}/search?q={urllib.parse.quote(query)}"

    try:
        async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
            async with session.get(url) as resp:
                if resp.status != 200:
                    return ""
                data = await resp.json()

        if not data or not isinstance(data, list):
            return ""

        # Take the first result that actually has synced lyrics
        for item in data:
            if item.get("syncedLyrics"):
                return item["syncedLyrics"]
                
        return ""
    except Exception:
        return ""
