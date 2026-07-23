"use client";

// Printable door QR sign. Staff open this page, hit print, tape the sheet
// by the door. Rotate is owner/manager only backend-side; the button just
// surfaces the failure as an alert for staff accounts.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/LocaleContext";
import { settingsApi, type QrInfo } from "@/lib/settings";

export default function QrSignPage() {
  const router = useRouter();
  const { token, user, loading: authLoading } = useAuth();
  const { t } = useT();
  const [qr, setQr] = useState<QrInfo | null>(null);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !token) router.replace("/login");
  }, [authLoading, token, router]);

  useEffect(() => {
    if (!token) return;
    settingsApi
      .qr(token)
      .then(setQr)
      .catch(() => setError(true));
  }, [token]);

  async function handleRotate() {
    if (!token || !qr) return;
    if (!window.confirm(t.qrSign.rotateConfirm)) return;
    try {
      const next = await settingsApi.rotateQr(token);
      setQr(next);
      setNotice(t.qrSign.rotated);
    } catch {
      setError(true);
    }
  }

  if (authLoading || !user) {
    return (
      <main className="min-h-dvh flex items-center justify-center">
        <p className="text-ifasto-secondary">{t.common.loading}</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh px-5 py-6 max-w-2xl mx-auto w-full">
      {/* Screen-only controls */}
      <div className="print:hidden mb-8">
        <div className="flex items-center justify-between mb-6">
          <Link href="/ops" className="text-sm text-ifasto-secondary">
            {t.qrSign.backToBoard}
          </Link>
          <div className="flex gap-2">
            <button
              onClick={handleRotate}
              className="px-4 py-2 rounded-md text-sm border border-ifasto-border text-ifasto-secondary"
            >
              {t.qrSign.rotate}
            </button>
            <button
              onClick={() => window.print()}
              className="px-5 py-2 rounded-md text-sm font-medium bg-ifasto-text text-ifasto-bg"
            >
              {t.qrSign.print}
            </button>
          </div>
        </div>
        <h1 className="font-display text-2xl tracking-tight">{t.qrSign.title}</h1>
        {notice && <p className="text-sm text-ifasto-text mt-2">{notice}</p>}
        {error && <p className="text-sm text-red-700 mt-2">{t.guest.network}</p>}
      </div>

      {/* The sign itself — bilingual by design, so one printout serves
          locals and tourists regardless of the dashboard locale. */}
      {qr && (
        <div className="bg-white border border-ifasto-border rounded-lg p-10 flex flex-col items-center text-center print:border-0 print:rounded-none print:p-0 print:min-h-dvh print:justify-center">
          {qr.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr.logo_url} alt="" className="h-16 w-16 object-contain mb-3" />
          )}
          <p className="font-display text-3xl tracking-tight mb-1">
            {qr.venue_name_ja ?? qr.venue_name}
          </p>
          {qr.venue_name_ja && qr.venue_name !== qr.venue_name_ja && (
            <p className="text-lg text-ifasto-secondary mb-6">{qr.venue_name}</p>
          )}

          <div className="my-8">
            <QRCodeSVG value={qr.guest_url} size={280} marginSize={2} />
          </div>

          <p className="text-2xl font-medium mb-1">スキャンして順番待ちに参加</p>
          <p className="text-lg text-ifasto-secondary mb-6">Scan to join the queue</p>
          <p className="text-base text-ifasto-secondary mb-1">
            お並びの前に、スマートフォンで受付できます
          </p>
          <p className="text-sm text-ifasto-secondary mb-8">
            Join from your phone before lining up
          </p>

          <p className="font-mono text-xs text-ifasto-secondary break-all">
            {t.qrSign.urlLabel}: {qr.guest_url}
          </p>
          <p className="font-display text-lg tracking-tight mt-6">ifasto</p>
        </div>
      )}
    </main>
  );
}
