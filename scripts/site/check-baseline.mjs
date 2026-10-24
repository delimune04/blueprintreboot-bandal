#!/usr/bin/env node
// Compares a BANDAL Site checkout's assetdist/ with the live snapshot this
// refresh started from (docs/site-baseline/20261024-live.json). Run it on fresh
// Site source before copying the redesigned folders over:
//
//   node scripts/site/check-baseline.mjs /path/to/site/assetdist
//
// "changed" or "missing" files were edited on the Site after 2026-10-24 and
// must be merged by hand instead of being overwritten.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const target = process.argv[2];
if (!target) {
  console.error("Usage: check-baseline.mjs <site assetdist directory>");
  process.exit(2);
}
const baseline = JSON.parse(await readFile(join(repo, "docs/site-baseline/20261024-live.json"), "utf8"));
const CF_BEACON = /<script>\(function\(\)\{function c\(\)[\s\S]*?<\/script>/g;
const report = { same: 0, changed: [], missing: [] };
for (const [path, hash] of Object.entries(baseline.files)) {
  let data;
  try {
    data = await readFile(join(resolve(target), path));
  } catch {
    report.missing.push(path);
    continue;
  }
  // The baseline was taken from served HTML with the Cloudflare beacon removed.
  if (path.endsWith(".html")) data = Buffer.from(data.toString("utf8").replace(CF_BEACON, ""));
  if (createHash("sha256").update(data).digest("hex") === hash) report.same += 1;
  else report.changed.push(path);
}
console.log(`${report.same} unchanged, ${report.changed.length} changed, ${report.missing.length} missing since the 2026-10-24 baseline.`);
for (const path of report.changed) console.log(`changed  ${path}`);
for (const path of report.missing) console.log(`missing  ${path}`);
process.exit(report.changed.length || report.missing.length ? 1 : 0);
