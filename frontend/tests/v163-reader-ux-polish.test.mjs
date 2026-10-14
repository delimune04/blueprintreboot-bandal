import assert from "node:assert/strict";
import { readFile } from "./ui-source.mjs";
import test from "node:test";

import { fitPageZoom, fitWidthZoom } from "../app/lib/pdf/reader-controller.mjs";

test("fit width and fit page use available PDF stage dimensions without changing DPR geometry", () => {
  assert.equal(fitWidthZoom({ availableWidth: 648, pageWidth: 600, horizontalPadding: 48 }), 1);
  assert.equal(fitPageZoom({ availableWidth: 648, availableHeight: 848, pageWidth: 600, pageHeight: 800, horizontalPadding: 48, verticalPadding: 48 }), 1);
  assert.equal(fitWidthZoom({ availableWidth: 120, pageWidth: 600 }), 0.5);
  assert.equal(fitPageZoom({ availableWidth: 2400, availableHeight: 3200, pageWidth: 600, pageHeight: 800 }), 3);
});

test("Reader tabs, persistent sizing, and an overlay drawer retain the existing editor surfaces", async () => {
  const [reader, css, pdfReader] = await Promise.all([
    readFile(new URL("../app/views/ReaderView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/components/PdfJsReader.tsx", import.meta.url), "utf8"),
  ]);
  for (const label of ["Note", "Blocks", "Details"]) assert.match(reader, new RegExp(`"${label}"`));
  assert.match(reader, /RESEARCH_PANEL_WIDTH_KEY/);
  assert.match(reader, /sessionStorage/);
  assert.match(reader, /role="separator"/);
  assert.match(reader, /onPointerDown=\{beginResearchPanelResize\}/);
  assert.match(reader, /onKeyDown=\{resizeResearchPanelWithKeyboard\}/);
  assert.match(reader, /hidden=\{activeResearchTab !== "note"\}/);
  assert.match(reader, /hidden=\{activeResearchTab !== "blocks"\}/);
  assert.match(reader, /hidden=\{activeResearchTab !== "details"\}/);
  assert.match(reader, /utilityDrawerRef/);
  assert.match(reader, /closeOnEscape/);
  assert.match(reader, /moveResearchTab/);
  assert.match(reader, /candidateReviewSectionRef/);
  assert.match(reader, /scrollIntoView/);
  assert.match(reader, /Draft restored/);
  assert.doesNotMatch(reader, /Leave this paper\?/);
  assert.doesNotMatch(reader, /window\.prompt/);
  assert.match(reader, /reader-link-dialog/);
  assert.match(css, /\.reader-layout--with-utility \{ grid-template-areas: "stage research"/);
  assert.match(css, /\.reader-utility-drawer \{ position: absolute/);
  assert.match(pdfReader, /fit-width/);
  assert.match(pdfReader, /fit-page/);
  assert.match(pdfReader, /ResizeObserver/);
  assert.match(pdfReader, /setViewMode\("manual"\)/);
});

test("collection workflow uses structured filters, explicit inspection, and bounded abstracts", async () => {
  const [library, inspector, css] = await Promise.all([
    readFile(new URL("../app/views/LibraryView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/LibraryPaperInspector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(library, /setTimeout\(\(\) =>/);
  assert.match(library, /library-canonical-tags/);
  assert.match(library, /READING_STATUSES/);
  assert.match(library, />Inspect</);
  assert.match(library, /className="paper-link" href=\{`\/papers/);
  assert.match(inspector, /abstractDisplayParagraphs/);
  assert.match(inspector, /Show more/);
  assert.match(inspector, /Show less/);
  assert.match(css, /-webkit-line-clamp: 7/);
});

test("Tags review queue and collection/dashboard controls stay task-facing", async () => {
  const [tags, projects, dashboard, client, bridge] = await Promise.all([
    readFile(new URL("../app/views/TagsView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/ProjectsView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/DashboardView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/api/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/blueprint/[...path]/bridge.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(tags, /getTagReviewQueue/);
  assert.match(tags, /utility=tags&review=tag-candidates/);
  assert.match(tags, />Review</);
  assert.match(client, /\/tags\/review-queue/);
  assert.match(bridge, /isBlueprintTagReviewQueuePath/);
  assert.match(projects, /Project collection filters/);
  assert.match(projects, /Recently updated/);
  assert.match(projects, /getAllProjects/);
  assert.doesNotMatch(projects, /Leave Projects\?/);
  assert.match(dashboard, /Continue reading/);
  assert.match(dashboard, /Active projects/);
  assert.match(dashboard, /Needs attention/);
  assert.match(dashboard, /Drafts to continue/);
});

test("normal task surfaces avoid implementation-language regressions", async () => {
  const surfaces = await Promise.all([
    readFile(new URL("../app/views/ReaderView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/ProjectsView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/TagsView.tsx", import.meta.url), "utf8"),
  ]);
  for (const source of surfaces) {
    assert.doesNotMatch(source, /Use latest server value|Project read model unavailable|The local Project store is empty/);
  }
});
