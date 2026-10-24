import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createResearchService } from '../../hosting/finance/research.mjs';
import { companySummary, renderExplorerCards } from '../../assetdist/finance/explorer.mjs';

const assets = new URL('../../assetdist/', import.meta.url);
const snapshots = new URL('finance/snapshots/', assets);
const catalog = JSON.parse(await readFile(new URL('catalog.json', snapshots), 'utf8'));
const names = (await readdir(snapshots)).filter(name => name.endsWith('.json') && name !== 'catalog.json');
const records = await Promise.all(names.map(async name => JSON.parse(await readFile(new URL(name, snapshots), 'utf8'))));
const collected = Math.max(Date.parse(catalog.collectedAt), ...records.map(record => Date.parse(record.collectedAt)));
const environment = { ASSETS: { async fetch(request) {
  const path = new URL(request.url).pathname;
  if (!/^\/finance\/(snapshots|outlooks)\/[A-Za-z0-9.-]+\.json$/.test(path)) return new Response('', { status: 404 });
  try { return new Response(await readFile(new URL(path.slice(1), assets)), { headers: { 'Content-Type': 'application/json' } }); }
  catch { return new Response('', { status: 404 }); }
} } };

test('the shipped public catalog is complete JSON with unique company identities', () => {
  assert.equal(catalog.schemaVersion, 1);
  assert.ok(catalog.companies.length > 10000);
  assert.equal(new Set(catalog.companies.map(company => company.ticker)).size, catalog.companies.length);
  for (const ticker of ['AAPL', 'IREN', 'XOM']) assert.ok(catalog.companies.some(company => company.ticker === ticker));
});

test('the real shipped research assets remain usable without live provider access', async () => {
  let liveCalls = 0;
  const service = createResearchService({ clock: () => collected + 1000, fetcher: async () => { liveCalls++; throw new Error('Live provider deliberately unavailable'); } });
  const response = await service(new Request('https://bandal.app/finance/api/companies/explore'), environment, 'companies/explore');
  const explorer = await response.json();
  assert.equal(explorer.companies.length, 10);
  for (const company of explorer.companies) {
    assert.ok(Number.isFinite(company.marketCap) && company.marketCap > 0, company.ticker);
    assert.ok(company.sources.marketCap?.url?.startsWith('https://finance.yahoo.com/'), company.ticker);
  }
  const summaries = explorer.companies.map(companySummary);
  assert.equal(summaries.length, 10);
  assert.doesNotThrow(() => renderExplorerCards(summaries));
  assert.match(renderExplorerCards(summaries), /XOM/);
  assert.equal(liveCalls, 0, 'fresh collected assets must not depend on production provider egress');
});

test('the shipped IREN and Apple data retain correction, N/M citations and reviewed outlooks', async () => {
  const service = createResearchService({ clock: () => collected + 1000, fetcher: async () => { throw new Error('No live provider'); } });
  for (const [query, ticker] of [['IREN', 'IREN'], ['APPL', 'AAPL']]) {
    const response = await service(new Request('https://bandal.app/finance/api/companies/' + query), environment, 'companies/' + query);
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.company.ticker, ticker);
    assert.equal(data.quote.status, 'available');
    assert.ok(data.company.descriptionSource?.url);
    assert.ok(data.outlook?.summary?.length);
    assert.ok(data.outlook.sources.length);
    for (const metric of data.metrics.filter(metric => metric.status === 'not-meaningful')) assert.ok(metric.source?.url, metric.key);
    if (query === 'APPL') assert.match(data.correction, /APPL.*AAPL/);
  }
});
