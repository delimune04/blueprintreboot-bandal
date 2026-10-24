#!/usr/bin/env node
// Fills the generated blocks of the BANDAL site from data that already lives in
// the repository, so numbers and links are never typed by hand:
//
//   <!-- generated:salary-table -->   연봉별 실수령액 rows from salary.mjs + tax-table.json
//   <!-- generated:related ids=a,b --> Harupyeon cards from harupyeon/catalog.json
//   bandal-home/sitemap.xml            every page whose canonical URL is itself
//
//   node scripts/site/tools-build.mjs          write
//   node scripts/site/tools-build.mjs --check  fail if anything is out of date
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const assets = join(repo, "assetdist");
const home = join(repo, "bandal-home");
const check = process.argv.includes("--check");
const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const group = (n) => new Intl.NumberFormat("ko-KR").format(n);

async function htmlFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await htmlFiles(path));
    else if (entry.name.endsWith(".html")) out.push(path);
  }
  return out.sort();
}

function fill(html, name, render, file) {
  const pattern = new RegExp(`(<!-- generated:${name}(?: ([^>]*?))? -->)[\\s\\S]*?(<!-- /generated:${name} -->)`, "g");
  let count = 0;
  const out = html.replace(pattern, (whole, open, args, close) => {
    count += 1;
    return `${open}\n${render(args || "")}\n${close}`;
  });
  return { html: out, count, file };
}

export const SALARY_STEPS = [2400, 2600, 2800, 3000, 3200, 3500, 3800, 4000, 4200, 4500, 5000, 5500, 6000, 6500, 7000, 8000, 9000, 10000];

export async function salaryRows() {
  const { calculateSalary } = await import(pathToFileURL(join(assets, "tools/salary/salary.mjs")).href);
  const table = JSON.parse(await readFile(join(assets, "tools/salary/tax-table.json"), "utf8"));
  return SALARY_STEPS.map((man) => {
    const r = calculateSalary(table, { annual: man * 10000, nonTaxable: 200000, family: 1, children: 0, percent: 100 });
    const insurance = r.pension + r.health + r.care + r.employment;
    return `<tr><th scope="row">${group(man)}만</th><td>${group(r.gross)}</td><td>${group(insurance)}</td><td>${group(r.incomeTax + r.localTax)}</td><td><strong>${group(r.net)}</strong></td></tr>`;
  }).join("\n");
}

async function relatedRenderer() {
  const catalog = JSON.parse(await readFile(join(assets, "harupyeon/catalog.json"), "utf8"));
  const byId = new Map(catalog.tips.map((tip) => [tip.id, tip]));
  return (args) => {
    const ids = /ids=([\w,-]+)/.exec(args)?.[1]?.split(",") || [];
    return ids.map((id) => {
      const tip = byId.get(id);
      if (!tip) throw new Error(`related: unknown Harupyeon tip ${id}`);
      return `<article class="bu-card bu-reveal"><p class="bu-card__meta"><span class="bu-tag">하루편 · ${escape(tip.category)}</span>${tip.minutes ? `<span>${tip.minutes}분 읽기</span>` : ""}</p><h3><a class="bu-card__link" href="${escape(tip.href)}">${escape(tip.title)}</a></h3><p>${escape(tip.summary)}</p></article>`;
    }).join("\n");
  };
}

