import { fail, emptyWorkspace, validateWorkspace, MAX_STATE_BYTES, sha256, now } from "./core.mjs";

export async function ownerKey(request) {
  const identity = request.headers.get("oai-authenticated-user-id");
  if (!identity || identity.length > 512 || /[\u0000-\u001f]/.test(identity)) fail(401, "Sign in to open your private workspace.", "sign_in_required");
  return sha256(identity);
}
export function requireWriteOrigin(request) {
  const origin = request.headers.get("origin"), url = new URL(request.url);
  if (origin && origin !== url.origin) fail(403, "Cross-origin workspace commands are not allowed.");
  if (["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site"))) fail(403, "Workspace commands must use the same origin.");
}
export async function loadWorkspace(env, owner) {
  if (!env.LABVIUM_DB || !env.LABVIUM_PDFS) fail(503, "Cloud workspace storage is not configured.", "storage_unavailable");
  let row = await env.LABVIUM_DB.prepare("SELECT revision, state_json, updated_at FROM labvium_workspaces WHERE owner_key = ?").bind(owner).first();
  if (!row) {
    const state = emptyWorkspace();
    await env.LABVIUM_DB.prepare("INSERT OR IGNORE INTO labvium_workspaces (owner_key, revision, state_json, updated_at) VALUES (?, 1, ?, ?)").bind(owner, JSON.stringify(state), now()).run();
    row = await env.LABVIUM_DB.prepare("SELECT revision, state_json, updated_at FROM labvium_workspaces WHERE owner_key = ?").bind(owner).first();
  }
  if (!row || !Number.isSafeInteger(row.revision) || row.revision < 1) fail(503, "The saved workspace revision is unreadable.");
  let state; try { state = JSON.parse(row.state_json); } catch { fail(503, "The saved workspace is unreadable; no reset was performed.", "corrupt_state"); }
  if (state?.storage === "r2") {
    if (!/^[0-9a-f]{64}$/.test(state.sha256 || "") || !Number.isSafeInteger(state.size_bytes) || state.size_bytes < 1 || state.size_bytes > MAX_STATE_BYTES) fail(503, "The saved workspace reference is unreadable.");
    const object = await readPrivateObject(env, owner, state.key);
    if (!object || object.size !== state.size_bytes) fail(503, "The retained workspace object is unavailable; no reset was performed.");
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (await sha256(bytes) !== state.sha256) fail(503, "The retained workspace checksum failed; no reset was performed.");
    try { state = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(503, "The retained workspace is unreadable."); }
  }
  try { validateWorkspace(state); } catch { fail(503, "The saved workspace failed its storage contract; no reset was performed.", "corrupt_state"); }
  return { state, revision: row.revision, updated_at:row.updated_at, original: JSON.stringify(state) };
}
export async function saveWorkspace(env, owner, loaded) {
  validateWorkspace(loaded.state);
  const serialized = JSON.stringify(loaded.state);
  if (new TextEncoder().encode(serialized).byteLength > MAX_STATE_BYTES) fail(413, "This workspace reached its structured-state storage limit. Export your work before adding more.", "workspace_limit");
  if (serialized === loaded.original) return loaded.revision;
  let persisted = serialized, spill = null;
  if (new TextEncoder().encode(serialized).length > 512 * 1024) {
    spill = await putPrivateObject(env, owner, "state", new TextEncoder().encode(serialized), { contentType: "application/json" });
    persisted = JSON.stringify({ storage: "r2", ...spill });
  }
  let result;
  try {
    const access = loaded.access;
    const permissionGuard = access ? " AND EXISTS (SELECT 1 FROM labvium_workspace_access a WHERE a.workspace_key = ? AND a.permissions_revision = ? AND (a.owner_user_key = ? OR EXISTS (SELECT 1 FROM labvium_workspace_members m WHERE m.workspace_key = a.workspace_key AND m.member_user_key = ? AND m.role = 'editor')))" : "";
    const values = [persisted, now(), owner, loaded.revision, ...(access ? [access.workspace_key, access.permissions_revision, access.actor_key, access.actor_key] : [])];
    result = await env.LABVIUM_DB.prepare("UPDATE labvium_workspaces SET state_json = ?, revision = revision + 1, updated_at = ? WHERE owner_key = ? AND revision = ?" + permissionGuard).bind(...values).run();
  }
  // A transport failure may occur after D1 committed. Retain the immutable
  // object on ambiguous outcomes so a committed pointer can never dangle.
  catch (error) { throw error; }
  if (result.meta?.changes === 0) { if (spill) await env.LABVIUM_PDFS.delete(spill.key).catch(() => {}); fail(409, "The workspace changed in another session. Reload before saving.", "conflict"); }
  if (result.meta?.changes !== 1) fail(503, "The storage result was ambiguous. Reload to inspect the saved state; retained objects were preserved.", "storage_ambiguous");
  return loaded.revision + 1;
}
export function privateKey(owner, kind, identity) { return `labvium/${owner}/${kind}/${identity}`; }
export async function readPrivateObject(env, owner, key) { if (typeof key !== "string" || !key.startsWith(`labvium/${owner}/`) || key.includes("..")) fail(409, "Invalid private object reference."); return env.LABVIUM_PDFS.get(key); }
export async function putPrivateObject(env, owner, kind, bytes, metadata = {}) {
  const sha = await sha256(bytes), key = privateKey(owner, kind, `${sha}-${crypto.randomUUID()}`);
  await env.LABVIUM_PDFS.put(key, bytes, { httpMetadata: { contentType: metadata.contentType || "application/octet-stream" }, customMetadata: { owner, sha256: sha, ...metadata } });
  const stored = await readPrivateObject(env, owner, key);
  if (!stored || stored.size !== bytes.byteLength || await sha256(new Uint8Array(await stored.arrayBuffer())) !== sha) fail(503, "Private object persistence could not be verified.");
  return { key, sha256: sha, size_bytes: bytes.byteLength, created_at: now() };
}
