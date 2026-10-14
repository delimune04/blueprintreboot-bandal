"use client";

import { ArrowLeft, ChevronLeft, ChevronRight, FileText, RefreshCw, ScanText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiClientError, apiClient, getWorkspaceMode } from "../lib/api/client";
import type { FullTextCacheState } from "../lib/api/types";
import { initialFullTextUiState, transitionFullTextUiState } from "../lib/full-text/workflow-state.mjs";
import { StatusBadge } from "./StatusBadge";
import { useI18n } from "../lib/i18n/LocaleProvider";
import { highlightedTextSegments, searchFullText } from "../lib/reader/full-text-search.mjs";


const STATE_LABELS: Record<FullTextCacheState, string> = {
  not_extracted: "Not extracted",
  success: "Ready",
  cached: "Cached",
  stale: "Stale",
  failed: "Failed",
  ocr_needed: "OCR needed",
};

type OcrProgress = { phase: string; page?: number; totalPages?: number; progress?: number; message?: string };
const OCR_PHASE_LABELS: Record<string, string> = {
  "text": "Checking existing PDF text…",
  "ocr-models": "Downloading recognition models…",
  "ocr-render": "Preparing scanned page…",
  "ocr-recognize": "Recognizing page text…",
  "ocr-complete": "OCR recognition complete. Saving text…",
  "cancelling": "Cancelling OCR…",
};


function statusTone(state: FullTextCacheState): "slate" | "blue" | "green" | "amber" | "rose" {
  if (state === "failed") return "rose";
  if (state === "stale" || state === "ocr_needed") return "amber";
  if (state === "success") return "green";
  if (state === "cached") return "blue";
  return "slate";
}


function operationError(error: unknown): string {
  if (error instanceof ApiClientError && error.kind === "not-found") return "This Paper is no longer available.";
  return "Full-text state could not be updated. The existing cache was not discarded.";
}


