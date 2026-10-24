import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFinancialInsights } from '../../hosting/finance/insights.mjs';

const source = (value, fields = {}) => ({ value, provider: 'SEC EDGAR', url: 'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/report.htm', unit: 'USD', start: '2025-01-01', end: '2025-12-31', filed: '2026-02-15', ...fields });
function fixture() {
  const financials = { revenue: 1200, operatingIncome: 240, operatingCashFlow: 300, capex: 90, assets: 1600, liabilities: 900, equity: 700, cash: 200, debt: 500 };
  const evidence = Object.fromEntries(Object.entries(financials).map(([key, value]) => [key, source(value, ['assets', 'liabilities', 'equity', 'cash', 'debt'].includes(key) ? { start: null } : {})]));
  evidence.debt.tag = 'LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities';
  const quarter = (start, end, revenue, operatingIncome) => ({ start, end, financials: { revenue, operatingIncome }, evidence: { revenue: source(revenue, { start, end }), operatingIncome: source(operatingIncome, { start, end }) } });
  return { company: { ticker: 'TEST', currency: 'USD' }, asOf: '2026-10-24T00:00:00.000Z', period: { start: '2025-01-01', end: '2025-12-31' }, financials, evidence, annualHistory: [
    { start: '2024-01-01', end: '2024-12-31', revenue: 1000, source: source(1000, { start: '2024-01-01', end: '2024-12-31' }) },
    { start: '2025-01-01', end: '2025-12-31', revenue: 1200, source: source(1200) },
  ], quarterlyHistory: { quarters: [quarter('2025-04-01', '2025-06-30', 250, 25), quarter('2026-04-01', '2026-06-30', 400, 60)] } };
}
test('source-backed insights calculate concrete annual growth, quarter margin changes, cashflow and balance facts', () => {
  const result = buildFinancialInsights(fixture()), byKey = Object.fromEntries(result.summary.map(item => [item.key, item]));
  assert(Math.abs(byKey.annualRevenueGrowth.source.value - 20) < 1e-9);
  assert.equal(byKey.annualOperatingMargin.source.value, 20);
  assert.equal(byKey.quarterOperatingMargin.source.value, 15);
  assert.equal(byKey.quarterOperatingMargin.source.changePercentagePoints, 5);
  assert.equal(byKey.cashAfterInvestment.source.value, 210);
  assert.equal(byKey.cashToBorrowings.source.value, 40);
  assert.match(byKey.quarterOperatingMargin.text, /전년 동기 10% 대비 5%p 상승/);
  assert.match(byKey.cashAfterInvestment.text, /30%/);
  assert(result.summary.every(item => item.kind === 'derived-fact' && item.source.inputs.length > 0));
  assert.equal(result.coverage.runtimeAI, false);
  assert.equal(result.financialHighlights.find(item => item.key === 'liabilities').value, 900);
});
test('sources missing values, links, currencies or matching periods suppress calculations rather than cite unrelated evidence', () => {
  const f = fixture(); delete f.evidence.operatingIncome.url; f.evidence.capex.end = '2025-09-30'; f.evidence.cash.end = '2026-06-30'; f.annualHistory[0].source.unit = 'EUR';
  const result = buildFinancialInsights(f), keys = result.summary.map(item => item.key);
  assert(!keys.includes('annualRevenueGrowth')); assert(!keys.includes('annualOperatingMargin')); assert(!keys.includes('cashAfterInvestment')); assert(!keys.includes('cashToBorrowings'));
  assert.equal(result.coverage.checks.annualRevenueGrowth.state, 'unavailable');
  const missingUnit = fixture(); delete missingUnit.evidence.operatingIncome.unit;
  assert(!buildFinancialInsights(missingUnit).summary.some(item => item.key === 'annualOperatingMargin'));
  const wrongValue = fixture(); wrongValue.evidence.operatingIncome.value = 99;
  assert(!buildFinancialInsights(wrongValue).summary.some(item => item.key === 'annualOperatingMargin'));
});
test('annual and quarterly periods cannot be mislabeled, and non-adjacent annual comparisons are omitted', () => {
  const f = fixture(); f.annualHistory[0].start = '2023-01-01'; f.annualHistory[0].end = '2023-12-31';
  f.evidence.operatingIncome.start = f.evidence.revenue.start = '2025-10-01';
  f.quarterlyHistory.quarters = [f.annualHistory[1]];
  const result = buildFinancialInsights(f);
  assert(!result.summary.some(item => ['annualRevenueGrowth', 'annualOperatingMargin', 'quarterOperatingMargin'].includes(item.key)));
});
test('total liabilities and partial long-term debt never masquerade as comparable borrowing totals', () => {
  for (const tag of ['Liabilities', 'LongTermDebtNoncurrent']) {
    const f = fixture(); f.evidence.debt.tag = tag;
    assert(!buildFinancialInsights(f).summary.some(item => item.key === 'cashToBorrowings'));
  }
  const f = fixture(); f.evidence.debt.provider = 'Yahoo Finance';
  assert(!buildFinancialInsights(f).summary.some(item => item.key === 'cashToBorrowings'));
});
test('losses and cash investment deficits are preserved without unsupported solvency or investment recommendations', () => {
  const f = fixture(); f.financials.operatingIncome = -120; f.evidence.operatingIncome.value = -120;
  f.financials.operatingCashFlow = -10; f.evidence.operatingCashFlow.value = -10;
  const result = buildFinancialInsights(f), byKey = Object.fromEntries(result.summary.map(item => [item.key, item]));
  assert.equal(byKey.annualOperatingMargin.source.value, -10); assert.match(byKey.annualOperatingMargin.text, /영업손실/);
  assert.equal(byKey.cashAfterInvestment.source.value, -100);
  assert(!result.financialHighlights.some(item => item.key === 'capexBurden'));
  assert(!result.summary.some(item => /매수|매도|안전한|상환할 수/.test(item.text)));
});
test('empty or unproven data yields explicit coverage without generic business conclusions', () => {
  const result = buildFinancialInsights({});
  assert.deepEqual(result.summary, []); assert.deepEqual(result.financialHighlights, []);
  assert.equal(result.coverage.status, 'unavailable');
  assert(Object.values(result.coverage.checks).every(item => item.state === 'unavailable'));
});
