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

function yen(n: number): string {
  return `¥${n.toLocaleString()}`;
}

function delta(now: number, prior: number): string {
  if (prior === 0) return now > 0 ? "new" : "·";
  const pct = Math.round(((now - prior) / prior) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

export default function HistoryPage() {
  const router = useRouter();
  const { token, user, loading: authLoading } = useAuth();
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
      .catch(() => setError("Could not load the report."));
  }, [token]);

  if (authLoading || !user) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <p className="text-sm text-ifasto-secondary">Loading…</p>
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
            ifasto · history
          </p>
          <p className="text-xs text-ifasto-secondary mt-1">
            Last {report?.days ?? 28} days · JST
          </p>
        </div>
        <Link
          href="/ops"
          className="text-sm text-ifasto-secondary hover:text-ifasto-text transition-colors"
        >
          ← Live board
        </Link>
      </header>

      {tw && pw && (
        <section className="px-6 py-5 border-b border-ifasto-border grid grid-cols-2 md:grid-cols-5 gap-4">
          <Stat label="Seated (7d)" value={tw.seated} sub={delta(tw.seated, pw.seated)} />
          <Stat
            label="Walk-aways (7d)"
            value={tw.walked_away}
            sub={delta(tw.walked_away, pw.walked_away)}
            subInverted
          />
          <Stat label="Premium sold (7d)" value={tw.premium_sold} sub={delta(tw.premium_sold, pw.premium_sold)} />
          <Stat
            label="Premium ¥ (7d)"
            value={yen(tw.premium_revenue)}
            sub={delta(tw.premium_revenue, pw.premium_revenue)}
            accent
          />
          <Stat
            label="Median wait (7d)"
            value={tw.median_wait_mins != null ? `${tw.median_wait_mins} min` : "—"}
            sub={
              pw.median_wait_mins != null && tw.median_wait_mins != null
                ? `${tw.median_wait_mins <= pw.median_wait_mins ? "" : "+"}${(tw.median_wait_mins - pw.median_wait_mins).toFixed(0)} min WoW`
                : "·"
            }
          />
        </section>
      )}

      <section className="flex-1 px-6 py-5 overflow-x-auto">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {report && report.rows.length === 0 && (
          <p className="text-sm text-ifasto-secondary">
            No activity in the window yet. Rows appear as soon as the queue is used.
          </p>
        )}
        {report && report.rows.length > 0 && (
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-xs font-mono uppercase tracking-widest text-ifasto-secondary border-b border-ifasto-border">
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Seated</th>
                <th className="py-2 pr-4">Walked</th>
                <th className="py-2 pr-4">Premium</th>
                <th className="py-2 pr-4">Premium ¥</th>
                <th className="py-2 pr-4">Median wait</th>
                <th className="py-2 pr-4">Premium saves</th>
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
                      ? "Walk-away spike vs window average — check whether premium pressure is hurting the regular line"
                      : undefined
                  }
                >
                  <td className="py-2 pr-4 font-mono text-xs">{r.date}</td>
                  <td className="py-2 pr-4">{r.seated}</td>
                  <td className="py-2 pr-4">
                    {r.walked_away}
                    {r.walkaway_spike && (
                      <span className="ml-1.5 text-[10px] font-mono text-amber-700">
                        SPIKE
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4">{r.premium_sold}</td>
                  <td className="py-2 pr-4 font-mono">{yen(r.premium_revenue)}</td>
                  <td className="py-2 pr-4">
                    {r.median_wait_mins != null ? `${r.median_wait_mins} min` : "—"}
                  </td>
                  <td className="py-2 pr-4">
                    {r.premium_wait_saving_mins != null
                      ? `${r.premium_wait_saving_mins} min`
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
