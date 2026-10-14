import test from "node:test";
import assert from "node:assert/strict";
import { blankReviewInput, newReviewRow, newWorkflowRow, validateReviewInput, validateReviewDossier, reviewInput, reviewRevision, reviewCoverage, collectProjectReviewSources, compareReviewSnapshots, exportReviewMarkdown } from "./model.mjs";
import { saveProjectReview, freezeProjectReview } from "../../../../hosting/domain/review.mjs";

function input(...rows) {
  const value = blankReviewInput();
  value.rows = rows;
  for (const kind of Object.keys(value.checklist)) value.checklist[kind] = true;
  return value;
}
function row(stage = "comparison", changes = {}) { return { ...newWorkflowRow(stage), text: "An explicitly recorded observation", ...changes }; }
function fixture() {
  return { projects: [{ project_id: "project-a", name: "Research handoff", status: "active", links: [{ target_type: "paper", paper_id: "paper-a", target_id: "paper-a" }] }], papers: [{ paper_id: "paper-a", metadata: { title: "Original evidence" }, note: "A recorded observation", blocks: [] }] };
}
const invalid = (value) => assert.throws(() => validateReviewInput(value), (error) => error.status === 422);

test("workflow factories create independent explicit fields without changing legacy input or rows", () => {
  assert.deepEqual(blankReviewInput(), { schema_version: 1, rows: [], checklist: { hypothesis: false, decision: false, failed_attempt: false, question: false, next_action: false } });
  assert.equal(Object.hasOwn(newReviewRow(), "context"), false);
  for (const [stage, kind] of [["comparison", "hypothesis"], ["decision", "decision"], ["handoff", "next_action"]]) {
    const created = newWorkflowRow(stage);
    assert.equal(created.kind, kind);
    assert.equal(created.context.stage, stage);
    assert.equal(created.context.availability, "not_reported");
    assert.equal(created.context.disposition, "pending");
    assert.equal(created.context.value, "");
    assert.equal(created.context.completed, false);
    assert.equal(created.context.origin_decision_id, "");
    assert.deepEqual(created.context.comparison_ids, []);
  }
  const first = newWorkflowRow(), second = newWorkflowRow();
  first.context.comparison_ids.push("comparison-other");
  assert.notEqual(first.id, second.id);
  assert.deepEqual(second.context.comparison_ids, []);
  assert.throws(() => newWorkflowRow("unknown"), (error) => error.status === 422);
});

test("legacy rows and snapshot bytes survive mixed workflow saves and reads without migration", async () => {
  const state = fixture(), legacy = { ...newReviewRow("decision"), text: "Keep the original decision", status: "reviewed", source_links: [collectProjectReviewSources(state, "project-a")[0].reference] };
  const original = input(legacy);
  assert.deepEqual(validateReviewInput(original), original);
  assert.equal(Object.hasOwn(validateReviewInput(original).rows[0], "context"), false);
  const saved = await saveProjectReview(state, "project-a", { dossier: original, expected_revision: reviewRevision(state.projects[0]) });
  const frozen = await freezeProjectReview(state, "project-a", { expected_revision: saved.revision, reviewed_by: "Reviewer", confirm: true });
  const snapshotBytes = JSON.stringify(frozen.snapshot), legacyBytes = JSON.stringify(frozen.dossier.rows[0]);
  const mixed = reviewInput(frozen.dossier); mixed.rows.push(row());
  const updated = await saveProjectReview(state, "project-a", { dossier: mixed, expected_revision: frozen.revision });
  assert.equal(JSON.stringify(updated.dossier.rows[0]), legacyBytes);
  assert.equal(JSON.stringify(updated.dossier.snapshots[0]), snapshotBytes);
  assert.equal(JSON.stringify(validateReviewDossier(updated.dossier).snapshots[0]), snapshotBytes);
});

