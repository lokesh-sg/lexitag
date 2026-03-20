"""SQLite database layer — async connection, migrations, and helpers."""

import aiosqlite
import os
from .config import settings

_db: aiosqlite.Connection | None = None


async def get_db() -> aiosqlite.Connection:
    """Return the shared database connection (creates on first call)."""
    global _db
    if _db is None:
        os.makedirs(settings.DATA_DIR, exist_ok=True)
        _db = await aiosqlite.connect(settings.db_path)
        _db.row_factory = aiosqlite.Row
        await _db.execute("PRAGMA journal_mode=WAL")
        await _db.execute("PRAGMA synchronous=NORMAL")
        await _db.execute("PRAGMA cache_size=10000")
        await _db.execute("PRAGMA mmap_size=30000000")
        await _db.execute("PRAGMA temp_store=MEMORY")
        await _db.execute("PRAGMA foreign_keys=ON")
        await _run_migrations(_db)
    return _db


async def close_db():
    """Gracefully close the database connection."""
    global _db
    if _db is not None:
        await _db.close()
        _db = None


async def _run_migrations(db: aiosqlite.Connection):
    """Create tables if they don't exist and run incremental migrations."""
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS tracks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            path        TEXT UNIQUE NOT NULL,
            filename    TEXT NOT NULL,
            title       TEXT DEFAULT '',
            artist      TEXT DEFAULT '',
            album       TEXT DEFAULT '',
            genre       TEXT DEFAULT '',
            year        TEXT DEFAULT '',
            duration    REAL DEFAULT 0,
            has_lyrics  INTEGER DEFAULT 0,
            language    TEXT DEFAULT '',
            has_junk    INTEGER DEFAULT 0,
            format      TEXT DEFAULT '',
            lyrics      TEXT DEFAULT '',
            last_scanned TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS tag_history (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id        INTEGER NOT NULL,
            track_path      TEXT NOT NULL,
            original_tags   TEXT NOT NULL,   -- JSON blob
            changed_tags    TEXT NOT NULL,   -- JSON blob
            timestamp       TEXT NOT NULL,
            reverted        INTEGER DEFAULT 0,
            batch_id        TEXT DEFAULT NULL,
            raw_before      TEXT DEFAULT '{}', -- JSON blob
            raw_after       TEXT DEFAULT '{}', -- JSON blob
            FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS llm_providers (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            provider    TEXT NOT NULL,
            api_base    TEXT NOT NULL,
            api_key     TEXT NOT NULL DEFAULT '',
            model       TEXT NOT NULL DEFAULT '',
            is_active   INTEGER DEFAULT 0,
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key     TEXT PRIMARY KEY,
            value   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS library_sources (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            path        TEXT UNIQUE NOT NULL,
            enabled     INTEGER DEFAULT 1,
            last_scanned TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS cleanup_patterns (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern     TEXT UNIQUE NOT NULL,
            category    TEXT DEFAULT 'junk', -- 'junk', 'soundtrack'
            is_regex    INTEGER DEFAULT 0,
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cleanup_suggestions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern     TEXT UNIQUE NOT NULL,
            frequency   INTEGER DEFAULT 1,
            sample_value TEXT,
            source_field TEXT,
            status      TEXT DEFAULT 'pending', -- 'pending', 'dismissed', 'accepted'
            created_at  TEXT NOT NULL
        );
    """)

    # Incremental migrations — add columns if missing
    await _safe_add_column(db, "tag_history", "batch_id", "TEXT DEFAULT NULL")
    await _safe_add_column(db, "tag_history", "raw_before", "TEXT DEFAULT '{}'")
    await _safe_add_column(db, "tag_history", "raw_after", "TEXT DEFAULT '{}'")
    await _safe_add_column(db, "tracks", "composer", "TEXT DEFAULT ''")
    await _safe_add_column(db, "tracks", "comment", "TEXT DEFAULT ''")
    await _safe_add_column(db, "tracks", "lyrics", "TEXT DEFAULT ''")
    await _safe_add_column(db, "tracks", "local_fix_count", "INTEGER DEFAULT 0")
    await _safe_add_column(db, "tracks", "llm_fix_count", "INTEGER DEFAULT 0")
    await _safe_add_column(db, "tracks", "last_fix_type", "TEXT DEFAULT NULL")
    await _safe_add_column(db, "tracks", "last_fixed_at", "TEXT DEFAULT NULL")
    await _safe_add_column(db, "tracks", "last_ai_fix_duration", "REAL DEFAULT 0")
    await _safe_add_column(db, "tracks", "bitrate", "INTEGER DEFAULT 0")

    await _safe_add_column(db, "tag_history", "duration_seconds", "REAL DEFAULT 0")

    await db.executescript("""
        CREATE INDEX IF NOT EXISTS idx_tracks_path ON tracks(path COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_tracks_filename ON tracks(filename);
        CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
        CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
        CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
        CREATE INDEX IF NOT EXISTS idx_tracks_fixed ON tracks(last_fixed_at);
        CREATE INDEX IF NOT EXISTS idx_tracks_junk ON tracks(has_junk);
        CREATE INDEX IF NOT EXISTS idx_tracks_lyrics ON tracks(has_lyrics);
        
        CREATE INDEX IF NOT EXISTS idx_history_track ON tag_history(track_id);
        CREATE INDEX IF NOT EXISTS idx_history_path ON tag_history(track_path COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_history_batch ON tag_history(batch_id);
        CREATE INDEX IF NOT EXISTS idx_history_timestamp ON tag_history(timestamp DESC);

        CREATE INDEX IF NOT EXISTS idx_suggestions_pattern ON cleanup_suggestions(pattern);
        CREATE INDEX IF NOT EXISTS idx_suggestions_status ON cleanup_suggestions(status);
    """)

    # Seed settings if empty
    cursor = await db.execute("SELECT COUNT(*) as cnt FROM settings")
    if (await cursor.fetchone())["cnt"] == 0:
        await db.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?)",
            ("music_dir", settings.MUSIC_DIR)
        )

    # Migrate music_dir string to library_sources table if empty
    cursor = await db.execute("SELECT COUNT(*) as cnt FROM library_sources")
    if (await cursor.fetchone())["cnt"] == 0:
        music_dir = await get_setting("music_dir", settings.MUSIC_DIR)
        if music_dir:
            dirs = [d.strip() for d in music_dir.split('\n') if d.strip()]
            for d in dirs:
                await db.execute("INSERT OR IGNORE INTO library_sources (path, enabled) VALUES (?, ?)", (d, 1))
    
    # 3. Seed cleanup patterns if empty
    cursor = await db.execute("SELECT COUNT(*) as cnt FROM cleanup_patterns")
    if (await cursor.fetchone())["cnt"] == 0:
        import time
        now = time.strftime("%Y-%m-%d %H:%M:%S")
        
        # Pull standard patterns from local_cleaner (just the textual parts if possible)
        from .services.local_cleaner import JUNK_PATTERNS
        for p in JUNK_PATTERNS:
            # We insert as regex if it contains special chars
            is_reg = 1 if any(c in p for c in "()[]*+?|") else 0
            cat = "soundtrack" if any(x in p for x in ["Original", "OST", "BGM", "Soundtrack"]) else "junk"
            await db.execute(
                "INSERT OR IGNORE INTO cleanup_patterns (pattern, category, is_regex, created_at) VALUES (?, ?, ?, ?)",
                (p, cat, is_reg, now)
            )

    await db.commit()


async def _safe_add_column(db: aiosqlite.Connection, table: str, column: str, col_type: str):
    """Add a column to a table if it doesn't already exist."""
    cursor = await db.execute(f"PRAGMA table_info({table})")
    columns = [row[1] for row in await cursor.fetchall()]
    if column not in columns:
        await db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")


async def get_setting(key: str, default: str = "") -> str:
    """Fetch a configuration value from the settings table."""
    db = await get_db()
    cursor = await db.execute("SELECT value FROM settings WHERE key = ?", (key,))
    row = await cursor.fetchone()
    return row["value"] if row else default
