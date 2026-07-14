"use client";

// Account page — lets an operator change the password the admin CLI minted
// for them. Uses FastAPI-Users' PATCH /api/users/me (server re-hashes).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function AccountPage() {
  const router = useRouter();
  const { token, user, loading: authLoading } = useAuth();
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
      setMsg({ ok: false, text: "Password must be at least 8 characters." });
      return;
    }
    if (pw1 !== pw2) {
      setMsg({ ok: false, text: "Passwords do not match." });
      return;
    }
    setBusy(true);
    try {
      await api("/api/users/me", {
        method: "PATCH",
        body: { password: pw1 },
        token,
      });
      setMsg({ ok: true, text: "Password updated. Use it on your next sign-in." });
      setPw1("");
      setPw2("");
    } catch (err) {
      setMsg({
        ok: false,
        text:
          err instanceof ApiError
            ? `Could not update password (${err.status}).`
            : "Network error. Try again.",
      });
    } finally {
      setBusy(false);
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
    <main className="flex-1 max-w-md mx-auto w-full px-5 py-8">
      <header className="flex items-center justify-between mb-8">
        <div>
          <p className="font-display text-2xl tracking-tight leading-none">Account</p>
          <p className="text-xs text-ifasto-secondary mt-1">
            {user.email} · {user.role}
          </p>
        </div>
        <Link href="/ops" className="text-sm text-ifasto-secondary hover:text-ifasto-text">
          ← Ops
        </Link>
      </header>

      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm font-medium">Change password</p>
        <input
          type="password"
          required
          autoComplete="new-password"
          placeholder="New password (min 8 characters)"
          value={pw1}
          onChange={(e) => setPw1(e.target.value)}
          className="w-full px-4 py-3 bg-white border border-ifasto-border rounded-lg text-base focus:outline-none focus:border-ifasto-text"
        />
        <input
          type="password"
          required
          autoComplete="new-password"
          placeholder="Repeat new password"
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
          {busy ? "Saving…" : "Update password"}
        </button>
      </form>
    </main>
  );
}
