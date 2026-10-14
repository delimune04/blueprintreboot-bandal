"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { translate, type Locale, type TranslationValues } from "./catalog";

export const LOCALE_STORAGE_KEY = "bandal.labvium.ui.locale";
const LOCALE_EVENT = "labvium:locale-changed";
let activeLocale: Locale | null = null;

export function getInterfaceLocale(): Locale {
  if (typeof window === "undefined") return "ko";
  if (activeLocale) return activeLocale;
  try { return window.localStorage.getItem(LOCALE_STORAGE_KEY) === "en" ? "en" : "ko"; }
  catch { return document.documentElement.lang === "en" ? "en" : "ko"; }
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === LOCALE_STORAGE_KEY || event.key === null) { activeLocale = null; listener(); } };
  window.addEventListener(LOCALE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(LOCALE_EVENT, listener); window.removeEventListener("storage", onStorage); };
}

function changeLocale(locale: Locale) {
  if (typeof window === "undefined") return;
  activeLocale = locale;
  document.documentElement.lang = locale;
  try { window.localStorage.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* the active preference remains in html.lang */ }
  window.dispatchEvent(new Event(LOCALE_EVENT));
}

type I18nContext = { locale: Locale; setLocale: (locale: Locale) => void; t: (source: string, values?: TranslationValues) => string };
const LocaleContext = createContext<I18nContext>({ locale: "ko", setLocale: changeLocale, t: (source, values) => translate(source, "ko", values) });

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore<Locale>(subscribe, getInterfaceLocale, () => "ko");
  const t = useCallback((source: string, values?: TranslationValues) => translate(source, locale, values), [locale]);
  const context = useMemo(() => ({ locale, setLocale: changeLocale, t }), [locale, t]);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return <LocaleContext.Provider value={context}>{children}</LocaleContext.Provider>;
}

export function useI18n() { return useContext(LocaleContext); }

export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();
  return <div className="language-toggle" role="group" aria-label={t("Choose interface language")}>
    <button type="button" lang="ko" aria-pressed={locale === "ko"} onClick={() => setLocale("ko")}>한국어</button>
    <button type="button" lang="en" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>English</button>
  </div>;
}
