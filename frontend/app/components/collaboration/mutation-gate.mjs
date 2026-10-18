/** One in-flight command, with an identical request id after an ambiguous retry. */
export function createCollaborationMutationGate({ request, id = () => crypto.randomUUID() }) {
  let locked = false;
  const pending = new Map();
  return {
    get locked() { return locked; },
    async run(path, method, body, revision, idempotent = false) {
      if (locked) return null;
      locked = true;
      const fingerprint = JSON.stringify([path, method, body]);
      const requestId = idempotent ? pending.get(fingerprint) || id() : undefined;
      if (requestId) pending.set(fingerprint, requestId);
      try {
        const response = await request(path, { method, body: { ...body, expected_revision: revision, ...(requestId ? { request_id: requestId } : {}) } });
        pending.delete(fingerprint);
        return response;
      } finally { locked = false; }
    },
  };
}
