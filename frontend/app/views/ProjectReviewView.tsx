"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Archive, CheckCircle2, Download, ExternalLink, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { StatusBadge } from "../components/StatusBadge";
import { ErrorState, LoadingState } from "../components/AsyncStates";
import { useApiResource } from "../hooks/useApiResource";
import { getWorkspaceRole, labviumRequest } from "../lib/api/client";
import { useI18n } from "../lib/i18n/LocaleProvider";
import { REVIEW_KINDS, REVIEW_MAX_SNAPSHOTS, compareReviewSnapshots, exportReviewMarkdown, newReviewRow, reviewCoverage, reviewInput, reviewSourceKey } from "../lib/review/model.mjs";
import type { ProjectReviewResponse, ReviewKind, ReviewRow } from "../lib/review/model.mjs";
import "../lib/review/review.css";
import { reviewReadiness } from "../lib/review/readiness.mjs";
import { ReviewWorkflow, ReviewContextEditor, FrozenWorkflowContext } from "../components/ReviewWorkflow";

const LABELS: Record<ReviewKind, string> = { hypothesis: "Current hypothesis", decision: "Key decisions", failed_attempt: "Failed attempts", question: "Open questions", next_action: "Next actions" };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The review could not be saved.";
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function ReviewEditor({ initial }: { initial: ProjectReviewResponse }) {
  const { t, locale } = useI18n();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(() => reviewInput(initial.dossier));
  const [reviewedBy, setReviewedBy] = useState("");
  const [selectedSnapshot, setSelectedSnapshot] = useState(initial.dossier.snapshots.at(-1)?.snapshot_id || "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const viewer = getWorkspaceRole() === "viewer";
  const archived = saved.project_status === "archived";
  const readonly = viewer || archived || busy;
  const dirty = !same(draft, reviewInput(saved.dossier));
  const coverage = reviewCoverage(draft, saved.sources);
  const readiness = reviewReadiness({ draft, coverage, viewer, archived, busy, dirty, evidenceChanges: saved.evidence_change_count, staleSources: saved.draft_sources_stale, reviewedBy, snapshotCount: saved.dossier.snapshots.length });
  const readinessText: Record<string, string> = locale === "ko" ? {
    viewer: "편집 권한이 있는 작업 공간에서 진행하세요.", archived: "프로젝트 보관을 해제하세요.", busy: "현재 저장·새로고침이 끝날 때까지 기다리세요.",
    empty: "검토 기록을 하나 이상 추가하세요.", blank: "내용이 빈 기록을 작성하거나 제거한 뒤 저장하세요.",
    unsourced: "검토 완료 주장에 프로젝트 근거를 연결하거나 미검토로 되돌리세요.", missing: "없어진 출처의 연결을 복구하거나 해당 참조를 제거하세요.",
    changed: "근거 변경 화면에서 영향을 받은 기록을 재검토하고 결론을 저장하세요.", stale: "변경된 원문을 확인한 뒤 검토를 다시 저장하세요.",
    save: "작성 중인 변경을 ‘검토 저장’으로 저장하세요.", reviewer: "검토 담당자 이름을 입력하세요.", limit: "스냅샷 20개 한도에 도달했습니다. 기존 버전은 보존됩니다.",
  } : {
    viewer: "Use a workspace where you have editing permission.", archived: "Restore the archived project.", busy: "Wait for the current save or refresh to finish.",
    empty: "Add at least one review record.", blank: "Complete or remove empty records, then save.",
    unsourced: "Link project evidence to reviewed claims, or mark them open.", missing: "Restore missing source relationships or remove their references.",
    changed: "Review affected records in Evidence changes and save your conclusions.", stale: "Inspect changed sources, then save the review again.",
    save: "Save your changes with Save review.", reviewer: "Enter the human reviewer name.", limit: "The 20-snapshot limit has been reached. Existing versions are preserved.",
  };
  const snapshotIndex = saved.dossier.snapshots.findIndex((entry) => entry.snapshot_id === selectedSnapshot);
  const snapshot = saved.dossier.snapshots[snapshotIndex];
  const previous = snapshotIndex > 0 ? saved.dossier.snapshots[snapshotIndex - 1] : null;
  const comparison = snapshot ? compareReviewSnapshots(previous?.input, snapshot.input) : null;
  const currentComparison = compareReviewSnapshots(saved.dossier.snapshots.at(-1)?.input, draft);
  const path = `/projects/${encodeURIComponent(saved.project_id)}/review`;
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => { const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null; if (event.defaultPrevented || event.button !== 0 || !anchor || anchor.getAttribute("href")?.startsWith("#")) return; if (!window.confirm(t("Discard the unsaved changes to this review?"))) { event.preventDefault(); event.stopPropagation(); } };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, [dirty, t]);
  function updateRow(identity: string, changes: Partial<ReviewRow>) { setDraft((current) => ({ ...current, rows: current.rows.map((row) => row.id === identity ? { ...row, ...changes } : row) })); }
  async function refresh() {
    if (busy || (dirty && !window.confirm(t("Discard the unsaved changes to this review?")))) return;
    setBusy(true); setNotice("");
    try { const response = await labviumRequest<ProjectReviewResponse>(path); setSaved(response); setDraft(reviewInput(response.dossier)); if (!response.dossier.snapshots.some((entry) => entry.snapshot_id === selectedSnapshot)) setSelectedSnapshot(response.dossier.snapshots.at(-1)?.snapshot_id || ""); setNotice(t("Review and source status refreshed.")); }
    catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); }
  }
  async function save() {
    if (readonly) return;
    setBusy(true); setNotice("");
    try { const response = await labviumRequest<ProjectReviewResponse>(path, { method: "PUT", body: { dossier: draft, expected_revision: saved.revision } }); setSaved(response); setDraft(reviewInput(response.dossier)); setNotice(t("Review draft saved. No snapshot was frozen.")); }
    catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); }
  }
  async function freeze() {
    if (readonly || dirty || !coverage.can_freeze || !reviewedBy.trim() || !window.confirm(t("Freeze this saved review as a versioned snapshot? Open records remain unreviewed. Source links record traceability, not proof."))) return;
    setBusy(true); setNotice("");
    try { const response = await labviumRequest<ProjectReviewResponse>(`${path}/freeze`, { method: "POST", body: { expected_revision: saved.revision, reviewed_by: reviewedBy, confirm: true } }); setSaved(response); setDraft(reviewInput(response.dossier)); setSelectedSnapshot(response.snapshot?.snapshot_id || ""); setNotice(t("Human-reviewed snapshot frozen. Future edits will not replace this version.")); }
    catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); }
  }
  function download() {
    if (!snapshot) return;
    const url = URL.createObjectURL(new Blob([exportReviewMarkdown(snapshot, saved.project_name)], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `project-handoff-v${snapshot.version}.md`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="page-stack review-dossier">
    <Breadcrumbs items={[{ label: t("Projects"), href: "/projects" }, { label: saved.project_name, href: `/projects/${encodeURIComponent(saved.project_id)}` }, { label: t("Decision and handoff review") }]} />
    <PageHeader title={t("Decision and handoff review")} description={saved.project_name} actions={<button className="reader-control reader-control--secondary" disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} />{t("Refresh sources")}</button>} />
    <p className="muted-text">{t("Record why the project changed direction. Review the original evidence yourself; a linked source does not prove a claim.")}</p>
    {viewer ? <StatusBadge>{t("Read-only workspace")}</StatusBadge> : null}
    {archived ? <StatusBadge tone="amber"><Archive size={13} />{t("Restore this project before editing its review.")}</StatusBadge> : null}
    {notice ? <p role="status" className="reader-editor__status">{notice}</p> : null}
    {saved.evidence_change_count ? <p className="review-warning"><Link href={`/projects/${saved.project_id}/continuity`}>{locale === "ko" ? `${saved.evidence_change_count}개 기록에 연결된 근거 변경을 재검토해 주세요. 새 인수인계 스냅샷을 확정하기 전에 검토 결론을 저장하세요.` : `${saved.evidence_change_count} records depend on open evidence notices. Review them before freezing a new handoff.`}</Link></p> : null}
    <ReviewWorkflow rows={draft.rows} readonly={readonly} ko={locale === "ko"} update={updateRow} add={(row) => setDraft(current => ({ ...current, rows: [...current.rows, row] }))} />
    <Section title={t("Evidence coverage")} description={t("Coverage counts reviewed hypotheses, decisions and failed attempts with a source in this project. It does not measure correctness.")}>
      <div className="review-coverage"><strong>{coverage.coverage_percent === null ? t("No reviewed claims yet") : `${coverage.sourced_reviewed_claims} / ${coverage.reviewed_claims} (${coverage.coverage_percent}%)`}</strong><span>{t("{count} open records", { count: coverage.open_rows })}</span><span>{t("{count} questions or actions without sources", { count: coverage.unsourced_questions_actions })}</span></div>
      {coverage.unsourced_reviewed_rows.length ? <p className="review-warning">{t("Reviewed substantive claims without evidence cannot be frozen. Add a project source or return the record to open review.")}</p> : null}
      {coverage.missing_source_rows.length ? <p className="review-warning">{t("Some references are missing or no longer belong to this project. Restore the source relationship or remove the reference.")}</p> : null}
      {saved.draft_sources_stale ? <p className="review-warning">{t("Evidence changed since this draft was saved. Review the current source, then save again before freezing.")}</p> : null}
      {saved.latest_snapshot_stale ? <p className="review-warning">{t("Linked evidence changed after the latest snapshot. Its saved input remains available, but it no longer describes the current source version.")}</p> : null}
      <p className="muted-text">{t("Only linked project papers, linked note blocks and research pages assigned to this project are offered as evidence. Extract PDF text in Reader to select a specific page.")}</p>
    </Section>
    <Section title={t("Working review records")} description={t("Changes remain a draft until Save review. AI provenance marks pasted AI text; this editor does not generate or verify it.")}>
      <fieldset className="review-fieldset" disabled={readonly}>
        {draft.rows.map((row, index) => <article className="review-record" key={row.id} id={`review-${row.id}`}>
          <div className="review-record-heading"><span className="review-number">{index + 1}</span><label className="reader-field"><span>{t("Record kind")}</span><select value={row.kind} onChange={(event) => updateRow(row.id, { kind: event.target.value as ReviewKind })}>{REVIEW_KINDS.map((kind) => <option key={kind} value={kind}>{t(LABELS[kind])}</option>)}</select></label><label className="reader-field"><span>{t("Review status")}</span><select value={row.status} onChange={(event) => updateRow(row.id, { status: event.target.value as ReviewRow["status"] })}><option value="open">{t("Open · not reviewed")}</option><option value="reviewed">{t("Reviewed by a person")}</option></select></label><button className="icon-button" aria-label={t("Remove review record")} disabled={draft.rows.some(item => (item.context?.comparison_ids.includes(row.id) || item.context?.origin_decision_id === row.id))} title={draft.rows.some(item => (item.context?.comparison_ids.includes(row.id) || item.context?.origin_decision_id === row.id)) ? (locale === "ko" ? "연결된 결정과 인수인계에서 비교 연결을 먼저 해제하세요." : "Unlink dependent decisions and actions first.") : undefined} onClick={() => setDraft({ ...draft, rows: draft.rows.filter((item) => item.id !== row.id) })}><Trash2 size={15} /></button></div>
          <label className="reader-field"><span>{t("Research record")}</span><textarea rows={3} maxLength={10000} value={row.text} onChange={(event) => updateRow(row.id, { text: event.target.value })} /></label>
          <ReviewContextEditor row={row} rows={draft.rows} readonly={readonly} ko={locale === "ko"} update={updateRow} add={(item) => setDraft(current => ({ ...current, rows: [...current.rows, item] }))} />
          <div className="review-record-fields"><label className="reader-field"><span>{t("Owner")}</span><input value={row.owner} maxLength={200} onChange={(event) => updateRow(row.id, { owner: event.target.value })} /></label><label className="reader-field"><span>{t("Due date")}</span><input type="date" value={row.due_date} onChange={(event) => updateRow(row.id, { due_date: event.target.value })} /></label><label className="reader-field"><span>{t("Content provenance")}</span><select value={row.provenance} onChange={(event) => updateRow(row.id, { provenance: event.target.value as ReviewRow["provenance"] })}><option value="manual">{t("Manual research")}</option><option value="ai">{t("AI draft · unverified")}</option></select></label></div>
          {row.provenance === "ai" ? <p className="muted-text">{t("AI-origin wording remains labeled even after human review. Compare every claim with the original evidence.")}</p> : null}
          <div className="review-source-list">{row.source_links.map((reference) => { const key = reviewSourceKey(reference), found = saved.sources.find((source) => source.key === key); return <div className="review-source" key={key}>{found ? <><Link href={found.url}>{found.label} <ExternalLink size={12} /></Link><details><summary>{t("Inspect source excerpt")}</summary><pre>{found.excerpt}</pre></details></> : <span className="review-warning">{t("Missing or outside project")}</span>}<button className="text-link" onClick={() => updateRow(row.id, { source_links: row.source_links.filter((source) => reviewSourceKey(source) !== key) })}>{t("Remove reference")}</button></div>; })}</div>
          <label className="reader-field"><span>{t("Add project evidence")}</span><select value="" disabled={readonly || row.source_links.length >= 10} onChange={(event) => { const source = saved.sources.find((item) => item.key === event.target.value); if (source && !row.source_links.some((item) => reviewSourceKey(item) === source.key)) updateRow(row.id, { source_links: [...row.source_links, source.reference] }); }}><option value="">{t("Select a linked source location")}</option>{saved.sources.filter((source) => !row.source_links.some((reference) => reviewSourceKey(reference) === source.key)).map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}</select></label>
          {!row.source_links.length ? <p className="muted-text">{t(["question", "next_action"].includes(row.kind) ? "No source linked. This is a question or proposed action, not an established fact." : "No source linked. Keep this claim open until its evidence is recorded.")}</p> : null}
        </article>)}
        <div className="review-actions"><button className="reader-control reader-control--secondary" disabled={readonly || draft.rows.length >= 100} onClick={() => setDraft({ ...draft, rows: [...draft.rows, newReviewRow()] })}><Plus size={15} />{t("Add review record")}</button><button className="reader-control" disabled={readonly || draft.rows.some((row) => !row.text.trim()) || (!dirty && !saved.draft_sources_stale)} onClick={() => void save()}><Save size={15} />{t("Save review")}</button><StatusBadge tone={dirty ? "amber" : "slate"}>{t(dirty ? "Unsaved changes" : "Saved")}</StatusBadge></div>
      </fieldset>
    </Section>
    <Section title={t("Human review checklist")} description={t("Confirm that each section was considered, including sections where nothing has been recorded. This records your judgment, not external certification.")}>
      <fieldset className="review-fieldset review-checklist" disabled={readonly}>{REVIEW_KINDS.map((kind) => <label key={kind}><input type="checkbox" checked={draft.checklist[kind]} onChange={(event) => setDraft({ ...draft, checklist: { ...draft.checklist, [kind]: event.target.checked } })} />{t(LABELS[kind])}</label>)}</fieldset>
      <p className="muted-text">{t("Compared with the latest snapshot: {added} added, {changed} changed, {removed} removed.", { added: currentComparison.added.length, changed: currentComparison.changed.length, removed: currentComparison.removed.length })}</p>
      <div className="review-actions"><label className="reader-field"><span>{t("Human reviewer name")}</span><input value={reviewedBy} maxLength={200} disabled={readonly} onChange={(event) => setReviewedBy(event.target.value)} /></label><button className="reader-control" aria-describedby="review-freeze-readiness" disabled={readonly || dirty || Boolean(saved.evidence_change_count) || saved.draft_sources_stale || !coverage.can_freeze || !reviewedBy.trim() || saved.dossier.snapshots.length >= REVIEW_MAX_SNAPSHOTS} onClick={() => void freeze()}><CheckCircle2 size={15} />{t("Freeze reviewed snapshot")}</button></div>
      <div id="review-freeze-readiness" role="status" aria-live="polite" className="review-freeze-readiness">
        <strong>{locale === "ko" ? (readiness.length ? "스냅샷 확정 전 확인할 일" : "스냅샷을 확정할 수 있습니다") : (readiness.length ? "Before freezing this snapshot" : "Ready to freeze this snapshot")}</strong>
        {readiness.length ? <ul>{readiness.map(reason => <li key={reason.code}>{reason.code === "checklist" ? `${locale === "ko" ? "검토 목록을 확인하세요" : "Complete the review checklist"}: ${reason.kinds!.map(kind => t(LABELS[kind])).join(", ")}` : readinessText[reason.code]}{reason.count ? ` (${reason.count})` : ""}</li>)}</ul> : <p>{locale === "ko" ? "확정 버튼을 누른 뒤 내용을 확인하세요. 미검토 기록은 미검토 상태로 보존됩니다." : "Use Freeze reviewed snapshot and confirm. Open records will remain unreviewed."}</p>}
      </div>
      <p className="muted-text">{t("Save first. Each snapshot preserves the exact review input, selected source text and fingerprints, reviewer name and date. Open records remain marked unreviewed.")}</p>
      {saved.dossier.snapshots.length >= REVIEW_MAX_SNAPSHOTS ? <p className="review-warning">{t("The 20-snapshot retention limit has been reached. Existing snapshots are preserved.")}</p> : null}
    </Section>
    <Section title={t("Versioned handoff snapshots")}>
      {saved.dossier.snapshots.length ? <><div className="review-actions"><label className="reader-field"><span>{t("Select snapshot")}</span><select value={selectedSnapshot} onChange={(event) => setSelectedSnapshot(event.target.value)}>{saved.dossier.snapshots.map((entry) => <option value={entry.snapshot_id} key={entry.snapshot_id}>v{entry.version} · {entry.reviewed_by} · {new Date(entry.created_at).toLocaleString(locale === "ko" ? "ko-KR" : "en-US")}</option>)}</select></label><button className="reader-control reader-control--secondary" disabled={!snapshot} onClick={download}><Download size={15} />{t("Export snapshot Markdown")}</button></div>{snapshot && comparison ? <>
        <p>{t("Compared with the previous snapshot: {added} added, {changed} changed, {removed} removed.", { added: comparison.added.length, changed: comparison.changed.length, removed: comparison.removed.length })}</p>
        {comparison.checklist_changed ? <p className="muted-text">{t("The review checklist changed.")}</p> : null}
        {([['added', 'Added records'], ['changed', 'Changed records'], ['removed', 'Removed records']] as const).map(([key, label]) => comparison[key].length ? <details key={key}><summary>{t(label)} ({comparison[key].length})</summary>{comparison[key].map((row) => <div key={row.id}><p><strong>{t(LABELS[row.kind])}:</strong> {row.text}</p><FrozenWorkflowContext row={row} ko={locale === "ko"} /></div>)}</details> : null)}
        <details><summary>{t("Inspect frozen review and source inputs")}</summary><p>{t("This is the input saved at this snapshot, including the source version at that time.")}</p><div className="review-frozen-input">{snapshot.input.rows.map((row) => <article key={row.id}><strong>{t(LABELS[row.kind])} · {t(row.status === "open" ? "Open · not reviewed" : "Reviewed by a person")}</strong><p>{row.text}</p><FrozenWorkflowContext row={row} ko={locale === "ko"} /><p>{row.owner} {row.due_date} · {t(row.provenance === "ai" ? "AI draft · unverified" : "Manual research")}</p></article>)}{snapshot.source_inputs.map((source) => <details key={reviewSourceKey(source.reference)}><summary>{source.label}</summary><pre>{source.content}</pre></details>)}</div></details>
      </> : null}</> : <p className="muted-text">{t("No snapshot yet. Save the records, review the evidence and complete the checklist first.")}</p>}
    </Section>
  </div>;
}

export function ProjectReviewView({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const resource = useApiResource(`project-review:${projectId}`, () => labviumRequest<ProjectReviewResponse>(`/projects/${encodeURIComponent(projectId)}/review`));
  if (resource.status === "loading") return <LoadingState label={t("Loading project review")} />;
  if (resource.status !== "success") return <ErrorState description={resource.message} onRetry={resource.retry} />;
  return <ReviewEditor key={projectId} initial={resource.data} />;
}
