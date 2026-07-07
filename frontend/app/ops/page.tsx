"use client";

// Live operations board. Floor staff use this to add parties, see who is
// waiting (regular vs premium), and seat the next party. Premium parties
// always jump regular FIFO order.

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  type QueueEntry,
  type QueueEntryCreate,
  queueApi,
} from "@/lib/queue";
import { useQueue } from "@/lib/useQueue";
import { pricingApi, formatPrice, type PriceResponse } from "@/lib/pricing";
import { settingsApi, type VenueSettings } from "@/lib/settings";
import LivePriceTile from "./LivePriceTile";

export default function OpsPage() {
  const router = useRouter();
  const { token, user, loading: authLoading, logout } = useAuth();

  // Auth gate.
  useEffect(() => {
    if (!authLoading && !token) router.replace("/login");
  }, [authLoading, token, router]);

  const { entries, state, loading, error, connected, refresh } = useQueue(token);

  const { regular, premium } = useMemo(() => splitEntries(entries), [entries]);
  const nextUp = premium[0] ?? regular[0] ?? null;

  const [actionId, setActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // Venue settings — pause state drives the header toggle; caps live in the
  // drawer. Staff see state but only owner/manager can change it.
  const [settings, setSettings] = useState<VenueSettings | null>(null);
  const [showCaps, setShowCaps] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const canEditSettings = user?.role === "owner" || user?.role === "manager";

  useEffect(() => {
    if (!token) return;
    settingsApi.get(token).then(setSettings).catch(() => setSettings(null));
  }, [token]);

  async function togglePause() {
    if (!token || !settings || settingsBusy) return;
    setSettingsBusy(true);
    try {
      const next = await settingsApi.update(token, {
        premium_paused: !settings.premium_paused,
      });
      setSettings(next);
    } catch (err) {
      setActionError(toMessage(err, "Could not update premium state."));
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleSeat(id: string) {
    if (!token) return;
    setActionId(id);
    setActionError(null);
    try {
      await queueApi.seat(token, id);
      // WS will deliver the update; refresh as a belt-and-braces fallback.
    } catch (err) {
      setActionError(toMessage(err, "Could not seat that party."));
      void refresh();
    } finally {
      setActionId(null);
    }
  }

  async function handleWalk(id: string) {
    if (!token) return;
    setActionId(id);
    setActionError(null);
    try {
      await queueApi.walkAway(token, id);
    } catch (err) {
      setActionError(toMessage(err, "Could not mark that party as walked away."));
      void refresh();
    } finally {
      setActionId(null);
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
    <main className="flex-1 flex flex-col">
      <header className="border-b border-ifasto-border px-6 py-4 flex items-center justify-between gap-4">
        <div>
          <p className="font-display text-2xl tracking-tight leading-none">
            ifasto · ops
          </p>
          <p className="text-xs text-ifasto-secondary mt-1">
            Signed in as {user.name} · {user.role}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {settings && (
            <button
              onClick={() => void togglePause()}
              disabled={!canEditSettings || settingsBusy}
              title={
                canEditSettings
                  ? settings.premium_paused
                    ? "Resume premium skip sales"
                    : "Pause premium skip sales immediately"
                  : "Owner/manager only"
              }
              className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium border transition-colors ${
                settings.premium_paused
                  ? "bg-amber-100 border-amber-300 text-amber-800"
                  : "bg-emerald-50 border-emerald-200 text-emerald-700"
              } ${canEditSettings ? "hover:opacity-80" : "cursor-default opacity-70"}`}
            >
              {settings.premium_paused ? "PREMIUM PAUSED — resume" : "PREMIUM ON — pause"}
            </button>
          )}
          {canEditSettings && (
            <button
              onClick={() => setShowCaps((v) => !v)}
              className="text-sm text-ifasto-secondary hover:text-ifasto-text transition-colors"
              title="Pricing caps"
            >
              Caps
            </button>
          )}
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-mono ${
              connected ? "text-emerald-600" : "text-ifasto-secondary"
            }`}
            title={connected ? "Live updates connected" : "Reconnecting…"}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                connected ? "bg-emerald-500" : "bg-ifasto-border"
              }`}
            />
            {connected ? "LIVE" : "OFFLINE"}
          </span>
          <button
            onClick={() => void logout()}
            className="text-sm text-ifasto-secondary hover:text-ifasto-text transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      {showCaps && settings && token && (
        <CapsDrawer
          token={token}
          settings={settings}
          onSaved={(s) => {
            setSettings(s);
            setShowCaps(false);
          }}
          onClose={() => setShowCaps(false)}
        />
      )}

      <section className="px-6 py-5 border-b border-ifasto-border grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
        <Stat label="Waiting" value={state?.total_waiting ?? entries.length} />
        <Stat label="Regular" value={state?.regular_waiting ?? regular.length} />
        <Stat label="Premium" value={state?.premium_waiting ?? premium.length} />
        <Stat
          label="Avg wait"
          value={
            state?.avg_wait_minutes != null
              ? `${Math.round(state.avg_wait_minutes)} min`
              : "—"
          }
        />
        {token && <LivePriceTile token={token} partySize={2} active />}
        <Stat label="Seated today" value={state?.seated_today ?? 0} />
        <Stat
          label="Premium ¥ today"
          value={formatYen(state?.premium_revenue_today ?? 0)}
          accent
        />
      </section>

      <section className="px-6 py-4 border-b border-ifasto-border flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-mono uppercase tracking-widest text-ifasto-secondary">
            Next up
          </p>
          <p className="font-display text-xl truncate">
            {nextUp ? (
              <>
                {nextUp.party_name || "Walk-in"}{" "}
                <span className="text-ifasto-secondary">
                  · party of {nextUp.party_size}
                </span>
                {nextUp.entry_type === "premium" && (
                  <span className="ml-2 text-xs font-mono text-ifasto-amber">
                    PREMIUM
                  </span>
                )}
              </>
            ) : (
              <span className="text-ifasto-secondary">Queue is empty</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowAdd(true)}
            className="px-4 py-2 text-sm border border-ifasto-border rounded-md hover:border-ifasto-text transition-colors"
          >
            + Add party
          </button>
          <button
            onClick={() => nextUp && handleSeat(nextUp.id)}
            disabled={!nextUp || actionId === nextUp?.id}
            className="px-4 py-2 text-sm bg-ifasto-text text-ifasto-bg rounded-md font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            Seat next
          </button>
        </div>
      </section>

      {(error || actionError) && (
        <div className="px-6 py-3 bg-red-50 border-b border-red-100 text-sm text-red-700">
          {error || actionError}
        </div>
      )}

      <section className="flex-1 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-ifasto-border">
        <QueueColumn
          title="Premium"
          tone="amber"
          entries={premium}
          empty="No premium parties."
          actionId={actionId}
          onSeat={handleSeat}
          onWalk={handleWalk}
          loading={loading}
        />
        <QueueColumn
          title="Regular"
          tone="text"
          entries={regular}
          empty="No regular parties."
          actionId={actionId}
          onSeat={handleSeat}
          onWalk={handleWalk}
          loading={loading}
        />
      </section>

      {showAdd && token && (
        <AddPartyModal
          token={token}
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            setShowAdd(false);
            void refresh();
          }}
        />
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-mono uppercase tracking-widest text-ifasto-secondary">
        {label}
      </p>
      <p
        className={`font-display text-2xl mt-0.5 ${
          accent ? "text-ifasto-amber" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function formatYen(yen: number): string {
  return `¥${yen.toLocaleString()}`;
}

interface QueueColumnProps {
  title: string;
  tone: "amber" | "text";
  entries: QueueEntry[];
  empty: string;
  actionId: string | null;
  onSeat: (id: string) => void;
  onWalk: (id: string) => void;
  loading: boolean;
}

function QueueColumn({
  title,
  tone,
  entries,
  empty,
  actionId,
  onSeat,
  onWalk,
  loading,
}: QueueColumnProps) {
  const titleColor = tone === "amber" ? "text-ifasto-amber" : "text-ifasto-text";

  return (
    <div className="flex flex-col">
      <div className="px-6 py-3 border-b border-ifasto-border flex items-center justify-between">
        <p className={`font-display text-lg ${titleColor}`}>
          {title}{" "}
          <span className="text-ifasto-secondary text-sm font-sans">
            ({entries.length})
          </span>
        </p>
      </div>
      <ul className="flex-1 divide-y divide-ifasto-border">
        {loading && entries.length === 0 ? (
          <li className="px-6 py-8 text-sm text-ifasto-secondary">Loading…</li>
        ) : entries.length === 0 ? (
          <li className="px-6 py-8 text-sm text-ifasto-secondary">{empty}</li>
        ) : (
          entries.map((entry, idx) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              position={idx + 1}
              busy={actionId === entry.id}
              onSeat={() => onSeat(entry.id)}
              onWalk={() => onWalk(entry.id)}
            />
          ))
        )}
      </ul>
    </div>
  );
}

function EntryRow({
  entry,
  position,
  busy,
  onSeat,
  onWalk,
}: {
  entry: QueueEntry;
  position: number;
  busy: boolean;
  onSeat: () => void;
  onWalk: () => void;
}) {
  const waited = waitedMinutes(entry.joined_at);
  return (
    <li className="px-6 py-3 flex items-center gap-4">
      <span className="font-mono text-sm text-ifasto-secondary w-6 shrink-0">
        {position}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">
          {entry.party_name || "Walk-in"}{" "}
          <span className="text-ifasto-secondary font-normal">
            · {entry.party_size}
          </span>
        </p>
        <p className="text-xs text-ifasto-secondary mt-0.5">
          waited {waited} min
          {entry.phone && <> · {entry.phone}</>}
          {entry.skip_price != null && (
            <> · ¥{entry.skip_price.toLocaleString()}</>
          )}
        </p>
        {entry.notes && (
          <p className="text-xs text-ifasto-secondary italic mt-0.5 truncate">
            {entry.notes}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onWalk}
          disabled={busy}
          className="px-3 py-1.5 text-xs border border-ifasto-border rounded hover:border-ifasto-text disabled:opacity-40 transition-colors"
        >
          Walk
        </button>
        <button
          onClick={onSeat}
          disabled={busy}
          className="px-3 py-1.5 text-xs bg-ifasto-text text-ifasto-bg rounded font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          Seat
        </button>
      </div>
    </li>
  );
}

function AddPartyModal({
  token,
  onClose,
  onAdded,
}: {
  token: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [partySize, setPartySize] = useState(2);
  const [entryType, setEntryType] = useState<"regular" | "premium">("regular");
  const [partyName, setPartyName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [skipPrice, setSkipPrice] = useState("");
  const [skipTouched, setSkipTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Live quote for the premium flow. One session per modal open — the
  // engine locks the quoted price to it for 5 minutes, and the backend
  // stores it on the entry so offer-to-sale conversion falls out of a join.
  const sessionIdRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const [quote, setQuote] = useState<PriceResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  useEffect(() => {
    if (entryType !== "premium") return;
    let cancelled = false;
    setQuoteLoading(true);
    pricingApi
      .quote(token, {
        party_size: partySize,
        source: "offer",
        session_id: sessionIdRef.current,
      })
      .then((r) => {
        if (cancelled) return;
        setQuote(r);
        // Prefill the charge field with the engine's quote unless the
        // operator already typed their own number (override is signal).
        if (r.ok && r.quote.price_minor != null && !skipTouched) {
          setSkipPrice(String(r.quote.price_minor));
        }
      })
      .finally(() => !cancelled && setQuoteLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryType, partySize, token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    const isPremium = entryType === "premium";
    const body: QueueEntryCreate = {
      party_size: partySize,
      entry_type: entryType,
      party_name: partyName.trim() || null,
      phone: phone.trim() || null,
      notes: notes.trim() || null,
      skip_price: isPremium && skipPrice.trim() ? Number(skipPrice) : null,
      pricing_session_id:
        isPremium && quote?.ok ? sessionIdRef.current : null,
      quoted_price:
        isPremium && quote?.ok ? quote.quote.price_minor : null,
    };
    try {
      await queueApi.add(token, body);
      onAdded();
    } catch (e) {
      setErr(toMessage(e, "Could not add the party."));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center px-4 z-50"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-ifasto-bg w-full max-w-md rounded-lg border border-ifasto-border p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <p className="font-display text-xl">Add to queue</p>
          <button
            type="button"
            onClick={onClose}
            className="text-ifasto-secondary hover:text-ifasto-text text-sm"
          >
            Close
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Party size">
            <input
              type="number"
              min={1}
              max={20}
              required
              value={partySize}
              onChange={(e) => setPartySize(Number(e.target.value))}
              className="w-full px-3 py-2 bg-white border border-ifasto-border rounded-md text-base focus:outline-none focus:border-ifasto-text"
            />
          </Field>
          <Field label="Type">
            <select
              value={entryType}
              onChange={(e) =>
                setEntryType(e.target.value as "regular" | "premium")
              }
              className="w-full px-3 py-2 bg-white border border-ifasto-border rounded-md text-base focus:outline-none focus:border-ifasto-text"
            >
              <option value="regular">Regular</option>
              <option value="premium">Premium (skip)</option>
            </select>
          </Field>
        </div>

        <Field label="Name (optional)">
          <input
            type="text"
            value={partyName}
            onChange={(e) => setPartyName(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-ifasto-border rounded-md text-base focus:outline-none focus:border-ifasto-text"
          />
        </Field>

        <Field label="Phone (optional)">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-ifasto-border rounded-md text-base focus:outline-none focus:border-ifasto-text"
          />
        </Field>

        <Field label="Notes (optional)">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-ifasto-border rounded-md text-base focus:outline-none focus:border-ifasto-text"
          />
        </Field>

        {entryType === "premium" && (
          <>
            <div className="text-xs font-mono px-3 py-2 rounded-md bg-ifasto-bg border border-ifasto-border">
              {quoteLoading ? (
                <span className="text-ifasto-secondary">Fetching live quote…</span>
              ) : quote?.ok ? (
                <span>
                  Engine quote:{" "}
                  <span className="font-semibold">{formatPrice(quote.quote)}</span>
                  {quote.quote.predicted_wait_mins != null && (
                    <span className="text-ifasto-secondary">
                      {" "}· ~{Math.round(quote.quote.predicted_wait_mins)} min wait
                    </span>
                  )}
                  <span className="text-ifasto-secondary"> · locked 5 min</span>
                </span>
              ) : (
                <span className="text-amber-700">
                  No live quote ({quote?.message ?? "unavailable"}) — enter price manually
                </span>
              )}
            </div>
            <Field label="Skip price (¥ charged to guest)">
              <input
                type="number"
                min={0}
                step={100}
                value={skipPrice}
                onChange={(e) => {
                  setSkipTouched(true);
                  setSkipPrice(e.target.value);
                }}
                className="w-full px-3 py-2 bg-white border border-ifasto-border rounded-md text-base focus:outline-none focus:border-ifasto-text"
              />
            </Field>
          </>
        )}

        {err && <p className="text-sm text-red-600">{err}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2.5 bg-ifasto-text text-ifasto-bg rounded-md font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {submitting ? "Adding…" : "Add to queue"}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-ifasto-secondary uppercase tracking-wide">
        {label}
      </span>
      {children}
    </label>
  );
}

function CapsDrawer({
  token,
  settings,
  onSaved,
  onClose,
}: {
  token: string;
  settings: VenueSettings;
  onSaved: (s: VenueSettings) => void;
  onClose: () => void;
}) {
  const [sharePct, setSharePct] = useState(String(Math.round(settings.max_premium_share * 100)));
  const [ceiling, setCeiling] = useState(String(settings.price_ceiling));
  const [maxEligible, setMaxEligible] = useState(String(settings.max_party_size_eligible));
  const [largeCap, setLargeCap] = useState(String(settings.large_party_cap_per_service));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const next = await settingsApi.update(token, {
        max_premium_share: Number(sharePct) / 100,
        price_ceiling: Number(ceiling),
        max_party_size_eligible: Number(maxEligible),
        large_party_cap_per_service: Number(largeCap),
      });
      onSaved(next);
    } catch (e) {
      setErr(toMessage(e, "Could not save caps."));
      setBusy(false);
    }
  }

  return (
    <section className="px-6 py-4 border-b border-ifasto-border bg-ifasto-bg/60 flex flex-wrap items-end gap-4">
      <Field label="Max premium share (%)">
        <input
          type="number" min={1} max={50} value={sharePct}
          onChange={(e) => setSharePct(e.target.value)}
          className="w-28 px-3 py-2 bg-white border border-ifasto-border rounded-md text-sm focus:outline-none focus:border-ifasto-text"
        />
      </Field>
      <Field label="Price ceiling (¥)">
        <input
          type="number" min={100} step={500} value={ceiling}
          onChange={(e) => setCeiling(e.target.value)}
          className="w-32 px-3 py-2 bg-white border border-ifasto-border rounded-md text-sm focus:outline-none focus:border-ifasto-text"
        />
      </Field>
      <Field label="Max party size eligible">
        <input
          type="number" min={1} max={20} value={maxEligible}
          onChange={(e) => setMaxEligible(e.target.value)}
          className="w-28 px-3 py-2 bg-white border border-ifasto-border rounded-md text-sm focus:outline-none focus:border-ifasto-text"
        />
      </Field>
      <Field label="Large-party skips / service">
        <input
          type="number" min={0} max={50} value={largeCap}
          onChange={(e) => setLargeCap(e.target.value)}
          className="w-28 px-3 py-2 bg-white border border-ifasto-border rounded-md text-sm focus:outline-none focus:border-ifasto-text"
        />
      </Field>
      <div className="flex items-center gap-2 pb-0.5">
        <button
          onClick={() => void save()}
          disabled={busy}
          className="px-4 py-2 text-sm bg-ifasto-text text-ifasto-bg rounded-md font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {busy ? "Saving…" : "Save caps"}
        </button>
        <button
          onClick={onClose}
          className="text-sm text-ifasto-secondary hover:text-ifasto-text transition-colors"
        >
          Cancel
        </button>
      </div>
      {err && <p className="text-sm text-red-600 w-full">{err}</p>}
    </section>
  );
}

function splitEntries(entries: QueueEntry[]) {
  // Backend sends waiting entries already sorted by joined_at ascending.
  const premium: QueueEntry[] = [];
  const regular: QueueEntry[] = [];
  for (const e of entries) {
    if (e.entry_type === "premium") premium.push(e);
    else regular.push(e);
  }
  return { regular, premium };
}

function waitedMinutes(iso: string): number {
  const diff = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.round(diff / 60000));
}

function toMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return `${fallback} (${err.status})`;
  return fallback;
}
