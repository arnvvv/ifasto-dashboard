"""WTP survey API — logs field willingness-to-pay interviews.

Any authenticated user can log (the founder standing in a Shibuya queue on
their phone). Rows go to wtp_surveys, NOT queue_entries — stated preference
stacks with revealed preference at analysis time, never in the operational
tables.
"""

from __future__ import annotations

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
