import { draftStorageKey } from "../drafts/revision-draft.mjs";

const key = (paperId) => draftStorageKey("reader-memo-visibility", paperId);
const defaults = () => ({ version: 1, hiddenAll: false, hiddenIds: [] });
function valid(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === 3
    && ["version", "hiddenAll", "hiddenIds"].every(field => Object.hasOwn(value, field))
    && value.version === 1 && typeof value.hiddenAll === "boolean"
    && Array.isArray(value.hiddenIds) && value.hiddenIds.length <= 1000
    && value.hiddenIds.every(id => typeof id === "string" && id.length > 0 && id.length <= 200 && !/[\u0000-\u001f\u007f]/.test(id));
}

/** Local presentation only. An unreadable record remains untouched and blocks
 * preference writes; hiding a memo never edits or removes its research text. */
export function readMemoVisibility(storage, paperId) {
  if (!storage) return { ok: false, value: defaults(), message: "Memo visibility preferences are unavailable in this browser." };
  try {
    const raw = storage.getItem(key(paperId));
    if (raw === null) return { ok: true, value: defaults(), message: "" };
    if (raw.length > 512000) throw new Error("oversized memo visibility preferences");
    const value = JSON.parse(raw);
    if (!valid(value)) throw new Error("invalid memo visibility preferences");
    return { ok: true, value, message: "" };
  } catch {
    return { ok: false, value: defaults(), message: "Memo visibility preferences could not be read. Existing data was preserved." };
  }
}

export function writeMemoVisibility(storage, paperId, value) {
  const current = readMemoVisibility(storage, paperId);
  if (!current.ok) return current;
  try {
    if (!valid(value)) throw new Error("invalid memo visibility preferences");
    const encoded = JSON.stringify(value);
    storage.setItem(key(paperId), encoded);
    if (storage.getItem(key(paperId)) !== encoded) throw new Error("unconfirmed memo visibility preferences");
    return { ok: true, value: JSON.parse(encoded), message: "" };
  } catch {
    return { ...current, ok: false, message: "Memo visibility preferences could not be saved. Nothing was acknowledged as saved." };
  }
}
