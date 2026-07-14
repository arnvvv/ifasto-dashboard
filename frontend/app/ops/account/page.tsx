"use client";

// Account page — lets an operator change the password the admin CLI minted
// for them. Uses FastAPI-Users' PATCH /api/users/me (server re-hashes).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/LocaleContext";
import { LOCALES, type Locale } from "@/lib/i18n";

export default function AccountPage() {
  const router = useRouter();
  const { token, user, loading: authLoading } = useAuth();
  const { t, locale, setLocale } = useT();
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!authLoading && !token) router.replace("/login");
  }, [authLoading, token, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (pw1.length < 8) {
      setMsg({ ok: false, text: t.account.tooShort });
      return;
    }
    if (pw1 !== pw2) {
      setMsg({ ok: false, text: t.account.mismatch });
      return;
    }
    setBusy(true);
    try {
      await api("/api/users/me", {
        method: "PATCH",
        body: { password: pw1 },
        token,
      });
      setMsg({ ok: true, text: t.account.updated });
      setPw1("");
      setPw2("");
    } catch (err) {
      setMsg({
        ok: false,
        text:
          err instanceof ApiError
            ? t.account.failed(err.status)
            : t.account.network,
      });
    } finally {
      setBusy(false);
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
    <main className="flex-1 max-w-md mx-auto w-full px-5 py-8">
      <header className="flex items-center justify-between mb-8">
        <div>
          <p className="font-display text-2xl tracking-tight leading-none">{t.account.title}</p>
          <p className="text-xs text-ifasto-secondary mt-1">
            {user.email} · {user.role}
          </p>
        </div>
        <Link href="/ops" className="text-sm text-ifasto-secondary hover:text-ifasto-text">
          {t.account.backToBoard}
        </Link>
      </header>

      <div className="mb-8 space-y-1.5">
        <p className="text-sm font-medium">{t.account.language}</p>
        <div className="flex gap-2">
          {LOCALES.map((l) => (
            <button
              key={l.code}
              onClick={() => setLocale(l.code as Locale)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                locale === l.code
                  ? "bg-ifasto-text text-ifasto-bg border-ifasto-text"
                  : "bg-white text-ifasto-secondary border-ifasto-border"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm font-medium">{t.account.changePassword}</p>
        <input
          type="password"
          required
          autoComplete="new-password"
          placeholder={t.account.newPassword}
          value={pw1}
          onChange={(e) => setPw1(e.target.value)}
          className="w-full px-4 py-3 bg-white border border-ifasto-border rounded-lg text-base focus:outline-none focus:border-ifasto-text"
        />
        <input
          type="password"
          required
          autoComplete="new-password"
          placeholder={t.account.repeatPassword}
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          className="w-full px-4 py-3 bg-white border border-ifasto-border rounded-lg text-base focus:outline-none focus:border-ifasto-text"
        />
        {msg && (
          <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>
            {msg.text}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full py-3 bg-ifasto-text text-ifasto-bg rounded-lg font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {busy ? t.account.updating : t.account.update}
        </button>
      </form>
    </main>
  );
}
