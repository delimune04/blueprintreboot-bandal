import { fail, text, choice, now } from "./core.mjs";
import { providerGet, openalexItem, crossrefItem, canonicalDoi, canonicalOpenAlexId } from "./providers.mjs";
import { rankExploration, normalizedTitle } from "../../frontend/app/lib/exploration/ranking.mjs";

const BUDGET = 8;
const MAX_CANDIDATES = 180;
const SELECT = "id,doi,display_name,publication_year,authorships,referenced_works,related_works,topics,cited_by_count,abstract_inverted_index,primary_location,best_oa_location,keywords,updated_date,is_retracted,type";
const workUrl = (filters = {}) => { const url = new URL("https://api.openalex.org/works"); url.searchParams.set("select", SELECT); for (const [key, value] of Object.entries(filters)) if (value) url.searchParams.set(key === "per-page" ? "per_page" : key, String(value)); return url; };
const rows = data => Array.isArray(data?.results) ? data.results.slice(0, 60) : [];
const isDoi = value => /^10\.\d{4,9}\/\S+$/i.test(value);
const usable = item => item.id && item.title && item.title !== "Untitled";
const researchItem = row => !/^(?:front[ -]?matter|back[ -]?matter|table of contents|contents|cover|editorial(?: board)?)\b/i.test(row.title || "");
/** Explicit, bounded expansion. This endpoint never writes, crawls, or invents a
 * seed Paper. Provider topics are classifications, not verified relationships.
 * Official contracts: help.openalex.org/data/works/{attributes,citations}/ and
 * help.openalex.org/api/filtering/ (OR batch maximum 100; we use <=40).
 */
