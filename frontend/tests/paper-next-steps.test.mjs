import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { appendPaperTrail, openAlexWorkId, paperExplorationSource, relatedSearchPath } from "../app/lib/workspace/paper-next-steps.mjs";

const require = createRequire(import.meta.url);
const work = { id: "https://openalex.org/W1", openalex_id: "W1", title: "Carbon storage", authors: ["A. Researcher"], year: "2020", doi: "10.1234/one", topics: ["Carbon storage", "Geology"], url: "https://example.test/paper", pdf_url: "", abstract: "Test abstract", source: "OpenAlex" };
const nextWork = { ...work, id: "https://openalex.org/W2", openalex_id: "W2", title: "Reservoir connectivity", doi: "10.1234/two" };
const paper = { ...work, paper_id: "paper-one", keywords: [], tags: [], external_source: work, status: "reading", project_links: [], authors: work.authors };
const project = { project_id: "project-one", name: "CCS", status: "active", links: [], links_revision: "links-7" };

test("reference requests require an exact work identity; topic searches explicitly use bounded title/topic candidates", () => {
  assert.equal(openAlexWorkId({ id: "https://openalex.org/W12?fake=1" }), "");
  assert.equal(openAlexWorkId({ id: "https://openalex.org/W12" }), "W12");
  assert.equal(relatedSearchPath({ ...work, openalex_id: "", id: "arxiv:1234.5555" }, "references"), "");
  const citation = new URL(relatedSearchPath(work, "cited_by"), "https://example.test");
  assert.equal(citation.searchParams.get("openalex_id"), "W1"); assert.equal(citation.searchParams.get("relation"), "cited_by");
  const topic = new URL(relatedSearchPath(work, "similar"), "https://example.test");
  assert.equal(topic.searchParams.get("q"), "Carbon storage Geology"); assert.equal(topic.searchParams.get("limit"), "12");
  assert.equal(paperExplorationSource({ ...paper, title: "Edited title", doi: "10.1234/edited" }).doi, "10.1234/edited");
});

test("paper trail retains prior results and folds repeated steps without losing earlier context", () => {
  const first = { work, relation: "references", response: { items: [nextWork] } };
  const second = { work: nextWork, relation: "cited_by", response: { items: [] } };
  const path = appendPaperTrail([first], second);
  assert.deepEqual(path, [first, second]);
  assert.deepEqual(appendPaperTrail(path, { ...first, response: { items: [] } }), [{ ...first, response: { items: [] } }]);
  assert.deepEqual(path[0].response.items, [nextWork]);
});

function createHarness({ request, api = {}, role = "owner", locale = "en" } = {}) {
  const values = []; const effects = []; let cursor = 0;
  const hooks = { ...React,
    useState(initial) { const index = cursor++; if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial; return [values[index], next => { values[index] = typeof next === "function" ? next(values[index]) : next; }]; },
    useRef(initial) { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    useId() { return "test-project-selector"; },
    useEffect(effect) { const index = cursor++; if (!(index in values)) { values[index] = true; effects.push(effect); } },
  };
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    const loaded = { exports: {} }; cache.set(path, loaded.exports);
    const localRequire = name => {
      if (name.endsWith(".css")) return {};
      if (name === "react") return hooks;
      if (name.endsWith("/api/client")) return { labviumRequest: request || (async () => ({ items: [] })), getWorkspaceRole: () => role, apiClient: { getPaper: async () => paper, getAllProjects: async () => [project], getCompleteProject: async () => project, ...api } };
      if (name.endsWith("/i18n/LocaleProvider")) return { useI18n: () => ({ locale }) };
      if (!name.startsWith(".")) return require(name);
      const location = resolve(dirname(path), name);
      if (name.endsWith(".mjs")) return require(location);
      const found = [location, `${location}.tsx`, `${location}.ts`].find(existsSync);
      if (!found) throw new Error(`Missing dependency ${location}`);
      return load(found);
    };
    new Function("require", "module", "exports", compiled)(localRequire, loaded, loaded.exports);
    cache.set(path, loaded.exports); return loaded.exports;
  }
  const Component = load(fileURLToPath(new URL("../app/components/PaperNextSteps.tsx", import.meta.url))).PaperNextSteps;
  let cleanups = [];
  return { render() { cursor = 0; const keyed = Component({ paperId: paper.paper_id }); return keyed.type(keyed.props); }, effects() { cleanups = effects.splice(0).map(effect => effect()); }, unmount() { cleanups.forEach(cleanup => cleanup?.()); } };
}
function nodes(tree, predicate) {
  const found = [];
  function walk(value) { if (Array.isArray(value)) return value.forEach(walk); if (!value || typeof value !== "object") return; if (predicate(value)) found.push(value); walk(value.props?.children); }
  walk(tree); return found;
}
function textOf(node) { if (Array.isArray(node)) return node.map(textOf).join(""); if (typeof node === "string") return node; return node && typeof node === "object" ? textOf(node.props?.children) : ""; }
function control(tree, label) { return nodes(tree, node => node.type === "button" && textOf(node) === label)[0]; }
const settle = () => new Promise(resolve => setImmediate(resolve));
async function mount(harness) { harness.render(); harness.effects(); await settle(); return harness.render(); }

