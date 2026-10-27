import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { fitPageZoom, fitWidthZoom } from "../app/lib/pdf/reader-controller.mjs";

const require = createRequire(import.meta.url);
const settle = () => new Promise(resolve => setImmediate(resolve));
function nodes(tree, predicate) {
  const result = [];
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    if (predicate(value)) result.push(value);
    visit(value.props?.children);
  }
  visit(tree); return result;
}
function hooksHarness() {
  const values = [], effects = [], jobs = [];
  let cursor = 0, dirty = true, render, commit = () => {}, result;
  const hooks = {
    useState(initial) {
      const id = cursor++;
      if (!(id in values)) values[id] = typeof initial === "function" ? initial() : initial;
      return [values[id], next => {
        const value = typeof next === "function" ? next(values[id]) : next;
        if (!Object.is(value, values[id])) { values[id] = value; dirty = true; }
      }];
    },
    useRef(initial) { const id = cursor++; return values[id] ??= { current: initial }; },
    useMemo(callback, deps) {
      const id = cursor++, old = values[id];
      if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) values[id] = { deps, value: callback() };
      return values[id].value;
    },
    useEffect(callback, deps) {
      const id = cursor++, old = effects[id];
      if (!old || !deps || deps.some((value, index) => !Object.is(value, old.deps[index]))) {
        const next = { deps, cleanup: old?.cleanup }; effects[id] = next;
        jobs.push(() => { old?.cleanup?.(); next.cleanup = callback(); });
      }
    },
  };
  hooks.useCallback = (callback, deps) => hooks.useMemo(() => callback, deps);
  return {
    hooks,
    start(callback, onCommit = () => {}) { render = callback; commit = onCommit; return this.flush(); },
    flush() {
      for (let pass = 0; pass < 50; pass++) {
        if (dirty) { dirty = false; cursor = 0; result = render(); commit(result); }
        jobs.splice(0).forEach(job => job());
        if (!dirty && !jobs.length) return result;
      }
      throw new Error("Reader hooks did not settle");
    },
    rerender() { dirty = true; return this.flush(); },
    unmount() { effects.forEach(effect => effect?.cleanup?.()); },
  };
}
function compile(path, hooks, mocks = {}, expose = []) {
  // Export private components in this in-memory test module only. Production
  // keeps its public component boundary unchanged.
  const source = readFileSync(new URL(path, import.meta.url), "utf8") + (expose.length ? `\nexport { ${expose.join(", ")} };` : "");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "react") return hooks;
    if (name.endsWith(".css")) return {};
    if (name in mocks) return mocks[name];
    if (name.startsWith("../lib/") && name.endsWith(".mjs")) return require(`../app/lib/${name.slice("../lib/".length)}`);
    return require(name);
  }, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
function fakeDocument() {
  const document = { title: "", baseURI: "https://example.invalid/LabVium/", documentElement: { lang: "en", dataset: {} } };
  document.createElement = tag => ({
    tagName: tag, ownerDocument: document, children: [], parentNode: null, dataset: {},
    appendChild(node) { node.remove(); node.parentNode = this; node.ownerDocument = this.ownerDocument; this.children.push(node); return node; },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; },
    cloneNode() { return Object.assign(document.createElement(tag), { href: this.href, textContent: this.textContent }); },
  });
  document.head = document.createElement("head"); document.body = document.createElement("body");
  document.querySelectorAll = () => document.head.children.filter(node => node.tagName === "style" || node.tagName === "link");
  return document;
}
function companionHarness(t, { blocked = false } = {}) {
  const previous = { document: globalThis.document, window: globalThis.window };
  const document = fakeDocument(), slot = document.createElement("div"), timers = new Map(), children = [];
  document.head.appendChild(document.createElement("style"));
  let openCalls = 0;
  globalThis.document = document;
  globalThis.window = {
    focus() {},
    open() {
      openCalls++;
      if (blocked) return null;
      const events = new Map();
      const child = { document: fakeDocument(), closed: false, focuses: 0,
        focus() { this.focuses++; },
        close() { if (this.closed) return; this.closed = true; for (const listener of events.get("pagehide") || []) listener(); },
        addEventListener(name, listener) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(listener); },
        removeEventListener(name, listener) { events.get(name)?.delete(listener); },
      }; children.push(child); return child;
    },
    setInterval(callback) { const id = timers.size + 1; timers.set(id, callback); return id; },
    clearInterval(id) { timers.delete(id); },
  };
  const hooks = hooksHarness(), { useReaderCompanion } = compile("../app/hooks/useReaderCompanion.ts", hooks.hooks);
  let title = "Test paper", locale = "en";
  hooks.start(() => useReaderCompanion(title, locale), value => { value.slot.current = slot; });
  t.after(() => { hooks.unmount(); Object.assign(globalThis, previous); });
  return { hooks, slot, children, timers, get openCalls() { return openCalls; }, value: () => hooks.flush(), changeTitle(nextTitle, nextLocale) { title = nextTitle; locale = nextLocale; return hooks.rerender(); } };
}

