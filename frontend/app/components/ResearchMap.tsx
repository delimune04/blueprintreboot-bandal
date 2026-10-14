"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { fitMapBounds, layoutResearchMap, mapDisplayBounds, mapLabelIds, nearestMapNode, relationshipCategory, zoomMapView, type MapBounds } from "../lib/exploration/map-layout.mjs";

export interface ResearchMapWork {
  id: string;
  title: string;
  authors?: readonly string[];
  year?: string | number | null;
  score?: number | null;
}

export interface ResearchMapEdge {
  source: string;
  target: string;
  kind: string;
  directed?: boolean;
  score?: number | null;
  weight?: number | null;
  evidence?: {
    provider?: string;
    url?: string;
    shared_reference_ids?: readonly string[];
    topic_ids?: readonly string[];
    method?: string;
  };
}

export interface ResearchMapProps {
  works: readonly ResearchMapWork[];
  edges: readonly ResearchMapEdge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  locale: "ko" | "en";
  height?: number;
}

const EDGE_APPEARANCE: Record<string, { color: string; dash?: string; className: string }> = {
  cites: { color: "#596164", className: "cites" },
  shares_references: { color: "#7452A8", dash: "7 4", className: "shares-references" },
  shares_topics: { color: "#2E7D32", dash: "2 5", className: "shares-topics" },
  text_similarity: { color: "#B26A00", dash: "9 3 2 3", className: "text-similarity" },
};
const OTHER_EDGE = { color: "#7A8386", dash: "2 4", className: "other" };
const controlStyle = { minWidth: 44, minHeight: 44 };
const shorten = (text: string, limit: number) => Array.from(text).length > limit ? `${Array.from(text).slice(0, limit - 1).join("")}…` : text;

