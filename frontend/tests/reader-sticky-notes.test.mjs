import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";
import { draftStorageKey } from "../app/lib/drafts/revision-draft.mjs";
import { decodeFloatingMemo, encodeFloatingMemo } from "../app/lib/reader/floating-memo.mjs";
import { readMemoVisibility } from "../app/lib/reader/memo-visibility.mjs";

const require = createRequire(import.meta.url);
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
class ApiClientError extends Error { constructor(message, kind) { super(message); this.kind = kind; } }
function memoryStorage({ blocked = false } = {}) {
  const rows = new Map();
  return { rows, getItem: key => rows.get(key) ?? null, setItem(key, value) { if (blocked) throw new Error("storage quota"); rows.set(key, value); }, removeItem: key => rows.delete(key) };
}
function block(id, text, x) {
  return { id, paper_id: "paper-1", block_type: "idea", title: `Title ${id}`, text: encodeFloatingMemo(text, { x, y: .1 }), page: "2", figure: "", quote: "Exact original excerpt", tags: [], provenance: { source: "pdf_selection", page: 2, coordinate_space: "page-normalized", rectangles: [{ x: .1, y: .2, width: .3, height: .02 }], quote: "Exact original excerpt" } };
}
const originalBlocks = () => [block("memo-1", "First saved interpretation", 0), block("memo-2", "Second saved interpretation", 1)];
const draftKey = id => draftStorageKey("reader-floating-memo", `paper-1:${id || "new"}`);

function nodes(tree, predicate) {
  const found = [];
  function walk(value) { if (Array.isArray(value)) return value.forEach(walk); if (!value || typeof value !== "object") return; if (predicate(value)) found.push(value); walk(value.props?.children); }
  walk(tree); return found;
}
function textOf(value) { return Array.isArray(value) ? value.map(textOf).join("") : typeof value === "string" || typeof value === "number" ? String(value) : value && typeof value === "object" ? textOf(value.props?.children) : ""; }
function button(tree, label) { const found = nodes(tree, node => node.type === "button" && textOf(node).trim() === label)[0]; assert.ok(found, `Missing button ${label}`); return found; }
function portal(tree, id) { return nodes(tree, node => node.type === "memo-test-portal" && node.props.memoId === id)[0]; }
function textarea(tree) { const found = nodes(tree, node => node.type === "textarea")[0]; assert.ok(found, "Expected an expanded memo editor"); return found; }