test("companion moves one stable host and returns it without a second editor", t => {
  const ui = companionHarness(t), original = ui.value().host;
  const textarea = original.ownerDocument.createElement("textarea"); textarea.value = "Unsaved research draft"; original.appendChild(textarea);
  assert.equal(original.parentNode, ui.slot);
  assert.equal(ui.value().open(), true); assert.equal(ui.value().detached, true);
  const child = ui.children[0];
  assert.equal(ui.value().host, original); assert.equal(original.parentNode, child.document.body);
  assert.equal(ui.slot.children.length, 0);
  assert.equal(child.document.head.children.filter(node => node.tagName === "style").length, 1);
  assert.equal(child.document.head.children.find(node => node.tagName === "base").href, "https://example.invalid/LabVium/");
  ui.value().open(); assert.equal(ui.openCalls, 1, "Repeated open must only focus the existing popup");
  ui.value().attach(); assert.equal(ui.value().detached, false);
  assert.equal(original.parentNode, ui.slot); assert.equal(child.closed, true); assert.equal(ui.timers.size, 0);
  assert.equal(original.children[0], textarea); assert.equal(textarea.value, "Unsaved research draft");
});

test("a blocked popup leaves the existing editor attached and reports a recoverable state", t => {
  const ui = companionHarness(t, { blocked: true }), original = ui.value().host;
  assert.equal(ui.value().open(), false);
  assert.equal(ui.value().blocked, true); assert.equal(ui.value().detached, false);
  assert.equal(original.parentNode, ui.slot); assert.equal(ui.timers.size, 0);
});

test("closing the second window restores its same live host and stops polling", t => {
  const ui = companionHarness(t), original = ui.value().host;
  ui.value().open(); ui.value(); ui.children[0].close();
  assert.equal(ui.value().detached, false); assert.equal(original.parentNode, ui.slot); assert.equal(ui.timers.size, 0);
});

test("companion detects close without pagehide and updates its document title and locale", t => {
  const ui = companionHarness(t), original = ui.value().host;
  ui.value().open(); ui.value();
  ui.changeTitle("새 논문", "ko");
  assert.equal(ui.children[0].document.title, "새 논문 · LabVium"); assert.equal(ui.children[0].document.documentElement.lang, "ko");
  ui.children[0].closed = true;
  for (const callback of ui.timers.values()) callback();
  assert.equal(ui.value().detached, false); assert.equal(original.parentNode, ui.slot); assert.equal(ui.timers.size, 0);
});

test("Reader unmount closes the companion and removes its host and close watcher", t => {
  const ui = companionHarness(t), original = ui.value().host;
  ui.value().open(); ui.value();
  const child = ui.children[0]; ui.hooks.unmount();
  assert.equal(child.closed, true); assert.equal(original.parentNode, null); assert.equal(ui.timers.size, 0);
});

test("fit-page can shrink short, narrow and large-page documents below fifty percent", () => {
  for (const input of [
    { availableWidth: 600, availableHeight: 300, pageWidth: 600, pageHeight: 800 },
    { availableWidth: 300, availableHeight: 600, pageWidth: 612, pageHeight: 792 },
    { availableWidth: 900, availableHeight: 750, pageWidth: 2384, pageHeight: 3370 },
  ]) {
    const zoom = fitPageZoom({ ...input, horizontalPadding: 48, verticalPadding: 48 });
    assert.ok(zoom < .5);
    assert.ok(input.pageWidth * zoom <= input.availableWidth - 48 + 1e-8);
    assert.ok(input.pageHeight * zoom <= input.availableHeight - 48 + 1e-8);
  }
  assert.equal(fitWidthZoom({ availableWidth: 120, pageWidth: 600 }), .2);
});

