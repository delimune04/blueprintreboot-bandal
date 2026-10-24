import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test, { afterEach } from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const originalWindow = globalThis.window;
afterEach(() => { globalThis.window = originalWindow; });

function loadModule(file, overrides = {}) {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", code)(name => overrides[name] || require(name), loaded, loaded.exports);
  return loaded.exports;
}

function setup(initial = "/LabVium") {
  const win = new EventTarget();
  const entries = [new URL(initial, "https://bandal.app")];
  const states = [{ keep: "history state" }];
  const external = [];
  const scrolls = [];
  let index = 0, subscription, memo;
  function refreshLocation() {
    const current = entries[index];
    win.location = {
      href: current.href, origin: current.origin, pathname: current.pathname, search: current.search, hash: current.hash,
      assign: href => external.push(["assign", href]), replace: href => external.push(["replace", href]), reload() {},
    };
  }
  win.history = {
    get state() { return states[index]; },
    get length() { return entries.length; },
    pushState(state, _title, href) {
      entries.splice(index + 1); states.splice(index + 1);
      entries.push(new URL(href, entries[index])); states.push(state); index++; refreshLocation();
    },
    replaceState(state, _title, href) { entries[index] = new URL(href, entries[index]); states[index] = state; refreshLocation(); },
    back() { if (index) { index--; refreshLocation(); win.dispatchEvent(new Event("popstate")); } },
    forward() { if (index + 1 < entries.length) { index++; refreshLocation(); win.dispatchEvent(new Event("popstate")); } },
  };
  win.scrollTo = value => scrolls.push(value);
  refreshLocation(); globalThis.window = win;
  const hooks = {
    useSyncExternalStore(subscribe, getSnapshot) { subscription = subscribe; return getSnapshot(); },
    useMemo(factory, dependencies) {
      if (!memo || !dependencies.every((value, i) => Object.is(value, memo.dependencies[i]))) memo = { value: factory(), dependencies };
      return memo.value;
    },
  };
  const navigation = loadModule("../demo/navigation.ts", { react: hooks });
  return { win, navigation, external, scrolls, subscribe: listener => subscription(listener), href: () => `${win.location.pathname}${win.location.search}${win.location.hash}` };
}

function click(overrides = {}) {
  return { button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...overrides };
}

test("clean routes preserve encoded Paper identity, query and document anchors without shared route memory", () => {
  const { win, navigation: nav } = setup("/LabVium/papers/arxiv%3A1706.03762/reader?page=3&quote=a%2Fb#selection");
  assert.equal(nav.readRoute(), "/papers/arxiv%3A1706.03762/reader?page=3&quote=a%2Fb#selection");
  assert.equal(nav.usePathname(), "/papers/arxiv%3A1706.03762/reader");
  win.history.replaceState({}, "", "/LabVium/guide#notes?not-a-query=1");
  assert.equal(nav.readRoute(), "/guide#notes?not-a-query=1");
  assert.equal(nav.useSearchParams().size, 0);
  win.history.replaceState({}, "", "/LabVium");
  assert.equal(nav.readRoute(), "/");
  win.history.replaceState({}, "", "/LabVium-other/library");
  assert.equal(nav.readRoute(), "/");
});

test("internal hrefs use the canonical root and resolve relative paths and href objects", () => {
  const { navigation: nav } = setup("/LabVium/papers/paper-one/reader?page=2#old");
  assert.equal(nav.DEMO_BASE, "/LabVium");
  assert.equal(nav.demoHref("/"), "/LabVium");
  assert.equal(nav.demoHref("/LabVium/"), "/LabVium");
  assert.equal(nav.demoHref("/library?tag=ccs#saved"), "/LabVium/library?tag=ccs#saved");
  assert.equal(nav.demoHref("../paper-two/reader?page=4"), "/LabVium/papers/paper-two/reader?page=4");
  assert.equal(nav.demoHref("?page=7#quote"), "/LabVium/papers/paper-one/reader?page=7#quote");
  assert.equal(nav.demoHref({ pathname: "/discover", query: { q: "attention is all", author: ["Vaswani", "Shazeer"], omit: null }, hash: "results" }), "/LabVium/discover?q=attention+is+all&author=Vaswani&author=Shazeer#results");
  assert.equal(nav.demoHref({ query: { page: 5 }, hash: "#note" }), "/LabVium/papers/paper-one/reader?page=5#note");
  assert.equal(nav.demoHref("/ku-ai/#/projects/demo?tab=review#decision"), "/LabVium/projects/demo?tab=review#decision");
  assert.equal(nav.demoHref("#note"), "#note");
});

test("legacy hash bookmarks migrate once with their query, inner anchor and existing history state", () => {
  for (const [old, expected] of [
    ["/ku-ai/#/", "/LabVium"],
    ["/LabVium/#/library?tag=ccs#saved", "/LabVium/library?tag=ccs#saved"],
    ["/ku-ai?lang=ko&page=1#/papers/a%2Fb/reader?page=8#quote", "/LabVium/papers/a%2Fb/reader?page=8&lang=ko#quote"],
    ["/ku-ai/projects/team?sort=new#notes", "/LabVium/projects/team?sort=new#notes"],
    ["/ku-ai?author=one&author=two#/discover?q=attention", "/LabVium/discover?q=attention&author=one&author=two"],
    ["/LabVium/", "/LabVium"],
  ]) {
    const env = setup(old);
    const previousState = env.win.history.state;
    env.navigation.migrateLegacyRoute();
    assert.equal(env.href(), expected);
    assert.equal(env.win.history.length, 1);
    assert.equal(env.win.history.state, previousState);
    env.navigation.migrateLegacyRoute();
    assert.equal(env.href(), expected);
    assert.equal(env.win.history.length, 1);
  }
});

