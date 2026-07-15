"use client";

// Auth context: holds the JWT in localStorage + the current user.
// localStorage is acceptable for pilot stage; revisit (httpOnly cookie via
// CookieTransport) before broader rollout.

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError } from "./api";

const TOKEN_KEY = "ifasto.dashboard.jwt";

export type UserRole = "owner" | "manager" | "staff";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  language_pref: "ja" | "en";
  restaurant_id: string;
  is_active: boolean;
  is_verified: boolean;
}

interface AuthCtx {
  token: string | null;
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Bootstrap: read token from localStorage, validate via /api/me.
  useEffect(() => {
    const stored =
      typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    if (!stored) {
      setLoading(false);
      return;
    }
    setToken(stored);
    api<CurrentUser>("/api/me", { token: stored })
      .then((u) => setUser(u))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // Sliding session: swap the token for a fresh 7-day one on load and every
  // 12h. The door tablet stays signed in indefinitely as long as the board
  // is opened at least once a week. Failures are silent — the old token
  // keeps working until its own expiry.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await api<{ access_token: string }>("/api/auth/refresh", {
          method: "POST",
          token,
        });
        if (!cancelled && res.access_token) {
          localStorage.setItem(TOKEN_KEY, res.access_token);
          setToken(res.access_token);
        }
      } catch {
        // keep current token; bootstrap 401 handling covers real expiry
      }
    };
    refresh();
    const id = setInterval(refresh, 12 * 60 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // Deliberately keyed on !!token: re-running on every refreshed token
    // value would reset the interval (and loop through refresh() each time).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!token]);

  const login = useCallback(
    async (email: string, password: string) => {
      // FastAPI-Users JWT login expects OAuth2-form body, not JSON.
      const res = await api<{ access_token: string; token_type: string }>(
        "/api/auth/jwt/login",
        { method: "POST", form: { username: email, password } },
      );
      localStorage.setItem(TOKEN_KEY, res.access_token);
      setToken(res.access_token);
      const u = await api<CurrentUser>("/api/me", { token: res.access_token });
      setUser(u);
      router.push("/ops");
    },
    [router],
  );

  const logout = useCallback(async () => {
    if (token) {
      try {
        await api("/api/auth/jwt/logout", { method: "POST", token });
      } catch {
        // best-effort; we're clearing client state regardless
      }
    }
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    router.push("/login");
  }, [router, token]);

  return (
    <Ctx.Provider value={{ token, user, loading, login, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within <AuthProvider>");
  return v;
}