test("render errors keep zoom usable and expose recovery outside the scrolling page stack", async t => {
  const previous = { window: globalThis.window, ResizeObserver: globalThis.ResizeObserver };
  const memory = new Map(), storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  const frames = new Map(); let frameId = 0, loads = 0;
  globalThis.window = { localStorage: storage, sessionStorage: storage, requestAnimationFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; }, cancelAnimationFrame: id => frames.delete(id), addEventListener() {}, removeEventListener() {} };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const hooks = hooksHarness(), viewport = { clientWidth: 768, clientHeight: 600, scrollTop: 0, querySelectorAll: () => [], querySelector: () => null, getBoundingClientRect: () => ({ top: 0 }), addEventListener() {}, removeEventListener() {} };
  const { PdfJsReader } = compile("../app/components/PdfJsReader.tsx", hooks.hooks, {
    "../lib/api/client": { paperPdfUrl: () => "/test-pdf" },
    "../lib/pdf/pdfjs-adapter": { createPdfLoadingTask: async () => { loads++; return { promise: Promise.resolve({ numPages: 3, getPage: async () => ({ getViewport: () => ({ width: 600, height: 800 }) }), destroy() {} }), destroy() {} }; }, readPdfNetworkDiagnostics: () => ({}) },
    "../lib/i18n/LocaleProvider": { useI18n: () => ({ locale: "en", t: text => text }) },
    "./ReaderPdfDownload": { ReaderPdfDownload: () => null },
  });
  t.after(() => { hooks.unmount(); Object.assign(globalThis, previous); });
  hooks.start(() => PdfJsReader({ paperId: "fixture-paper" }), tree => {
    nodes(tree, node => node.props?.className === "reader-document-workspace")[0].props.ref.current = { clientWidth: 800 };
    nodes(tree, node => node.props?.className === "reader-canvas-viewport")[0].props.ref(viewport);
  });
  await settle(); hooks.flush(); await settle();
  let tree = hooks.flush();
  const page = nodes(tree, node => typeof node.type === "function" && node.type.name === "ContinuousPdfPage")[0];
  page.props.onRenderError(new Error("Fixture rendering failure")); tree = hooks.flush();
  const zoom = nodes(tree, node => node.type === "button" && node.props["aria-label"] === "Zoom out")[0];
  assert.equal(zoom.props.disabled, false);
  const alert = nodes(tree, node => node.props?.role === "alert")[0]; assert.ok(alert);
  for (const error of [{ status: 404 }, { status: 503 }, { name: "ResponseException" }]) {
    page.props.onRenderError(error); tree = hooks.flush();
    assert.equal(nodes(tree, node => node.props?.role === "alert").length, 1, "Render-time network failures must also show recovery");
    assert.equal(nodes(tree, node => node.type === "button" && node.props["aria-label"] === "Zoom out")[0].props.disabled, false);
  }
  const viewportTree = nodes(tree, node => node.props?.className === "reader-canvas-viewport")[0];
  assert.equal(nodes(viewportTree, node => node.props?.role === "alert").length, 0);
  const percentage = nodes(tree, node => node.type === "select" && node.props["aria-label"] === "Choose PDF zoom percentage")[0];
  assert.ok(percentage); assert.equal(percentage.props.disabled, false);
  percentage.props.onChange({ target: { value: ".25" } }); tree = hooks.flush();
  assert.equal(nodes(tree, node => typeof node.type === "function" && node.type.name === "ContinuousPdfPage")[0].props.zoom, .25);
  assert.equal(nodes(tree, node => node.props?.role === "alert").length, 0);
  assert.equal(loads, 1, "Changing zoom recovers rendering without reloading the PDF");
});

