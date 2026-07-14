"use client";

// Guest join page — the target of the printed door QR.
// No auth, mobile-first, browser-language default.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getVenue,
  joinQueue,
  loadTicket,
  saveTicket,
  PublicApiError,
  type PublicVenue,
} from "@/lib/publicApi";
import { useGuestLocale } from "@/lib/useGuestLocale";

export default function GuestJoinPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { locale, setLocale, t } = useGuestLocale();

  const [venue, setVenue] = useState<PublicVenue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [partySize, setPartySize] = useState(2);
  const [joining, setJoining] = useState(false);
  const [existingTicket, setExistingTicket] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadTicket();
    if (stored && stored.token === token) setExistingTicket(stored.entryId);
  }, [token]);

  useEffect(() => {
    let alive = true;
    getVenue(token)
      .then((v) => {
        if (alive) setVenue(v);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof PublicApiError && e.status === 404 ? "unknown" : "network");
      });
    return () => {
      alive = false;
    };
  }, [token]);

  async function handleJoin() {
    if (joining) return;
    setJoining(true);
    setError(null);
    try {
      const entry = await joinQueue(token, partySize);
      saveTicket(entry.entry_id, token);
      router.replace(`/g/${entry.entry_id}`);
    } catch (e) {
      if (e instanceof PublicApiError) {
        if (e.status === 429) setError("tooMany");
        else if (e.status === 409) setError("queueFull");
        else if (e.status === 404) setError("unknown");
        else setError("network");
      } else {
        setError("network");
      }
      setJoining(false);
    }
  }

  const errorText =
    error === "unknown"
      ? t.guest.unknownVenue
      : error === "queueFull"
        ? t.guest.queueFull
        : error === "tooMany"
          ? t.guest.tooMany
          : error === "network"
            ? t.guest.network
            : null;

  const venueName =
    venue && (locale === "ja" ? (venue.venue_name_ja ?? venue.venue_name) : venue.venue_name);

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

      {!venue && errorText ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
          <p className="text-base text-ifasto-text">{errorText}</p>
        </div>
      ) : !venue ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-ifasto-secondary">{t.common.loading}</p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          <h1 className="font-display text-3xl tracking-tight mb-1">{venueName}</h1>
          <p className="text-ifasto-secondary mb-8">{t.guest.waitingNow(venue.waiting)}</p>

          <h2 className="text-base font-medium mb-3">{t.guest.partySize}</h2>
          <div className="grid grid-cols-4 gap-2 mb-8">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
              const active = partySize === n;
              return (
                <button
                  key={n}
                  onClick={() => setPartySize(n)}
                  aria-pressed={active}
                  className={
                    active
                      ? "py-4 rounded-md text-lg font-medium bg-ifasto-text text-ifasto-bg"
                      : "py-4 rounded-md text-lg font-medium bg-white border border-ifasto-border text-ifasto-text"
                  }
                >
                  {t.guest.people(n)}
                </button>
              );
            })}
          </div>

          {errorText && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-4 py-3 mb-4">
              {errorText}
            </p>
          )}

          <button
            onClick={handleJoin}
            disabled={joining || !venue.accepting}
            className="w-full py-4 rounded-md text-lg font-medium bg-ifasto-amber text-ifasto-text disabled:opacity-50"
          >
            {joining ? t.guest.joining : t.guest.join}
          </button>
          {!venue.accepting && !errorText && (
            <p className="text-sm text-ifasto-secondary mt-3 text-center">{t.guest.queueFull}</p>
          )}

          {existingTicket && (
            <Link
              href={`/g/${existingTicket}`}
              className="mt-6 text-center text-sm text-ifasto-text underline underline-offset-4"
            >
              {t.guest.returnToTicket}
            </Link>
          )}
        </div>
      )}

      <p className="text-xs text-ifasto-secondary text-center mt-10">{t.guest.poweredBy}</p>
    </main>
  );
}
