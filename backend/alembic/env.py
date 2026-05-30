"""Alembic environment script.

- Pulls DB URL from app.config.settings (so .env works the same as the app).
- Imports app.models so autogenerate can detect all tables.
- Uses sync URL (psycopg/psycopg2 style) for Alembic; the app itself uses async.
"""

import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import engine_from_config, pool
from alembic import context

# Make `app` importable.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.database import Base  # noqa: E402
from app import models  # noqa: F401,E402 — import side effects register models

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Alembic uses sync drivers; convert the async URL.
sync_url = settings.database_url.replace("+asyncpg", "")
config.set_main_option("sqlalchemy.url", sync_url)

target_metadata = Base.metadata


def render_item(type_, obj, autogen_context):
    """Render fastapi-users-db-sqlalchemy's custom GUID as standard sa.UUID.
    On Postgres they map to the same underlying column type — but rendering
    as sa.UUID avoids needing to import fastapi_users_db_sqlalchemy into
    every migration file."""
    if type_ == "type" and obj.__class__.__module__ == "fastapi_users_db_sqlalchemy.generics":
        return "sa.UUID(as_uuid=True)"
    return False  # fall through to Alembic's default rendering


def run_migrations_offline() -> None:
    context.configure(
        url=sync_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_item=render_item,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_item=render_item,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
