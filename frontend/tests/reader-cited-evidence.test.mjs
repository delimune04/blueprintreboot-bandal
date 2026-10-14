import assert from "node:assert/strict";
import test from "node:test";
import { appendReaderHighlight, readReaderPreferences, readerPreferenceKey, selectionEvidenceDraft, updateReaderPreferences, validateReaderSelection } from "../app/lib/reader/browser-reader-state.mjs";
import { highlightedTextSegments, searchFullText } from "../app/lib/reader/full-text-search.mjs";
import { normalizePageSelection } from "../app/lib/pdf/selection-coordinates.mjs";
import { visiblePdfPage } from "../app/lib/reader/visible-pdf-page.mjs";

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}
function selection() {
  return normalizePageSelection({ pageNumber: 3, text: "CO₂ 저장 · 근거", pageRect: { left: 50, top: 80, width: 500, height: 800 }, selectionRects: [{ left: 100, top: 160, right: 350, bottom: 190 }] });
}

test("PDF selections preserve literal quote and 1-based normalized citation geometry", () => {
  const capture = selection();
  const draft = selectionEvidenceDraft(capture);
  assert.equal(draft.block_type, "evidence");
  assert.equal(draft.page, "3");
  assert.equal(draft.quote, "CO₂ 저장 · 근거");
  assert.deepEqual(draft.provenance, { source: "pdf_selection", page: 3, coordinate_space: "page-normalized", quote: draft.quote, rectangles: [{ x: 0.1, y: 0.1, width: 0.5, height: 0.0375 }] });
  assert.equal(validateReaderSelection({ ...capture, pageNumber: 0 }), false);
  assert.equal(validateReaderSelection({ ...capture, rectangles: [{ x: 0.9, y: 0.1, width: 0.5, height: 0.01 }] }), false);
  assert.throws(() => selectionEvidenceDraft({ ...capture, text: "" }));
});

test("reader preference updates preserve highlights when another page preference is saved", () => {
  const local = storage();
  const paperId = "paper/한글";
  assert.equal(updateReaderPreferences(local, paperId, (current) => appendReaderHighlight(current, selection(), "highlight-1")).ok, true);
  assert.equal(updateReaderPreferences(local, paperId, (current) => ({ ...current, page: 8 })).ok, true);
  const restored = readReaderPreferences(local, paperId).value;
  assert.equal(restored.page, 8);
  assert.equal(restored.highlights.length, 1);
  assert.equal(restored.highlights[0].text, "CO₂ 저장 · 근거");
  assert.equal(updateReaderPreferences(local, paperId, (current) => appendReaderHighlight(current, selection(), "duplicate")).value.highlights.length, 1);
  assert.equal(readReaderPreferences(local, "other-paper").value.highlights.length, 0);
});

test("corrupt preferences are preserved and block a write instead of resetting", () => {
  const local = storage();
  local.setItem(readerPreferenceKey("paper"), "{unreadable");
  const result = updateReaderPreferences(local, "paper", (current) => ({ ...current, page: 4 }));
  assert.equal(result.ok, false);
  assert.equal(local.getItem(readerPreferenceKey("paper")), "{unreadable");
});

test("quota errors and failed write confirmation do not report a saved highlight", () => {
  const quota = { getItem: () => null, setItem() { throw new Error("quota"); } };
  assert.equal(updateReaderPreferences(quota, "paper", (current) => appendReaderHighlight(current, selection(), "h")).ok, false);
  const discarded = { getItem: () => null, setItem() {} };
  assert.equal(updateReaderPreferences(discarded, "paper", (current) => ({ ...current, page: 2 })).ok, false);
});

test("full-text search treats query punctuation literally and maps original PDF page markers", () => {
  const text = "--- Page 1 ---\nCO₂ storage (test)\n\n--- Page 2 ---\nStorage (test) is measured.";
  const matches = searchFullText(text, "(test)");
  assert.deepEqual(matches.map((match) => match.page), [1, 2]);
  assert.equal(matches.length, 2);
  assert.equal(highlightedTextSegments(text, matches).map((segment) => segment.text).join(""), text);
  assert.equal(searchFullText(text, "storage")[1].page, 2);
  assert.deepEqual(searchFullText(text, ""), []);
  assert.equal(searchFullText("word word", "word", 1).length, 1);
});

test("search never guesses a PDF page without a page boundary and supports formfeed caches", () => {
  assert.equal(searchFullText("flat text text", "text")[0].page, null);
  assert.deepEqual(searchFullText("text\ftext\ftext", "text").map((match) => match.page), [1, 2, 3]);
  const text = "İstanbul · 연구 · Match";
  const match = searchFullText(text, "match")[0];
  assert.equal(text.slice(match.index, match.index + match.length), "Match");
});

test("current page tracking works when zoomed pages are taller than the viewport", () => {
  const pages = [{ page: 1, top: 20, height: 2000 }, { page: 2, top: 2040, height: 2000 }];
  assert.equal(visiblePdfPage(pages, 2600, 400), 2);
  assert.equal(visiblePdfPage(pages, 100, 400), 1);
  assert.equal(visiblePdfPage(pages, 1820, 400), 1);
  assert.equal(visiblePdfPage([], 0, 400), null);
});
