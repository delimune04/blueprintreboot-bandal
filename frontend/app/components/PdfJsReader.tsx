"use client";

import { AlertCircle, ChevronLeft, ChevronRight, ExternalLink, LoaderCircle, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { paperPdfUrl } from "../lib/api/client";
import { createPdfLoadingTask, createPdfTextLayer, readPdfNetworkDiagnostics, type PDFDocumentProxy } from "../lib/pdf/pdfjs-adapter";
import { createPdfViewportAnchor, scrollTopForPdfViewportAnchor } from "../lib/pdf/resize-anchor.mjs";
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, ZOOM_STEP, canvasRenderGeometry, classifyPdfError, fitPageZoom, fitWidthZoom } from "../lib/pdf/reader-controller.mjs";
import { readPageSelection, type PdfPageSelection } from "../lib/pdf/selection-coordinates.mjs";
import { readReaderPreferences, updateReaderPreferences, type ReaderHighlight } from "../lib/reader/browser-reader-state.mjs";
import { useI18n } from "../lib/i18n/LocaleProvider";
import { visiblePdfPage } from "../lib/reader/visible-pdf-page.mjs";

type PdfReaderUiState = {
  mode: "loading" | "ready" | "error";
  pageNumber: number;
  totalPages: number;
  zoom: number;
  rendering: boolean;
  errorKind: "not-found" | "unavailable" | "load" | "render" | null;
  message: string;
};

type PdfReaderDiagnostics = {
  documentLoadCount: number;
  renderCount: number;
  renderCancellationCount: number;
  documentLoadDurationMs: number | null;
  firstPageRenderDurationMs: number | null;
  requestCount: number | null;
  rangeRequestCount: number | null;
  fullRequestCount: number | null;
  requestMode: string;
};

const INITIAL_STATE: PdfReaderUiState = {
  mode: "loading",
  pageNumber: 1,
  totalPages: 0,
  zoom: DEFAULT_ZOOM,
  rendering: false,
  errorKind: null,
  message: "",
};

const INITIAL_DIAGNOSTICS: PdfReaderDiagnostics = {
  documentLoadCount: 0,
  renderCount: 0,
  renderCancellationCount: 0,
  documentLoadDurationMs: null,
  firstPageRenderDurationMs: null,
  requestCount: null,
  rangeRequestCount: null,
  fullRequestCount: null,
  requestMode: "pdfjs-auto",
};

type RenderTaskLike = { promise: Promise<void>; cancel?: () => void };
type PdfViewMode = "fit-width" | "fit-page" | "manual";
type PdfViewportAnchor = ReturnType<typeof createPdfViewportAnchor>;

const PDF_VIEW_PREFERENCE_KEY = "blueprint-reboot:pdf-view-preference";
const PDF_VIEWPORT_PADDING = 48;
function readerStorage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

function readPdfViewPreference(): { mode: PdfViewMode; zoom: number } {
  if (typeof window === "undefined") return { mode: "fit-width", zoom: DEFAULT_ZOOM };
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(PDF_VIEW_PREFERENCE_KEY) || "");
    if (!parsed || !["fit-width", "fit-page", "manual"].includes(parsed.mode)) return { mode: "fit-width", zoom: DEFAULT_ZOOM };
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(parsed.zoom) || DEFAULT_ZOOM));
    return { mode: parsed.mode, zoom };
  } catch {
    return { mode: "fit-width", zoom: DEFAULT_ZOOM };
  }
}

