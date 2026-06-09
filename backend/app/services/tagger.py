"""Tag writer — writes cleaned metadata back to audio files using mutagen."""

from pathlib import Path
from mutagen import File as MutagenFile
from mutagen.id3 import ID3, TIT2, TPE1, TALB, TCON, TDRC, USLT, TLAN, COMM, TCOM, TXXX, TextFrame, SYLT
from mutagen.flac import FLAC
from mutagen.mp4 import MP4
from mutagen.wave import WAVE
import traceback
import re
import os
import shutil
import struct


import json
import ast
import datetime

def _log(msg):
    """Log to a file in the data directory for debugging. Silenced in production."""
    try:
        from backend.app.config import settings
        if settings.ENV == "production":
            return  # No debug logs in production
        import os
        log_path = os.path.join(settings.DATA_DIR, "tagger_debug.log")
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(log_path, "a") as f:
            f.write(f"[{timestamp}] {msg}\n")
    except Exception:
        pass

def _flatten_tag(val):
    """Recursively flatten nested stringified lists and ensure string output for scalars."""
    if val is None:
        return ""
    
    if isinstance(val, list):
        if len(val) > 0:
            return _flatten_tag(val[0])
        return ""

    if not isinstance(val, (str, bytes)):
        return str(val)
    
    if isinstance(val, bytes):
        try: return val.decode('utf-8')
        except: return str(val)

    # Try to parse as JSON or Python list if it looks like one
    if val.startswith('[') and val.endswith(']'):
        try:
            # First try standard JSON
            parsed = json.loads(val.replace("'", '"'))
            if isinstance(parsed, list):
                return _flatten_tag(parsed)
        except Exception:
            try:
                # Fallback to literal_eval for Python-style lists
                import ast
                parsed = ast.literal_eval(val)
                if isinstance(parsed, list):
                    return _flatten_tag(parsed)
            except Exception:
                pass
    return val

def _parse_lrc_to_sylt(lrc_text):
    """Parse LRC format string into a list of (text, timestamp_ms) for SYLT."""
    if not lrc_text:
        return []
    
    entries = []
    # Standard LRC line: [mm:ss.xx] Lyrics
    # Also handles multiple tags: [mm:ss.xx][mm:ss.yy] Lyrics
    pattern = re.compile(r'\[(\d+):(\d+(?:\.\d+)?)\]')
    
    for line in lrc_text.splitlines():
        line = line.strip()
        if not line:
            continue
            
        timestamps = pattern.findall(line)
        if not timestamps:
            continue
            
        # Text is everything after the last ]
        text = re.sub(r'\[\d+:\d+(?:\.\d+)?\]', '', line).strip()
        
        for m, s in timestamps:
            try:
                ms = int(int(m) * 60000 + float(s) * 1000)
                entries.append((text, ms))
            except Exception:
                continue
            
    # SYLT requires sorting by time
    entries.sort(key=lambda x: x[1])
    return entries

REVERSE_LANG_MAP = {
    "eng": "English", "spa": "Spanish", "fra": "French", "deu": "German",
    "ita": "Italian", "por": "Portuguese", "jpn": "Japanese", "kor": "Korean",
    "zho": "Chinese", "hin": "Hindi", "ara": "Arabic", "rus": "Russian",
    "tam": "Tamil", "mal": "Malayalam", "tel": "Telugu", "kan": "Kannada",
    "en": "English", "es": "Spanish", "fr": "French", "de": "German", "ta": "Tamil"
}

def _get_full_lang(lang: str) -> str:
    if not lang: return ""
    l = lang.lower()
    return REVERSE_LANG_MAP.get(l, lang.capitalize() if len(lang) > 3 else lang)

import mutagen
from mutagen.id3 import TCON

