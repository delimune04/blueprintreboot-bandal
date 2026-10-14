/** Opt-in local OCR. Language models are downloaded only after invocation. */
export const MAX_OCR_PAGES = 20;
const MAX_RENDER_PIXELS = 8_000_000;
const aborted = (signal) => { if (signal?.aborted) throw new DOMException("OCR was cancelled. The previous text cache was retained.", "AbortError"); };

async function languageModels(options, progress) {
  if (options.ocrModelLoader) return options.ocrModelLoader();
  const models = [];
  let cache;
  try { cache = await globalThis.caches?.open("labvium-ocr-language-models-v1"); } catch { /* Recognition also works without a persistent model cache. */ }
  for (const [index, code] of ["eng", "kor"].entries()) {
    aborted(options.signal);
    const url = `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${code}@1.0.0/4.0.0_best_int/${code}.traineddata.gz`;
    let response, downloaded = false;
    try { response = await cache?.match(url); } catch { /* Download when the optional cache is unavailable. */ }
    if (!response) {
      response = await fetch(url, { signal: options.signal, cache: "force-cache" });
      if (!response.ok) throw new Error(`The ${code} OCR language model could not be downloaded. Previous text was retained.`);
      downloaded = true;
    }
    const reusable = response.clone(), data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength < 1000 || data.byteLength > 32 * 1024 * 1024) throw new Error("The OCR language model download was invalid or too large.");
    if (downloaded) { try { await cache?.put(url, reusable); } catch { /* Storage quota must not block a one-off OCR run. */ } }
    models.push({ code, data });
    progress("ocr-models", { progress: (index + 1) / 2, message: `Loaded ${code} OCR language data.` });
  }
  return models;
}

async function stageLanguageModels(models) {
  // Tesseract's documented browser cache uses idb-keyval's default store.
  // Namespaced keys let the normal string-language API read our pinned,
  // abortable downloads without its incompatible object-language init path.
  const database = await new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error("OCR language caching requires browser storage.")); return; }
    const request = indexedDB.open("keyval-store", 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("keyval")) request.result.createObjectStore("keyval"); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("OCR language caching is unavailable."));
  });
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("keyval", "readwrite"), store = transaction.objectStore("keyval");
      for (const model of models) store.put(model.data, `labvium-ocr-v7-eng-kor/${model.code}.traineddata`);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("OCR language data could not be cached."));
      transaction.onabort = () => reject(transaction.error || new Error("OCR language caching was cancelled."));
    });
  } finally { database.close(); }
}

export function selectOcrPages(pages, selected) {
  const needed = pages.filter((page) => !page.text.trim()).map((page) => page.page_number);
  if (selected !== undefined && !Array.isArray(selected)) throw new Error("OCR pages must be a list of page numbers.");
  const numbers = selected === undefined ? needed : [...new Set(selected)];
  if (!Array.isArray(numbers) || numbers.some((number) => !Number.isInteger(number) || !needed.includes(number))) throw new Error("Select only PDF pages that need OCR.");
  if (numbers.length > MAX_OCR_PAGES) throw new Error("OCR is limited to 20 scanned pages per run. Split the PDF or select a smaller page range; no pages were silently skipped.");
  return numbers;
}

export async function renderPdfPageForOcr(page, options = {}) {
  aborted(options.signal);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2.5, Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, base.width * base.height)));
  if (!Number.isFinite(scale) || scale <= 0 || base.width <= 0 || base.height <= 0) throw new Error("This PDF page has invalid render dimensions.");
  const viewport = page.getViewport({ scale });
  const canvas = options.canvasFactory ? options.canvasFactory() : globalThis.document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) { canvas.width = 0; canvas.height = 0; throw new Error("A page image could not be created for OCR."); }
  let task;
  try { task = page.render({ canvasContext: context, canvas, viewport, background: "#ffffff" }); }
  catch (error) { canvas.width = 0; canvas.height = 0; throw error; }
  const cancel = () => task.cancel?.();
  options.signal?.addEventListener("abort", cancel, { once: true });
  try { await task.promise; aborted(options.signal); return canvas; }
  catch (error) { canvas.width = 0; canvas.height = 0; aborted(options.signal); throw error; }
  finally { options.signal?.removeEventListener("abort", cancel); }
}