test("workflow validation bounds every text field and rejects unknown or malformed context", () => {
  const limits = { method: 500, conditions: 2000, metric: 200, value: 200, unit: 100, rationale: 4000 };
  for (const [field, limit] of Object.entries(limits)) {
    const value = input(row());
    value.rows[0].context.availability = "reported";
    value.rows[0].context.value = "1";
    value.rows[0].context[field] = "x".repeat(limit);
    assert.equal(validateReviewInput(value).rows[0].context[field].length, limit);
    value.rows[0].context[field] += "x"; invalid(value);
    value.rows[0].context[field] = 0; invalid(value);
    value.rows[0].context[field] = "bad\0text"; invalid(value);
  }
  for (const context of [null, [], {}, { ...row().context, ignored: true }, { ...row().context, stage: "other" }, { ...row().context, availability: "available" }, { ...row().context, disposition: "accepted" }, { ...row().context, completed: "yes" }, { ...row().context, comparison_ids: "comparison-a" }, { ...row().context, comparison_ids: Array(101).fill("comparison-a") }]) invalid(input(row("comparison", { context })));
  for (const availability of ["reported", "not_reported", "unavailable", "extraction_failed"]) {
    const value = input(row()); value.rows[0].context.availability = availability;
    value.rows[0].context.value = availability === "reported" ? "0" : "";
    assert.equal(validateReviewInput(value).rows[0].context.availability, availability);
    assert.equal(validateReviewInput(value).rows[0].context.value, availability === "reported" ? "0" : "");
  }
  for (const disposition of ["pending", "adopted", "rejected", "deferred"]) {
    const value = input(row("decision")); value.rows[0].context.disposition = disposition;
    assert.equal(validateReviewInput(value).rows[0].context.disposition, disposition);
  }
});

test("reported values remain literal strings; unavailable measurements cannot retain hidden values or units", () => {
  for (const measurement of ["0", "0.00", "2–4", "below detection limit"]) {
    const value = input(row()); Object.assign(value.rows[0].context, { availability: "reported", value: measurement });
    assert.equal(validateReviewInput(value).rows[0].context.value, measurement);
    assert.equal(validateReviewInput(value).rows[0].context.unit, "");
  }
  for (const measurement of ["", " ", "\n\t"]) {
    const value = input(row()); Object.assign(value.rows[0].context, { availability: "reported", value: measurement }); invalid(value);
  }
  for (const availability of ["not_reported", "unavailable", "extraction_failed"]) {
    for (const stale of [{ value: "0" }, { unit: "%" }, { value: "old-result", unit: "old-unit" }]) {
      const value = input(row()); Object.assign(value.rows[0].context, { availability, ...stale });
      const before = JSON.stringify(value); invalid(value); assert.equal(JSON.stringify(value), before);
      const markdown = exportReviewMarkdown(value);
      assert.ok(markdown.includes(`Value: ${availability.replaceAll("_", " ")}`));
      assert.ok(markdown.includes(`Unit: ${availability.replaceAll("_", " ")}`));
      assert.equal(markdown.includes("Value: 0"), false);
      assert.equal(markdown.includes("Unit: %"), false);
      assert.equal(markdown.includes("old-result"), false);
      assert.equal(markdown.includes("old-unit"), false);
    }
  }
});

test("decision and handoff references resolve comparison rows independent of ordering", () => {
  const comparison = row(), decision = row("decision", { kind: "failed_attempt" }), handoff = row("handoff");
  decision.context.comparison_ids = [comparison.id];
  decision.context.disposition = "rejected";
  handoff.context.comparison_ids = [comparison.id];
  handoff.context.completed = true;
  const value = input(handoff, decision, comparison);
  assert.deepEqual(validateReviewInput(value), value);
  const validated = validateReviewInput(value); validated.rows[0].context.comparison_ids.push("other");
  assert.deepEqual(handoff.context.comparison_ids, [comparison.id]);
  for (const references of [[comparison.id, comparison.id], ["missing"], [decision.id], ["invalid/id"], [null]]) {
    const bad = structuredClone(value); bad.rows[0].context.comparison_ids = references; invalid(bad);
  }
  const self = row(); self.context.comparison_ids = [self.id]; invalid(input(self));
  invalid(input(decision, handoff));
  const changedStage = structuredClone(value); changedStage.rows[2].context.stage = "handoff"; invalid(changedStage);
  const legacy = { ...newReviewRow(), text: "A legacy hypothesis" };
  const linkedLegacy = row("decision"); linkedLegacy.context.comparison_ids = [legacy.id]; invalid(input(legacy, linkedLegacy));
});

test("invalid reference saves preserve saved rows, history and revision", async () => {
  const state = fixture(), comparison = row(), decision = row("decision"); decision.context.comparison_ids = [comparison.id];
  const saved = await saveProjectReview(state, "project-a", { dossier: input(comparison, decision), expected_revision: reviewRevision(state.projects[0]) });
  const before = JSON.stringify(state);
  await assert.rejects(() => saveProjectReview(state, "project-a", { dossier: input(decision), expected_revision: saved.revision }), (error) => error.status === 422);
  assert.equal(JSON.stringify(state), before);
});

