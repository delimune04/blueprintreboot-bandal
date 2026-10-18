import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { computeMemoConnector, memoSideFromPosition } from "../app/lib/reader/memo-layout.mjs";

const require = createRequire(import.meta.url);
const rectangle = { x: 0.1, y: 0.2, width: 0.2, height: 0.02 };
const base = { noteRect: { left: 20, top: 100, width: 220, height: 150 }, pageRect: { left: 300, top: 50, width: 600, height: 900 }, viewportRect: { left: 280, top: 40, width: 700, height: 700 }, rectangles: [rectangle], side: "left", windowWidth: 1400, windowHeight: 1000 };

test("legacy normalized memo X positions select a real side without rewriting stored positions", () => {
  assert.equal(memoSideFromPosition({ x: 0, y: 1 }), "left"); assert.equal(memoSideFromPosition({ x: 0.49, y: 0 }), "left");
  assert.equal(memoSideFromPosition({ x: 0.5, y: 0 }), "right"); assert.equal(memoSideFromPosition({ x: 1, y: 1 }), "right");
  assert.equal(memoSideFromPosition(), "right"); assert.equal(memoSideFromPosition({ x: NaN }), "right");
});

test("connector measures note inner edges and the exact normalized provenance center in viewport pixels", () => {
  const left = computeMemoConnector(base);
  assert.deepEqual(left.start, { x: 240, y: 175 }); assert.deepEqual(left.end, { x: 420, y: 239 }); assert.match(left.path, /^M 240 175 C /);
  const right = computeMemoConnector({ ...base, side: "right", noteRect: { left: 1040, top: 100, width: 220, height: 150 } });
  assert.deepEqual(right.start, { x: 1040, y: 175 }); assert.deepEqual(right.end, left.end);
  const zoomed = computeMemoConnector({ ...base, pageRect: { ...base.pageRect, width: 1200, height: 1800 } });
  assert.deepEqual(zoomed.end, { x: 540, y: 428 });
});

test("scrolling or clipping the actual selected source out of the PDF viewport removes its connector", () => {
  assert.equal(computeMemoConnector({ ...base, pageRect: { ...base.pageRect, top: -800 } }), null);
  assert.equal(computeMemoConnector({ ...base, viewportRect: { ...base.viewportRect, height: 100 } }), null);
  assert.equal(computeMemoConnector({ ...base, viewportRect: { ...base.viewportRect, left: 500, width: 400 } }), null);
  assert.equal(computeMemoConnector({ ...base, windowHeight: 200 }), null, "memo is partially offscreen");
  assert.equal(computeMemoConnector({ ...base, noteClipRect: { left: 0, top: 0, width: 260, height: 200 } }), null, "memo clipped by its scroll rail");
  const multiple = computeMemoConnector({ ...base, rectangles: [{ ...rectangle, y: 0.9 }, rectangle] });
  assert.deepEqual(multiple.end, { x: 420, y: 239 }, "an offscreen first rectangle never substitutes the wrong visible location");
});

test("malformed, missing, overlapping and mobile geometry never invents a source anchor", () => {
  for (const changes of [{ rectangles: [] }, { rectangles: [{ ...rectangle, width: -1 }] }, { rectangles: [{ ...rectangle, x: 0.95 }] }, { pageRect: { ...base.pageRect, width: 0 } }, { noteRect: { ...base.noteRect, top: NaN } }, { side: "mobile" }, { noteRect: { ...base.noteRect, left: 700 } }]) assert.equal(computeMemoConnector({ ...base, ...changes }), null, JSON.stringify(changes));
});

