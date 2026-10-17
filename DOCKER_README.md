# LexiTag (v0.1.9)

**Self-Hosted Music Metadata, Lyrics, and Artwork Manager**

LexiTag is a self-hosted music library manager built to clean watermarked tags, organize metadata, fetch lyrics, and manage album artwork using configurable AI providers and a fast SQLite backend.

---

## Quick Start

Deploy LexiTag using Docker Compose:

```yaml
services:
  lexitag:
    image: lokeshsg/lexitag:latest
    container_name: lexitag
    network_mode: "host" # Required for multicast discovery
    environment:
      - DATA_DIR=/app/data
    volumes:
      - ./data:/app/data
      - /path/to/your/music:/app/music
    restart: unless-stopped
```

1. Create a `docker-compose.yml` with the content above.
2. Run `docker compose up -d`.
3. Open the UI at `http://localhost:3030`.

---

## Key Features

- **Real-Time Filesystem Monitor (Live Watch)**: Detects newly added, modified, or deleted audio files on disk with Jellyfin/Navidrome-safe **Add & Delete Only** mode, write-settle debounce, and self-write suppression.
- **Database Maintenance & Old Path Cleanup**: Inspect active vs. orphaned library paths, purge stale database entries, and run non-blocking background SQLite `VACUUM` from the dedicated `/settings` page.
- **Recently Added Filter & Multi-Sort**: 1-click **Recently Added** filter pill and sorting controls (`Recently Added`, `Recently Scanned`, `Recently Fixed`, `A → Z`, `Release Year`) across both the **Music Library** and **Album Art Gallery**.
- **Album Art Gallery**: Full-page gallery with group-by-album and flat-track views, multi-select, bulk Apply / Remove, and per-album artwork override workflow.
- **Artwork Search**: Cover art lookup across Apple Music, Deezer, Discogs, Wikipedia, MusicBrainz, and Cover Art Archive with exact album/year matching.
- **Media Server Artwork Synchronization**: Synchronizes folder-level images (`cover.jpg`, `folder.jpg`) alongside embedded audio tags for Navidrome and Jellyfin compatibility.
- **Responsive UI & Dedicated Settings Page**: Clean dark studio interface with a dedicated `/settings` route, sticky pagination bar, and full mobile/desktop responsiveness.
- **Periodic Library Auto-Scanner**: Configurable background auto-sync scheduler with preset intervals (`1h`, `6h`, `12h`, `24h`, `7d`) and custom minute/hour schedules.
- **Tag & Lyrics Enrichment**: Cleans titles, artists, albums, genres, release years, and fetches synced or plain lyrics (including regional & soundtrack releases).
- **History & Revert System**: Retains manual edits during scans and provides 1-click history restoration across all supported audio formats.
- **Multi-Format Audio Support**: Full ID3, Vorbis, MP4 atom, and WAV RIFF tag scanning and writing for MP3, FLAC, M4A, and WAV files.

---

## Deployment Notes

- **Music Path**: Point the volume mount to your music directory (`/path/to/your/music:/app/music`).
- **Database**: The SQLite database and settings are stored in `./data` (`./data:/app/data`).
- **Default Port**: Web UI listens on port `3030`.

**Source Repository:** [https://github.com/lokesh-sg/lexitag](https://github.com/lokesh-sg/lexitag)

