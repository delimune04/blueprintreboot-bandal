import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Ordinary, declared public-source ingestion. No private account access,
// authentication workaround, publishing, or automatic scheduling occurs here.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'assetdist/finance/snapshots');
const DEFAULT_TICKERS = 'NVDA,MSFT,AAPL,IREN,GOOGL,META,AMZN,TSLA,XOM,CVX';
const VALID_TICKER = /^[A-Z0-9.-]{1,12}$/;
const SNAPSHOT_LIMIT = 768 * 1024;
const USAGE = 'Usage: node scripts/refresh-finance-research.mjs [--tickers NVDA,MSFT,AAPL | --all --offset 0 --limit 25]';

export function parseCollectorOptions(args = []) {
  const options = { tickers: null, all: false, offset: 0, limit: 25, help: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (seen.has(key)) throw new Error('Repeated option: ' + key);
    seen.add(key);
    if (key === '--all') options.all = true;
    else if (key === '--help') options.help = true;
    else if (['--tickers', '--offset', '--limit'].includes(key)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(USAGE);
      if (key === '--tickers') options.tickers = [...new Set(value.split(',').map(item => item.trim().toUpperCase()))];
      else {
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Batch offset and limit must be non-negative integers.');
        options[key.slice(2)] = Number(value);
      }
    } else throw new Error(USAGE);
  }
  if (options.help) return options;
  if (options.all && options.tickers || !options.all && (seen.has('--offset') || seen.has('--limit'))) throw new Error(USAGE);
  if (!options.all) options.tickers ||= DEFAULT_TICKERS.split(',');
  if (options.tickers && (!options.tickers.length || options.tickers.length > 100 || options.tickers.some(ticker => !VALID_TICKER.test(ticker)))) throw new Error('Provide 1–100 valid SEC tickers.');
  if (options.limit < 1 || options.limit > 100) throw new Error('A catalog batch must contain 1–100 issuers.');
  return options;
}

export function snapshotIndexEntry(record, filename) {
  const p = record?.payload, ticker = filename.replace(/\.json$/, '');
  if (!/^[A-Z0-9.-]{1,12}\.json$/.test(filename) || record?.schemaVersion !== 1 || typeof record.collectedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.collectedAt) || !Number.isFinite(Date.parse(record.collectedAt)) || new Date(record.collectedAt).toISOString() !== record.collectedAt || p?.company?.ticker !== ticker || !['available', 'partial'].includes(p.status) || typeof p.company.name !== 'string' || p.company.name.length > 300 || !/^\d{1,10}$/.test(String(p.company.cik)) || Number(p.company.cik) <= 0) return null;
  const annual = p.status === 'available' && p.period?.sourceUrl && p.sources?.some(source => source?.provider === 'SEC companyfacts' && source.status === 'available');
  const market = p.quote?.status === 'available' && p.quote?.ticker === ticker && p.quote.provider === 'Yahoo Finance' && p.sources?.some(source => source?.provider === 'Yahoo Finance' && source.status === 'available');
  if (!annual && !market) return null;
  return { ticker, name: p.company.name, cik: String(p.company.cik), currency: p.company.currency || 'USD', collectedAt: record.collectedAt, status: p.status, sector: p.quote?.profile?.sector || p.company.sector || null, industry: p.quote?.profile?.industry || p.company.industry || null, periodEnd: p.period?.end || null };
}

async function save(name, object, maxBytes, directory = output) {
  const content = JSON.stringify(object) + '\n';
  if (Buffer.byteLength(content) > maxBytes) throw new Error('Normalized snapshot exceeds the bounded output size.');
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, name), temporary = path + '.tmp';
  await writeFile(temporary, content, { mode: 0o644 });
  await rename(temporary, path);
}

async function readSnapshot(filename) {
  try { return JSON.parse(await readFile(resolve(output, filename), 'utf8')); } catch { return null; }
}

