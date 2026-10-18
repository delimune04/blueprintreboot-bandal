"use client";

import { Archive, Download, FileUp, RefreshCw, RotateCcw, Trash2, Link2 } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { DataTableShell } from "../components/DataTableShell";
import { ErrorState, LoadingState } from "../components/AsyncStates";
import { StatusBadge } from "../components/StatusBadge";
import { useApiResource } from "../hooks/useApiResource";
import { apiClient, downloadRawWorkspace, getWorkspaceMode, getWorkspaceRole, labviumRequest, workspaceDownloadUrl } from "../lib/api/client";
import type { ManagedPdfImportResponse, NoteBlockCollection, PaperDetail, ProjectDetail, ProjectLinkType } from "../lib/api/types";
import { useI18n } from "../lib/i18n/LocaleProvider";
import { readExternalNoteFile } from "../lib/workspace/note-file";
import type { BackupPreview, BackupRecord, NoteImportPreview, RecoveryRecord, WorkspaceSnapshot } from "../lib/workspace/types";
import "../lib/workspace/workspace.css";

const LINK_TYPES: ProjectLinkType[] = ["related", "background", "key_reference", "supports_project", "raises_question", "idea_for_project"];
const readableError = (error: unknown) => error instanceof Error ? error.message : "The operation could not be completed.";
type TagMergePreview = { affected_paper_count: number; affected_block_count: number; affected_project_count: number; expected_registry_revision: string; preview_token: string; workspace_revision: string; message: string };
type SimilarTag = {source_key:string;target_key:string;source_label:string;target_label:string;similarity:number;reason:string};
function downloadJson(value: unknown, name: string) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function recoveryDownload(url: string | undefined) { return url && /^\/(?:LabVium|ku-ai)\/api\/recovery\/[a-zA-Z0-9_-]+\/download(?:\?|$)/.test(url) ? workspaceDownloadUrl(url) : ""; }

