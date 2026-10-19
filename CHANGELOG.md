# Changelog

All notable changes to LexiTag are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.9] — 2026-10-18 (Build 20261018)

### Added
- **Adaptive Mobile & Multi-Viewport Responsive Engine (`useViewport`)** — Added real-time browser viewport and input-device detection (`useViewport.js`) using `ResizeObserver`, `window.visualViewport`, and pointer/touch media queries (`coarse` / `hover: none`) to dynamically optimize layouts from `320px` phones to ultra-wide studio monitors.
- **Mobile Track Cards & Responsive Action Toolbars** — Added dedicated mobile card layouts in `TrackTable.jsx` with inline play, cover art, format/language/lyrics badges, and 1-tap editing, while keeping all three Library action button groups (`AI Fix / Lyrics / Clean Names`, `Local Fix / Fix Names / Sync Lang / Edit`, `Refresh / Scan`) permanently visible in symmetrical full-width studio bars on mobile.
- **Mobile-Optimized Album Art Studio, Modals, History & Settings** — Adapted `AlbumArtGallery.jsx`, `TrackMetadataModal.jsx`, `HistoryView.jsx`, `HistoryDiffModal.jsx`, `SettingsPanel.jsx`, and `PlayerBar.jsx` with touch-accessible controls (no hover dependency), symmetrical 12-column filter/sort/group grids, and stacked mobile diff/modal views.
- **Real-Time Filesystem Monitor (Live Watch)** — Background `FilesystemWatcher` service (`fs_watcher.py`) that actively monitors library source folders for newly added, modified, or deleted audio files (`SUPPORTED_EXTENSIONS` only; ignores `cover.jpg`, `.lrc`, `.nfo`, and hidden temp files). Includes configurable **Add & Delete Only** mode (safe for Jellyfin/Navidrome co-existence), write-settle debounce (`1.5s`), and automatic self-write suppression (`suppress_path` / `suppress_rename`) when LexiTag modifies or renames files.
- **Database Maintenance & Old Path Cleanup** — Added `/api/settings/database/stats` and `/api/settings/database/cleanup` endpoints plus a dedicated **Database Maintenance** section in Settings to inspect total vs. active vs. out-of-scope tracks, purge stale/orphaned path records, and run non-blocking background SQLite `VACUUM`.
- **Dedicated `/settings` Page with Sidebar Navigation** — Moved Settings out of the main Library page into its own full-page `/settings` route with a 4-section sidebar (`Library & Scanning`, `AI & Lyrics`, `Automation & Cleanup`, `System & Logs`).
- **Recently Added Filter & Multi-Sort Controls** — Added a 1-click **Recently Added** filter pill and **Sort** dropdown (`Recently Added`, `Recently Scanned`, `Recently Fixed`, `Title/Artist/Album A → Z`, `Release Year`) in both the **Music Library** and **Album Art Gallery** (supporting both flat tracks and Album/Artist/Folder grouped views).

### Changed
- **Main Library Header & Action Toolbar** — Organized all track-fixing actions (`AI Fix`, `Lyrics`, `Clean Names`, `Local Fix`, `Fix Names`, `Sync Lang`, `Edit`, `Refresh`, `Scan`) into three clean, permanently accessible pill groups on the Music Library header.
- **Sticky Bottom Pagination & Player Clearance** — Made the bottom pagination bar sticky above the audio player bar and added bottom scroll clearance (`pb-20`) so page numbers and navigation buttons are never obscured.
- **Security & Dependency Upgrades** — Upgraded `axios` (`^1.20.0`), `fastapi` (`>=0.143.3`), `uvicorn` (`>=0.54.0`), `pydantic` (`>=2.14.1`), `aiohttp` (`>=3.14.5`), `cryptography` (`>=50.0.2`), `mutagen` (`>=1.48.1`), `postcss-selector-parser` (`^7.1.6`), and `source-map-js` (`^1.2.2`), and hardened `.dockerignore` against local artifacts.

---

## [0.1.8] — 2026-09-15 (Build 20260915)

