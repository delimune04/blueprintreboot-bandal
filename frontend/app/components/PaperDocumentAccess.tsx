"use client";

import Link from "next/link";
import { BookOpen, Download, ExternalLink, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiClientError, getWorkspaceMode, getWorkspaceRole, labviumRequest } from "../lib/api/client";
import type { PaperDetail } from "../lib/api/types";
import { useI18n } from "../lib/i18n/LocaleProvider";
import { safeResearchUrl } from "../lib/workspace/pages.mjs";
import { Section } from "./Section";
import "../lib/workspace/paper-document.css";

const PDF_LIMIT = 25 * 1024 * 1024;
async function publicPdf(url: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(url, {signal, credentials: "omit", referrerPolicy: "no-referrer"});
  if (!response.ok || !response.body) throw new Error("pdf_source_unavailable");
  if (Number(response.headers.get("content-length")) > PDF_LIMIT) throw new Error("pdf_too_large");
  const reader = response.body.getReader(); const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  try {
    for (;;) { const {done, value} = await reader.read(); if (done) break; size += value.byteLength; if (size > PDF_LIMIT) { await reader.cancel(); throw new Error("pdf_too_large"); } chunks.push(new Uint8Array(value)); }
  } finally { reader.releaseLock(); }
  return new Blob(chunks, {type: "application/pdf"});
}

