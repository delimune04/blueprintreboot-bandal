export type AiTask = "question" | "summary" | "compare" | "gaps" | "handoff";
export interface AiEvidenceSource { id: string; paper_id: string; title: string; page: number | null; block_id?: string; text: string; kind: "pdf-page" | "note-block" | "reading-note"; retrieval_score: number }
export interface AiEvidencePreview { sources: AiEvidenceSource[]; revision: string; coverage: { method: string; paper_count: number; available_units: number; candidate_chunks: number; returned_chunks: number; omitted_units: number; excluded_pdf_pages: number; limited: boolean; semantic_search: false } }
export const AI_TASKS: AiTask[];
export function rankEvidence(sources: Array<Omit<AiEvidenceSource, "retrieval_score">>, query: string): AiEvidenceSource[];
export function prepareAiSources(state: unknown, input: { question: string; paper_ids?: string[]; project_id?: string }): Promise<AiEvidencePreview>;
export function selectAiEvidence(state: unknown, input: unknown): Promise<unknown>;
