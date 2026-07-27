"""Pricing API — server-side bridge to the ML pricing engine (/v2/price).

Thin transport wrapper over app/services/quote_service.py, which owns the
guardrails (pause, pass-count cap, large-party cap, service hours), the
engine round-trip, and PriceQuoteLog conversion logging. The same service
backs the public guest fast-pass endpoints so staff and guest quotes can
never drift apart.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.users import current_active_user
from app.database import get_session
from app.models.user import User
from app.schemas.pricing import PriceQuote, PriceQuoteRequest
from app.services.quote_service import QuoteRefused, get_quote

router = APIRouter()

_STATUS_BY_REASON = {
    "venue_not_found": status.HTTP_404_NOT_FOUND,
    "engine_unavailable": status.HTTP_503_SERVICE_UNAVAILABLE,
}


@router.post("/quote", response_model=PriceQuote)
async def quote_price(
    body: PriceQuoteRequest,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> PriceQuote:
    try:
        result = await get_quote(
            session,
            user.restaurant_id,
            body.party_size,
            source=body.source,
            service_id=body.service_id,
            session_id=body.session_id,
        )
    except QuoteRefused as exc:
        raise HTTPException(
            _STATUS_BY_REASON.get(exc.reason, status.HTTP_409_CONFLICT),
            detail={"reason": exc.reason, "message": exc.message},
        )
    return PriceQuote(**result)