/** Relationships are supplied evidence; the layout itself makes no scholarly claims. */
export function ResearchMap({ works, edges, selectedId, onSelect, locale, height = 520 }: ResearchMapProps) {
  const ko = locale === "ko";
  const titleId = useId();
  const descriptionId = useId();
  const arrowId = useId().replace(/:/g, "");
  const stageRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const dragRef = useRef<{ pointerId: number; x: number; y: number; view: MapBounds } | null>(null);
  const [viewportWidth, setViewportWidth] = useState(1000);
  const [customView, setCustomView] = useState<{ key: string; value: MapBounds } | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const stageHeight = Math.max(280, Math.min(900, Number.isFinite(height) ? height : 520));
  const layout = useMemo(() => layoutResearchMap(works, edges, { selectedId }), [works, edges, selectedId]);
  const byId = useMemo(() => new Map(works.map((work) => [work.id, work])), [works]);
  const positions = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout]);
  const selectionId = selectedId && positions.has(selectedId) ? selectedId : null;
  const fittedView = useMemo(() => fitMapBounds(mapDisplayBounds(layout.nodes, works), viewportWidth, stageHeight, 50), [layout.nodes, works, viewportWidth, stageHeight]);
  const viewKey = JSON.stringify([layout.nodes, layout.edges, fittedView]);
  const view = customView?.key === viewKey ? customView.value : fittedView;
  const zoom = fittedView.width / view.width;
  const activeFocusId = focusedId && positions.has(focusedId) ? focusedId : selectionId ?? layout.nodes[0]?.id ?? null;
  const labels = mapLabelIds(layout.nodes, layout.edges, selectionId, activeFocusId, zoom);
  const neighborhood = new Set<string>(selectionId ? [selectionId] : []);
  for (const edge of layout.edges) {
    if (edge.source === selectionId) neighborhood.add(edge.target);
    if (edge.target === selectionId) neighborhood.add(edge.source);
  }
  const edgeLabel = (kind: string) => ({
    cites: ko ? "인용 (화살표: 인용한 논문 → 인용된 논문)" : "Citation (citing → cited work)",
    shares_references: ko ? "공통 참고문헌" : "Shared references",
    shares_topics: ko ? "공통 주제" : "Shared topics",
    text_similarity: ko ? "텍스트 유사도" : "Text similarity",
  })[kind] ?? (ko ? "기타 관계" : "Other relationship");
  const kinds = [...new Set(layout.edges.map((edge) => edge.kind))].sort();
  const mapTitle = ko ? "논문 관계 지도" : "Research relationship map";
  const mapHelp = ko ? "빈 공간을 드래그해 이동하세요. 논문에서 방향키로 이동하고 Enter로 선택하세요. +/− 또는 Ctrl+휠로 확대·축소, 0으로 전체 보기를 합니다." : "Drag empty space to pan. On a paper, use arrow keys to move and Enter to select. +/− or Ctrl+wheel zoom; 0 fits the map.";
  const totalWorks = layout.nodes.length + layout.omittedCount;
  const countText = ko ? `전체 ${totalWorks}편 중 ${layout.nodes.length}편 표시 · 관계 ${layout.edges.length}개` : `${layout.nodes.length} of ${totalWorks} works shown · ${layout.edges.length} relationships`;

  useEffect(() => {
    const element = stageRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && Number.isFinite(width)) setViewportWidth(Math.max(1, Math.round(width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const current = { x: view.x, y: view.y, width: view.width, height: view.height };
      const anchor = { x: current.x + (event.clientX - rect.left) / rect.width * current.width, y: current.y + (event.clientY - rect.top) / rect.height * current.height };
      setCustomView({ key: viewKey, value: zoomMapView(current, event.deltaY < 0 ? 1.15 : 1 / 1.15, anchor, fittedView.width / 5, fittedView.width * 2) });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [view.x, view.y, view.width, view.height, viewKey, fittedView.width]);

  function setView(value: MapBounds) { setCustomView({ key: viewKey, value }); }
  function fit() { setCustomView(null); }
  function zoomBy(factor: number, anchor?: { x: number; y: number }) {
    setView(zoomMapView(view, factor, anchor, fittedView.width / 5, fittedView.width * 2));
  }
  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || (event.target as Element).closest("[data-map-node]")) return;
    event.preventDefault();
    svgRef.current?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, view };
    setDragging(true);
  }
  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!drag || drag.pointerId !== event.pointerId || !rect.width || !rect.height) return;
    setView({ ...drag.view, x: drag.view.x - (event.clientX - drag.x) / rect.width * drag.view.width, y: drag.view.y - (event.clientY - drag.y) / rect.height * drag.view.height });
  }
  function stopDragging(event: PointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function revealNode(id: string) {
    const node = positions.get(id);
    setFocusedId(id);
    if (node && (node.x < view.x + 35 || node.x > view.x + view.width - 35 || node.y < view.y + 35 || node.y > view.y + view.height - 35)) {
      setView({ ...view, x: node.x - view.width / 2, y: node.y - view.height / 2 });
    }
  }
  function focusNode(id: string) {
    revealNode(id);
    nodeRefs.current.get(id)?.focus();
  }
  function onNodeKey(event: KeyboardEvent<SVGGElement>, id: string) {
    if (event.key.startsWith("Arrow")) {
      event.preventDefault(); event.stopPropagation();
      const next = nearestMapNode(layout.nodes, id, event.key);
      if (next) focusNode(next);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); event.stopPropagation(); onSelect(id);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault(); event.stopPropagation();
      const next = event.key === "Home" ? layout.nodes[0] : layout.nodes[layout.nodes.length - 1];
      if (next) focusNode(next.id);
    } else if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); svgRef.current?.focus();
    }
  }
  function onMapKey(event: KeyboardEvent<SVGSVGElement>) {
    const nodeId = (event.target as Element).closest("[data-map-node]")?.getAttribute("data-map-node");
    const anchor = nodeId ? positions.get(nodeId) : undefined;
    if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomBy(1.25, anchor); }
    else if (event.key === "-" || event.key === "−") { event.preventDefault(); zoomBy(0.8, anchor); }
    else if (event.key === "0") { event.preventDefault(); fit(); }
    else if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      const amount = view.width * 0.08;
      setView({ ...view, x: view.x + (event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0), y: view.y + (event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0) });
    }
  }
  function exportSvg() {
    const svg = svgRef.current;
    if (!svg) return;
    try {
      const snapshot = svg.cloneNode(true) as SVGSVGElement;
      snapshot.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      snapshot.setAttribute("width", "1200");
      snapshot.setAttribute("height", String(Math.round(1200 * stageHeight / viewportWidth)));
      snapshot.removeAttribute("tabindex");
      snapshot.querySelectorAll("[tabindex]").forEach((element) => element.removeAttribute("tabindex"));
      const bytes = new XMLSerializer().serializeToString(snapshot);
      const url = URL.createObjectURL(new Blob([bytes], { type: "image/svg+xml;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url; link.download = "labvium-research-map.svg";
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportStatus(ko ? "현재 지도 보기를 SVG로 내보냈습니다." : "Exported the current map view as SVG.");
    } catch {
      setExportStatus(ko ? "지도를 내보내지 못했습니다. 다시 시도하세요." : "The map could not be exported. Try again.");
    }
  }

  return <section className="research-map" aria-label={mapTitle}>
    <div className="research-map__toolbar" role="group" aria-label={ko ? "지도 보기" : "Map view"}>
      <button type="button" className="button-secondary research-map__control" style={controlStyle} aria-label={ko ? "지도 축소" : "Zoom map out"} disabled={zoom <= 0.5001 || !layout.nodes.length} onClick={() => zoomBy(0.8)}>−</button>
      <span className="research-map__zoom" aria-label={ko ? `지도 확대 ${Math.round(zoom * 100)}%` : `Map zoom ${Math.round(zoom * 100)}%`}>{Math.round(zoom * 100)}%</span>
      <button type="button" className="button-secondary research-map__control" style={controlStyle} aria-label={ko ? "지도 확대" : "Zoom map in"} disabled={zoom >= 4.999 || !layout.nodes.length} onClick={() => zoomBy(1.25)}>+</button>
      <button type="button" className="button-secondary research-map__control" style={controlStyle} disabled={!layout.nodes.length} onClick={fit}>{ko ? "전체 보기" : "Fit map"}</button>
      <button type="button" className="button-secondary research-map__control" style={controlStyle} disabled={!layout.nodes.length} onClick={exportSvg}>{ko ? "SVG 내보내기" : "Export SVG"}</button>
      <span className="research-map__count">{countText}</span>
    </div>
    <div ref={stageRef} className={`research-map__stage${dragging ? " research-map__stage--dragging" : ""}`} style={{ height: stageHeight, minHeight: stageHeight, minWidth: 0, overflow: "hidden" }}>
      <svg ref={svgRef} className="research-map__svg" width="100%" height="100%" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} role="group" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={0} onKeyDown={onMapKey} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={stopDragging} onPointerCancel={stopDragging} onLostPointerCapture={stopDragging} style={{ display: "block", background: "#FAFBFB", touchAction: "none", cursor: dragging ? "grabbing" : "grab" }}>
        <title id={titleId}>{mapTitle}</title>
        <desc id={descriptionId}>{countText}. {ko ? "실선 화살표는 인용, 점선은 유사 관계입니다. 거리는 인용 수나 관련도 점수를 나타내지 않습니다." : "Solid arrows show citations; dashed lines show similarity relationships. Distance does not represent citation counts or relevance scores."} {mapHelp}</desc>
        <defs><marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#596164" /></marker></defs>
        <rect x={view.x} y={view.y} width={view.width} height={view.height} fill="#FAFBFB" pointerEvents="none" />
        {layout.edges.map((edge) => {
          const source = positions.get(edge.source)!;
          const target = positions.get(edge.target)!;
          const appearance = EDGE_APPEARANCE[edge.kind] ?? OTHER_EDGE;
          const dx = target.x - source.x; const dy = target.y - source.y;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const related = edge.source === selectionId || edge.target === selectionId;
          const evidence = edges.find((item) => item.source === edge.source && item.target === edge.target && item.kind === edge.kind)?.evidence;
          return <line key={edge.id} className={`research-map__edge research-map__edge--${appearance.className}${related ? " research-map__edge--selected" : selectionId ? " research-map__edge--dimmed" : ""}`} x1={source.x + dx / distance * (source.radius + 2)} y1={source.y + dy / distance * (source.radius + 2)} x2={target.x - dx / distance * (target.radius + 3)} y2={target.y - dy / distance * (target.radius + 3)} stroke={appearance.color} strokeWidth={related ? 2.1 : 1.3} strokeDasharray={appearance.dash} opacity={selectionId && !related ? 0.2 : 0.75} vectorEffect="non-scaling-stroke" markerEnd={edge.kind === "cites" && edge.directed ? `url(#${arrowId})` : undefined}>
            <title>{byId.get(edge.source)?.title ?? edge.source}{edge.directed ? " → " : " — "}{byId.get(edge.target)?.title ?? edge.target}: {edgeLabel(edge.kind)}{evidence?.provider ? ` · ${evidence.provider}` : ""}</title>
          </line>;
        })}
        {layout.nodes.map((node) => {
          const work = byId.get(node.id)!;
          const selected = node.id === selectionId;
          const dimmed = !!selectionId && !neighborhood.has(node.id);
          const title = work.title || (ko ? "제목 없음" : "Untitled work");
          const label = `${title}${work.year ? ` (${work.year})` : ""}`;
          const hitRadius = Math.max(node.radius + 5, 22 * view.width / viewportWidth);
          const labelOnLeft = node.x > layout.bounds.x + layout.bounds.width / 2;
          return <g key={node.id} ref={(element) => { if (element) nodeRefs.current.set(node.id, element); else nodeRefs.current.delete(node.id); }} data-map-node={node.id} className={`research-map__node${selected ? " research-map__node--selected" : ""}${dimmed ? " research-map__node--dimmed" : ""}`} role="button" aria-label={label} aria-pressed={selected} tabIndex={node.id === activeFocusId ? 0 : -1} transform={`translate(${node.x} ${node.y})`} onFocus={() => revealNode(node.id)} onKeyDown={(event) => onNodeKey(event, node.id)} onClick={() => { setFocusedId(node.id); onSelect(node.id); }} style={{ cursor: "pointer", outline: "none" }}>
            <title>{label}{work.authors?.length ? ` · ${work.authors.join(", ")}` : ""}</title>
            <circle className="research-map__node-hit" r={hitRadius} fill="transparent" />
            <circle className="research-map__node-focus" r={node.radius + 5} fill="none" stroke="#1A73E8" strokeWidth="2" opacity={node.id === focusedId ? 1 : 0} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            <circle className="research-map__node-dot" r={node.radius} fill={selected ? "#1A73E8" : "#FFFFFF"} stroke={selected ? "#1769AA" : "#596164"} strokeWidth={selected ? 2.5 : 1.5} opacity={dimmed ? 0.45 : 1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            {labels.has(node.id) ? <text className="research-map__node-label" x={(node.radius + 6) * (labelOnLeft ? -1 : 1)} y="4" textAnchor={labelOnLeft ? "end" : "start"} fill={selected ? "#1769AA" : "#2B3032"} fontFamily="system-ui, sans-serif" fontSize={selected ? 13 : 11.5} fontWeight={selected ? 600 : 400} stroke="#FAFBFB" strokeWidth="3" paintOrder="stroke" opacity={dimmed ? 0.6 : 1} pointerEvents="none">{shorten(title, selected ? 42 : 28)}{work.year ? ` · ${work.year}` : ""}</text> : null}
          </g>;
        })}
        {!layout.nodes.length ? <text x={view.x + view.width / 2} y={view.y + view.height / 2} textAnchor="middle" fill="#596164" fontFamily="system-ui, sans-serif" fontSize="16">{ko ? "논문을 검색해 관계 지도를 시작하세요." : "Search for papers to start a relationship map."}</text> : null}
      </svg>
    </div>
    {kinds.length ? <ul className="research-map__legend" aria-label={ko ? "관계 범례" : "Relationship legend"}>{kinds.map((kind) => {
      const appearance = EDGE_APPEARANCE[kind] ?? OTHER_EDGE;
      return <li key={kind} className="research-map__legend-item"><svg width="36" height="14" viewBox="0 0 36 14" aria-hidden="true"><line x1="1" y1="7" x2="33" y2="7" stroke={appearance.color} strokeWidth="2" strokeDasharray={appearance.dash} />{relationshipCategory(kind) === "citation" ? <path d="M 28 3 L 35 7 L 28 11" fill="none" stroke={appearance.color} strokeWidth="1.5" /> : null}</svg><span>{edgeLabel(kind)}</span></li>;
    })}</ul> : null}
    <p className="research-map__help">{mapHelp}</p>
    {layout.omittedCount > 0 ? <p className="research-map__help">{ko ? `선택 논문과 연결된 논문을 우선해 최대 100편을 표시합니다. 나머지 ${layout.omittedCount}편은 목록에서 확인하세요.` : `The map shows up to 100 works, prioritizing the selected work and its neighbors. Find ${layout.omittedCount} additional works in the list.`}</p> : null}
    <p className="research-map__status sr-only" role="status" aria-live="polite">{exportStatus}</p>
  </section>;
}
