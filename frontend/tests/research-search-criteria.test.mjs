import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function createSurface({ request = async () => { throw new Error("Rendering must not run a search"); }, locale = "ko", hooks = React, router = {push(){}} } = {}) {
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    const compiledModule = { exports: {} }; cache.set(path, compiledModule.exports);
    function localRequire(name) {
      if (name.endsWith(".css")) return {};
      if (name === "react") return hooks;
      if (name === "next/navigation") return {useRouter:()=>router};
      if (name === "next/link") return {default: ({children, ...props}) => React.createElement("a", props, children)};
      if (name.endsWith("/api/client")) return { labviumRequest: request, getWorkspaceRole: () => "owner", getWorkspaceMode: () => "browser", getWorkspaceStorageScope: () => "test:workspace", apiClient: { getAllPapers: async () => [] } };
      if (name.endsWith("/i18n/LocaleProvider")) return { useI18n: () => ({ locale, t: value => value }) };
      if (!name.startsWith(".")) return require(name);
      const location = resolve(dirname(path), name);
      if (name.endsWith(".mjs")) return require(location);
      const found = [location, `${location}.tsx`, `${location}.ts`].find(existsSync);
      if (!found) throw new Error(`Missing dependency: ${location}`);
      return load(found);
    }
    new Function("require", "module", "exports", compiled)(localRequire, compiledModule, compiledModule.exports);
    cache.set(path, compiledModule.exports); return compiledModule.exports;
  }
  return load(fileURLToPath(new URL("../app/views/SearchView.tsx", import.meta.url)));
}
function hookController(request, locale = "ko") {
  const values = []; const cleanups = []; const routes = []; let cursor = 0;
  const hooks = { ...React,
    useState(initial) { const index = cursor++; if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial; return [values[index], next => { values[index] = typeof next === "function" ? next(values[index]) : next; }]; },
    useRef(initial) { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    useEffect(effect, deps) { const index = cursor++; const prior = values[index]; if (!prior || !deps || deps.some((value, i) => !Object.is(value, prior[i]))) { cleanups[index]?.(); values[index] = deps || []; cleanups[index] = effect(); } },
  };
  const ui = createSurface({ request, hooks, locale });
  return { routes, render() { cursor = 0; return ui.SearchView(); }, unmount() { cleanups.forEach(cleanup => cleanup?.()); } };
}
function nodes(tree, predicate) {
  const found = [];
  function walk(value) { if (Array.isArray(value)) { value.forEach(walk); return; } if (!value || typeof value !== "object") return; if (predicate(value)) found.push(value); walk(value.props?.children); }
  walk(tree); return found;
}
const input = tree => nodes(tree, n => n.type === 'input')[0];
const form = tree => nodes(tree, n => n.type === 'form')[0];
const html = tree => renderToStaticMarkup(tree);
const settle = () => new Promise(resolve => setImmediate(resolve));
const row = {id:'evidence',url:'/papers/example/reader',title:'Evidence',kind:'note-block',page:2,snippet:'A saved finding'};
function edit(h, value) { input(h.render()).props.onChange({target:{value}}); return h.render(); }
function submit(h) { form(h.render()).props.onSubmit({preventDefault(){}}); return h.render(); }
function fixture(locale='ko') {
  const requests=[];
  const h=hookController((path,options)=>new Promise((resolve,reject)=>requests.push({path,options,resolve,reject})),locale);
  return {h,requests};
}
test('initial render is passive, whitespace search disabled and empty submit makes no request',()=>{
  const {h,requests}=fixture(); assert.doesNotMatch(html(h.render()),/적용 검색어/);
  edit(h,'   '); submit(h); assert.equal(requests.length,0);
  assert.ok(nodes(h.render(), n=>n.type==='button' && n.props.disabled).length);
});
test('results retain captured submitted query when input changes during a request',async()=>{
  const {h,requests}=fixture(); edit(h,' caprock '); submit(h);
  assert.equal(new URL(requests[0].path,'https://example.test').searchParams.get('q'),'caprock');
  edit(h,'muon'); assert.match(html(h.render()),/“caprock” 검색 중/);
  requests[0].resolve({items:[row]}); await settle();
  const output=html(h.render()); assert.match(output,/적용 검색어.*<strong>caprock<\/strong>/); assert.match(output,/아래는 이전 검색 결과/); assert.match(output,/value="muon"/);
  assert.match(output,/papers\/example\/reader/); assert.match(output,/p\. 2/);
  assert.equal(requests.length,1); h.unmount();
});
test('editing back to applied query removes pending warning, including outer whitespace',async()=>{
  const {h,requests}=fixture(); edit(h,'caprock'); submit(h); requests[0].resolve({items:[row]}); await settle();
  edit(h,'different'); assert.match(html(h.render()),/검색어가 바뀌었습니다/);
  edit(h,' caprock '); assert.doesNotMatch(html(h.render()),/검색어가 바뀌었습니다/);
  assert.equal(requests.length,1); h.unmount();
});
test('failed retry identifies failed query and preserves last successful results and their query',async()=>{
  const {h,requests}=fixture(); edit(h,'caprock'); submit(h); requests[0].resolve({items:[row]}); await settle();
  edit(h,'muon'); submit(h); requests[1].reject(new Error('Offline test')); await settle();
  const output=html(h.render()); assert.match(output,/“muon” 검색에 실패/); assert.match(output,/Offline test/); assert.match(output,/마지막으로 성공한/); assert.match(output,/<strong>caprock<\/strong>/); assert.match(output,/Evidence/);
  submit(h); assert.doesNotMatch(html(h.render()),/Offline test/); requests[2].resolve({items:[]}); await settle();
  assert.match(html(h.render()),/<strong>muon<\/strong>/); assert.match(html(h.render()),/검색 결과 0개/); assert.doesNotMatch(html(h.render()),/Evidence/); h.unmount();
});
test('empty results still identify their applied query and changed input',async()=>{
  const {h,requests}=fixture(); edit(h,'absent'); submit(h); requests[0].resolve({items:[]}); await settle();
  edit(h,''); assert.match(html(h.render()),/일치하는 자료가 없습니다/); assert.match(html(h.render()),/<strong>absent<\/strong>/); assert.match(html(h.render()),/이전 검색 결과/); h.unmount();
});
test('superseded response cannot replace newer results or clear its loading state',async()=>{
  const {h,requests}=fixture(); edit(h,'first'); submit(h); edit(h,'second'); submit(h);
  assert.equal(requests[0].options.signal.aborted,true); requests[0].resolve({items:[row]}); await settle();
  assert.match(html(h.render()),/“second” 검색 중/); assert.doesNotMatch(html(h.render()),/적용 검색어/);
  requests[1].resolve({items:[]}); await settle(); assert.match(html(h.render()),/<strong>second<\/strong>/); h.unmount();
});
test('unmount aborts in-flight requests and ignores late data',async()=>{
  const {h,requests}=fixture(); edit(h,'caprock'); submit(h); h.unmount();
  assert.equal(requests[0].options.signal.aborted,true); requests[0].resolve({items:[row]}); await settle(); assert.doesNotMatch(html(h.render()),/적용 검색어/);
});
test('English labels and escaped query do not inject HTML',async()=>{
  const {h,requests}=fixture('en'); edit(h,'<img src=x>'); submit(h); requests[0].resolve({items:[]}); await settle();
  edit(h,'new term'); const output=html(h.render()); assert.match(output,/Applied search term/); assert.match(output,/Choose Search to apply/); assert.match(output,/&lt;img src=x&gt;/); assert.doesNotMatch(output,/<img src=x>/); h.unmount();
});

function historyBrowser(state = null) {
  const listeners = new Map();
  const writes = [];
  return {
    location: {pathname:'/LabVium/search'},
    history: {state, replaceState(next, title, url) { this.state=next; writes.push({next,title,url}); }},
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name,new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    dispatch(name) { listeners.get(name)?.forEach(fn=>fn()); }, writes,
    listeners,
  };
}
const historyKey='labvium.research-search.v1';
function withBrowser(state, run) {
  const previous=globalThis.window;
  const browser=historyBrowser(state); globalThis.window=browser;
  return Promise.resolve().then(()=>run(browser)).finally(()=>{ if(previous===undefined)delete globalThis.window;else globalThis.window=previous; });
}
test('history restores query after mount without requests or cached results and preserves router fields on edit',()=>withBrowser({router:{index:3},[historyKey]:{scope:'browser:test:workspace',query:' caprock '}},async browser=>{
  const {h,requests}=fixture(); h.render();
  assert.match(html(h.render()),/value=" caprock "/); assert.match(html(h.render()),/검색어를 복원했습니다/);
  assert.equal(requests.length,0); assert.equal(browser.writes.length,0);
  edit(h,'new term'); assert.equal(browser.history.state.router.index,3); assert.equal(browser.history.state[historyKey].query,'new term');
  assert.equal(browser.writes[0].url,undefined); assert.doesNotMatch(html(h.render()),/검색어를 복원했습니다/);
  edit(h,''); assert.equal(browser.history.state[historyKey].query,'');
  h.unmount(); assert.equal([...browser.listeners.values()].every(set=>!set.size),true);
}));
test('popstate restore aborts pending request and ignores its late data, then searches only on submit',()=>withBrowser(null,async browser=>{
  const {h,requests}=fixture(); h.render(); edit(h,'first'); submit(h);
  browser.history.state={[historyKey]:{scope:'browser:test:workspace',query:'restored'}}; browser.dispatch('popstate');
  assert.equal(requests[0].options.signal.aborted,true); requests[0].resolve({items:[row]}); await settle();
  const output=html(h.render()); assert.match(output,/value="restored"/); assert.doesNotMatch(output,/Evidence|검색 중|적용 검색어/);
  submit(h); assert.equal(requests.length,2); requests[1].resolve({items:[]}); await settle();
  assert.match(html(h.render()),/<strong>restored<\/strong>/); h.unmount();
}));
test('other workspace history and new history entry start empty, without leaking old results',()=>withBrowser({[historyKey]:{scope:'cloud:another:workspace',query:'private query'}},async browser=>{
  const {h,requests}=fixture(); h.render(); assert.equal(input(h.render()).props.value,'');
  edit(h,'caprock'); submit(h); requests[0].resolve({items:[row]}); await settle();
  browser.history.state=null; browser.dispatch('popstate'); assert.equal(input(h.render()).props.value,''); assert.doesNotMatch(html(h.render()),/Evidence/); h.unmount();
}));
test('unrelated navigation does not restore or write onto destination history',()=>withBrowser(null,async browser=>{
  const {h}=fixture();h.render(); edit(h,'caprock'); const count=browser.writes.length;
  browser.location.pathname='/LabVium/library'; browser.history.state={router:'destination'}; browser.dispatch('bandal-demo:navigation');
  assert.equal(input(h.render()).props.value,'caprock'); assert.equal(browser.writes.length,count);
  edit(h,'late edit'); assert.deepEqual(browser.history.state,{router:'destination'}); h.unmount();
}));
test('unavailable history does not prevent an explicit search',()=>withBrowser(null,async browser=>{
  Object.defineProperty(browser.history,'state',{get(){throw Error('Unavailable');}});
  const {h,requests}=fixture();h.render();edit(h,'caprock');submit(h);
  assert.equal(requests.length,1); requests[0].resolve({items:[row]});await settle();assert.match(html(h.render()),/Evidence/);h.unmount();
}));
test('English restored notice is explicit and query HTML remains escaped',()=>withBrowser({[historyKey]:{scope:'browser:test:workspace',query:'<img src=x>'}},async()=>{
  const {h}=fixture('en');h.render();const output=html(h.render());assert.match(output,/Search term restored. Choose Search/);assert.doesNotMatch(output,/<img src=x>/);h.unmount();
}));
