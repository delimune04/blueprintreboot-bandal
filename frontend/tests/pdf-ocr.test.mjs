import assert from "node:assert/strict";
import test from "node:test";
import { selectOcrPages, renderPdfPageForOcr, recognizeScannedPdfPages } from "../app/lib/demo/pdf-ocr.mjs";
import { extractPdfPages } from "../app/lib/demo/pdf-extraction.mjs";
import { createSupervisedOcrWorker } from "../app/lib/demo/pdf-ocr-supervisor.mjs";

const pages = [{ page_number: 1, text: "Existing selectable evidence" }, { page_number: 2, text: "" }];
function setup(recognize = async () => ({ data: { text: "Recognized research 근거", confidence: 84.5 } })) {
  const stats = { renders: [], cleaned: [], canvases: [], terminated: 0, models: 0, options: null, languages: null };
  const document = { numPages: 2, getPage: async (number) => ({ getViewport: ({ scale }) => ({ width: 100 * scale, height: 200 * scale }), render: ({ canvas, background }) => { stats.renders.push({ number, canvas, background }); return { promise: Promise.resolve() }; }, cleanup: () => { stats.cleaned.push(number); } }) };
  const options = {
    canvasFactory: () => { const canvas = { width: 0, height: 0, getContext: () => ({}) }; stats.canvases.push(canvas); return canvas; },
    ocrModelLoader: async () => { stats.models += 1; return [{ code: "eng", data: new Uint8Array([1]) }, { code: "kor", data: new Uint8Array([2]) }]; },
    ocrWorkerFactory: async (languages, mode, workerOptions) => { stats.languages = languages; stats.options = workerOptions; assert.equal(mode, 1); return { setParameters: async () => undefined, recognize, terminate: async () => { stats.terminated += 1; } }; },
  };
  return { stats, document, options };
}

test("OCR is opt-in, selects only missing text, and rejects oversize runs before downloads", async () => {
  assert.deepEqual(selectOcrPages(pages), [2]);
  assert.throws(() => selectOcrPages(pages, [1]), /need OCR/);
  const fixture = setup();
  const unchanged = await recognizeScannedPdfPages(fixture.document, [pages[0]], fixture.options);
  assert.deepEqual(unchanged.ocr_pages, []); assert.equal(fixture.stats.models, 0);
  await assert.rejects(recognizeScannedPdfPages({ numPages: 21 }, Array.from({ length: 21 }, (_, index) => ({ page_number: index + 1, text: "" })), fixture.options), /20 scanned pages/);
  assert.equal(fixture.stats.models, 0);
});

test("OCR renders only scanned pages, retains selectable text, reports actual confidence and releases resources", async () => {
  const fixture = setup(), events = [];
  const result = await recognizeScannedPdfPages(fixture.document, pages, { ...fixture.options, onProgress: (event) => events.push(event) });
  assert.equal(result.pages[0].text, pages[0].text);
  assert.equal(result.pages[1].text, "Recognized research 근거");
  assert.deepEqual(result.ocr_pages, [{ page_number: 2, confidence: 84.5 }]);
  assert.deepEqual(fixture.stats.languages, ["eng", "kor"]);
  assert.match(fixture.stats.options.workerPath, /\/ocr\/worker.min.js$/);
  assert.match(fixture.stats.options.corePath, /\/ocr\/core$/);
  assert.deepEqual(fixture.stats.renders.map((render) => render.number), [2]);
  assert.equal(fixture.stats.renders[0].background, "#ffffff");
  assert.equal(fixture.stats.canvases[0].width, 0); assert.equal(fixture.stats.canvases[0].height, 0);
  assert.deepEqual(fixture.stats.cleaned, [2]); assert.equal(fixture.stats.terminated, 1);
  assert.ok(events.some((event) => event.phase === "ocr-complete" && event.page === 2 && event.totalPages === 2));
  assert.equal(pages[1].text, "");
});

test("PDF extraction integrates opt-in OCR with the real source hash and retains original image classification", async () => {
  const fixture = setup(); let destroyed = 0;
  const getPage = fixture.document.getPage;
  fixture.document.getPage = async (number) => ({ ...await getPage(number), getTextContent: async () => ({ items: number === 1 ? [{ str: "Original text", transform: [1, 0, 0, 1, 0, 10], hasEOL: true }] : [] }) });
  fixture.document.destroy = async () => { destroyed += 1; };
  const source = new File(["%PDF-1.4\nAuthored injected-loader fixture\n%%EOF"], "fixture.pdf", { type: "application/pdf" });
  const result = await extractPdfPages(source, { ...fixture.options, ocr: true, loadingTaskFactory: () => ({ promise: Promise.resolve(fixture.document) }) });
  assert.equal(result.provider, "browser-pdfjs+tesseract"); assert.equal(result.classification, "mixed");
  assert.match(result.source_pdf_sha256, /^[a-f0-9]{64}$/); assert.equal(result.pages[0].text, "Original text");
  assert.equal(result.pages[1].text, "Recognized research 근거"); assert.deepEqual(result.ocr_needed_pages, []);
  assert.deepEqual(result.ocr_pages, [{ page_number: 2, confidence: 84.5 }]); assert.equal(destroyed, 1);
});

