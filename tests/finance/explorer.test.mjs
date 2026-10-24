import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {companySummary,rankCompanies,renderExplorerCards,sourceMarkup,renderMetrics,renderFinancialTable,renderCompany,comparisonRows,renderComparison,businessRevenueFlow,companyLogo,renderMetricHistory,renderPricePanel,renderAnalystResearch,renderDebt,renderCoverage} from '../../assetdist/finance/explorer.mjs';

const source={provider:'Public Finance',url:'https://finance.yahoo.com/quote/AAPL/key-statistics/',period:'TTM',asOf:'2026-10-23T20:00:00Z',retrievedAt:'2026-10-24T04:00:00Z'};
const company=(ticker,extra={})=>({company:{ticker,name:ticker+' company',sector:'Technology'},financials:{revenue:100,operatingIncome:20,netIncome:10,dilutedEPS:1,shares:10},period:{start:'2025-01-01',end:'2025-12-31'},metrics:[{key:'per',label:'PER',value:20,unit:'배',formula:'주가 / EPS',source}],quote:{price:20,marketCap:200,latestTradingDay:'2026-10-23'},fieldSources:{price:source,marketCap:source},...extra});

test('explorer filters and ranks collected companies without interpreting missing ratios as zero',()=>{
 const companies=[{ticker:'A',name:'Alpha',sector:'Tech',marketCap:200,per:30},{ticker:'B',name:'Beta',sector:'Tech',marketCap:100,per:null},{ticker:'C',name:'Coda',sector:'Energy',marketCap:300,per:5}];
 assert.deepEqual(rankCompanies(companies,{sort:'marketCap'}).map(c=>c.ticker),['C','A','B']);
 assert.deepEqual(rankCompanies(companies,{sort:'per',direction:'asc'}).map(c=>c.ticker),['C','A','B']);
 assert.deepEqual(rankCompanies(companies,{sector:'Tech',query:'beta'}).map(c=>c.ticker),['B']);
 assert.equal(companies[0].ticker,'A');
});
test('summary preserves negative-earnings N/M status instead of labelling all missing PER as N/M',()=>{
 const a=companySummary(company('A',{metrics:[{key:'per',value:null,status:'not-meaningful'}]}));
 const b=companySummary(company('B',{metrics:[{key:'per',value:null,status:'unavailable'}]}));
 assert.equal(a.perStatus,'not-meaningful');
 const html=renderExplorerCards([a,b],{sort:'per'});
 assert.equal((html.match(/N\/M/g)||[]).length,1);
 assert.match(html,/미제공/);
});
test('source presentation distinguishes financial period, market observation and collection dates',()=>{
 const html=sourceMarkup({...source,filed:'2026-02-01'});
 for(const text of ['기간 TTM','자료 기준 2026-10-23','공시일 2026-02-01','수집일 2026-10-24','https://finance.yahoo.com/quote/AAPL/key-statistics/'])assert(html.includes(text),text);
 assert(!sourceMarkup({provider:'bad',url:'javascript:alert(1)'}).includes('href="javascript:'));
});
test('metric and financial rows retain their own values, periods and original sources',()=>{
 const d=company('A',{evidence:{revenue:{value:100,unit:'USD',provider:'SEC EDGAR',url:'https://www.sec.gov/Archives/data.htm',start:'2025-01-01',end:'2025-12-31',filed:'2026-02-01'}}});
 const metrics=renderMetrics(d.metrics);assert.match(metrics,/Public Finance/);assert.match(metrics,/期間|기간 TTM/);assert.match(metrics,/20/);
 const table=renderFinancialTable(d);assert.match(table,/SEC EDGAR/);assert.match(table,/2025-01-01 ~ 2025-12-31/);assert.match(table,/공시일 2026-02-01/);
});
test('two-company comparison preserves signed losses, missing values and distinct TTM versus annual bases',()=>{
 const a=company('A'),b=company('B',{financials:{revenue:50,operatingIncome:-10,netIncome:-20,dilutedEPS:-2},metrics:[{key:'per',value:null,status:'not-meaningful',source:{...source,period:'TTM'}}]});
 const rows=comparisonRows([a,b]);assert.equal(rows.find(r=>r.key==='netIncome').values[1].value,-20);assert.equal(rows.find(r=>r.key==='per').values[1].value,null);assert.equal(rows.find(r=>r.key==='revenue').values[0].period,'2025-12-31');
 const html=renderComparison([a,b]);assert.match(html,/N\/M/);assert.match(html,/\$-20/);assert.match(html,/TTM/);assert.match(html,/전체 시장 순위|다른 회계연도/);
});
test('profile exposes separately labelled sections and no fabricated business or forecast when missing',()=>{
 const html=renderCompany(company('A'),{flowMarkup:'<p>REAL_FLOW</p>'});
 for(const section of ['overview','financials','flow','valuation','outlook','sources']){assert(html.includes('id="company-panel-'+section+'"'));assert(html.includes('aria-controls="company-panel-'+section+'"'));}
 assert.match(html,/확인된 다음 기간 전망 자료가 아직 없습니다/);assert.match(html,/REAL_FLOW/);assert.match(html,/주식 수 \(기준 확인\)/);assert(!html.includes('AI가 예측한 적정주가'));
});
test('outlook labels management guidance and interpretation separately and warns when forecast period passed',()=>{
 const d=company('A',{outlook:{label:'AI 작성·출처 기반 요약',stale:true,freshnessNote:'대상 기간이 지났습니다',summary:[{text:'Business outlook',kind:'inference',sourceIds:['a']}],officialGuidance:{items:[{text:'Company guidance',kind:'management-guidance',sourceIds:['a']}]},sources:[{id:'a',provider:'Company release',title:'Earnings release',url:'https://example.com/earnings',publishedAt:'2026-01-01',retrievedAt:'2026-10-24'}]}});
 const html=renderCompany(d);assert.match(html,/대상 기간이 지났습니다/);assert.match(html,/경영진 전망/);assert.match(html,/요약자의 해석/);assert.match(html,/https:\/\/example.com\/earnings/);
});
test('untrusted labels and explanations cannot become markup or executable source links',()=>{
 const d=company('A',{company:{ticker:'A',name:'<script>company</script>'},metrics:[{key:'per',label:'<img src=x>',value:1,unit:'배',explanation:'<svg onload=x>',source:{provider:'<script>source</script>',url:'javascript:alert(1)'}}]});
 const html=renderCompany(d);assert(!html.includes('<script>'));assert(!html.includes('<img src=x>'));assert(!html.includes('href="javascript:'));assert(html.includes('&lt;script&gt;company'));
});

