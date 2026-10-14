import { translate, type Locale } from "./i18n/catalog";

export function formatUiDate(value: string, locale: Locale = "ko"): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { dateStyle: "medium" }).format(date);
}

export function formatAuthorSummary(authors: string[], fallback = "", locale: Locale = "ko"): string {
  const names = authors.filter(Boolean);
  if (names.length === 0) return fallback || translate("Authors unknown", locale);
  if (names.length === 1) return names[0];
  return locale === "ko" ? `${names[0]} 외` : `${names[0]} et al.`;
}