async function collectCatalog(userAgent) {
  const url = 'https://www.sec.gov/files/company_tickers.json';
  const response = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(12000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error('SEC catalog response ' + response.status); }
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 3 * 1024 * 1024) { await reader.cancel(); throw new Error('SEC catalog exceeds 3 MiB.'); } chunks.push(value); }
  const raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const companies = Object.values(raw).filter(row => typeof row?.ticker === 'string' && VALID_TICKER.test(row.ticker) && typeof row.title === 'string' && row.title.length <= 300 && Number.isInteger(row.cik_str) && row.cik_str > 0 && row.cik_str < 1e10).map(row => ({ ticker: row.ticker, name: row.title, cik: String(row.cik_str) }));
  if (companies.length < 100) throw new Error('SEC catalog unexpectedly small; retained existing snapshot.');
  const collectedAt = new Date().toISOString();
  await save('catalog.json', { schemaVersion: 1, collectedAt, source: { provider: 'SEC EDGAR', url, retrievedAt: collectedAt }, companies }, 3 * 1024 * 1024);
  console.log(JSON.stringify({ file: 'catalog.json', companies: companies.length, collectedAt }));
  return companies;
}

export function compactResearchPayload(payload) {
  // The runtime deterministically reconstructs these derived views from the
  // preserved raw normalized quarter records, annual evidence and quote facts.
  // Avoid serializing each nested evidence object in four parallel views.
  delete payload.history;
  delete payload.metrics;
  delete payload.fieldSources;
  if (payload.quarterlyHistory) delete payload.quarterlyHistory.metricSeries;
  return payload;
}

export async function rebuildSnapshotIndex() {
  await mkdir(output, { recursive: true });
  const entries = [];
  for (const filename of (await readdir(output)).sort()) {
    if (!/^[A-Z0-9.-]{1,12}\.json$/.test(filename)) continue;
    const item = snapshotIndexEntry(await readSnapshot(filename), filename);
    if (item) entries.push(item);
  }
  const collectedAt = new Date().toISOString();
  await save('index.json', { schemaVersion: 1, collectedAt, scope: 'collected-only', source: { provider: 'BANDAL verified public-source snapshots', basis: 'Existing verified snapshot files only; not the complete SEC directory' }, companies: entries, count: entries.length }, 256 * 1024);
  return entries;
}

