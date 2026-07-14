"""ifasto dashboard backend — FastAPI entry point."""

import time
from collections import defaultdict, deque

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.database import SessionLocal

from app.api import pricing as pricing_api
from app.api import queue as queue_api
from app.api import reports as reports_api
from app.api import settings as settings_api
from app.api import surveys as surveys_api
from app.api import websockets as ws_api
from app.auth.users import auth_backend, current_active_user, fastapi_users
from app.models.user import User
from app.schemas.user import UserRead, UserUpdate

app = FastAPI(
    title="ifasto dashboard backend",
    version="0.1.0",
    description="Restaurant operator dashboard for ifasto.",
)

# Frontend and backend share the app.ifasto.com origin in production
# (Nginx routes /api/* to here, everything else to Next.js). CORS is
# really only needed for local dev where they run on different ports.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://app.ifasto.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Production hardening: security headers on every API response, and a
# brute-force limiter on the login endpoint. In-memory state is fine — the
# service runs a single uvicorn worker (same constraint as the WS broadcaster).
# ---------------------------------------------------------------------------

_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "Cache-Control": "no-store",  # API responses carry queue/pricing data
}

LOGIN_WINDOW_S = 300
LOGIN_MAX_ATTEMPTS = 10
_login_attempts: dict[str, deque] = defaultdict(deque)


@app.middleware("http")
async def security_and_login_limit(request: Request, call_next):
    # Rate-limit the password login endpoint per client IP (10 per 5 min).
    if request.url.path == "/api/auth/jwt/login" and request.method == "POST":
        # Nginx sits in front; X-Forwarded-For's first hop is the client.
        fwd = request.headers.get("x-forwarded-for", "")
        ip = fwd.split(",")[0].strip() or (request.client.host if request.client else "unknown")
        now = time.monotonic()
        bucket = _login_attempts[ip]
        while bucket and now - bucket[0] > LOGIN_WINDOW_S:
            bucket.popleft()
        if len(bucket) >= LOGIN_MAX_ATTEMPTS:
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many login attempts. Try again in a few minutes."},
                headers=_SECURITY_HEADERS,
            )
        bucket.append(now)
        # Opportunistic cleanup so the map can't grow unbounded.
        if len(_login_attempts) > 10_000:
            _login_attempts.clear()

    response = await call_next(request)
    for k, v in _SECURITY_HEADERS.items():
        response.headers.setdefault(k, v)
    return response


@app.get("/health")
async def health():
    """Deep health: verifies the database answers, not just that the process
    is alive. The hourly monitoring routine alerts on non-200."""
    try:
        async with SessionLocal() as session:
            await session.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    body = {
        "status": "ok" if db_ok else "degraded",
        "service": "ifasto-dashboard-backend",
        "db": "ok" if db_ok else "unreachable",
    }
    return JSONResponse(status_code=200 if db_ok else 503, content=body)


@app.get("/api/me", response_model=UserRead)
async def me(user: User = Depends(current_active_user)):
    """Currently-logged-in user. Frontend uses this to check session validity."""
    return user


# Login + logout. JWT bearer in Authorization header.
app.include_router(
    fastapi_users.get_auth_router(auth_backend),
    prefix="/api/auth/jwt",
    tags=["auth"],
)

# Self-service profile update (name + language pref only, per UserUpdate schema).
# Role + restaurant change require the admin CLI.
app.include_router(
    fastapi_users.get_users_router(UserRead, UserUpdate),
    prefix="/api/users",
    tags=["users"],
)

# NOTE: public registration is intentionally NOT exposed. Owner accounts are
# minted via the admin CLI during the pilot phase (per the build spec).

# Queue management — REST + WebSocket.
app.include_router(queue_api.router, prefix="/api/queue", tags=["queue"])
app.include_router(ws_api.router, prefix="/api", tags=["queue-ws"])

# Pricing bridge — server-side proxy to the ML pricing engine, gated on
# VenueSettings (paused + per-category caps).
app.include_router(pricing_api.router, prefix="/api/pricing", tags=["pricing"])

# Venue settings — pause button + caps (PATCH is owner/manager only).
app.include_router(settings_api.router, prefix="/api/settings", tags=["settings"])

# Reports — end-of-day summary + week-over-week trends.
app.include_router(reports_api.router, prefix="/api/reports", tags=["reports"])

# WTP field surveys — stated-preference rows, separate from operational data.
app.include_router(surveys_api.router, prefix="/api/surveys", tags=["surveys"])
