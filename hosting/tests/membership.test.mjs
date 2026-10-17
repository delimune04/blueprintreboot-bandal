import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { normalizeMemberEmail, resolveWorkspaceAccess, routeWorkspaceMembership } from "../membership.mjs";
import { rev, sha256 } from "../domain/core.mjs";
import { loadWorkspace, saveWorkspace } from "../domain/store.mjs";

// SQL executes against SQLite rather than matching query strings. This verifies
// INSERT ... SELECT, ON CONFLICT, EXISTS predicates and transactional batches.
class SQLiteD1 {
  database = new DatabaseSync(":memory:");
  beforeBatch = null;
  failBatchAt = null;
  prepare(sql) {
    const database = this.database;
    return { bind(...args) {
      return {
        async first() { return database.prepare(sql).get(...args) || null; },
        async all() { return { results: database.prepare(sql).all(...args), success: true }; },
        async run() { const result = database.prepare(sql).run(...args); return { success: true, meta: { changes: Number(result.changes) } }; },
      };
    } };
  }
  async batch(statements) {
    const before = this.beforeBatch;
    this.beforeBatch = null;
    if (before) before(this.database);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const [index, statement] of statements.entries()) {
        if (this.failBatchAt === index) { this.failBatchAt = null; throw new Error("Injected transaction failure"); }
        results.push(await statement.run());
      }
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

class PrivateBucket {
  objects = new Map();
  async put(key, bytes) { this.objects.set(key, new Uint8Array(bytes)); }
  async get(key) {
    const bytes = this.objects.get(key);
    return bytes ? { size: bytes.length, async arrayBuffer() { return bytes.slice().buffer; } } : null;
  }
  async delete(key) { this.objects.delete(key); }
}

const OWNER = { id: "owner-user", email: "owner@lab.test" };
const VIEWER = { id: "viewer-user", email: "viewer@lab.test" };
const EDITOR = { id: "editor-user", email: "editor@lab.test" };
function request(actor, method = "GET", workspaceKey) {
  const headers = { "oai-authenticated-user-id": actor.id, "oai-authenticated-user-email": actor.email, Origin: "https://bandal.app" };
  if (workspaceKey) headers["X-Labvium-Workspace"] = workspaceKey;
  return new Request("https://bandal.app/ku-ai/api/workspaces", { method, headers });
}
async function environment() {
  const env = { LABVIUM_DB: new SQLiteD1(), LABVIUM_PDFS: new PrivateBucket() };
  const directory = new URL("../drizzle/", import.meta.url);
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    env.LABVIUM_DB.database.exec(await readFile(new URL(file, directory), "utf8"));
  }
  return env;
}
async function createShared(env) {
  return routeWorkspaceMembership(request(OWNER, "POST"), env, ["workspaces"], { title: "CCS evidence review" });
}
async function grant(env, workspace, actor, role, expected = workspace.permissions_revision) {
  return routeWorkspaceMembership(request(OWNER, "POST"), env, ["workspaces", workspace.workspace_id, "members"], { email: actor.email, role, expected_revision: expected, confirm: true });
}
async function revoke(env, workspace, actor, expected) {
  return routeWorkspaceMembership(request(OWNER, "DELETE"), env, ["workspaces", workspace.workspace_id, "members", await sha256(normalizeMemberEmail(actor.email))], { expected_revision: expected, confirm: true });
}
function stagedProject(loaded) {
  loaded.state.projects.push({ project_id: "project-staged", name: "Candidate reservoir", description: "", status: "active", priority: "normal", tags: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), projectRev: 1, linksRev: 1, links: [] });
}

