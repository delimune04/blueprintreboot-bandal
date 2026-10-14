import test from "node:test";
import assert from "node:assert/strict";
import { emptyExploration, validateExploration, mergeExploration, getProjectExplorationState, saveProjectExplorationState, EXPLORATION_LIMITS } from "./model.mjs";
const work = (id, doi = "") => ({ id, title: id, authors: [], year: "2025", doi, url: "https://openalex.org/W1", source: "OpenAlex" });
const response = (items, edges = [], seed = null) => ({ items, seed, graph: { edges } });
test("old project exploration is empty without rewriting original data", () => {
  const state = { projects: [{ project_id: "p", name: "CCS", status: "active" }] }, before = JSON.stringify(state);
  assert.equal(getProjectExplorationState(state, "p").exploration.topic, "CCS"); assert.equal(JSON.stringify(state), before);
});
test("revision conflict preserves saved graph and archived project refuses writes", () => {
  const state = { projects: [{ project_id: "p", name: "CCS", status: "active" }] }, first = getProjectExplorationState(state, "p"), changed = { ...first.exploration, topic: "Caprock" };
  saveProjectExplorationState(state, "p", { exploration: changed, expected_revision: first.revision }); const before = JSON.stringify(state);
  assert.throws(() => saveProjectExplorationState(state, "p", { exploration: first.exploration, expected_revision: first.revision }), { status: 409 }); assert.equal(JSON.stringify(state), before);
  state.projects[0].status = "archived"; assert.throws(() => saveProjectExplorationState(state, "p", { exploration: changed, expected_revision: getProjectExplorationState(state, "p").revision }), { status: 409 });
});
test("DOI identity merge preserves saved queue and path while remapping graph endpoints", () => {
  let current = mergeExploration(emptyExploration(), response([work("10.1234/a", "10.1234/a")])).exploration;
  current.saved_ids = ["10.1234/a"]; current.path = ["10.1234/a"]; current.queue = [{ work_id: "10.1234/a", state: "reading", note: "Keep this." }];
  const merged = mergeExploration(current, response([work("https://openalex.org/W2")], [{ source: "https://openalex.org/W1", target: "https://openalex.org/W2", kind: "cites", directed: true, evidence: { provider: "OpenAlex" } }], { ...work("https://openalex.org/W1", "10.1234/A"), openalex_id: "W1" })).exploration;
  assert.equal(merged.works.length, 2); assert.equal(merged.edges[0].source, "10.1234/a"); assert.deepEqual(merged.queue, current.queue); assert.deepEqual(merged.path, current.path);
});
test("graph limits preserve all previous nodes and explicitly report overflow", () => {
  const full = mergeExploration(emptyExploration(), response(Array.from({ length: 100 }, (_, i) => work(`W${i}`)))).exploration;
  for (let batch = 1; batch < EXPLORATION_LIMITS.works / 100; batch++) Object.assign(full, mergeExploration(full, response(Array.from({ length: 100 }, (_, i) => work(`W${batch * 100 + i}`)))).exploration);
  const merged = mergeExploration(full, response([work("new")])); assert.equal(merged.truncated, true); assert.equal(merged.exploration.works.length, EXPLORATION_LIMITS.works); assert.deepEqual(merged.exploration.works, full.works);
});
test("sparse fallback metadata does not erase known references, author identity or provider provenance", () => {
  const rich = { ...work("https://openalex.org/W1", "10.1234/a"), openalex_id: "https://openalex.org/W1", abstract: "Known source abstract", authors: ["Researcher"], references: ["https://openalex.org/W2"], providers: ["OpenAlex"], citation_count: 17 };
  const first = mergeExploration(emptyExploration(), response([rich])).exploration;
  const second = mergeExploration(first, response([{ ...work("10.1234/a", "10.1234/A"), source: "Crossref", providers: ["Crossref"], abstract: "", references: [], authors: [], reasons: [] }])).exploration;
  assert.equal(second.works[0].abstract, rich.abstract); assert.deepEqual(second.works[0].references, rich.references); assert.equal(second.works[0].openalex_id, rich.openalex_id); assert.deepEqual(second.works[0].providers, ["OpenAlex", "Crossref"]); assert.equal(second.works[0].citation_count, 17); assert.deepEqual(second.works[0].reasons, []);
});
test("unsafe links, dangling identities and citation-like undirected edges are rejected", () => {
  assert.throws(() => mergeExploration(emptyExploration(), response([{ ...work("a"), url: "javascript:alert(1)" }])));
  const value = mergeExploration(emptyExploration(), response([work("a"), work("b")])).exploration;
  assert.throws(() => validateExploration({ ...value, queue: [{ work_id: "missing", state: "read", note: "" }] }));
  assert.throws(() => validateExploration({ ...value, edges: [{ source: "a", target: "b", kind: "cites", directed: false, evidence: { provider: "manual" } }] }));
});
