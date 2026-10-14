"use client";

import type { ReactNode } from "react";
import { useI18n } from "../lib/i18n/LocaleProvider";

export function DataTableShell({ children, label }: { children: ReactNode; label: string }) {
  const { t } = useI18n();
  return <div className="data-table-shell" role="region" aria-label={t(label)} tabIndex={0}>{children}</div>;
}
