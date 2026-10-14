import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import postcss from "postcss";
import { createModalFocusStack, modalRestoreTarget } from "../app/lib/accessibility/modal-focus.mjs";

const require = createRequire(import.meta.url);

async function loadNavigation() {
  const source = await readFile(new URL("../app/components/SidebarNavigation.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const navigationModule = { exports: {} };
  const localRequire = (name) => {
    if (name === "next/link") return { default: ({ children, ...props }) => React.createElement("a", props, children) };
    if (name === "next/navigation") return { usePathname: () => "/projects/current/review" };
    if (name.includes("LocaleProvider")) return { useI18n: () => ({ t: (text) => text }), LanguageToggle: () => React.createElement("button", { "aria-label": "Language" }, "KR / EN") };
    if (name.endsWith("i18n/catalog")) return { PRODUCT_NAME: "랩비움" };
    if (name.endsWith("api/client")) return { getWorkspaceMode: () => "browser" };
    return require(name);
  };
  new Function("require", "module", "exports", code)(localRequire, navigationModule, navigationModule.exports);
  return navigationModule.exports.SidebarNavigation;
}

const navigationProps = {
  readerMode: false, collapsed: false, overlayMode: false, open: true,
  navigationRef: { current: null }, onNavigate() {}, onToggleCollapsed() {},
  readerPinned: false, onToggleReaderPinned() {}, onReaderClose() {}, onReaderEnter() {}, onReaderLeave() {},
};

test("tablet navigation renders an accessible dialog with every destination and an explicit close", async () => {
  const Navigation = await loadNavigation();
  const html = renderToStaticMarkup(React.createElement(Navigation, { ...navigationProps, overlayMode: true }));
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-label="Close navigation"/);
  assert.doesNotMatch(html, /aria-label="Collapse sidebar"|aria-label="Pin navigation"/);
  for (const destination of ["dashboard", "library", "workspace", "projects", "search", "discover", "assistant", "tags", "team", "maintenance", "settings"]) assert.match(html, new RegExp(`href="/${destination}"`));
  assert.match(html, /href="\/projects"[^>]*aria-current="page"/);
});

test("closed navigation is inert and desktop icon navigation retains accessible labels", async () => {
  const Navigation = await loadNavigation();
  const closed = renderToStaticMarkup(React.createElement(Navigation, { ...navigationProps, overlayMode: true, open: false }));
  assert.match(closed, /inert=""/);
  assert.doesNotMatch(closed, /role="dialog"|aria-modal="true"/);
  const collapsed = renderToStaticMarkup(React.createElement(Navigation, { ...navigationProps, collapsed: true }));
  assert.match(collapsed, /aria-label="Expand sidebar"/);
  assert.match(collapsed, /href="\/library"[^>]*aria-label="Library"/);
  assert.doesNotMatch(collapsed, /inert=""|role="dialog"/);
});

test("narrow menu reuses the focus trap, restores focus and locks only the open overlay", async () => {
  const source = await readFile(new URL("../app/components/AppShell.tsx", import.meta.url), "utf8");
  assert.match(source, /navigationModalOpen = narrowNavigation && sidebarOpen/);
  assert.match(source, /useModalFocus<HTMLElement>\(\{[\s\S]*?active: navigationModalOpen,[\s\S]*?onRequestClose: closeNavigation,[\s\S]*?restoreFocusRef: navigationTriggerRef/);
  assert.match(source, /if \(!navigationModalOpen\) return;[\s\S]*?document\.body\.style\.overflow = "hidden";[\s\S]*?document\.body\.style\.overflow = previousOverflow/);
  assert.match(source, /className="workspace-frame" inert=\{navigationModalOpen\}/);
  assert.match(source, /mobileSidebarPath === pathname/);
  assert.match(source, /className="skip-link"[^\n]*event\.preventDefault\(\)[^\n]*getElementById\("main-content"\)\?\.focus\(\)/);
  assert.match(source, /collapsed=\{readerRoute \|\| narrowNavigation \? false : normalSidebarCollapsed\}/);
});

test("responsive CSS preserves the Reader stage and provides local scrolling and touch geometry", async () => {
  const css = postcss.parse(await readFile(new URL("../app/globals.css", import.meta.url), "utf8"));
  const declarations = (selector, property, media) => {
    const values = [];
    css.walkRules(selector, (rule) => {
      if (media && rule.parent.params !== media) return;
      rule.walkDecls(property, (declaration) => values.push(declaration.value));
    });
    return values;
  };
  assert.ok(declarations(".toolbar", "flex-wrap").includes("wrap"));
  assert.ok(declarations(".toolbar > .library-filter-field, .toolbar > .library-toolbar__search", "flex", "(max-width: 48rem)").includes("0 0 auto"));
  assert.ok(declarations(".data-table-shell > table:not(.metadata-enrichment-table):not(.library-paper-table)", "min-width", "(max-width: 48rem)").includes("38rem"));
  assert.ok(declarations(".data-table-shell", "overflow-x").includes("auto"));
  assert.ok(declarations(".workspace-appbar", "position", "(max-width: 64rem)").includes("sticky"));
  assert.ok(declarations(":root", "--control-height", "(max-width: 64rem)").includes("2.75rem"));
  assert.ok(declarations(":root", "--font-size-base", "(max-width: 48rem)").includes("1.0625rem"));
  assert.ok(declarations('.reader-research-panel[data-collapsed="false"]', "position", "(max-width: 900px)").includes("absolute"));
  assert.ok(declarations(".reader-workspace__utilities", "grid-column", "(max-width: 48rem)").includes("1 / -1"));
  assert.ok(declarations(".reader-link-dialog", "overflow-y").includes("auto"));
  const singleColumn = '.reader-layout, .reader-layout--with-utility, .reader-layout[data-research-collapsed="true"], .reader-layout[data-research-collapsed="true"].reader-layout--with-utility';
  assert.ok(declarations(singleColumn, "grid-template-columns", "(max-width: 900px)").includes("minmax(0, 1fr)"));
  postcss.parse(await readFile(new URL("../demo/style.css", import.meta.url), "utf8"));
  postcss.parse(await readFile(new URL("../app/lib/workspace/workspace.css", import.meta.url), "utf8"));
});


test("nested navigation owns focus until it closes, then returns into the still-open research dialog", () => {
  const noteInput = { name: "research note" };
  const noteClose = { name: "close research panel" };
  const navigationTrigger = { name: "open navigation" };
  const researchDialog = {
    contains: (target) => target === noteInput || target === noteClose,
    querySelectorAll: () => [noteClose, noteInput],
  };
  const stack = createModalFocusStack();
  const research = stack.push(researchDialog);
  const navigation = stack.push({ name: "navigation dialog" });
  assert.equal(stack.isTop(research), false);
  assert.equal(stack.isTop(navigation), true);
  const removed = stack.remove(navigation);
  assert.equal(removed.wasTop, true);
  assert.equal(removed.next, research);
  assert.equal(modalRestoreTarget(removed.next.dialog, navigationTrigger, noteInput), noteInput);
  assert.equal(modalRestoreTarget(null, navigationTrigger, noteInput), navigationTrigger);
});

test("closing an underlying dialog cannot steal focus from a newer dialog", () => {
  const stack = createModalFocusStack();
  const underlying = stack.push({ name: "research panel" });
  const newer = stack.push({ name: "navigation" });
  assert.deepEqual(stack.remove(underlying), { wasTop: false, next: newer });
  assert.equal(stack.current(), newer);
  assert.deepEqual(stack.remove(newer), { wasTop: true, next: null });
  assert.deepEqual(stack.remove(underlying), { wasTop: false, next: null });
});