test('business revenue mix only draws source totals that reconcile and keeps period-specific data separate',()=>{
 const business={totalRevenue:100,period:{label:'Q3'},segments:[{label:'Products',value:70},{label:'Services',value:30}]};
 const flow=businessRevenueFlow(business);assert.equal(flow.nodes.at(-1).value,100);assert.equal(flow.links.reduce((n,l)=>n+l.value,0),100);assert.equal(flow.nodes.length,3);
 assert.equal(businessRevenueFlow({...business,segments:[{label:'Products',value:90}]}),null);assert.equal(businessRevenueFlow({...business,segments:[{label:'Products',value:-10},{label:'Services',value:110}]}),null);assert.equal(businessRevenueFlow({...business,totalRevenue:null}),null);
 assert.equal(businessRevenueFlow({...business,totalRevenue:100.001}).status,'available');
});
test('ARR separates operating run rate, contracted capacity and conditional future target',()=>{
 const d=company('IREN',{outlook:{arr:{definition:'Company-defined, not GAAP revenue',operating:{value:100,label:'Operating ARR'},contracted:{value:400,label:'Contracted ARR'},target:{value:400,label:'Target ARR',targetDate:'2026-12-31',conditions:'Subject to commissioning'}},officialGuidance:{items:[]},summary:[],sources:[]}});
 const html=renderCompany(d);for(const text of ['현재 운영','계약된 용량','향후 전환 목표','Company-defined, not GAAP revenue','Subject to commissioning','2026-12-31'])assert(html.includes(text),text);
 assert(sourceMarkup({provider:'Release',publishedAt:'2026-08-26',retrievedAt:'2026-10-24'}).includes('발표일 2026-08-26'));
});

