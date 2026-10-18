"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SelectionProvenance as PdfSelectionProvenance } from "../lib/reader/browser-reader-state.mjs";
import { computeMemoConnector, type MemoConnector, type MemoLayoutRect, type MemoSide } from "../lib/reader/memo-layout.mjs";

export interface ReaderMemoConnectionsProps {
  paperId: string;
  items: Array<{ id: string; provenance?: PdfSelectionProvenance }>;
  visible: boolean;
}
type MeasuredConnections = { paperId: string; signature: string; width: number; height: number; lines: Array<MemoConnector & { id: string }> };

function clippedRect(element: HTMLElement, includeSelf: boolean): MemoLayoutRect {
  let left = 0, top = 0, right = window.innerWidth, bottom = window.innerHeight;
  if (includeSelf) {
    const rect = element.getBoundingClientRect();
    left = Math.max(left, rect.left + element.clientLeft); top = Math.max(top, rect.top + element.clientTop);
    right = Math.min(right, rect.left + element.clientLeft + element.clientWidth); bottom = Math.min(bottom, rect.top + element.clientTop + element.clientHeight);
  }
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const clipX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX || style.overflow);
    const clipY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY || style.overflow);
    if (!clipX && !clipY) continue;
    const rect = parent.getBoundingClientRect();
    if (clipX) { left = Math.max(left, rect.left + parent.clientLeft); right = Math.min(right, rect.left + parent.clientLeft + parent.clientWidth); }
    if (clipY) { top = Math.max(top, rect.top + parent.clientTop); bottom = Math.min(bottom, rect.top + parent.clientTop + parent.clientHeight); }
  }
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
function visibleElement(element: HTMLElement): boolean {
  if (!element.isConnected || !element.getClientRects().length) return false;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (current.hidden || current.getAttribute("aria-hidden") === "true" || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") return false;
  }
  return true;
}

/** Decorative, event-driven links between side notes and their own PDF source. */
export function ReaderMemoConnections({ paperId, items, visible }: ReaderMemoConnectionsProps) {
  const markerId = `reader-memo-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const signature = JSON.stringify(items.map(item => ({ id: item.id, source: item.provenance?.source, coordinateSpace: item.provenance?.coordinate_space, page: item.provenance?.page, rectangles: item.provenance?.rectangles })));
  const itemsRef = useRef(items);
  const [measured, setMeasured] = useState<MeasuredConnections | null>(null);
  useEffect(() => { itemsRef.current = items; }, [items]);

  useEffect(() => {
    if (!visible || !itemsRef.current.length) return;
    let disposed = false, frame: number | null = null;
    let workspace: HTMLElement | null = null;
    const observed = new Set<Element>();
    const schedule = () => { if (!disposed && frame === null) frame = window.requestAnimationFrame(measure); };
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    const mutations = typeof MutationObserver === "undefined" ? null : new MutationObserver(schedule);
    const waiting = typeof MutationObserver === "undefined" ? null : new MutationObserver(schedule);
    function observe(elements: Element[]) {
      const next = new Set(elements);
      for (const element of observed) if (!next.has(element)) { resize?.unobserve(element); observed.delete(element); }
      for (const element of next) if (!observed.has(element)) { resize?.observe(element); observed.add(element); }
    }
    function measure() {
      frame = null; if (disposed) return;
      const nextWorkspace = Array.from(document.querySelectorAll<HTMLElement>(".reader-document-workspace[data-memo-paper-id]")).find(element => element.dataset.memoPaperId === paperId) || null;
      if (workspace !== nextWorkspace) {
        mutations?.disconnect(); waiting?.disconnect(); workspace = nextWorkspace;
        if (workspace) mutations?.observe(workspace, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class", "hidden", "aria-hidden", "data-page-number", "data-memo-connector-id", "data-memo-paper-id", "data-memo-rail", "data-memo-layout", "data-memo-visible", "data-native-fallback"] });
      }
      if (!workspace) waiting?.observe(document.body, { childList: true, subtree: true });
      const viewport = workspace?.querySelector<HTMLElement>(".reader-canvas-viewport");
      const nodes = workspace ? Array.from(workspace.querySelectorAll<HTMLElement>("[data-memo-connector-id]")).filter(element => element.closest<HTMLElement>("[data-memo-paper-id]")?.dataset.memoPaperId === paperId) : [];
      const anchors = new Map(nodes.map(note => [note, note.querySelector<HTMLElement>(".reader-sticky-note__header") || note]));
      const pages = viewport ? Array.from(viewport.querySelectorAll<HTMLElement>(".reader-page-surface[data-page-number]")) : [];
      const lines: MeasuredConnections["lines"] = [];
      observe([...(workspace ? [workspace] : []), ...(viewport ? [viewport] : []), ...nodes, ...anchors.values(), ...pages]);
      if (viewport && visibleElement(viewport)) {
        const viewportRect = clippedRect(viewport, true);
        for (const item of itemsRef.current) {
          const source = item.provenance;
          if (source?.source !== "pdf_selection" || source.coordinate_space !== "page-normalized" || !Number.isInteger(source.page) || source.page < 1) continue;
          const note = nodes.find(element => element.dataset.memoConnectorId === item.id && visibleElement(element));
          if (!note) continue;
          const anchor = anchors.get(note);
          if (!anchor || !visibleElement(anchor)) continue;
          const side = note.closest<HTMLElement>("[data-memo-rail]")?.dataset.memoRail;
          if (side !== "left" && side !== "right") continue;
          const page = pages.find(element => element.dataset.pageNumber === String(source.page));
          if (!page || !visibleElement(page)) continue;
          const line = computeMemoConnector({ noteRect: anchor.getBoundingClientRect(), pageRect: page.getBoundingClientRect(), viewportRect, rectangles: source.rectangles, side: side as MemoSide, windowWidth: window.innerWidth, windowHeight: window.innerHeight, noteClipRect: clippedRect(anchor, false) });
          if (line) lines.push({ ...line, id: item.id });
        }
      }
      const next = { paperId, signature, width: window.innerWidth, height: window.innerHeight, lines };
      setMeasured(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    }
    document.addEventListener("scroll", schedule, true);
    document.addEventListener("transitionend", schedule, true);
    document.addEventListener("animationend", schedule, true);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    document.addEventListener("visibilitychange", schedule);
    schedule();
    return () => {
      disposed = true; if (frame !== null) window.cancelAnimationFrame(frame);
      resize?.disconnect(); mutations?.disconnect(); waiting?.disconnect();
      document.removeEventListener("scroll", schedule, true);
      document.removeEventListener("transitionend", schedule, true);
      document.removeEventListener("animationend", schedule, true);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [paperId, signature, visible]);

  if (!visible || !measured || measured.paperId !== paperId || measured.signature !== signature || !measured.lines.length || typeof document === "undefined") return null;
  return createPortal(<svg className="reader-memo-connectors" aria-hidden="true" focusable="false" width={measured.width} height={measured.height} viewBox={`0 0 ${measured.width} ${measured.height}`} style={{ position: "fixed", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 24, overflow: "hidden" }}>
    <defs><marker id={markerId} viewBox="0 0 6 6" refX="5.2" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 6 3 L 0 6 Z" fill="var(--state-amber, #b26a00)" /></marker></defs>
    {measured.lines.map(line => <path key={line.id} data-memo-line-id={line.id} d={line.path} stroke="var(--state-amber, #b26a00)" strokeWidth="1.2" strokeOpacity="0.7" vectorEffect="non-scaling-stroke" fill="none" markerEnd={`url(#${markerId})`} />)}
  </svg>, document.body);
}
