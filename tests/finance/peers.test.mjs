import { test } from 'node:test';
import assert from 'node:assert/strict';
import { industryBenchmarks } from '../../hosting/finance/peers.mjs';

const source = { provider: 'Yahoo Finance', url: 'https://finance.yahoo.com/quote/AAPL/key-statistics/', basis: 'Yahoo 제공 TTM 지표', asOf: '2026-10-23' };
function company(ticker, value, patch = {}) {
  return { company: { ticker, name: ticker, cik: String(ticker.charCodeAt(0)), industry: 'Semiconductors', classificationSource: { provider: 'Yahoo Finance', url: 'https://finance.yahoo.com/' }, ...patch.company }, metrics: [{ key: 'per', value, unit: '배', status: value === null ? 'not-meaningful' : 'reported', source: { ...source, ...patch.source } }] };
}
test('same-industry peer averages exclude the subject, loss PER, duplicate issuers and mismatched bases', () => {
  const subject = company('A', 30), b = company('B', 20), c = company('C', 40);
  const result = industryBenchmarks(subject, [subject, b, c, company('D', -5), company('E', 100, { company: { industry: 'Banks' } }), company('F', 100, { source: { basis: 'next-year estimated' } }), company('B', 20), company('BB', 200, { company: { cik: b.company.cik } })]);
  assert.equal(result.status, 'available'); assert.equal(result.metrics.per.mean, 30); assert.equal(result.metrics.per.n, 2);
  assert.equal(result.metrics.per.median, 30); assert.equal(result.metrics.per.scope, 'observed-peer-sample');
  assert.deepEqual(result.metrics.per.sample.map(row => row.ticker), ['B', 'C']);
  assert.match(result.reason, /전체 산업 평균이 아닙니다/);
});
test('a loss-making subject may see an unambiguous positive peer sample without claiming subject comparability', () => {
  const result = industryBenchmarks(company('A', null), [company('B', 10), company('C', 30)]);
  assert.equal(result.metrics.per.mean, 20); assert.equal(result.metrics.per.subjectComparable, false);
  const ambiguous = industryBenchmarks(company('A', null), [company('B', 10), company('C', 30, { source: { basis: 'forward' } })]);
  assert.equal(ambiguous.metrics.per, undefined);
});
test('editorial categories and unknown numeric values cannot become source-backed industry averages', () => {
  const subject = company('A', 20, { company: { classificationSource: 'BANDAL 탐색용 편집 분류' } });
  assert.equal(industryBenchmarks(subject, [company('B', 30)]).status, 'unavailable');
  const result = industryBenchmarks(company('A', 20), [company('B', NaN), company('C', Infinity), company('D', null)]);
  assert.equal(result.status, 'unavailable'); assert.deepEqual(result.metrics, {});
});
test('Yahoo assetProfile classification is accepted directly and source dates are preserved', () => {
  const a = company('A', 20); a.company.classificationSource = null;
  a.quote = { profile: { industry: 'Semiconductors', source: { provider: 'Yahoo Finance', url: 'https://finance.yahoo.com/quote/A/profile/' } } };
  const result = industryBenchmarks(a, [company('B', 30)]);
  assert.equal(result.metrics.per.mean, 30); assert.deepEqual(result.metrics.per.dates, ['2026-10-23']);
});
