"use client";

// Dashboard locale. Resolution order:
//   1. manual override (localStorage) — the toggle on /ops/account
//   2. the signed-in user's language_pref from the database
//   3. Japanese (this is a tool for Tokyo restaurant staff)
//
// Must be mounted INSIDE AuthProvider (reads useAuth).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./auth";
import { DEFAULT_LOCALE, DICTS, LOCALES, type Dict, type Locale } from "./i18n";

const KEY = "ifasto.dashboard.locale";

interface LocaleCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Dict;
}

const Ctx = createContext<LocaleCtx | null>(null);

function isLocale(v: string | null): v is Locale {
  return !!v && LOCALES.some((l) => l.code === v);
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [override, setOverride] = useState<Locale | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(KEY);
    if (isLocale(saved)) setOverride(saved);
    setBootstrapped(true);
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setOverride(l);
    if (typeof window !== "undefined") window.localStorage.setItem(KEY, l);
  }, []);

  const locale: Locale =
    override ??
    (bootstrapped && user && isLocale(user.language_pref) ? user.language_pref : DEFAULT_LOCALE);

  const value = useMemo<LocaleCtx>(
    () => ({ locale, setLocale, t: DICTS[locale] }),
    [locale, setLocale]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT(): LocaleCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useT must be used within LocaleProvider");
  return v;
}