test("ownership transfer keeps the same workspace and files, and the previous owner becomes an editor", async()=>{
  const env=await environment(),workspace=await createShared(env),granted=await grant(env,workspace,EDITOR,"editor");
  await resolveWorkspaceAccess(request(EDITOR,"GET",workspace.workspace_id),env);
  const loaded=await loadWorkspace(env,workspace.workspace_id);stagedProject(loaded);await saveWorkspace(env,workspace.workspace_id,loaded);
  const transferred=await routeWorkspaceMembership(request(OWNER,"POST"),env,["workspaces",workspace.workspace_id,"transfer"],{email:EDITOR.email,expected_revision:granted.permissions_revision,confirm:true});
  assert.equal(transferred.status,"transferred");assert.equal((await resolveWorkspaceAccess(request(EDITOR,"GET",workspace.workspace_id),env)).role,"owner");assert.equal((await resolveWorkspaceAccess(request(OWNER,"POST",workspace.workspace_id),env)).role,"editor");
  assert.equal((await loadWorkspace(env,workspace.workspace_id)).state.projects[0].project_id,"project-staged");
  await assert.rejects(()=>routeWorkspaceMembership(request(OWNER,"POST"),env,["workspaces",workspace.workspace_id,"transfer"],{email:VIEWER.email,expected_revision:transferred.permissions_revision,confirm:true}),e=>e.status===403);
});
test("ownership transfer rejects unaccepted recipients, personal spaces and stale permission revisions",async()=>{
  const env=await environment(),workspace=await createShared(env),granted=await grant(env,workspace,EDITOR,"editor");
  const transfer=(email,revision=granted.permissions_revision)=>routeWorkspaceMembership(request(OWNER,"POST"),env,["workspaces",workspace.workspace_id,"transfer"],{email,expected_revision:revision,confirm:true});
  await assert.rejects(()=>transfer(EDITOR.email),e=>e.status===422);
  await resolveWorkspaceAccess(request(EDITOR,"GET",workspace.workspace_id),env);
  await assert.rejects(()=>transfer(EDITOR.email,workspace.permissions_revision),e=>e.status===409);
  const personal=await resolveWorkspaceAccess(request(OWNER),env);
  await assert.rejects(()=>routeWorkspaceMembership(request(OWNER,"POST"),env,["workspaces",personal.workspace_key,"transfer"],{email:EDITOR.email,expected_revision:rev(1),confirm:true}),e=>e.status===422);
  assert.equal((await resolveWorkspaceAccess(request(OWNER,"GET",workspace.workspace_id),env)).role,"owner");
});

test("unselected accounts default to independent private workspaces", async () => {
  const env = await environment();
  const owner = await resolveWorkspaceAccess(request(OWNER), env);
  const viewer = await resolveWorkspaceAccess(request(VIEWER), env);
  assert.equal(owner.workspace_key, await sha256(OWNER.id));
  assert.equal(owner.actor_key, owner.workspace_key);
  assert.equal(owner.role, "owner");
  assert.notEqual(owner.workspace_key, viewer.workspace_key);
  assert.equal(viewer.role, "owner");
});

test("anonymous identity and unknown selected workspaces create no foreign workspace", async () => {
  const env = await environment();
  await assert.rejects(() => resolveWorkspaceAccess(new Request("https://bandal.app/ku-ai/api/papers"), env), (error) => error.status === 401);
  await assert.rejects(() => resolveWorkspaceAccess(request(VIEWER, "GET", "a".repeat(64)), env), (error) => error.status === 403);
  assert.equal(env.LABVIUM_DB.database.prepare("SELECT COUNT(*) AS n FROM labvium_workspace_access").get().n, 0);
  await assert.rejects(() => resolveWorkspaceAccess(request(VIEWER, "GET", "../owner"), env), (error) => error.status === 422);
});

test("only trusted email can accept an explicitly granted viewer role", async () => {
  const env = await environment(), workspace = await createShared(env);
  await grant(env, workspace, VIEWER, "viewer");
  await assert.rejects(() => resolveWorkspaceAccess(request({ id: "outsider", email: "outsider@lab.test" }, "GET", workspace.workspace_id), env), (error) => error.status === 403);
  const access = await resolveWorkspaceAccess(request(VIEWER, "GET", workspace.workspace_id), env);
  assert.equal(access.role, "viewer");
  assert.equal(access.workspace_key, workspace.workspace_id);
  assert.equal(access.actor_key, await sha256(VIEWER.id));
  assert.notEqual(access.actor_key, workspace.workspace_id);
  await assert.rejects(() => resolveWorkspaceAccess(request(VIEWER, "POST", workspace.workspace_id), env), (error) => error.status === 403);
});

