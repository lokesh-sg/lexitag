# 🏷️ LexiTag (v0.1.3)
**Intelligent Music Metadata Manager with AI-Powered Junk Discovery**

LexiTag is a state-of-the-art music library manager designed to clean, organize, and discover junk in your track metadata using advanced pattern matching and an asynchronous SQLite engine.

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
      - /path/to/your/music:/app/music:ro
    restart: unless-stopped
```

1. Create a `docker-compose.yml` with the content above.
2. Run `docker compose up -d`.
3. Access the UI at **http://localhost:3030**.

## 🛠️ Key Features
- **Auto-Discovery Engine**: Automatically flags site-specific junk metadata during scans.
- **Interactive Review Dashboard**: Easily Approve or Dismiss discovered candidates.
- **Asynchronous Database**: Smooth, non-blocking track analysis.
- **Silent Production Logs**: Suppresses high-frequency background polling for clear output.

---

### ⚙️ Deployment Notes
- **Music Path**: Ensure the volume mount points to your physical music library.
- **Database**: The database is persisted in the `./data` folder on your host.

**Official Repository**: [GitHub (Source)](https://github.com/lokeshsg/lexitag)
