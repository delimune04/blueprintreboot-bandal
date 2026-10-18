import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { createDemoAdapter, createDemoSeed, DEMO_STORAGE_KEY } from "../app/lib/demo/adapter.mjs";
import { getBrowserWorkspaceStorage, exportBrowserWorkspace, previewBrowserWorkspaceRestore, restoreBrowserWorkspace, listBrowserPdfRecords } from "../app/lib/demo/browser-storage.mjs";
import { applyCollaborationCommand } from "../app/lib/collaboration/model.mjs";
import { validateArchive } from "../../hosting/domain/maintenance.mjs";

const event = (title = "Research review") => ({ title, description: "Discuss evidence", start_date: "2026-10-24", end_date: "2026-10-24", all_day: true, start_time: "", end_time: "", participant_ids: [], project_id: "" });
const payload = (revision, title) => ({ event: event(title), expected_revision: revision, request_id: crypto.randomUUID() });
async function call(api, path, method = "GET", body) {
  const response = await api(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() };
}
function memoryStorage() {
  const data = new Map([[DEMO_STORAGE_KEY, JSON.stringify(createDemoSeed())]]);
  return { data, async getItem(key) { return data.get(key) ?? null; }, async setItem(key, value) { data.set(key, value); }, async compareAndSet(key, expected, next) { if ((data.get(key) ?? null) !== expected) return false; data.set(key, next); return true; } };
}
async function reset() {
  const storage = getBrowserWorkspaceStorage(), raw = await storage.getItem(DEMO_STORAGE_KEY);
  const seed = createDemoSeed(); seed.papers = []; seed.projects = [];
  await storage.compareAndSet(DEMO_STORAGE_KEY, raw, JSON.stringify(seed), { deleteFiles: (await listBrowserPdfRecords()).map(file => file.key) });
  return { storage, api: createDemoAdapter() };
}

test("browser collaboration has only the real local actor, leaves legacy reads untouched, and persists via IndexedDB CAS", async () => {
  const { storage, api } = await reset(), before = await storage.getItem(DEMO_STORAGE_KEY);
  const initial = await call(api, "/collaboration");
  assert.equal(initial.status, 200, JSON.stringify(initial.data));
  assert.equal(initial.data.mode, "browser"); assert.equal(initial.data.time_zone, "Asia/Seoul");
  assert.deepEqual(initial.data.members.map(member => member.id), ["browser-self"]);
  assert.deepEqual((await call(api, "/collaboration/summary")).data, { unread_count: 0, revision: initial.data.revision });
  assert.equal(await storage.getItem(DEMO_STORAGE_KEY), before);
  const body = payload(initial.data.revision);
  const saved = await call(api, "/collaboration/events", "POST", body);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const nextAdapter = createDemoAdapter();
  const loaded = await call(nextAdapter, "/collaboration");
  assert.equal(loaded.data.events[0].title, "Research review");
  const repeated = await call(nextAdapter, "/collaboration/events", "POST", body);
  assert.equal(repeated.data.idempotent, true); assert.equal(repeated.data.revision, saved.data.revision);
  const foreign = await call(nextAdapter, "/collaboration/tasks", "POST", { task: { title: "No simulated professor", description: "", assignee_id: "professor-fake", due_date: "2026-10-24", priority: "normal", project_id: "", source_idea_id: "" }, expected_revision: loaded.data.revision, request_id: crypto.randomUUID() });
  assert.equal(foreign.status, 422);
});

test("two adapters reject stale collaboration revisions and workspace CAS races without overwriting newer unrelated research", async () => {
  const storage = memoryStorage(), api = createDemoAdapter(storage), other = createDemoAdapter(storage);
  const initial = (await call(api, "/collaboration")).data;
  const saved = await call(other, "/collaboration/events", "POST", payload(initial.revision, "Other tab"));
  assert.equal(saved.status, 200);
  assert.equal((await call(api, "/collaboration/events", "POST", payload(initial.revision, "Stale tab"))).status, 409);
  const current = (await call(api, "/collaboration")).data;
  const originalCAS = storage.compareAndSet;
  storage.compareAndSet = async (key, expected, next) => {
    const latest = JSON.parse(await storage.getItem(key)); latest.unrelatedDraft = "Keep the concurrent research";
    await storage.setItem(key, JSON.stringify(latest)); storage.compareAndSet = originalCAS;
    return originalCAS(key, expected, next);
  };
  assert.equal((await call(api, "/collaboration/events", "POST", payload(current.revision, "Raced tab"))).status, 409);
  const persisted = JSON.parse(await storage.getItem(DEMO_STORAGE_KEY));
  assert.equal(persisted.unrelatedDraft, "Keep the concurrent research");
  assert.deepEqual(persisted.collaboration.events.map(row => row.title), ["Other tab"]);
});

