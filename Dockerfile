# ==========================================
# Stage 1: Build Frontend
# ==========================================
FROM --platform=$BUILDPLATFORM node:20-alpine AS frontend-build

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ==========================================
# Stage 2: Production Python Image
# ==========================================
FROM python:3.12-slim

WORKDIR /app

# Install system deps
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libc6-dev python3-dev ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./backend/

# Copy built frontend
COPY --from=frontend-build /build/frontend/dist /app/static

# Create data directory and non-root user
RUN mkdir -p /app/data /app/music && \
    adduser --disabled-password --gecos '' lexitag && \
    chown -R lexitag:lexitag /app

# Switch to non-root user
USER lexitag

# Expose port
EXPOSE 3030

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:3030/api/health')" || exit 1

# Run
ENV PYTHONPATH=/app
ENV MUSIC_DIR=/app/music
ENV DATA_DIR=/app/data
ENV ENV=production

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "3030", "--workers", "1"]