test('financial table uses actual backend keys and labels direct-cost contribution without inventing GAAP gross profit',()=>{
 const d=company('IREN',{financials:{sellingGeneralAdministrative:12,interestExpense:3,incomeTax:2,grossProfit:48,operatingExpenses:110},evidence:{grossProfit:{scope:'직접원가 차감잔액 (표준 매출총이익 아님)',provider:'SEC EDGAR',formula:'매출 − 감가상각 제외 직접원가'},operatingExpenses:{derived:true,formula:'차감잔액 − 영업이익'}}});
 const html=renderFinancialTable(d);assert(html.includes('$12'));assert(html.includes('$3'));assert(html.includes('$2'));assert(html.includes('직접원가 차감잔액 (표준 매출총이익 아님)'));assert(html.includes('산출식: 매출 − 감가상각 제외 직접원가'));assert(html.includes('영업비용·잔여 조정액'));
});
test('atlas links the selected metric source outside its company button and separates market from collection dates',()=>{
 const summary=companySummary({ticker:'AAPL',name:'Apple',marketCap:100,asOf:'2026-10-24',sources:{marketCap:source}});
 const html=renderExplorerCards([summary],{sort:'marketCap'});assert(html.includes('Yahoo')||html.includes('Public Finance'));assert(html.includes('자료 기준 2026-10-23'));assert(html.includes('수집 2026-10-24'));assert(html.indexOf('</button><div class="atlas-sources">')>0);
});

test('partial company source maps and nullable source arrays do not break the atlas',()=>{
 for(const sources of [{revenue:null,price:source,roe:undefined},[null,source,undefined]]){
  const summary=companySummary({ticker:'XOM',name:'Exxon Mobil',marketCap:100,sources});
  assert.equal(summary.sourceLabel,'Public Finance');
  const html=renderExplorerCards([summary],{sort:'marketCap'});assert(html.includes('XOM'));assert(html.includes('Exxon Mobil'));
 }
});


