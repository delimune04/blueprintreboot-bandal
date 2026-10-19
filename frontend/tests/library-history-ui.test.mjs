import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";
import { DEFAULT_LIBRARY_FILTERS as defaults, mergeLibraryHistory, readLibraryHistory } from "../app/lib/library/library-history.mjs";

const require = createRequire(import.meta.url);
const SCOPE = "cloud:actor-a:workspace-a";
const source = readFileSync(new URL("../app/views/LibraryView.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const navigationCode = ts.transpileModule(readFileSync(new URL("../demo/navigation.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function elements(tree, predicate) {
  const found = [];
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    if (predicate(value)) found.push(value);
    visit(value.props?.children);
  }
  visit(tree);
  return found;
}
function label(tree) {
  if (Array.isArray(tree)) return tree.map(label).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return tree && typeof tree === "object" ? label(tree.props?.children) : "";
}
function button(tree, text) {
  const result = elements(tree, node => node.type === "button" && label(node) === text)[0];
  assert.ok(result, `Missing button: ${text}`);
  return result;
}
function search(tree) {
  const result = elements(tree, node => node.type === "input" && node.props.type === "search")[0];
  assert.ok(result, "Missing search input");
  return result;
}

function browser(initialState = null) {
  const listeners = new Map(), timers = new Map(), replacements = [];
  const entries = [{ url: new URL("https://bandal.app/LabVium/library"), state: structuredClone(initialState) }];
  let index = 0, now = 0, timerId = 0;
  const win = {
    get location() { return entries[index].url; },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatchEvent(event) { for (const listener of [...listeners.get(event.type) || []]) listener(event); },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    scrollTo() {},
    history: {
      get state() { return structuredClone(entries[index].state); },
      get length() { return entries.length; },
      replaceState(state, _title, href) {
        const url = href == null ? entries[index].url : new URL(href, entries[index].url);
        entries[index] = { state: structuredClone(state), url };
        replacements.push({ index, state: structuredClone(state), pathname: url.pathname });
      },
      pushState(state, _title, href) {
        entries.splice(index + 1);
        entries.push({ state: structuredClone(state), url: new URL(href, entries[index].url) });
        index++;
      },
      back() { if (index > 0) { index--; win.dispatchEvent({ type: "popstate", state: this.state }); } },
      forward() { if (index + 1 < entries.length) { index++; win.dispatchEvent({ type: "popstate", state: this.state }); } },
    },
  };
  return {
    win, entries, replacements, timers, listeners,
    advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id); now = timer.at; timer.callback();
      }
      now = target;
    },
  };
}

