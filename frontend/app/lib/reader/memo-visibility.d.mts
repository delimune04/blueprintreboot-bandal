export interface MemoVisibility {
  version: 1;
  hiddenAll: boolean;
  hiddenIds: string[];
}
export interface MemoVisibilityResult {
  ok: boolean;
  value: MemoVisibility;
  message: string;
}
export function readMemoVisibility(storage: Pick<Storage, "getItem"> | null, paperId: string): MemoVisibilityResult;
export function writeMemoVisibility(storage: Pick<Storage, "getItem" | "setItem"> | null, paperId: string, value: MemoVisibility): MemoVisibilityResult;
