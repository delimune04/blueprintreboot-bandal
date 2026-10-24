import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDebtService, validateDebtPack } from '../hosting/finance/debt.mjs';

// Public-source ingestion only. Does not publish or silently redate a reviewed
// summary. Existing reviewed packs require explicit --from to replace them.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'assetdist/finance/debt');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || !['--tickers', '--from'].includes(args[0]))) throw new Error('Usage: node scripts/refresh-finance-debt.mjs [--tickers AAPL,MSFT | --from reviewed-pack.json]');
await mkdir(output, { recursive: true });
async function save(pack) {
  validateDebtPack(pack, pack.ticker, pack.cik);
  const text = JSON.stringify(pack) + '\n';
  if (Buffer.byteLength(text) > 220000) throw new Error('Normalized debt pack exceeds 220 KB.');
  const path = resolve(output, pack.ticker + '.json');
  await writeFile(path + '.tmp', text); await rename(path + '.tmp', path);
  console.log(JSON.stringify({ ticker: pack.ticker, asOf: pack.asOf, instruments: pack.instruments.length, mode: pack.coverage.mode, file: path }));
}
if (args[0] === '--from') {
  await save(JSON.parse(await readFile(resolve(args[1]), 'utf8')));
} else if (!args.length) {
  // Validation leaves both dates and data unchanged.
  const { readdir } = await import('node:fs/promises');
  for (const file of (await readdir(output)).filter(name => /^[A-Z0-9.-]+\.json$/.test(name))) {
    const pack = JSON.parse(await readFile(resolve(output, file), 'utf8'));
    validateDebtPack(pack, pack.ticker, pack.cik);
    console.log(JSON.stringify({ ticker: pack.ticker, status: 'validated-without-redating', asOf: pack.asOf }));
  }
} else {
  const tickers = [...new Set(args[1].split(',').map(value => value.trim().toUpperCase()))];
  if (!tickers.length || tickers.length > 30 || tickers.some(t => !/^[A-Z0-9.-]{1,12}$/.test(t))) throw new Error('Provide 1–30 valid SEC tickers.');
  const userAgent = process.env.SEC_USER_AGENT || 'BANDAL Finance support@bandal.app';
  if (!userAgent.includes('@') || /[\r\n]/.test(userAgent)) throw new Error('SEC_USER_AGENT must identify operator and contact email.');
  const service = createDebtService();
  const catalog = JSON.parse(await readFile(resolve(root, 'assetdist/finance/snapshots/catalog.json'), 'utf8'));
  for (const ticker of tickers) {
    try {
      const existing = await readFile(resolve(output, ticker + '.json'), 'utf8').then(JSON.parse).catch(() => null);
      if (existing?.coverage?.mode?.startsWith('reviewed-')) { validateDebtPack(existing, ticker, existing.cik); console.log(JSON.stringify({ ticker, status: 'reviewed-pack-retained', asOf: existing.asOf })); continue; }
      const company = catalog.companies.find(c => c.ticker === ticker);
      if (!company) throw new Error('SEC ticker identity unavailable.');
      const cik = String(company.cik).padStart(10, '0');
      const readJSON = async url => {
        const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': userAgent }, redirect: 'error', signal: AbortSignal.timeout(12000) });
        if (!response.ok) { await response.body?.cancel(); throw new Error('SEC source HTTP ' + response.status); }
        const reader = response.body.getReader(), chunks = []; let size = 0;
        while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 12 * 1024 * 1024) { await reader.cancel(); throw new Error('SEC JSON too large.'); } chunks.push(value); }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      };
      const facts = await readJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
      await new Promise(resolve => setTimeout(resolve, 250));
      const submissions = await readJSON(`https://data.sec.gov/submissions/CIK${cik}.json`);
      if (Number(submissions.cik) !== Number(cik)) throw new Error('SEC submissions identity mismatch.');
      const f = submissions.filings?.recent || {}, reports = [];
      for (let i = 0; i < Math.min(f.form?.length || 0, 1000); i++) if (['10-K', '10-Q', '20-F', '40-F'].includes(f.form[i]) && /^\d{10}-\d{2}-\d{6}$/.test(f.accessionNumber?.[i] || '') && /^[A-Za-z0-9_.-]{1,150}\.html?$/.test(f.primaryDocument?.[i] || '')) reports.push({ type: f.form[i], date: f.filingDate[i], periodEnd: f.reportDate[i], url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accessionNumber[i].replaceAll('-', '')}/${f.primaryDocument[i]}` });
      const result = await service.get(ticker, { cik, reports, facts, userAgent });
      if (!result || result.status === 'unavailable' || !result.sources.length) throw new Error('No verified debt facts; existing pack retained.');
      await save({ version: 1, ...result, ticker, cik: String(Number(cik)) });
    } catch (error) { console.error(ticker + ' debt refresh failed: ' + error.message); process.exitCode = 1; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
