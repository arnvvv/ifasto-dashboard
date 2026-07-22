"""WTP survey API — logs field willingness-to-pay interviews.

Any authenticated user can log (the founder standing in a Shibuya queue on
their phone). Rows go to wtp_surveys, NOT queue_entries — stated preference
stacks with revealed preference at analysis time, never in the operational
tables.
"""

from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.users import current_active_user
from app.database import get_session
from app.models.operations import WtpSurvey
from app.models.user import User
from app.schemas.surveys import SurveyCreate, SurveyRead

router = APIRouter()


@router.post("", response_model=SurveyRead, status_code=201)
async def create_survey(
    body: SurveyCreate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> WtpSurvey:
    row = WtpSurvey(**body.model_dump())
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


@router.get("", response_model=list[SurveyRead])
async def list_surveys(
    limit: int = Query(default=200, ge=1, le=1000),
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> list[WtpSurvey]:
    stmt = select(WtpSurvey).order_by(WtpSurvey.created_at.desc()).limit(limit)
    return list((await session.execute(stmt)).scalars().all())


@router.get("/summary")
async def survey_summary(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Field demand curve from v2 rows. Yes-rate by the RANDOMIZED offered
    price (the whole point of randomizing: acceptance-by-price traces the
    curve), plus tourist/local split and per-venue counts. Founder field
    tool, refreshed each evening after a survey session."""
    rows = list((await session.execute(select(WtpSurvey))).scalars().all())
    v2 = [r for r in rows if r.offered_price_yen is not None]

    price: dict = defaultdict(lambda: {"n": 0, "yes": 0})
    resp: dict = defaultdict(lambda: {"n": 0, "yes": 0})
    venue: dict = defaultdict(lambda: {"n": 0, "yes": 0})
    max_waits: list[int] = []
    for r in v2:
        for bucket, key in ((price, r.offered_price_yen), (resp, r.respondent), (venue, r.venue_label)):
            bucket[key]["n"] += 1
            bucket[key]["yes"] += 1 if r.would_skip else 0
        if r.stated_max_wait_mins is not None:
            max_waits.append(r.stated_max_wait_mins)

    def rate(d: dict) -> float | None:
        return round(d["yes"] / d["n"], 3) if d["n"] else None

    max_waits.sort()
    total_yes = sum(1 for r in v2 if r.would_skip)
    return {
        "total": len(v2),
        "overall_yes_rate": round(total_yes / len(v2), 3) if v2 else None,
        "median_stated_max_wait": max_waits[len(max_waits) // 2] if max_waits else None,
        "by_price": [
            {"price": p, "n": d["n"], "yes": d["yes"], "yes_rate": rate(d)}
            for p, d in sorted(price.items())
        ],
        "by_respondent": {k: {"n": d["n"], "yes_rate": rate(d)} for k, d in resp.items()},
        "by_venue": [
            {"venue": k, "n": d["n"], "yes_rate": rate(d)}
            for k, d in sorted(venue.items(), key=lambda kv: -kv[1]["n"])
        ],
    }
