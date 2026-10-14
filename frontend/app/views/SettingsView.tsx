"use client";

import { LanguageToggle, useI18n } from "../lib/i18n/LocaleProvider";

import Link from "next/link";
import packageMetadata from "../../package.json";
import { DataTableShell } from "../components/DataTableShell";
import { EmptyState, ErrorState, LoadingState, UnavailableState } from "../components/AsyncStates";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { StatusBadge } from "../components/StatusBadge";
import { useApiResource } from "../hooks/useApiResource";
import { apiClient } from "../lib/api/client";
import { systemStateTone } from "../lib/semantic-tones.mjs";
import type { SettingsState } from "../lib/api/types";

function stateTone(state: SettingsState | "available") {
  return systemStateTone(state);
}

function displayedCount(state: SettingsState, count: number | null, unavailableLabel: string) {
  return state === "unavailable" || count === null
    ? <span className="muted-text">{unavailableLabel}</span>
    : <strong>{count}</strong>;
}

export function SettingsView() {
  const { t } = useI18n();
  return (
    <div className="page-stack">
      <PageHeader title={t("Settings")} description={t("Workspace information and maintenance tools for this local application.")} />
      <Section title={t("Language")}><LanguageToggle /></Section>
      <Section title={t("Workspace")}>
        <div className="settings-landing">
          <div>
            <h2>{t("Local research workspace")}</h2>
            <p>{t("This web workspace does not currently offer editable settings. Your papers, notes, projects, and tags stay on this device.")}</p>
          </div>
          <dl className="metadata-list metadata-list--compact">
            <div><dt>{t("Application version")}</dt><dd>{packageMetadata.version}</dd></div>
            <div><dt>{t("Maintenance information")}</dt><dd>{t("Library health, store checks, and backup readiness are available in Diagnostics.")}</dd></div>
          </dl>
          <Link className="reader-action" href="/settings/diagnostics">{t("Open Diagnostics")}</Link>
        </div>
      </Section>
    </div>
  );
}

export function DiagnosticsView() {
  const { t } = useI18n();
  const resource = useApiResource("settings-summary", apiClient.getSettingsSummary);
  return (
    <div className="page-stack">
      <PageHeader
        title={t("Diagnostics")}
        description={t("Review application, workspace, integrity, and backup information.")}
        actions={<Link className="reader-control reader-control--secondary" href="/settings">{t("Back to Settings")}</Link>}
      />
      {resource.status === "loading" ? <LoadingState label={t("Loading Settings summary")} /> : null}
      {resource.status === "unavailable" ? <UnavailableState description={t(resource.message)} onRetry={resource.retry} /> : null}
      {resource.status === "error" ? <ErrorState title={t("Settings couldn't be loaded")} description={t(resource.message)} onRetry={resource.retry} /> : null}
      {resource.status === "not-found" ? <ErrorState description={t(resource.message)} onRetry={resource.retry} /> : null}
      {resource.status === "success" ? (
        <>
          <Section title={t("Application")} description={t(resource.data.application.summary)}>
            <div className="summary-strip">
              <div><span>{t("Product version")}</span><strong>{resource.data.application.product_version}</strong></div>
              <div><span>{t("API state")}</span><StatusBadge tone={stateTone(resource.data.application.api_state)}>{resource.data.application.api_state}</StatusBadge></div>
              <div><span>{t("API contract")}</span><strong>{resource.data.application.api_contract_version}</strong></div>
              <div><span>{t("Section state")}</span><StatusBadge tone={stateTone(resource.data.application.state)}>{resource.data.application.state}</StatusBadge></div>
            </div>
          </Section>

          <Section title={t("Workspace")} description={t(resource.data.workspace.summary)}>
            {resource.data.workspace.state === "empty" ? (
              <EmptyState title={t("Workspace is empty")} description={t("The safe API verified zero stored items across the available workspace stores.")} />
            ) : (
              <DataTableShell label={t("Workspace availability summary")}>
                <table>
                  <thead><tr><th>{t("Store")}</th><th>{t("State")}</th><th>{t("Count")}</th><th>{t("Summary")}</th></tr></thead>
                  <tbody>
                    {resource.data.workspace.resources.map((item) => (
                      <tr key={item.code}>
                        <td><strong>{t(item.label)}</strong></td>
                        <td><StatusBadge tone={stateTone(item.state)}>{item.state}</StatusBadge></td>
                      <td>{displayedCount(item.state, item.count, t("Unavailable"))}</td>
                        <td>{t(item.summary)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DataTableShell>
            )}
          </Section>

          <Section title={t("Data integrity")} description={t(resource.data.data_integrity.summary)}>
            <DataTableShell label={t("Lightweight data integrity summary")}>
              <table>
                <thead><tr><th>{t("Check")}</th><th>{t("State")}</th><th>{t("Count")}</th><th>{t("Explanation")}</th><th>{t("Next action")}</th></tr></thead>
                <tbody>
                  {resource.data.data_integrity.issues.map((issue) => (
                    <tr key={issue.code}>
                      <td><strong>{issue.code.replaceAll("_", " ")}</strong><small className="settings-severity">{issue.severity}</small></td>
                      <td><StatusBadge tone={stateTone(issue.state)}>{issue.state}</StatusBadge></td>
                      <td>{displayedCount(issue.state, issue.count, t("Unavailable"))}</td>
                      <td>{t(issue.explanation)}</td>
                      <td>{t(issue.next_action)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTableShell>
          </Section>

          <Section title={t("Backup readiness")} description={t(resource.data.backup_readiness.summary)}>
            <div className="detail-panel">
              <dl className="metadata-list metadata-list--compact">
                <div><dt>{t("State")}</dt><dd><StatusBadge tone={stateTone(resource.data.backup_readiness.state)}>{resource.data.backup_readiness.state}</StatusBadge></dd></div>
                <div><dt>{t("Snapshot evidence")}</dt><dd>{resource.data.backup_readiness.snapshot_available === null ? t("Unavailable") : resource.data.backup_readiness.snapshot_available ? t("Available") : t("Not found")}</dd></div>
                <div><dt>{t("Last updated")}</dt><dd>{resource.data.backup_readiness.last_updated_at ?? t("Unavailable")}</dd></div>
              </dl>
              <p className="deferred-note">{t("Backup, restore, repair, and configuration actions remain in the existing Streamlit Settings workflow.")}</p>
            </div>
          </Section>
          <p className="purpose-copy">{t("Only values returned by the safe summary API are shown; this page never generates sample counts or backup history.")}</p>
        </>
      ) : null}
    </div>
  );
}
