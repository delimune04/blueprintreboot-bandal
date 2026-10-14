import test from "node:test";
import assert from "node:assert/strict";
import { prepareAiSources, selectAiEvidence, rankEvidence } from "./sources.mjs";
const sha = "a".repeat(64);
function state() { return { papers: [
  { paper_id: "one", metadata: { title: "CCS storage" }, archived: false, pdfSha256: sha, fullTextCache: { source_pdf_sha256: sha, provider: "browser-pdfjs", pages: [{ page_number: 1, text: "Caprock permeability constrains carbon storage monitoring." }] }, blocks: [{ id: "b1", text: "Selected question about leakage", page: "1" }, { id: "b2", text: "Unrelated seismic observation", page: "2" }], noteExists: true, note: "Keep uncertainty explicit." },
  { paper_id: "two", metadata: { title: "Unrelated private research" }, blocks: [{ id: "b3", text: "Not selected" }] },
], projects: [{ project_id: "p", links: [{ target_type: "paper", paper_id: "one", target_id: "one" }] }, { project_id: "block-only", links: [{ target_type: "note_block", paper_id: "one", target_id: "b1" }] }] }; }
test("BM25 evidence preview is project-scoped and tied to PDF pages", async () => {
  const preview = await prepareAiSources(state(), { project_id: "p", question: "caprock permeability" });
  assert.equal(preview.sources[0].kind, "pdf-page"); assert.equal(preview.sources[0].page, 1);
  assert(preview.sources.every((source) => source.paper_id === "one")); assert.equal(preview.coverage.semantic_search, false);
});
test("block-only project links cannot disclose the rest of a linked paper", async () => {
  const preview = await prepareAiSources(state(), { project_id: "block-only", question: "leakage" });
  assert.equal(preview.sources.length, 1); assert.equal(preview.sources[0].block_id, "b1");
});
test("stale or removed PDF extraction is excluded and changes preview consent", async () => {
  const input = { project_id: "p", question: "caprock" }, s = state(), original = await prepareAiSources(s, input);
  s.papers[0].pdfSha256 = "b".repeat(64);
  const changed = await prepareAiSources(s, input); assert(changed.coverage.excluded_pdf_pages > 0); assert(!changed.sources.some((source) => source.kind === "pdf-page")); assert.notEqual(changed.revision, original.revision);
  s.papers[0].pdfMissing = true; assert(!(await prepareAiSources(s, input)).sources.some((source) => source.kind === "pdf-page"));
});
test("AI selection refuses changed questions, changed source bytes and forged IDs", async () => {
  const s = state(), input = { project_id: "p", question: "caprock" }, preview = await prepareAiSources(s, input), request = { ...input, source_ids: [preview.sources[0].id], sources_revision: preview.revision, task: "handoff" };
  assert.equal((await selectAiEvidence(s, request)).sources.length, 1);
  await assert.rejects(selectAiEvidence(s, { ...request, question: "another question" }), { status: 409 });
  await assert.rejects(selectAiEvidence(s, { ...request, source_ids: ["two:private"] }), { status: 409 });
  s.papers[0].fullTextCache.pages[0].text += " Changed evidence.";
  await assert.rejects(selectAiEvidence(s, request), { status: 409 });
});
test("ranking is deterministic and does not treat missing matches as scientific confidence", () => {
  const input = [{ id: "a", title: "Study", text: "seismic data" }, { id: "b", title: "Study", text: "caprock permeability caprock" }];
  const ranked = rankEvidence(input, "caprock"); assert.equal(ranked[0].id, "b"); assert.deepEqual(ranked, rankEvidence(input, "caprock")); assert(rankEvidence(input, "unseen").every((row) => row.retrieval_score === 0));
});
