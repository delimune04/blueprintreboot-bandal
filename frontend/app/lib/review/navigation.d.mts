import type { ReviewRow, ReviewKind } from './model.mjs';
export function findReviewRecords(rows: ReviewRow[], query?: string, status?: 'all' | 'open' | 'reviewed', kind?: 'all' | ReviewKind): { row: ReviewRow; number: number }[];
