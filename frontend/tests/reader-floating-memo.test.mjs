import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MEMO_POSITION,
  clampMemoPosition,
  encodeFloatingMemo,
  decodeFloatingMemo,
  floatingMemoDraft,
  citedBlockHighlights,
  mergeReaderHighlights,
} from "../app/lib/reader/floating-memo.mjs";
import { selectionProvenance } from "../app/lib/reader/browser-reader-state.mjs";
import {
  applyLatestRevisionDraft,
  beginRevisionSave,
  completeRevisionSave,
  createRevisionDraftState,
  draftStorageKey,
  editRevisionDraft,
  failRevisionSave,
  keepMyRevisionDraft,
  persistRevisionDraft,
  readPersistentRevisionDraft,
  receiveRemoteRevision,
} from "../app/lib/drafts/revision-draft.mjs";
import { createDemoAdapter, createDemoSeed } from "../app/lib/demo/adapter.mjs";
import { BROWSER_WORKSPACE_KEY, getBrowserWorkspaceStorage } from "../app/lib/demo/browser-storage.mjs";

function selection() {
  return {
    pageNumber: 3,
    coordinateSpace: "page-normalized",
    text: "CO₂ 저장 효율 · 직접 인용한 근거",
    rectangles: [{ x: 0.12, y: 0.24, width: 0.4, height: 0.03 }],
  };
}

