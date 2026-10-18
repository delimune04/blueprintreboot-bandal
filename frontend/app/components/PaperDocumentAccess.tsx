"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Download, ExternalLink, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiClientError, getWorkspaceMode, getWorkspaceRole, labviumRequest } from "../lib/api/client";
import type { PaperDetail } from "../lib/api/types";
import { useI18n } from "../lib/i18n/LocaleProvider";
import { inferredPdfSource, publicPdfAccessPath, downloadManagedPdf } from "../lib/workspace/pdf-access.mjs";
import { safeResearchUrl } from "../lib/workspace/pages.mjs";
import { Section } from "./Section";
import "../lib/workspace/paper-document.css";

export type PdfOpenAction = "reader" | "download";
type PdfAccess = {status: "available" | "open_access" | "source_only" | "unavailable"; pdf_url: string; source_url: string; can_import: boolean; reason?: string};
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

export function PaperDocumentAccess({paper, onAttached, autoAction = null}: {paper: PaperDetail; onAttached: () => void; autoAction?: PdfOpenAction | null}) {
  const {locale} = useI18n(); const tr = (ko: string, en: string) => locale === "ko" ? ko : en;
  const router = useRouter();
  const available = !paper.missing_pdf && Boolean(paper.relative_pdf_path);
  const [access, setAccess] = useState<PdfAccess | null>(null);
  const [resolving, setResolving] = useState(!available); const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(""); const [needsRefresh, setNeedsRefresh] = useState(false);
  const input = useRef<HTMLInputElement>(null); const actionController = useRef<AbortController | null>(null);
  const generation = useRef(0); const lock = useRef(false); const autoDone = useRef("");
  const inferred = inferredPdfSource(paper);
  const sourceUrl = safeResearchUrl(access?.source_url || inferred.source_url || "");
  const pdfUrl = safeResearchUrl(access?.pdf_url || inferred.pdf_url || "");
  const readyPdf = available || access?.status === "available";
  const canRetrieve = Boolean(pdfUrl || access?.can_import);
  const readOnly = getWorkspaceRole() === "viewer";

  useEffect(() => {
    const scope = ++generation.current; const controller = new AbortController();
    setNeedsRefresh(false); setAccess(null); setNotice("");
    if (available) setResolving(false);
    else {
      setResolving(true);
      const path = getWorkspaceMode() === "cloud" ? `/papers/${encodeURIComponent(paper.paper_id)}/pdf-access` : publicPdfAccessPath(paper);
      if (!path) setResolving(false);
      else void labviumRequest<PdfAccess>(path, {signal: controller.signal})
        .then(value => { if (generation.current === scope && !controller.signal.aborted) setAccess(value); })
        .catch(() => { if (generation.current === scope && !controller.signal.aborted) setNotice(tr("공개 원문 조회에 연결하지 못했습니다. 아래 원문 링크를 열거나 잠시 후 다시 시도해 주세요.", "The open-PDF lookup could not be reached. Use the source link or retry shortly.")); })
        .finally(() => { if (generation.current === scope && !controller.signal.aborted) setResolving(false); });
    }
    return () => { generation.current += 1; controller.abort(); actionController.current?.abort(); };
    // Paper revision identifies the retained attachment; locale changes do not restart a PDF lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper.paper_id, paper.pdf_revision, available]);

  async function open(action: PdfOpenAction, file?: File) {
    if (lock.current) return;
    if (!readyPdf && readOnly) { setNotice(tr("원문 링크로 PDF를 열 수 있습니다. 이 공간에 PDF와 주석을 저장하려면 편집 권한이 필요합니다.", "Open the PDF at its source. Saving a PDF and annotations in this workspace requires editing permission.")); return; }
    lock.current = true; setBusy(true); setNotice(""); setNeedsRefresh(false);
    const scope = generation.current; const lifetime = new AbortController(); actionController.current = lifetime;
    const timeout = setTimeout(() => lifetime.abort(), 45000);
    try {
      if (!readyPdf || file) {
        if (!file && getWorkspaceMode() === "cloud" && access?.can_import !== false) {
          await labviumRequest(`/papers/${encodeURIComponent(paper.paper_id)}/import-source-pdf`, {method: "POST", body: {expected_pdf_revision: paper.pdf_revision}, signal: lifetime.signal});
        } else {
          let document = file;
          if (!document) { if (!pdfUrl) throw new Error("pdf_source_unavailable"); const blob = await publicPdf(pdfUrl, lifetime.signal); document = new File([blob], "source-paper.pdf", {type: "application/pdf"}); }
          if (document.size > PDF_LIMIT || !document.size) throw new Error("pdf_too_large");
          const body = new FormData(); body.set("file", document); body.set("expected_pdf_revision", paper.pdf_revision);
          await labviumRequest(`/papers/${encodeURIComponent(paper.paper_id)}/pdf-attachment`, {method: "POST", body, signal: lifetime.signal});
        }
      }
      if (generation.current !== scope || lifetime.signal.aborted) return;
      if (action === "reader") router.replace(`/papers/${encodeURIComponent(paper.paper_id)}/reader`);
      else {
        await downloadManagedPdf(paper.paper_id, paper.title, lifetime.signal);
        if (generation.current !== scope || lifetime.signal.aborted) return;
        setNotice(tr("PDF 다운로드를 시작했습니다. 기기의 다운로드 목록이나 파일 앱을 확인하세요.", "PDF download started. Check your device’s downloads or Files app."));
        if (autoAction) router.replace(`/papers/${encodeURIComponent(paper.paper_id)}`);
        if (!available) onAttached();
      }
    } catch (error) {
      if (generation.current !== scope) return;
      if (error instanceof ApiClientError && (error.kind === "conflict" || error.status === 401 || error.status === 403)) { setNotice(error.message); setNeedsRefresh(true); return; }
      if (lifetime.signal.aborted) setNeedsRefresh(true);
      setNotice(lifetime.signal.aborted ? tr("PDF를 준비하는 시간이 초과됐습니다. 최신 상태를 확인하거나 아래 원문 PDF 링크를 열어 주세요.", "Preparing the PDF timed out. Check the latest state or open the source PDF below.") : error instanceof Error && error.message === "pdf_too_large" ? tr("웹에서 가져올 수 있는 PDF는 25 MiB 이하입니다. 원문 링크에서 파일을 열어 주세요.", "The hosted reader accepts PDFs up to 25 MiB. Open the file at its source.") : file ? (error instanceof Error ? error.message : tr("PDF를 열지 못했습니다.", "The PDF could not be opened.")) : tr("공개 PDF를 앱으로 가져오지 못했습니다. 아래 ‘원문 PDF 열기’에서 바로 읽거나 기기에 저장할 수 있습니다. 파일을 확보한 경우에만 ‘내 PDF 업로드’를 이용하세요.", "The app could not fetch the PDF. Open the source PDF below to read or save it on your device. Upload a PDF only if you already have the file."));
    } finally { clearTimeout(timeout); lock.current = false; if (generation.current === scope) { setBusy(false); if (input.current) input.current.value = ""; } }
  }

  useEffect(() => {
    if (!autoAction || resolving) return;
    const key = `${paper.paper_id}:${autoAction}`; if (autoDone.current === key) return;
    autoDone.current = key;
    if (readyPdf || canRetrieve) void open(autoAction);
    else setNotice(tr("공개된 PDF 주소를 찾지 못했습니다. 출판사 원문에서 이용 가능 여부를 확인해 주세요. PDF 파일이 있으면 직접 업로드해 읽을 수 있습니다.", "No public PDF link was found. Check access at the publisher, or upload a PDF you already have."));
    // Run once for the explicit open/download navigation after resolution completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAction, resolving, paper.paper_id, readyPdf, canRetrieve]);

  return <section id="paper-document" className="paper-document-access">
    <Section title={tr("PDF 읽기·주석·다운로드", "Read, annotate and download PDF")}>
      <p className="paper-document-location">{readyPdf ? tr("PDF 준비 완료 · 보관함에 저장됨", "PDF ready · saved in your library") : resolving ? tr("논문 식별자로 공개 PDF를 확인하고 있습니다…", "Checking the paper’s identifiers for an open PDF…") : canRetrieve ? tr("원문 PDF를 찾았습니다", "Source PDF found") : tr("서지정보 저장됨 · 공개 PDF 확인 필요", "Metadata saved · public PDF access needed")}</p>
      <p>{tr("웹에서 원문을 읽으며 하이라이트와 플로팅 메모를 저장하거나, PDF 파일을 기기에 다운로드할 수 있습니다.", "Read the original in the web reader with highlights and floating notes, or download the PDF to your device.")}</p>
      {!readyPdf && !paper.metadata_only ? <p>{tr("이전에 연결한 PDF를 찾을 수 없습니다. 같은 원본을 다시 가져오면 기존 페이지와 주석을 유지할 수 있습니다.", "The previously attached PDF is missing. Reconnect the same original to retain page annotations.")}</p> : null}
      <div className="paper-document-actions">
        {readyPdf ? <Link className="reader-control" href={`/papers/${encodeURIComponent(paper.paper_id)}/reader`}><BookOpen size={16}/>{tr("웹에서 PDF 읽기", "Read PDF on web")}</Link> : <button className="reader-control" type="button" disabled={busy || resolving || !canRetrieve || readOnly} onClick={() => void open("reader")}><BookOpen size={16}/>{tr(busy ? "PDF 준비 중…" : "웹에서 PDF 읽기", busy ? "Preparing PDF…" : "Read PDF on web")}</button>}
        <button className="reader-control reader-control--secondary" type="button" disabled={busy || resolving || (!readyPdf && (!canRetrieve || readOnly))} onClick={() => void open("download")}><Download size={16}/>{tr("PDF 다운로드", "Download PDF")}</button>
        {pdfUrl && !readyPdf ? <a className="text-link" href={pdfUrl} target="_blank" rel="noreferrer"><ExternalLink size={14}/>{tr("원문 PDF 열기", "Open source PDF")}</a> : null}
        {sourceUrl ? <a className="text-link" href={sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14}/>{tr("출판사·원문 사이트", "Publisher or source site")}</a> : null}
      </div>
      {!readyPdf && !resolving && !canRetrieve ? <p className="muted-text">{tr("제공처에 공개 PDF가 등록되지 않았거나 별도 구독이 필요한 논문일 수 있습니다. 출판사 사이트에서 확인해 주세요.", "A public PDF may not be registered, or the paper may require a subscription. Check the publisher’s site.")}</p> : null}
      {readOnly && !readyPdf ? <p className="muted-text">{tr("이 연구 공간에서는 읽기만 가능합니다. 원문 링크로 PDF를 열 수 있으며, 보관함에 PDF와 주석을 저장하려면 편집 권한이 필요합니다.", "You have read-only access here. Open the PDF at its source; saving PDF bytes and annotations requires editing permission.")}</p> : null}
      {!readyPdf ? <details className="paper-document-manual"><summary>{tr("PDF 파일을 이미 가지고 있나요?", "Already have a PDF file?")}</summary><p>{tr("같은 논문의 PDF를 직접 연결할 수도 있습니다. 파일당 25 MiB까지 지원합니다.", "You can attach your own copy of this paper, up to 25 MiB.")}</p><button className="reader-control reader-control--secondary" type="button" disabled={busy || readOnly} onClick={() => input.current?.click()}><Upload size={16}/>{tr("내 PDF 업로드", "Upload my PDF")}</button><input ref={input} type="file" accept="application/pdf,.pdf" aria-label={tr("이 논문에 연결할 PDF", "PDF to connect to this paper")} hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void open("reader", file); }}/></details> : null}
      {notice ? <p role="status" className="reader-editor__status">{notice}</p> : null}
      {needsRefresh ? <button className="reader-control reader-control--secondary" type="button" onClick={onAttached}>{tr("최신 상태 확인", "Check current state")}</button> : null}
    </Section>
  </section>;
}