export function MaintenanceView() {
  const { t } = useI18n();
  const resource = useApiResource("workspace-maintenance", async () => {
    const [workspace, backups, recovery, papers, projects, settings, tags] = await Promise.all([
      labviumRequest<WorkspaceSnapshot>("/workspace"), labviumRequest<{items: BackupRecord[];workspace_revision: string}>("/backups"),
      labviumRequest<{items: RecoveryRecord[];workspace_revision: string}>("/recovery"), apiClient.getAllPapers({ archiveStatus: "all" }), apiClient.getAllProjects(), apiClient.getSettingsSummary(), apiClient.getAllTags(),
    ]);
    return { workspace, backups, recovery, papers, projects, settings, tags };
  });
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [backupKind, setBackupKind] = useState<"light" | "full">("full");
  const [restorePreview, setRestorePreview] = useState<BackupPreview | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [sourceContent, setSourceContent] = useState("");
  const [targetPaperId, setTargetPaperId] = useState("");
  const [importPreview, setImportPreview] = useState<NoteImportPreview | null>(null);
  const [pdfResult, setPdfResult] = useState<ManagedPdfImportResponse | null>(null);
  const [selectedProject, setSelectedProject] = useState<ProjectDetail | null>(null);
  const [linkDrafts, setLinkDrafts] = useState<Record<string, ProjectLinkType>>({});
  const [blocks, setBlocks] = useState<NoteBlockCollection | null>(null);
  const [selectedPaper, setSelectedPaper] = useState<(PaperDetail & {priority_revision?:string}) | null>(null);
  const [priority, setPriority] = useState("normal");
  const [filename, setFilename] = useState("");
  const viewer = getWorkspaceRole() === "viewer";
  const [sourceTag, setSourceTag] = useState("");
  const [targetTag, setTargetTag] = useState("");
  const [tagMergePreview, setTagMergePreview] = useState<TagMergePreview | null>(null);
  const [similarTags, setSimilarTags] = useState<SimilarTag[] | null>(null);
  const [rebuiltProfile, setRebuiltProfile] = useState<Record<string, unknown> | null>(null);
  const supports = (capability: string) => {
    if (resource.status !== "success") return false;
    const capabilities = resource.data.workspace.capabilities;
    return Array.isArray(capabilities) ? capabilities.includes(capability) : Boolean(capabilities[capability]);
  };
  async function run(key: string, operation: () => Promise<void>) {
    if (busy) return; setBusy(key); setNotice("");
    try { await operation(); } catch (error) { setNotice(readableError(error)); } finally { setBusy(""); }
  }
  async function createBackup() {
    if (resource.status !== "success") return;
    await run("backup", async () => {
      const backup = await labviumRequest<BackupRecord>("/backups", { method: "POST", body: { kind: backupKind, expected_revision: resource.data.workspace.workspace_revision } });
      const archive = await labviumRequest<unknown>(`/backups/${encodeURIComponent(backup.backup_id)}`);
      downloadJson(archive, `labvium-${backupKind}-backup-${new Date().toISOString().slice(0, 10)}.json`);
      const archivePdfs = (archive as {pdfs?: Array<{data_base64?: string}>})?.pdfs;
      const portable = backup.portable ?? (Array.isArray(archivePdfs) && archivePdfs.every((file) => typeof file.data_base64 === "string"));
      setNotice(t(portable ? "Backup verified and downloaded. Keep it somewhere separate from this workspace." : "Snapshot downloaded. PDF references stay in your account; this file is not an offline PDF backup.")); resource.retry();
    });
  }
  async function exportPortable() {
    await run("export", async () => {
      const archive = await labviumRequest<{pdfs?: Array<{data_base64?: string}>}>("/exports/workspace");
      downloadJson(archive, `labvium-workspace-export-${new Date().toISOString().slice(0, 10)}.json`);
      const byteCoverage = Array.isArray(archive.pdfs) && archive.pdfs.every((file) => typeof file.data_base64 === "string");
      setNotice(t(byteCoverage ? "Workspace exported with included PDF bytes." : "Export includes records and account PDF references. It is not an offline PDF backup."));
    });
  }
  async function previewBackup(id: string) { await run("preview", async () => { const preview = await labviumRequest<BackupPreview>(`/backups/${encodeURIComponent(id)}/restore-preview`, { method: "POST", body: {} }); setRestorePreview(preview); }); }
  async function uploadBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    await run("preview", async () => { if (file.size > 250 * 1024 * 1024) throw new Error(t("Backup files must be smaller than 250 MiB.")); const archive: unknown = JSON.parse(await file.text()); const preview = await labviumRequest<BackupPreview>("/backups/import-preview", { method: "POST", body: { archive } }); setRestorePreview(preview); });
  }
  async function restore() {
    if (!restorePreview?.verified || !window.confirm(t("Replace this workspace with the verified backup? The current workspace will be retained as a recovery copy."))) return;
    await run("restore", async () => { await labviumRequest(`/backups/${encodeURIComponent(restorePreview.backup_id)}/restore`, { method: "POST", body: { expected_revision: restorePreview.workspace_revision, confirm: true } }); setRestorePreview(null); setNotice(t("Workspace restored. The previous state remains in recovery.")); resource.retry(); });
  }
  async function readNote(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    await run("read-note", async () => { setSourceContent(await readExternalNoteFile(file)); setSourceName(file.name); setImportPreview(null); });
  }
  async function previewNote() { await run("note-preview", async () => { setImportPreview(await labviumRequest<NoteImportPreview>("/note-import/preview", { method: "POST", body: { source_name: sourceName, content: sourceContent, ...(targetPaperId ? { target_paper_id: targetPaperId } : {}) } })); }); }
  async function applyNote() {
    if (!importPreview || !targetPaperId || importPreview.duplicate || !window.confirm(t("Import this previewed note into the selected paper? Existing notes will be retained."))) return;
    await run("note-import", async () => { await labviumRequest("/note-import", { method: "POST", body: { source_name: sourceName, content: sourceContent, target_paper_id: targetPaperId, expected_revision: importPreview.workspace_revision, confirm: true, force_reimport: false } }); setImportPreview(null); setSourceContent(""); setSourceName(""); setNotice(t("External note imported with source provenance.")); resource.retry(); });
  }
  async function uploadPdfs(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []).filter((file) => /\.pdf$/i.test(file.name)); event.target.value = "";
    if (!files.length) { setNotice(t("Choose at least one PDF file.")); return; }
    await run("upload", async () => { setPdfResult(await apiClient.uploadManagedPdfs(files)); resource.retry(); });
  }
  async function loadProject(id: string) { if (!id) { setSelectedProject(null); return; } await run("project", async () => { setSelectedProject(await apiClient.getCompleteProject(id)); setLinkDrafts({}); }); }
  async function restoreProject() {
    if (!selectedProject || !window.confirm(t("Restore this archived project?"))) return;
    await run("project-restore", async () => { await labviumRequest(`/projects/${encodeURIComponent(selectedProject.project_id)}/unarchive`, { method: "POST", body: { expected_revision: selectedProject.project_revision, confirm: true } }); setSelectedProject(await apiClient.getCompleteProject(selectedProject.project_id)); resource.retry(); });
  }
  async function removeProject() {
    if (!selectedProject || !window.confirm(t("Delete this project and its links? A recovery copy will be retained; papers and notes remain."))) return;
    await run("project-delete", async () => { await labviumRequest(`/projects/${encodeURIComponent(selectedProject.project_id)}`, { method: "DELETE", body: { expected_revision: selectedProject.project_revision, confirm: true } }); setSelectedProject(null); setNotice(t("Project removed. Papers and notes remain available.")); resource.retry(); });
  }
  async function updateLink(linkId: string, targetType: string) {
    if (!selectedProject || !linkDrafts[linkId]) return;
    await run("link", async () => { await labviumRequest(`/projects/${encodeURIComponent(selectedProject.project_id)}/${targetType === "paper" ? "paper-links" : "note-block-links"}/${encodeURIComponent(linkId)}`, { method: "PATCH", body: { changes: { link_type: linkDrafts[linkId] }, expected_links_revision: selectedProject.links_revision } }); setSelectedProject(await apiClient.getCompleteProject(selectedProject.project_id)); setLinkDrafts({}); resource.retry(); });
  }
  async function loadBlocks(id: string) { if (!id) { setBlocks(null); return; } await run("blocks", async () => { setBlocks(await apiClient.getNoteBlocks(id)); }); }
  async function removeBlock(id: string) {
    if (!blocks || !window.confirm(t("Delete this saved note block? Linked blocks must be unlinked from projects first. A recovery copy will be retained."))) return;
    await run("block-delete", async () => { await labviumRequest(`/papers/${encodeURIComponent(blocks.source_paper.paper_id)}/note-blocks/${encodeURIComponent(id)}`, { method: "DELETE", body: { expected_revision: blocks.note_blocks_revision, confirm: true } }); setBlocks(await apiClient.getNoteBlocks(blocks.source_paper.paper_id)); resource.retry(); });
  }
  async function loadPaper(id: string) {
    if (!id) { setSelectedPaper(null); return; }
    await run("paper", async () => { const paper = await apiClient.getPaper(id); setSelectedPaper(paper); setPriority(paper.priority); setFilename(paper.filename); setRebuiltProfile(null); });
  }
  async function savePriority() {
    if (!selectedPaper?.priority_revision || viewer) return;
    await run("priority", async () => { await labviumRequest(`/papers/${encodeURIComponent(selectedPaper.paper_id)}/priority`, {method:"PATCH",body:{priority,expected_revision:selectedPaper.priority_revision}}); setSelectedPaper(await apiClient.getPaper(selectedPaper.paper_id)); resource.retry(); });
  }
  async function renameAttachment() {
    if (!selectedPaper || viewer || !filename.trim() || filename === selectedPaper.filename) return;
    if (!/\.pdf$/i.test(filename) || /[\\/\0]/.test(filename) || filename.includes("..")) { setNotice(t("Use a PDF filename without directory paths.")); return; }
    if (!window.confirm(t("Update the managed PDF name? The paper identity and saved notes will stay the same."))) return;
    await run("rename", async () => { await labviumRequest(`/papers/${encodeURIComponent(selectedPaper.paper_id)}/rename-pdf`, {method:"POST",body:{filename:filename.trim(),expected_pdf_revision:selectedPaper.pdf_revision,confirm:true}}); const current = await apiClient.getPaper(selectedPaper.paper_id); setSelectedPaper(current); setFilename(current.filename); setNotice(t("Managed PDF name updated.")); resource.retry(); });
  }
  async function quarantineCache() {
    if (!selectedPaper || resource.status !== "success" || viewer || !window.confirm(t("Move the extracted text cache into recovery? The original PDF and saved notes will remain available."))) return;
    await run("quarantine", async () => { await labviumRequest(`/papers/${encodeURIComponent(selectedPaper.paper_id)}/full-text/quarantine`, {method:"POST",body:{expected_revision:resource.data.workspace.workspace_revision,confirm:true}}); setSelectedPaper(await apiClient.getPaper(selectedPaper.paper_id)); setNotice(t("Text cache moved to recovery. Use Reader to extract the text again.")); resource.retry(); });
  }
  async function rebuildProfile() {
    if (!selectedPaper || viewer) return;
    await run("profile", async () => {
      const current = await labviumRequest<{profile:Record<string,unknown>|null;profile_revision:string}>(`/papers/${encodeURIComponent(selectedPaper.paper_id)}/profile`);
      const result = await labviumRequest<{profile:Record<string,unknown>;profile_revision:string}>(`/papers/${encodeURIComponent(selectedPaper.paper_id)}/profile/rebuild`, {method:"POST",body:{expected_revision:current.profile_revision}});
      setRebuiltProfile(result.profile); setSelectedPaper(await apiClient.getPaper(selectedPaper.paper_id)); setNotice(t("Paper search profile rebuilt from saved data.")); resource.retry();
    });
  }
  async function reviewSimilarTags() { await run("similar-tags", async () => { const result = await labviumRequest<{items:SimilarTag[]}>("/tags/near-duplicates"); setSimilarTags(result.items); }); }
  async function previewTagMerge() {
    if (!sourceTag || !targetTag || sourceTag === targetTag) return;
    await run("tag-preview", async () => { setTagMergePreview(await labviumRequest<TagMergePreview>(`/tags/merge-preview?${new URLSearchParams({source_key:sourceTag,target_key:targetTag})}`)); });
  }
  async function mergeTags() {
    if (!tagMergePreview || viewer || !window.confirm(t("Apply this reviewed tag merge across the affected research records?"))) return;
    await run("tag-merge", async () => { await labviumRequest("/tags/merge", {method:"POST",body:{source_key:sourceTag,target_key:targetTag,expected_registry_revision:tagMergePreview.expected_registry_revision,preview_token:tagMergePreview.preview_token,confirm:true}}); setTagMergePreview(null); setSimilarTags(null); setNotice(t("Tag merge applied to the reviewed records.")); resource.retry(); });
  }
  return <div className="page-stack">
    <PageHeader title={t("Workspace maintenance")} description={t("Create verified backups, preview imports, and manage recovery through explicit actions.")} actions={<button className="reader-control reader-control--secondary" disabled={Boolean(busy)} onClick={resource.retry}><RefreshCw size={15} />{t("Refresh diagnostics")}</button>} />
    {resource.status === "loading" ? <LoadingState label={t("Loading workspace maintenance")} /> : resource.status !== "success" ? <ErrorState description={resource.message} onRetry={resource.retry} /> : <><fieldset className="lab-maintenance-fieldset" disabled={viewer}>
      {viewer ? <p role="status">{t("Read-only workspace")}</p> : null}
      <p className="muted-text">{t("Workspace contains {papers} papers, {projects} projects, and {pdfs} stored PDFs.", { papers: resource.data.workspace.paper_count, projects: resource.data.workspace.project_count, pdfs: resource.data.workspace.pdf_count })}</p>
      <div className="lab-maintenance-columns">
        <Section title={t("Backups and validated restore")} description={t(resource.data.workspace.mode === "cloud" ? "Cloud snapshots preserve account records and attached PDF references. Download a portable export separately and check its PDF coverage." : "Full backups include stored PDFs. Light backups preserve research records and require the PDFs separately.")}>
          <div className="lab-maintenance-stack"><label className="reader-field"><span>{t("Backup type")}</span><select value={backupKind} onChange={(event) => setBackupKind(event.target.value as "light" | "full")}><option value="full">{t(resource.data.workspace.mode === "cloud" ? "Full account snapshot" : "Full · records and PDFs")}</option><option value="light">{t("Light · records only")}</option></select></label><button className="reader-control" disabled={Boolean(busy)} onClick={() => void createBackup()}><Download size={15} />{t(busy === "backup" ? "Creating verified backup…" : "Create and download backup")}</button><button className="reader-control reader-control--secondary" disabled={Boolean(busy)} onClick={() => void exportPortable()}><Download size={15} />{t("Download workspace export")}</button><label className="reader-field"><span>{t("Preview a downloaded backup")}</span><input className="lab-file-input" type="file" accept=".json,application/json" disabled={Boolean(busy)} onChange={(event) => void uploadBackup(event)} /></label>
          {resource.data.backups.items.map((backup) => <div key={backup.backup_id} className="lab-editor-actions"><StatusBadge tone={backup.verified ? "green" : "amber"}>{t(backup.verified ? "Verified" : "Not verified")}</StatusBadge><span>{backup.kind} · {new Date(backup.created_at).toLocaleString()} · {(backup.size_bytes / 1024).toFixed(0)} KiB</span><button className="text-link" disabled={Boolean(busy)} onClick={() => void previewBackup(backup.backup_id)}>{t("Preview restore")}</button></div>)}
          {restorePreview ? <div className="lab-preview" role="region" aria-label={t("Restore preview")}><strong>{t("Restore preview")}</strong><p>{restorePreview.message}</p><ul><li>{t("{count} papers", { count: restorePreview.paper_count })}</li><li>{t("{count} projects", { count: restorePreview.project_count })}</li><li>{t("{count} PDFs missing from this backup", { count: restorePreview.missing_pdf_count })}</li></ul><button className="reader-control" disabled={!restorePreview.verified || Boolean(busy)} onClick={() => void restore()}><RotateCcw size={15} />{t("Confirm restore")}</button><button className="text-link" onClick={() => setRestorePreview(null)}>{t("Cancel")}</button></div> : null}</div>
        </Section>
        {supports("note_import") ? <Section title={t("External research notes")} description={t("Import Markdown, text, or DOCX after reviewing the source, matching paper, and candidate blocks.")}><div className="lab-maintenance-stack"><input aria-label={t("Choose external note")} className="lab-file-input" type="file" accept=".md,.markdown,.txt,.docx" disabled={Boolean(busy)} onChange={(event) => void readNote(event)} /><label className="reader-field"><span>{t("Target paper")}</span><select value={targetPaperId} onChange={(event) => { setTargetPaperId(event.target.value); setImportPreview(null); }}><option value="">{t("Select a paper")}</option>{resource.data.papers.map((paper) => <option key={paper.paper_id} value={paper.paper_id}>{paper.title}</option>)}</select></label>{sourceName ? <><p>{sourceName}</p><details><summary>{t("Read extracted note text")}</summary><pre className="lab-note-preview">{sourceContent}</pre></details><button className="reader-control reader-control--secondary" disabled={Boolean(busy)} onClick={() => void previewNote()}><FileUp size={15} />{t("Preview note import")}</button></> : null}{importPreview ? <div className="lab-preview"><strong>{t("Import preview")}</strong><p>{t("{count} candidate blocks", { count: importPreview.block_candidates.length })}</p>{importPreview.block_candidates.map((block, index) => <article key={index}><strong>{block.title || block.block_type || t("Block text")}</strong><p>{block.text || ""}</p></article>)}{importPreview.matching_papers.map((paper) => <button className="text-link" key={paper.paper_id} onClick={() => setTargetPaperId(paper.paper_id)}>{paper.title}</button>)}{importPreview.duplicate ? <p role="status">{t("This source has already been imported. No duplicate import will be applied.")}</p> : <button className="reader-control" disabled={!targetPaperId || Boolean(busy)} onClick={() => void applyNote()}>{t("Confirm note import")}</button>}</div> : null}</div></Section> : null}
        <Section title={t("PDF folder inbox")} description={t("Select files or a folder to copy PDFs into the workspace. Original files are retained; duplicates are checked by content hash.")}><div className="lab-maintenance-stack"><label className="reader-field"><span>{t("Upload PDFs")}</span><input className="lab-file-input" type="file" accept="application/pdf,.pdf" multiple disabled={Boolean(busy)} onChange={(event) => void uploadPdfs(event)} /></label><label className="reader-field"><span>{t("Choose a PDF folder")}</span><input className="lab-file-input" type="file" multiple {...{ webkitdirectory: "", directory: "" }} disabled={Boolean(busy)} onChange={(event) => void uploadPdfs(event)} /></label>{pdfResult ? <div role="status"><p>{pdfResult.message}</p>{pdfResult.results.map((row, index) => <p key={`${row.filename}-${index}`}>{row.filename}: {row.status} · {row.message}</p>)}</div> : null}</div></Section>
        <Section title={t("Recovery copies")} description={t("A recovery copy is retained before supported destructive changes. Restore only after reviewing the affected records.")}><div className="lab-maintenance-stack">{resource.data.recovery.items.length ? resource.data.recovery.items.map((item) => <div key={item.recovery_id} className="lab-preview"><strong>{item.summary}</strong><p>{item.kind} · {new Date(item.created_at).toLocaleString()}</p>{recoveryDownload(item.download_url) ? <a className="text-link" href={recoveryDownload(item.download_url)} download><Download size={14} />{t("Download recovery copy")}</a> : null}<button className="reader-control reader-control--secondary" disabled={Boolean(busy)} onClick={() => { if (window.confirm(t("Restore this recovery copy into the workspace?"))) void run("recovery", async () => { await labviumRequest(`/recovery/${encodeURIComponent(item.recovery_id)}/restore`, { method: "POST", body: { expected_revision: resource.data.workspace.workspace_revision, confirm: true } }); setNotice(t("Recovery copy restored.")); resource.retry(); }); }}><RotateCcw size={15} />{t("Restore recovery copy")}</button></div>) : <p className="muted-text">{t("No recovery copies are currently available.")}</p>}</div></Section>
      </div>
      <Section title={t("Archived papers")}>
        {resource.data.papers.filter((paper) => paper.archived).map((paper) => <div className="lab-editor-actions" key={paper.paper_id}><Archive size={15} /><span>{paper.title}</span><button className="reader-control reader-control--secondary" disabled={Boolean(busy)} onClick={() => void run("paper-restore", async () => { const current = await apiClient.getPaper(paper.paper_id); await labviumRequest(`/papers/${encodeURIComponent(paper.paper_id)}/unarchive`, { method: "POST", body: { expected_lifecycle_revision: current.lifecycle_revision, confirm: true } }); setNotice(t("Paper restored to the active library.")); resource.retry(); })}><RotateCcw size={14} />{t("Restore paper")}</button></div>)}
        {!resource.data.papers.some((paper) => paper.archived) ? <p className="muted-text">{t("No archived papers.")}</p> : null}
      </Section>
      <Section title={t("Project links and lifecycle")}><label className="reader-field"><span>{t("Select a project")}</span><select value={selectedProject?.project_id || ""} disabled={Boolean(busy)} onChange={(event) => void loadProject(event.target.value)}><option value="">{t("Select a project")}</option>{resource.data.projects.map((project) => <option key={project.project_id} value={project.project_id}>{project.name}</option>)}</select></label>{selectedProject ? <><div className="lab-editor-actions"><StatusBadge>{selectedProject.status}</StatusBadge>{selectedProject.status === "archived" ? <button className="reader-control reader-control--secondary" disabled={Boolean(busy)} onClick={() => void restoreProject()}><RotateCcw size={14} />{t("Restore project")}</button> : null}<button className="reader-control reader-control--danger" disabled={Boolean(busy)} onClick={() => void removeProject()}><Trash2 size={14} />{t("Delete project with recovery")}</button></div><DataTableShell label={t("Project relationships")}><table><thead><tr><th>{t("Source")}</th><th>{t("Relationship")}</th><th>{t("Action")}</th></tr></thead><tbody>{selectedProject.links.map((link) => <tr key={link.link_id}><td>{link.paper?.title || link.note_block?.title || link.target_id}</td><td><select aria-label={t("Relationship")} value={linkDrafts[link.link_id] || link.link_type} disabled={Boolean(busy) || selectedProject.status === "archived"} onChange={(event) => setLinkDrafts({ ...linkDrafts, [link.link_id]: event.target.value as ProjectLinkType })}>{LINK_TYPES.map((type) => <option key={type} value={type}>{t(type.replaceAll("_", " "))}</option>)}</select></td><td><button className="reader-control reader-control--secondary" disabled={Boolean(busy) || !linkDrafts[link.link_id]} onClick={() => void updateLink(link.link_id, link.target_type)}><Link2 size={14} />{t("Save relationship")}</button></td></tr>)}</tbody></table></DataTableShell></> : null}</Section>
      <Section title={t("Saved note blocks")}><label className="reader-field"><span>{t("Select a paper")}</span><select value={blocks?.source_paper.paper_id || ""} disabled={Boolean(busy)} onChange={(event) => void loadBlocks(event.target.value)}><option value="">{t("Select a paper")}</option>{resource.data.papers.map((paper) => <option key={paper.paper_id} value={paper.paper_id}>{paper.title}</option>)}</select></label>{blocks?.items.map((block) => <div key={block.id} className="lab-editor-actions"><span>{block.title || block.block_type}</span><button className="reader-control reader-control--danger" disabled={Boolean(busy)} onClick={() => void removeBlock(block.id)}><Trash2 size={14} />{t("Delete block with recovery")}</button></div>)}</Section>
      <Section title={t("Paper metadata and cache recovery")}><label className="reader-field"><span>{t("Select a paper")}</span><select value={selectedPaper?.paper_id || ""} disabled={Boolean(busy)} onChange={(event) => void loadPaper(event.target.value)}><option value="">{t("Select a paper")}</option>{resource.data.papers.map((paper) => <option key={paper.paper_id} value={paper.paper_id}>{paper.title}</option>)}</select></label>{selectedPaper ? <div className="lab-maintenance-stack">
        {selectedPaper.priority_revision ? <div className="lab-editor-actions"><label className="reader-field"><span>{t("Reading priority")}</span><select value={priority} disabled={Boolean(busy)} onChange={(event) => setPriority(event.target.value)}>{["low","normal","high"].map((value) => <option value={value} key={value}>{t(value)}</option>)}</select></label><button className="reader-control reader-control--secondary" disabled={Boolean(busy) || priority === selectedPaper.priority} onClick={() => void savePriority()}>{t("Save priority")}</button></div> : null}
        {supports("rename_pdf") ? <div className="lab-maintenance-stack"><label className="reader-field"><span>{t("Managed PDF filename")}</span><input value={filename} maxLength={255} disabled={Boolean(busy)} onChange={(event) => setFilename(event.target.value)} /></label><p>{selectedPaper.filename} → {filename}</p><p className="muted-text">{t("This changes the managed attachment name. It does not rename your original uploaded file or change the paper identity.")}</p><button className="reader-control reader-control--secondary" disabled={Boolean(busy) || !filename.trim() || filename === selectedPaper.filename} onClick={() => void renameAttachment()}>{t("Confirm PDF name change")}</button></div> : null}
        {supports("cache_quarantine") ? <button className="reader-control reader-control--secondary" disabled={Boolean(busy) || !selectedPaper.extracted_text_available} onClick={() => void quarantineCache()}>{t("Quarantine text cache with recovery")}</button> : null}
        {supports("profile_rebuild") ? <><p className="muted-text">{t("Rebuild the search profile from saved metadata and text. This does not generate new research findings.")}</p><button className="reader-control reader-control--secondary" disabled={Boolean(busy)} onClick={() => void rebuildProfile()}>{t("Rebuild paper search profile")}</button>{rebuiltProfile ? <details><summary>{t("Inspect rebuilt profile")}</summary><pre className="lab-note-preview">{JSON.stringify(rebuiltProfile,null,2)}</pre></details> : null}</> : null}
      </div> : null}</Section>
      {supports("tag_merge") ? <Section title={t("Review and merge canonical tags")} description={t("Preview every affected paper, block, and project before merging. Similar names do not prove identical meaning.")}>
        {supports("near_duplicate_tags") ? <><button className="reader-control reader-control--secondary" disabled={Boolean(busy)} onClick={() => void reviewSimilarTags()}>{t("Review similar tag names")}</button>{similarTags ? <div className="lab-maintenance-stack">{similarTags.length ? similarTags.map((pair) => <div className="lab-editor-actions" key={`${pair.source_key}-${pair.target_key}`}><span>{pair.source_label} → {pair.target_label}</span><span className="muted-text">{pair.reason}</span><button className="text-link" disabled={Boolean(busy)} onClick={() => {setSourceTag(pair.source_key);setTargetTag(pair.target_key);setTagMergePreview(null);}}>{t("Review this pair")}</button></div>) : <p className="muted-text">{t("No similar tag names were found.")}</p>}</div> : null}</> : null}
        <div className="project-form-grid"><label className="reader-field"><span>{t("Merge this source tag")}</span><select value={sourceTag} onChange={(event) => {setSourceTag(event.target.value);setTagMergePreview(null);}} disabled={Boolean(busy)}><option value="">{t("Select a tag")}</option>{resource.data.tags.map((tag) => <option value={tag.canonical_key} key={tag.canonical_key}>{tag.label}</option>)}</select></label><label className="reader-field"><span>{t("Keep this target tag")}</span><select value={targetTag} onChange={(event) => {setTargetTag(event.target.value);setTagMergePreview(null);}} disabled={Boolean(busy)}><option value="">{t("Select a tag")}</option>{resource.data.tags.filter((tag) => tag.canonical_key !== sourceTag).map((tag) => <option value={tag.canonical_key} key={tag.canonical_key}>{tag.label}</option>)}</select></label></div>
        <button className="reader-control reader-control--secondary" disabled={Boolean(busy) || !sourceTag || !targetTag || sourceTag === targetTag} onClick={() => void previewTagMerge()}>{t("Preview tag merge")}</button>
        {tagMergePreview ? <div className="lab-preview"><p>{tagMergePreview.message}</p><p>{t("Affected records: {papers} papers, {blocks} blocks, {projects} projects.",{papers:tagMergePreview.affected_paper_count,blocks:tagMergePreview.affected_block_count,projects:tagMergePreview.affected_project_count})}</p><button className="reader-control" disabled={Boolean(busy)} onClick={() => void mergeTags()}>{t("Confirm reviewed tag merge")}</button><button className="text-link" onClick={() => setTagMergePreview(null)}>{t("Cancel")}</button></div> : null}
      </Section> : null}
      <Section title={t("Data integrity")} description={resource.data.settings.data_integrity.summary}>{resource.data.settings.data_integrity.issues.map((issue) => <p key={issue.code}><StatusBadge tone={issue.state === "healthy" ? "slate" : "amber"}>{issue.state}</StatusBadge> {issue.explanation} {issue.next_action}</p>)}<button className="reader-control reader-control--secondary" disabled={Boolean(busy)} onClick={resource.retry}><RefreshCw size={14} />{t("Refresh diagnostics")}</button></Section>
    </fieldset>{viewer ? <button className="reader-control reader-control--secondary" disabled={Boolean(busy)} onClick={() => void exportPortable()}><Download size={15} />{t("Download workspace export")}</button> : null}</>}
    {getWorkspaceMode() === "cloud" ? <details className="tag-advanced-details"><summary>{t("Advanced recovery export")}</summary><p>{t("Preserve the exact saved workspace bytes for manual recovery. This does not repair or replace your data.")}</p><button className="reader-control reader-control--secondary" disabled={Boolean(busy)} onClick={() => void downloadRawWorkspace().catch((error) => setNotice(readableError(error)))}>{t("Download original saved bytes")}</button></details> : null}
    {notice ? <p role="status" className="reader-editor__status">{notice}</p> : null}
  </div>;
}