test("members cannot manage access or spoof owner fields in a command body", async () => {
  const env = await environment(), workspace = await createShared(env);
  const granted = await grant(env, workspace, EDITOR, "editor");
  await resolveWorkspaceAccess(request(EDITOR, "GET", workspace.workspace_id), env);
  const forgedOwner = await sha256(OWNER.id);
  await assert.rejects(() => routeWorkspaceMembership(request(EDITOR, "POST"), env, ["workspaces", workspace.workspace_id, "members"], { email: VIEWER.email, role: "editor", actor_key: forgedOwner, expected_revision: granted.permissions_revision, confirm: true }), (error) => error.status === 403);
  assert.equal(env.LABVIUM_DB.database.prepare("SELECT COUNT(*) AS n FROM labvium_workspace_email_grants WHERE workspace_key = ?").get(workspace.workspace_id).n, 1);
  await assert.rejects(() => routeWorkspaceMembership(request(EDITOR), env, ["workspaces", workspace.workspace_id, "members"], {}), (error) => error.status === 403);
});

test("owner role grants require explicit confirmation and exact permissions revision", async () => {
  const env = await environment(), workspace = await createShared(env);
  await assert.rejects(() => routeWorkspaceMembership(request(OWNER, "POST"), env, ["workspaces", workspace.workspace_id, "members"], { email: VIEWER.email, role: "viewer", expected_revision: workspace.permissions_revision, confirm: false }), (error) => error.status === 422);
  const first = await grant(env, workspace, VIEWER, "viewer");
  await assert.rejects(() => grant(env, workspace, EDITOR, "editor"), (error) => error.status === 409);
  assert.equal(first.permissions_revision, rev(2));
  assert.equal(env.LABVIUM_DB.database.prepare("SELECT COUNT(*) AS n FROM labvium_workspace_email_grants WHERE workspace_key = ?").get(workspace.workspace_id).n, 1);
});

test("permission races apply none of a stale grant's conditional SQL mutations", async () => {
  const env = await environment(), workspace = await createShared(env);
  env.LABVIUM_DB.beforeBatch = (database) => database.prepare("UPDATE labvium_workspace_access SET permissions_revision = permissions_revision + 1 WHERE workspace_key = ?").run(workspace.workspace_id);
  await assert.rejects(() => grant(env, workspace, VIEWER, "editor"), (error) => error.status === 409);
  assert.equal(env.LABVIUM_DB.database.prepare("SELECT COUNT(*) AS n FROM labvium_workspace_email_grants").get().n, 0);
  assert.equal(env.LABVIUM_DB.database.prepare("SELECT permissions_revision FROM labvium_workspace_access WHERE workspace_key = ?").get(workspace.workspace_id).permissions_revision, 2);
});

test("a failed atomic batch rolls back both grants and accepted member updates", async () => {
  const env = await environment(), workspace = await createShared(env);
  const granted = await grant(env, workspace, EDITOR, "editor");
  await resolveWorkspaceAccess(request(EDITOR, "GET", workspace.workspace_id), env);
  env.LABVIUM_DB.failBatchAt = 2;
  await assert.rejects(() => grant(env, workspace, EDITOR, "viewer", granted.permissions_revision), /Injected transaction failure/);
  assert.equal(env.LABVIUM_DB.database.prepare("SELECT role FROM labvium_workspace_email_grants WHERE workspace_key = ?").get(workspace.workspace_id).role, "editor");
  assert.equal(env.LABVIUM_DB.database.prepare("SELECT role FROM labvium_workspace_members WHERE workspace_key = ?").get(workspace.workspace_id).role, "editor");
  assert.equal(env.LABVIUM_DB.database.prepare("SELECT permissions_revision FROM labvium_workspace_access WHERE workspace_key = ?").get(workspace.workspace_id).permissions_revision, 2);
});

test("downgrade and revocation apply to existing stable member IDs without re-grant", async () => {
  const env = await environment(), workspace = await createShared(env);
  const granted = await grant(env, workspace, EDITOR, "editor");
  assert.equal((await resolveWorkspaceAccess(request(EDITOR, "POST", workspace.workspace_id), env)).role, "editor");
  const downgraded = await grant(env, workspace, EDITOR, "viewer", granted.permissions_revision);
  assert.equal((await resolveWorkspaceAccess(request(EDITOR, "GET", workspace.workspace_id), env)).role, "viewer");
  await assert.rejects(() => resolveWorkspaceAccess(request(EDITOR, "POST", workspace.workspace_id), env), (error) => error.status === 403);
  await revoke(env, workspace, EDITOR, downgraded.permissions_revision);
  await assert.rejects(() => resolveWorkspaceAccess(request(EDITOR, "GET", workspace.workspace_id), env), (error) => error.status === 403);
  assert.equal(env.LABVIUM_DB.database.prepare("SELECT COUNT(*) AS n FROM labvium_workspace_members WHERE workspace_key = ?").get(workspace.workspace_id).n, 0);
});