test("handoffs link to an existing originating decision while older contexts stay unchanged", async () => {
  const comparison = row(), decision = row("decision"), handoff = row("handoff");
  decision.context.comparison_ids = [comparison.id];
  handoff.context.comparison_ids = [comparison.id];
  handoff.context.origin_decision_id = decision.id;
  const value = input(handoff, comparison, decision);
  assert.deepEqual(validateReviewInput(value), value);
  assert.ok(exportReviewMarkdown(value).includes(`Origin decision record ID: \`${decision.id}\``));
  const older = row("handoff"); delete older.context.origin_decision_id;
  assert.deepEqual(validateReviewInput(input(older)), input(older));
  assert.equal(Object.hasOwn(validateReviewInput(input(older)).rows[0].context, "origin_decision_id"), false);
  for (const reference of ["missing-decision", comparison.id, handoff.id, "invalid/id", null, 12]) {
    const bad = structuredClone(value); bad.rows[0].context.origin_decision_id = reference; invalid(bad);
  }
  for (const stage of ["comparison", "decision"]) {
    const bad = row(stage); bad.context.origin_decision_id = decision.id; invalid(input(bad, decision));
  }
  const changedStage = structuredClone(value); changedStage.rows[2].context.stage = "handoff"; invalid(changedStage);
  const legacy = { ...newReviewRow("decision"), text: "Legacy decision" }, legacyLink = row("handoff");
  legacyLink.context.origin_decision_id = legacy.id; invalid(input(legacy, legacyLink));
  const state = fixture(), saved = await saveProjectReview(state, "project-a", { dossier: value, expected_revision: reviewRevision(state.projects[0]) });
  const frozen = await freezeProjectReview(state, "project-a", { expected_revision: saved.revision, reviewed_by: "Reviewer", confirm: true });
  const before = JSON.stringify(state);
  await assert.rejects(() => saveProjectReview(state, "project-a", { dossier: input(handoff, comparison), expected_revision: frozen.revision }), (error) => error.status === 422);
  assert.equal(JSON.stringify(state), before);
  const snapshotBytes = JSON.stringify(frozen.snapshot);
  const next = structuredClone(value); next.rows[0].context.completed = true;
  const updated = await saveProjectReview(state, "project-a", { dossier: next, expected_revision: frozen.revision });
  assert.equal(JSON.stringify(updated.dossier.snapshots[0]), snapshotBytes);
  assert.equal(updated.dossier.snapshots[0].input.rows[0].context.origin_decision_id, decision.id);
});

test("reviewed comparisons always require their own project source before freezing", async () => {
  for (const kind of ["hypothesis", "question", "next_action"]) {
    const state = fixture(), comparison = row("comparison", { kind, status: "reviewed" });
    const value = input(comparison), sources = collectProjectReviewSources(state, "project-a");
    assert.deepEqual(reviewCoverage(value, sources).unsourced_reviewed_rows, [comparison.id]);
    assert.equal(reviewCoverage(value, sources).substantive_rows, 1);
    assert.equal(reviewCoverage(value, sources).unsourced_questions_actions, 0);
    const saved = await saveProjectReview(state, "project-a", { dossier: value, expected_revision: reviewRevision(state.projects[0]) });
    const before = JSON.stringify(state);
    await assert.rejects(() => freezeProjectReview(state, "project-a", { expected_revision: saved.revision, reviewed_by: "Reviewer", confirm: true }), (error) => error.status === 422);
    assert.equal(JSON.stringify(state), before);
    comparison.source_links = [sources[0].reference];
    const sourced = await saveProjectReview(state, "project-a", { dossier: input(comparison), expected_revision: saved.revision });
    const frozen = await freezeProjectReview(state, "project-a", { expected_revision: sourced.revision, reviewed_by: "Reviewer", confirm: true });
    assert.equal(frozen.snapshot.source_inputs.length, 1);
  }
  const state = fixture(), comparison = row("comparison", { status: "reviewed", source_links: [collectProjectReviewSources(state, "project-a")[0].reference] }), decision = row("decision", { status: "reviewed" });
  decision.context.comparison_ids = [comparison.id];
  assert.deepEqual(reviewCoverage(input(comparison, decision), collectProjectReviewSources(state, "project-a")).unsourced_reviewed_rows, [decision.id]);
});

