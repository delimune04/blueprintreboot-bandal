"use client";

import { BookOpen, ChevronDown, FileText, Plus, Save, Trash2, ArrowUp, ArrowDown, ExternalLink, Archive, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { ErrorState, LoadingState } from "../components/AsyncStates";
import { StatusBadge } from "../components/StatusBadge";
import { useApiResource } from "../hooks/useApiResource";
import { apiClient, getWorkspaceMode, getWorkspaceRole, labviumRequest } from "../lib/api/client";
import { useI18n } from "../lib/i18n/LocaleProvider";
import { flattenResearchPageTree, newResearchBlock, researchPageInput, safeResearchUrl } from "../lib/workspace/pages.mjs";
import { createResearchTemplate, RESEARCH_TEMPLATES } from "../lib/workspace/templates.mjs";
import type { ResearchBlock, ResearchPage, ResearchPageInput, ResearchPageResponse, ResearchPages } from "../lib/workspace/types";
import "../lib/workspace/workspace.css";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "The operation could not be completed."; }

export function ResearchWorkspaceView() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const requestedPageId = searchParams.get("page") || "";
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<ResearchPageInput | null>(null);
  const [baseline, setBaseline] = useState<ResearchPageInput | null>(null);
  const [revision, setRevision] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [templateId, setTemplateId] = useState("blank");
  const viewer = getWorkspaceRole() === "viewer";
  const resource = useApiResource(`research-pages:${requestedPageId}`, async () => {
    const [pages, papers, projects] = await Promise.all([labviumRequest<ResearchPages>("/research/pages"), apiClient.getAllPapers({ archiveStatus: "all" }), apiClient.getAllProjects()]);
    if (requestedPageId) {
      const requested = pages.items.find((page) => page.id === requestedPageId);
      if (requested) { const input = researchPageInput(requested); setSelectedId(requested.id); setDraft(input); setBaseline(input); setRevision(pages.revision); setShowArchived(requested.archived); }
    }
    return { pages, papers, projects };
  });
  const dirty = Boolean(draft && baseline && !same(draft, baseline));
  const pages = resource.status === "success" ? resource.data.pages.items : [];
  const selected = pages.find((page) => page.id === selectedId);
  const tree = flattenResearchPageTree(pages, showArchived);

  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => { if (event.defaultPrevented || event.button !== 0) return; const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null; if (!anchor || anchor.getAttribute("href") === "#main-content") return; if (!window.confirm(t("Discard the unsaved changes to this research page?"))) { event.preventDefault(); event.stopPropagation(); } };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, [dirty, t]);

  function select(page: ResearchPage) {
    if (dirty && !window.confirm(t("Discard the unsaved changes to this research page?"))) return;
    const input = researchPageInput(page); setSelectedId(page.id); setDraft(input); setBaseline(input);
    if (resource.status === "success") setRevision(resource.data.pages.revision);
    setNotice("");
  }
  async function create(parentId: string | null) {
    if (busy || viewer || (dirty && !window.confirm(t("Discard the unsaved changes to this research page?")))) return;
    setBusy(true); setNotice("");
    try {
      const input = createResearchTemplate(templateId, t, parentId);
      const result = await labviumRequest<ResearchPageResponse>("/research/pages", { method: "POST", body: { page: input } });
      resource.updateData((data) => ({ ...data, pages: { items: [...data.pages.items, result.page], revision: result.revision } }));
      setSelectedId(result.page.id); setDraft(researchPageInput(result.page)); setBaseline(researchPageInput(result.page)); setRevision(result.revision);
      setNotice(t("Research page created."));
    } catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); }
  }
  async function save() {
    if (!draft || !selectedId || busy || viewer || !dirty) return;
    const submitted = structuredClone(draft); setBusy(true); setNotice("");
    try {
      const result = await labviumRequest<ResearchPageResponse>(`/research/pages/${encodeURIComponent(selectedId)}`, { method: "PUT", body: { page: submitted, expected_revision: revision } });
      const saved = researchPageInput(result.page);
      setBaseline(saved); setRevision(result.revision);
      setDraft(saved);
      resource.updateData((data) => ({ ...data, pages: { items: data.pages.items.map((page) => page.id === result.page.id ? result.page : page), revision: result.revision } }));
      setNotice(t("Research page saved."));
    } catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); }
  }
  async function archivePage(archived: boolean) {
    if (!selected || busy || viewer || dirty || !window.confirm(t(archived ? "Archive this page? Its content and child pages will be retained." : "Restore this archived page?"))) return;
    setBusy(true);
    try {
      const result = await labviumRequest<ResearchPageResponse>(`/research/pages/${encodeURIComponent(selectedId)}/${archived ? "archive" : "unarchive"}`, { method: "POST", body: { expected_revision: revision, confirm: true } });
      setRevision(result.revision); resource.updateData((data) => ({ ...data, pages: { items: data.pages.items.map((page) => page.id === result.page.id ? result.page : page), revision: result.revision } }));
      setShowArchived(archived); setNotice(t(archived ? "Page archived. Its content is retained." : "Page restored."));
    } catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); }
  }
  function updateBlock(id: string, changes: Partial<ResearchBlock>) { setDraft((current) => current ? { ...current, blocks: current.blocks.map((block) => block.id === id ? { ...block, ...changes } : block) } : current); }
  function moveBlock(index: number, direction: number) { setDraft((current) => { if (!current) return current; const blocks = [...current.blocks]; [blocks[index], blocks[index + direction]] = [blocks[index + direction], blocks[index]]; return { ...current, blocks }; }); }
  function addWebSource(block: ResearchBlock) {
    const value = window.prompt(t("Paste the source URL (HTTP or HTTPS).")); if (!value) return;
    const url = safeResearchUrl(value); if (!url) { setNotice(t("Source links must use HTTP or HTTPS.")); return; }
    updateBlock(block.id, { source_links: [...block.source_links, { paper_id: "", url, label: url }] });
  }
  function exportPage() {
    if (!draft) return;
    const blocks = draft.blocks.map((block) => `${block.type === "heading" ? "## " : block.type === "quote" ? "> " : block.type === "checklist" ? `- [${block.checked ? "x" : " "}] ` : ""}${block.text}\n${block.source_links.map((source) => `Source: ${source.label} ${source.url || source.paper_id}`).join("\n")}\n${block.provenance === "ai" ? "Provenance: AI draft, requires verification\n" : ""}`).join("\n");
    const body = `# ${draft.title}\n\n${blocks}\n## Verified facts\n${draft.handoff.verified_facts}\n\n## Open questions\n${draft.handoff.open_questions}\n\n## Next steps\n${draft.handoff.next_steps}\n\nOwner: ${draft.handoff.owner}\n`;
    const url = URL.createObjectURL(new Blob([body], { type: "text/markdown;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "research-page.md"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const readonly = busy || selected?.archived || viewer;
  return <div className="page-stack lab-workspace-page">
    <PageHeader title={t("Research workspace")} description={t("Turn reading into a connected research notebook. Pages and blocks save only when you choose Save.")} actions={<div className="lab-editor-actions">{viewer ? <StatusBadge>{t("Read-only workspace")}</StatusBadge> : null}<select aria-label={t("Research page template")} value={templateId} onChange={(event) => setTemplateId(event.target.value)} disabled={busy || viewer}>{RESEARCH_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{t(template.label)}</option>)}</select><button className="reader-control" onClick={() => void create(null)} disabled={busy || viewer}><Plus size={15} />{t("New page")}</button></div>} />
    {resource.status === "loading" ? <LoadingState label={t("Loading research pages")} /> : resource.status !== "success" ? <ErrorState description={resource.message} onRetry={resource.retry} /> : <div className="lab-workspace-grid">
      <aside className="lab-page-tree" aria-label={t("Research page tree")}>
        <div className="lab-tree-toolbar"><strong><BookOpen size={16} /> {t("Pages")}</strong><label><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> {t("Archived")}</label></div>
        {tree.length ? tree.map(({ page, depth }) => <button key={page.id} className="lab-tree-row" data-selected={page.id === selectedId} disabled={busy} style={{ paddingInlineStart: `${12 + depth * 16}px` }} onClick={() => select(page)}><FileText size={14} /><span>{page.title}</span>{page.archived ? <Archive size={12} /> : null}</button>) : <p className="muted-text">{t("Create a page to begin your research notebook.")}</p>}
      </aside>
      <main className="lab-page-editor">
        {!draft ? <Section title={t("A place for your research") }><p>{t("Create a page, add evidence blocks, and connect the source papers and project.")}</p><button className="reader-control" disabled={viewer} onClick={() => void create(null)}><Plus size={15} />{t("New page")}</button></Section> : <>
          <div className="lab-editor-actions"><StatusBadge tone={dirty ? "amber" : "slate"}>{t(dirty ? "Unsaved changes" : "Saved")}</StatusBadge><button className="reader-control" onClick={() => void save()} disabled={!dirty || Boolean(readonly) || !draft.title.trim()}><Save size={15} />{t(busy ? "Saving…" : "Save page")}</button><button className="reader-control reader-control--secondary" onClick={exportPage}>{t("Export Markdown")}</button><button className="reader-control reader-control--secondary" onClick={() => void create(selectedId)} disabled={Boolean(readonly)}><Plus size={15} />{t("Child page")}</button><button className="reader-control reader-control--secondary" disabled={busy || dirty || viewer} onClick={() => void archivePage(!selected?.archived)}>{selected?.archived ? <RotateCcw size={15} /> : <Archive size={15} />}{t(selected?.archived ? "Restore page" : "Archive page")}</button></div>
          <label className="reader-field lab-page-title"><span className="sr-only">{t("Page title")}</span><input value={draft.title} maxLength={200} onChange={(event) => setDraft({ ...draft, title: event.target.value })} disabled={Boolean(readonly)} placeholder={t("Untitled research page")} /></label>
          <div className="project-form-grid">
            <label className="reader-field"><span>{t("Parent page")}</span><select value={draft.parent_id || ""} onChange={(event) => setDraft({ ...draft, parent_id: event.target.value || null })} disabled={Boolean(readonly)}><option value="">{t("Top level")}</option>{pages.filter((page) => page.id !== selectedId && !page.archived).map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}</select></label>
            <label className="reader-field"><span>{t("Linked project")}</span><select value={draft.project_id} onChange={(event) => setDraft({ ...draft, project_id: event.target.value })} disabled={Boolean(readonly)}><option value="">{t("No project")}</option>{resource.data.projects.map((project) => <option key={project.project_id} value={project.project_id}>{project.name}</option>)}</select></label>
          </div>
          {draft.project_id ? <Link className="text-link" href={`/projects/${encodeURIComponent(draft.project_id)}`}>{t("Open linked project")} <ExternalLink size={13} /></Link> : null}
          <Section title={t("Research blocks")} description={t("Keep your interpretation beside its source. Pasted AI text is marked separately and must be verified.")}>
            <div className="lab-block-list">{draft.blocks.map((block, index) => <article key={block.id} className="lab-research-block" data-kind={block.type}>
              <div className="lab-block-toolbar"><ChevronDown size={14} /><select aria-label={t("Block type")} value={block.type} disabled={Boolean(readonly)} onChange={(event) => updateBlock(block.id, { type: event.target.value as ResearchBlock["type"] })}>{["paragraph", "heading", "quote", "checklist"].map((type) => <option key={type} value={type}>{t(type)}</option>)}</select><select aria-label={t("Content provenance")} value={block.provenance} disabled={Boolean(readonly)} onChange={(event) => updateBlock(block.id, { provenance: event.target.value as ResearchBlock["provenance"] })}><option value="manual">{t("Manual research")}</option><option value="ai">{t("AI draft · unverified")}</option></select><span className="lab-flex-spacer" /><button className="icon-button" aria-label={t("Move block up")} disabled={Boolean(readonly) || index === 0} onClick={() => moveBlock(index, -1)}><ArrowUp size={14} /></button><button className="icon-button" aria-label={t("Move block down")} disabled={Boolean(readonly) || index === draft.blocks.length - 1} onClick={() => moveBlock(index, 1)}><ArrowDown size={14} /></button><button className="icon-button" aria-label={t("Remove block from draft")} disabled={Boolean(readonly)} onClick={() => setDraft({ ...draft, blocks: draft.blocks.filter((row) => row.id !== block.id) })}><Trash2 size={14} /></button></div>
              <div className="lab-block-content">{block.type === "checklist" ? <input aria-label={t("Task completed")} type="checkbox" checked={block.checked} disabled={Boolean(readonly)} onChange={(event) => updateBlock(block.id, { checked: event.target.checked })} /> : null}<textarea aria-label={t("Block text")} rows={block.type === "heading" ? 1 : 3} value={block.text} maxLength={100000} disabled={Boolean(readonly)} placeholder={t("Write your research note…")} onChange={(event) => updateBlock(block.id, { text: event.target.value })} /></div>
              {block.provenance === "ai" ? <p className="lab-provenance-note">{t("AI draft. Verify the claim against the linked source before using it as a fact.")}</p> : null}
              <div className="lab-block-sources">{block.source_links.map((source, sourceIndex) => <span className="lab-source-link" key={`${source.paper_id}-${source.url}-${sourceIndex}`}>{source.paper_id ? <Link href={`/papers/${encodeURIComponent(source.paper_id)}/reader`}>{source.label || source.paper_id}</Link> : safeResearchUrl(source.url) ? <a href={safeResearchUrl(source.url)} target="_blank" rel="noreferrer">{source.label || source.url}</a> : null}<button aria-label={t("Remove source link")} disabled={Boolean(readonly)} onClick={() => updateBlock(block.id, { source_links: block.source_links.filter((_, i) => i !== sourceIndex) })}>×</button></span>)}<select aria-label={t("Add a source paper")} value="" disabled={Boolean(readonly)} onChange={(event) => { const paper = resource.data.papers.find((row) => row.paper_id === event.target.value); if (paper) updateBlock(block.id, { source_links: [...block.source_links, { paper_id: paper.paper_id, url: "", label: paper.title }] }); }}><option value="">{t("Add source paper…")}</option>{resource.data.papers.map((paper) => <option key={paper.paper_id} value={paper.paper_id}>{paper.title}</option>)}</select><button className="text-link" onClick={() => addWebSource(block)} disabled={Boolean(readonly)}>{t("Add web source")}</button></div>
              {block.type === "checklist" ? <label className="reader-field"><span>{t("Task owner")}</span><input value={block.owner} maxLength={200} onChange={(event) => updateBlock(block.id, { owner: event.target.value })} disabled={Boolean(readonly)} /></label> : null}
            </article>)}</div>
            <button className="reader-control reader-control--secondary" disabled={Boolean(readonly)} onClick={() => setDraft({ ...draft, blocks: [...draft.blocks, newResearchBlock()] })}><Plus size={15} />{t("Add block")}</button>
          </Section>
          <Section title={t("Research handoff")} description={t("Keep verified facts, unresolved questions, and next actions separate for the next researcher.")}>
            <div className="lab-handoff-grid">{([['verified_facts', 'Verified facts'], ['open_questions', 'Open questions'], ['next_steps', 'Next steps']] as const).map(([key, label]) => <label key={key} className="reader-field"><span>{t(label)}</span><textarea rows={4} maxLength={100000} value={draft.handoff[key]} disabled={Boolean(readonly)} onChange={(event) => setDraft({ ...draft, handoff: { ...draft.handoff, [key]: event.target.value } })} /></label>)}</div>
            <label className="reader-field"><span>{t("Handoff owner")}</span><input value={draft.handoff.owner} maxLength={200} disabled={Boolean(readonly)} onChange={(event) => setDraft({ ...draft, handoff: { ...draft.handoff, owner: event.target.value } })} /></label>
          </Section>
        </>}
        {notice ? <p role="status" className="reader-editor__status">{notice}</p> : null}
        <p className="muted-text">{t(getWorkspaceMode() === "cloud" ? "Saved pages belong to your signed-in account." : "Guest pages are saved in this browser. Export a backup before clearing browser data.")}</p>
      </main>
    </div>}
  </div>;
}
