
"""Search service — uses DuckDuckGo (primary) with Google Custom Search JSON API fallback."""

import re
import asyncio
import aiohttp
from typing import List, Dict


async def _search_ddg(query: str, limit: int) -> str:
    """DuckDuckGo search via ddgs library."""
    try:
        from ddgs import DDGS
        loop = asyncio.get_event_loop()
        def _run():
            return list(DDGS().text(query, max_results=limit))
        results = await loop.run_in_executor(None, _run)
        if results:
            blocks = [f"Source {i+1}: {r.get('title','')}\n{r.get('body','')}" for i, r in enumerate(results)]
            return "\n\n".join(blocks)
    except Exception as e:
        print(f"[search_service] DuckDuckGo error: {e}")
    return ""


async def _search_google_cse(query: str, limit: int) -> str:
    """Google Custom Search JSON API fallback (requires GOOGLE_CSE_KEY + GOOGLE_CSE_CX env vars)."""
    from ..config import settings
    api_key = settings.GOOGLE_CSE_KEY
    cx = settings.GOOGLE_CSE_CX

    if not api_key or not cx:
        return ""  # Not configured — skip silently

    url = "https://www.googleapis.com/customsearch/v1"
    params = {
        "key": api_key,
        "cx": cx,
        "q": query,
        "num": min(limit, 10),  # API max is 10
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    print(f"[search_service] Google CSE HTTP {resp.status}: {text[:200]}")
                    return ""
                data = await resp.json()

        items = data.get("items", [])
        if not items:
            return ""

        blocks = []
        for i, item in enumerate(items):
            title = item.get("title", "")
            snippet = item.get("snippet", "")
            link = item.get("link", "")
            blocks.append(f"Source {i+1}: {title} ({link})\n{snippet}")
        return "\n\n".join(blocks)

    except Exception as e:
        print(f"[search_service] Google CSE error: {e}")
    return ""


async def search_track_context(query: str, limit: int = 4) -> str:
    """
    Search for track metadata context.
    Priority: DuckDuckGo → Google Custom Search JSON API
    """
    if not query or len(query) < 4:
        return ""

    # 1. Try DuckDuckGo
    result = await _search_ddg(query, limit)
    if result:
        return result

    # 2. Fallback: Google Custom Search JSON API
    print(f"[search_service] DDG returned nothing, trying Google CSE...")
    result = await _search_google_cse(query, limit)
    return result


async def get_search_context_for_track(artist: str, title: str, filename: str = "") -> str:
    """
    Generates a search query and returns the context, with a simpler fallback query.
    """
    # Primary query: full context
    parts = []
    if title: parts.append(title)
    if artist: parts.append(artist)
    if not title and filename:
        cleaned_filename = re.sub(r'^\d+[\._\-\s]+', '', filename).rsplit('.', 1)[0]
        parts.append(cleaned_filename)
    parts.append("song movie original soundtrack composer")

    query1 = " ".join(parts)
    print(f"[search_service] Query (Primary): {query1}")
    context = await search_track_context(query1)

    # Fallback: simpler query
    if not context and title:
        query2 = f"{title} song movie soundtrack"
        print(f"[search_service] Query (Fallback): {query2}")
        context = await search_track_context(query2)

    if context:
        return f"WEB SEARCH RESULTS (CONTEXT):\n\n{context}"
    return ""
