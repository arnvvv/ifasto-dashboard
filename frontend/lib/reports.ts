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
