"""Local Cleaner engine — performs cost-effective pre-cleaning of metadata junk locally."""

import re

# Comprehensive list of generic promotional junk patterns (Global)
JUNK_PATTERNS = [
    # URLs
    r"https?://[^\s{}]+",
    r"www\.[a-z0-9-]+\.[a-z]{2,10}",
    r"[a-z0-9-]+\.(online|net|com|org|xyz|biz|info|me|co|uk|in|pk|site|top|club|audio|music|gold|download|host|cc|ws|sh|io|ly|gd|gl|tv|link|click|social)",
    
    # Promotional Phrases (English/Universal)
    r"Downloaded from",
    r"Ripped by",
    r"Encoded by",
    r"Tags by",
    r"Provided by",
    r"Upload by",
    r"Official Site",
    r"Free Download",
    r"Join us at",
    r"Exclusive on",
    r"Visit for more",
    r"Quality assured",
    
    # Common Site signatures (Universal Patterns)
    r"MusicMaza",
    r"DjMaza",
    r"Gaana\.com",
    r"Saavn\.com",
    r"JioSaavn",
    r"downloaded?\s+from",
    r"ripped\s+by",
    r"uploaded?\s+by",
    r"provided\s+by",
    r"encoded\s+by",
    r"tags?\s+by",
    r"visit\s+(us\s+at\s+)?",
    r"free\s+download",
    r"official\s+site",
    r"exclusive\s+on",
    r"quality\s+assured",
    r"join\s+us",
    r"subscribe",
    r"promo(tional)?",
    r"sponsor(ed|ship)?",
    r"advertising|marketing",
    r"follow\s+(us|me)\s+(on|at)",
    
    # Audio Quality / Technical Promo Junk
    r"lossless",
    r"24(-|\s*)bit",
    r"collection\s+of\s+.*lossless",
    r"hires(\s*tracks)?",
    r"HiResTracks\.com",
    
    # Sountrack / Movie Suffixes (Global)
    r"\(?Original\s+Motion\s+Pictures?\s+Soundtracks?\)?",
    r"\(?Original\s+Sound\s+Tracks?\)?",
    r"\(?Original\s+Soundtracks?\)?",
    r"\(?Original\s+Motion\s+Pictures?\)?",
    r"\(?Original\s+Background\s+Scores?\)?",
    r"\(?Theatrical\s+Versions?\)?",
    r"\(?Promotional\s+Versions?\)?",
    r"\(?Background\s+Scores?\)?",
    r"\(?BGM\)?",
    r"\(?Soundtracks?\)?",
    r"\(?Official\s+Soundtracks?\)?",
    r"OST",
    r"Video\s+Songs?",
    r"Musical",
    r"High\s+Quality",
    r"HQ",
    # Generic placeholders
    r"Unknown\s+(Artist|Album|Genre|Year|Composer|Track)",
    r"Various\s+Artists?",
    r"Track\s*\d+",
]

# Compile for speed
_junk_regex = re.compile("|".join(JUNK_PATTERNS), re.IGNORECASE)
_url_regex = re.compile(r"https?://\S+|www\.\S+|\.[a-z]{2,10}/|(?:\.com|\.net|\.org|\.io|\.info|\.online|\.site|\.top|\.club|\.audio|\.music|\.gold|\.download|\.link)\b", re.I)

# Global for dynamic patterns
_dynamic_junk_patterns = []
_dynamic_soundtrack_patterns = []
_dynamic_junk_regex = None

async def load_dynamic_patterns():
    """Load cleanup patterns from the database, categorized and escaped."""
    global _dynamic_junk_patterns, _dynamic_soundtrack_patterns, _dynamic_junk_regex
    from ..database import get_db
    try:
        db = await get_db()
        cursor = await db.execute("SELECT pattern, category, is_regex FROM cleanup_patterns")
        rows = await cursor.fetchall()
        
        _dynamic_junk_patterns = []
        _dynamic_soundtrack_patterns = []
        
        for row in rows:
            p = row["pattern"]
            is_reg = bool(row["is_regex"])
            # Escape if not already marked as regex
            if not is_reg:
                p = re.escape(p)
            
            if row["category"] == "soundtrack":
                _dynamic_soundtrack_patterns.append(p)
            else:
                _dynamic_junk_patterns.append(p)

        # Merge all into one list
        total_patterns = JUNK_PATTERNS + _dynamic_junk_patterns + _dynamic_soundtrack_patterns
        # Deduplicate and sort by length descending
        unique_patterns = sorted(list(set(total_patterns)), key=len, reverse=True)
        
        if unique_patterns:
            _dynamic_junk_regex = re.compile("|".join(unique_patterns), re.IGNORECASE)
        else:
            _dynamic_junk_regex = _junk_regex
            
    except Exception as e:
        import logging
        logging.error(f"[local_cleaner] Failed to load dynamic patterns: {e}")
        _dynamic_junk_regex = _junk_regex

