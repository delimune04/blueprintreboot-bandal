"use client";

import type { ReactNode } from "react";
import { useI18n } from "../lib/i18n/LocaleProvider";

export function Toolbar({ children, label = "Page tools" }: { children: ReactNode; label?: string }) {
  const { t } = useI18n();
  return <div className="toolbar" role="group" aria-label={t(label)}>{children}</div>;
}
