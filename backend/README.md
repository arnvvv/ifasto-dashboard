# ifasto-dashboard backend

FastAPI + SQLAlchemy 2 (async) + Postgres + FastAPI-Users for auth.

## Local dev

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # fill in real values
uvicorn main:app --reload --port 8000
```

`http://localhost:8000/health` should return `{"status":"ok"}`.

## Production

Runs as a systemd service on the droplet, Gunicorn + Uvicorn workers behind Nginx at `app.ifasto.com/api/*`. See repo root README + SETUP.md (added in deploy step).

## Schema migrations

Alembic. Initialized in Phase 1 Step 4.

```bash
alembic upgrade head            # apply all pending migrations
alembic revision --autogenerate -m "describe change"
```

## Admin CLI

`python cli.py create-owner --email ... --name ... --restaurant-name ...` mints owner accounts during the pilot phase.
