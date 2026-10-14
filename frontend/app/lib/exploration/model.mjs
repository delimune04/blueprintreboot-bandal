/** Project-owned exploration records. Scores describe retrieval, never truth. */
export const EXPLORATION_LIMITS = { works: 500, edges: 3000, path: 1000, bytes: 6 * 1024 * 1024 };
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function fail(message, status = 422) { const error = new Error(message); error.status = status; throw error; }
function text(v, max = 1000, required = false) { if (typeof v !== "string" || v.length > max || v.includes("\0") || (required && !v.trim())) fail("Invalid exploration text."); return v; }
function array(v, max) { if (!Array.isArray(v) || v.length > max) fail("Exploration collection exceeds its limit."); return v; }
const strings = (v, max = 100, length = 300) => array(v || [], max).map((s) => text(s, length, true));
function url(v) { if (!v) return ""; text(v, 2048); let parsed; try { parsed = new URL(v); } catch { fail("Invalid research URL."); } if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) fail("Research links must use HTTP(S)."); return v; }
const finite = (v) => typeof v === "number" && Number.isFinite(v);
export function emptyExploration(topic = "") { return { version: 1, topic, works: [], edges: [], path: [], saved_ids: [], dismissed_ids: [], queue: [], updated_at: "" }; }
export function validateExplorationWork(value) {
  if (!object(value)) fail("Invalid exploration Paper.");
  const work = { id: text(value.id, 500, true), title: text(value.title, 2000, true), authors: strings(value.authors, 100, 500), year: text(String(value.year || ""), 10), doi: text(value.doi || "", 2048), abstract: text(value.abstract || "", 30000), url: url(value.url), pdf_url: url(value.pdf_url), source: text(value.source || "", 100), references: strings(value.references, 1500, 300), topic_ids: strings(value.topic_ids, 100), topics: strings(value.topics, 100, 500), providers: strings(value.providers || (value.source ? [value.source] : []), 10, 100) };
  for (const key of ["openalex_id", "journal", "retrieved_at", "updated_at", "updated_date"]) if (value[key] != null) work[key] = text(value[key], key === "journal" ? 1000 : 300);
  for (const key of ["is_retracted", "is_paratext"]) if (value[key] !== undefined) { if (typeof value[key] !== "boolean") fail("Invalid scholarly status flag."); work[key] = value[key]; }
  for (const key of ["citation_count", "cited_by_count", "score"]) if (value[key] != null) { if (!finite(value[key]) || value[key] < 0) fail("Invalid exploration metric."); work[key] = value[key]; } else if (key !== "score") work[key] = null;
  if (value.rank_components) { if (!object(value.rank_components)) fail("Invalid ranking details."); work.rank_components = Object.fromEntries(Object.entries(value.rank_components).map(([key, v]) => { text(key, 100, true); if (!finite(v)) fail("Invalid ranking component."); return [key, v]; })); }
  if (value.evidence) { if (!object(value.evidence)) fail("Invalid evidence availability."); work.evidence = Object.fromEntries(Object.entries(value.evidence).map(([key, v]) => [text(key, 100, true), text(v, 100)])); }
  work.reasons = array(value.reasons || [], 20).map((reason) => { if (!object(reason)) fail("Invalid recommendation reason."); const result = { kind: text(reason.kind, 100, true), text: text(reason.text || "", 2000), provider: text(reason.provider || "", 100) }; if (reason.evidence_count != null) { if (!Number.isSafeInteger(reason.evidence_count) || reason.evidence_count < 0) fail("Invalid evidence count."); result.evidence_count = reason.evidence_count; } if (reason.source_ids) result.source_ids = strings(reason.source_ids, 1500); return result; });
  work.relation_to_seed = strings(value.relation_to_seed, 20, 100);
  work.shared_reference_ids = strings(value.shared_reference_ids, 1500);
  return work;
}
export function validateExplorationEdge(value) {
  if (!object(value) || !["cites", "shares_references", "shares_topics", "text_similarity"].includes(value.kind) || typeof value.directed !== "boolean") fail("Invalid research relationship.");
  if (value.directed !== (value.kind === "cites")) fail("Only citation links have a direction.");
  const evidence = value.evidence || {}; if (!object(evidence)) fail("Invalid relationship evidence.");
  const result = { source: text(value.source, 500, true), target: text(value.target, 500, true), kind: value.kind, directed: value.directed, evidence: { provider: text(evidence.provider || "", 100) } };
  if (result.source === result.target) fail("Self relationships are not supported.");
  if (evidence.url) result.evidence.url = url(evidence.url);
  if (evidence.method) result.evidence.method = text(evidence.method, 500);
  if (evidence.shared_reference_ids) result.evidence.shared_reference_ids = strings(evidence.shared_reference_ids, 1500);
  if (evidence.topic_ids) result.evidence.topic_ids = strings(evidence.topic_ids, 100);
  if (evidence.score != null) { if (!finite(evidence.score)) fail("Invalid similarity score."); result.evidence.score = evidence.score; }
  return result;
}
const edgeKey = (edge) => `${edge.kind}:${edge.directed ? edge.source : [edge.source, edge.target].sort()[0]}:${edge.directed ? edge.target : [edge.source, edge.target].sort()[1]}`;
function preserveKnownMetadata(previous, incoming, stable) {
  if (!previous) return { ...incoming, id: stable };
  const preferPrevious = Boolean(previous.openalex_id) && !incoming.openalex_id;
  const preferred = preferPrevious ? previous : incoming, other = preferPrevious ? incoming : previous;
  const merged = { ...other, ...preferred, id: stable, providers: [...new Set([...previous.providers, ...incoming.providers])], reasons: incoming.reasons, relation_to_seed: incoming.relation_to_seed, shared_reference_ids: incoming.shared_reference_ids, rank_components: incoming.rank_components || {}, score: incoming.score };
  for (const field of ["title", "abstract", "doi", "openalex_id", "year", "journal", "url", "pdf_url", "retrieved_at", "updated_at"]) if (!merged[field] && other[field]) merged[field] = other[field];
  for (const field of ["authors", "references", "topics", "topic_ids"]) if (!preferred[field]?.length && other[field]?.length) merged[field] = other[field];
  for (const field of ["citation_count", "cited_by_count"]) if (preferred[field] == null) merged[field] = other[field] ?? null;
  merged.evidence = { ...(other.evidence || {}), ...(preferred.evidence || {}) };
  for (const [field, availability] of [["abstract", "abstract"], ["references", "references"], ["topic_ids", "topic_ids"], ["year", "publication_year"]]) if (merged[field]?.length && merged.evidence[availability] === "missing") merged.evidence[availability] = "available";
  return validateExplorationWork(merged);
}
export function validateExploration(value) {
  if (!object(value) || value.version !== 1) fail("Unsupported exploration version.");
  const result = { version: 1, topic: text(value.topic, 1000), works: array(value.works, EXPLORATION_LIMITS.works).map(validateExplorationWork), edges: array(value.edges, EXPLORATION_LIMITS.edges).map(validateExplorationEdge), path: strings(value.path, EXPLORATION_LIMITS.path, 500), saved_ids: strings(value.saved_ids, 500, 500), dismissed_ids: strings(value.dismissed_ids, 500, 500), queue: [], updated_at: text(value.updated_at || "", 100) };
  const ids = new Set(result.works.map((work) => work.id));
  if (ids.size !== result.works.length || new Set(result.edges.map(edgeKey)).size !== result.edges.length || result.edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target))) fail("Exploration identities or relationships are invalid.");
  for (const list of [result.path, result.saved_ids, result.dismissed_ids]) if (list.some((id) => !ids.has(id))) fail("Exploration state references a missing Paper.");
  for (const list of [result.saved_ids, result.dismissed_ids]) if (new Set(list).size !== list.length) fail("Duplicate saved research state.");
  result.queue = array(value.queue, 500).map((entry) => { if (!object(entry) || !ids.has(entry.work_id) || !["to_read", "reading", "read"].includes(entry.state)) fail("Invalid reading queue entry."); return { work_id: entry.work_id, state: entry.state, note: text(entry.note || "", 10000) }; });
  if (new Set(result.queue.map((entry) => entry.work_id)).size !== result.queue.length) fail("Duplicate reading queue entries.");
  if (new TextEncoder().encode(JSON.stringify(result)).length > EXPLORATION_LIMITS.bytes) fail("The exploration is too large. Export it before beginning another trail.");
  return result;
}
export function mergeExploration(current, response) {
  const existing = validateExploration(current), incoming = [...(response.seed ? [response.seed] : []), ...array(response.items || [], 100)].map(validateExplorationWork);
  // Preserve all existing nodes, including saved papers and the exploration path.
  const works = new Map(existing.works.map((work) => [work.id, work])); let truncated = false;
  const doiKey = (work) => work.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim().toLowerCase();
  const doiIds = new Map(existing.works.filter((work) => doiKey(work)).map((work) => [doiKey(work), work.id]));
  const aliases = new Map();
  for (const work of incoming) {
    const stable = works.has(work.id) ? work.id : doiIds.get(doiKey(work)) || work.id;
    aliases.set(work.id, stable);
    if (works.has(stable) || works.size < EXPLORATION_LIMITS.works) { works.set(stable, preserveKnownMetadata(works.get(stable), work, stable)); if (doiKey(work)) doiIds.set(doiKey(work), stable); } else truncated = true;
  }
  const edges = new Map(existing.edges.map((edge) => [edgeKey(edge), edge]));
  for (const raw of response.graph?.edges || []) { const edge = validateExplorationEdge(raw); edge.source = aliases.get(edge.source) || edge.source; edge.target = aliases.get(edge.target) || edge.target; if (edge.source === edge.target) continue; if (!works.has(edge.source) || !works.has(edge.target)) { truncated = true; continue; } if (edges.has(edgeKey(edge)) || edges.size < EXPLORATION_LIMITS.edges) edges.set(edgeKey(edge), edge); else truncated = true; }
  return { exploration: validateExploration({ ...existing, works: [...works.values()], edges: [...edges.values()], updated_at: new Date().toISOString() }), truncated };
}
export function explorationRevision(project) { const revision = project.researchTrailRev ?? 1; if (!Number.isSafeInteger(revision) || revision < 1) fail("The saved exploration revision is invalid.", 503); return revision.toString(16).padStart(64, "0"); }
function projectById(state, projectId) { const project = state.projects.find((row) => row.project_id === projectId); if (!project) fail("Project not found.", 404); return project; }
export function getProjectExplorationState(state, projectId) { const project = projectById(state, projectId); return { project_id: projectId, exploration: project.researchTrail === undefined ? emptyExploration(project.name) : validateExploration(project.researchTrail), revision: explorationRevision(project) }; }
export function saveProjectExplorationState(state, projectId, body) {
  const project = projectById(state, projectId); if (project.status === "archived") fail("Unarchive this project before editing its research trail.", 409);
  if (!object(body) || Object.keys(body).some((key) => !["exploration", "expected_revision"].includes(key))) fail("Unknown exploration command fields.");
  if (body.expected_revision !== explorationRevision(project)) fail("The research trail changed. Reload before saving your draft.", 409);
  const exploration = validateExploration(body.exploration);
  if (JSON.stringify(project.researchTrail) !== JSON.stringify(exploration)) { project.researchTrail = exploration; project.researchTrailRev = (project.researchTrailRev ?? 1) + 1; project.updated_at = new Date().toISOString(); }
  return getProjectExplorationState(state, projectId);
}
