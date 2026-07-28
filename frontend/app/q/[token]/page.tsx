"use client";

// Guest QR page — the fast-pass flow, two explicit steps:
//   1. size:  venue + live wait + party size + "See price"
//   2. quote: the price, front and center + "Confirm" (locks the spot for
//             5 minutes via the pending window) or "Back" for misclicks.
// No digital free-join here: the physical line is the free queue.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  acceptFastpass,
  getFastpassOffer,
  getVenue,
  loadTicket,
  saveTicket,
  PublicApiError,
  type FastpassOffer,
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
  const [step, setStep] = useState<"size" | "quote">("size");
  const [offer, setOffer] = useState<FastpassOffer | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);
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

  // Step 1 headline wait: a lightweight party-2 offer probe.
  const [headlineWait, setHeadlineWait] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    getFastpassOffer(token, 2)
      .then((o) => {
        if (alive && o.enabled && o.available && o.predicted_wait_mins != null) {
          setHeadlineWait(Math.max(1, Math.round(o.predicted_wait_mins)));
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token]);

  async function handleSeePrice() {
    if (quoteLoading) return;
    setQuoteLoading(true);
    setError(null);
    try {
      const o = await getFastpassOffer(token, partySize);
      setOffer(o);
      setStep("quote");
    } catch {
      setError("network");
    } finally {
      setQuoteLoading(false);
    }
  }

  async function handleConfirm() {
    if (accepting) return;
    setAccepting(true);
    setError(null);
    try {
      const res = await acceptFastpass(token, partySize);
      if (res.mode === "stripe") {
        window.location.href = res.checkout_url;
        return;
      }
      saveTicket(res.entry_id, token);
      router.replace(`/g/${res.entry_id}`);
    } catch (e) {
      if (e instanceof PublicApiError && e.status === 409) {
        // Sold out / paused between quote and confirm — re-fetch and show.
        const o = await getFastpassOffer(token, partySize).catch(() => null);
        setOffer(o);
      } else {
        setError("network");
      }
      setAccepting(false);
    }
  }

  const errorText =
    error === "unknown"
      ? t.guest.unknownVenue
      : error === "network"
        ? t.guest.network
        : null;

  const venueName =
    venue && (locale === "ja" ? (venue.venue_name_ja ?? venue.venue_name) : venue.venue_name);

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

      {!venue && errorText ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
          <p className="text-base text-ifasto-text">{errorText}</p>
        </div>
      ) : !venue ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-ifasto-secondary">{t.common.loading}</p>
        </div>
      ) : step === "size" ? (
        /* ---------------- STEP 1: party size ---------------- */
        <div className="flex-1 flex flex-col">
          {venue.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={venue.logo_url} alt="" className="h-14 w-14 object-contain mb-3" />
          )}
          <h1 className="font-display text-3xl tracking-tight mb-1" translate="no">{venueName}</h1>
          {headlineWait !== null && (
            <p className="text-2xl font-semibold text-ifasto-text mt-1 mb-1">
              {t.guest.currentWaitBig(headlineWait)}
            </p>
          )}
          <p className="text-sm text-ifasto-secondary mb-8">{t.guest.lineAtDoor}</p>

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
            onClick={handleSeePrice}
            disabled={quoteLoading}
            className="w-full py-4 rounded-md text-lg font-medium bg-ifasto-amber text-ifasto-text disabled:opacity-50"
          >
            {quoteLoading ? t.common.loading : t.guest.seePrice}
          </button>

          {existingTicket && (
            <Link
              href={`/g/${existingTicket}`}
              className="mt-6 text-center text-sm text-ifasto-text underline underline-offset-4"
            >
              {t.guest.returnToTicket}
            </Link>
          )}
        </div>
      ) : (
        /* ---------------- STEP 2: the price ---------------- */
        <div className="flex-1 flex flex-col">
          <button
            onClick={() => setStep("size")}
            className="self-start text-sm text-ifasto-secondary mb-6"
          >
            {t.guest.goBack}
          </button>

          <p className="text-ifasto-secondary mb-1" translate="no">{venueName}</p>
          <h1 className="font-display text-2xl tracking-tight mb-8">
            {t.guest.fastPass} · {t.common.partyOf(partySize)}
          </h1>

          {offer?.enabled && offer.available && offer.price_minor != null ? (
            <>
              <div className="bg-white border border-ifasto-border rounded-lg p-8 text-center mb-4">
                <p className="font-mono text-5xl text-ifasto-text mb-2">
                  ¥{offer.price_minor.toLocaleString()}
                </p>
                {offer.predicted_wait_mins != null && (
                  <p className="text-ifasto-secondary">
                    {t.guest.currentWaitBig(Math.max(1, Math.round(offer.predicted_wait_mins)))}
                  </p>
                )}
              </div>

              <p className="text-sm text-ifasto-secondary mb-6">{t.guest.lockNote}</p>

              {errorText && (
                <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-4 py-3 mb-4">
                  {errorText}
                </p>
              )}

              <button
                onClick={handleConfirm}
                disabled={accepting}
                className="w-full py-4 rounded-md text-lg font-semibold bg-ifasto-amber text-ifasto-text disabled:opacity-50"
              >
                {accepting
                  ? t.guest.fpAccepting
                  : t.guest.confirmFor(`¥${offer.price_minor.toLocaleString()}`)}
              </button>
              <button
                onClick={() => setStep("size")}
                className="w-full mt-3 py-4 rounded-md text-base font-medium bg-white border border-ifasto-border text-ifasto-text"
              >
                {t.guest.goBack}
              </button>
            </>
          ) : (
            <>
              <p className="text-base text-ifasto-text mb-6">{t.guest.notAvailableNow}</p>
              <button
                onClick={() => setStep("size")}
                className="w-full py-4 rounded-md text-base font-medium bg-white border border-ifasto-border text-ifasto-text"
              >
                {t.guest.goBack}
              </button>
            </>
          )}
        </div>
      )}

      <p className="text-xs text-ifasto-secondary text-center mt-10" translate="no">{t.guest.poweredBy}</p>
    </main>
  );
}