test("saved recommendation identities survive a fresh mount and never issue another save", async () => {
  const requests = [];
  const harness = createHarness({ request: async (path, options) => {
    requests.push({ path, options });
    return path === "/papers/discovery-index" ? { items: [{ paper_id: "saved-two", keys: ["doi:10.1234/two"] }] } : { items: [work, nextWork], provider: "OpenAlex" };
  } });
  let tree = await mount(harness);
  control(tree, "Start with references").props.onClick(); await settle(); tree = harness.render();
  assert.ok(control(tree, "Saved ✔").props.disabled);
  assert.ok(!control(tree, "Save to paper library"));
  assert.match(renderToStaticMarkup(tree), /\/papers\/saved-two/);
  assert.equal(nodes(tree, node => node.type === "li").length, 1, "current paper is excluded from its recommendations");
  assert.ok(requests.every(item => item.options?.method !== "POST")); harness.unmount();
});

test("saving uses the library command and replaces the action with a saved indicator and destination", async () => {
  const writes = [];
  const harness = createHarness({ request: async (path, options) => {
    if (path === "/papers/discovery-index") return { items: [] };
    if (options?.method === "POST") { writes.push({ path, options }); return { status: "saved", paper_id: "saved-two", keys: ["doi:10.1234/two"] }; }
    return { items: [nextWork], provider: "OpenAlex" };
  } });
  let tree = await mount(harness); control(tree, "Start with references").props.onClick(); await settle(); tree = harness.render();
  control(tree, "Save to paper library").props.onClick(); await settle(); tree = harness.render();
  assert.equal(writes.length, 1); assert.equal(writes[0].path, "/papers/from-discovery"); assert.deepEqual(writes[0].options.body, { work: nextWork });
  assert.ok(control(tree, "Saved ✔").props.disabled); assert.match(renderToStaticMarkup(tree), /Open saved paper/); harness.unmount();
});

test("a viewer can explore but cannot save papers or connect a project", async () => {
  const harness = createHarness({ role: "viewer", request: async path => path === "/papers/discovery-index" ? { items: [] } : { items: [nextWork], provider: "OpenAlex" } });
  let tree = await mount(harness); assert.equal(control(tree, "Start with references").props.disabled, false);
  control(tree, "Start with references").props.onClick(); await settle(); tree = harness.render();
  assert.equal(control(tree, "Save to paper library").props.disabled, true); assert.equal(control(tree, "Link to project").props.disabled, true);
  assert.match(renderToStaticMarkup(tree), /read-only access/); harness.unmount();
});

test("linking reads a coherent project revision, preserves the selected role and skips existing paper links", async () => {
  const writes = [];
  const harness = createHarness({ api: { addProjectPaperLink: async (...args) => { writes.push(args); } } });
  let tree = await mount(harness);
  const selectors = nodes(tree, node => node.type === "select");
  selectors[0].props.onChange({ target: { value: project.project_id } });
  selectors[1].props.onChange({ target: { value: "key_reference" } }); tree = harness.render();
  nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); await settle(); tree = harness.render();
  assert.deepEqual(writes, [[project.project_id, paper.paper_id, "key_reference", "links-7"]]);
  assert.equal(control(tree, "Linked ✔").props.disabled, true); harness.unmount();
  const duplicateHarness = createHarness({ api: { getCompleteProject: async () => ({ ...project, links: [{ target_type: "paper", paper_id: paper.paper_id }] }), addProjectPaperLink: async () => { throw new Error("Duplicate paper must not be written"); } } });
  tree = await mount(duplicateHarness); nodes(tree, node => node.type === "select")[0].props.onChange({ target: { value: project.project_id } }); tree = duplicateHarness.render();
  nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); await settle(); tree = duplicateHarness.render();
  assert.match(renderToStaticMarkup(tree), /already linked/); duplicateHarness.unmount();
});

