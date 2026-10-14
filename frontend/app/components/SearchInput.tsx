"use client";

import { Search } from "lucide-react";
import { useI18n } from "../lib/i18n/LocaleProvider";

export function SearchInput({ label = "Search papers", disabled = false, placeholder = "Search" }: { label?: string; disabled?: boolean; placeholder?: string }) {
  const { t } = useI18n();
  return (
    <label className="search-shell">
      <span className="sr-only">{t(label)}</span>
      <Search aria-hidden="true" size={16} />
      <input disabled={disabled} type="search" placeholder={t(placeholder)} aria-label={t(label)} />
    </label>
  );
}
