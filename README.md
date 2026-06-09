# LexiTag

**Version:** 0.1.4 | **Language:** Python 3.12 / React 18 | **Database:** SQLite

LexiTag is a self-hosted music library metadata manager. It scans your audio files, cleans junk metadata, enriches tags using an AI model, fetches lyrics, and provides a web-based UI for browsing and editing your entire library. Everything runs locally — no cloud sync required.

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Docker Deployment](#docker-deployment)
- [Running Locally (Development)](#running-locally-development)
- [Configuration](#configuration)
- [Ports](#ports)
- [Authentication](#authentication)
- [How Tag Cleaning Works](#how-tag-cleaning-works)
- [Multi-Provider AI Support](#multi-provider-ai-support)
- [Audio Player](#audio-player)
- [Library Management](#library-management)
- [History and Revert](#history-and-revert)
- [Batch Processing](#batch-processing)
- [Release Notes](#release-notes)

---

## Features

### Metadata Cleaning
- Removes junk embedded in tags: download site URLs, promo text, streaming watermarks, and comment spam.
- Uses a two-phase cleaning process — local pattern matching runs first, then the AI result is re-scanned to catch anything that crept back in from search results.
- Supports custom junk patterns configured through the Settings panel.

### AI Metadata Enrichment
- Sends track information to a configured LLM (Gemini, OpenAI-compatible, Anthropic) to identify the correct title, artist, album, year, genre, composer, and language.
- Works across multiple languages and regional music libraries.
- Falls back gracefully when a track cannot be identified rather than crashing the batch.

### Lyrics
- Searches LRCLIB for time-synced and plain lyrics.
- Saves lyrics directly into the audio file's metadata tags (ID3 USLT, Vorbis LYRICS, MP4 ©lyr).
- Language is deduced from the lyrics and stored as an ISO 639-1/639-2 code.

### Language Detection
- Detects the language of a track based on its title, artist context, and lyrics.
- Stores the result in the standard TLAN tag (FLAC/MP3) or equivalent.
- Tracks with "UND" (undetermined) are still flagged for review in the Missing Lyrics filter.

### Audio Player
- Built-in browser-based audio player supporting MP3, FLAC, WAV, ALAC, and M4A.
- Full seek support via HTTP Range Requests.
- Per-track playback directly from the library table without leaving the page.

### UPnP / DLNA Casting
- Discovers DLNA renderers (TVs, speakers, media receivers) on your local network.
- Casts any track directly to the selected renderer from the UI.
- Requires `network_mode: host` in Docker for SSDP multicast to reach the network.

### Library Management
- Indexes files by scanning configured source directories.
- Supports multiple library sources with independent enabled/disabled toggles per source.
- Only enabled sources are scanned — useful when migrating between drives or directories.
- Filters available: Missing Tags, Missing Lyrics, Missing Language, Has Junk, and more.

### Batch Fix
- Select any number of tracks and run an AI fix, lyrics-only fix, local-only fix, or filename fix.
- Real-time progress panel with per-track step indicators (Read, Backup, Clean, Lyrics, Lang, Write).
- Elapsed time display with HH:MM:SS formatting for long-running batches.
- Stop & Clear button to unlock the UI if a job hangs or the backend restarts mid-batch.
- Accurate abort reporting shows exactly how many tracks completed before the stop.

### History and Revert
- Every fix creates a per-field audit record before writing.
- The History view shows every change with before/after diffs and timestamps.
- Individual fields, full tracks, or entire batches can be reverted with one click.

### Manual Editing
- Click any track to open the metadata editor.
- Edit title, artist, album, year, genre, composer, lyrics, and language manually.
- Changes are written directly to the file and synced to the database.
- Bulk edit: select multiple tracks to update a shared field across all of them at once.

---

## Requirements

- Docker (recommended) or Python 3.12+ and Node 20+
- An LLM API key (Google Gemini recommended — has a free tier)
- Optionally: a Google Custom Search API key for web search fallback

---

## Quick Start

```bash
# Clone or download the project
cp .env.example .env
# Edit .env with your LLM_API_KEY and other settings

mkdir -p music data
# Copy your audio files into ./music

docker compose up -d # Automatically pulls lokeshsg/lexitag:latest from Docker Hub
# Access the UI at http://localhost:3030
```

On first load, go to **Settings > Library Sources** and add the path to your music directory inside the container (`/app/music` by default). Then click **Scan Library** to index your files.

---

## Docker Deployment

The official and easiest way to deploy LexiTag is via Docker Compose using our pre-built image from Docker Hub.

1. Create a directory on your server (e.g., `lexitag`) and navigate to it.
2. Create a `docker-compose.yml` file with the following contents:

```yaml
services:
  lexitag:
    image: lokeshsg/lexitag:latest
    container_name: lexitag
    network_mode: "host" # Crucial for UPnP DLNA casting to discover speakers
    environment:
      - MUSIC_DIR=/app/music
      - DATA_DIR=/app/data
    volumes:
      - ./music:/app/music # Map your host's music folder here
      - ./data:/app/data   # Maps the database folder to persist data
    restart: unless-stopped
```

3. Ensure your `./music` directory exists and has your music files in it.
4. Start the container in the background:
   ```bash
   docker compose up -d
   ```
5. Access the web interface at `http://YOUR_SERVER_IP:3030`.

---

## Running Locally (Development)

**Backend:**
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 3020
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
# Runs on http://localhost:3010, proxied to backend on 3020
```

Or use the provided restart script from the project root:
```bash
./restart.sh
```

---

## Configuration

All settings are managed through a `.env` file in the project root.

| Variable | Description | Default |
|---|---|---|
| `LLM_API_KEY` | API key for the LLM provider | required |
| `LLM_API_BASE_URL` | Base URL for the completions endpoint | Gemini endpoint |
| `LLM_MODEL` | Model identifier | `gemini-2.0-flash` |
| `MUSIC_DIR` | Path to the music library | `/app/music` |
| `DATA_DIR` | Path for the SQLite database | `/app/data` |
| `LEXITAG_AUTH_TOKEN` | Optional bearer token to protect the UI | none |
| `ALLOWED_ORIGINS` | CORS origins (comma-separated) | `*` |
| `GOOGLE_CSE_KEY` | Google Custom Search API key (optional) | none |
| `GOOGLE_CSE_CX` | Google Custom Search Engine ID (optional) | none |

Additional providers can be added and managed through **Settings > AI Providers** in the UI without editing `.env`.

---

## Security & Deployment

- **Non-Root Execution:** The Docker container runs strictly as a non-root user (`lexitag`).
- **Path Jailing:** The backend enforces strict path validation to ensure files can only be read from or written to the designated `MUSIC_DIR` and `DATA_DIR`.

---

## Ports

| Context | Service | Port |
|---|---|---|
| Development | Frontend (Vite) | 3010 |
| Development | Backend (uvicorn) | 3020 |
| Docker / Production | Combined (served from uvicorn) | 3030 |

---

## Authentication

If `LEXITAG_AUTH_TOKEN` is set, all API requests require a `Authorization: Bearer <token>` header. The frontend reads this token from the `VITE_LEXITAG_AUTH_TOKEN` environment variable at build time, or from `window.LEXITAG_TOKEN` at runtime.

To run without auth (local use only), leave both variables unset.

---

## How Tag Cleaning Works

LexiTag uses two cleaning passes on every track:

1. **Local Pass** — Pattern matching against a built-in and user-configurable list of junk strings (e.g., `Gaana.com`, `HiResTracks.com`, encoded URLs, comment spam). This runs before any AI call.

2. **AI Pass** — The cleaned tags are sent to the LLM with the track's filename and folder name as context. The AI identifies correct metadata and returns a structured result.

3. **Post-AI Pass** — The AI result is re-cleaned through the same local rules. This prevents the AI from accidentally re-introducing junk it encountered in its web search results (e.g., site tags embedded in streaming metadata).

Tags like `TSRC`, `TSSE`, and vendor-specific frames are explicitly stripped at write time.

---

## Multi-Provider AI Support

LexiTag supports multiple AI providers through a single settings panel:

- **Google Gemini** (default, recommended)
- **OpenAI** and any OpenAI-compatible endpoint
- **Anthropic Claude**

Providers can be added, switched, or disabled from **Settings > AI Providers**. API keys are stored encrypted in the database. Only one provider is active at a time.

If the active provider returns a 503 (overloaded) or 429 (rate limited) error, LexiTag will automatically pause and retry the same track up to 3 times with increasing wait intervals (8s, then 16s) before marking the track as failed.

---

## Audio Player

The built-in player supports:
- MP3, FLAC, WAV, M4A/ALAC, OGG
- Seeking via HTTP Range Requests (browser-native)
- Volume control and playback progress
- Inline streaming (not treated as a download by the browser)

FLAC files are served with the `audio/flac` MIME type for maximum browser compatibility.

---

## Library Management

Source directories are managed from **Settings > Library Sources**. You can:
- Add multiple paths (useful for multi-drive setups)
- Enable or disable a source without removing it
- Trigger a full scan or a status-only refresh per source

The scanner skips disabled sources entirely. When a file is renamed during a fix, the database path is updated automatically.

---

## History and Revert

Every change made by LexiTag (AI fix, manual edit, bulk update) is recorded in the history table with:
- Timestamp
- Changed fields with before and after values
- Batch ID to group related changes together

From the History view, you can:
- View a diff for any change
- Revert a single field change
- Revert an entire track to its pre-fix state
- Revert an entire batch at once

---

## Batch Processing

Batch fixes run as background tasks. You can:
- Queue an AI fix, lyrics-only, local-only, or filename-only fix for any selection
- Monitor progress in real time via the progress panel
- Abort at any time — completed tracks are saved, the aborted track is not
- Dismiss the progress panel or force-clear it with "Stop & Clear" if it gets stuck

The batch engine retries on API failures and soft-skips tracks the AI cannot identify (e.g., personal recordings with no external metadata available).

---

## Release Notes

### v0.1.4 (2026-06-09)
- Hardened Docker image to run securely as a non-root user (`lexitag`).
- Implemented cross-compilation fixes for reliable Apple Silicon (arm64) to Intel (amd64) server deployments.
- Upgraded multiple vulnerable frontend dependencies.

### v0.1.3 (2026-05-15)
- Removed insecure `LEXITAG_MASTER_KEY` fallback authentication system to eliminate backdoor vulnerabilities.
- Implemented strict directory path jailing (`validate_path`) to prevent arbitrary file read/write access.
- Removed left-over debug and test scripts.

### v0.1.2 (2026-03-20)
- Added 3-attempt retry with exponential backoff for AI provider overload errors.
- Implemented double-cleaning to prevent junk re-injection from AI search results.
- Fixed FLAC browser playback by switching to `FileResponse` with `audio/flac` MIME type.
- Fixed manual bulk edits for Language and Lyrics not being written to disk.
- Fixed progress bar showing full batch count on manual abort.
- Added HH:MM:SS elapsed timer for long-running batches.
- Added "Stop & Clear" button to allow UI recovery when a job hangs.
- Scanner now respects the enabled/disabled state of library sources.
- Fixed overly aggressive junk pattern that removed artist names containing "Gaana".
- Changed ports to 3010 (frontend), 3020 (backend), 3030 (Docker).
