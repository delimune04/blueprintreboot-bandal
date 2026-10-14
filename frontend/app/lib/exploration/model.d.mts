export interface ExplorationReason { kind: string; text: string; provider: string; evidence_count?: number; source_ids?: string[] }
export interface ExplorationWork { id: string; title: string; authors: string[]; year: string; doi: string; abstract: string; url: string; pdf_url: string; source: string; references: string[]; topic_ids: string[]; topics: string[]; providers: string[]; openalex_id?: string; is_retracted?: boolean; is_paratext?: boolean; journal?: string; retrieved_at?: string; updated_at?: string; updated_date?: string; citation_count?: number | null; cited_by_count?: number | null; score?: number; rank_components?: Record<string, number>; evidence?: Record<string, string>; reasons: ExplorationReason[]; relation_to_seed: string[]; shared_reference_ids: string[] }
export interface ExplorationEdge { source: string; target: string; kind: "cites" | "shares_references" | "shares_topics" | "text_similarity"; directed: boolean; evidence: { provider: string; url?: string; method?: string; shared_reference_ids?: string[]; topic_ids?: string[]; score?: number } }
export interface Exploration { version: 1; topic: string; works: ExplorationWork[]; edges: ExplorationEdge[]; path: string[]; saved_ids: string[]; dismissed_ids: string[]; queue: Array<{ work_id: string; state: "to_read" | "reading" | "read"; note: string }>; updated_at: string }
export interface ExploreResponse { items: ExplorationWork[]; seed: ExplorationWork | null; q: string; mode: string; warnings: string[]; retrieved_at: string; graph: { nodes: Array<{ id: string; title: string; [key: string]: unknown }>; edges: ExplorationEdge[] }; coverage: { requests: number; budget: number; candidate_count: number; returned_count: number; citation_graph: string; providers: string[]; truncated: boolean } }
export const EXPLORATION_LIMITS: { works: number; edges: number; path: number; bytes: number };
export function emptyExploration(topic?: string): Exploration;
export function validateExplorationWork(value: unknown): ExplorationWork;
export function validateExplorationEdge(value: unknown): ExplorationEdge;
export function validateExploration(value: unknown): Exploration;
export function mergeExploration(current: Exploration, response: ExploreResponse): { exploration: Exploration; truncated: boolean };
export function explorationRevision(project: { researchTrailRev?: number }): string;
export function getProjectExplorationState(state: unknown, projectId: string): { project_id: string; exploration: Exploration; revision: string };
export function saveProjectExplorationState(state: unknown, projectId: string, body: unknown): { project_id: string; exploration: Exploration; revision: string };
