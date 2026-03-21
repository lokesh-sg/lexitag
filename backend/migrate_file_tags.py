
import sqlite3
import os
import sys
import asyncio

# Add the app directory to sys.path so we can import services
sys.path.append("/Volumes/Downloads/LexiTag/dev/backend")

from app.services.tagger import write_tags
from app.services.scanner import fetch_raw_tags

DB_PATH = "/Volumes/Downloads/LexiTag/dev/backend/lexitage.db"

async def mass_update_file_languages():
    print("Starting mass language tag update (Full Words)...")
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Find tracks where we have a language set in our database
    cursor.execute("SELECT id, path, language, title, artist, album, genre, year, composer, comment FROM tracks WHERE language IS NOT NULL AND language != ''")
    rows = cursor.fetchall()
    
    total = len(rows)
    updated = 0
    errors = 0
    
    print(f"Analyzing {total} tracks...")

    for i, row in enumerate(rows):
        track_path = row["path"]
        target_lang = row["language"]
        
        if not os.path.exists(track_path):
            continue

        # Simple progress update
        if i % 100 == 0:
            print(f"Processing: {i}/{total}...")

        try:
            # 1. Fetch EVERYTHING currently in the file to preserve it
            raw = fetch_raw_tags(track_path)
            raw_data = raw.get("tags", {})
            
            # Prepare standard tags for write_tags - prioritize DB values if they exist
            tags = {
                "title": str(row["title"] or ""),
                "artist": str(row["artist"] or ""),
                "album": str(row["album"] or ""),
                "genre": str(row["genre"] or ""),
                "year": str(row["year"] or ""),
                "composer": str(row["composer"] or ""),
                "comment": str(row["comment"] or "")
            }
            
            # Extract lyrics safely
            lyrics = ""
            for k in ["USLT", "\\xa9lyr", "lyrics", "LYRICS"]:
                for rk, rv in raw_data.items():
                    if rk.startswith(k):
                        if isinstance(rv, list):
                            lyrics = "\n".join(str(x) for x in rv if x)
                        else:
                            lyrics = str(rv)
                        break
                if lyrics: break

            # Force write-back using fixed tagger
            # We pass raw_data to preserve all other tags (Track #, Copyright, etc.)
            success = write_tags(track_path, tags, lyrics=lyrics, language=target_lang, raw_tags=raw_data)
            
            if success:
                updated += 1
            else:
                errors += 1
                
        except Exception as e:
            # print(f"Error on {track_path}: {e}")
            errors += 1

    conn.close()
    print(f"\nMigration Finished!")
    print(f"Successfully updated tags in files: {updated}")
    print(f"Failed/Errors: {errors}")

if __name__ == "__main__":
    asyncio.run(mass_update_file_languages())
