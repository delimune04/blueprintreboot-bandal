import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCollectorOptions, snapshotIndexEntry, compactResearchPayload } from '../../scripts/refresh-finance-research.mjs';

test('collector handles any validated SEC ticker and bounded resumable catalog batches', () => {
  assert.deepEqual(parseCollectorOptions(['--tickers', 'iren, AMD,iren']).tickers, ['IREN', 'AMD']);
  assert.deepEqual(parseCollectorOptions(['--all', '--offset', '125', '--limit', '100']), { all: true, offset: 125, limit: 100, tickers: null, help: false });
  for (const args of [['--all', '--limit', '101'], ['--all', '--offset', '-1'], ['--all', '--limit', '0'], ['--tickers', '../private'], ['--tickers', 'AMD,'], ['--all', '--tickers', 'AMD'], ['--offset', '0'], ['--all', '--all']]) assert.throws(() => parseCollectorOptions(args));
});

test('snapshot index includes verified collected company identities, not directory or failed files', () => {
  const record = { schemaVersion: 1, collectedAt: '2026-10-24T00:00:00.000Z', payload: { status: 'available', company: { ticker: 'AMD', name: 'Advanced Micro Devices', cik: '2488', currency: 'USD' }, period: { sourceUrl: 'https://www.sec.gov/Archives/edgar/data/2488/example.htm', end: '2025-12-27' }, sources: [{ provider: 'SEC companyfacts', status: 'available' }], quote: { profile: { sector: 'Technology', industry: 'Semiconductors' } } } };
  const entry = snapshotIndexEntry(record, 'AMD.json');
  assert.equal(entry.industry, 'Semiconductors');
  assert.equal(entry.periodEnd, '2025-12-27');
  assert.equal(snapshotIndexEntry(record, 'catalog.json'), null);
  assert.equal(snapshotIndexEntry(record, 'AAPL.json'), null);
  assert.equal(snapshotIndexEntry({ ...record, payload: { ...record.payload, status: 'unavailable' } }, 'AMD.json'), null);
  assert.equal(snapshotIndexEntry({ ...record, payload: { ...record.payload, sources: [] } }, 'AMD.json'), null);
});

test('partial quote-only snapshot needs matching ticker and verified Yahoo source', () => {
  const record = { schemaVersion: 1, collectedAt: '2026-10-24T00:00:00.000Z', payload: { status: 'partial', company: { ticker: 'XOM', name: 'ExxonMobil Holdings Corp', cik: '2115436' }, period: null, quote: { ticker: 'XOM', status: 'available', provider: 'Yahoo Finance' }, sources: [{ provider: 'Yahoo Finance', status: 'available' }] } };
  assert.equal(snapshotIndexEntry(record, 'XOM.json').status, 'partial');
  record.payload.quote.ticker = 'AAPL';
  assert.equal(snapshotIndexEntry(record, 'XOM.json'), null);
});


test('snapshot compaction retains primary evidence and raw quarters while removing reproducible duplicate views', () => {
  const evidence = { provider: 'SEC EDGAR', tag: 'Revenues', end: '2026-06-30', value: 100 };
  const payload = { financials: { revenue: 100 }, evidence: { revenue: evidence }, quote: { price: 50 }, history: { metricSeries: {} }, metrics: [{ key: 'per', value: 10 }], fieldSources: { revenue: evidence }, quarterlyHistory: { quarters: [{ financials: { revenue: 100 }, metrics: { eps: 2 }, evidence: { revenue: evidence } }], metricSeries: { revenue: [] } }, debt: { instruments: [{ name: 'Senior notes' }] } };
  const compact = compactResearchPayload(payload);
  assert.equal(compact.evidence.revenue, evidence);
  assert.equal(compact.quarterlyHistory.quarters[0].evidence.revenue, evidence);
  assert.equal(compact.quarterlyHistory.quarters[0].metrics.eps, 2);
  assert.equal(compact.debt.instruments[0].name, 'Senior notes');
  for (const key of ['history', 'metrics', 'fieldSources']) assert.equal(Object.hasOwn(compact, key), false);
  assert.equal(Object.hasOwn(compact.quarterlyHistory, 'metricSeries'), false);
});