### Added
- **Sidecar `.lrc` Discovery & Management** — Automatically detects adjacent `.lrc` sidecar files in the track directory on disk, tags them with `lyrics_source="sidecar"`, and displays a distinct `📄 Sidecar` badge across the library table and track modal.
- **Sidecar-Only Library Filter** — Added `Sidecar Only` filter tab in the UI to isolate tracks with external `.lrc` files, with 1-click Local Fix to embed them into audio tags (`USLT`/`LYRICS`).
- **Missing Lyrics Filter Exclusion** — Tracks with existing sidecar `.lrc` files are automatically excluded from the `Missing Lyrics` filter.
- **Album Art Gallery** — Full-page gallery view with group-by-album and flat-track modes, multi-select checkboxes, and bulk Apply / Remove operations.
- **Artwork Research Agent** — AI-powered cover art search using Gemini Google Search Grounding across Apple Music, Spotify, Deezer, Discogs, Wikipedia, MusicBrainz, and Cover Art Archive. Results are scored by exact album/year matching and source rank.
- **One-Click Broad Search** — Dedicated "Broad Search" button to search an artist's or composer's full discography for related artwork without manual text prompts.
- **Media Server Artwork Sync (Navidrome & Jellyfin)** — Cover art embedding now writes and overwrites folder-level image files (`cover.jpg`, `cover.png`, `folder.jpg`, `folder.png`) alongside embedded audio tags, ensuring media servers refresh artwork immediately.
- **Bounded LRU Image Cache** — Client-side LRU cache with configurable maximum size to prevent browser memory bloat while keeping recently-viewed artwork instantly available.
- **Instant Hover Track Previews** — Hovering over a numbered track pill on a group card previews that track's artwork in the card thumbnail.
- **1-Click Morphing Sync Icon** — Track number pills transform into a sync icon on hover when artwork is available, enabling instant 1-click synchronization to the full album without opening the tracks drawer.
- **SSRF Protection in `download_image`** — Strict `http://`/`https://` URL scheme validation before fetching any AI-supplied image URL, blocking local-file inclusion and protocol-smuggling attacks.

### Fixed
- **Anti-Recitation Grounded Lyric Retrieval** — Resolved Gemini API `finishReason: "RECITATION"` blocks by using timestamped line markers during generation to bypass Google's verbatim copyright filter, and automatically stripping line markers in Python (`strip_lrc_timestamps`) to deliver pure, authentic plain-text lyrics with zero hallucinated timestamps.
- **Natural Open-Web Grounding Search** — Replaced rigid, site-specific queries with natural human-style Google Search grounding (`[song title] lyrics`), eliminating false `LYRICS_NOT_FOUND` errors caused by restrictive site names or inaccurate album tags.
- **ID3 Writer `lang_code` Unbound Error** — Fixed `UnboundLocalError` in `_apply_id3_frames` when writing tags for tracks without an explicit language code.
- **Decoupled Lyrics from Master Forensic LLM** — Master LLM focuses purely on track identification and JSON metadata without overloading tokens on multi-stanza lyrics; lyric retrieval is handled exclusively by the dedicated `lyrics_llm` service.
- **Docker Production Static Asset Serving** — Configured FastAPI static files mount in `main.py` to serve `/app/static` with automatic fallback to `backend/app/static`.
- **Apple Music / iTunes API Integration** — Resolved `ContentTypeError` on `text/javascript` responses from the iTunes Search API, restoring reliable 1200×1200 master artwork retrieval.
- **Hallucinated Image URL Rejection** — Artwork validation now strictly filters dead 404 URLs from AI search grounding, ensuring only verified, accessible images are presented and applied.
- **Reactive Image Preview Fallback** — Replaced imperative DOM error injection with reactive state fallbacks, preventing distorted previews for CORS-restricted source URLs.

### Changed
- **Production Log Hardening** — Downgraded `async_upnp_client` logger from `DEBUG` to `INFO` to suppress verbose UPnP wire traces in production container logs.
- **UI Alignment Polish** — Standardised group card action buttons to matching outline icons, unified height, and pixel-perfect alignment.
- **User-Agent Version Sync** — Bumped outgoing HTTP `User-Agent` headers to `LexiTag/0.1.8`.

---

## [0.1.7] — 2026-09-01

### Added
- **Periodic Background Library Auto-Scanner** — Singleton `AutoScanScheduler` background service with configurable presets (1 h, 6 h, 12 h, 24 h, 7 d) and custom minute/hour intervals. Live next-scan countdown and last-scan timestamp shown in System Config settings.

