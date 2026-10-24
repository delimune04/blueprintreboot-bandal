// Only public document content: never credentials, crumbs, cookies or page JS.
const MAX_PAGE = 3 * 1024 * 1024;
const MAX_PACK = 180000;
const validTicker = value => typeof value === 'string' && /^[A-Z0-9.-]{1,12}$/.test(value);
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const raw = value => finite(value?.raw);
const text = (value, max = 200) => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : null;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value ? value : null;
const utc = value => finite(value) !== null && value > 0 && value < 1e11 ? new Date(value * 1000).toISOString() : null;
const decode = value => value.replace(/&#(x[0-9a-f]+|\d+);?/gi, (_, code) => { const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1),16) : Number(code); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; }).replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&nbsp;', ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
const plain = html => decode(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
const safeNow = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const unavailable = (ticker, collectedAt, reason = '공개 페이지에 확인 가능한 애널리스트 자료가 없습니다.') => ({ version:1, status:'unavailable', ticker, collectedAt, consensus:null, estimates:[], ratings:[], sources:[], coverage:{financialEstimates:'unavailable',namedAnalysts:'unavailable',firmRatings:'unavailable',reason}, limitations:['공개된 집계 추정치와 개인 애널리스트의 실적 추정치는 서로 다릅니다. 집계값을 개인의 의견으로 귀속하지 않습니다.'] });

function source(provider, ticker, collectedAt, field, extra = {}) {
  return { provider, url: provider === 'Yahoo Finance' ? `https://finance.yahoo.com/quote/${ticker}/analysis/` : `https://stockanalysis.com/stocks/${ticker.toLowerCase()}/forecast/`, retrievedAt:collectedAt, field, ...extra };
}

export function parseYahooAnalystHtml(html, ticker, collectedAt = new Date().toISOString()) {
  if (!validTicker(ticker) || typeof html !== 'string' || html.length > MAX_PAGE || !safeNow(collectedAt)) throw new Error('INVALID_ANALYST_PAGE');
  let modules;
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\btype=["']application\/json["']/i.test(attrs) || !/\bdata-sveltekit-fetched\b/.test(attrs)) continue;
    let url;
    try { url = new URL(decode(/\bdata-url="([^"]+)"/.exec(attrs)?.[1] || '')); } catch { continue; }
    if (url.origin !== 'https://query1.finance.yahoo.com' || url.pathname !== `/v10/finance/quoteSummary/${ticker}` || body.length > 2 * 1024 * 1024) continue;
    try {
      const envelope = JSON.parse(body);
      if (envelope.status !== 200 || typeof envelope.body !== 'string') continue;
      const parsed = JSON.parse(envelope.body), rows = parsed.quoteSummary?.result;
      if (parsed.quoteSummary?.error || !Array.isArray(rows) || rows.length !== 1) continue;
      if (rows[0]?.price?.symbol !== ticker || !['EQUITY','ETF'].includes(rows[0]?.price?.quoteType)) continue;
      modules = rows[0]; break;
    } catch { /* Other script blocks are not observations. */ }
  }
  if (!modules) throw new Error('PUBLIC_ANALYST_JSON_UNAVAILABLE');
  const data = unavailable(ticker, collectedAt), f = modules.financialData || {}, trends = modules.earningsTrend || {};
  const count = value => { const n = raw(value); return n !== null && Number.isInteger(n) && n >= 0 && n < 10000 ? n : null; };
  const distribution = (modules.recommendationTrend?.trend || []).filter(row => row?.period === '0m').map(row => {
    const items = [['strongBuy','Strong Buy'],['buy','Buy'],['hold','Hold'],['sell','Sell'],['strongSell','Strong Sell']].map(([key,rating])=>({rating,count:finite(row[key])})).filter(row=>Number.isInteger(row.count)&&row.count>=0&&row.count<10000);
    return {period:'0m',items,source:source('Yahoo Finance',ticker,collectedAt,'recommendationTrend.trend[period=0m]',{basis:'현재 제공자 집계 분포; 개인 애널리스트 명단과 별도'})};
  })[0] || null;
  const targetCurrency = text(modules.price.currency, 10);
  data.consensus = { recommendation:text(f.recommendationKey,40), mean:raw(f.recommendationMean), analystCount:count(f.numberOfAnalystOpinions), targetMean:raw(f.targetMeanPrice), targetMedian:raw(f.targetMedianPrice), targetLow:raw(f.targetLowPrice), targetHigh:raw(f.targetHighPrice), currency:targetCurrency, distribution:distribution?.items || [], source:source('Yahoo Finance',ticker,collectedAt,'financialData/recommendationTrend',{basis:'목표주가 및 투자의견 집계; 다음 분기 실적 예상이나 개인별 의견이 아님'}) };
  if (!data.consensus.recommendation && data.consensus.targetMean === null && !data.consensus.distribution.length) data.consensus = null;
  const methodology = ['gaap','nongaap'].includes(trends.defaultMethodology) ? trends.defaultMethodology : 'unspecified';
  data.estimates = (Array.isArray(trends.trend) ? trends.trend : []).filter(row=>['0q','+1q','0y','+1y'].includes(row?.period)&&date(row.endDate)).slice(0,4).map(row=>{
    const e=row.earningsEstimate||{}, r=row.revenueEstimate||{}, revisions=row.epsRevisions||{}, epsTrend=row.epsTrend||{};
    const epsCurrency=text(e.earningsCurrency||f.financialCurrency,10), revenueCurrency=text(r.revenueCurrency||f.financialCurrency,10);
    const metrics = (object, currency) => ({ average:currency?raw(object.avg):null,low:currency?raw(object.low):null,high:currency?raw(object.high):null,analystCount:count(object.numberOfAnalysts),currency });
    return { period:row.period, label:{'0q':'다가오는 발표 대상 분기','+1q':'그다음 분기','0y':'현재 회계연도','+1y':'다음 회계연도'}[row.period],periodEnd:row.endDate,kind:'analyst-estimate',methodology,eps:metrics(e,epsCurrency),revenue:metrics(r,revenueCurrency),epsTrend:{current:raw(epsTrend.current),days7:raw(epsTrend['7daysAgo']),days30:raw(epsTrend['30daysAgo']),days60:raw(epsTrend['60daysAgo']),days90:raw(epsTrend['90daysAgo']),currency:text(epsTrend.epsTrendCurrency||epsCurrency,10)},revisions:{up7:count(revisions.upLast7days),up30:count(revisions.upLast30days),down7:count(revisions.downLast7days||revisions.downLast7Days),down30:count(revisions.downLast30days)},source:source('Yahoo Finance',ticker,collectedAt,`earningsTrend.trend[period=${row.period}]`,{periodEnd:row.endDate,basis:`애널리스트 집계 예상 · ${methodology==='gaap'?'GAAP':methodology==='nongaap'?'비GAAP 조정 실적':'회계 기준 미공개'}; 개별 분석가 이름 미제공`}) };
  });
  data.ratings = (Array.isArray(modules.upgradeDowngradeHistory?.history)?modules.upgradeDowngradeHistory.history:[]).flatMap(row=>{
    const at=utc(row?.epochGradeDate),firm=text(row?.firm),rating=text(row?.toGrade,80);
    if (!at || Date.parse(at)>Date.parse(collectedAt)+300000 || !firm || !rating) return [];
    const target=finite(row.currentPriceTarget),prior=finite(row.priorPriceTarget);
    return [{ analyst:text(row.analystName)||null,firm,rating,previousRating:text(row.fromGrade,80)||null,date:at.slice(0,10),action:text(row.action,40),targetPrice:target!==null&&target>0?target:null,previousTargetPrice:prior!==null&&prior>0?prior:null,currency:targetCurrency,source:source('Yahoo Finance',ticker,collectedAt,'upgradeDowngradeHistory.history',{publishedAt:at,basis:'증권사별 의견 변경 기록; 이름이 없으면 개인 분석가는 미공개'}) }];
  }).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,30);
  data.sources=[source('Yahoo Finance',ticker,collectedAt,'public analysis page embedded JSON')];
  data.status=data.estimates.length||data.ratings.length||data.consensus?'available':'unavailable';
  data.coverage={financialEstimates:data.estimates.length?'available':'unavailable',namedAnalysts:data.ratings.some(row=>row.analyst)?'partial':'unavailable',firmRatings:data.ratings.length?'available':'unavailable',reason:'공개 페이지에 포함된 집계 예상 및 최근 증권사 의견 최대 30건. 개인 실적 추정치와 유료 리포트 전문은 제공되지 않습니다.'};
  data.limitations.push('Yahoo의 0q는 다음 발표 대상 분기입니다. 해당 회계기간은 이미 종료되었을 수 있으며 발표 전 예상치로 표시합니다.','EPS 예상의 GAAP/비GAAP 기준과 각 지표의 통화를 확인하세요. 회사 가이던스·실제 실적과 구분합니다.');
  return data;
}

export function parseStockAnalysisRatingsHtml(html,ticker,collectedAt=new Date().toISOString()) {
  if (!validTicker(ticker)||typeof html!=='string'||html.length>MAX_PAGE||!safeNow(collectedAt)) throw new Error('INVALID_ANALYST_PAGE');
  const canonical = /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html)?.[1];
  if (canonical!==`https://stockanalysis.com/stocks/${ticker.toLowerCase()}/forecast/`) throw new Error('ANALYST_IDENTITY_MISMATCH');
  const table = /<table\b[^>]*class=["'][^"']*\brating-table\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1];
  if (!table) throw new Error('PUBLIC_NAMED_RATINGS_UNAVAILABLE');
  const result=[];
  for (const [,tr] of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells=[...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(row=>row[1]);
    // Read only the visible eight-column free table, never serialized page JS or Pro cells.
    if (cells.length!==8) continue;
    const name=text(plain(/<div\b[^>]*class=["'][^"']*\banalyst-name\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(cells[0])?.[1]||''));
    const firm=text(plain(cells[1])),rating=text(plain(cells[3]),80),published=text(plain(cells[7]),80);
    const match=/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(published||'');
    const month=match?['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(match[1])+1:0;
    const at=match&&month?date(`${match[3]}-${String(month).padStart(2,'0')}-${match[2].padStart(2,'0')}`):null;
    if (!name||!firm||!rating||!at||Date.parse(at)>Date.parse(collectedAt)+300000) continue;
    const targets=[...plain(cells[5]).matchAll(/\$([\d,]+(?:\.\d+)?)/g)].map(row=>Number(row[1].replaceAll(',',''))).filter(n=>Number.isFinite(n)&&n>0);
    result.push({analyst:name,firm,rating,previousRating:null,date:at,action:text(plain(cells[4]),80),targetPrice:targets.at(-1)??null,previousTargetPrice:targets.length>1?targets[0]:null,currency:'USD',source:source('Stock Analysis · TipRanks',ticker,collectedAt,'visible Latest Forecasts table',{publishedAt:at,basis:'공개된 개인별 목표주가·투자의견; 개인별 EPS/매출 예상은 별도 미공개'})});
  }
  return result.slice(0,10);
}

export function combineAnalystResearch(base,ratings) {
  if (!base||!validTicker(base.ticker)||!Array.isArray(base.ratings)) throw new Error('INVALID_ANALYST_BASE');
  const named=(ratings||[]).filter(row=>row.analyst);
  const remaining=base.ratings.filter(row=>!named.some(n=>n.date===row.date&&n.targetPrice===row.targetPrice&&n.firm.replace(/[^a-z]/gi,'').toLowerCase()===row.firm.replace(/[^a-z]/gi,'').toLowerCase()));
  return {...base,status:base.status==='available'||named.length?'available':'unavailable',ratings:[...named,...remaining].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,35),sources:[...base.sources,...(named.length?[source('Stock Analysis · TipRanks',base.ticker,base.collectedAt,'visible Latest Forecasts table')]:[])],coverage:{...base.coverage,namedAnalysts:named.length?'partial':base.coverage.namedAnalysts,namedAnalystCount:named.length,reason:base.coverage.reason+' 개인 이름은 공개 표에서 확인한 기록에만 표시합니다.'}};
}

async function readBounded(response,limit=MAX_PAGE) {
  if (!response.ok) { await response.body?.cancel(); throw new Error('PUBLIC_SOURCE_HTTP_'+response.status); }
  if (Number(response.headers.get('Content-Length'))>limit) { await response.body?.cancel(); throw new Error('PUBLIC_SOURCE_TOO_LARGE'); }
  const reader=response.body?.getReader();if(!reader)throw new Error('PUBLIC_SOURCE_EMPTY');
  const chunks=[];let size=0;
  while(true){const{value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('PUBLIC_SOURCE_TOO_LARGE');}chunks.push(value);}
  const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}return new TextDecoder().decode(all);
}

export function createAnalystService({fetcher=fetch,clock=()=>Date.now()}={}) {
  const cache=new Map(),pending=new Map();
  return async function get(ticker) {
    if(!validTicker(ticker))throw new Error('INVALID_TICKER');
    const current=cache.get(ticker);if(current&&current.expires>clock())return structuredClone(current.value);
    if(pending.has(ticker))return structuredClone(await pending.get(ticker));
    const promise=(async()=>{
      const collectedAt=new Date(clock()).toISOString();
      const read=async url=>readBounded(await fetcher(url,{method:'GET',redirect:'error',headers:{Accept:'text/html','User-Agent':'BANDAL Finance public research support@bandal.app'},signal:AbortSignal.timeout(10000)}));
      let base=unavailable(ticker,collectedAt),ratings=[];const failures=[];
      // Independent public pages; no restricted endpoint retries or authentication workarounds.
      const results=await Promise.allSettled([read(`https://finance.yahoo.com/quote/${ticker}/analysis/`).then(html=>parseYahooAnalystHtml(html,ticker,collectedAt)),read(`https://stockanalysis.com/stocks/${ticker.toLowerCase()}/forecast/`).then(html=>parseStockAnalysisRatingsHtml(html,ticker,collectedAt))]);
      if(results[0].status==='fulfilled')base=results[0].value;else failures.push('Yahoo analysis: '+String(results[0].reason?.message||'수집 실패'));
      if(results[1].status==='fulfilled')ratings=results[1].value;else failures.push('Stock Analysis: '+String(results[1].reason?.message||'수집 실패'));
      const value=combineAnalystResearch(base,ratings);value.coverage.fetchFailures=failures;
      cache.set(ticker,{expires:clock()+(value.status==='available'?900000:60000),value});while(cache.size>20)cache.delete(cache.keys().next().value);return value;
    })();pending.set(ticker,promise);try{return structuredClone(await promise);}finally{pending.delete(ticker);}
  };
}

export function validateAnalystResearch(value,ticker,now=Date.now()) {
  if(!validTicker(ticker)||value?.version!==1||value.ticker!==ticker||!safeNow(value.collectedAt)||Date.parse(value.collectedAt)>now+300000||!Array.isArray(value.estimates)||value.estimates.length>4||!Array.isArray(value.ratings)||value.ratings.length>35||!Array.isArray(value.sources)||value.sources.length>4)throw new Error('INVALID_ANALYST_PACK');
  const allowed=new Set(['finance.yahoo.com','stockanalysis.com']);
  const validateSource=s=>{if(!s||typeof s.url!=='string')throw new Error('INVALID_ANALYST_SOURCE');const u=new URL(s.url);if(u.protocol!=='https:'||!allowed.has(u.hostname)||u.username||u.password||u.port||u.search||u.hash||u.pathname!==(u.hostname==='finance.yahoo.com'?`/quote/${ticker}/analysis/`:`/stocks/${ticker.toLowerCase()}/forecast/`)||!safeNow(s.retrievedAt)||Date.parse(s.retrievedAt)>now+300000)throw new Error('INVALID_ANALYST_SOURCE');};
  value.sources.forEach(validateSource);
  for(const row of value.ratings){if(!text(row.firm)||!text(row.rating)||!date(row.date)||Date.parse(row.date)>now+300000||row.targetPrice!==null&&(!Number.isFinite(row.targetPrice)||row.targetPrice<=0))throw new Error('INVALID_ANALYST_RATING');validateSource(row.source);}
  for(const row of value.estimates){if(!date(row.periodEnd)||!['0q','+1q','0y','+1y'].includes(row.period))throw new Error('INVALID_ANALYST_ESTIMATE');for(const metric of [row.eps,row.revenue]){if(!metric||[metric.average,metric.low,metric.high].some(n=>n!==null&&!Number.isFinite(n)))throw new Error('INVALID_ANALYST_ESTIMATE');}validateSource(row.source);}
  if(value.consensus){for(const key of ['mean','analystCount','targetMean','targetMedian','targetLow','targetHigh'])if(value.consensus[key]!==null&&!Number.isFinite(value.consensus[key]))throw new Error('INVALID_ANALYST_CONSENSUS');validateSource(value.consensus.source);}
  return value;
}

export async function loadAnalystResearch(request,env,ticker,{clock=()=>Date.now()}={}) {
  if(!validTicker(ticker)||!env.ASSETS?.fetch)return null;
  try{const target=new URL(request.url);target.pathname=`/finance/analysts/${ticker}.json`;target.search='';target.hash='';const response=await env.ASSETS.fetch(new Request(target,{headers:{Accept:'application/json'}}));const value=validateAnalystResearch(JSON.parse(await readBounded(response,MAX_PACK)),ticker,clock());return {...value,stale:clock()-Date.parse(value.collectedAt)>86400000,dataMode:'public-source-snapshot'};}catch{return null;}
}
