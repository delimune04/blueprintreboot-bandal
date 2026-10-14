import assert from "node:assert/strict";
import { readFile } from "./ui-source.mjs";
import test from "node:test";

const sources = Promise.all([
  readFile(new URL("../app/settings/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/SettingsView.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/api/client.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/api/types.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/AsyncStates.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/hooks/useApiResource.ts", import.meta.url), "utf8"),
]);

test("Settings route renders the real safe summary instead of a deferred placeholder", async () => {
  const [page, view, client] = await sources;

  assert.match(page, /<SettingsView \/>/);
  assert.doesNotMatch(page + view, /DeferredWorkspaceView/);
  assert.match(view, /apiClient\.getSettingsSummary/);
  assert.match(client, /getSettingsSummary:\s*\(\)\s*=>\s*request<SettingsSummary>\("\/settings\/summary"\)/);
});

test("Settings renders all four sections from typed API values", async () => {
  const [, view, , types] = await sources;

  for (const title of ["Application", "Workspace", "Data integrity", "Backup readiness"]) {
    assert.match(view, new RegExp(`title="${title}"`));
  }
  for (const field of [
    "application.product_version",
    "application.api_state",
    "application.api_contract_version",
    "workspace.resources",
    "data_integrity.issues",
    "backup_readiness.snapshot_available",
    "backup_readiness.last_updated_at",
  ]) {
    assert.match(view, new RegExp(field.replaceAll(".", "\\.")));
  }
  assert.match(types, /count:\s*number \| null/);
  assert.match(types, /snapshot_available:\s*boolean \| null/);
});

test("Settings distinguishes verified empty and zero states from unavailable diagnostics", async () => {
  const [, view] = await sources;

  assert.match(view, /state === "empty"/);
  assert.match(view, /Workspace is empty/);
  assert.match(view, /state === "unavailable" \|\| count === null/);
  assert.match(view, /<span className="muted-text">\{unavailableLabel\}<\/span>/);
  assert.match(view, /displayedCount\(item\.state, item\.count, "Unavailable"\)/);
  assert.match(view, /displayedCount\(issue\.state, issue\.count, "Unavailable"\)/);
  assert.match(view, /issue\.count/);
  assert.match(view, /issue\.state/);
});

test("Settings includes loading, API-offline, controlled error, partial warning, and retry states", async () => {
  const [, view, , , asyncStates, resourceHook] = await sources;

  assert.match(view, /status === "loading"/);
  assert.match(view, /status === "unavailable"/);
  assert.match(view, /status === "error"/);
  assert.match(view, /Settings couldn't be loaded/);
  assert.match(view, /onRetry=\{resource\.retry\}/);
  assert.match(view, /stateTone\(item\.state\)/);
  assert.match(view, /stateTone\(issue\.state\)/);
  assert.match(asyncStates, />Retry<\/button>/);
  assert.match(resourceHook, /setAttempt\(\(current\) => current \+ 1\)/);
});

test("Settings exposes no write controls, fabricated data, or private diagnostic detail", async () => {
  const [, view] = await sources;

  assert.match(view, /never generates sample counts or backup history/);
  assert.doesNotMatch(view, /<button\b|<input\b|<textarea\b|Create backup|Restore backup|Repair issues|Remove orphan|Edit configuration|Change workspace|Download logs/i);
  assert.doesNotMatch(view, /source_paths|snapshot_path|target_path|filepath|workspace_relative_path|sha256|process\.env|hostname|token|secret/i);
  assert.doesNotMatch(view, /const\s+(?:counts|history|issues|resources)\s*=\s*\[/i);
});

test("existing read-parity views remain wired to their established clients", async () => {
  const [dashboard, library, papers, reader, projects, tags] = await Promise.all([
    readFile(new URL("../app/views/DashboardView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/LibraryView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/PapersView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/ReaderView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/ProjectsView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/TagsView.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /apiClient\.getDashboard/);
  assert.match(library, /apiClient\.getLibraryStatus/);
  assert.match(library, /apiClient\.getPapers/);
  assert.match(papers, /Library is the primary Paper collection surface/);
  assert.match(reader, /apiClient\.getReaderSnapshot/);
  assert.match(projects, /apiClient\.getAllProjects/);
  assert.match(tags, /apiClient\.getTagGovernance/);
});
