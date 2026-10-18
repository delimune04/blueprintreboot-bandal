import type { PaperDetail } from '../api/types';
import type { ScholarlyWork } from './types';
export type PdfSourceInput = Partial<PaperDetail> | Partial<ScholarlyWork> | { metadata?: { doi?: string; arxiv_id?: string; openalex_id?: string }; external_source?: Partial<ScholarlyWork>; discovery_identifiers?: string[] };
export interface CanonicalPdfIdentifiers { doi: string; arxiv_id: string; openalex_id: string }
export interface InferredPdfSource { pdf_url: string; source_url: string; arxiv_id: string; inferred: boolean }
export interface PdfAccessResult { status: 'available' | 'open_access' | 'source_only' | 'unavailable'; pdf_url: string; source_url: string; can_import: boolean; reason: string }
export function canonicalPdfIdentifiers(input?: PdfSourceInput): CanonicalPdfIdentifiers;
export function inferredPdfSource(input?: PdfSourceInput): InferredPdfSource;
export function publicPdfAccessPath(input?: PdfSourceInput): string;
export function downloadManagedPdf(paperId: string, title: string, signal?: AbortSignal): Promise<void>;
