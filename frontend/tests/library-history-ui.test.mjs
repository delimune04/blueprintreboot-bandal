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

function loadCatalog(path) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", code)(name => name.startsWith("./") ? loadCatalog(new URL(`${name}.ts`, path)) : require(name), loaded, loaded.exports);
  return loaded.exports;
}
const { translate } = loadCatalog(new URL("../app/lib/i18n/catalog.ts", import.meta.url));

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

function field(tree, text) {
  const wrapper = elements(tree, node => node.type === "label" && label(node.props.children?.[0]) === text)[0];
  assert.ok(wrapper, `Missing filter field: ${text}`);
  return elements(wrapper, node => node.type === "input" || node.type === "select")[0];
}
function chips(tree) {
  return elements(tree, node => node.type === "button" && node.props.className?.includes("library-filter-chip"));
}
function removeButton(tree, name) {
  const result = chips(tree).find(node => node.props["aria-label"] === name);
  assert.ok(result, `Missing filter removal: ${name}`);
  return result;
}
function inspector(tree) { return elements(tree, node => node.type === "LibraryPaperInspector")[0]; }
function emptyState(tree) { return elements(tree, node => node.type === "EmptyState")[0]; }

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
function harness(env, initialScope = SCOPE, options = {}) {
  let cursor = 0, dirty = true, tree, mounted = true, scope = initialScope, locale = options.locale || "en";
  const values = [], effects = [], pendingEffects = [], collectionKeys = [];
  const hosts = new Map(), elementHosts = new Map();
  let refs = [];
  // Commit host refs before effects, retaining host identity at each tree path.
  // This models focus on stable controls without pretending to test DOM layout.
  function commitRefs() {
    refs.forEach(([ref]) => { if (typeof ref === "function") ref(null); else ref.current = null; });
    refs = []; elementHosts.clear();
    for (const host of hosts.values()) host.isConnected = false;
    function visit(value, path = "root") {
      if (Array.isArray(value)) return value.forEach((child, index) => visit(child, `${path}.${index}`));
      if (!value || typeof value !== "object") return;
      const ref = value.props?.ref;
      if (ref) {
        if (!hosts.has(path)) hosts.set(path, { focus() { assert.ok(this.isConnected); env.focused = this; }, setAttribute() {} });
        const host = hosts.get(path);
        host.isConnected = true; host.props = value.props;
        elementHosts.set(value, host); refs.push([ref, host]);
        if (typeof ref === "function") ref(host); else ref.current = host;
      }
      visit(value.props?.children, `${path}.children`);
    }
    visit(tree);
  }
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
  let collection = options.collection || { items: [{ paper_id: "paper-1", title: "Paper one", first_author: "Author", year: "2026", status: "unread", tags: [], missing_pdf: false }], total: 100, has_more: true };
  const component = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "react") return hooks;
    if (name === "next/link") return { default: "a" };
    if (name.endsWith("/LocaleProvider")) return { useI18n: () => ({ locale, t: (source, values) => translate(source, locale, values) }) };
    if (name.endsWith("/api/client")) return { ApiClientError: Error, apiClient: {}, getWorkspaceMode: () => scope.split(":")[0], getWorkspaceStorageScope: () => scope.slice(scope.indexOf(":") + 1) };
    if (name.endsWith("/useModalFocus")) return { useModalFocus: () => ({ current: null }) };
    if (name.endsWith("/useApiResource")) return { useApiResource: key => {
      const common = { retry() {}, updateData() {} };
      if (key.startsWith("library-papers:")) { collectionKeys.push(key); return { ...common, status: "success", data: collection }; }
      if (key === "library-canonical-tags") return { ...common, status: "success", data: options.tags || [] };
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
    commitEffects() { commitRefs(); pendingEffects.splice(0).forEach(effect => effect()); },
    host(element) { return elementHosts.get(element); },
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
    switchLocale(next) { locale = next; dirty = true; return this.flush(); },
    setCollection(next) { collection = next; dirty = true; return this.flush(); },
    unmount() {
      effects.forEach(effect => effect?.cleanup?.());
      refs.forEach(([ref]) => { if (typeof ref === "function") ref(null); else ref.current = null; });
      for (const host of hosts.values()) host.isConnected = false;
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

const completeFilters = filters({ searchInput: "muon", q: "muon", tag: "canonical-muon", tagInput: "Muon physics", year: "2026", readingStatus: "finished", archiveStatus: "archived", offset: 40 });
const tagCatalog = [{ canonical_key: "canonical-muon", label: "Muon physics" }];
const removals = [
  { field: "Search", label: "Search: muon", cleared: { searchInput: "", q: "" } },
  { field: "Tag", label: "Tag: Muon physics", cleared: { tag: "", tagInput: "" } },
  { field: "Year", label: "Year: 2026", cleared: { year: "" } },
  { field: "Reading status", label: "Reading status: Finished", cleared: { readingStatus: "" } },
  { field: "Library state", label: "Library state: Archived papers", cleared: { archiveStatus: "active" } },
];

for (const removal of removals) {
  test(`removing ${removal.field} preserves the other criteria and resets pagination and inspector`, t => {
    const env = browser(seeded(completeFilters)), ui = harness(env, SCOPE, { tags: tagCatalog });
    t.after(() => ui.unmount());
    ui.flush();
    button(ui.tree, "Inspect").props.onClick(); ui.flush();
    assert.ok(inspector(ui.tree));
    assert.equal(chips(ui.tree).length, 5);
    const target = ui.host(field(ui.tree, removal.field));
    const remove = removeButton(ui.tree, `Remove filter: ${removal.label}`);
    remove.props.onClick(); ui.flush();
    assert.deepEqual(stored(env), { ...completeFilters, ...removal.cleared, offset: 0 });
    assert.equal(inspector(ui.tree), undefined);
    assert.equal(chips(ui.tree).length, 4);
    assert.equal(env.focused, target, "The disappearing chip must return focus to its own filter field");
    assert.equal(target.isConnected, true);
    assert.equal(button(ui.tree, "Previous").props.disabled, true);
    assert.equal(env.win.history.state.router, "keep-me");
    assert.equal(env.win.history.state.__NA, true);
    assert.equal(env.win.location.search, "", "Filter text must not enter the URL");
    assert.equal(env.win.history.length, 1);
    const remaining = removals.filter(item => item !== removal).map(item => `Remove filter: ${item.label}`);
    assert.deepEqual(chips(ui.tree).map(node => node.props["aria-label"]), remaining);
    ui.advance(1000);
    assert.deepEqual(stored(env), { ...completeFilters, ...removal.cleared, offset: 0 });
  });
}

for (const pending of ["new private query", ""]) {
  test(`removing search cancels a pending ${pending ? "replacement" : "clear"} without restoring stale results`, t => {
    const env = browser(seeded(completeFilters)), ui = harness(env);
    t.after(() => ui.unmount());
    ui.flush(); ui.type(pending); ui.advance(100);
    assert.equal(stored(env).q, "muon");
    assert.equal(env.timers.size, 1);
    removeButton(ui.tree, `Remove filter: ${pending ? "Pending search" : "Clearing search"}: ${pending || "muon"}`).props.onClick(); ui.flush();
    assert.equal(env.timers.size, 0);
    const expected = { ...completeFilters, searchInput: "", q: "", offset: 0 };
    assert.deepEqual(stored(env), expected);
    ui.advance(1000);
    assert.deepEqual(stored(env), expected);
    assert.equal(search(ui.tree).props.value, "");
    assert.ok(ui.collectionKeys.at(-1).startsWith("library-papers::canonical-muon:2026:finished:archived:0"));
  });
}

test("a first pending search can be removed before it applies, including after repeated activation", t => {
  const env = browser(), ui = harness(env);
  t.after(() => ui.unmount());
  ui.flush(); ui.type("not applied yet");
  assert.equal(stored(env).q, "");
  const remove = removeButton(ui.tree, "Remove filter: Pending search: not applied yet");
  remove.props.onClick(); remove.props.onClick(); ui.flush(); ui.advance(1000);
  assert.deepEqual(stored(env), defaults);
  assert.equal(chips(ui.tree).length, 0);
  assert.equal(button(ui.tree, "Reset filters").props.disabled, true);
  assert.equal(env.focused, ui.host(search(ui.tree)));
});

for (const removal of removals.slice(1)) {
  test(`removing ${removal.field} preserves the pending search and its original debounce deadline`, t => {
    const env = browser(seeded(completeFilters)), ui = harness(env);
    t.after(() => ui.unmount());
    ui.flush(); ui.type("pending query"); ui.advance(120);
    removeButton(ui.tree, `Remove filter: ${removal.label}`).props.onClick(); ui.flush();
    const expected = { ...completeFilters, ...removal.cleared, searchInput: "pending query", offset: 0 };
    assert.deepEqual(stored(env), expected);
    ui.advance(139);
    assert.deepEqual(stored(env), expected);
    ui.advance(1);
    assert.deepEqual(stored(env), { ...expected, q: "pending query" });
    assert.equal(env.timers.size, 0);
    assert.equal(env.focused, ui.host(field(ui.tree, removal.field)));
  });
}

test("removed criteria persist across paper navigation and remount without leaking into the paper entry", t => {
  const env = browser(seeded(completeFilters));
  let ui = harness(env), active = ui;
  t.after(() => active?.unmount());
  ui.flush();
  removeButton(ui.tree, "Remove filter: Reading status: Finished").props.onClick(); ui.flush();
  const expected = { ...completeFilters, readingStatus: "", offset: 0 };
  ui.router.push("/papers/paper-1");
  ui.unmount(); active = null; env.advance(1000);
  assert.equal(env.win.history.state, null);
  assert.equal(env.win.location.search, "");
  env.win.history.back(); active = ui = harness(env); ui.flush();
  assert.deepEqual(stored(env), expected);
  assert.equal(chips(ui.tree).length, 4);
  assert.equal(field(ui.tree, "Reading status").props.value, "");
  assert.equal(env.win.history.state.router, "keep-me");
  assert.equal(env.focused?.isConnected, false, "Navigation must not receive delayed focus from the old removal");
  assert.equal(env.win.history.length, 2);
});

test("reset clears all criteria and any pending query, closes the inspector, and returns focus to search", t => {
  const env = browser(seeded(completeFilters)), ui = harness(env);
  t.after(() => ui.unmount());
  ui.flush(); ui.type("pending");
  button(ui.tree, "Inspect").props.onClick(); ui.flush();
  button(ui.tree, "Reset filters").props.onClick(); ui.flush(); ui.advance(1000);
  assert.deepEqual(stored(env), defaults);
  assert.equal(inspector(ui.tree), undefined);
  assert.equal(chips(ui.tree).length, 0);
  assert.equal(env.focused, ui.host(search(ui.tree)));
  assert.equal(env.timers.size, 0);
});

test("chips and the reading column follow live KR/EN locale changes while research text stays unchanged", t => {
  const researchText = "Library {value} CO₂ / 한글";
  const initial = { ...completeFilters, searchInput: researchText, q: researchText };
  const env = browser(seeded(initial)), ui = harness(env, SCOPE, { tags: tagCatalog });
  t.after(() => ui.unmount());
  ui.flush();
  assert.ok(elements(ui.tree, node => node.type === "th" && label(node) === "Reading status").length);
  ui.switchLocale("ko");
  const expected = [
    `필터 해제: 검색: ${researchText}`, "필터 해제: 태그: Muon physics", "필터 해제: 연도: 2026",
    "필터 해제: 읽기상태: 읽기 완료", "필터 해제: 보관 상태: 보관된 논문",
  ];
  assert.deepEqual(chips(ui.tree).map(node => node.props["aria-label"]), expected);
  assert.ok(elements(ui.tree, node => node.type === "th" && label(node) === "읽기상태").length);
  assert.deepEqual(stored(env), initial, "Language changes must not alter queries or saved history");
  ui.switchLocale("en");
  assert.ok(removeButton(ui.tree, "Remove filter: Reading status: Finished"));
  assert.equal(search(ui.tree).props.value, researchText);
});

for (const [status, en, ko] of [["unread", "Unread", "읽기 전"], ["reading", "Reading", "읽는 중"], ["read", "Read", "읽음"], ["finished", "Finished", "읽기 완료"]]) {
  test(`${status} reading criteria show human labels in both languages`, t => {
    const env = browser(seeded({ readingStatus: status })), ui = harness(env);
    t.after(() => ui.unmount()); ui.flush();
    assert.ok(removeButton(ui.tree, `Remove filter: Reading status: ${en}`));
    ui.switchLocale("ko");
    assert.ok(removeButton(ui.tree, `필터 해제: 읽기상태: ${ko}`));
  });
}

test("All papers is a removable nondefault scope and active-only has no redundant chip", t => {
  const env = browser(seeded({ archiveStatus: "all" })), ui = harness(env);
  t.after(() => ui.unmount()); ui.flush();
  assert.equal(chips(ui.tree).length, 1);
  removeButton(ui.tree, "Remove filter: Library state: All papers").props.onClick(); ui.flush();
  assert.equal(field(ui.tree, "Library state").props.value, "active");
  assert.equal(chips(ui.tree).length, 0);
  assert.equal(button(ui.tree, "Reset filters").props.disabled, true);
});

const emptyCollection = { items: [], total: 0, has_more: false };
for (const criterion of [{ searchInput: "muon", q: "muon" }, { tag: "tag-key", tagInput: "Library" }, { year: "2026" }, { readingStatus: "finished" }, { archiveStatus: "archived" }]) {
  test(`empty results with ${Object.keys(criterion)[0]} guide filter recovery instead of adding papers`, t => {
    const env = browser(seeded(criterion)), ui = harness(env, SCOPE, { collection: emptyCollection });
    t.after(() => ui.unmount()); ui.flush();
    assert.equal(emptyState(ui.tree).props.title, "No matching papers");
    assert.match(emptyState(ui.tree).props.description, /Remove a filter above or reset filters/);
    assert.doesNotMatch(emptyState(ui.tree).props.description, /Discover|import/);
    ui.switchLocale("ko");
    assert.match(emptyState(ui.tree).props.description, /필터 때문에 저장한 논문이 보이지 않을 수 있습니다/);
    assert.match(emptyState(ui.tree).props.description, /조건을 하나씩 해제/);
    assert.doesNotMatch(emptyState(ui.tree).props.description, /PDF|논문 찾기/);
  });
}

test("unfiltered empty Library keeps Discover/PDF guidance and acknowledges archived papers", t => {
  const env = browser(), ui = harness(env, SCOPE, { collection: emptyCollection });
  t.after(() => ui.unmount()); ui.flush();
  assert.equal(emptyState(ui.tree).props.title, "No active papers");
  assert.match(emptyState(ui.tree).props.description, /Discover or import a PDF/);
  assert.match(emptyState(ui.tree).props.description, /archived papers/);
  assert.equal(button(ui.tree, "Reset filters").props.disabled, true);
  ui.switchLocale("ko");
  assert.equal(emptyState(ui.tree).props.title, "활성 논문이 없습니다");
  assert.match(emptyState(ui.tree).props.description, /논문 찾기/);
  assert.match(emptyState(ui.tree).props.description, /PDF/);
  assert.match(emptyState(ui.tree).props.description, /보관한 논문/);
  ui.setCollection({ items: [{ paper_id: "paper-1", title: "Visible paper", tags: [], status: "unread" }], total: 1, has_more: false });
  assert.equal(emptyState(ui.tree), undefined);
});


test("an empty all-papers-only view gives add-paper guidance rather than recommending narrower active filters", t => {
  const env = browser(seeded({ archiveStatus: "all" })), ui = harness(env, SCOPE, { collection: emptyCollection });
  t.after(() => ui.unmount()); ui.flush();
  assert.equal(emptyState(ui.tree).props.title, "No papers yet");
  assert.match(emptyState(ui.tree).props.description, /Discover or import a PDF/);
  assert.doesNotMatch(emptyState(ui.tree).props.description, /reset|broaden|hidden|archived/i);
  assert.equal(chips(ui.tree).length, 1, "The all-papers scope remains removable");
  ui.switchLocale("ko");
  assert.equal(emptyState(ui.tree).props.title, "아직 저장한 논문이 없습니다");
  assert.match(emptyState(ui.tree).props.description, /논문 찾기/);
  assert.doesNotMatch(emptyState(ui.tree).props.description, /필터|초기화/);
});

test("pending and clearing search chips are labeled until the applied query catches up in both languages", t => {
  const env = browser(seeded({ searchInput: "old", q: "old" })), ui = harness(env);
  t.after(() => ui.unmount()); ui.flush();
  ui.type("new");
  assert.ok(removeButton(ui.tree, "Remove filter: Pending search: new"));
  assert.equal(stored(env).q, "old");
  ui.switchLocale("ko");
  assert.ok(removeButton(ui.tree, "필터 해제: 검색 적용 대기: new"));
  ui.advance(260);
  assert.ok(removeButton(ui.tree, "필터 해제: 검색: new"));
  ui.type("");
  assert.ok(removeButton(ui.tree, "필터 해제: 검색 해제 중: new"));
  assert.equal(stored(env).q, "new");
  ui.switchLocale("en");
  assert.ok(removeButton(ui.tree, "Remove filter: Clearing search: new"));
  ui.advance(260);
  assert.equal(chips(ui.tree).length, 0);
  assert.equal(stored(env).q, "");
});
