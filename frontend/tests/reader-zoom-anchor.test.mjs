import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/components/PdfJsReader.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const settle = () => new Promise(resolve => setImmediate(resolve));
function nodes(tree, predicate) {
  const found = [];
  function visit(value) { if (Array.isArray(value)) return value.forEach(visit); if (!value || typeof value !== "object") return; if (predicate(value)) found.push(value); visit(value.props?.children); }
  visit(tree); return found;
}
function storage() { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; }
// Exercise real Reader handlers, hooks/effects, DOM geometry reads and RAF
// cleanup. Page surfaces use their committed JSX zoom and a 600x800 test PDF.
// Canvas rendering and actual browser scroll anchoring are verified separately.
function harness() {
  let cursor = 0, dirty = true, tree, mounted = true, frames = new Map(), nextFrame = 0, loads = 0;
  const values = [], slots = [], jobs = [], listeners = new Map(), pages = new Map(), resizeObservers = [];
  const old = { window: globalThis.window, ResizeObserver: globalThis.ResizeObserver };
  const viewport = {
    clientWidth: 768, clientHeight: 600, scrollTop: 0,
    getBoundingClientRect: () => ({ top: 100, bottom: 700, height: 600 }),
    querySelector: selector => pages.get(Number(selector.match(/(\d+)$/)?.[1])) ?? null,
    querySelectorAll: () => [...pages.values()],
    addEventListener: (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener: (name, fn) => listeners.get(name)?.delete(fn),
    scrollTo({ top }) { this.scrollTop = top; },
  };
  const workspace = { clientWidth: 800 };
  const win = { localStorage: storage(), sessionStorage: storage(), requestAnimationFrame: callback => { const id = ++nextFrame; frames.set(id, callback); return id; }, cancelAnimationFrame: id => frames.delete(id), addEventListener() {}, removeEventListener() {} };
  globalThis.window = win;
  globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback; resizeObservers.push(this); } observe(target) { this.target = target; } disconnect() { this.target = null; } };
  const hooks = { ...React,
    useState(initial) { const id = cursor++; if (!(id in values)) values[id] = typeof initial === "function" ? initial() : initial; return [values[id], next => { assert.ok(mounted, "No state write after unmount"); const value = typeof next === "function" ? next(values[id]) : next; if (!Object.is(value, values[id])) { values[id] = value; dirty = true; } }]; },
    useRef(initial) { const id = cursor++; if (!(id in values)) values[id] = { current: initial }; return values[id]; },
    useMemo(callback, deps) { const id = cursor++, old = slots[id]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) slots[id] = { deps, value: callback() }; return slots[id].value; },
    useEffect(callback, deps) { const id = cursor++, old = slots[id]; if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps[i]))) { const next = { deps, cleanup: old?.cleanup }; slots[id] = next; jobs.push(() => { old?.cleanup?.(); next.cleanup = callback(); }); } },
  };
  hooks.useCallback = (callback, deps) => hooks.useMemo(() => callback, deps);
  const component = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "react") return hooks;
    if (name.endsWith(".css")) return {};
    if (name.endsWith("/api/client")) return { paperPdfUrl: id => `/pdf/${id}` };
    if (name.endsWith("/pdfjs-adapter")) return { createPdfLoadingTask: async () => { loads++; return { promise: Promise.resolve({ numPages: 10, getPage: async () => ({ getViewport: () => ({ width: 600, height: 800 }) }), destroy() {} }), destroy() {} }; }, readPdfNetworkDiagnostics: () => ({}) };
    if (name.endsWith("/LocaleProvider")) return { useI18n: () => ({ locale: "en", t: (text, vars) => text.replace(/\{(\w+)\}/g, (_match, key) => String(vars?.[key] ?? key)) }) };
    if (name === "./ReaderPdfDownload") return { ReaderPdfDownload: () => null };
    if (name.startsWith("../lib/") && name.endsWith(".mjs")) return require(`../app/lib/${name.slice("../lib/".length)}`);
    return require(name);
  }, component, component.exports);
  let capture;
  const props = { paperId: "paper-a", onCaptureLayoutAnchor: callback => { capture = callback; } }; let viewportRef;
  function commit() {
    nodes(tree, node => node.props?.className === "reader-document-workspace")[0].props.ref.current = workspace;
    const viewportNode = nodes(tree, node => node.props?.className === "reader-canvas-viewport")[0];
    if (viewportRef !== viewportNode.props.ref) { viewportRef?.(null); viewportRef = viewportNode.props.ref; viewportRef(viewport); }
    pages.clear();
    for (const node of nodes(tree, node => typeof node.type === "function" && node.type.name === "ContinuousPdfPage")) {
      const { pageNumber, zoom } = node.props;
      pages.set(pageNumber, { dataset: { pageNumber: String(pageNumber) }, getBoundingClientRect: () => ({ top: 100 + 24 + (pageNumber - 1) * (800 * zoom + 16) - viewport.scrollTop, bottom: 100 + 24 + (pageNumber - 1) * (800 * zoom + 16) + 800 * zoom - viewport.scrollTop, height: 800 * zoom }) });
    }
    jobs.splice(0).forEach(job => job());
  }
  const ui = {
    props, viewport, get loads() { return loads; }, get tree() { return tree; }, get pendingFrames() { return frames.size; },
    flush() { for (let pass = 0; pass < 40; pass++) { if (dirty) { dirty = false; cursor = 0; tree = component.exports.PdfJsReader(props); commit(); } if (!dirty && !jobs.length) return tree; } throw new Error("Reader did not settle"); },
    frame() { const due = frames; frames = new Map(); for (const fn of due.values()) fn(); return this.flush(); },
    frames() { for (let pass = 0; frames.size && pass < 20; pass++) this.frame(); assert.equal(frames.size, 0); },
    async mount() { this.flush(); await settle(); this.flush(); await settle(); this.flush(); this.frames(); this.rendered(); return this; },
    rendered() { for (const node of nodes(tree, node => typeof node.type === "function" && node.type.name === "ContinuousPdfPage")) node.props.onRendered(node.props.pageNumber, 1); this.flush(); },
    click(label, { frame = true } = {}) { const button = nodes(tree, node => node.type === "button" && node.props["aria-label"] === label)[0]; assert.ok(button, label); assert.ok(!button.props.disabled, `${label} should be enabled`); button.props.onClick(); this.flush(); if (frame) this.frames(); },
    position(page = 6, relative = .63) { const rect = pages.get(page).getBoundingClientRect(); viewport.scrollTop += rect.top - 100 + rect.height * relative - viewport.clientHeight / 2; this.scroll(); this.frames(); this.rendered(); },
    scroll() { for (const fn of listeners.get("scroll") || []) fn(); },
    anchor() { const center = 100 + viewport.clientHeight / 2; for (const [page, element] of pages) { const rect = element.getBoundingClientRect(); if (rect.top <= center && rect.bottom >= center) return { page, relative: (center - rect.top) / rect.height }; } return null; },
    zoom() { return nodes(tree, node => typeof node.type === "function" && node.type.name === "ContinuousPdfPage")[0].props.zoom; },
    changeProps(next) { Object.assign(props, next); dirty = true; this.flush(); },
    capture() { capture?.(); },
    resize() { for (const observer of resizeObservers) if (observer.target) observer.callback(); this.flush(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); viewportRef?.(null); mounted = false; Object.assign(globalThis, old); },
  }; return ui;
}
function sameAnchor(ui, expected) { const actual = ui.anchor(); assert.equal(actual?.page, expected.page); assert.ok(Math.abs(actual.relative - expected.relative) < 1e-9, JSON.stringify({ actual, expected })); }
for (const label of ["Zoom in", "Zoom out", "Set manual zoom to 100 percent"]) {
  test(`${label} preserves the paragraph in the viewport center`, async t => { const ui = harness(); t.after(() => ui.unmount()); await ui.mount(); ui.position(); const anchor = ui.anchor(); ui.click(label); sameAnchor(ui, anchor); assert.equal(ui.loads, 1, "Zoom must not reload the PDF"); });
}
test("repeated manual zoom and fit-width switches retain the same source position", async t => {
  const ui = harness(); t.after(() => ui.unmount()); await ui.mount(); ui.position(7, .42); const anchor = ui.anchor();
  for (const label of ["Zoom in", "Zoom in", "Zoom out", "Fit PDF to available width", "Set manual zoom to 100 percent", "Zoom in", "Fit PDF to available width"]) { ui.click(label); sameAnchor(ui, anchor); ui.rendered(); } assert.equal(ui.loads, 1);
});
test("rapid zoom clicks retain the first anchor until the final geometry commits", async t => {
  const ui = harness(); t.after(() => ui.unmount()); await ui.mount(); ui.position(); const anchor = ui.anchor();
  ui.click("Zoom in", { frame: false }); ui.scroll(); ui.click("Zoom in", { frame: false }); ui.click("Zoom out", { frame: false }); ui.frames(); sameAnchor(ui, anchor); assert.equal(ui.loads, 1);
});
test("an explicit fit-page destination wins over intermediate manual and fit-width anchors", async t => {
  const ui = harness(); t.after(() => ui.unmount()); await ui.mount(); ui.position();
  ui.click("Fit PDF page to available space", { frame: false }); ui.click("Zoom in", { frame: false }); ui.click("Fit PDF to available width", { frame: false }); ui.frames();
  assert.equal(ui.anchor().page, 6);
  assert.equal(ui.viewport.querySelector("#pdf-page-6").getBoundingClientRect().top, ui.viewport.getBoundingClientRect().top);
  assert.equal(ui.loads, 1);
});

