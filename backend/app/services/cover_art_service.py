import asyncio
import logging
import re
import json
import urllib.parse
import aiohttp
from pathlib import Path
from typing import Optional, Dict, Any, Tuple, List
from backend.app.services.llm import chat_completion
from backend.app.services.tagger import embed_cover_art, remove_cover_art
from backend.app.database import get_db

logger = logging.getLogger("cover_art_service")

COVER_SYSTEM_PROMPT = (
    "You are a music metadata and album artwork retrieval specialist.\n"
    "TASK:\n"
    "Search Google to find the official, authentic, high-resolution original album cover artwork image.\n\n"
    "CRITICAL RULES:\n"
    "1. PRIMARY FOCUS: The search MUST be based strictly on the specified ALBUM name and release YEAR (if provided).\n"
    "2. The cover art must match the specific original album and era/year, NOT a modern movie remake, compilation, or tribute album.\n"
    "3. SPECIAL CARE FOR SOUNDTRACKS / REGIONAL / INDIAN MUSIC:\n"
    "   - Track artists (e.g. S. P. Balasubrahmanyam, P. Susheela, Lata Mangeshkar, etc.) are often playback singers, NOT album artists.\n"
    "   - The album name is the movie or soundtrack title (e.g. 'Achamillai Achamillai' from 1984).\n"
    "   - DO NOT return cover art for a modern movie or album (e.g. 'Hey! Sinamika') just because it contains a song or track sharing a word with the album name!\n"
    "   - The image must be the authentic cover of the requested album itself.\n"
    "4. Return a direct, accessible image asset URL (e.g. from Apple Music *.mzstatic.com, Spotify *.scdn.co, Deezer *.dzcdn.net, Cover Art Archive coverartarchive.org, JioSaavn, Gaana, Discogs, IMDb, or Wikimedia/Wikipedia).\n"
    "5. If a direct image URL is unavailable, you may return the official release page URL (e.g. https://www.discogs.com/release/... or Wikipedia article or MusicBrainz release), and the high-resolution artwork will be resolved automatically.\n"
    "6. In your JSON response, the 'album' field MUST be the resolved album name of the cover found. If you cannot find authentic cover art for the requested album, return null for image_url.\n"
    "7. Return ONLY valid JSON in the exact format shown below, with no markdown code fences or surrounding text.\n\n"
    "OUTPUT FORMAT:\n"
    "{\n"
    '  "album": "Accurate Album Name",\n'
    '  "artist": "Accurate Artist Name",\n'
    '  "image_url": "https://...direct-image-url-or-release-page.jpg",\n'
    '  "source": "Source Name (e.g. Apple Music / Spotify / Discogs / Cover Art Archive)",\n'
    '  "description": "Brief description of the cover"\n'
    "}"
)


# Relaxed variant used when the user has provided custom agent instructions.
# Strict album-matching rules are replaced with user-intent-first guidance so
# the custom instructions are not overridden by conflicting system constraints.
COVER_SYSTEM_PROMPT_RELAXED = (
    "You are a music metadata and album artwork retrieval specialist.\n"
    "TASK:\n"
    "Search Google to find a high-resolution album cover or related artwork image as guided by the USER AGENT INSTRUCTIONS below.\n\n"
    "IMPORTANT RULES:\n"
    "1. USER AGENT INSTRUCTIONS have the HIGHEST priority — follow them exactly. If the user says a related or approximate cover is acceptable, you MAY return it.\n"
    "2. Use the album name, year, and artist as context, but do NOT reject candidates that are close matches if the user has relaxed the requirement.\n"
    "3. For Indian / regional film soundtracks, the album name is usually the film title — use it as context but honour the user's guidance above it.\n"
    "4. Return a direct, accessible image asset URL (Apple Music, Spotify, Deezer, Discogs, IMDb, Wikipedia/Wikimedia, JioSaavn, Gaana, Cover Art Archive).\n"
    "5. If a direct image URL is unavailable, return the release page URL (Discogs, Wikipedia, MusicBrainz) — artwork will be resolved automatically.\n"
    "6. The 'album' field MUST contain the resolved album name of the image found. If absolutely nothing is available, return null for image_url.\n"
    "7. Return ONLY valid JSON in the exact format shown below, with no markdown code fences or surrounding text.\n\n"
    "OUTPUT FORMAT:\n"
    "{\n"
    '  "album": "Resolved Album Name",\n'
    '  "artist": "Accurate Artist Name",\n'
    '  "image_url": "https://...direct-image-url-or-release-page.jpg",\n'
    '  "source": "Source Name (e.g. Apple Music / Spotify / Discogs / Cover Art Archive)",\n'
    '  "description": "Brief description of the cover"\n'
    "}"
)