def append_language_genre(file_path, language_word):
    """Universally appends a language as a strict secondary genre array element."""
    try:
        audio = mutagen.File(file_path)
        if audio is None or audio.tags is None:
            _log(f"Append Language: Un-taggable or corrupted file {file_path}")
            return False

        tags = audio.tags
        tag_type = type(tags).__name__

        # 1. MP3 and WAV (ID3 Tags)
        if tag_type == 'ID3':
            existing = tags.getall("TCON")
            genre_list = existing[0].text if existing else []
            if language_word not in genre_list:
                genre_list.append(language_word)
            # encoding=3 ensures utf-8 and safe multi-value null byte separators
            tags.add(TCON(encoding=3, text=genre_list))

        # 2. AAC / M4A / MP4 (Apple iTunes Tags)
        elif tag_type == 'MP4Tags':
            genre_list = tags.get('\xa9gen', [])
            if language_word not in genre_list:
                genre_list.append(language_word)
            tags['\xa9gen'] = genre_list

        # 3. FLAC / Ogg / OPUS (Vorbis Comments)
        else: 
            # Vorbis is a case-insensitive multi-dict
            genre_list = tags.get('genre', [])
            if language_word not in genre_list:
                genre_list.append(language_word)
            tags['genre'] = genre_list

        audio.save()
        return True
    except Exception as e:
        _log(f"Error appending native language genre to {file_path}: {e}")
        return False

def write_tags(filepath: str, tags: dict, lyrics: str = "", language: str = "", raw_tags: dict = None) -> bool:
    """
    Write metadata back to an audio file.

    Args:
        filepath: Path to the audio file.
        tags: Dict with keys: title, artist, album, genre, year, comment, composer.
        lyrics: Lyrics text to embed.
        language: ISO 639-1 language code.
        raw_tags: Dict of raw tag keys and values to write directly.

    Returns:
        True on success, False on failure.
    """
    try:
        ext = Path(filepath).suffix.lower()
        
        # Flatten lyrics if passed as a list accidentally
        if isinstance(lyrics, list):
            lyrics = "\n".join(str(l) for l in lyrics if l)
        elif not isinstance(lyrics, (str, bytes)) and lyrics is not None:
            lyrics = str(lyrics)

        if ext == ".mp3":
            return _write_id3(filepath, tags, lyrics, language, raw_tags)
        elif ext == ".flac":
            return _write_flac(filepath, tags, lyrics, language, raw_tags)
        elif ext in (".m4a", ".mp4"):
            return _write_mp4(filepath, tags, lyrics, language, raw_tags)
        elif ext == ".wav":
            return _write_wav(filepath, tags, lyrics, language, raw_tags)
        else:
            return _write_generic(filepath, tags, lyrics, language, raw_tags)
    except Exception as e:
        print(f"[tagger] CRITICAL: Error writing tags to {filepath}")
        print(f"[tagger] Exception: {e}")
        _log(f"CRITICAL WRITE ERROR: {filepath} - {e}")
        import traceback
        traceback.print_exc()
        return False


ID3_LANG_MAP = {
    "english": "eng", "spanish": "spa", "french": "fra", "german": "deu",
    "italian": "ita", "portuguese": "por", "japanese": "jpn", "korean": "kor",
    "chinese": "zho", "hindi": "hin", "arabic": "ara", "russian": "rus",
    "tamil": "tam", "malayalam": "mal", "telugu": "tel", "kannada": "kan",
    "en": "eng", "es": "spa", "fr": "fra", "de": "deu", "ta": "tam"
}

def _get_lang_code(lang: str) -> str:
    """Map language string to ISO 639-2 (3 chars) for internal frames (USLT/COMM)."""
    if not lang:
        return "und"
    l = lang.lower()
    if len(l) == 3:
        return l
    return ID3_LANG_MAP.get(l, "und")