test("explicit fit-page after a scrolled manual zoom reveals the whole current page", async t => {
  const ui = harness(); t.after(() => ui.unmount()); await ui.mount();
  ui.click("Set manual zoom to 100 percent"); ui.position(7, .8);
  const viewportTop = ui.viewport.getBoundingClientRect().top;
  assert.ok(ui.viewport.querySelector("#pdf-page-7").getBoundingClientRect().top < viewportTop, "Fixture starts with the page top clipped");
  ui.click("Fit PDF page to available space");
  const page = ui.viewport.querySelector("#pdf-page-7").getBoundingClientRect();
  assert.equal(page.top, viewportTop, "An explicit whole-page command aligns the current page top");
  assert.ok(page.bottom <= viewportTop + ui.viewport.clientHeight);
  assert.ok(600 * ui.zoom() <= ui.viewport.clientWidth - 48);
  assert.equal(ui.anchor().page, 7); assert.equal(ui.loads, 1);
  ui.rendered(); ui.frames();
  assert.equal(ui.viewport.querySelector("#pdf-page-7").getBoundingClientRect().top, viewportTop, "Late canvas completion cannot restore the clipped anchor");
});

test("reselecting fit-page realigns a scrolled page even when its zoom does not change", async t => {
  const ui = harness(); t.after(() => ui.unmount()); await ui.mount();
  ui.click("Fit PDF page to available space"); const zoom = ui.zoom(); ui.position(5, .75);
  assert.equal(nodes(ui.tree, node => node.props?.className === "reader-render-progress").length, 0, "Fixture has finished rendering");
  ui.click("Fit PDF page to available space");
  assert.equal(ui.zoom(), zoom);
  const page = ui.viewport.querySelector("#pdf-page-5").getBoundingClientRect(), viewportTop = ui.viewport.getBoundingClientRect().top;
  assert.equal(page.top, viewportTop); assert.ok(page.bottom <= viewportTop + ui.viewport.clientHeight);
  assert.equal(nodes(ui.tree, node => node.props?.className === "reader-render-progress").length, 0, "Same-scale realignment must not wait for a render that will never start");
  assert.equal(ui.loads, 1);
});
test("an explicit page jump supersedes a pending zoom anchor", async t => {
  const ui = harness(); t.after(() => ui.unmount()); await ui.mount(); ui.position(); ui.click("Zoom in", { frame: false }); ui.changeProps({ pageJump: { page: 3, token: 1 } }); ui.frames();
  const anchor = ui.anchor(); assert.equal(anchor.page, 3); assert.ok(anchor.relative < .3); ui.rendered(); assert.equal(ui.anchor().page, 3, "Late renders cannot restore the old page");
});
test("zoom while a page jump is queued keeps the deliberate page destination", async t => {
  const ui = harness(); t.after(() => ui.unmount()); await ui.mount(); ui.position(); ui.changeProps({ pageJump: { page: 3, token: 1 } }); ui.click("Zoom in", { frame: false }); ui.frames(); assert.equal(ui.anchor().page, 3); assert.ok(ui.anchor().relative < .3);
});
test("same-scale mode changes do not fabricate a render or leave a stale anchor", async t => {
  const ui = harness(); t.after(() => ui.unmount()); await ui.mount(); ui.position(); ui.click("Set manual zoom to 100 percent"); ui.rendered();
  ui.viewport.clientWidth = 648; ui.click("Fit PDF to available width"); ui.click("Set manual zoom to 100 percent"); assert.equal(ui.zoom(), 1); assert.equal(nodes(ui.tree, node => node.props?.className === "reader-render-progress").length, 0);
  ui.position(4, .55); const anchor = ui.anchor(); ui.click("Zoom in"); sameAnchor(ui, anchor);
});
test("paper changes discard pending anchors and page-jump frames", async t => {
  const ui = harness(); t.after(() => ui.unmount()); await ui.mount(); ui.position(); ui.click("Zoom in", { frame: false }); ui.changeProps({ paperId: "paper-b" }); await settle(); ui.flush(); await settle(); ui.flush(); ui.frames(); assert.equal(ui.loads, 2); assert.equal(ui.anchor().page, 1);
});
test("unmount cancels pending anchor restoration and explicit navigation", async () => {
  const ui = harness(); await ui.mount(); ui.position(); ui.click("Zoom in", { frame: false }); ui.changeProps({ pageJump: { page: 4, token: 1 } }); const before = ui.viewport.scrollTop; ui.unmount(); assert.equal(ui.pendingFrames, 0); assert.equal(ui.viewport.scrollTop, before);
});