async function sitemap() {
  const pages = [];
  const add = async (file, root, prefix) => {
    const html = await readFile(file, "utf8");
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
    const path = `${prefix}${relative(root, file).replace(/\\/g, "/").replace(/index\.html$/, "")}`;
    const url = `https://bandal.app/${path}`;
    if (!canonical || canonical !== url) return;
    if (/<meta name="robots" content="[^"]*noindex/.test(html)) return;
    const modified = /수정 <time datetime="(\d{4}-\d{2}-\d{2})">/.exec(html)?.[1];
    pages.push({ url, modified });
  };
  await add(join(home, "index.html"), home, "");
  for (const file of await htmlFiles(assets)) await add(file, assets, "");
  // Built outside assetdist; its canonical is https://bandal.app/LabVium.
  pages.push({ url: "https://bandal.app/LabVium" });
  pages.sort((a, b) => a.url.localeCompare(b.url));
  const body = pages.map((p) => `<url><loc>${p.url}</loc>${p.modified ? `<lastmod>${p.modified}</lastmod>` : ""}</url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

const MOTION = '<button class="bu-motion" type="button" aria-pressed="false"><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M7 5v10M13 5v10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>모션 끄기</span></button>';

export async function toolRenderers() {
  const { tools } = JSON.parse(await readFile(join(assets, "tools/tools.json"), "utf8"));
  const current = (args) => /current=(\S+)/.exec(args)?.[1] || "";
  const icon = (path) => `<span class="bu-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"><path d="${escape(path)}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
  return {
    bar: (args) => `<header class="bu-bar"><div class="bu-shell bu-bar__inner"><a class="bu-brand" href="/" aria-label="BANDAL 홈페이지"><span class="bu-brand__mark" aria-hidden="true"></span><span>BANDAL</span></a><span class="bu-bar__divider" aria-hidden="true"></span><a class="bu-product" href="/tools/">반달 도구함</a><nav class="bu-nav" aria-label="도구 메뉴">${tools.map((t) => `<a href="${t.href}"${t.href === current(args) ? ' aria-current="page"' : ""}>${escape(t.nav)}</a>`).join("")}</nav><div class="bu-bar__actions">${MOTION}</div></div></header>`,
    footer: () => `<footer class="bu-footer"><div class="bu-shell bu-footer__inner"><div><a class="bu-footer__brand" href="/">BANDAL STUDIO</a><p>반달 도구함 · 계산은 이 브라우저 안에서 해요.</p><p>© 2026 BANDAL STUDIO</p></div><nav aria-label="하단 메뉴"><a href="/tools/">전체 도구</a>${tools.map((t) => `<a href="${t.href}">${escape(t.title)}</a>`).join("")}<a href="/tools/#privacy">정보 처리 안내</a><a href="mailto:support@bandal.app">support@bandal.app</a></nav><div class="bu-footer__projects" data-bu-projects="/tools/" hidden><p>BANDAL PROJECTS</p></div></div><p class="bu-footer__wordmark" aria-hidden="true">TOOLS</p></footer>`,
    cards: () => tools.map((t, i) => `<article class="bu-card bu-reveal">${icon(t.icon)}<p class="bu-card__meta"><span>${String(i + 1).padStart(2, "0")}</span><span>${escape(t.audience)}</span></p><h3><a class="bu-card__link" href="${t.href}">${escape(t.title)}</a></h3><p>${escape(t.summary)}</p><p class="bu-card__foot"><span>바로 계산하기 →</span></p></article>`).join("\n"),
    count: () => String(tools.length),
  };
}

export async function build() {
  const related = await relatedRenderer();
  const rows = await salaryRows();
  const tool = await toolRenderers();
  const stale = [];
  for (const file of await htmlFiles(join(assets, "tools"))) {
    const original = await readFile(file, "utf8");
    let html = fill(original, "salary-table", () => rows, file).html;
    html = fill(html, "related", related, file).html;
    html = fill(html, "tools-bar", tool.bar, file).html;
    html = fill(html, "tools-footer", tool.footer, file).html;
    html = fill(html, "tools-cards", tool.cards, file).html;
    html = html.replace(/(<!-- generated:tools-count -->)[\s\S]*?(<!-- \/generated:tools-count -->)/g, `$1${tool.count()}$2`);
    if (html !== original) {
      stale.push(relative(repo, file));
      if (!check) await writeFile(file, html);
    }
  }
  const map = await sitemap();
  const mapPath = join(home, "sitemap.xml");
  const current = await readFile(mapPath, "utf8").catch(() => "");
  if (current !== map) {
    stale.push(relative(repo, mapPath));
    if (!check) await writeFile(mapPath, map);
  }
  return stale;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stale = await build();
  if (check && stale.length) {
    console.error(`Generated blocks are out of date: ${stale.join(", ")}\nRun node scripts/site/tools-build.mjs`);
    process.exit(1);
  }
  console.log(check ? "Generated blocks are up to date." : `Updated ${stale.length} file(s)${stale.length ? `: ${stale.join(", ")}` : ""}.`);
}