export async function recognizeScannedPdfPages(pdfDocument, pages, options = {}) {
  const needed = selectOcrPages(pages, options.ocrPageNumbers);
  aborted(options.signal);
  if (!needed.length) return { pages: structuredClone(pages), ocr_pages: [], warnings: [] };
  let worker, initialization, initializationFailure;
  let activePage;
  const progress = (phase, details = {}) => options.onProgress?.({ phase, status: phase, totalPages: pdfDocument.numPages, total: pdfDocument.numPages, ...details });
  const terminate = () => { if (worker) void worker.terminate().catch(() => undefined); };
  options.signal?.addEventListener("abort", terminate, { once: true });
  try {
    progress("ocr-models", { progress: 0, message: "Loading English and Korean OCR models. First use downloads language data; recognition runs on this device." });
    const models = await languageModels(options, progress);
    aborted(options.signal);
    if (!options.ocrWorkerFactory) await stageLanguageModels(models);
    aborted(options.signal);
    const factory = options.ocrWorkerFactory || (await import("./pdf-ocr-supervisor.mjs")).createSupervisedOcrWorker;
    const base = (process.env.NEXT_PUBLIC_BANDAL_DEMO_BASE || "").replace(/\/$/, "");
    const failed = new Promise((_, reject) => { initializationFailure = reject; });
    initialization = factory(["eng", "kor"], 1, {
      workerPath: `${base}/ocr/worker.min.js`,
      corePath: `${base}/ocr/core`,
      workerBlobURL: false,
      cachePath: "labvium-ocr-v7-eng-kor",
      logger: (event) => progress(activePage ? "ocr-recognize" : "ocr-models", { ...(activePage ? { page: activePage } : {}), progress: Number.isFinite(event.progress) ? event.progress : 0, message: String(event.status || "OCR") }),
      errorHandler: (error) => initializationFailure(new Error(String(error?.message || error || "OCR initialization failed. The previous text cache was retained."))),
    });
    // Abort can occur while models initialize. Return promptly, then terminate
    // the eventual worker as soon as initialization resolves.
    worker = await new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timeout); options.signal?.removeEventListener("abort", cancel); };
      const stop = (error) => { cleanup(); initialization.cancel?.(); void Promise.resolve(initialization).then((value) => value.terminate()).catch(() => undefined); reject(error); };
      const cancel = () => stop(new DOMException("OCR was cancelled.", "AbortError"));
      const timeout = setTimeout(() => stop(new Error("OCR initialization timed out. The previous text cache was retained; retry on a faster connection.")), 120000);
      options.signal?.addEventListener("abort", cancel, { once: true });
      Promise.race([initialization, failed]).then(resolve, reject).finally(cleanup);
      if (options.signal?.aborted) cancel();
    });
    aborted(options.signal);
    await worker.setParameters?.({ tessedit_pageseg_mode: "3", preserve_interword_spaces: "1", user_defined_dpi: "180" });
    const output = structuredClone(pages), ocr_pages = [], warnings = [];
    for (const number of needed) {
      aborted(options.signal); activePage = number;
      progress("ocr-render", { page: number, progress: 0, message: "Rendering a PDF page for OCR." });
      const page = await pdfDocument.getPage(number);
      let canvas;
      try {
        canvas = await renderPdfPageForOcr(page, options);
        const recognition = worker.recognize(canvas, {}, { text: true });
        const data = await new Promise((resolve, reject) => {
          const cancel = () => reject(new DOMException("OCR was cancelled.", "AbortError"));
          options.signal?.addEventListener("abort", cancel, { once: true });
          Promise.resolve(recognition).then(resolve, reject).finally(() => options.signal?.removeEventListener("abort", cancel));
          if (options.signal?.aborted) cancel();
        });
        aborted(options.signal);
        const text = String(data?.data?.text || "").trim();
        if (text.length > 200_000) throw new Error("An OCR page exceeds the 200,000-character limit. No text was truncated or saved.");
        const confidence = Math.min(100, Math.max(0, Number(data?.data?.confidence) || 0));
        output.find((item) => item.page_number === number).text = text;
        ocr_pages.push({ page_number: number, confidence });
        if (!text) warnings.push(`OCR found no readable text on page ${number}.`);
        if (confidence < 60) warnings.push(`OCR confidence is low on page ${number}; check the original page.`);
        progress("ocr-complete", { page: number, progress: 1, message: "Page OCR completed. Review recognized text against the PDF." });
      } finally { if (canvas) { canvas.width = 0; canvas.height = 0; } page.cleanup?.(); }
    }
    if (output.reduce((total, page) => total + page.text.length, 0) > 2_000_000) throw new Error("OCR text exceeds the browser limit. The previous cache was retained; no text was truncated.");
    if (!output.some((page) => needed.includes(page.page_number) && page.text.trim())) throw new Error("OCR did not recognize readable text on the selected scanned pages. The previous cache was retained.");
    return { pages: output, ocr_pages, warnings };
  } finally {
    options.signal?.removeEventListener("abort", terminate);
    if (worker) await Promise.resolve(worker.terminate()).catch(() => undefined);
    else initialization?.cancel?.();
  }
}
