export interface SearchResult { id: string; kind: string; title: string; snippet: string; url: string; paper_id?: string; page?: number | null; block_id?: string; project_id?: string; research_page_id?: string }
export function searchWorkspace(state: unknown, researchPages: unknown[], query: string, projectId?: string, limit?: number): SearchResult[];
