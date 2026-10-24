import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPublicDataService, parseYahooChart, parseYahooStatisticsHtml } from '../../hosting/finance/public-data.mjs';

const raw = value => ({ raw: value });
const collected = '2026-10-24T04:20:00.000Z';
function modules(ticker = 'IREN') {
  return { price: { symbol: ticker, quoteType: 'EQUITY', currency: 'USD', longName: 'Company', regularMarketPrice: raw(25), regularMarketTime: 1792785600, marketCap: raw(1000000000), exchangeDataDelayedBy: 15 },
    summaryDetail: { priceToSalesTrailing12Months: raw(5), trailingPE: raw(20) }, defaultKeyStatistics: { mostRecentQuarter: { fmt: '2026-06-30' }, trailingEps: raw(1.25), forwardPE: raw(15), forwardEps: raw(1.5), beta: raw(1.2), enterpriseValue: raw(1200000000), sharesOutstanding: raw(40000000) },
    financialData: { financialCurrency: 'USD', returnOnEquity: raw(0.125), totalRevenue: raw(200000000), freeCashflow: raw(-1000000), operatingCashflow: raw(10000000), totalDebt: raw(200000000), totalCash: raw(5000000), recommendationKey: 'buy', numberOfAnalystOpinions: raw(10), targetMeanPrice: raw(30) },
    calendarEvents: { earnings: { earningsDate: [{ fmt: '2026-11-05' }], earningsAverage: raw(0.25), revenueAverage: raw(60000000), isEarningsDateEstimate: true } }, earningsGaap: { earningsChart: { currentPeriodEndDate: { fmt: '2026-09-30' }, currentFiscalQuarter: '1Q2027', currentCalendarQuarter: '3Q2026' } } };
}
function page(data, ticker = data.price.symbol) { return `<script type="application/json" data-sveltekit-fetched data-url="https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=price&amp;formatted=true">${JSON.stringify({ status: 200, body: JSON.stringify({ quoteSummary: { result: [data], error: null } }) })}</script>`; }

