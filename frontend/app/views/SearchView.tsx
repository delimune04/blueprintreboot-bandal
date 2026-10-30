"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { labviumRequest } from "../lib/api/client";
import { useI18n } from "../lib/i18n/LocaleProvider";
import type { SearchResult } from "../lib/workspace/search.mjs";

export function SearchView() {
  const { locale } = useI18n();
  const tr = (ko: string, en: string) => locale === "ko" ? ko : en;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ query: string; items: SearchResult[] } | null>(null);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const busy = pendingQuery !== null;
  const [error, setError] = useState<{ query: string; message: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const hasPendingInput = results !== null && query.trim() !== results.query;
  useEffect(() => () => { controller.current?.abort(); }, []);
  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedQuery = query.trim();
    if (!submittedQuery) return;
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setPendingQuery(submittedQuery); setError(null);
    try {
      const data = await labviumRequest<{ items: SearchResult[] }>(`/search?${new URLSearchParams({ q: submittedQuery })}`, { signal: current.signal });
      if (!current.signal.aborted) setResults({ query: submittedQuery, items: data.items });
    } catch (failure) { if (!current.signal.aborted) setError({ query: submittedQuery, message: failure instanceof Error ? failure.message : tr("검색하지 못했습니다.", "Search could not be completed.") }); }
    finally { if (!current.signal.aborted) setPendingQuery(null); }
  }
  return <div className="page-stack">
    <PageHeader title={tr("내 연구 자료 검색", "Search my research")} description={tr("논문 정보, 추출한 본문, 읽기 노트, 근거 블록과 연구 페이지를 함께 찾습니다.", "Find paper metadata, extracted text, reading notes, evidence blocks and research pages together.")} />
    <Section title={tr("자료에서 찾기", "Find saved evidence")}><form className="lab-discover-form" onSubmit={(event) => void search(event)}><label className="reader-field"><span>{tr("검색어", "Search term")}</span><input value={query} maxLength={500} onChange={(event) => setQuery(event.target.value)} required placeholder={tr("예: 모세관 압력, caprock, acceptance", "e.g. caprock, acceptance, uncertainty")} /></label><button className="reader-control" disabled={busy || !query.trim()}>{tr(busy ? "검색 중…" : "검색", busy ? "Searching…" : "Search")}</button></form><p className="muted-text">{tr("저장된 텍스트의 단어를 검색합니다. PDF 본문은 먼저 추출해야 검색할 수 있습니다.", "Searches words in saved text. Extract a PDF's text first to include its contents.")}</p></Section>
    <p role="status" aria-live="polite" aria-atomic="true" className={busy || hasPendingInput ? "muted-text" : "sr-only"}>
      {busy ? tr(`“${pendingQuery}” 검색 중입니다.`, `Searching for “${pendingQuery}”.`) : hasPendingInput ? tr("검색어가 바뀌었습니다. 검색을 눌러 적용하세요. 아래는 이전 검색 결과입니다.", "The search term has changed. Choose Search to apply it. Previous results are shown below.") : null}
    </p>
    {error ? <p role="alert">{tr(`“${error.query}” 검색에 실패했습니다.`, `Search for “${error.query}” failed.`)} {error.message}{results ? tr(" 아래는 마지막으로 성공한 검색 결과입니다.", " The last successful results are shown below.") : ""}</p> : null}
    {results ? <Section title={tr(`검색 결과 ${results.items.length}개`, `${results.items.length} results`)}><p className="muted-text">{tr("적용 검색어", "Applied search term")}: <strong>{results.query}</strong></p>{!results.items.length ? <p>{tr("일치하는 자료가 없습니다.", "No matching saved material.")}</p> : <div className="lab-discovery-list">{results.items.map((result) => <article className="lab-discovery-row" key={result.id}><h2><Link href={result.url}>{result.title}</Link></h2><p className="muted-text">{result.kind}{result.page ? ` · p. ${result.page}` : ""}</p><p>{result.snippet}</p></article>)}</div>}</Section> : null}
  </div>;
}

