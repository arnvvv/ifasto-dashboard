"""ifasto dashboard backend — FastAPI entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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


# Auth + venue + transaction routers wire in here in later steps:
#   from app.api import auth, venues, transactions
#   app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
#   app.include_router(venues.router, prefix="/api/venues", tags=["venues"])
#   app.include_router(transactions.router, prefix="/api/transactions", tags=["transactions"])
