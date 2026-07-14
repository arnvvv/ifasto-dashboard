"use client";

// Guest-page locale. Unlike the staff dashboard (JA-first, account pref),
// guests are often tourists: default from the browser language, remember a
// manual toggle. Kept separate from LocaleContext, which is auth-driven.

import { useCallback, useEffect, useState } from "react";
import { DICTS, type Dict, type Locale } from "./i18n";

const KEY = "ifasto.guest.locale";

export function useGuestLocale(): { locale: Locale; setLocale: (l: Locale) => void; t: Dict } {
  // SSR renders ja; the effect below corrects before first paint on the client.
  const [locale, setLocaleState] = useState<Locale>("ja");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved === "ja" || saved === "en") {
        setLocaleState(saved);
        return;
      }
    } catch {
      // fall through to browser language
    }
    if (!navigator.language.toLowerCase().startsWith("ja")) setLocaleState("en");
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      window.localStorage.setItem(KEY, l);
    } catch {
      // ignore
    }
  }, []);

  return { locale, setLocale, t: DICTS[locale] };
}
