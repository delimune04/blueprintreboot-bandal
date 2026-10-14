import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const hostingRoot = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(process.argv[2] || dirname(hostingRoot));
const dist = join(siteRoot, "dist");
const manifest = JSON.parse(await readFile(join(dist, ".openai/hosting.json"), "utf8"));
assert.ok(manifest.project_id);
assert.equal(manifest.static, undefined);
assert.equal(manifest.d1, "LABVIUM_DB");
assert.equal(manifest.r2, "LABVIUM_PDFS");
const source = await readFile(join(dist, "server/index.js"), "utf8");
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)).default;
assert.equal(typeof worker?.fetch, "function");
const config = JSON.parse(await readFile(join(dist, "server/wrangler.json"), "utf8"));
assert.equal(config.assets.binding, "ASSETS");
assert.equal(config.assets.directory, "../client");
assert.equal(config.assets.run_worker_first, true);
const sourceAssets = await hashFiles(join(siteRoot, "assetdist"));
const builtAssets = await hashFiles(join(dist, "client"));
assert.deepEqual(builtAssets, sourceAssets, "Every original static asset must be preserved byte-for-byte.");
assert.ok(sourceAssets["index.html"]);
assert.ok(sourceAssets["ku-ai/index.html"]);
assert.ok((await readdir(join(dist, ".openai/drizzle"))).some((file) => file.endsWith(".sql")));
console.log(`Validated ESM Worker, D1/R2 bindings and ${Object.keys(sourceAssets).length} preserved assets.`);

async function hashFiles(root, prefix = "") {
  const result = {};
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await hashFiles(join(root, entry.name), path));
    else if (entry.isFile()) result[path] = createHash("sha256").update(await readFile(join(root, entry.name))).digest("hex");
    else throw new Error(`Unsupported asset entry: ${path}`);
  }
  return result;
}
