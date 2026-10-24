import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCompanyOutlook } from '../hosting/finance/outlook.mjs';

// A refresh must be a reviewed source update, not a fresh timestamp on old text.
// No model/API key is required, no trading/account data is read, and source
// verification never follows redirects or tries alternate hosts after denial.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, 'assetdist/finance/outlooks');
const args = process.argv.slice(2);
const tickers = ['AAPL', 'IREN'];
let files = tickers.map(ticker => resolve(directory, ticker + '.json'));
const apply = args.length === 2 && args[0] === '--from';
const verify = args.length === 1 && args[0] === '--verify-sources';
if (args.length && !apply && !verify) throw new Error('Usage: node scripts/refresh-finance-outlooks.mjs [--from reviewed.json | --verify-sources]');
if (apply) files = [resolve(args[1])];
for (const file of files) {
  const body = await readFile(file, 'utf8');
  if (Buffer.byteLength(body) > 120000) throw new Error('Outlook exceeds the bounded snapshot size.');
  const data = JSON.parse(body), ticker = data.ticker;
  if (!tickers.includes(ticker)) throw new Error('Only reviewed AAPL and IREN outlook packs are supported.');
  validateCompanyOutlook(data, ticker);
  if (apply) {
    await mkdir(directory, { recursive: true });
    const output = resolve(directory, ticker + '.json'), temporary = output + '.reviewed.tmp';
    await writeFile(temporary, JSON.stringify(data, null, 2) + '\n');
    await rename(temporary, output);
  }
  const checks = [];
  if (verify) for (const source of data.sources) {
    let status = 'unavailable', http = null;
    try {
      const response = await fetch(source.url, { redirect: 'error', signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'BANDAL Finance support@bandal.app', Accept: 'text/html,application/pdf' } });
      http = response.status;
      status = response.ok ? 'reachable' : 'unavailable';
      await response.body?.cancel();
    } catch { /* Keep the reviewed source and date; report the verification gap. */ }
    checks.push({ id: source.id, http, status });
  }
  console.log(JSON.stringify({ ticker, file: basename(file), asOf: data.asOf, statements: data.summary.length, sources: data.sources.length, reviewedImport: apply, ...(verify ? { checks, note: 'Reachability does not verify claim accuracy and never advances asOf.' } : {}) }));
}
