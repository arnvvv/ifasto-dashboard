"use client";

// Founder admin — cross-venue overview. English-only on purpose: this is a
// founder field tool, never shown to venue staff (the API is superuser-gated
// so a curious operator gets a 403, and non-superusers never see the link).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface VenueRow {
  venue_id: string;
  name: string;
  name_ja: string | null;
  venue_type: string;
  premium_paused: boolean;
  has_qr: boolean;
  waiting_now: number;
  joined_today: number;
  seated_today: number;
  walked_today: number;
  premium_sold_today: number;
  premium_revenue_today: number;
  ifasto_fee_today: number;
  last_activity: string | null;
}

interface Overview {
  date_jst: string;
  venues: VenueRow[];
  totals: {
    venues: number;
    waiting_now: number;
    joined_today: number;
    seated_today: number;
    walked_today: number;
    premium_sold_today: number;
    premium_revenue_today: number;
    ifasto_fee_today: number;
  };
}

function yen(n: number): string {
  return `¥${n.toLocaleString()}`;
}

function ago(iso: string | null): string {
  if (!iso) return "-";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

export default function AdminPage() {
  const router = useRouter();
  const { token, user, loading: authLoading } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !token) router.replace("/login");
  }, [authLoading, token, router]);

  useEffect(() => {
    if (!token) return;
    const load = () =>
      api<Overview>("/api/admin/overview", { token })
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch(() => setError("Could not load the overview (founder access only)."));
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [token]);

  if (authLoading || !user) {
    return (
      <main className="min-h-dvh flex items-center justify-center">
        <p className="text-ifasto-secondary">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh px-5 py-6 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl tracking-tight">ifasto admin</h1>
          <p className="text-sm text-ifasto-secondary mt-1">
            All venues, today (JST{data ? ` ${data.date_jst}` : ""}). Refreshes every 30s.
          </p>
        </div>
        <Link href="/ops" className="text-sm text-ifasto-secondary">
          ← Live board
        </Link>
      </div>

      {error && <p className="text-sm text-red-700 mb-4">{error}</p>}
      {!error && !data && <p className="text-ifasto-secondary">Loading…</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            {[
              ["Waiting now", String(data.totals.waiting_now)],
              ["Seated today", String(data.totals.seated_today)],
              ["Passes sold", String(data.totals.premium_sold_today)],
              ["ifasto fees", yen(data.totals.ifasto_fee_today)],
            ].map(([label, value]) => (
              <div key={label} className="bg-white border border-ifasto-border rounded-md p-4">
                <p className="text-xs text-ifasto-secondary mb-1">{label}</p>
                <p className="font-mono text-xl">{value}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ifasto-secondary border-b border-ifasto-border">
                  <th className="py-2 pr-4 font-medium">Venue</th>
                  <th className="py-2 pr-4 font-medium text-right">Waiting</th>
                  <th className="py-2 pr-4 font-medium text-right">Joined</th>
                  <th className="py-2 pr-4 font-medium text-right">Seated</th>
                  <th className="py-2 pr-4 font-medium text-right">Walked</th>
                  <th className="py-2 pr-4 font-medium text-right">Passes</th>
                  <th className="py-2 pr-4 font-medium text-right">Revenue</th>
                  <th className="py-2 pr-4 font-medium text-right">Fee (30%)</th>
                  <th className="py-2 font-medium">Last activity</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {data.venues.map((v) => (
                  <tr key={v.venue_id} className="border-b border-ifasto-border/50">
                    <td className="py-2 pr-4 font-sans">
                      <span className="font-medium">{v.name_ja ?? v.name}</span>
                      <span className="text-ifasto-secondary"> · {v.venue_type}</span>
                      {v.premium_paused && (
                        <span className="ml-2 text-xs text-amber-700">paused</span>
                      )}
                      {!v.has_qr && (
                        <span className="ml-2 text-xs text-red-700">no QR</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right">{v.waiting_now}</td>
                    <td className="py-2 pr-4 text-right">{v.joined_today}</td>
                    <td className="py-2 pr-4 text-right">{v.seated_today}</td>
                    <td className="py-2 pr-4 text-right">{v.walked_today}</td>
                    <td className="py-2 pr-4 text-right">{v.premium_sold_today}</td>
                    <td className="py-2 pr-4 text-right">{yen(v.premium_revenue_today)}</td>
                    <td className="py-2 pr-4 text-right">{yen(v.ifasto_fee_today)}</td>
                    <td className="py-2 text-ifasto-secondary">{ago(v.last_activity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
