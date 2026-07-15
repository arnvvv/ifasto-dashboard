"""Schemas for the daily/trends report — the operator's renewal artifact."""

from __future__ import annotations

from pydantic import BaseModel


class DailyRow(BaseModel):
    date: str  # JST date, ISO
    joined: int
    seated: int
    walked_away: int
    walkaway_rate: float | None  # walked / (seated + walked), None if no outcomes
    premium_sold: int
    premium_revenue: int  # yen, from Transaction rows
    median_wait_mins: float | None  # seated parties, all types
    median_wait_regular: float | None
    median_wait_premium: float | None
    premium_wait_saving_mins: float | None  # regular median - premium median
    walkaway_spike: bool  # rate > 1.5x window mean (min 3 walk-aways)


class WeekComparison(BaseModel):
    seated: int
    walked_away: int
    premium_sold: int
    premium_revenue: int
    median_wait_mins: float | None


class DailyReport(BaseModel):
    days: int
    rows: list[DailyRow]
    this_week: WeekComparison
    prior_week: WeekComparison


class StatementLine(BaseModel):
    date: str  # JST date of sale, ISO
    time: str  # JST HH:MM
    ticket_no: int | None
    party_size: int
    gross_amount: int  # yen
    restaurant_share: int  # 70%
    ifasto_fee: int  # 30%


class MonthlyStatement(BaseModel):
    month: str  # YYYY-MM (JST)
    venue_name: str
    lines: list[StatementLine]
    passes_sold: int
    gross_total: int
    restaurant_total: int
    ifasto_total: int
