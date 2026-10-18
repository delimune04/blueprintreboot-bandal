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
  const response = await worker.fetch(request("/LabVium/api/papers", { method: "POST", body: "{}" }), {});
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
test("canonical LabVium root and direct HTML routes use the retained asset tree", async () => {
  const env = assetEnv({ "/ku-ai/index.html": "labvium" });
  for (const path of ["/LabVium", "/LabVium/library", "/LabVium/papers/paper-a/reader?workspace=team", "/LabVium/collaboration/ideas/idea-a"]) {
    const response = await worker.fetch(request(path, { headers: { accept: "text/html" } }), env);
    assert.equal(response.status, 200, path);
    assert.equal(await response.text(), "labvium", path);
  }
  assert.equal((await worker.fetch(request("/LabVium", { method: "HEAD" }), env)).status, 200);
  assert.equal((await worker.fetch(request("/LabVium/library", { headers: { accept: "application/json" } }), env)).status, 404);
});
test("legacy app bookmarks redirect to the canonical path without dropping query or changing origin", async () => {
  for (const [from, to] of [["/ku-ai", "/LabVium"], ["/ku-ai/", "/LabVium"], ["/ku-ai/index.html?workspace=abc", "/LabVium?workspace=abc"], ["/ku-ai/library?sort=newest", "/LabVium/library?sort=newest"], ["/ku-ai//evil?return_to=https://evil.example", "/LabVium//evil?return_to=https://evil.example"], ["/LabVium/?workspace=abc", "/LabVium?workspace=abc"], ["/LabVium/index.html?q=CCS", "/LabVium?q=CCS"]]) {
    const response = await worker.fetch(request(from), assetEnv());
    assert.equal(response.status, 308, from);
    assert.equal(response.headers.get("location"), `https://bandal.app${to}`, from);
  }
});
test("new and old static assets and PDFs have the same bytes, with no redirect", async () => {
  const env = assetEnv({ "/ku-ai/assets/app.js": "js-code", "/ku-ai/help/LabVium_User_Guide_KO.pdf": "%PDF-guide", "/ku-ai/brand/labvium-mark.svg": "logo" });
  for (const prefix of ["/LabVium", "/ku-ai"]) for (const [suffix, bytes] of [["/assets/app.js", "js-code"], ["/help/LabVium_User_Guide_KO.pdf", "%PDF-guide"], ["/brand/labvium-mark.svg", "logo"]]) {
    const response = await worker.fetch(request(`${prefix}${suffix}`), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
    assert.equal(await response.text(), bytes);
  }
});
test("SPA fallback never replaces missing files, reserved asset paths, invalid encodings, or unrelated paths", async () => {
  const env = assetEnv({ "/ku-ai/index.html": "labvium" });
  for (const path of ["/LabVium/missing.js", "/LabVium/help/missing.pdf", "/LabVium/help/missing", "/LabVium/assets/missing", "/LabVium/%61pi/private", "/LabVium/%2fapi/private", "/LabVium/%ZZ", "/ku-ai/missing.js", "/ku-ai/missing.html", "/LabViumish/library", "/missing"]) {
    assert.equal((await worker.fetch(request(path, { headers: { accept: "text/html" } }), env)).status, 404, path);
  }
});
test("both API mounts preserve ingress authentication and same-origin rules without redirecting mutations", async () => {
  for (const prefix of ["/LabVium/api", "/ku-ai/api"]) {
    assert.equal((await worker.fetch(request(`${prefix}/papers`, { method: "POST", body: "{}" }), {})).status, 401);
    assert.equal((await worker.fetch(request(`${prefix}/papers`, { method: "POST", headers: { "oai-authenticated-user-id": "dispatch-user", origin: "https://evil.example", "sec-fetch-site": "cross-site" }, body: "{}" }), {})).status, 403);
    const response = await worker.fetch(request(`${prefix}/papers`, { method: "POST", headers: { "oai-authenticated-user-id": "dispatch-user", origin: "https://bandal.app", "sec-fetch-site": "same-origin" }, body: "{}" }), { marker: "existing-binding" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
    assert.deepEqual(await response.json(), { path: `${prefix}/papers`, marker: "existing-binding" });
  }
  assert.equal((await worker.fetch(request("/LabVium/apiary", { method: "POST", body: "{}" }), assetEnv())).status, 405);
});
test("static assets never accept writes", async () => {
  assert.equal((await worker.fetch(request("/", { method: "POST", body: "ignored" }), assetEnv())).status, 405);
});
test("the dedicated LabVium hostname opens the research product without changing the BANDAL homepage",async()=>{
  const env=assetEnv({"/index.html":"bandal","/ku-ai/index.html":"labvium"});
  const response=await worker.fetch(new Request("https://labvium.bandal.app/?workspace=abc"),env);
  assert.equal(response.status,200);assert.equal(response.headers.get("location"),null);assert.equal(await response.text(),"labvium");
  assert.equal(await(await worker.fetch(new Request("https://bandal.app/"),env)).text(),"bandal");
});
