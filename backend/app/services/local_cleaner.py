"""Local Cleaner engine — performs cost-effective pre-cleaning of metadata junk locally."""

import re

# Comprehensive list of generic promotional junk patterns (Global)
# Static patterns removed - System is now strictly data-driven via cleanup_rules in DB
JUNK_PATTERNS = []

# Placeholder patterns removed - System is now strictly data-driven via cleanup_rules in DB
PLACEHOLDER_PATTERNS = []

# Compile for speed - Default to a 'Never Match' pattern to avoid flagging everything if list is empty
_junk_regex = re.compile(r"$^", re.IGNORECASE)
_placeholder_regex = re.compile(r"$^", re.IGNORECASE)
_url_regex = re.compile(r"https?://\S+|www\.\S+|\.[a-z]{2,10}/|(?:\.com|\.net|\.org|\.io|\.info|\.online|\.site|\.top|\.club|\.audio|\.music|\.gold|\.download|\.link)\b", re.I)

# Global for dynamic patterns
_dynamic_junk_patterns = []
_dynamic_soundtrack_patterns = []
_dynamic_junk_regex = None

async def load_dynamic_patterns():
    """Load cleanup patterns from the database, categorized and escaped."""
    global _dynamic_junk_patterns, _dynamic_soundtrack_patterns, _dynamic_junk_regex
    from backend.app.database import get_db
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

        # 1. CONSTRUCTION OF JUNK REGEX (The 'Alert' list)
        # ONLY includes 'junk' category. 'soundtrack' category is for cleaning, not flagging.
        junk_only_patterns = JUNK_PATTERNS + _dynamic_junk_patterns
        unique_junk_patterns = sorted(list(set(junk_only_patterns)), key=len, reverse=True)
        
        if unique_junk_patterns:
            _dynamic_junk_regex = re.compile("|".join(unique_junk_patterns), re.IGNORECASE)
        else:
            # Fallback to a pattern that NEVER matches anything
            _dynamic_junk_regex = re.compile(r"$^")
            
    except Exception as e:
        import logging
        logging.error(f"[local_cleaner] Failed to load dynamic patterns: {e}")
        _dynamic_junk_regex = re.compile(r"$^")

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
        # If it's pure URL and in a junk-prone frame, clear it
        if key and any(key.lower().startswith(p.lower()) for p in JUNK_PRONE_FRAMES):
            return ""
        # If it's a single word and matches URL pattern, clear it
        if val_strip.count(" ") == 0:
            return ""

    # Rule 2: Pattern Match
    current_junk_regex = get_junk_regex()
    
    # Check if the whole value IS a junk or placeholder pattern
    is_junk_frame = key and any(key.lower().startswith(p.lower()) for p in JUNK_PRONE_FRAMES)
    
    # Skip clearing if it looks like a valid genre
    if key and "genre" in key.lower():
         if any(g in val_strip.lower() for g in ["soundtrack", "musical", "score", "classical", "pop", "jazz", "rock"]):
             return val_strip

    # If the whole value is a known junk signature, clear it
    # We use fullmatch to ensure we don't clear "Song with HQ" but we DO clear "HQ"
    if current_junk_regex.fullmatch(val_strip):
        if not (key and "title" in key.lower()): # Be very careful with titles
            return ""
        
    # Rule 3: Substring reduction (Aggressive for junk-prone frames, conservative for titles)
    if current_junk_regex.search(val_strip):
        # For non-title frames, we can be more aggressive
        # For titles, we only strip at word boundaries or if it's a known promo phrase
        is_title = key and any(x in key.lower() for x in ["title", "tit2"])
        
        cleaned = val_strip
        if is_title:
            # For titles, only remove URLs and very specific promo phrases at the end
            # Don't use the massive global regex for 'sub' on titles
            cleaned = _url_regex.sub("", cleaned).strip()
            # Remove trailing junk patterns only
            for pattern in [r"\s+[\-\:].*$", r"\(?Official\s+Video\)?", r"\(?HQ\)?", r"\(?Lyrics\)?"]:
                cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE).strip()
        else:
            # For other frames, use the dynamic junk regex
            total_patterns = JUNK_PATTERNS + _dynamic_junk_patterns + _dynamic_soundtrack_patterns
            junk_patterns_str = "|".join(sorted(list(set(total_patterns)), key=len, reverse=True))
            if junk_patterns_str:
                cleaned = re.sub(fr"\b(?:{junk_patterns_str})\b", "", val_strip, flags=re.IGNORECASE).strip()
                # If word-boundaries failed to match due to special characters like dots, 
                # do a fallback un-bounded replacement of custom patterns and pure URLs
                for custom_p in _dynamic_junk_patterns:
                    cleaned = re.sub(custom_p, "", cleaned, flags=re.IGNORECASE).strip()
                cleaned = _url_regex.sub("", cleaned).strip()

        # Clean up punctuation artifacts
        cleaned = re.sub(r"[\s\-:._|]+$", "", cleaned).strip()
        cleaned = re.sub(r"^[\s\-:._|]+", "", cleaned).strip()
        cleaned = re.sub(r"\(\s*\)", "", cleaned).strip()
        
        # 214: Final safety check: if we stripped EVERYTHING but the original had content,
        # and it wasn't a junk-prone frame, keep the original (minus basic whitespace)
        if not cleaned and val_strip and not is_junk_frame:
            return val_strip
            
        # [NEW] If the frame is junk-prone (like a comment) AND it still matches junk patterns, wipe it!
        # This prevents 'Ghost Junk' when partial cleaning leaves other promo signatures intact.
        if cleaned and is_junk_frame:
            from backend.app.services.scanner import _check_junk
            if _check_junk(cleaned):
                return ""
                
        return cleaned

    return val_strip

def clean_movie_references(tags: dict) -> dict:
    title_keys = ["title", "TIT2", "TITLE"]
    album_keys = ["album", "TALB", "ALBUM"]
    
    target_keys = title_keys + album_keys
    
    # Only strip very specific movie suffixes if they are separated
    movie_suffixes = [
        r"\(?Original\s+Motion\s+Pictures?\s+Soundtracks?\)?",
        r"\(?Original\s+Sound\s+Tracks?\)?",
        r"\(?Original\s+Soundtracks?\)?",
        r"\(?Original\s+Background\s+Scores?\)?",
        r"\(?Background\s+Scores?\)?",
        r"\(?BGM\)?",
        r"OST",
    ]
    
    for k in target_keys:
        if tags.get(k):
            val = str(tags[k]).strip()
            
            # For titles, we only remove these if they are at the end or in brackets
            for pattern in movie_suffixes:
                # Use word boundaries and only match at the end or in parentheses
                suffix_p = fr"[\s\-\(]+{pattern}[\s\)]*$"
                new_val = re.sub(suffix_p, "", val, flags=re.IGNORECASE).strip()
                if new_val: # Only apply if it doesn't empty the string
                    val = new_val
            
            val = re.sub(r"[\s\-:._|]+$", "", val).strip()
            val = re.sub(r"^[\s\-:._|]+", "", val).strip()
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
