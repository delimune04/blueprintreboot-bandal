// Browser-local draft preservation for explicit, revision-checked writes.
//
// This module intentionally has no React dependency. It is used by editor
// components as well as focused Node tests, and keeps the persistence contract
// small enough to apply to the existing command surfaces incrementally.

export const SAVE_STATES = [
  "saved",
  "unsaved",
  "saving",
  "failed",
  "changed_elsewhere",
  "offline",
];
let workspaceScope = "";
export function configureDraftWorkspaceScope(scope = "") { workspaceScope = String(scope); }

export function saveStateLabel(state) {
  return {
    saved: "Saved",
    unsaved: "Unsaved changes",
    saving: "Saving...",
    failed: "Save failed",
    changed_elsewhere: "Changed elsewhere",
    offline: "Offline",
  }[state] ?? "Unsaved changes";
}

export function draftStorageKey(scope, identity) {
  const namespace = workspaceScope ? `cloud:${encodeURIComponent(workspaceScope)}:` : "";
  return `blueprint-reboot:draft:v1:${namespace}${encodeURIComponent(scope)}:${encodeURIComponent(identity)}`;
}

function copy(value) {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

export function revisionDraftEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value) {
  return value
    && typeof value === "object"
    && value.version === 1
    && Object.hasOwn(value, "draft")
    && Object.hasOwn(value, "baseline")
    && typeof value.revision === "string"
    && Number.isInteger(value.generation);
}

export function readPersistentRevisionDraft(storage, key) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const record = JSON.parse(raw);
    return isRecord(record) ? record : null;
  } catch {
    // A browser privacy setting or a malformed local record must never make an
    // editor unusable. Keep the record untouched so a user can recover it by
    // browser means if necessary.
    return null;
  }
}

export function persistRevisionDraft(storage, key, state) {
  if (!storage) return false;
  try {
    if (state.saveState === "saved" && revisionDraftEqual(state.draft, state.baseline)) {
      storage.removeItem(key);
      return true;
    }
    storage.setItem(key, JSON.stringify({
      version: 1,
      draft: state.draft,
      baseline: state.baseline,
      revision: state.revision,
      generation: state.generation,
      remote: state.remote,
      remoteRevision: state.remoteRevision,
    }));
    return true;
  } catch {
    // The in-memory draft remains intact when storage is unavailable or full.
    return false;
  }
}