test("workspace listing reveals only owned or authorized workspaces", async () => {
  const env = await environment(), shared = await createShared(env);
  await grant(env, shared, VIEWER, "viewer");
  const other = await routeWorkspaceMembership(request({ id: "unrelated-owner", email: "unrelated@lab.test" }, "POST"), env, ["workspaces"], { title: "Private geology" });
  const result = await routeWorkspaceMembership(request(VIEWER), env, ["workspaces"], {});
  assert.deepEqual(new Set(result.items.map((row) => row.workspace_id)), new Set([shared.workspace_id, await sha256(VIEWER.id)]));
  assert.ok(!result.items.some((row) => row.workspace_id === other.workspace_id));
  assert.equal(result.items.find((row) => row.workspace_id === shared.workspace_id).role, "viewer");
});

test("PDF URL workspace scope is authorized and cannot select a stranger's files", async () => {
  const env = await environment(), shared = await createShared(env);
  await grant(env, shared, VIEWER, "viewer");
  const trustedHeaders = { "oai-authenticated-user-id": VIEWER.id, "oai-authenticated-user-email": VIEWER.email };
  const pdfRequest = new Request(`https://bandal.app/ku-ai/api/papers/paper-a/pdf?workspace=${shared.workspace_id}`, { headers: trustedHeaders });
  assert.equal((await resolveWorkspaceAccess(pdfRequest, env)).workspace_key, shared.workspace_id);
  const stranger = new Request(`https://bandal.app/ku-ai/api/papers/paper-a/pdf?workspace=${shared.workspace_id}`, { headers: { "oai-authenticated-user-id": "stranger", "oai-authenticated-user-email": "stranger@lab.test" } });
  await assert.rejects(() => resolveWorkspaceAccess(stranger, env), (error) => error.status === 403);
  const otherEndpoint = new Request(`https://bandal.app/ku-ai/api/workspace?workspace=${shared.workspace_id}`, { headers: trustedHeaders });
  assert.equal((await resolveWorkspaceAccess(otherEndpoint, env)).workspace_key, await sha256(VIEWER.id));
});

for (const resource of ["recovery/recovery-a/download", "backups/backup-a"]) {
  test(`${resource.split("/")[0]} download URL requires current workspace membership`, async () => {
    const env = await environment(), shared = await createShared(env);
    const granted = await grant(env, shared, VIEWER, "viewer");
    const download = (actor) => new Request(`https://bandal.app/ku-ai/api/${resource}?workspace=${shared.workspace_id}`, {
      headers: { "oai-authenticated-user-id": actor.id, "oai-authenticated-user-email": actor.email },
    });
    assert.equal((await resolveWorkspaceAccess(download(VIEWER), env)).workspace_key, shared.workspace_id);
    await assert.rejects(() => resolveWorkspaceAccess(download({ id: "outsider", email: "outsider@lab.test" }), env), (error) => error.status === 403);
    await revoke(env, shared, VIEWER, granted.permissions_revision);
    await assert.rejects(() => resolveWorkspaceAccess(download(VIEWER), env), (error) => error.status === 403);
  });
}

test("download query scope applies only to exact GET download routes", async () => {
  const env = await environment(), shared = await createShared(env);
  await grant(env, shared, EDITOR, "editor");
  const headers = { "oai-authenticated-user-id": EDITOR.id, "oai-authenticated-user-email": EDITOR.email };
  const personal = await sha256(EDITOR.id);
  for (const [path, method] of [
    ["papers/paper-a/pdf", "POST"],
    ["recovery/recovery-a/download", "DELETE"],
    ["backups/backup-a", "DELETE"],
    ["papers/paper-a/pdf/extra", "GET"],
    ["recovery/recovery-a/download/extra", "GET"],
    ["backups/backup-a/restore", "GET"],
    ["backups", "GET"],
  ]) {
    const access = await resolveWorkspaceAccess(new Request(`https://bandal.app/ku-ai/api/${path}?workspace=${shared.workspace_id}`, { method, headers }), env);
    assert.equal(access.workspace_key, personal, `${method} ${path} must not use download scope`);
  }
  const explicit = new Request(`https://bandal.app/ku-ai/api/backups/backup-a?workspace=${shared.workspace_id}`, {
    headers: { ...headers, "X-Labvium-Workspace": personal },
  });
  assert.equal((await resolveWorkspaceAccess(explicit, env)).workspace_key, personal, "the explicit API workspace header takes precedence");
});

