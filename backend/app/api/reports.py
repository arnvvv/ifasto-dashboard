"""Reports API — end-of-day summary + week-over-week trends.

This is the number the operator renews on ("premium guests waited N minutes
less, walk-aways down X%") and the cannibalization guard (walk-away spikes
flag days where the paid lane may be hurting the free line — the pause
button in the header is the remedy).

Aggregation is Python-side over the window's rows: pilot volumes are tiny,
and it keeps the JST bucketing + median math readable and testable.
"""

from __future__ import annotations

import statistics
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.users import current_active_user, require_role
from app.database import get_session
from app.models.restaurant import Restaurant
from app.models.operations import (
    QueueEntry,
    QueueEntryStatus,
    QueueEntryType,
    Transaction,
)
from app.models.user import User, UserRole
from app.schemas.reports import (
    DailyReport,
    DailyRow,
    MonthlyStatement,
    StatementLine,
    WeekComparison,
)

router = APIRouter()

JST = ZoneInfo("Asia/Tokyo")

# A day only counts as a walk-away "spike" with real volume behind it —
# 1 walk-away out of 2 outcomes is noise, not cannibalization.
SPIKE_MULTIPLIER = 1.5
SPIKE_MIN_WALKAWAYS = 3


def _jst_date(dt: datetime) -> str:
    aware = dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return aware.astimezone(JST).date().isoformat()


def _wait_mins(entry: QueueEntry) -> float | None:
    if entry.seated_at is None:
        return None
    seated = entry.seated_at if entry.seated_at.tzinfo else entry.seated_at.replace(tzinfo=timezone.utc)
    joined = entry.joined_at if entry.joined_at.tzinfo else entry.joined_at.replace(tzinfo=timezone.utc)
    return (seated - joined).total_seconds() / 60.0


def _median(values: list[float]) -> float | None:
    return round(statistics.median(values), 1) if values else None


@router.get("/daily", response_model=DailyReport)
async def daily_report(
    days: int = Query(default=28, ge=1, le=90),
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_session),
) -> DailyReport:
    window_start = datetime.now(timezone.utc) - timedelta(days=days)

    entries = list((await session.execute(
        select(QueueEntry).where(
            QueueEntry.restaurant_id == user.restaurant_id,
            QueueEntry.joined_at >= window_start,
        )
    )).scalars())

    transactions = list((await session.execute(
        select(Transaction).where(
            Transaction.restaurant_id == user.restaurant_id,
            Transaction.created_at >= window_start,
        )
    )).scalars())

    # ---- Bucket by JST date ----
    buckets: dict[str, list[QueueEntry]] = {}
    for e in entries:
        buckets.setdefault(_jst_date(e.joined_at), []).append(e)
    tx_by_date: dict[str, list[Transaction]] = {}
    for t in transactions:
        tx_by_date.setdefault(_jst_date(t.created_at), []).append(t)

    rows: list[DailyRow] = []
    for date_str in sorted(set(buckets) | set(tx_by_date)):
        day = buckets.get(date_str, [])
        seated = [e for e in day if e.status == QueueEntryStatus.seated]
        walked = [e for e in day if e.status == QueueEntryStatus.walked_away]
        outcomes = len(seated) + len(walked)

        waits_all = [w for e in seated if (w := _wait_mins(e)) is not None]
        waits_reg = [w for e in seated if e.entry_type == QueueEntryType.regular
                     and (w := _wait_mins(e)) is not None]
        waits_prem = [w for e in seated if e.entry_type == QueueEntryType.premium
                      and (w := _wait_mins(e)) is not None]
        med_reg = _median(waits_reg)
        med_prem = _median(waits_prem)

        day_tx = tx_by_date.get(date_str, [])
        rows.append(DailyRow(
            date=date_str,
            joined=len(day),
            seated=len(seated),
            walked_away=len(walked),
            walkaway_rate=round(len(walked) / outcomes, 3) if outcomes else None,
            premium_sold=len(day_tx),
            premium_revenue=sum(t.gross_amount for t in day_tx),
            median_wait_mins=_median(waits_all),
            median_wait_regular=med_reg,
            median_wait_premium=med_prem,
            premium_wait_saving_mins=(
                round(med_reg - med_prem, 1)
                if med_reg is not None and med_prem is not None else None
            ),
            walkaway_spike=False,  # filled below once the window mean exists
        ))

    # ---- Cannibalization flags (vs window mean walk-away rate) ----
    rates = [r.walkaway_rate for r in rows if r.walkaway_rate is not None]
    if rates:
        mean_rate = sum(rates) / len(rates)
        for r in rows:
            r.walkaway_spike = (
                r.walkaway_rate is not None
                and r.walked_away >= SPIKE_MIN_WALKAWAYS
                and mean_rate > 0
                and r.walkaway_rate > SPIKE_MULTIPLIER * mean_rate
            )

    # ---- Week-over-week ----
    today_jst = datetime.now(JST).date()
    def _week(offset_days: int) -> WeekComparison:
        lo = today_jst - timedelta(days=offset_days + 6)
        hi = today_jst - timedelta(days=offset_days)
        in_week = [r for r in rows if lo.isoformat() <= r.date <= hi.isoformat()]
        waits = [r.median_wait_mins for r in in_week if r.median_wait_mins is not None]
        return WeekComparison(
            seated=sum(r.seated for r in in_week),
            walked_away=sum(r.walked_away for r in in_week),
            premium_sold=sum(r.premium_sold for r in in_week),
            premium_revenue=sum(r.premium_revenue for r in in_week),
            median_wait_mins=_median(waits),
        )

    return DailyReport(
        days=days,
        rows=rows,
        this_week=_week(0),
        prior_week=_week(7),
    )


