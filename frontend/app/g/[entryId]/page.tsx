"use client";

// Guest ticket page — polls entry status every 10s (guests don't get a WS
// connection; polling is cheaper and survives flaky cafe wifi).

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  clearTicket,
  getEntry,
  leaveQueue,
  PublicApiError,
  type PublicEntry,
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
        <p className="font-display text-xl tracking-tight">ifasto</p>
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
          <p className="text-ifasto-secondary mb-1">{venueName}</p>
          <h1 className="font-display text-2xl tracking-tight mb-8">{t.guest.ticketTitle}</h1>

          <div className="bg-white border border-ifasto-border rounded-lg p-8 text-center mb-6">
            <p className="font-mono text-6xl text-ifasto-text mb-2">
              {t.guest.ticketNo(entry.ticket_no)}
            </p>
            {entry.status === "waiting" && (
              <>
                <p className="text-lg text-ifasto-text mt-4">
                  {t.guest.partiesAhead(entry.parties_ahead)}
                </p>
                <p className="text-ifasto-secondary mt-1">
                  {entry.est_remaining_mins !== null
                    ? t.guest.estWait(Math.round(entry.est_remaining_mins))
                    : t.guest.waitUnknown}
                </p>
              </>
            )}
          </div>

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

      <p className="text-xs text-ifasto-secondary text-center mt-10">{t.guest.poweredBy}</p>
    </main>
  );
}
