import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { copyPaperReference, paperReference } from "../app/lib/workspace/paper-reference.mjs";
const paper = {title: "Carbon & climate", authors: ["김연구", "Lovelace, Ada"], year: "2025", journal: "Research Journal", doi: "10.1234/example", arxiv_id: "2501.12345v2"};
test("preserves author order, original names, identifiers and version", () => {
 const value = paperReference(paper);
 assert.equal(value.text, "Title: Carbon & climate\nAuthors: 김연구; Lovelace, Ada\nYear: 2025\nJournal: Research Journal\nDOI: 10.1234/example\narXiv: 2501.12345v2");
 assert.deepEqual(value.missing, []);
});
test("missing metadata is explicit and does not invent authors, dates, journal or identifier", () => {
 const value = paperReference({title: "Preprint", first_author: "Only partial metadata", authors: []}, "ko");
 assert.deepEqual(value.missing, ["저자", "연도"]);
 assert.equal(value.text, "제목: Preprint\n저자: 미등록\n연도: 미등록");
});
test("normalizes control characters and handles malformed metadata", () => {
 const value = paperReference({title: "A\nB\tC", authors: [null, "  Alice  ", 4], year: null});
 assert.equal(value.text, "Title: A B C\nAuthors: Alice\nYear: Not recorded");
 assert.deepEqual(paperReference().missing, ["title", "authors", "year"]);
});
test("copy reports success only after actual clipboard resolution", async () => {
 let recorded = ""; assert.equal(await copyPaperReference("example", {writeText: async text => { recorded = text; }}), true);
 assert.equal(recorded, "example");
 assert.equal(await copyPaperReference("example"), false);
 assert.equal(await copyPaperReference("example", {writeText: async () => { throw new Error("denied"); }}), false);
});
test("preview is readonly, labelled, keyboard accessible and fallback selects rather than claiming success", () => {
 const ui = readFileSync(new URL("../app/components/PaperReferenceActions.tsx", import.meta.url), "utf8");
 assert.match(ui, /<label/); assert.match(ui, /<textarea ref={preview} readOnly/); assert.match(ui, /preview.current\?\.focus\(\)/); assert.match(ui, /preview.current\?\.select\(\)/); assert.match(ui, /aria-live="polite"/);
 const view = readFileSync(new URL("../app/views/PaperDetailView.tsx", import.meta.url), "utf8");
 assert.match(view, /<PaperReferenceActions key=/);
});
