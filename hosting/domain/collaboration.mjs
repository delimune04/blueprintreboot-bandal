import { applyCollaborationCommand, getCollaborationSnapshot } from "../../frontend/app/lib/collaboration/model.mjs";
import { fail } from "./core.mjs";

/** The HTTP adapter passes only the server-resolved actor and accepted roster. */
export function routeCollaboration(parts, method, body, state, context) {
  if (parts[0] !== "collaboration") return null;
  if (parts.length === 1 && method === "GET") return getCollaborationSnapshot(state, context);
  if (parts.length === 2 && parts[1] === "summary" && method === "GET") {
    const snapshot = getCollaborationSnapshot(state, context);
    return { unread_count: snapshot.notifications.filter(notification => !notification.read_at).length, revision: snapshot.revision };
  }
  const result = applyCollaborationCommand(state, parts, method, body, context);
  if (result === null) fail(404, "Collaboration command not found.");
  return result;
}
