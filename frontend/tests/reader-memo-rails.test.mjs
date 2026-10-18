import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { fitWidthZoom } from "../app/lib/pdf/reader-controller.mjs";
import { createPdfViewportAnchor, scrollTopForPdfViewportAnchor } from "../app/lib/pdf/resize-anchor.mjs";

const pdfUrl = new URL("../app/components/PdfJsReader.tsx", import.meta.url);
const readerUrl = new URL("../app/views/ReaderView.tsx", import.meta.url);
const railsUrl = new URL("../app/components/ReaderMemoRails.css", import.meta.url);

function parse(source) {
  return ts.createSourceFile("Reader.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function descendants(root, predicate) {
  const matches = [];
  function visit(node) { if (predicate(node)) matches.push(node); ts.forEachChild(node, visit); }
  visit(root);
  return matches;
}
function opening(node) { return ts.isJsxElement(node) ? node.openingElement : node; }
function attribute(node, name) {
  return opening(node).attributes.properties.find(value => ts.isJsxAttribute(value) && value.name.text === name)?.initializer;
}
function className(node, expected) {
  const value = attribute(node, "className");
  return value && ts.isStringLiteral(value) && value.text.split(/\s+/).includes(expected);
}
function elements(tree) { return descendants(tree, node => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)); }
function cssRule(css, selector) {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const match = rules.find(([, actual]) => actual.trim() === selector);
  assert.ok(match, `Missing rule: ${selector}`);
  return match[2];
}
function sideRailWidths(css) {
  const rule = cssRule(css, '.reader-document-workspace[data-memo-visible="true"][data-memo-layout="side"]');
  const columns = rule.match(/grid-template-columns:\s*(\d+)px\s+minmax\(0,\s*1fr\)\s+(\d+)px/);
  assert.ok(columns, "Side memo rails must reserve actual columns around the shrinkable PDF center");
  return [Number(columns[1]), Number(columns[2])];
}

test("memo workspace keeps three labelled rails outside the single PDF scroll viewport", async () => {
  const tree = parse(await readFile(pdfUrl, "utf8"));
  const workspaces = elements(tree).filter(node => className(node, "reader-document-workspace"));
  assert.equal(workspaces.length, 1);
  const workspace = workspaces[0];
  for (const name of ["data-memo-layout", "data-memo-visible", "data-memo-paper-id"]) assert.ok(attribute(workspace, name), name);
  const children = workspace.children.filter(node => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node));
  assert.deepEqual(children.map(node => className(node, "reader-canvas-viewport") ? "PDF" : attribute(node, "data-memo-rail")?.text), ["left", "PDF", "right", "mobile"]);
  for (const rail of children.filter(node => attribute(node, "data-memo-rail"))) {
    assert.equal(opening(rail).tagName.getText(tree), "aside");
    assert.ok(attribute(rail, "aria-label"));
  }
  const viewport = children.find(node => className(node, "reader-canvas-viewport"));
  assert.equal(elements(viewport).filter(node => attribute(node, "data-memo-rail")).length, 0);
  assert.equal(elements(tree).filter(node => className(node, "reader-canvas-viewport")).length, 1);
});

test("side notes reserve 210px columns and narrow notes reserve a separate bottom row", async () => {
  const css = await readFile(railsUrl, "utf8");
  assert.deepEqual(sideRailWidths(css), [210, 210]);
  assert.match(cssRule(css, ".reader-document-workspace"), /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(cssRule(css, ".reader-memo-rail"), /position:\s*relative/);
  assert.doesNotMatch(css, /position:\s*(absolute|fixed)/);
  assert.match(cssRule(css, '.reader-document-workspace[data-memo-visible="true"][data-memo-layout="side"] > .reader-canvas-viewport'), /grid-column:\s*2/);
  assert.match(cssRule(css, '.reader-document-workspace[data-memo-visible="true"][data-memo-layout="bottom"]'), /grid-template-rows:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*0\.55fr\)/);
  assert.match(cssRule(css, '.reader-document-workspace[data-memo-visible="true"][data-memo-layout="bottom"] > .reader-memo-rail--mobile'), /grid-row:\s*2/);
});

