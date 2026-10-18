import type { NormalizedPageRectangle } from '../pdf/selection-coordinates.mjs';
import type { MemoPosition } from './floating-memo.mjs';
export type MemoSide = 'left' | 'right';
export interface MemoLayoutRect { left: number; top: number; width: number; height: number; right?: number; bottom?: number }
export interface MemoConnector { start: {x: number; y: number}; end: {x: number; y: number}; path: string }
export interface MemoConnectorInput { noteRect: MemoLayoutRect; pageRect: MemoLayoutRect; viewportRect: MemoLayoutRect; rectangles: NormalizedPageRectangle[]; side: MemoSide; windowWidth: number; windowHeight?: number; height?: number; noteClipRect?: MemoLayoutRect }
export function memoSideFromPosition(position?: Partial<MemoPosition> | null): MemoSide;
export function computeMemoConnector(input: MemoConnectorInput): MemoConnector | null;
