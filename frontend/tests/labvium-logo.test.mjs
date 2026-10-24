import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const file = (path) => readFile(new URL(`../${path}`, import.meta.url));
const text = async (path) => (await file(path)).toString("utf8");
const pngSize = (bytes) => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];

test("LabVium v2 symbol and icon are self-contained vectors with raster fallbacks", async () => {
  for (const name of ["labvium-symbol-v2.svg", "labvium-icon-v2.svg"]) {
    const svg = await text(`public/brand/${name}`);
    assert.match(svg, /viewBox="0 0 120 120"/, name);
    assert.match(svg, /<title>LabVium<\/title>/, name);
    assert.doesNotMatch(svg, /href=|url\((?!#)|<image|<text/, `${name} has no external, raster or font dependency`);
  }
  assert.match(await text("public/brand/labvium-symbol-v2.svg"), /fill="#7c3aed"[\s\S]*stroke="#5b21b6"[\s\S]*fill="#a78bfa"/);
  for (const name of ["labvium-symbol-v2.png", "labvium-icon-v2.png"]) {
    const bytes = await file(`public/brand/${name}`);
    assert.equal(bytes.subarray(1, 4).toString(), "PNG", name);
    assert.deepEqual(pngSize(bytes), [512, 512], name);
  }
});

test("app, favicon, share image and homepage use the v2 LabVium logo", async () => {
  assert.match(await text("app/components/LabviumBrand.tsx"), /\/brand\/labvium-symbol-v2\.svg/);
  assert.match(await text("app/globals.css"), /\.brand__mark \{[^}]*url\("\/brand\/labvium-symbol-v2\.svg"\)/);
  const layout = await text("app/layout.tsx");
  assert.match(layout, /url: "\/brand\/labvium-icon-v2\.svg", type: "image\/svg\+xml"/);
  assert.match(layout, /apple: \[\{ url: "\/brand\/labvium-icon-v2\.png" \}\]/);
  const demo = await text("demo/index.html");
  assert.match(demo, /<link rel="icon" href="\/brand\/labvium-icon-v2\.svg" type="image\/svg\+xml" \/>/);
  assert.match(demo, /<link rel="apple-touch-icon" href="\/brand\/labvium-icon-v2\.png" \/>/);
  assert.match(await text("public/og-labvium.svg"), /M51 61 67 80 94 37/, "share image carries the new symbol");
  const home = await text("../bandal-home/index.html");
  assert.equal(home.match(/\/LabVium\/brand\/labvium-symbol-v2\.svg/g)?.length, 2);
  for (const source of [layout, demo, home, await text("app/components/LabviumBrand.tsx"), await text("app/globals.css")]) {
    assert.doesNotMatch(source, /labvium-symbol-v1\.png/);
  }
});
