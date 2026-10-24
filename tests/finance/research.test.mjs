import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFinancialFlow, calculateDCF, calculateMetrics, dcfSensitivity } from '../../assetdist/finance/research-model.mjs';
import { createResearchService, normalizeCompanyFacts, reportsFromSubmissions } from '../../hosting/finance/research.mjs';

const row = (val, fields = {}) => ({ val, start: '2025-01-01', end: '2025-12-31', filed: '2026-02-12', form: '10-K', accn: '0001045810-26-000001', ...fields });
function factsFixture() {
  const tags = {
    RevenueFromContractWithCustomerExcludingAssessedTax: [row(1000), row(777, { start: '2026-01-01', end: '2026-03-31', filed: '2026-05-01', form: '10-Q' }), row(999, { start: '2024-01-01', end: '2024-12-31' })],
    CostOfRevenue: [row(400)], OperatingIncomeLoss: [row(200)], NetIncomeLoss: [row(150)], NetCashProvidedByUsedInOperatingActivities: [row(300)], PaymentsToAcquirePropertyPlantAndEquipment: [row(50)],
    StockholdersEquity: [row(600, { start: undefined }), row(400, { start: undefined, end: '2024-12-31' })], CashAndCashEquivalentsAtCarryingValue: [row(100, { start: undefined })],
  };
  return { cik: 1045810, facts: { 'us-gaap': { ...Object.fromEntries(Object.entries(tags).map(([tag, rows]) => [tag, { units: { USD: rows } }])), EarningsPerShareDiluted: { units: { 'USD/shares': [row(3)] } }, CommonStockSharesOutstanding: { units: { shares: [row(50, { start: undefined })] } } } } };
}
function submissionsFixture() { return { cik: '0001045810', filings: { recent: { form: ['8-K', '10-K', '10-Q'], filingDate: ['2026-04-30', '2026-02-12', '2025-11-01'], reportDate: ['2026-04-28', '2025-12-31', '2025-09-30'], accessionNumber: ['0001045810-26-000002', '0001045810-26-000001', '0001045810-25-000003'], primaryDocument: ['earnings.htm', 'annual.htm', '../malicious.htm'], items: ['2.02,9.01', '', ''] } } }; }
const request = path => new Request('https://bandal.app/finance/api/' + path);
const env = { SEC_USER_AGENT: 'BANDAL Finance tests contact@example.com' };
const tickers = { 0: { ticker: 'NVDA', title: 'NVIDIA Corporation', cik_str: 1045810 }, 1: { ticker: 'WXYZ', title: 'Other Co', cik_str: 12345 } };
function provider(extra = {}) { const calls = []; return { calls, fetcher: async (url, options) => { calls.push({ url, options }); if (url.endsWith('company_tickers.json')) return Response.json(tickers); if (url.includes('/companyfacts/')) return Response.json(factsFixture()); if (url.includes('/submissions/')) return Response.json(submissionsFixture()); if (url.includes('alphavantage.co')) { const fn = new URL(url).searchParams.get('function'); return Response.json(extra[fn] || {}); } throw new Error('Unexpected URL'); } }; }