test("legacy ambiguous saved identifiers never silently open one of the duplicate papers", async () => {
  const harness = createHarness({ request: async path => path === "/papers/discovery-index" ? { items: [{ paper_id: "duplicate-a", keys: ["doi:10.1234/two"] }, { paper_id: "duplicate-b", keys: ["doi:10.1234/two"] }] } : { items: [nextWork], provider: "OpenAlex" } });
  let tree = await mount(harness); control(tree, "Start with references").props.onClick(); await settle(); tree = harness.render();
  assert.ok(control(tree, "Save to paper library")); assert.equal(control(tree, "Saved ✔"), undefined);
  const html = renderToStaticMarkup(tree); assert.ok(!html.includes("/papers/duplicate-a")); assert.ok(!html.includes("/papers/duplicate-b")); harness.unmount();
});

test("a rapid repeated project submit starts only one canonical write", async () => {
  const writes = []; let finishRead;
  const harness = createHarness({ api: { getCompleteProject: () => new Promise(resolve => { finishRead = resolve; }), addProjectPaperLink: async (...args) => { writes.push(args); } } });
  let tree = await mount(harness); nodes(tree, node => node.type === "select")[0].props.onChange({ target: { value: project.project_id } }); tree = harness.render();
  const form = nodes(tree, node => node.type === "form")[0]; form.props.onSubmit({ preventDefault() {} }); form.props.onSubmit({ preventDefault() {} });
  finishRead(project); await settle(); assert.equal(writes.length, 1); harness.unmount();
});

test("late exploration results cannot overwrite a newer relation or survive unmount", async () => {
  const pending = [];
  const harness = createHarness({ request: (path, options) => path === "/papers/discovery-index" ? Promise.resolve({ items: [] }) : new Promise(resolve => pending.push({ path, options, resolve })) });
  let tree = await mount(harness); control(tree, "Start with references").props.onClick();
  // The earlier rendered handler is deliberately invoked to exercise rapid input.
  control(tree, "Similar topics").props.onClick(); assert.equal(pending[0].options.signal.aborted, true);
  pending[1].resolve({ items: [nextWork], provider: "all" }); await settle(); tree = harness.render();
  pending[0].resolve({ items: [], provider: "OpenAlex" }); await settle(); tree = harness.render();
  assert.match(renderToStaticMarkup(tree), /citation edge or agreement/); assert.equal(nodes(tree, node => node.type === "li").length, 1);
  control(tree, "Start with references").props.onClick(); harness.unmount(); assert.equal(pending[2].options.signal.aborted, true);
});

test("finished papers show connected reading automatically, and backtracking restores cached trail results", async () => {
  const requests = [];
  const harness = createHarness({ api: { getPaper: async () => ({ ...paper, status: "read" }) }, request: async path => {
    requests.push(path);
    if (path === "/papers/discovery-index") return { items: [] };
    return { items: path.includes("openalex_id=W2") ? [{ ...nextWork, id: "W3", openalex_id: "W3", doi: "10.1234/three", title: "Third paper" }] : [nextWork], provider: "OpenAlex" };
  } });
  let tree = await mount(harness); await settle(); tree = harness.render();
  assert.match(renderToStaticMarkup(tree), /Finished reading/); assert.ok(control(tree, "Keep exploring from this paper"));
  control(tree, "Keep exploring from this paper").props.onClick(); await settle(); tree = harness.render();
  assert.match(renderToStaticMarkup(tree), /Third paper/); const count = requests.length;
  control(tree, "Previous paper").props.onClick(); tree = harness.render();
  assert.equal(requests.length, count, "backtracking reuses the prior response"); assert.match(renderToStaticMarkup(tree), /Reservoir connectivity/); assert.doesNotMatch(renderToStaticMarkup(tree), /Third paper/); harness.unmount();
});
