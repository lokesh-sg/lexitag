"""Fixer engine — orchestrates the 6-step metadata cleaning pipeline."""

import json
import time
import asyncio
from backend.app.database import get_db
from pathlib import Path
from backend.app.services.scanner import scan_file
from backend.app.services.lyrics import fetch_lyrics
from backend.app.services.lyrics_llm import fetch_lyrics_llm
from backend.app.services.tagger import write_tags


STEPS = ["read", "backup", "sanitize", "lyrics", "language", "write"]


async def fix_track(track_id: int, batch_id: str = None, progress_callback=None, clean_filenames: bool = False, lyrics_only: bool = False, local_only: bool = False, filenames_only: bool = False, language_only: bool = False) -> dict:
    """
    Run the full Fixer pipeline on a single track with precision stage timing.
    """
    if language_only:
        local_only = True
        clean_filenames = False
    elif filenames_only:
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

        row_dict = dict(row) if row else {}
        original_tags = {
            "title": file_data.get("title") or row_dict.get("title", "") or "",
            "artist": file_data.get("artist") or row_dict.get("artist", "") or "",
            "album": file_data.get("album") or row_dict.get("album", "") or "",
            "genre": file_data.get("genre") or row_dict.get("genre", "") or "",
            "year": file_data.get("year") or row_dict.get("year", "") or "",
            "comment": file_data.get("comment") or row_dict.get("comment", "") or "",
            "lyrics": file_data.get("lyrics") or row_dict.get("lyrics", "") or "",
            "language": file_data.get("language") or row_dict.get("language", "") or "",
            "composer": file_data.get("composer") or row_dict.get("composer", "") or "",
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
        
        from backend.app.services.local_cleaner import pre_clean_tags
        raw_before = dict(all_text_tags)
        pre_cleaned_tags = pre_clean_tags(all_text_tags)
        pre_cleaned_original = pre_clean_tags(original_tags)
        
        tags_to_sanitize = {**pre_cleaned_original, **pre_cleaned_tags}
        if not tags_to_sanitize.get("title"):
            tags_to_sanitize["title"] = Path(track_name).stem
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
            from backend.app.services.master_llm import process_song_full
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
            # Merge AI results OVER local pre-cleaned results safely:
            # Only update fields if the AI provided a non-empty value!
            current_result = dict(pre_cleaned_original)
            current_result.update(pre_cleaned_tags)
            for k, v in discovery_result.items():
                if v and str(v).strip():
                    current_result[k] = v
            
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
            msg = "Language sync only" if language_only else ("Fix filenames only" if filenames_only else ("Skipped in lyrics-only mode" if lyrics_only else "Local standardization only"))
            await notify("sanitize", "done", msg)
            if language_only:
                cleaned_tags = dict(all_text_tags) # Keep existing tags EXACTLY as they are
            else:
                cleaned_tags = pre_cleaned_tags
            
            # Local Suggested Filename Generator
            suggested_filename = None
            if clean_filenames:
                from backend.app.services.tagger import _flatten_tag
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
                else:
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
        # ── Step 6: WRITE ──
        await notify("write", "running")
        
        # AGGRESSIVE RAW TAG JUNK PURGE
        # By default, Mutagen only edits predefined human fields and leaves random custom fields untouched.
        # This will deliberately locate custom raw fields with junk and pass `{ "field": "" }` to tagger.py
        # which acts as an explicit DEL command.
        from backend.app.services.scanner import _check_junk
        raw_tags_to_purge = {}
        if not language_only and not lyrics_only:
            for k, val in raw_before.items():
                k_str = str(k)
                v_str = str(val[0]) if isinstance(val, list) and val else str(val)
                # Keep standard frames out of this, they are handled natively.
                if _check_junk(k_str) or _check_junk(v_str):
                    if k_str.lower() not in ["title", "artist", "album", "genre", "year", "composer", "comment", "language"]:
                        raw_tags_to_purge[k_str] = ""
        
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
                print(f"[fixer] Rename failed for {track_path}: {e}")

        # Remove keys that shouldn't be passed to mutagen
        IGNORE_KEYS = {"has_junk", "has_lyrics", "last_scanned", "path", "filename", "duration", "suggested_filename", "current_filename", "parent_folder", "discovery_result", "research_context"}
        tags_to_write = {k: v for k, v in cleaned_tags.items() if k not in IGNORE_KEYS}

        # ONLY Write to file if it was actually fetched or we are applying local rules. Lyrics-only or local skip is respected.
        if (llm_lyrics_found or not lyrics_only) or local_only:
            success = write_tags(final_path, tags_to_write, lyrics, language, raw_tags=raw_tags_to_purge)
            if not success:
                await notify("write", "error", "File system error.")
                return {"success": False, "error": "Write failed"}
            
            # Post-write native sync logic
            if language:
                from backend.app.services.tagger import append_language_genre, _get_full_lang
                if full_lang := _get_full_lang(language):
                    append_language_genre(final_path, full_lang)

        # Extract a fresh audit of raw tags from disk after the write 
        # to ensure the history diff is 100% accurate
        from backend.app.services.scanner import fetch_raw_tags
        raw_after_audit = fetch_raw_tags(final_path)["tags"]

        duration = time.time() - start_time
        
        # We need to unify the cleaned_tags for the "summary" view in history
        # Since cleaned_tags may contain raw Mutagen keys (like TIT2)
        from backend.app.services.local_cleaner import pre_clean_tags
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

        final_title = final_summary.get("title") or cleaned_tags.get("title") or original_tags.get("title") or ""
        final_artist = final_summary.get("artist") or cleaned_tags.get("artist") or original_tags.get("artist") or ""
        final_album = final_summary.get("album") or cleaned_tags.get("album") or original_tags.get("album") or ""
        final_genre = final_summary.get("genre") or cleaned_tags.get("genre") or original_tags.get("genre") or ""
        final_year = final_summary.get("year") or cleaned_tags.get("year") or original_tags.get("year") or ""
        final_composer = final_summary.get("composer") or cleaned_tags.get("composer") or original_tags.get("composer") or ""

        await db.execute(
            f"""UPDATE tracks SET
                title = ?, artist = ?, album = ?, genre = ?, year = ?, composer = ?,
                has_lyrics = ?, lyrics = ?, language = ?, has_junk = 0, last_scanned = ?,
                path = ?, filename = ?, raw_tags_json = ?,
                {count_field} = {count_field} + 1, last_fix_type = ?,
                last_fixed_at = ?, last_ai_fix_duration = ?
               WHERE id = ?""",
            (
                final_title,
                final_artist,
                final_album,
                final_genre,
                final_year,
                final_composer,
                1 if (lyrics and lyrics.strip()) or final_summary.get("has_lyrics") else 0,
                "", # Stop saving lyrics to DB
                language,
                time.strftime("%Y-%m-%d %H:%M:%S"),
                final_path,
                Path(final_path).name,
                json.dumps(raw_after_audit),
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
    if not row or row["reverted"]:
        return {"success": False, "error": "Invalid or already reverted history entry"}

    track_path = row["track_path"]
    track_id = row["track_id"]
    original_tags = json.loads(row["original_tags"] or "{}")
    raw_before = json.loads(row["raw_before"] or "{}")

    # Safety Fallback: If original_tags recorded empty fields (e.g. from an earlier failed fix),
    # look back through previous history entries for this track to recover non-empty values.
    prev_cursor = await db.execute(
        "SELECT original_tags FROM tag_history WHERE (track_id = ? OR track_path = ?) AND id < ? ORDER BY id DESC",
        (track_id, track_path, history_id)
    )
    prev_rows = await prev_cursor.fetchall()
    for prev_row in prev_rows:
        prev_tags = json.loads(prev_row["original_tags"] or "{}")
        for k in ["title", "artist", "album", "genre", "year", "composer", "comment", "language"]:
            if not original_tags.get(k) and prev_tags.get(k):
                original_tags[k] = prev_tags[k]

    lyrics = original_tags.pop("lyrics", "")
    language = original_tags.pop("language", "")

    # Write original tags, lyrics, language, and raw_before back to the physical audio file
    if not write_tags(track_path, original_tags, lyrics=lyrics, language=language, raw_tags=raw_before):
        return {"success": False, "error": f"Failed to write tags to file: {track_path}"}

    # Mark history entry as reverted
    await db.execute("UPDATE tag_history SET reverted = 1 WHERE id = ?", (history_id,))

    # Re-scan file and sync database record
    file_data = scan_file(track_path)
    final_title = (file_data.get("title") if file_data else "") or original_tags.get("title", "")
    final_artist = (file_data.get("artist") if file_data else "") or original_tags.get("artist", "")
    final_album = (file_data.get("album") if file_data else "") or original_tags.get("album", "")
    final_genre = (file_data.get("genre") if file_data else "") or original_tags.get("genre", "")
    final_year = (file_data.get("year") if file_data else "") or original_tags.get("year", "")
    final_composer = (file_data.get("composer") if file_data else "") or original_tags.get("composer", "")
    final_comment = (file_data.get("comment") if file_data else "") or original_tags.get("comment", "")
    final_language = (file_data.get("language") if file_data else "") or language
    final_lyrics = (file_data.get("lyrics") if file_data else "") or lyrics

    await db.execute(
        """UPDATE tracks SET
            title = ?, artist = ?, album = ?, genre = ?, year = ?, composer = ?, comment = ?,
            has_lyrics = ?, language = ?, has_junk = ?, raw_tags_json = ?, last_scanned = ?
           WHERE path = ? OR id = ?""",
        (
            final_title,
            final_artist,
            final_album,
            final_genre,
            final_year,
            final_composer,
            final_comment,
            1 if final_lyrics else 0,
            final_language,
            1 if (file_data and file_data.get("has_junk")) else 0,
            file_data.get("raw_tags_json", "{}") if file_data else "{}",
            time.strftime("%Y-%m-%d %H:%M:%S"),
            track_path,
            track_id
        ),
    )
    await db.commit()
    return {"success": True, "message": "Reverted successfully"}