test("mobile companion keeps AI controls interactive and error feedback height bounded", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  assert.ok(rules.some(([, selector, body]) => selector.includes(".reader-companion-slot") && selector.includes(".reader-selection-assistant") && /pointer-events:\s*auto/.test(body)));
  assert.ok(rules.some(([, selector, body]) => selector.trim() === ".reader-render-error-banner" && /min-height:\s*0/.test(body)));
});

function pageRenderingHarness(t) {
  const oldWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  const hooks = hooksHarness(), layers = [], tasks = [], rendered = [], errors = [];
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ({}) };
  const textContainer = { children: [], style: { setProperty() {} }, replaceChildren() { this.children = []; } };
  const page = {
    getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale, scale }),
    render() {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const task = { promise, resolve, cancellations: 0, cancel() { this.cancellations++; reject(Object.assign(new Error("Cancelled fixture canvas"), { name: "RenderingCancelledException" })); } };
      tasks.push(task); return task;
    },
    cleanup() {},
  };
  const { ContinuousPdfPage } = compile("../app/components/PdfJsReader.tsx", hooks.hooks, {
    "../lib/api/client": {},
    "../lib/pdf/pdfjs-adapter": {
      createPdfTextLayer({ viewport, container }) {
        let resolve;
        const promise = new Promise(yes => { resolve = yes; });
        const layer = { scale: viewport.scale, renderCalls: 0, cancelCalls: 0,
          render() { this.renderCalls++; container.children.push(`text at ${this.scale}`); return Promise.resolve(); },
          cancel() { this.cancelCalls++; },
        };
        layers.push({ layer, resolve: () => resolve(layer) }); return promise;
      },
    },
    "../lib/i18n/LocaleProvider": { useI18n: () => ({ locale: "en", t: text => text }) },
    "./ReaderPdfDownload": {},
  }, ["ContinuousPdfPage"]);
  const props = { document: { getPage: async () => page }, pageNumber: 1, zoom: 1, viewportRoot: null, active: true, highlights: [], defaultPageSize: { width: 600, height: 800 }, onRendered: (...value) => rendered.push(value), onRenderError: error => errors.push(error) };
  let unmounted = false;
  const unmount = () => { if (unmounted) return; unmounted = true; hooks.unmount(); };
  t.after(() => { unmount(); globalThis.window = oldWindow; });
  hooks.start(() => ContinuousPdfPage(props), tree => {
    tree.props.ref.current = {};
    nodes(tree, node => node.type === "canvas")[0].props.ref.current = canvas;
    nodes(tree, node => node.props?.className === "textLayer reader-text-layer")[0].props.ref.current = textContainer;
  });
  return { layers, tasks, rendered, errors, textContainer, unmount, async ready() { await settle(); hooks.flush(); }, async zoom(value) { props.zoom = value; hooks.rerender(); await settle(); hooks.flush(); } };
}

test("cancelled rapid zoom generations never append late text into the current PDF page", async t => {
  const ui = pageRenderingHarness(t);
  await ui.ready(); await ui.zoom(1.5); await ui.zoom(.5);
  assert.equal(ui.layers.length, 3);
  assert.equal(ui.tasks[0].cancellations, 1); assert.equal(ui.tasks[1].cancellations, 1);
  // Finish the newest canvas/text first, then allow older text loading to finish.
  ui.tasks[2].resolve(); ui.layers[2].resolve(); await settle();
  assert.deepEqual(ui.textContainer.children, ["text at 0.5"]);
  ui.layers[1].resolve(); ui.layers[0].resolve(); await settle();
  assert.deepEqual(ui.textContainer.children, ["text at 0.5"], "Stale layers must not duplicate selectable text");
  assert.deepEqual(ui.layers.map(({ layer }) => layer.renderCalls), [0, 0, 1]);
  assert.deepEqual(ui.layers.map(({ layer }) => layer.cancelCalls), [1, 1, 0]);
  assert.equal(ui.rendered.length, 1); assert.deepEqual(ui.errors, []);
});

