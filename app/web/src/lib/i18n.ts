export type Locale = "ja" | "en";

const DICTIONARIES = {
  ja: () => import("@/locales/ja").then((m) => m.default),
  en: () => import("@/locales/en").then((m) => m.default),
} as const;

export async function getDictionary(locale: Locale) {
  return DICTIONARIES[locale]();
}

// ブラウザ側で localStorage から locale を取得するユーティリティ
export function getLocale(): Locale {
  if (typeof window === "undefined") return "ja";
  const saved = localStorage.getItem("locale");
  return saved === "en" ? "en" : "ja";
}

export function setLocale(locale: Locale): void {
  localStorage.setItem("locale", locale);
}