@router.get("/statement", response_model=MonthlyStatement)
async def monthly_statement(
    month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    user: User = Depends(require_role(UserRole.owner, UserRole.manager)),
    session: AsyncSession = Depends(get_session),
) -> MonthlyStatement:
    """Month-to-date (or a past month's) fast-pass sales with the 70/30
    split — the invoicing artifact for Model B. Restaurant collected the
    gross directly; ifasto invoices ifasto_total at month end."""
    now_jst = datetime.now(JST)
    month_str = month or now_jst.strftime("%Y-%m")
    year, mon = int(month_str[:4]), int(month_str[5:7])

    # JST month bounds converted to UTC for the created_at filter.
    start_jst = datetime(year, mon, 1, tzinfo=JST)
    end_jst = datetime(year + 1, 1, 1, tzinfo=JST) if mon == 12 else datetime(year, mon + 1, 1, tzinfo=JST)

    stmt = (
        select(Transaction, QueueEntry)
        .join(QueueEntry, Transaction.queue_entry_id == QueueEntry.id)
        .where(
            Transaction.restaurant_id == user.restaurant_id,
            Transaction.created_at >= start_jst.astimezone(timezone.utc),
            Transaction.created_at < end_jst.astimezone(timezone.utc),
        )
        .order_by(Transaction.created_at)
    )
    rows = (await session.execute(stmt)).all()
    venue = await session.get(Restaurant, user.restaurant_id)

    lines: list[StatementLine] = []
    for tx, entry in rows:
        created = tx.created_at if tx.created_at.tzinfo else tx.created_at.replace(tzinfo=timezone.utc)
        local = created.astimezone(JST)
        lines.append(StatementLine(
            date=local.date().isoformat(),
            time=local.strftime("%H:%M"),
            ticket_no=entry.ticket_no,
            party_size=entry.party_size,
            gross_amount=tx.gross_amount,
            restaurant_share=tx.restaurant_share,
            ifasto_fee=tx.ifasto_fee,
        ))

    return MonthlyStatement(
        month=month_str,
        venue_name=(venue.name_ja or venue.name) if venue else "",
        lines=lines,
        passes_sold=len(lines),
        gross_total=sum(l.gross_amount for l in lines),
        restaurant_total=sum(l.restaurant_share for l in lines),
        ifasto_total=sum(l.ifasto_fee for l in lines),
    )