function harness({ storage = memoryStorage(), api = {}, role = "owner", acquire = () => 7, layout = "side" } = {}) {
  const values = [], slots = [], effectJobs = [], observers = [], calls = [], highlights = [], visibility = [];
  let cursor = 0, writes = 0, savedCount = 0;
  const rails = { left: { name: "left", clientHeight: 600 }, right: { name: "right", clientHeight: 600 }, mobile: { name: "mobile", clientHeight: 360 } };
  const workspace = { dataset: { memoLayout: layout }, querySelector: selector => rails[/data-memo-rail="(left|right|mobile)"/.exec(selector)?.[1]], querySelectorAll: () => [], getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 700 }) };
  const reader = { querySelector: () => workspace };
  const root = { closest: () => reader };
  const oldGlobals = { window: globalThis.window, MutationObserver: globalThis.MutationObserver, ResizeObserver: globalThis.ResizeObserver };
  globalThis.window = { localStorage: storage, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout, confirm: () => true };
  globalThis.MutationObserver = class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() {} };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const hooks = { ...React,
    useState(initial) { const index = cursor++; if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial; return [values[index], next => { writes++; values[index] = typeof next === "function" ? next(values[index]) : next; }]; },
    useRef(initial) { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    useCallback(callback, deps) { const index = cursor++; if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) slots[index] = { deps, callback }; return slots[index].callback; },
    useEffect(effect, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) { const next = { deps, cleanup: old?.cleanup }; slots[index] = next; effectJobs.push(() => { old?.cleanup?.(); next.cleanup = effect(); }); } },
  };
  const implementation = {
    getNoteBlocks: async () => ({ items: originalBlocks(), note_blocks_revision: "blocks-1" }),
    updateNoteBlock: async (_paperId, id, draft) => ({ block: { ...draft, id, paper_id: "paper-1" }, note_blocks_revision: "blocks-2" }),
    createNoteBlock: async (_paperId, draft) => ({ block: { ...draft, id: "memo-new", paper_id: "paper-1" }, note_blocks_revision: "blocks-2" }),
    ...api,
  };
  const client = Object.fromEntries(Object.entries(implementation).map(([name, fn]) => [name, (...args) => { calls.push({ name, args }); return fn(...args); }]));
  const source = readFileSync(new URL("../app/components/ReaderFloatingMemos.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name.endsWith(".css")) return {};
    if (name === "react") return hooks;
    if (name === "react-dom") return { createPortal: (child, target, id) => React.createElement("memo-test-portal", { target: target.name, memoId: id, key: id }, child) };
    if (name.endsWith("/api/client")) return { ApiClientError, apiClient: client, getWorkspaceMode: () => "cloud", getWorkspaceRole: () => role };
    if (name.endsWith("/LocaleProvider")) return { useI18n: () => ({ locale: "en" }) };
    if (name === "./SaveStatus") return { SaveStatus: () => null };
    if (name === "./ReaderMemoConnections") return { ReaderMemoConnections: () => null };
    if (name.startsWith("../lib/") && name.endsWith(".mjs")) return require(`../app/lib/${name.slice("../lib/".length)}`);
    return require(name);
  }, compiledModule, compiledModule.exports);
  const props = { paperId: "paper-1", selection: null, refreshToken: 0, mutationBusy: false, acquireMutation: acquire, releaseMutation: token => calls.push({ name: "releaseMutation", args: [token] }), onSaved: () => savedCount++, onHighlights: next => highlights.push(next), onJumpToPage() {}, onVisibilityChange: next => visibility.push(next) };
  return {
    storage, calls, props, get savedCount() { return savedCount; }, get writes() { return writes; },
    render() { cursor = 0; const tree = compiledModule.exports.ReaderFloatingMemos(props); tree.props.ref.current = root; effectJobs.splice(0).forEach(effect => effect()); return tree; },
    async mount() { this.render(); await settle(); this.render(); await settle(); return this.render(); },
    setLayout(next) { workspace.dataset.memoLayout = next; observers.forEach(observer => observer.callback()); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); Object.assign(globalThis, oldGlobals); },
  };
}

test("saved post-its coexist in side portals and reflow to one bottom rail without creating note writes", async () => {
  const ui = harness(); let tree = await ui.mount();
  assert.equal(portal(tree, "memo-1").props.target, "left"); assert.equal(portal(tree, "memo-2").props.target, "right");
  assert.match(textOf(portal(tree, "memo-1")), /First saved interpretation/); assert.match(textOf(portal(tree, "memo-2")), /Second saved interpretation/);
  ui.setLayout("bottom"); tree = ui.render();
  assert.equal(portal(tree, "memo-1").props.target, "mobile"); assert.equal(portal(tree, "memo-2").props.target, "mobile");
  assert.ok(ui.calls.every(call => call.name === "getNoteBlocks")); ui.unmount();
});

test("viewer can hide a post-it and toggle all while retaining the individual choice across remount", async () => {
  const storage = memoryStorage(), ui = harness({ role: "viewer", storage }); let tree = await ui.mount();
  const hide = nodes(portal(tree, "memo-1"), node => node.type === "button" && node.props["aria-label"] === "Hide memo and keep content")[0];
  assert.equal(hide.props.disabled, undefined); hide.props.onClick(); tree = ui.render(); assert.equal(portal(tree, "memo-1"), undefined);
  button(tree, "Hide all memos").props.onClick(); tree = ui.render(); assert.equal(nodes(tree, node => node.type === "memo-test-portal").length, 0);
  button(tree, "Show memos").props.onClick(); tree = ui.render(); assert.equal(portal(tree, "memo-1"), undefined); assert.ok(portal(tree, "memo-2"));
  assert.deepEqual(readMemoVisibility(storage, "paper-1").value, { version: 1, hiddenAll: false, hiddenIds: ["memo-1"] });
  assert.ok(ui.calls.every(call => call.name === "getNoteBlocks")); ui.unmount();
  const restored = harness({ role: "viewer", storage }); tree = await restored.mount(); assert.equal(portal(tree, "memo-1"), undefined); assert.ok(portal(tree, "memo-2")); restored.unmount();
});

