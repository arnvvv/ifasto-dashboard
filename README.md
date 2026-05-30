# ifasto-dashboard

Restaurant operator dashboard for ifasto. Runs at **https://app.ifasto.com**.

Separate from:
- `ifasto.com` (marketing site, Vercel, repo `ifasto-website`)
- `api.ifasto.com` (pricing engine, droplet, repo `ifasto-ml`)

## Structure

```
ifasto-dashboard/
├── frontend/    Next.js 16 + Tailwind v4 + Playfair/Inter/JetBrains Mono
├── backend/     FastAPI + SQLAlchemy 2 async + Postgres + FastAPI-Users
└── README.md
```

## Architecture

Both services run on the existing DigitalOcean Singapore droplet as
independent systemd units, behind Nginx + Let's Encrypt at `app.ifasto.com`:

- `/api/*` → backend (Gunicorn + Uvicorn, port 8000)
- everything else → frontend (Next.js standalone, port 3001)

The dashboard does NOT modify the pricing engine. The pause/cap logic
is enforced in the dashboard backend (which gates calls to `/v2/price`).
The engine stays exactly as it is.

## Local dev

```bash
# Backend
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Frontend at `http://localhost:3000`, backend at `http://localhost:8000`.

## Payment model

Model B: ifasto does NOT collect customer money or move funds. The
restaurant collects the skip fee through their own payment method;
the dashboard records every transaction and calculates the 70/30
split. ifasto invoices the restaurant monthly for the 30% service fee.

No Stripe Connect, no payouts, no customer card handling in this build.
