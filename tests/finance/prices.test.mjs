import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPriceService,parsePriceHistory} from '../../hosting/finance/prices.mjs';

const collected='2026-10-24T04:20:00.000Z';
function fixture(ticker='AAPL'){
  return {chart:{error:null,result:[{meta:{symbol:ticker,currency:'USD',instrumentType:'EQUITY',regularMarketPrice:25,regularMarketTime:1792785600,chartPreviousClose:5,exchangeTimezoneName:'America/New_York',fullExchangeName:'NasdaqGS',exchangeDataDelayedBy:15},timestamp:[1792526400,1792612800,1792699200,1792785600],indicators:{quote:[{close:[24,null,24.5,25],volume:[100,200,300,400]}],adjclose:[{adjclose:[23.5,null,24,24.75]}]},events:{splits:{'1792526400':{date:1792526400,numerator:2,denominator:1}}}}]}};
}
test('daily chart reads real close, adjusted close, exchange dates, split records and provenance',()=>{
  const found=parsePriceHistory(fixture(),'AAPL',collected);
  assert.equal(found.status,'available');assert.equal(found.points.length,3);assert.equal(found.points[0].close,24);assert.equal(found.points[0].adjustedClose,23.5);assert.equal(found.points[0].date,'2026-10-20');assert.equal(found.points.at(-1).date,'2026-10-23');
  assert.equal(found.quote.price,25);assert.equal(found.quote.marketTime,'2026-10-23T20:00:00.000Z');assert.equal(found.quote.change,null,'range-start price is not yesterday close');
  assert.equal(found.source.url,'https://finance.yahoo.com/quote/AAPL/history/');assert.equal(found.source.retrievedAt,collected);assert.equal(found.splits[0].numerator,2);assert.equal(found.splits[0].date,'2026-10-20');
});
test('history rejects another ticker, unsupported security, malformed currency, future quote and unbounded series',()=>{
  assert.throws(()=>parsePriceHistory(fixture('MSFT'),'AAPL',collected),/IDENTITY/);
  for(const [key,value] of [['currency','???'],['instrumentType','CRYPTOCURRENCY'],['regularMarketTime',1792899999]]){const p=fixture();p.chart.result[0].meta[key]=value;assert.throws(()=>parsePriceHistory(p,'AAPL',collected));}
  const huge=fixture();huge.chart.result[0].timestamp=Array(1601).fill(1792785600);huge.chart.result[0].indicators.quote[0].close=Array(1601).fill(25);assert.throws(()=>parsePriceHistory(huge,'AAPL',collected),/SERIES/);
  const malformed=fixture();malformed.chart.result[0].indicators.quote[0].close=[];assert.throws(()=>parsePriceHistory(malformed,'AAPL',collected),/SERIES/);
});
test('non-dollar stock prices keep their actual currency and regular daily changes use previous close only',()=>{
  const p=fixture('7203.T');Object.assign(p.chart.result[0].meta,{currency:'JPY',previousClose:20,exchangeTimezoneName:'Asia/Tokyo'});
  const found=parsePriceHistory(p,'7203.T',collected);assert.equal(found.currency,'JPY');assert.equal(found.source.unit,'JPY');assert.equal(found.quote.change,5);assert.equal(found.quote.changePercent,25);
});
test('future or missing candles and duplicate dates are gaps, never invented zero prices',()=>{
  const p=fixture();p.chart.result[0].timestamp=[1792785600,1792785601,1792899999,1792526400];p.chart.result[0].indicators.quote[0].close=[25,26,27,-1];
  const found=parsePriceHistory(p,'AAPL',collected);assert.deepEqual(found.points.map(x=>x.close),[25]);
});
test('stock service uses only fixed public chart destination and caches/coalesces requests',async()=>{
  let calls=0;const get=createPriceService({clock:()=>Date.parse(collected),fetcher:async(url,init)=>{calls++;assert.equal(url,'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=5y&includePrePost=false&events=div%2Csplits');assert.equal(init.redirect,'error');assert.equal(new Headers(init.headers).get('cookie'),null);return Response.json(fixture());}});
  const [a,b]=await Promise.all([get('AAPL'),get.get('AAPL')]);assert.equal(a.points.length,b.points.length);await get('AAPL');assert.equal(calls,1);await assert.rejects(get('https://evil.example'),/TICKER/);
});
test('network failure, malformed and oversized source data are explicit unavailable states',async()=>{
  for(const response of [()=>new Response('forbidden',{status:403}),()=>new Response('{}'),()=>new Response('x',{headers:{'Content-Length':String(769*1024)}})]){
    const found=await createPriceService({clock:()=>Date.parse(collected),fetcher:async()=>response()})('AAPL');assert.equal(found.status,'unavailable');assert.deepEqual(found.points,[]);assert.equal(found.quote,null);
  }
});