function NativePdfFallback({ pdfUrl, onRetry }: { pdfUrl: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="reader-native-fallback-shell" role="region" aria-label={t("Native browser PDF fallback")}>
      <div className="reader-fallback-banner" role="status">
        <strong>{t("Native browser fallback active")}</strong>
        <span>{t("PDF.js is not mounted while this fallback is displayed.")}</span>
      </div>
      <object className="reader-pdf-viewer" data={pdfUrl} type="application/pdf" aria-label={t("Native browser PDF fallback viewer")}>
        <div className="reader-native-fallback">
          <h2>{t("Browser PDF viewer unavailable")}</h2>
          <p>{t("This browser cannot display the managed PDF inline.")}</p>
          <a className="text-link" href={pdfUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />{t("Open the managed PDF in a browser tab")}</a>
        </div>
      </object>
      <div className="reader-fallback-actions"><button className="reader-control" type="button" onClick={onRetry}>{t("Retry PDF.js Reader")}</button></div>
    </div>
  );
}

function ReaderDiagnostics({ diagnostics }: { diagnostics: PdfReaderDiagnostics }) {
  const { t } = useI18n();
  return (
    <details className="reader-diagnostics">
      <summary>{t("Reader diagnostics (development only)")}</summary>
      <dl>
        <div><dt>{t("Document loads")}</dt><dd>{diagnostics.documentLoadCount}</dd></div>
        <div><dt>{t("Page renders")}</dt><dd>{diagnostics.renderCount}</dd></div>
        <div><dt>{t("Render cancellations")}</dt><dd>{diagnostics.renderCancellationCount}</dd></div>
        <div><dt>{t("First page render")}</dt><dd>{diagnostics.firstPageRenderDurationMs === null ? "Pending" : `${Math.round(diagnostics.firstPageRenderDurationMs)} ms`}</dd></div>
        <div><dt>{t("Observed PDF requests")}</dt><dd>{diagnostics.requestCount ?? "Unavailable"}</dd></div>
        <div><dt>{t("Observed Range responses")}</dt><dd>{diagnostics.rangeRequestCount ?? "Unavailable"}</dd></div>
        <div><dt>{t("Request mode")}</dt><dd>{diagnostics.requestMode}</dd></div>
      </dl>
    </details>
  );
}

function ContinuousPdfPage({
  document,
  pageNumber,
  zoom,
  viewportRoot,
  active,
  onRendered,
  onRenderError,
  onSelectionChange,
  highlights,
  defaultPageSize,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  viewportRoot: HTMLElement | null;
  active: boolean;
  onRendered: (page: number, durationMs: number) => void;
  onRenderError: (error: unknown) => void;
  onSelectionChange?: (selection: PdfPageSelection | null) => void;
  highlights: ReaderHighlight[];
  defaultPageSize: { width: number; height: number };
}) {
  const { t } = useI18n();
  const pageSurfaceRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [logicalSize, setLogicalSize] = useState(defaultPageSize);
  const shouldRender = active || nearViewport;

  useEffect(() => {
    const element = pageSurfaceRef.current;
    if (!element || !viewportRoot || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      setNearViewport(Boolean(entry?.isIntersecting));
    }, { root: viewportRoot, rootMargin: "320px 0px", threshold: [0] });
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewportRoot]);

  useEffect(() => {
    if (!shouldRender) return;
    const ownedCanvas = canvasRef.current;
    const ownedTextLayer = textLayerRef.current;
    let cancelled = false;
    let page: Awaited<ReturnType<PDFDocumentProxy["getPage"]>> | null = null;
    let renderTask: RenderTaskLike | null = null;
    let textLayer: Awaited<ReturnType<typeof createPdfTextLayer>> | null = null;
    const startedAt = performance.now();
    const render = async () => {
      try {
        page = await document.getPage(pageNumber);
        if (cancelled) return;
        const canvas = canvasRef.current;
        const textLayerContainer = textLayerRef.current;
        const canvasContext = canvas?.getContext("2d", { alpha: false });
        if (!canvas || !canvasContext || !textLayerContainer) throw new Error("Canvas context unavailable");
        const pageViewport = page.getViewport({ scale: zoom });
        setLogicalSize({ width: pageViewport.width / zoom, height: pageViewport.height / zoom });
        const geometry = canvasRenderGeometry(pageViewport, window.devicePixelRatio || 1);
        canvas.width = geometry.canvasWidth;
        canvas.height = geometry.canvasHeight;
        canvas.style.width = `${geometry.cssWidth}px`;
        canvas.style.height = `${geometry.cssHeight}px`;
        textLayerContainer.replaceChildren();
        textLayerContainer.style.setProperty("--total-scale-factor", String(pageViewport.scale));
        textLayerContainer.style.setProperty("--scale-round-x", "1px");
        textLayerContainer.style.setProperty("--scale-round-y", "1px");
        renderTask = page.render({ canvas, canvasContext, viewport: pageViewport, ...(geometry.transform ? { transform: geometry.transform } : {}) }) as RenderTaskLike;
        textLayer = await createPdfTextLayer({ page, container: textLayerContainer, viewport: pageViewport });
        await Promise.all([renderTask.promise, textLayer.render()]);
        if (!cancelled) onRendered(pageNumber, Math.max(0, performance.now() - startedAt));
      } catch (error) {
        if (!cancelled && (error as { name?: string } | null)?.name !== "RenderingCancelledException") onRenderError(error);
      } finally {
        page?.cleanup();
      }
    };
    void render();
    return () => {
      cancelled = true;
      textLayer?.cancel();
      renderTask?.cancel?.();
      // Free backing memory when a page leaves the bounded render window.
      if (ownedCanvas) { ownedCanvas.width = 0; ownedCanvas.height = 0; }
      ownedTextLayer?.replaceChildren();
    };
  }, [document, onRenderError, onRendered, pageNumber, shouldRender, zoom]);

  const publishSelection = () => {
    if (!onSelectionChange || !pageSurfaceRef.current) return;
    const selection = readPageSelection({ pageNumber, pageElement: pageSurfaceRef.current });
    if (selection) onSelectionChange(selection);
  };

  useEffect(() => {
    if (!shouldRender || !onSelectionChange) return;
    const selectionChanged = () => {
      if (!pageSurfaceRef.current) return;
      const selection = readPageSelection({ pageNumber, pageElement: pageSurfaceRef.current });
      if (selection) onSelectionChange(selection);
    };
    // iOS selection handles do not reliably dispatch mouseup.
    globalThis.document.addEventListener("selectionchange", selectionChanged);
    return () => globalThis.document.removeEventListener("selectionchange", selectionChanged);
  }, [document, onSelectionChange, pageNumber, shouldRender]);

  return (
    <div id={`pdf-page-${pageNumber}`} ref={pageSurfaceRef} className="reader-page-surface reader-page-surface--continuous" style={{ width: logicalSize.width * zoom, height: logicalSize.height * zoom }} data-page-number={pageNumber} onPointerUp={publishSelection} onKeyUp={publishSelection}>
      <canvas ref={canvasRef} className="reader-canvas" role="img" aria-label={t("PDF page {page}", { page: pageNumber })}>{t("A PDF page is displayed in this canvas when PDF.js rendering succeeds.")}</canvas>
      <div className="reader-pdf-highlight-layer" aria-hidden="true">{highlights.flatMap((highlight) => highlight.rectangles.map((rect, index) => <span key={`${highlight.id}:${index}`} className="reader-pdf-highlight" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }} />))}</div>
      <div ref={textLayerRef} className="textLayer reader-text-layer" data-page-number={pageNumber} aria-label={t("Selectable text for PDF page {page}", { page: pageNumber })} />
    </div>
  );
}

