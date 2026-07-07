"use client";

// WTP field survey — built for one-handed phone entry while standing in a
// real Tokyo queue. Venue + wait persist between entries so consecutive
// interviews at the same line are a few taps each.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { surveysApi } from "@/lib/surveys";

export default function SurveyPage() {
  const router = useRouter();
  const { token, user, loading: authLoading } = useAuth();

  // Sticky across entries (same queue, next respondent):
  const [venue, setVenue] = useState("");
  const [waitMins, setWaitMins] = useState("");
  // Per-respondent:
  const [partySize, setPartySize] = useState(2);
  const [respondent, setRespondent] = useState<"tourist" | "local">("tourist");
  const [wouldSkip, setWouldSkip] = useState<boolean | null>(null);
  const [maxFee, setMaxFee] = useState("");
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
        max_fee_yen: wouldSkip && maxFee.trim() ? Number(maxFee) : null,
        reason: reason.trim() || null,
      });
      setSavedToday((n) => n + 1);
      // Reset per-respondent fields; keep venue + wait for the next interview.
      setPartySize(2);
      setRespondent("tourist");
      setWouldSkip(null);
      setMaxFee("");
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
            WTP survey
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
            Current wait (min)
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

      <Toggle
        label="Would they pay to skip?"
        options={[["yes", "Yes"], ["no", "No"]]}
        value={wouldSkip === null ? "" : wouldSkip ? "yes" : "no"}
        onChange={(v) => setWouldSkip(v === "yes")}
      />

      {wouldSkip && (
        <label className="block space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-ifasto-secondary">
            Max fee (¥)
          </span>
          <input
            type="number" inputMode="numeric" min={0} step={100}
            value={maxFee}
            onChange={(e) => setMaxFee(e.target.value)}
            className="w-full px-4 py-3 bg-white border border-ifasto-border rounded-lg text-base focus:outline-none focus:border-ifasto-text"
          />
        </label>
      )}

      <label className="block space-y-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-ifasto-secondary">
          Reason (one word)
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
