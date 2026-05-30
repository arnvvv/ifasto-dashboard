"""ifasto dashboard backend — FastAPI entry point."""

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

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


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ifasto-dashboard-backend"}


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
