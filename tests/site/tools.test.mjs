import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RATES, calculateSalary, withholdingTax } from '../../assetdist/tools/salary/salary.mjs';
import { countText, tidyBlankLines, tidySpaces } from '../../assetdist/tools/char-count/count.mjs';
import { byTerm, convert, neededAverage, summarize, truncate2 } from '../../assetdist/tools/gpa/gpa.mjs';
import { impliedRate, legalCapRate, monthlyCost, rentForDeposit } from '../../assetdist/tools/rent/rent.mjs';
import { STYLES, apa, bibtex, chicago, fromCrossref, ieee, mla, parseDoi } from '../../assetdist/tools/cite/cite.mjs';
import { koreanAmount, parseAmount } from '../../assetdist/tools/common.mjs';
import { adsPrivacy, adsTxt, adsenseClient, adsenseHead, withAdsenseHead } from '../../scripts/site/site-build.mjs';

const assets = new URL('../../assetdist/', import.meta.url);
const read = (path) => readFileSync(new URL(path, assets), 'utf8');
const table = JSON.parse(read('tools/salary/tax-table.json'));
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')).message;

test('the wage tax table is the complete, contiguous 별표2 grid', () => {
  assert.equal(table.revision, '2024. 2. 29.');
  assert.equal(table.rows.length, 646);
  assert.deepEqual(table.rows[0].slice(0, 2), [770, 775]);
  assert.equal(table.rows.at(-1)[1], 10000);
  for (let i = 1; i < table.rows.length; i += 1) assert.equal(table.rows[i][0], table.rows[i - 1][1]);
  assert.deepEqual(table.at10000, [1507400, 1431570, 1200840, 1170840, 1140840, 1110840, 1080840, 1050840, 1020840, 990840, 960840]);
});

test('간이세액 matches the published table and its formulas', () => {
  assert.equal(withholdingTax(table, 3000000, 1), 74350);
  assert.equal(withholdingTax(table, 3000000, 3), 31940);
  assert.equal(withholdingTax(table, 700000, 1), 0);
  assert.equal(withholdingTax(table, 10000000, 1), 1507400);
  // 10,000천원 + 1,397,000 + (15,000,000 − 14,000,000) × 98% × 38%
  assert.equal(withholdingTax(table, 15000000, 1), 3276800);
  // 비고 3 (2026. 3. 1. 이후): 자녀 1명 20,830원, 2명 45,830원, 3명부터 1명당 33,330원 추가
  assert.equal(withholdingTax(table, 3000000, 3, 1), 31940 - 20830);
  assert.equal(withholdingTax(table, 5000000, 4, 3), 219100 - (45830 + 33330));
  assert.equal(withholdingTax(table, 1500000, 2, 1), 0, 'never below zero');
  // 비고 4: 11명 초과
  const t10 = withholdingTax(table, 5000000, 10), t11 = withholdingTax(table, 5000000, 11);
  assert.equal(withholdingTax(table, 5000000, 12), t11 - (t10 - t11));
  assert.equal(withholdingTax(table, 3000000, 1, 0, 80), 59480);
  assert.equal(withholdingTax(table, 3000000, 1, 0, 120), 89220);
  assert.deepEqual(RATES.child, { one: 20830, two: 45830, extra: 33330 });
});

test('월 실수령액 uses the 2026 insurance rates and truncates below 10원', () => {
  const r = calculateSalary(table, { annual: 40000000, nonTaxable: 200000, family: 1 });
  assert.deepEqual(
    { gross: r.gross, taxable: r.taxable, pension: r.pension, health: r.health, care: r.care, employment: r.employment, incomeTax: r.incomeTax, localTax: r.localTax, net: r.net },
    { gross: 3333333, taxable: 3133333, pension: 148810, health: 112640, care: 14800, employment: 28190, incomeTax: 84620, localTax: 8460, net: 2935813 },
  );
  const high = calculateSalary(table, { monthly: 9000000, nonTaxable: 0, family: 1 });
  assert.equal(high.pensionBase, 6590000, '기준소득월액 상한');
  assert.equal(high.pension, 313020);
  const low = calculateSalary(table, { monthly: 300000, nonTaxable: 0, family: 1 });
  assert.equal(low.pensionBase, 410000, '기준소득월액 하한');
  assert.equal(calculateSalary(table, { annual: 39000000, nonTaxable: 0, family: 1, severanceIncluded: true }).gross, 3000000);
  assert.equal(calculateSalary(table, { monthly: 150000, nonTaxable: 200000, family: 1 }).taxable, 0, '비과세는 급여를 넘지 않아요');
});

