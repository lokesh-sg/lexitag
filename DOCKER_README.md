# LexiTag (v0.1.6)

**Intelligent Music Metadata Manager with AI-Powered Junk Discovery**

LexiTag is a state-of-the-art self-hosted music library manager designed to clean, organize, fetch lyrics, and discover junk in your track metadata using advanced AI search grounding and an asynchronous SQLite engine.

---

## 🚀 Quick Start

Deploy LexiTag instantly using Docker Compose:

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
3. Access the UI at `http://localhost:3030`.

---

## 🛠 Key Features

- **AI-Powered Tag & Lyrics Enrichment**: Uses Gemini Google Search Grounding to clean titles, artists, albums, genres, release years, and fetch full lyrics (including regional & Tamil songs).
- **Metadata Protection & Revert System**: Retains manual edits during scans and provides 1-click backwards history restoration across all audio formats.
- **Multi-Format Audio Support**: Full ID3, Vorbis, MP4 atom, and WAV RIFF tag scanning & writing for MP3, FLAC, M4A, and WAV files.
- **System Logs & Live Debug Mode**: Interactive terminal viewer, runtime log level toggle, and direct log file download directly from the browser UI.
- **Auto-Junk Discovery Engine**: Automatically detects site-specific promo junk, website URLs, and unwanted comments during library scans.

---

## ⚙️ Deployment Notes

- **Music Path**: Ensure the volume mount points to your physical music library (`/path/to/your/music:/app/music`).
- **Database**: The SQLite database and settings are persisted in the `./data` folder on your host (`./data:/app/data`).
- **Default Port**: Access the Web UI on port `3030`.

**Official Repository:** [GitHub (Source)](https://github.com/lokesh-sg/lexitag)