export function PdfJsReader({
  paperId,
  onSelectionChange,
  layoutResizeActive = false,
  layoutResizeVersion = 0,
  onCaptureLayoutAnchor,
  pageJump,
  highlights = [],
  onRemoveHighlight,
  selectionActions,
}: {
  paperId: string;
  onSelectionChange?: (selection: PdfPageSelection | null) => void;
  layoutResizeActive?: boolean;
  layoutResizeVersion?: number;
  onCaptureLayoutAnchor?: (capture: (() => void) | null) => void;
  pageJump?: { page: number; token: number } | null;
  highlights?: ReaderHighlight[];
  onRemoveHighlight?: (id: string) => void;
  selectionActions?: ReactNode;
}) {
  const { t } = useI18n();
  const pdfUrl = useMemo(() => paperPdfUrl(paperId), [paperId]);
  const [state, setState] = useState<PdfReaderUiState>(INITIAL_STATE);
  const [diagnostics, setDiagnostics] = useState<PdfReaderDiagnostics>(INITIAL_DIAGNOSTICS);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageInput, setPageInput] = useState("1");
  const [viewportRoot, setViewportRoot] = useState<HTMLDivElement | null>(null);
  const viewportRootRef = useRef<HTMLDivElement | null>(null);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const viewPreferenceRef = useRef(readPdfViewPreference());
  const [viewMode, setViewMode] = useState<PdfViewMode>(() => viewPreferenceRef.current.mode);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [fallbackActive, setFallbackActive] = useState(false);
  const pendingLayoutAnchorRef = useRef<PdfViewportAnchor | null>(null);
  const initialPageRef = useRef<number | null>(null);
  const [preferenceMessage, setPreferenceMessage] = useState("");
  const diagnosticsEnabled = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_BLUEPRINT_READER_DIAGNOSTICS === "1";

  useEffect(() => {
    if (fallbackActive) return;
    let current = true;
    let loadingTask: Awaited<ReturnType<typeof createPdfLoadingTask>> | null = null;
    let document: PDFDocumentProxy | null = null;
    const startedAt = performance.now();
    setPdfDocument(null);
    setState({ ...INITIAL_STATE, mode: "loading" });
    setDiagnostics((value) => ({ ...INITIAL_DIAGNOSTICS, documentLoadCount: value.documentLoadCount + 1 }));
    const load = async () => {
      try {
        loadingTask = await createPdfLoadingTask(pdfUrl);
        document = await loadingTask.promise;
        if (!current) return;
        const network = readPdfNetworkDiagnostics(pdfUrl);
        const preference = readReaderPreferences(readerStorage(), paperId);
        const restoredPage = Math.min(Math.max(1, preference.value.page), document.numPages);
        initialPageRef.current = restoredPage;
        if (!preference.ok) setPreferenceMessage(preference.message);
        const firstPage = await document.getPage(1);
        const firstViewport = firstPage.getViewport({ scale: 1 });
        if (!current) return;
        setPageSize({ width: firstViewport.width, height: firstViewport.height });
        setPdfDocument(document);
        setState({ mode: "ready", pageNumber: restoredPage, totalPages: Math.max(1, Number(document.numPages) || 1), zoom: viewPreferenceRef.current.mode === "manual" ? viewPreferenceRef.current.zoom : DEFAULT_ZOOM, rendering: true, errorKind: null, message: "" });
        setDiagnostics((value) => ({ ...value, documentLoadDurationMs: Math.max(0, performance.now() - startedAt), requestCount: network.requestCount, rangeRequestCount: network.rangeRequestCount, fullRequestCount: network.fullRequestCount, requestMode: network.requestMode }));
      } catch (error) {
        if (!current) return;
        setState((value) => ({ ...value, mode: "error", rendering: false, ...classifyPdfError(error, "load") }));
      }
    };
    void load();
    return () => {
      current = false;
      void loadingTask?.destroy();
      void document?.destroy();
    };
  }, [fallbackActive, loadAttempt, paperId, pdfUrl]);

  useEffect(() => setPageInput(String(state.pageNumber)), [state.pageNumber]);

  const setViewportElement = useCallback((element: HTMLDivElement | null) => {
    viewportRootRef.current = element;
    setViewportRoot(element);
  }, []);

  const captureLayoutAnchor = useCallback(() => {
    if (pendingLayoutAnchorRef.current) return;
    const viewport = viewportRootRef.current;
    if (!viewport) return;
    const viewportRect = viewport.getBoundingClientRect();
    const viewportAnchorY = viewportRect.top + viewport.clientHeight / 2;
    const pages = Array.from(viewport.querySelectorAll<HTMLElement>(".reader-page-surface[data-page-number]"));
    let target: HTMLElement | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const page of pages) {
      const rect = page.getBoundingClientRect();
      if (rect.height <= 0) continue;
      if (rect.top <= viewportAnchorY && rect.bottom >= viewportAnchorY) {
        target = page;
        break;
      }
      const distance = Math.min(Math.abs(rect.top - viewportAnchorY), Math.abs(rect.bottom - viewportAnchorY));
      if (distance < closestDistance) {
        closestDistance = distance;
        target = page;
      }
    }
    if (!target) return;
    const targetRect = target.getBoundingClientRect();
    const pageNumber = Number(target.dataset.pageNumber);
    pendingLayoutAnchorRef.current = createPdfViewportAnchor({
      pageNumber,
      pageTop: viewport.scrollTop + targetRect.top - viewportRect.top,
      pageHeight: targetRect.height,
      viewportTop: viewport.scrollTop,
      viewportHeight: viewport.clientHeight,
    });
  }, []);

  const restoreLayoutAnchor = useCallback(() => {
    const anchor = pendingLayoutAnchorRef.current;
    const viewport = viewportRootRef.current;
    if (!anchor || !viewport) return false;
    const target = viewport.querySelector<HTMLElement>(`#pdf-page-${anchor.pageNumber}`);
    if (!target) return false;
    const viewportRect = viewport.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (targetRect.height <= 0) return false;
    viewport.scrollTop = scrollTopForPdfViewportAnchor({
      pageTop: viewport.scrollTop + targetRect.top - viewportRect.top,
      pageHeight: targetRect.height,
      relativePageOffset: anchor.relativePageOffset,
      viewportAnchorOffset: anchor.viewportAnchorOffset,
    });
    pendingLayoutAnchorRef.current = null;
    return true;
  }, []);

  useEffect(() => {
    onCaptureLayoutAnchor?.(captureLayoutAnchor);
    return () => onCaptureLayoutAnchor?.(null);
  }, [captureLayoutAnchor, onCaptureLayoutAnchor]);

  useEffect(() => {
    if (layoutResizeActive) captureLayoutAnchor();
  }, [captureLayoutAnchor, layoutResizeActive]);

  useEffect(() => {
    if (!pdfDocument || state.mode !== "ready") return;
    let active = true;
    void pdfDocument.getPage(state.pageNumber).then((page) => {
      if (!active) return;
      const viewport = page.getViewport({ scale: 1 });
      setPageSize({ width: viewport.width, height: viewport.height });
    }).catch(() => { /* The normal render path owns visible error handling. */ });
    return () => { active = false; };
  }, [pdfDocument, state.mode, state.pageNumber]);

  const applyFitMode = useCallback((mode: Exclude<PdfViewMode, "manual">) => {
    const viewport = viewportRootRef.current;
    if (!viewport || !pageSize.width || !pageSize.height) return;
    const zoom = mode === "fit-width"
      ? fitWidthZoom({ availableWidth: viewport.clientWidth, pageWidth: pageSize.width, horizontalPadding: PDF_VIEWPORT_PADDING })
      : fitPageZoom({ availableWidth: viewport.clientWidth, availableHeight: viewport.clientHeight, pageWidth: pageSize.width, pageHeight: pageSize.height, horizontalPadding: PDF_VIEWPORT_PADDING, verticalPadding: PDF_VIEWPORT_PADDING });
    setState((current) => current.zoom === zoom ? current : { ...current, zoom, rendering: true });
  }, [pageSize]);

  useEffect(() => {
    if (!viewportRoot || !pageSize.width || viewMode === "manual" || layoutResizeActive) return;
    const update = () => applyFitMode(viewMode);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(viewportRoot);
    return () => observer.disconnect();
  }, [applyFitMode, layoutResizeActive, pageSize.width, viewMode, viewportRoot]);

  useEffect(() => {
    if (layoutResizeActive || !pendingLayoutAnchorRef.current) return;
    // A manual zoom does not rerender page geometry. For fit modes this is a
    // fallback behind onRendered, which restores as soon as the anchor page's
    // new canvas/text layer dimensions are available.
    if (viewMode !== "manual") return;
    const frame = window.requestAnimationFrame(() => { restoreLayoutAnchor(); });
    return () => window.cancelAnimationFrame(frame);
  }, [layoutResizeActive, layoutResizeVersion, restoreLayoutAnchor, viewMode]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(PDF_VIEW_PREFERENCE_KEY, JSON.stringify({ mode: viewMode, zoom: state.zoom }));
    } catch { /* The active reader remains usable when session storage is unavailable. */ }
  }, [state.zoom, viewMode]);

  const setPage = useCallback((requestedPage: number) => {
    if (state.mode !== "ready") return;
    const pageNumber = Math.min(state.totalPages, Math.max(1, Math.trunc(requestedPage)));
    setState((current) => ({ ...current, pageNumber, rendering: true }));
    window.requestAnimationFrame(() => {
      const viewport = viewportRootRef.current;
      const target = viewport?.querySelector<HTMLElement>(`#pdf-page-${pageNumber}`);
      if (!target || !viewport) return;
      viewport.scrollTo({ top: viewport.scrollTop + target.getBoundingClientRect().top - viewport.getBoundingClientRect().top, behavior: "auto" });
    });
  }, [state.mode, state.totalPages]);
  useEffect(() => {
    if (state.mode !== "ready" || !viewportRoot || initialPageRef.current === null) return;
    const page = initialPageRef.current;
    initialPageRef.current = null;
    setPage(page);
  }, [setPage, state.mode, viewportRoot]);
  useEffect(() => { if (pageJump && state.mode === "ready") setPage(pageJump.page); }, [pageJump, setPage, state.mode]);
  useEffect(() => {
    if (state.mode !== "ready") return;
    const saved = updateReaderPreferences(readerStorage(), paperId, (current) => ({ ...current, page: state.pageNumber }));
    if (!saved.ok) setPreferenceMessage(saved.message);
  }, [paperId, state.mode, state.pageNumber]);
  const commitPageInput = () => {
    const requestedPage = Number.parseInt(pageInput, 10);
    if (!Number.isFinite(requestedPage)) return setPageInput(String(state.pageNumber));
    setPage(requestedPage);
  };
  const setManualZoom = (requestedZoom: number) => {
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, requestedZoom));
    setViewMode("manual");
    setState((current) => ({ ...current, zoom, rendering: true }));
  };
  const chooseFitMode = (mode: Exclude<PdfViewMode, "manual">) => {
    setViewMode(mode);
    applyFitMode(mode);
  };
  const onVisible = useCallback((pageNumber: number) => {
    if (initialPageRef.current !== null) return;
    setState((current) => current.mode === "ready" && current.pageNumber !== pageNumber ? { ...current, pageNumber } : current);
  }, []);
  const onRendered = useCallback((pageNumber: number, durationMs: number) => {
    if (!layoutResizeActive && pendingLayoutAnchorRef.current?.pageNumber === pageNumber) restoreLayoutAnchor();
    setState((current) => current.pageNumber === pageNumber ? { ...current, rendering: false } : current);
    setDiagnostics((current) => ({ ...current, renderCount: current.renderCount + 1, firstPageRenderDurationMs: current.firstPageRenderDurationMs ?? durationMs }));
  }, [layoutResizeActive, restoreLayoutAnchor]);
  const onRenderError = useCallback((error: unknown) => setState((current) => ({ ...current, mode: "error", rendering: false, ...classifyPdfError(error, "render") })), []);
  useEffect(() => {
    if (!viewportRoot || state.mode !== "ready") return;
    let frame: number | null = null;
    const updateVisiblePage = () => {
      frame = null;
      const viewportRect = viewportRoot.getBoundingClientRect();
      const pages = Array.from(viewportRoot.querySelectorAll<HTMLElement>(".reader-page-surface[data-page-number]")).map((element) => {
        const rect = element.getBoundingClientRect();
        return { page: Number(element.dataset.pageNumber), top: viewportRoot.scrollTop + rect.top - viewportRect.top, height: rect.height };
      });
      const page = visiblePdfPage(pages, viewportRoot.scrollTop, viewportRoot.clientHeight);
      if (page) onVisible(page);
    };
    const schedule = () => { if (frame === null) frame = window.requestAnimationFrame(updateVisiblePage); };
    viewportRoot.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => { viewportRoot.removeEventListener("scroll", schedule); if (frame !== null) window.cancelAnimationFrame(frame); };
  }, [onVisible, state.mode, viewportRoot]);

  if (fallbackActive) return <NativePdfFallback pdfUrl={pdfUrl} onRetry={() => { setFallbackActive(false); setLoadAttempt((value) => value + 1); }} />;

  const controlsReady = state.mode === "ready";
  return (
    <div className="pdfjs-reader">
      <div className="reader-toolbar" role="toolbar" aria-label={t("PDF page and zoom controls")}>
        <div className="reader-toolbar__group" aria-label={t("Page navigation")}>
          <button className="reader-control" type="button" aria-label={t("Previous PDF page")} disabled={!controlsReady || state.pageNumber <= 1} onClick={() => setPage(state.pageNumber - 1)}><ChevronLeft size={16} />{t("Previous")}</button>
          <label className="reader-page-field"><span>{t("Page")}</span><input aria-label={t("PDF page number")} type="number" inputMode="numeric" min={1} max={Math.max(1, state.totalPages)} value={pageInput} disabled={!controlsReady} onChange={(event) => setPageInput(event.target.value)} onBlur={commitPageInput} onKeyDown={(event) => { if (event.key === "Enter") commitPageInput(); }} /><span aria-live="polite">{t("of {count}", { count: state.totalPages || "?" })}</span></label>
          <button className="reader-control" type="button" aria-label={t("Next PDF page")} disabled={!controlsReady || state.pageNumber >= state.totalPages} onClick={() => setPage(state.pageNumber + 1)}>{t("Next")}<ChevronRight size={16} /></button>
        </div>
        <div className="reader-toolbar__group" aria-label={t("PDF zoom controls")}>
          <button className={viewMode === "fit-width" ? "reader-control reader-control--active" : "reader-control reader-control--secondary"} type="button" title={t("Fit PDF to available width")} aria-label={t("Fit PDF to available width")} aria-pressed={viewMode === "fit-width"} disabled={!controlsReady} onClick={() => chooseFitMode("fit-width")}>{t("Fit width")}</button>
          <button className={viewMode === "fit-page" ? "reader-control reader-control--active" : "reader-control reader-control--secondary"} type="button" title={t("Fit PDF page to available space")} aria-label={t("Fit PDF page to available space")} aria-pressed={viewMode === "fit-page"} disabled={!controlsReady} onClick={() => chooseFitMode("fit-page")}>{t("Fit page")}</button>
          <button className="reader-control" type="button" aria-label={t("Zoom out")} title={t("Zoom out")} disabled={!controlsReady || state.zoom <= MIN_ZOOM} onClick={() => setManualZoom(state.zoom - ZOOM_STEP)}><ZoomOut size={16} /><span className="sr-only">{t("Zoom out")}</span></button>
          <output className="reader-zoom-value" aria-live="polite">{Math.round(state.zoom * 100)}% <span className="sr-only">{viewMode === "manual" ? "manual zoom" : viewMode.replace("-", " ")}</span></output>
          <button className="reader-control" type="button" aria-label={t("Zoom in")} title={t("Zoom in")} disabled={!controlsReady || state.zoom >= MAX_ZOOM} onClick={() => setManualZoom(state.zoom + ZOOM_STEP)}><ZoomIn size={16} /><span className="sr-only">{t("Zoom in")}</span></button>
          <button className="reader-control reader-control--secondary" type="button" aria-label={t("Set manual zoom to 100 percent")} title={t("Set manual zoom to 100 percent")} disabled={!controlsReady || (viewMode === "manual" && state.zoom === DEFAULT_ZOOM)} onClick={() => setManualZoom(DEFAULT_ZOOM)}><RotateCcw size={16} /><span className="sr-only">{t("Manual 100 percent")}</span></button>
        </div>
      </div>
      {selectionActions}
      <div ref={setViewportElement} className="reader-canvas-viewport">
        {pdfDocument ? <div className="reader-pdf-page-stack">{Array.from({ length: state.totalPages }, (_, index) => index + 1).map((pageNumber) => <ContinuousPdfPage key={pageNumber} document={pdfDocument} pageNumber={pageNumber} zoom={state.zoom} viewportRoot={viewportRoot} active={state.pageNumber === pageNumber} defaultPageSize={pageSize.width ? pageSize : { width: 612, height: 792 }} highlights={highlights.filter((highlight) => highlight.pageNumber === pageNumber)} onRendered={onRendered} onRenderError={onRenderError} onSelectionChange={onSelectionChange} />)}</div> : null}
        {state.mode === "loading" ? <div className="reader-render-state" role="status"><LoaderCircle className="loading-icon" size={22} aria-hidden="true" /><div><h2>{t("Loading PDF.js Reader")}</h2><p>{t("Loading the managed PDF through the local same-origin endpoint.")}</p></div></div> : null}
        {state.mode === "ready" && state.rendering ? <div className="reader-render-progress" role="status">{t("Rendering page {page}…", { page: state.pageNumber })}</div> : null}
        {state.mode === "error" ? <div className="reader-render-state" role="alert"><AlertCircle size={22} aria-hidden="true" /><div><h2>{state.errorKind === "unavailable" ? "Local PDF service unavailable" : state.errorKind === "not-found" ? "Managed PDF missing" : "PDF.js Reader unavailable"}</h2><p>{state.message || "The managed PDF could not be displayed."}</p><div className="reader-error-actions"><button className="reader-control" type="button" onClick={() => setLoadAttempt((value) => value + 1)}>{t("Retry PDF.js")}</button><button className="reader-control reader-control--secondary" type="button" onClick={() => setFallbackActive(true)}>{t("Use native viewer fallback")}</button></div></div></div> : null}
      </div>
      {highlights.length ? <details className="reader-highlight-list"><summary>{t("Highlights ({count})", { count: highlights.length })}</summary>{highlights.map((highlight) => <div key={highlight.id}><button className="text-link" type="button" onClick={() => setPage(highlight.pageNumber)}>{t("Page {page}", { page: highlight.pageNumber })}: {highlight.text.slice(0, 100)}</button>{onRemoveHighlight ? <button className="reader-control reader-control--secondary" type="button" onClick={() => onRemoveHighlight(highlight.id)}>{t("Remove highlight")}</button> : null}</div>)}</details> : null}
      {preferenceMessage ? <p className="reader-editor__status" role="status">{t(preferenceMessage)}</p> : null}
      {diagnosticsEnabled ? <ReaderDiagnostics diagnostics={diagnostics} /> : null}
    </div>
  );
}
