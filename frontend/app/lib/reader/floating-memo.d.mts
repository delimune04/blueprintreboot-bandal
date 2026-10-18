import type { EditableNoteBlockContent, NoteBlock } from "../api/types";
import type { PdfPageSelection } from "../pdf/selection-coordinates.mjs";
import type { ReaderHighlight } from "./browser-reader-state.mjs";
export interface MemoPosition { x: number; y: number; }
export const DEFAULT_MEMO_POSITION: MemoPosition;
export function clampMemoPosition(position?: MemoPosition): MemoPosition;
export function encodeFloatingMemo(text: string, position: MemoPosition): string;
export function decodeFloatingMemo(content: string): { text: string; position: MemoPosition } | null;
export function floatingMemoDraft(selection?: PdfPageSelection | null): EditableNoteBlockContent;
export function citedBlockHighlights(blocks: NoteBlock[], paperId: string): ReaderHighlight[];
export function mergeReaderHighlights(local: ReaderHighlight[], cited: ReaderHighlight[]): ReaderHighlight[];
