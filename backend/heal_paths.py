import sqlite3
import os

DB_PATH = "/Users/lokeshg/LexiTag/dev/data/lexitage.db"

def heal_db_paths():
    if not os.path.exists(DB_PATH):
        print(f"Error: Database not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Base Path Mapping
    # Macdonald -> Container
    MAPPING = {
        "/Volumes/Media/Music/Organized": "/app/music",
        "/Volumes/Downloads/LexiTag/music": "/app/music",
        "/Volumes/Media/Music/UnOrganized": "/app/music/UnOrganized" # Just in case
    }

    # 1. Update Library Sources
    print("Updating library_sources...")
    for old, new in MAPPING.items():
        cursor.execute("UPDATE library_sources SET path = ? WHERE path = ?", (new, old))
        print(f"Mapped source {old} -> {new}")

    # 2. Update Tracks Table
    print("\nUpdating tracks paths...")
    total_updated = 0
    for old, new in MAPPING.items():
        # Using REPLACE to upgrade base paths
        cursor.execute("UPDATE tracks SET path = REPLACE(path, ?, ?)", (old, new))
        rowcount = cursor.rowcount
        total_updated += rowcount
        print(f"Updated {rowcount} tracks for {old} -> {new}")

    # 3. Update History Table
    print("\nUpdating history paths...")
    for old, new in MAPPING.items():
        cursor.execute("UPDATE tag_history SET track_path = REPLACE(track_path, ?, ?)", (old, new))
        print(f"Updated {cursor.rowcount} history entries for {old} -> {new}")

    # 4. Cleanup Duplicates (if some /app/music paths already were created)
    # This might happen if they ran a scan on Ubuntu already.
    print("\nCleaning up duplicates from previous failed scans...")
    # Keep the row with the most metadata or history (simplest: keep the one with lower ID or most recently scanned)
    # We'll GROUP BY path and keep the first one
    cursor.execute("""
        DELETE FROM tracks
        WHERE id NOT IN (
            SELECT MIN(id)
            FROM tracks
            GROUP BY path
        );
    """)
    print(f"Deleted {cursor.rowcount} duplicate track entries.")

    conn.commit()
    conn.close()
    print("\nDatabase paths healed successfully.")

if __name__ == "__main__":
    heal_db_paths()
