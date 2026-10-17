"use client";

import { lazy, Suspense, useId, useMemo, useRef, useState } from "react";
import { layoutResearchMap3D } from "../lib/exploration/map-3d.mjs";
import type { ResearchMap3DControls } from "./ResearchMap3D";
import "./research-map-3d.css";

export interface ResearchMapWork {
  id: string;
  title: string;
  authors?: readonly string[];
  year?: string | number | null;
  score?: number | null;
  abstract?: string;
  topics?: readonly string[];
  topic_ids?: readonly string[];
  references?: readonly string[];
  referenced_works?: readonly string[];
  reference_ids?: readonly string[];
  citation_count?: number | null;
}

export interface ResearchMapEdge {
  source: string;
  target: string;
  kind: string;
  directed?: boolean;
  score?: number;
  weight?: number;
  evidence?: { provider?: string; url?: string; shared_reference_ids?: readonly string[]; topic_ids?: readonly string[]; method?: string; score?: number };
}

export interface ResearchMapProps {
  works: readonly ResearchMapWork[];
  edges: readonly ResearchMapEdge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  locale: "ko" | "en";
  height?: number;
}

export const MAP_CLUSTER_COLORS = ["#329ee8", "#6edfe0", "#edbd73", "#6ab9ee", "#ca8132", "#a4d9f0", "#a5b2f2", "#67c8af"];
export function mapClusterColor(cluster: number) { return MAP_CLUSTER_COLORS[Math.abs(cluster) % MAP_CLUSTER_COLORS.length]; }
const ResearchMap3D = lazy(() => import("./ResearchMap3D").then((module) => ({ default: module.ResearchMap3D })));

