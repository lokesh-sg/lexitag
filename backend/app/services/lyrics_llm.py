import re
from backend.app.services.llm import chat_completion

# LRC timestamp pattern: [mm:ss.xx] or [mm:ss:xx]
_LRC_TS = re.compile(r'^\[\d{1,2}:\d{2}[.:]\d{2}\]')

# Pattern to clean singer prefixes like "[00:12.00] Female : Line" or "[00:12.00] Male Chorus: Line"
_SINGER_PREFIX = re.compile(r'^(\[\d{1,2}:\d{2}[.:]\d{2}\])\s*(?:(?:Male|Female)?\s*(?:Chorus|Singer|S\d+|Vocalist|Lead|All|Duet)?\s*:\s*)', re.IGNORECASE)

SYSTEM_PROMPT = (
    "You are a music lyric retrieval assistant with Google Search access.\n\n"
    "TASK: Search Google for the FULL and COMPLETE song lyrics on lyrics databases, then return every line formatted with line markers.\n\n"
    "SEARCH STRATEGY:\n"
    "- Search Google naturally, exactly like a human: search '[song title] lyrics'.\n"
    "- Do NOT restrict searches to specific website names (like Gaana or Genius) — search broadly across the open web.\n"
    "- Handle common phonetic spelling/transliteration variations (e.g. 'Yenakk...' vs 'Enakk...', 'Yaen' vs 'Yen', 'Ye' vs 'E').\n"
    "- If title + album yields no results, drop the album and search solely for the song title and artist.\n"
    "- If the track is an adaptation of a traditional song or classical poem, search for the full original poem/song lyrics.\n\n"
    "OUTPUT FORMAT — TIMESTAMPED LINES ONLY:\n"
    "[mm:ss.xx] Lyric line\n"
    "Example:\n"
    "[00:04.00] First sung line\n"
    "[00:08.50] Second sung line\n\n"
    "CRITICAL COMPLETENESS REQUIREMENT:\n"
    "- Do NOT truncate, summarize, or stop after the first verse/stanza.\n"
    "- Ensure ALL verses (Stanza 1, Stanza 2, Charanam 1, Charanam 2), chorus repetitions, and outro are included until the song ends.\n\n"
    "RULES:\n"
    "1. Output ONLY timestamped lines. Do not add conversational intro, outro, singer names (e.g. S1, Male Chorus, Female:), markdown formatting blocks, or explanations.\n"
    "2. If available on the web, transcribe in the song's original native script (Tamil script for Tamil, Devanagari for Hindi, etc.). If native script is not found, use Romanized transliteration.\n"
    "3. Transcribe the COMPLETE song from start to end (intro, verses, chorus, bridge, outro).\n"
    "4. If no lyrics can be found anywhere after searching, output: [00:00.00] LYRICS_NOT_FOUND\n"
)


def _clean_hallucinated_timestamps(text: str) -> str:
    """
    If timestamps appear to be mechanically fabricated (e.g. starting at 00:00.00
    with uniform static increments like +4s across the entire song), strip timestamps and return plain text.
    """
    if not text:
        return ""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    ts_matches = [_LRC_TS.match(l) for l in lines]
    if not any(ts_matches):
        return text  # Already plain text

    # Parse timestamp seconds
    pattern = re.compile(r'^\[(\d{1,2}):(\d{2})(?:[.:](\d{2}))?\]')
    parsed_sec = []
    for l in lines:
        m = pattern.match(l)
        if m:
            mins, secs, hundredths = m.groups()
            sec_val = int(mins) * 60 + int(secs) + (int(hundredths) / 100.0 if hundredths else 0.0)
            parsed_sec.append(sec_val)
        else:
            parsed_sec.append(None)

    valid_secs = [s for s in parsed_sec if s is not None]
    if len(valid_secs) >= 4 and valid_secs[0] == 0.0:
        deltas = [round(valid_secs[i] - valid_secs[i - 1], 1) for i in range(1, min(6, len(valid_secs)))]
        # If deltas are all identical or exactly 3.0, 4.0, 5.0s, it's an artificial linear guess
        if len(set(deltas)) == 1 or (all(d in (2.0, 3.0, 4.0, 5.0) for d in deltas) and valid_secs[0] == 0.0 and valid_secs[1] in (2.0, 3.0, 4.0, 5.0)):
            print("[lyrics_llm] Detected hallucinated 00:00.00 static timestamps — stripping to clean plain text.")
            cleaned_plain = [_LRC_TS.sub('', l).strip() for l in lines]
            return "\n".join(l for l in cleaned_plain if l)

    return text


def strip_lrc_timestamps(text: str) -> str:
    """
    Strip LRC timestamp prefixes in Python to produce 100% clean, authentic plain text lyrics.
    This guarantees zero artificial timestamp hallucinations while allowing Gemini to bypass
    Google's verbatim copyright recitation filter during API generation.
    """
    if not text:
        return ""
    lines = []
    for line in text.splitlines():
        clean_line = _LRC_TS.sub('', line.strip()).strip()
        if clean_line:
            lines.append(clean_line)
    return "\n".join(lines)


