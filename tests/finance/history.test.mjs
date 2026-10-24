import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuarterlyHistory, attachHistoricalValuations } from '../../hosting/finance/history.mjs';

const row = (val, start, end, filed, extra = {}) => ({ val, start, end, filed, form: end === '2025-12-31' ? '10-K' : '10-Q', accn: `0000000001-${filed.slice(2, 4)}-${filed.slice(5).replace('-', '').padStart(6, '0')}`, ...extra });
const q1 = value => row(value, '2025-01-01', '2025-03-31', '2025-05-01');
const q2 = value => row(value, '2025-04-01', '2025-06-30', '2025-08-01');
const h1 = value => row(value, '2025-01-01', '2025-06-30', '2025-08-01');
const nine = value => row(value, '2025-01-01', '2025-09-30', '2025-11-01');
const year = value => row(value, '2025-01-01', '2025-12-31', '2026-02-01');
function facts(fields, taxonomy = 'us-gaap') {
  return { facts: { [taxonomy]: Object.fromEntries(Object.entries(fields).map(([tag, rows]) => [tag, { units: { [tag.includes('PerShare') ? 'USD/shares' : 'USD']: rows } }])) } };
}

test('four individual quarters combine direct revenue with matched YTD cashflow, retain provenance and never use annual totals as Q4', () => {
  const result = normalizeQuarterlyHistory(facts({ Revenues: [q1(100), q2(120), h1(220), nine(360), year(520)], NetCashProvidedByUsedInOperatingActivities: [q1(20), h1(50), nine(90), year(150)], PaymentsToAcquirePropertyPlantAndEquipment: [q1(5), h1(15), nine(30), year(50)] }), '1');
  assert.equal(result.status, 'available');
  assert.deepEqual(result.quarters.map(q => q.financials.revenue), [100, 120, 140, 160]);
  assert.deepEqual(result.metricSeries.fcf.map(q => q.value), [15, 20, 25, 40]);
  assert.deepEqual(result.quarters.map(q => q.start), ['2025-01-01', '2025-04-01', '2025-07-01', '2025-10-01']);
  assert.equal(result.quarters[3].evidence.revenue.derived, true);
  assert.equal(result.quarters[3].evidence.revenue.inputs.length, 2);
  assert.equal(result.quarters[3].evidence.revenue.inputs[0].value, 520);
  assert.match(result.quarters[3].evidence.revenue.url, /^https:\/\/www.sec.gov\/Archives\//);
});

test('annual-only financials never become fabricated quarterly trends or EPS differences', () => {
  const result = normalizeQuarterlyHistory(facts({ Revenues: [year(1000)], EarningsPerShareDiluted: [year(5)] }), '1');
  assert.equal(result.status, 'unavailable'); assert.deepEqual(result.quarters, []);
});

test('EPS is accepted only for an explicit quarter, while loss and zero metrics stay real values', () => {
  const result = normalizeQuarterlyHistory(facts({ Revenues: [q1(100), q2(120), h1(220), nine(360), year(520)], EarningsPerShareDiluted: [q1(-1), h1(3), year(9)], OperatingIncomeLoss: [q1(0), q2(-12)], NetIncomeLoss: [q1(-20)] }), '1');
  assert.deepEqual(result.metricSeries.eps.map(point => point.value), [-1, null, null, null]);
  assert.equal(result.metricSeries.operatingMargin[0].value, 0);
  assert.equal(result.metricSeries.operatingMargin[1].value, -10);
  assert.equal(result.metricSeries.netMargin[0].value, -20);
  assert(result.metricSeries.per.every(point => point.value === null));
});

test('YTD differences never cross tags, fiscal year starts, currencies or future restatements', () => {
  const original = q1(100), correctedAfterQ2 = { ...original, val: 999, filed: '2026-05-01' };
  const result = normalizeQuarterlyHistory(facts({ Revenues: [original, correctedAfterQ2, h1(220)], SalesRevenueNet: [nine(700)] }), '1');
  assert.equal(result.quarters.find(q => q.end === '2025-06-30').financials.revenue, 120);
  assert.equal(result.quarters.some(q => q.end === '2025-09-30'), false);
  const wrongFY = normalizeQuarterlyHistory(facts({ Revenues: [q1(100), { ...h1(250), start: '2025-01-02' }] }), '1');
  assert.equal(wrongFY.quarters.length, 1);
  const foreign = facts({ Revenues: [q1(100)] }); foreign.facts['us-gaap'].Revenues.units = { EUR: [q1(100)] };
  assert.equal(normalizeQuarterlyHistory(foreign, '1').status, 'unavailable');
});

test('current-filing restated comparative YTD wins and amended totals require matching-filing comparatives', () => {
  const q2restated = { ...h1(230), form: '10-Q/A', filed: '2025-08-20', accn: '0000000001-25-000008' };
  const q1restated = { ...q1(105), filed: '2025-08-20', form: '10-Q/A', accn: q2restated.accn };
  const current = normalizeQuarterlyHistory(facts({ Revenues: [q1(100), q2(120), h1(220), q1restated, q2restated] }), '1');
  assert.equal(current.quarters[1].financials.revenue, 125);
  assert.equal(current.quarters[1].evidence.revenue.inputs[1].value, 105);
  const unmatched = normalizeQuarterlyHistory(facts({ Revenues: [q1(100), q2restated] }), '1');
  assert.equal(unmatched.quarters.length, 1);
});

test('IFRS USD quarters work with exact 53-week fiscal periods and requested as-of excludes later reports', () => {
  const result = normalizeQuarterlyHistory(facts({ Revenue: [row(300, '2025-09-28', '2026-01-03', '2026-02-10'), row(400, '2026-01-04', '2026-04-04', '2026-05-05')] }, 'ifrs-full'), '1', { asOf: '2026-04-30' });
  assert.equal(result.quarters.length, 1); assert.equal(result.quarters[0].end, '2026-01-03');
  assert.equal(result.quarters[0].evidence.revenue.taxonomy, 'ifrs-full');
});

test('quarterly ROE uses quarter-end average capital, labels annualization, and refuses negative capital', () => {
  const balance = (value, end) => row(value, undefined, end, '2025-05-01');
  const result = normalizeQuarterlyHistory(facts({ Revenues: [q1(100)], NetIncomeLoss: [q1(10)], StockholdersEquity: [balance(100, '2024-12-31'), balance(140, '2025-03-31')] }), '1');
  assert(Math.abs(result.metricSeries.roe[0].value - 100 / 3) < 1e-9);
  assert.match(result.metricSeries.roe[0].source.basis, /연율화/);
  const negative = normalizeQuarterlyHistory(facts({ Revenues: [q1(100)], NetIncomeLoss: [q1(10)], StockholdersEquity: [balance(-100, '2024-12-31'), balance(-140, '2025-03-31')] }), '1');
  assert.equal(negative.metricSeries.roe[0].value, null);
});

function valuationHistory() {
  return { status: 'available', quarters: [
    ['2025-01-01', '2025-03-31'], ['2025-04-01', '2025-06-30'], ['2025-07-01', '2025-09-30'], ['2025-10-01', '2025-12-31'],
    ['2026-01-01', '2026-03-31'], ['2026-04-01', '2026-06-30'], ['2026-07-01', '2026-09-30'], ['2026-10-01', '2026-12-31'],
  ].map(([start, end]) => ({ start, end, label: end, financials: { revenue: 100, shares: 10 }, metrics: { eps: 1 }, evidence: { revenue: { value: 100, end, url: 'https://www.sec.gov/' }, eps: { value: 1, end, url: 'https://www.sec.gov/' }, shares: { value: 10, end, url: 'https://www.sec.gov/' } } })), metricSeries: {}, limitations: [] };
}
const prices = { currency: 'USD', splits: [], points: ['2026-03-31', '2026-06-30', '2026-09-30', '2026-12-31'].map(date => ({ date, close: 40, adjustedClose: 1 })), source: { provider: 'Yahoo Finance', url: 'https://finance.yahoo.com/quote/TEST/history/' } };
test('historical valuation uses actual raw quarter-end close and four contiguous quarter observations, then returns the latest four', () => {
  const result = attachHistoricalValuations(valuationHistory(), prices);
  assert.equal(result.quarters.length, 4);
  assert.deepEqual(result.metricSeries.per.map(point => point.value), [10, 10, 10, 10]);
  assert.deepEqual(result.metricSeries.psr.map(point => point.value), [1, 1, 1, 1]);
  assert.deepEqual(result.metricSeries.epsTTM.map(point => point.value), [4, 4, 4, 4]);
  assert.equal(result.metricSeries.per[0].source.marketSource.value, 40);
  assert.match(result.metricSeries.per[0].source.basis, /사후 공시/);
});
test('split ambiguity, missing EPS, nonconsecutive quarters and stale prices leave gaps instead of forged ratios', () => {
  const split = attachHistoricalValuations(valuationHistory(), { ...prices, splits: [{ date: '2026-08-01', numerator: 2, denominator: 1 }] });
  assert.equal(split.metricSeries.per[0].value, null); assert.match(split.metricSeries.per[0].reason, /주식분할/);
  assert.equal(split.metricSeries.per[2].value, 10);
  const unverified = { ...prices }; delete unverified.splits;
  assert(attachHistoricalValuations(valuationHistory(), unverified).metricSeries.per.every(point => point.value === null));
  const missing = valuationHistory(); missing.quarters[2].metrics.eps = null;
  assert.equal(attachHistoricalValuations(missing, prices).metricSeries.per[0].value, null);
  const gap = valuationHistory(); gap.quarters[3].start = '2025-10-02';
  assert.equal(attachHistoricalValuations(gap, prices).metricSeries.psr[0].value, null);
  const stale = { ...prices, points: prices.points.map(point => ({ ...point, date: point.date.slice(0, 8) + '01' })) };
  assert(attachHistoricalValuations(valuationHistory(), stale).metricSeries.per.every(point => point.value === null));
});
test('historical loss PER is N/M and negative EPS is preserved; raw historical stock prices remain viewable', () => {
  const h = valuationHistory(); h.quarters.forEach(q => { q.metrics.eps = -1; });
  const result = attachHistoricalValuations(h, prices);
  assert.equal(result.metricSeries.per[0].status, 'not-meaningful');
  assert.equal(result.metricSeries.epsTTM[0].value, -4);
  assert.equal(result.metricSeries.price[0].value, 40);
});
