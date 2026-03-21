"""Fixer engine — orchestrates the 6-step metadata cleaning pipeline."""

import json
import time
import asyncio
from ..database import get_db
from pathlib import Path
from .scanner import scan_file
from .lyrics import fetch_lyrics
from .lyrics_llm import fetch_lyrics_llm
from .tagger import write_tags


STEPS = ["read", "backup", "sanitize", "lyrics", "language", "write"]


async def fix_track(track_id: int, batch_id: str = None, progress_callback=None, clean_filenames: bool = False, lyrics_only: bool = False, local_only: bool = False, filenames_only: bool = False) -> dict:
    """
    Run the full Fixer pipeline on a single track with precision stage timing.
    """
    if filenames_only:
        local_only = True
        clean_filenames = True
    db = await get_db()
    stage_start = time.time()
    
    async def notify(step: str, status: str, msg: str = ""):
        nonlocal stage_start
        duration = 0.0
        if status == "done" or status == "error":
            duration = time.time() - stage_start
        
        if progress_callback:
            await progress_callback(track_id, step, status, msg, duration)
            
        if status == "done":
            stage_start = time.time() # Reset for next stage

    # Fetch track from DB
    cursor = await db.execute("SELECT * FROM tracks WHERE id = ?", (track_id,))
    row = await cursor.fetchone()
    if not row:
        await notify("read", "error", "Track not found in database")
        return {"success": False, "error": "Track not found"}

    track_path = row["path"]
    track_name = row["filename"]

    try:
        start_time = time.time()
        stage_start = time.time() # First stage start

        # ── Step 1: READ ──
        await notify("read", "running")
        file_data = scan_file(track_path)
        if not file_data:
            await notify("read", "error", "Could not read audio file")
            return {"success": False, "error": "Could not read file"}

        original_tags = {
            "title": file_data.get("title", ""),
            "artist": file_data.get("artist", ""),
            "album": file_data.get("album", ""),
            "genre": file_data.get("genre", ""),
            "year": file_data.get("year", ""),
            "comment": file_data.get("comment", ""),
            "lyrics": file_data.get("lyrics", ""),
            "composer": file_data.get("composer", ""),
        }
        
        # Capture raw tags for Deep Cleaning
        from mutagen import File as MutagenFile
        try:
            audio_file = MutagenFile(track_path)
        except Exception as e:
            if "can't sync to MPEG frame" in str(e):
                from mutagen.id3 import ID3
                try: audio_file = ID3(track_path)
                except: audio_file = None
            else:
                audio_file = None
        
        all_text_tags = {}
        JUNK_TAG_PATTERNS = [
            "Acoustid", "MusicBrainz", "UFID", "PRIV", "MCDI", "TLEN",
            "TSRC", "TSSE", "TXXX:Acoustid", "TXXX:MusicBrainz",
            "fingerprint", "barcode"
        ]
        
        tags_obj = getattr(audio_file, "tags", audio_file)
        if tags_obj and hasattr(tags_obj, "items"):
            for k, v in tags_obj.items():
                if k.startswith("APIC") or k == "covr": continue
                if any(p.lower() in k.lower() for p in JUNK_TAG_PATTERNS): continue
                
                # Filter out obvious placeholders so LLM isn't lazy
                val_str = str(v[0]) if isinstance(v, list) and v else str(v)
                low_val = val_str.lower()
                if any(x in low_val for x in ["unknown artist", "unknown genre", "unknown album", "various artist"]):
                    continue
                
                all_text_tags[k] = val_str
        
        from .local_cleaner import pre_clean_tags
        raw_before = dict(all_text_tags)
        pre_cleaned_tags = pre_clean_tags(all_text_tags)
        pre_cleaned_original = pre_clean_tags(original_tags)
        
        tags_to_sanitize = {**pre_cleaned_original, **pre_cleaned_tags}
        tags_to_sanitize["current_filename"] = track_name
        tags_to_sanitize["parent_folder"] = Path(track_path).parent.name
        
        await notify("read", "done")

        # ── Step 2: BACKUP ──
        await notify("backup", "running")
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        cursor = await db.execute(
            """INSERT INTO tag_history (track_id, track_path, original_tags, changed_tags, timestamp, batch_id, raw_before)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (track_id, track_path, json.dumps(original_tags), "{}", timestamp, batch_id, json.dumps(raw_before)),
        )
        history_id = cursor.lastrowid
        await db.commit()
        await notify("backup", "done")

        if not lyrics_only and not local_only:
            # ── Step 3: SANITIZE ──
            await notify("sanitize", "running", "Performing forensic identification...")
            from .master_llm import process_song_full
            async def on_master_retry(wait_time):
                await notify("sanitize", "waiting", f"Rate limited. Retrying in {int(wait_time)}s...")

            try:
                master_result = await process_song_full(
                    tags=tags_to_sanitize,
                    filename=track_name,
                    parent_folder=Path(track_path).parent.name,
                    force_lyrics=True,
                    on_retry=on_master_retry
                )
            except Exception as e:
                # Log the error and notify user, then stop for this track
                print(f"[fixer] AI Stage Failed for '{track_name}': {e}")
                await notify("sanitize", "error", f"AI Error: {str(e)}")
                return {"success": False, "error": str(e)}
            
            discovery_result = master_result.get("metadata", {})
            # Merge AI results OVER local pre-cleaned results
            current_result = dict(pre_cleaned_tags)
            current_result.update(discovery_result)
            
            # CRITICAL: Re-clean AFTER the AI merge! 
            # This prevents the AI from re-injecting junk it found during its search.
            cleaned_result = pre_clean_tags(current_result)
            
            language = master_result.get("language", "Undetermined")
            suggested_filename = master_result.get("suggested_filename")
            llm_lyrics_found = master_result.get("lyrics", "")

            INTERNAL_KEYS = {
                "current_filename", "parent_folder", "acoustid_id", "acoustid_fingerprint",
                "musicbrainz_trackid", "musicbrainz_albumid", "musicbrainz_artistid",
                "musicbrainz_albumartistid", "musicbrainz_releasegroupid",
                "fingerprint", "barcode", "TXXX:Acoustid", "TXXX:MusicBrainz",
                "isrc", "tsrc", "tsse", # Filter these specific site-prone tags as well
            }
            # Final filter for keys we don't want to persist from AI
            cleaned_tags = {k: v for k, v in cleaned_result.items() if k.lower() not in {ik.lower() for ik in INTERNAL_KEYS}}
            await notify("sanitize", "done")
        else:
            msg = "Fix filenames only" if filenames_only else ("Skipped in lyrics-only mode" if lyrics_only else "Local standardization only")
            await notify("sanitize", "done", msg)
            cleaned_tags = pre_cleaned_tags
            
            # Local Suggested Filename Generator
            suggested_filename = None
            if clean_filenames:
                from .tagger import _flatten_tag
                # Prioritize cleaned tags if available, else original
                title = cleaned_tags.get("title") or original_tags.get("title")
                artist = cleaned_tags.get("artist") or original_tags.get("artist")
                
                if title and artist:
                    suggested_filename = f"{_flatten_tag(title)} - {_flatten_tag(artist)}"
                elif title:
                    suggested_filename = _flatten_tag(title)
                elif artist:
                    suggested_filename = f"Unknown - {_flatten_tag(artist)}"
            
            llm_lyrics_found = ""
            language = row["language"] or ""

        # ── Step 4: LYRICS ──
        if not local_only:
            await notify("lyrics", "running", "Fetching lyrics...")
            lyrics = await fetch_lyrics(
                artist=cleaned_tags.get("artist", ""),
                title=cleaned_tags.get("title", ""),
                album=cleaned_tags.get("album", ""),
                duration=file_data.get("duration", 0),
            )
                
            if not lyrics or not lyrics.strip():
                if llm_lyrics_found and "LYRICS_NOT_FOUND" not in llm_lyrics_found:
                    lyrics = llm_lyrics_found
                elif not lyrics_only:
                    lyrics = await fetch_lyrics_llm(
                        artist=cleaned_tags.get("artist", ""),
                        title=cleaned_tags.get("title", ""),
                        album=cleaned_tags.get("album", ""),
                    )
            await notify("lyrics", "done")
        else:
            await notify("lyrics", "done", "Skipped (Local only)")
            lyrics = original_tags.get("lyrics", "")

        # ── Step 5: LANGUAGE ──
        await notify("language", "done")

        # ── Step 6: WRITE ──
        await notify("write", "running")
        final_path = track_path
        if clean_filenames and suggested_filename:
            try:
                sanitized_name = "".join(c for c in suggested_filename if c not in r'\/:*?"<>|').strip()
                ext = Path(track_path).suffix
                if sanitized_name.lower().endswith(ext.lower()):
                    sanitized_name = sanitized_name[:-len(ext)].strip()
                new_name = sanitized_name + ext
                new_path = Path(track_path).parent / new_name
                
                if str(new_path).lower() != track_path.lower():
                    import shutil
                    counter = 1
                    actual_new_path = new_path
                    while actual_new_path.exists() and str(actual_new_path).lower() != track_path.lower():
                        actual_new_path = Path(track_path).parent / f"{sanitized_name} ({counter}){ext}"
                        counter += 1
                    
                    if str(actual_new_path).lower() != track_path.lower():
                        shutil.move(track_path, str(actual_new_path))
                        final_path = str(actual_new_path)
                        await db.execute("UPDATE tracks SET path = ?, filename = ? WHERE id = ?", (final_path, Path(final_path).name, track_id))
                        await db.commit()
            except Exception as e:
                print(f"[fixer] Rename failed: {e}")

        # Filter and write
        IGNORE_KEYS = {"has_junk", "has_lyrics", "last_scanned", "path", "filename", "duration", "suggested_filename", "current_filename", "parent_folder", "discovery_result", "research_context"}
        tags_to_write = {k: v for k, v in cleaned_tags.items() if k not in IGNORE_KEYS}
        success = write_tags(final_path, tags_to_write, lyrics, language, raw_tags=tags_to_write)
        if not success:
            await notify("write", "error", "Failed to write tags")
            return {"success": False, "error": "Write failed"}

        # Extract a fresh audit of raw tags from disk after the write 
        # to ensure the history diff is 100% accurate
        from .scanner import fetch_raw_tags
        raw_after_audit = fetch_raw_tags(final_path)["tags"]

        duration = time.time() - start_time
        
        # We need to unify the cleaned_tags for the "summary" view in history
        # Since cleaned_tags may contain raw Mutagen keys (like TIT2)
        from .local_cleaner import pre_clean_tags
        final_summary = scan_file(final_path) # Most reliable way to get unified fields
        
        changed_tags = {
            "title": final_summary.get("title", ""),
            "artist": final_summary.get("artist", ""),
            "album": final_summary.get("album", ""),
            "genre": final_summary.get("genre", ""),
            "year": final_summary.get("year", ""),
            "comment": final_summary.get("comment", ""),
            "lyrics": lyrics[:200] + "..." if len(lyrics) > 200 else lyrics,
            "language": language,
            "composer": final_summary.get("composer", ""),
        }
        
        await db.execute(
            "UPDATE tag_history SET changed_tags = ?, raw_after = ?, duration_seconds = ? WHERE id = ?",
            (json.dumps(changed_tags), json.dumps(raw_after_audit), duration, history_id),
        )

        fix_type = 'rename' if filenames_only else ('local' if local_only else ('lyrics' if lyrics_only else 'llm'))
        count_field = "local_fix_count" if (local_only or filenames_only) else "llm_fix_count"

        await db.execute(
            f"""UPDATE tracks SET
                title = ?, artist = ?, album = ?, genre = ?, year = ?, composer = ?,
                has_lyrics = ?, lyrics = ?, language = ?, has_junk = 0, last_scanned = ?,
                path = ?, filename = ?,
                {count_field} = {count_field} + 1, last_fix_type = ?,
                last_fixed_at = ?, last_ai_fix_duration = ?
               WHERE id = ?""",
            (
                final_summary.get("title", ""),
                final_summary.get("artist", ""),
                final_summary.get("album", ""),
                final_summary.get("genre", ""),
                final_summary.get("year", ""),
                final_summary.get("composer", ""),
                1 if final_summary.get("has_lyrics") else 0,
                "", # Stop saving lyrics to DB
                language,
                time.strftime("%Y-%m-%d %H:%M:%S"),
                final_path,
                Path(final_path).name,
                fix_type,
                time.strftime("%Y-%m-%d %H:%M:%S"),
                duration,
                track_id
            ),
        )
        await db.commit()
        await notify("write", "done")

        return {"success": True, "track_id": track_id, "track_name": Path(final_path).name, "language": language, "has_lyrics": bool(lyrics.strip()), "duration": duration}

    except Exception as e:
        await notify("write", "error", str(e))
        return {"success": False, "error": str(e)}


async def revert_track(history_id: int) -> dict:
    """Revert tags to original state."""
    db = await get_db()
    cursor = await db.execute("SELECT * FROM tag_history WHERE id = ?", (history_id,))
    row = await cursor.fetchone()
    if not row or row["reverted"]: return {"success": False, "error": "Invalid history entry"}

    track_path = row["track_path"]
    original_tags = json.loads(row["original_tags"])
    lyrics = original_tags.pop("lyrics", "")
    if not write_tags(track_path, original_tags, lyrics): return {"success": False, "error": "Revert failed"}

    await db.execute("UPDATE tag_history SET reverted = 1 WHERE id = ?", (history_id,))
    file_data = scan_file(track_path)
    if file_data:
        await db.execute("UPDATE tracks SET title = ?, artist = ?, album = ?, genre = ?, year = ?, composer = ?, has_lyrics = ?, language = '', has_junk = ?, last_scanned = ? WHERE path = ?", (file_data["title"], file_data["artist"], file_data["album"], file_data["genre"], file_data["year"], file_data["composer"], 1 if file_data["has_lyrics"] else 0, 1 if file_data["has_junk"] else 0, file_data["last_scanned"], track_path))
    await db.commit()
    return {"success": True, "message": "Reverted"}
