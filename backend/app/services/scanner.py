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

# Legacy static patterns removed - System is now 100% data-driven via clean_rules in DB
JUNK_PATTERNS = []

def _check_junk(text: str) -> bool:
    """Return True if text matches any junk pattern."""
    if not text:
        return False
    
    from backend.app.services.local_cleaner import get_junk_regex, _placeholder_regex
    
    # 1. Check against primary junk regex (Promos, URLs from DB)
    if get_junk_regex().search(text):
        return True
    
    return False


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

    def _clean_frame(frame):
        if hasattr(frame, 'text'):
            return "; ".join([str(t) for t in frame.text]) if isinstance(frame.text, list) else str(frame.text)
        return str(frame).replace('\x00', '; ')

    # Title
    if "TIT2" in id3:
        tags["title"] = _clean_frame(id3["TIT2"])
    # Artist
    if "TPE1" in id3:
        tags["artist"] = _clean_frame(id3["TPE1"])
    # Album
    if "TALB" in id3:
        tags["album"] = _clean_frame(id3["TALB"])
    # Genre
    if "TCON" in id3:
        tags["genre"] = _clean_frame(id3["TCON"])
    # Year
    if "TDRC" in id3:
        tags["year"] = _clean_frame(id3["TDRC"])
    elif "TYER" in id3:
        tags["year"] = _clean_frame(id3["TYER"])
    # Composer
    if "TCOM" in id3:
        tags["composer"] = _clean_frame(id3["TCOM"])
    # Language
    if "TXXX:Language" in id3:
        tags["language"] = _clean_frame(id3["TXXX:Language"])
    elif "TLAN" in id3:
        tags["language"] = _clean_frame(id3["TLAN"])
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
    
    def _safe_get(k):
        val = vorbis.get(k)
        return val[0] if val and isinstance(val, list) and len(val) > 0 else ""

    tags["title"] = _safe_get("title")
    tags["artist"] = _safe_get("artist")
    tags["album"] = _safe_get("album")
    tags["genre"] = _safe_get("genre")
    tags["year"] = _safe_get("date")
    
    # Lyrics: check common FLAC/Vorbis lyrics keys
    for k in ["lyrics", "unsyncedlyrics", "lyric", "unsynced lyrics"]:
        val = _safe_get(k)
        if val.strip():
            tags["lyrics"] = val
            break
            
    tags["comment"] = _safe_get("comment")
    tags["composer"] = _safe_get("composer")
    # Language: Prioritize full name if available
    lang_val = _safe_get("language")
    full_lang = _safe_get("language_full")
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

    atoms = audio.tags
    
    def _safe_get(k):
        val = atoms.get(k)
        return str(val[0]) if val and isinstance(val, list) and len(val) > 0 else ""

    tags["title"] = _safe_get("\xa9nam")
    tags["artist"] = _safe_get("\xa9ART")
    tags["album"] = _safe_get("\xa9alb")
    tags["genre"] = _safe_get("\xa9gen")
    tags["year"] = _safe_get("\xa9day")
    
    # Lyrics: check common MP4 lyrics keys
    for k in ["\xa9lyr", "lyrics", "desc"]:
        val = _safe_get(k)
        if val.strip():
            tags["lyrics"] = val
            break
            
    tags["comment"] = _safe_get("\xa9cmt")
    tags["composer"] = _safe_get("\xa9wrt")
    # Language: Prioritize full name in freeform atom if available
    lang_val = _safe_get("\xa9lan")
    full_lang_raw = atoms.get("----:com.apple.iTunes:Language", [b""])[0]
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
                        # Handle multi-value tags by joining with "; "
                        val_str = "; ".join(val) if isinstance(val, list) else str(val)
                        
                        if "title" in k:
                            tags["title"] = val_str
                        elif "artist" in k:
                            tags["artist"] = val_str
                        elif "album" in k:
                            tags["album"] = val_str
                        elif "genre" in k:
                            tags["genre"] = val_str
                        elif "date" in k or "year" in k:
                            tags["year"] = val_str
                        elif "composer" in k:
                            tags["composer"] = val_str
                        elif "lyrics" in k:
                            tags["lyrics"] = val_str
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
            
            # Additional check for RIFF INFO in WAV files
            if fmt == "wav":
                try:
                    import mutagen.riff
                    info = mutagen.riff.INFO(filepath)
                    for rk, rv in info.items():
                        rv_str = str(rv[0]) if isinstance(rv, list) and rv else str(rv)
                        if _check_junk(rk) or _check_junk(rv_str):
                            print(f"[scanner] JUNK FOUND in RIFF INFO frame {rk}: {rv_str}")
                            has_junk = True
                            break
                except Exception: pass

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
        from backend.app.services.local_cleaner import pre_clean_tags
        from backend.app.services.discovery_engine import discovery_engine
        
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

        raw_fetched = fetch_raw_tags(filepath)
        import json
        raw_tags_json = json.dumps(raw_fetched.get("tags", {}))

        return {
            "path": filepath,
            "filename": os.path.basename(filepath),
            "title": raw_scanned["title"],
            "artist": raw_scanned["artist"],
            "album": raw_scanned["album"],
            "genre": raw_scanned["genre"],
            "year": raw_scanned["year"],
            "composer": raw_scanned["composer"],
            "duration": round(duration, 2),
            "bitrate": bitrate,
            "has_lyrics": bool(tags.get("lyrics", "").strip()),
            "language": tags.get("language", ""),
            "has_junk": has_junk,
            "format": fmt,
            "lyrics": tags.get("lyrics", ""),
            "comment": raw_scanned["comment"],
            "raw_tags_json": raw_tags_json,
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
                if hasattr(val, 'text'):
                    if isinstance(val.text, list):
                        raw_tags[str(key)] = [str(v) for v in val.text]
                    else:
                        raw_tags[str(key)] = str(val.text)
                elif isinstance(val, list):
                    raw_tags[str(key)] = [str(v) for v in val]
                else:
                    raw_tags[str(key)] = str(val).replace('\x00', '; ')
                    
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
    # Normalize paths: absolute, stripped, no trailing slash
    raw_dirs = [os.path.abspath(d.strip()).rstrip(os.path.sep) 
                for d in music_dirs_str.split('\n') 
                if d.strip() and os.path.isdir(d.strip())]
    
    # Remove duplicates and overlapping paths (e.g., /A and /A/B)
    raw_dirs = sorted(list(set(raw_dirs)))
    directories = []
    for d in raw_dirs:
        if not any(d.startswith(parent + os.path.sep) for parent in directories):
            directories.append(d)
    
    # 1. First pass: count total supported files
    all_files = []
    for directory in directories:
        for root, _, files in os.walk(directory):
            for fname in files:
                if Path(fname).suffix.lower() in SUPPORTED_EXTENSIONS:
                    all_files.append(os.path.join(root, fname))
    
    # 2. De-duplicate files list as absolute paths (safeguard)
    all_files = sorted(list(set(all_files)))
    
    total = len(all_files)
    if total == 0:
        return

    # 2. Second pass: scan and yield
    for i, fpath in enumerate(all_files):
        data = scan_file(fpath)
        yield (i + 1, total, data)
