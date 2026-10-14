import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createDemoSeed } from "../demo/adapter.mjs";
import { BROWSER_WORKSPACE_KEY, getBrowserWorkspaceStorage, listBrowserPdfRecords } from "../demo/browser-storage.mjs";
import { blankResearchPage } from "./pages.mjs";
import { browserWorkspaceRequest } from "./browser-request.mjs";

const values = new Map(); globalThis.window = { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const match = /bandal-demo\/(demo-(?:ccs|muon|seismic))\.pdf$/.exec(String(url));
  if (match) return new Response(await readFile(new URL(`../../../public/bandal-demo/${match[1]}.pdf`, import.meta.url)), { headers: {"Content-Type":"application/pdf"} });
  return originalFetch(url, init);
};
async function request(path, method = "GET", body) { const response = await browserWorkspaceRequest(path, { method, ...(body ? {body:JSON.stringify(body)} : {}) }); return { status: response.status, data: await response.json() }; }
test("guest backups carry research pages and reject restoring over edits made after preview", async () => {
  const storage = getBrowserWorkspaceStorage(); const raw = await storage.getItem(BROWSER_WORKSPACE_KEY); const files = await listBrowserPdfRecords();
  await storage.compareAndSet(BROWSER_WORKSPACE_KEY, raw, JSON.stringify(createDemoSeed()), {deleteFiles: files.map((file) => file.key)});
  values.clear();
  const page = await request("/research/pages", "POST", {page:{...blankResearchPage(),title:"CCS source evidence"}}); assert.equal(page.status, 200);
  const snapshot = await request("/workspace"); assert.equal(snapshot.status, 200); assert.ok(snapshot.data.capabilities.includes("note_import"));
  const backup = await request("/backups", "POST", {kind:"full",expected_revision:snapshot.data.workspace_revision}); assert.equal(backup.status, 200);
  const exported = await request(`/backups/${backup.data.backup_id}`); assert.equal(exported.data.pdfs.length, 3); assert.equal(exported.data.research_pages.pages[0].title, "CCS source evidence");
  const preview = await request(`/backups/${backup.data.backup_id}/restore-preview`, "POST", {}); assert.equal(preview.status, 200);
  const edited = await request(`/research/pages/${page.data.page.id}`, "PUT", {page:{...blankResearchPage(),title:"Newer research"},expected_revision:page.data.revision}); assert.equal(edited.status, 200);
  const restore = await request(`/backups/${backup.data.backup_id}/restore`, "POST", {expected_revision:preview.data.workspace_revision,confirm:true}); assert.equal(restore.status, 409);
  const current = await request("/research/pages"); assert.equal(current.data.items[0].title, "Newer research");
});
test("guest search uses persisted notes and page content and supports cancellation", async () => {
  const result = await request("/search?q=Newer"); assert.equal(result.status, 200); assert.equal(result.data.items[0].kind, "research-page");
  const controller = new AbortController(); controller.abort(); await assert.rejects(() => browserWorkspaceRequest("/search?q=Newer", {signal:controller.signal}), {name:"AbortError"});
});
test("confirmed guest restore retains research page recovery and can undo the page replacement", async () => {
  const registry = await request("/backups"); const id = registry.data.items[0].backup_id;
  const preview = await request(`/backups/${id}/restore-preview`, "POST", {});
  const restored = await request(`/backups/${id}/restore`, "POST", {expected_revision:preview.data.workspace_revision,confirm:true}); assert.equal(restored.status, 200);
  const pages = await request("/research/pages"); assert.equal(pages.data.items[0].title, "CCS source evidence");
  const recovery = await request("/recovery"); assert.equal(recovery.status, 200);
  const pageRecovery = recovery.data.items.find((row) => row.kind === "research_pages"); assert.ok(pageRecovery);
  const snapshot = await request("/workspace");
  const undo = await request(`/recovery/${pageRecovery.recovery_id}/restore`, "POST", {expected_revision:snapshot.data.workspace_revision,confirm:true}); assert.equal(undo.status, 200);
  const recoveredPages = await request("/research/pages"); assert.equal(recoveredPages.data.items[0].title, "Newer research");
});
