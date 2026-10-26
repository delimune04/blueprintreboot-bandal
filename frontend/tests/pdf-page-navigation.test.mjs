import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { normalizePdfPageInput, pdfPageShortcut } from "../app/lib/pdf/page-navigation.mjs";

test("page inputs clamp whole numbers, including a jump already on the boundary", () => {
  assert.equal(normalizePdfPageInput("999", 2, 2), 2);
  assert.equal(normalizePdfPageInput("0", 1, 9), 1);
  assert.equal(normalizePdfPageInput("-20", 1, 9), 1);
  assert.equal(normalizePdfPageInput(" 03 ", 1, 9), 3);
  assert.equal(normalizePdfPageInput("+4", 1, 9), 4);
});

test("empty, fractional, exponent, nonnumeric and unsafe drafts keep the actual page", () => {
  for (const input of ["", " ", "1.9", "1e2", "2abc", "NaN", "Infinity", "9007199254740993"]) {
    assert.equal(normalizePdfPageInput(input, 3, 10), 3, input);
  }
  assert.equal(normalizePdfPageInput("1", NaN, 0), 1);
});

test("N/P page shortcuts belong only to the focused viewport", () => {
  assert.equal(pdfPageShortcut({ key: "n", viewportFocused: true }), 1);
  assert.equal(pdfPageShortcut({ key: "p", viewportFocused: true }), -1);
  assert.equal(pdfPageShortcut({ key: "N", viewportFocused: true }), 1);
  for (const key of ["n", "p"]) {
    assert.equal(pdfPageShortcut({ key, viewportFocused: false }), 0);
    for (const guard of ["altKey", "ctrlKey", "metaKey", "shiftKey", "isComposing", "defaultPrevented"]) {
      assert.equal(pdfPageShortcut({ key, viewportFocused: true, [guard]: true }), 0, guard);
    }
  }
});

test("PDF zoom panning, scrolling, selection and browser keys remain untouched", () => {
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Tab", "Escape", "f"]) {
    assert.equal(pdfPageShortcut({ key, viewportFocused: true }), 0, key);
  }
});

test("reader wires same-page field synchronization, Escape cancellation and scoped keyboard navigation", () => {
  const source = readFileSync(new URL("../app/components/PdfJsReader.tsx", import.meta.url), "utf8");
  assert.match(source, /setPageInput\(String\(pageNumber\)\)/);
  assert.match(source, /normalizePdfPageInput\(pageInput, state.pageNumber, state.totalPages\)/);
  assert.match(source, /event.key === "Escape"[\s\S]*?setPageInput\(String\(state.pageNumber\)\)/);
  assert.match(source, /viewportFocused: event.target === event.currentTarget/);
  assert.match(source, /if \(!step \|\| fallbackActive \|\| !controlsReady\) return/);
  assert.match(source, /tabIndex=\{!fallbackActive && controlsReady \? 0 : undefined\}/);
  assert.match(source, /aria-describedby=\{!fallbackActive && controlsReady \? "pdf-navigation-hint" : undefined\}/);
});
