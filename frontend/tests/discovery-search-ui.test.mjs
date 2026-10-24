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
    const loaded = { exports: {} }; cache.set(path, loaded.exports);
    function localRequire(name) {
      if (name.endsWith(".css")) return {};
      if (name === "react") return hooks;
      if (name === "next/navigation") return {useRouter:()=>router};
      if (name === "next/link") return {default: ({children, ...props}) => React.createElement("a", props, children)};
      if (name.endsWith("/api/client")) return { labviumRequest: request, getWorkspaceRole: () => "owner", apiClient: { getAllPapers: async () => [] } };
      if (name.endsWith("/i18n/LocaleProvider")) return { useI18n: () => ({ locale, t: value => value }) };
      if (!name.startsWith(".")) return require(name);
      const location = resolve(dirname(path), name);
      if (name.endsWith(".mjs")) return require(location);
      const found = [location, `${location}.tsx`, `${location}.ts`].find(existsSync);
      if (!found) throw new Error(`Missing dependency: ${location}`);
      return load(found);
    }
    new Function("require", "module", "exports", compiled)(localRequire, loaded, loaded.exports);
    cache.set(path, loaded.exports); return loaded.exports;
  }
  return load(fileURLToPath(new URL("../app/views/DiscoverView.tsx", import.meta.url)));
}
const surface = createSurface();
const criteria = { q: " Attention Is All You Need ", author: " Ashish Vaswani ", authorQuery: "Geoffrey Hinton", mode: "works", provider: "all", exactTitle: true, sort: "citations" };
const work = { id: "https://openalex.org/W12345", title: "Attention Is All You Need", authors: ["Ashish Vaswani", "Noam Shazeer"], year: "2017", publication_date: "2017-06-12", doi: "10.5555/original", abstract: "Original transformer study.", url: "https://arxiv.org/abs/1706.03762", pdf_url: "https://arxiv.org/pdf/1706.03762", journal: "NeurIPS", affiliations: ["Google Brain"], source: "OpenAlex", providers: ["OpenAlex", "arXiv"], cited_by_count: 1000, popularity_score: 100 };
const response = { items: [work, { ...work, id: "arxiv:2401.00001", authors: ["Different Author"], year: "2024", publication_date: "2024-01-01", doi: "", url: "https://arxiv.org/abs/2401.00001", affiliations: [], cited_by_count: null, popularity_score: null }], q: "Attention Is All You Need", provider: "all", total: 10, displayed_count: 2, provider_total: null, candidate_count: 60, duplicates_removed: 2, sort: "citations", sort_scope: "provider_candidates" };
const callbacks = { onRelated() {}, onSave() {}, onReturn() {} };

function renderResults(overrides = {}, applied = criteria) { return renderToStaticMarkup(React.createElement(surface.DiscoveryResults, { results: { ...response, ...overrides }, criteria: applied, ...callbacks })); }
test("search request combines title and author without leaking paper filters to author-profile lookup", () => {
  const params = new URL(surface.discoverySearchPath(criteria), "https://example.test").searchParams;
  assert.equal(params.get("q"), "Attention Is All You Need"); assert.equal(params.get("author"), "Ashish Vaswani");
  assert.equal(params.get("exact_title"), "1"); assert.equal(params.get("sort"), "citations"); assert.equal(params.get("provider"), "all");
  const authorParams = new URL(surface.discoverySearchPath({ ...criteria, mode: "authors" }), "https://example.test").searchParams;
  assert.equal(authorParams.get("q"), "Geoffrey Hinton"); assert.equal(authorParams.get("provider"), "openalex");
  for (const key of ["author", "exact_title", "sort"]) assert.equal(authorParams.has(key), false, key);
  const authorOnly = new URL(surface.discoverySearchPath({ ...criteria, q: "", exactTitle: false }), "https://example.test").searchParams;
  assert.equal(authorOnly.has("q"), false); assert.equal(authorOnly.get("author"), "Ashish Vaswani");
  assert.equal(new URL(surface.discoverySearchPath({ ...criteria, provider: "arxiv", sort: "popularity" }), "https://example.test").searchParams.get("sort"), "relevance");
});

