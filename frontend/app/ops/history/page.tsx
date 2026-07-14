"use client";

// History — end-of-day summaries and week-over-week trends. This page is the
// renewal artifact: premium revenue, wait saving, and walk-away trend at a
// glance. Days flagged amber = walk-away spike (possible cannibalization;
// consider the pause button).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { reportsApi, type DailyReport } from "@/lib/reports";
import { useT } from "@/lib/LocaleContext";

function yen(n: number): string {
  return `¥${n.toLocaleString()}`;
}

function delta(now: number, prior: number, newLabel = "new"): string {
  if (prior === 0) return now > 0 ? newLabel : "·";
  const pct = Math.round(((now - prior) / prior) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

export default function HistoryPage() {
  const router = useRouter();
  const { token, user, loading: authLoading } = useAuth();
  const { t } = useT();
  const [report, setReport] = useState<DailyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !token) router.replace("/login");
  }, [authLoading, token, router]);

  useEffect(() => {
    if (!token) return;
    reportsApi
      .daily(token, 28)
      .then(setReport)
      .catch(() => setError(t.history.errLoad));
  }, [token]);

  if (authLoading || !user) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <p className="text-sm text-ifasto-secondary">{t.common.loading}</p>
      </main>
    );
  }

  const tw = report?.this_week;
  const pw = report?.prior_week;

  return (
    <main className="flex-1 flex flex-col">
      <header className="border-b border-ifasto-border px-6 py-4 flex items-center justify-between gap-4">
        <div>
          <p className="font-display text-2xl tracking-tight leading-none">
            {t.history.title}
          </p>
          <p className="text-xs text-ifasto-secondary mt-1">
            {t.history.subtitle(report?.days ?? 28)}
          </p>
        </div>
        <Link
          href="/ops"
          className="text-sm text-ifasto-secondary hover:text-ifasto-text transition-colors"
        >
          {t.history.backToBoard}
        </Link>
      </header>

      {tw && pw && (
        <section className="px-6 py-5 border-b border-ifasto-border grid grid-cols-2 md:grid-cols-5 gap-4">
          <Stat label={t.history.seated7} value={tw.seated} sub={delta(tw.seated, pw.seated, t.history.newBadge)} />
          <Stat
            label={t.history.walked7}
            value={tw.walked_away}
            sub={delta(tw.walked_away, pw.walked_away, t.history.newBadge)}
            subInverted
          />
          <Stat label={t.history.premiumSold7} value={tw.premium_sold} sub={delta(tw.premium_sold, pw.premium_sold, t.history.newBadge)} />
          <Stat
            label={t.history.premiumRevenue7}
            value={yen(tw.premium_revenue)}
            sub={delta(tw.premium_revenue, pw.premium_revenue, t.history.newBadge)}
            accent
          />
          <Stat
            label={t.history.medianWait7}
            value={tw.median_wait_mins != null ? `${tw.median_wait_mins} ${t.history.min}` : "—"}
            sub={
              pw.median_wait_mins != null && tw.median_wait_mins != null
                ? `${tw.median_wait_mins <= pw.median_wait_mins ? "" : "+"}${(tw.median_wait_mins - pw.median_wait_mins).toFixed(0)}${t.history.wowSuffix}`
                : "·"
            }
          />
        </section>
      )}

      <section className="flex-1 px-6 py-5 overflow-x-auto">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {report && report.rows.length === 0 && (
          <p className="text-sm text-ifasto-secondary">
            {t.history.empty}
          </p>
        )}
        {report && report.rows.length > 0 && (
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-xs font-mono uppercase tracking-widest text-ifasto-secondary border-b border-ifasto-border">
                <th className="py-2 pr-4">{t.history.colDate}</th>
                <th className="py-2 pr-4">{t.history.colSeated}</th>
                <th className="py-2 pr-4">{t.history.colWalked}</th>
                <th className="py-2 pr-4">{t.history.colPremium}</th>
                <th className="py-2 pr-4">{t.history.colPremiumRevenue}</th>
                <th className="py-2 pr-4">{t.history.colMedianWait}</th>
                <th className="py-2 pr-4">{t.history.colPremiumSaves}</th>
              </tr>
            </thead>
            <tbody>
              {[...report.rows].reverse().map((r) => (
                <tr
                  key={r.date}
                  className={`border-b border-ifasto-border/60 ${
                    r.walkaway_spike ? "bg-amber-50" : ""
                  }`}
                  title={
                    r.walkaway_spike
                      ? t.history.spikeTooltip
                      : undefined
                  }
                >
                  <td className="py-2 pr-4 font-mono text-xs">{r.date}</td>
                  <td className="py-2 pr-4">{r.seated}</td>
                  <td className="py-2 pr-4">
                    {r.walked_away}
                    {r.walkaway_spike && (
                      <span className="ml-1.5 text-[10px] font-mono text-amber-700">
                        {t.history.spike}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4">{r.premium_sold}</td>
                  <td className="py-2 pr-4 font-mono">{yen(r.premium_revenue)}</td>
                  <td className="py-2 pr-4">
                    {r.median_wait_mins != null ? `${r.median_wait_mins} ${t.history.min}` : "—"}
                  </td>
                  <td className="py-2 pr-4">
                    {r.premium_wait_saving_mins != null
                      ? `${r.premium_wait_saving_mins} ${t.history.min}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
  accent = false,
  subInverted = false,
}: {
  label: string;
  value: string | number;
  sub: string;
  accent?: boolean;
  subInverted?: boolean;
}) {
  const positive = sub.startsWith("+");
  const subColor =
    sub === "·" || sub === "new"
      ? "text-ifasto-secondary"
      : positive !== subInverted
        ? "text-emerald-600"
        : "text-red-600";
  return (
    <div>
      <p className="text-xs font-mono uppercase tracking-widest text-ifasto-secondary">
        {label}
      </p>
      <p className={`font-display text-2xl mt-0.5 ${accent ? "text-ifasto-amber" : ""}`}>
        {value}
      </p>
      <p className={`text-xs mt-0.5 font-mono ${subColor}`}>{sub}</p>
    </div>
  );
}