function citedBlock(id = "memo-1", paperId = "paper-1", source = selection()) {
  return { id, paper_id: paperId, ...floatingMemoDraft(source) };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

async function call(api, path, method = "GET", body) {
  const response = await api(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() };
}

test("floating memo roundtrip retains Unicode, whitespace, Markdown and its bounded position", () => {
  const text = "  연구 질문\n\n**핵심**: ① CO₂ storage\n[참고](https://example.org)\n";
  const position = { x: 0.123456, y: 0.876543 };
  const encoded = encodeFloatingMemo(text, position);
  assert.deepEqual(decodeFloatingMemo(encoded), { text, position: { x: 0.12346, y: 0.87654 } });
  assert.equal(encodeFloatingMemo(decodeFloatingMemo(encoded).text, decodeFloatingMemo(encoded).position), encoded);
  assert.deepEqual(clampMemoPosition({ x: -1, y: 2 }), { x: 0, y: 1 });
  assert.deepEqual(clampMemoPosition({ x: Number.NaN, y: Number.POSITIVE_INFINITY }), DEFAULT_MEMO_POSITION);
});

test("unknown or corrupt position markers remain ordinary unstripped memo text", () => {
  const malformed = [
    '내 메모\n\n<!-- labvium-floating-memo:v1 {"x":2,"y":0.5} -->',
    '내 메모\n\n<!-- labvium-floating-memo:v1 {"x":0.5,"y":-1} -->',
    '내 메모\n\n<!-- labvium-floating-memo:v1 {"x":0..5,"y":0.5} -->',
    '내 메모\n\n<!-- labvium-floating-memo:v2 {"x":0.5,"y":0.5} -->',
    '내 메모\n\n<!-- labvium-floating-memo:v1 {"x":0.5,"y":0.5,"extra":true} -->',
    '일반 메모에는 위치 정보가 없다',
  ];
  for (const text of malformed) {
    assert.equal(decodeFloatingMemo(text), null);
    // A valid marker added later must roundtrip all original user text,
    // including a malformed or future-version marker within that text.
    assert.equal(decodeFloatingMemo(encodeFloatingMemo(text, DEFAULT_MEMO_POSITION)).text, text);
  }
});

test("a selected-text memo carries an independent exact citation and a blank memo stays uncited", () => {
  const source = selection();
  const memo = floatingMemoDraft(source);
  assert.equal(memo.block_type, "idea");
  assert.equal(memo.page, "3");
  assert.equal(memo.quote, source.text);
  assert.deepEqual(memo.provenance, selectionProvenance(source));
  assert.deepEqual(decodeFloatingMemo(memo.text), { text: "", position: DEFAULT_MEMO_POSITION });
  source.rectangles[0].x = 0.9;
  assert.equal(memo.provenance.rectangles[0].x, 0.12, "a later PDF selection cannot mutate the captured citation");
  const blank = floatingMemoDraft();
  assert.equal(blank.page, "");
  assert.equal(blank.quote, "");
  assert.equal(Object.hasOwn(blank, "provenance"), false);
});

test("cited highlight reconstruction excludes other papers and rejects invalid page geometry", () => {
  const valid = citedBlock();
  const others = [
    citedBlock("other-paper", "paper-2"),
    { ...citedBlock("missing-provenance"), provenance: undefined },
    { ...citedBlock("wrong-source"), provenance: { ...valid.provenance, source: "manual" } },
  ];
  // Invalid geometry can be read from a corrupt external record even though
  // floatingMemoDraft correctly rejects creating it.
  const corrupted = [
    { page: 0 },
    { coordinate_space: "pixels" },
    { quote: "" },
    { rectangles: [{ x: 0.9, y: 0.1, width: 0.5, height: 0.02 }] },
    { rectangles: [{ x: 0.1, y: 0.1, width: Number.NaN, height: 0.02 }] },
    { rectangles: [] },
  ].map((changes, index) => ({ ...valid, id: `invalid-${index}`, provenance: { ...valid.provenance, ...changes } }));
  const restored = citedBlockHighlights([valid, ...others, ...corrupted], "paper-1");
  assert.deepEqual(restored, [{ ...selection(), id: "block:memo-1" }]);
  assert.throws(() => floatingMemoDraft({ ...selection(), pageNumber: 0 }));
});

test("merging persisted citations supersedes duplicate local geometry without dropping unrelated highlights", () => {
  const local = [
    { ...selection(), id: "local-old-copy" },
    { ...selection(), pageNumber: 4, id: "local-unrelated" },
  ];
  const cited = citedBlockHighlights([citedBlock()], "paper-1");
  const before = structuredClone(local);
  const merged = mergeReaderHighlights(local, cited);
  assert.deepEqual(merged.map((highlight) => highlight.id), ["local-unrelated", "block:memo-1"]);
  assert.deepEqual(local, before, "merging must not rewrite the browser-local source collection");
  assert.deepEqual(mergeReaderHighlights(merged, cited), merged, "reloading saved citations does not multiply overlays");
});

test("text and position edits made during memo save remain recoverable after remount", () => {
  const storage = memoryStorage();
  const key = draftStorageKey("floating-memo", "paper-1:memo-1");
  const baseline = floatingMemoDraft(selection());
  const first = { ...baseline, text: encodeFloatingMemo("저장 중인 메모", { x: 0.2, y: 0.3 }) };
  let state = editRevisionDraft(createRevisionDraftState({ draft: baseline, revision: "r1" }), first);
  const started = beginRevisionSave(state);
  assert.ok(started.request);
  const latest = { ...first, text: encodeFloatingMemo("저장 요청 뒤 계속 작성한 메모", { x: 0.8, y: 0.6 }) };
  state = editRevisionDraft(started.state, latest);
  state = completeRevisionSave(state, started.request.token, { value: first, revision: "r2" });
  assert.equal(state.saveState, "unsaved");
  assert.equal(persistRevisionDraft(storage, key, state), true);
  const restored = createRevisionDraftState({ draft: first, revision: "r2", record: readPersistentRevisionDraft(storage, key) });
  assert.deepEqual(restored.draft, latest);
  assert.deepEqual(restored.baseline, first);
  assert.deepEqual(restored.draft.provenance, baseline.provenance);
  assert.deepEqual(decodeFloatingMemo(restored.draft.text), { text: "저장 요청 뒤 계속 작성한 메모", position: { x: 0.8, y: 0.6 } });
  assert.equal(restored.saveState, "unsaved");
  assert.equal(beginRevisionSave(restored).request.revision, "r2");
});

test("a conflicted memo restores both versions and requires explicit keep-mine or use-latest", () => {
  const storage = memoryStorage();
  const key = draftStorageKey("floating-memo", "paper-1:conflicted");
  const initial = floatingMemoDraft(selection());
  const local = { ...initial, text: encodeFloatingMemo("내 연구 해석", { x: 0.1, y: 0.2 }) };
  const remote = { ...initial, text: encodeFloatingMemo("다른 기기의 메모", { x: 0.7, y: 0.8 }) };
  const started = beginRevisionSave(editRevisionDraft(createRevisionDraftState({ draft: initial, revision: "r1" }), local));
  const conflicted = receiveRemoteRevision(failRevisionSave(started.state, started.request.token, "conflict"), { value: remote, revision: "r2", changedElsewhere: true });
  persistRevisionDraft(storage, key, conflicted);
  const restored = createRevisionDraftState({ draft: remote, revision: "r2", record: readPersistentRevisionDraft(storage, key) });
  assert.equal(restored.saveState, "changed_elsewhere");
  assert.deepEqual(restored.draft, local);
  assert.deepEqual(restored.remote, remote);
  assert.equal(beginRevisionSave(restored).request, null);
  const keepMine = keepMyRevisionDraft(restored);
  assert.deepEqual(keepMine.draft, local);
  assert.deepEqual(keepMine.baseline, remote);
  assert.equal(keepMine.saveState, "unsaved");
  assert.equal(beginRevisionSave(keepMine).request.revision, "r2");
  const useLatest = applyLatestRevisionDraft(restored);
  assert.deepEqual(useLatest.draft, remote);
  assert.equal(useLatest.saveState, "saved");
  persistRevisionDraft(storage, key, useLatest);
  assert.equal(storage.getItem(key), null, "only the explicit use-latest choice clears this conflict draft");
});

test("IndexedDB recreation preserves memo position and citation while stale updates cannot overwrite it", async () => {
  const storage = getBrowserWorkspaceStorage();
  const existing = await storage.getItem(BROWSER_WORKSPACE_KEY);
  assert.equal(await storage.compareAndSet(BROWSER_WORKSPACE_KEY, existing, JSON.stringify(createDemoSeed())), true);
  const api = createDemoAdapter();
  const path = "/papers/demo-ccs/note-blocks";
  const initial = await call(api, path);
  assert.equal(initial.status, 200);
  const memo = { ...floatingMemoDraft(selection()), title: "내 연구 메모", text: encodeFloatingMemo("근거와 해석을 연결한다", { x: 0.3, y: 0.6 }) };
  const created = await call(api, path, "POST", { ...memo, expected_revision: initial.data.note_blocks_revision });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const recreated = createDemoAdapter();
  const collection = await call(recreated, path);
  const saved = collection.data.items.find((block) => block.id === created.data.block.id);
  assert.deepEqual(decodeFloatingMemo(saved.text), { text: "근거와 해석을 연결한다", position: { x: 0.3, y: 0.6 } });
  assert.deepEqual(saved.provenance, memo.provenance);
  assert.deepEqual(citedBlockHighlights([saved], "demo-ccs"), [{ ...selection(), id: `block:${saved.id}` }]);
  const nextText = encodeFloatingMemo("서버에 저장한 수정본", { x: 0.4, y: 0.5 });
  const updated = await call(recreated, `${path}/${saved.id}`, "PATCH", { changes: { text: nextText }, expected_revision: collection.data.note_blocks_revision });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  const stale = await call(api, `${path}/${saved.id}`, "PATCH", { changes: { text: encodeFloatingMemo("덮어쓰면 안 되는 이전 초안", { x: 0, y: 0 }) }, expected_revision: collection.data.note_blocks_revision });
  assert.equal(stale.status, 409);
  const reloaded = (await call(createDemoAdapter(), path)).data.items.find((block) => block.id === saved.id);
  assert.equal(reloaded.text, nextText);
  assert.deepEqual(reloaded.provenance, memo.provenance);
});
