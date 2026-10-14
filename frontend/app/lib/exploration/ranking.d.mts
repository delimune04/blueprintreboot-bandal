import type { ExplorationWork, ExplorationEdge } from "./model.mjs";
export function tokenize(value: unknown): string[];
export function normalizedTitle(value: unknown): string;
export function deduplicateWorks(input: Array<Partial<ExplorationWork>>): ExplorationWork[];
export function sharedReferenceSimilarity(a: Partial<ExplorationWork>, b: Partial<ExplorationWork>): { score: number; ids: string[] };
export function rankExploration(options?: { candidates?: Array<Partial<ExplorationWork>>; seed?: Partial<ExplorationWork> | null; q?: string; mode?: "balanced" | "foundations" | "recent" | "bridges"; limit?: number; currentYear?: number }): { items: ExplorationWork[]; seed: ExplorationWork | null; graph: { nodes: Array<{ id: string; title: string; doi: string; url: string; year: string; is_seed: boolean }>; edges: ExplorationEdge[] }; candidate_count: number; truncated: boolean; ranking: { method: string; mode: string; weights: Record<string, number>; mmr_lambda: number; missing_evidence: string } };
