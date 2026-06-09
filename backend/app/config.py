"""LexiTag configuration — loads settings from environment / .env file."""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root if it exists
_project_root = Path(__file__).resolve().parent.parent.parent
_env_path = _project_root / ".env"
if _env_path.exists():
    load_dotenv(_env_path)


class Settings:
    """Application settings pulling initial values from env or stable defaults."""

    # These will eventually move entirely to DB, keeping as initial fallbacks
    LLM_API_KEY: str = os.getenv("LLM_API_KEY", "")
    LLM_API_BASE_URL: str = os.getenv("LLM_API_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "gemini-2.0-flash")

    # Security settings
    LEXITAG_AUTH_TOKEN: str = os.getenv("LEXITAG_AUTH_TOKEN", "")
    LEXITAG_MASTER_KEY: str = os.getenv("LEXITAG_MASTER_KEY", "")
    ALLOWED_ORIGINS: list[str] = os.getenv("ALLOWED_ORIGINS", "*").split(",")
    ENV: str = os.getenv("ENV", "development")

    @property
    def effective_origins(self) -> list[str]:
        """In production, fall back to same-origin only if wildcard was not explicitly set."""
        if self.ENV == "production" and self.ALLOWED_ORIGINS == ["*"]:
            return []  # FastAPI/Starlette: empty list = same-origin only
        return self.ALLOWED_ORIGINS

    # System paths
    MUSIC_DIR: str = os.getenv("MUSIC_DIR", "/app/music")
    # Support production env vars while defaulting to a dedicated data/ folder for local dev visibility
    DATA_DIR: str = os.getenv("DATA_DIR", str(_project_root / "data"))

    # Google Custom Search (optional fallback when DuckDuckGo fails)
    # Get these free at: https://programmablesearchengine.google.com
    # API key from: https://console.cloud.google.com (enable Custom Search API)
    GOOGLE_CSE_KEY: str = os.getenv("GOOGLE_CSE_KEY", "")
    GOOGLE_CSE_CX: str = os.getenv("GOOGLE_CSE_CX", "")  # Search Engine ID

    @property
    def db_path(self) -> str:
        # User explicitly requested 'lexitage.db' filename
        return os.path.join(self.DATA_DIR, "lexitage.db")


settings = Settings()