function closestDataset(element, field) {
  if (!element) return null;
  return element.dataset?.[field] !== undefined ? element : closestDataset(element.parentElement, field);
}
function element(rect, dataset = {}, parent = null) {
  return {
    dataset, parentElement: parent, isConnected: true, hidden: false, style: {},
    clientLeft: 0, clientTop: 0, clientWidth: rect.width, clientHeight: rect.height,
    getBoundingClientRect() { return this.rect; }, rect,
    getClientRects() { return this.hidden ? [] : [this.rect]; },
    getAttribute(name) { if (name === "aria-hidden") return this.ariaHidden || null; return null; },
    querySelector() { return null; },
    closest(selector) { return closestDataset(this, selector.includes("data-memo-rail") ? "memoRail" : "memoPaperId"); },
  };
}
function harness() {
  const values = [], pendingEffects = [], cleanups = []; let cursor = 0;
  const hooks = { ...React,
    useId() { cursor++; return ":test-memo:"; },
    useRef(initial) { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    useState(initial) { const index = cursor++; if (!(index in values)) values[index] = initial; return [values[index], next => { values[index] = typeof next === "function" ? next(values[index]) : next; }]; },
    useEffect(callback, dependencies) { const index = cursor++; const previous = values[index]; if (!previous || dependencies.some((value, i) => value !== previous[i])) { values[index] = dependencies; pendingEffects.push(() => { cleanups[index]?.(); cleanups[index] = callback(); }); } },
  };
  const frames = new Map(); let frameId = 0;
  const window = Object.assign(new EventTarget(), { innerWidth: 1400, innerHeight: 1000, requestAnimationFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; }, cancelAnimationFrame(id) { frames.delete(id); }, visualViewport: new EventTarget() });
  const document = Object.assign(new EventTarget(), { body: {}, querySelectorAll() { return [otherWorkspace, workspace]; } });
  const workspace = element({ left: 0, top: 40, width: 1400, height: 700 }, { memoPaperId: "paper-a" });
  const otherWorkspace = element({ left: 0, top: 40, width: 1400, height: 700 }, { memoPaperId: "paper-b" });
  const viewport = element(base.viewportRect, {}, workspace);
  const rail = element({ left: 0, top: 40, width: 260, height: 700 }, { memoRail: "left" }, workspace);
  rail.style.overflow = "auto";
  const note = element(base.noteRect, { memoConnectorId: "memo-one" }, rail);
  const header = element({ ...base.noteRect, height: 34 }, {}, note);
  note.querySelector = selector => selector === ".reader-sticky-note__header" ? header : null;
  const page = element(base.pageRect, { pageNumber: "1" }, viewport);
  const foreign = element(base.noteRect, { memoConnectorId: "foreign", memoPaperId: "paper-b" }, rail);
  let pages = [page], notes = [foreign, note];
  workspace.querySelector = () => viewport; workspace.querySelectorAll = () => notes;
  otherWorkspace.querySelector = () => { throw new Error("Must not read another paper's pages"); };
  viewport.querySelectorAll = () => pages;
  const resizeObservers = [], mutationObservers = [];
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.elements = new Set(); resizeObservers.push(this); }
    observe(value) { this.elements.add(value); } unobserve(value) { this.elements.delete(value); } disconnect() { this.disconnected = true; this.elements.clear(); }
  }
  class MutationObserver {
    constructor(callback) { this.callback = callback; mutationObservers.push(this); }
    observe(node, options) { this.node = node; this.options = options; this.disconnected = false; } disconnect() { this.disconnected = true; }
  }
  const output = ts.transpileModule(readFileSync(new URL("../app/components/ReaderMemoConnections.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiledModule = { exports: {} };
  const localRequire = name => name === "react" ? hooks : name === "react-dom" ? { createPortal: child => child } : name.includes("memo-layout.mjs") ? require("../app/lib/reader/memo-layout.mjs") : require(name);
  new Function("require", "module", "exports", "window", "document", "getComputedStyle", "ResizeObserver", "MutationObserver", output)(localRequire, compiledModule, compiledModule.exports, window, document, node => node.style, ResizeObserver, MutationObserver);
  const source = { source: "pdf_selection", page: 1, coordinate_space: "page-normalized", rectangles: [rectangle], quote: "Exact highlighted source" };
  const items = [{ id: "memo-one", provenance: source }, { id: "foreign", provenance: source }];
  return {
    render(changes = {}) { cursor = 0; return compiledModule.exports.ReaderMemoConnections({ paperId: "paper-a", items, visible: true, ...changes }); },
    effects() { pendingEffects.splice(0).forEach(callback => callback()); },
    flush() { const batch = [...frames.values()]; frames.clear(); batch.forEach(callback => callback()); },
    unmount() { cleanups.forEach(cleanup => cleanup?.()); },
    window, document, note, header, page, rail, viewport, workspace, resizeObservers, mutationObservers, frames, items,
    setPages(next) { pages = next; }, setNotes(next) { notes = next; },
  };
}

test("overlay scopes annotations to one paper and batches scroll, zoom and rail changes without an idle animation loop", () => {
  const h = harness(); assert.equal(h.render(), null); h.effects(); assert.equal(h.frames.size, 1);
  h.document.dispatchEvent(new Event("scroll")); h.window.dispatchEvent(new Event("resize")); assert.equal(h.frames.size, 1);
  h.flush(); let tree = h.render(); let html = renderToStaticMarkup(tree);
  assert.match(html, /aria-hidden="true"/); assert.match(html, /pointer-events:none/); assert.match(html, /data-memo-line-id="memo-one"/); assert.doesNotMatch(html, /data-memo-line-id="foreign"/);
  assert.match(html, /M 240 117 C/); assert.equal(h.frames.size, 0, "measurement schedules no next frame by itself");
  h.page.rect = { ...base.pageRect, width: 1200, height: 1800 }; h.resizeObservers[0].callback(); h.mutationObservers[0].callback(); assert.equal(h.frames.size, 1);
  h.flush(); tree = h.render(); html = renderToStaticMarkup(tree); assert.match(html, /540 428/); assert.equal(h.frames.size, 0);
  h.unmount(); assert.ok(h.resizeObservers[0].disconnected); assert.ok(h.mutationObservers.every(observer => observer.disconnected));
});

test("hidden memos, mobile rails, offscreen sources and native fallback remove lines rather than pointing at stale page positions", () => {
  const h = harness(); h.render(); h.effects(); h.flush(); assert.ok(h.render());
  for (const mutation of [() => { h.note.hidden = true; }, () => { h.note.hidden = false; h.rail.dataset.memoRail = "mobile"; }, () => { h.rail.dataset.memoRail = "left"; h.page.rect = { ...base.pageRect, top: -1000 }; }, () => { h.setPages([]); }]) {
    mutation(); h.document.dispatchEvent(new Event("scroll")); h.flush(); assert.equal(h.render(), null);
  }
  h.unmount();
});

test("paper changes and closing notes cannot briefly reuse old connector geometry, and cleanup cancels queued frames", () => {
  const h = harness(); h.render(); h.effects(); h.flush(); assert.ok(h.render());
  assert.equal(h.render({ paperId: "paper-b" }), null); h.effects(); assert.equal(h.frames.size, 1);
  assert.equal(h.render({ visible: false }), null); h.effects(); assert.equal(h.frames.size, 0);
  h.document.dispatchEvent(new Event("scroll")); assert.equal(h.frames.size, 0); h.unmount();
});

test("fresh item arrays during dragging keep observers subscribed and use DOM layout mutations to move the connector", () => {
  const h = harness(); h.render(); h.effects(); h.flush(); assert.ok(h.render());
  const observer = h.resizeObservers[0];
  for (let movement = 1; movement <= 3; movement++) {
    h.header.rect = { ...h.header.rect, top: 100 + movement * 10 };
    h.render({ items: h.items.map(item => ({ ...item, provenance: { ...item.provenance } })) }); h.effects();
    assert.equal(h.resizeObservers.length, 1); assert.equal(h.mutationObservers.length, 2); assert.ok(!observer.disconnected);
    h.mutationObservers[0].callback(); h.flush();
  }
  assert.match(renderToStaticMarkup(h.render()), /M 240 147 C/); assert.equal(h.frames.size, 0); h.unmount();
});

test("expanded memo bodies may be clipped while their visible headers remain connected; clipped headers remove the arrow", () => {
  const h = harness(); h.note.rect = { ...base.noteRect, height: 1400 }; h.note.clientHeight = 1400;
  h.render(); h.effects(); h.flush(); assert.match(renderToStaticMarkup(h.render()), /M 240 117 C/);
  h.header.rect = { ...h.header.rect, top: 20 }; h.mutationObservers[0].callback(); h.flush();
  assert.equal(h.render(), null, "header is clipped by the rail whose visible top is 40");
  h.header.rect = { ...h.header.rect, top: -5 }; h.document.dispatchEvent(new Event("scroll")); h.flush();
  assert.equal(h.render(), null, "partly offscreen header is not a visible connector anchor"); h.unmount();
});
