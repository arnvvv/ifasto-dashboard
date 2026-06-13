// Pricing bridge client. Wraps POST /api/pricing/quote.
// Gating failures (409) and engine outage (503) are turned into a typed
// "unavailable" instead of throwing so the tile can render a dash + reason.

import { api, ApiError } from "./api";

export interface PriceQuote {
  status: string;
  venue_id: string;
  party_size: number;
  party_size_category: "small" | "large";
  currency: string;
  minor_units: number;
  price_minor: number | null;
  price_major: number | null;
  base_minor: number | null;
  floor_minor: number | null;
  ceiling_minor: number | null;
  raw_minor: number | null;
  multipliers: Record<string, number>;
  predicted_wait_mins: number | null;
  premium_share_pct: number | null;
  queue_count: number | null;
  premium_count_in_category: number | null;
  hard_cap_for_category: number | null;
  session_id: string | null;
  valid_until_ts: number | null;
  valid_for_seconds: number | null;
  message: string | null;
}

export interface PriceQuoteRequest {
  party_size: number;
  service_id?: string | null;
  session_id?: string | null;
}

export interface PriceUnavailable {
  ok: false;
  reason: string;
  message: string;
}
export interface PriceOk {
  ok: true;
  quote: PriceQuote;
}
export type PriceResponse = PriceOk | PriceUnavailable;

function extractDetail(err: ApiError): { reason: string; message: string } {
  // Backend raises HTTPException(detail={reason, message}); the wrapper puts
  // the parsed JSON body in err.body. Fall back to err.message for stringy
  // details (older endpoints).
  const body = err.body as { detail?: unknown } | undefined;
  const detail = body?.detail;
  if (detail && typeof detail === "object") {
    const d = detail as { reason?: string; message?: string };
    return {
      reason: d.reason ?? "unavailable",
      message: d.message ?? "Price unavailable.",
    };
  }
  return { reason: "unavailable", message: String(err.message ?? "Price unavailable.") };
}

export const pricingApi = {
  quote: async (token: string, body: PriceQuoteRequest): Promise<PriceResponse> => {
    try {
      const quote = await api<PriceQuote>("/api/pricing/quote", {
        method: "POST",
        body,
        token,
      });
      return { ok: true, quote };
    } catch (err) {
      if (err instanceof ApiError) {
        const { reason, message } = extractDetail(err);
        return { ok: false, reason, message };
      }
      return { ok: false, reason: "network", message: "Could not reach pricing." };
    }
  },
};

export function formatPrice(q: PriceQuote): string {
  if (q.price_major == null) return "—";
  if (q.currency === "JPY") return `¥${Math.round(q.price_major).toLocaleString()}`;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: q.currency,
  }).format(q.price_major);
}