test('장기요양 uses the exact NHIS ratio before truncating to 10원', () => {
  // NHIS 2026 notice: health premium × 0.9448% / 7.19%.
  // Using the rounded 13.14% multiplier incorrectly returns 11,280원 here.
  const r = calculateSalary(table, { monthly: 2390000, nonTaxable: 0, family: 1 });
  assert.equal(r.health, 85920);
  assert.equal(r.care, 11290);
  assert.equal(RATES.care.ofHealth, 0.009448 / 0.0719);
});

test('글자수 counts NFC syllables, spaces and both byte conventions', () => {
  const c = countText('가나다 abc\n줄2');
  assert.deepEqual([c.chars, c.charsNoSpace, c.utf8Bytes, c.legacyBytes, c.words, c.lines], [10, 8, 19, 15, 3, 2]);
  assert.equal(countText('한글'.normalize('NFD')).chars, 2);
  assert.equal(countText('a\r\nb').utf8Bytes, 4);
  assert.deepEqual(countText(''), { chars: 0, charsNoSpace: 0, utf8Bytes: 0, legacyBytes: 0, words: 0, lines: 0, paragraphs: 0, sentences: 0 });
  assert.equal(countText('첫 문단.\n\n둘째 문단!').paragraphs, 2);
  assert.equal(tidySpaces('  a   b \t c  \n  d  '), 'a b c\nd');
  assert.equal(tidyBlankLines('a\n\n\n\nb\n'), 'a\n\nb');
});

test('학점: P, NP and F follow transcript rules', () => {
  const courses = [
    { term: '1-1', credits: 3, grade: 'A+', major: true },
    { term: '1-1', credits: 3, grade: 'B0' },
    { term: '1-1', credits: 2, grade: 'P' },
    { term: '1-2', credits: 3, grade: 'F' },
    { term: '1-2', credits: 1, grade: 'NP' },
  ];
  const s = summarize(courses, '4.5');
  assert.deepEqual([s.gpa, s.gpaCredits, s.earned, s.passCredits, s.majorGpa], [2.5, 9, 8, 2, 4.5]);
  assert.deepEqual(byTerm(courses, '4.5').map((t) => [t.term, t.gpa]), [['1-1', 3.75], ['1-2', 0]]);
  assert.equal(summarize([{ credits: 3, grade: 'A-' }, { credits: 3, grade: 'B+' }], '4.3').gpa, 3.5);
  assert.equal(truncate2(3.4999), 3.49);
  assert.equal(truncate2(3.5), 3.5);
  assert.ok(Math.abs(convert(4.0, 4.5, 4.3) - 3.8222) < 1e-4);
  assert.ok(Math.abs(neededAverage({ gpa: 3.5, credits: 60, remaining: 30, target: 3.8 }) - 4.4) < 1e-9);
  assert.equal(neededAverage({ gpa: 3.5, credits: 60, remaining: 0, target: 3.8 }), null);
});

test('주거비: interest, opportunity cost and the 전월세 전환 cap', () => {
  const jeonse = monthlyCost({ deposit: 200000000, rent: 0, maintenance: 100000, loan: 160000000, loanRate: 4, savingsRate: 3 });
  assert.equal(Math.round(jeonse.interest), 533333);
  assert.equal(Math.round(jeonse.opportunity), 100000);
  assert.equal(Math.round(jeonse.total), 733333);
  assert.equal(monthlyCost({ deposit: 1000, loan: 5000, loanRate: 10, savingsRate: 0 }).borrowed, 1000, 'loan never exceeds the deposit');
  assert.equal(legalCapRate(2.5), 4.5);
  assert.equal(legalCapRate(9), 10);
  assert.equal(legalCapRate(NaN), null);
  assert.equal(rentForDeposit(50000000, 4.5), 187500);
  assert.equal(impliedRate({ deposit: 200000000, rent: 0 }, { deposit: 100000000, rent: 400000 }), 4.8);
  assert.equal(impliedRate({ deposit: 1, rent: 0 }, { deposit: 1, rent: 5 }), null);
});

