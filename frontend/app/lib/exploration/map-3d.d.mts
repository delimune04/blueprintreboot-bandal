export const MAX_MAP_3D_NODES: 200;
export interface Map3DWork {
  id: string;
  title?: string;
  abstract?: string;
  authors?: readonly string[];
  year?: string | number | null;
  topics?: readonly string[];
  topic_ids?: readonly string[];
  references?: readonly string[];
  referenced_works?: readonly string[];
  reference_ids?: readonly string[];
  openalex_id?: string;
  doi?: string;
  evidence?: Record<string, string>;
}
export interface Map3DEdge {
  source: string;
  target: string;
  kind: string;
  directed?: boolean;
  score?: number;
  weight?: number;
  evidence?: { score?: number; [key: string]: unknown };
}
export interface Map3DNode { id: string; x: number; y: number; z: number; radius: number; degree: number; cluster: number }
export interface PaperSimilarityComponent { kind: "shared_references" | "topic_overlap" | "text_similarity" | "citation"; score: number; weight: number }
export interface PaperSimilarity { score: number | null; components: PaperSimilarityComponent[]; known: boolean }
export interface Map3DLayout {
  nodes: Map3DNode[];
  edges: (Map3DEdge & { id: string; directed: boolean; similarity: number | null; targetDistance: number | null })[];
  omittedCount: number;
  method: {
    label: string;
    weights: Record<PaperSimilarityComponent["kind"], number>;
    knownPairCount: number;
    unknownPairCount: number;
    iterations: number;
    maxNodes: number;
    stress: number | null;
    clusterCount: number;
    clusterMethod: string;
    unknownDistance: string;
    disclaimer: string;
  };
}
export function scorePaperSimilarity(a: Map3DWork, b: Map3DWork, edges?: readonly Map3DEdge[]): PaperSimilarity;
export function similarityToDistance(score: number): number;
export function similarityToDistance(score: null | undefined): null;
export function similarityToDistance(score: number | null | undefined): number | null;
export function layoutResearchMap3D(works: readonly Map3DWork[], edges: readonly Map3DEdge[], options?: { maxNodes?: number; iterations?: number; selectedId?: string | null }): Map3DLayout;
