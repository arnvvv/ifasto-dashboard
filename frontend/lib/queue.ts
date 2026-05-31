// Queue domain types + REST helpers. Mirrors backend/app/schemas/queue.py.

import { api, API_BASE } from "./api";

export type QueueEntryType = "regular" | "premium";
export type QueueEntryStatus = "waiting" | "seated" | "walked_away";

export interface QueueEntry {
  id: string;
  restaurant_id: string;
  party_size: number;
  entry_type: QueueEntryType;
  party_name: string | null;
  phone: string | null;
  notes: string | null;
  joined_at: string;
  seated_at: string | null;
  status: QueueEntryStatus;
  skip_price: number | null;
}

export interface QueueState {
  regular_waiting: number;
  premium_waiting: number;
  total_waiting: number;
  avg_wait_minutes: number | null;
  seated_today: number;
  premium_revenue_today: number;  // yen (integer minor units)
}

export interface QueueEntryCreate {
  party_size: number;
  entry_type: QueueEntryType;
  party_name?: string | null;
  phone?: string | null;
  notes?: string | null;
  skip_price?: number | null;
}

export const queueApi = {
  list: (token: string) => api<QueueEntry[]>("/api/queue/entries", { token }),
  state: (token: string) => api<QueueState>("/api/queue/state", { token }),
  add: (token: string, body: QueueEntryCreate) =>
    api<QueueEntry>("/api/queue/entries", { method: "POST", body, token }),
  seat: (token: string, id: string) =>
    api<QueueEntry>(`/api/queue/entries/${id}/seat`, { method: "PATCH", token }),
  walkAway: (token: string, id: string) =>
    api<QueueEntry>(`/api/queue/entries/${id}/walk-away`, { method: "PATCH", token }),
};

// WS URL derived from API_BASE — handles both relative (prod, same origin)
// and absolute (dev, different port).
export function wsUrl(token: string): string {
  let base = API_BASE;
  if (!base && typeof window !== "undefined") {
    base = `${window.location.protocol}//${window.location.host}`;
  }
  const wsBase = base.replace(/^http/, "ws");
  return `${wsBase}/api/ws/queue?token=${encodeURIComponent(token)}`;
}
