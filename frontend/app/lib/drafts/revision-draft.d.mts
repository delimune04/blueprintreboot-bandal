export type SaveState = "saved" | "unsaved" | "saving" | "failed" | "changed_elsewhere" | "offline";

export interface RevisionDraftSave<T> {
  token: number;
  draft: T;
  revision: string;
  generation: number;
}

export interface RevisionDraftState<T> {
  draft: T;
  baseline: T;
  revision: string;
  remote: T;
  remoteRevision: string;
  generation: number;
  saveState: SaveState;
  lastError: string;
  activeSave: RevisionDraftSave<T> | null;
  nextSaveToken: number;
}

export const SAVE_STATES: SaveState[];
export function saveStateLabel(state: SaveState): string;
export function draftStorageKey(scope: string, identity: string): string;
export function configureDraftWorkspaceScope(scope?: string): void;
export function revisionDraftEqual<T>(left: T, right: T): boolean;
export function readPersistentRevisionDraft(storage: Storage | null | undefined, key: string): Record<string, unknown> | null;
export function persistRevisionDraft<T>(storage: Storage | null | undefined, key: string, state: RevisionDraftState<T>): boolean;
export function clearPersistentRevisionDraft(storage: Storage | null | undefined, key: string): boolean;
export function createRevisionDraftState<T>(input: { draft: T; baseline?: T; revision?: string; record?: Record<string, unknown> | null }): RevisionDraftState<T>;
export function editRevisionDraft<S extends RevisionDraftState<unknown>>(state: S, draft: S["draft"]): S;
export function beginRevisionSave<S extends RevisionDraftState<unknown>>(state: S): { state: S; request: RevisionDraftSave<S["draft"]> | null };
export function completeRevisionSave<S extends RevisionDraftState<unknown>>(state: S, token: number, response: { value: S["draft"]; revision: string }): S;
export function failRevisionSave<S extends RevisionDraftState<unknown>>(state: S, token: number, kind: string, message?: string): S;
export function receiveRemoteRevision<S extends RevisionDraftState<unknown>>(state: S, response: { value: S["draft"]; revision: string; changedElsewhere?: boolean }): S;
export function rebaseRevisionDraft<S extends RevisionDraftState<unknown>>(state: S, response: { value: S["draft"]; revision: string }): S;
export function keepMyRevisionDraft<S extends RevisionDraftState<unknown>>(state: S): S;
export function applyLatestRevisionDraft<S extends RevisionDraftState<unknown>>(state: S): S;
