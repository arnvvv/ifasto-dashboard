"use client";

// Live skip-price tile for the ops header. Polls the server-side pricing
// bridge every 15s; on 409 (paused / cap reached) or 503 (engine down), shows
// the reason instead of a price.

import { useCallback, useEffect, useRef, useState } from "react";
import { pricingApi, formatPrice, type PriceResponse } from "@/lib/pricing";

interface LivePriceTileProps {
  token: string;
  partySize?: number;
  active?: boolean;
}

const POLL_MS = 15_000;

const REASON_LABELS: Record<string, string> = {
  premium_paused: "paused",
  large_party_cap_reached: "cap reached",
  engine_unavailable: "engine offline",
  network: "offline",
  unavailable_hard_cap: "cap reached",
  unauthorized: "unauthorized",
};

export default function LivePriceTile({
  token,
  partySize = 2,
  active = true,
}: LivePriceTileProps) {
  const [resp, setResp] = useState<PriceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchQuote = useCallback(async () => {
    const r = await pricingApi.quote(token, { party_size: partySize });
    setResp(r);
    setLoading(false);
  }, [token, partySize]);

  useEffect(() => {
    if (!active) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    void fetchQuote();
    timer.current = setInterval(() => void fetchQuote(), POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [active, fetchQuote]);

  const value = loading
    ? "…"
    : resp?.ok
      ? formatPrice(resp.quote)
      : "—";

  const sub = loading
    ? "fetching"
    : resp?.ok
      ? resp.quote.predicted_wait_mins != null
        ? `~${Math.round(resp.quote.predicted_wait_mins)} min wait`
        : "live"
      : REASON_LABELS[resp?.reason ?? ""] ?? "unavailable";

  return (
    <div>
      <p className="text-xs font-mono uppercase tracking-widest text-ifasto-secondary">
        Skip price · party {partySize}
      </p>
      <p className="font-display text-2xl mt-0.5 tabular-nums">{value}</p>
      <p className="text-[11px] text-ifasto-secondary mt-0.5">{sub}</p>
    </div>
  );
}
