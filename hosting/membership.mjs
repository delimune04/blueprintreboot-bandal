import { fail, sha256, now, rev, strict, text, choice, confirm } from "./domain/core.mjs";
import { ownerKey } from "./domain/store.mjs";

const WORKSPACE_KEY = /^[0-9a-f]{64}$/;
const ROLE = ["viewer", "editor"];
export function normalizeMemberEmail(value) {
  const email = text(value, 254, true).normalize("NFC").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(422, "Enter a valid email address.");
  return email;
}
async function trustedActor(request) {
  const actor_key = await ownerKey(request);
  const raw = request.headers.get("oai-authenticated-user-email");
  return { actor_key, email: raw ? normalizeMemberEmail(raw) : null };
}
async function ensurePersonal(env, actor) {
  await env.LABVIUM_DB.prepare("INSERT OR IGNORE INTO labvium_workspace_access (workspace_key, owner_user_key, title, permissions_revision, created_at) VALUES (?, ?, ?, 1, ?)")
    .bind(actor.actor_key, actor.actor_key, "Personal research", now()).run();
}
async function acceptExistingGrants(env, actor) {
  if (!actor.email) return;
  const email_key = await sha256(actor.email);
  // Only platform-supplied email can claim a grant. Body/header owner overrides
  // never act as identity. Stable user IDs retain accepted memberships.
  await env.LABVIUM_DB.prepare("INSERT OR IGNORE INTO labvium_workspace_members (workspace_key, member_user_key, email_key, role, joined_at) SELECT workspace_key, ?, email_key, role, ? FROM labvium_workspace_email_grants WHERE email_key = ?")
    .bind(actor.actor_key, now(), email_key).run();
}
export async function resolveWorkspaceAccess(request, env) {
  if (!env.LABVIUM_DB) fail(503, "Workspace access storage is unavailable.");
  const actor = await trustedActor(request);
  const url = new URL(request.url);
  const isScopedDownload = /\/papers\/[^/]+\/pdf$/.test(url.pathname)
    || /\/recovery\/[^/]+\/download$/.test(url.pathname)
    || /\/backups\/[^/]+$/.test(url.pathname);
  const downloadScope = request.method === "GET" && isScopedDownload ? url.searchParams.get("workspace") : null;
  const selected = request.headers.get("X-Labvium-Workspace") || downloadScope || actor.actor_key;
  if (!WORKSPACE_KEY.test(selected)) fail(422, "Invalid workspace identity.");
  if (selected === actor.actor_key) await ensurePersonal(env, actor);
  await acceptExistingGrants(env, actor);
  const workspace = await env.LABVIUM_DB.prepare("SELECT workspace_key, owner_user_key, title, permissions_revision FROM labvium_workspace_access WHERE workspace_key = ?").bind(selected).first();
  if (!workspace) fail(403, "This workspace is not available to your account.");
  let role = workspace.owner_user_key === actor.actor_key ? "owner" : null;
  if (!role) {
    const member = await env.LABVIUM_DB.prepare("SELECT role FROM labvium_workspace_members WHERE workspace_key = ? AND member_user_key = ?").bind(selected, actor.actor_key).first();
    role = member?.role;
  }
  if (!["owner", ...ROLE].includes(role)) fail(403, "Your account does not have access to this workspace.");
  if (request.method !== "GET" && request.method !== "HEAD" && role === "viewer") fail(403, "This workspace grants you read-only access.");
  return { ...actor, workspace_key: selected, role, title: workspace.title, permissions_revision: workspace.permissions_revision };
}
function checkExpected(value, actual) { if (value !== rev(actual)) fail(409, "Workspace access changed. Reload before updating permissions.", "conflict"); }

