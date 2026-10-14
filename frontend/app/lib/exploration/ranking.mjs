/** Deterministic retrieval ranking. No model, h-index, or scientific-quality score.
 * MMR: Carbonell & Goldstein, SIGIR 1998, doi:10.1145/290941.291025.
 * Citation direction always comes from provider reference/query evidence.
 */
const STOP = new Set("a an and are as at be been by for from in into is it its of on or that the their this to using was were with we our study studies paper results method methods analysis based new via".split(" "));
const MODES = {
  balanced: { text_similarity: .28, topic_overlap: .18, shared_reference_similarity: .24, direct_relationship: .20, recency: .07, citation_context: .03 },
  foundations: { text_similarity: .20, topic_overlap: .10, shared_reference_similarity: .16, direct_relationship: .28, recency: .02, citation_context: .04, foundation_context: .20 },
  recent: { text_similarity: .28, topic_overlap: .18, shared_reference_similarity: .12, direct_relationship: .12, recency: .27, citation_context: .03 },
  bridges: { text_similarity: .25, topic_overlap: .15, shared_reference_similarity: .35, direct_relationship: .07, recency: .08, citation_context: .02, bridge_context: .08 },
};
const LAMBDA = { balanced: .80, foundations: .88, recent: .82, bridges: .65 };
const clamp = n => Math.max(0, Math.min(1, n));
const round = n => Math.round(n * 1000000) / 1000000;
const strings = v => Array.isArray(v) ? [...new Set(v.filter(x => typeof x === "string" && x))] : [];
const oa = v => { const m = String(v || "").match(/^(?:https:\/\/openalex\.org\/)?(W\d+)$/i); return m ? `https://openalex.org/${m[1].toUpperCase()}` : ""; };
const doi = v => String(v || "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim().toLowerCase();
const validDoi = v => /^10\.\d{4,9}\/\S+$/i.test(v);
const identity = v => oa(v) || (validDoi(doi(v)) ? `https://doi.org/${doi(v)}` : String(v || ""));
export function tokenize(value) { return (String(value || "").normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(t => t.length > 1 && !STOP.has(t)).slice(0, 1800); }
export function normalizedTitle(value) { return String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
function normalizeWork(value) {
  const openalex_id = oa(value.openalex_id || value.id), canonicalDoi = doi(value.doi);
  return { ...value, id: openalex_id || (validDoi(canonicalDoi) ? `https://doi.org/${canonicalDoi}` : identity(value.id)), ...(openalex_id ? { openalex_id } : {}), title: String(value.title || "Untitled"), doi: canonicalDoi, authors: strings(value.authors), abstract: String(value.abstract || ""), year: String(value.year || ""), url: value.url || openalex_id || (canonicalDoi ? `https://doi.org/${canonicalDoi}` : ""), pdf_url: value.pdf_url || "", source: value.source || "", references: strings(strings(value.references).map(identity)).slice(0, 1500), topic_ids: strings(value.topic_ids).slice(0, 100), topics: strings(value.topics).slice(0, 100), providers: strings(value.providers || [value.source]), evidence: { references: Array.isArray(value.references) ? "available" : "missing", topic_ids: value.topic_ids?.length ? "available" : "missing", abstract: value.abstract ? "available" : "missing", publication_year: value.year ? "available" : "missing", citation_count: Number.isFinite(value.citation_count) && value.citation_count >= 0 ? "available" : "missing", ...(value.evidence || {}) }, citation_count: Number.isFinite(value.citation_count) && value.citation_count >= 0 ? value.citation_count : null, cited_by_count: Number.isFinite(value.cited_by_count) && value.cited_by_count >= 0 ? value.cited_by_count : null };
}
export function deduplicateWorks(input) {
  const records = [], ids = new Map(), dois = new Map();
  for (const raw of input.slice(0, 240)) {
    if (!raw || typeof raw !== "object") continue;
    const work = normalizeWork(raw); if (!work.id || !work.title) continue;
    const found = ids.get(work.id) ?? (validDoi(work.doi) ? dois.get(work.doi) : undefined);
    if (found === undefined) { const i = records.length; records.push(work); ids.set(work.id, i); if (validDoi(work.doi)) dois.set(work.doi, i); continue; }
    const old = records[found], preferNew = (!!work.openalex_id && !old.openalex_id) || (work.source === old.source && work.abstract.length > old.abstract.length);
    const preferred = preferNew ? work : old, other = preferNew ? old : work;
    // Counts are never added and distinct providers' incomplete reference lists
    // are never mixed into a fabricated complete bibliography.
    const merged = { ...other, ...preferred, providers: strings([...old.providers, ...work.providers]), abstract: preferred.abstract || other.abstract, _relations: [...(old._relations || []), ...(work._relations || [])] };
    merged.evidence = { ...preferred.evidence, abstract: merged.abstract ? "available" : "missing" };
    records[found] = merged; ids.set(old.id, found); ids.set(work.id, found); if (validDoi(work.doi)) dois.set(work.doi, found);
  }
  return records;
}
const intersection = (a, b) => { const set = new Set(b); return a.filter(x => set.has(x)); };
export function sharedReferenceSimilarity(a, b) { const left = strings(strings(a.references).map(identity)), right = strings(strings(b.references).map(identity)), shared = intersection(left, right); return { score: left.length && right.length ? shared.length / Math.sqrt(left.length * right.length) : 0, ids: shared }; }
const topicSimilarity = (a, b) => { const left = strings(a.topic_ids), right = strings(b.topic_ids), shared = intersection(left, right); return { score: left.length && right.length ? shared.length / new Set([...left, ...right]).size : 0, ids: shared }; };
function vectors(works) {
  const counts = works.map(w => { const map = new Map(); for (const [content, weight] of [[w.title, 2.5], [String(w.abstract || "").slice(0, 5000), 1], [strings(w.keywords).join(" "), 2], [(w.topics || []).join(" "), 1]]) for (const token of tokenize(content)) map.set(token, (map.get(token) || 0) + weight); return map; });
  const df = new Map(); for (const map of counts) for (const token of map.keys()) df.set(token, (df.get(token) || 0) + 1);
  return counts.map(map => { let sum = 0; const out = new Map(); for (const [token, tf] of map) { const score = (1 + Math.log(tf)) * (Math.log((1 + works.length) / (1 + df.get(token))) + 1); out.set(token, score); sum += score * score; } const norm = Math.sqrt(sum); if (norm) for (const [token, value] of out) out.set(token, value / norm); return out; });
}
function cosine(a, b) { let result = 0; for (const [key, value] of a) result += value * (b.get(key) || 0); return clamp(result); }
const aliases = work => new Set([identity(work.id), oa(work.openalex_id), validDoi(work.doi) ? `https://doi.org/${doi(work.doi)}` : ""].filter(Boolean));
function citationEvidence(citing, cited) {
  const ids = aliases(cited); if (citing.references.some(id => ids.has(identity(id)))) return { provider: citing.source || "Provider", url: citing.openalex_id ? `https://api.openalex.org/works/${citing.openalex_id.split("/").at(-1)}` : citing.doi ? `https://api.crossref.org/works/${encodeURIComponent(citing.doi)}` : cited.url, method: "provider reference list (citing → cited)" };
  const proof = (citing._relations || []).find(r => r.kind === "cites" && ids.has(identity(r.target)));
  return proof ? { provider: proof.provider || citing.source || "Provider", url: proof.url, method: "provider cites filter (citing → cited)" } : null;
}
function relationship(candidate, seed) { if (!seed) return []; const out = []; if (citationEvidence(seed, candidate)) out.push("seed_cites_work"); if (citationEvidence(candidate, seed)) out.push("work_cites_seed"); return out; }
const yearOf = work => /^\d{4}$/.test(work.year) && Number(work.year) > 1400 ? Number(work.year) : null;
const publicWork = work => { const result = { ...work }; delete result._relations; delete result.related_ids; delete result.is_paratext; return result; };
export function rankExploration({ candidates = [], seed: rawSeed = null, q = "", mode = "balanced", limit = 20, currentYear = new Date().getUTCFullYear() } = {}) {
  if (!MODES[mode]) throw new Error("Unsupported exploration mode.");
  const seed = rawSeed ? normalizeWork(rawSeed) : null, seedAliases = seed ? aliases(seed) : new Set();
  const works = deduplicateWorks([...candidates].sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")))).filter(w => !w.is_retracted && !w.is_paratext && ![...aliases(w)].some(id => seedAliases.has(id)));
  const overCandidateLimit = works.length > 180;
  if (overCandidateLimit) { const queryTokens = new Set(tokenize(seed?.title || q)); const priority = w => (relationship(w, seed).length ? 3 : 0) + (seed ? sharedReferenceSimilarity(w, seed).score + topicSimilarity(w, seed).score : 0) + tokenize(w.title).filter(token => queryTokens.has(token)).length / Math.max(1, queryTokens.size); works.sort((a, b) => priority(b) - priority(a) || a.id.localeCompare(b.id)); works.length = 180; }
  const query = seed || normalizeWork({ id: "query", title: q, references: [], topic_ids: [], source: "Query", evidence: { references: "missing", topic_ids: "missing" } });
  const all = [query, ...works], vecs = vectors(all), byId = new Map(works.map((w, i) => [w.id, i + 1])), weights = MODES[mode];
  const scored = works.map((work, index) => {
    const refs = sharedReferenceSimilarity(work, query), topics = topicSimilarity(work, query), relations = relationship(work, seed), year = yearOf(work), seedYear = seed && yearOf(seed), citation = work.citation_count;
    const values = { text_similarity: cosine(vecs[0], vecs[index + 1]), topic_overlap: topics.score, shared_reference_similarity: refs.score, direct_relationship: relations.length ? 1 : 0, recency: year && year <= currentYear + 1 ? Math.exp(-Math.max(0, currentYear - year) / 5) : 0, citation_context: citation === null ? 0 : Math.min(1, Math.log1p(citation) / Math.log1p(500)), foundation_context: relations.includes("seed_cites_work") && year && seedYear && year <= seedYear ? clamp((seedYear - year + 1) / 20) : 0, bridge_context: refs.score > 0 && topics.ids.length === 0 && work.topic_ids.length && query.topic_ids.length ? refs.score : 0 };
    const available = { text_similarity: !!tokenize(query.title + " " + query.abstract).length, topic_overlap: !!(work.topic_ids.length && query.topic_ids.length), shared_reference_similarity: work.evidence.references !== "missing" && query.evidence.references !== "missing" && !!seed, direct_relationship: !!seed && (relations.length > 0 || work.evidence.references !== "missing" && query.evidence.references !== "missing"), recency: !!year && year <= currentYear + 1, citation_context: citation !== null, foundation_context: !!(seedYear && year) && !!seed, bridge_context: !!(work.topic_ids.length && query.topic_ids.length) && !!seed && work.evidence.references !== "missing" && query.evidence.references !== "missing" };
    let total = 0, denominator = 0; for (const [key, weight] of Object.entries(weights)) if (available[key]) { total += values[key] * weight; denominator += weight; }
    const reasons = [];
    if (relations.includes("seed_cites_work")) reasons.push({ kind: "seed_cites_work", text: "The seed's provider bibliography includes this work.", provider: seed.source, source_ids: [seed.id] });
    if (relations.includes("work_cites_seed")) reasons.push({ kind: "work_cites_seed", text: "The provider indexes a citation from this work to the seed.", provider: work.source, source_ids: [seed.id] });
    if (refs.ids.length) reasons.push({ kind: "shared_references", text: `${refs.ids.length} indexed references shared with the seed; cosine-normalized bibliographic coupling.`, provider: work.source, evidence_count: refs.ids.length, source_ids: refs.ids });
    if (topics.ids.length) reasons.push({ kind: "shared_topics", text: `${topics.ids.length} shared provider-classified topic IDs.`, provider: "OpenAlex", evidence_count: topics.ids.length, source_ids: topics.ids });
    if (values.text_similarity > .01) reasons.push({ kind: "text_similarity", text: "Token-based TF-IDF similarity of title, available abstract, keywords and topic names; not semantic or causal evidence.", provider: "Labvium deterministic ranking" });
    if (available.recency && (mode === "recent" || currentYear - year <= 2)) reasons.push({ kind: "recency", text: `Publication year ${year}; recent mode increases this component.`, provider: work.source });
    if (citation !== null) reasons.push({ kind: "citation_context", text: `Provider indexes ${citation} citations. This component is log-scaled, capped at 500 citations and has at most 4% configured weight; it is not a quality judgment.`, provider: work.source, evidence_count: Math.min(Number.MAX_SAFE_INTEGER, Math.floor(citation)) });
    const missing = Object.entries(work.evidence).filter(([, v]) => v === "missing").map(([k]) => k); if (missing.length) reasons.push({ kind: "missing_evidence", text: `Unavailable metadata: ${missing.join(", ")}. Missing evidence is not fabricated.`, provider: work.source });
    return { work, values, relevance: denominator ? total / denominator : 0, relations, refs, reasons };
  });
  const selected = [], remaining = [...scored], lambda = LAMBDA[mode];
  while (remaining.length && selected.length < Math.min(40, Math.max(1, limit))) {
    for (const candidate of remaining) { let redundancy = 0; for (const prior of selected) redundancy = Math.max(redundancy, .6 * cosine(vecs[byId.get(candidate.work.id)], vecs[byId.get(prior.work.id)]) + .2 * topicSimilarity(candidate.work, prior.work).score + .2 * sharedReferenceSimilarity(candidate.work, prior.work).score); candidate.penalty = (1 - lambda) / lambda * redundancy; candidate.gain = candidate.relevance - candidate.penalty; }
    remaining.sort((a, b) => b.gain - a.gain || b.relevance - a.relevance || a.work.id.localeCompare(b.work.id)); selected.push(remaining.shift());
  }
  const items = selected.map(entry => ({ ...publicWork(entry.work), score: round(clamp(entry.gain)), rank_components: { ...Object.fromEntries(Object.entries(entry.values).map(([key, value]) => [key, round(value)])), relevance_before_diversity: round(entry.relevance), diversity_penalty: round(entry.penalty) }, reasons: [...entry.reasons, { kind: "diversity", text: `MMR diversity reranking (lambda ${lambda}) reduces repeated metadata and reference neighborhoods. Score describes retrieval, not scientific quality.`, provider: "Labvium deterministic ranking" }], relation_to_seed: entry.relations, shared_reference_ids: entry.refs.ids }));
  const graphWorks = [...(seed ? [seed] : []), ...selected.map(e => e.work)], graphVecs = vectors(graphWorks), edges = [];
  for (let i = 0; i < graphWorks.length; i++) for (let j = i + 1; j < graphWorks.length; j++) {
    const a = graphWorks[i], b = graphWorks[j], ab = citationEvidence(a, b), ba = citationEvidence(b, a), refs = sharedReferenceSimilarity(a, b), topics = topicSimilarity(a, b), similarity = cosine(graphVecs[i], graphVecs[j]);
    if (ab) edges.push({ source: a.id, target: b.id, kind: "cites", directed: true, evidence: ab });
    if (ba) edges.push({ source: b.id, target: a.id, kind: "cites", directed: true, evidence: ba });
    if (refs.ids.length) edges.push({ source: a.id, target: b.id, kind: "shares_references", directed: false, evidence: { provider: [...new Set([...a.providers, ...b.providers])].join(" + "), shared_reference_ids: refs.ids, score: round(refs.score), method: "intersection / sqrt(reference_count_a × reference_count_b); bibliographic coupling, not a citation between these works" } });
    if (topics.ids.length) edges.push({ source: a.id, target: b.id, kind: "shares_topics", directed: false, evidence: { provider: "OpenAlex", topic_ids: topics.ids, score: round(topics.score), method: "Jaccard overlap of provider-classified topic IDs; not a citation" } });
    if (!refs.ids.length && !topics.ids.length && similarity >= .35) edges.push({ source: a.id, target: b.id, kind: "text_similarity", directed: false, evidence: { provider: "Labvium deterministic ranking", score: round(similarity), method: "TF-IDF cosine of available metadata; not a citation or validated scientific relationship" } });
  }
  const order = { cites: 0, shares_references: 1, shares_topics: 2, text_similarity: 3 }; edges.sort((a, b) => order[a.kind] - order[b.kind] || a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  return { items, seed: seed ? { ...publicWork(seed), reasons: [], relation_to_seed: [], shared_reference_ids: [] } : null, graph: { nodes: graphWorks.map(w => ({ id: w.id, title: w.title, doi: w.doi, url: w.url, year: w.year, is_seed: !!seed && w.id === seed.id })), edges: edges.slice(0, 160) }, candidate_count: works.length, truncated: overCandidateLimit || works.length > items.length || edges.length > 160, ranking: { method: "TF-IDF + indexed citation/reference/topic evidence + MMR", mode, weights: { ...weights }, mmr_lambda: lambda, missing_evidence: "Available components are renormalized; missing metadata is unknown, not zero evidence of quality." } };
}
