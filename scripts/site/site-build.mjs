#!/usr/bin/env node
// Fills the generated blocks of the BANDAL site from data that already lives in
// the repository, so numbers and links are never typed by hand:
//
//   <!-- generated:salary-table -->   연봉별 실수령액 rows from salary.mjs + tax-table.json
//   <!-- generated:related ids=a,b --> Harupyeon cards from harupyeon/catalog.json
//   <!-- generated:tools-* -->         tool menu, footer and hub cards from tools/tools.json
//   <!-- generated:adsense -->         AdSense tag from scripts/site/adsense.json (absent while unset)
//   <!-- generated:ads-privacy -->     the matching ad disclosure on /privacy/ and /tools/
//   bandal-home/sitemap.xml            every page whose canonical URL is itself
//   bandal-home/ads.txt                only while an AdSense client is set
//
//   node scripts/site/site-build.mjs          write
//   node scripts/site/site-build.mjs --check  fail if anything is out of date
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
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

// AdSense: Google's ads.txt certification ID and the pages that may carry ads.
// Ads run only on self-canonical 반달 도구함 and 하루편 pages; the homepage carries
// the verification meta alone. CAPELLA, Travel, privacy and legal pages never do.
const ADS_TXT_TAG = "f08c47fec0942fa0";

export function adsenseClient(config) {
  const client = config?.client ?? null;
  if (client === null) return null;
  if (typeof client !== "string" || !/^ca-pub-\d{16}$/.test(client)) {
    throw new Error(`scripts/site/adsense.json: client must look like ca-pub-0000000000000000, got ${JSON.stringify(client)}`);
  }
  return client;
}

export function adsenseHead(client, kind) {
  if (!client) return "";
  const meta = `<meta name="google-adsense-account" content="${client}">`;
  if (kind === "verify") return meta;
  return `${meta}\n<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}" crossorigin="anonymous"></script>`;
}

export function withAdsenseHead(html, block) {
  const stripped = html.replace(/\n?<!-- generated:adsense -->[\s\S]*?<!-- \/generated:adsense -->\n?/g, "");
  if (!block) return stripped;
  return stripped.replace("</head>", `\n<!-- generated:adsense -->\n${block}\n<!-- /generated:adsense -->\n</head>`);
}

export const adsTxt = (client) => (client ? `google.com, ${client.replace(/^ca-/, "")}, DIRECT, ${ADS_TXT_TAG}\n` : null);

export function adsPrivacy(client, where) {
  if (!client) return "";
  const body = '<p>반달 도구함과 하루편 자료실에는 Google AdSense 광고가 표시될 수 있어요. Google을 비롯한 제3자 광고 사업자는 쿠키를 사용해 이 사이트나 다른 사이트를 방문한 기록을 바탕으로 광고를 게재할 수 있어요.</p><p>맞춤 광고는 <a class="bu-link" href="https://adssettings.google.com/" rel="noopener noreferrer">Google 광고 설정</a>에서 끌 수 있고, Google이 파트너 사이트의 정보를 사용하는 방식은 <a class="bu-link" href="https://policies.google.com/technologies/partner-sites" rel="noopener noreferrer">Google 안내</a>에서 확인할 수 있어요. 광고가 있어도 계산기에 입력한 값을 BANDAL 서버로 보내지 않는 것은 그대로예요. CAPELLA·여행 설계·개인정보 안내 페이지에는 광고를 넣지 않아요.</p>';
  return where === "tools"
    ? `<p><strong>광고</strong>: ${body.slice(3)}`
    : `<section class="privacy-ads bu-reveal" aria-labelledby="ads-title"><h2 id="ads-title">광고 (Google AdSense)</h2>${body}</section>`;
}

const selfCanonical = (html, url) => /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1] === url;

export async function build({ config } = {}) {
  const client = adsenseClient(config ?? JSON.parse(await readFile(join(repo, "scripts/site/adsense.json"), "utf8")));
  const related = await relatedRenderer();
  const rows = await salaryRows();
  const tool = await toolRenderers();
  const stale = [];
  const sync = async (file, html, original) => {
    if (html === original) return;
    stale.push(relative(repo, file));
    if (!check) await writeFile(file, html);
  };
  for (const file of await htmlFiles(join(assets, "tools"))) {
    const original = await readFile(file, "utf8");
    let html = fill(original, "salary-table", () => rows, file).html;
    html = fill(html, "related", related, file).html;
    html = fill(html, "tools-bar", tool.bar, file).html;
    html = fill(html, "tools-footer", tool.footer, file).html;
    html = fill(html, "tools-cards", tool.cards, file).html;
    html = fill(html, "ads-privacy", () => adsPrivacy(client, "tools"), file).html;
    html = html.replace(/(<!-- generated:tools-count -->)[\s\S]*?(<!-- \/generated:tools-count -->)/g, `$1${tool.count()}$2`);
    html = withAdsenseHead(html, adsenseHead(client, "ads"));
    await sync(file, html, original);
  }
  for (const file of await htmlFiles(join(assets, "harupyeon"))) {
    const original = await readFile(file, "utf8");
    const url = `https://bandal.app/harupyeon/${relative(join(assets, "harupyeon"), file).replace(/\\/g, "/").replace(/index\.html$/, "")}`;
    await sync(file, withAdsenseHead(original, selfCanonical(original, url) ? adsenseHead(client, "ads") : ""), original);
  }
  for (const [file, render] of [
    [join(home, "index.html"), (html) => withAdsenseHead(html, adsenseHead(client, "verify"))],
    [join(assets, "privacy/index.html"), (html) => fill(html, "ads-privacy", () => adsPrivacy(client, "hub")).html],
  ]) {
    const original = await readFile(file, "utf8");
    await sync(file, render(original), original);
  }
  const map = await sitemap();
  const mapPath = join(home, "sitemap.xml");
  const current = await readFile(mapPath, "utf8").catch(() => "");
  if (current !== map) {
    stale.push(relative(repo, mapPath));
    if (!check) await writeFile(mapPath, map);
  }
  const txtPath = join(home, "ads.txt");
  const txt = adsTxt(client);
  const existing = await readFile(txtPath, "utf8").catch(() => null);
  if (existing !== txt) {
    stale.push(relative(repo, txtPath));
    if (!check) await (txt === null ? rm(txtPath, { force: true }) : writeFile(txtPath, txt));
  }
  return stale;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stale = await build();
  if (check && stale.length) {
    console.error(`Generated blocks are out of date: ${stale.join(", ")}\nRun node scripts/site/site-build.mjs`);
    process.exit(1);
  }
  console.log(check ? "Generated blocks are up to date." : `Updated ${stale.length} file(s)${stale.length ? `: ${stale.join(", ")}` : ""}.`);
}
