"""Founder admin API — cross-venue overview.

Superuser-gated (is_superuser on the founder's account, set via CLI).
Regular owners/managers/staff get 403: venue accounts must never see other
venues' numbers. Aggregation is Python-side over today's rows, same
reasoning as reports.py — pilot volumes are tiny.
"""

from __future__ import annotations

from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.users import current_superuser
from app.database import get_session
from app.models.operations import (
    QueueEntry,
    QueueEntryStatus,
    QueueEntryType,
    Transaction,
)
from app.models.restaurant import Restaurant, VenueSettings
from app.models.user import User

router = APIRouter()

JST = ZoneInfo("Asia/Tokyo")


def _today_start_utc() -> datetime:
    today_jst = datetime.now(JST).date()
    return datetime.combine(today_jst, time.min, tzinfo=JST).astimezone(timezone.utc)


@router.get("/overview")
async def overview(
    user: User = Depends(current_superuser),
    session: AsyncSession = Depends(get_session),
) -> dict:
    start = _today_start_utc()

    venues = (await session.execute(select(Restaurant))).scalars().all()
    entries = (await session.execute(
        select(QueueEntry).where(QueueEntry.joined_at >= start)
    )).scalars().all()
    txs = (await session.execute(
        select(Transaction).where(Transaction.created_at >= start)
    )).scalars().all()
    settings_rows = (await session.execute(select(VenueSettings))).scalars().all()
    paused = {vs.restaurant_id for vs in settings_rows if vs.premium_paused}

    by_venue: dict = {}
    for v in venues:
        by_venue[v.id] = {
            "venue_id": str(v.id),
            "name": v.name,
            "name_ja": v.name_ja,
            "venue_type": v.venue_type.value,
            "premium_paused": v.id in paused,
            "has_qr": v.qr_token is not None,
            "waiting_now": 0,
            "joined_today": 0,
            "seated_today": 0,
            "walked_today": 0,
            "premium_sold_today": 0,
            "premium_revenue_today": 0,
            "ifasto_fee_today": 0,
            "last_activity": None,
        }

    for e in entries:
        row = by_venue.get(e.restaurant_id)
        if row is None:
            continue
        row["joined_today"] += 1
        if e.status == QueueEntryStatus.waiting:
            row["waiting_now"] += 1
        elif e.status == QueueEntryStatus.seated:
            row["seated_today"] += 1
        elif e.status == QueueEntryStatus.walked_away:
            row["walked_today"] += 1
        ts = e.seated_at or e.walked_away_at or e.joined_at
        aware = ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
        if row["last_activity"] is None or aware.isoformat() > row["last_activity"]:
            row["last_activity"] = aware.isoformat()

    for tx in txs:
        row = by_venue.get(tx.restaurant_id)
        if row is None:
            continue
        row["premium_sold_today"] += 1
        row["premium_revenue_today"] += tx.gross_amount
        row["ifasto_fee_today"] += tx.ifasto_fee

    rows = sorted(by_venue.values(), key=lambda r: r["name"].lower())
    return {
        "date_jst": datetime.now(JST).date().isoformat(),
        "venues": rows,
        "totals": {
            "venues": len(rows),
            "waiting_now": sum(r["waiting_now"] for r in rows),
            "joined_today": sum(r["joined_today"] for r in rows),
            "seated_today": sum(r["seated_today"] for r in rows),
            "walked_today": sum(r["walked_today"] for r in rows),
            "premium_sold_today": sum(r["premium_sold_today"] for r in rows),
            "premium_revenue_today": sum(r["premium_revenue_today"] for r in rows),
            "ifasto_fee_today": sum(r["ifasto_fee_today"] for r in rows),
        },
    }