def _apply_id3_frames(id3: ID3, tags: dict, lyrics: str, language: str, raw_tags: dict, filepath: str):
    """Core logic to apply ID3 frames to an ID3 object."""
    # 0. Universal Purge of Hidden Technical / Junk Tracking Frames
    junk_patterns = ["musicbrainz", "acoustid", "fingerprint", "barcode", "ufid", "priv", "mcdi", "tlen", "tsrc", "tsse", "tenc"]
    keys_to_delete = []
    for k in id3.keys():
        if any(p in k.lower() for p in junk_patterns):
            keys_to_delete.append(k)
    for k in keys_to_delete:
        try:
            del id3[k]
        except Exception:
            pass

    # 1. Apply standard mapped tags
    if tags.get("title") is not None:
        id3["TIT2"] = TIT2(encoding=3, text=[_flatten_tag(tags["title"])])
    if tags.get("artist") is not None:
        id3["TPE1"] = TPE1(encoding=3, text=[_flatten_tag(tags["artist"])])
    if tags.get("album") is not None:
        id3["TALB"] = TALB(encoding=3, text=[_flatten_tag(tags["album"])])
    if tags.get("genre") is not None:
        genres = tags["genre"]
        if isinstance(genres, list):
            # Mutagen's TCON text expects a list of exact strings (ID3 handles multi separator logic)
            id3["TCON"] = TCON(encoding=3, text=[_flatten_tag(g) for g in genres])
        else:
            # Fallback for generic string
            id3["TCON"] = TCON(encoding=3, text=[_flatten_tag(genres)])
    if tags.get("year") is not None:
        id3["TDRC"] = TDRC(encoding=3, text=[_flatten_tag(tags["year"])])
    if tags.get("composer") is not None:
        id3["TCOM"] = TCOM(encoding=3, text=[_flatten_tag(tags["composer"])])
    
    lang_code = _get_lang_code(language)
    if language:
        # 1. Standard: 3-letter ISO code for maximum player compatibility
        id3["TLAN"] = TLAN(encoding=3, text=[lang_code])
        
        # 2. Friendly: Full word preserved in a custom frame
        if len(language) > 3:
            id3.add(TXXX(encoding=3, desc="Language", text=[language]))
    
    if lyrics is not None:
        # Update both Synchronized (SYLT) and Unsynchronized (USLT) frames.
        # This ensures maximum compatibility across all players.
        id3.delall("USLT")
        id3.delall("SYLT")
        
        if lyrics:
            # 1. Try to write SYLT (Synchronized) for LRC-capable players
            sylts = _parse_lrc_to_sylt(lyrics)
            if sylts:
                # encoding=3 (UTF-8), type=1 (Lyrics), format=2 (Milliseconds)
                id3.add(SYLT(encoding=3, lang=lang_code, desc="", type=1, format=2, text=sylts))
            
            # 2. Always write USLT (Unsynchronized) for standard players.
            # This contains the raw string (either plain text or LRC format).
            id3.add(USLT(encoding=3, lang=lang_code, desc="", text=lyrics))

    if tags.get("comment") is not None:
        id3.delall("COMM")
        if tags["comment"]:
            id3.add(COMM(encoding=3, lang=lang_code, desc="", text=[tags["comment"]]))

    # 2. Apply arbitrary raw tags
    if raw_tags:
        HUMAN_KEYS = {"title", "artist", "album", "genre", "year", "composer", "comment", "language", "suggested_filename"}
        STANDARD_FRAMES = {"TIT2", "TPE1", "TALB", "TCON", "TDRC", "TCOM", "TLAN", "USLT", "COMM"}
        
        for key, val in raw_tags.items():
            # If we're writing a new value, skip standard mapped frames to avoid double-writes
            # But if we're DELETING (val is empty), allow purging standard frames too!
            is_deletion = val == "" or val == [] or val is None
            if not is_deletion:
                if key in HUMAN_KEYS or any(key.startswith(s) for s in STANDARD_FRAMES):
                    continue
            
            # Skip binary data placeholders
            if val == "__ALBUM_ART__":
                continue
            
            if val == "" or val == [] or val is None:
                try:
                    if key in id3:
                        del id3[key]
                    else:
                        id3.delall(key.split(":", 1)[0] if ":" in key else key)
                except Exception:
                    pass
                continue

            if key.startswith("TXXX:"):
                desc = key.split(":", 1)[1]
                id3[key] = TXXX(encoding=3, desc=desc, text=[_flatten_tag(v) for v in val] if isinstance(val, list) else [_flatten_tag(val)])
            elif key.startswith("T") and len(key) == 4:
                id3.add(TextFrame(encoding=3, text=[_flatten_tag(v) for v in val] if isinstance(val, list) else [_flatten_tag(val)], frameid=key))
            elif key.startswith("W") and len(key) == 4:
                try:
                    id3[key] = str(_flatten_tag(val))
                except Exception:
                    pass
            elif key.startswith("USLT:") or key.startswith("COMM:"):
                parts = key.split(":", 2)
                frame_type = parts[0]
                lang_raw = parts[1] if len(parts) > 1 else "und"
                lang = _get_lang_code(lang_raw)
                desc = parts[2] if len(parts) > 2 else ""
                val_flat = _flatten_tag(val)
                if val_flat:
                    if frame_type == "USLT":
                        id3[key] = USLT(encoding=3, lang=lang, desc=desc, text=val_flat)
                    else:
                        id3[key] = COMM(encoding=3, lang=lang, desc=desc, text=[val_flat])
            else:
                try:
                    id3[key] = [_flatten_tag(v) for v in val] if isinstance(val, list) else _flatten_tag(val)
                except Exception:
                    pass

