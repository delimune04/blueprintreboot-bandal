/** Keep a handle from the start, including Tesseract's unresolved init phase. */
export function createSupervisedOcrWorker(languages, mode, options = {}) {
  const supervisor = options.supervisorFactory ? options.supervisorFactory() : new Worker(new URL("./pdf-ocr-worker.mjs", import.meta.url), { type: "module" });
  const jobs = new Map(); let nextId = 0, stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true; supervisor.terminate();
    for (const job of jobs.values()) job.reject(new DOMException("OCR worker was stopped.", "AbortError"));
    jobs.clear();
  };
  const invoke = (action, payload) => new Promise((resolve, reject) => {
    if (stopped) { reject(new DOMException("OCR worker was stopped.", "AbortError")); return; }
    const id = ++nextId; jobs.set(id, { resolve, reject });
    try { supervisor.postMessage({ id, action, payload }); } catch (error) { jobs.delete(id); reject(error); }
  });
  supervisor.onmessage = ({ data }) => {
    if (data.type === "progress") { options.logger?.(data.progress); return; }
    const job = jobs.get(data.id); if (!job) return;
    jobs.delete(data.id);
    if (data.error) { job.reject(new Error(data.error)); options.errorHandler?.(data.error); }
    else job.resolve(data.value);
  };
  supervisor.onerror = (event) => {
    const error = new Error(event.message || "The OCR worker failed. The previous cache was retained.");
    for (const job of jobs.values()) job.reject(error);
    jobs.clear(); stop();
  };
  const proxy = {
    setParameters: (parameters) => invoke("parameters", parameters),
    async recognize(canvas) {
      const blob = canvas instanceof Blob ? canvas : typeof canvas.convertToBlob === "function" ? await canvas.convertToBlob({ type: "image/png" }) : await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("The rendered PDF page could not be read for OCR.")), "image/png"));
      return invoke("recognize", blob);
    },
    terminate: async () => stop(),
  };
  const initialization = invoke("initialize", { languages, mode, options: { workerPath: options.workerPath, corePath: options.corePath, workerBlobURL: false, cachePath: options.cachePath } }).then(() => proxy);
  initialization.cancel = stop;
  return initialization;
}
