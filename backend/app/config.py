import os
import secrets
from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
# Serverless hosts (Vercel) only allow writes under /tmp, so the data folder can be moved.
DATA_DIR = Path(os.environ.get("DATA_DIR") or BACKEND_DIR / "data")
# On Vercel threads stop once the response is sent, so generation runs execute inside the request.
ON_VERCEL = bool(os.environ.get("VERCEL"))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    api_prefix: str = "/api/v1"
    # SQLite by default; set DATABASE_URL to a Postgres URL (e.g. Neon) for multi-instance hosting.
    database_url: str = f"sqlite:///{(DATA_DIR / 'app.db').as_posix()}"
    # Comma-separated list of origins allowed to call the API from a browser.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Leave empty to generate (and persist) a random key: in data/.secret_key for SQLite,
    # in the database otherwise, so every server instance shares it.
    secret_key: str = ""
    access_token_minutes: int = 60 * 24 * 7
    max_upload_bytes: int = 2 * 1024 * 1024
    inline_runs: bool = ON_VERCEL
    # Optional: enables Claude-written scenarios and reports in the AI agent.
    anthropic_api_key: str = ""
    llm_model: str = "claude-sonnet-5-5"
    llm_timeout_seconds: float = 90
    llm_max_calls_per_run: int = 4

    @field_validator("database_url")
    @classmethod
    def _postgres_driver(cls, value: str) -> str:
        """Hosted Postgres URLs say postgres:// or postgresql://; SQLAlchemy needs the psycopg driver named."""
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value[len(prefix):]
        return value

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not settings.secret_key and settings.is_sqlite:
        key_file = DATA_DIR / ".secret_key"
        if not key_file.exists():
            key_file.write_text(secrets.token_urlsafe(48), encoding="utf-8")
        settings.secret_key = key_file.read_text(encoding="utf-8").strip()
    return settings