export function FullTextWorkspace({ paperId, onJumpToPage }: { paperId: string; onJumpToPage?: (page: number) => void }) {
  const { t } = useI18n();
  const [ui, setUi] = useState(initialFullTextUiState);
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const [ocrActive, setOcrActive] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);
  const ocrControllerRef = useRef<AbortController | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const matches = useMemo(() => searchFullText(ui.content, query), [query, ui.content]);
  const segments = useMemo(() => highlightedTextSegments(ui.content, matches), [matches, ui.content]);
  useEffect(() => { textRef.current?.querySelector<HTMLElement>(`[data-match-index="${matches[activeMatch]?.index}"]`)?.scrollIntoView({ block: "center" }); }, [activeMatch, matches]);
  useEffect(() => () => { ocrControllerRef.current?.abort(); ocrControllerRef.current = null; }, [paperId]);

  const loadStatus = async () => {
    setUi((state) => transitionFullTextUiState(state, { type: "status-loading" }));
    try {
      const status = await apiClient.getFullTextStatus(paperId);
      setUi((state) => transitionFullTextUiState(state, { type: "status-loaded", status }));
    } catch (error) {
      setUi((state) => transitionFullTextUiState(state, { type: "operation-failed", message: operationError(error) }));
    }
  };

  useEffect(() => {
    let current = true;
    void apiClient.getFullTextStatus(paperId)
      .then((status) => {
        if (current) setUi((state) => transitionFullTextUiState(state, { type: "status-loaded", status }));
      })
      .catch((error) => {
        if (current) setUi((state) => transitionFullTextUiState(state, { type: "operation-failed", message: operationError(error) }));
      });
    return () => { current = false; };
  }, [paperId]);

  const extract = async () => {
    if (!ui.data || ui.phase === "working" || ocrControllerRef.current) return;
    const force = ui.data.state !== "not_extracted";
    setUi((state) => transitionFullTextUiState(state, { type: "operation-started" }));
    try {
      const document = await apiClient.extractFullText(paperId, force);
      setUi((state) => transitionFullTextUiState(state, { type: "document-loaded", document, open: false }));
    } catch (error) {
      setUi((state) => transitionFullTextUiState(state, { type: "operation-failed", message: operationError(error) }));
    }
  };

  const runOcr = async () => {
    if (!ui.data || ui.phase === "working" || ocrControllerRef.current || getWorkspaceMode() === "local") return;
    const controller = new AbortController();
    ocrControllerRef.current = controller;
    setOcrActive(true);
    setOcrProgress({ phase: "starting" });
    setUi((state) => transitionFullTextUiState(state, { type: "operation-started" }));
    try {
      const document = await apiClient.extractFullText(paperId, true, true, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (ocrControllerRef.current !== controller || controller.signal.aborted) return;
          setOcrProgress({ ...progress, phase: progress.phase || "text", totalPages: progress.totalPages ?? progress.total });
        },
      });
      if (ocrControllerRef.current !== controller) return;
      setUi((state) => transitionFullTextUiState(state, { type: "document-loaded", document, open: false }));
    } catch (error) {
      if (ocrControllerRef.current !== controller) return;
      if (controller.signal.aborted) setUi((state) => ({ ...state, phase: "ready", message: "OCR cancelled. The previous cached text remains." }));
      else setUi((state) => transitionFullTextUiState(state, { type: "operation-failed", message: error instanceof Error ? error.message : "OCR failed. The previous cached text remains." }));
    } finally {
      if (ocrControllerRef.current === controller) {
        ocrControllerRef.current = null;
        setOcrActive(false);
        setOcrProgress(null);
      }
    }
  };

  const openFullText = async () => {
    if (ui.phase === "working") return;
    setUi((state) => transitionFullTextUiState(state, { type: "operation-started" }));
    try {
      const document = await apiClient.getFullText(paperId);
      setUi((state) => transitionFullTextUiState(state, { type: "document-loaded", document, open: true }));
    } catch (error) {
      setUi((state) => transitionFullTextUiState(state, { type: "operation-failed", message: operationError(error) }));
    }
  };

  const data = ui.data;
  const busy = ui.phase === "loading" || ui.phase === "working";
  const ocrPageCount = data?.ocr_needed_pages.length ?? 0;
  const ocrAvailable = getWorkspaceMode() !== "local" && data?.can_extract && (data.ocr_needed_pages.length > 0 || data.state === "ocr_needed");
  const includesOcr = data?.provider.includes("tesseract") ?? false;
  const extractedPages = data?.page_count ? t("Text from {count} pages is available.", { count: data.page_count }) : t("Full text is available.");
  return (
    <section className="reader-utility-section full-text-workspace" aria-labelledby="full-text-title">
      <div className="reader-note__heading">
        <div>
          <h2 id="full-text-title">{t("Full Text")}</h2>
        </div>
        <StatusBadge tone={data ? statusTone(data.state) : ui.phase === "error" ? "rose" : "slate"}>
          {t(data ? STATE_LABELS[data.state] : ui.phase === "error" ? "Unavailable" : "Loading")}
        </StatusBadge>
      </div>

      <p className="reader-editor__status" role="status" aria-live="polite">
        {t(ui.message || data?.message || (data?.state === "not_extracted" ? "No extracted text yet." : data?.state === "failed" || data?.state === "ocr_needed" ? "Text extraction failed. This PDF may require OCR." : extractedPages))}
      </p>

      <div className="reader-editor__actions">
        {data?.has_content ? (
          <button className="reader-control" type="button" disabled={busy} onClick={openFullText}>
            <FileText size={15} />{t("View text")}
          </button>
        ) : null}
        {data?.can_extract ? (
          <button className={data.has_content ? "reader-control reader-control--secondary" : "reader-control"} type="button" disabled={busy} onClick={extract}>
            <RefreshCw size={15} />{t(ui.phase === "working" ? "Extracting…" : data.state === "not_extracted" ? "Extract text" : "Re-extract")}
          </button>
        ) : null}
        {ui.phase === "error" ? (
          <button className="reader-control reader-control--secondary" type="button" onClick={loadStatus}>
            <RefreshCw size={15} />{t("Retry Status")}
          </button>
        ) : null}
      </div>

      {ocrAvailable ? <div className="reader-ocr-action">
        <p className="reader-editor__status">{t("OCR runs only after you choose it and processes only pages that need recognition. First use downloads English and Korean models. Each run supports up to 20 scanned pages.")}</p>
        <button className="reader-control reader-control--secondary" type="button" disabled={busy || ocrPageCount > 20} onClick={() => void runOcr()}><ScanText size={15} />{t("Run OCR (English + Korean)")}</button>
        {ocrPageCount > 20 ? <p className="reader-editor__status" role="status">{t("More than 20 pages need OCR. Split the PDF or choose a smaller document before running OCR. No pages will be silently skipped.")}</p> : null}
      </div> : null}
      {ocrActive ? <div className="reader-ocr-progress" aria-live="polite" aria-busy="true">
        <p role="status">{t(OCR_PHASE_LABELS[ocrProgress?.phase ?? ""] || "Starting OCR…")}{ocrProgress?.page && ocrProgress.totalPages ? ` · ${t("Page {page} of {count}", { page: ocrProgress.page, count: ocrProgress.totalPages })}` : ""}</p>
        <progress max={1} value={typeof ocrProgress?.progress === "number" && Number.isFinite(ocrProgress.progress) ? Math.min(1, Math.max(0, ocrProgress.progress)) : undefined} aria-label={t("OCR progress")} />
        <button className="reader-control reader-control--secondary" type="button" disabled={ocrProgress?.phase === "cancelling"} onClick={() => { ocrControllerRef.current?.abort(); setOcrProgress({ phase: "cancelling" }); }}><X size={15} />{t("Cancel OCR")}</button>
      </div> : null}
      {includesOcr || ocrActive || ocrAvailable ? <p className="reader-editor__status">{t("OCR can misread formulas, tables and words. Verify the text against the PDF. OCR output does not make image-only PDF pages selectable or supply PDF highlight coordinates.")}</p> : null}

      {ui.viewerOpen ? (
        <div className="full-text-viewer" role="region" aria-label={t("Full text") }>
          <div className="full-text-viewer__heading">
            <strong>{t("Full text")}</strong>
            <button className="reader-control reader-control--secondary" type="button" onClick={() => setUi((state) => transitionFullTextUiState(state, { type: "viewer-closed" }))}><ArrowLeft size={15} />{t("Back")}</button>
          </div>
          <div className="full-text-search" role="search"><label className="reader-field"><span>{t("Search this full text")}</span><input type="search" maxLength={200} value={query} onChange={(event) => { setQuery(event.target.value); setActiveMatch(0); }} /></label><button className="reader-control reader-control--secondary" type="button" disabled={!matches.length} aria-label={t("Previous match")} onClick={() => setActiveMatch((current) => (current - 1 + matches.length) % matches.length)}><ChevronLeft size={15} /></button><button className="reader-control reader-control--secondary" type="button" disabled={!matches.length} aria-label={t("Next match")} onClick={() => setActiveMatch((current) => (current + 1) % matches.length)}><ChevronRight size={15} /></button></div>
          {query.trim() ? <p role="status">{matches.length ? t("{current} of {count} matches", { current: activeMatch + 1, count: matches.length }) : t("No matches")}{matches.length === 1000 ? ` · ${t("Showing the first 1000 matches")}` : ""}</p> : null}
          {matches.length > 0 && onJumpToPage ? <ul className="full-text-search-results" aria-label={t("Search matches with PDF pages")}>{matches.slice(Math.max(0, activeMatch - 2), activeMatch + 3).map((match) => <li key={match.index}>{match.page ? <button className="text-link" type="button" onClick={() => onJumpToPage(match.page!)}>{t("Page {page}", { page: match.page })}: {match.excerpt}</button> : <span>{match.excerpt}</span>}</li>)}</ul> : null}
          <div ref={textRef}>{query.trim() ? <pre>{segments.map((segment, index) => segment.match ? <mark key={index} data-match-index={segment.match.index} className={segment.match.index === matches[activeMatch]?.index ? "is-active" : ""}>{segment.text}</mark> : segment.text)}</pre> : <pre>{ui.content}</pre>}</div>
        </div>
      ) : null}
    </section>
  );
}
