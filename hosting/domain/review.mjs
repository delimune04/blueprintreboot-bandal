import { getContinuity, affectedReviewRows } from "../../frontend/app/lib/continuity/model.mjs";
import { getReviewDossier, reviewInput, validateReviewInput, validateReviewDossier, reviewRevision, collectProjectReviewSources, selectedReviewSources, reviewFingerprint, reviewCoverage } from "../../frontend/app/lib/review/model.mjs";

function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function strict(value, keys) { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) fail(422, "Unknown or invalid review command fields."); }
function projectById(state, id) { const project = state.projects.find((row) => row.project_id === id); if (!project) fail(404, "Project not found."); return project; }
function guard(project, expected) { if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected)) fail(422, "An expected review revision is required."); if (expected !== reviewRevision(project)) fail(409, "The review changed. Reload before saving or freezing."); if ((project.reviewRev || 1) >= Number.MAX_SAFE_INTEGER) fail(503, "The review revision limit was reached; existing history has been preserved."); if (project.status === "archived") fail(409, "Restore this project before editing its review."); }
export async function getProjectReview(state, projectId) {
  const project = projectById(state, projectId), dossier = getReviewDossier(project), sources = collectProjectReviewSources(state, projectId), source_fingerprint = await reviewFingerprint(dossier, sources), latest = dossier.snapshots.at(-1);
  const affected = affectedReviewRows(project, getContinuity(project).signals);
  return { evidence_affected_rows: affected, evidence_change_count: affected.length, project_id: projectId, project_name: project.name, project_status: project.status, dossier, revision: reviewRevision(project), sources: sources.map(({ content: _content, ...source }) => source), source_fingerprint, coverage: reviewCoverage(dossier, sources), draft_sources_stale: Boolean(dossier.source_fingerprint && dossier.source_fingerprint !== source_fingerprint), latest_snapshot_stale: latest ? latest.source_fingerprint !== await reviewFingerprint(latest.input, sources) : false, draft_differs_from_snapshot: latest ? JSON.stringify(latest.input) !== JSON.stringify(reviewInput(dossier)) : Boolean(dossier.rows.length) };
}
export async function saveProjectReview(state, projectId, command) {
  strict(command, ["dossier", "expected_revision"]); const project = projectById(state, projectId); guard(project, command.expected_revision);
  const input = validateReviewInput(command.dossier), old = getReviewDossier(project), sources = collectProjectReviewSources(state, projectId);
  selectedReviewSources(input, sources, true);
  const next = validateReviewDossier({ ...input, source_fingerprint: await reviewFingerprint(input, sources), snapshots: old.snapshots });
  project.reviewDossier = next; project.reviewRev = (project.reviewRev || 1) + 1;
  return { status: "saved", ...await getProjectReview(state, projectId) };
}
export async function freezeProjectReview(state, projectId, command, context = {}) {
  strict(command, ["expected_revision", "reviewed_by", "confirm"]); const project = projectById(state, projectId); guard(project, command.expected_revision);
  if (command.confirm !== true || typeof command.reviewed_by !== "string" || !command.reviewed_by.trim() || command.reviewed_by.length > 200 || command.reviewed_by.includes("\0")) fail(422, "Confirm the snapshot and provide the human reviewer's name.");
  if (affectedReviewRows(project, getContinuity(project).signals).length) fail(422, "Review the open evidence-change notices and record their outcomes before freezing a new handoff snapshot.");
  const dossier = getReviewDossier(project), sources = collectProjectReviewSources(state, projectId), coverage = reviewCoverage(dossier, sources);
  if (!coverage.can_freeze) fail(422, "Review all five checklist sections and link project evidence to every reviewed hypothesis, decision and failed attempt. Missing references must be resolved.");
  const fingerprint = await reviewFingerprint(dossier, sources);
  if (!dossier.source_fingerprint || fingerprint !== dossier.source_fingerprint) fail(409, "Linked evidence changed since the review was saved. Compare the original and save your reviewed draft again before freezing.");
  const source_inputs = selectedReviewSources(dossier, sources, true);
  const snapshot = { snapshot_id: `review-snapshot-${crypto.randomUUID()}`, version: dossier.snapshots.length + 1, created_at: typeof context.now === "function" ? context.now() : new Date().toISOString(), reviewed_by: command.reviewed_by.trim(), input: reviewInput(dossier), source_fingerprint: fingerprint, source_inputs };
  const next = validateReviewDossier({ ...dossier, snapshots: [...dossier.snapshots, snapshot] });
  project.reviewDossier = next; project.reviewRev = (project.reviewRev || 1) + 1;
  return { status: "frozen", snapshot, ...await getProjectReview(state, projectId) };
}
export async function routeReview(parts, method, body, state, context = {}) {
  if (parts[0] !== "projects" || parts[2] !== "review") return null;
  if (parts.length === 3 && method === "GET") return getProjectReview(state, parts[1]);
  if (parts.length === 3 && method === "PUT") return saveProjectReview(state, parts[1], body);
  if (parts.length === 4 && parts[3] === "freeze" && method === "POST") return freezeProjectReview(state, parts[1], body, context);
  fail(404, "Project review command not found.");
}