export async function explore(params, env, fetchImpl = fetch) {
  const q = text(params.get("q") || "", 300).trim(), rawSeed = text(params.get("seed") || "", 1000).trim(), mode = choice(params.get("mode") || "balanced", ["balanced", "foundations", "recent", "bridges"]), limit = Number(params.get("limit") || 20);
  if (!q && !rawSeed) fail(422, "Enter a research topic or a real seed work identifier.", "exploration_query_required");
  if (!Number.isInteger(limit) || limit < 1 || limit > 40) fail(422, "Exploration limit must be between one and 40.");
  const seedId = canonicalOpenAlexId(rawSeed), seedDoi = canonicalDoi(rawSeed), doiSeed = isDoi(seedDoi);
  if (rawSeed && !seedId && !doiSeed && (/^[a-z][a-z\d+.-]*:\/\//i.test(rawSeed) || /^W\d/i.test(rawSeed) || /^10\./.test(rawSeed))) fail(422, "Use an OpenAlex work ID, DOI, or seed title. Other URLs are unsupported.");
  const warnings = ["Citation and abstract coverage depends on provider indexing. A missing link does not establish that two papers are unrelated.", "Scores rank exploration candidates using metadata and reference evidence; they do not measure scientific quality, truth, or author reputation."], candidates = [], providers = new Set();
  let requests = 0, lookups = 0, cacheHits = 0, truncated = false, seed = null, citedLookupSucceeded = false, openalexSucceeded = false;
  const controller = new AbortController(), deadline = Date.now() + 18000, timer = setTimeout(() => controller.abort(), 18000);
  async function lookup(url, label) {
    if (lookups >= BUDGET || controller.signal.aborted || Date.now() >= deadline) { truncated = true; warnings.push(`${label}: this expansion's lookup budget or deadline was reached.`); return null; }
    lookups++;
    try {
      return await providerGet(url, env, fetchImpl, { signal: controller.signal, timeoutMs: Math.min(8000, deadline - Date.now()), onRequest: () => { if (requests >= BUDGET) fail(429, "The exploration provider budget was reached."); requests++; }, onCache: () => { cacheHits++; } });
    } catch (error) { warnings.push(`${label}: ${error?.code === "provider_timeout" ? "provider deadline exceeded" : error?.status === 429 ? "provider rate limit reached" : "provider unavailable"}; existing research is unchanged.`); return null; }
  }
  function collect(data, relation = null) {
    if (!data) return [];
    const source = rows(data), found = source.map(openalexItem).filter(usable); openalexSucceeded = true; providers.add("OpenAlex");
    if (Number(data.meta?.count) > source.length) truncated = true;
    for (const work of found) { if (relation) work._relations = [relation]; candidates.push(work); }
    return found;
  }
  async function crossrefFallback(query, exact = false) {
    const url = exact ? new URL(`https://api.crossref.org/works/${encodeURIComponent(query)}`) : new URL("https://api.crossref.org/works");
    if (!exact) { url.searchParams.set("query.bibliographic", query.slice(0, 300)); url.searchParams.set("query.title", query.slice(0, 300)); url.searchParams.set("rows", String(Math.min(40, limit * 2))); }
    const data = await lookup(url, "Crossref fallback"); if (!data) return [];
    const list = exact ? (data.message ? [data.message] : []) : (Array.isArray(data.message?.items) ? data.message.items.slice(0, 40) : []), found = list.map(crossrefItem).filter(usable).filter(researchItem); if (found.length) providers.add("Crossref"); candidates.push(...found); return found;
  }
  try {
    if (seedId) {
      const url = new URL(`https://api.openalex.org/works/${seedId.split("/").at(-1)}`); url.searchParams.set("select", SELECT);
      const data = await lookup(url, "Seed lookup");
      if (data) { const item = openalexItem(data); if (item.id === seedId && usable(item)) { seed = item; providers.add("OpenAlex"); openalexSucceeded = true; } }
    } else if (doiSeed) {
      const data = await lookup(workUrl({ filter: `doi:${seedDoi}`, "per-page": 5 }), "Seed DOI lookup"), found = collect(data).filter(item => canonicalDoi(item.doi) === seedDoi);
      if (found.length === 1) seed = found[0];
      else if (!found.length) { const exact = await crossrefFallback(seedDoi, true); if (exact.length === 1 && canonicalDoi(exact[0].doi) === seedDoi) seed = exact[0]; }
      else warnings.push("The DOI matched several OpenAlex work IDs. Select a specific work to expand; no seed was assumed.");
    } else if (rawSeed) {
      const data = await lookup(workUrl({ search: rawSeed.slice(0, 300), "per-page": 8 }), "Seed title lookup"), found = collect(data), exact = found.filter(item => normalizedTitle(item.title) === normalizedTitle(rawSeed));
      if (exact.length === 1) seed = exact[0];
      else warnings.push("The seed title did not identify one exact indexed work. Choose a returned work before expanding its citation neighborhood.");
      if (!found.length) await crossrefFallback(rawSeed);
    }
    if (rawSeed && !seed) warnings.push("The requested seed could not be resolved unambiguously. No placeholder or inferred original paper was created.");
    if (seed?.is_retracted) warnings.push("The seed is marked retracted by OpenAlex. It remains visible as the explicit seed; recommendations exclude works marked retracted.");
    if (seed?.openalex_id) {
      const shortId = seed.openalex_id.split("/").at(-1), refs = seed.references.map(value => canonicalOpenAlexId(value)).filter(Boolean), related = (seed.related_ids || []).map(value => canonicalOpenAlexId(value)).filter(Boolean), batch = [...new Set([...refs.slice(0, 25), ...related.slice(0, 15)])].slice(0, 40), topics = seed.topic_ids.slice(0, 2).map(value => value.split("/").at(-1));
      if (refs.length > 25 || related.length > 15) truncated = true;
      const jobs = [];
      if (batch.length) jobs.push(lookup(workUrl({ filter: `openalex:${batch.map(id => id.split("/").at(-1)).join("|")}`, "per-page": 40 }), "Reference/related work metadata").then(data => collect(data)));
      const citingUrl = workUrl({ filter: `cites:${shortId}`, "per-page": 40 });
      jobs.push(lookup(citingUrl, "Citing works").then(data => { if (data) citedLookupSucceeded = true; return collect(data, { kind: "cites", target: seed.id, url: citingUrl.toString() }); }));
      if (refs.length) jobs.push(lookup(workUrl({ filter: `cites:${refs.slice(0, 6).map(id => id.split("/").at(-1)).join("|")}`, "per-page": 40 }), "Shared-reference candidates").then(data => collect(data)));
      if (topics.length) jobs.push(lookup(workUrl({ filter: `topics.id:${topics.join("|")}`, "per-page": 40 }), "Topic neighbors").then(data => collect(data)));
      jobs.push(lookup(workUrl({ search: q || seed.title.slice(0, 300), "per-page": 40 }), "Text neighbors").then(data => collect(data)));
      await Promise.all(jobs);
    } else if (!rawSeed || q || seed) {
      const query = q || seed?.title || rawSeed, data = await lookup(workUrl({ search: query.slice(0, 300), "per-page": 40 }), "Topic starter search"); collect(data);
    }
    if (!candidates.some(work => !seed || work.id !== seed.id)) await crossrefFallback(q || seed?.title || (doiSeed ? seedDoi : rawSeed));
    if (!openalexSucceeded && !providers.has("Crossref")) fail(503, "Scholarly providers are unavailable. Retry later; your saved research has been preserved.", "exploration_unavailable");
    if (!seed?.openalex_id) warnings.push("No resolved OpenAlex seed is available. Citation-neighborhood expansion and shared-reference retrieval are unavailable; starter results use actual provider metadata only.");
    if (providers.has("Crossref")) warnings.push("Crossref fallback has DOI-only reference coverage, no OpenAlex topic IDs, and no citing-work expansion. Missing evidence remains unavailable.");
    const ranked = rankExploration({ candidates: candidates.slice(0, 240), seed, q: q || (!seed ? rawSeed : ""), mode, limit });
    if (candidates.length > MAX_CANDIDATES) truncated = true;
    const citationGraph = seed?.openalex_id && citedLookupSucceeded && seed.evidence.references !== "missing" ? "available" : openalexSucceeded ? "partial" : "unavailable";
    return { items: ranked.items, seed: ranked.seed, q, mode, warnings: [...new Set(warnings)], retrieved_at: now(), graph: ranked.graph, coverage: { requests, lookups, cache_hits: cacheHits, budget: BUDGET, candidate_count: ranked.candidate_count, returned_count: ranked.items.length, citation_graph: citationGraph, providers: [...providers].sort(), truncated: truncated || ranked.truncated, bounded_paging: "First provider page only; no background crawling or automatic pagination." }, ranking: ranked.ranking };
  } finally { clearTimeout(timer); }
}
