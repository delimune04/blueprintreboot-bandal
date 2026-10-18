import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function harness(downloadManagedPdf, locale = "en") {
  const values = [], cleanups = []; let cursor = 0, writes = 0;
  const hooks = { ...React,
    useState(initial) { const index = cursor++; if (!(index in values)) values[index] = initial; return [values[index], value => { writes++; values[index] = typeof value === "function" ? value(values[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    useEffect(effect) { const index = cursor++; if (!(index in values)) { values[index] = true; cleanups.push(effect()); } },
  };
  const source = readFileSync(new URL("../app/components/ReaderPdfDownload.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "react") return hooks;
    if (name.endsWith("/LocaleProvider")) return { useI18n: () => ({ locale }) };
    if (name.endsWith("/pdf-access.mjs")) return { downloadManagedPdf };
    return require(name);
  }, compiledModule, compiledModule.exports);
  return { render() { cursor = 0; return compiledModule.exports.ReaderPdfDownload({ paperId: "paper-1", title: "Saved research paper" }); }, unmount() { cleanups.forEach(cleanup => cleanup?.()); }, writes: () => writes };
}
function button(tree) { return tree.props.children[0]; }
const settle = () => new Promise(resolve => setImmediate(resolve));

test("Reader downloads the saved paper once per click sequence and reports handoff after completion", async () => {
  const calls = []; let complete;
  const ui = harness((...args) => { calls.push(args); return new Promise(resolve => { complete = resolve; }); });
  const trigger = button(ui.render()); trigger.props.onClick(); trigger.props.onClick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "paper-1"); assert.equal(calls[0][1], "Saved research paper"); assert.ok(calls[0][2] instanceof AbortSignal);
  assert.equal(button(ui.render()).props.disabled, true);
  assert.doesNotMatch(renderToStaticMarkup(ui.render()), /download has started/);
  complete(); await settle();
  assert.match(renderToStaticMarkup(ui.render()), /The PDF download has started/);
  assert.equal(button(ui.render()).props.disabled, false); ui.unmount();
});

test("failed PDF downloads show a retryable error and never claim a completed download", async () => {
  let calls = 0;
  const ui = harness(async () => { calls++; throw new Error("pdf_unavailable"); }, "ko");
  button(ui.render()).props.onClick(); await settle();
  const tree = ui.render(), html = renderToStaticMarkup(tree);
  assert.match(html, /PDF를 다운로드하지 못했습니다/); assert.doesNotMatch(html, /다운로드를 시작했습니다/);
  assert.equal(button(tree).props.disabled, false);
  button(tree).props.onClick(); await settle(); assert.equal(calls, 2); ui.unmount();
});

test("leaving Reader cancels the request and suppresses late download state", async () => {
  let signal, complete;
  const ui = harness((_id, _title, requestSignal) => { signal = requestSignal; return new Promise(resolve => { complete = resolve; }); });
  button(ui.render()).props.onClick(); ui.unmount();
  assert.equal(signal.aborted, true);
  const writesBeforeCompletion = ui.writes(); complete(); await settle();
  assert.equal(ui.writes(), writesBeforeCompletion);
});

test("PDF Reader offers download in both PDF.js and native fallback and recovers metadata-only papers through the implemented automatic reader flow", () => {
  const pdf = readFileSync(new URL("../app/components/PdfJsReader.tsx", import.meta.url), "utf8");
  const reader = readFileSync(new URL("../app/views/ReaderView.tsx", import.meta.url), "utf8");
  assert.equal((pdf.match(/<ReaderPdfDownload key=\{paperId\}/g) || []).length, 2);
  assert.match(reader, /paperTitle=\{snapshot\.paper\.title\}/);
  assert.match(reader, /snapshot\.paper\.metadata_only \? "\?open=reader" : ""/);
  assert.match(reader, /Reconnect the original PDF from paper details/);
});
