"use client";

// Live operations board. Floor staff use this to add parties, see who is
// waiting (regular vs premium), and seat the next party. Premium parties
// always jump regular FIFO order.

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  type QueueEntry,
  type QueueEntryCreate,
  queueApi,
} from "@/lib/queue";
import { useQueue } from "@/lib/useQueue";
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
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    const body: QueueEntryCreate = {
      party_size: partySize,
      entry_type: entryType,
      party_name: partyName.trim() || null,
      phone: phone.trim() || null,
      notes: notes.trim() || null,
      skip_price:
        entryType === "premium" && skipPrice.trim()
          ? Number(skipPrice)
          : null,
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
          <Field label="Skip price (¥, optional)">
            <input
              type="number"
              min={0}
              step={100}
              value={skipPrice}
              onChange={(e) => setSkipPrice(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-ifasto-border rounded-md text-base focus:outline-none focus:border-ifasto-text"
            />
          </Field>
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
