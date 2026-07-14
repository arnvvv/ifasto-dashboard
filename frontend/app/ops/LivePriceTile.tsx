"use client";

// Live skip-price tile for the ops header. Polls the server-side pricing
// bridge every 15s; on 409 (paused / cap reached) or 503 (engine down), shows
// the reason instead of a price.

import { useCallback, useEffect, useRef, useState } from "react";
import { pricingApi, formatPrice, type PriceResponse } from "@/lib/pricing";
import { useT } from "@/lib/LocaleContext";

interface LivePriceTileProps {
  token: string;
  partySize?: number;
  active?: boolean;
}

const POLL_MS = 15_000;

export default function LivePriceTile({
  token,
  partySize = 2,
  active = true,
}: LivePriceTileProps) {
  const { t } = useT();
  const reasonLabels: Record<string, string> = {
    premium_paused: t.tile.paused,
    large_party_cap_reached: t.tile.capReached,
    engine_unavailable: t.tile.engineOffline,
    network: t.tile.offline,
    unavailable_hard_cap: t.tile.capReached,
    out_of_service_hours: t.tile.outOfHours,
  };
  const [resp, setResp] = useState<PriceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchQuote = useCallback(async () => {
    // source: 'tile_poll' keeps these periodic refreshes out of the
    // conversion denominator in the backend's quote log.
    const r = await pricingApi.quote(token, {
      party_size: partySize,
      source: "tile_poll",
    });
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
    ? t.tile.fetching
    : resp?.ok
      ? resp.quote.predicted_wait_mins != null
        ? t.tile.waitSub(Math.round(resp.quote.predicted_wait_mins))
        : t.tile.liveSub
      : reasonLabels[resp?.reason ?? ""] ?? t.tile.unavailable;

  return (
    <div>
      <p className="text-xs font-mono uppercase tracking-widest text-ifasto-secondary">
        {t.tile.label(partySize)}
      </p>
      <p className="font-display text-2xl mt-0.5 tabular-nums">{value}</p>
      <p className="text-[11px] text-ifasto-secondary mt-0.5">{sub}</p>
    </div>
  );
}
