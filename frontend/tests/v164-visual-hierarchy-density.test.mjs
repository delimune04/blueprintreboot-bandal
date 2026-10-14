import assert from "node:assert/strict";
import { readFile } from "./ui-source.mjs";
import test from "node:test";

test("Reader removes duplicate chrome and keeps save state with the active editor", async () => {
  const reader = await readFile(new URL("../app/views/ReaderView.tsx", import.meta.url), "utf8");

  assert.match(reader, /<h1 className="sr-only">Reader:/);
  assert.doesNotMatch(reader, /reader-workspace__identity/);
  assert.match(reader, /snapshot\.paper\.lifecycle_state !== "active"/);
  assert.equal((reader.match(/<SaveStatus state=\{editor\.note\.saveState\}/g) ?? []).length, 1);
  assert.equal((reader.match(/<SaveStatus state=\{editor\.metadata\.saveState\}/g) ?? []).length, 1);
  assert.doesNotMatch(reader, /reader-utility-drawer__tabs|reader-utility-drawer__tab/);
  assert.match(reader, /reader-utility-drawer-title/);
  assert.match(reader, /role="region" aria-labelledby="reader-utility-drawer-title"/);
});

test("Reader formatting stays compact, labelled, and selection preserving", async () => {
  const [reader, css] = await Promise.all([
    readFile(new URL("../app/views/ReaderView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  for (const label of ["Heading", "Bold", "Italic", "Bullets", "Numbered list", "Task list", "Quote", "Link"]) {
    assert.match(reader, new RegExp(`title="${label}" aria-label="${label}"`));
  }
  assert.match(reader, /onMouseDown=\{preserveNoteSelection\}/);
  assert.match(css, /\.reader-note__formatting \.reader-control \{ width: var\(--control-height-compact\)/);
});

test("Project Detail presents compact metadata and compact linked-material rows", async () => {
  const [detail, css] = await Promise.all([
    readFile(new URL("../app/views/ProjectDetailView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(detail, /<Section title="Overview">/);
  assert.match(detail, /project-metadata-summary/);
  assert.doesNotMatch(detail, /PageHeader[^\n]*StatusBadge/);
  assert.match(detail, /project-secondary-actions/);
  assert.match(detail, /project-material-row/);
  assert.match(detail, /aria-label=\{`Remove link to/);
  assert.match(detail, /window\.confirm\(`Remove the Project link/);
  assert.match(css, /\.project-material-row \{ min-height: 3\.75rem/);
  assert.match(css, /\.compact-metadata-row/);
});

test("page archetype widths, compact Dashboard empty state, and version-free shell use shared classes", async () => {
  const [dashboard, shell, sidebar, css] = await Promise.all([
    readFile(new URL("../app/views/DashboardView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/SidebarNavigation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /page-stack page-stack--dashboard/);
  assert.match(dashboard, /dashboard-empty-state/);
  assert.match(css, /\.page-stack--dashboard/);
  assert.match(css, /\.page-stack--detail/);
  assert.match(css, /\.dashboard-empty-state \.state-frame/);
  assert.match(css, /--color-text-muted: #7a8386/);
  assert.doesNotMatch(shell, /packageMetadata|applicationVersion/);
  assert.doesNotMatch(sidebar, /Research workspace · v/);
  assert.match(sidebar, /sidebar-nav--secondary/);
});