test("email normalization never broadens grants through plus or dot rewriting", () => {
  assert.equal(normalizeMemberEmail("  Research.Team+ccs@Lab.Test  "), "research.team+ccs@lab.test");
  assert.notEqual(normalizeMemberEmail("research.team+ccs@lab.test"), normalizeMemberEmail("researchteam@lab.test"));
});

test("an editor revoked after loading cannot publish staged state", async () => {
  const env = await environment(), workspace = await createShared(env);
  const granted = await grant(env, workspace, EDITOR, "editor");
  const access = await resolveWorkspaceAccess(request(EDITOR, "POST", workspace.workspace_id), env);
  const loaded = await loadWorkspace(env, workspace.workspace_id);
  loaded.access = access;
  stagedProject(loaded);
  await revoke(env, workspace, EDITOR, granted.permissions_revision);
  await assert.rejects(() => saveWorkspace(env, workspace.workspace_id, loaded), (error) => error.status === 409 || error.status === 403);
  assert.equal((await loadWorkspace(env, workspace.workspace_id)).state.projects.length, 0);
});

test("an editor downgraded after loading cannot publish staged state", async () => {
  const env = await environment(), workspace = await createShared(env);
  const granted = await grant(env, workspace, EDITOR, "editor");
  const access = await resolveWorkspaceAccess(request(EDITOR, "POST", workspace.workspace_id), env);
  const loaded = await loadWorkspace(env, workspace.workspace_id);
  loaded.access = access;
  stagedProject(loaded);
  await grant(env, workspace, EDITOR, "viewer", granted.permissions_revision);
  await assert.rejects(() => saveWorkspace(env, workspace.workspace_id, loaded), (error) => error.status === 409 || error.status === 403);
  assert.equal((await loadWorkspace(env, workspace.workspace_id)).state.projects.length, 0);
});

test("write publication rechecks actual editor membership even with unchanged revision", async () => {
  const env = await environment(), workspace = await createShared(env);
  await grant(env, workspace, EDITOR, "editor");
  const access = await resolveWorkspaceAccess(request(EDITOR, "POST", workspace.workspace_id), env);
  const loaded = await loadWorkspace(env, workspace.workspace_id);
  loaded.access = access;
  stagedProject(loaded);
  env.LABVIUM_DB.database.prepare("UPDATE labvium_workspace_members SET role = 'viewer' WHERE workspace_key = ? AND member_user_key = ?").run(workspace.workspace_id, access.actor_key);
  await assert.rejects(() => saveWorkspace(env, workspace.workspace_id, loaded), (error) => error.status === 409 || error.status === 403);
  assert.equal((await loadWorkspace(env, workspace.workspace_id)).state.projects.length, 0);
});

test("a permission race or transaction failure leaves ownership and previous-owner grants unchanged",async()=>{
  for(const failure of ["race","transaction"]){
    const env=await environment(),workspace=await createShared(env),granted=await grant(env,workspace,EDITOR,"editor");
    await resolveWorkspaceAccess(request(EDITOR,"GET",workspace.workspace_id),env);
    if(failure==="race")env.LABVIUM_DB.beforeBatch=db=>db.prepare("UPDATE labvium_workspace_access SET permissions_revision=permissions_revision+1 WHERE workspace_key=?").run(workspace.workspace_id);
    else env.LABVIUM_DB.failBatchAt=2;
    await assert.rejects(()=>routeWorkspaceMembership(request(OWNER,"POST"),env,["workspaces",workspace.workspace_id,"transfer"],{email:EDITOR.email,expected_revision:granted.permissions_revision,confirm:true}));
    assert.equal((await resolveWorkspaceAccess(request(OWNER,"GET",workspace.workspace_id),env)).role,"owner");
    assert.equal(env.LABVIUM_DB.database.prepare("SELECT COUNT(*) AS n FROM labvium_workspace_members WHERE workspace_key=? AND member_user_key=?").get(workspace.workspace_id,await sha256(OWNER.id)).n,0);
  }
});
