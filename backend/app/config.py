"""Centralized settings via pydantic-settings. Reads from environment + .env."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Database — async driver for SQLAlchemy 2.x async session.
    database_url: str = (
        "postgresql+asyncpg://ifasto_app:changeme@localhost:5432/ifasto_dashboard"
    )

    # JWT auth (FastAPI-Users)
    jwt_secret: str = "dev-secret-change-in-production"
    jwt_lifetime_seconds: int = 86400 * 7  # 7 days

    # The existing pricing engine — dashboard reads queue state + calls /v2/price
    pricing_engine_url: str = "https://api.ifasto.com"

    # Redis (shared with the pricing engine)
    redis_url: str = "redis://127.0.0.1:6379/1"


settings = Settings()
