import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createResearchService} from '../../hosting/finance/research.mjs';
import {readPublicCache,writePublicCache} from '../../hosting/finance/public-cache.mjs';
import {renderCompany,renderMetrics} from '../../assetdist/finance/explorer.mjs';

const assetRoot=new URL('../../assetdist/',import.meta.url);
async function readJson(path){return JSON.parse(await readFile(new URL(path,assetRoot),'utf8'));}
const index=await readJson('finance/snapshots/index.json');
const records=await Promise.all(index.companies.map(row=>readJson(`finance/snapshots/${row.ticker}.json`)));
const clock=()=>Math.max(Date.parse(index.collectedAt),...records.map(record=>Date.parse(record.collectedAt)))+1000;
const assetRequests=[];
const env={ASSETS:{async fetch(request){
  const path=new URL(request.url).pathname;assetRequests.push({path,headers:[...request.headers],search:new URL(request.url).search});
  if(!/^\/finance\/(?:snapshots|outlooks|analysts|debt)\/[A-Za-z0-9.-]+\.json$/.test(path)&&!/^\/finance\/logos\/[A-Za-z0-9._-]+$/.test(path))return new Response(null,{status:404});
  try{return new Response(await readFile(new URL(path.slice(1),assetRoot)),{headers:{'Content-Type':path.endsWith('.json')?'application/json':path.endsWith('.png')?'image/png':'image/svg+xml'}});}catch{return new Response(null,{status:404});}
}}};

test('published public index drives an offline atlas without assuming a fixed company count',async()=>{
  let liveCalls=0;const service=createResearchService({clock,fetcher:async()=>{liveCalls++;throw Error('Network disabled in shipped-asset verification');}});
  const response=await service(new Request('https://bandal.app/finance/api/companies/explore'),env,'companies/explore'),atlas=await response.json();
  assert.equal(response.status,200);assert.equal(atlas.companies.length,index.companies.length);assert.ok(atlas.companies.length>=10);assert.equal(new Set(atlas.companies.map(c=>c.ticker)).size,atlas.companies.length);assert.equal(liveCalls,0);
});

test('IREN, Apple and another company retain price, real logo, four-quarter evidence and actual analyst content across API and UI',async()=>{
  let liveCalls=0;const service=createResearchService({clock,fetcher:async()=>{liveCalls++;throw Error('Network disabled');}});
  for(const ticker of ['IREN','AAPL','MSFT']){
    const request=new Request(`https://bandal.app/finance/api/companies/${ticker}?untrusted=private`,{headers:{Cookie:'private-session','X-Finance-Account':'private-owner'}});
    const response=await service(request,env,'companies/'+ticker),data=await response.json();
    assert.equal(response.status,200,ticker);assert.equal(data.company.ticker,ticker);assert.ok(data.quote.price>0,ticker+' price');assert.ok(data.quote.marketTime,ticker+' price timestamp');
    assert.ok(data.company.logo?.url?.startsWith('/finance/'),ticker+' real logo route');
    const logoResponse=await service(new Request(`https://bandal.app/finance/api/companies/${ticker}/logo`),env,`companies/${ticker}/logo`);assert.equal(logoResponse.status,200,ticker+' published logo');assert.ok((await logoResponse.arrayBuffer()).byteLength>100,ticker+' logo bytes');
    assert.ok(data.priceHistory?.points?.length>200,ticker+' genuine daily history');assert.ok(data.priceHistory.source?.url,ticker+' price source');
    assert.ok(data.history?.quarters?.length>=4,ticker+' quarterly history');
    const series=data.history.metricSeries||data.history.metrics||{};
    const historical=Object.values(series).filter(rows=>Array.isArray(rows)&&rows.slice(-4).filter(p=>Number.isFinite(p.value)&&p.source).length>=3);
    assert.ok(historical.length>=3,ticker+' sourced historical metrics');
    assert.ok(data.analystResearch?.ratings?.some(row=>row.analyst&&row.firm&&row.source?.url),ticker+' actual named analysts');
    assert.ok(data.analystResearch.estimates.some(row=>row.eps?.average!==null&&row.revenue?.average>0&&row.source?.url),ticker+' extracted consensus');
    assert.ok(data.debt?.sources?.length,ticker+' debt documents');assert.ok(data.debt.coverage,ticker+' debt review scope');
    const html=renderCompany(data);assert.match(html,/company-logo/);assert.match(html,/price-history-chart/);assert.match(html,/metric-info/);assert.match(html,/metric-history/);assert.match(html,/analyst-ratings/);assert.match(html,/부채와 전환사채/);assert.doesNotMatch(html,/\[object Object\]|NaN|Infinity/);
    const form=/<form id="dcf-form">([\s\S]*?)<\/form>/.exec(html)?.[1];assert.ok(form,ticker+' DCF form');
    for(const name of ['freeCashFlow','shares']){const input=new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(form)?.[0];assert.ok(input,ticker+' '+name);assert.match(input,/readonly/);}
    const inputs=[...form.matchAll(/<input\b[^>]*>/g)].map(m=>m[0]);assert.equal(inputs.filter(input=>!input.includes('readonly')).length,4,ticker+' only four editable assumptions');
    const named=data.analystResearch.ratings.find(row=>row.analyst);assert.ok(html.includes(named.analyst),ticker+' rendered analyst name');
    const metricHtml=renderMetrics(data.metrics,data);assert.doesNotMatch(metricHtml,/<p class="(?:metric-description|metric-explanation)"/);assert.match(metricHtml,/<details class="metric-info">/);
  }
  assert.equal(liveCalls,0,'fresh shipped research must not require provider access');
  assert.ok(assetRequests.every(row=>!row.search&&!row.headers.some(([name])=>['cookie','authorization','x-finance-account','oai-authenticated-user-id'].includes(name))),'asset enrichment must not forward private visitor identity');
});

test('public cache cannot store or expose account-bearing fields at any depth',async()=>{
  const publicPayload={status:'partial',company:{ticker:'AMD',cik:'2488'},sources:[{provider:'Yahoo Finance',status:'available'}]};let writes=0;
  const forbidden=[{...publicPayload,credentials:{apiKey:'private'}},{...publicPayload,company:{...publicPayload.company,session:{token:'private'}}},{...publicPayload,quote:{ownerKey:'private'}},{...publicPayload,reports:[{title:'public',connections:[{secret:'private'}]}]}];
  for(const payload of forbidden){
    assert.equal(await writePublicCache({LABVIUM_PDFS:{put:async()=>{writes++;}}},'AMD',payload,{clock}),false,'private fields must be rejected on write');
    const serialized=JSON.stringify({schemaVersion:1,collectedAt:new Date(clock()).toISOString(),payload});
    assert.equal(await readPublicCache({LABVIUM_PDFS:{get:async()=>({size:serialized.length,text:async()=>serialized})}},'AMD',{clock}),null,'private fields must be rejected on read');
  }
  assert.equal(writes,0);
});