def _reencapsulate_mp3(filepath: str) -> bool:
    """
    Re-mux an MP3 file using ffmpeg to fix container synchronization issues.
    This is the 'Nuclear Option' for 'can't sync to MPEG frame' errors.
    """
    import subprocess
    try:
        tmp_path = filepath + ".remux.mp3"
        _log(f"Deep-Reencapsulating MP3: {filepath}")
        
        # -map 0 maps all streams, -c copy copies without re-encoding
        # -id3v2_version 3 ensures standard ID3v2.3 compatibility
        cmd = [
            "ffmpeg", "-y", "-i", filepath, 
            "-map", "0", "-c", "copy", 
            "-id3v2_version", "3", 
            "-write_id3v1", "1",
            tmp_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0 and os.path.exists(tmp_path):
            os.replace(tmp_path, filepath)
            _log(f"MP3 Re-encapsulation SUCCESS: {filepath}")
            return True
        else:
            _log(f"MP3 Re-encapsulation FAILED: {result.stderr}")
            if os.path.exists(tmp_path): os.remove(tmp_path)
            return False
    except Exception as e:
        _log(f"MP3 Re-encapsulation EXCEPTION: {e}")
        return False

def _write_id3(filepath: str, tags: dict, lyrics: str, language: str, raw_tags: dict) -> bool:
    """Write tags using explicit ID3 object (MP3) with sync-error repair."""
    try:
        # Try a normal load first
        try:
            id3 = ID3(filepath)
        except Exception as e:
            if "can't sync to MPEG frame" in str(e):
                _log(f"Sync error detected in {filepath}. Attempting repair...")
                if _reencapsulate_mp3(filepath):
                    id3 = ID3(filepath) # Try again after repair
                else:
                    raise # Rethrow if repair fails
            else:
                _log(f"Falling back to empty ID3 for {filepath} (Error: {e})")
                id3 = ID3()
        
        _apply_id3_frames(id3, tags, lyrics, language, raw_tags, filepath)
        
        # When saving, if we hit a sync error, repair and retry ONE LAST time
        try:
            id3.save(filepath)
        except Exception as e:
            if "can't sync to MPEG frame" in str(e):
                _log(f"Sync error during SAVE for {filepath}. Attempting emergency repair...")
                if _reencapsulate_mp3(filepath):
                    # Re-apply frames to a fresh object after remux
                    id3 = ID3(filepath)
                    _apply_id3_frames(id3, tags, lyrics, language, raw_tags, filepath)
                    id3.save(filepath)
                else:
                    raise
            else:
                raise
                
        return True
    except Exception as e:
        _log(f"ID3 write CRITICAL failure: {e}")
        return False

def _reencapsulate_wav(filepath: str) -> bool:
    """
    Reconstruct a WAV file by keeping only 'fmt ' and 'data' chunks.
    This discards all corrupted/non-standard metadata chunks that cause save failures.
    """
    try:
        _log(f"Deep-Reencapsulating WAV: {filepath}")
        
        fmt_chunk = b""
        data_chunk_header = b""
        data_chunk_pos = 0
        data_chunk_size = 0
        
        with open(filepath, "rb") as f:
            riff_type = f.read(4)
            if riff_type != b"RIFF":
                _log("Not a RIFF file, skipping re-encapsulation")
                return False
            
            f.read(4) # Skip total size
            wave_id = f.read(4)
            if wave_id != b"WAVE":
                _log("Not a WAVE file, skipping re-encapsulation")
                return False
                
            # Scan for required chunks
            while True:
                chunk_id = f.read(4)
                if not chunk_id: break
                try:
                    chunk_size = struct.unpack("<I", f.read(4))[0]
                except Exception: break
                
                if chunk_id == b"fmt ":
                    fmt_chunk = b"fmt " + struct.pack("<I", chunk_size) + f.read(chunk_size)
                    if chunk_size % 2 != 0: f.read(1)
                elif chunk_id == b"data":
                    data_chunk_header = b"data" + struct.pack("<I", chunk_size)
                    data_chunk_pos = f.tell()
                    data_chunk_size = chunk_size
                    f.seek(chunk_size, 1)
                    if chunk_size % 2 != 0: f.read(1)
                else:
                    _log(f"Discarding corrupt/junk chunk: {chunk_id!r} ({chunk_size} bytes)")
                    f.seek(chunk_size, 1)
                    if chunk_size % 2 != 0: f.read(1)

        if not fmt_chunk or not data_chunk_header:
            _log("Required WAVE chunks missing, cannot re-encapsulate")
            return False

        tmp_path = filepath + ".fix-tmp"
        new_riff_size = 4 + len(fmt_chunk) + len(data_chunk_header) + data_chunk_size
        
        with open(tmp_path, "wb") as f_out:
            f_out.write(b"RIFF" + struct.pack("<I", new_riff_size) + b"WAVE")
            f_out.write(fmt_chunk)
            f_out.write(data_chunk_header)
            
            with open(filepath, "rb") as f_in:
                f_in.seek(data_chunk_pos)
                remaining = data_chunk_size
                while remaining > 0:
                    buf = f_in.read(min(remaining, 1024 * 1024))
                    if not buf: break
                    f_out.write(buf)
                    remaining -= len(buf)
            
            if data_chunk_size % 2 != 0:
                f_out.write(b"\x00")
        
        os.replace(tmp_path, filepath)
        _log(f"WAV Re-encapsulation SUCCESS: {filepath}")
        return True
    except Exception as e:
        _log(f"WAV Re-encapsulation FAILED: {e}")
        return False

def _write_wav(filepath: str, tags: dict, lyrics: str, language: str, raw_tags: dict) -> bool:
    """Write ID3 tags to a WAV file for maximum compatibility."""
    from mutagen.wave import WAVE
    
    _log(f"Attempting to write WAV: {filepath}")
    
    def _do_write(path):
        # 1. Write ID3 Tags (Standard and most robust)
        from mutagen.wave import WAVE
        audio = WAVE(path)
        if audio.tags is None:
            audio.add_tags()
        _apply_id3_frames(audio.tags, tags, lyrics, language, raw_tags, path)
        try:
            audio.save(v2_version=4)
        except TypeError:
            audio.save()
        
        # 2. Sync / Purge RIFF INFO (Critical for Windows Explorer and some legacy apps)
        try:
            import mutagen.riff
            info = mutagen.riff.INFO(path)
            
            # Map standard fields
            if tags.get("title") is not None: info["INAM"] = [_flatten_tag(tags["title"])]
            if tags.get("artist") is not None: info["IART"] = [_flatten_tag(tags["artist"])]
            if tags.get("album") is not None: info["IPRD"] = [_flatten_tag(tags["album"])]
            if tags.get("genre") is not None: info["IGNR"] = [_flatten_tag(tags["genre"])]
            if tags.get("year") is not None: info["ICRD"] = [_flatten_tag(tags["year"])]
            if tags.get("comment") is not None: info["ICMT"] = [_flatten_tag(tags["comment"])]
            if tags.get("composer") is not None: info["IMUS"] = [_flatten_tag(tags["composer"])]
            
            # AGGRESSIVE PURGE: Delete any RIFF INFO key that matches junk
            from backend.app.services.scanner import _check_junk
            keys_to_del = []
            for riff_k, riff_v in info.items():
                v_str = str(riff_v[0]) if isinstance(riff_v, list) and riff_v else str(riff_v)
                if _check_junk(riff_k) or _check_junk(v_str):
                    keys_to_del.append(riff_k)
            for rk in keys_to_del:
                del info[rk]
                
            info.save()
            _log("RIFF INFO tags synced and purged")
        except Exception as e:
            _log(f"RIFF INFO sync warning: {e}")
            pass
            
    # ── Try 1: Standard write ──
    try:
        _do_write(filepath)
        # Verify persistence (Standard mutagen check)
        audio_check = WAVE(filepath)
        if audio_check.tags:
            _log("WAVE write persistence verified (ID3)")
            return True
        else:
            _log("WAVE write technically succeeded but NO tags persisted. Escalating to Deep Repair...")
    except Exception as e:
        _log(f"Standard WAVE write failed: {e}. Escalating to Deep Repair...")
        
    # ── Try 2: Deep Re-encapsulation (The Silver Bullet) ──
    if _reencapsulate_wav(filepath):
        try:
            _do_write(filepath)
            _log("WAVE write success after Deep Repair")
            return True
        except Exception as e:
            _log(f"WAVE write still failed after Deep Repair: {e}")
        
    # ── Try 3: Direct ID3 write (Final Fallback) ──
    try:
        from mutagen.id3 import ID3
        id3 = ID3(filepath)
        _apply_id3_frames(id3, tags, lyrics, language, raw_tags, filepath)
        id3.save(filepath, v2_version=3) # Force 2.3 for maximum compatibility
        _log("ID3 fallback success")
        return True
    except Exception as e2:
        _log(f"ID3 fallback failed: {e2}")
        return False
    return False


def _write_flac(filepath: str, tags: dict, lyrics: str, language: str, raw_tags: dict) -> bool:
    """Write tags to a FLAC file."""
    audio = FLAC(filepath)
    if audio.tags is None:
        audio.add_tags()

    # 0. Universal Purge of Hidden Technical / Junk Tracking Frames
    junk_patterns = ["musicbrainz", "acoustid", "fingerprint", "barcode", "ufid", "priv", "mcdi", "tlen", "tsrc", "tsse", "tenc"]
    keys_to_delete = []
    for k in audio.tags.keys():
        if any(p in k.lower() for p in junk_patterns):
            keys_to_delete.append(k)
    for k in keys_to_delete:
        try:
            del audio.tags[k]
        except Exception:
            pass

    # 1. Standard tags
    if tags.get("title") is not None: audio["title"] = _flatten_tag(tags["title"])
    if tags.get("artist") is not None: audio["artist"] = _flatten_tag(tags["artist"])
    if tags.get("album") is not None: audio["album"] = _flatten_tag(tags["album"])
    if tags.get("genre") is not None:
        genres = tags["genre"]
        if isinstance(genres, list):
            # FLAC uses list natively for multi-tags
            audio["genre"] = [_flatten_tag(g) for g in genres]
        else:
            audio["genre"] = [_flatten_tag(genres)]
    if tags.get("year") is not None: audio["date"] = _flatten_tag(tags["year"])
    if tags.get("composer") is not None: audio["composer"] = _flatten_tag(tags["composer"])
    lang_code = _get_lang_code(language)
    if language is not None:
        # 1. Standard: 3-letter code
        audio["language"] = lang_code
        # 2. Friendly: Full word
        if len(language) > 3:
            audio["language_full"] = _flatten_tag(language)
    
    if lyrics is not None:
        # User requested strictly 'LYRICS' (all caps).
        for k in ["lyrics", "unsyncedlyrics", "lyric"]:
            if k in audio.tags:
                del audio.tags[k]
        if lyrics:
            # We use the standard dict interface which mutagen handles safely
            audio.tags["LYRICS"] = lyrics
    if tags.get("comment") is not None: audio["comment"] = _flatten_tag(tags["comment"])

    # 2. Raw tags (Vorbis comments are easy)
    if raw_tags:
        standard_keys = {"title", "artist", "album", "genre", "date", "composer", "language", "lyrics", "comment"}
        ID3_SYNONYMS = {"TIT2", "TPE1", "TALB", "TCON", "TDRC", "TCOM", "TLAN", "USLT", "COMM"}
        for key, val in raw_tags.items():
            # If we're writing a new value, skip standard mapped frames to avoid double-writes
            # But if we're DELETING (val is empty), allow purging standard frames too!
            is_deletion = val == "" or val == [] or val is None
            if not is_deletion:
                if key.lower() in standard_keys or key in ID3_SYNONYMS or key == "suggested_filename":
                    continue
            
            # Skip binary data placeholders
            if val == "__ALBUM_ART__":
                continue
            
            # Robust Deletion
            if val == "" or val == [] or val is None:
                if key in audio:
                    del audio[key]
                continue
                
            try:
                audio[key] = [_flatten_tag(v) for v in val] if isinstance(val, list) else _flatten_tag(val)
            except Exception as e:
                print(f"[tagger] Warning: Could not write Vorbis comment {key}: {e}")

    audio.save()
    return True


def _write_mp4(filepath: str, tags: dict, lyrics: str, language: str, raw_tags: dict) -> bool:
    """Write tags to an MP4/M4A file."""
    audio = MP4(filepath)
    if audio.tags is None:
        audio.add_tags()

    # 0. Universal Purge of Hidden Technical / Junk Tracking Frames
    junk_patterns = ["musicbrainz", "acoustid", "fingerprint", "barcode", "ufid", "priv", "mcdi", "tlen", "tsrc", "tsse", "tenc"]
    keys_to_delete = []
    for k in audio.tags.keys():
        if any(p in k.lower() for p in junk_patterns):
            keys_to_delete.append(k)
    for k in keys_to_delete:
        try:
            del audio.tags[k]
        except Exception:
            pass

    # 1. Standard atoms (Fall back to direct mp4 keys if standard mapped keys are missing)
    v_title = tags.get("title") if tags.get("title") is not None else raw_tags.get("\xa9nam")
    if v_title is not None: audio["\xa9nam"] = [_flatten_tag(v_title)]
    
    v_art = tags.get("artist") if tags.get("artist") is not None else raw_tags.get("\xa9ART")
    if v_art is not None: audio["\xa9ART"] = [_flatten_tag(v_art)]
    
    v_alb = tags.get("album") if tags.get("album") is not None else raw_tags.get("\xa9alb")
    if v_alb is not None: audio["\xa9alb"] = [_flatten_tag(v_alb)]
    
    v_gen = tags.get("genre") if tags.get("genre") is not None else raw_tags.get("\xa9gen")
    if v_gen is not None:
        if isinstance(v_gen, list):
            audio["\xa9gen"] = [_flatten_tag(g) for g in v_gen]
        else:
            audio["\xa9gen"] = [_flatten_tag(v_gen)]
            
    v_yr = tags.get("year") if tags.get("year") is not None else raw_tags.get("\xa9day")
    if v_yr is not None: audio["\xa9day"] = [_flatten_tag(v_yr)]
    
    if lyrics is not None:
        for k in ["\xa9lyr", "lyrics"]:
            if k in audio:
                del audio[k]
        if lyrics:
            audio["\xa9lyr"] = [lyrics]
            
    if language is not None: 
        lang_code = _get_lang_code(language)
        audio["\xa9lan"] = [lang_code]
        if len(language) > 3:
            audio["----:com.apple.iTunes:Language"] = [language.encode('utf-8')]
            
    v_comp = tags.get("composer") if tags.get("composer") is not None else raw_tags.get("\xa9wrt")
    if v_comp is not None: audio["\xa9wrt"] = [_flatten_tag(v_comp)]
    
    v_cmt = tags.get("comment") if tags.get("comment") is not None else raw_tags.get("\xa9cmt")
    if v_cmt is not None: audio["\xa9cmt"] = [_flatten_tag(v_cmt)]

    # 2. Raw atoms
    if raw_tags:
        standard_keys = {"\xa9nam", "\xa9ART", "\xa9alb", "\xa9gen", "\xa9day", "\xa9lyr", "\xa9lan", "\xa9wrt", "\xa9cmt"}
        ID3_SYNONYMS = {"TIT2", "TPE1", "TALB", "TCON", "TDRC", "TCOM", "TLAN", "USLT", "COMM"}
        for key, val in raw_tags.items():
            # If we're writing a new value, skip standard mapped frames to avoid double-writes
            # But if we're DELETING (val is empty), allow purging standard frames too!
            is_deletion = val == "" or val == [] or val is None
            if not is_deletion:
                if key in standard_keys or key in ID3_SYNONYMS or key == "suggested_filename":
                    continue

            # Skip binary data placeholders
            if val == "__ALBUM_ART__" or key == "stik":
                continue
            
            # Robust Deletion
            if val == "" or val == [] or val is None or val == "b''":
                if key in audio:
                    del audio[key]
                continue
                
            try:
                if key.startswith("----"):
                    # Handle raw byte lists natively
                    if isinstance(val, list):
                        safe_val = []
                        for v in val:
                            vf = _flatten_tag(v)
                            # Remove literal b'' encapsulation from stringified repr
                            if vf.startswith("b'") and vf.endswith("'"): vf = vf[2:-1]
                            if vf: safe_val.append(vf.encode("utf-8"))
                        if not safe_val:
                            if key in audio: del audio[key]
                        else:
                            audio[key] = safe_val
                    else:
                        vf = _flatten_tag(val)
                        if vf.startswith("b'") and vf.endswith("'"): vf = vf[2:-1]
                        if vf:
                            audio[key] = [vf.encode("utf-8")]
                        elif key in audio:
                            del audio[key]
                else:
                    audio[key] = [_flatten_tag(v) for v in val] if isinstance(val, list) else [_flatten_tag(val)]
            except Exception as e:
                print(f"[tagger] Warning: Could not write MP4 atom {key}: {e}")

    audio.save()
    return True


def _write_generic(filepath: str, tags: dict, lyrics: str, language: str, raw_tags: dict) -> bool:
    """Best-effort write for other formats (Vorbis-based)."""
    audio = MutagenFile(filepath)
    if audio is None: return False
    if audio.tags is None:
        try: audio.add_tags()
        except Exception: return False

    if tags.get("title") is not None: audio["title"] = [_flatten_tag(tags["title"])]
    if tags.get("artist") is not None: audio["artist"] = [_flatten_tag(tags["artist"])]
    if tags.get("album") is not None: audio["album"] = [_flatten_tag(tags["album"])]
    if tags.get("genre") is not None:
        genres = tags["genre"]
        if isinstance(genres, list):
            audio["genre"] = [_flatten_tag(g) for g in genres]
        else:
            audio["genre"] = [_flatten_tag(genres)]
    if tags.get("year") is not None: audio["date"] = [_flatten_tag(tags["year"])]

    if raw_tags:
        for key, val in raw_tags.items():
            audio[key] = [_flatten_tag(v) for v in val] if isinstance(val, list) else [_flatten_tag(val)]

    audio.save()
    return True
