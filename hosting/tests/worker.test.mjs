import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// Isolate routing and ingress authorization from the separately tested API domain.
const source = (await readFile(new URL("../worker.mjs", import.meta.url), "utf8"))
  .replace('import { handleLabviumApi } from "./api.mjs";',
    'async function handleLabviumApi(request, env) { return Response.json({ path: new URL(request.url).pathname, marker: env.marker }); }');
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)).default;
function request(path, options = {}) { return new Request(`https://bandal.app${path}`, options); }
function assetEnv(files = {}) {
  return { ASSETS: { async fetch(req) {
    const path = new URL(req.url).pathname;
    return path in files ? new Response(req.method === "HEAD" ? null : files[path], { headers: { "Content-Type": "text/html" } }) : new Response("404", { status: 404 });
  } } };
}

test("anonymous writes cannot reach the API", async () => {
  const response = await worker.fetch(request("/ku-ai/api/papers", { method: "POST", body: "{}" }), {});
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "authentication_required");
});
test("authenticated cross-origin writes cannot reach the API", async () => {
  const response = await worker.fetch(request("/ku-ai/api/papers", { method: "POST", headers: {
    "oai-authenticated-user-id": "dispatch-user", origin: "https://evil.example", "sec-fetch-site": "cross-site",
  }, body: "{}" }), {});
  assert.equal(response.status, 403);
});
test("authenticated same-origin write forwards to owner-scoped API", async () => {
  const response = await worker.fetch(request("/ku-ai/api/papers", { method: "POST", headers: {
    "oai-authenticated-user-id": "dispatch-user", origin: "https://bandal.app", "sec-fetch-site": "same-origin",
  }, body: "{}" }), { marker: "correct-binding" });
  assert.deepEqual(await response.json(), { path: "/ku-ai/api/papers", marker: "correct-binding" });
});
test("public metadata read can reach API without writable identity", async () => {
  const response = await worker.fetch(request("/ku-ai/api/discover"), { marker: "public" });
  assert.equal(response.status, 200);
});
test("existing homepage and article directory indexes remain reachable", async () => {
  const env = assetEnv({ "/index.html": "home", "/harupyeon/tips/article/index.html": "article" });
  assert.equal(await (await worker.fetch(request("/"), env)).text(), "home");
  assert.equal(await (await worker.fetch(request("/harupyeon/tips/article/"), env)).text(), "article");
});
test("only Labvium extensionless document requests get SPA fallback", async () => {
  const env = assetEnv({ "/ku-ai/index.html": "labvium" });
  assert.equal(await (await worker.fetch(request("/ku-ai/library", { headers: { accept: "text/html" } }), env)).text(), "labvium");
  assert.equal((await worker.fetch(request("/ku-ai/missing.js", { headers: { accept: "text/html" } }), env)).status, 404);
  assert.equal((await worker.fetch(request("/missing", { headers: { accept: "text/html" } }), env)).status, 404);
});
test("ku-ai canonical redirect preserves mounted path", async () => {
  const response = await worker.fetch(request("/ku-ai"), assetEnv());
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://bandal.app/ku-ai/");
});
test("static assets never accept writes", async () => {
  assert.equal((await worker.fetch(request("/", { method: "POST", body: "ignored" }), assetEnv())).status, 405);
});