test("a text layer resolving after page unmount is cancelled without rendering or unhandled canvas rejection", async t => {
  const ui = pageRenderingHarness(t); await ui.ready(); ui.unmount();
  // Waiting a turn while text loading is pending catches an unobserved canvas
  // rejection, rather than only checking cancellation once both promises settle.
  await settle(); ui.layers[0].resolve(); await settle();
  assert.equal(ui.tasks[0].cancellations, 1);
  assert.equal(ui.layers[0].layer.renderCalls, 0); assert.equal(ui.layers[0].layer.cancelCalls, 1);
  assert.deepEqual(ui.textContainer.children, []); assert.deepEqual(ui.rendered, []); assert.deepEqual(ui.errors, []);
});

test("PDF page draft commits and cancels truthfully, with keyboard navigation confined to the viewport", async t => {
  const previous = { window: globalThis.window, ResizeObserver: globalThis.ResizeObserver };
  const memory = new Map(), storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  const frames = new Map(); let frameId = 0, loads = 0;
  globalThis.window = { localStorage: storage, sessionStorage: storage, requestAnimationFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; }, cancelAnimationFrame: id => frames.delete(id), addEventListener() {}, removeEventListener() {} };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const hooks = hooksHarness(), viewport = { clientWidth: 768, clientHeight: 600, scrollTop: 0, querySelectorAll: () => [], querySelector: () => null, getBoundingClientRect: () => ({ top: 0 }), addEventListener() {}, removeEventListener() {} };
  const { PdfJsReader } = compile("../app/components/PdfJsReader.tsx", hooks.hooks, {
    "../lib/api/client": { paperPdfUrl: () => "/test-pdf" },
    "../lib/pdf/pdfjs-adapter": { createPdfLoadingTask: async () => { loads++; return { promise: Promise.resolve({ numPages: 3, getPage: async () => ({ getViewport: () => ({ width: 600, height: 800 }) }), destroy() {} }), destroy() {} }; }, readPdfNetworkDiagnostics: () => ({}) },
    "../lib/i18n/LocaleProvider": { useI18n: () => ({ locale: "en", t: text => text }) },
    "./ReaderPdfDownload": { ReaderPdfDownload: () => null },
  });
  t.after(() => { hooks.unmount(); Object.assign(globalThis, previous); });
  hooks.start(() => PdfJsReader({ paperId: "fixture-paper" }), tree => {
    nodes(tree, node => node.props?.className === "reader-document-workspace")[0].props.ref.current = { clientWidth: 800 };
    nodes(tree, node => node.props?.className === "reader-canvas-viewport")[0].props.ref(viewport);
  });
  await settle(); hooks.flush(); await settle();
  let tree = hooks.flush();

  const input = () => nodes(hooks.flush(), node => node.type === "input" && node.props["aria-label"] === "PDF page number")[0];
  const draft = value => { input().props.onChange({ target: { value } }); hooks.flush(); };
  const key = (value, composing = false) => input().props.onKeyDown({ key: value, nativeEvent: { isComposing: composing }, preventDefault() {} });
  draft("3"); key("Enter"); assert.equal(input().props.value, "3");
  draft("999"); key("Enter"); assert.equal(input().props.value, "3", "Same-page boundary commits reset the input");
  draft("-5"); input().props.onBlur(); assert.equal(input().props.value, "1");
  draft("1.9"); key("Enter"); assert.equal(input().props.value, "1");
  draft("2"); key("Escape"); assert.equal(input().props.value, "1");
  input().props.onBlur(); assert.equal(input().props.value, "1", "Escape must not later commit a stale draft on blur");
  draft("2"); key("Enter", true); assert.equal(input().props.value, "2");
  key("Escape");
  const viewportNode = () => nodes(hooks.flush(), node => node.props?.className === "reader-canvas-viewport")[0];
  assert.equal(viewportNode().props.tabIndex, 0);
  let prevented = 0;
  const press = (key, overrides = {}) => viewportNode().props.onKeyDown({ key, target: viewport, currentTarget: viewport, nativeEvent: { isComposing: false }, preventDefault() { prevented++; }, ...overrides });
  press("n"); assert.equal(input().props.value, "2");
  press("n"); assert.equal(input().props.value, "3");
  const frameBeforeBoundary = frameId;
  const treeBeforeBoundary = hooks.flush();
  press("n"); assert.equal(input().props.value, "3");
  assert.equal(frameId, frameBeforeBoundary, "Last-page next must not schedule a scroll");
  assert.equal(hooks.flush(), treeBeforeBoundary, "Last-page next must not update component state");
  press("p"); assert.equal(input().props.value, "2");
  assert.equal(prevented, 3);
  for (const props of [{target: {}}, {ctrlKey:true}, {metaKey:true}, {altKey:true}, {shiftKey:true}, {nativeEvent:{isComposing:true}}]) press("n", props);
  for (const key of ["ArrowLeft", "ArrowRight", "PageDown", "PageUp"]) press(key);
  assert.equal(input().props.value, "2"); assert.equal(prevented, 3);
  press("p"); assert.equal(input().props.value, "1");
  const frameAtFirst = frameId, treeAtFirst = hooks.flush();
  press("p");
  assert.equal(frameId, frameAtFirst, "First-page previous must not schedule a scroll");
  assert.equal(hooks.flush(), treeAtFirst, "First-page previous must not update component state");
  assert.equal(prevented, 4);
});

