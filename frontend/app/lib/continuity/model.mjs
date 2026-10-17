import { getReviewDossier } from "../review/model.mjs";

const RUN_FIELDS = ["id", "title", "paper_ids", "review_row_ids", "dataset", "data_version", "data_url", "data_sha256", "repository_url", "commit_sha", "environment", "procedure", "result", "artifact_url", "status", "created_at", "updated_at"];
const SIGNAL_FIELDS = ["id", "paper_id", "kind", "source", "url", "summary", "observed_at", "status", "resolution", "resolved_at", "resolved_by"];
function fail(message, status = 422) { const e = new Error(message); e.status = status; throw e; }
function object(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function keys(v, allowed) { if (!object(v) || Object.keys(v).some(k => !allowed.includes(k))) fail("Unknown research continuity fields."); }
function text(v, max = 4000, required = false) { if (typeof v !== "string" || v.length > max || v.includes("\0") || (required && !v.trim())) fail("A research continuity field is missing or too large."); return v; }
function id(v) { if (typeof v !== "string" || !/^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,199}$/u.test(v)) fail("Invalid research record identity."); return v; }
function list(v, max = 100) { if (!Array.isArray(v) || v.length > max) fail("Too many linked records."); const result = v.map(id); if (new Set(result).size !== result.length) fail("Duplicate linked record."); return result; }
function choice(v, values) { if (!values.includes(v)) fail("Unsupported research record state."); return v; }
function time(v, empty = false) { text(v, 50, !empty); if (v && (!/^\d{4}-\d\d-\d\dT/.test(v) || !Number.isFinite(Date.parse(v)))) fail("Invalid record date."); return v; }
function url(v) { text(v, 2048); if (v) { let parsed; try { parsed = new URL(v); } catch { fail("Enter a complete HTTPS or HTTP link."); } if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) fail("Only public web links without embedded credentials are supported."); } return v; }
export function blankRun() { return { id: `run-${crypto.randomUUID()}`, title: "", paper_ids: [], review_row_ids: [], dataset: "", data_version: "", data_url: "", data_sha256: "", repository_url: "", commit_sha: "", environment: "", procedure: "", result: "", artifact_url: "", status: "planned", created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; }
export function blankContinuity() { return { schema_version: 1, runs: [], signals: [], checked_at: "", checks: [] }; }
export function validateRun(v) {
  keys(v, RUN_FIELDS);
  const result = { id: id(v.id), title: text(v.title, 300, true), paper_ids: list(v.paper_ids), review_row_ids: list(v.review_row_ids), dataset: text(v.dataset, 500), data_version: text(v.data_version, 300), data_url: url(v.data_url), data_sha256: text(v.data_sha256, 64), repository_url: url(v.repository_url), commit_sha: text(v.commit_sha, 64), environment: text(v.environment, 5000), procedure: text(v.procedure, 10000), result: text(v.result, 10000), artifact_url: url(v.artifact_url), status: choice(v.status, ["planned", "running", "completed", "failed"]), created_at: time(v.created_at), updated_at: time(v.updated_at) };
  if (result.data_sha256 && !/^[a-f0-9]{64}$/i.test(result.data_sha256)) fail("SHA-256 must contain 64 hexadecimal characters.");
  if (result.commit_sha && !/^[a-f0-9]{7,64}$/i.test(result.commit_sha)) fail("Record a Git commit hash (7-64 hexadecimal characters).");
  return result;
}
export function validateSignal(v) {
  keys(v, SIGNAL_FIELDS);
  return { id: id(v.id), paper_id: id(v.paper_id), kind: choice(v.kind, ["retraction", "correction", "contradictory", "other"]), source: choice(v.source, ["manual", "OpenAlex", "Crossref"]), url: url(v.url), summary: text(v.summary, 4000, true), observed_at: time(v.observed_at), status: choice(v.status, ["open", "reviewed"]), resolution: text(v.resolution, 4000), resolved_at: time(v.resolved_at, true), resolved_by: text(v.resolved_by, 300) };
}
export function validateContinuity(v) {
  keys(v, ["schema_version", "runs", "signals", "checked_at", "checks"]);
  if (v.schema_version !== 1 || !Array.isArray(v.runs) || v.runs.length > 100 || !Array.isArray(v.signals) || v.signals.length > 200 || !Array.isArray(v.checks) || v.checks.length > 20) fail("Research history limit reached. Existing records were preserved.");
  const runs = v.runs.map(validateRun), signals = v.signals.map(validateSignal);
  if (new Set(runs.map(r => r.id)).size !== runs.length || new Set(signals.map(r => r.id)).size !== signals.length) fail("Duplicate research record identity.");
  const checks = v.checks.map(v => { keys(v, ["paper_id", "title", "status", "message", "checked_at"]); return { paper_id: id(v.paper_id), title: text(v.title, 1000), status: choice(v.status, ["checked", "unavailable", "no_doi"]), message: text(v.message, 2000), checked_at: time(v.checked_at) }; });
  return { schema_version: 1, runs, signals, checked_at: time(v.checked_at, true), checks };
}
export function getContinuity(project) { return project.continuity === undefined ? blankContinuity() : validateContinuity(project.continuity); }
export function continuityRevision(project) { const n = project.continuityRev ?? 1; if (!Number.isSafeInteger(n) || n < 1 || n >= Number.MAX_SAFE_INTEGER) fail("Research continuity revision is invalid.", 503); return n.toString(16).padStart(64, "0"); }
export function affectedReviewRows(project, signals) {
  const rows = getReviewDossier(project).rows, open = signals.filter(s => s.status === "open"), marked = new Map();
  for (const row of rows) { const hits = open.filter(s => row.source_links.some(source => source.paper_id === s.paper_id)); if (hits.length) marked.set(row.id, new Set(hits.map(s => s.id))); }
  for (let iteration = 0; iteration < rows.length; iteration++) {
    let changed = false;
    for (const row of rows) {
      const linked = [...(row.context?.comparison_ids || []), row.context?.origin_decision_id].filter(Boolean);
      const hits = new Set([...(marked.get(row.id) || []), ...linked.flatMap(key => [...(marked.get(key) || [])])]);
      if (hits.size && hits.size !== marked.get(row.id)?.size) { marked.set(row.id, hits); changed = true; }
    }
    if (!changed) break;
  }
  return rows.filter(row => marked.has(row.id)).map(row => ({ row_id: row.id, kind: row.kind, text: row.text, signal_ids: [...marked.get(row.id)] }));
}
function linkedPapers(state, project) { const ids = new Set(project.links.map(l => l.paper_id)); return state.papers.filter(p => ids.has(p.paper_id)).map(p => ({ paper_id: p.paper_id, title: p.metadata.title, doi: p.metadata.doi })); }
export function continuityResponse(state, projectId) {
  const project = state.projects.find(p => p.project_id === projectId); if (!project) fail("Project not found.", 404);
  const dossier = getContinuity(project);
  return { project_id: projectId, project_name: project.name, project_status: project.status, revision: continuityRevision(project), dossier, papers: linkedPapers(state, project), review_rows: getReviewDossier(project).rows.map(({ id, kind, text }) => ({ id, kind, text })), affected_rows: affectedReviewRows(project, dossier.signals) };
}
/** Commands mutate only the caller's already authorized state. Persistence stays in the transport. */
export function continuityCommand(state, projectId, action, command, actor = "") {
  const project = state.projects.find(p => p.project_id === projectId); if (!project) fail("Project not found.", 404);
  if (project.status === "archived") fail("Restore this project before editing research history.", 409);
  if (typeof command.expected_revision !== "string" || !/^[a-f0-9]{64}$/.test(command.expected_revision)) fail("An expected research history revision is required.");
  if (command.expected_revision !== continuityRevision(project)) fail("Research history changed in another session. Reload before saving.", 409);
  const next = getContinuity(project), timestamp = new Date().toISOString();
  if (action === "run") {
    keys(command, ["expected_revision", "run"]); const run = validateRun(command.run);
    const allowedPapers = new Set(linkedPapers(state, project).map(p => p.paper_id)), reviewIds = new Set(getReviewDossier(project).rows.map(r => r.id));
    if (run.paper_ids.some(id => !allowedPapers.has(id)) || run.review_row_ids.some(id => !reviewIds.has(id))) fail("Link only papers and review records in this project.");
    const index = next.runs.findIndex(r => r.id === run.id);
    if (index < 0 && next.runs.length >= 100) fail("This project retains up to 100 reproduction records.");
    const saved = { ...run, created_at: index < 0 ? timestamp : next.runs[index].created_at, updated_at: timestamp };
    if (index < 0) next.runs.push(saved); else next.runs[index] = saved;
  } else if (action === "signal") {
    keys(command, ["expected_revision", "paper_id", "kind", "url", "summary"]);
    if (!linkedPapers(state, project).some(p => p.paper_id === command.paper_id)) fail("The paper must be linked to this project.");
    next.signals.push(validateSignal({ id: `signal-${crypto.randomUUID()}`, paper_id: command.paper_id, kind: command.kind, url: command.url, summary: command.summary, source: "manual", observed_at: timestamp, status: "open", resolution: "", resolved_at: "", resolved_by: "" }));
  } else if (action === "resolve") {
    keys(command, ["expected_revision", "signal_id", "resolution", "confirm"]); if (command.confirm !== true) fail("Confirm the review outcome.");
    const signal = next.signals.find(s => s.id === command.signal_id); if (!signal) fail("Change notice not found.", 404);
    signal.resolution = text(command.resolution, 4000, true); signal.status = "reviewed"; signal.resolved_at = timestamp; signal.resolved_by = text(actor, 300);
  } else fail("Unknown research history command.", 404);
  project.continuity = validateContinuity(next); project.continuityRev = (project.continuityRev || 1) + 1;
  return { status: "saved", ...continuityResponse(state, projectId) };
}
export function exportContinuity(data) {
  const safe = v => String(v).replace(/\r/g, "").replace(/^#/gm, "\\#");
  return [`# ${safe(data.project_name)}\n\nResearch continuity export\n`, ...data.dossier.runs.map(r => `## ${safe(r.title)}\n\n- Record: ${r.id}\n- Status: ${r.status}\n- Papers: ${r.paper_ids.join(", ")}\n- Review records: ${r.review_row_ids.join(", ")}\n- Dataset: ${safe(r.dataset)}\n- Version: ${safe(r.data_version)}\n- Data: ${r.data_url}\n- SHA-256: ${r.data_sha256}\n- Repository: ${r.repository_url}\n- Commit: ${r.commit_sha}\n- Environment: ${safe(r.environment)}\n\n### Procedure\n${safe(r.procedure)}\n\n### Result\n${safe(r.result)}\n\nArtifact: ${r.artifact_url}\nUpdated: ${r.updated_at}\n`), "## Evidence changes\n", ...data.dossier.signals.map(s => `- ${s.kind} / ${s.paper_id} / ${s.status}: ${safe(s.summary)}\n  - Source: ${s.source}; ${s.url}; ${s.observed_at}\n  - Review: ${safe(s.resolution)} (${safe(s.resolved_by)}; ${s.resolved_at})`)].join("\n");
}