test("reviewed decision-stage outcomes cannot bypass evidence checks by changing their legacy kind", async () => {
  for (const kind of ["question", "next_action"]) for (const disposition of ["pending", "adopted", "rejected", "deferred"]) {
    const state = fixture(), decision = row("decision", { kind, status: "reviewed" });
    decision.context.disposition = disposition;
    const value = input(decision), sources = collectProjectReviewSources(state, "project-a"), coverage = reviewCoverage(value, sources);
    assert.equal(coverage.can_freeze, false);
    assert.deepEqual(coverage.unsourced_reviewed_rows, [decision.id]);
    assert.equal(coverage.substantive_rows, 1);
    assert.equal(coverage.unsourced_questions_actions, 0);
    const saved = await saveProjectReview(state, "project-a", { dossier: value, expected_revision: reviewRevision(state.projects[0]) });
    const before = JSON.stringify(state);
    await assert.rejects(() => freezeProjectReview(state, "project-a", { expected_revision: saved.revision, reviewed_by: "Reviewer", confirm: true }), (error) => error.status === 422);
    assert.equal(JSON.stringify(state), before);
    decision.source_links = [sources[0].reference];
    assert.equal(reviewCoverage(input(decision), sources).can_freeze, true);
  }
});

test("context-only changes appear in snapshot differences and preserve earlier context", () => {
  const previous = input(row("handoff")), current = structuredClone(previous);
  current.rows[0].context.completed = true;
  current.rows[0].context.rationale = "First measurement was recorded";
  const diff = compareReviewSnapshots(previous, current);
  assert.equal(diff.changed.length, 1); assert.equal(diff.added.length, 0); assert.equal(diff.removed.length, 0);
  assert.equal(previous.rows[0].context.completed, false);
});

test("Markdown exports comparison conditions, decisions, reference IDs and handoff completion safely", () => {
  const comparison = row(), decision = row("decision", { kind: "failed_attempt" }), handoff = row("handoff", { owner: "Incoming researcher", due_date: "2026-10-20" });
  Object.assign(comparison.context, { method: "Protocol A", conditions: "room temperature", metric: "yield", value: "73", unit: "%", availability: "reported" });
  Object.assign(decision.context, { disposition: "rejected", rationale: "Failed the control measurement", comparison_ids: [comparison.id] });
  Object.assign(handoff.context, { comparison_ids: [comparison.id], completed: true });
  const markdown = exportReviewMarkdown(input(comparison, decision, handoff), "Research trial");
  for (const expected of ["Workflow stage: comparison", "Method: Protocol A", "Conditions: room temperature", "Metric: yield", "Value: 73", "Unit: %", "Availability: reported", "Disposition: rejected", "Rationale: Failed the control measurement", `Comparison record IDs: \`${comparison.id}\``, `Record ID: \`${comparison.id}\``, "owner: Incoming researcher", "due: 2026-10-20", "First action completed: yes"]) assert.ok(markdown.includes(expected), expected);
  assert.match(markdown, /Human review records judgment/);
  const hostile = row("handoff", { text: "![image](https://example.test/x)\n# fake heading\n<script>bad</script>\n===", owner: "**admin**" });
  hostile.context.method = "[link](javascript:bad)"; hostile.context.rationale = "`code`\n## injected";
  hostile.source_links = [collectProjectReviewSources(fixture(), "project-a")[0].reference];
  const snapshot = { input: input(hostile), version: 1, reviewed_by: "<img src=x>", created_at: "2026-10-14T12:00:00Z", source_fingerprint: "a".repeat(64), source_inputs: [{ reference: hostile.source_links[0], label: "<script>alert(1)</script>", content: "{}" }] };
  const safe = exportReviewMarkdown(snapshot, "# name\n## forged");
  assert.ok(safe.includes("\\!\\[image\\]\\(https://example\\.test/x\\)"));
  assert.ok(safe.includes("\\[link\\]\\(javascript:bad\\)"));
  assert.ok(safe.includes("&lt;script&gt;bad&lt;/script&gt;"));
  assert.ok(safe.includes("owner: \\*\\*admin\\*\\*"));
  assert.ok(safe.includes("reviewed by &lt;img src\\=x&gt;"));
  assert.ok(safe.includes("\\=\\=\\="));
  assert.equal(safe.includes("<script>"), false);
  assert.equal(safe.includes("\n# fake heading"), false);
  assert.equal(safe.includes("\n## forged"), false);
});
