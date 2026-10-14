import assert from "node:assert/strict";
import { readFile } from "./ui-source.mjs";
import test from "node:test";

const sources = Promise.all([
  readFile(new URL("../app/components/FirstPageThumbnail.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/LibraryPaperInspector.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/PaperDetailView.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/LibraryView.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/views/ReaderView.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("selected-paper thumbnails render only page one through the shared local PDF.js adapter", async () => {
  const [thumbnail] = await sources;
  assert.match(thumbnail, /paperPdfUrl\(paperId\)/);
  assert.match(thumbnail, /createPdfLoadingTask\(pdfUrl\)/);
  assert.match(thumbnail, /document\.getPage\(1\)/);
  assert.match(thumbnail, /canvasRenderGeometry/);
  assert.match(thumbnail, /loadingTask\?\.destroy\(\)/);
  assert.match(thumbnail, /document\?\.destroy\(\)/);
  assert.match(thumbnail, /aria-label="First page preview"/);
});

test("the Library inspector and Paper Detail mount the shared thumbnail with a safe PDF fallback", async () => {
  const [, inspector, detail, library, reader, css] = await sources;
  assert.match(inspector, /<FirstPageThumbnail paperId=\{resource\.data\.paper_id\} available=\{!resource\.data\.missing_pdf && Boolean\(resource\.data\.relative_pdf_path\)\} \/>/);
  assert.match(detail, /<FirstPageThumbnail paperId=\{resource\.data\.paper_id\} available=\{!resource\.data\.missing_pdf && Boolean\(resource\.data\.relative_pdf_path\)\} size="detail" \/>/);
  assert.match(css, /\.pdf-first-page-thumbnail--inspector \{ --first-page-thumbnail-width: 5\.5rem;/);
  assert.match(css, /\.pdf-first-page-thumbnail--detail \{ --first-page-thumbnail-width: 8\.25rem;/);
  assert.match(css, /\.pdf-first-page-thumbnail__skeleton/);
  assert.match(css, /\.pdf-first-page-thumbnail__fallback/);
  assert.doesNotMatch(library, /FirstPageThumbnail/);
  assert.doesNotMatch(reader, /FirstPageThumbnail/);
});

test("strong semantic colors drive markers while state text remains Ink-readable", async () => {
  const [, , , , , css] = await sources;
  for (const [token, value] of Object.entries({
    "--state-blue": "#1a73e8",
    "--state-green": "#2e7d32",
    "--state-amber": "#b26a00",
    "--state-rose": "#b3261e",
    "--state-violet": "#7452a8",
    "--state-slate": "#5f6b73",
  })) assert.match(css, new RegExp(`${token}: ${value};`));
  assert.match(css, /--status-marker-color: var\(--state-slate\)/);
  assert.match(css, /background: var\(--status-marker-color\)/);
  assert.match(css, /\.status-badge \{ --status-marker-color: var\(--state-slate\);[\s\S]*color: var\(--color-text-strong-secondary\);/);
});