// Exercise the real component's state/effects and real demo navigation without
// adding a DOM dependency. Effects commit after rendering; state updates batch
// until the next render; timers and unmount cleanup are controlled explicitly.
function harness(env, initialScope = SCOPE) {
  let cursor = 0, dirty = true, tree, mounted = true, scope = initialScope;
  const values = [], effects = [], pendingEffects = [], collectionKeys = [];
  const previousWindow = globalThis.window;
  globalThis.window = env.win;
  const hooks = {
    ...React,
    useState(initial) {
      const id = cursor++;
      if (!(id in values)) values[id] = typeof initial === "function" ? initial() : initial;
      return [values[id], next => {
        assert.ok(mounted, "An unmounted component received a state update");
        const value = typeof next === "function" ? next(values[id]) : next;
        if (!Object.is(value, values[id])) { values[id] = value; dirty = true; }
      }];
    },
    useRef(initial) {
      const id = cursor++;
      if (!(id in values)) values[id] = { current: initial };
      return values[id];
    },
    useEffect(callback, dependencies) {
      const id = cursor++, previous = effects[id];
      if (!previous || !dependencies || dependencies.length !== previous.dependencies.length || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        const next = { dependencies, cleanup: previous?.cleanup };
        effects[id] = next;
        pendingEffects.push(() => { previous?.cleanup?.(); next.cleanup = callback(); });
      }
    },
  };
  const collection = { items: [{ paper_id: "paper-1", title: "Paper one", first_author: "Author", year: "2026", status: "unread", tags: [], missing_pdf: false }], total: 100, has_more: true };
  const component = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "react") return hooks;
    if (name === "next/link") return { default: "a" };
    if (name.endsWith("/LocaleProvider")) return { useI18n: () => ({ locale: "en", t: value => value }) };
    if (name.endsWith("/api/client")) return { ApiClientError: Error, apiClient: {}, getWorkspaceMode: () => scope.split(":")[0], getWorkspaceStorageScope: () => scope.slice(scope.indexOf(":") + 1) };
    if (name.endsWith("/useModalFocus")) return { useModalFocus: () => ({ current: null }) };
    if (name.endsWith("/useApiResource")) return { useApiResource: key => {
      const common = { retry() {}, updateData() {} };
      if (key.startsWith("library-papers:")) { collectionKeys.push(key); return { ...common, status: "success", data: collection }; }
      if (key === "library-canonical-tags") return { ...common, status: "success", data: [] };
      return { ...common, status: "loading" };
    } };
    if (name.startsWith("../components/")) return new Proxy({}, { get: (_, key) => String(key) });
    if (name.startsWith("../lib/") && name.endsWith(".mjs")) return require(`../app/lib/${name.slice("../lib/".length)}`);
    return require(name);
  }, component, component.exports);
  const navigation = { exports: {} };
  new Function("require", "module", "exports", navigationCode)(name => name === "react" ? hooks : require(name), navigation, navigation.exports);
  const ui = {
    router: navigation.exports.useRouter(), collectionKeys,
    get tree() { return tree; },
    get scope() { return scope; },
    renderOnce() { dirty = false; cursor = 0; tree = component.exports.LibraryView(); return tree; },
    commitEffects() { pendingEffects.splice(0).forEach(effect => effect()); },
    flush() {
      for (let pass = 0; pass < 20; pass++) {
        if (dirty) this.renderOnce();
        this.commitEffects();
        if (!dirty && !pendingEffects.length) return tree;
      }
      assert.fail("Component effects did not settle");
    },
    type(value) { search(tree).props.onChange({ target: { value } }); return this.flush(); },
    advance(milliseconds) { env.advance(milliseconds); return this.flush(); },
    switchScope(next) { scope = next; dirty = true; return this.flush(); },
    unmount() {
      effects.forEach(effect => effect?.cleanup?.());
      mounted = false;
      globalThis.window = previousWindow;
    },
  };
  return ui;
}

function filters(overrides = {}) { return { ...defaults, ...overrides }; }
function stored(env, scope = SCOPE) { return readLibraryHistory(env.win.history.state, scope); }
function seeded(overrides = {}) { return mergeLibraryHistory({ router: "keep-me", __NA: true }, SCOPE, filters(overrides)); }

test("initial hydration leaves saved history intact before restoring nonzero pagination", t => {
  const expected = filters({ searchInput: "CCS", q: "CCS", tag: "reservoir", tagInput: "Reservoir", year: "2026", readingStatus: "reading", archiveStatus: "all", offset: 40 });
  const initial = seeded(expected), env = browser(initial), ui = harness(env);
  t.after(() => ui.unmount());
  assert.equal(search(ui.renderOnce()).props.value, "", "First render must use SSR-safe defaults");
  assert.deepEqual(env.win.history.state, initial);
  assert.equal(env.replacements.length, 0);
  ui.commitEffects();
  assert.deepEqual(env.win.history.state, initial, "Mount effects must not persist initial defaults over saved state");
  assert.equal(env.replacements.length, 0);
  ui.flush();
  assert.equal(search(ui.tree).props.value, "CCS");
  assert.equal(button(ui.tree, "Previous").props.disabled, false);
  assert.deepEqual(stored(env), expected);
  assert.equal(env.win.history.state.router, "keep-me");
  ui.advance(1000);
  assert.equal(stored(env).offset, 40, "Restoring an already-applied query must not reset its page");
  assert.equal(env.timers.size, 0);
  assert.equal(env.win.history.length, 1);
});

