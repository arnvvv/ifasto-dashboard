// WTP survey client.

import { api } from "./api";

export interface SurveyCreate {
  venue_label: string;
  observed_wait_mins?: number | null;
  party_size: number;
  respondent: "tourist" | "local";
  would_skip: boolean;
  max_fee_yen?: number | null; // legacy, no longer collected
  offered_price_yen?: number | null;
  perceived_wait_mins?: number | null;
  stated_max_wait_mins?: number | null;
  time_pressure?: "hurry" | "normal" | "relaxed" | null;
  first_visit?: boolean | null;
  reason?: string | null;
  notes?: string | null;
}

export interface SurveyRead extends SurveyCreate {
  id: string;
  restaurant_id: string | null;
  created_at: string;
}

export interface SurveySummary {
  total: number;
  overall_yes_rate: number | null;
  median_stated_max_wait: number | null;
  by_price: { price: number; n: number; yes: number; yes_rate: number | null }[];
  by_respondent: Record<string, { n: number; yes_rate: number | null }>;
  by_venue: { venue: string; n: number; yes_rate: number | null }[];
}

export const surveysApi = {
  summary: (token: string) => api<SurveySummary>("/api/surveys/summary", { token }),
  create: (token: string, body: SurveyCreate) =>
    api<SurveyRead>("/api/surveys", { method: "POST", body, token }),
  list: (token: string, limit = 200) =>
    api<SurveyRead[]>(`/api/surveys?limit=${limit}`, { token }),
};
