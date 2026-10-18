import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as reference from "../app/lib/workspace/paper-reference.mjs";
const require = createRequire(import.meta.url);
function harness(locale = "en") {
  const states = []; const refs = []; let stateIndex = 0; let refIndex = 0;
  const hooks = {...React, useState(initial) { const id = stateIndex++; if (!(id in states)) states[id] = initial; return [states[id], value => { states[id] = value; }]; }, useRef(initial) { const id = refIndex++; refs[id] ||= {current: initial}; return refs[id]; }};
  const code = ts.transpileModule(readFileSync(new URL("../app/components/PaperReferenceActions.tsx", import.meta.url), "utf8"), {reportDiagnostics: true, compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022}});
  assert.deepEqual(code.diagnostics, []);
  const module = {exports: {}};
  new Function("require", "module", "exports", code.outputText)(name => name === "react" ? hooks : name.endsWith("LocaleProvider") ? {useI18n: () => ({locale})} : name.endsWith("paper-reference.mjs") ? reference : require(name), module, module.exports);
  return {refs, render() { stateIndex = 0; refIndex = 0; return module.exports.PaperReferenceActions({paper: {title:"A <test>",authors:["Kim"],year:"2026"}}); }};
}
function find(node, type) { if (!node || typeof node !== "object") return null; if (node.type === type) return node; for (const child of React.Children.toArray(node.props?.children)) {const found = find(child,type); if(found) return found;} return null; }
test("renders a labelled read-only preview and bilingual copy controls without raw HTML injection", () => {
 for(const [locale, label] of [["en","Copy reference"],["ko","서지정보 복사"]]) {const h=harness(locale); const html=renderToStaticMarkup(h.render()); assert.ok(html.includes(label)); assert.ok(html.includes("A &lt;test&gt;")); assert.match(html, /<label/); assert.match(html, /readonly/i); assert.match(html, /aria-live="polite"/);}
});
test("clipboard rejection selects preview and reports the fallback without a success message", async () => {
 const h=harness(); let focused=0,selected=0; const tree=h.render(); h.refs[0].current={focus(){focused++;},select(){selected++;}};
 const original=Object.getOwnPropertyDescriptor(globalThis,"navigator"); Object.defineProperty(globalThis,"navigator",{value:{clipboard:{writeText:async()=>{throw new Error("denied");}}},configurable:true});
 try { await find(tree,"button").props.onClick(); await new Promise(resolve=>setImmediate(resolve)); const html=renderToStaticMarkup(h.render()); assert.equal(focused,1); assert.equal(selected,1); assert.match(html,/Automatic copy is unavailable/); assert.ok(!html.includes("Reference copied.")); } finally {if(original)Object.defineProperty(globalThis,"navigator",original);else delete globalThis.navigator;}
});
test("clipboard success includes exactly the displayed text", async () => {
 const h=harness("ko"); const tree=h.render(); let copied=""; const original=Object.getOwnPropertyDescriptor(globalThis,"navigator"); Object.defineProperty(globalThis,"navigator",{value:{clipboard:{writeText:async text=>{copied=text;}}},configurable:true});
 try {find(tree,"button").props.onClick(); await new Promise(resolve=>setImmediate(resolve)); assert.equal(copied,find(tree,"textarea").props.value); assert.match(renderToStaticMarkup(h.render()),/서지정보를 복사했습니다/);} finally {if(original)Object.defineProperty(globalThis,"navigator",original);else delete globalThis.navigator;}
});