test('public Yahoo JSON preserves fields, individual bases and dates without executing page scripts', () => {
  const data = parseYahooStatisticsHtml('<script>throw new Error("never execute")</script>' + page(modules()), 'IREN', collected);
  assert.equal(data.price, 25); assert.equal(data.reportedPE, 20); assert.equal(data.reportedPS, 5); assert.equal(data.roe, 12.5); assert.equal(data.freeCashFlowTTM, -1000000);
  assert.equal(data.evidence.price.asOf, '2026-10-23T20:00:00.000Z'); assert.equal(data.evidence.roe.periodEnd, '2026-06-30'); assert.equal(data.evidence.reportedPS.retrievedAt, collected);
  assert.equal(data.evidence.reportedPS.url, 'https://finance.yahoo.com/quote/IREN/key-statistics/'); assert.match(data.evidence.reportedPS.basis, /TTM/);
  assert.equal(data.nextQuarterEstimates.revenueAverage, 60000000); assert.equal(data.nextQuarterEstimates.fiscalQuarter, '1Q2027'); assert.match(data.nextQuarterEstimates.source.basis, /예상/);
  assert.equal(data.analystConsensus.analystCount, 10);
});
test('loss-making actual and estimated earnings create explicit N/M PE rather than a fabricated positive ratio', () => {
  const fixture = modules(); fixture.defaultKeyStatistics.trailingEps = raw(-2.17); fixture.defaultKeyStatistics.forwardPE = raw(-6.25);
  const data = parseYahooStatisticsHtml(page(fixture), 'IREN', collected);
  assert.equal(data.reportedPE, null); assert.equal(data.forwardPE, null); assert.equal(data.epsTTM, -2.17); assert.equal(data.evidence.reportedPE, undefined);
  assert.match(data.unavailableReasons.reportedPE, /N\/M/); assert.match(data.unavailableReasons.forwardPE, /N\/M/);
});
test('a page cannot borrow price/statistics from an unrelated symbol, currency or unauthenticated wrapper', () => {
  assert.throws(() => parseYahooStatisticsHtml(page(modules('MSFT')), 'IREN', collected));
  const euro = modules(); euro.price.currency = 'EUR'; assert.throws(() => parseYahooStatisticsHtml(page(euro), 'IREN', collected));
  assert.throws(() => parseYahooStatisticsHtml(page(modules()).replace('"status":200', '"status":401'), 'IREN', collected));
  assert.throws(() => parseYahooStatisticsHtml(page(modules()).replace('https://query1.finance.yahoo.com', 'https://untrusted.example'), 'IREN', collected));
});
test('formatted strings, nonfinite fields and invalid dates never become numeric observations', () => {
  const fixture = modules(); fixture.price.marketCap = { raw: '1B' }; fixture.financialData.returnOnEquity = raw('12.5%'); fixture.defaultKeyStatistics.mostRecentQuarter = { fmt: '2026-99-01' };
  const result = parseYahooStatisticsHtml(page(fixture), 'IREN', collected);
  assert.equal(result.marketCap, null); assert.equal(result.roe, null); assert.equal(result.latestQuarter, null);
});
test('USD-traded ADRs cannot relabel another financial currency as dollar income or EPS', () => {
  const fixture = modules(); fixture.financialData.financialCurrency = 'EUR'; fixture.defaultKeyStatistics.netIncomeToCommon = raw(1000000);
  const result = parseYahooStatisticsHtml(page(fixture), 'IREN', collected);
  assert.equal(result.price, 25); assert.equal(result.marketCap, 1000000000);
  for (const field of ['epsTTM', 'forwardEPS', 'netIncomeTTM', 'revenueTTM', 'freeCashFlowTTM', 'totalCash', 'totalDebt']) {
    assert.equal(result[field], null, field); assert.equal(result.evidence[field], undefined, field); assert.match(result.unavailableReasons[field], /통화/, field);
  }
  assert.equal(result.nextQuarterEstimates.epsAverage, null); assert.equal(result.nextQuarterEstimates.revenueAverage, null); assert.equal(result.nextQuarterEstimates.currency, null);
});
test('provider Unix dates take precedence over localized strings while future earnings remain estimates', () => {
  const fixture = modules(); fixture.defaultKeyStatistics.mostRecentQuarter = { raw: 1782777600, fmt: 'Jun 30, 2026' };
  fixture.calendarEvents.earnings.earningsDate = [{ raw: 1793908800, fmt: 'Nov 5, 2026' }];
  fixture.earningsGaap.earningsChart.currentPeriodEndDate = { raw: 1798675200, fmt: 'Dec 31, 2026' };
  const result = parseYahooStatisticsHtml(page(fixture), 'IREN', collected);
  assert.equal(result.latestQuarter, '2026-06-30'); assert.equal(result.nextQuarterEstimates.earningsDate, '2026-11-05');
  assert.equal(result.nextQuarterEstimates.periodEnd, '2026-12-31');
});
test('future actual market or reported-quarter timestamps cannot become observations', () => {
  const future = Math.floor(Date.parse(collected) / 1000) + 301;
  const fixture = modules(); fixture.price.regularMarketTime = future;
  assert.throws(() => parseYahooStatisticsHtml(page(fixture), 'IREN', collected), /FUTURE/);
  const quarter = modules(); quarter.defaultKeyStatistics.mostRecentQuarter = { raw: 1798675200, fmt: '2026-06-30' };
  assert.throws(() => parseYahooStatisticsHtml(page(quarter), 'IREN', collected), /FUTURE/);
  assert.throws(() => parseYahooChart({chart:{result:[{meta:{symbol:'IREN',currency:'USD',regularMarketPrice:25,regularMarketTime:future}}]}}, 'IREN', collected), /FUTURE/);
});
test('service fetches only fixed public destinations, coalesces requests and caches normalized results', async () => {
  let calls = 0;
  const service = createPublicDataService({ clock: () => Date.parse(collected), fetcher: async (url, init) => { calls++; assert.equal(url, 'https://finance.yahoo.com/quote/IREN/key-statistics/'); assert.equal(init.redirect, 'error'); assert.equal(new Headers(init.headers).get('cookie'), null); return new Response(page(modules())); } });
  const [a, b] = await Promise.all([service('IREN'), service('IREN')]); assert.equal(a.price, b.price); await service('IREN'); assert.equal(calls, 1);
  await assert.rejects(service('https://evil.example')); await assert.rejects(service('../SECRET'));
});
test('a restricted statistics page is not retried with credentials; a public chart can supply only its own quote', async () => {
  const paths = [];
  const service = createPublicDataService({ clock: () => Date.parse(collected), fetcher: async url => { paths.push(url); return url.includes('key-statistics') ? new Response('Restricted', {status:401}) : Response.json({ chart: { result: [{ meta: { symbol:'IREN',currency:'USD',regularMarketPrice:25,regularMarketTime:1792785600 } }], error:null } }); } });
  const result = await service('IREN'); assert.equal(paths.length,2); assert.equal(result.price,25); assert.equal(result.reportedPE,null); assert.equal(result.marketCap,null);
  assert(paths[1].startsWith('https://query1.finance.yahoo.com/v8/finance/chart/IREN?'));
  assert.throws(() => parseYahooChart({chart:{result:[{meta:{symbol:'MSFT',currency:'USD',regularMarketPrice:25}}]}},'IREN',collected));
});
test('provider failure and oversized responses remain missing without fabricated source values', async () => {
  const service = createPublicDataService({ clock: () => Date.parse(collected), fetcher: async () => new Response('x', {headers:{'Content-Length':String(4*1024*1024)}}) });
  const result = await service('IREN'); assert.equal(result.status,'unavailable'); assert.deepEqual(result.evidence,{}); assert.equal(result.price,null);
});
