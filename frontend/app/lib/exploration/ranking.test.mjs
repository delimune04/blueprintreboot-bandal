import test from "node:test";
import assert from "node:assert/strict";
import { rankExploration, sharedReferenceSimilarity, deduplicateWorks, normalizedTitle } from "./ranking.mjs";
import { validateExplorationWork, validateExplorationEdge } from "./model.mjs";

const W = n => `https://openalex.org/W${n}`;
const work = (n, props = {}) => ({ id: W(n), openalex_id: W(n), title: "Carbon storage geological caprock", authors: ["Researcher"], doi: "", abstract: "Carbon storage evidence and caprock transport", year: "2020", url: W(n), pdf_url: "", source: "OpenAlex", providers: ["OpenAlex"], references: [], topic_ids: [], topics: [], citation_count: 0, cited_by_count: 0, ...props });
test("citation direction comes from real references; coupling and topics remain undirected", () => {
  const seed = work(1, { references: [W(2), W(90)], topic_ids: ["https://openalex.org/T1"] });
  const output = rankExploration({ seed, candidates: [work(2), work(3, { references: [W(1), W(90)], topic_ids: ["https://openalex.org/T1"] }), work(4, { references: [W(90)] })], currentYear: 2026 });
  const citation = output.graph.edges.filter(e => e.kind === "cites");
  assert.deepEqual(citation.map(e => [e.source, e.target]), [[W(1), W(2)], [W(3), W(1)]]);
  assert.ok(output.graph.edges.some(e => e.kind === "shares_references" && e.evidence.shared_reference_ids.includes(W(90))));
  assert.ok(output.graph.edges.filter(e => e.kind !== "cites").every(e => !e.directed));
  for (const item of [output.seed, ...output.items]) validateExplorationWork(item);
  for (const edge of output.graph.edges) validateExplorationEdge(edge);
});
test("textual or topical similarity alone never fabricates a citation", () => {
  const output = rankExploration({ seed: work(1, { topic_ids: ["https://openalex.org/T1"] }), candidates: [work(2, { topic_ids: ["https://openalex.org/T1"] }), work(3)] });
  assert.ok(output.graph.edges.length);
  assert.equal(output.graph.edges.filter(e => e.kind === "cites").length, 0);
  assert.ok(output.items.every(item => item.relation_to_seed.length === 0));
});
test("MMR diversifies repeated neighborhoods and is deterministic across provider completion order", () => {
  const seed = work(1, { references: [W(90), W(91)], topic_ids: ["https://openalex.org/T1"] });
  const candidates = [work(2, { references: [W(90), W(91)], topic_ids: ["https://openalex.org/T1"] }), work(3, { references: [W(90), W(91)], topic_ids: ["https://openalex.org/T1"] }), work(4, { references: [W(90), W(91)], topic_ids: ["https://openalex.org/T2"] })];
  const a = rankExploration({ seed, candidates, mode: "bridges", currentYear: 2026 }), b = rankExploration({ seed, candidates: [...candidates].reverse(), mode: "bridges", currentYear: 2026 });
  assert.deepEqual(a, b);
  assert.ok(a.items.find(item => item.id === W(3)).rank_components.diversity_penalty > 0);
  assert.ok(a.items.find(item => item.id === W(4)).rank_components.bridge_context > 0);
  assert.equal(a.items[1].id, W(4));
  assert.ok(a.items.find(item => item.id === W(3)).rank_components.relevance_before_diversity > a.items[1].rank_components.relevance_before_diversity);
});
test("recency mode prefers newer otherwise equal evidence and foundations favors actual earlier references", () => {
  const seed = work(1, { year: "2020", references: [W(2)] }), candidates = [work(2, { year: "2000" }), work(3, { year: "2026" })];
  assert.equal(rankExploration({ seed, candidates, mode: "recent", currentYear: 2026 }).items[0].id, W(3));
  assert.equal(rankExploration({ seed, candidates, mode: "foundations", currentYear: 2026 }).items[0].id, W(2));
});
test("citation context saturates, never uses h-index, and missing fields remain explicit", () => {
  const seed = work(1), a = work(2, { citation_count: 500, h_index: 1 }), b = work(3, { citation_count: 50000000, h_index: 900000 });
  const output = rankExploration({ seed, candidates: [a, b, work(4, { year: "", abstract: "", citation_count: null, evidence: { references: "missing" } })], currentYear: 2026 });
  assert.equal(output.items.find(i => i.id === W(2)).rank_components.citation_context, output.items.find(i => i.id === W(3)).rank_components.citation_context);
  assert.equal(output.items.find(i => i.id === W(2)).rank_components.relevance_before_diversity, output.items.find(i => i.id === W(3)).rank_components.relevance_before_diversity);
  const missing = output.items.find(i => i.id === W(4)); assert.equal(missing.citation_count, null); assert.equal(missing.evidence.references, "missing"); assert.ok(missing.reasons.some(r => r.kind === "missing_evidence"));
});
test("provider duplicates prefer OpenAlex identity without adding counts or inventing complete refs", () => {
  const result = deduplicateWorks([{ id: "10.1234/test", doi: "10.1234/TEST", source: "Crossref", title: "A real work", references: ["https://doi.org/10.1234/ref"], citation_count: 10 }, work(1, { doi: "10.1234/test", citation_count: 12, references: [W(2)] })]);
  assert.equal(result.length, 1); assert.equal(result[0].id, W(1)); assert.equal(result[0].citation_count, 12); assert.deepEqual(result[0].references, [W(2)]); assert.deepEqual(result[0].providers.sort(), ["Crossref", "OpenAlex"]);
  assert.deepEqual(sharedReferenceSimilarity({ references: ["W2", W(2)] }, { references: [W(2)] }), { score: 1, ids: [W(2)] });
  assert.notEqual(normalizedTitle("The method"), normalizedTitle("Method"));
});
test("retracted and paratext works are excluded without changing the explicitly chosen seed", () => {
  const result = rankExploration({ seed: work(1, { is_retracted: true }), candidates: [work(2, { is_retracted: true }), work(3, { is_paratext: true }), work(4)] });
  assert.equal(result.seed.id, W(1)); assert.equal(result.seed.is_retracted, true); assert.deepEqual(result.items.map(i => i.id), [W(4)]);
});