test('인용: Crossref records format to APA, MLA, Chicago, IEEE and BibTeX', () => {
  const numpy = fromCrossref(fixture('crossref-numpy.json'));
  const optuna = fromCrossref(fixture('crossref-optuna.json'));
  assert.equal(numpy.authors.length, 26);
  assert.match(apa(numpy).text, /^Harris, C\. R\., Millman, K\. J\., van der Walt, S\. J\., .*Peterson, P\., \. \. \. Oliphant, T\. E\. \(2020\)\. Array programming with NumPy\. Nature, 585\(7825\), 357–362\. https:\/\/doi\.org\/10\.1038\/s41586-020-2649-2$/);
  assert.match(apa(numpy).html, /<i>Nature<\/i>, <i>585<\/i>\(7825\)/);
  assert.equal(mla(numpy).text, 'Harris, Charles R., et al. “Array programming with NumPy.” Nature, vol. 585, no. 7825, 2020, pp. 357-362. https://doi.org/10.1038/s41586-020-2649-2');
  assert.match(chicago(numpy).text, /^Harris, Charles R\., K\. Jarrod Millman, .*, et al\. 2020\. “Array programming with NumPy\.” Nature 585 \(7825\): 357–362\./);
  assert.equal(ieee(numpy).text, 'C. R. Harris et al., “Array programming with NumPy,” Nature, vol. 585, no. 7825, pp. 357–362, Sep. 2020, doi: 10.1038/s41586-020-2649-2.');
  assert.equal(apa(optuna).text, 'Akiba, T., Sano, S., Yanase, T., Ohta, T., & Koyama, M. (2019). Optuna: A Next-generation Hyperparameter Optimization Framework. In Proceedings of the 25th ACM SIGKDD International Conference on Knowledge Discovery & Data Mining (pp. 2623–2631). ACM. https://doi.org/10.1145/3292500.3330701');
  assert.match(bibtex(optuna).text, /^@inproceedings\{akiba2019optuna,\n {2}author = \{Akiba, Takuya and Sano, Shotaro and Yanase, Toshihiko and Ohta, Takeru and Koyama, Masanori\},/);
  assert.match(bibtex(optuna).text, /booktitle = \{Proceedings of the 25th ACM SIGKDD International Conference on Knowledge Discovery \\& Data Mining\}/);
  assert.match(bibtex(optuna).text, /pages = \{2623--2631\}/);
  assert.deepEqual(STYLES.map((s) => s.id), ['apa', 'mla', 'chicago', 'ieee', 'bibtex']);
  assert.equal(parseDoi('https://doi.org/10.1145/3292500.3330701'), '10.1145/3292500.3330701');
  assert.equal(parseDoi('doi: 10.1000/182.'), '10.1000/182');
  assert.equal(parseDoi('not a doi'), null);
  assert.doesNotMatch(apa({ ...numpy, title: '<i>In vivo</i> &amp; more' }).html, /<i>In vivo<\/i>/, 'markup in metadata is escaped');
});

test('amount parsing understands Korean units', () => {
  assert.equal(parseAmount('4,000만'), 40000000);
  assert.equal(parseAmount('1억 2천'), 120000000);
  assert.equal(parseAmount('4천만원'), 40000000);
  assert.equal(parseAmount('1억2천5백만'), 125000000);
  assert.equal(parseAmount('3500000'), 3500000);
  assert(Number.isNaN(parseAmount('abc')));
  assert.equal(koreanAmount(41234000), '4,123만 4,000원');
});

test('tool pages are generated, self-canonical and list the same registry', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  execFileSync(process.execPath, ['scripts/site/site-build.mjs', '--check'], { cwd: root, stdio: 'pipe' });
  const { tools } = JSON.parse(read('tools/tools.json'));
  const sitemap = readFileSync(new URL('../../bandal-home/sitemap.xml', import.meta.url), 'utf8');
  for (const page of ['/tools/', ...tools.map((t) => t.href)]) {
    const html = read(`${page.slice(1)}index.html`);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://bandal.app${page}">`), page);
    assert(sitemap.includes(`<loc>https://bandal.app${page}</loc>`), `sitemap ${page}`);
    for (const t of tools) assert(html.includes(`href="${t.href}"`), `${page} links ${t.href}`);
    if (page !== '/tools/') assert(html.includes(`<a href="${page}" aria-current="page">`), page);
    for (const json of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(json[1]);
    assert.doesNotMatch(html, /<!-- generated:(?!ads-privacy)[\w-]+[^>]*-->\s*<!-- \/generated/, `${page} has an empty generated block`);
  }
  for (const loc of sitemap.matchAll(/<loc>https:\/\/bandal\.app\/([^<]*)<\/loc>/g)) {
    const path = loc[1];
    if (path === 'LabVium') continue;
    const file = path === '' ? new URL('../../bandal-home/index.html', import.meta.url) : new URL(`${path}index.html`, assets);
    assert(existsSync(file), `sitemap entry ${path} exists`);
  }
  // Only the citation tool talks to another origin, and only to Crossref.
  for (const t of tools) {
    const page = read(`${t.href.slice(1)}page.mjs`);
    const hosts = [...page.matchAll(/https?:\/\/([\w.-]+)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(hosts)].filter((h) => h !== 'doi.org'), t.slug === 'cite' ? ['api.crossref.org'] : [], t.slug);
  }
});

test('AdSense stays off until a publisher ID is configured, then lands only where allowed', () => {
  const config = JSON.parse(readFileSync(new URL('../../scripts/site/adsense.json', import.meta.url), 'utf8'));
  assert.equal(adsenseClient({ client: null }), null);
  assert.throws(() => adsenseClient({ client: 'pub-123' }), /ca-pub-/);
  const client = adsenseClient({ client: 'ca-pub-1234567890123456' });
  assert.equal(adsTxt(client), 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
  assert.equal(adsTxt(null), null);
  const page = '<!doctype html><html><head><title>t</title></head><body></body></html>';
  const tagged = withAdsenseHead(page, adsenseHead(client, 'ads'));
  assert.match(tagged, /<meta name="google-adsense-account" content="ca-pub-1234567890123456">\n<script async src="https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-1234567890123456" crossorigin="anonymous"><\/script>\n<!-- \/generated:adsense -->\n<\/head>/);
  assert.equal(withAdsenseHead(tagged, adsenseHead(client, 'ads')), tagged, 'idempotent');
  assert.equal(withAdsenseHead(tagged, ''), page, 'unsetting removes every trace');
  assert.doesNotMatch(adsenseHead(client, 'verify'), /<script/, 'the homepage only verifies ownership');
  assert.match(adsPrivacy(client, 'hub'), /adssettings\.google\.com/);
  assert.equal(adsPrivacy(null, 'hub'), '');
  // With the committed config, no page ships ad code and no ads.txt exists.
  if (adsenseClient(config) === null) {
    assert(!existsSync(new URL('../../bandal-home/ads.txt', import.meta.url)));
    for (const file of ['tools/index.html', 'tools/salary/index.html', 'harupyeon/index.html', 'privacy/index.html']) assert.doesNotMatch(read(file), /adsbygoogle|google-adsense-account/, file);
  }
  // Pages that promise no ads never get the tag, whatever the config says.
  for (const file of ['capella/index.html', 'capella/support/index.html', 'capella/privacy/index.html', 'travel/index.html', 'privacy/index.html']) assert.doesNotMatch(read(file), /adsbygoogle/, file);
  assert.doesNotMatch(readFileSync(new URL('../../scripts/site/site-build.mjs', import.meta.url), 'utf8'), /join\(assets, "(capella|travel)/, 'the ad loop never walks CAPELLA or Travel');
});
