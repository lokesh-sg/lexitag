import sqlite3
import json
import os
from mutagen.flac import FLAC
from mutagen import File as MutagenFile

DB_PATH = "/app/data/lexitage.db"
MUSIC_DIR = "/app/music"

def get_audio_handler(filepath):
    """Simple wrapper similar to our backend tagger."""
    try:
        return MutagenFile(filepath)
    except Exception:
        return None

def write_to_disk(filepath, tags):
    """Write tags back to physical file."""
    audio = get_audio_handler(filepath)
    if not audio:
        return False
        
    try:
        is_flac = isinstance(audio, FLAC)
        for key, val in tags.items():
            str_val = str(val[0]) if isinstance(val, (list, tuple)) else str(val)
            if not str_val:
                continue
                
            if is_flac:
                audio[key.upper()] = [str_val]
            else:
                # Basic ID3 mapping
                mapping = {"title": "TIT2", "artist": "TPE1", "album": "TALB", "year": "TDRC", "genre": "TCON"}
                tag_key = mapping.get(key.lower(), key.upper())
                audio[tag_key] = str_val
        
        audio.save()
        return True
    except Exception as e:
        print(f"Failed to write disk for {filepath}: {e}")
        return False

def restore_missing_tags(apply_to_disk=True):
    # Try to find Local DB if not in container
    db_path = DB_PATH if os.path.exists(DB_PATH) else "/Users/lokeshg/LexiTag/dev/data/lexitage.db"
    
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Find tracks with missing Title, Artist, OR Album
    # but that HAVE tag history entries with raw_before
    query = """
        SELECT t.id, t.path, t.filename, t.title, t.artist, t.album, h.raw_before
        FROM tracks t
        JOIN tag_history h ON t.path = h.track_path
        WHERE (t.title IS NULL OR t.title = '' OR t.title = t.filename)
        AND h.raw_before IS NOT NULL
        AND h.raw_before != '{}'
        ORDER BY h.timestamp DESC;
    """
    
    cursor.execute(query)
    rows = cursor.fetchall()
    print(f"Found {len(rows)} potential candidates for restoration.")
    
    db_restored = 0
    disk_restored = 0
    
    for row in rows:
        try:
            raw_before = json.loads(row['raw_before'])
            if not raw_before: continue
                
            updates = {}
            # Restore Title if missing
            if (not row['title'] or row['title'] == row['filename']) and raw_before.get('title'):
                val = raw_before['title']
                updates['title'] = str(val[0]) if isinstance(val, (list, tuple)) else str(val)
            
            # Restore Artist if missing
            if not row['artist'] and raw_before.get('artist'):
                val = raw_before['artist']
                updates['artist'] = str(val[0]) if isinstance(val, (list, tuple)) else str(val)
                
            # Restore Album if missing
            if not row['album'] and raw_before.get('album'):
                val = raw_before['album']
                updates['album'] = str(val[0]) if isinstance(val, (list, tuple)) else str(val)
                
            if updates:
                # 1. Update Database
                set_clause = ", ".join([f"{k} = ?" for k in updates.keys()])
                params = list(updates.values()) + [row['id']]
                cursor.execute(f"UPDATE tracks SET {set_clause} WHERE id = ?", params)
                db_restored += 1
                
                # 2. Update Disk if requested and file exists
                if apply_to_disk and os.path.exists(row['path']):
                    if write_to_disk(row['path'], updates):
                        disk_restored += 1
                
                if db_restored % 100 == 0:
                    print(f"Processed {db_restored}... (Disk Fixes so far: {disk_restored})")
                    
        except Exception as e:
            print(f"Error processing {row['path']}: {e}")

    conn.commit()
    conn.close()
    print(f"\nRestoration Summary:")
    print(f"- Database entries recovered: {db_restored}")
    print(f"- Physical files updated: {disk_restored}")

if __name__ == "__main__":
    restore_missing_tags(apply_to_disk=True)