test("rendered search results distinguish identical titles by authors, publication, venue, affiliation and identifiers", () => {
  const html = renderResults();
  assert.match(html, /Ashish Vaswani, Noam Shazeer/); assert.match(html, /Different Author/);
  assert.match(html, /2017-06-12/); assert.match(html, /2024-01-01/); assert.match(html, /NeurIPS/); assert.match(html, /Google Brain/);
  assert.match(html, /DOI: /); assert.match(html, /10\.5555\/original/); assert.match(html, /arXiv: 1706\.03762/);
  assert.match(html, /표시 2편/); assert.ok(!html.includes("표시 10편")); assert.ok(!html.includes("제공처 검색 결과"));
  assert.match(html, /검토 후보 60편/); assert.match(html, /동일 식별자 중복 2건/);
  assert.match(html, /적용 정렬: 인용수 많은 순/); assert.match(html, /전체 학술 데이터베이스의 순위가 아닙니다/);
  assert.match(html, /OpenAlex · arXiv/); assert.match(html, /Citations \(OpenAlex\): 1,000/); assert.match(html, /Citations \(OpenAlex\): Unavailable/);
  assert.match(html, /논문 보관함에 저장/); assert.match(html, /References/); assert.match(html, /Citing works/); assert.match(html, /Source PDF/);
});

test("popularity uses supplied annual citation score and never invents unavailable metrics", () => {
  const html = renderResults({ sort: "popularity", provider: "crossref", provider_total: 5000 }, { ...criteria, sort: "popularity" });
  assert.match(html, /연평균 인용수: 100/); assert.match(html, /연평균 인용수: Unavailable/);
  assert.match(html, /누적 인용 수 ÷ \(현재 연도 − 발행 연도 \+ 1\)/); assert.match(html, /조회수·다운로드 수나 논문의 정확성을 뜻하지 않습니다/);
  assert.match(html, /표시 2편/); assert.match(html, /제공처 검색 결과 5,000건/);
  const authorHtml = renderResults({ items: [{ id: "a", name: "Researcher", h_index: null, works_count: 2, cited_by_count: null }], provider: "openalex", provider_total: 1 }, { ...criteria, mode: "authors", authorQuery: "Researcher" });
  assert.match(authorHtml, /표시 1명/); assert.match(authorHtml, /저자 프로필: Researcher/);
  assert.ok(!authorHtml.includes("적용 정렬")); assert.ok(!authorHtml.includes("제목 정확히 일치"));
});