### Changed
- **Full Responsive Redesign** — Navigation header, search bar, filter chips (now horizontally scrollable), metadata edit modals, bottom player bar, and history views all fully adapted for mobile, tablet, laptop, and ultra-wide displays.
- **Typography & Contrast Boost** — Significantly increased global text brightness, badge contrast, and input readability for maximum clarity on dark themes.

### Fixed
- **Persistent Tag Deletion** — Manually clearing a metadata field or lyrics in the track editor now correctly saves the blank state to the physical file on disk.

---

## [0.1.6] — 2026-08-22

### Added
- **System Logs & Live Debug Mode** — Persistent server log rotation (`data/lexitag.log`), runtime DEBUG/INFO log toggle endpoint, direct log download endpoint, and an interactive terminal log viewer in the Settings panel.
- **Universal Google Search Grounded Lyrics** — Gemini Google Search Grounding fallback for regional and Indian songs when LRCLIB has no match. Works even when artist tags are absent.

### Fixed
- **Metadata Protection Engine** — Manual edits and existing track metadata are guaranteed to never be erased or blanked by an AI Fix operation.
- **Backward History Revert** — Fixed revert logic to recover earlier non-empty metadata even when intermediate runs stored empty states.
- **Enhanced WAV & USLT Tag Parsing** — Fixed Mutagen `USLT.text` extraction and added explicit `ID3(filepath)` container scanning for `.wav` files.
- **Track Edit Modal Lyrics Fallback** — Lyrics endpoint now falls back to `tag_history` whenever the disk scanner returns empty text.

---

## [0.1.5] — 2026-08-21

### Added
- **Language Column** — Standalone Language column in the library table with sorting, column manager toggling, and re-ordering support.
- **Multi-Format Language Tag Extraction** — Reads language from ID3 (`TLAN`, `TXXX:Language`), FLAC (`language`, `lang`, `tlan`), and MP4 (`©lan`) tags.

### Fixed
- **Scanner Language Column** — Fixed missing `language` column in background scanner SQL `INSERT` and `UPDATE` queries.
- **History Revert** — Fixed revert routine to properly restore physical audio file tags and database records for all metadata attributes.

### Security
- Audited and updated all frontend and backend dependencies — 0 `npm audit` findings.

---

## [0.1.4] — 2026-06-09

### Security
- **Non-Root Docker Container** — Docker image now runs strictly as a dedicated non-root `lexitag` user.

### Fixed
- **Apple Silicon Cross-Compilation** — Resolved cross-compilation issues for reliable arm64 → amd64 server deployments.
- Upgraded multiple vulnerable frontend dependencies.

---

## [0.1.3] — 2026-05-15

### Security
- **Removed Backdoor Auth** — Eliminated the insecure `LEXITAG_MASTER_KEY` fallback authentication system.
- **Path Jailing** — Implemented strict directory path validation to prevent arbitrary file read/write access outside `MUSIC_DIR` and `DATA_DIR`.

### Changed
- Removed leftover debug and test scripts from the repository.

---

## [0.1.2] — 2026-03-20

### Added
- **AI Retry with Exponential Backoff** — 3-attempt retry on provider 503/429 errors with increasing wait intervals (8 s, 16 s).
- **Double-Cleaning Pass** — AI results are re-run through local junk patterns to prevent junk re-injection from AI search results.
- **HH:MM:SS Elapsed Timer** — Elapsed time display in the batch progress panel.
- **Stop & Clear Button** — Allows UI recovery when a batch job hangs or the backend restarts mid-run.

### Fixed
- **FLAC Browser Playback** — Switched to `FileResponse` with explicit `audio/flac` MIME type for correct browser streaming.
- **Manual Bulk Edits** — Language and Lyrics bulk edits now correctly write to disk.
- **Abort Progress Bar** — Fixed progress bar showing full batch count on a manual abort.
- **Library Source Gating** — Scanner now respects the enabled/disabled state per library source.
- **Junk Pattern Overmatch** — Fixed overly aggressive pattern that stripped artist names containing the word "Gaana".

### Changed
- Moved to dedicated ports: `3010` (frontend dev), `3020` (backend dev), `3030` (Docker / production).