test("anchors, external destinations and app-prefix lookalikes cannot become external migration redirects", () => {
  for (const path of ["/LabVium/guide#notes", "/LabVium#//evil.example/steal", "/LabVium-other/#/library", "/travel/#/library"]) {
    const env = setup(path);
    env.navigation.migrateLegacyRoute();
    assert.equal(env.href(), path);
    assert.deepEqual(env.external, []);
  }
  const { navigation: nav } = setup();
  for (const href of ["https://example.org/paper.pdf", "mailto:help@example.org", "//example.org/paper", "#notes"]) {
    assert.equal(nav.demoHref(href), href);
    assert.equal(nav.isDemoHref(href), false);
  }
  for (const href of ["/LabVium-other/library", "/LabVium/../../travel", "/LabVium\\\\evil.example", "/LabVium\n/library"]) assert.equal(nav.isDemoHref(href), false);
  assert.equal(nav.demoHref("/\\evil.example"), "#");
  assert.equal(nav.demoHref("../../../../travel"), "/LabVium/travel");
});

test("push, replace, Back, Forward and hashchange update subscribers with complete cleanup", () => {
  const env = setup("/LabVium/library");
  const nav = env.navigation, router = nav.useRouter(), notifications = [];
  nav.useDemoRoute();
  const unsubscribe = env.subscribe(() => notifications.push(nav.readRoute()));
  router.push("/papers/paper-one/reader?page=3", { scroll: false });
  assert.equal(env.href(), "/LabVium/papers/paper-one/reader?page=3");
  assert.equal(env.scrolls.length, 0);
  router.replace({ pathname: "/papers/paper-one/reader", query: { page: 4 } });
  assert.equal(env.win.history.length, 2);
  assert.equal(env.scrolls.length, 1);
  router.back(); assert.equal(env.href(), "/LabVium/library");
  router.forward(); assert.equal(env.href(), "/LabVium/papers/paper-one/reader?page=4");
  env.win.history.replaceState({}, "", "/LabVium/papers/paper-one/reader?page=4#quote");
  env.win.dispatchEvent(new Event("hashchange"));
  assert.deepEqual(notifications, ["/papers/paper-one/reader?page=3", "/papers/paper-one/reader?page=4", "/library", "/papers/paper-one/reader?page=4", "/papers/paper-one/reader?page=4#quote"]);
  unsubscribe();
  router.push("/guide");
  env.win.dispatchEvent(new Event("hashchange"));
  env.win.dispatchEvent(new Event("popstate"));
  assert.equal(notifications.length, 5);
  router.push("https://example.org");
  assert.deepEqual(env.external, [["assign", "https://example.org"]]);
});

test("Reader search-parameter identity stays stable across anchor and path changes with the same query", () => {
  const { win, navigation: nav } = setup("/LabVium/papers/one/reader?page=3");
  const params = nav.useSearchParams();
  assert.equal(params.get("page"), "3");
  win.history.replaceState({}, "", "/LabVium/papers/two/reader?page=3#quote");
  assert.equal(nav.useSearchParams(), params);
  win.history.replaceState({}, "", "/LabVium/papers/two/reader?page=4");
  assert.notEqual(nav.useSearchParams(), params);
  assert.equal(nav.useSearchParams().get("page"), "4");
});

test("Link intercepts ordinary internal clicks while native modified, target, download and anchor actions remain intact", () => {
  const env = setup("/LabVium/library");
  const Link = loadModule("../demo/link.tsx", { "./navigation": env.navigation, react: React }).default;
  function render(props) { return Link.render({ children: "Open", ...props }, null); }
  const link = render({ href: "/papers/paper-one/reader?page=2" });
  assert.equal(link.props.href, "/LabVium/papers/paper-one/reader?page=2");
  const normal = click(); link.props.onClick(normal);
  assert.equal(normal.defaultPrevented, true);
  assert.equal(env.href(), "/LabVium/papers/paper-one/reader?page=2");
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
    const event = click(options), count = env.win.history.length;
    link.props.onClick(event); assert.equal(env.win.history.length, count);
  }
  for (const props of [{ href: "/library", target: "_blank" }, { href: "/library", download: "papers.txt" }, { href: "https://example.org" }, { href: "#quote" }, { href: "/library", onClick: event => event.preventDefault() }]) {
    const anchor = render(props), event = click(), count = env.win.history.length;
    anchor.props.onClick(event); assert.equal(env.win.history.length, count);
  }
  const replace = render({ href: "/guide", replace: true, scroll: false }), count = env.win.history.length;
  replace.props.onClick(click());
  assert.equal(env.win.history.length, count);
  assert.equal(env.href(), "/LabVium/guide");
});


test("Back to cached-client history and a new legacy root hash both migrate before notifying React", () => {
  const env = setup("/ku-ai/#/papers/paper-one/reader?page=3#quote");
  const nav = env.navigation, notifications = [];
  nav.useDemoRoute();
  const unsubscribe = env.subscribe(() => notifications.push(nav.readRoute()));
  nav.useRouter().push("/library");
  nav.useRouter().back();
  assert.equal(env.href(), "/LabVium/papers/paper-one/reader?page=3#quote");
  assert.deepEqual(notifications, ["/library", "/papers/paper-one/reader?page=3#quote"]);
  env.win.history.replaceState({}, "", "/LabVium/#/discover?q=ccs");
  env.win.dispatchEvent(new Event("hashchange"));
  assert.equal(env.href(), "/LabVium/discover?q=ccs");
  assert.equal(notifications.at(-1), "/discover?q=ccs");
  unsubscribe();
});