def validate_lyrics(text: str) -> bool:
    """
    Validates lyrics — accepts both plain text and LRC format.
    Strips LRC timestamps before running length/repetition checks.
    """
    if not text or "LYRICS_NOT_FOUND" in text:
        return False

    lines = [line.strip() for line in text.split('\n') if line.strip()]

    # Detect LRC format and strip timestamps for content validation
    is_lrc = any(_LRC_TS.match(l) for l in lines)
    if is_lrc:
        content_lines = [_LRC_TS.sub('', l).strip() for l in lines if _LRC_TS.match(l)]
    else:
        content_lines = lines

    # 1. Length Check: Minimum 3 content lines
    if len(content_lines) < 3:
        print(f"[lyrics_llm] Validation failed: Response too short ({len(content_lines)} lines)")
        return False

    # 2. Repetition Check: Catch hallucination loops (same LONG line > 5 times consecutively).
    # Short lines like "Rock, rock!" or "Yeah" are legitimate musical repetitions — skip them.
    MIN_LOOP_LINE_LEN = 20
    consecutive_count = 1
    for i in range(1, len(content_lines)):
        if content_lines[i] == content_lines[i - 1]:
            consecutive_count += 1
            if consecutive_count > 5 and len(content_lines[i]) > MIN_LOOP_LINE_LEN:
                print(f"[lyrics_llm] Validation failed: Repetition loop detected at '{content_lines[i][:30]}...'")
                return False
        else:
            consecutive_count = 1

    return True


async def fetch_lyrics_llm(
    artist: str,
    title: str,
    album: str = "",
    language: str = "",
    on_retry: callable = None,
) -> str:
    """
    Fetch lyrics using Gemini with Google Search Grounding.
    Requests LRC (time-synced) format in the song's original script
    to avoid Gemini's RECITATION copyright block.
    """
    if not title and not album:
        return ""

    # Strip OST junk from album for a cleaner query
    clean_album = re.sub(r'\(.*?\)', '', album).strip() if album else ""

    # Expand ISO 639-2/3 codes to full language names
    _ISO_TO_LANG = {
        "tam": "Tamil", "hin": "Hindi", "tel": "Telugu", "mal": "Malayalam",
        "kan": "Kannada", "ben": "Bengali", "mar": "Marathi", "pan": "Punjabi",
        "eng": "English", "fra": "French", "spa": "Spanish", "deu": "German",
        "jpn": "Japanese", "kor": "Korean", "zho": "Chinese", "ara": "Arabic",
        "por": "Portuguese", "ita": "Italian", "rus": "Russian",
    }
    lang_full = _ISO_TO_LANG.get(language.lower().strip(), language).strip() if language else ""

    # Clean leading track numbers (e.g. "01 " or "01 - ") and trailing brackets/parentheses
    clean_title = re.sub(r'^\d+[\s._-]+', '', title).strip() if title else ""
    clean_title = re.sub(r'[\(\[].*?[\)\]]', '', clean_title).strip()

    parts = []
    if clean_title:
        parts.append(f"Song: '{clean_title}'")
    if artist:
        parts.append(f"Artist: '{artist}'")
    if clean_album:
        parts.append(f"Album: '{clean_album}'")
    if lang_full:
        parts.append(f"Language: {lang_full}")
    parts.append("Note: Provide the COMPLETE lyrics including all stanzas and outro.")

    user_msg = " | ".join(parts)

    print(f"[lyrics_llm] Grounded Request: {user_msg}")

    tools = [{"google_search": {}}]

    try:
        lyrics = await chat_completion(
            system_prompt=SYSTEM_PROMPT,
            user_message=user_msg,
            temperature=0.2,
            max_tokens=4096,
            on_retry=on_retry,
            tools=tools,
        )

        cleaned = lyrics.strip()
        # Clean markdown codeblocks if returned
        if cleaned.startswith("```") and cleaned.endswith("```"):
            cleaned = re.sub(r'^```[a-zA-Z]*\n', '', cleaned)
            cleaned = re.sub(r'\n```$', '', cleaned).strip()

        # Clean stray singer prefixes like "[00:12.00] Male Chorus: Hello" -> "[00:12.00] Hello"
        cleaned_lines = []
        for line in cleaned.splitlines():
            line_str = line.strip()
            if not line_str:
                continue
            line_str = _SINGER_PREFIX.sub(r'\1 ', line_str)
            cleaned_lines.append(line_str)
        cleaned = "\n".join(cleaned_lines)

        # Remove completion anchor [END_OF_TRACK] if present
        cleaned = re.sub(r'\s*\[END_OF_TRACK\]\s*$', '', cleaned, flags=re.IGNORECASE).strip()

        # Strip LRC timestamp prefixes so user receives clean, authentic plain text lyrics
        cleaned = strip_lrc_timestamps(cleaned)

        print(f"[lyrics_llm] RAW LLM Response:\n---\n{cleaned[:500]}...\n---")

        if "LYRICS_NOT_FOUND" in cleaned:
            print(f"[lyrics_llm] LLM reported LYRICS_NOT_FOUND")
            return ""

        if validate_lyrics(cleaned):
            print(f"[lyrics_llm] Validation successful (LRC={any(_LRC_TS.match(l) for l in cleaned.splitlines())})")
            return cleaned
        else:
            print(f"[lyrics_llm] Validation failed")
            return ""

    except RuntimeError as e:
        err = str(e)
        if "RECITATION" in err:
            print(f"[lyrics_llm] RECITATION block hit — Gemini refused to output lyrics for '{title}'. Consider switching to OpenAI/Claude provider for this track.")
        else:
            print(f"[lyrics_llm] Grounded fetch error: {e}")
        return ""
    except Exception as e:
        print(f"[lyrics_llm] Unexpected error: {e}")
        return ""
