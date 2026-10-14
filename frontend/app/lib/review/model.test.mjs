import test from "node:test";
import assert from "node:assert/strict";
import { blankReviewInput, collectProjectReviewSources, getReviewDossier, newReviewRow, reviewFingerprint, reviewRevision, validateReviewDossier, validateReviewInput, compareReviewSnapshots, exportReviewMarkdown } from "./model.mjs";
import { getProjectReview, saveProjectReview, freezeProjectReview, routeReview } from "../../../../hosting/domain/review.mjs";

function fixture() {
  return { projects: [{ project_id: "project-a", name: "Lab handoff", status: "active", links: [{ target_type: "paper", paper_id: "paper-a", target_id: "paper-a" }, { target_type: "note_block", paper_id: "paper-b", target_id: "block-b" }] }], papers: [{ paper_id: "paper-a", metadata: { title: "Linked research", abstract: "Recorded abstract" }, note: "A reading note", blocks: [{ id: "block-a", title: "A result", text: "Recorded evidence", page: "1" }], pdfSha256: "a".repeat(64), fullTextCache: { sha256: "a".repeat(64), provider: "browser-pdfjs", pages: [{ page_number: 1, text: "Actual page text" }] } }, { paper_id: "paper-b", metadata: { title: "Block-only paper" }, note: "Not in project scope", blocks: [{ id: "block-b", text: "Linked block" }, { id: "block-private", text: "Unlinked block" }] }, { paper_id: "paper-private", metadata: { title: "Unrelated work" }, blocks: [] }], researchPages: [{ id: "page-a", project_id: "project-a", title: "Project notebook", blocks: [], handoff: {}, archived: false }, { id: "page-private", project_id: "other-project", title: "Other notebook", archived: false }] };
}
function input(source, kind = "decision") { const value = blankReviewInput(); value.checklist = Object.fromEntries(Object.keys(value.checklist).map((key) => [key, true])); value.rows = [{ ...newReviewRow(kind), text: "Keep the model provisional", status: "reviewed", source_links: source ? [source.reference] : [] }]; return value; }

