"use client";

import { FileText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { paperPdfUrl } from "../lib/api/client";
import { createPdfLoadingTask, type PDFDocumentProxy } from "../lib/pdf/pdfjs-adapter";
import { canvasRenderGeometry } from "../lib/pdf/reader-controller.mjs";
import { useI18n } from "../lib/i18n/LocaleProvider";

type ThumbnailSize = "inspector" | "detail";
type ThumbnailState = "loading" | "ready" | "unavailable";
type RenderTaskLike = { promise: Promise<void>; cancel?: () => void };

const THUMBNAIL_DIMENSIONS: Record<ThumbnailSize, { width: number; height: number }> = {
  inspector: { width: 88, height: 124 },
  detail: { width: 132, height: 186 },
};

export function FirstPageThumbnail({
  paperId,
  available,
  size = "inspector",
}: {
  paperId: string;
  available: boolean;
  size?: ThumbnailSize;
}) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [result, setResult] = useState<{ paperId: string; state: ThumbnailState }>({
    paperId,
    state: available ? "loading" : "unavailable",
  });
  const pdfUrl = useMemo(() => paperPdfUrl(paperId), [paperId]);
  const dimensions = THUMBNAIL_DIMENSIONS[size];
  const state = !available
    ? "unavailable"
    : result.paperId === paperId
      ? result.state
      : "loading";

  useEffect(() => {
    if (!available) return;

    let current = true;
    let loadingTask: Awaited<ReturnType<typeof createPdfLoadingTask>> | null = null;
    let document: PDFDocumentProxy | null = null;
    let page: Awaited<ReturnType<PDFDocumentProxy["getPage"]>> | null = null;
    let renderTask: RenderTaskLike | null = null;

    const renderFirstPage = async () => {
      try {
        loadingTask = await createPdfLoadingTask(pdfUrl);
        if (!current) { void loadingTask.destroy(); return; }
        document = await loadingTask.promise;
        if (!current) { void document.destroy(); return; }
        page = await document.getPage(1);
        if (!current) return;

        const sourceViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(
          dimensions.width / Math.max(sourceViewport.width, 1),
          dimensions.height / Math.max(sourceViewport.height, 1),
        );
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const canvasContext = canvas?.getContext("2d", { alpha: false });
        if (!canvas || !canvasContext) throw new Error("Thumbnail canvas context unavailable");
        const geometry = canvasRenderGeometry(viewport, window.devicePixelRatio || 1);
        canvas.width = geometry.canvasWidth;
        canvas.height = geometry.canvasHeight;
        canvas.style.width = `${geometry.cssWidth}px`;
        canvas.style.height = `${geometry.cssHeight}px`;
        renderTask = page.render({
          canvas,
          canvasContext,
          viewport,
          ...(geometry.transform ? { transform: geometry.transform } : {}),
        }) as RenderTaskLike;
        await renderTask.promise;
        if (current) setResult({ paperId, state: "ready" });
      } catch {
        if (current) setResult({ paperId, state: "unavailable" });
      } finally {
        page?.cleanup();
      }
    };

    void renderFirstPage();
    return () => {
      current = false;
      renderTask?.cancel?.();
      void loadingTask?.destroy();
      void document?.destroy();
    };
  }, [available, dimensions.height, dimensions.width, paperId, pdfUrl]);

  return (
    <figure className={`pdf-first-page-thumbnail pdf-first-page-thumbnail--${size}`} data-state={state} aria-busy={state === "loading" || undefined}>
      <div className="pdf-first-page-thumbnail__frame">
        <canvas ref={canvasRef} className="pdf-first-page-thumbnail__canvas" role="img" aria-label={t("First page preview")}>{t("A first page PDF preview is displayed here when available.")}</canvas>
        {state === "loading" ? <><span className="pdf-first-page-thumbnail__skeleton" aria-hidden="true" /><span className="sr-only">{t("Loading first page preview")}</span></> : null}
        {state === "unavailable" ? <div className="pdf-first-page-thumbnail__fallback" role="img" aria-label={t("First page preview unavailable")}><FileText size={size === "detail" ? 24 : 18} aria-hidden="true" /></div> : null}
      </div>
      <figcaption className="sr-only">{t("First page preview")}</figcaption>
    </figure>
  );
}
