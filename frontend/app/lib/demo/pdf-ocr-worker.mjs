// A disposable worker owns the Tesseract worker. Terminating this supervisor
// also ends its child worker even if Tesseract's initialization promise stalls.
let engine;
globalThis.onmessage = async ({ data }) => {
  const { id, action, payload } = data;
  const send = (message) => globalThis.postMessage({ id, ...message });
  try {
    if (action === "initialize") {
      const { createWorker } = await import("tesseract.js");
      engine = await createWorker(payload.languages, payload.mode, { ...payload.options, logger: (progress) => globalThis.postMessage({ type: "progress", progress }), errorHandler: (error) => send({ error: String(error?.message || error || "OCR engine failed.") }) });
      send({ value: true });
    } else if (!engine) throw new Error("The OCR engine is not initialized.");
    else if (action === "parameters") { await engine.setParameters(payload); send({ value: true }); }
    else if (action === "recognize") {
      const recognized = await engine.recognize(payload, {}, { text: true });
      send({ value: { data: { text: recognized.data.text, confidence: recognized.data.confidence } } });
    } else throw new Error("Unknown OCR operation.");
  } catch (error) { send({ error: String(error?.message || error || "OCR failed.") }); }
};