def get_junk_regex():
    """Returns the cached combined junk regex."""
    global _dynamic_junk_regex
    return _dynamic_junk_regex if _dynamic_junk_regex is not None else _junk_regex

# Frames that are ALMOST CERTAINLY junk if they contain a URL or Promo junk
JUNK_PRONE_FRAMES = {
    # Non-standard or comment-like frames
    "WOAF", "WOAR", "WOAS", "WORS", "WPAY", "WPUB", "WXXX",
    "TCOP", "TENC", "TEXT", "TLIB", "TMED", "TOWN", "TRSN", "TSTR", "TXXX",
    "TPUB", "TOPE", "TCOM", "COMM", "USLT", "TIT3", "comment", "lyrics", "composer", "encodedby",
}

def clean_value(val: str, key: str = None) -> str:
    """Apply local heuristics to clean a metadata value."""
    if not val or not isinstance(val, str):
        return val
    
    val_strip = val.strip()
    if not val_strip:
        return ""

    # Rule 1: Pure URL Check
    if _url_regex.match(val_strip):
        if key and any(key.lower().startswith(p.lower()) for p in JUNK_PRONE_FRAMES):
            return ""
        if val_strip.count(" ") == 0:
            return ""

    # Rule 2: Pattern Match
    current_junk_regex = get_junk_regex()
    if current_junk_regex.search(val_strip):
        # If the whole value IS a junk pattern
        matches = [m for m in JUNK_PATTERNS if re.fullmatch(m, val_strip, re.IGNORECASE)]
        if matches and len(val_strip.split()) <= 6:
            # Skip clearing if it looks like a valid genre
            if key and "genre" in key.lower():
                 if any(g in val_strip.lower() for g in ["soundtrack", "musical", "score", "classical", "pop", "jazz", "rock"]):
                     return val_strip
            return ""

        # If it's a known junk-prone frame and it's short, be aggressive
        if key and any(key.lower().startswith(p.lower()) for p in JUNK_PRONE_FRAMES):
            if val_strip.count(" ") < 3 or len(val_strip) < 40:
                return ""
                
        # Strip the junk part
        cleaned = current_junk_regex.sub("", val_strip).strip()
        cleaned = re.sub(r"[\s\-:._]+$", "", cleaned).strip()
        cleaned = re.sub(r"^[\s\-:._]+", "", cleaned).strip()
        cleaned = re.sub(r"\(\s*\)", "", cleaned).strip()
        
        is_junk_frame = key and any(key.lower().startswith(p.lower()) for p in JUNK_PRONE_FRAMES)
        if is_junk_frame and len(cleaned) < len(val_strip) * 0.3 and len(cleaned) < 20:
            return ""
            
        return cleaned

    return val_strip

def clean_movie_references(tags: dict) -> dict:
    title_keys = ["title", "TIT2", "TITLE"]
    album_keys = ["album", "TALB", "ALBUM"]
    
    target_keys = title_keys + album_keys
    
    for k in target_keys:
        if tags.get(k):
            val = str(tags[k]).strip()
            # Clean common generic meta-prefixes found in movie metadata
            all_suffix_patterns = JUNK_PATTERNS + _dynamic_soundtrack_patterns + _dynamic_junk_patterns
            
            for pattern in all_suffix_patterns:
                if any(x in pattern for x in ["Original", "OST", "BGM", "Soundtrack"]):
                    val = re.sub(pattern, "", val, flags=re.IGNORECASE).strip()
            
            val = re.sub(r"[\s\-:._]+$", "", val).strip()
            val = re.sub(r"^[\s\-:._]+", "", val).strip()
            val = re.sub(r"\(\s*\)", "", val).strip()
            
            tags[k] = val

    return tags

def pre_clean_tags(tags: dict) -> dict:
    cleaned = {}
    for k, v in tags.items():
        if isinstance(v, list):
            cleaned_vals = [clean_value(str(item), k) for item in v]
            cleaned[k] = [cv for cv in cleaned_vals if cv]
            if not cleaned[k]: cleaned[k] = ""
        else:
            cleaned[k] = clean_value(str(v), k)
            
    cleaned = clean_movie_references(cleaned)
    return cleaned