function hookController(request, index = { items: [] }) {
  const values = []; const cleanups = []; const routes = []; let cursor = 0;
  const hooks = { ...React,
    useState(initial) { const index = cursor++; if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial; return [values[index], next => { values[index] = typeof next === "function" ? next(values[index]) : next; }]; },
    useRef(initial) { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    useEffect(effect) { const index = cursor++; if (!(index in values)) { values[index] = true; cleanups.push(effect()); } },
  };
  const ui = createSurface({ request: (path, options) => path === "/papers/discovery-index" ? Promise.resolve(index) : request(path, options), hooks, router:{push:path=>routes.push(path)} });
  return { routes, render() { cursor = 0; return ui.DiscoverView(); }, unmount() { cleanups.forEach(cleanup => cleanup?.()); } };
}
function nodes(tree, predicate) {
  const found = [];
  function walk(value) { if (Array.isArray(value)) { value.forEach(walk); return; } if (!value || typeof value !== "object") return; if (predicate(value)) found.push(value); walk(value.props?.children); }
  walk(tree); return found;
}
function byText(tree, text) { return nodes(tree, node => node.props?.children === text)[0]; }
function paperInput(tree) { return nodes(tree, node => node.type === "input" && node.props.maxLength === 300)[0]; }
function authorInput(tree) { return nodes(tree, node => node.type === "input" && node.props.maxLength === 200)[0]; }
function form(tree) { return nodes(tree, node => node.type === "form")[0]; }
const settle = () => new Promise(resolve => setImmediate(resolve));

test("live form preserves multiword input, applies filters explicitly and keeps old result criteria through a failed search", async () => {
  const requests = [];
  const controller = hookController((path, options) => new Promise((resolve, reject) => { requests.push({ path, options, resolve, reject }); }));
  let tree = controller.render();
  const initialHtml = renderToStaticMarkup(tree); assert.match(initialHtml, /전체 출처/); assert.match(initialHtml, /제목 정확히 일치/); assert.match(initialHtml, /Ashish Vaswani/);
  paperInput(tree).props.onChange({ target: { value: "Attention Is All You Need " } }); tree = controller.render();
  assert.equal(paperInput(tree).props.value, "Attention Is All You Need ");
  authorInput(tree).props.onChange({ target: { value: "Ashish Vaswani " } }); tree = controller.render();
  assert.equal(authorInput(tree).props.value, "Ashish Vaswani ");
  form(tree).props.onSubmit({ preventDefault() {} }); assert.equal(requests.length, 1);
  requests[0].resolve(response); await settle(); tree = controller.render();
  const resultNode = nodes(tree, node => node.type === surface.DiscoveryResults || node.type?.name === "DiscoveryResults")[0];
  assert.equal(resultNode.props.criteria.author, "Ashish Vaswani");
  const select = nodes(tree, node => node.type === "select" && node.props.value === "relevance")[0]; select.props.onChange({ target: { value: "newest" } }); tree = controller.render();
  assert.equal(requests.length, 1); assert.match(renderToStaticMarkup(tree), /아래는 이전 검색 결과입니다/);
  assert.equal(nodes(tree, node => node.type?.name === "DiscoveryResults")[0].props.results.sort, "citations");
  form(tree).props.onSubmit({ preventDefault() {} }); assert.equal(requests.length, 2);
  assert.equal(new URL(requests[1].path, "https://example.test").searchParams.get("sort"), "newest");
  requests[1].reject(new Error("Search source unavailable")); await settle(); tree = controller.render();
  assert.match(renderToStaticMarkup(tree), /Search source unavailable/);
  assert.equal(nodes(tree, node => node.type?.name === "DiscoveryResults")[0].props.criteria.sort, "relevance");
  assert.equal(nodes(tree, node => node.type?.name === "DiscoveryResults")[0].props.results.sort, "citations");
  controller.unmount();
});

test("changing criteria and unmounting abort requests and prevent late responses from replacing results", async () => {
  const requests = [];
  const controller = hookController((path, options) => new Promise(resolve => requests.push({ path, options, resolve })));
  let tree = controller.render(); paperInput(tree).props.onChange({ target: { value: "old title" } }); tree = controller.render(); form(tree).props.onSubmit({ preventDefault() {} });
  tree = controller.render(); paperInput(tree).props.onChange({ target: { value: "new title" } }); assert.equal(requests[0].options.signal.aborted, true);
  requests[0].resolve(response); await settle(); tree = controller.render();
  assert.equal(nodes(tree, node => node.type?.name === "DiscoveryResults").length, 0);
  form(tree).props.onSubmit({ preventDefault() {} }); controller.unmount(); assert.equal(requests[1].options.signal.aborted, true);
  requests[1].resolve(response); await settle(); tree = controller.render();
  assert.equal(nodes(tree, node => node.type?.name === "DiscoveryResults").length, 0);
});

test("author profiles have an independent name field and arXiv clears unsupported citation sorting", () => {
  const controller = hookController(async () => response);
  let tree = controller.render(); paperInput(tree).props.onChange({ target: { value: "Paper title" } }); tree = controller.render();
  nodes(tree, node => node.type === "select" && node.props.value === "works")[0].props.onChange({ target: { value: "authors" } }); tree = controller.render();
  assert.equal(paperInput(tree).props.value, ""); assert.equal(authorInput(tree), undefined);
  assert.equal(nodes(tree, node => node.type === "input" && node.props.type === "checkbox").length, 0);
  paperInput(tree).props.onChange({ target: { value: "Geoffrey Hinton" } }); tree = controller.render();
  nodes(tree, node => node.type === "select" && node.props.value === "authors")[0].props.onChange({ target: { value: "works" } }); tree = controller.render();
  assert.equal(paperInput(tree).props.value, "Paper title");
  nodes(tree, node => node.type === "select" && node.props.value === "relevance")[0].props.onChange({ target: { value: "citations" } }); tree = controller.render();
  nodes(tree, node => node.type === "select" && node.props.value === "all")[0].props.onChange({ target: { value: "arxiv" } }); tree = controller.render();
  const sort = nodes(tree, node => node.type === "select" && node.props.value === "relevance")[0]; assert.ok(sort);
  const disabled = nodes(sort, node => node.type === "option" && node.props.disabled); assert.deepEqual(disabled.map(node => node.props.value), ["citations", "popularity"]);
  controller.unmount();
});


test("original-paper example searches all sources with the combined exact title and author", async () => {
  const requests = [];
  const controller = hookController(async (path) => { requests.push(path); return response; });
  let tree = controller.render();
  byText(tree, "예시 채우기 · Attention Is All You Need").props.onClick(); tree = controller.render();
  assert.equal(paperInput(tree).props.value, "Attention Is All You Need"); assert.equal(authorInput(tree).props.value, "Ashish Vaswani");
  assert.equal(nodes(tree, node => node.type === "input" && node.props.type === "checkbox")[0].props.checked, true);
  form(tree).props.onSubmit({ preventDefault() {} }); await settle();
  const params = new URL(requests[0], "https://example.test").searchParams;
  assert.equal(params.get("provider"), "all"); assert.equal(params.get("author"), "Ashish Vaswani"); assert.equal(params.get("exact_title"), "1");
  controller.unmount();
});


test("provider warning codes become readable bilingual partial-result guidance", () => {
  const warnings = ["openalex_unavailable", "crossref_unavailable", "arxiv_unavailable", "bounded_candidates_filtered", "popularity_is_annual_citations_within_candidates", "arxiv_citation_counts_unavailable"];
  const html = renderResults({ warnings });
  for (const warning of warnings) assert.ok(!html.includes(warning), warning);
  assert.match(html, /OpenAlex에 연결하지 못했습니다/); assert.match(html, /Crossref에 연결하지 못했습니다/); assert.match(html, /arXiv에 연결하지 못했습니다/);
  assert.match(html, /제목·저자 조건에 맞는 논문만 표시/); assert.match(html, /가져온 후보 안에서 연평균 인용수로 비교/); assert.match(html, /arXiv는 인용수를 제공하지 않습니다/);
  const english = createSurface({ locale: "en" });
  const englishHtml = renderToStaticMarkup(React.createElement(english.DiscoveryResults, { results: { ...response, warnings: [...warnings, "The source omitted some fields."] }, criteria, ...callbacks }));
  assert.match(englishHtml, /OpenAlex could not be reached/); assert.match(englishHtml, /Only retrieved candidates matching/); assert.match(englishHtml, /The source omitted some fields/);
  for (const warning of warnings) assert.ok(!englishHtml.includes(warning), warning);
});

test("saving creates an actual library paper, shows a stable saved check and direct destination, and blocks double clicks", async () => {
  const requests = [];
  const controller = hookController((path, options) => {
    if (path.startsWith("/discover?")) return Promise.resolve(response);
    return new Promise((resolve, reject) => requests.push({path, options, resolve, reject}));
  });
  let tree = controller.render(); paperInput(tree).props.onChange({target: {value: work.title}}); tree = controller.render(); form(tree).props.onSubmit({preventDefault(){}}); await settle(); tree = controller.render();
  let results = nodes(tree, node => node.type?.name === "DiscoveryResults")[0];
  results.props.onSave(work); results.props.onSave(work);
  assert.equal(requests.length, 1); assert.equal(requests[0].path, "/papers/from-discovery"); assert.deepEqual(requests[0].options.body, {work});
  requests[0].resolve({paper_id: "paper-original", keys: ["doi:10.5555/original"]}); await settle(); tree = controller.render();
  results = nodes(tree, node => node.type?.name === "DiscoveryResults")[0];
  const html = renderToStaticMarkup(React.createElement(surface.DiscoveryResults, results.props));
  assert.match(html, /저장 완료 ✔️/); assert.match(html, /저장 위치: 논문 보관함/); assert.match(html, /href="\/papers\/paper-original\?open=reader"/); assert.ok(!html.includes("Save as research page"));
  results.props.onSave({...work, id: "other-provider", doi: "https://doi.org/10.5555/ORIGINAL"}); assert.equal(requests.length, 1);
  controller.unmount();
});

test("saved identity index restores checks after reopening search; failed writes keep save available", async () => {
  const keys = ["doi:10.5555/original"];
  const controller = hookController(async (path) => path.startsWith("/discover?") ? response : Promise.reject(new Error("Save failed in test")), {items: [{paper_id:"saved-before-reload",keys}]});
  let tree = controller.render(); await settle(); paperInput(tree).props.onChange({target:{value:work.title}}); tree = controller.render(); form(tree).props.onSubmit({preventDefault(){}}); await settle(); tree=controller.render();
  const results=nodes(tree,node=>node.type?.name==="DiscoveryResults")[0];
  assert.equal(surface.savedDiscoveryPaper(work,results.props.savedPapers),"saved-before-reload");
  const other = {...work,id:"arxiv:2401.00001",doi:"",arxiv_id:"2401.00001",url:"https://arxiv.org/abs/2401.00001"};
  results.props.onSave(other); await settle(); tree=controller.render();
  assert.match(renderToStaticMarkup(tree),/Save failed in test/);
  const current=nodes(tree,node=>node.type?.name==="DiscoveryResults")[0]; assert.equal(surface.savedDiscoveryPaper(other,current.props.savedPapers),"");
  controller.unmount();
});

test("ambiguous saved identifiers never point at an arbitrary library paper", () => {
  const map = surface.discoverySavedMap([{paper_id:"one",keys:["doi:10.5555/original"]},{paper_id:"two",keys:["doi:10.5555/original"]}]);
  assert.equal(surface.savedDiscoveryPaper(work,map),"");
  assert.equal(surface.savedDiscoveryPaper(work,{"doi:10.5555/original":"one","arxiv:1706.03762":"two"}),"");
});

test("paper title opens its actual saved Paper into the automatic PDF reader flow", async()=>{
  const calls=[];const h=hookController(async(path,options)=>{calls.push({path,options});return path.startsWith('/discover?')?response:{paper_id:'open-paper',keys:['doi:10.5555/original']};});
  let tree=h.render();paperInput(tree).props.onChange({target:{value:work.title}});tree=h.render();form(tree).props.onSubmit({preventDefault(){}});await settle();tree=h.render();
  const row=nodes(tree,node=>node.type?.name==='DiscoveryResults')[0];row.props.onOpen(work,'reader');row.props.onOpen(work,'reader');await settle();
  assert.equal(calls.filter(call=>call.path==='/papers/from-discovery').length,1);assert.deepEqual(h.routes,['/papers/open-paper?open=reader']);
  h.unmount();
});
test("download request reuses saved identity and routes directly to PDF preparation without another save",async()=>{
  const calls=[];const h=hookController(async(path)=>{calls.push(path);return response;},{items:[{paper_id:'kept-paper',keys:['doi:10.5555/original']}]});
  let tree=h.render();await settle();paperInput(tree).props.onChange({target:{value:work.title}});tree=h.render();form(tree).props.onSubmit({preventDefault(){}});await settle();tree=h.render();
  nodes(tree,node=>node.type?.name==='DiscoveryResults')[0].props.onOpen(work,'download');await settle();assert.deepEqual(h.routes,['/papers/kept-paper?open=download']);assert.ok(!calls.includes('/papers/from-discovery'));h.unmount();
});

test("changing the search while a paper opens retains its save but cancels the old automatic navigation",async()=>{
  let complete;const h=hookController((path)=>path.startsWith('/discover?')?Promise.resolve(response):new Promise(resolve=>complete=resolve));let tree=h.render();paperInput(tree).props.onChange({target:{value:work.title}});tree=h.render();form(tree).props.onSubmit({preventDefault(){}});await settle();tree=h.render();nodes(tree,node=>node.type?.name==='DiscoveryResults')[0].props.onOpen(work,'reader');paperInput(tree).props.onChange({target:{value:'a newer research question'}});complete({paper_id:'saved-old-result',keys:['doi:10.5555/original']});await settle();tree=h.render();assert.equal(h.routes.length,0);assert.equal(nodes(tree,node=>node.type?.name==='DiscoveryResults')[0].props.savedPapers['doi:10.5555/original'],'saved-old-result');h.unmount();
});
