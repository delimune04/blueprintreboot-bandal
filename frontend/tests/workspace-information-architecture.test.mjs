import assert from "node:assert/strict";
import { readFile } from "./ui-source.mjs";
import test from "node:test";
import { abstractDisplayParagraphs } from "../app/lib/abstract-display.mjs";

test("Paper Detail normalizes display-only abstract line breaks while preserving paragraphs", async () => {
  assert.deepEqual(
    abstractDisplayParagraphs("First extracted\nline wraps here.\n\nSecond paragraph\nkeeps its boundary."),
    ["First extracted line wraps here.", "Second paragraph keeps its boundary."],
  );
  assert.deepEqual(abstractDisplayParagraphs(" \n\t\n "), []);

  const [detail, css] = await Promise.all([
    readFile(new URL("../app/views/PaperDetailView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(detail, /abstractDisplayParagraphs\(resource\.data\.abstract\)/);
  assert.match(detail, /abstractParagraphs\.length/);
  assert.match(detail, /paper-detail-content-grid/);
  assert.match(css, /\.abstract-text \{ max-width: 72ch;/);
  assert.doesNotMatch(css.match(/\.abstract-text \{[^}]+\}/)?.[0] ?? "", /white-space: pre-wrap/);
});

test("Projects keeps the collection first and subordinates creation and link management", async () => {
  const [projects, detail] = await Promise.all([
    readFile(new URL("../app/views/ProjectsView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/ProjectDetailView.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(projects, /aria-controls="create-project-panel"/);
  assert.match(projects, /aria-expanded=\{showCreate\}/);
  assert.match(projects, /useDisclosureFocus<HTMLButtonElement>/);
  assert.match(projects, /restoreTriggerFocus\(\)/);
  assert.ok(projects.indexOf('title="Projects"') < projects.indexOf('title="Create Project"'));
  assert.doesNotMatch(detail, /<Section title="Overview">/);
  assert.match(detail, /compact-metadata-row project-metadata-summary/);
  assert.match(detail, /<Section title="Linked Papers"/);
  assert.match(detail, /<Section title="Linked Note Blocks"/);
  assert.match(detail, /<details id="manage-project-links"/);
  assert.match(detail, /project-material-row/);
  assert.match(detail, /project-secondary-actions/);
  assert.ok(detail.indexOf('title="Linked Papers"') < detail.indexOf('title="Edit Project"'));
  assert.match(detail, /<RelationshipLabel type=\{link\.link_type\}/);
  assert.match(detail, /targetStateTone\(link\.target_state\)/);
  assert.doesNotMatch(detail, /<DataTableShell/);
});

test("Settings links to a dedicated Diagnostics route without losing diagnostic content", async () => {
  const [settings, diagnosticsPage, settingsPage] = await Promise.all([
    readFile(new URL("../app/views/SettingsView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/settings/diagnostics/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/settings/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(settings, /href="\/settings\/diagnostics"/);
  assert.match(settings, /export function DiagnosticsView/);
  assert.match(settings, /apiClient\.getSettingsSummary/);
  for (const section of ["Application", "Workspace", "Data integrity", "Backup readiness"]) assert.match(settings, new RegExp(`title="${section}"`));
  assert.match(diagnosticsPage, /<DiagnosticsView \/>/);
  assert.match(settingsPage, /<SettingsView \/>/);
});

test("Tags prioritizes candidate review and keeps registry internals and creation progressive", async () => {
  const tags = await readFile(new URL("../app/views/TagsView.tsx", import.meta.url), "utf8");
  assert.match(tags, /title="Review candidates"/);
  assert.match(tags, /getTagReviewQueue/);
  assert.match(tags, /utility=tags&review=tag-candidates/);
  assert.match(tags, />Review</);
  assert.match(tags, /aria-controls="create-canonical-tag"/);
  assert.match(tags, /useDisclosureFocus<HTMLButtonElement>/);
  assert.match(tags, /\{showCreate \? <Section title="Create tag"/);
  assert.match(tags, /categoryLabel\(tag\.category\)/);
  assert.match(tags, /className="alias-chip"/);
  assert.match(tags, /aria-label=\{`Remove alias \$\{value\}`\}/);
  assert.match(tags, /<details className="tag-advanced-details">/);
  assert.doesNotMatch(tags, /<th>Canonical key<\/th>/);
});

test("Library labels its filters, exposes active filters, and keeps keyboard selection and inspector actions available", async () => {
  const [library, inspector, css] = await Promise.all([
    readFile(new URL("../app/views/LibraryView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/LibraryPaperInspector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  for (const label of [">Search<", ">Tag<", ">Year<", ">Reading status<", ">Library state<"]) assert.match(library, new RegExp(label));
  assert.match(library, /Active papers only/);
  assert.match(library, /active-filter-bar/);
  assert.match(library, /Reset filters/);
  assert.match(library, /href=\{`\/papers\/\$\{encodeURIComponent\(paper\.paper_id\)\}`\}/);
  assert.match(library, />Inspect</);
  assert.match(library, /selectionControls\.current\.get\(dismissedPaperId\)\?\.focus\(\)/);
  assert.match(library, /library-canonical-tags/);
  assert.match(inspector, /Open Reader/);
  assert.match(inspector, /View Paper Detail/);
  assert.match(library, /href="\/settings\/diagnostics"/);
  assert.match(css, /\.library-collection-layout--with-inspector/);
  assert.match(css, /\.library-paper-row\[data-selected="true"\]/);
});