test("old projects expose an empty dossier without mutating original state", async () => {
  const state = fixture(), before = JSON.stringify(state), response = await getProjectReview(state, "project-a");
  assert.equal(response.revision, "1".padStart(64, "0")); assert.deepEqual(response.dossier, getReviewDossier(state.projects[0])); assert.equal(JSON.stringify(state), before);
  assert.equal(await routeReview(["papers", "paper-a"], "GET", {}, state), null);
});
test("source scope permits project paper pages, exact block links and project notebook only", () => {
  const sources = collectProjectReviewSources(fixture(), "project-a");
  assert.deepEqual(sources.map((source) => source.reference.kind), ["paper", "pdf_page", "note_block", "note_block", "research_page"]);
  assert.equal(sources.some((source) => source.reference.block_id === "block-private"), false);
  assert.equal(sources.some((source) => source.reference.paper_id === "paper-private"), false);
  assert.equal(sources.some((source) => source.reference.research_page_id === "page-private"), false);
});
test("unsourced reviewed substantive claims cannot freeze; source-less questions are labeled", async () => {
  for (const kind of ["hypothesis", "decision", "failed_attempt"]) {
    const state = fixture(); const saved = await saveProjectReview(state, "project-a", { dossier: input(null, kind), expected_revision: reviewRevision(state.projects[0]) }); const before = JSON.stringify(state);
    await assert.rejects(() => freezeProjectReview(state, "project-a", { expected_revision: saved.revision, reviewed_by: "Human reviewer", confirm: true }), (error) => error.status === 422);
    assert.equal(JSON.stringify(state), before);
  }
  const state = fixture(), saved = await saveProjectReview(state, "project-a", { dossier: input(null, "question"), expected_revision: reviewRevision(state.projects[0]) });
  const frozen = await freezeProjectReview(state, "project-a", { expected_revision: saved.revision, reviewed_by: "Human reviewer", confirm: true });
  assert.equal(frozen.snapshot.source_inputs.length, 0); assert.match(exportReviewMarkdown(frozen.snapshot), /No source linked/);
});
test("save and freeze refuse out-of-project or removed evidence", async () => {
  const state = fixture(), invalid = { reference: { kind: "paper", paper_id: "paper-private", page: null, block_id: "", research_page_id: "" } };
  await assert.rejects(() => saveProjectReview(state, "project-a", { dossier: input(invalid), expected_revision: reviewRevision(state.projects[0]) }), (error) => error.status === 422);
  const source = collectProjectReviewSources(state, "project-a")[0];
  const saved = await saveProjectReview(state, "project-a", { dossier: input(source), expected_revision: reviewRevision(state.projects[0]) });
  state.projects[0].links = [];
  assert.deepEqual((await getProjectReview(state, "project-a")).coverage.missing_source_rows, saved.dossier.rows.map((row) => row.id));
  await assert.rejects(() => freezeProjectReview(state, "project-a", { expected_revision: saved.revision, reviewed_by: "Reviewer", confirm: true }), (error) => error.status === 422);
});
test("exact snapshot evidence survives edits and fingerprints signal stale sources", async () => {
  const state = fixture(), source = collectProjectReviewSources(state, "project-a").find((item) => item.reference.kind === "pdf_page");
  const saved = await saveProjectReview(state, "project-a", { dossier: input(source), expected_revision: reviewRevision(state.projects[0]) });
  const frozen = await freezeProjectReview(state, "project-a", { expected_revision: saved.revision, reviewed_by: "Reviewer", confirm: true }, { now: () => "2026-10-14T12:00:00.000Z" });
  const snapshotBytes = JSON.stringify(frozen.snapshot);
  assert.equal(frozen.snapshot.source_inputs[0].content, source.content);
  state.papers[0].fullTextCache.pages[0].text = "Changed evidence";
  const current = await getProjectReview(state, "project-a"); assert.equal(current.latest_snapshot_stale, true); assert.equal(current.draft_sources_stale, true); assert.equal(JSON.stringify(current.dossier.snapshots[0]), snapshotBytes);
  await assert.rejects(() => freezeProjectReview(state, "project-a", { expected_revision: current.revision, reviewed_by: "Reviewer", confirm: true }), (error) => error.status === 409);
  const resaved = await saveProjectReview(state, "project-a", { dossier: reviewInputForTest(current), expected_revision: current.revision });
  assert.equal(resaved.draft_sources_stale, false); assert.equal(resaved.latest_snapshot_stale, true);
});
function reviewInputForTest(response) { return { schema_version: 1, rows: response.dossier.rows, checklist: response.dossier.checklist }; }
test("review revision guards stale writers and immutable history cannot be supplied through save", async () => {
  const state = fixture(), source = collectProjectReviewSources(state, "project-a")[0], version = reviewRevision(state.projects[0]);
  await saveProjectReview(state, "project-a", { dossier: input(source), expected_revision: version });
  await assert.rejects(() => saveProjectReview(state, "project-a", { dossier: input(source), expected_revision: version }), (error) => error.status === 409);
  const next = { ...input(source), snapshots: [] };
  await assert.rejects(() => saveProjectReview(state, "project-a", { dossier: next, expected_revision: reviewRevision(state.projects[0]) }), (error) => error.status === 422);
});
test("fingerprints ignore unrelated sources but preserve actual selected content and provenance", async () => {
  const state = fixture(), sources = collectProjectReviewSources(state, "project-a"), value = input(sources[1]);
  const first = await reviewFingerprint(value, sources); state.papers[1].note = "Unrelated reading note changed";
  assert.equal(await reviewFingerprint(value, collectProjectReviewSources(state, "project-a")), first);
  state.papers[0].fullTextCache.provider = "browser-pdfjs+tesseract";
  assert.notEqual(await reviewFingerprint(value, collectProjectReviewSources(state, "project-a")), first);
});
test("guest page sources retain their actual extraction hash and refuse stale or missing PDFs", () => {
  const state = fixture(), paper = state.papers[0];
  delete paper.fullTextCache.sha256; paper.fullTextCache.source_pdf_sha256 = "a".repeat(64);
  let page = collectProjectReviewSources(state, "project-a").find((source) => source.reference.kind === "pdf_page");
  assert.equal(JSON.parse(page.content).pdf_sha256, "a".repeat(64));
  paper.pdfSha256 = "b".repeat(64);
  assert.equal(collectProjectReviewSources(state, "project-a").some((source) => source.reference.kind === "pdf_page"), false);
  paper.pdfSha256 = "a".repeat(64); paper.pdfMissing = true;
  assert.equal(collectProjectReviewSources(state, "project-a").some((source) => source.reference.kind === "pdf_page"), false);
});
test("diff includes added changed removed rows; strict bounded models reject malformed state", () => {
  const before = input(null), changed = structuredClone(before); changed.rows[0].owner = "New owner"; changed.rows.push({ ...newReviewRow("next_action"), text: "Measure again" });
  let diff = compareReviewSnapshots(before, changed); assert.equal(diff.changed.length, 1); assert.equal(diff.added.length, 1);
  diff = compareReviewSnapshots(changed, before); assert.equal(diff.removed.length, 1);
  assert.throws(() => validateReviewInput({ ...before, ignored: true }), (error) => error.status === 422);
  assert.throws(() => validateReviewInput({ ...before, rows: [...before.rows, ...before.rows] }), (error) => error.status === 422);
  assert.throws(() => validateReviewDossier({ ...before, source_fingerprint: "", snapshots: [{ version: 1 }] }), (error) => error.status === 422);
  for (const due_date of ["2026-02-30", "not-a-date"]) { const bad = structuredClone(before); bad.rows[0].due_date = due_date; assert.throws(() => validateReviewInput(bad)); }
});