test("switching cards keeps each unsaved interpretation even when local storage is full", async () => {
  const ui = harness({ storage: memoryStorage({ blocked: true }) }); let tree = await ui.mount();
  button(portal(tree, "memo-1"), "Edit").props.onClick(); tree = ui.render(); textarea(tree).props.onChange({ target: { value: "First local draft despite full storage" } }); tree = ui.render();
  button(portal(tree, "memo-2"), "Edit").props.onClick(); tree = ui.render(); textarea(tree).props.onChange({ target: { value: "Second local draft" } }); tree = ui.render();
  assert.match(textOf(portal(tree, "memo-1")), /First local draft despite full storage/);
  button(portal(tree, "memo-1"), "Edit").props.onClick(); tree = ui.render(); assert.equal(textarea(tree).props.value, "First local draft despite full storage");
  assert.ok(ui.calls.every(call => call.name === "getNoteBlocks")); ui.unmount();
});

test("an unsaved new post-it stays visible and editable when another saved memo is opened", async () => {
  const ui = harness(); let tree = await ui.mount();
  button(tree, "New sticky note").props.onClick(); tree = ui.render(); textarea(tree).props.onChange({ target: { value: "New research idea awaiting an explicit save" } }); tree = ui.render();
  button(portal(tree, "memo-1"), "Edit").props.onClick(); tree = ui.render();
  assert.ok(portal(tree, "draft:new")); assert.match(textOf(portal(tree, "draft:new")), /New research idea awaiting an explicit save/);
  button(portal(tree, "draft:new"), "Edit").props.onClick(); tree = ui.render(); assert.equal(textarea(tree).props.value, "New research idea awaiting an explicit save");
  assert.equal(decodeFloatingMemo(JSON.parse(ui.storage.getItem(draftKey())).draft.text).text, "New research idea awaiting an explicit save");
  assert.ok(ui.calls.every(call => call.name === "getNoteBlocks")); ui.unmount();
});

test("edits typed during a save remain the current draft while the acknowledged snapshot becomes its baseline", async () => {
  const pending = deferred(); let submitted;
  const ui = harness({ api: { updateNoteBlock: (_paperId, id, draft) => { submitted = { ...draft, id, paper_id: "paper-1" }; return pending.promise; } } }); let tree = await ui.mount();
  button(portal(tree, "memo-1"), "Edit").props.onClick(); tree = ui.render(); textarea(tree).props.onChange({ target: { value: "Submitted snapshot" } }); tree = ui.render(); button(portal(tree, "memo-1"), "Save").props.onClick(); tree = ui.render(); textarea(tree).props.onChange({ target: { value: "Newer typing during save" } });
  pending.resolve({ block: submitted, note_blocks_revision: "blocks-2" }); await settle(); tree = ui.render();
  assert.equal(textarea(tree).props.value, "Newer typing during save");
  const persisted = JSON.parse(ui.storage.getItem(draftKey("memo-1")));
  assert.equal(decodeFloatingMemo(persisted.draft.text).text, "Newer typing during save"); assert.equal(decodeFloatingMemo(persisted.baseline.text).text, "Submitted snapshot"); assert.equal(persisted.revision, "blocks-2");
  assert.equal(ui.savedCount, 1); assert.equal(ui.calls.filter(call => call.name === "releaseMutation").length, 1); ui.unmount();
});

