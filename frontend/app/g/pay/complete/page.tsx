"use client";

// Stripe redirect target: verifies the checkout session server-side and
// lands the guest on their ticket. Suspense-wrapped for useSearchParams.

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { completeFastpass, saveTicket } from "@/lib/publicApi";
import { useGuestLocale } from "@/lib/useGuestLocale";

function CompleteInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { t } = useGuestLocale();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const token = params.get("token");
    const cs = params.get("cs");
    if (!token || !cs) {
      setFailed(true);
      return;
    }
    completeFastpass(token, cs)
      .then((entry) => {
        saveTicket(entry.entry_id, token);
        router.replace(`/g/${entry.entry_id}`);
      })
      .catch(() => setFailed(true));
  }, [params, router]);

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-xl tracking-tight mb-6" translate="no">ifasto</p>
      <p className="text-base text-ifasto-text">
        {failed ? t.guest.fpPayFailed : t.guest.fpCompleting}
      </p>
    </main>
  );
}

export default function PayCompletePage() {
  return (
    <Suspense fallback={null}>
      <CompleteInner />
    </Suspense>
  );
}
