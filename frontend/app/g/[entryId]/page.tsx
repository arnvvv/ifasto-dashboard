"use client";

// Guest ticket page — polls entry status every 10s (guests don't get a WS
// connection; polling is cheaper and survives flaky cafe wifi).

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  clearTicket,
  getEntry,
  getUpgradeOffer,
  leaveQueue,
  upgradeEntry,
  PublicApiError,
  type PublicEntry,
  type UpgradeOffer,
} from "@/lib/publicApi";
import { useGuestLocale } from "@/lib/useGuestLocale";

const POLL_MS = 10_000;

export default function GuestTicketPage() {
  const { entryId } = useParams<{ entryId: string }>();
  const { locale, setLocale, t } = useGuestLocale();

  const [entry, setEntry] = useState<PublicEntry | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [upOffer, setUpOffer] = useState<UpgradeOffer | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    getEntry(entryId)
      .then((e) => {
        setEntry(e);
        // Terminal states: stop polling, forget the stored ticket.
        if (e.status !== "waiting") {
          if (timer.current) clearInterval(timer.current);
          clearTicket();
        }
      })
      .catch((e) => {
        if (e instanceof PublicApiError && e.status === 404) {
          setNotFound(true);
          if (timer.current) clearInterval(timer.current);
        }
        // network blips: keep the last known state, next poll retries
      });
  }, [entryId]);

  // Upgrade offer for free-lane guests: fetch on load, refresh every 30s
  // (the price moves with the queue).
  useEffect(() => {
    let alive = true;
    const load = () =>
      getUpgradeOffer(entryId)
        .then((o) => {
          if (alive) setUpOffer(o);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [entryId]);

  async function handleUpgrade() {
    if (upgrading) return;
    setUpgrading(true);
    try {
      const res = await upgradeEntry(entryId);
      if (res.mode === "stripe") {
        window.location.href = res.checkout_url;
        return;
      }
      setEntry(res);
      setUpOffer(null);
    } catch {
      getUpgradeOffer(entryId).then(setUpOffer).catch(() => {});
    } finally {
      setUpgrading(false);
    }
  }

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer.current) clearInterval(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  async function handleLeave() {
    if (leaving) return;
    setLeaving(true);
    try {
      const e = await leaveQueue(entryId);
      setEntry(e);
      clearTicket();
      if (timer.current) clearInterval(timer.current);
    } catch {
      refresh();
    } finally {
      setLeaving(false);
      setConfirmLeave(false);
    }
  }

  const venueName =
    entry && (locale === "ja" ? (entry.venue_name_ja ?? entry.venue_name) : entry.venue_name);

  return (
    <main className="min-h-dvh flex flex-col px-5 py-6 max-w-md mx-auto w-full">
      <div className="flex items-center justify-between mb-8">
        <p className="font-display text-xl tracking-tight" translate="no">ifasto</p>
        <button
          onClick={() => setLocale(locale === "ja" ? "en" : "ja")}
          className="text-sm text-ifasto-secondary border border-ifasto-border rounded-md px-3 py-1.5"
        >
          {locale === "ja" ? "EN" : "日本語"}
        </button>
      </div>

      {notFound ? (
        <div className="flex-1 flex items-center justify-center text-center">
          <p className="text-base text-ifasto-text">{t.guest.unknownVenue}</p>
        </div>
      ) : !entry ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-ifasto-secondary">{t.common.loading}</p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          <p className="text-ifasto-secondary mb-1" translate="no">{venueName}</p>
          <h1 className="font-display text-2xl tracking-tight mb-8">{t.guest.ticketTitle}</h1>

          <div className="bg-white border border-ifasto-border rounded-lg p-8 text-center mb-6">
            {entry.entry_type === "premium" && (
              <div className="mb-4">
                <span className="inline-block px-3 py-1 rounded-full bg-ifasto-amber text-sm font-medium">
                  {t.guest.fastPass}
                </span>
                {entry.paid_amount !== null && (
                  <p className="text-sm text-ifasto-secondary mt-2">
                    {entry.status === "waiting" && !entry.paid_online
                      ? t.guest.fpPayAtRegister(`¥${entry.paid_amount.toLocaleString()}`)
                      : t.guest.paid(`¥${entry.paid_amount.toLocaleString()}`)}
                  </p>
                )}
              </div>
            )}
            <p className="font-mono text-6xl text-ifasto-text mb-2">
              {t.guest.ticketNo(entry.ticket_no)}
            </p>
            {entry.status === "waiting" && (
              <>
                <p className="text-lg text-ifasto-text mt-4">
                  {t.guest.partiesAhead(entry.parties_ahead)}
                </p>
                <p className="text-ifasto-secondary mt-1">
                  {entry.est_remaining_p10 !== null && entry.est_remaining_p90 !== null
                    ? t.guest.estWaitRange(
                        Math.round(entry.est_remaining_p10),
                        Math.round(entry.est_remaining_p90)
                      )
                    : entry.est_remaining_mins !== null
                      ? t.guest.estWait(Math.round(entry.est_remaining_mins))
                      : t.guest.waitUnknown}
                </p>
              </>
            )}
          </div>

          {entry.status === "waiting" && entry.entry_type === "premium" &&
            entry.pending_seconds_left != null && (
            <div className="mb-6 rounded-md bg-amber-100 border border-amber-300 px-4 py-3 text-sm text-amber-900">
              {t.guest.fpPendingBanner(Math.max(1, Math.ceil(entry.pending_seconds_left / 60)))}
            </div>
          )}

          {entry.status === "waiting" && entry.entry_type === "regular" &&
            upOffer?.available && upOffer.price_minor != null && (
            <button
              onClick={handleUpgrade}
              disabled={upgrading}
              className="w-full mb-6 py-4 rounded-md border-2 border-ifasto-text bg-white text-left px-4 disabled:opacity-50"
            >
              <span className="block text-[11px] uppercase tracking-widest text-ifasto-secondary mb-1">
                {t.guest.fpUpgradeTitle}
              </span>
              <span className="block text-lg font-semibold">
                {upgrading
                  ? t.guest.fpAccepting
                  : t.guest.fpUpgradeButton(`¥${upOffer.price_minor.toLocaleString()}`)}
              </span>
            </button>
          )}

          {entry.status === "waiting" && (
            <>
              <p className="text-base text-ifasto-text text-center mb-2">
                {t.guest.statusWaiting}
              </p>
              <p className="text-sm text-ifasto-secondary text-center mb-8">{t.guest.keepOpen}</p>

              {confirmLeave ? (
                <div className="border border-ifasto-border rounded-md p-4">
                  <p className="text-sm text-ifasto-text mb-3 text-center">
                    {t.guest.leaveConfirm}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmLeave(false)}
                      className="flex-1 py-3 rounded-md text-sm font-medium bg-white border border-ifasto-border"
                    >
                      {t.guest.leaveNo}
                    </button>
                    <button
                      onClick={handleLeave}
                      disabled={leaving}
                      className="flex-1 py-3 rounded-md text-sm font-medium bg-red-600 text-white disabled:opacity-50"
                    >
                      {t.guest.leaveYes}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmLeave(true)}
                  className="text-sm text-ifasto-secondary underline underline-offset-4"
                >
                  {t.guest.leave}
                </button>
              )}
            </>
          )}

          {entry.status === "seated" && (
            <div className="text-center">
              <p className="text-lg text-ifasto-text mb-2">{t.guest.statusSeated}</p>
              <p className="text-ifasto-secondary">{t.guest.statusSeatedBody}</p>
            </div>
          )}

          {entry.status === "walked_away" && (
            <div className="text-center">
              <p className="text-lg text-ifasto-text mb-2">{t.guest.statusWalked}</p>
              <p className="text-ifasto-secondary">{t.guest.statusWalkedBody}</p>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-ifasto-secondary text-center mt-10" translate="no">{t.guest.poweredBy}</p>
    </main>
  );
}
