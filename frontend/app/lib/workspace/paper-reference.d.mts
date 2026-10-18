import type { PaperDetail } from '../api/types';
export function paperReference(paper?: Partial<PaperDetail>, locale?: string): {text: string; missing: string[]};
export function copyPaperReference(text: string, clipboard?: {writeText(text: string): Promise<void>}): Promise<boolean>;
