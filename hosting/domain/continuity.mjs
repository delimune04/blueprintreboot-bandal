import * as c from "./core.mjs";
import { providerGet, canonicalDoi } from "./providers.mjs";
import { continuityCommand, continuityResponse, getContinuity, continuityRevision, validateContinuity, validateSignal } from "../../frontend/app/lib/continuity/model.mjs";

export function crossrefNotices(message, doi) {
  // Only an explicit deposited reverse update identifies an update to this work.
  // A changed metadata timestamp or an ordinary citation is not a correction.
  const items = Array.isArray(message?.["updated-by"]) ? message["updated-by"] : [];
  return items.filter(row => /^(retraction|correction|erratum|expression-of-concern)$/i.test(row?.type || "") && canonicalDoi(row.DOI) && canonicalDoi(row.DOI) !== doi)
    .map(row => ({ kind: row.type.toLowerCase() === "retraction" ? "retraction" : row.type.toLowerCase() === "expression-of-concern" ? "other" : "correction", url: `https://doi.org/${canonicalDoi(row.DOI)}`, summary: `Crossref reports ${row.type}: ${canonicalDoi(row.DOI)}` }));
}
export async function checkEvidenceChanges(state, projectId, body, context = {}) {
  c.strict(body, ["expected_revision", "paper_ids"]);
  const current = continuityResponse(state, projectId), project = state.projects.find(p => p.project_id === projectId);
  if (project.status === "archived") c.fail(409, "Restore this project before checking evidence changes.");
  if (body.expected_revision !== current.revision) c.fail(409, "Research history changed. Reload before checking.", "conflict");
  if (!Array.isArray(body.paper_ids) || !body.paper_ids.length || body.paper_ids.length > 6 || new Set(body.paper_ids).size !== body.paper_ids.length) c.fail(422, "Select one to six project papers per check.");
  if (body.paper_ids.some(id => !current.papers.some(p => p.paper_id === id))) c.fail(422, "Check only papers linked to this project.");
  const dossier = getContinuity(project), timestamp = c.now(), staged = [];
  const checks = await Promise.all(body.paper_ids.map(async paperId => {
    const paper = current.papers.find(p => p.paper_id === paperId), doi = canonicalDoi(paper.doi);
    const check = { paper_id: paperId, title: paper.title, checked_at: timestamp };
    if (!doi) return { ...check, status: "no_doi", message: "DOI가 없어 자동 확인을 건너뛰었습니다. 정정·반대 결과는 직접 등록할 수 있습니다." };
    let completed = 0;
    const notices = [];
    await Promise.all([
      (async () => { try {
        const url = new URL(`https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}`); url.searchParams.set("select", "id,doi,is_retracted,updated_date");
        const work = await providerGet(url, context.env || {}, context.fetch || fetch, { timeoutMs: 7000 });
        if (canonicalDoi(work?.doi) !== doi || typeof work.is_retracted !== "boolean") return;
        completed++; if (work.is_retracted) notices.push({ kind: "retraction", source: "OpenAlex", url: /^https:\/\/openalex.org\/W\d+$/.test(work.id || "") ? work.id : `https://doi.org/${doi}`, summary: "OpenAlex에 철회 표시가 등록되어 있습니다. 원문과 발행기관 공지를 확인해 관련 결정을 재검토하세요." });
      } catch { /* A lookup failure remains unknown, never a clean bill. */ } })(),
      (async () => { try {
        const response = await providerGet(new URL(`https://api.crossref.org/works/${encodeURIComponent(doi)}`), context.env || {}, context.fetch || fetch, { timeoutMs: 7000 });
        if (canonicalDoi(response?.message?.DOI) !== doi) return;
        completed++; notices.push(...crossrefNotices(response.message, doi).map(v => ({ ...v, source: "Crossref" })));
      } catch { /* Preserve successful results from the other provider. */ } })(),
    ]);
    for (const item of notices) if (![...dossier.signals, ...staged].some(s => s.paper_id === paperId && s.source === item.source && s.kind === item.kind && s.url === item.url)) {
      staged.push(validateSignal({ id: `signal-${crypto.randomUUID()}`, paper_id: paperId, ...item, observed_at: timestamp, status: "open", resolution: "", resolved_at: "", resolved_by: "" }));
    }
    return { ...check, status: completed === 2 ? "checked" : "unavailable", message: `${completed}/2 제공처 응답 확인. ${notices.length ? `${notices.length}개 변경 공지 확인.` : "확인한 응답에서 변경 공지를 찾지 못했습니다."} ${completed < 2 ? "일부 제공처를 확인하지 못했습니다. " : ""}수록 누락과 아직 등록되지 않은 변경은 포함하지 않습니다.` };
  }));
  if (dossier.signals.length + staged.length > 200) c.fail(422, "Evidence notice history is full. Existing records were preserved.");
  dossier.signals.push(...staged); dossier.checks = checks; dossier.checked_at = timestamp;
  project.continuity = validateContinuity(dossier); project.continuityRev = (project.continuityRev || 1) + 1;
  return { status: "checked", ...continuityResponse(state, projectId) };
}
export async function routeContinuity(parts, method, body, state, context = {}) {
  if (parts[0] !== "projects" || parts[2] !== "continuity") return null;
  if (parts.length === 3 && method === "GET") return continuityResponse(state, parts[1]);
  if (parts.length === 4 && parts[3] === "check" && method === "POST") return checkEvidenceChanges(state, parts[1], body, context);
  if (parts.length === 4 && method === "POST" && ["run", "signal", "resolve"].includes(parts[3])) return continuityCommand(state, parts[1], parts[3], body, context.actor || "");
  c.fail(404, "Research continuity command not found.");
}
