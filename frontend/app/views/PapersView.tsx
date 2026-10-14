"use client";

import { useI18n } from "../lib/i18n/LocaleProvider";

import Link from "next/link";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";

/** Legacy collection URL retained as a gentle, non-destructive signpost. */
export function PapersView() {
  const { t } = useI18n();
  return (
    <div className="page-stack">
      <PageHeader title={t("Papers")} description={t("Library is the primary Paper collection surface.")} />
      <Section title={t("Open Library")} description={t("Search, browse, filter, scan, import, enrich, and repair managed Papers from one coherent workflow.")}>
        <Link className="reader-action" href="/library">{t("Go to Library")}</Link>
      </Section>
    </div>
  );
}
