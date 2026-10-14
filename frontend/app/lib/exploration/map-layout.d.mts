export const MAX_MAP_NODES: 100;
export interface MapWork { id: string }
export interface MapEdge { source: string; target: string; kind: string; directed?: boolean }
export interface MapNode { id: string; x: number; y: number; radius: number; degree: number }
export interface MapBounds { x: number; y: number; width: number; height: number }
export interface MapLayout { nodes: MapNode[]; edges: (MapEdge & { id: string; directed: boolean })[]; bounds: MapBounds; omittedCount: number }
export function relationshipCategory(kind: string): "citation" | "similarity" | "other";
export function layoutResearchMap(works: readonly MapWork[], edges: readonly MapEdge[], options?: { maxNodes?: number; width?: number; height?: number; iterations?: number; selectedId?: string | null }): MapLayout;
export function fitMapBounds(bounds: MapBounds, viewportWidth: number, viewportHeight: number, padding?: number): MapBounds;
export function mapDisplayBounds(nodes: readonly MapNode[], works: readonly {id: string; title?: string; year?: string | number | null}[]): MapBounds;
export function zoomMapView(view: MapBounds, factor: number, anchor?: {x: number; y: number}, minWidth?: number, maxWidth?: number): MapBounds;
export function nearestMapNode(nodes: readonly MapNode[], currentId: string | null, direction: string): string | null;
export function mapLabelIds(nodes: readonly MapNode[], edges: readonly MapEdge[], selectedId: string | null, focusedId: string | null, zoom?: number): Set<string>;
