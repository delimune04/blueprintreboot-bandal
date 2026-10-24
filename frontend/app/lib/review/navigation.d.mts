import type { ReviewRow } from './model.mjs';
export function findReviewRecords(rows: ReviewRow[], query?: string, status?: 'all' | 'open' | 'reviewed'): { row: ReviewRow; number: number }[];
