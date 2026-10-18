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
    || /\/backups\/[^/]+$/.test(url.pathname)
    || /\/exports\/(workspace|raw)$/.test(url.pathname);
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

/** Read only the accepted roster of the already-authorized selected workspace.
 * Pending email grants never become selectable identities. This does not open
 * the owner's access-management endpoint to other members.
 */
export async function collaborationMembership(request, env, access) {
  const rows = await env.LABVIUM_DB.prepare("SELECT a.owner_user_key, m.member_user_key, m.role, g.email_label FROM labvium_workspace_access a LEFT JOIN labvium_workspace_members m ON m.workspace_key = a.workspace_key AND m.member_user_key != a.owner_user_key LEFT JOIN labvium_workspace_email_grants g ON g.workspace_key = m.workspace_key AND g.email_key = m.email_key WHERE a.workspace_key = ?")
    .bind(access.workspace_key).all();
  if (!rows.results.length) fail(403, "This workspace is no longer available.");
  const members = [{ id: rows.results[0].owner_user_key, name: "공간 관리자", email: "", role: "owner", accepted: true }];
  for (const row of rows.results) if (row.member_user_key && ["viewer", "editor"].includes(row.role)) members.push({ id: row.member_user_key, name: row.email_label || "공간 구성원", email: row.email_label || "", role: row.role, accepted: true });
  let name = request.headers.get("oai-authenticated-user-full-name") || "";
  if (request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") { try { name = decodeURIComponent(name); } catch { name = ""; } }
  name = name.replace(/[\u0000-\u001f]/g, "").slice(0, 300).trim();
  const actor = { id: access.actor_key, name: name || access.email || (access.role === "owner" ? "공간 관리자" : "공간 구성원"), email: access.email || "", role: access.role, accepted: true };
  const index = members.findIndex(member => member.id === actor.id);
  if (index < 0 || members[index].role !== actor.role) fail(409, "Workspace access changed. Reload before continuing.", "conflict");
  members[index] = actor;
  return { actor, members, mode: "cloud" };
}

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
  if (parts.length === 3 && parts[2] === "transfer" && method === "POST") {
    strict(body, ["email", "expected_revision", "confirm"]); confirm(body); checkExpected(body.expected_revision, workspace.permissions_revision);
    if (selected === actor.actor_key) fail(422, "Personal workspaces cannot be transferred. Use a separate team workspace.");
    if (!actor.email) fail(422, "A verified account email is required for ownership transfer.");
    const email = normalizeMemberEmail(body.email), email_key = await sha256(email);
    if (email === actor.email) fail(422, "Select another accepted team member.");
    const member = await env.LABVIUM_DB.prepare("SELECT member_user_key FROM labvium_workspace_members WHERE workspace_key = ? AND email_key = ?").bind(selected, email_key).first();
    if (!member || member.member_user_key === actor.actor_key) fail(422, "The recipient must already have signed in and joined this workspace.");
    const expected = workspace.permissions_revision, previousEmail = await sha256(actor.email);
    const guard = "EXISTS (SELECT 1 FROM labvium_workspace_access a WHERE a.workspace_key = ? AND a.owner_user_key = ? AND a.permissions_revision = ? AND EXISTS (SELECT 1 FROM labvium_workspace_members m WHERE m.workspace_key = a.workspace_key AND m.member_user_key = ? AND m.email_key = ?))";
    const args = [selected, actor.actor_key, expected, member.member_user_key, email_key];
    const results = await env.LABVIUM_DB.batch([
      env.LABVIUM_DB.prepare(`INSERT INTO labvium_workspace_members (workspace_key, member_user_key, email_key, role, joined_at) SELECT ?, ?, ?, 'editor', ? WHERE ${guard} ON CONFLICT(workspace_key, member_user_key) DO UPDATE SET role = 'editor', email_key = excluded.email_key`).bind(selected, actor.actor_key, previousEmail, now(), ...args),
      env.LABVIUM_DB.prepare(`INSERT INTO labvium_workspace_email_grants (workspace_key, email_key, email_label, role, created_by, created_at) SELECT ?, ?, ?, 'editor', ?, ? WHERE ${guard} ON CONFLICT(workspace_key, email_key) DO UPDATE SET role = 'editor', email_label = excluded.email_label`).bind(selected, previousEmail, actor.email, actor.actor_key, now(), ...args),
      env.LABVIUM_DB.prepare(`UPDATE labvium_workspace_access SET owner_user_key = ?, permissions_revision = permissions_revision + 1 WHERE workspace_key = ? AND ${guard}`).bind(member.member_user_key, selected, ...args),
    ]);
    if (results[2].meta?.changes !== 1) fail(409, "Access changed before ownership transfer. Reload and try again.", "conflict");
    return { status: "transferred", email, previous_owner_role: "editor", permissions_revision: rev(expected + 1) };
  }
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
