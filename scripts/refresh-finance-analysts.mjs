import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { combineAnalystResearch, createAnalystService, parseStockAnalysisRatingsHtml, parseYahooAnalystHtml, validateAnalystResearch } from '../hosting/finance/analysts.mjs';

// Ordinary public pages only. Existing verified packs survive source failures.
const args=process.argv.slice(2),options={};
while(args.length){const key=args.shift(),value=args.shift();if(!['--tickers','--from-directory'].includes(key)||!value||options[key])throw new Error('Usage: node scripts/refresh-finance-analysts.mjs [--tickers IREN,AAPL,MSFT] [--from-directory /absolute/public-pages]');options[key]=value;}
const tickers=[...new Set((options['--tickers']||'IREN,AAPL,MSFT').split(',').map(t=>t.trim().toUpperCase()))];
if(!tickers.length||tickers.length>30||tickers.some(t=>!/^[A-Z0-9.-]{1,12}$/.test(t)))throw new Error('Provide 1–30 valid tickers.');
const output=resolve(dirname(fileURLToPath(import.meta.url)),'../assetdist/finance/analysts');await mkdir(output,{recursive:true});
const service=createAnalystService();let failed=false;
for(const ticker of tickers){try{
  let value;
  if(options['--from-directory']){
    const collectedAt=new Date().toISOString(),directory=resolve(options['--from-directory']);
    const yahoo=await readFile(resolve(directory,`${ticker}-yahoo.html`),'utf8');
    value=parseYahooAnalystHtml(yahoo,ticker,collectedAt);
    try{value=combineAnalystResearch(value,parseStockAnalysisRatingsHtml(await readFile(resolve(directory,`${ticker}-stockanalysis.html`),'utf8'),ticker,collectedAt));}catch(error){value.coverage.namedSourceFailure=error.message;}
  }else value=await service(ticker);
  validateAnalystResearch(value,ticker);
  if(value.status!=='available')throw new Error('No public analyst observations; retained previous pack.');
  const content=JSON.stringify(value)+'\n';if(Buffer.byteLength(content)>180000)throw new Error('Pack too large; retained previous pack.');
  const path=resolve(output,ticker+'.json');await writeFile(path+'.tmp',content,{mode:0o644});await rename(path+'.tmp',path);
  console.log(JSON.stringify({ticker,collectedAt:value.collectedAt,estimates:value.estimates.length,ratings:value.ratings.length,namedAnalysts:value.ratings.filter(r=>r.analyst).length}));
}catch(error){failed=true;console.error(ticker+': '+error.message);}}
if(failed)process.exitCode=1;
