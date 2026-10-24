import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {combineAnalystResearch,createAnalystService,loadAnalystResearch,parseStockAnalysisRatingsHtml,parseYahooAnalystHtml,validateAnalystResearch} from '../../hosting/finance/analysts.mjs';

const at='2026-10-24T04:45:00.000Z',now=Date.parse(at),raw=value=>({raw:value});
function modules(ticker='IREN') {return {price:{symbol:ticker,quoteType:'EQUITY',currency:'USD'},financialData:{recommendationKey:'buy',recommendationMean:raw(1.55),numberOfAnalystOpinions:raw(18),targetMeanPrice:raw(77.8),targetMedianPrice:raw(80),targetLowPrice:raw(37),targetHighPrice:raw(139),financialCurrency:'USD'},earningsTrend:{defaultMethodology:'nongaap',trend:[{period:'0q',endDate:'2026-09-30',earningsEstimate:{avg:raw(-0.665),low:raw(-0.82),high:raw(-0.51),numberOfAnalysts:raw(2),earningsCurrency:'USD'},revenueEstimate:{avg:raw(221329820),low:raw(200017000),high:raw(244600000),numberOfAnalysts:raw(13),revenueCurrency:'USD'},epsTrend:{current:raw(-0.665),'7daysAgo':raw(-0.51),epsTrendCurrency:'USD'},epsRevisions:{upLast7days:raw(2),downLast30days:raw(1)}}]},recommendationTrend:{trend:[{period:'0m',strongBuy:3,buy:13,hold:4,sell:0,strongSell:0}]},upgradeDowngradeHistory:{history:[{epochGradeDate:1790696356,firm:'B. Riley Securities',toGrade:'Buy',fromGrade:'Buy',action:'main',currentPriceTarget:91,priorPriceTarget:96}]}};}
function page(data=modules(),ticker=data.price.symbol){return '<script>throw Error("must not run")</script>'+`<script type="application/json" data-sveltekit-fetched data-url="https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=earningsTrend&amp;formatted=true">${JSON.stringify({status:200,body:JSON.stringify({quoteSummary:{result:[data],error:null}})})}</script>`;}
function namedPage({ticker='IREN',name='Nick Giles',firm='B. Riley Securities',date='Sep 29, 2026',rating='Buy',target='$96 &#8594 $91'}={}){return `<link rel="canonical" href="https://stockanalysis.com/stocks/${ticker.toLowerCase()}/forecast/"><table class="rating-table compact"><tr><th>Analyst</th></tr><tr><td><div class="analyst-name"><a href="/analysts/nick-giles/">${name}</a></div><div>${firm}</div></td><td>${firm}</td><td>mobile duplicate</td><td>${rating}</td><td>Maintains</td><td>${target}</td><td>+10%</td><td>${date}</td></tr></table><script>eval("private payload not parsed")</script>`;}

