"use client";

import Link from "next/link";
import { useI18n } from "../lib/i18n/LocaleProvider";

type BreadcrumbItem = {
  label: string;
  href?: string;
};

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  const { t } = useI18n();
  return (
    <nav className="breadcrumbs" aria-label={t("Breadcrumb")}>
      <ol>
        {items.map((item, index) => {
          const current = index === items.length - 1;
          const label = item.href && ["/dashboard", "/library", "/projects", "/tags", "/settings"].includes(item.href) ? t(item.label) : item.label;
          return (
            <li key={`${item.href ?? "current"}-${item.label}`}>
              {index > 0 ? <span className="breadcrumbs__separator" aria-hidden="true">/</span> : null}
              {item.href && !current ? (
                <Link href={item.href} className="breadcrumbs__link" title={label}>{label}</Link>
              ) : (
                <span className="breadcrumbs__current" aria-current="page" title={label}>{label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
