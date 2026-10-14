const PREFIX = "bandal.reader.preferences.v1:";
const LIMIT = 500;
let workspaceScope = "";
export function configureReaderWorkspaceScope(scope = "") { workspaceScope = String(scope); }

export function readerPreferenceKey(paperId) {
  return `${PREFIX}${workspaceScope ? `cloud:${encodeURIComponent(workspaceScope)}:` : ""}${encodeURIComponent(String(paperId))}`;
}

export function emptyReaderPreferences() { return { version: 1, page: 1, highlights: [] }; }

export function validateReaderSelection(selection) {
  if (!selection || !Number.isInteger(selection.pageNumber) || selection.pageNumber < 1
    || selection.coordinateSpace !== "page-normalized" || typeof selection.text !== "string"
    || !selection.text.trim() || selection.text.length > 100000
    || !Array.isArray(selection.rectangles) || selection.rectangles.length < 1 || selection.rectangles.length > LIMIT) return false;
  return selection.rectangles.every((rect) => rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
    && rect.x + rect.width <= 1.000001 && rect.y + rect.height <= 1.000001);
}

export function selectionProvenance(selection) {
  if (!validateReaderSelection(selection)) throw new Error("A valid, single-page PDF text selection is required.");
  return {
    source: "pdf_selection", page: selection.pageNumber, coordinate_space: "page-normalized",
    rectangles: selection.rectangles.map((rect) => ({ ...rect })), quote: selection.text,
  };
}

export function selectionEvidenceDraft(selection) {
  return {
    block_type: "evidence", title: selection.text.slice(0, 90), text: selection.text,
    page: String(selection.pageNumber), figure: "", quote: selection.text, tags: [],
    provenance: selectionProvenance(selection),
  };
}

function validState(state) {
  return state?.version === 1 && Number.isInteger(state.page) && state.page > 0
    && Array.isArray(state.highlights) && state.highlights.length <= LIMIT
    && state.highlights.every((selection) => typeof selection.id === "string" && selection.id.length <= 200 && validateReaderSelection(selection));
}

export function readReaderPreferences(storage, paperId) {
  try {
    if (!storage) return { ok: false, value: emptyReaderPreferences(), message: "Reader preferences are unavailable in this browser." };
    const raw = storage.getItem(readerPreferenceKey(paperId));
    if (raw === null) return { ok: true, value: emptyReaderPreferences(), message: "" };
    const value = JSON.parse(raw);
    if (!validState(value)) throw new Error("invalid reader preferences");
    return { ok: true, value, message: "" };
  } catch {
    return { ok: false, value: emptyReaderPreferences(), message: "Reader preferences could not be read. Existing data was preserved." };
  }
}

export function updateReaderPreferences(storage, paperId, update) {
  const current = readReaderPreferences(storage, paperId);
  if (!current.ok) return current;
  try {
    const next = update(structuredClone(current.value));
    if (!validState(next)) throw new Error("invalid reader preferences");
    const encoded = JSON.stringify(next);
    storage.setItem(readerPreferenceKey(paperId), encoded);
    if (storage.getItem(readerPreferenceKey(paperId)) !== encoded) throw new Error("unconfirmed reader preference save");
    return { ok: true, value: next, message: "" };
  } catch {
    return { ...current, ok: false, message: "Reader preferences could not be saved. Nothing was acknowledged as saved." };
  }
}

export function appendReaderHighlight(preferences, selection, id) {
  if (!validateReaderSelection(selection)) throw new Error("Invalid PDF selection.");
  const signature = JSON.stringify(selectionProvenance(selection));
  if (preferences.highlights.some((highlight) => JSON.stringify(selectionProvenance(highlight)) === signature)) return preferences;
  return { ...preferences, highlights: [...preferences.highlights, { ...selection, id }] };
}
