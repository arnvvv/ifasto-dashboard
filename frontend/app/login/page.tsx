"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const { login, user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already logged in, bounce to ops.
  useEffect(() => {
    if (!loading && user) router.replace("/ops");
  }, [loading, user, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.status === 400 || err.status === 401
            ? "Incorrect email or password."
            : `Login failed (${err.status}): ${err.message}`,
        );
      } else {
        setError("Network error. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <p className="font-display text-4xl tracking-tight">ifasto</p>
          <p className="text-sm text-ifasto-secondary">Restaurant dashboard</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium block">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-3 bg-white border border-ifasto-border rounded-md text-base focus:outline-none focus:border-ifasto-text transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium block">Password</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-3 bg-white border border-ifasto-border rounded-md text-base focus:outline-none focus:border-ifasto-text transition-colors"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 font-medium">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-ifasto-text text-ifasto-bg rounded-md font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-xs text-ifasto-secondary text-center">
          Accounts are issued by ifasto. Contact{" "}
          <a
            href="mailto:arnav@ifasto.com"
            className="text-ifasto-text hover:text-ifasto-amber transition-colors"
          >
            arnav@ifasto.com
          </a>{" "}
          for access.
        </p>
      </div>
    </main>
  );
}