test("fit width uses the remaining center width instead of drawing PDF underneath memo rails", async () => {
  const [leftWidth, rightWidth] = sideRailWidths(await readFile(railsUrl, "utf8"));
  const pageWidth = 600;
  for (const workspaceWidth of [900, 1100, 1320]) {
    const centerWidth = workspaceWidth - leftWidth - rightWidth;
    const withNotes = fitWidthZoom({ availableWidth: centerWidth, pageWidth, horizontalPadding: 48 });
    const withoutNotes = fitWidthZoom({ availableWidth: workspaceWidth, pageWidth, horizontalPadding: 48 });
    assert.ok(withNotes < withoutNotes);
    assert.ok(pageWidth * withNotes <= centerWidth - 48 + 0.000001);
    assert.ok(leftWidth + pageWidth * withNotes + 48 + rightWidth <= workspaceWidth + 0.000001);
  }
  const source = await readFile(pdfUrl, "utf8");
  assert.match(source, /fitWidthZoom\(\{\s*availableWidth:\s*viewport\.clientWidth/);
  assert.match(source, /workspace\.clientWidth\s*>=\s*900\s*\?\s*"side"\s*:\s*"bottom"/);
  assert.match(source, /observer\.observe\(workspace\)/);
});

test("showing and hiding rails preserves the same page-relative reading anchor at each fit width", async () => {
  const rails = sideRailWidths(await readFile(railsUrl, "utf8"));
  const pageNumber = 7, pageWidth = 600, pageHeight = 800, viewportHeight = 700, gap = 16;
  let zoom = fitWidthZoom({ availableWidth: 1320, pageWidth, horizontalPadding: 48 });
  let renderedHeight = pageHeight * zoom;
  let pageTop = (pageNumber - 1) * (renderedHeight + gap);
  let scrollTop = pageTop + renderedHeight * 0.62 - viewportHeight / 2;
  for (const availableWidth of [1320 - rails[0] - rails[1], 1320, 900 - rails[0] - rails[1]]) {
    const anchor = createPdfViewportAnchor({ pageNumber, pageTop, pageHeight: renderedHeight, viewportTop: scrollTop, viewportHeight });
    assert.equal(anchor.pageNumber, pageNumber);
    assert.ok(Math.abs(anchor.relativePageOffset - 0.62) < 1e-12);
    zoom = fitWidthZoom({ availableWidth, pageWidth, horizontalPadding: 48 });
    renderedHeight = pageHeight * zoom;
    pageTop = (pageNumber - 1) * (renderedHeight + gap);
    scrollTop = scrollTopForPdfViewportAnchor({ pageTop, pageHeight: renderedHeight, relativePageOffset: anchor.relativePageOffset, viewportAnchorOffset: anchor.viewportAnchorOffset });
    assert.ok(Math.abs((scrollTop + viewportHeight / 2 - pageTop) / renderedHeight - 0.62) < 1e-12);
  }
});

test("bottom notes keep the same source at viewport center when available reading height changes", async () => {
  const pageNumber = 4, pageTop = 2400, pageHeight = 900, relativePageOffset = 0.68;
  let height = 620;
  let scrollTop = pageTop + pageHeight * relativePageOffset - height / 2;
  for (const nextHeight of [400, 620, 300, 540]) {
    const anchor = createPdfViewportAnchor({ pageNumber, pageTop, pageHeight, viewportTop: scrollTop, viewportHeight: height });
    scrollTop = scrollTopForPdfViewportAnchor({ pageTop, pageHeight, relativePageOffset: anchor.relativePageOffset, viewportAnchorOffset: nextHeight / 2 });
    assert.ok(Math.abs((scrollTop + nextHeight / 2 - pageTop) / pageHeight - relativePageOffset) < 1e-12);
    height = nextHeight;
  }
  const source = await readFile(pdfUrl, "utf8");
  assert.match(source, /viewportAnchorOffset:\s*viewport\.clientHeight\s*\/\s*2/);
});

test("memo visibility and responsive layout do not restart the PDF loading effect", async () => {
  const source = await readFile(pdfUrl, "utf8"), tree = parse(source);
  const loadingEffects = descendants(tree, node => ts.isCallExpression(node) && node.expression.getText(tree) === "useEffect" && node.arguments[0]?.getText(tree).includes("createPdfLoadingTask(pdfUrl)"));
  assert.equal(loadingEffects.length, 1);
  const deps = loadingEffects[0].arguments[1];
  assert.ok(deps && ts.isArrayLiteralExpression(deps));
  assert.deepEqual(deps.elements.map(node => node.getText(tree)), ["fallbackActive", "loadAttempt", "paperId", "pdfUrl"]);
  assert.match(source, /captureLayoutAnchor\(\);\s*memoLayoutRef\.current\s*=\s*next;\s*setMemoLayout\(next\)/);
  assert.match(source, /memoLayout,\s*memoRailsVisible,\s*restoreLayoutAnchor/);
});

test("native fallback retains memo actions and rail destinations while suppressing inaccessible selection actions", async () => {
  const source = await readFile(pdfUrl, "utf8"), tree = parse(source);
  const workspace = elements(tree).find(node => className(node, "reader-document-workspace"));
  const viewport = elements(workspace).find(node => className(node, "reader-canvas-viewport"));
  assert.ok(attribute(workspace, "data-native-fallback"));
  assert.match(viewport.getText(tree), /\{fallbackContent\}/);
  assert.match(source, /fallbackContent\s*=\s*<NativePdfFallback/);
  assert.doesNotMatch(source, /if\s*\(fallbackActive\)\s*return\s*<NativePdfFallback/);
  assert.match(source, /\{!fallbackActive\s*\?\s*selectionActions\s*:\s*null\}/);
  assert.match(source, /\{annotationActions\}\s*<div[^>]*className="reader-document-workspace"/);
  assert.match(source, /!fallbackActive\s*&&\s*pdfDocument\s*\?/);
});

test("Reader memo visibility callback captures the PDF anchor before changing rail visibility", async () => {
  const source = await readFile(readerUrl, "utf8"), tree = parse(source);
  const memo = elements(tree).find(node => opening(node).tagName.getText(tree) === "ReaderFloatingMemos");
  const reader = elements(tree).find(node => opening(node).tagName.getText(tree) === "PdfJsReader");
  assert.ok(memo);
  assert.ok(attribute(memo, "onVisibilityChange"));
  assert.ok(reader && attribute(reader, "memoRailsVisible"));
  const callback = attribute(memo, "onVisibilityChange");
  const callbackText = callback.expression?.getText(tree);
  assert.ok(callbackText);
  const callbackDeclaration = descendants(tree, node => ts.isVariableDeclaration(node) && node.name.getText(tree) === callbackText)[0];
  const body = callbackDeclaration?.initializer?.getText(tree) ?? callbackText;
  assert.match(body, /capturePdfLayoutAnchorRef\.current\?\.\(\)/);
  assert.match(body, /setMemoRailsVisible\(/);
  assert.ok(body.indexOf("capturePdfLayoutAnchorRef.current") < body.indexOf("setMemoRailsVisible("));
});