export function clearPersistentRevisionDraft(storage, key) {
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function createRevisionDraftState({ draft, baseline = draft, revision = "", record = null }) {
  const hasLocalDraft = record && (
    !revisionDraftEqual(record.draft, record.baseline)
    || (typeof record.remoteRevision === "string" && record.remoteRevision !== record.revision)
  );
  if (hasLocalDraft) {
    const serverChangedSinceRecord = Boolean(record.revision && revision && record.revision !== revision);
    const remoteChanged = Boolean(
      serverChangedSinceRecord
      || (record.remoteRevision && record.remoteRevision !== record.revision),
    );
    return {
      draft: copy(record.draft),
      baseline: copy(record.baseline),
      revision: record.revision,
      remote: copy(serverChangedSinceRecord || record.remote === undefined ? draft : record.remote),
      remoteRevision: serverChangedSinceRecord
        ? revision
        : typeof record.remoteRevision === "string" ? record.remoteRevision : revision,
      generation: Math.max(0, record.generation),
      saveState: remoteChanged ? "changed_elsewhere" : "unsaved",
      lastError: "",
      activeSave: null,
      nextSaveToken: 1,
    };
  }
  return {
    draft: copy(draft),
    baseline: copy(baseline),
    revision,
    remote: copy(draft),
    remoteRevision: revision,
    generation: 0,
    saveState: "saved",
    lastError: "",
    activeSave: null,
    nextSaveToken: 1,
  };
}

function unsavedStateAfterEdit(state) {
  if (state.saveState === "changed_elsewhere") return "changed_elsewhere";
  return revisionDraftEqual(state.draft, state.baseline) ? "saved" : "unsaved";
}

export function editRevisionDraft(state, draft) {
  const next = {
    ...state,
    draft: copy(draft),
    generation: state.generation + 1,
    lastError: "",
  };
  return { ...next, saveState: unsavedStateAfterEdit(next) };
}

export function beginRevisionSave(state) {
  if (state.activeSave || state.saveState === "changed_elsewhere" || revisionDraftEqual(state.draft, state.baseline)) {
    return { state, request: null };
  }
  const token = state.nextSaveToken;
  const activeSave = {
    token,
    draft: copy(state.draft),
    revision: state.revision,
    generation: state.generation,
  };
  return {
    state: {
      ...state,
      activeSave,
      nextSaveToken: token + 1,
      saveState: "saving",
      lastError: "",
    },
    request: activeSave,
  };
}

export function completeRevisionSave(state, token, { value, revision }) {
  if (!state.activeSave || state.activeSave.token !== token) return state;
  const savedSnapshot = state.activeSave;
  const userChangedDuringSave = state.generation !== savedSnapshot.generation
    || !revisionDraftEqual(state.draft, savedSnapshot.draft);
  const next = {
    ...state,
    baseline: copy(value),
    revision,
    remote: copy(value),
    remoteRevision: revision,
    activeSave: null,
    lastError: "",
  };
  if (!userChangedDuringSave) {
    return {
      ...next,
      draft: copy(value),
      saveState: "saved",
    };
  }
  return { ...next, saveState: "unsaved" };
}

export function failRevisionSave(state, token, kind, message = "") {
  if (!state.activeSave || state.activeSave.token !== token) return state;
  const saveState = kind === "conflict"
    ? "changed_elsewhere"
    : kind === "unavailable"
      ? "offline"
      : "failed";
  return {
    ...state,
    activeSave: null,
    saveState,
    lastError: message,
  };
}

// Applies a confirmed current server value without discarding local work. This
// is used after a conflict or a related command updates the authoritative note
// header. A caller may subsequently choose which version to keep.
export function receiveRemoteRevision(state, { value, revision, changedElsewhere = false }) {
  const localIsDirty = !revisionDraftEqual(state.draft, state.baseline);
  if (!localIsDirty) {
    return {
      ...state,
      draft: copy(value),
      baseline: copy(value),
      revision,
      remote: copy(value),
      remoteRevision: revision,
      saveState: "saved",
      lastError: "",
    };
  }
  return {
    ...state,
    remote: copy(value),
    remoteRevision: revision,
    saveState: changedElsewhere ? "changed_elsewhere" : state.saveState === "saving" ? "saving" : "unsaved",
  };
}

// Rebase is appropriate when this same browser has just received a command
// response that is known to have changed the server value (for example a
// metadata edit refreshing the Reading Note header). It preserves a local
// draft but lets its next explicit Save use the new revision.
export function rebaseRevisionDraft(state, { value, revision }) {
  const localIsDirty = !revisionDraftEqual(state.draft, state.baseline);
  if (!localIsDirty) return receiveRemoteRevision(state, { value, revision });
  return {
    ...state,
    baseline: copy(value),
    revision,
    remote: copy(value),
    remoteRevision: revision,
    saveState: state.saveState === "saving" ? "saving" : "unsaved",
  };
}

export function keepMyRevisionDraft(state) {
  if (
    state.remoteRevision === undefined
    || state.remoteRevision === null
    || (state.remoteRevision === state.revision && revisionDraftEqual(state.remote, state.baseline))
  ) return state;
  const next = {
    ...state,
    baseline: copy(state.remote),
    revision: state.remoteRevision,
    activeSave: null,
    lastError: "",
  };
  return {
    ...next,
    saveState: revisionDraftEqual(next.draft, next.baseline) ? "saved" : "unsaved",
  };
}

export function applyLatestRevisionDraft(state) {
  const next = {
    ...state,
    draft: copy(state.remote),
    baseline: copy(state.remote),
    revision: state.remoteRevision,
    generation: state.generation + 1,
    activeSave: null,
    saveState: "saved",
    lastError: "",
  };
  return next;
}