test('public analysis parsing keeps next-quarter forecast, GAAP basis, distinct respondent counts and rating distribution',()=>{
  const value=parseYahooAnalystHtml(page(),'IREN',at),e=value.estimates[0];
  assert.equal(value.status,'available');assert.equal(e.period,'0q');assert.equal(e.periodEnd,'2026-09-30');assert.equal(e.methodology,'nongaap');assert.equal(e.eps.average,-0.665);assert.equal(e.eps.analystCount,2);assert.equal(e.revenue.analystCount,13);assert.equal(e.epsTrend.days7,-0.51);assert.equal(e.revisions.up7,2);
  assert.deepEqual(value.consensus.distribution.map(r=>[r.rating,r.count]),[['Strong Buy',3],['Buy',13],['Hold',4],['Sell',0],['Strong Sell',0]]);
  assert.equal(value.consensus.analystCount,18);assert.equal(value.ratings[0].analyst,null);assert.equal(value.ratings[0].firm,'B. Riley Securities');assert.equal(value.ratings[0].targetPrice,91);
  assert.match(e.source.basis,/개별 분석가 이름 미제공/);assert.equal(e.source.retrievedAt,at);assert.equal(e.source.url,'https://finance.yahoo.com/quote/IREN/analysis/');
});
test('foreign-currency estimates preserve their reporting currency instead of relabeling USD and unknown currency does not invent values',()=>{
  const m=modules();m.earningsTrend.trend[0].earningsEstimate.earningsCurrency='EUR';m.earningsTrend.trend[0].revenueEstimate.revenueCurrency='EUR';
  let e=parseYahooAnalystHtml(page(m),'IREN',at).estimates[0];assert.equal(e.eps.currency,'EUR');assert.equal(e.revenue.currency,'EUR');
  delete m.financialData.financialCurrency;delete m.earningsTrend.trend[0].earningsEstimate.earningsCurrency;delete m.earningsTrend.trend[0].revenueEstimate.revenueCurrency;
  e=parseYahooAnalystHtml(page(m),'IREN',at).estimates[0];assert.equal(e.eps.average,null);assert.equal(e.revenue.average,null);
});
test('unrelated ticker, restricted wrappers, malformed dates and future actual ratings cannot become observations',()=>{
  assert.throws(()=>parseYahooAnalystHtml(page(modules('AAPL')),'IREN',at));
  assert.throws(()=>parseYahooAnalystHtml(page().replace('"status":200','"status":401'),'IREN',at));
  assert.throws(()=>parseYahooAnalystHtml(page().replace('query1.finance.yahoo.com','evil.example'),'IREN',at));
  const m=modules();m.earningsTrend.trend[0].endDate='2026-02-30';m.upgradeDowngradeHistory.history[0].epochGradeDate=(now+600000)/1000;
  const value=parseYahooAnalystHtml(page(m),'IREN',at);assert.equal(value.estimates.length,0);assert.equal(value.ratings.length,0);
  for(const ticker of ['../SECRET','https://evil.example','AAPL?cookie=1'])assert.throws(()=>parseYahooAnalystHtml(page(),ticker,at));
});
test('visible named analyst rows preserve actual name, firm, grade, date and changed target without using page scripts',()=>{
  const rows=parseStockAnalysisRatingsHtml(namedPage(),'IREN',at);assert.equal(rows.length,1);assert.equal(rows[0].analyst,'Nick Giles');assert.equal(rows[0].firm,'B. Riley Securities');assert.equal(rows[0].targetPrice,91);assert.equal(rows[0].previousTargetPrice,96);assert.equal(rows[0].date,'2026-09-29');
  assert.match(rows[0].source.basis,/개인별 EPS/);assert.equal(parseStockAnalysisRatingsHtml(namedPage({date:'Nov 1, 2026'}),'IREN',at).length,0);
  assert.throws(()=>parseStockAnalysisRatingsHtml(namedPage({ticker:'AAPL'}),'IREN',at),/IDENTITY/);
  assert.equal(parseStockAnalysisRatingsHtml(namedPage({rating:'Outperform'}),'IREN',at)[0].rating,'Outperform');
});
test('named target opinions never acquire anonymous EPS and same-date exact duplicated firm record is replaced',()=>{
  const base=parseYahooAnalystHtml(page(),'IREN',at),named=parseStockAnalysisRatingsHtml(namedPage(),'IREN',at),value=combineAnalystResearch(base,named);
  assert.equal(value.ratings.length,1);assert.equal(value.ratings[0].analyst,'Nick Giles');assert.equal(value.ratings[0].eps,undefined);assert.equal(value.estimates[0].analyst,undefined);assert.equal(value.coverage.namedAnalystCount,1);assert.equal(value.coverage.namedAnalysts,'partial');
  validateAnalystResearch(value,'IREN',now);
});
test('on-demand service uses fixed public hosts, no credentials, bounded reads and coalesced cached copies',async()=>{
  const seen=[];const get=createAnalystService({clock:()=>now,fetcher:async(url,init)=>{seen.push(url);assert.equal(init.redirect,'error');assert.equal(new Headers(init.headers).get('cookie'),null);assert.equal(new Headers(init.headers).get('authorization'),null);return new Response(url.includes('stockanalysis')?namedPage():page());}});
  const [a,b]=await Promise.all([get('IREN'),get('IREN')]);assert.equal(seen.length,2);assert.equal(a.ratings[0].analyst,b.ratings[0].analyst);a.ratings[0].analyst='changed';assert.equal((await get('IREN')).ratings[0].analyst,'Nick Giles');assert.equal(seen.length,2);await assert.rejects(get('../SECRET'));
});
test('restricted/oversized public responses are explicit unavailable coverage without authentication retries',async()=>{
  let calls=0;const get=createAnalystService({clock:()=>now,fetcher:async()=>{calls++;return new Response('restricted',{status:401});}});const value=await get('IREN');assert.equal(calls,2);assert.equal(value.status,'unavailable');assert.equal(value.ratings.length,0);assert.equal(value.estimates.length,0);assert.equal(value.coverage.fetchFailures.length,2);
  const big=createAnalystService({clock:()=>now,fetcher:async()=>new Response('x',{headers:{'Content-Length':String(4*1024*1024)}})});assert.equal((await big('IREN')).status,'unavailable');
});
test('bundled public pack reader drops visitor credentials/query, validates ticker provenance, and labels stale data',async()=>{
  const pack=combineAnalystResearch(parseYahooAnalystHtml(page(),'IREN',at),parseStockAnalysisRatingsHtml(namedPage(),'IREN',at));let seen;
  const env={ASSETS:{fetch:async req=>{seen=req;return Response.json(pack);}}};
  const value=await loadAnalystResearch(new Request('https://bandal.app/finance/api/companies/IREN?secret=private',{headers:{Authorization:'Bearer private',Cookie:'secret'}}),env,'IREN',{clock:()=>now+2*86400000});
  assert.equal(seen.url,'https://bandal.app/finance/analysts/IREN.json');assert.equal(seen.headers.get('authorization'),null);assert.equal(seen.headers.get('cookie'),null);assert.equal(value.stale,true);
  const forged=structuredClone(pack);forged.sources[0].url='https://finance.yahoo.com/quote/AAPL/analysis/';assert.throws(()=>validateAnalystResearch(forged,'IREN',now),/SOURCE/);
  assert.equal(await loadAnalystResearch(new Request('https://bandal.app/'),{ASSETS:{fetch:async()=>Response.json(forged)}},'IREN',{clock:()=>now}),null);
});
test('actual shipped IREN/Apple/Microsoft public collection is valid and includes named ratings plus four sourced consensus periods',async()=>{
  for(const ticker of ['IREN','AAPL','MSFT']){const pack=JSON.parse(await readFile(new URL(`../../assetdist/finance/analysts/${ticker}.json`,import.meta.url),'utf8'));validateAnalystResearch(pack,ticker,now);assert.equal(pack.estimates.length,4);assert(pack.ratings.some(r=>r.analyst));assert(pack.ratings.every(r=>r.source.url));assert.equal(pack.estimates[0].period,'0q');assert(pack.estimates[0].eps.average!==null);assert(pack.estimates[0].revenue.average>0);}
});
