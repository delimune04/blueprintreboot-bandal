#!/usr/bin/env node
// Applies the BANDAL UI shell to the generated Harupyeon pages and writes
// catalog.json from the library index. Article bodies, ids, canonical links and
// the generator's revision/sha256 metadata are left untouched, so the same
// script can be re-run after the content generator publishes new pages.
//
//   node scripts/site/harupyeon-shell.mjs [path/to/assetdist/harupyeon]
//
// Every replacement must match exactly once; the script stops otherwise
// instead of writing a half-converted page.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DESIGN = "harupyeon-labvium-20261024";
const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const root = resolve(process.argv[2] || join(repoRoot, "assetdist/harupyeon"));

const decode = (text) => text
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const escape = (text) => String(text)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function replaceOnce(html, pattern, replacement, label, file) {
  const matches = html.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`));
  if (!matches || matches.length !== 1) throw new Error(`${file}: expected one ${label}, found ${matches ? matches.length : 0}`);
  return html.replace(pattern, replacement);
}

async function htmlFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await htmlFiles(path));
    else if (entry.name === "index.html") out.push(path);
  }
  return out.sort();
}

// Category links and counts come from the generated index, not from this script.
function readCategories(indexHtml) {
  // Accepts the generated markup and this script's own output, so re-runs work.
  const nav = /<nav class="category-nav(?: bu-chips)?" aria-label="생활 단계별 분류">([\s\S]*?)<\/nav>/.exec(indexHtml)?.[1];
  if (!nav) throw new Error("index.html: category navigation not found");
  return [...nav.matchAll(/<a (?:class="bu-chip" )?href="([^"]+)"[^>]*>([^<]+)<(?:span|small)>(\d+)<\/(?:span|small)><\/a>/g)].map(([, href, label, count]) => ({
    href, label: decode(label), count: Number(count),
    slug: /\/category\/([^/]+)\//.exec(href)?.[1] || null,
  }));
}

function readCards(html) {
  return [...html.matchAll(/<article class="tip-card" data-tip-id="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)].map(([, id, body]) => {
    const [category, minutes] = [...(/<div class="card-meta">([\s\S]*?)<\/div>/.exec(body)?.[1] || "").matchAll(/<span>([^<]*)<\/span>/g)].map((m) => decode(m[1]));
    return {
      id,
      title: decode(/<h2><a href="[^"]+">([\s\S]*?)<\/a><\/h2>/.exec(body)?.[1] || ""),
      summary: decode(/<\/h2><p>([\s\S]*?)<\/p>/.exec(body)?.[1] || ""),
      category,
      minutes: Number.parseInt(minutes, 10) || null,
      tags: [...(/<div class="tags">([\s\S]*?)<\/div>/.exec(body)?.[1] || "").matchAll(/<span>([^<]*)<\/span>/g)].map((m) => decode(m[1])),
    };
  });
}

const MOTION_BUTTON = '<button class="bu-motion" type="button" aria-pressed="false"><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M7 5v10M13 5v10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>모션 끄기</span></button>';

function bar(categories, current) {
  const links = [{ href: "/harupyeon/", label: "전체 글" }, ...categories.filter((c) => c.slug)]
    .map((c) => `<a href="${c.href}"${c.href === current ? ' aria-current="page"' : ""}>${escape(c.label)}</a>`).join("");
  return `<header class="bu-bar"><div class="bu-shell bu-bar__inner"><a class="bu-brand" href="/" aria-label="BANDAL STUDIO 홈페이지"><span class="bu-brand__mark" aria-hidden="true"></span><span>BANDAL</span></a><span class="bu-bar__divider" aria-hidden="true"></span><a class="bu-product" href="/harupyeon/">하루편</a><nav class="bu-nav" aria-label="하루편 메뉴">${links}</nav><div class="bu-bar__actions">${MOTION_BUTTON}</div></div></header>`;
}

const FOOTER = '<footer class="bu-footer"><div class="bu-shell bu-footer__inner"><div><a class="bu-footer__brand" href="/">BANDAL STUDIO</a><p>하루편 · 처음인 생활에도, 내 편.</p><p>© 2026 BANDAL STUDIO</p></div><nav aria-label="하단 메뉴"><a href="/harupyeon/">하루편 자료실</a><a href="/tools/">반달 도구함</a><a href="/privacy/">개인정보 안내</a><a href="mailto:support@bandal.app">support@bandal.app</a></nav><div class="bu-footer__projects" data-bu-projects="/harupyeon/" hidden><p>BANDAL PROJECTS</p></div></div><p class="bu-footer__wordmark" aria-hidden="true">HARUPYEON</p></footer>';

const HEAD_ASSETS = [
  '<link rel="stylesheet" href="/fonts/pretendard/pretendardvariable-dynamic-subset.css">',
  '<link rel="stylesheet" href="/bandal-ui/bandal-ui.css">',
  '<link rel="stylesheet" href="/harupyeon/library.css">',
  '<script>try{if(localStorage.getItem("bandal:motion")==="paused")document.documentElement.classList.add("motion-paused")}catch(e){}</script>',
  '<script src="/bandal-ui/bandal-ui.js" defer></script>',
  '<script src="/harupyeon/library.js" defer></script>',
].join("");

const SEARCH_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

// Index and category heroes are built from the page's own generated blocks.
function libraryHero(html, file, categories, kind) {
  const intro = /<div class="library-intro"(?: id="library")?><div><p class="eyebrow">[^<]*<\/p><h1>([^<]+)<\/h1><p class="intro-description">([^<]+)<\/p><\/div><div class="library-total"><strong>(\d+)<\/strong><span>([^<]+)<\/span><\/div><\/div>/.exec(html);
  if (!intro) throw new Error(`${file}: library intro not found`);
  const [whole, h1, description, total] = intro;
  const find = /<section class="find-area" aria-label="글 찾기">([\s\S]*?)<\/section>/.exec(html);
  if (!find) throw new Error(`${file}: search area not found`);
  const form = find[1]
    .replace('<div class="search-field"><span aria-hidden="true" class="search-icon"></span>', `<div class="search-field bu-search">${SEARCH_ICON}`)
    .replace('<button type="submit">검색</button>', '<button class="bu-btn bu-btn--sm" type="submit">검색</button>')
    .replace('<nav class="category-nav" aria-label="생활 단계별 분류">', '<nav class="category-nav bu-chips" aria-label="생활 단계별 분류">')
    .replace(/<a href="([^"]+)"( aria-current="page")?>([^<]+)<span>(\d+)<\/span><\/a>/g, '<a class="bu-chip" href="$1"$2>$3<small>$4</small></a>');
  const app = /<section class="haru-app-intro" aria-labelledby="haru-app-title"><div><p class="eyebrow">[^<]*<\/p><h2 id="haru-app-title">([^<]+)<\/h2><p>([\s\S]*?)<\/p><span class="haru-app-status">([^<]+)<\/span><\/div><a href="#library">[\s\S]*?<\/a><\/section>/.exec(html);
  const steps = categories.filter((c) => c.slug).map((c, index) => `<li><a href="${c.href}"${kind === c.slug ? ' aria-current="page"' : ""}><span class="bu-icon" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span><span><strong>${escape(c.label)}</strong><small>${c.count}편의 생활정보</small></span><span class="bu-count">${c.count}</span></a></li>`).join("");
  const title = kind === "index" && app
    ? `${escape(decode(app[1]).replace(/,\s*/, ",|")).split("|").map((part, i) => i ? `<br><span class="bu-grad">${part}</span>` : part).join("")}`
    : `<span class="bu-grad">${h1}</span>`;
  const kicker = kind === "index" ? `<span>${h1} · 생활정보 <span data-bu-count>${total}</span>편</span>` : `<span>하루편 자료실 · ${h1}</span>`;
  const lead = kind === "index" && app ? `${app[2]}` : description;
  const note = kind === "index" && app ? `<p class="bu-hero__note">${description}<br><span class="haru-status">${app[3]}</span></p>` : "";
  const hero = `<section class="bu-hero haru-hero bu-reveal" aria-labelledby="haru-hero-title"><div class="bu-aura" aria-hidden="true"><span></span><span></span><span></span></div><div class="bu-hero__intro"><p class="bu-kicker"><span class="bu-kicker__dot" aria-hidden="true"></span>${kicker}</p><h1 id="haru-hero-title">${title}</h1><p class="bu-hero__lead">${lead}</p><section class="find-area" aria-label="글 찾기">${form}</section>${note}</div><aside class="bu-glass haru-stages" aria-label="생활 단계별 글"><p class="bu-glass__head"><span>생활 단계</span><span class="bu-mono">${total} TIPS</span></p><ol class="bu-steps">${steps}</ol><p class="haru-stages__foot"><a class="bu-pill-link" href="/tools/">반달 도구함 · 생활 계산기 <span aria-hidden="true">↗</span></a></p></aside></section>`;
  let out = html;
  if (app) out = replaceOnce(out, /<section class="haru-app-intro"[\s\S]*?<\/section>/, "", "app intro", file);
  out = replaceOnce(out, new RegExp(whole.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), hero, "library intro", file);
  out = replaceOnce(out, /<section class="find-area" aria-label="글 찾기">(?:(?!<\/section>)[\s\S])*?<\/form><nav class="category-nav" aria-label="생활 단계별 분류">[\s\S]*?<\/nav><\/section>(?=<div class="results-heading">)/, "", "original search area", file);
  out = replaceOnce(out, /<div class="results-heading">/, '<div class="results-heading" id="library">', "results heading", file);
  return out;
}

export async function apply(dir = root) {
  const files = await htmlFiles(dir);
  const indexPath = join(dir, "index.html");
  const indexHtml = await readFile(indexPath, "utf8");
  const categories = readCategories(indexHtml);
  const cards = readCards(indexHtml);
  if (!cards.length) throw new Error("index.html: no tip cards");

  // Category membership is read from the category pages themselves.
  const categoryOf = new Map();
  for (const category of categories.filter((c) => c.slug)) {
    const html = await readFile(join(dir, "category", category.slug, "index.html"), "utf8");
    for (const card of readCards(html)) categoryOf.set(card.id, category.slug);
  }
  const catalog = {
    design: DESIGN,
    revision: /<meta name="harupyeon:revision" content="([^"]+)">/.exec(indexHtml)?.[1] || null,
    categories: categories.filter((c) => c.slug).map(({ slug, label, href, count }) => ({ slug, label, href, count })),
    tips: cards.map((card, index) => ({ ...card, n: index + 1, slug: categoryOf.get(card.id) || null, href: `/harupyeon/tips/${card.id}/` })),
  };

  let changed = 0;
  for (const file of files) {
    const rel = relative(dir, file);
    let html = await readFile(file, "utf8");
    if (html.includes(`<meta name="bandal:design" content="${DESIGN}">`)) continue;
    const kind = rel === "index.html" ? "index" : rel.startsWith("category/") ? rel.split("/")[1] : "tip";
    const current = kind === "index" ? "/harupyeon/" : kind === "tip" ? null : `/harupyeon/category/${kind}/`;
    html = replaceOnce(html, /<link rel="stylesheet" href="\/harupyeon\/library\.css">(?:<script src="\/harupyeon\/library\.js" defer><\/script>)?/, `<meta name="bandal:design" content="${DESIGN}">${HEAD_ASSETS}`, "stylesheet link", rel);
    html = replaceOnce(html, /<body>/, `<body class="bu-page haru" data-haru-page="${kind === "index" || kind === "tip" ? kind : "category"}">`, "body", rel);
    html = replaceOnce(html, /<a class="skip-link" href="#main">([^<]+)<\/a>/, '<a class="bu-skip" href="#main">$1</a>', "skip link", rel);
    if (kind === "tip") {
      const breadcrumbCategory = /<nav class="breadcrumbs" aria-label="현재 위치"><a href="\/harupyeon\/">하루편<\/a><span aria-hidden="true">\/<\/span><a href="([^"]+)">/.exec(html)?.[1];
      html = replaceOnce(html, /<header class="library-header wrap">[\s\S]*?<\/header>/, `<div class="bu-progress" data-target=".article-body" aria-hidden="true"></div>${bar(categories, breadcrumbCategory)}`, "header", rel);
      html = replaceOnce(html, /<main id="main" class="wrap article-main">/, '<main id="main" class="bu-shell article-main">', "main", rel);
      html = replaceOnce(html, /<header class="article-intro">/, '<header class="article-intro bu-reveal"><div class="bu-aura" aria-hidden="true"><span></span><span></span><span></span></div>', "article intro", rel);
    } else {
      html = replaceOnce(html, /<header class="library-header wrap">[\s\S]*?<\/header>/, bar(categories, current), "header", rel);
      html = replaceOnce(html, /<main id="main" class="wrap library-main">/, '<main id="main" class="bu-shell library-main">', "main", rel);
      html = libraryHero(html, rel, categories, kind);
    }
    html = replaceOnce(html, /<footer class="library-footer wrap">[\s\S]*?<\/footer>/, FOOTER, "footer", rel);
    await writeFile(file, html);
    changed += 1;
  }
  await writeFile(join(dir, "catalog.json"), `${JSON.stringify(catalog, null, 1)}\n`);
  return { files: files.length, changed, tips: catalog.tips.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await apply(root);
  console.log(`Harupyeon shell: ${result.changed}/${result.files} pages updated, catalog has ${result.tips} tips.`);
}
