"""Music library scanner — reads audio files and extracts tags via mutagen."""

import os
import re
import time
from pathlib import Path
from mutagen import File as MutagenFile
from mutagen.id3 import ID3
from mutagen.flac import FLAC
from mutagen.mp4 import MP4

SUPPORTED_EXTENSIONS = {".mp3", ".flac", ".m4a", ".mp4", ".ogg", ".opus", ".wma", ".aac", ".wav"}

# Patterns that indicate junk metadata
JUNK_PATTERNS = [
    re.compile(r'https?://\S+', re.IGNORECASE),
    re.compile(r'www\.\S+', re.IGNORECASE),
    re.compile(r'\.(com|net|org|io|info|online|site|top|club|audio|music|gold|download|link|me|biz|tv|xyz|life|best|today|work|site)\b', re.IGNORECASE),
    re.compile(r'downloaded?\s+from', re.IGNORECASE),
    re.compile(r'ripped\s+by', re.IGNORECASE),
    re.compile(r'uploaded?\s+by', re.IGNORECASE),
    re.compile(r'provided\s+by', re.IGNORECASE),
    re.compile(r'encoded\s+by', re.IGNORECASE),
    re.compile(r'tags?\s+by', re.IGNORECASE),
    re.compile(r'visit\s+(us\s+at\s+)?', re.IGNORECASE),
    re.compile(r'free\s+download', re.IGNORECASE),
    re.compile(r'official\s+site', re.IGNORECASE),
    re.compile(r'exclusive\s+on', re.IGNORECASE),
    re.compile(r'quality\s+assured', re.IGNORECASE),
    re.compile(r'join\s+us', re.IGNORECASE),
    re.compile(r'subscribe', re.IGNORECASE),
    re.compile(r'promo(tional)?', re.IGNORECASE),
    re.compile(r'sponsor(ed|ship)?', re.IGNORECASE),
    re.compile(r'advertising|marketing', re.IGNORECASE),
    re.compile(r'follow\s+(us|me)\s+(on|at)', re.IGNORECASE),
    re.compile(r'TamilVaathi|Masstamilan|Starmusiq|Isaimini|Tamilyogi|Samperals|Raag|Gaana|Saavn|Naasongs|Sensongsmp3', re.IGNORECASE),
]




def _check_junk(text: str) -> bool:
    """Return True if text matches any junk pattern."""
    if not text:
        return False
    # Specific aggressive check for known promo signatures
    low_text = text.lower()
    if "tamilvaathi" in low_text or "tamilvaathi.online" in low_text:
        return True
    return any(p.search(text) for p in JUNK_PATTERNS)


def _get_id3_tags(audio) -> dict:
    """Extract tags from an ID3-based file (MP3/WAV with ID3)."""
    tags = {
        "title": "",
        "artist": "",
        "album": "",
        "genre": "",
        "year": "",
        "lyrics": "",
        "comment": "",
        "composer": "",
        "language": "",
    }
    
    from mutagen.id3 import ID3
    if isinstance(audio, ID3):
        id3 = audio
    elif hasattr(audio, 'tags') and audio.tags is not None:
        id3 = audio.tags
    else:
        return tags

    # Title
    if "TIT2" in id3:
        tags["title"] = str(id3["TIT2"])
    # Artist
    if "TPE1" in id3:
        tags["artist"] = str(id3["TPE1"])
    # Album
    if "TALB" in id3:
        tags["album"] = str(id3["TALB"])
    # Genre
    if "TCON" in id3:
        tags["genre"] = str(id3["TCON"])
    # Year
    if "TDRC" in id3:
        tags["year"] = str(id3["TDRC"])
    elif "TYER" in id3:
        tags["year"] = str(id3["TYER"])
    # Composer
    if "TCOM" in id3:
        tags["composer"] = str(id3["TCOM"])
    # Language
    if "TXXX:Language" in id3:
        tags["language"] = str(id3["TXXX:Language"])
    elif "TLAN" in id3:
        tags["language"] = str(id3["TLAN"])
    # Lyrics (USLT frames)
    # Check all USLT frames; prioritize those with content
    for key in id3:
        if key.startswith("USLT"):
            val = str(id3[key])
            if val.strip():
                tags["lyrics"] = val
                break
    
    # If no USLT, check for SYLT (synchronized lyrics)
    if not tags["lyrics"]:
        for key in id3:
            if key.startswith("SYLT"):
                sylt = id3[key]
                # Convert SYLT structure back to roughly timestamped text or just text
                try:
                    lines = []
                    for text, ms in sylt.text:
                        if text.strip():
                            m = ms // 60000
                            s = (ms % 60000) / 1000
                            lines.append(f"[{m:02d}:{s:05.2f}] {text}")
                    if lines:
                        tags["lyrics"] = "\n".join(lines)
                        break
                except Exception:
                    pass

    # Comment (COMM frames)
    for key in id3:
        if key.startswith("COMM"):
            tags["comment"] = str(id3[key])
            break

    return tags


