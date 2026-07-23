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
import { useT } from "@/lib/LocaleContext";

export default function OpsPage() {
  const router = useRouter();
  const { token, user, loading: authLoading, logout } = useAuth();
  const { t, locale, setLocale } = useT();

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
  const [quickBusy, setQuickBusy] = useState<number | null>(null);
  // Mobile-only: the management links collapse into a single "More" menu so
  // the floor view stays uncluttered. Desktop shows them inline.
  const [menuOpen, setMenuOpen] = useState(false);

  // 30-second undo window after seat/walk (fat-finger protection).
  const [undoState, setUndoState] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function armUndo(id: string, label: string) {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoState({ id, label });
    undoTimer.current = setTimeout(() => setUndoState(null), 30_000);
  }

  async function handleUndo() {
    if (!token || !undoState) return;
    const id = undoState.id;
    setUndoState(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    try {
      await queueApi.reinstate(token, id);
    } catch {
      setActionError(t.ops.errUndo);
    }
    void refresh();
  }

  // Keep the tablet awake through a whole service. Re-acquire when the tab
  // becomes visible again (the lock is released on hide).
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    async function acquire() {
      try {
        const wl = (navigator as Navigator & {
          wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
        }).wakeLock;
        if (wl) lock = await wl.request("screen");
      } catch {
        // Not supported or denied — non-fatal.
      }
    }
    void acquire();
    const onVis = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release().catch(() => {});
    };
  }, []);

  async function quickAdd(size: number) {
    if (!token || quickBusy !== null) return;
    setQuickBusy(size);
    setActionError(null);
    try {
      await queueApi.add(token, { party_size: size, entry_type: "regular" });
    } catch (err) {
      setActionError(toMessage(err, t.ops.errAdd));
    } finally {
      setQuickBusy(null);
    }
  }

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
      setActionError(toMessage(err, t.ops.errPause));
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleSeat(id: string) {
    if (!token) return;
    setActionId(id);
    setActionError(null);
    try {
      const seated = await queueApi.seat(token, id);
      armUndo(
        id,
        t.ops.undoSeated(
          seated.ticket_no != null ? t.ops.ticket(seated.ticket_no) : "",
        ),
      );
      // WS will deliver the update; refresh as a belt-and-braces fallback.
    } catch (err) {
      setActionError(toMessage(err, t.ops.errSeat));
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
      const walked = await queueApi.walkAway(token, id);
      armUndo(
        id,
        t.ops.undoWalked(
          walked.ticket_no != null ? t.ops.ticket(walked.ticket_no) : "",
        ),
      );
    } catch (err) {
      setActionError(toMessage(err, t.ops.errWalk));
      void refresh();
    } finally {
      setActionId(null);
    }
  }

  if (authLoading || !user) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <p className="text-sm text-ifasto-secondary">{t.common.loading}</p>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col">
      <header className="border-b border-ifasto-border px-4 sm:px-6 py-3 sm:py-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-xl sm:text-2xl tracking-tight leading-none truncate">
              {t.ops.title}
            </p>
            <p className="text-xs text-ifasto-secondary mt-1 truncate">
              {t.ops.signedInAs(user.name)} · {t.common.roleLabel(user.role)}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-mono ${
                connected ? "text-emerald-600" : "text-ifasto-secondary"
              }`}
              title={connected ? t.ops.liveTooltip : t.ops.offlineTooltip}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  connected ? "bg-emerald-500" : "bg-ifasto-border"
                }`}
              />
              {connected ? t.ops.live : t.ops.offline}
            </span>
            <button
              onClick={() => void logout()}
              className="text-sm text-ifasto-secondary hover:text-ifasto-text transition-colors"
            >
              {t.common.signOut}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {settings && (
            <button
              onClick={() => void togglePause()}
              disabled={!canEditSettings || settingsBusy}
              title={
                canEditSettings
                  ? settings.premium_paused
                    ? t.ops.pauseTooltipPaused
                    : t.ops.pauseTooltipOn
                  : t.ops.ownerOnly
              }
              className={`px-3 py-2 rounded-md text-xs font-mono font-medium border transition-colors min-w-0 truncate ${
                settings.premium_paused
                  ? "bg-amber-100 border-amber-300 text-amber-800"
                  : "bg-emerald-50 border-emerald-200 text-emerald-700"
              } ${canEditSettings ? "hover:opacity-80" : "cursor-default opacity-70"}`}
            >
              {settings.premium_paused ? t.ops.premiumPaused : t.ops.premiumOn}
            </button>
          )}

          {/* Desktop: all management links inline (unchanged). */}
          <div className="hidden sm:flex sm:flex-1 items-center gap-2 sm:gap-3 flex-wrap">
            {canEditSettings && (
              <button
                onClick={() => setShowCaps((v) => !v)}
                className="text-sm text-ifasto-secondary hover:text-ifasto-text transition-colors py-2 px-1"
                title={t.ops.caps}
              >
                {t.ops.caps}
              </button>
            )}
            <a href="/ops/help" className="text-sm text-ifasto-secondary hover:text-ifasto-text transition-colors py-2 px-1">
              {t.ops.help}
            </a>
            <a href="/ops/qr" className="text-sm text-ifasto-secondary hover:text-ifasto-text transition-colors py-2 px-1">
              {t.ops.qrSign}
            </a>
            <a href="/ops/history" className="text-sm text-ifasto-secondary hover:text-ifasto-text transition-colors py-2 px-1">
              {t.ops.history}
            </a>
            <a href="/ops/survey" className="text-sm text-ifasto-secondary hover:text-ifasto-text transition-colors py-2 px-1">
              {t.ops.survey}
            </a>
            <a href="/ops/account" className="text-sm text-ifasto-secondary hover:text-ifasto-text transition-colors py-2 px-1">
              {t.ops.account}
            </a>
            {user.is_superuser && (
              <a href="/ops/admin" className="text-sm text-ifasto-secondary hover:text-ifasto-text transition-colors py-2 px-1">
                Admin
              </a>
            )}
            <button
              onClick={() => setLocale(locale === "ja" ? "en" : "ja")}
              className="ml-auto text-xs font-mono border border-ifasto-border rounded px-2.5 py-1.5 text-ifasto-secondary hover:text-ifasto-text hover:border-ifasto-text transition-colors"
              title={locale === "ja" ? "Switch to English" : "日本語に切り替え"}
            >
              {locale === "ja" ? "EN" : "日本語"}
            </button>
          </div>

          {/* Mobile: one "More" menu keeps the floor view clean. */}
          <div className="relative ml-auto sm:hidden shrink-0">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              className="flex items-center gap-1 text-sm text-ifasto-secondary border border-ifasto-border rounded-md px-3 py-2 hover:border-ifasto-text transition-colors"
            >
              {t.ops.menu}
              <span className="text-[10px] leading-none">▾</span>
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1.5 z-40 w-44 bg-white border border-ifasto-border rounded-lg shadow-lg py-1.5 flex flex-col">
                  {canEditSettings && (
                    <button
                      onClick={() => { setShowCaps(true); setMenuOpen(false); }}
                      className="text-left px-4 py-2.5 text-sm text-ifasto-text hover:bg-ifasto-bg"
                    >
                      {t.ops.caps}
                    </button>
                  )}
                  <a href="/ops/help" className="px-4 py-2.5 text-sm text-ifasto-text hover:bg-ifasto-bg">{t.ops.help}</a>
                  <a href="/ops/qr" className="px-4 py-2.5 text-sm text-ifasto-text hover:bg-ifasto-bg">{t.ops.qrSign}</a>
                  <a href="/ops/history" className="px-4 py-2.5 text-sm text-ifasto-text hover:bg-ifasto-bg">{t.ops.history}</a>
                  <a href="/ops/survey" className="px-4 py-2.5 text-sm text-ifasto-text hover:bg-ifasto-bg">{t.ops.survey}</a>
                  <a href="/ops/account" className="px-4 py-2.5 text-sm text-ifasto-text hover:bg-ifasto-bg">{t.ops.account}</a>
                  {user.is_superuser && (
                    <a href="/ops/admin" className="px-4 py-2.5 text-sm text-ifasto-text hover:bg-ifasto-bg">Admin</a>
                  )}
                  <button
                    onClick={() => { setLocale(locale === "ja" ? "en" : "ja"); setMenuOpen(false); }}
                    className="text-left px-4 py-2.5 mt-1 pt-2.5 border-t border-ifasto-border text-sm text-ifasto-secondary hover:bg-ifasto-bg"
                  >
                    {locale === "ja" ? "English" : "日本語"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {!connected && !loading && (
        <div className="px-4 sm:px-6 py-2.5 bg-amber-100 border-b border-amber-300 text-sm text-amber-900 font-medium">
          {t.ops.offlineBanner}
        </div>
      )}

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

      {/* Floor-priority metrics. Mobile shows the four that drive decisions
          as a clean 2x2; the rest reveal on larger screens. */}
      <section className="px-4 sm:px-6 py-3.5 sm:py-5 border-b border-ifasto-border grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-x-3 gap-y-3 sm:gap-4">
        <Stat label={t.ops.tileWaiting} value={state?.total_waiting ?? entries.length} />
        <Stat label={t.ops.tilePremium} value={state?.premium_waiting ?? premium.length} />
        <Stat label={t.ops.tileSeatedToday} value={state?.seated_today ?? 0} />
        <Stat
          label={t.ops.tilePremiumToday}
          value={formatYen(state?.premium_revenue_today ?? 0)}
          accent
        />
        <Stat
          className="hidden sm:block"
          label={t.ops.tileRegular}
          value={state?.regular_waiting ?? regular.length}
        />
        <Stat
          className="hidden sm:block"
          label={t.ops.tileMedianWait}
          value={
            state?.median_wait_today_mins != null
              ? t.common.minutes(Math.round(state.median_wait_today_mins))
              : "-"
          }
        />
        {token && (
          <div className="hidden lg:block">
            <LivePriceTile token={token} partySize={2} active />
          </div>
        )}
      </section>

      <section className="px-4 sm:px-6 py-3 border-b border-ifasto-border flex items-center gap-2 sm:gap-3">
        <span className="text-xs font-mono uppercase tracking-widest text-ifasto-secondary shrink-0">
          {t.ops.quickAdd}
        </span>
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            onClick={() => void quickAdd(n)}
            disabled={quickBusy !== null}
            className="flex-1 sm:flex-none sm:w-14 py-3 text-base font-semibold border border-ifasto-border rounded-md bg-white hover:border-ifasto-text disabled:opacity-40 transition-colors tabular-nums"
          >
            {quickBusy === n ? "…" : n}
          </button>
        ))}
        <button
          onClick={() => setShowAdd(true)}
          className="shrink-0 px-4 py-3 text-sm text-ifasto-secondary border border-ifasto-border rounded-md hover:border-ifasto-text transition-colors"
        >
          {t.ops.quickAddDetail}
        </button>
      </section>

      <section className="px-4 sm:px-6 py-4 border-b border-ifasto-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-mono uppercase tracking-widest text-ifasto-secondary">
            {t.ops.nextUp}
          </p>
          <p className="font-display text-xl truncate">
            {nextUp ? (
              <>
                {nextUp.ticket_no != null && (
                  <span className="font-mono font-bold text-ifasto-text mr-2">
                    {t.ops.ticket(nextUp.ticket_no)}
                  </span>
                )}
                {nextUp.party_name || t.ops.walkIn}{" "}
                <span className="text-ifasto-secondary">
                  · {t.common.partyOf(nextUp.party_size)}
                </span>
                {nextUp.entry_type === "premium" && (
                  <span className="ml-2 text-xs font-mono text-ifasto-amber">
                    {t.ops.premiumChip}
                  </span>
                )}
              </>
            ) : (
              <span className="text-ifasto-secondary">{t.ops.queueEmpty}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
          <button
            onClick={() => setShowAdd(true)}
            className="flex-1 sm:flex-none px-4 py-3 sm:py-2 text-sm border border-ifasto-border rounded-md hover:border-ifasto-text transition-colors"
          >
            {t.ops.addParty}
          </button>
          <button
            onClick={() => nextUp && handleSeat(nextUp.id)}
            disabled={!nextUp || actionId === nextUp?.id}
            className="flex-1 sm:flex-none px-4 py-3 sm:py-2 text-sm bg-ifasto-text text-ifasto-bg rounded-md font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {t.ops.seatNext}
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
          title={t.ops.colPremium}
          tone="amber"
          entries={premium}
          empty={t.ops.emptyPremium}
          actionId={actionId}
          onSeat={handleSeat}
          onWalk={handleWalk}
          loading={loading}
        />
        <QueueColumn
          title={t.ops.colRegular}
          tone="text"
          entries={regular}
          empty={t.ops.emptyRegular}
          actionId={actionId}
          onSeat={handleSeat}
          onWalk={handleWalk}
          loading={loading}
        />
      </section>

      {undoState && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 bg-ifasto-text text-ifasto-bg rounded-lg px-5 py-3 shadow-lg">
          <span className="text-sm">{undoState.label}</span>
          <button
            onClick={() => void handleUndo()}
            className="text-sm font-bold underline underline-offset-2"
          >
            {t.ops.undo}
          </button>
        </div>
      )}

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
  className = "",
}: {
  label: string;
  value: string | number;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[11px] sm:text-xs font-mono uppercase tracking-widest text-ifasto-secondary truncate">
        {label}
      </p>
      <p
        className={`font-display text-2xl mt-0.5 tabular-nums ${
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
  const { t } = useT();
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
          <li className="px-6 py-8 text-sm text-ifasto-secondary">{t.common.loading}</li>
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
  const { t } = useT();
  const waited = waitedMinutes(entry.joined_at);
  return (
    <li className="px-4 sm:px-6 py-3 flex items-center gap-3 sm:gap-4">
      <span className="font-mono text-base font-bold text-ifasto-text w-12 shrink-0 tabular-nums">
        {entry.ticket_no != null ? t.ops.ticket(entry.ticket_no) : position}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">
          {entry.party_name || t.ops.walkIn}{" "}
          <span className="text-ifasto-secondary font-normal">
            · {entry.party_size}
          </span>
        </p>
        <p className="text-xs text-ifasto-secondary mt-0.5">
          {t.ops.waited(waited)}
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
          className="px-4 py-2.5 text-xs border border-ifasto-border rounded-md hover:border-ifasto-text disabled:opacity-40 transition-colors"
        >
          {t.ops.walk}
        </button>
        <button
          onClick={onSeat}
          disabled={busy}
          className="px-4 py-2.5 text-xs bg-ifasto-text text-ifasto-bg rounded-md font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {t.ops.seat}
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
  const { t } = useT();
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
      setErr(toMessage(e, t.ops.errAdd));
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
          <p className="font-display text-xl">{t.modal.title}</p>
          <button
            type="button"
            onClick={onClose}
            className="text-ifasto-secondary hover:text-ifasto-text text-sm"
          >
            {t.common.close}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t.modal.partySize}>
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
          <Field label={t.modal.type}>
            <select
              value={entryType}
              onChange={(e) =>
                setEntryType(e.target.value as "regular" | "premium")
              }
              className="w-full px-3 py-2 bg-white border border-ifasto-border rounded-md text-base focus:outline-none focus:border-ifasto-text"
            >
              <option value="regular">{t.modal.typeRegular}</option>
              <option value="premium">{t.modal.typePremium}</option>
            </select>
          </Field>
        </div>

        <Field label={t.modal.name}>
          <input
            type="text"
            value={partyName}
            onChange={(e) => setPartyName(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-ifasto-border rounded-md text-base focus:outline-none focus:border-ifasto-text"
          />
        </Field>

        <Field label={t.modal.phone}>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-ifasto-border rounded-md text-base focus:outline-none focus:border-ifasto-text"
          />
        </Field>

        <Field label={t.modal.notes}>
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
                <span className="text-ifasto-secondary">{t.modal.fetchingQuote}</span>
              ) : quote?.ok ? (
                <span>
                  {t.modal.engineQuote}{" "}
                  <span className="font-semibold">{formatPrice(quote.quote)}</span>
                  {quote.quote.predicted_wait_mins != null && (
                    <span className="text-ifasto-secondary">
                      {" "}· {t.modal.quoteWait(Math.round(quote.quote.predicted_wait_mins))}
                    </span>
                  )}
                  <span className="text-ifasto-secondary"> · {t.modal.quoteLocked}</span>
                </span>
              ) : (
                <span className="text-amber-700">
                  {t.modal.noQuote(
                    quote && !quote.ok
                      ? ({
                          premium_paused: t.tile.paused,
                          large_party_cap_reached: t.tile.capReached,
                          out_of_service_hours: t.tile.outOfHours,
                          engine_unavailable: t.tile.engineOffline,
                          unavailable_hard_cap: t.tile.capReached,
                        }[quote.reason] ?? quote.message)
                      : t.tile.unavailable,
                  )}
                </span>
              )}
            </div>
            <Field label={t.modal.skipPrice}>
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
          {submitting ? t.modal.submitting : t.modal.submit}
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
  const { t } = useT();
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
      setErr(toMessage(e, t.caps.errSave));
      setBusy(false);
    }
  }

  return (
    <section className="px-6 py-4 border-b border-ifasto-border bg-ifasto-bg/60 flex flex-wrap items-end gap-4">
      <Field label={t.caps.maxShare}>
        <input
          type="number" min={1} max={50} value={sharePct}
          onChange={(e) => setSharePct(e.target.value)}
          className="w-28 px-3 py-2 bg-white border border-ifasto-border rounded-md text-sm focus:outline-none focus:border-ifasto-text"
        />
      </Field>
      <Field label={t.caps.ceiling}>
        <input
          type="number" min={100} step={500} value={ceiling}
          onChange={(e) => setCeiling(e.target.value)}
          className="w-32 px-3 py-2 bg-white border border-ifasto-border rounded-md text-sm focus:outline-none focus:border-ifasto-text"
        />
      </Field>
      <Field label={t.caps.maxEligible}>
        <input
          type="number" min={1} max={20} value={maxEligible}
          onChange={(e) => setMaxEligible(e.target.value)}
          className="w-28 px-3 py-2 bg-white border border-ifasto-border rounded-md text-sm focus:outline-none focus:border-ifasto-text"
        />
      </Field>
      <Field label={t.caps.largeCap}>
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
          {busy ? t.common.saving : t.caps.saveCaps}
        </button>
        <button
          onClick={onClose}
          className="text-sm text-ifasto-secondary hover:text-ifasto-text transition-colors"
        >
          {t.common.cancel}
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
