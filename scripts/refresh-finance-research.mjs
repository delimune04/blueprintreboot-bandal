import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createResearchService } from '../hosting/finance/research.mjs';

// Normal, declared SEC API ingestion. This script does not publish, schedule,
// access private accounts, bypass access controls or use alternate data mirrors.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'assetdist/finance/snapshots');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--tickers')) throw new Error('Usage: node scripts/refresh-finance-research.mjs [--tickers NVDA,MSFT,AAPL]');
const tickers = [...new Set((args[1] || 'NVDA,MSFT,AAPL,IREN,GOOGL,META,AMZN,TSLA,XOM,CVX').split(',').map(value => value.trim().toUpperCase()))];
if (!tickers.length || tickers.length > 30 || tickers.some(ticker => !/^[A-Z0-9.-]{1,12}$/.test(ticker))) throw new Error('Provide 1–30 valid SEC tickers.');
const userAgent = process.env.SEC_USER_AGENT || 'BANDAL Finance support@bandal.app';
if (!userAgent.includes('@') || /[\r\n]/.test(userAgent)) throw new Error('SEC_USER_AGENT must identify the operator and contact email.');
const env = { SEC_USER_AGENT: userAgent }; // Public Yahoo page observations may be collected; no paid provider key is used.
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function save(name, object, maxBytes) {
  const content = JSON.stringify(object) + '\n';
  if (Buffer.byteLength(content) > maxBytes) throw new Error('Normalized snapshot exceeds the bounded output size.');
  await mkdir(output, { recursive: true });
  const path = resolve(output, name), temporary = path + '.tmp';
  await writeFile(temporary, content, { mode: 0o644 });
  await rename(temporary, path);
}
async function catalog() {
  const url = 'https://www.sec.gov/files/company_tickers.json';
  const response = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(12000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error('SEC catalog response ' + response.status); }
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 3 * 1024 * 1024) { await reader.cancel(); throw new Error('SEC catalog exceeds 3 MiB.'); } chunks.push(value); }
  const raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const companies = Object.values(raw).filter(row => typeof row?.ticker === 'string' && /^[A-Z0-9.-]{1,12}$/.test(row.ticker) && typeof row.title === 'string' && row.title.length <= 300 && Number.isInteger(row.cik_str) && row.cik_str > 0 && row.cik_str < 1e10).map(row => ({ ticker: row.ticker, name: row.title, cik: String(row.cik_str) }));
  if (companies.length < 100) throw new Error('SEC catalog unexpectedly small; retained existing snapshot.');
  const collectedAt = new Date().toISOString();
  await save('catalog.json', { schemaVersion: 1, collectedAt, source: { provider: 'SEC EDGAR', url, retrievedAt: collectedAt }, companies }, 3 * 1024 * 1024);
  console.log(JSON.stringify({ file: 'catalog.json', companies: companies.length, collectedAt }));
}

let failed = false;
try { await catalog(); } catch (error) { failed = true; console.error('Catalog refresh failed: ' + error.message); }
const handle = createResearchService();
for (const ticker of tickers) {
  await pause(400); // Sequential issuers, at most two paced SEC reads per issuer.
  try {
    const response = await handle(new Request('https://bandal.app/finance/api/companies/' + ticker), env, 'companies/' + ticker);
    const payload = await response.json();
    const annual=payload.status==='available'&&payload.period?.sourceUrl&&payload.sources?.some(source=>source.provider==='SEC companyfacts'&&source.status==='available');
    const publicOnly=payload.status==='partial'&&payload.period===null&&payload.quote?.status==='available'&&payload.sources?.some(source=>source.provider==='Yahoo Finance'&&source.status==='available');
    if(!response.ok||!annual&&!publicOnly)throw new Error('No verified annual SEC or public quote facts; retained previous snapshot.');
    const collectedAt = new Date().toISOString();
    payload.asOf = collectedAt;
    await save(ticker + '.json', { schemaVersion: 1, collectedAt, source: annual?'SEC EDGAR + public Yahoo Finance observations':'Yahoo Finance public observations; annual SEC facts unavailable', payload }, 256 * 1024);
    console.log(JSON.stringify({ ticker, status: payload.status, periodEnd: payload.period?.end||null, collectedAt, reports: payload.reports.length, flow: payload.flow.status, market: payload.quote?.provider, quoteAt: payload.quote?.marketTime }));
  } catch (error) { failed = true; console.error(ticker + ' refresh failed: ' + error.message); }
}
if (failed) process.exitCode = 1;
