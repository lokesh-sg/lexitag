#!/bin/bash

# LexiTag Clean Restart Script

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

echo "[LexiTag] Cleaning up old processes..."
lsof -ti :3010 | xargs kill -9 2>/dev/null || true
lsof -ti :3020 | xargs kill -9 2>/dev/null || true
pkill -9 -f "vite --port 3010" 2>/dev/null || true
pkill -9 -f "uvicorn app.main:app" 2>/dev/null || true
pkill -9 -f "esbuild" 2>/dev/null || true

sleep 2

echo "[LexiTag] Initializing Backend..."
cd "$BACKEND_DIR"
source .venv/bin/activate
export DATA_DIR="$PROJECT_ROOT/data"
export MUSIC_DIR="/Volumes/Media/Music/UnOrganized"

nohup python3 -m uvicorn app.main:app --host 0.0.0.0 --port 3020 --reload --reload-dir app > backend.log 2>&1 &
echo "[LexiTag] Backend started on port 3020 (PID: $!)"

echo "[LexiTag] Initializing Frontend..."
cd "$FRONTEND_DIR"
nohup npm run dev -- --port 3010 > frontend.log 2>&1 &
echo "[LexiTag] Frontend started on port 3010 (PID: $!)"

echo "[LexiTag] Restart complete. Services are warming up..."
