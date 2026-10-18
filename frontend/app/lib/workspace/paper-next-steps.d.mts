import type { PaperDetail } from '../api/types';
import type { DiscoveryResponse, ScholarlyWork } from './types';
export type ExplorationRelation = 'references' | 'cited_by' | 'similar';
export type PaperTrailStep = { work: ScholarlyWork; relation: ExplorationRelation; response: DiscoveryResponse };
export function openAlexWorkId(work: Partial<ScholarlyWork>): string;
export function paperExplorationSource(paper: PaperDetail): ScholarlyWork;
export function relatedSearchPath(work: ScholarlyWork, relation: ExplorationRelation): string;
export function appendPaperTrail(trail: PaperTrailStep[], step: PaperTrailStep): PaperTrailStep[];
