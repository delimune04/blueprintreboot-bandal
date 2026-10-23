import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import postcss from "postcss";

const home = (path) => new URL(`../../bandal-home/${path}`, import.meta.url);
const read = (path) => readFile(home(path), "utf8");
const attributes = (html, name) => [...html.matchAll(new RegExp(`\\s${name}="([^"]+)"`, "g"))].map((match) => match[1]);

// Every link and anchor on the v7 homepage, as published at https://bandal.app/ on 2026-10-23.
const V7_LINKS = [
  "#main", "#top", "/moaflow/", "/LabVium", "/harupyeon/", "/travel/", "/capella/", "#about", "#projects",
  "mailto:support@bandal.app", "/LabVium/help/LabVium_User_Guide_KO.pdf", "https://momento-youth.blogspot.com/",
  "/harupyeon/tips/hs-ai-verification/", "/harupyeon/tips/uni-team-roles/", "/harupyeon/tips/job-subscription-audit/",
  "/capella/support/", "#app-projects", "/privacy/",
];
const V7_IDS = ["top", "navigation", "main", "hero-title", "horizon-sky", "horizon-moon", "constellation", "projects", "labvium-title", "harupyeon", "momento", "haru-title", "travel", "travel-title", "capella", "tokyo", "capella-title", "about", "about-title", "app-projects", "directory-title"];
// Files the homepage expects from the existing BANDAL Site; everything else ships in bandal-home/.
const SITE_ASSETS = ["/favicon.svg", "/horizon.png", "/crescent-flat.svg", "/transitions.css", "/transitions.js", "/moaflow/mark.svg", "/LabVium/brand/labvium-symbol-v1.png", "/capella-icon-starlight-lens.png"];

test("BANDAL homepage keeps every published link and anchor", async () => {
  const html = await read("index.html");
  const links = new Set(attributes(html, "href"));
  for (const link of V7_LINKS) assert.ok(links.has(link), `missing link ${link}`);
  const ids = new Set(attributes(html, "id"));
  for (const id of V7_IDS) assert.ok(ids.has(id), `missing id ${id}`);
  for (const href of links) {
    if (href.startsWith("#") && href.length > 1) assert.ok(ids.has(href.slice(1)), `in-page link ${href} has a target`);
  }
  assert.equal(attributes(html, "id").length, ids.size, "ids are unique");
});

test("BANDAL homepage loads only same-origin assets and bundles its font", async () => {
  const html = await read("index.html");
  const assets = [
    ...[...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((match) => match[1]),
    ...[...html.matchAll(/<(?:script|img|image)[^>]+(?:src|href)="([^"]+)"/g)].map((match) => match[1]),
  ].filter((path) => path !== "https://bandal.app/");
  for (const path of assets) assert.match(path, /^\/[^/]/, `${path} is same-origin`);
  for (const path of new Set(assets)) {
    if (SITE_ASSETS.includes(path)) continue;
    await stat(home(path.slice(1)));
  }
  const font = await read("fonts/pretendard/pretendardvariable-dynamic-subset.css");
  assert.match(font, /font-display: swap/);
  assert.doesNotMatch(font, /url\((?:https?:)?\/\//, "font files stay same-origin");
  assert.match(await read("fonts/pretendard/LICENSE.txt"), /SIL Open Font License/);
  for (const file of ["bandal-home.css", "bandal-home.js"]) {
    assert.doesNotMatch(await read(file), /https?:\/\/(?!www\.w3\.org\/2000\/svg)/, `${file} makes no third-party request`);
  }
});

test("BANDAL homepage animation is opt-in and has static fallbacks", async () => {
  const css = postcss.parse(await read("bandal-home.css"));
  const gatedBy = (node, pattern) => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (parent.type === "atrule" && parent.name === "media" && pattern.test(parent.params.replace(/\s+/g, ""))) return true;
    }
    return false;
  };
  css.walkDecls(/^animation$/, (declaration) => {
    if (/^none/.test(declaration.value)) return;
    assert.ok(gatedBy(declaration, /prefers-reduced-motion:no-preference/), `${declaration.parent.selector} animates outside the motion opt-in`);
    assert.match(declaration.parent.selector, /:root:not\(\.motion-paused\)/, `${declaration.parent.selector} ignores the motion toggle`);
  });
  let reducedReset = false, pausedReset = false;
  css.walkRules((rule) => {
    if (gatedBy(rule, /prefers-reduced-motion:reduce/) && rule.selector.includes(".js .reveal")) reducedReset = true;
    if (rule.selector.includes(".motion-paused .reveal")) pausedReset = true;
  });
  assert.ok(reducedReset, "reduced motion shows every revealed element");
  assert.ok(pausedReset, "the motion toggle shows every revealed element");
  assert.doesNotMatch(await read("bandal-home.css"), /color-mix\(/, "backgrounds do not depend on color-mix support");
  const script = await read("bandal-home.js");
  assert.match(script, /prefers-reduced-motion: reduce/);
  assert.match(script, /try \{\s*if \(userPaused\) localStorage/, "the motion preference is stored best-effort");
});