for (const mode of ["fit-width", "fit-page", "manual"]) {
  test(`${mode} preserves its anchor when memo layout precedes ResizeObserver`, async t => {
    const ui = harness(); t.after(() => ui.unmount()); await ui.mount();
    if (mode === "fit-page") ui.click("Fit PDF page to available space");
    if (mode === "manual") ui.click("Set manual zoom to 100 percent");
    ui.position(5, .55); const anchor = ui.anchor();
    ui.capture(); ui.viewport.clientWidth = 568; ui.viewport.clientHeight = 420;
    ui.changeProps({ memoRailsVisible: true }); ui.frame(); ui.resize(); ui.frames(); sameAnchor(ui, anchor);
    ui.capture(); ui.viewport.clientWidth = 768; ui.viewport.clientHeight = 600;
    ui.changeProps({ memoRailsVisible: false }); ui.frame(); ui.resize(); ui.frames(); sameAnchor(ui, anchor);
    assert.equal(ui.loads, 1);
  });
}

test("a stale canvas completion cannot consume the anchor between rapid zooms", async t => {
  const ui = harness(); t.after(() => ui.unmount()); await ui.mount(); ui.position(); const anchor = ui.anchor();
  ui.click("Zoom in", { frame: false }); ui.rendered(); ui.click("Zoom in", { frame: false }); ui.frames(); sameAnchor(ui, anchor);
});