/** A stable scholarly layout; selecting a paper changes emphasis, never the camera. */
export function ResearchMap({ works, edges, selectedId, onSelect, locale, height = 560 }: ResearchMapProps) {
  const ko = locale === "ko";
  const helpId = useId();
  const controls = useRef<ResearchMap3DControls | null>(null);
  const [zoom, setZoom] = useState(100);
  const [exportStatus, setExportStatus] = useState("");
  const sliceSelection = works.length > 200 ? selectedId : null;
  const layout = useMemo(() => layoutResearchMap3D(works, edges, { selectedId: sliceSelection }), [works, edges, sliceSelection]);
  const byId = useMemo(() => new Map(works.map((work) => [work.id, work])), [works]);
  const positions = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout.nodes]);
  const selectionId = selectedId && positions.has(selectedId) ? selectedId : null;
  const selectedWork = selectionId ? byId.get(selectionId) : null;
  const clusters = [...new Set(layout.nodes.map((node) => node.cluster))].sort((a, b) => a - b);
  const neighbors = useMemo(() => {
    const result = new Map<string, { id: string; similarity: number | null; kinds: string[] }>();
    if (!selectionId) return [];
    for (const edge of layout.edges) {
      const id = edge.source === selectionId ? edge.target : edge.target === selectionId ? edge.source : null;
      if (!id) continue;
      const existing = result.get(id);
      const score = typeof edge.similarity === "number" ? edge.similarity : null;
      if (existing) {
        if (score !== null) existing.similarity = Math.max(existing.similarity ?? 0, score);
        if (!existing.kinds.includes(edge.kind)) existing.kinds.push(edge.kind);
      } else result.set(id, { id, similarity: score, kinds: [edge.kind] });
    }
    return [...result.values()].sort((a, b) => (b.similarity ?? -1) - (a.similarity ?? -1) || a.id.localeCompare(b.id));
  }, [layout.edges, selectionId]);
  const stageHeight = Math.max(320, Math.min(900, Number.isFinite(height) ? height : 560));
  const edgeLabel = (kind: string) => ({ cites: ko ? "인용" : "Citation", shares_references: ko ? "공통 참고문헌" : "Shared references", shares_topics: ko ? "공통 주제" : "Shared topics", text_similarity: ko ? "제목·초록 유사성" : "Title/abstract similarity", similarity: ko ? "메타데이터 유사성" : "Metadata similarity", inferred_similarity: ko ? "메타데이터 유사성" : "Metadata similarity" })[kind] ?? (ko ? "관련 근거" : "Related evidence");
  const paperLabel = (id: string) => {
    const work = byId.get(id);
    return `${work?.title || (ko ? "제목 없음" : "Untitled work")}${work?.year ? ` · ${work.year}` : ""}`;
  };
  const countText = ko ? `논문 ${layout.nodes.length}편 · 연결 ${layout.edges.length}개` : `${layout.nodes.length} papers · ${layout.edges.length} connections`;

  function exportSvg() {
    try {
      const source = controls.current?.snapshotSvg();
      if (!source) return;
      const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url; link.download = "labvium-research-map-3d.svg";
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportStatus(ko ? "현재 3D 시점의 지도를 SVG로 내보냈습니다." : "Exported an SVG of the current 3D view.");
    } catch { setExportStatus(ko ? "지도를 내보내지 못했습니다. 다시 시도하세요." : "The map could not be exported. Try again."); }
  }

  return <section className="research-map research-map--3d" aria-label={ko ? "3D 논문 연관 지도" : "3D paper relationship map"}>
    <div className="research-map__toolbar" role="group" aria-label={ko ? "3D 지도 보기" : "3D map view"}>
      <span className="research-map__dimension">3D</span>
      <button type="button" className="research-map__control" aria-label={ko ? "지도 축소" : "Zoom map out"} disabled={!layout.nodes.length} onClick={() => controls.current?.zoomBy(0.8)}>−</button>
      <span className="research-map__zoom" aria-label={ko ? `지도 확대 ${zoom}%` : `Map zoom ${zoom}%`}>{zoom}%</span>
      <button type="button" className="research-map__control" aria-label={ko ? "지도 확대" : "Zoom map in"} disabled={!layout.nodes.length} onClick={() => controls.current?.zoomBy(1.25)}>+</button>
      <button type="button" className="research-map__control" disabled={!layout.nodes.length} onClick={() => controls.current?.reset()}>{ko ? "전체 보기" : "Fit map"}</button>
      <button type="button" className="research-map__control" disabled={!selectionId} onClick={() => { if (selectionId) controls.current?.focus(selectionId); }}>{ko ? "선택 논문 중심" : "Focus selected"}</button>
      <button type="button" className="research-map__control" disabled={!layout.nodes.length} onClick={exportSvg}>{ko ? "SVG 내보내기" : "Export SVG"}</button>
      <span className="research-map__count">{countText}</span>
    </div>
    <Suspense fallback={<div className="research-map__stage research-map__stage--3d" style={{ height: stageHeight }} role="status"><p className="research-map__stage-empty">{ko ? "3D 지도를 준비하고 있습니다…" : "Preparing the 3D map…"}</p></div>}><ResearchMap3D ref={controls} layout={layout} works={byId} selectedId={selectionId} onSelect={onSelect} locale={locale} height={stageHeight} descriptionId={helpId} onZoomChange={setZoom} /></Suspense>
    <div className="research-map__legend research-map__legend--3d" aria-label={ko ? "지도 범례" : "Map legend"}>
      <span>{ko ? "점 1개 = 논문 1편" : "One point = one paper"}</span>
      <span className="research-map__cluster-legend">{clusters.slice(0, 8).map((cluster) => <i key={cluster} style={{ background: mapClusterColor(cluster) }} />)}{ko ? "색: 유사도 그룹" : "Color: similarity groups"}</span>
      <span>{ko ? "선: 인용·공통 근거·유사성" : "Lines: citations, shared evidence and similarity"}</span>
    </div>
    <p id={helpId} className="research-map__help">{ko ? "드래그로 회전 · 휠/두 손가락으로 확대·축소 · 우클릭 드래그/두 손가락 이동 · 점 클릭으로 선택 · 두 번 클릭으로 중심 이동. 지도에 초점을 두고 방향키로 회전, Shift+방향키로 이동, +/−로 확대·축소, 0으로 전체 보기를 합니다." : "Drag to rotate · wheel/pinch to zoom · right-drag/two-finger drag to pan · click a point to select · double-click to focus. Focus the map and use arrows to rotate, Shift+arrows to pan, +/− to zoom, and 0 to fit."}</p>
    <p className="research-map__help">{ko ? "3D 공간의 거리는 공통 참고문헌·주제·제목/초록과 인용 관계에서 계산한 관련도를 근사합니다. 가까울수록 관련 근거가 많으며, 통계적 상관계수나 논문의 품질을 뜻하지 않습니다. 자료가 부족한 논문의 위치는 해석에 주의하세요." : "Distances in 3D approximate relatedness from shared references, topics, title/abstract and citations. Shorter distances indicate stronger evidence of relatedness, not a statistical correlation or paper quality. Treat positions with incomplete metadata cautiously."}</p>
    {layout.omittedCount > 0 ? <p className="research-map__help">{ko ? `선택 논문과 연결된 논문을 우선해 최대 200편을 표시합니다. 나머지 ${layout.omittedCount}편은 검색 결과 목록에서 확인하세요.` : `Up to 200 papers are shown, prioritizing the selected paper and its neighbors. Find ${layout.omittedCount} remaining papers in the search results.`}</p> : null}
    {selectedWork ? <div className="research-map__selection">
      <div className="research-map__selection-heading"><span className="research-map__paper-marker" style={{ background: mapClusterColor(positions.get(selectionId!)!.cluster) }} /><strong>{paperLabel(selectionId!)}</strong><span>{ko ? `연결 ${neighbors.length}편` : `${neighbors.length} neighbors`}</span></div>
      {neighbors.length ? <ul className="research-map__neighbors">{neighbors.slice(0, 5).map((item) => <li key={item.id}><button type="button" onClick={() => onSelect(item.id)}>{paperLabel(item.id)}</button><span title={item.kinds.map(edgeLabel).join(" · ")}>{item.similarity === null ? (ko ? "관련도 자료 부족" : "Insufficient data") : `${ko ? "관련도" : "Relatedness"} ${Math.round(item.similarity * 100)}/100`}</span></li>)}</ul> : <p className="research-map__help">{ko ? "표시된 논문에서 확인된 연결이 없습니다. 검색으로 관련 논문을 더 추가하세요." : "No confirmed connections among displayed papers. Add related papers through search."}</p>}
    </div> : null}
    <details className="research-map__paper-list"><summary>{ko ? `지도에 표시된 논문 목록 (${layout.nodes.length})` : `Papers in this map (${layout.nodes.length})`}</summary><ol>{layout.nodes.map((node) => <li key={node.id}><button type="button" aria-pressed={node.id === selectionId} onClick={() => onSelect(node.id)} onDoubleClick={() => controls.current?.focus(node.id)}><span className="research-map__paper-marker" style={{ background: mapClusterColor(node.cluster) }} /><span>{paperLabel(node.id)}</span></button><button className="research-map__list-focus" type="button" onClick={() => controls.current?.focus(node.id)} aria-label={ko ? `${paperLabel(node.id)} 중심으로 보기` : `Focus ${paperLabel(node.id)}`}>{ko ? "중심 보기" : "Focus"}</button></li>)}</ol></details>
    <details className="research-map__method"><summary>{ko ? "관련도와 거리 산정 기준" : "How relatedness and distance are calculated"}</summary><dl>{Object.entries(layout.method.weights).map(([kind, weight]) => <div key={kind}><dt>{({ shared_references: ko ? "공통 참고문헌" : "Shared references", topic_overlap: ko ? "주제 중복" : "Topic overlap", text_similarity: ko ? "제목·초록 텍스트" : "Title/abstract text", citation: ko ? "직접 인용" : "Direct citations" })[kind]}</dt><dd>{Math.round(weight * 100)}%</dd></div>)}</dl><p>{ko ? "사용 가능한 메타데이터 항목의 가중치를 다시 배분합니다(합계 92%). 확인된 직접 인용은 최대 8%를 더합니다. 자료가 부족한 쌍의 관련도는 알 수 없음으로 표시합니다." : "Available metadata weights are redistributed to a total of 92%. Confirmed direct citations add up to 8%. Relatedness is unknown where pairwise data is insufficient."}</p><p>{ko ? `비교 자료가 있는 논문 쌍 ${layout.method.knownPairCount}개 · 자료가 부족한 쌍 ${layout.method.unknownPairCount}개. 모든 쌍의 거리를 동시에 만족시키기 어려워 3D 배치는 근삿값입니다. 점의 크기는 표시된 연결 수를 반영합니다.` : `${layout.method.knownPairCount} paper pairs have comparison data; ${layout.method.unknownPairCount} have insufficient data. The 3D arrangement is approximate because all pairwise distances cannot be satisfied at once. Point size reflects the number of displayed connections.`}</p></details>
    <p className="research-map__status sr-only" role="status" aria-live="polite">{exportStatus}</p>
  </section>;
}
