import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadCompanyOutlook, validateCompanyOutlook } from '../../hosting/finance/outlook.mjs';

const root = new URL('../../assetdist/finance/outlooks/', import.meta.url);
const pack = async ticker => JSON.parse(await readFile(new URL(ticker + '.json', root), 'utf8'));
const collected = Date.parse('2026-10-24T05:00:00Z');
const request = new Request('https://bandal.app/finance/api/companies/AAPL?url=https://evil.example/private', { headers: { 'oai-authenticated-user-id': 'private-user', Cookie: 'private-cookie' } });
function environment(value, { status = 200 } = {}) {
  const calls = [];
  return { calls, ASSETS: { async fetch(req) { calls.push(req); return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); } } };
}

test('reviewed company packs retain citations, current-period distinction and scheduled event status', async () => {
  for (const ticker of ['AAPL', 'IREN']) {
    const value = await pack(ticker);
    assert.equal(validateCompanyOutlook(value, ticker, collected), value);
    assert.equal(value.mode, 'curated-source-summary');
    assert.equal(value.label, 'AI 작성·출처 기반 요약');
    assert.equal(value.nextEarnings.status, 'company-announced');
    assert.match(value.forecastPeriod.reason, /아래/);
    const ids = new Set(value.sources.map(s => s.id));
    for (const line of [...value.summary, ...value.watchItems, ...value.riskFactors]) assert(line.sourceIds.every(id => ids.has(id)));
    assert(value.summary.some(line => line.kind === 'inference'));
    assert(value.consensus.items.every(item => item.kind === 'analyst-estimate'));
  }
});

test('IREN ARR distinguishes operating, contracted and conditional target from GAAP sales', async () => {
  const value = await pack('IREN');
  assert.equal(value.arr.operating.value, 1000000000);
  assert.equal(value.arr.operating.effectiveAt, '2026-08-26');
  assert.equal(value.arr.contracted.value, 4000000000);
  assert.equal(value.arr.contracted.effectiveAt, '2026-08-27');
  assert.equal(value.officialGuidance.items.find(item => item.label.startsWith('계약 ARR')).effectiveAt, value.arr.contracted.effectiveAt);
  assert.equal(value.arr.target.targetDate, '2026-12-31');
  assert.match(value.arr.definition, /GAAP 매출이 아니/);
  assert.match(value.arr.target.conditions, /고객 인수/);
  assert.notEqual(value.arr.operating.value, value.business.totalRevenue);
  assert.equal(value.business.period.basis, 'annual');
  assert.equal(value.business.income.costOfRevenue, undefined, 'D&A-exclusive cost is never mislabeled as standard cost');
  assert.equal(value.business.income.costOfRevenueExcludingDepreciation, 219700000);
  assert.match(value.consensus.basis, /FY2026 Q3/);
});

test('business source segments reconcile within their own quarter or year without mixing durations', async () => {
  for (const ticker of ['AAPL', 'IREN']) {
    const value = await pack(ticker), business = value.business;
    assert.equal(business.segments.reduce((n, item) => n + item.value, 0), business.totalRevenue);
    assert.equal(business.income.revenue, business.totalRevenue);
  }
  const apple = (await pack('AAPL')).business;
  assert.equal(apple.period.basis, 'quarterly');
  assert.equal(apple.period.end, '2026-06-27');
  assert.equal(apple.income.revenue - apple.income.costOfRevenue, apple.income.grossProfit);
  assert.equal(apple.income.grossProfit - apple.income.operatingExpenses, apple.income.operatingIncome);
});

test('loader reads one fixed same-origin asset without forwarding user identity or arbitrary query URLs', async () => {
  const env = environment(await pack('AAPL'));
  const value = await loadCompanyOutlook(request, env, 'AAPL', { clock: () => collected });
  assert.equal(value.ticker, 'AAPL');
  assert.equal(value.stale, false);
  assert.equal(value.eventPassed, false);
  assert.equal(value.asOf, '2026-10-24T04:13:36Z');
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].url, 'https://bandal.app/finance/outlooks/AAPL.json');
  assert.equal(env.calls[0].headers.get('cookie'), null);
  assert.equal(env.calls[0].headers.get('oai-authenticated-user-id'), null);
});

test('invalid symbols do not dispatch an asset request or create a fabricated outlook', async () => {
  const env = environment(await pack('IREN'));
  for (const ticker of ['../IREN', 'https://evil.example', 'AAPL?owner=alice', '', null]) assert.equal(await loadCompanyOutlook(request, env, ticker), null);
  assert.equal(env.calls.length, 0);
  assert.equal(await loadCompanyOutlook(request, {}, 'IREN'), null);
  assert.equal(await loadCompanyOutlook(request, environment({}, { status: 404 }), 'AAPL'), null);
});

test('passed announcement dates and older packs become dated archive summaries, never new forecasts', async () => {
  const value = await loadCompanyOutlook(request, environment(await pack('AAPL')), 'AAPL', { clock: () => Date.parse('2026-11-03T10:00:00Z') });
  assert.equal(value.eventPassed, true);
  assert.equal(value.stale, true);
  assert.match(value.freshnessNote, /예정 발표일이 지났/);
  assert.equal(value.nextEarnings.date, '2026-11-02');
  assert.equal(value.asOf, '2026-10-24T04:13:36Z');
});

test('future/cross-company records, nonfinite figures, invalid citations and unmatched segments are rejected', async () => {
  const original = await pack('AAPL');
  const bad = [
    value => { value.asOf = '2099-01-01T00:00:00Z'; },
    value => { value.ticker = 'IREN'; },
    value => { value.sources[0].url = 'https://evil.example/private'; },
    value => { value.sources[0].publishedAt = '2099-01-01'; },
    value => { value.summary[0].sourceIds = ['invented']; },
    value => { value.consensus.items[0].value = Infinity; },
    value => { value.business.segments[0].value += 1000000; },
    value => { value.business.income.revenue = 0; },
  ];
  for (const mutate of bad) {
    const value = structuredClone(original); mutate(value);
    assert.throws(() => validateCompanyOutlook(value, 'AAPL', collected));
    assert.equal(await loadCompanyOutlook(request, environment(value), 'AAPL', { clock: () => collected }), null);
  }
});

test('reported ARR cannot claim a future effective date and a target must retain a target date', async () => {
  const value = await pack('IREN'); value.arr.operating.effectiveAt = '2026-12-31';
  assert.throws(() => validateCompanyOutlook(value, 'IREN', collected), /Future ARR/);
  const value2 = await pack('IREN'); delete value2.arr.target.targetDate;
  assert.throws(() => validateCompanyOutlook(value2, 'IREN', collected), /target date/);
});

test('oversized or malformed asset responses fail closed without leaking internal errors', async () => {
  const huge = { ASSETS: { async fetch() { return new Response('x'.repeat(120001)); } } };
  const malformed = { ASSETS: { async fetch() { return new Response('{not-json'); } } };
  assert.equal(await loadCompanyOutlook(request, huge, 'AAPL'), null);
  assert.equal(await loadCompanyOutlook(request, malformed, 'AAPL'), null);
});