export function PaperDocumentAccess({paper, onAttached}: {paper: PaperDetail; onAttached: () => void}) {
  const {locale} = useI18n(); const tr = (ko: string, en: string) => locale === "ko" ? ko : en;
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(""); const [needsRefresh, setNeedsRefresh] = useState(false);
  const input = useRef<HTMLInputElement>(null); const controller = useRef<AbortController | null>(null); const lock = useRef(false);
  const generation = useRef(0);
  useEffect(() => { generation.current += 1; return () => { generation.current += 1; controller.current?.abort(); }; }, [paper.paper_id]);
  const available = !paper.missing_pdf && Boolean(paper.relative_pdf_path);
  const source = paper.external_source;
  const sourceUrl = safeResearchUrl(source?.url || ""); const pdfUrl = safeResearchUrl(source?.pdf_url || "");
  const readOnly = getWorkspaceRole() === "viewer";
  async function attach(file?: File) {
    if (lock.current || readOnly) return; lock.current = true; setBusy(true); setNotice(""); setNeedsRefresh(false);
    const scope = generation.current;
    const lifetime = new AbortController(); controller.current = lifetime;
    const timeout = setTimeout(() => lifetime.abort(), 30000);
    try {
      if (!file && getWorkspaceMode() === "cloud") {
        await labviumRequest(`/papers/${encodeURIComponent(paper.paper_id)}/import-source-pdf`, {method: "POST", body: {expected_pdf_revision: paper.pdf_revision}, signal: lifetime.signal});
      } else {
        let document = file;
        if (!document) { if (!pdfUrl) throw new Error("pdf_source_unavailable"); const blob = await publicPdf(pdfUrl, lifetime.signal); document = new File([blob], "source-paper.pdf", {type: "application/pdf"}); }
        if (document.size > PDF_LIMIT || !document.size) throw new Error("pdf_too_large");
        const body = new FormData(); body.set("file", document); body.set("expected_pdf_revision", paper.pdf_revision);
        await labviumRequest(`/papers/${encodeURIComponent(paper.paper_id)}/pdf-attachment`, {method: "POST", body, signal: lifetime.signal});
      }
      if (generation.current === scope && !lifetime.signal.aborted) { setNotice(tr("PDF 연결 완료 ✔️ 아래 ‘논문 읽기’에서 이어가세요.", "PDF connected ✔ Continue with Read paper.")); onAttached(); }
    } catch (error) {
      if (controller.current !== lifetime || generation.current !== scope) return;
      if (error instanceof ApiClientError && (error.kind === "conflict" || error.status === 401 || error.status === 403)) { setNotice(error.message); setNeedsRefresh(true); return; }
      if (lifetime.signal.aborted) setNeedsRefresh(true);
      setNotice(lifetime.signal.aborted ? tr("PDF를 가져오는 시간이 초과됐습니다. 다시 시도하거나 PDF 파일을 선택해 주세요.", "Fetching timed out. Retry or choose a PDF file.") : error instanceof Error && error.message === "pdf_too_large" ? tr("25 MiB 이하의 PDF 파일을 선택해 주세요.", "Choose a PDF up to 25 MiB.") : !file ? tr("원문 사이트의 접근 제한 등으로 PDF를 가져오지 못했습니다. 원문을 열어 PDF를 내려받은 뒤 ‘내 PDF 연결’을 이용하세요. 저장한 서지정보와 메모는 그대로 있습니다.", "The source PDF could not be fetched. Open the source, download the PDF, and choose Connect my PDF. Your saved metadata and notes are retained.") : error instanceof Error ? error.message : tr("PDF를 연결하지 못했습니다.", "The PDF could not be connected."));
    } finally { clearTimeout(timeout); lock.current = false; if (generation.current === scope) { setBusy(false); if (input.current) input.current.value = ""; } }
  }
  return <section id="paper-document" className="paper-document-access">
    <Section title={tr("논문 읽기", "Read paper")}>
      <p className="paper-document-location">{tr("저장 위치: 논문 보관함", "Saved in: paper library")} · {available ? tr("PDF 연결됨", "PDF connected") : paper.metadata_only ? tr("서지정보·초록 저장됨 · PDF 연결 필요", "Metadata and abstract saved · PDF needed") : tr("이전에 연결한 PDF를 찾을 수 없음", "Previously connected PDF is missing")}</p>
      {available ? <><p>{tr("텍스트를 선택해 하이라이트하고, 플로팅 메모에 생각을 기록하세요. 메모와 근거는 이 논문에 연결됩니다.", "Select text to highlight and capture ideas in a floating memo. Notes and evidence stay linked to this paper.")}</p><Link className="reader-control" href={`/papers/${encodeURIComponent(paper.paper_id)}/reader`}><BookOpen size={16}/>{tr("논문 읽기", "Read paper")}</Link></> : <>
        <p>{paper.metadata_only ? tr("검색에서 저장한 논문은 이곳에 보관됩니다. 원문 PDF를 연결하면 같은 논문 안에서 읽기·하이라이트·메모를 이어갈 수 있습니다.", "The paper you saved from search is stored here. Connect its full PDF to read, highlight and take notes on this same paper.") : tr("이 논문에 연결했던 PDF가 현재 없습니다. 같은 원본 PDF를 다시 연결하면 기존 페이지 위치와 메모를 이어갈 수 있습니다.", "This paper’s PDF is currently missing. Reconnect the same original PDF to preserve page locations and notes.")}</p>
        <div className="paper-document-actions">
          {pdfUrl ? <button className="reader-control" type="button" disabled={busy || readOnly} onClick={() => void attach()}><Download size={16}/>{tr(busy ? "PDF 연결 중…" : "공개 PDF 가져오기", busy ? "Connecting PDF…" : "Fetch open PDF")}</button> : null}
          <button className="reader-control reader-control--secondary" type="button" disabled={busy || readOnly} onClick={() => input.current?.click()}><Upload size={16}/>{tr("내 PDF 연결", "Connect my PDF")}</button>
          <input ref={input} type="file" accept="application/pdf,.pdf" aria-label={tr("이 논문에 연결할 PDF", "PDF to connect to this paper")} hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void attach(file); }}/>
          {pdfUrl || sourceUrl ? <a className="text-link" href={pdfUrl || sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14}/>{tr("원문 열기", "Open original")}</a> : null}
        </div>
        <p className="muted-text">{tr("25 MiB 이하 PDF · 원문 제공처가 자동 가져오기를 제한하면 파일을 직접 연결해 주세요.", "PDF up to 25 MiB · If the publisher blocks fetching, connect the file directly.")}</p>
        {readOnly ? <p>{tr("읽기 권한으로 보고 있습니다. PDF 연결은 편집 가능한 구성원이 할 수 있습니다.", "You have read-only access. An editor can connect the PDF.")}</p> : null}
      </>}
      {notice ? <p role="status" className="reader-editor__status">{notice}</p> : null}
      {needsRefresh ? <button className="reader-control reader-control--secondary" type="button" onClick={onAttached}>{tr("최신 상태 확인", "Check current state")}</button> : null}
    </Section>
  </section>;
}
