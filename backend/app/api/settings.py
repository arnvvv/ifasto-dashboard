"""Venue settings API — the operator's pause button and pricing caps.

GET is open to any authenticated user of the restaurant (staff need to see
whether premium is paused). PATCH is owner/manager only. The quote path in
app/api/pricing.py already enforces these values on every quote, so a PATCH
takes effect on the very next quote with no engine deploy.
"""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.users import current_active_user, require_role
from app.database import get_session
from app.models.restaurant import Restaurant, VenueSettings
from app.models.user import User, UserRole
from app.schemas.settings import VenueSettingsRead, VenueSettingsUpdate
from app.services.engine_payload import _VS_DEFAULTS

router = APIRouter()


async def _get_or_create(session: AsyncSession, restaurant_id) -> VenueSettings:
    """Fetch the row, creating a defaults-populated PERSISTED one if missing
    (unlike the pricing path's read-only transient, a settings edit needs a
    real row to write to)."""
    vs = await session.get(VenueSettings, restaurant_id)
    if vs is None:
        vs = VenueSettings(restaurant_id=restaurant_id, **_VS_DEFAULTS)
        session.add(vs)
        await session.commit()
        await session.refresh(vs)
    return vs


@router.get("", response_model=VenueSettingsRead)
async def get_settings(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> VenueSettings:
    return await _get_or_create(session, user.restaurant_id)


@router.patch("", response_model=VenueSettingsRead)
async def update_settings(
    body: VenueSettingsUpdate,
    user: User = Depends(require_role(UserRole.owner, UserRole.manager)),
    session: AsyncSession = Depends(get_session),
) -> VenueSettings:
    vs = await _get_or_create(session, user.restaurant_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(vs, field, value)
    await session.commit()
    await session.refresh(vs)
    return vs


def _qr_payload(venue: Restaurant) -> dict:
    return {
        "qr_token": venue.qr_token,
        "guest_url": f"https://app.ifasto.com/q/{venue.qr_token}" if venue.qr_token else None,
        "venue_name": venue.name,
        "venue_name_ja": venue.name_ja,
        "logo_url": venue.logo_url,
    }


@router.get("/qr")
async def get_qr(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """The venue's guest-join QR target, for the printable /ops/qr sign.
    Mints a token on first read so venues created before the QR feature
    work without a manual step."""
    venue = await session.get(Restaurant, user.restaurant_id)
    if venue is None:
        raise HTTPException(status_code=404, detail="Venue not found.")
    if not venue.qr_token:
        venue.qr_token = secrets.token_urlsafe(18)
        await session.commit()
        await session.refresh(venue)
    return _qr_payload(venue)


@router.post("/qr/rotate")
async def rotate_qr(
    user: User = Depends(require_role(UserRole.owner, UserRole.manager)),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Invalidate the printed QR and mint a new token (leak/abuse response).
    The old sign stops working the moment this returns — reprint first."""
    venue = await session.get(Restaurant, user.restaurant_id)
    if venue is None:
        raise HTTPException(status_code=404, detail="Venue not found.")
    venue.qr_token = secrets.token_urlsafe(18)
    await session.commit()
    await session.refresh(venue)
    return _qr_payload(venue)
