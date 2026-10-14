import type { PdfPageSelection } from "../pdf/selection-coordinates.mjs";
export interface ReaderHighlight extends PdfPageSelection { id: string; }
export interface ReaderPreferences { version: 1; page: number; highlights: ReaderHighlight[]; }
export interface ReaderPreferenceResult { ok: boolean; value: ReaderPreferences; message: string; }
export interface SelectionProvenance { source: "pdf_selection"; page: number; coordinate_space: "page-normalized"; rectangles: PdfPageSelection["rectangles"]; quote: string; }
export function readerPreferenceKey(paperId: string): string;
export function configureReaderWorkspaceScope(scope?: string): void;
export function emptyReaderPreferences(): ReaderPreferences;
export function validateReaderSelection(selection: unknown): selection is PdfPageSelection;
export function selectionProvenance(selection: PdfPageSelection): SelectionProvenance;
export function selectionEvidenceDraft(selection: PdfPageSelection): { block_type: "evidence"; title: string; text: string; page: string; figure: string; quote: string; tags: string[]; provenance: SelectionProvenance };
export function readReaderPreferences(storage: Storage | null, paperId: string): ReaderPreferenceResult;
export function updateReaderPreferences(storage: Storage | null, paperId: string, update: (state: ReaderPreferences) => ReaderPreferences): ReaderPreferenceResult;
export function appendReaderHighlight(preferences: ReaderPreferences, selection: PdfPageSelection, id: string): ReaderPreferences;
