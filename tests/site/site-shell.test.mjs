import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply as applyHarupyeonShell, DESIGN } from '../../scripts/site/harupyeon-shell.mjs';
import { DEFAULTS, PRESETS, RATIOS, cropRect, fitSize, processPixels, stampText } from '../../assetdist/capella/filters.mjs';

const assets = new URL('../../assetdist/', import.meta.url);
const read = (path) => readFileSync(new URL(path, assets), 'utf8');
const sha = (text) => createHash('sha256').update(text).digest('hex');
const baseline = JSON.parse(readFileSync(new URL('./fixtures/baseline-hashes.json', import.meta.url), 'utf8'));
const attributes = (html, name) => [...html.matchAll(new RegExp(`\\s${name}="([^"]+)"`, 'g'))].map((m) => m[1]);
// Calls visit(declaration, [...enclosing preludes]) for every declaration.
const walk = (css, visit) => { const stack = []; let buffer = ''; for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, '')) { if (ch === '{') { stack.push(buffer.trim()); buffer = ''; } else if (ch === ';' || ch === '}') { const decl = buffer.trim(); if (decl && stack.length) visit(decl, [...stack]); buffer = ''; if (ch === '}') stack.pop(); } else buffer += ch; } };

async function htmlFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await htmlFiles(path));
    else if (entry.name.endsWith('.html')) out.push(path);
  }
  return out;
}

const SKINS = ['bandal-ui/bandal-ui.css', 'harupyeon/library.css', 'capella/app.css', 'capella/legal.css', 'privacy/privacy.css', 'travel/travel-skin.css', 'travel/legal.css', 'tools/tools.css', 'tools/char-count/char-count.css', 'tools/gpa/gpa.css', 'tools/rent/rent.css', 'tools/cite/cite.css'];

