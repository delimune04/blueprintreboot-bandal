/** An explicit click posts a source snapshot to this workspace's idea feed.
 * The request identity survives ambiguous network outcomes so retries are safe.
 */
export function createQuickIdeaDraft(source, requestId, locale = "ko") {
  if (!source || !["paper", "project", "page"].includes(source.type) || typeof source.id !== "string" || !source.id) throw new Error("Choose a saved research source first.");
  if (typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw new Error("A request identity is required.");
  return { request_id: requestId, idea: { title: String(source.title || (locale === "ko" ? "함께 검토할 연구 아이디어" : "Research idea to review")).slice(0, 200), body: locale === "ko" ? "이 아이디어 어때요?" : "What do you think of this idea?", recipient_ids: [], source: { type: source.type, id: source.id, title: String(source.title || "").slice(0, 200), excerpt: String(source.excerpt || "").slice(0, 5000) } } };
}
export async function sendQuickIdeaDraft(draft, { request, scope, getScope }) {
  const unchanged = () => { if (getScope() !== scope) { const error = new Error("The workspace changed. Open the source in the current workspace and try again."); error.code = "workspace_changed"; throw error; } };
  unchanged();
  const snapshot = await request("/collaboration");
  unchanged();
  if (!snapshot.permissions?.can_edit) { const error = new Error("An editor role is required to ask for feedback in this workspace."); error.status = 403; throw error; }
  const result = await request("/collaboration/ideas", { method: "POST", body: { ...draft, expected_revision: snapshot.revision } });
  unchanged();
  if (typeof result.result_id !== "string" || !result.result_id) throw new Error("The saved question could not be confirmed. Retry with the same request.");
  return result;
}