test('company logos stay on bounded BANDAL image routes and never embed arbitrary remote tracking URLs',()=>{
 const valid=companyLogo({ticker:'AAPL',name:'Apple',logo:{url:'/finance/api/companies/AAPL/logo'}});
 assert.match(valid,/src="\/finance\/api\/companies\/AAPL\/logo"/);assert.match(valid,/Apple 로고/);assert.match(valid,/referrerpolicy="no-referrer"/);
 for(const url of ['https://attacker.example/track','//attacker.example/track','/finance/api/companies/AAPL/logo/../../private','data:image/svg+xml,<svg>','javascript:alert(1)'])assert(!companyLogo({ticker:'AAPL',logo:{url}}).includes('<img'),url);
 const summary=companySummary(company('AAPL',{company:{ticker:'AAPL',name:'Apple',logo:{url:'/finance/logos/AAPL.png'}}}));assert.equal(summary.logo.url,'/finance/logos/AAPL.png');assert.match(renderExplorerCards([summary]),/Apple 로고/);
});
test('metric explanations and source details are inside i while values and peer sample means stay compact',()=>{
 const m={key:'per',label:'PER',value:20,unit:'배',explanation:'EXPLANATION_ONLY_INSIDE_INFO',formula:'PRICE / EPS',source};
 const html=renderMetrics([m],{peerBenchmarks:{metrics:{per:{mean:18,n:3,industry:'Software',sample:['A','B','C'],basis:'TTM same basis'}}}});
 const info=html.slice(html.indexOf('<details class="metric-info"'),html.indexOf('</details>')+10);
 assert(info.includes('EXPLANATION_ONLY_INSIDE_INFO'));assert(info.includes('PRICE / EPS'));assert(info.includes('Public Finance'));assert.match(html,/aria-label="PER 설명"/);
 assert(!html.slice(html.indexOf('</details>')+10).includes('EXPLANATION_ONLY_INSIDE_INFO'));
 assert.match(html,/동일 산업 표본 평균/);assert.match(html,/18 배/);assert.match(html,/3개사/);assert.match(info,/A, B, C/);
});
test('four-quarter sparklines retain signed values, sort dates and leave a visible gap for missing observations',()=>{
 const series=[{periodEnd:'2026-09-30',value:5},{periodEnd:'2025-12-31',value:-3},{periodEnd:'2026-03-31',value:null},{periodEnd:'2026-06-30',value:0},{periodEnd:'2025-09-30',value:100}];
 const html=renderMetricHistory(series,'분기 영업이익','USD');assert.match(html,/최근 4분기/);assert(!html.includes('2025-09-30'));assert.match(html,/2025-12-31: \$-3/);assert.match(html,/2026-06-30: \$0/);assert.equal((html.match(/<polyline /g)||[]).length,2);assert.match(html,/spark-missing/);assert(!/NaN|Infinity/.test(html));
 assert(!/NaN|Infinity/.test(renderMetricHistory([{periodEnd:'2026-06-30',value:null}],'EPS')));
});
test('DCF sources are readonly and only the four forecasting assumptions are editable',()=>{
 const html=renderCompany(company('AAPL',{financials:{freeCashFlow:123,shares:12},evidence:{freeCashFlow:source,shares:source}}));
 const form=html.slice(html.indexOf('<form id="dcf-form"'),html.indexOf('</form>',html.indexOf('<form id="dcf-form"')));
 const inputs=[...form.matchAll(/<input\b[^>]*>/g)].map(match=>match[0]);assert.equal(inputs.length,6);
 const editable=inputs.filter(input=>!input.includes('readonly'));assert.equal(editable.length,4);
 for(const name of ['growthRate','discountRate','terminalGrowthRate','years'])assert(editable.some(input=>input.includes('name="'+name+'"')));
 assert(inputs.find(input=>input.includes('name="freeCashFlow"')).includes('value="123"'));assert(inputs.find(input=>input.includes('name="shares"')).includes('readonly'));
 const negative=renderCompany(company('IREN',{financials:{freeCashFlow:-1,shares:12}}));assert.match(negative,/공시 현금흐름이 0 이하/);assert.match(negative,/value="-1" readonly/);assert.match(negative,/<button class="button" type="submit" disabled>가정으로/);
});
test('price history exposes correct range and timestamps without replacing unavailable prices with zero',()=>{
 const data=company('AAPL',{quote:{price:25,marketTime:'2026-10-23T20:00:00Z',marketState:'CLOSED',delayMinutes:15,change:1,changePercent:4},priceHistory:{currency:'USD',source,points:[{date:'2026-01-01',close:10},{date:'2026-09-22',close:20},{date:'2026-10-23',close:25},{date:'2026-10-24',close:null}]}});
 const month=renderPricePanel(data,{range:'1M'}),year=renderPricePanel(data,{range:'1Y'});
 assert.match(month,/data-price-range="1M" aria-pressed="true"/);assert.match(month,/2026-10-23 20:00:00 UTC/);assert.match(month,/장마감/);assert.match(month,/15분 지연/);assert.match(month,/2거래일/);assert.match(year,/3거래일/);assert(!month.includes('2026-10-24 · $0'));assert.match(month,/Public Finance/);
 const missing=renderPricePanel(company('X',{quote:{price:null},priceHistory:{points:[],reason:'SOURCE_FAILED'}}));assert.match(missing,/SOURCE_FAILED/);assert.match(missing,/미제공/);assert(!/NaN|Infinity/.test(missing));
 {const html=renderPricePanel({company:{ticker:"IREN"},quote:{price:100},priceHistory:{currency:"USD",points:[{date:"2025-01-01",close:1},{date:"2026-01-01",close:100}]}},{range:"5Y"});const axes=[...html.matchAll(/class="price-axis">([^<]+)/g)].slice(0,3).map(m=>Number(m[1].replaceAll(",","")));assert(axes.every(value=>Number.isFinite(value)&&value>=0));}
});
test('individual analyst rows separate named people and firms from anonymous consensus',()=>{
 const html=renderAnalystResearch(company('AAPL',{analystResearch:{consensus:{recommendation:'strong_buy',analystCount:10,targetMean:250,source},estimates:[{fiscalQuarter:'Q4 2026',epsAverage:2,revenueAverage:120000000000,source}],ratings:[{analyst:'Jane Analyst',firm:'Research Firm',rating:'Buy',previousRating:'Hold',date:'2026-10-23',targetPrice:260,source},{firm:'Other Firm',rating:'Sell',date:'2026-10-22',source}]}}));
 for(const term of ['Strong Buy','10명 집계','Q4 2026','Jane Analyst','Research Firm','Buy','이전 Hold','Sell','개인 이름 미공개','2026-10-23'])assert(html.includes(term),term);
 assert(!renderAnalystResearch(company('X')).includes('Jane Analyst'));
});
test('debt details display only confirmed terms and label undisclosed lender and conversion fields',()=>{
 const html=renderDebt(company('IREN',{debt:{asOf:'2026-06-30',coverage:{note:'Reviewed annual note; later changes not covered'},instruments:[{name:'2030 Convertible Notes',type:'전환사채',principal:1000000000,coupon:3.5,maturity:'2030-06-15',conversionPrice:40,conversionTerms:'Cash or shares',source}],maturitySchedule:[{year:2030,amount:1000000000,source}]}}));
 for(const term of ['2030 Convertible Notes','전환사채','$1B','3.5%','2030-06-15','$40','Cash or shares','대주·인수기관','미공개·미확인','Reviewed annual note','공개된 만기별 상환 일정'])assert(html.includes(term),term);
 const unsafe=renderDebt(company('X',{debt:{instruments:[{name:'<script>x</script>',creditor:'<img src=x>',source:{url:'javascript:alert(1)'}}]}}));assert(!unsafe.includes('<script>'));assert(!unsafe.includes('<img src=x>'));assert(!unsafe.includes('href="javascript:'));
});
test('coverage distinguishes not meaningful ratios from collection failures and keeps causes in source panel',()=>{
 const data=company('A',{coverage:{scope:'SEC registered securities',metrics:{per:{state:'not-meaningful',reason:'Negative EPS'},arr:{state:'unavailable',reason:'No company-defined ARR found'}},quarterly:{available:true,count:4},price:{available:false,reason:'Provider timeout'}}});
 const html=renderCoverage(data);for(const term of ['SEC registered securities','N/M','Negative EPS','No company-defined ARR found','Provider timeout','4개'])assert(html.includes(term),term);
 assert(renderCompany(data).includes('자료 수집 범위와 미확인 항목'));
});