def _get_flac_tags(audio: FLAC) -> dict:
    """Extract tags from a FLAC file."""
    tags = {
        "title": "",
        "artist": "",
        "album": "",
        "genre": "",
        "year": "",
        "lyrics": "",
        "comment": "",
        "composer": "",
        "language": "",
    }
    if audio.tags is None:
        return tags

    vorbis = audio.tags
    tags["title"] = vorbis.get("title", [""])[0]
    tags["artist"] = vorbis.get("artist", [""])[0]
    tags["album"] = vorbis.get("album", [""])[0]
    tags["genre"] = vorbis.get("genre", [""])[0]
    tags["year"] = vorbis.get("date", [""])[0]
    
    # Lyrics: check common FLAC/Vorbis lyrics keys
    for k in ["lyrics", "unsyncedlyrics", "lyric", "unsynced lyrics"]:
        val = vorbis.get(k, [""])[0]
        if val.strip():
            tags["lyrics"] = val
            break
            
    tags["comment"] = vorbis.get("comment", [""])[0]
    tags["composer"] = vorbis.get("composer", [""])[0]
    # Language: Prioritize full name if available
    lang_val = vorbis.get("language", [""])[0]
    full_lang = vorbis.get("language_full", [""])[0]
    tags["language"] = full_lang if full_lang and len(full_lang) > 3 else lang_val

    return tags


def _get_mp4_tags(audio: MP4) -> dict:
    """Extract tags from an MP4/M4A file."""
    tags = {
        "title": "",
        "artist": "",
        "album": "",
        "genre": "",
        "year": "",
        "lyrics": "",
        "comment": "",
        "composer": "",
        "language": "",
    }
    if audio.tags is None:
        return tags

    t = audio.tags
    tags["title"] = t.get("\xa9nam", [""])[0]
    tags["artist"] = t.get("\xa9ART", [""])[0]
    tags["album"] = t.get("\xa9alb", [""])[0]
    tags["genre"] = t.get("\xa9gen", [""])[0]
    tags["year"] = t.get("\xa9day", [""])[0]
    
    # Lyrics: check common MP4 lyrics keys
    for k in ["\xa9lyr", "lyrics", "desc"]:
        val = t.get(k, [""])[0]
        if isinstance(val, str) and val.strip():
            tags["lyrics"] = val
            break
            
    tags["comment"] = t.get("\xa9cmt", [""])[0]
    tags["composer"] = t.get("\xa9wrt", [""])[0]
    # Language: Prioritize full name in freeform atom if available
    lang_val = t.get("\xa9lan", [""])[0]
    full_lang_raw = t.get("----:com.apple.iTunes:Language", [b""])[0]
    full_lang = full_lang_raw.decode('utf-8', errors='ignore') if isinstance(full_lang_raw, bytes) else str(full_lang_raw)
    tags["language"] = full_lang if full_lang and len(full_lang) > 3 else lang_val

    return tags


