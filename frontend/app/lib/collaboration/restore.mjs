import { emptyCollaboration, validateCollaboration } from "./model.mjs";

/** Only actual restore publication calls this. Downloaded archives and preview
 * validation retain their original bytes and revision. A new generation keeps
 * forms opened before the restore from matching an older restored revision.
 */
export function collaborationAfterRestore(previous, incoming) {
  if (previous === undefined && incoming === undefined) return undefined;
  if (previous !== undefined) validateCollaboration(previous);
  if (incoming !== undefined) validateCollaboration(incoming);
  const next = structuredClone(incoming ?? emptyCollaboration());
  next.revision = Math.max(previous?.revision ?? 1, next.revision) + 1;
  validateCollaboration(next);
  return next;
}
