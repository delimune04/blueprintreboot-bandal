import type { ReviewInput, ReviewCoverage, ReviewKind } from './model.mjs';
export type ReadinessReason = { code: string; kinds?: ReviewKind[]; count?: number };
export function reviewReadiness(input: { draft: ReviewInput; coverage: ReviewCoverage; viewer: boolean; archived: boolean; busy: boolean; dirty: boolean; evidenceChanges?: number; staleSources: boolean; reviewedBy: string; snapshotCount: number }): ReadinessReason[];
