import assert from "node:assert/strict";
import { readFile } from "./ui-source.mjs";
import test from "node:test";

const sources = Promise.all([
  readFile(new URL("../app/views/ReaderView.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/LibraryView.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/LibraryPaperInspector.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/NoteBlocksWorkspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/ProjectDetailView.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/TagsView.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/SidebarNavigation.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/api/client.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/blueprint/[...path]/bridge.mjs", import.meta.url), "utf8"),
  readFile(new URL("../app/components/StatusBadge.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/ProjectsView.tsx", import.meta.url), "utf8"),
]);

test("Reader reserves structural space for the navigation trigger and keeps Library untruncated", async () => {
  const [reader, , , , , , , css] = await sources;
  assert.match(reader, /reader-workspace__navigation-slot/);
  assert.match(css, /grid-template-columns: var\(--reader-navigation-slot\) minmax\(0, 1fr\) auto/);
  assert.match(css, /\.breadcrumbs li:first-child, \.breadcrumbs li:last-child \{ flex: 0 0 auto;/);
  assert.match(css, /\.breadcrumbs li:nth-child\(2\) \{ flex: 1 1 auto;/);
  assert.match(css, /\.reader-navigation-zone \{[^}]*left: var\(--content-padding\);/);
});

test("relationship labels, tag cleanup, and final local brand mark retain the restrained grammar", async () => {
  const [, , , blocks, project, tags, sidebar, css] = await sources;
  assert.match(project, /<RelationshipLabel type=\{link\.link_type\}/);
  assert.match(blocks, /<RelationshipLabel type=\{link\.link_type\}/);
  assert.match(css, /\.relationship-label \{/);
  assert.match(css, /\.relationship-label\[data-tone="green"\]/);
  assert.doesNotMatch(tags, /<th>Status<\/th>/);
  assert.match(tags, /Advanced lifecycle/);
  assert.match(sidebar, /<span className="brand__mark" aria-hidden="true" \/>/);
  assert.match(sidebar, /href="\/dashboard" className="brand" aria-label=\{`\$\{PRODUCT_NAME\} · /);
  assert.match(css, /\.brand__mark \{[^}]*width: 2rem;[^}]*height: 2rem;[^}]*background: url\("\/brand\/labvium-symbol-v1\.png"\) center \/ contain no-repeat;/);
  const mark = await readFile(new URL("../public/brand/labvium-mark.svg", import.meta.url), "utf8");
  assert.match(mark, /viewBox="0 0 48 48"/);
  assert.match(mark, /fill="#7851ca"/);
  assert.match(css, /\.sidebar\[data-collapsed="true"\] \.brand \{ padding: var\(--space-1\); \}/);
  assert.match(css, /\.sidebar\[data-collapsed="true"\] \.brand__copy, \.sidebar\[data-collapsed="true"\] \.sidebar-toggle__label, \.sidebar\[data-collapsed="true"\] \.sidebar-link span \{ display: none; \}/);
  assert.doesNotMatch(sidebar, /<svg className="brand__mark"/);
});

test("Library keeps operations bounded while supporting PDF picker and drag/drop validation", async () => {
  const [, library, inspector, , , , , css, client, bridge] = await sources;
  assert.match(library, /operation-result-strip/);
  assert.match(library, /library-operation-drawer/);
  assert.match(library, /library-drop-overlay/);
  assert.match(library, /Drop PDFs to import/);
  assert.match(library, /accept="application\/pdf,.pdf"/);
  assert.match(library, /uploadManagedPdfs/);
  assert.match(library, /Only PDF files can be imported/);
  assert.match(inspector, /Remove PDF file/);
  assert.match(inspector, /Remove Paper from Library/);
  assert.match(inspector, /Permanent deletion is intentionally unavailable/);
  assert.match(css, /\.library-operation-drawer \{[^}]*overflow-y: auto/);
  assert.match(client, /removeManagedPdf/);
  assert.match(client, /archivePaper/);
  assert.match(bridge, /isBlueprintManagedPdfUploadPath/);
});

test("reading status and new Note Blocks use explicit safe mutation paths", async () => {
  const [reader, , inspector, blocks, , , , , client] = await sources;
  assert.match(reader, /saveReadingStatus/);
  assert.match(inspector, /saveReadingStatus/);
  assert.match(client, /saveReadingStatus/);
  assert.match(blocks, /: \[block, \.\.\.collection\.items\]/);
  assert.match(blocks, /setExpandedBlockId\(response\.block\.id\)/);
  assert.match(blocks, /editorTitleRef\.current\?\.focus/);
});

test("compact domain status markers use centralized semantic tones without recoloring tags", async () => {
  const [, , , , projectDetail, , , css, , , statusBadge, projects] = await sources;
  assert.match(statusBadge, /inferredStatusMarkerTone/);
  assert.match(statusBadge, /inferredStatusMarkerTone\(children, presentation\)/);
  assert.match(css, /--state-blue: #1a73e8/);
  assert.match(css, /--state-green: #2e7d32/);
  assert.match(css, /--state-amber: #b26a00/);
  assert.match(css, /--state-rose: #b3261e/);
  assert.match(css, /--state-violet: #7452a8/);
  assert.match(css, /--state-slate: #5f6b73/);
  assert.match(projects, /<StatusBadge>\{project\.status\}<\/StatusBadge>/);
  assert.match(projects, /<StatusBadge>\{project\.priority\}<\/StatusBadge>/);
  assert.match(projectDetail, /<StatusBadge>\{project\.status\}<\/StatusBadge>/);
});