test('actual shipped analyst research renders nested estimate values and distinct rating distributions',()=>{
 const pack=JSON.parse(readFileSync(new URL('../../assetdist/finance/analysts/AAPL.json',import.meta.url),'utf8'));
 const html=renderAnalystResearch(company('AAPL',{analystResearch:pack})),first=pack.estimates[0];
 assert(first.eps.average>0);assert(first.revenue.average>0);
 const eps='$'+first.eps.average.toLocaleString('ko-KR',{maximumFractionDigits:2});
 const revenue='$'+(first.revenue.average/1e9).toLocaleString('ko-KR',{maximumFractionDigits:2})+'B';
 for(const text of [eps,revenue,first.periodEnd,first.label,'GAAP','EPS 예상치 변화와 상향·하향 조정'])assert(html.includes(text),text);
 assert(pack.ratings.some(row=>row.analyst));for(const row of pack.ratings.filter(row=>row.analyst).slice(0,2))assert(html.includes(row.analyst),row.analyst);
 for(const row of pack.consensus.distribution)assert(html.includes('>'+row.count+'</b>'));
});
test('debt object summary, maturities and original face amount stay distinct from remaining principal and capacity',()=>{
 const data=company('A',{debt:{summary:{debtTotal:{label:'부채 장부금액',value:700,currency:'USD',periodEnd:'2026-06-30',source}},maturities:[{label:'2년 차',value:100,currency:'USD',source}],instruments:[{name:'Facility',principal:1000,principalBasis:'XBRL 명목 발행·계약액; 잔존 원금·인출액은 별도 확인',remainingPrincipal:500,capacity:1200,carryingAmount:490,couponRate:3,effectiveRate:3.2,undrawnCapacity:700,fieldSources:{principal:source},source}]}});
 const html=renderDebt(data);for(const text of ['부채 장부금액','$700','2026-06-30','2년 차','$100','원발행·계약액','$1,000','잔존 원금','$500','약정 한도','$1,200','미인출 한도','3.2%','별도 확인'])assert(html.includes(text),text);
 assert(!html.includes('[object Object]'));
});
test('source-derived business analysis remains separate from compact metric cards',()=>{
 const html=renderCompany(company('A',{insights:{summary:[{label:'수익 변화',text:'Revenue grew by the source-derived amount',kind:'derived-fact',source}]}}));
 assert.match(html,/공개 자료로 읽는 기업/);assert.match(html,/Revenue grew by the source-derived amount/);
 assert(html.indexOf('Revenue grew')<html.indexOf('id="metrics-grid"'));
 assert(!renderMetrics(company('A').metrics).includes('Revenue grew'));
});


