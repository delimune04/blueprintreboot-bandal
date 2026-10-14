import assert from "node:assert/strict";
import { readFile } from "./ui-source.mjs";
import test from "node:test";

test("Library makes the paper collection primary and selects papers into a contextual inspector", async () => {
  const [library, inspector, css] = await Promise.all([
    readFile(new URL("../app/views/LibraryView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/LibraryPaperInspector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(library, /<PageHeader title="Library"/);
  assert.match(library, /<Section title="Papers">/);
  assert.match(library, /library-operation-drawer/);
  assert.match(library, /placeholder="Title, author, journal, DOI…"/);
  assert.match(library, />Library state</);
  assert.match(library, /Reset filters/);
  assert.match(library, /apiClient\.getPapers\(\{ limit: PAGE_SIZE, offset, archiveStatus, q, tag, year, status: readingStatus \}\)/);
  assert.match(library, /aria-label=\{`Inspect \$\{paper\.title/);
  assert.match(library, /href=\{`\/papers\/\$\{encodeURIComponent\(paper\.paper_id\)\}`\}/);
  assert.match(library, /onClick=\{\(\) => selectPaper\(paper\.paper_id\)\}/);
  assert.match(library, /setTimeout\(\(\) =>/);
  assert.match(library, /READING_STATUSES/);
  assert.match(library, />Inspect</);
  assert.match(library, /selectionControls\.current\.get\(dismissedPaperId\)\?\.focus\(\)/);
  assert.match(library, /className="paper-link"/);
  assert.match(library, /<table className="library-paper-table"><colgroup>/);
  assert.match(library, /library-paper-table__title/);
  assert.match(library, /library-paper-table__inspect/);
  assert.match(library, /<LibraryPaperInspector/);
  assert.doesNotMatch(library, /<th>Actions<\/th>/);
  assert.doesNotMatch(library, />Detail<\/Link>/);
  assert.doesNotMatch(library, />Reader<\/Link>/);

  assert.match(inspector, /apiClient\.getPaper\(paperId\)/);
  assert.match(inspector, /aria-label="Selected paper"/);
  assert.match(inspector, /Open Reader/);
  assert.match(inspector, /View Paper Detail/);
  assert.match(inspector, /Find metadata/);
  assert.match(inspector, /No tags yet/);
  assert.match(inspector, /Linked to \$\{count\} project/);
  assert.match(css, /\.library-collection-layout--with-inspector/);
  assert.match(css, /\.library-paper-row\[data-selected="true"\]/);
  assert.match(css, /\.library-paper-row__tags/);
  assert.match(css, /\.library-paper-inspector__abstract/);
  assert.match(library, /className="metadata-enrichment-table"/);
  assert.match(library, /data-label="Current"/);
  assert.match(library, /data-label="Candidate"/);
  assert.match(css, /\.metadata-enrichment-table \{ min-width: 0; table-layout: fixed; \}/);
  assert.match(css, /@container \(max-width: 22rem\)/);
  assert.match(css, /\.library-paper-inspector \.metadata-enrichment-table td \{ min-width: 0; display: grid; grid-template-columns: 5\.25rem minmax\(0, 1fr\);/);
  assert.match(css, /\.library-collection-layout--with-inspector \{ grid-template-columns: minmax\(0, 1fr\) clamp\(19rem, 22vw, 24rem\);/);
  assert.match(css, /@media \(min-width: 72\.0625rem\) and \(max-width: 89\.9375rem\)/);
  assert.match(css, /\.library-collection-layout--with-inspector \.library-paper-inspector \{ position: absolute;/);
  assert.match(css, /\.library-paper-table \{ min-width: 44rem; table-layout: fixed; \}/);
});

test("metadata enrichment remains explicit and contextual to the selected paper", async () => {
  const library = await readFile(new URL("../app/views/LibraryView.tsx", import.meta.url), "utf8");

  assert.match(library, /previewMetadataEnrichment\(paperId\)/);
  assert.match(library, /saveReaderMetadata\(enrichment\.paper_id, changes, enrichment\.metadata_revision\)/);
  assert.match(library, /Choose fields before applying\./);
  assert.match(library, /Apply selected fields/);
  assert.match(library, /checked=\{selectedFields\.includes\(field\.field\)\}/);
  assert.match(library, /Candidate details/);
});

test("Paper Detail presents a readable overview and keeps identifiers and organization contextual", async () => {
  const detail = await readFile(new URL("../app/views/PaperDetailView.tsx", import.meta.url), "utf8");

  assert.match(detail, /<Breadcrumbs items=/);
  assert.match(detail, /<PageHeader title=\{resource\.data\.title \|\| "Untitled paper"\}/);
  assert.match(detail, /Open Reader/);
  assert.match(detail, /<Section title="Abstract">/);
  assert.match(detail, /abstractDisplayParagraphs\(resource\.data\.abstract\)/);
  assert.match(detail, /<Section title="Citation">/);
  assert.ok(detail.indexOf('<Section title="Abstract">') < detail.indexOf('<Section title="Citation">'));
  assert.match(detail, /resource\.data\.authors\.join\("; "\)/);
  assert.match(detail, /resource\.data\.doi/);
  assert.match(detail, /resource\.data\.arxiv_id/);
  assert.match(detail, /<DetailPanel title="Organization">/);
  assert.match(detail, /No tags yet/);
  assert.match(detail, /<DetailPanel title="Reading context">/);
  assert.doesNotMatch(detail, /project_id/);
  assert.doesNotMatch(detail, /extracted_text_available|profile_available|metadata_revision/);
});