test('annual financials reject quarters/YTD and derive only matching-period residuals', () => {
  const normalized = normalizeCompanyFacts(factsFixture(), '1045810');
  assert.equal(normalized.period.end, '2025-12-31');
  assert.equal(normalized.financials.revenue, 1000);
  assert.equal(normalized.financials.grossProfit, 600);
  assert.equal(normalized.financials.operatingExpenses, 400);
  assert.equal(normalized.financials.freeCashFlow, 250);
  assert.equal(normalized.financials.priorEquity, 400);
  assert.equal(normalized.evidence.grossProfit.derived, true);
  assert.match(normalized.evidence.revenue.url, /^https:\/\/www\.sec\.gov\/Archives\//);
});
test('different fiscal periods, wrong currencies and absent tags remain unavailable', () => {
  const facts = factsFixture();
  facts.facts['us-gaap'].CostOfRevenue.units.USD[0].start = '2025-01-02';
  facts.facts['us-gaap'].NetIncomeLoss.units = { EUR: [row(150)] };
  const normalized = normalizeCompanyFacts(facts, '1045810');
  assert.equal(normalized.financials.costOfRevenue, null);
  assert.equal(normalized.financials.grossProfit, null);
  assert.equal(normalized.financials.netIncome, null);
  assert.equal(normalized.financials.debt, null);
  assert.equal(buildFinancialFlow(normalized.financials).status, 'unavailable');
});
test('a newly filed restatement wins for the same year without replacing it by a later quarter', () => {
  const facts = factsFixture();
  facts.facts['us-gaap'].NetIncomeLoss.units.USD.push(row(140, { filed: '2026-03-01', form: '10-K/A' }));
  assert.equal(normalizeCompanyFacts(facts, '1045810').financials.netIncome, 140);
});
test('standard productive-asset capex supports broader investment scope with an explicit warning and exact period', () => {
  const facts = factsFixture();
  delete facts.facts['us-gaap'].PaymentsToAcquirePropertyPlantAndEquipment;
  facts.facts['us-gaap'].PaymentsToAcquireProductiveAssets = { units: { USD: [row(70)] } };
  const result = normalizeCompanyFacts(facts, '1045810');
  assert.equal(result.financials.freeCashFlow, 230);
  assert.equal(result.evidence.capex.tag, 'PaymentsToAcquireProductiveAssets');
  assert(result.warnings.some(message => message.includes('소프트웨어')));
  facts.facts['us-gaap'].PaymentsToAcquireProductiveAssets.units.USD[0].end = '2025-12-30';
  assert.equal(normalizeCompanyFacts(facts, '1045810').financials.freeCashFlow, null);
});
test('financial flow conserves both revenue and gross profit and declines negative/inconsistent flows', () => {
  const f = normalizeCompanyFacts(factsFixture(), '1045810').financials;
  const flow = buildFinancialFlow(f);
  assert.equal(flow.status, 'available');
  for (const id of ['revenue', 'gross']) assert.equal(flow.links.filter(link => link.source === id).reduce((sum, link) => sum + link.value, 0), flow.nodes.find(node => node.id === id).value);
  assert.equal(buildFinancialFlow({ ...f, operatingExpenses: 410 }).status, 'unavailable');
  assert.equal(buildFinancialFlow({ ...f, operatingIncome: -1 }).status, 'unavailable');
  assert.equal(buildFinancialFlow({ ...f, revenue: NaN }).status, 'unavailable');
});
test('metrics use average equity, never invent ARR and do not mix unconfirmed split-basis price with EPS', () => {
  const f = normalizeCompanyFacts(factsFixture(), '1045810').financials;
  const metrics = calculateMetrics(f, { price: 60, marketCap: 3000 });
  assert.equal(metrics.find(item => item.key === 'roe').value, 30);
  assert.equal(metrics.find(item => item.key === 'eps').value, 3);
  assert.equal(metrics.find(item => item.key === 'arr').value, null);
  assert.equal(metrics.find(item => item.key === 'per').value, null);
  assert.equal(calculateMetrics(f, { reportedPE: 20, reportedPS: 3 }).find(item => item.key === 'per').value, 20);
  assert.equal(calculateMetrics(f, { price: 60, basisConfirmed: true }).find(item => item.key === 'per').value, 20);
  assert.equal(calculateMetrics({ ...f, equity: -1000 }).find(item => item.key === 'roe').value, null);
});
test('DCF matches perpetuity arithmetic and applies cash/debt only to explicit FCFF', () => {
  const input = { freeCashFlow: 100, growthRate: 0, discountRate: 0.1, terminalGrowthRate: 0, years: 1, shares: 10, cash: 20, debt: 40 };
  const proxy = calculateDCF(input), enterprise = calculateDCF({ ...input, cashFlowType: 'fcff' });
  assert(Math.abs(proxy.perShare - 100) < 1e-9);
  assert.equal(proxy.enterpriseValue, null);
  assert(Math.abs(enterprise.enterpriseValue - 1000) < 1e-9);
  assert(Math.abs(enterprise.perShare - 98) < 1e-9);
  assert(proxy.warnings.length > 0);
  const sensitivity = dcfSensitivity({ ...input, discountRate: 0.1, growthRate: 0.05 });
  assert.equal(sensitivity.length, 9);
  assert(sensitivity[0].perShare > sensitivity[6].perShare);
});
test('DCF rejects undefined cashflow, non-finite assumptions, invalid horizons and Gordon singularities', () => {
  const valid = { freeCashFlow: 100, shares: 10 };
  for (const patch of [{ freeCashFlow: 0 }, { freeCashFlow: -1 }, { shares: 0 }, { discountRate: 0.02, terminalGrowthRate: 0.02 }, { growthRate: Infinity }, { years: 0 }, { years: 5.5 }, { cashFlowType: 'unknown' }]) assert.throws(() => calculateDCF({ ...valid, ...patch }));
});
test('reports expose only SEC paths; earnings requires actual 8-K Item 2.02 and uses filing dates', () => {
  const reports = reportsFromSubmissions(submissionsFixture(), '1045810');
  assert.equal(reports.length, 3);
  assert.equal(reports[0].earnings, true);
  assert.equal(reports[0].date, '2026-04-30');
  assert.equal(reports[0].periodEnd, '2026-04-28');
  assert.match(reports[2].url, /-index\.htm$/);
  assert.equal(reports.some(item => item.url.includes('malicious')), false);
});
test('search and facts use fixed SEC destinations, declared user agent, caching and source provenance', async () => {
  const p = provider(), handle = createResearchService({ fetcher: p.fetcher });
  const search = await handle(request('companies/search?q=엔비디아'), env, 'companies/search');
  assert.equal(search.status, 200);
  assert.equal((await search.json()).results[0].ticker, 'NVDA');
  const company = await (await handle(request('companies/NVDA'), env, 'companies/NVDA')).json();
  assert.equal(company.status, 'available');
  assert.equal(company.flow.status, 'available');
  assert.equal(company.reports[0].type, '8-K');
  assert.equal(company.metrics.find(item => item.key === 'per').value, null);
  assert.equal(company.quote.status, 'unavailable');
  const count = p.calls.length;
  await handle(request('companies/NVDA?url=https://evil.example'), env, 'companies/NVDA');
  assert.equal(p.calls.length, count);
  for (const call of p.calls) { assert.match(call.url, /^https:\/\/(?:www\.)?(?:sec\.gov|data\.sec\.gov)\//); assert.equal(call.options.headers['User-Agent'], env.SEC_USER_AGENT); assert.equal(call.options.redirect, 'error'); }
  assert(company.sources[0].retrievedAt);
});
test('missing operator identity and provider outages return official links and no fabricated financial numbers', async () => {
  let calls = 0;
  const handle = createResearchService({ fetcher: async () => { calls++; throw new Error('Network unavailable'); } });
  const search = await (await handle(request('companies/search?q=NVDA'), {}, 'companies/search')).json();
  assert.equal(search.source.status, 'directory-only');
  assert.equal(calls, 0);
  const result = await (await handle(request('companies/NVDA'), {}, 'companies/NVDA')).json();
  assert.equal(result.status, 'unavailable');
  assert(Object.values(result.financials).every(value => value === null));
  assert.equal(result.reports.find(item => item.provider === '기업 공식 IR').url, 'https://investor.nvidia.com/');
  assert.equal(calls, 0);
  const unavailable = await handle(request('companies/WXYZ'), {}, 'companies/WXYZ');
  assert.equal(unavailable.status, 503);
});
test('invalid symbols and arbitrary URL inputs cannot trigger server-side fetches', async () => {
  let calls = 0;
  const handle = createResearchService({ fetcher: async () => { calls++; throw new Error(); } });
  assert.equal((await handle(request('companies/https%3Aevil'), env, 'companies/https:evil')).status, 422);
  assert.equal((await handle(request('companies/search?q=' + 'x'.repeat(101)), env, 'companies/search')).status, 422);
  assert.equal((await handle(new Request('https://bandal.app/finance/api/companies/NVDA', { method: 'POST' }), env, 'companies/NVDA')).status, 405);
  assert.equal(calls, 0);
});
test('oversized SEC responses, invalid JSON and company ID mismatches cannot populate financials', async () => {
  for (const kind of ['oversize', 'bad-json', 'wrong-cik']) {
    const handle = createResearchService({ fetcher: async url => {
      if (url.endsWith('company_tickers.json')) return Response.json(tickers);
      if (url.includes('submissions')) return Response.json(submissionsFixture());
      if (kind === 'oversize') return new Response('{}', { headers: { 'Content-Length': String(15 * 1024 * 1024) } });
      if (kind === 'bad-json') return new Response('not json');
      return Response.json({ ...factsFixture(), cik: 123 });
    } });
    const result = await (await handle(request('companies/NVDA'), env, 'companies/NVDA')).json();
    assert.equal(result.status, 'unavailable', kind);
    assert.equal(result.financials.revenue, null);
  }
});
test('configured market adapter supplies documented EOD quote and provider TTM ratios, never leaks its API key', async () => {
  const p = provider({ GLOBAL_QUOTE: { 'Global Quote': { '01. symbol': 'NVDA', '05. price': '60.00', '07. latest trading day': '2026-10-23' } }, OVERVIEW: { Symbol: 'NVDA', Currency: 'USD', PERatio: '25.00', PriceToSalesRatioTTM: '9.1', MarketCapitalization: '300000000', LatestQuarter: '2026-06-30', AnalystTargetPrice: '70', AnalystRatingBuy: '12', AnalystRatingHold: '3' } });
  const handle = createResearchService({ fetcher: p.fetcher }), result = await (await handle(request('companies/NVDA'), { ...env, ALPHAVANTAGE_API_KEY: 'PRIVATE_MARKET_KEY' }, 'companies/NVDA')).json();
  assert.equal(result.quote.price, 60);
  assert.equal(result.metrics.find(item => item.key === 'per').value, 25);
  assert.equal(result.metrics.find(item => item.key === 'psr').value, 9.1);
  assert.equal(result.opinions.status, 'available');
  assert.equal(result.opinions.ratings.find(item => item.rating === 'Buy').count, 12);
  assert.equal(JSON.stringify(result).includes('PRIVATE_MARKET_KEY'), false);
  assert.match(result.quote.freshness, /실시간 아님/);
  const count = p.calls.length;
  await handle(request('companies/NVDA'), { ...env, ALPHAVANTAGE_API_KEY: 'PRIVATE_MARKET_KEY' }, 'companies/NVDA');
  assert.equal(p.calls.length, count);
});
test('market provider quota notices and symbol/currency mismatches stay unavailable with no made-up ratios', async () => {
  for (const override of [{ GLOBAL_QUOTE: { Information: 'Quota exhausted' }, OVERVIEW: { Note: 'Quota exhausted' } }, { GLOBAL_QUOTE: { 'Global Quote': { '01. symbol': 'OTHER', '05. price': '100', '07. latest trading day': '2026-10-23' } }, OVERVIEW: { Symbol: 'NVDA', Currency: 'EUR', PERatio: '20' } }]) {
    const p = provider(override), handle = createResearchService({ fetcher: p.fetcher });
    const result = await (await handle(request('companies/NVDA'), { ...env, ALPHAVANTAGE_API_KEY: 'test-key' }, 'companies/NVDA')).json();
    assert.equal(result.quote.status, 'unavailable');
    assert.equal(result.metrics.find(item => item.key === 'per').value, null);
  }
});

async function snapshotFixture(collectedAt) {
  const p = provider(), handle = createResearchService({ fetcher: p.fetcher });
  const payload = await (await handle(request('companies/NVDA'), env, 'companies/NVDA')).json();
  return { schemaVersion: 1, collectedAt, source: 'SEC EDGAR direct API ingestion', payload };
}
function assetBinding(files, calls = []) {
  return { async fetch(req) { const url = new URL(req.url); calls.push({ origin: url.origin, pathname: url.pathname, search: url.search }); return files[url.pathname] ? Response.json(files[url.pathname]) : new Response('Not found', { status: 404 }); } };
}
test('fresh normalized snapshots serve source-backed numbers with collection age and no live-provider claim', async () => {
  const now = Date.parse('2026-10-24T12:00:00.000Z'), collectedAt = '2026-10-24T11:00:00.000Z', snapshot = await snapshotFixture(collectedAt), assets = [];
  let external = 0;
  const handle = createResearchService({ clock: () => now, fetcher: async () => { external++; throw new Error('Hosted SEC unavailable'); } });
  const response = await handle(request('companies/NVDA?url=https://evil.example'), { ...env, ASSETS: assetBinding({ '/finance/snapshots/NVDA.json': snapshot }, assets) }, 'companies/NVDA');
  const data = await response.json();
  assert.equal(data.status, 'available');
  assert.equal(data.dataMode, 'snapshot');
  assert.equal(data.collectedAt, collectedAt);
  assert.equal(data.asOf, collectedAt);
  assert.equal(data.snapshot.ageHours, 1);
  assert.equal(data.snapshot.stale, false);
  assert.equal(data.financials.revenue, 1000);
  assert.equal(data.period.filed, '2026-02-12');
  assert.equal(data.evidence.revenue.filed, '2026-02-12');
  assert.equal(data.sources[0].snapshotCollectedAt, collectedAt);
  assert.equal(data.quote.status, 'unavailable');
  assert.equal(external, 0);
  assert.deepEqual(assets, [{ origin: 'https://bandal.app', pathname: '/finance/snapshots/NVDA.json', search: '' }]);
  assert.match(data.limitations[0], /실시간 갱신 아님/);
  assert.match(response.headers.get('cache-control'), /no-store/);
});
test('stale snapshots are used only after a live failure and clearly retain old collection/filing dates', async () => {
  const now = Date.parse('2026-10-24T12:00:00.000Z'), collectedAt = '2026-10-20T11:00:00.000Z', snapshot = await snapshotFixture(collectedAt);
  let external = 0;
  const handle = createResearchService({ clock: () => now, fetcher: async () => { external++; throw new Error('Hosted SEC unavailable'); } });
  const data = await (await handle(request('companies/NVDA'), { ...env, ASSETS: assetBinding({ '/finance/snapshots/NVDA.json': snapshot }) }, 'companies/NVDA')).json();
  assert.equal(data.snapshot.stale, true);
  assert.equal(data.snapshot.reason, 'provider-unavailable');
  assert.equal(data.snapshot.ageHours, 97);
  assert.equal(data.asOf, collectedAt);
  assert.equal(data.period.end, '2025-12-31');
  assert(external > 0);
  assert.match(data.limitations[0], /24시간이 지났/);
});
test('full catalog snapshot provides search beyond the small fallback directory with honest freshness', async () => {
  const now = Date.parse('2026-10-24T12:00:00.000Z'), collectedAt = '2026-10-24T11:00:00.000Z';
  const catalog = { schemaVersion: 1, collectedAt, source: { provider: 'SEC EDGAR', url: 'https://www.sec.gov/files/company_tickers.json' }, companies: [{ ticker: 'WXYZ', name: 'Other Co', cik: '12345' }] };
  let external = 0;
  const handle = createResearchService({ clock: () => now, fetcher: async () => { external++; throw new Error(); } });
  const data = await (await handle(request('companies/search?q=WXYZ'), { ASSETS: assetBinding({ '/finance/snapshots/catalog.json': catalog }) }, 'companies/search')).json();
  assert.equal(data.results[0].ticker, 'WXYZ');
  assert.equal(data.source.status, 'snapshot');
  assert.equal(data.source.retrievedAt, collectedAt);
  assert.equal(data.source.stale, false);
  assert.equal(external, 0);
});
test('missing, future-dated, wrong-company and malformed snapshots fall through without invented values', async () => {
  const now = Date.parse('2026-10-24T12:00:00.000Z'), valid = await snapshotFixture('2026-10-24T11:00:00.000Z');
  for (const snapshot of [null, { ...valid, collectedAt: '2026-10-25T11:00:00.000Z' }, { ...valid, payload: { ...valid.payload, company: { ...valid.payload.company, ticker: 'OTHER' } } }, { ...valid, schemaVersion: 99 }]) {
    const handle = createResearchService({ clock: () => now, fetcher: async () => { throw new Error(); } });
    const files = snapshot ? { '/finance/snapshots/NVDA.json': snapshot } : {};
    const data = await (await handle(request('companies/NVDA'), { ASSETS: assetBinding(files) }, 'companies/NVDA')).json();
    assert.equal(data.status, 'unavailable');
    assert.equal(data.dataMode, 'live-source');
    assert.equal(data.financials.revenue, null);
  }
});