test("typing during a conflict lookup survives beside the latest remote version", async () => {
  const lookup = deferred(); let loads = 0;
  const remote = { ...originalBlocks()[0], text: encodeFloatingMemo("Remote interpretation", { x: 0, y: .1 }) };
  const ui = harness({ api: { getNoteBlocks: () => ++loads === 1 ? Promise.resolve({ items: originalBlocks(), note_blocks_revision: "blocks-1" }) : lookup.promise, updateNoteBlock: async () => { throw new ApiClientError("changed elsewhere", "conflict"); } } }); let tree = await ui.mount();
  button(portal(tree, "memo-1"), "Edit").props.onClick(); tree = ui.render(); textarea(tree).props.onChange({ target: { value: "Before conflict" } }); tree = ui.render(); button(portal(tree, "memo-1"), "Save").props.onClick(); await settle(); tree = ui.render(); textarea(tree).props.onChange({ target: { value: "Typed while remote conflict loaded" } });
  lookup.resolve({ items: [remote, originalBlocks()[1]], note_blocks_revision: "blocks-2" }); await settle(); tree = ui.render();
  assert.equal(textarea(tree).props.value, "Typed while remote conflict loaded");
  const persisted = JSON.parse(ui.storage.getItem(draftKey("memo-1")));
  assert.equal(decodeFloatingMemo(persisted.draft.text).text, "Typed while remote conflict loaded"); assert.equal(decodeFloatingMemo(persisted.remote.text).text, "Remote interpretation");
  assert.match(textOf(tree), /Changed elsewhere/); assert.equal(ui.savedCount, 0); ui.unmount();
});

test("hiding a new memo during save follows its saved identity without discarding newer typing", async () => {
  const pending = deferred(); let submitted;
  const ui = harness({ api: { createNoteBlock: (_paperId, draft) => { submitted = { ...draft, id: "memo-new", paper_id: "paper-1" }; return pending.promise; } } }); let tree = await ui.mount();
  button(tree, "New sticky note").props.onClick(); tree = ui.render(); textarea(tree).props.onChange({ target: { value: "New memo submitted snapshot" } }); tree = ui.render(); button(portal(tree, "draft:new"), "Save").props.onClick(); tree = ui.render(); textarea(tree).props.onChange({ target: { value: "Newer hidden draft" } }); tree = ui.render();
  nodes(portal(tree, "draft:new"), node => node.type === "button" && node.props["aria-label"] === "Hide memo and keep content")[0].props.onClick();
  pending.resolve({ block: submitted, note_blocks_revision: "blocks-2" }); await settle(); tree = ui.render();
  assert.equal(portal(tree, "draft:new"), undefined); assert.equal(portal(tree, "memo-new"), undefined);
  assert.deepEqual(readMemoVisibility(ui.storage, "paper-1").value.hiddenIds, ["memo-new"]);
  assert.equal(ui.storage.getItem(draftKey()), null);
  const retained = JSON.parse(ui.storage.getItem(draftKey("memo-new")));
  assert.equal(decodeFloatingMemo(retained.draft.text).text, "Newer hidden draft"); assert.equal(decodeFloatingMemo(retained.baseline.text).text, "New memo submitted snapshot");
  assert.equal(ui.savedCount, 1); ui.unmount();
});

test("a denied shared mutation gate leaves the memo draft unsaved and does not call the API", async () => {
  const ui = harness({ acquire: () => null }); let tree = await ui.mount();
  button(portal(tree, "memo-1"), "Edit").props.onClick(); tree = ui.render(); textarea(tree).props.onChange({ target: { value: "Retained while another mutation is active" } }); tree = ui.render(); button(portal(tree, "memo-1"), "Save").props.onClick(); await settle(); tree = ui.render();
  assert.equal(textarea(tree).props.value, "Retained while another mutation is active"); assert.ok(ui.calls.every(call => call.name === "getNoteBlocks"));
  const persisted = JSON.parse(ui.storage.getItem(draftKey("memo-1"))); assert.equal(decodeFloatingMemo(persisted.draft.text).text, "Retained while another mutation is active"); ui.unmount();
});
