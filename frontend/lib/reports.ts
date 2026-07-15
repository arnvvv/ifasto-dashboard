// Reports client — daily summary + week-over-week trends.

import { api } from "./api";

export interface DailyRow {
  date: string;
  joined: number;
  seated: number;
  walked_away: number;
  walkaway_rate: number | null;
  premium_sold: number;
  premium_revenue: number;
  median_wait_mins: number | null;
  median_wait_regular: number | null;
  median_wait_premium: number | null;
  premium_wait_saving_mins: number | null;
  walkaway_spike: boolean;
}

export interface WeekComparison {
  seated: number;
  walked_away: number;
  premium_sold: number;
  premium_revenue: number;
  median_wait_mins: number | null;
}

export interface DailyReport {
  days: number;
  rows: DailyRow[];
  this_week: WeekComparison;
  prior_week: WeekComparison;
}

export const reportsApi = {
  daily: (token: string, days = 28) =>
    api<DailyReport>(`/api/reports/daily?days=${days}`, { token }),
};

export interface StatementLine {
  date: string;
  time: string;
  ticket_no: number | null;
  party_size: number;
  gross_amount: number;
  restaurant_share: number;
  ifasto_fee: number;
}

export interface MonthlyStatement {
  month: string;
  venue_name: string;
  lines: StatementLine[];
  passes_sold: number;
  gross_total: number;
  restaurant_total: number;
  ifasto_total: number;
}

export const statementApi = {
  get: (token: string, month?: string) =>
    api<MonthlyStatement>(
      `/api/reports/statement${month ? `?month=${month}` : ""}`,
      { token }
    ),
};
