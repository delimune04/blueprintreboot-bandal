export interface FullTextMatch { index: number; length: number; page: number | null; excerpt: string; }
export function searchFullText(content: string, query: string, limit?: number): FullTextMatch[];
export function highlightedTextSegments(content: string, matches: FullTextMatch[]): Array<{text: string; match: FullTextMatch | null}>;
