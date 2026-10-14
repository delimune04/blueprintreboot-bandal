import { validatePdfFile } from "./browser-storage.mjs";

export function formatPdfTextItems(items) {
  let text = "", previousY = null;
  for (const item of items || []) {
    if (!item || typeof item.str !== "string") continue;
    const y = Number(item.transform?.[5]);
    if (text && Number.isFinite(y) && previousY !== null && Math.abs(y - previousY) > 3 && !text.endsWith("\n")) text += "\n";
    text += item.str;
    if (item.hasEOL) text += "\n";
    else if (item.str && !/\s$/.test(item.str)) text += " ";
    if (Number.isFinite(y)) previousY = y;
  }
  return text.replace(/[ \t]+\n/g, "\n").trim();
}

/** Extract actual PDF text; raster OCR runs only when explicitly requested. */
export async function extractPdfPages(file, options = {}) {
  const verified = await validatePdfFile(file);
  const url = URL.createObjectURL(file);
  let loadingTask, document;
  const checkAbort = () => { if (options.signal?.aborted) throw new DOMException("PDF extraction was cancelled.", "AbortError"); };
  try {
    checkAbort();
    const factory = options.loadingTaskFactory || (await import("../pdf/pdfjs-adapter.ts")).createPdfLoadingTask;
    loadingTask = await factory(url);
    const abort = () => { void loadingTask.destroy?.(); };
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      document = await loadingTask.promise;
      if (!Number.isInteger(document.numPages) || document.numPages < 1 || document.numPages > (options.maxPages || 1000)) throw new Error("This PDF exceeds the 1,000-page browser extraction limit.");
      let pages = [];
      let char_count = 0;
      for (let number = 1; number <= document.numPages; number += 1) {
        checkAbort();
        const page = await document.getPage(number);
        try {
          const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
          const text = formatPdfTextItems(content.items);
          if (text.length > 200000) throw new Error("A PDF page exceeds the 200,000-character extraction limit. No text was truncated or saved.");
          char_count += text.length;
          if (char_count > 2000000) throw new Error("The extracted text exceeds the two-million-character browser limit. The PDF remains stored; no text was truncated.");
          pages.push({ page_number: number, text });
          options.onProgress?.({ phase: "text", status: "text", page: number, total: document.numPages, totalPages: document.numPages, progress: number / document.numPages });
        } finally { page.cleanup?.(); }
      }
      let ocr_pages = [], warnings = [];
      const originallyScanned = pages.filter((page) => !page.text.trim()).length;
      if (options.ocr === true) {
        const { recognizeScannedPdfPages } = await import("./pdf-ocr.mjs");
        const recognized = await recognizeScannedPdfPages(document, pages, options);
        pages = recognized.pages; ocr_pages = recognized.ocr_pages; warnings = recognized.warnings;
        char_count = pages.reduce((total, page) => total + page.text.length, 0);
      }
      const ocr_needed_pages = pages.filter((page) => !page.text.trim()).map((page) => page.page_number);
      return { provider: ocr_pages.length ? "browser-pdfjs+tesseract" : "browser-pdfjs", source_pdf_sha256: verified.sha256, page_count: pages.length, char_count, ocr_needed_pages, classification: originallyScanned === pages.length ? "scanned" : originallyScanned ? "mixed" : "text", pages, ocr_pages, warnings };
    } finally { options.signal?.removeEventListener("abort", abort); }
  } finally {
    if (document) await Promise.resolve(document.destroy?.()).catch(() => undefined);
    else if (loadingTask) await Promise.resolve(loadingTask.destroy?.()).catch(() => undefined);
    URL.revokeObjectURL(url);
  }
}

export function extractedPagesContent(pages) {
  return pages.map((page) => `--- Page ${page.page_number} ---\n\n${page.text}`).join("\n\n");
}