test('every new animation is opt-in, pausable, and reveals never hide content without the script', () => {
  let animations = 0;
  for (const file of SKINS) {
    walk(read(file), (decl, stack) => {
      const selector = stack.at(-1), media = stack.slice(0, -1).join(' ').replace(/\s+/g, '');
      if (/^animation(-name)?\s*:/.test(decl) && !/:\s*none/.test(decl)) {
        animations += 1;
        assert(media.includes('prefers-reduced-motion:no-preference'), `${file}: ${selector}`);
        assert.match(selector, /:root(\.bu-js)?:not\(\.motion-paused\)/, `${file}: ${selector}`);
      }
      if (/\.bu-reveal:not\(\.is-visible\)/.test(selector) && /^opacity/.test(decl)) {
        assert(media.includes('prefers-reduced-motion:no-preference'), selector);
        assert.match(selector, /:root\.bu-js:not\(\.motion-paused\)/);
      }
    });
    assert.doesNotMatch(read(file), /https?:\/\/(?!www\.w3\.org\/2000\/svg)/, `${file} loads nothing third-party`);
  }
  assert(animations >= 10);
  const script = read('bandal-ui/bandal-ui.js');
  assert.match(script, /const STORE_KEY = 'bandal:motion'/);
  assert.match(script, /try \{\s*if \(userPaused\) localStorage/);
  assert.match(script, /prefers-reduced-motion: reduce/);
});

test('pages on BANDAL UI load the font, the shared CSS/JS and restore the motion preference first', async () => {
  const pages = (await Promise.all(['harupyeon', 'capella', 'privacy', 'tools'].map((d) => htmlFiles(new URL(d, assets).pathname)))).flat();
  assert(pages.length > 80);
  for (const file of pages) {
    const html = await readFile(file, 'utf8');
    if (!html.includes('/bandal-ui/bandal-ui.css')) continue;
    assert(html.includes('/fonts/pretendard/pretendardvariable-dynamic-subset.css'), file);
    assert(html.includes('<script src="/bandal-ui/bandal-ui.js" defer></script>'), file);
    assert(html.includes('localStorage.getItem("bandal:motion")==="paused"'), file);
    assert(html.indexOf('/bandal-ui/bandal-ui.css') < html.indexOf('</head>'), file);
    const ids = attributes(html, 'id');
    assert.equal(ids.length, new Set(ids).size, `${file} has unique ids`);
    for (const href of attributes(html, 'href')) if (href.startsWith('#') && href.length > 1) assert(ids.includes(href.slice(1)), `${file}: ${href}`);
  }
});

test('Harupyeon articles are byte-identical to the live baseline and every page has the shell', async () => {
  const dir = new URL('harupyeon/', assets).pathname;
  const files = await htmlFiles(dir);
  assert.equal(files.length, 75);
  for (const file of files) {
    const html = await readFile(file, 'utf8');
    assert(html.includes(`<meta name="bandal:design" content="${DESIGN}">`), file);
    assert.match(html, /<meta name="harupyeon:revision" content="harupyeon-71-[^"]+">/);
    assert.match(html, /<meta name="harupyeon:source-sha256" content="[0-9a-f]{64}">/);
    assert.match(html, /<link rel="canonical" href="https:\/\/[^"]+">/);
    assert(html.includes('<header class="bu-bar">') && html.includes('<footer class="bu-footer">'), file);
    assert(!html.includes('library-header') && !html.includes('library-footer'), file);
  }
  for (const [tip, hash] of Object.entries(baseline.harupyeonArticles)) {
    const html = read(`harupyeon/tips/${tip}/index.html`);
    const article = /<article class="article-body"[\s\S]*?<\/article>/.exec(html)[0];
    assert.equal(sha(article), hash, `${tip} article body changed`);
  }
  const catalog = JSON.parse(read('harupyeon/catalog.json'));
  assert.equal(catalog.tips.length, 71);
  assert.deepEqual(catalog.categories.map((c) => c.count).reduce((a, b) => a + b, 0), 71);
  for (const tip of catalog.tips) {
    assert.equal(tip.href, `/harupyeon/tips/${tip.id}/`);
    assert(existsSync(new URL(`harupyeon/tips/${tip.id}/index.html`, assets)), tip.id);
    assert(tip.slug && tip.title && tip.summary, tip.id);
  }
});

test('the Harupyeon shell script is idempotent on its own output', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'haru-'));
  try {
    await cp(new URL('harupyeon/', assets).pathname, temp, { recursive: true });
    const result = await applyHarupyeonShell(temp);
    assert.equal(result.changed, 0);
    assert.equal(result.tips, 71);
    assert.equal(await readFile(join(temp, 'catalog.json'), 'utf8'), read('harupyeon/catalog.json'));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('legal and policy text is unchanged; only the page chrome moved to BANDAL UI', () => {
  for (const [path, hash] of Object.entries(baseline.legalMains)) {
    const main = /<main\b[\s\S]*?<\/main>/.exec(read(path))[0];
    assert.equal(sha(main), hash, `${path} main content changed`);
  }
  const hub = read('privacy/index.html');
  for (const href of ['/capella/privacy/', '/travel/privacy/', '/travel/cookies/', '/travel/terms/', 'mailto:support@bandal.app', '/']) assert(attributes(hub, 'href').includes(href), href);
  for (const text of ['기존 명칭 TOKYO', '웹 안내 준비 중', '현재는 하루편 앱 안의 ‘개인정보 처리 안내’를 확인해 주세요.', '비밀번호나 인증 코드는 보내지 마세요.']) assert(hub.includes(text), text);
});

test('CAPELLA preview math leaves pixels alone at neutral settings and stays in range', () => {
  const data = new Uint8ClampedArray([10, 120, 250, 255, 200, 30, 90, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
  const copy = new Uint8ClampedArray(data);
  processPixels(copy, 2, 2, { preset: 'none', intensity: 100, exposure: 0, grain: 0, vignette: 0 });
  assert.deepEqual([...copy], [...data]);
  const off = new Uint8ClampedArray(data);
  processPixels(off, 2, 2, { preset: 'film', intensity: 0, exposure: 0, grain: 0, vignette: 0 });
  assert.deepEqual([...off], [...data]);
  const bright = new Uint8ClampedArray(data);
  processPixels(bright, 2, 2, { preset: 'none', intensity: 0, exposure: 100, grain: 0, vignette: 0 });
  assert(bright[0] >= data[0] && bright[1] >= data[1]);
  const mono = new Uint8ClampedArray(data);
  processPixels(mono, 2, 2, { ...DEFAULTS, preset: 'mono', intensity: 100, grain: 0, vignette: 0 });
  assert.equal(mono[0], mono[1]);
  assert.equal(mono[1], mono[2]);
  assert.deepEqual(cropRect(4000, 3000, 1), { x: 500, y: 0, width: 3000, height: 3000 });
  assert.deepEqual(cropRect(3000, 4000, 9 / 16), { x: 375, y: 0, width: 2250, height: 4000 });
  assert.deepEqual(cropRect(1200, 1500, null), { x: 0, y: 0, width: 1200, height: 1500 });
  assert.deepEqual(fitSize(4000, 3000, 2048), { width: 2048, height: 1536 });
  assert.equal(stampText(new Date(2026, 9, 4)), "'26 10 04");
  assert.deepEqual(PRESETS.map((p) => p.id), ['none', 'starlight', 'film', 'sunset', 'clear', 'mono']);
  assert(RATIOS.some((r) => r.id === 'source'));
  const page = read('capella/filter-lab.mjs');
  assert.doesNotMatch(page, /fetch\(|XMLHttpRequest|sendBeacon/, 'the preview never uploads');
});

test('Travel keeps every live id, reads cities from the catalog and loads the skin last', () => {
  const html = read('travel/index.html');
  const ids = new Set(attributes(html, 'id'));
  for (const id of baseline.travelIds) assert(ids.has(id), `travel id ${id}`);
  assert.doesNotMatch(html, /6 CITIES|초기 버전|오사카 · 교토 · 로마 · 도쿄 · 파리 · 런던을 지원해요|오사카·교토·로마·도쿄·파리·런던·서울/);
  const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
  assert.equal(sheets.at(-1), './travel-skin.css');
  const onboarding = read('travel/onboarding.js');
  assert.match(onboarding, /CITY_CATALOG\.map\(c=>`<button type="button" data-quick-city=/);
  assert.match(onboarding, /api\.selectCity\(b\.dataset\.quickCity,\{categories\}\)/);
});