export async function routeWorkspaceMembership(request, env, parts, body) {
  if (parts[0] !== "workspaces") return null;
  const actor = await trustedActor(request);
  await ensurePersonal(env, actor); await acceptExistingGrants(env, actor);
  const method = request.method;
  if (parts.length === 1 && method === "GET") {
    const rows = await env.LABVIUM_DB.prepare("SELECT a.workspace_key, a.title, a.owner_user_key, a.permissions_revision, m.role FROM labvium_workspace_access a LEFT JOIN labvium_workspace_members m ON a.workspace_key = m.workspace_key AND m.member_user_key = ? WHERE a.owner_user_key = ? OR m.member_user_key = ? ORDER BY a.created_at").bind(actor.actor_key, actor.actor_key, actor.actor_key).all();
    return { personal_workspace_id: actor.actor_key, items: rows.results.map((row) => ({ workspace_id: row.workspace_key, title: row.title, role: row.owner_user_key === actor.actor_key ? "owner" : row.role, permissions_revision: rev(row.permissions_revision) })) };
  }
  if (parts.length === 1 && method === "POST") {
    strict(body, ["title"]);
    const title = text(body.title, 200, true).trim();
    const count = await env.LABVIUM_DB.prepare("SELECT COUNT(*) AS count FROM labvium_workspace_access WHERE owner_user_key = ?").bind(actor.actor_key).first();
    if (count.count >= 20) fail(422, "You can own up to 20 workspaces.");
    const workspace_id = await sha256(crypto.randomUUID());
    await env.LABVIUM_DB.prepare("INSERT INTO labvium_workspace_access (workspace_key, owner_user_key, title, permissions_revision, created_at) VALUES (?, ?, ?, 1, ?)").bind(workspace_id, actor.actor_key, title, now()).run();
    return { workspace_id, title, role: "owner", permissions_revision: rev(1) };
  }
  const selected = parts[1];
  if (!WORKSPACE_KEY.test(selected || "")) fail(422, "Invalid workspace identity.");
  const workspace = await env.LABVIUM_DB.prepare("SELECT owner_user_key, permissions_revision FROM labvium_workspace_access WHERE workspace_key = ?").bind(selected).first();
  if (!workspace || workspace.owner_user_key !== actor.actor_key) fail(403, "Only the workspace owner can manage access.");
  if (parts[2] === "members" && parts.length === 3 && method === "GET") {
    const grants = await env.LABVIUM_DB.prepare("SELECT email_key, email_label, role, created_at FROM labvium_workspace_email_grants WHERE workspace_key = ? ORDER BY created_at").bind(selected).all();
    return { items: grants.results.map((row) => ({ member_id: row.email_key, email: row.email_label, role: row.role, created_at: row.created_at })), permissions_revision: rev(workspace.permissions_revision) };
  }
  if (parts[2] === "members" && parts.length === 3 && method === "POST") {
    strict(body, ["email", "role", "expected_revision", "confirm"]); confirm(body); checkExpected(body.expected_revision, workspace.permissions_revision);
    const email = normalizeMemberEmail(body.email), email_key = await sha256(email), role = choice(body.role, ROLE);
    if (actor.email === email) fail(422, "The workspace owner already has full access.");
    const count = await env.LABVIUM_DB.prepare("SELECT COUNT(*) AS count FROM labvium_workspace_email_grants WHERE workspace_key = ?").bind(selected).first();
    if (count.count >= 100) fail(422, "Workspace member limit reached.");
    const expected = workspace.permissions_revision;
    const result = await env.LABVIUM_DB.batch([
      env.LABVIUM_DB.prepare("INSERT INTO labvium_workspace_email_grants (workspace_key, email_key, email_label, role, created_by, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM labvium_workspace_access WHERE workspace_key = ? AND owner_user_key = ? AND permissions_revision = ?) ON CONFLICT(workspace_key, email_key) DO UPDATE SET role = excluded.role, email_label = excluded.email_label").bind(selected, email_key, email, role, actor.actor_key, now(), selected, actor.actor_key, expected),
      env.LABVIUM_DB.prepare("UPDATE labvium_workspace_members SET role = ? WHERE workspace_key = ? AND email_key = ? AND EXISTS (SELECT 1 FROM labvium_workspace_access WHERE workspace_key = ? AND permissions_revision = ?)").bind(role, selected, email_key, selected, expected),
      env.LABVIUM_DB.prepare("UPDATE labvium_workspace_access SET permissions_revision = permissions_revision + 1 WHERE workspace_key = ? AND owner_user_key = ? AND permissions_revision = ?").bind(selected, actor.actor_key, expected),
    ]);
    if (result[2].meta?.changes !== 1) fail(409, "Workspace access changed. Reload before sharing.", "conflict");
    return { status: "granted", email, role, permissions_revision: rev(expected + 1), message: "Access is enabled when this email signs in. No invitation email was sent." };
  }
  if (parts[2] === "members" && parts.length === 4 && method === "DELETE") {
    strict(body, ["expected_revision", "confirm"]); confirm(body); checkExpected(body.expected_revision, workspace.permissions_revision);
    const email_key = parts[3]; if (!WORKSPACE_KEY.test(email_key)) fail(422, "Invalid member identity.");
    const expected = workspace.permissions_revision;
    const result = await env.LABVIUM_DB.batch([
      env.LABVIUM_DB.prepare("DELETE FROM labvium_workspace_email_grants WHERE workspace_key = ? AND email_key = ? AND EXISTS (SELECT 1 FROM labvium_workspace_access WHERE workspace_key = ? AND permissions_revision = ?)").bind(selected, email_key, selected, expected),
      env.LABVIUM_DB.prepare("DELETE FROM labvium_workspace_members WHERE workspace_key = ? AND email_key = ? AND EXISTS (SELECT 1 FROM labvium_workspace_access WHERE workspace_key = ? AND permissions_revision = ?)").bind(selected, email_key, selected, expected),
      env.LABVIUM_DB.prepare("UPDATE labvium_workspace_access SET permissions_revision = permissions_revision + 1 WHERE workspace_key = ? AND owner_user_key = ? AND permissions_revision = ?").bind(selected, actor.actor_key, expected),
    ]);
    if (result[2].meta?.changes !== 1) fail(409, "Workspace access changed. Reload before revoking.", "conflict");
    return { status: "revoked", permissions_revision: rev(expected + 1) };
  }
  fail(404, "Workspace access command not found.");
}
