"use client";

// Monthly statement — the Model B invoicing artifact. Owner/manager only
// (the API enforces it; staff get a 403 and an error message here).
// Printable: month-end, print this and the invoice matches it line by line.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/LocaleContext";
import { statementApi, type MonthlyStatement } from "@/lib/reports";

function yen(n: number): string {
  return `¥${n.toLocaleString()}`;
}

function monthShift(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function currentJstMonth(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 3600_000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function StatementPage() {
  const router = useRouter();
  const { token, user, loading: authLoading } = useAuth();
  const { t } = useT();
  const [month, setMonth] = useState(currentJstMonth);
  const [stmt, setStmt] = useState<MonthlyStatement | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!authLoading && !token) router.replace("/login");
  }, [authLoading, token, router]);

  useEffect(() => {
    if (!token) return;
    setStmt(null);
    setError(false);
    statementApi
      .get(token, month)
      .then(setStmt)
      .catch(() => setError(true));
  }, [token, month]);

  if (authLoading || !user) {
    return (
      <main className="min-h-dvh flex items-center justify-center">
        <p className="text-ifasto-secondary">{t.common.loading}</p>
      </main>
    );
  }

  const atCurrentMonth = month >= currentJstMonth();

  return (
    <main className="min-h-dvh px-5 py-6 max-w-3xl mx-auto w-full">
      <div className="print:hidden flex items-center justify-between mb-6">
        <Link href="/ops" className="text-sm text-ifasto-secondary">
          {t.statement.backToBoard}
        </Link>
        <button
          onClick={() => window.print()}
          className="px-5 py-2 rounded-md text-sm font-medium bg-ifasto-text text-ifasto-bg"
        >
          {t.statement.print}
        </button>
      </div>

      <div className="flex items-end justify-between mb-2">
        <div>
          <h1 className="font-display text-2xl tracking-tight">{t.statement.title}</h1>
          <p className="text-sm text-ifasto-secondary mt-1">{t.statement.subtitle}</p>
        </div>
        <div className="print:hidden flex items-center gap-2">
          <button
            onClick={() => setMonth((m) => monthShift(m, -1))}
            className="px-3 py-1.5 rounded-md border border-ifasto-border text-sm"
            aria-label="previous month"
          >
            ←
          </button>
          <span className="font-mono text-sm">{month}</span>
          <button
            onClick={() => setMonth((m) => monthShift(m, 1))}
            disabled={atCurrentMonth}
            className="px-3 py-1.5 rounded-md border border-ifasto-border text-sm disabled:opacity-40"
            aria-label="next month"
          >
            →
          </button>
        </div>
      </div>
      <p className="hidden print:block font-mono text-sm mb-2">{month}</p>
      {stmt && <p className="text-sm text-ifasto-secondary mb-6">{stmt.venue_name}</p>}

      {error && <p className="text-sm text-red-700 mt-4">{t.statement.errLoad}</p>}
      {!error && !stmt && <p className="text-ifasto-secondary mt-4">{t.common.loading}</p>}

      {stmt && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            {[
              [t.statement.passesSold, String(stmt.passes_sold)],
              [t.statement.grossTotal, yen(stmt.gross_total)],
              [t.statement.restaurantTotal, yen(stmt.restaurant_total)],
              [t.statement.ifastoTotal, yen(stmt.ifasto_total)],
            ].map(([label, value]) => (
              <div key={label} className="bg-white border border-ifasto-border rounded-md p-4">
                <p className="text-xs text-ifasto-secondary mb-1">{label}</p>
                <p className="font-mono text-xl">{value}</p>
              </div>
            ))}
          </div>

          {stmt.lines.length === 0 ? (
            <p className="text-ifasto-secondary">{t.statement.empty}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ifasto-secondary border-b border-ifasto-border">
                    <th className="py-2 pr-4 font-medium">{t.statement.colDate}</th>
                    <th className="py-2 pr-4 font-medium">{t.statement.colTime}</th>
                    <th className="py-2 pr-4 font-medium">{t.statement.colTicket}</th>
                    <th className="py-2 pr-4 font-medium">{t.statement.colParty}</th>
                    <th className="py-2 pr-4 font-medium text-right">{t.statement.colGross}</th>
                    <th className="py-2 pr-4 font-medium text-right">{t.statement.colRestaurant}</th>
                    <th className="py-2 font-medium text-right">{t.statement.colIfasto}</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {stmt.lines.map((l, i) => (
                    <tr key={i} className="border-b border-ifasto-border/50">
                      <td className="py-2 pr-4">{l.date}</td>
                      <td className="py-2 pr-4">{l.time}</td>
                      <td className="py-2 pr-4">{l.ticket_no ?? "-"}</td>
                      <td className="py-2 pr-4">{l.party_size}</td>
                      <td className="py-2 pr-4 text-right">{yen(l.gross_amount)}</td>
                      <td className="py-2 pr-4 text-right">{yen(l.restaurant_share)}</td>
                      <td className="py-2 text-right">{yen(l.ifasto_fee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-ifasto-secondary mt-8 max-w-xl leading-relaxed">
            {t.statement.note}
          </p>
        </>
      )}
    </main>
  );
}
