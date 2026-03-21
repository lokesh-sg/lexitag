import asyncio
import aiosqlite
import os
import sys
from pathlib import Path
from app.services.scanner import scan_file
from app.config import settings

async def main():
    db = await aiosqlite.connect(settings.db_path)
    db.row_factory = aiosqlite.Row
    
    # Get all tracks where has_lyrics=1 and lyrics is empty
    cursor = await db.execute("SELECT id, path FROM tracks WHERE has_lyrics = 1 AND (lyrics = '' OR lyrics IS NULL)")
    rows = await cursor.fetchall()
    print(f"Found {len(rows)} tracks to fix")
    
    count = 0
    for row in rows:
        track_id = row['id']
        path = row['path']
        if not os.path.exists(path):
            continue
            
        data = scan_file(path)
        if data and data['lyrics']:
            await db.execute("UPDATE tracks SET lyrics = ? WHERE id = ?", (data['lyrics'], track_id))
            count += 1
            if count % 10 == 0:
                print(f"Progress: {count}/{len(rows)}")
                await db.commit()
    
    await db.commit()
    await db.close()
    print(f"Finished! Updated {count} tracks.")

if __name__ == "__main__":
    asyncio.run(main())