test("empty or failed OCR rejects and cannot replace a previous cache with fake success", async () => {
  const empty = setup(async () => ({ data: { text: "  ", confidence: 0 } }));
  await assert.rejects(recognizeScannedPdfPages(empty.document, pages, empty.options), /did not recognize readable text/);
  assert.equal(empty.stats.terminated, 1); assert.equal(pages[1].text, "");
  const failed = setup(async () => { throw new Error("Engine failed"); });
  await assert.rejects(recognizeScannedPdfPages(failed.document, pages, failed.options), /Engine failed/);
  assert.equal(failed.stats.canvases[0].height, 0); assert.equal(failed.stats.terminated, 1);
});

test("cancel during recognition rejects promptly and releases worker, page and canvas", async () => {
  const controller = new AbortController();
  const fixture = setup(async () => { controller.abort(); return new Promise(() => {}); });
  await assert.rejects(recognizeScannedPdfPages(fixture.document, pages, { ...fixture.options, signal: controller.signal }), { name: "AbortError" });
  assert.ok(fixture.stats.terminated >= 1); assert.deepEqual(fixture.stats.cleaned, [2]); assert.equal(fixture.stats.canvases[0].width, 0);
});

test("cancel during initialization terminates the worker when it becomes available", async () => {
  const controller = new AbortController(), fixture = setup();
  let resolveWorker;
  const pending = recognizeScannedPdfPages(fixture.document, pages, { ...fixture.options, signal: controller.signal, ocrWorkerFactory: () => { queueMicrotask(() => controller.abort()); return new Promise((resolve) => { resolveWorker = resolve; }); } });
  await assert.rejects(pending, { name: "AbortError" });
  resolveWorker({ terminate: async () => { fixture.stats.terminated += 1; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.stats.terminated, 1); assert.equal(fixture.stats.renders.length, 0);
});

test("engine initialization errors reject promptly even when the library leaves its startup promise pending", async () => {
  const fixture = setup();
  await assert.rejects(recognizeScannedPdfPages(fixture.document, pages, { ...fixture.options, ocrWorkerFactory: (languages, mode, options) => { queueMicrotask(() => options.errorHandler("Bad language data")); return new Promise(() => {}); } }), /Bad language data/);
});

test("supervisor has an immediate termination handle before engine initialization completes", async () => {
  let terminated = 0, sent;
  const transport = { postMessage: (message) => { sent = message; }, terminate: () => { terminated += 1; } };
  const pending = createSupervisedOcrWorker(["eng", "kor"], 1, { supervisorFactory: () => transport });
  assert.equal(sent.action, "initialize");
  pending.cancel();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(terminated, 1);
});

test("supervisor forwards progress and only recognized text/confidence and terminates once", async () => {
  let terminated = 0; const progress = [];
  const transport = { postMessage: (message) => { queueMicrotask(() => transport.onmessage({ data: { id: message.id, value: message.action === "recognize" ? { data: { text: "Research", confidence: 91 } } : true } })); }, terminate: () => { terminated += 1; } };
  const worker = await createSupervisedOcrWorker(["eng", "kor"], 1, { supervisorFactory: () => transport, logger: (value) => progress.push(value) });
  transport.onmessage({ data: { type: "progress", progress: { status: "recognizing text", progress: 0.5 } } });
  const recognized = await worker.recognize(new Blob(["authored image fixture"]));
  assert.deepEqual(recognized, { data: { text: "Research", confidence: 91 } }); assert.equal(progress[0].progress, 0.5);
  await worker.terminate(); await worker.terminate(); assert.equal(terminated, 1);
});

test("render cancellation cancels PDF.js render and clears the allocated canvas", async () => {
  const controller = new AbortController(); let canvas, cancelled = 0;
  const page = { getViewport: ({ scale }) => ({ width: 100 * scale, height: 100 * scale }), render: () => ({ promise: new Promise((resolve, reject) => { controller.signal.addEventListener("abort", () => reject(new Error("render cancelled"))); queueMicrotask(() => controller.abort()); }), cancel: () => { cancelled += 1; } }) };
  await assert.rejects(renderPdfPageForOcr(page, { signal: controller.signal, canvasFactory: () => { canvas = { getContext: () => ({}) }; return canvas; } }), { name: "AbortError" });
  assert.equal(canvas.width, 0); assert.equal(canvas.height, 0); assert.equal(cancelled, 1);
});