test("PDF zoom preset reflects selection across keyboard-equivalent steps and fit transitions", async t => {
  const previous = { window: globalThis.window, ResizeObserver: globalThis.ResizeObserver };
  const memory = new Map(), storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  const frames = new Map(); let frameId = 0, loads = 0;
  globalThis.window = { localStorage: storage, sessionStorage: storage, requestAnimationFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; }, cancelAnimationFrame: id => frames.delete(id), addEventListener() {}, removeEventListener() {} };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const hooks = hooksHarness(), viewport = { clientWidth: 768, clientHeight: 600, scrollTop: 0, querySelectorAll: () => [], querySelector: () => null, getBoundingClientRect: () => ({ top: 0 }), addEventListener() {}, removeEventListener() {} };
  const { PdfJsReader } = compile("../app/components/PdfJsReader.tsx", hooks.hooks, {
    "../lib/api/client": { paperPdfUrl: () => "/test-pdf" },
    "../lib/pdf/pdfjs-adapter": { createPdfLoadingTask: async () => { loads++; return { promise: Promise.resolve({ numPages: 3, getPage: async () => ({ getViewport: () => ({ width: 600, height: 800 }) }), destroy() {} }), destroy() {} }; }, readPdfNetworkDiagnostics: () => ({}) },
    "../lib/i18n/LocaleProvider": { useI18n: () => ({ locale: "en", t: text => text }) },
    "./ReaderPdfDownload": { ReaderPdfDownload: () => null },
  });
  t.after(() => { hooks.unmount(); Object.assign(globalThis, previous); });
  hooks.start(() => PdfJsReader({ paperId: "fixture-paper" }), tree => {
    nodes(tree, node => node.props?.className === "reader-document-workspace")[0].props.ref.current = { clientWidth: 800 };
    nodes(tree, node => node.props?.className === "reader-canvas-viewport")[0].props.ref(viewport);
  });
  await settle(); hooks.flush(); await settle();
  let tree = hooks.flush();

  const select = () => nodes(hooks.flush(), node => node.type === "select" && node.props["aria-label"] === "Choose PDF zoom percentage")[0];
  const options = () => nodes(select(), node => node.type === "option");
  const choose = value => { select().props.onChange({ target: { value: String(value) } }); hooks.flush(); };
  choose(0.75);
  assert.equal(select().props.value, 0.75);
  assert.equal(options().filter(option => option.props.value === 0.75).length, 1);
  const next = options()[options().findIndex(option => option.props.value === select().props.value) + 1].props.value;
  assert.equal(next, 1, "ArrowDown from 75% advances to 100%, not 10%");
  choose(next); assert.equal(select().props.value, 1);
  choose(1.22);
  assert.equal(select().props.value, 1.22);
  assert.deepEqual(options().map(option => option.props.value), [0.1, 0.25, 0.5, 0.75, 1, 1.22, 1.25, 1.5, 2, 3]);
  choose(1.25); assert.equal(options().length, 9);
  for (const value of [0.1, 3, 0.5, 1]) { choose(value); assert.equal(select().props.value, value); }
  assert.equal(loads, 1, "Changing zoom never reloads the PDF document");
});