test("manual zoom limits keep the same paragraph and disable only the exhausted direction", async t => {
  const ui = harness(); t.after(() => ui.unmount()); await ui.mount(); ui.position(5, .5); const anchor = ui.anchor();
  const disabled = label => nodes(ui.tree, node => node.type === "button" && node.props["aria-label"] === label)[0].props.disabled;
  for (let i = 0; i < 20 && !disabled("Zoom in"); i++) { ui.click("Zoom in"); sameAnchor(ui, anchor); }
  assert.equal(ui.zoom(), 3); assert.ok(disabled("Zoom in")); assert.ok(!disabled("Zoom out"));
  for (let i = 0; i < 20 && !disabled("Zoom out"); i++) { ui.click("Zoom out"); sameAnchor(ui, anchor); }
  assert.equal(ui.zoom(), .1); assert.ok(disabled("Zoom out")); assert.ok(!disabled("Zoom in"));
});

test("a later explicit navigation replaces an earlier queued page jump", async t => {
  const ui = harness(); t.after(() => ui.unmount()); await ui.mount(); ui.position();
  ui.changeProps({ pageJump: { page: 3, token: 1 } }); ui.changeProps({ pageJump: { page: 8, token: 2 } }); ui.frames(); assert.equal(ui.anchor().page, 8);
});
