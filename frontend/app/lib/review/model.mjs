/** Project-scoped human review. A source link is traceability, never proof. */
export const REVIEW_KINDS = ["hypothesis", "decision", "failed_attempt", "question", "next_action"];
export const REVIEW_STAGES = ["comparison", "decision", "handoff"];
export const REVIEW_MAX_SNAPSHOTS = 20;
const MAX_DOSSIER_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const clone = (value) => structuredClone(value);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function fail(message, status = 422) { const error = new Error(message); error.status = status; throw error; }
function keys(value, allowed) { if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key))) fail("Unknown or invalid review fields."); }
function text(value, max, required = false) { if (typeof value !== "string" || value.length > max || value.includes("\0") || (required && !value.trim())) fail("A review text field is invalid or too large."); return value; }
function id(value, empty = false) { if (empty && value === "") return value; if (typeof value !== "string" || !/^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,159}$/u.test(value)) fail("Invalid review identity."); return value; }
function bytes(value) { return new TextEncoder().encode(JSON.stringify(value)).length; }
function hash(value) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("Invalid evidence fingerprint."); return value; }
function date(value) { text(value, 10); if (value) { const parsed = new Date(`${value}T00:00:00Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail("Use a valid due date."); } return value; }
function iso(value) { text(value, 40, true); if (!/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) fail("Invalid review time."); return value; }
export function blankReviewInput() { return { schema_version: 1, rows: [], checklist: Object.fromEntries(REVIEW_KINDS.map((kind) => [kind, false])) }; }
export function reviewInput(dossier) { return clone({ schema_version: 1, rows: dossier.rows, checklist: dossier.checklist }); }
export function newReviewRow(kind = "hypothesis") { return { id: `review-${crypto.randomUUID()}`, kind, text: "", owner: "", due_date: "", status: "open", provenance: "manual", source_links: [] }; }
export function newWorkflowRow(stage = "comparison") {
  if (!REVIEW_STAGES.includes(stage)) fail("Unsupported review workflow stage.");
  return { ...newReviewRow({ comparison: "hypothesis", decision: "decision", handoff: "next_action" }[stage]), context: { stage, method: "", conditions: "", metric: "", value: "", unit: "", availability: "not_reported", disposition: "pending", rationale: "", comparison_ids: [], completed: false, origin_decision_id: "" } };
}
function validateReviewContext(value) {
  keys(value, ["stage", "method", "conditions", "metric", "value", "unit", "availability", "disposition", "rationale", "comparison_ids", "completed", "origin_decision_id"]);
  if (!REVIEW_STAGES.includes(value.stage) || !["reported", "not_reported", "unavailable", "extraction_failed"].includes(value.availability) || !["pending", "adopted", "rejected", "deferred"].includes(value.disposition) || typeof value.completed !== "boolean" || !Array.isArray(value.comparison_ids) || value.comparison_ids.length > 100) fail("Invalid review workflow context.");
  const comparison_ids = value.comparison_ids.map((identity) => id(identity));
  if (new Set(comparison_ids).size !== comparison_ids.length) fail("Duplicate comparison reference.");
  const result = { stage: value.stage, method: text(value.method, 500), conditions: text(value.conditions, 2000), metric: text(value.metric, 200), value: text(value.value, 200), unit: text(value.unit, 100), availability: value.availability, disposition: value.disposition, rationale: text(value.rationale, 4000), comparison_ids, completed: value.completed, ...(Object.hasOwn(value, "origin_decision_id") ? { origin_decision_id: id(value.origin_decision_id, true) } : {}) };
  if (result.origin_decision_id && result.stage !== "handoff") fail("Only a handoff record can link to its originating decision.");
  if (result.availability === "reported" && !result.value.trim()) fail("Enter the reported value or choose its actual availability.");
  if (result.availability !== "reported" && (result.value.trim() || result.unit.trim())) fail("Clear the value and unit when a measurement is not reported or unavailable.");
  return result;
}
export function validateReviewSource(value) {
  keys(value, ["kind", "paper_id", "page", "block_id", "research_page_id"]);
  if (!["paper", "pdf_page", "note_block", "research_page"].includes(value.kind)) fail("Unsupported review source.");
  const result = { kind: value.kind, paper_id: id(value.paper_id, true), page: value.page, block_id: id(value.block_id, true), research_page_id: id(value.research_page_id, true) };
  if (result.kind === "research_page") { if (!result.research_page_id || result.paper_id || result.block_id || result.page !== null) fail("Invalid research-page reference."); }
  else if (!result.paper_id || result.research_page_id || (result.kind === "pdf_page" ? !Number.isInteger(result.page) || result.page < 1 || result.page > 10000 || result.block_id : result.page !== null || (result.kind === "note_block" ? !result.block_id : Boolean(result.block_id)))) fail("Invalid Paper evidence reference.");
  return result;
}
export function reviewSourceKey(source) { return JSON.stringify([source.kind, source.paper_id, source.page, source.block_id, source.research_page_id]); }
export function reviewSourceUrl(reference) { if (reference.kind === "research_page") return `/workspace?page=${encodeURIComponent(reference.research_page_id)}`; const base = `/papers/${encodeURIComponent(reference.paper_id)}/reader`; return reference.kind === "pdf_page" ? `${base}?page=${reference.page}` : reference.kind === "note_block" ? `${base}?noteBlock=${encodeURIComponent(reference.block_id)}` : base; }
export function validateReviewInput(value) {
  keys(value, ["schema_version", "rows", "checklist"]);
  if (value.schema_version !== 1 || !Array.isArray(value.rows) || value.rows.length > 100) fail("A review supports at most 100 records.");
  keys(value.checklist, REVIEW_KINDS);
  if (REVIEW_KINDS.some((kind) => typeof value.checklist[kind] !== "boolean")) fail("Complete the review checklist fields.");
  const ids = new Set();
  const rows = value.rows.map((row) => {
    keys(row, ["id", "kind", "text", "owner", "due_date", "status", "provenance", "source_links", "context"]);
    id(row.id); if (ids.has(row.id)) fail("Review record identities must be unique."); ids.add(row.id);
    if (!REVIEW_KINDS.includes(row.kind) || !["open", "reviewed"].includes(row.status) || !["manual", "ai"].includes(row.provenance) || !Array.isArray(row.source_links) || row.source_links.length > 10) fail("Invalid review record state.");
    const source_links = row.source_links.map(validateReviewSource);
    if (new Set(source_links.map(reviewSourceKey)).size !== source_links.length) fail("Duplicate source reference.");
    return { id: row.id, kind: row.kind, text: text(row.text, 10000, true), owner: text(row.owner, 200), due_date: date(row.due_date), status: row.status, provenance: row.provenance, source_links, ...(Object.hasOwn(row, "context") ? { context: validateReviewContext(row.context) } : {}) };
  });
  const comparisons = new Set(rows.filter((row) => row.context?.stage === "comparison").map((row) => row.id));
  const decisions = new Set(rows.filter((row) => row.context?.stage === "decision").map((row) => row.id));
  for (const row of rows) for (const reference of row.context?.comparison_ids || []) if (reference === row.id || !comparisons.has(reference)) fail("Comparison references must identify another comparison record in this review.");
  for (const row of rows) if (row.context?.origin_decision_id && (row.context.origin_decision_id === row.id || !decisions.has(row.context.origin_decision_id))) fail("The originating decision must identify another decision record in this review.");
  return { schema_version: 1, rows, checklist: clone(value.checklist) };
}
export function validateReviewDossier(value) {
  keys(value, ["schema_version", "rows", "checklist", "source_fingerprint", "snapshots"]);
  const input = validateReviewInput(reviewInput(value));
  if (value.source_fingerprint !== "") hash(value.source_fingerprint);
  if (!Array.isArray(value.snapshots) || value.snapshots.length > REVIEW_MAX_SNAPSHOTS) fail("Invalid review snapshot history.");
  const ids = new Set();
  for (const snapshot of value.snapshots) {
    keys(snapshot, ["snapshot_id", "version", "created_at", "reviewed_by", "input", "source_fingerprint", "source_inputs"]);
    id(snapshot.snapshot_id); if (ids.has(snapshot.snapshot_id)) fail("Duplicate review snapshot identity."); ids.add(snapshot.snapshot_id);
    if (!Number.isSafeInteger(snapshot.version) || snapshot.version !== ids.size) fail("Invalid review snapshot sequence.");
    iso(snapshot.created_at); text(snapshot.reviewed_by, 200, true); validateReviewInput(snapshot.input); hash(snapshot.source_fingerprint);
    if (!Array.isArray(snapshot.source_inputs) || snapshot.source_inputs.length > 200 || bytes(snapshot.source_inputs) > MAX_SOURCE_BYTES) fail("Snapshot evidence is too large.");
    const referenced = new Set(snapshot.input.rows.flatMap((row) => row.source_links.map(reviewSourceKey)));
    const seen = new Set();
    for (const source of snapshot.source_inputs) {
      keys(source, ["reference", "label", "content"]); validateReviewSource(source.reference); text(source.label, 1200, true); text(source.content, MAX_SOURCE_BYTES);
      const key = reviewSourceKey(source.reference); if (!referenced.has(key) || seen.has(key)) fail("Snapshot evidence does not match its input."); seen.add(key);
    }
    if (seen.size !== referenced.size) fail("Snapshot evidence is incomplete.");
  }
  if (bytes(value) > MAX_DOSSIER_BYTES) fail("Review history exceeds 4 MiB. Export the existing snapshots before starting another dossier.");
  return { ...input, source_fingerprint: value.source_fingerprint, snapshots: clone(value.snapshots) };
}
export function getReviewDossier(project) { return project.reviewDossier === undefined ? { ...blankReviewInput(), source_fingerprint: "", snapshots: [] } : validateReviewDossier(project.reviewDossier); }
export function reviewRevision(project) { const sequence = project.reviewRev === undefined ? 1 : project.reviewRev; if (!Number.isSafeInteger(sequence) || sequence < 1) fail("The saved review revision is invalid.", 503); return sequence.toString(16).padStart(64, "0"); }
function projectById(state, identity) { const project = state.projects?.find((row) => row.project_id === identity); if (!project) fail("Project not found.", 404); return project; }
function source(reference, label, content, url) { return { key: reviewSourceKey(reference), reference, label, content: JSON.stringify(content), url, excerpt: (typeof content === "string" ? content : JSON.stringify(content)).slice(0, 600) }; }
/** Paper links grant the whole Paper; block-only links grant only that block. */
export function collectProjectReviewSources(state, projectId) {
  const project = projectById(state, projectId), sources = [], links = project.links || [];
  for (const paper of state.papers || []) {
    const full = links.some((link) => link.target_type === "paper" && link.paper_id === paper.paper_id);
    const metadata = paper.metadata || {}, title = metadata.title || paper.paper_id;
    const base = { paper_id: paper.paper_id, page: null, block_id: "", research_page_id: "" };
    const actualPdfHash = state.files?.[paper.pdfPath]?.sha256 || paper.pdfSha256 || "";
    const cacheHash = paper.fullTextCache?.sha256 || paper.fullTextCache?.source_pdf_sha256 || "";
    const pdf_sha256 = actualPdfHash || cacheHash;
    const currentCache = !paper.pdfMissing && (!actualPdfHash || !cacheHash || actualPdfHash === cacheHash);
    if (full) {
      sources.push(source({ ...base, kind: "paper" }, title, { metadata, note: paper.note || "", pdf_sha256, missing_pdf: Boolean(paper.pdfMissing), archived: Boolean(paper.archived) }, `/papers/${encodeURIComponent(paper.paper_id)}/reader`));
      if (currentCache) for (const page of paper.fullTextCache?.pages || []) sources.push(source({ ...base, kind: "pdf_page", page: page.page_number }, `${title} · p.${page.page_number}`, { text: page.text, pdf_sha256: cacheHash || pdf_sha256, provider: paper.fullTextCache.provider || "", ocr: paper.fullTextCache.ocr_pages?.find((row) => row.page_number === page.page_number) || null }, `/papers/${encodeURIComponent(paper.paper_id)}/reader?page=${page.page_number}`));
    }
    for (const block of paper.blocks || []) if (full || links.some((link) => link.target_type === "note_block" && link.paper_id === paper.paper_id && link.target_id === block.id)) sources.push(source({ ...base, kind: "note_block", block_id: block.id }, `${title} · ${block.title || block.block_type || "Note Block"}`, { block, pdf_sha256 }, `/papers/${encodeURIComponent(paper.paper_id)}/reader?noteBlock=${encodeURIComponent(block.id)}`));
  }
  for (const page of state.researchPages || []) if (page.project_id === projectId && !page.archived) sources.push(source({ kind: "research_page", paper_id: "", page: null, block_id: "", research_page_id: page.id }, page.title, page, `/workspace?page=${encodeURIComponent(page.id)}`));
  return sources;
}
export function selectedReviewSources(input, sources, strict = false) {
  const wanted = new Map(input.rows.flatMap((row) => row.source_links.map((reference) => [reviewSourceKey(reference), reference]))), indexed = new Map(sources.map((source) => [source.key, source]));
  if (wanted.size > 200) fail("A review supports at most 200 distinct source locations.");
  return [...wanted].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, reference]) => {
    const found = indexed.get(key); if (!found && strict) fail("A selected source is missing or outside this project. Update the project links and review the source again.");
    return found ? { reference: clone(reference), label: found.label, content: found.content } : { reference: clone(reference), label: "Missing or outside project", content: "null" };
  });
}
export async function reviewFingerprint(input, sources) { const encoded = new TextEncoder().encode(JSON.stringify(selectedReviewSources(input, sources))); const digest = await crypto.subtle.digest("SHA-256", encoded); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function substantiveReviewRow(row) { return ["comparison", "decision"].includes(row.context?.stage) || !["question", "next_action"].includes(row.kind); }
export function reviewCoverage(input, sources) {
  const valid = new Set(sources.map((source) => source.key)), substantive = input.rows.filter(substantiveReviewRow), reviewed = substantive.filter((row) => row.status === "reviewed");
  const linked = (row) => row.source_links.some((reference) => valid.has(reviewSourceKey(reference)));
  const missing_source_rows = input.rows.filter((row) => row.source_links.some((reference) => !valid.has(reviewSourceKey(reference)))).map((row) => row.id);
  const unsourced_reviewed_rows = reviewed.filter((row) => !linked(row)).map((row) => row.id);
  return { total_rows: input.rows.length, substantive_rows: substantive.length, reviewed_claims: reviewed.length, sourced_reviewed_claims: reviewed.filter(linked).length, coverage_percent: reviewed.length ? Math.round(reviewed.filter(linked).length / reviewed.length * 100) : null, unsourced_reviewed_rows, missing_source_rows, open_rows: input.rows.filter((row) => row.status === "open").length, unsourced_questions_actions: input.rows.filter((row) => !substantiveReviewRow(row) && !linked(row)).length, checklist_complete: REVIEW_KINDS.every((kind) => input.checklist[kind]), can_freeze: input.rows.length > 0 && REVIEW_KINDS.every((kind) => input.checklist[kind]) && !unsourced_reviewed_rows.length && !missing_source_rows.length };
}
export function compareReviewSnapshots(previous, current) {
  const before = new Map((previous?.rows || []).map((row) => [row.id, row])), after = new Map((current?.rows || []).map((row) => [row.id, row]));
  return { added: [...after.values()].filter((row) => !before.has(row.id)), changed: [...after.values()].filter((row) => before.has(row.id) && JSON.stringify(row) !== JSON.stringify(before.get(row.id))), removed: [...before.values()].filter((row) => !after.has(row.id)), checklist_changed: JSON.stringify(previous?.checklist || {}) !== JSON.stringify(current?.checklist || {}) };
}
/** User-authored content is literal text, never Markdown links, HTML or headings. */
function markdownText(value, continuation = "    ") {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replace(/[\\`*_{}\[\]()#+.!|=~-]/g, "\\$&").replace(/\r\n?/g, "\n").replaceAll("\n", `\n${continuation}`);
}
function workflowMarkdown(context) {
  if (!context) return "";
  const availability = context.availability.replaceAll("_", " ");
  return [
    `  - Workflow stage: ${context.stage}`,
    ...[["Method", context.method], ["Conditions", context.conditions], ["Metric", context.metric]].map(([label, value]) => `  - ${label}: ${value ? markdownText(value) : "unspecified"}`),
    ...[["Value", context.value], ["Unit", context.unit]].map(([label, value]) => `  - ${label}: ${context.availability === "reported" ? (value.trim() ? markdownText(value) : "unspecified") : availability}`),
    `  - Availability: ${availability}`,
    `  - Disposition: ${context.disposition}`,
    `  - Rationale: ${context.rationale ? markdownText(context.rationale) : "unspecified"}`,
    `  - Comparison record IDs: ${context.comparison_ids.length ? context.comparison_ids.map((identity) => `\`${identity}\``).join(", ") : "none linked"}`,
    ...(context.stage === "handoff" ? [`  - Origin decision record ID: ${context.origin_decision_id ? `\`${context.origin_decision_id}\`` : "none linked"}`] : []),
    `  - ${context.stage === "handoff" ? "First action completed" : "Completed"}: ${context.completed ? "yes" : "no"}`,
  ].join("\n");
}
export function exportReviewMarkdown(snapshot, projectName = "Project") {
  const input = snapshot.input || snapshot, sources = snapshot.source_inputs || [];
  const rows = REVIEW_KINDS.map((kind) => `## ${kind.replaceAll("_", " ")}\n\n${input.rows.filter((row) => row.kind === kind).map((row) => `- ${markdownText(row.text, "  ")}\n  - Record ID: \`${row.id}\`\n  - Status: ${row.status}; provenance: ${row.provenance === "ai" ? "AI origin, compare with human review status" : "manual"}; owner: ${markdownText(row.owner || "unassigned")}; due: ${row.due_date || "unspecified"}\n${row.context ? `${workflowMarkdown(row.context)}\n` : ""}${row.source_links.length ? row.source_links.map((reference) => { const found = sources.find((source) => reviewSourceKey(source.reference) === reviewSourceKey(reference)); return `  - Source: ${markdownText(found?.label || "Evidence location")} — ${reviewSourceUrl(reference)}\n    - Stable reference: \`${reviewSourceKey(reference)}\``; }).join("\n") : "  - No source linked; not an established evidence-backed claim."}`).join("\n\n") || "No records."}`).join("\n\n");
  const checklist = REVIEW_KINDS.map((kind) => `- [${input.checklist[kind] ? "x" : " "}] ${kind.replaceAll("_", " ")}`).join("\n");
  return `# ${markdownText(projectName.replace(/[\r\n]+/g, " "))} — research handoff\n\n${snapshot.version ? `Snapshot ${snapshot.version}; reviewed by ${markdownText(snapshot.reviewed_by)}; ${snapshot.created_at}\n\nEvidence fingerprint: ${snapshot.source_fingerprint}\n\n` : "Working draft\n\n"}Human review records judgment; source links do not prove that claims are correct. Open rows remain unreviewed. Source paths open within the same workspace.\n\n${rows}\n\n## Review checklist\n\n${checklist}\n`;
}