test("browser backup and confirmed restore preserve collaboration; corrupt extension is rejected without reset", async () => {
  const { storage, api } = await reset();
  const initial = (await call(api, "/collaboration")).data;
  const saved = await call(api, "/collaboration/events", "POST", payload(initial.revision));
  assert.equal(saved.status, 200);
  const archive = await exportBrowserWorkspace();
  const retained = structuredClone(archive.workspace.collaboration);
  assert.deepEqual((await validateArchive(archive)).workspace.collaboration, retained);
  const changed = await call(api, `/collaboration/events/${saved.data.result_id}`, "PATCH", { changes: { title: "Later change" }, expected_revision: saved.data.revision });
  assert.equal(changed.status, 200);
  const preview = await previewBrowserWorkspaceRestore(archive); assert.equal(preview.valid, true);
  await restoreBrowserWorkspace(archive, { expected_revision: preview.revision, confirm: true });
  const afterRestore = (await call(api, "/collaboration")).data;
  const rebased = { ...retained, revision: Number.parseInt(changed.data.revision, 16) + 1 };
  assert.deepEqual(JSON.parse(await storage.getItem(DEMO_STORAGE_KEY)).collaboration, rebased);
  assert.equal((await call(api, `/collaboration/events/${saved.data.result_id}`, "PATCH", { changes: { title: "Stale form after restore" }, expected_revision: saved.data.revision })).status, 409);
  assert.equal((await call(api, "/collaboration")).data.events[0].title, "Research review");
  assert.ok(afterRestore.revision > changed.data.revision);
  assert.deepEqual(archive.workspace.collaboration, retained, "actual restore must not modify downloaded archive bytes");
  const before = await storage.getItem(DEMO_STORAGE_KEY), bad = structuredClone(archive);
  bad.workspace.collaboration.events = "malformed";
  assert.equal((await previewBrowserWorkspaceRestore(bad)).valid, false);
  await assert.rejects(() => restoreBrowserWorkspace(bad, { expected_revision: preview.revision, confirm: true }));
  assert.equal(await storage.getItem(DEMO_STORAGE_KEY), before);
  await storage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ ...JSON.parse(before), collaboration: { version: 1, events: null } }));
  const corruptBytes = await storage.getItem(DEMO_STORAGE_KEY);
  assert.equal((await call(createDemoAdapter(), "/collaboration")).status, 503);
  assert.equal(await storage.getItem(DEMO_STORAGE_KEY), corruptBytes);
});

test("portable cloud collaboration restores attribution without inventing browser colleagues or recipients", async () => {
  const { storage } = await reset();
  const workspace = createDemoSeed(); workspace.papers = []; workspace.projects = [];
  const professor = { id: "foreign-professor", name: "Professor", email: "p@lab.test", role: "owner", accepted: true };
  const student = { id: "foreign-student", name: "Student", email: "s@lab.test", role: "editor", accepted: true };
  applyCollaborationCommand(workspace, ["collaboration", "ideas"], "POST", { idea: { title: "Retained question", body: "이 아이디어 어때요?", recipient_ids: [student.id], source: { type: "none", id: "", title: "", excerpt: "" } }, expected_revision: "1".padStart(64, "0"), request_id: crypto.randomUUID() }, { actor: professor, members: [professor, student], mode: "cloud" });
  const archive = { schema_version: 1, workspace, pdfs: [] };
  const preview = await previewBrowserWorkspaceRestore(archive); assert.equal(preview.valid, true);
  await restoreBrowserWorkspace(archive, { expected_revision: preview.revision, confirm: true });
  const snapshot = (await call(createDemoAdapter(), "/collaboration")).data;
  assert.deepEqual(snapshot.members.map(member => member.id), ["browser-self"]);
  assert.equal(snapshot.ideas[0].author_id, professor.id); assert.deepEqual(snapshot.notifications, []);
  assert.deepEqual(JSON.parse(await storage.getItem(DEMO_STORAGE_KEY)).collaboration, { ...workspace.collaboration, revision: workspace.collaboration.revision + 1 });
});

test("restoring a legacy browser archive clears collaboration with a fresh generation and rejects old empty forms", async () => {
  const { api } = await reset();
  const initial = (await call(api, "/collaboration")).data;
  const legacyArchive = await exportBrowserWorkspace();
  assert.equal(Object.hasOwn(legacyArchive.workspace, "collaboration"), false);
  const saved = await call(api, "/collaboration/events", "POST", payload(initial.revision));
  assert.equal(saved.status, 200);
  const preview = await previewBrowserWorkspaceRestore(legacyArchive); assert.equal(preview.valid, true);
  await restoreBrowserWorkspace(legacyArchive, { expected_revision: preview.revision, confirm: true });
  const current = (await call(api, "/collaboration")).data;
  assert.deepEqual(current.events, []); assert.ok(current.revision > saved.data.revision);
  assert.equal((await call(api, "/collaboration/events", "POST", payload(initial.revision, "Old empty form"))).status, 409);
  assert.equal(Object.hasOwn(legacyArchive.workspace, "collaboration"), false);
});