test('actual reviewed IREN debt terms label remaining principal separately from the original contract amount',()=>{
 const pack=JSON.parse(readFileSync(new URL('../../assetdist/finance/debt/IREN.json',import.meta.url),'utf8'));
 const html=renderDebt(company('IREN',{debt:pack})),first=pack.instruments.find(item=>item.balanceConfirmed&&item.principal);
 assert(first);assert.match(html,/잔존 원금/);assert.match(html,/이자·상환 방식/);assert.match(html,/세부 내용/);assert(html.includes(first.paymentTerms));assert(html.includes(first.details));assert(html.includes(first.principalBasis));assert(!html.includes('[object Object]'));
 const firstCard=html.slice(html.indexOf('<article class="debt-instrument"'),html.indexOf('</article>',html.indexOf('<article class="debt-instrument"')));
 assert.match(firstCard,/잔존 원금/);assert(!firstCard.includes('<dt>원발행·계약액'));
});


test('quarter chart basis uses explicit type and does not confuse comparison mentions with actual TTM basis',()=>{
 const point={periodEnd:'2026-06-30',value:12};
 const annualized=renderMetricHistory([{...point,source:{basis:'분기 ROE 연율화 (최근 12개월 실제 ROE와 별도)'}}],'ROE','%');assert.match(annualized,/최근 4분기 · 분기·연율화/);
 const quarterly=renderMetricHistory([{...point,source:{basis:'개별 분기 수익률 (연간·TTM과 별도)'}}],'영업이익률','%');assert.match(quarterly,/최근 4분기 · 분기</);
 const explicit=renderMetricHistory([{...point,periodType:'ttm',source:{basis:'분기 말 시점의 최근 4개 분기 이익 합계'}}],'PER','배');assert.match(explicit,/최근 4분기 · TTM/);
 const explicitQuarter=renderMetricHistory([{...point,periodType:'quarter',source:{basis:'분기 단위이며 TTM 비교와는 별도'}}],'EPS','USD/주');assert.match(explicitQuarter,/최근 4분기 · 분기</);
});

