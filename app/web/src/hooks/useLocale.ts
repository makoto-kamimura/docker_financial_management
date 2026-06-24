"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";
import type { Dictionary } from "@/locales/ja";

const cachedDicts: Partial<Record<Locale, Dictionary>> = {};

async function loadDict(locale: Locale): Promise<Dictionary> {
  if (cachedDicts[locale]) return cachedDicts[locale]!;
  const mod = await import(`@/locales/${locale}`);
  const dict = mod.default as Dictionary;
  cachedDicts[locale] = dict;
  return dict;
}

export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>("ja");
  const [dict,   setDict]        = useState<Dictionary | null>(null);

  useEffect(() => {
    const saved = (localStorage.getItem("locale") as Locale | null) ?? "ja";
    setLocaleState(saved);
    loadDict(saved).then(setDict);
  }, []);

  function changeLocale(next: Locale) {
    localStorage.setItem("locale", next);
    setLocaleState(next);
    loadDict(next).then(setDict);
    window.dispatchEvent(new CustomEvent("locale-change", { detail: next }));
  }

  return { locale, dict, changeLocale };
}
