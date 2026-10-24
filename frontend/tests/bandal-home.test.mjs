import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import postcss from "postcss";

const home = (path) => new URL(`../../bandal-home/${path}`, import.meta.url);
const read = (path) => readFile(home(path), "utf8");
const attributes = (html, name) => [...html.matchAll(new RegExp(`\\s${name}="([^"]+)"`, "g"))].map((match) => match[1]);

// Keep published non-finance links and anchors. The explicit Finance consolidation
// replaces the old standalone MoaFlow homepage destination with /finance/#ledger.
const V7_LINKS = [
  "#main", "#top", "/LabVium", "/harupyeon/", "/travel/", "/capella/", "#about", "#projects",
  "mailto:support@bandal.app", "/LabVium/help/LabVium_User_Guide_KO.pdf", "https://momento-youth.blogspot.com/",
  "/harupyeon/tips/hs-ai-verification/", "/harupyeon/tips/uni-team-roles/", "/harupyeon/tips/job-subscription-audit/",
  "/capella/support/", "#app-projects", "/privacy/",
];
const V7_IDS = ["top", "navigation", "main", "hero-title", "horizon-sky", "horizon-moon", "constellation", "projects", "labvium-title", "harupyeon", "momento", "haru-title", "travel", "travel-title", "capella", "tokyo", "capella-title", "about", "about-title", "app-projects", "directory-title"];
// Files the homepage expects from the existing BANDAL Site; everything else ships in bandal-home/.
const SITE_ASSETS = ["/favicon.svg", "/horizon.png", "/crescent-flat.svg", "/transitions.css", "/transitions.js", "/LabVium/brand/labvium-symbol-v1.png", "/capella-icon-starlight-lens.png"];

test("BANDAL homepage keeps unrelated published links and anchors", async () => {
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

const PROJECTS = [
  { id: "labvium", href: "/LabVium", label: "LABVIUM" },
  { id: "harupyeon", href: "/harupyeon/", label: "HARUPYEON" },
  { id: "travel", href: "/travel/", label: "TRAVEL PLANNER" },
  { id: "capella", href: "/capella/", label: "CAPELLA CAMERA" },
  { id: "finance", href: "/finance/", label: "BANDAL FINANCE" },
];

// Match complete section elements so ordering checks use rendered source order,
// rather than independent string-presence checks that let stale numbering pass.
const projectSections = html => [...html.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section>/g)]
  .filter(([, attrs]) => /class="project(?: |")/.test(attrs))
  .map(([, attrs, content]) => ({
    id: /\bid="([^"]+)"/.exec(attrs)?.[1],
    chapter: /\bdata-chapter="([^"]+)"/.exec(attrs)?.[1],
    heading: /aria-labelledby="([^"]+)"/.exec(attrs)?.[1],
    content,
  }));
const navContent = (html, attributes) => new RegExp(`<nav ${attributes}>([\\s\\S]*?)<\\/nav>`).exec(html)?.[1] || "";

test("homepage source order, chapter numbers and jump links follow the requested project order", async () => {
  const html = await read("index.html");
  const sections = projectSections(html);
  assert.deepEqual(sections.map(section => section.id), PROJECTS.map(project => project.id));
  assert.deepEqual(sections.map(section => section.chapter), PROJECTS.map(project => project.id));
  for (const [index, section] of sections.entries()) {
    const number = String(index + 1).padStart(2, "0");
    assert.match(section.content, new RegExp(`<span class="project-numeral" aria-hidden="true">${number}</span>`));
    assert.ok(section.content.includes(`<p class="eyebrow reveal">${number} / ${PROJECTS[index].label}</p>`));
    assert.ok(section.content.includes(`<h2 id="${section.heading}"`), `${section.id} has its labelled heading`);
    assert.ok(attributes(section.content, "href").includes(PROJECTS[index].href));
  }
  const rail = navContent(html, 'class="chapter-rail" aria-label="섹션 바로가기"');
  assert.deepEqual(attributes(rail, "data-chapter-link"), [...PROJECTS.map(project => project.id), "about", "directory"]);
  assert.deepEqual(attributes(rail, "href"), [...PROJECTS.map(project => `#${project.id}`), "#about", "#app-projects"]);
  assert.match(html, /class="scroll-cue" href="#projects" aria-label="다음 섹션, LabVium"/);
  assert.ok(html.includes(`${String(PROJECTS.length).padStart(2, "0")} PROJECTS`));
  assert.ok(html.includes(`${String(PROJECTS.length + 1).padStart(2, "0")} / ABOUT BANDAL`));
});

test("desktop, compact menu, footer and directory keep the same project order", async () => {
  const html = await read("index.html");
  const nav = navContent(html, 'id="navigation" class="primary-nav" aria-label="주 메뉴"');
  assert.deepEqual(attributes(nav, "href"), [...PROJECTS.map(project => project.href), "#about"]);
  assert.deepEqual([...nav.matchAll(/<small aria-hidden="true">(\d{2})<\/small>/g)].map(match => match[1]), ["01", "02", "03", "04", "05", "06"]);
  assert.deepEqual([...nav.matchAll(/style="--i:(\d+)"/g)].map(match => Number(match[1])), [0, 1, 2, 3, 4, 5]);
  const cards = [...html.matchAll(/<a class="directory-card[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  assert.deepEqual(cards.map(match => match[1]), PROJECTS.map(project => project.href));
  for (const [index, card] of cards.entries()) {
    assert.ok(card[2].includes(`<span class="directory-label">${String(index + 1).padStart(2, "0")} /`));
  }
  const footer = navContent(html, 'aria-label="하단 메뉴"');
  const footerProjects = attributes(footer, "href").filter(href => PROJECTS.some(project => project.href === href));
  assert.deepEqual(footerProjects, PROJECTS.map(project => project.href));
  // Every project and the Studio link remain usable in the compact menu.
  const css = await read("bandal-home.css"), script = await read("bandal-home.js");
  assert.match(css, /@media \(max-width:1020px\)/);
  assert.match(css, /overflow-y:auto/);
  assert.match(script, /matchMedia\('\(max-width: 1020px\)'\)/);
});

test("the ledger appears only inside Finance and the homepage has no standalone MoaFlow destination", async () => {
  const html = await read("index.html");
  const sections = projectSections(html);
  assert.equal(sections.some(section => section.id === "moaflow"), false);
  assert.equal(attributes(html, "href").some(href => href.startsWith("/moaflow")), false);
  assert.doesNotMatch(html, /data-chapter(?:-link)?="moaflow"|id="moaflow-title"|MOAFLOW<\/p>/);
  const finance = sections.find(section => section.id === "finance");
  for (const tab of ["ledger", "analysis", "quant"]) assert.ok(finance.content.includes(`href="/finance/#${tab}"`));
});
