import { createRequire } from "node:module";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const hostingRoot = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const options = new Map();
for (let i = 0; i < args.length; i += 2) {
  if (!["--site-root", "--assets", "--output", "--esbuild"].includes(args[i]) || !args[i + 1]) {
    throw new Error("Usage: build-site.mjs [--site-root PATH] [--assets PATH] [--output PATH] [--esbuild PATH]");
  }
  options.set(args[i], resolve(args[i + 1]));
}
const siteRoot = options.get("--site-root") || dirname(hostingRoot);
const assetsRoot = options.get("--assets") || join(siteRoot, "assetdist");
const outputRoot = options.get("--output") || join(siteRoot, "dist");
const relativeOutput = relative(siteRoot, outputRoot);
if (!relativeOutput || relativeOutput.startsWith("..") || isAbsolute(relativeOutput)) {
  throw new Error("Build output must be a subdirectory of the Site checkout.");
}
if (assetsRoot === outputRoot || assetsRoot.startsWith(`${outputRoot}/`)) {
  throw new Error("Keep source assets in assetdist, outside generated dist.");
}
const manifest = JSON.parse(await readFile(join(siteRoot, ".openai/hosting.json"), "utf8"));
if (!manifest.project_id || manifest.static) throw new Error("Worker manifest must preserve project_id and omit static.");
if (manifest.d1 !== "LABVIUM_DB" || manifest.r2 !== "LABVIUM_PDFS") throw new Error("Declare LABVIUM_DB and LABVIUM_PDFS bindings.");
await stat(join(assetsRoot, "index.html"));
await stat(join(assetsRoot, "ku-ai/index.html"));
await assertRegularTree(assetsRoot);
const require = createRequire(import.meta.url);
const esbuild = options.has("--esbuild") ? require(options.get("--esbuild")) : require("esbuild");
const staging = `${outputRoot}.labvium-build`;
await rm(staging, { force: true, recursive: true });
await mkdir(join(staging, "server"), { recursive: true });
await mkdir(join(staging, ".openai"), { recursive: true });
try {
  await cp(assetsRoot, join(staging, "client"), { recursive: true });
  await esbuild.build({
    entryPoints: [join(hostingRoot, "worker.mjs")],
    outfile: join(staging, "server/index.js"), bundle: true, format: "esm",
    platform: "browser", target: "es2022", minify: false, sourcemap: false,
    external: ["cloudflare:workers"], logLevel: "warning",
  });
  await writeFile(join(staging, ".openai/hosting.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const migrationRoot = join(hostingRoot, "drizzle");
  if (await exists(migrationRoot)) {
    await assertRegularTree(migrationRoot);
    await cp(migrationRoot, join(staging, ".openai/drizzle"), { recursive: true });
  }
  const wrangler = {
    name: "bandal-studio", main: "index.js", compatibility_date: "2026-10-14",
    compatibility_flags: ["nodejs_compat"],
    assets: { directory: "../client", binding: "ASSETS", run_worker_first: true,
      html_handling: "none", not_found_handling: "none" },
    d1_databases: [{ binding: manifest.d1, database_name: "labvium-workspaces",
      database_id: "00000000-0000-4000-8000-000000000000" }],
    r2_buckets: [{ binding: manifest.r2, bucket_name: "labvium-pdfs" }],
  };
  await writeFile(join(staging, "server/wrangler.json"), `${JSON.stringify(wrangler, null, 2)}\n`);
  await rm(outputRoot, { force: true, recursive: true });
  await rename(staging, outputRoot);
  console.log(`Built Labvium Worker and preserved static assets in ${outputRoot}`);
} catch (error) {
  await rm(staging, { force: true, recursive: true });
  throw error;
}

async function exists(path) { try { await stat(path); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
async function assertRegularTree(path) {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error(`Unsupported asset entry: ${entry.name}`);
    if (entry.isDirectory()) await assertRegularTree(join(path, entry.name));
  }
}
