import test from "node:test";
import assert from "node:assert/strict";
import { createDemoAdapter, createDemoSeed, DEMO_STORAGE_KEY } from "../demo/adapter.mjs";
import { RESEARCH_PAGES_KEY, createResearchPagesStore, blankResearchPage } from "../workspace/pages.mjs";
import { blankReviewInput, newReviewRow } from "./model.mjs";
import { emptyExploration } from "../exploration/model.mjs";

function setup(t, withLocks) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const pages = new Map(), core = new Map([[DEMO_STORAGE_KEY, JSON.stringify(createDemoSeed())]]), active = new Set(), publications = [];
  const localStorage = { getItem: (key) => pages.get(key) ?? null, setItem: (key, value) => pages.set(key, value), removeItem: (key) => pages.delete(key) };
  const locks = { async request(name, options, callback) { const run = callback || options; assert.equal(active.has(name), false); active.add(name); try { return await run(); } finally { active.delete(name); } } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: withLocks ? { locks } : {} });
  t.after(() => { if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else delete globalThis.window; if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator); else delete globalThis.navigator; });
  const storage = { getItem: async (key) => core.get(key) ?? null, setItem: async (key, value) => core.set(key, value), async compareAndSet(key, expected, value) { if (core.get(key) !== expected) return false; publications.push([...active]); await Promise.resolve(); core.set(key, value); return true; } };
  const pageStore = createResearchPagesStore(localStorage), page = pageStore.create({ ...blankResearchPage(), title: "Project page", project_id: "demo-storage" }).page;
  const dossier = blankReviewInput(); dossier.checklist = Object.fromEntries(Object.keys(dossier.checklist).map((key) => [key, true])); dossier.rows = [{ ...newReviewRow("decision"), text: "Preserve the observed uncertainty", status: "reviewed", source_links: [{ kind: "research_page", paper_id: "", page: null, block_id: "", research_page_id: page.id }] }];
  const api = createDemoAdapter(storage);
  const request = async (path, method = "GET", body) => { const response = await api(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, data: await response.json() }; };
  return { request, dossier, core, localStorage, publications, pageStore };
}

test("page-backed review saves and freezes hold the shared page lock through primary CAS", async (t) => {
  const { request, dossier, publications } = setup(t, true);
  const current = await request("/projects/demo-storage/review");
  const saved = await request("/projects/demo-storage/review", "PUT", { dossier, expected_revision: current.data.revision }); assert.equal(saved.status, 200);
  const frozen = await request("/projects/demo-storage/review/freeze", "POST", { expected_revision: saved.data.revision, reviewed_by: "Human reviewer", confirm: true }); assert.equal(frozen.status, 200);
  assert.equal(frozen.data.snapshot.source_inputs.length, 1);
  assert.equal(publications.length, 2);
  for (const held of publications) assert.deepEqual(held, ["labvium:research-pages", "labvium:browser-workspace"]);
});
test("without Web Locks page-backed freezing refuses publication and retains saved draft", async (t) => {
  const { request, dossier, core } = setup(t, false);
  const current = await request("/projects/demo-storage/review"), saved = await request("/projects/demo-storage/review", "PUT", { dossier, expected_revision: current.data.revision }); assert.equal(saved.status, 200);
  const before = core.get(DEMO_STORAGE_KEY);
  const frozen = await request("/projects/demo-storage/review/freeze", "POST", { expected_revision: saved.data.revision, reviewed_by: "Human reviewer", confirm: true });
  assert.equal(frozen.status, 503); assert.match(frozen.data.detail, /Web Locks/); assert.equal(core.get(DEMO_STORAGE_KEY), before);
});
test("fallback save detects a research-page change during async hashing and preserves core bytes", async (t) => {
  const { request, dossier, core, localStorage } = setup(t, false);
  const current = await request("/projects/demo-storage/review"), before = core.get(DEMO_STORAGE_KEY);
  const originalDigest = crypto.subtle.digest;
  let changed = false;
  crypto.subtle.digest = async function (...args) { if (!changed) { changed = true; const state = JSON.parse(localStorage.getItem(RESEARCH_PAGES_KEY)); state.sequence++; state.pages[0].title = "Changed in another tab"; localStorage.setItem(RESEARCH_PAGES_KEY, JSON.stringify(state)); } return originalDigest.apply(this, args); };
  t.after(() => { crypto.subtle.digest = originalDigest; });
  const saved = await request("/projects/demo-storage/review", "PUT", { dossier, expected_revision: current.data.revision });
  assert.equal(saved.status, 409); assert.match(saved.data.detail, /Research pages changed/); assert.equal(core.get(DEMO_STORAGE_KEY), before);
});
test("only exploration PUT accepts a valid graph above the ordinary 2.5 MB ingress cap", async (t) => {
  const { request } = setup(t, true), exploration = emptyExploration("Large but bounded research trail");
  exploration.works = Array.from({ length: 90 }, (_, index) => ({ id: `paper-${index}`, title: `Source ${index}`, authors: [], year: "2026", doi: "", abstract: "x".repeat(30000), url: "", pdf_url: "", source: "Test fixture", references: [], topic_ids: [], topics: [], providers: [] }));
  const body = { exploration, expected_revision: "1".padStart(64, "0") };
  assert.ok(new TextEncoder().encode(JSON.stringify(body)).length > 2500000);
  const saved = await request("/projects/demo-storage/exploration", "PUT", body);
  assert.equal(saved.status, 200); assert.equal(saved.data.exploration.works.length, 90);
  const otherCommand = await request("/projects/demo-storage/review", "PUT", body);
  assert.equal(otherCommand.status, 422); assert.match(otherCommand.data.detail, /bounded JSON/);
});