test("same-route entries restore their own filters on Back and Forward without remounting", t => {
  const first = filters({ searchInput: "first", q: "first", offset: 40 });
  const env = browser(seeded(first)), ui = harness(env);
  t.after(() => ui.unmount());
  ui.flush();
  ui.router.push("/library"); ui.flush();
  assert.equal(env.win.history.length, 2);
  assert.deepEqual(stored(env), defaults, "A new Library history entry starts with its own context");
  ui.type("second"); ui.advance(260);
  button(ui.tree, "Next").props.onClick(); ui.flush();
  const second = filters({ searchInput: "second", q: "second", offset: 20 });
  assert.deepEqual(stored(env), second);
  ui.router.back(); ui.flush();
  assert.equal(search(ui.tree).props.value, "first");
  assert.deepEqual(stored(env), first);
  ui.advance(1000);
  assert.equal(stored(env).offset, 40);
  ui.router.forward(); ui.flush();
  assert.equal(search(ui.tree).props.value, "second");
  assert.deepEqual(stored(env), second);
  assert.equal(env.win.history.length, 2, "Restoration must not add entries");
});

test("pending search survives paper navigation and remount, then resets only when applied", t => {
  const env = browser(seeded({ searchInput: "old", q: "old", offset: 40 }));
  let ui = harness(env), active = ui;
  t.after(() => active?.unmount());
  ui.flush(); ui.type("new");
  assert.equal(stored(env).q, "old");
  assert.equal(stored(env).offset, 40);
  ui.router.push("/papers/paper-1");
  assert.equal(env.win.history.state, null);
  ui.unmount(); active = null;
  assert.equal(env.timers.size, 0, "Navigation unmount must cancel the old debounce");
  assert.equal(env.listeners.get("popstate")?.size, 0);
  assert.equal(env.listeners.get("bandal-demo:navigation")?.size, 0);
  env.advance(1000);
  assert.equal(env.win.history.state, null, "The paper entry must not receive Library state");
  env.win.history.back();
  active = ui = harness(env); ui.flush();
  assert.equal(search(ui.tree).props.value, "new");
  assert.equal(stored(env).q, "old");
  assert.equal(stored(env).offset, 40);
  ui.advance(259);
  assert.equal(stored(env).q, "old");
  ui.advance(1);
  assert.equal(stored(env).q, "new");
  assert.equal(stored(env).offset, 0);
  assert.equal(env.win.history.length, 2);
});

test("Back cancels a second entry's pending search instead of applying it to the first", t => {
  const first = filters({ searchInput: "first", q: "first", offset: 40 });
  const env = browser(seeded(first)), ui = harness(env);
  t.after(() => ui.unmount());
  ui.flush(); ui.router.push("/library"); ui.flush(); ui.type("pending second");
  ui.router.back(); ui.flush(); ui.advance(1000);
  assert.equal(search(ui.tree).props.value, "first");
  assert.deepEqual(stored(env), first);
  ui.router.forward(); ui.flush();
  assert.equal(search(ui.tree).props.value, "pending second");
  assert.equal(stored(env).q, "");
  ui.advance(260);
  assert.equal(stored(env).q, "pending second");
});

test("actor and workspace switches discard earlier filters before writing the new scope", t => {
  const env = browser(seeded({ searchInput: "private query", q: "private query", offset: 40 })), ui = harness(env);
  t.after(() => ui.unmount());
  ui.flush();
  for (const scope of ["cloud:actor-a:workspace-b", "cloud:actor-b:workspace-b", "browser::"]) {
    ui.switchScope(scope);
    assert.equal(search(ui.tree).props.value, "");
    assert.deepEqual(stored(env, scope), defaults);
    assert.equal(env.win.history.state["labvium.library.v1"].scope, scope);
  }
  assert.equal(env.win.history.length, 1);
});
