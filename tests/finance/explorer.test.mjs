import test from 'node:test';
import assert from 'node:assert/strict';
import {companySummary,rankCompanies,renderExplorerCards,sourceMarkup,renderMetrics,renderFinancialTable,renderCompany,comparisonRows,renderComparison,businessRevenueFlow} from '../../assetdist/finance/explorer.mjs';

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