def _normalize_title(s: str) -> str:
    """Normalize title for exact matching by removing punctuation, case, and soundtrack/edition noise."""
    if not s:
        return ""
    # Strip soundtrack / OST / edition suffixes in parentheses/brackets
    s = re.sub(
        r"[\(\[\{].*?(?:soundtrack|ost|original motion picture|theme|remaster|edition|score|album|ep|single|bonus|deluxe|version).*?[\)\]\}]",
        "",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(r"\b(original motion picture soundtrack|ost|soundtrack|ep|single)\b", "", s, flags=re.IGNORECASE)
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip().lower()


def _is_exact_match(target_album: str, candidate_album: str, target_year: str = "", candidate_year: str = "") -> bool:
    """Check if candidate album title is an exact match for target album (and release year if both provided)."""
    if not target_album or not candidate_album:
        return False
    norm_target = _normalize_title(target_album)
    norm_candidate = _normalize_title(candidate_album)
    if not norm_target or norm_target != norm_candidate:
        return False

    if target_year and candidate_year:
        t_y = str(target_year).strip()[:4]
        c_y = str(candidate_year).strip()[:4]
        if t_y.isdigit() and c_y.isdigit() and abs(int(t_y) - int(c_y)) > 1:
            return False

    return True


async def _empty_list() -> List:
    """No-op coroutine returning an empty list. Used as a placeholder in asyncio.gather when an optional search is skipped."""
    return []


def _is_album_match(target_album: str, candidate_album: str) -> bool:
    """Verify candidate album returned by search has meaningful overlap with target album."""
    if not target_album or not candidate_album:
        return True
    t_words = [w.lower() for w in re.findall(r"[a-zA-Z0-9]+", target_album)]
    c_words = [w.lower() for w in re.findall(r"[a-zA-Z0-9]+", candidate_album)]
    stopwords = {"the", "a", "an", "and", "or", "of", "in", "to", "vol", "volume", "original", "motion", "picture", "soundtrack", "ost"}
    t_sig = [w for w in t_words if w not in stopwords and len(w) > 2]
    if not t_sig:
        return True
    c_sig = set(c_words)
    matched = sum(1 for w in t_sig if w in c_sig)
    
    # For short album titles (1 or 2 words, e.g. 'Aadi Velli', 'Roja'), ALL significant words must match
    if len(t_sig) <= 2:
        return matched == len(t_sig)
    # For longer album names, require at least 70% match
    return matched >= max(2, int(len(t_sig) * 0.7))



def extract_cover_bytes(filepath: str) -> Tuple[Optional[bytes], str]:
    """Extract embedded cover art bytes or directory fallback image from an audio file."""
    import os
    if not os.path.exists(filepath):
        return None, ""
    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(filepath)
        if audio is not None:
            # FLAC
            if hasattr(audio, "pictures") and audio.pictures:
                pic = audio.pictures[0]
                return pic.data, pic.mime or "image/jpeg"
            tags = getattr(audio, "tags", audio)
            if tags:
                # ID3 (MP3, WAV)
                for key in getattr(tags, "keys", lambda: [])():
                    if str(key).startswith("APIC"):
                        frame = tags[key]
                        return frame.data, frame.mime or "image/jpeg"
                # MP4 (M4A)
                if "covr" in tags and tags["covr"]:
                    data = tags["covr"][0]
                    mime = "image/png" if data.startswith(b"\x89PNG") else "image/jpeg"
                    return data, mime
                # OGG / Opus
                if "metadata_block_picture" in tags and tags["metadata_block_picture"]:
                    import base64
                    from mutagen.flac import Picture
                    b64_data = tags["metadata_block_picture"][0]
                    pic = Picture(base64.b64decode(b64_data))
                    return pic.data, pic.mime or "image/jpeg"
    except Exception as e:
        logger.debug(f"[CoverArt] Error extracting tags from {filepath}: {e}")

    # Fallback: check parent directory
    try:
        parent = Path(filepath).parent
        for candidate in ("cover.jpg", "cover.png", "cover.jpeg", "folder.jpg", "folder.png", "albumart.jpg", "front.jpg", "front.png"):
            art_path = parent / candidate
            if art_path.is_file():
                with open(art_path, "rb") as f:
                    data = f.read()
                mime = "image/png" if candidate.endswith(".png") else "image/jpeg"
                return data, mime
    except Exception as e:
        logger.debug(f"[CoverArt] Directory art fallback error: {e}")

    return None, ""


def _clean_music_text(text: str) -> str:
    """Strip extensions, track numbers, and bracketed tags from titles/filenames."""
    if not text:
        return ""
    # Strip file extensions
    s = re.sub(r"\.(mp3|flac|m4a|aac|wav|ogg|opus|aiff|wma)$", "", text, flags=re.IGNORECASE)
    # Strip leading track numbers like "01 - ", "01. ", "1-02 ", "[01] "
    s = re.sub(r"^(\[?\d{1,3}[\]\s._-]+)+", "", s)
    # Strip common bracketed junk like [Official Video], (Remastered 2021), etc.
    s = re.sub(r"\[(official[\w\s]*|hd|hq|1080p|720p|4k|audio|video|lyrics?|remaster[\w\s]*)\]", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\((official[\w\s]*|hd|hq|1080p|720p|4k|audio|video|lyrics?|remaster[\w\s]*)\)", "", s, flags=re.IGNORECASE)
    # Strip hyphens separating unknown artist or placeholder
    s = s.replace("_", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


async def search_cover_art_ai(
    title: str = "",
    artist: str = "",
    album: str = "",
    year: str = "",
    filename: str = "",
    parent_folder: str = "",
    composer: str = "",
    language: str = "",
    custom_prompt: str = ""
) -> Dict[str, Any]:
    """
    Search for official high-resolution album cover artwork using Google AI Search Grounding,
    prioritizing the ALBUM name, and querying verified music repository APIs (iTunes, Deezer, Cover Art Archive).
    Acts as an intelligent music research agent utilizing rich track metadata and user guidance.
    """
    clean_title = (title or "").strip()
    clean_artist = (artist or "").strip()
    clean_album = (album or "").strip()
    clean_filename = (filename or "").strip()
    clean_year = (str(year) if year is not None else "").strip()
    clean_composer = (composer or "").strip()
    clean_language = (language or "").strip()

    # Filter out placeholder strings
    if clean_artist.lower() in {"unknown", "unknown artist", "various artists", "va", "none"}:
        clean_artist = ""
    if clean_album.lower() in {"unknown", "unknown album", "single", "none"}:
        clean_album = ""

    # Sanitize title; if missing, derive from filename
    sanitized_title = _clean_music_text(clean_title)
    if not sanitized_title and clean_filename:
        sanitized_title = _clean_music_text(clean_filename)

    logger.info(
        f"[CoverArt Agent] Initiating multi-provider search: album='{clean_album}', year='{clean_year}', artist='{clean_artist}', "
        f"composer='{clean_composer}', language='{clean_language}', custom_prompt='{custom_prompt}', "
        f"title='{sanitized_title}' (raw: '{clean_title}'), filename='{clean_filename}'"
    )

    # ── Step 1: Google AI Search Workflow (Gemini with Google Search Grounding) ──
    prompt_input = {
        "album": clean_album,
        "year": clean_year,
        "artist": clean_artist,
        "composer": clean_composer,
        "language": clean_language,
        "title": sanitized_title or clean_title,
        "filename": clean_filename,
        "folder": (parent_folder or "").strip(),
    }

    refinement_block = ""
    if custom_prompt:
        refinement_block = f"\nUSER AGENT GUIDANCE / REFINEMENT INSTRUCTION:\n{custom_prompt.strip()}\n"

    meta_details = []
    if clean_composer:
        meta_details.append(f"Composer / Music Director: '{clean_composer}'")
    if clean_language:
        meta_details.append(f"Language / Industry: '{clean_language}'")
    meta_str = (", " + ", ".join(meta_details)) if meta_details else ""

    if clean_album:
        year_ctx = f" ({clean_year})" if clean_year else ""
        if custom_prompt:
            # Relaxed mode: user has provided custom guidance — surface only the context, no strict rules
            user_msg = (
                f"Find a high-resolution cover image for the album/film: '{clean_album}'{year_ctx}{meta_str}.\n"
                f"Artist / Composer: '{clean_artist}'\n"
                f"{refinement_block}"
                f"Track Metadata (for reference):\n{json.dumps(prompt_input)}\n\n"
                f"INSTRUCTIONS:\n"
                f"1. The USER AGENT GUIDANCE above is your PRIMARY directive — follow it exactly.\n"
                f"2. A related poster, film cover, or approximate match is acceptable if the user says so.\n"
                f"3. Return a direct image URL (Apple Music, Spotify, Deezer, Wikipedia/Wikimedia, IMDb, JioSaavn, Gaana, Discogs, Cover Art Archive).\n"
                f"4. The 'album' key in the JSON MUST be the name of whatever cover/album you found."
            )
        else:
            user_msg = (
                f"Search Google and find the official high-resolution original album cover artwork image URL for the ALBUM: '{clean_album}'{year_ctx}{meta_str}.\n"
                f"Song title (for context): '{sanitized_title or clean_title}', Artist: '{clean_artist}'\n"
                f"{refinement_block}"
                f"Track Metadata:\n{json.dumps(prompt_input)}\n\n"
                f"CRITICAL MATCHING REQUIREMENTS:\n"
                f"1. If USER AGENT GUIDANCE / REFINEMENT INSTRUCTION is provided above, you MUST prioritize it as your primary search criteria (e.g. director, cast, composer, studio, film details, or release year).\n"
                f"2. Search strictly for the original album cover or official soundtrack release of '{clean_album}'{year_ctx} or the entity described in the user guidance.\n"
                f"3. DO NOT return an unrelated album or modern movie that happens to contain a song or track sharing a word with the album name.\n"
                f"4. For Indian / regional film soundtracks, '{clean_album}' is the film title. Search for: '{clean_album}'{year_ctx} {clean_language or ''} film soundtrack album cover.\n"
                f"5. Return a direct image URL (from Apple Music, Spotify, Deezer, Cover Art Archive, JioSaavn, Gaana, Discogs, IMDb, or Wikipedia / Wikimedia Commons).\n"
                f"6. The 'album' key in the output JSON MUST be the resolved name of the album. If you cannot find relevant cover art, return null for image_url."
            )
    else:
        user_msg = (
            f"Search Google and find the official high-resolution album cover art image URL for this song{meta_str}:\n"
            f"{refinement_block}"
            f"{json.dumps(prompt_input)}\n"
            f"Provide the direct image URL in JSON format."
        )


    ai_candidates: List[Dict[str, Any]] = []
    try:
        target_name = clean_album if clean_album else (sanitized_title or clean_title)
        logger.info(f"[CoverArt] Querying AI engine for album='{target_name}' (Year: '{clean_year}', Artist: '{clean_artist}')...")
        raw_response = await chat_completion(
            system_prompt=COVER_SYSTEM_PROMPT_RELAXED if custom_prompt else COVER_SYSTEM_PROMPT,
            user_message=user_msg,
            temperature=0.2,
            max_tokens=600,
            tools=[{"googleSearch": {}}],
        )
        json_match = re.search(r"\{[\s\S]*\}", raw_response)
        if json_match:
            ai_result = json.loads(json_match.group())
            if ai_result and ai_result.get("image_url"):
                candidate_album = ai_result.get("album", "")
                # If custom_prompt is provided, trust the user-guided search and don't discard candidates based on original album title
                if custom_prompt or not (clean_album and candidate_album and not _is_album_match(clean_album, candidate_album)):
                    raw_cand_url = ai_result["image_url"].strip()
                    candidate_url = _normalize_wikimedia_url(raw_cand_url)
                    candidate_url = await _resolve_wikimedia_url_async(candidate_url)

                    # Resolve Discogs release/master/hash to valid high-res image
                    if "discogs" in candidate_url.lower() or re.search(r"R-\d+", candidate_url):
                        discogs_resolved = await _resolve_discogs_url_async(candidate_url)
                        if discogs_resolved:
                            candidate_url = discogs_resolved

                    valid = await _validate_image_url(candidate_url)
                    # If direct validation failed, try extracting image via URL candidate parser
                    if not valid:
                        extracted = await _extract_url_candidate(raw_cand_url)
                        if extracted and extracted.get("image_url"):
                            candidate_url = extracted["image_url"]
                            valid = await _validate_image_url(candidate_url)

                    # Only bypass validation for Wikimedia / Wikipedia images if fair-use hotlink blocked (403).
                    # NEVER bypass validation for mzstatic.com (Apple Music) or other domains where 404 means the asset doesn't exist!
                    if not valid and custom_prompt and ("wikipedia.org" in candidate_url.lower() or "wikimedia.org" in candidate_url.lower()):
                        valid = True
                        logger.info(f"[CoverArt] Bypassing strict validation for Wikipedia/Wikimedia URL: {candidate_url}")

                    if valid and (candidate_url.startswith("http://") or candidate_url.startswith("https://")):
                        is_exact = _is_exact_match(clean_album, candidate_album or clean_album, clean_year, "")

                        # If the user explicitly provided custom guidance, boost the AI score so it outranks fallback results
                        base_score = 90 if custom_prompt else 60

                        ai_candidates.append({
                            "score": base_score + (40 if is_exact else 0),
                            "image_url": candidate_url,
                            "source": ai_result.get("source", "Google AI Search"),
                            "album": candidate_album or clean_album,
                            "artist": ai_result.get("artist", clean_artist),
                            "year": clean_year,
                            "description": ai_result.get("description", "Identified via Google AI"),
                            "is_exact": is_exact or bool(custom_prompt),
                        })
    except Exception as e:
        logger.warning(f"[CoverArt] Google AI search encountered error: {e}")

    # ── Step 1.5: If user provided a URL in custom instructions, extract candidate directly ──
    user_url_cands = []
    if custom_prompt:
        for u in re.findall(r"https?://[^\s)\]\}\>\"']+", custom_prompt):
            cand = await _extract_url_candidate(u)
            if cand:
                user_url_cands.append(cand)

    # ── Step 2, 3, 4: Query Verified Music Repositories & Wikipedia Concurrently ──
    search_album = clean_album or (ai_candidates[0]["album"] if ai_candidates else "")
    search_artist = clean_artist or (ai_candidates[0]["artist"] if ai_candidates else "")
    search_composer = clean_composer or search_artist

    repo_results = await asyncio.gather(
        _search_itunes_candidates(
            album=search_album,
            artist=search_artist,
            title=sanitized_title or clean_title,
            year=clean_year,
        ),
        _search_deezer_candidates(
            album=search_album,
            artist=search_artist,
            title=sanitized_title or clean_title,
            year=clean_year,
        ),
        _search_caa_candidates(
            album=search_album,
            artist=search_artist,
        ),
        _search_wikipedia_candidates(
            album=search_album,
            year=clean_year,
        ),
        # When user provides custom guidance, also run broad artist/composer searches to surface more choices
        _search_itunes_candidates(
            album="",
            artist=search_composer,
            title=sanitized_title or clean_title,
            year=clean_year,
            relaxed=True,
        ) if custom_prompt else _empty_list(),
        _search_deezer_candidates(
            album="",
            artist=search_composer,
            title=sanitized_title or clean_title,
            year=clean_year,
            relaxed=True,
        ) if custom_prompt else _empty_list(),
        return_exceptions=True
    )

    itunes_cands = repo_results[0] if isinstance(repo_results[0], list) else []
    deezer_cands = repo_results[1] if isinstance(repo_results[1], list) else []
    caa_cands = repo_results[2] if isinstance(repo_results[2], list) else []
    wiki_cands = repo_results[3] if isinstance(repo_results[3], list) else []
    itunes_relaxed_cands = repo_results[4] if len(repo_results) > 4 and isinstance(repo_results[4], list) else []
    deezer_relaxed_cands = repo_results[5] if len(repo_results) > 5 and isinstance(repo_results[5], list) else []

    # ── Aggregate & Deduplicate Candidates ──
    all_raw_candidates: List[Dict[str, Any]] = []
    all_raw_candidates.extend(user_url_cands)
    all_raw_candidates.extend(wiki_cands)
    all_raw_candidates.extend(ai_candidates)
    all_raw_candidates.extend(itunes_cands)
    all_raw_candidates.extend(deezer_cands)
    all_raw_candidates.extend(caa_cands)
    # Relaxed artist/composer-wide results (only present when custom_prompt is set)
    all_raw_candidates.extend(itunes_relaxed_cands)
    all_raw_candidates.extend(deezer_relaxed_cands)

    seen_urls = set()
    unique_candidates: List[Dict[str, Any]] = []
    for cand in all_raw_candidates:
        url = cand.get("image_url", "").strip()
        if not url:
            continue
        norm_key = re.sub(r"^https?://", "", url).rstrip("/").lower()
        if norm_key not in seen_urls:
            seen_urls.add(norm_key)
            unique_candidates.append(cand)

    # Sort: exact matches first, then highest score
    unique_candidates.sort(key=lambda x: (1 if x.get("is_exact") else 0, x.get("score", 0)), reverse=True)

    if not unique_candidates:
        logger.warning(f"[CoverArt] No artwork located for '{clean_album or sanitized_title or clean_filename}'.")
        return {
            "success": False,
            "exact_match": False,
            "error": f"No high-resolution album cover art could be located for '{clean_album or sanitized_title or clean_filename}'.",
            "image_url": "",
            "album": clean_album,
            "artist": clean_artist,
            "candidates": [],
        }

    top = unique_candidates[0]
    has_exact = any(c.get("is_exact", False) for c in unique_candidates)

    # In relaxed (custom_prompt) mode show up to 12 candidates so user has more to pick from
    candidate_limit = 12 if custom_prompt else 8
    formatted_candidates = []
    for idx, c in enumerate(unique_candidates[:candidate_limit]):
        formatted_candidates.append({
            "id": f"cand_{idx}",
            "image_url": c["image_url"],
            "source": c.get("source", "Music Repository"),
            "album": c.get("album", clean_album),
            "artist": c.get("artist", clean_artist),
            "year": c.get("year", clean_year),
            "description": c.get("description", ""),
            "is_exact": c.get("is_exact", False),
        })

    logger.info(
        f"[CoverArt] Found {len(unique_candidates)} candidates for '{clean_album or sanitized_title}'. "
        f"Exact match: {has_exact}. Top source: {top.get('source')}"
    )

    return {
        "success": True,
        "exact_match": has_exact,
        "image_url": top["image_url"],
        "source": top.get("source", "Music Repository"),
        "album": top.get("album", clean_album),
        "artist": top.get("artist", clean_artist),
        "year": top.get("year", clean_year),
        "description": top.get("description", ""),
        "candidates": formatted_candidates,
    }


def _normalize_wikimedia_url(url: str) -> str:
    """Transform wikimedia thumbnail URL to original full-resolution image URL."""
    if not url:
        return ""
    if "upload.wikimedia.org" in url and "/thumb/" in url:
        parts = url.split("/thumb/")
        if len(parts) == 2:
            base = parts[0]
            rest = parts[1]
            subparts = rest.rsplit("/", 1)
            return f"{base}/{subparts[0]}"
    return url


async def _resolve_wikimedia_url_async(url: str) -> str:
    """Resolve the true Wikimedia URL using the Wikipedia API to bypass hallucinated hash paths."""
    if not url or "upload.wikimedia.org" not in url:
        return url
        
    try:
        # Extract filename (e.g., Aadi_Velli.jpg)
        filename = url.split("/")[-1]
        if filename.lower().endswith(('.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp')):
            # Sometimes thumbnail urls end with sizes, e.g. 220px-Aadi_Velli.jpg
            if "-" in filename and filename.split("-")[0].endswith("px"):
                filename = filename.split("-", 1)[1]
                
            api_url = f"https://en.wikipedia.org/w/api.php?action=query&titles=File:{urllib.parse.quote(filename)}&prop=imageinfo&iiprop=url&format=json"
            headers = {"User-Agent": "LexiTag/0.1.8 (https://github.com/lokesh-sg/lexitag; mail@lexitag.app)"}
            async with aiohttp.ClientSession(headers=headers) as session:
                async with session.get(api_url, timeout=aiohttp.ClientTimeout(total=4)) as resp:
                    if resp.status == 200:
                        data = await resp.json(content_type=None)
                        pages = data.get("query", {}).get("pages", {})
                        for page_id, page_data in pages.items():
                            if page_id != "-1" and "imageinfo" in page_data:
                                true_url = page_data["imageinfo"][0].get("url")
                                if true_url:
                                    return true_url.split("?")[0]
    except Exception as e:
        logger.warning(f"[CoverArt] Error resolving Wikimedia URL {url}: {e}")
        
    return url


async def _resolve_discogs_url_async(url: str) -> Optional[str]:
    """Resolve Discogs release/master/CDN URL or hallucinated hash URL to authentic high-resolution image via Discogs API."""
    if not url or "discogs" not in url.lower():
        # Check if it has an R-ID pattern commonly returned by AI for Discogs
        if not re.search(r"R-\d+", url):
            return None

    rel_match = re.search(r"(?:R-|/release(?:s)?/)(\d+)", url, re.IGNORECASE)
    master_match = re.search(r"/master(?:s)?/(\d+)", url, re.IGNORECASE)

    api_url = None
    if rel_match:
        api_url = f"https://api.discogs.com/releases/{rel_match.group(1)}"
    elif master_match:
        api_url = f"https://api.discogs.com/masters/{master_match.group(1)}"

    if not api_url:
        return None

    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) LexiTag/0.1.8"
        }
        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.get(api_url, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                if resp.status == 200:
                    data = await resp.json(content_type=None)
                    images = data.get("images", [])
                    if images and isinstance(images, list):
                        primary = next((img for img in images if img.get("type") == "primary"), images[0])
                        uri = primary.get("uri") or primary.get("resource_url")
                        if uri and (uri.startswith("http://") or uri.startswith("https://")):
                            return uri
    except Exception as e:
        logger.debug(f"[CoverArt] Error resolving Discogs URL {url}: {e}")
    return None


async def _extract_url_candidate(url: str) -> Optional[Dict[str, Any]]:
    """Fetch image from a user-supplied web page, Discogs, or Wikipedia URL."""
    try:
        headers = {
            "User-Agent": "LexiTag/0.1.8 (https://github.com/lokesh-sg/lexitag; mail@lexitag.app) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
        }
        if re.search(r"\.(jpe?g|png|webp)(\?.*)?$", url, re.IGNORECASE):
            if await _validate_image_url(url):
                return {
                    "score": 110,
                    "image_url": url,
                    "source": "User Web Link",
                    "album": "",
                    "artist": "",
                    "description": "Image provided via user URL link",
                    "is_exact": True,
                }
        # Check Discogs URL
        discogs_img = await _resolve_discogs_url_async(url)
        if discogs_img and await _validate_image_url(discogs_img):
            return {
                "score": 110,
                "image_url": discogs_img,
                "source": "Discogs",
                "album": "",
                "artist": "",
                "description": "Official Discogs release artwork",
                "is_exact": True,
            }
        wiki_match = re.search(r"wikipedia\.org/wiki/([^#?&]+)", url)
        if wiki_match:
            title_slug = wiki_match.group(1)
            api_url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{title_slug}"
            async with aiohttp.ClientSession(headers=headers) as session:
                async with session.get(api_url, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                    if resp.status == 200:
                        data = await resp.json(content_type=None)
                        img_info = data.get("originalimage") or data.get("thumbnail")
                        if img_info and img_info.get("source"):
                            src = _normalize_wikimedia_url(img_info["source"])
                            return {
                                "score": 110,
                                "image_url": src,
                                "source": "Wikipedia (Official Page)",
                                "album": data.get("title", ""),
                                "artist": "",
                                "description": data.get("description", "Official Wikipedia artwork"),
                                "is_exact": True,
                            }
        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                if resp.status == 200:
                    html = await resp.text()
                    og_match = re.search(r'<meta\s+property=["\']og:image["\']\s+content=["\']([^"\']+)["\']', html, re.IGNORECASE)
                    if not og_match:
                        og_match = re.search(r'<meta\s+content=["\']([^"\']+)["\']\s+property=["\']og:image["\']', html, re.IGNORECASE)
                    if og_match:
                        og_url = _normalize_wikimedia_url(og_match.group(1))
                        if og_url.startswith("//"):
                            og_url = "https:" + og_url
                        if await _validate_image_url(og_url):
                            return {
                                "score": 110,
                                "image_url": og_url,
                                "source": "Web Page (OG Image)",
                                "album": "",
                                "artist": "",
                                "description": "Extracted from provided webpage",
                                "is_exact": True,
                            }
    except Exception as e:
        logger.warning(f"[CoverArt] Error extracting image from URL {url}: {e}")
    return None


async def _search_wikipedia_candidates(album: str, year: str = "") -> List[Dict[str, Any]]:
    """Query Wikipedia summary API for film/soundtrack posters."""
    if not album:
        return []
    candidates = []
    headers = {
        "User-Agent": "LexiTag/0.1.8 (https://github.com/lokesh-sg/lexitag; mail@lexitag.app)"
    }
    slugs = []
    clean_alb = re.sub(r"[^\w\s]", "", album).strip().replace(" ", "_")
    slugs.append(f"{clean_alb}_(film)")
    slugs.append(f"{clean_alb}_(soundtrack)")
    slugs.append(f"{clean_alb}_(album)")
    slugs.append(clean_alb)
    
    seen = set()
    async with aiohttp.ClientSession(headers=headers) as session:
        for slug in slugs:
            api_url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{slug}"
            try:
                async with session.get(api_url, timeout=aiohttp.ClientTimeout(total=4)) as resp:
                    if resp.status == 200:
                        data = await resp.json(content_type=None)
                        img_info = data.get("originalimage") or data.get("thumbnail")
                        if img_info and img_info.get("source"):
                            src = _normalize_wikimedia_url(img_info["source"])
                            if src not in seen:
                                seen.add(src)
                                page_desc = data.get("description", "")
                                candidates.append({
                                    "score": 95,
                                    "image_url": src,
                                    "source": "Wikipedia (Official Article)",
                                    "album": data.get("title", album),
                                    "artist": "",
                                    "year": year,
                                    "description": f"Official Wikipedia entry ({page_desc or 'Film/Soundtrack'})",
                                    "is_exact": True,
                                })
            except Exception:
                pass
    return candidates


async def _validate_image_url(url: str, timeout: int = 8) -> bool:
    """Check whether a URL points to an accessible image."""
    if not url or not (url.startswith("http://") or url.startswith("https://")):
        return False
    url = _normalize_wikimedia_url(url)
    try:
        headers = {
            "User-Agent": "LexiTag/0.1.8 (https://github.com/lokesh-sg/lexitag; mail@lexitag.app) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
        }
        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
                if resp.status != 200:
                    return False
                content_type = resp.headers.get("Content-Type", "").lower()
                if "image" in content_type:
                    return True
                chunk = await resp.content.read(64)
                if chunk.startswith(b"\xff\xd8") or chunk.startswith(b"\x89PNG") or (b"WEBP" in chunk):
                    return True
    except Exception:
        pass
    return False


async def _search_itunes_candidates(album: str = "", artist: str = "", title: str = "", year: str = "", relaxed: bool = False) -> List[Dict[str, Any]]:
    """Query Apple Music / iTunes Search API for high-resolution 1200x1200 master artwork candidates."""
    queries = []
    if album and year:
        queries.append((f"{album} {year}", "album"))
    if album:
        queries.append((album, "album"))
    if album and artist:
        queries.append((f"{artist} {album}", "album"))
    if not album:
        if artist and title:
            queries.append((f"{artist} {title}", "song"))
        if artist:
            queries.append((artist, "album"))  # artist discography browsing in relaxed mode
        if title:
            queries.append((title, "song"))

    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
    candidates: List[Dict[str, Any]] = []
    seen = set()

    for query_str, entity in queries:
        for country_param in ("", "&country=IN"):
            url = f"https://itunes.apple.com/search?term={urllib.parse.quote(query_str)}&entity={entity}&limit=10{country_param}"
            try:
                async with aiohttp.ClientSession(headers=headers) as session:
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                        if resp.status == 200:
                            data = await resp.json(content_type=None)
                            results = data.get("results", [])
                            for item in results:
                                cid = item.get("collectionId")
                                if cid in seen:
                                    continue
                                seen.add(cid)
                                raw_art = item.get("artworkUrl100", "")
                                if not raw_art:
                                    continue

                                col_name = item.get("collectionName", "")
                                col_artist = item.get("artistName", "")
                                col_year = (item.get("releaseDate", "") or "")[:4]

                                if album and not relaxed and not _is_album_match(album, col_name):
                                    continue

                                is_exact = _is_exact_match(album, col_name, year, col_year)
                                score = 55
                                if is_exact:
                                    score += 45
                                if year and col_year and str(year).isdigit() and col_year.isdigit():
                                    diff = abs(int(col_year) - int(year))
                                    if diff == 0:
                                        score += 30
                                    elif diff <= 1:
                                        score += 15
                                    elif diff > 2:
                                        score -= 50  # Heavy penalty for modern remake/single of vintage track
                                if artist and col_artist and artist.lower() in col_artist.lower():
                                    score += 20

                                high_res_art = re.sub(r"\d+x\d+bb\.", "1200x1200bb.", raw_art)
                                candidates.append({
                                    "score": score,
                                    "image_url": high_res_art,
                                    "source": "Apple Music (High-Res Master)",
                                    "album": col_name,
                                    "artist": col_artist,
                                    "year": col_year,
                                    "description": f"Official artwork for {col_name} ({col_year or 'Release'})",
                                    "is_exact": is_exact,
                                })
            except Exception as e:
                logger.debug(f"[CoverArt] iTunes query '{query_str}' error: {e}")

    candidates.sort(key=lambda x: (1 if x["is_exact"] else 0, x["score"]), reverse=True)
    return candidates[:5]


async def _search_deezer_candidates(album: str = "", artist: str = "", title: str = "", year: str = "", relaxed: bool = False) -> List[Dict[str, Any]]:
    """Query Deezer Open Search API for 1000x1000 master album artwork candidates."""
    queries = []
    if album:
        if year:
            queries.append(f'album:"{album}"')
            queries.append(f"{album} {year}")
        queries.append(f'album:"{album}"')
        queries.append(album)
        if artist:
            queries.append(f"{artist} {album}")
    if not album:
        if artist and title:
            queries.append(f'artist:"{artist}" track:"{title}"')
            queries.append(f"{artist} {title}")
        if artist:
            queries.append(f'artist:"{artist}"')  # artist discography in relaxed mode
        if title:
            queries.append(title)

    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
    candidates: List[Dict[str, Any]] = []
    seen_urls = set()

    for query_str in queries:
        url = f"https://api.deezer.com/search?q={urllib.parse.quote(query_str)}&limit=5"
        try:
            async with aiohttp.ClientSession(headers=headers) as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                    if resp.status == 200:
                        data = await resp.json(content_type=None)
                        items = data.get("data", [])
                        for item in items:
                            album_info = item.get("album", {})
                            item_album_title = album_info.get("title", "")
                            if not item_album_title:
                                continue

                            if album and not relaxed and not _is_album_match(album, item_album_title):
                                continue

                            cover_url = (
                                album_info.get("cover_xl")
                                or album_info.get("cover_big")
                                or album_info.get("cover_medium")
                            )
                            if not cover_url or cover_url in seen_urls:
                                continue
                            seen_urls.add(cover_url)

                            is_exact = _is_exact_match(album, item_album_title, year, "")
                            item_artist = item.get("artist", {}).get("name", artist)
                            score = 50
                            if is_exact:
                                score += 45
                            if artist and item_artist and artist.lower() in item_artist.lower():
                                score += 20

                            candidates.append({
                                "score": score,
                                "image_url": cover_url,
                                "source": "Deezer (1000x1000 Master)",
                                "album": item_album_title,
                                "artist": item_artist,
                                "year": "",
                                "description": f"Official artwork for {item_album_title}",
                                "is_exact": is_exact,
                            })
        except Exception as e:
            logger.debug(f"[CoverArt] Deezer query '{query_str}' error: {e}")

    candidates.sort(key=lambda x: (1 if x["is_exact"] else 0, x["score"]), reverse=True)
    return candidates[:3]


async def _search_caa_candidates(album: str = "", artist: str = "") -> List[Dict[str, Any]]:
    """Query MusicBrainz and Cover Art Archive for open-source release artwork candidates."""
    if not album:
        return []

    query = f'release:"{album}"'
    if artist:
        query += f' AND artist:"{artist}"'

    url = f"https://musicbrainz.org/ws/2/release/?query={urllib.parse.quote(query)}&fmt=json&limit=3"
    headers = {"User-Agent": "LexiTag/0.1.8 (https://github.com/lokesh-sg/lexitag)"}
    candidates: List[Dict[str, Any]] = []

    try:
        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                if resp.status == 200:
                    data = await resp.json(content_type=None)
                    releases = data.get("releases", [])
                    for rel in releases:
                        mbid = rel.get("id")
                        if not mbid:
                            continue
                        caa_url = f"https://coverartarchive.org/release/{mbid}/front-500"
                        async with session.head(caa_url, timeout=aiohttp.ClientTimeout(total=5), allow_redirects=True) as caa_resp:
                            if caa_resp.status == 200:
                                rel_title = rel.get("title", album)
                                is_exact = _is_exact_match(album, rel_title)
                                candidates.append({
                                    "score": 40 + (45 if is_exact else 0),
                                    "image_url": caa_url,
                                    "source": "Cover Art Archive (MusicBrainz)",
                                    "album": rel_title,
                                    "artist": artist,
                                    "year": (rel.get("date", "") or "")[:4],
                                    "description": f"Community-verified release artwork for {rel_title}",
                                    "is_exact": is_exact,
                                })
                                break
    except Exception as e:
        logger.debug(f"[CoverArt] Cover Art Archive error: {e}")
    return candidates



async def download_image(url: str, timeout: int = 15) -> Tuple[bytes, str]:
    """Download image bytes and determine MIME type."""
    if not url or not url.startswith(("http://", "https://")):
        raise ValueError(f"Invalid image URL protocol: {url}")
    url = _normalize_wikimedia_url(url)
    headers = {
        "User-Agent": "LexiTag/0.1.8 (https://github.com/lokesh-sg/lexitag; mail@lexitag.app) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
    }
    async with aiohttp.ClientSession(headers=headers) as session:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
            if resp.status != 200:
                raise ValueError(f"Failed to download image from {url}, HTTP status {resp.status}")
            data = await resp.read()

    if not data or len(data) < 100:
        raise ValueError("Downloaded file is empty or too small to be an image")

    # Detect MIME type from magic bytes or headers
    mime = "image/jpeg"
    if data.startswith(b"\x89PNG"):
        mime = "image/png"
    elif data.startswith(b"\xff\xd8"):
        mime = "image/jpeg"
    elif data.startswith(b"RIFF") and b"WEBP" in data[:16]:
        mime = "image/webp"

    return data, mime


async def apply_cover_to_track(track_id: int, image_bytes: bytes, mime_type: str = "image/jpeg", source_url: str = "") -> Dict[str, Any]:
    """Embed downloaded or uploaded cover art into a track's file, write directory cover image, and update database."""
    db = await get_db()
    cursor = await db.execute("SELECT id, path, filename, title, artist, album FROM tracks WHERE id = ?", (track_id,))
    track = await cursor.fetchone()
    if not track:
        return {"success": False, "error": f"Track {track_id} not found"}

    filepath = track["path"]
    parent_dir = Path(filepath).parent

    # 1. Embed directly into audio tags
    success = embed_cover_art(filepath, image_bytes, mime_type)

    # 2. Also write standard folder image so players (Navidrome, Plex, foobar) and LexiTag directory fallback find it
    try:
        ext_img = ".png" if mime_type == "image/png" else ".jpg"
        cover_path = parent_dir / f"cover{ext_img}"
        with open(cover_path, "wb") as f:
            f.write(image_bytes)

        # Remove opposing stale extension if present (e.g. if we wrote cover.jpg, remove stale cover.png)
        alt_ext = ".jpg" if mime_type == "image/png" else ".png"
        alt_cover = parent_dir / f"cover{alt_ext}"
        if alt_cover.exists():
            try:
                alt_cover.unlink()
            except Exception:
                pass

        # Also overwrite folder.jpg / folder.png if present so Navidrome/Plex doesn't use old folder.jpg
        for legacy_name in [f"folder{ext_img}", f"folder{alt_ext}"]:
            legacy_file = parent_dir / legacy_name
            if legacy_file.exists():
                try:
                    with open(legacy_file, "wb") as f:
                        f.write(image_bytes)
                except Exception:
                    pass
    except Exception as e:
        logger.debug(f"[CoverArt] Directory cover write error: {e}")

    if not success:
        return {"success": False, "error": f"Failed to embed cover art into {track['filename']}"}

    # Update database has_cover flag
    await db.execute("UPDATE tracks SET has_cover = 1 WHERE id = ?", (track_id,))
    await db.commit()

    return {
        "success": True,
        "track_id": track_id,
        "filename": track["filename"],
        "has_cover": True,
        "source": source_url or "Embedded Artwork",
    }
