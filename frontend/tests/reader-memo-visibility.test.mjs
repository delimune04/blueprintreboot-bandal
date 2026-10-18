import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { configureDraftWorkspaceScope, draftStorageKey } from "../app/lib/drafts/revision-draft.mjs";
import { readMemoVisibility, writeMemoVisibility } from "../app/lib/reader/memo-visibility.mjs";

function memoryStorage() {
  const records = new Map();
  return { records, getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
}
const preferenceKey = paperId => draftStorageKey("reader-memo-visibility", paperId);
const shown = () => ({ version: 1, hiddenAll: false, hiddenIds: [] });
afterEach(() => configureDraftWorkspaceScope(""));

test("memo visibility is isolated by account, workspace, paper and guest scope", () => {
  const storage = memoryStorage();
  const scopes = ["", "alice:personal", "alice:lab", "bob:lab"];
  for (const [index, scope] of scopes.entries()) {
    configureDraftWorkspaceScope(scope);
    assert.deepEqual(readMemoVisibility(storage, "paper-1").value, shown());
    assert.equal(writeMemoVisibility(storage, "paper-1", { version: 1, hiddenAll: index % 2 === 1, hiddenIds: [`memo-${index}`] }).ok, true);
    assert.deepEqual(readMemoVisibility(storage, "paper-2").value, shown());
  }
  for (const [index, scope] of scopes.entries()) {
    configureDraftWorkspaceScope(scope);
    assert.deepEqual(readMemoVisibility(storage, "paper-1").value, { version: 1, hiddenAll: index % 2 === 1, hiddenIds: [`memo-${index}`] });
  }
  assert.equal(storage.records.size, 4);
});

test("showing all and hiding individual memos remain independent without changing note contents or revision drafts", () => {
  const storage = memoryStorage();
  const note = { id: "memo-1", text: "Original research evidence", quote: "Exact PDF quote", revision: "blocks-3" };
  const noteBytes = JSON.stringify(note), draftBytes = JSON.stringify({ draft: "Unsaved interpretation", revision: "blocks-3" });
  storage.setItem("saved-note-blocks", noteBytes);
  storage.setItem(draftStorageKey("reader-floating-memo", "paper-1:memo-1"), draftBytes);
  assert.equal(writeMemoVisibility(storage, "paper-1", { version: 1, hiddenAll: false, hiddenIds: [note.id] }).ok, true);
  assert.equal(writeMemoVisibility(storage, "paper-1", { ...readMemoVisibility(storage, "paper-1").value, hiddenAll: true }).ok, true);
  assert.equal(writeMemoVisibility(storage, "paper-1", { ...readMemoVisibility(storage, "paper-1").value, hiddenAll: false }).ok, true);
  assert.deepEqual(readMemoVisibility(storage, "paper-1").value, { version: 1, hiddenAll: false, hiddenIds: ["memo-1"] });
  assert.equal(storage.getItem("saved-note-blocks"), noteBytes);
  assert.equal(storage.getItem(draftStorageKey("reader-floating-memo", "paper-1:memo-1")), draftBytes);
  assert.deepEqual(note, JSON.parse(noteBytes));
});

test("corrupt, unsupported and oversized saved preference bytes remain untouched and cannot be overwritten", () => {
  const storage = memoryStorage();
  for (const raw of ["{broken", "null", JSON.stringify({ ...shown(), version: 2 }), JSON.stringify({ ...shown(), text: "Unexpected content" }), " ".repeat(512001)]) {
    storage.setItem(preferenceKey("paper-1"), raw);
    assert.equal(readMemoVisibility(storage, "paper-1").ok, false);
    const result = writeMemoVisibility(storage, "paper-1", shown());
    assert.equal(result.ok, false); assert.match(result.message, /preserved/);
    assert.equal(storage.getItem(preferenceKey("paper-1")), raw);
  }
});

test("invalid or unbounded visibility writes retain the last confirmed preference", () => {
  const storage = memoryStorage();
  const baseline = { version: 1, hiddenAll: true, hiddenIds: ["kept"] };
  writeMemoVisibility(storage, "paper-1", baseline); const raw = storage.getItem(preferenceKey("paper-1"));
  const invalid = [null, { ...shown(), hiddenAll: "false" }, { ...shown(), hiddenIds: [""] }, { ...shown(), hiddenIds: ["a".repeat(201)] }, { ...shown(), hiddenIds: ["memo\n1"] }, { ...shown(), hiddenIds: Array.from({ length: 1001 }, (_, i) => `memo-${i}`) }, { ...shown(), hiddenIds: null }];
  for (const value of invalid) {
    const result = writeMemoVisibility(storage, "paper-1", value);
    assert.equal(result.ok, false); assert.deepEqual(result.value, baseline);
    assert.equal(storage.getItem(preferenceKey("paper-1")), raw);
  }
  const maximum = { version: 1, hiddenAll: false, hiddenIds: Array.from({ length: 1000 }, (_, i) => `${i}`.padEnd(200, "a")) };
  assert.equal(writeMemoVisibility(storage, "paper-1", maximum).ok, true);
  maximum.hiddenIds[0] = "changed-after-save";
  assert.notEqual(readMemoVisibility(storage, "paper-1").value.hiddenIds[0], maximum.hiddenIds[0]);
});

test("unavailable, quota-limited and unconfirmed storage never claims a successful preference save", () => {
  assert.equal(readMemoVisibility(null, "paper-1").ok, false);
  assert.equal(writeMemoVisibility(null, "paper-1", shown()).ok, false);
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { assert.fail("unreadable bytes must never be overwritten"); } };
  assert.equal(writeMemoVisibility(blocked, "paper-1", shown()).ok, false);
  const quota = { getItem: () => null, setItem() { throw new Error("quota"); } };
  assert.equal(writeMemoVisibility(quota, "paper-1", shown()).ok, false);
  const ignored = { getItem: () => null, setItem() {} };
  assert.equal(writeMemoVisibility(ignored, "paper-1", shown()).ok, false);
});
