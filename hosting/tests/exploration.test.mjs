import test from "node:test";
import assert from "node:assert/strict";
import { explore } from "../domain/exploration.mjs";
import { providerGet } from "../domain/providers.mjs";
import { validateExplorationWork, validateExplorationEdge } from "../../frontend/app/lib/exploration/model.mjs";
const W = n => `https://openalex.org/W${n}`;
const row = (n, props = {}) => ({ id: W(n), display_name: "Geological carbon storage caprock", publication_year: 2024, doi: `https://doi.org/10.9876/${n}`, cited_by_count: 12, authorships: [{ author: { display_name: "Researcher" } }], topics: [{ id: "https://openalex.org/T1", display_name: "Geological storage" }], referenced_works: [], abstract_inverted_index: { Geological: [0], carbon: [1], storage: [2] }, ...props });
const response = body => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
test("seed expansion uses bounded official endpoints and real citation proofs", async () => {
  const seed = row(81001, { referenced_works: [W(81002), W(81900)], related_works: [W(81004)] }), calls = [];
  const result = await explore(new URLSearchParams({ seed: "W81001", q: "geological carbon", limit: "10" }), {}, async value => {
    const url = new URL(value); calls.push(url); assert.equal(url.hostname, "api.openalex.org");
    if (url.pathname.endsWith("/W81001")) return response(seed);
    if (url.searchParams.get("filter") === "cites:W81001") return response({ results: [row(81003, { referenced_works: [] })], meta: { count: 1 } });
    if (url.searchParams.get("filter")?.startsWith("openalex:")) return response({ results: [row(81002), row(81004, { referenced_works: [W(81900)] })], meta: { count: 2 } });
    return response({ results: [row(81004, { referenced_works: [W(81900)] })], meta: { count: 1 } });
  });
  assert.equal(calls.length, 6); assert.ok(result.coverage.requests <= result.coverage.budget); assert.equal(result.seed.id, W(81001)); assert.equal(result.coverage.citation_graph, "available");
  assert.ok(result.graph.edges.some(edge => edge.kind === "cites" && edge.source === W(81003) && edge.target === W(81001) && edge.evidence.method.includes("filter")));
  assert.ok(result.graph.edges.some(edge => edge.kind === "cites" && edge.source === W(81001) && edge.target === W(81002)));
  assert.ok(result.items.some(item => item.shared_reference_ids.includes(W(81900))));
  for (const work of [result.seed, ...result.items]) validateExplorationWork(work); for (const edge of result.graph.edges) validateExplorationEdge(edge);
});
test("OpenAlex failure falls back to real Crossref metadata with missing citation-neighborhood evidence", async () => {
  const calls = [];
  const result = await explore(new URLSearchParams({ q: "caprock outage fixture 82001" }), {}, async value => {
    const url = new URL(value); calls.push(url); if (url.hostname === "api.openalex.org") throw new Error("offline");
    assert.equal(url.hostname, "api.crossref.org"); return response({ message: { items: [{ DOI: "10.9876/82001", title: ["Measured caprock transport"], published: { "date-parts": [[2025]] }, "is-referenced-by-count": 8, reference: [{ DOI: "10.9876/reference" }] }] } });
  });
  assert.equal(calls.length, 2); assert.equal(result.seed, null); assert.equal(result.items.length, 1); assert.equal(result.coverage.citation_graph, "unavailable"); assert.equal(result.items[0].evidence.topic_ids, "missing"); assert.ok(result.warnings.some(w => w.includes("fallback")));
  assert.equal(result.graph.edges.filter(e => e.kind === "cites").length, 0);
});
test("unresolved or ambiguous seed never becomes a fabricated original paper", async () => {
  const result = await explore(new URLSearchParams({ seed: "An exact ambiguous title 83001" }), {}, async value => {
    assert.equal(new URL(value).hostname, "api.openalex.org"); return response({ results: [row(83001, { display_name: "An exact ambiguous title 83001" }), row(83002, { display_name: "An exact ambiguous title 83001" })], meta: { count: 2 } });
  });
  assert.equal(result.seed, null); assert.equal(result.items.length, 2); assert.ok(result.warnings.some(w => w.includes("No placeholder"))); assert.ok(result.graph.nodes.every(n => !n.is_seed));
});
test("exact DOI fallback preserves actual record and never invents an OpenAlex ID", async () => {
  const result = await explore(new URLSearchParams({ seed: "https://doi.org/10.9876/84001" }), {}, async value => {
    const url = new URL(value); if (url.hostname === "api.openalex.org") throw new Error("offline");
    if (url.pathname.includes("10.9876%2F84001")) return response({ message: { DOI: "10.9876/84001", title: ["A real DOI record"] } });
    return response({ message: { items: [{ DOI: "10.9876/84002", title: ["Related measured evidence"] }] } });
  });
  assert.equal(result.seed.id, "https://doi.org/10.9876/84001"); assert.equal(result.seed.openalex_id, undefined); assert.equal(result.coverage.citation_graph, "unavailable"); assert.ok(result.coverage.lookups <= 8);
});
test("invalid URLs, excessive limits, and total provider failure are explicit", async () => {
  let calls = 0; const offline = async () => { calls++; throw new Error("offline"); };
  await assert.rejects(explore(new URLSearchParams({ seed: "https://private.invalid/secret" }), {}, offline), { status: 422 });
  await assert.rejects(explore(new URLSearchParams({ q: "topic", limit: "41" }), {}, offline), { status: 422 }); assert.equal(calls, 0);
  await assert.rejects(explore(new URLSearchParams({ q: "total outage fixture 85001" }), {}, offline), { status: 503, code: "exploration_unavailable" }); assert.equal(calls, 2);
});
test("cache hits avoid repeat provider requests and provider deadlines abort pending fetches", async () => {
  let calls = 0; const params = new URLSearchParams({ q: "cached exploration fixture 86001" });
  const fetcher = async () => { calls++; return response({ results: [row(86001)], meta: { count: 1 } }); };
  const first = await explore(params, {}, fetcher), second = await explore(params, {}, fetcher);
  assert.equal(first.coverage.requests, 1); assert.equal(second.coverage.requests, 0); assert.equal(second.coverage.cache_hits, 1); assert.equal(calls, 1);
  await assert.rejects(providerGet("https://api.openalex.org/works/W86002", {}, async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })), { timeoutMs: 10 }), { status: 504, code: "provider_timeout" });
});
