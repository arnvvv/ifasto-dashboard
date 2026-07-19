"use client";

// WTP field survey v2 — the 5-question intercept protocol, built for
// one-handed phone entry while standing in a real Tokyo queue.
//
// Core mechanic: ONE randomized skip price per respondent, yes/no. Never
// ask "how much would you pay" (anchoring) and never show one person two
// prices. Aggregated acceptance by price point traces the demand curve.
// Venue + current wait persist between entries so consecutive interviews
// at the same line are a few taps each.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { surveysApi } from "@/lib/surveys";

const PRICES = [500, 1000, 1500, 2000, 3000];

function drawPrice(): number {
  return PRICES[Math.floor(Math.random() * PRICES.length)];
}

export default function SurveyPage() {
  const router = useRouter();
  const { token, user, loading: authLoading } = useAuth();

  // Sticky across entries (same queue, next respondent):
  const [venue, setVenue] = useState("");
  const [waitMins, setWaitMins] = useState("");
  // Per-respondent:
  const [offeredPrice, setOfferedPrice] = useState<number>(drawPrice);
  const [partySize, setPartySize] = useState(2);
  const [respondent, setRespondent] = useState<"tourist" | "local">("tourist");
  const [perceivedWait, setPerceivedWait] = useState("");
  const [maxWait, setMaxWait] = useState("");
  const [wouldSkip, setWouldSkip] = useState<boolean | null>(null);
  const [pressure, setPressure] = useState<"hurry" | "normal" | "relaxed" | "">("");
  const [firstVisit, setFirstVisit] = useState<boolean | null>(null);
  const [reason, setReason] = useState("");

  const [savedToday, setSavedToday] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!authLoading && !token) router.replace("/login");
  }, [authLoading, token, router]);

  useEffect(() => {
    if (!token) return;
    surveysApi.list(token, 500).then((rows) => {
      const today = new Date().toDateString();
      setSavedToday(rows.filter((r) => new Date(r.created_at).toDateString() === today).length);
    }).catch(() => {});
  }, [token]);

  const canSave = venue.trim().length > 0 && wouldSkip !== null && !busy;

  async function save() {
    if (!token || wouldSkip === null) return;
    setBusy(true);
    setErr(null);
    try {
      await surveysApi.create(token, {
        venue_label: venue.trim(),
        observed_wait_mins: waitMins.trim() ? Number(waitMins) : null,
        party_size: partySize,
        respondent,
        would_skip: wouldSkip,
        offered_price_yen: offeredPrice,
        perceived_wait_mins: perceivedWait.trim() ? Number(perceivedWait) : null,
        stated_max_wait_mins: maxWait.trim() ? Number(maxWait) : null,
        time_pressure: pressure || null,
        first_visit: firstVisit,
        reason: reason.trim() || null,
      });
      setSavedToday((n) => n + 1);
      // Reset per-respondent fields and DRAW A FRESH PRICE for the next
      // interview; keep venue + wait sticky.
      setOfferedPrice(drawPrice());
      setPartySize(2);
      setRespondent("tourist");
      setPerceivedWait("");
      setMaxWait("");
      setWouldSkip(null);
      setPressure("");
      setFirstVisit(null);
      setReason("");
      setFlash(true);
      setTimeout(() => setFlash(false), 900);
    } catch {
      setErr("Could not save. Check connection and retry.");
    } finally {
      setBusy(false);
    }
  }

  if (authLoading || !user) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <p className="text-sm text-ifasto-secondary">Loading…</p>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col max-w-md mx-auto w-full px-5 py-6 gap-5">
      <header className="flex items-center justify-between">
        <div>
          <p className="font-display text-2xl tracking-tight leading-none">
            WTP survey v2
          </p>
          <p className="text-xs text-ifasto-secondary mt-1">
            {savedToday} saved today
          </p>
        </div>
        <Link href="/ops" className="text-sm text-ifasto-secondary hover:text-ifasto-text">
          ← Ops
        </Link>
      </header>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-ifasto-secondary">
          Venue (sticky)
        </span>
        <input
          type="text"
          value={venue}
          placeholder="Fuunji, Shinjuku"
          onChange={(e) => setVenue(e.target.value)}
          className="w-full px-4 py-3 bg-white border border-ifasto-border rounded-lg text-base focus:outline-none focus:border-ifasto-text"
        />
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-ifasto-secondary">
            Actual wait (min, sticky)
          </span>
          <input
            type="number" inputMode="numeric" min={0} max={600}
            value={waitMins}
            onChange={(e) => setWaitMins(e.target.value)}
            className="w-full px-4 py-3 bg-white border border-ifasto-border rounded-lg text-base focus:outline-none focus:border-ifasto-text"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-ifasto-secondary">
            Party size
          </span>
          <div className="flex items-center justify-between border border-ifasto-border rounded-lg bg-white px-2 py-1.5">
            <button
              onClick={() => setPartySize((p) => Math.max(1, p - 1))}
              className="w-10 h-10 rounded-md text-xl text-ifasto-text active:bg-ifasto-bg"
            >
              –
            </button>
            <span className="text-xl font-medium tabular-nums">{partySize}</span>
            <button
              onClick={() => setPartySize((p) => Math.min(20, p + 1))}
              className="w-10 h-10 rounded-md text-xl text-ifasto-text active:bg-ifasto-bg"
            >
              +
            </button>
          </div>
        </label>
      </div>

      <Toggle
        label="Respondent"
        options={[["tourist", "Tourist"], ["local", "Local"]]}
        value={respondent}
        onChange={(v) => setRespondent(v as "tourist" | "local")}
      />

      {/* Q1 */}
      <label className="block space-y-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-ifasto-secondary">
          Q1 · 何分待ちだと思いますか？ (perceived wait, min)
        </span>
        <input
          type="number" inputMode="numeric" min={0} max={600}
          value={perceivedWait}
          onChange={(e) => setPerceivedWait(e.target.value)}
          className="w-full px-4 py-3 bg-white border border-ifasto-border rounded-lg text-base focus:outline-none focus:border-ifasto-text"
        />
      </label>

      {/* Q2 */}
      <label className="block space-y-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-ifasto-secondary">
          Q2 · 最大で何分まで待てますか？ (max wait, min)
        </span>
        <input
          type="number" inputMode="numeric" min={0} max={600}
          value={maxWait}
          onChange={(e) => setMaxWait(e.target.value)}
          className="w-full px-4 py-3 bg-white border border-ifasto-border rounded-lg text-base focus:outline-none focus:border-ifasto-text"
        />
      </label>

      {/* Q3 — the randomized price. Assigned, never chosen. */}
      <div className="border-2 border-ifasto-text rounded-xl p-4 bg-white space-y-3">
        <span className="text-xs font-medium uppercase tracking-wide text-ifasto-secondary block">
          Q3 · Ask exactly this
        </span>
        <p className="text-base leading-relaxed">
          もし<strong className="text-xl">¥{offeredPrice.toLocaleString()}</strong>で待たずに入れるとしたら、利用しますか？
        </p>
        <p className="text-xs text-ifasto-secondary">
          (If you could skip the wait for ¥{offeredPrice.toLocaleString()}, would you?)
          · price is randomly assigned, do not reroll for the same person
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[["yes", "Yes"], ["no", "No"]].map(([v, text]) => (
            <button
              key={v}
              onClick={() => setWouldSkip(v === "yes")}
              className={`py-3.5 rounded-lg text-base font-medium border transition-colors ${
                (wouldSkip === null ? "" : wouldSkip ? "yes" : "no") === v
                  ? "bg-ifasto-text text-ifasto-bg border-ifasto-text"
                  : "bg-white text-ifasto-secondary border-ifasto-border"
              }`}
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      {/* Q4 */}
      <div className="space-y-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-ifasto-secondary block">
          Q4 · お時間に余裕がありますか？ (time pressure)
        </span>
        <div className="grid grid-cols-3 gap-2">
          {([["hurry", "Hurry"], ["normal", "Normal"], ["relaxed", "Relaxed"]] as const).map(
            ([v, text]) => (
              <button
                key={v}
                onClick={() => setPressure(v)}
                className={`py-3 rounded-lg text-sm font-medium border transition-colors ${
                  pressure === v
                    ? "bg-ifasto-text text-ifasto-bg border-ifasto-text"
                    : "bg-white text-ifasto-secondary border-ifasto-border"
                }`}
              >
                {text}
              </button>
            )
          )}
        </div>
      </div>

      {/* Q5 */}
      <Toggle
        label="Q5 · このお店は初めてですか？ (first visit)"
        options={[["yes", "First visit"], ["no", "Repeat"]]}
        value={firstVisit === null ? "" : firstVisit ? "yes" : "no"}
        onChange={(v) => setFirstVisit(v === "yes")}
      />

      <label className="block space-y-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-ifasto-secondary">
          Reason (one word, optional)
        </span>
        <input
          type="text"
          value={reason}
          placeholder={wouldSkip === false ? "principle / budget / time" : "hungry / schedule / kids"}
          onChange={(e) => setReason(e.target.value)}
          className="w-full px-4 py-3 bg-white border border-ifasto-border rounded-lg text-base focus:outline-none focus:border-ifasto-text"
        />
      </label>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <button
        onClick={() => void save()}
        disabled={!canSave}
        className={`w-full py-4 rounded-xl text-base font-semibold transition-colors ${
          flash
            ? "bg-emerald-600 text-white"
            : "bg-ifasto-text text-ifasto-bg disabled:opacity-40"
        }`}
      >
        {flash ? "Saved" : busy ? "Saving…" : "Save response"}
      </button>
    </main>
  );
}

function Toggle({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [string, string][];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-ifasto-secondary block">
        {label}
      </span>
      <div className="grid grid-cols-2 gap-2">
        {options.map(([v, text]) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={`py-3.5 rounded-lg text-base font-medium border transition-colors ${
              value === v
                ? "bg-ifasto-text text-ifasto-bg border-ifasto-text"
                : "bg-white text-ifasto-secondary border-ifasto-border"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