export async function runCollector(args = process.argv.slice(2)) {
  const options = parseCollectorOptions(args);
  if (options.help) { console.log(USAGE); return; }
  const userAgent = process.env.SEC_USER_AGENT || 'BANDAL Finance support@bandal.app';
  if (!userAgent.includes('@') || /[\r\n]/.test(userAgent)) throw new Error('SEC_USER_AGENT must identify the operator and contact email.');
  let failed = false, companies;
  try { companies = await collectCatalog(userAgent); }
  catch (error) {
    failed = true;
    console.error('Catalog refresh failed: ' + error.message);
    companies = (await readSnapshot('catalog.json'))?.companies;
    if (!Array.isArray(companies)) throw new Error('No usable SEC catalog.');
  }
  const ordered = [...new Set(companies.map(company => company.ticker).filter(ticker => VALID_TICKER.test(ticker)))].sort();
  const tickers = options.all ? ordered.slice(options.offset, options.offset + options.limit) : options.tickers;
  if (!tickers.length) throw new Error('No companies in the selected catalog batch.');
  const env = { SEC_USER_AGENT: userAgent, ASSETS: { async fetch(request) {
    const pathname = new URL(request.url).pathname;
    // Read reviewed supplemental research only. Collected company snapshots
    // deliberately stay inaccessible here so every refresh attempts new facts.
    if (!/^\/finance\/(?:debt|analysts)\/[A-Z0-9.-]{1,12}\.json$/.test(pathname)) return new Response('Not found', { status: 404 });
    try { return new Response(await readFile(resolve(root, 'assetdist' + pathname)), { headers: { 'Content-Type': 'application/json' } }); }
    catch { return new Response('Not found', { status: 404 }); }
  } } };
  const { createResearchService } = await import('../hosting/finance/research.mjs');
  const { fetchPublicCompanyLogo } = await import('../hosting/finance/public-data.mjs');
  const handle = createResearchService();
  const results = [];
  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    await new Promise(resolve => setTimeout(resolve, 400));
    try {
      const response = await handle(new Request('https://bandal.app/finance/api/companies/' + ticker), env, 'companies/' + ticker);
      const payload = await response.json();
      const collectedAt = new Date().toISOString();
      const record = { schemaVersion: 1, collectedAt, source: payload.period ? 'SEC EDGAR + public Yahoo Finance observations' : 'Yahoo Finance public observations; annual SEC facts unavailable', payload };
      if (!response.ok || !snapshotIndexEntry(record, ticker + '.json')) throw new Error('No verified annual SEC or public quote facts; retained previous snapshot.');
      const previous = await readSnapshot(ticker + '.json');
      if (previous?.payload?.status === 'available' && payload.status !== 'available') throw new Error('Annual facts unavailable in new response; retained the more complete previous snapshot.');
      const logo = payload.quote?.logo || payload.company?.logo;
      if (logo?.url) {
        try {
          const image = await fetchPublicCompanyLogo(logo);
          const directory = resolve(root, 'assetdist/finance/logos');
          await mkdir(directory, { recursive: true });
          const filename = ticker + '.' + image.extension;
          const path = resolve(directory, filename), temporary = path + '.tmp';
          await writeFile(temporary, image.bytes, { mode: 0o644 });
          await rename(temporary, path);
          payload.company.logo = { url: '/finance/logos/' + filename, source: logo.source, originalUrl: image.sourceUrl, collectedAt };
        } catch (error) {
          // A failed image fetch must not discard independently verified facts.
          console.error(ticker + ' logo unavailable: ' + error.message);
        }
      }
      payload.asOf = collectedAt;
      const beforeBytes = Buffer.byteLength(JSON.stringify(record));
      compactResearchPayload(payload);
      const afterBytes = Buffer.byteLength(JSON.stringify(record));
      if (afterBytes > SNAPSHOT_LIMIT) console.error(ticker + ' bounded-size fields: ' + JSON.stringify(Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, Buffer.byteLength(JSON.stringify(value))]))));
      await save(ticker + '.json', record, SNAPSHOT_LIMIT);
      const result = { ticker, status: payload.status, periodEnd: payload.period?.end || null, collectedAt, reports: payload.reports?.length || 0, flow: payload.flow?.status, market: payload.quote?.provider, quoteAt: payload.quote?.marketTime, beforeBytes, afterBytes, quarters: payload.quarterlyHistory?.quarters?.length || 0, pricePoints: payload.priceHistory?.points?.length || 0 };
      results.push(result);
      console.log(JSON.stringify(result));
    } catch (error) {
      failed = true;
      results.push({ ticker, status: 'retained', reason: error.message });
      console.error(ticker + ' refresh failed: ' + error.message);
    }
    // Atomic progress file allows an interrupted bounded batch to be reviewed
    // and resumed; it does not discard previously verified company files.
    await save('finance-research-checkpoint.json', { schemaVersion: 1, collectedAt: new Date().toISOString(), mode: options.all ? 'catalog-batch' : 'tickers', offset: options.offset, limit: tickers.length, completed: i + 1, total: tickers.length, nextOffset: options.all ? options.offset + i + 1 : null, results }, 256 * 1024, resolve(root, '.cache'));
  }
  const index = await rebuildSnapshotIndex();
  console.log(JSON.stringify({ file: 'index.json', collectedCompanies: index.length, directoryCompanies: ordered.length, nextOffset: options.all ? options.offset + tickers.length : null, failed }));
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCollector();
