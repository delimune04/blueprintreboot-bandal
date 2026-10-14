"use client";

import { ExternalLink, Search, BookOpen, Network, ArrowLeft, Plus } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { EmptyState } from "../components/AsyncStates";
import { StatusBadge } from "../components/StatusBadge";
import { apiClient, getWorkspaceRole, labviumRequest } from "../lib/api/client";
import { useI18n } from "../lib/i18n/LocaleProvider";
import { blankResearchPage, newResearchBlock, safeResearchUrl } from "../lib/workspace/pages.mjs";
import type { DiscoveryResponse, ResearchPageResponse, ScholarlyAuthor, ScholarlyWork } from "../lib/workspace/types";
import "../lib/workspace/workspace.css";

type AuthorResult = ScholarlyAuthor & { works_count?: number; cited_by_count?: number; source?: string; updated_date?: string };
type Results = { items: Array<ScholarlyWork | AuthorResult>; total: number; q: string; provider: string; retrieved_at?: string; warnings?: string[] };
function isWork(item: ScholarlyWork | AuthorResult): item is ScholarlyWork { return "title" in item; }
function openAlexId(value: string) { return /(?:^|\/)(W\d+)\b/.exec(value)?.[1] || ""; }

export function DiscoverView() {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("crossref");
  const [mode, setMode] = useState("works");
  const [results, setResults] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [relatedTitle, setRelatedTitle] = useState("");
  const [lookupTime, setLookupTime] = useState("");
  const [savingId, setSavingId] = useState("");
  const sequence = useRef(0);
  async function search(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault(); if (!query.trim() || busy) return;
    const token = ++sequence.current; setBusy(true); setNotice(""); setRelatedTitle("");
    try {
      const params = new URLSearchParams({ q: query.trim(), provider: mode === "authors" ? "openalex" : provider, mode, limit: "20" });
      const response = await labviumRequest<Results>(`/discover?${params}`);
      if (token !== sequence.current) return;
      setResults(response); setLookupTime(response.retrieved_at || new Date().toISOString());
    } catch (error) { if (token === sequence.current) setNotice(error instanceof Error ? error.message : t("Scholarly search is unavailable. Try again later.")); }
    finally { if (token === sequence.current) setBusy(false); }
  }
  async function related(work: ScholarlyWork, relation: "references" | "cited_by") {
    const id = openAlexId(work.id); if (!id || busy) return;
    const token = ++sequence.current; setBusy(true); setNotice("");
    try {
      const response = await labviumRequest<DiscoveryResponse>(`/discover/related?${new URLSearchParams({ openalex_id: id, relation, limit: "20" })}`);
      if (token !== sequence.current) return;
      setResults(response); setLookupTime(response.retrieved_at || new Date().toISOString()); setRelatedTitle(`${t(relation === "references" ? "References of" : "Works citing")} ${work.title}`);
    } catch (error) { if (token === sequence.current) setNotice(error instanceof Error ? error.message : t("Citation links could not be loaded.")); }
    finally { if (token === sequence.current) setBusy(false); }
  }
  async function selectLibraryTopic() {
    if (busy) return; setBusy(true);
    try { const papers = await apiClient.getAllPapers({ archiveStatus: "active" }); const paper = papers.find((row) => row.status === "reading") || papers[0]; if (paper) { setQuery(paper.tags.length ? paper.tags.join(" ") : paper.title); setNotice(t("Library topic selected. Choose Search to retrieve current results.")); } else setNotice(t("Add a paper to your library before selecting a library topic.")); }
    catch (error) { setNotice(error instanceof Error ? error.message : t("The library could not be read.")); }
    finally { setBusy(false); }
  }
  async function saveToResearch(work: ScholarlyWork) {
    if (savingId || getWorkspaceRole() === "viewer") return; setSavingId(work.id);
    try {
      const block = newResearchBlock("paragraph"); block.text = work.abstract || ""; block.source_links = [{ paper_id: "", url: safeResearchUrl(work.url) || (work.doi ? `https://doi.org/${encodeURIComponent(work.doi)}` : ""), label: work.title }];
      const input = { ...blankResearchPage(), title: work.title.slice(0, 200), blocks: [block], handoff: { verified_facts: "", open_questions: "", next_steps: "Read the source and record whether it supports the research question.", owner: "" } };
      await labviumRequest<ResearchPageResponse>("/research/pages", { method: "POST", body: { page: input } });
      setNotice(t("Source saved as a research page. Review the original before recording verified facts."));
    } catch (error) { setNotice(error instanceof Error ? error.message : t("The source could not be saved.")); }
    finally { setSavingId(""); }
  }
  const retrieved = lookupTime ? new Date(lookupTime).toLocaleString(locale === "ko" ? "ko-KR" : "en-US") : "";
  return <div className="page-stack">
    <PageHeader title={t("Discover research")} description={t("Search scholarly sources, follow citation connections, and preserve the evidence for your own research.")} />
    <Section title={t("Find related work")}>
      <form className="lab-discover-form" onSubmit={(event) => void search(event)}>
        <label className="reader-field"><span>{t("Topic, title, DOI, or author")}</span><input required value={query} maxLength={500} onChange={(event) => setQuery(event.target.value)} placeholder={t("e.g. carbon storage caprock monitoring")} /></label>
        <label className="reader-field"><span>{t("Search mode")}</span><select value={mode} onChange={(event) => setMode(event.target.value)}><option value="works">{t("Papers")}</option><option value="authors">{t("Author profiles")}</option></select></label>
        <label className="reader-field"><span>{t("Source")}</span><select value={mode === "authors" ? "openalex" : provider} disabled={mode === "authors"} onChange={(event) => setProvider(event.target.value)}><option value="crossref">Crossref</option><option value="arxiv">arXiv</option><option value="openalex">OpenAlex</option></select></label>
        <button className="reader-control" type="submit" disabled={busy || !query.trim()}><Search size={15} />{t(busy ? "Searching…" : "Search")}</button>
      </form>
      <button className="text-link" onClick={() => void selectLibraryTopic()} disabled={busy}><BookOpen size={14} />{t("Use a topic from my library")}</button>
      <p className="muted-text">{t("Relevance and citation connections guide discovery. Author h-index is supplementary context, affected by discipline, career length, and database coverage.")}</p>
    </Section>
    {notice ? <p className="reader-editor__status" role="status">{notice}</p> : null}
    {results ? <Section title={relatedTitle || t("Search results")} description={`${results.provider} · ${t("Retrieved")}: ${retrieved} · ${t("{count} results", { count: results.total })}`}>
      {relatedTitle ? <button className="reader-control reader-control--secondary" onClick={() => void search()} disabled={busy}><ArrowLeft size={14} />{t("Return to topic search")}</button> : null}
      {results.warnings?.map((warning, index) => <p role="status" className="muted-text" key={index}>{warning}</p>)}
      {!results.items.length ? <EmptyState title={t("No matching research found")} description={t("Try a broader topic or a different scholarly source.")} /> : <div className="lab-discovery-list">{results.items.map((item) => isWork(item) ? <article key={item.id} className="lab-discovery-row">
        <h2>{safeResearchUrl(item.url) ? <a href={safeResearchUrl(item.url)} target="_blank" rel="noreferrer">{item.title} <ExternalLink size={15} /></a> : item.title}</h2>
        <p>{item.authors?.join(", ") || t("Authors unavailable")}{item.year ? ` · ${item.year}` : ""}</p>
        {item.abstract ? <details><summary>{t("Read abstract")}</summary><p>{item.abstract}</p></details> : <p className="muted-text">{t("Abstract unavailable from this source.")}</p>}
        <div className="lab-result-metadata"><span>{t("Source")}: {item.source || results.provider}</span><span>{t("Citations")}: {item.cited_by_count == null ? t("Unavailable") : item.cited_by_count}</span>{item.updated_at ? <span>{t("Source updated")}: {item.updated_at}</span> : null}{item.doi ? <span>DOI: {item.doi}</span> : null}</div>
        {item.topics?.length ? <div className="tag-list">{item.topics.map((topic) => <StatusBadge key={topic} presentation="chip">{topic}</StatusBadge>)}</div> : null}
        <div className="lab-result-actions"><button className="reader-control reader-control--secondary" disabled={Boolean(savingId) || getWorkspaceRole() === "viewer"} onClick={() => void saveToResearch(item)}><Plus size={14} />{t(savingId === item.id ? "Saving…" : "Save as research page")}</button>{openAlexId(item.id) ? <><button className="reader-control reader-control--secondary" disabled={busy} onClick={() => void related(item, "references")}><Network size={14} />{t("References")}</button><button className="reader-control reader-control--secondary" disabled={busy} onClick={() => void related(item, "cited_by")}>{t("Citing works")}</button></> : null}{safeResearchUrl(item.pdf_url) ? <a className="text-link" href={safeResearchUrl(item.pdf_url)} target="_blank" rel="noreferrer">{t("Source PDF")} <ExternalLink size={14} /></a> : null}</div>
      </article> : <article key={item.id} className="lab-discovery-row"><h2>{safeResearchUrl(item.url) ? <a href={safeResearchUrl(item.url)} target="_blank" rel="noreferrer">{item.name}</a> : item.name}</h2><p>{t("Verify this author identity before using the metrics. Names alone may refer to different researchers.")}</p><div className="lab-result-metadata"><span>OpenAlex h-index: {item.h_index == null ? t("Unavailable") : item.h_index}</span><span>{t("Works")}: {item.works_count ?? t("Unavailable")}</span><span>{t("Citations")}: {item.cited_by_count ?? t("Unavailable")}</span><span>{t("Source updated")}: {item.updated_date || item.updated_at || t("Unavailable")}</span></div><p className="muted-text">{t("This author-level metric does not establish the quality or correctness of an individual paper.")}</p></article>)}</div>}
    </Section> : <EmptyState title={t("Start with a research question")} description={t("Results come from the selected scholarly source when you run a search.")} />}
    <details className="tag-advanced-details"><summary>{t("Sources and metric interpretation")}</summary><p><a href="https://help.openalex.org/data/authors/" target="_blank" rel="noreferrer">OpenAlex author metrics</a> · <a href="https://www.crossref.org/documentation/retrieve-metadata/rest-api/" target="_blank" rel="noreferrer">Crossref REST API</a> · <a href="https://doi.org/10.1038/520429a" target="_blank" rel="noreferrer">Leiden Manifesto</a></p><p>{t("Provider omissions remain unavailable. No missing citation count or h-index is replaced with a guess.")}</p></details>
  </div>;
}
