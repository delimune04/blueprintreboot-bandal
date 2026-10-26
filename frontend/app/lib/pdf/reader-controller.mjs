export const DEFAULT_ZOOM = 1;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 3;
export const ZOOM_STEP = 0.25;
export const RENDER_QUALITY_MULTIPLIER = 1.5;
export const MAX_OUTPUT_SCALE = 3;

// These helpers deliberately operate on logical PDF viewport dimensions only.
// Canvas DPR scaling remains in canvasRenderGeometry so fit modes cannot change
// text-layer alignment or high-density rendering quality.
export function fitWidthZoom({ availableWidth, pageWidth, horizontalPadding = 0 }) {
  const width = Math.max(1, Number(availableWidth) - Math.max(0, Number(horizontalPadding) || 0));
  const page = Math.max(1, Number(pageWidth) || 1);
  return clamp(width / page, MIN_ZOOM, MAX_ZOOM);
}

export function fitPageZoom({ availableWidth, availableHeight, pageWidth, pageHeight, horizontalPadding = 0, verticalPadding = 0 }) {
  const width = Math.max(1, Number(availableWidth) - Math.max(0, Number(horizontalPadding) || 0));
  const height = Math.max(1, Number(availableHeight) - Math.max(0, Number(verticalPadding) || 0));
  const pageWidthValue = Math.max(1, Number(pageWidth) || 1);
  const pageHeightValue = Math.max(1, Number(pageHeight) || 1);
  return clamp(Math.min(width / pageWidthValue, height / pageHeightValue), MIN_ZOOM, MAX_ZOOM);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeOutputScale(value) {
  const numericScale = Number(value);
  const deviceScale = Number.isFinite(numericScale) ? numericScale : 1;
  return clamp(deviceScale * RENDER_QUALITY_MULTIPLIER, 1, MAX_OUTPUT_SCALE);
}

export function canvasRenderGeometry(viewport, devicePixelRatio) {
  const scale = normalizeOutputScale(devicePixelRatio);
  const cssWidth = Math.max(1, Number(viewport?.width) || 1);
  const cssHeight = Math.max(1, Number(viewport?.height) || 1);
  return {
    cssWidth,
    cssHeight,
    canvasWidth: Math.max(1, Math.ceil(cssWidth * scale)),
    canvasHeight: Math.max(1, Math.ceil(cssHeight * scale)),
    outputScale: scale,
    transform: scale === 1 ? undefined : [scale, 0, 0, scale, 0, 0],
  };
}

function safeStatus(error) {
  if (!error || typeof error !== "object") return undefined;
  const status = Number(error.status);
  return Number.isInteger(status) ? status : undefined;
}

export function isPdfCancellation(error) {
  return Boolean(
    error
      && typeof error === "object"
      && (error.name === "RenderingCancelledException" || error.name === "AbortException"),
  );
}

export function classifyPdfError(error, phase = "load") {
  const status = safeStatus(error);
  if (status === 404) {
    return { errorKind: "not-found", message: "The managed PDF is missing." };
  }
  if (status === 503 || (error && typeof error === "object" && error.name === "ResponseException")) {
    return {
      errorKind: "unavailable",
      message: "The local PDF service is unavailable. Start the local API and retry.",
    };
  }
  if (phase === "render") {
    return {
      errorKind: "render",
      message: "PDF.js could not render this page. Retry or use the native browser fallback.",
    };
  }
  return {
    errorKind: "load",
    message: "PDF.js could not load this managed PDF. Retry or use the native browser fallback.",
  };
}

function initialState() {
  return {
    mode: "idle",
    pageNumber: 1,
    totalPages: 0,
    zoom: DEFAULT_ZOOM,
    rendering: false,
    errorKind: null,
    message: "",
  };
}

function initialDiagnostics() {
  return {
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
}

function createLoadOperation(cycle) {
  return {
    cycle,
    cancelled: false,
    creationPromise: null,
    loadingTask: null,
    documentPromise: null,
    document: null,
    renderTask: null,
    activePage: null,
    renderCycle: 0,
    textLayer: null,
    textLayerPromise: null,
    disposalPromise: null,
  };
}

async function safeCall(callback) {
  try {
    await callback?.();
  } catch {
    // Cleanup is best-effort and deliberately never hides the originating load/render error.
  }
}

export class PdfReaderController {
  constructor({
    createLoadingTask,
    createTextLayer = null,
    getCanvas,
    getTextLayerContainer = () => null,
    getOutputScale = () => globalThis.devicePixelRatio || 1,
    onState = () => {},
    onDiagnostics = () => {},
    getNetworkDiagnostics = () => ({}),
    now = () => performance.now(),
    isCurrent = () => true,
  }) {
    this.createLoadingTask = createLoadingTask;
    this.createTextLayer = createTextLayer;
    this.getCanvas = getCanvas;
    this.getTextLayerContainer = getTextLayerContainer;
    this.getOutputScale = getOutputScale;
    this.onState = onState;
    this.onDiagnostics = onDiagnostics;
    this.getNetworkDiagnostics = getNetworkDiagnostics;
    this.now = now;
    this.isCurrent = isCurrent;

    this.state = initialState();
    this.diagnostics = initialDiagnostics();
    this.url = "";
    this.activeLoad = null;
    this.loadCycle = 0;
    this.destroyed = false;
  }

  snapshot() {
    return { ...this.state };
  }

  diagnosticsSnapshot() {
    return { ...this.diagnostics };
  }

  _emitState(nextState) {
    this.state = { ...this.state, ...nextState };
    if (this.isCurrent()) this.onState(this.snapshot());
  }

  _emitDiagnostics(nextDiagnostics = {}) {
    this.diagnostics = { ...this.diagnostics, ...nextDiagnostics };
    if (this.isCurrent()) this.onDiagnostics(this.diagnosticsSnapshot());
  }

  _isActive(operation) {
    return Boolean(
      operation
        && this.activeLoad === operation
        && operation.cycle === this.loadCycle
        && !operation.cancelled
        && !this.destroyed,
    );
  }

  async load(url) {
    if (this.destroyed) return;
    const cycle = ++this.loadCycle;
    this.url = url;
    this._emitState({
      mode: url ? "loading" : "empty",
      pageNumber: 1,
      totalPages: 0,
      zoom: DEFAULT_ZOOM,
      rendering: false,
      errorKind: null,
      message: url ? "" : "No managed PDF URL is available.",
    });
    const previousOperation = this.activeLoad;
    if (previousOperation) {
      previousOperation.cancelled = true;
      this.activeLoad = null;
    }
    await this._disposeLoadOperation(previousOperation);
    if (!url || cycle !== this.loadCycle || this.destroyed) return;

    const operation = createLoadOperation(cycle);
    this.activeLoad = operation;
    const loadStartedAt = this.now();
    this._emitDiagnostics({
      documentLoadCount: this.diagnostics.documentLoadCount + 1,
      documentLoadDurationMs: null,
      firstPageRenderDurationMs: null,
      requestCount: null,
      rangeRequestCount: null,
      fullRequestCount: null,
      requestMode: "pdfjs-auto",
    });

    try {
      operation.creationPromise = Promise.resolve(this.createLoadingTask(url)).then((loadingTask) => {
        operation.loadingTask = loadingTask;
        operation.documentPromise = Promise.resolve(loadingTask.promise).then((document) => {
          operation.document = document;
          return document;
        });
        // Observe the PDF.js task immediately, including cancellation before load() resumes.
        operation.documentPromise.catch(() => {});
        return loadingTask;
      });
      operation.creationPromise.catch(() => {});

      await operation.creationPromise;
      if (!this._isActive(operation)) {
        await this._disposeLoadOperation(operation);
        return;
      }
      const document = await operation.documentPromise;
      if (!this._isActive(operation)) {
        await this._disposeLoadOperation(operation);
        return;
      }

      const totalPages = Math.max(1, Number(document.numPages) || 1);
      this._emitDiagnostics({ documentLoadDurationMs: Math.max(0, this.now() - loadStartedAt) });
      this._emitState({
        mode: "ready",
        pageNumber: 1,
        totalPages,
        zoom: DEFAULT_ZOOM,
        rendering: true,
        errorKind: null,
        message: "",
      });
      await this._renderCurrentPage({ firstPage: true, operation });
    } catch (error) {
      if (!this._isActive(operation) || isPdfCancellation(error)) return;
      operation.cancelled = true;
      this.activeLoad = null;
      await this._disposeLoadOperation(operation);
      if (cycle !== this.loadCycle || this.destroyed) return;
      this._emitState({
        mode: "error",
        rendering: false,
        ...classifyPdfError(error, "load"),
      });
    }
  }

  retry() {
    return this.load(this.url);
  }

  setPage(requestedPage) {
    const operation = this.activeLoad;
    if (!this._isActive(operation) || !operation.document || this.state.mode !== "ready") {
      return Promise.resolve();
    }
    const numericPage = Number(requestedPage);
    if (!Number.isFinite(numericPage)) return Promise.resolve();
    const pageNumber = clamp(Math.trunc(numericPage), 1, this.state.totalPages);
    if (pageNumber === this.state.pageNumber && !this.state.rendering) return Promise.resolve();
    this._emitState({ pageNumber, rendering: true, errorKind: null, message: "" });
    return this._renderCurrentPage({ operation });
  }

  previousPage() {
    return this.setPage(this.state.pageNumber - 1);
  }

  nextPage() {
    return this.setPage(this.state.pageNumber + 1);
  }

  setZoom(requestedZoom) {
    const operation = this.activeLoad;
    if (!this._isActive(operation) || !operation.document || this.state.mode !== "ready") {
      return Promise.resolve();
    }
    const numericZoom = Number(requestedZoom);
    if (!Number.isFinite(numericZoom)) return Promise.resolve();
    const zoom = clamp(numericZoom, MIN_ZOOM, MAX_ZOOM);
    if (zoom === this.state.zoom && !this.state.rendering) return Promise.resolve();
    this._emitState({ zoom, rendering: true, errorKind: null, message: "" });
    return this._renderCurrentPage({ operation });
  }

  zoomIn() {
    return this.setZoom(this.state.zoom + ZOOM_STEP);
  }

  zoomOut() {
    return this.setZoom(this.state.zoom - ZOOM_STEP);
  }

  resetZoom() {
    return this.setZoom(DEFAULT_ZOOM);
  }

  async activateFallback() {
    const cycle = ++this.loadCycle;
    const operation = this.activeLoad;
    if (operation) {
      operation.cancelled = true;
      this.activeLoad = null;
    }
    await this._disposeLoadOperation(operation);
    if (this.destroyed || cycle !== this.loadCycle) return;
    this._emitState({
      mode: "fallback",
      rendering: false,
      errorKind: null,
      message: "Native browser fallback is active.",
    });
  }

  async destroy() {
    if (this.destroyed && !this.activeLoad) return;
    this.destroyed = true;
    ++this.loadCycle;
    const operation = this.activeLoad;
    if (operation) {
      operation.cancelled = true;
      this.activeLoad = null;
    }
    await this._disposeLoadOperation(operation);
  }

  async _renderCurrentPage({ firstPage = false, operation = this.activeLoad } = {}) {
    const document = operation?.document;
    if (!document || !this._isActive(operation)) return;
    const cycle = ++operation.renderCycle;
    await this._cancelActiveRender(operation, cycle);
    if (cycle !== operation.renderCycle || !this._isActive(operation)) return;

    const pageNumber = this.state.pageNumber;
    const zoom = this.state.zoom;
    const renderStartedAt = this.now();
    let page = null;
    let renderTask = null;
    let textLayer = null;
    let textLayerPromise = null;

    try {
      page = await document.getPage(pageNumber);
      if (cycle !== operation.renderCycle || !this._isActive(operation)) {
        await safeCall(() => page.cleanup?.());
        return;
      }

      const canvas = this.getCanvas();
      const canvasContext = canvas?.getContext?.("2d", { alpha: false });
      if (!canvas || !canvasContext) throw new Error("Canvas context unavailable");
      const viewport = page.getViewport({ scale: zoom });
      const geometry = canvasRenderGeometry(viewport, this.getOutputScale());
      canvas.width = geometry.canvasWidth;
      canvas.height = geometry.canvasHeight;
      if (canvas.style) {
        canvas.style.width = `${geometry.cssWidth}px`;
        canvas.style.height = `${geometry.cssHeight}px`;
      }

      renderTask = page.render({
        canvasContext,
        viewport,
        ...(geometry.transform ? { transform: geometry.transform } : {}),
      });
      if (cycle !== operation.renderCycle || !this._isActive(operation)) {
        renderTask.cancel?.();
        await safeCall(() => renderTask.promise);
        await safeCall(() => page.cleanup?.());
        return;
      }

      operation.renderTask = renderTask;
      operation.activePage = page;
      this._emitDiagnostics({ renderCount: this.diagnostics.renderCount + 1 });

      textLayerPromise = Promise.resolve();
      const textLayerContainer = this.getTextLayerContainer?.();
      if (textLayerContainer && this.createTextLayer) {
        this._prepareTextLayerContainer(textLayerContainer, viewport);
        textLayer = await this.createTextLayer({ page, container: textLayerContainer, viewport });
        if (cycle !== operation.renderCycle || !this._isActive(operation)) {
          textLayer?.cancel?.();
          return;
        }
        operation.textLayer = textLayer;
        textLayerPromise = Promise.resolve(textLayer.render?.());
        operation.textLayerPromise = textLayerPromise;
      }

      await Promise.all([renderTask.promise, textLayerPromise]);
      if (cycle !== operation.renderCycle || !this._isActive(operation)) return;

      const renderDuration = Math.max(0, this.now() - renderStartedAt);
      const network = this.getNetworkDiagnostics(this.url) || {};
      this._emitDiagnostics({
        ...(firstPage && this.diagnostics.firstPageRenderDurationMs === null
          ? { firstPageRenderDurationMs: renderDuration }
          : {}),
        requestCount: network.requestCount ?? this.diagnostics.requestCount,
        rangeRequestCount: network.rangeRequestCount ?? this.diagnostics.rangeRequestCount,
        fullRequestCount: network.fullRequestCount ?? this.diagnostics.fullRequestCount,
        requestMode: network.requestMode ?? this.diagnostics.requestMode,
      });
      this._emitState({ mode: "ready", rendering: false, errorKind: null, message: "" });
    } catch (error) {
      if (cycle !== operation.renderCycle || !this._isActive(operation) || isPdfCancellation(error)) return;
      renderTask?.cancel?.();
      await safeCall(() => renderTask?.promise);
      this._clearCanvas();
      this._clearTextLayer();
      this._emitState({
        mode: "error",
        rendering: false,
        ...classifyPdfError(error, "render"),
      });
    } finally {
      if (operation.renderTask === renderTask) operation.renderTask = null;
      if (operation.activePage === page) operation.activePage = null;
      await safeCall(() => page?.cleanup?.());
    }
  }

  async _cancelActiveRender(operation, clearCycle = operation?.renderCycle) {
    if (!operation) return;
    const renderTask = operation.renderTask;
    const textLayer = operation.textLayer;
    const textLayerPromise = operation.textLayerPromise;
    const page = operation.activePage;
    operation.renderTask = null;
    operation.textLayer = null;
    operation.textLayerPromise = null;
    operation.activePage = null;
    await safeCall(() => textLayer?.cancel?.());
    if (renderTask) {
      renderTask.cancel?.();
      this._emitDiagnostics({
        renderCancellationCount: this.diagnostics.renderCancellationCount + 1,
      });
      await safeCall(() => renderTask.promise);
    }
    await safeCall(() => textLayerPromise);
    await safeCall(() => page?.cleanup?.());
    if (operation.renderCycle === clearCycle) this._clearTextLayer();
  }

  _disposeLoadOperation(operation) {
    if (!operation) {
      this._clearCanvas();
      this._clearTextLayer();
      return Promise.resolve();
    }
    if (operation.disposalPromise) return operation.disposalPromise;

    operation.cancelled = true;
    operation.disposalPromise = (async () => {
      ++operation.renderCycle;
      await this._cancelActiveRender(operation, operation.renderCycle);
      if (!operation.loadingTask && operation.creationPromise) {
        await safeCall(() => operation.creationPromise);
      }

      const document = operation.document;
      const loadingTask = operation.loadingTask;
      operation.document = null;
      operation.loadingTask = null;
      await safeCall(() => document?.cleanup?.());
      if (loadingTask) await safeCall(() => loadingTask.destroy?.());
      else await safeCall(() => document?.destroy?.());

      const lateDocument = operation.document;
      operation.document = null;
      if (lateDocument && lateDocument !== document) {
        await safeCall(() => lateDocument.cleanup?.());
        if (!loadingTask) await safeCall(() => lateDocument.destroy?.());
      }
      this._clearCanvas();
      this._clearTextLayer();
    })();
    return operation.disposalPromise;
  }

  _clearCanvas() {
    if (!this.isCurrent()) return;
    const canvas = this.getCanvas?.();
    if (!canvas) return;
    const context = canvas.getContext?.("2d");
    context?.clearRect?.(0, 0, canvas.width || 0, canvas.height || 0);
    canvas.width = 0;
    canvas.height = 0;
    if (canvas.style) {
      canvas.style.width = "";
      canvas.style.height = "";
    }
  }

  _prepareTextLayerContainer(container, viewport) {
    if (!this.isCurrent()) return;
    container.replaceChildren?.();
    container.style?.setProperty?.("--total-scale-factor", String(viewport.scale));
    container.style?.setProperty?.("--scale-round-x", "1px");
    container.style?.setProperty?.("--scale-round-y", "1px");
  }

  _clearTextLayer() {
    if (!this.isCurrent()) return;
    const container = this.getTextLayerContainer?.();
    if (!container) return;
    container.replaceChildren?.();
    container.removeAttribute?.("data-main-rotation");
    if (container.style) {
      container.style.width = "";
      container.style.height = "";
      container.style.removeProperty?.("--total-scale-factor");
      container.style.removeProperty?.("--scale-round-x");
      container.style.removeProperty?.("--scale-round-y");
    }
  }
}
