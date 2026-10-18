import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { handleLabviumApi } from "../api.mjs";
import { sha256 } from "../domain/core.mjs";
import { loadWorkspace } from "../domain/store.mjs";
import { validateArchive } from "../domain/maintenance.mjs";
import { applyCollaborationCommand, getCollaborationSnapshot } from "../../frontend/app/lib/collaboration/model.mjs";

// Actual SQLite executes the membership joins, permission predicates, and CAS.
class SQLiteD1 {
  database = new DatabaseSync(":memory:");
  beforeStateSave = null;
  prepare(sql) {
    const owner = this;
    return { bind(...args) { return {
      async first() { return owner.database.prepare(sql).get(...args) || null; },
      async all() { return { results: owner.database.prepare(sql).all(...args), success: true }; },
      async run() {
        if (/^UPDATE labvium_workspaces SET state_json/.test(sql) && owner.beforeStateSave) {
          const hook = owner.beforeStateSave; owner.beforeStateSave = null; hook(owner.database);
        }
        const result = owner.database.prepare(sql).run(...args);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    }; } };
  }
  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.database.exec("COMMIT"); return results; }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
}
class PrivateBucket {
  objects = new Map();
  async put(key, bytes) { this.objects.set(key, new Uint8Array(bytes)); }
  async get(key) { const bytes = this.objects.get(key); return bytes ? { size: bytes.length, body: bytes.slice(), async arrayBuffer() { return bytes.slice().buffer; } } : null; }
  async delete(key) { this.objects.delete(key); }
}
const OWNER = { id: "collaboration-owner", email: "professor@lab.test", name: "Professor" };
const EDITOR = { id: "collaboration-editor", email: "student@lab.test", name: "Student" };
const VIEWER = { id: "collaboration-viewer", email: "viewer@lab.test", name: "Viewer" };
const PENDING = { id: "not-signed-in", email: "pending@lab.test", name: "Pending" };
async function environment() {
  const env = { LABVIUM_DB: new SQLiteD1(), LABVIUM_PDFS: new PrivateBucket() };
  const directory = new URL("../drizzle/", import.meta.url);
  for (const file of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort()) env.LABVIUM_DB.database.exec(await readFile(new URL(file, directory), "utf8"));
  return env;
}
async function request(env, actor, path, { workspace, method = "GET", body } = {}) {
  const headers = { "oai-authenticated-user-id": actor.id, "oai-authenticated-user-email": actor.email, "oai-authenticated-user-full-name": actor.name, Origin: "https://bandal.app", ...(workspace ? { "X-Labvium-Workspace": workspace } : {}) };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await handleLabviumApi(new Request(`https://bandal.app/ku-ai/api${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
  return { status: response.status, data: await response.json() };
}
async function shared(env, extra = []) {
  const created = await request(env, OWNER, "/workspaces", { method: "POST", body: { title: "CCS laboratory" } });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  let permissions = created.data.permissions_revision;
  for (const [actor, role] of [[EDITOR, "editor"], ...extra]) {
    const grant = await request(env, OWNER, `/workspaces/${created.data.workspace_id}/members`, { method: "POST", body: { email: actor.email, role, expected_revision: permissions, confirm: true } });
    assert.equal(grant.status, 200, JSON.stringify(grant.data)); permissions = grant.data.permissions_revision;
  }
  await request(env, EDITOR, "/collaboration", { workspace: created.data.workspace_id });
  return created.data.workspace_id;
}
const event = (title = "Weekly evidence review") => ({ title, description: "Compare method and pressure", start_date: "2026-10-24", end_date: "2026-10-24", all_day: false, start_time: "14:00", end_time: "15:00", participant_ids: [], project_id: "" });
const source = { type: "none", id: "", title: "", excerpt: "" };
const create = (key, value, revision) => ({ [key]: value, expected_revision: revision, request_id: crypto.randomUUID() });

test("legacy collaboration reads do not add state and unsupported commands do not report success", async () => {
  const env = await environment();
  await request(env, OWNER, "/workspace");
  const owner = await sha256(OWNER.id);
  const before = env.LABVIUM_DB.database.prepare("SELECT revision, state_json FROM labvium_workspaces WHERE owner_key = ?").get(owner);
  const snapshot = await request(env, OWNER, "/collaboration");
  assert.equal(snapshot.status, 200); assert.deepEqual(snapshot.data.events, []);
  assert.deepEqual(env.LABVIUM_DB.database.prepare("SELECT revision, state_json FROM labvium_workspaces WHERE owner_key = ?").get(owner), before);
  assert.equal((await request(env, OWNER, "/collaboration/events")).status, 404);
  assert.equal((await request(env, OWNER, "/collaboration/ideas/unknown", { method: "DELETE", body: { expected_revision: snapshot.data.revision } })).status, 404);
  assert.deepEqual(env.LABVIUM_DB.database.prepare("SELECT revision, state_json FROM labvium_workspaces WHERE owner_key = ?").get(owner), before);
});

test("two authenticated accounts share calendar, two-way questions/comments, assignments, and private inboxes", async () => {
  const env = await environment(), workspace = await shared(env);
  const initial = (await request(env, OWNER, "/collaboration", { workspace })).data;
  assert.equal(initial.mode, "cloud"); assert.equal(initial.time_zone, "Asia/Seoul");
  assert.deepEqual(new Set(initial.members.map(member => member.id)), new Set([await sha256(OWNER.id), await sha256(EDITOR.id)]));
  assert.ok(initial.members.every(member => member.accepted));
  const payload = create("event", event(), initial.revision);
  const calendar = await request(env, OWNER, "/collaboration/events", { workspace, method: "POST", body: payload });
  assert.equal(calendar.status, 200, JSON.stringify(calendar.data));
  const repeated = await request(env, OWNER, "/collaboration/events", { workspace, method: "POST", body: payload });
  assert.equal(repeated.status, 200); assert.equal(repeated.data.idempotent, true); assert.equal(repeated.data.revision, calendar.data.revision);
  const student = (await request(env, EDITOR, "/collaboration", { workspace })).data;
  assert.equal(student.events[0].title, event().title);
  const edited = await request(env, EDITOR, `/collaboration/events/${student.events[0].id}`, { workspace, method: "PATCH", body: { changes: { description: "Bring the comparison table" }, expected_revision: student.revision } });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  const idea = await request(env, EDITOR, "/collaboration/ideas", { workspace, method: "POST", body: create("idea", { title: "Pressure sweep", body: "이 아이디어 어때요?", recipient_ids: [await sha256(OWNER.id)], source }, edited.data.revision) });
  assert.equal(idea.status, 200, JSON.stringify(idea.data));
  const comment = await request(env, OWNER, `/collaboration/ideas/${idea.data.result_id}/comments`, { workspace, method: "POST", body: { body: "Add a lower-pressure control first.", expected_revision: idea.data.revision, request_id: crypto.randomUUID() } });
  assert.equal(comment.status, 200, JSON.stringify(comment.data));
  assert.equal(comment.data.comments.at(-1).author_id, await sha256(OWNER.id));
  const assigned = await request(env, OWNER, "/collaboration/tasks", { workspace, method: "POST", body: create("task", { title: "Run the control", description: "Document the first run", assignee_id: await sha256(EDITOR.id), due_date: "2026-10-24", priority: "high", project_id: "", source_idea_id: idea.data.result_id }, comment.data.revision) });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.data));
  const submitted = await request(env, EDITOR, `/collaboration/tasks/${assigned.data.result_id}`, { workspace, method: "PATCH", body: { changes: { status: "submitted" }, expected_revision: assigned.data.revision } });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
  const completed = await request(env, OWNER, `/collaboration/tasks/${assigned.data.result_id}`, { workspace, method: "PATCH", body: { changes: { status: "done" }, expected_revision: submitted.data.revision } });
  assert.equal(completed.status, 200, JSON.stringify(completed.data));
  const ownerState = (await request(env, OWNER, "/collaboration", { workspace })).data;
  const editorState = (await request(env, EDITOR, "/collaboration", { workspace })).data;
  assert.equal(editorState.tasks[0].status, "done"); assert.equal(editorState.comments.length, 1);
  assert.ok(ownerState.notifications.length > 0); assert.ok(editorState.notifications.length > 0);
  const ownerSummary = (await request(env, OWNER, "/collaboration/summary", { workspace })).data;
  const editorSummary = (await request(env, EDITOR, "/collaboration/summary", { workspace })).data;
  assert.equal(ownerSummary.unread_count, ownerState.notifications.filter(row => !row.read_at).length);
  assert.equal(editorSummary.unread_count, editorState.notifications.filter(row => !row.read_at).length);
  assert.equal(ownerSummary.revision, ownerState.revision);
  assert.deepEqual(Object.keys(ownerSummary).sort(), ["revision", "unread_count", "workspace_revision"]);
  for (const row of ownerState.notifications) assert.equal(row.member_id ?? row.recipient_id, await sha256(OWNER.id));
  for (const row of editorState.notifications) assert.equal(row.member_id ?? row.recipient_id, await sha256(EDITOR.id));
  const read = await request(env, OWNER, "/collaboration/notifications/read", { workspace, method: "POST", body: { ids: [], expected_revision: ownerState.revision } });
  assert.equal(read.status, 200, JSON.stringify(read.data));
  assert.ok(read.data.notifications.every(row => row.read_at));
  assert.equal((await request(env, OWNER, "/collaboration/summary", { workspace })).data.unread_count, 0);
  assert.equal((await request(env, EDITOR, "/collaboration/summary", { workspace })).data.unread_count, editorSummary.unread_count);
  assert.ok((await request(env, EDITOR, "/collaboration", { workspace })).data.notifications.some(row => !row.read_at));
  const persisted = await loadWorkspace(env, workspace);
  assert.equal(persisted.state.collaboration.tasks[0].status, "done");
});

test("accepted roster excludes pending/foreign accounts; viewer and spoofed commands cannot write", async () => {
  const env = await environment(), workspace = await shared(env, [[VIEWER, "viewer"], [PENDING, "editor"]]);
  await request(env, VIEWER, "/collaboration", { workspace });
  const snapshot = (await request(env, EDITOR, "/collaboration", { workspace })).data;
  assert.equal(snapshot.members.length, 3); assert.ok(!snapshot.members.some(member => member.email === PENDING.email));
  assert.equal(snapshot.members.find(member => member.role === "owner").name, "공간 관리자");
  assert.equal((await request(env, EDITOR, `/workspaces/${workspace}/members`)).status, 403);
  assert.equal((await request(env, { id: "foreign", email: "foreign@lab.test", name: "Other" }, "/collaboration", { workspace })).status, 403);
  assert.equal((await request(env, VIEWER, "/collaboration/events", { workspace, method: "POST", body: create("event", event(), snapshot.revision) })).status, 403);
  const foreignTask = { title: "Foreign assignee", description: "", assignee_id: await sha256(PENDING.id), due_date: "2026-10-24", priority: "normal", project_id: "", source_idea_id: "" };
  assert.equal((await request(env, OWNER, "/collaboration/tasks", { workspace, method: "POST", body: create("task", foreignTask, snapshot.revision) })).status, 422);
  assert.equal((await request(env, EDITOR, "/collaboration/events", { workspace, method: "POST", body: { ...create("event", event(), snapshot.revision), actor_id: await sha256(OWNER.id) } })).status, 422);
  assert.equal((await request(env, EDITOR, "/collaboration/ideas", { workspace, method: "POST", body: create("idea", { title: "Unknown paper", body: "Ask", recipient_ids: [], source: { type: "paper", id: "foreign-paper", title: "Forged title", excerpt: "" } }, snapshot.revision) })).status, 422);
  assert.equal((await request(env, OWNER, "/collaboration", { workspace })).data.events.length, 0);
});

test("stale revisions and membership downgrade between roster and D1 CAS preserve all saved collaboration", async () => {
  const env = await environment(), workspace = await shared(env);
  const first = (await request(env, EDITOR, "/collaboration", { workspace })).data;
  const saved = await request(env, EDITOR, "/collaboration/events", { workspace, method: "POST", body: create("event", event(), first.revision) });
  assert.equal(saved.status, 200);
  assert.equal((await request(env, OWNER, "/collaboration/events", { workspace, method: "POST", body: create("event", event("Stale"), first.revision) })).status, 409);
  env.LABVIUM_DB.beforeStateSave = db => {
    db.prepare("UPDATE labvium_workspace_members SET role = 'viewer' WHERE workspace_key = ? AND member_user_key = ?").run(workspace, snapshotActor);
    db.prepare("UPDATE labvium_workspace_access SET permissions_revision = permissions_revision + 1 WHERE workspace_key = ?").run(workspace);
  };
  const snapshotActor = await sha256(EDITOR.id);
  const raced = await request(env, EDITOR, "/collaboration/events", { workspace, method: "POST", body: create("event", event("Raced"), saved.data.revision) });
  assert.equal(raced.status, 409, JSON.stringify(raced.data));
  const current = (await request(env, OWNER, "/collaboration", { workspace })).data;
  assert.equal(current.events.length, 1); assert.equal(current.events[0].title, event().title);
});

test("verified backup restore preserves collaboration and rejects corrupt extension without replacing work", async () => {
  const env = await environment(), workspace = await shared(env);
  const initial = (await request(env, OWNER, "/collaboration", { workspace })).data;
  const saved = await request(env, OWNER, "/collaboration/events", { workspace, method: "POST", body: create("event", event(), initial.revision) });
  const backup = await request(env, OWNER, "/backups", { workspace, method: "POST", body: { kind: "full", expected_revision: saved.data.workspace_revision } });
  assert.equal(backup.status, 200, JSON.stringify(backup.data));
  const changed = await request(env, EDITOR, `/collaboration/events/${saved.data.result_id}`, { workspace, method: "PATCH", body: { changes: { title: "Changed later" }, expected_revision: saved.data.revision } });
  assert.equal(changed.status, 200);
  const preview = await request(env, OWNER, `/backups/${backup.data.backup_id}/restore-preview`, { workspace, method: "POST", body: {} });
  const restored = await request(env, OWNER, `/backups/${backup.data.backup_id}/restore`, { workspace, method: "POST", body: { confirm: true, expected_revision: preview.data.workspace_revision } });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  const afterRestore = (await request(env, EDITOR, "/collaboration", { workspace })).data;
  assert.equal(afterRestore.events[0].title, event().title);
  assert.ok(afterRestore.revision > changed.data.revision);
  const staleForm = await request(env, OWNER, `/collaboration/events/${saved.data.result_id}`, { workspace, method: "PATCH", body: { changes: { title: "Stale form from backup date" }, expected_revision: saved.data.revision } });
  assert.equal(staleForm.status, 409, JSON.stringify(staleForm.data));
  assert.equal((await request(env, EDITOR, "/collaboration", { workspace })).data.events[0].title, event().title);
  const originalDownload = (await request(env, OWNER, `/backups/${backup.data.backup_id}`, { workspace })).data;
  assert.equal(originalDownload.workspace.collaboration.revision, Number.parseInt(saved.data.revision, 16));
  const exported = (await request(env, OWNER, "/exports/workspace", { workspace })).data;
  assert.deepEqual(exported.workspace.collaboration, (await loadWorkspace(env, workspace)).state.collaboration);
  const bad = structuredClone(exported); bad.workspace.collaboration.events = "corrupt";
  assert.equal((await request(env, OWNER, "/backups/import-preview", { workspace, method: "POST", body: { archive: bad } })).status, 422);
  assert.equal((await request(env, EDITOR, "/collaboration", { workspace })).data.events[0].title, event().title);
  const old = structuredClone(exported); delete old.workspace.collaboration;
  const loaded = await validateArchive(old); assert.equal(Object.hasOwn(loaded.workspace, "collaboration"), false);
});

test("portable imports preserve historical members without granting foreign identities access", async () => {
  const env = await environment(), workspace = await shared(env);
  const initial = (await request(env, OWNER, "/collaboration", { workspace })).data;
  const sharedIdea = await request(env, EDITOR, "/collaboration/ideas", { workspace, method: "POST", body: create("idea", { title: "Historical question", body: "Discuss", recipient_ids: [initial.actor.id], source }, initial.revision) });
  assert.equal(sharedIdea.status, 200);
  const archive = (await request(env, OWNER, "/exports/workspace", { workspace })).data;
  const imported = await validateArchive(archive);
  const stranger = { id: "stranger-actor", name: "Other lab", email: "other@lab.test", role: "owner", accepted: true };
  const ctx = { actor: stranger, members: [stranger], mode: "cloud" };
  const snapshot = getCollaborationSnapshot(imported.workspace, ctx);
  assert.equal(snapshot.members.length, 1); assert.deepEqual(snapshot.notifications, []);
  assert.equal(snapshot.ideas[0].author_id, await sha256(EDITOR.id));
  assert.throws(() => applyCollaborationCommand(imported.workspace, ["collaboration", "tasks"], "POST", create("task", { title: "Unsafe reassignment", description: "", assignee_id: "a".repeat(64), due_date: "2026-10-24", priority: "normal", project_id: "", source_idea_id: "" }, snapshot.revision), ctx), error => error.status === 422);
  const before = await loadWorkspace(env, workspace);
  const corrupted = structuredClone(before.state); corrupted.collaboration = { version: 1, revision: 1, events: "broken" };
  env.LABVIUM_DB.database.prepare("UPDATE labvium_workspaces SET state_json = ? WHERE owner_key = ?").run(JSON.stringify(corrupted), workspace);
  assert.equal((await request(env, OWNER, "/collaboration", { workspace })).status, 503);
  assert.equal(env.LABVIUM_DB.database.prepare("SELECT state_json FROM labvium_workspaces WHERE owner_key = ?").get(workspace).state_json, JSON.stringify(corrupted));
});

test("restoring a legacy cloud archive clears collaboration only with a fresh generation", async () => {
  const env = await environment(), workspace = await shared(env);
  const initial = (await request(env, OWNER, "/collaboration", { workspace })).data;
  const legacyArchive = (await request(env, OWNER, "/exports/workspace", { workspace })).data;
  assert.equal(Object.hasOwn(legacyArchive.workspace, "collaboration"), false);
  const saved = await request(env, OWNER, "/collaboration/events", { workspace, method: "POST", body: create("event", event(), initial.revision) });
  const imported = await request(env, OWNER, "/backups/import-preview", { workspace, method: "POST", body: { archive: legacyArchive } });
  assert.equal(imported.status, 200, JSON.stringify(imported.data));
  const restored = await request(env, OWNER, `/backups/${imported.data.backup_id}/restore`, { workspace, method: "POST", body: { confirm: true, expected_revision: imported.data.workspace_revision } });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  const current = (await request(env, EDITOR, "/collaboration", { workspace })).data;
  assert.deepEqual(current.events, []); assert.ok(current.revision > saved.data.revision);
  assert.equal(current.members.length, 2);
  assert.equal((await request(env, OWNER, "/collaboration/events", { workspace, method: "POST", body: create("event", event("Stale empty form"), initial.revision) })).status, 409);
  assert.equal(Object.hasOwn(legacyArchive.workspace, "collaboration"), false);
});
