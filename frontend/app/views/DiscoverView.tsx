"use client";

import { ExternalLink, Search, BookOpen, Network, ArrowLeft, Plus, Check, LibraryBig } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { EmptyState } from "../components/AsyncStates";
import { StatusBadge } from "../components/StatusBadge";
import { apiClient, getWorkspaceRole, labviumRequest } from "../lib/api/client";
import { useI18n } from "../lib/i18n/LocaleProvider";
import { safeResearchUrl } from "../lib/workspace/pages.mjs";
import { discoveryKeys } from "../lib/workspace/discovery-identity.mjs";
import type { DiscoveryResponse, ScholarlyAuthor, ScholarlyWork } from "../lib/workspace/types";
import "../lib/workspace/workspace.css";
import "../lib/workspace/discovery.css";

type AuthorResult = ScholarlyAuthor & { works_count?: number; cited_by_count?: number; source?: string; updated_date?: string; affiliations?: string[] };
export type DiscoverySort = "relevance" | "citations" | "newest" | "oldest" | "popularity";
export type SearchCriteria = { q: string; author: string; authorQuery: string; provider: string; mode: string; exactTitle: boolean; sort: DiscoverySort };
export type SearchResults = { items: Array<ScholarlyWork | AuthorResult>; total: number; q: string; provider: string; retrieved_at?: string; warnings?: string[]; sort?: string; provider_total?: number | null; duplicates_removed?: number; candidate_count?: number; sort_scope?: string; author?: string; exact_title?: boolean };
type DisplayWork = ScholarlyWork & { journal?: string; affiliations?: string[]; publication_date?: string; popularity_score?: number | null };
const initialCriteria: SearchCriteria = { q: "", author: "", authorQuery: "", provider: "all", mode: "works", exactTitle: false, sort: "relevance" };
const sortLabels: Record<DiscoverySort, [string, string]> = {
  relevance: ["관련도순", "Relevance"], citations: ["인용수 많은 순", "Most cited"], newest: ["최신순", "Newest first"], oldest: ["오래된순", "Oldest first"], popularity: ["인기도순 · 연평균 인용수", "Popularity · annual citations"],
};
function isWork(item: ScholarlyWork | AuthorResult): item is ScholarlyWork { return "title" in item; }
function openAlexId(value: string) { return /(?:^|\/)(W\d+)\b/.exec(value)?.[1] || ""; }
function arxivId(work: ScholarlyWork) { return work.arxiv_id || /(?:arxiv:|arxiv\.org\/(?:abs|pdf)\/)([^?#\s]+)/i.exec(`${work.id} ${work.url}`)?.[1]?.replace(/\.pdf$/, "") || ""; }
function textFor(locale: string, ko: string, en: string) { return locale === "ko" ? ko : en; }
function discoveryWarningMessage(warning: string, locale: string) {
  const messages: Record<string, [string, string]> = {
    openalex_unavailable: ["OpenAlex에 연결하지 못했습니다. 현재 검색할 수 있는 다른 출처의 결과를 표시합니다.", "OpenAlex could not be reached. Results from the other available sources are shown."],
    crossref_unavailable: ["Crossref에 연결하지 못했습니다. 현재 검색할 수 있는 다른 출처의 결과를 표시합니다.", "Crossref could not be reached. Results from the other available sources are shown."],
    arxiv_unavailable: ["arXiv에 연결하지 못했습니다. 현재 검색할 수 있는 다른 출처의 결과를 표시합니다.", "arXiv could not be reached. Results from the other available sources are shown."],
    bounded_candidates_filtered: ["가져온 후보 중 제목·저자 조건에 맞는 논문만 표시합니다. 제공처의 전체 검색 결과를 모두 검토한 것은 아닙니다.", "Only retrieved candidates matching the title and author conditions are shown. This does not cover every result in the source."],
    popularity_is_annual_citations_within_candidates: ["인기도는 가져온 후보 안에서 연평균 인용수로 비교합니다. 조회수나 다운로드 수는 반영하지 않습니다.", "Popularity compares annual citations within the retrieved candidates. Views and downloads are not included."],
    arxiv_citation_counts_unavailable: ["arXiv는 인용수를 제공하지 않습니다. 인용 정보가 없는 논문은 인용수·인기도 정렬에서 뒤에 표시합니다.", "arXiv does not provide citation counts. Papers without citation data appear last when ordering by citations or popularity."],
  };
  return messages[warning]?.[locale === "ko" ? 0 : 1] || (warning.includes("_") && /^[a-z0-9_]+$/.test(warning) ? textFor(locale, "일부 검색 정보를 가져오지 못했습니다. 표시된 결과와 출처를 확인해 주세요.", "Some search information is unavailable. Check the displayed results and their sources.") : warning);
}
export function normalizeSearchCriteria(value: SearchCriteria): SearchCriteria {
  return { ...value, q: value.q.trim(), author: value.author.trim(), authorQuery: value.authorQuery.trim(), sort: value.provider === "arxiv" && (value.sort === "citations" || value.sort === "popularity") ? "relevance" : value.sort };
}
export function discoverySearchPath(value: SearchCriteria): string {
  const criteria = normalizeSearchCriteria(value);
  const params = new URLSearchParams({ provider: criteria.mode === "authors" ? "openalex" : criteria.provider, mode: criteria.mode, limit: "20" });
  if (criteria.mode === "authors") params.set("q", criteria.authorQuery);
  else {
    if (criteria.q) params.set("q", criteria.q);
    if (criteria.author) params.set("author", criteria.author);
    if (criteria.exactTitle) params.set("exact_title", "1");
    params.set("sort", criteria.sort);
  }
  return `/discover?${params}`;
}
function canSearch(value: SearchCriteria) { return value.mode === "authors" ? Boolean(value.authorQuery.trim()) : Boolean(value.q.trim() || value.author.trim()) && (!value.exactTitle || Boolean(value.q.trim())); }
function criteriaKey(value: SearchCriteria) { return discoverySearchPath(value); }

export function discoverySavedMap(items: Array<{paper_id: string; keys: string[]}>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const paper of items) for (const key of paper.keys) result[key] = Object.hasOwn(result, key) && result[key] !== paper.paper_id ? "" : paper.paper_id;
  return result;
}
export function savedDiscoveryPaper(work: ScholarlyWork, savedPapers: Record<string, string>): string {
  const keys = discoveryKeys(work);
  if (keys.some((key: string) => Object.hasOwn(savedPapers, key) && !savedPapers[key])) return "";
  const matches = [...new Set(keys.map((key: string) => savedPapers[key]).filter(Boolean))];
  return matches.length === 1 ? matches[0] : "";
}

export function DiscoveryResults({ results, criteria, relatedTitle = "", busy = false, savingId = "", savedPapers = {}, onRelated, onSave, onReturn }: { results: SearchResults; criteria: SearchCriteria; relatedTitle?: string; busy?: boolean; savingId?: string; savedPapers?: Record<string, string>; onRelated: (work: ScholarlyWork, relation: "references" | "cited_by") => void; onSave: (work: ScholarlyWork) => void; onReturn: () => void }) {
  const { t, locale } = useI18n();
  const say = (ko: string, en: string) => textFor(locale, ko, en);
  const actualSort = results.sort && results.sort in sortLabels ? sortLabels[results.sort as DiscoverySort][locale === "ko" ? 0 : 1] : "";
  const retrieved = results.retrieved_at ? new Date(results.retrieved_at).toLocaleString(locale === "ko" ? "ko-KR" : "en-US") : "";
  return <Section title={relatedTitle || t("Search results")}>
    <div className="discovery-results-summary" aria-live="polite">
      <p><strong>{say(`표시 ${results.items.length.toLocaleString()}${criteria.mode === "authors" ? "명" : "편"}`, `${results.items.length.toLocaleString()} displayed`)}</strong>{results.provider_total != null ? <span>{say(` · 제공처 검색 결과 ${results.provider_total.toLocaleString()}건`, ` · ${results.provider_total.toLocaleString()} provider matches`)}</span> : null}<span> · {results.provider === "all" ? say("전체 출처", "All sources") : results.provider}</span>{retrieved ? <span> · {t("Retrieved")}: {retrieved}</span> : null}</p>
      {relatedTitle ? <p>{say("선택한 논문의 인용 관계를 표시하고 있습니다.", "Showing citation connections for the selected paper.")}</p> : <p className="discovery-applied-criteria">{criteria.mode === "authors" ? say(`저자 프로필: ${criteria.authorQuery}`, `Author profiles: ${criteria.authorQuery}`) : <>{criteria.q ? <span>{say("제목·주제", "Title/topic")}: {criteria.q}</span> : null}{criteria.author ? <span>{say("저자", "Author")}: {criteria.author}</span> : null}{criteria.exactTitle ? <span>{say("제목 정확히 일치", "Exact title")}</span> : null}{actualSort ? <strong>{say("적용 정렬", "Applied sort")}: {actualSort}</strong> : null}</>}</p>}
      {criteria.mode !== "authors" && !relatedTitle ? <p className="muted-text">{say("선택한 제공처에서 가져온 후보 안에서 정렬합니다. 전체 학술 데이터베이스의 순위가 아닙니다.", "Ordering applies to the retrieved candidates from this source, not the entire scholarly database.")}{results.candidate_count != null ? say(` 검토 후보 ${results.candidate_count.toLocaleString()}편.`, ` ${results.candidate_count.toLocaleString()} candidates considered.`) : ""}{results.duplicates_removed ? say(` 동일 식별자 중복 ${results.duplicates_removed}건을 합쳤습니다.`, ` ${results.duplicates_removed} duplicate identifiers merged.`) : ""}</p> : null}
      {actualSort && results.sort === "popularity" ? <p className="muted-text">{say("인기도 = 누적 인용 수 ÷ (현재 연도 − 발행 연도 + 1). 조회수·다운로드 수나 논문의 정확성을 뜻하지 않습니다.", "Popularity = citations ÷ (current year − publication year + 1). It does not measure views, downloads, or correctness.")}</p> : null}
      {actualSort && results.sort === "relevance" && criteria.mode === "works" ? <p className="muted-text">{say("관련도는 검색어와 제목이 일치하는 결과를 우선합니다. 제목이 같은 결과는 발행일이 오래된 순으로, 그 외에는 제공처가 반환한 순서로 표시합니다.", "Relevance prioritizes exact title matches. Equal-title matches use earliest publication first; other results retain the source order.")}</p> : null}
    </div>
    {relatedTitle ? <button className="reader-control reader-control--secondary" onClick={onReturn} disabled={busy}><ArrowLeft size={14} />{t("Return to topic search")}</button> : null}
    {results.warnings?.map((warning, index) => <p role="status" className="muted-text" key={index}>{discoveryWarningMessage(warning, locale)}</p>)}
    {!results.items.length ? <EmptyState title={t("No matching research found")} description={say("저자명을 줄이거나, 제목 정확히 일치를 해제하거나, 다른 제공처를 선택해 보세요.", "Try a shorter author name, turn off exact-title matching, or choose another source.")} /> : <div className="lab-discovery-list">{results.items.map((item) => isWork(item) ? <article key={item.id} className="lab-discovery-row discovery-work">
      <h3>{safeResearchUrl(item.url) ? <a href={safeResearchUrl(item.url)} target="_blank" rel="noreferrer">{item.title} <ExternalLink size={15} /></a> : item.title}</h3>
      <p className="discovery-author-line">{item.authors?.join(", ") || t("Authors unavailable")}</p>
      <div className="discovery-identity"><span>{say("출판", "Published")}: {(item as DisplayWork).publication_date || item.year || t("Unavailable")}</span>{(item as DisplayWork).journal ? <span>{(item as DisplayWork).journal}</span> : null}</div>
      {(item as DisplayWork).affiliations?.length ? <p className="discovery-affiliations">{say("소속", "Affiliations")}: {(item as DisplayWork).affiliations!.join(" · ")}</p> : null}
      {item.abstract ? <details><summary>{t("Read abstract")}</summary><p className="discovery-abstract">{item.abstract}</p></details> : <p className="muted-text">{t("Abstract unavailable from this source.")}</p>}
      <div className="lab-result-metadata"><span>{t("Source")}: {item.providers?.length ? item.providers.join(" · ") : item.source || results.provider}</span><span>{t("Citations")} ({item.source || results.provider}): {item.cited_by_count == null ? t("Unavailable") : item.cited_by_count.toLocaleString()}</span>{results.sort === "popularity" ? <span>{say("연평균 인용수", "Annual citations")}: {(item as DisplayWork).popularity_score == null ? t("Unavailable") : (item as DisplayWork).popularity_score!.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span> : null}{item.updated_at ? <span>{t("Source updated")}: {item.updated_at}</span> : null}</div>
      {item.doi || arxivId(item) ? <p className="discovery-identifiers">{item.doi ? <span>DOI: <a href={`https://doi.org/${encodeURIComponent(item.doi)}`} target="_blank" rel="noreferrer">{item.doi}</a></span> : null}{arxivId(item) ? <span>arXiv: {arxivId(item)}</span> : null}</p> : null}
      {item.topics?.length ? <div className="tag-list">{item.topics.map((topic) => <StatusBadge key={topic} presentation="chip">{topic}</StatusBadge>)}</div> : null}
      <div className="lab-result-actions"><button className={`reader-control reader-control--secondary${savedDiscoveryPaper(item, savedPapers) ? " discovery-save--complete" : ""}`} disabled={Boolean(savingId) || Boolean(savedDiscoveryPaper(item, savedPapers)) || getWorkspaceRole() === "viewer"} onClick={() => onSave(item)}>{savedDiscoveryPaper(item, savedPapers) ? <Check size={14} /> : <Plus size={14} />}{savedDiscoveryPaper(item, savedPapers) ? say("저장 완료 ✔️", "Saved ✔") : savingId === item.id ? t("Saving…") : say("논문 보관함에 저장", "Save to paper library")}</button>{savedDiscoveryPaper(item, savedPapers) ? <Link className="reader-control" href={`/papers/${encodeURIComponent(savedDiscoveryPaper(item, savedPapers))}`}><BookOpen size={14} />{say("저장한 논문 열기", "Open saved paper")}</Link> : null}{openAlexId(item.openalex_id || item.id) ? <><button className="reader-control reader-control--secondary" disabled={busy} onClick={() => onRelated(item, "references")}><Network size={14} />{t("References")}</button><button className="reader-control reader-control--secondary" disabled={busy} onClick={() => onRelated(item, "cited_by")}>{t("Citing works")}</button></> : null}{safeResearchUrl(item.pdf_url) ? <a className="text-link" href={safeResearchUrl(item.pdf_url)} target="_blank" rel="noreferrer">{t("Source PDF")} <ExternalLink size={14} /></a> : null}</div>
      {savedDiscoveryPaper(item, savedPapers) ? <p className="discovery-save-location" role="status">{say("저장 위치: 논문 보관함", "Saved in: paper library")} · <Link href="/library">{say("보관함 보기", "View library")}</Link></p> : null}
    </article> : <article key={item.id} className="lab-discovery-row"><h3>{safeResearchUrl(item.url) ? <a href={safeResearchUrl(item.url)} target="_blank" rel="noreferrer">{item.name}</a> : item.name}</h3><p>{t("Verify this author identity before using the metrics. Names alone may refer to different researchers.")}</p>{item.affiliations?.length ? <p>{say("소속", "Affiliations")}: {item.affiliations.join(" · ")}</p> : null}<div className="lab-result-metadata"><span>OpenAlex h-index: {item.h_index == null ? t("Unavailable") : item.h_index}</span><span>{t("Works")}: {item.works_count ?? t("Unavailable")}</span><span>{t("Citations")}: {item.cited_by_count ?? t("Unavailable")}</span><span>{t("Source updated")}: {item.updated_date || item.updated_at || t("Unavailable")}</span></div><p className="muted-text">{t("This author-level metric does not establish the quality or correctness of an individual paper.")}</p></article>)}</div>}
  </Section>;
}

export function DiscoverView() {
  const { t, locale } = useI18n();
  const say = (ko: string, en: string) => textFor(locale, ko, en);
  const [criteria, setCriteria] = useState<SearchCriteria>(initialCriteria);
  const [submitted, setSubmitted] = useState<SearchCriteria | null>(null);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [relatedTitle, setRelatedTitle] = useState("");
  const [savingId, setSavingId] = useState("");
  const [savedPapers, setSavedPapers] = useState<Record<string, string>>({});
  const saveLock = useRef(false);
  const sequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const saveController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current += 1; requestController.current?.abort(); saveController.current?.abort(); }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    labviumRequest<{items: Array<{paper_id: string; keys: string[]}>}>("/papers/discovery-index", {signal: controller.signal})
      .then((index) => { if (!controller.signal.aborted) setSavedPapers((current) => ({ ...discoverySavedMap(index.items), ...current })); })
      .catch(() => { /* Saving still checks identity on the server when the index is unavailable. */ });
    return () => controller.abort();
  }, []);
  function invalidateSearch() { sequence.current += 1; requestController.current?.abort(); setBusy(false); }
  function changeCriteria(changes: Partial<SearchCriteria>) {
    invalidateSearch(); setNotice(""); setCriteria((current) => { const next = { ...current, ...changes }; return next.provider === "arxiv" && (next.sort === "citations" || next.sort === "popularity") ? { ...next, sort: "relevance" } : next; });
  }
  async function search(event?: FormEvent<HTMLFormElement>, selected = criteria) {
    event?.preventDefault(); if (!canSearch(selected)) return;
    const snapshot = normalizeSearchCriteria(selected);
    requestController.current?.abort(); const controller = new AbortController(); requestController.current = controller;
    const token = ++sequence.current; setBusy(true); setNotice("");
    try {
      const response = await labviumRequest<SearchResults>(discoverySearchPath(snapshot), { signal: controller.signal });
      if (token !== sequence.current || !mounted.current) return;
      setResults(response); setSubmitted(snapshot); setRelatedTitle("");
    } catch (error) { if (token === sequence.current && mounted.current && !controller.signal.aborted) setNotice(error instanceof Error ? error.message : t("Scholarly search is unavailable. Try again later.")); }
    finally { if (token === sequence.current && mounted.current) setBusy(false); }
  }
  async function related(work: ScholarlyWork, relation: "references" | "cited_by") {
    const id = openAlexId(work.openalex_id || work.id); if (!id || busy) return;
    requestController.current?.abort(); const controller = new AbortController(); requestController.current = controller;
    const token = ++sequence.current; setBusy(true); setNotice("");
    try {
      const response = await labviumRequest<DiscoveryResponse>(`/discover/related?${new URLSearchParams({ openalex_id: id, relation, limit: "20" })}`, { signal: controller.signal });
      if (token !== sequence.current || !mounted.current) return;
      setResults(response); setRelatedTitle(`${t(relation === "references" ? "References of" : "Works citing")} ${work.title}`);
    } catch (error) { if (token === sequence.current && mounted.current && !controller.signal.aborted) setNotice(error instanceof Error ? error.message : t("Citation links could not be loaded.")); }
    finally { if (token === sequence.current && mounted.current) setBusy(false); }
  }
  async function selectLibraryTopic() {
    invalidateSearch(); const token = ++sequence.current; setBusy(true); setNotice("");
    try { const papers = await apiClient.getAllPapers({ archiveStatus: "active" }); if (token !== sequence.current || !mounted.current) return; const paper = papers.find((row) => row.status === "reading") || papers[0]; if (paper) { setCriteria((current) => ({ ...current, mode: "works", q: paper.tags.length ? paper.tags.join(" ") : paper.title, author: "", exactTitle: false })); setNotice(t("Library topic selected. Choose Search to retrieve current results.")); } else setNotice(t("Add a paper to your library before selecting a library topic.")); }
    catch (error) { if (token === sequence.current && mounted.current) setNotice(error instanceof Error ? error.message : t("The library could not be read.")); }
    finally { if (token === sequence.current && mounted.current) setBusy(false); }
  }
  async function saveToLibrary(work: ScholarlyWork) {
    if (saveLock.current || savedDiscoveryPaper(work, savedPapers) || getWorkspaceRole() === "viewer") return; saveLock.current = true; setSavingId(work.id);
    const controller = new AbortController(); saveController.current = controller;
    try {
      const saved = await labviumRequest<{paper_id: string; keys: string[]}>("/papers/from-discovery", { method: "POST", body: { work }, signal: controller.signal });
      if (mounted.current) {
        setSavedPapers((current) => ({ ...current, ...Object.fromEntries([...discoveryKeys(work), ...saved.keys].map((key) => [key, saved.paper_id])) }));
        setNotice(say("논문 보관함에 저장했습니다. ‘저장한 논문 열기’에서 원문 PDF를 연결하고 읽기·메모·프로젝트 정리를 이어가세요.", "Saved to your paper library. Open the saved paper to connect its PDF, read, annotate, and link it to a project."));
      }
    } catch (error) { if (mounted.current && !controller.signal.aborted) setNotice(error instanceof Error ? error.message : t("The source could not be saved.")); }
    finally { saveLock.current = false; if (mounted.current) setSavingId(""); }
  }
  const pending = submitted && criteriaKey(submitted) !== criteriaKey(criteria);
  return <div className="page-stack discovery-page">
    <PageHeader title={t("Discover research")} description={say("논문 제목과 저자를 함께 검색하고, 인용수·출판일을 비교해 원하는 원문을 찾으세요.", "Search by title and author together, then compare citations and publication dates to identify the original paper.")} />
    <div className="discovery-library-guide"><LibraryBig size={20} aria-hidden="true" /><div><strong>{say("찾은 논문은 논문 보관함에 모입니다", "Your saved papers live in the paper library")}</strong><p>{say("검색 → 논문 보관함 → PDF 읽기·하이라이트·메모 → 관련 논문 탐색. 프로젝트에는 필요한 논문을 연결하세요. 저장 시에는 서지정보와 초록을 보관하며, 원문 PDF는 논문을 열어 연결합니다.", "Search → paper library → PDF reading, highlights and notes → related papers. Link the papers you need to a project. Saving retains metadata and abstract; connect the full PDF from the saved paper.")}</p><p>{say("이전에 ‘연구 페이지로 저장’한 항목은 ", "Items previously saved as research pages are in ")}<Link href="/workspace">{say("연구 노트", "research notes")}</Link>{say("에서 볼 수 있어요.", ".")}</p></div><Link className="reader-control reader-control--secondary" href="/library">{say("논문 보관함", "Paper library")}</Link></div>
    <Section title={t("Find related work")}>
      <form className="discovery-search-form" onSubmit={(event) => void search(event)}>
        <div className="discovery-search-options">
          <label className="reader-field"><span>{t("Search mode")}</span><select value={criteria.mode} onChange={(event) => changeCriteria({ mode: event.target.value })}><option value="works">{t("Papers")}</option><option value="authors">{t("Author profiles")}</option></select></label>
          <label className="reader-field"><span>{t("Source")}</span><select value={criteria.mode === "authors" ? "openalex" : criteria.provider} disabled={criteria.mode === "authors"} onChange={(event) => changeCriteria({ provider: event.target.value })}><option value="all">{say("전체 출처", "All sources")}</option><option value="crossref">Crossref</option><option value="arxiv">arXiv</option><option value="openalex">OpenAlex</option></select></label>
          {criteria.mode === "works" ? <label className="reader-field"><span>{say("정렬 방법", "Sort by")}</span><select value={criteria.sort} onChange={(event) => changeCriteria({ sort: event.target.value as DiscoverySort })}>{Object.entries(sortLabels).map(([value, label]) => <option key={value} value={value} disabled={criteria.provider === "arxiv" && (value === "citations" || value === "popularity")}>{label[locale === "ko" ? 0 : 1]}</option>)}</select></label> : null}
        </div>
        {criteria.mode === "works" ? <div className="discovery-search-fields">
          <label className="reader-field"><span>{say("논문 제목·주제·DOI", "Paper title, topic, or DOI")}</span><input value={criteria.q} maxLength={300} onChange={(event) => changeCriteria({ q: event.target.value })} placeholder="Attention Is All You Need" /></label>
          <label className="reader-field"><span>{say("저자명", "Author name")} <span className="muted-text">{say("선택", "optional")}</span></span><input value={criteria.author} maxLength={200} onChange={(event) => changeCriteria({ author: event.target.value })} placeholder="Ashish Vaswani" /></label>
          <button className="reader-control" type="submit" disabled={busy || !canSearch(criteria)}><Search size={15} />{t(busy ? "Searching…" : "Search")}</button>
          <label className="discovery-exact-title"><input type="checkbox" checked={criteria.exactTitle} onChange={(event) => changeCriteria({ exactTitle: event.target.checked })} />{say("제목 정확히 일치", "Match exact title")}</label>
        </div> : <div className="discovery-author-search"><label className="reader-field"><span>{say("찾을 저자명", "Author to find")}</span><input required value={criteria.authorQuery} maxLength={300} onChange={(event) => changeCriteria({ authorQuery: event.target.value })} placeholder="Ashish Vaswani" /></label><button className="reader-control" type="submit" disabled={busy || !canSearch(criteria)}><Search size={15} />{t(busy ? "Searching…" : "Search")}</button></div>}
        {criteria.mode === "works" ? <p className="discovery-form-help">{say("제목과 저자를 함께 입력하면 두 조건을 모두 적용합니다. 필터와 정렬을 변경한 뒤 ‘검색’을 눌러 적용하세요.", "Title and author are combined. Choose Search after changing filters or ordering.")}{criteria.exactTitle && !criteria.q.trim() ? <span> {say("정확히 일치하려면 제목을 입력하세요.", "Enter a title for exact matching.")}</span> : null}{criteria.provider === "arxiv" ? <span> {say("arXiv는 인용수를 제공하지 않아 인용수·인기도 정렬을 지원하지 않습니다.", "arXiv does not provide citation counts; citation and popularity ordering are unavailable.")}</span> : null}</p> : null}
      </form>
      <div className="discovery-source-tools"><button className="text-link" onClick={() => void selectLibraryTopic()} disabled={busy}><BookOpen size={14} />{t("Use a topic from my library")}</button>{criteria.mode === "works" ? <button className="text-link" type="button" onClick={() => { changeCriteria({ q: "Attention Is All You Need", author: "Ashish Vaswani", exactTitle: true, provider: "all", sort: "relevance" }); }}>{say("예시 채우기 · Attention Is All You Need", "Fill example · Attention Is All You Need")}</button> : null}</div>
      {criteria.mode === "works" ? <p className="muted-text discovery-original-tip">{say("동명 논문은 저자·출판연도·학술지·DOI/arXiv 번호로 구분하세요. 예시 원문은 Ashish Vaswani 외, 2017년(arXiv: 1706.03762)입니다. 소속은 제공처에 정보가 있을 때 표시합니다.", "Distinguish identical titles by author, year, venue, and DOI/arXiv identifier. The example original is by Ashish Vaswani et al. (2017; arXiv: 1706.03762). Affiliations are shown when supplied by the source.")} <a href="https://research.google/pubs/attention-is-all-you-need/" target="_blank" rel="noreferrer">{say("Google 공식 논문 정보", "Official Google publication record")} <ExternalLink size={12} /></a></p> : null}
    </Section>
    {pending ? <p className="discovery-pending" role="status">{say("검색 조건이 변경되었습니다. 아래는 이전 검색 결과입니다. ‘검색’을 눌러 새 조건을 적용하세요.", "Search criteria changed. The results below are from the previous search. Choose Search to apply the new criteria.")}</p> : null}
    {notice ? <p className="reader-editor__status" role="status">{notice}</p> : null}
    {busy ? <p role="status" className="muted-text">{t("Searching…")}{results ? say(" 이전 결과를 표시하고 있습니다.", " Previous results remain visible.") : ""}</p> : null}
    {results && submitted ? <DiscoveryResults results={results} criteria={submitted} relatedTitle={relatedTitle} busy={busy} savingId={savingId} savedPapers={savedPapers} onRelated={(work, relation) => void related(work, relation)} onSave={(work) => void saveToLibrary(work)} onReturn={() => void search(undefined, submitted)} /> : !busy ? <EmptyState title={t("Start with a research question")} description={t("Results come from the selected scholarly source when you run a search.")} /> : null}
    <details className="tag-advanced-details"><summary>{t("Sources and metric interpretation")}</summary><p><a href="https://help.openalex.org/data/authors/" target="_blank" rel="noreferrer">OpenAlex author metrics</a> · <a href="https://www.crossref.org/documentation/retrieve-metadata/rest-api/" target="_blank" rel="noreferrer">Crossref REST API</a> · <a href="https://doi.org/10.1038/520429a" target="_blank" rel="noreferrer">Leiden Manifesto</a></p><p>{t("Provider omissions remain unavailable. No missing citation count or h-index is replaced with a guess.")}</p><p>{t("Relevance and citation connections guide discovery. Author h-index is supplementary context, affected by discipline, career length, and database coverage.")}</p></details>
  </div>;
}