def scan_file(filepath: str) -> dict | None:
    """
    Scan a single audio file and return metadata dict, or None on failure.
    """
    try:
        from mutagen.mp3 import MP3
        from mutagen.flac import FLAC
        from mutagen.mp4 import MP4
        from mutagen.wave import WAVE
        
        ext = Path(filepath).suffix.lower()
        if ext == ".mp3":
            try:
                audio = MP3(filepath)
            except Exception as e:
                if "can't sync to MPEG frame" in str(e):
                    print(f"[scanner] Sync error in {filepath}, falling back to ID3-only read")
                    from mutagen.id3 import ID3
                    audio = ID3(filepath)
                else:
                    raise
            tags = _get_id3_tags(audio)
            fmt = "mp3"
        elif ext == ".flac":
            audio = FLAC(filepath)
            tags = _get_flac_tags(audio)
            language = tags.get("language", "")
            fmt = "flac"
        elif ext in (".m4a", ".mp4"):
            audio = MP4(filepath)
            tags = _get_mp4_tags(audio)
            language = tags.get("language", "")
            fmt = "m4a"
        elif ext == ".wav":
            try:
                from mutagen.wave import WAVE
                audio = WAVE(filepath)
                tags = _get_id3_tags(audio)
                fmt = "wav"
            except Exception as e:
                print(f"[scanner] WAVE loader failed for {filepath}, trying explicit ID3: {e}")
                try:
                    from mutagen.id3 import ID3
                    audio = ID3(filepath)
                    tags = _get_id3_tags(audio)
                    fmt = "wav"
                except Exception as e2:
                    print(f"[scanner] ID3 fallback also failed: {e2}")
                    audio = None
                    tags = {
                        "title": "", "artist": "", "album": "", "genre": "",
                        "year": "", "lyrics": "", "comment": "", "composer": "", "language": ""
                    }
                    fmt = "wav"

            # Fallback to RIFF INFO if standard fields are empty (if we have a usable object)
            if not tags["title"] or not tags["artist"]:
                try:
                    from mutagen.riff import INFO
                    riff = INFO(filepath)
                    if riff:
                        if not tags["title"]: tags["title"] = str(riff.get("INAM", [""])[0])
                        if not tags["artist"]: tags["artist"] = str(riff.get("IART", [""])[0])
                        if not tags["album"]: tags["album"] = str(riff.get("IPRD", [""])[0])
                        if not tags["genre"]: tags["genre"] = str(riff.get("IGNR", [""])[0])
                        if not tags["year"]: tags["year"] = str(riff.get("ICRD", [""])[0])
                except Exception:
                    pass
        else:
            from mutagen import File
            audio = File(filepath)
            if audio is None: return None
            
            # Generic: try common keys
            tags = {
                "title": "", "artist": "", "album": "", "genre": "",
                "year": "", "lyrics": "", "comment": "", "composer": "",
            }
            # Safely get tags object
            tags_obj = getattr(audio, 'tags', audio)
            if tags_obj and hasattr(tags_obj, 'items'):
                try:
                    for key, val in tags_obj.items():
                        k = key.lower()
                        if "title" in k:
                            tags["title"] = str(val[0]) if isinstance(val, list) else str(val)
                        elif "artist" in k:
                            tags["artist"] = str(val[0]) if isinstance(val, list) else str(val)
                        elif "album" in k:
                            tags["album"] = str(val[0]) if isinstance(val, list) else str(val)
                        elif "genre" in k:
                            tags["genre"] = str(val[0]) if isinstance(val, list) else str(val)
                        elif "date" in k or "year" in k:
                            tags["year"] = str(val[0]) if isinstance(val, list) else str(val)
                        elif "composer" in k:
                            tags["composer"] = str(val[0]) if isinstance(val, list) else str(val)
                        elif "lyrics" in k:
                            tags["lyrics"] = str(val[0]) if isinstance(val, list) else str(val)
                        elif "comment" in k:
                            tags["comment"] = str(val[0]) if isinstance(val, list) else str(val)
                except Exception:
                    pass
            
            language = tags.get("language", "")
            fmt = "generic"

        # Duration
        info = getattr(audio, 'info', None)
        duration = info.length if info and hasattr(info, "length") else 0.0

        # Check for junk - Deep Scan (check every available tag)
        has_junk = False
        tags_to_check = getattr(audio, 'tags', audio)
        if tags_to_check and hasattr(tags_to_check, 'items'):
            for key, val in tags_to_check.items():
                if key.startswith("APIC") or key == "covr":
                    continue # Skip binary data
                
                # Check both key (some keys are junk themselves) and value
                try:
                    val_str = str(val[0]) if isinstance(val, list) and len(val) > 0 else str(val)
                    # For ID3 frames, the str() of the frame usually gives the text content
                    # But some frames might need str(val.text[0]) or similar.
                    if _check_junk(str(key)) or _check_junk(val_str):
                        print(f"[scanner] JUNK FOUND in frame {key}: {val_str}")
                        has_junk = True
                        break
                except Exception as e:
                    print(f"[scanner] Error checking frame {key}: {e}")

        if not has_junk:
            # Final check on extracted standard tags just in case
            has_junk = any(
                _check_junk(tags.get(f, ""))
                for f in ("title", "artist", "album", "genre", "comment", "lyrics", "composer")
            )

        # Info (Bitrate, etc.)
        info = getattr(audio, 'info', None)
        bitrate = getattr(info, "bitrate", 0) // 1000 if info else 0

        # Apply local cleaning immediately during scan
        from .local_cleaner import pre_clean_tags
        from .discovery_engine import discovery_engine
        
        raw_scanned = {
            "title": tags.get("title", ""),
            "artist": tags.get("artist", ""),
            "album": tags.get("album", ""),
            "genre": tags.get("genre", ""),
            "year": tags.get("year", ""),
            "composer": tags.get("composer", ""),
            "comment": tags.get("comment", ""),
            "filename": os.path.basename(filepath),
            "encodedby": tags.get("encodedby", "") if "encodedby" in tags else ""
        }
        # Analyze for automated junk discovery (candidates)
        discovery_engine.analyze_track_tags(raw_scanned)
        
        cleaned = pre_clean_tags(raw_scanned)

        return {
            "path": filepath,
            "filename": os.path.basename(filepath),
            "title": cleaned["title"],
            "artist": cleaned["artist"],
            "album": cleaned["album"],
            "genre": cleaned["genre"],
            "year": cleaned["year"],
            "composer": cleaned["composer"],
            "duration": round(duration, 2),
            "bitrate": bitrate,
            "has_lyrics": bool(tags.get("lyrics", "").strip()),
            "language": tags.get("language", ""),
            "has_junk": has_junk,
            "format": fmt,
            "lyrics": tags.get("lyrics", ""),
            "comment": cleaned["comment"],
            "last_scanned": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
    except Exception as e:
        print(f"[scanner] Error scanning {filepath}: {e}")
        return None


def fetch_raw_tags(filepath: str) -> dict:
    """Read every raw tag mutagen found in the file, returning a standardized dict."""
    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(filepath)
        if audio is None:
            return {"tags": {}, "format": "unknown"}
            
        tags_obj = getattr(audio, "tags", audio)
        raw_tags = {}
        if tags_obj and hasattr(tags_obj, "items"):
            for key, val in tags_obj.items():
                if key.startswith("APIC") or key == "covr":
                    raw_tags[str(key)] = "__ALBUM_ART__"
                    continue
                if isinstance(val, list):
                    raw_tags[str(key)] = [str(v) for v in val]
                else:
                    raw_tags[str(key)] = str(val)
                    
        return {
            "tags": raw_tags,
            "format": Path(filepath).suffix.lower().lstrip(".")
        }
    except Exception as e:
        print(f"[scanner] fetch_raw_tags error: {e}")
        return {"tags": {}, "format": "error"}

def scan_directory(music_dirs_str: str):
    """
    Recursively scan one or more directories for audio files.
    Yields (current_index, total_files, track_data) for each file.
    """
    # Split the string by newlines and filter out empty paths
    directories = [d.strip() for d in music_dirs_str.split('\n') if d.strip() and os.path.isdir(d.strip())]
    
    # 1. First pass: count total supported files
    all_files = []
    for directory in directories:
        for root, _, files in os.walk(directory):
            for fname in files:
                if Path(fname).suffix.lower() in SUPPORTED_EXTENSIONS:
                    all_files.append(os.path.join(root, fname))
    
    total = len(all_files)
    if total == 0:
        return

    # 2. Second pass: scan and yield
    for i, fpath in enumerate(all_files):
        data = scan_file(fpath)
        yield (i + 1, total, data)

