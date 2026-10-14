import assert from "node:assert/strict";
import { readFile } from "./ui-source.mjs";
import test from "node:test";

test("shared White, Ink, Blueprint Blue, rule, and geometry tokens define the v1.6.5 language", async () => {
  const [css, statusBadge] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/components/StatusBadge.tsx", import.meta.url), "utf8"),
  ]);

  for (const token of ["--color-rule-faint", "--rule-faint", "--rule-strong", "--shadow-overlay", "--font-main", "--font-technical"]) {
    assert.match(css, new RegExp(token));
  }
  for (const [token, value] of Object.entries({
    "--color-surface": "#ffffff",
    "--color-canvas": "#f7f8f8",
    "--color-sidebar": "#f3f4f4",
    "--color-text": "#171a1b",
    "--color-rule": "#c9ced0",
    "--color-rule-strong": "#202425",
    "--blue-700": "#1769aa",
    "--blue-600": "#1a73e8",
    "--blue-500": "#4285f4",
    "--blue-300": "#8ab4f8",
    "--blue-100": "#ddebff",
    "--blue-050": "#f3f7ff",
  })) {
    assert.match(css, new RegExp(`${token}: ${value};`));
  }
  assert.match(css, /\.data-table-shell \{ min-width: 0; overflow-x: auto; background: transparent; border-top: var\(--rule-strong\); border-bottom: var\(--rule-strong\);/);
  assert.match(css, /\.toolbar \{[^}]*background: transparent; border: 0; border-bottom: var\(--rule-strong\); border-radius: 0;/);
  assert.match(css, /\.reader-utility-drawer \{[^}]*box-shadow: var\(--shadow-overlay\);/);
  assert.match(css, /\.reader-page-surface \{[^}]*box-shadow:/);
  assert.match(statusBadge, /type Presentation = "label" \| "chip" \| "badge"/);
  assert.match(statusBadge, /type Taxonomy = "canonical" \| "alias" \| "candidate"/);
  assert.match(statusBadge, /tone === "amber" \|\| tone === "rose" \? "badge" : "label"/);
  assert.match(statusBadge, /data-taxonomy=\{resolvedPresentation === "chip" \? taxonomy \?\? "canonical" : undefined\}/);
  assert.match(statusBadge, /status-badge--\$\{resolvedPresentation\}/);
  assert.match(css, /\.status-badge--chip\[data-taxonomy="canonical"\]|\.status-badge--chip \{[^}]*box-shadow: inset 2px 0 0 var\(--color-accent-strong\);/);
  assert.match(css, /\.status-badge--chip\[data-taxonomy="alias"\]/);
  assert.match(css, /\.status-badge--chip\[data-taxonomy="candidate"\]/);
});

test("collections encode canonical tags, aliases, and candidates distinctly while keeping ordinary state quiet", async () => {
  const [library, paperDetail, projects, tags, reader] = await Promise.all([
    readFile(new URL("../app/views/LibraryView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/PaperDetailView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/ProjectsView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/TagsView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/ReaderView.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(library, /presentation="chip" taxonomy="canonical"/);
  assert.match(paperDetail, /presentation="chip" taxonomy="canonical"/);
  assert.match(paperDetail, /presentation="chip" taxonomy="alias"/);
  assert.match(projects, /presentation="chip" taxonomy="canonical"/);
  assert.match(tags, /presentation="chip" taxonomy="candidate"/);
  assert.match(tags, /presentation="chip" taxonomy="alias"/);
  assert.match(library, /<td className="structural-value">\{paper\.year \|\| "—"\}<\/td>/);
  assert.match(paperDetail, /<StatusBadge>Archived<\/StatusBadge>/);
  assert.match(projects, /<StatusBadge>\{project\.status\}<\/StatusBadge>/);
  assert.match(projects, /<StatusBadge>\{project\.priority\}<\/StatusBadge>/);
  assert.match(reader, /snapshot\.paper\.lifecycle_state !== "active" \? <StatusBadge>\{snapshot\.paper\.lifecycle_state\}/);
});
