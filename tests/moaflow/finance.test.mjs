import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../../assetdist/moaflow/finance.mjs';
const day=F.today(),month=day.slice(0,7);
function base(){const s=F.blankState();s.book.openingDate=month+'-01';s.accounts[0].openingBalance=1000000;return s;}
let order=0;const e=(kind,amount,fields={})=>({id:'tx-'+(++order),kind,amount,date:month+'-01',description:'fixture',status:'posted',order,...fields});
test('income, card spending and repayment reconcile without double-counting expenses',()=>{
 const s=base();s.entries=[e('income',300000,{to:'bank',categoryId:'salary'}),e('expense',100000,{from:'card',categoryId:'food'}),e('repayment',100000,{from:'bank',to:'card'})];F.validateState(s);
 const r=F.monthly(s);assert.equal(r.income,300000);assert.equal(r.expense,100000);assert.equal(r.balances.bank,1200000);assert.equal(r.balances.card,0);assert.equal(r.netAssets,1200000);
});
test('savings and investment transfers preserve total assets and never become spending',()=>{
 const s=base();s.entries=[e('transfer',200000,{from:'bank',to:'saving'}),e('transfer',150000,{from:'bank',to:'invest'})];const m=F.monthly(s);assert.equal(m.balances.bank,650000);assert.equal(m.balances.saving,200000);assert.equal(m.netAssets,1000000);assert.equal(m.expense,0);
});
test('borrowing and principal repayment change assets and liabilities equally',()=>{
 const s=base();s.entries=[e('borrow',300000,{from:'card',to:'bank'}),e('repayment',100000,{from:'bank',to:'card'})];const m=F.monthly(s);assert.equal(m.assets,1200000);assert.equal(m.liabilities,200000);assert.equal(m.netAssets,1000000);assert.equal(m.income,0);assert.equal(m.expense,0);
});
test('manual valuation changes net assets while leaving the income statement intact',()=>{
 const s=base();s.entries=[e('transfer',200000,{from:'bank',to:'invest'}),e('valuation',0,{accountId:'invest',targetBalance:270000})];const m=F.monthly(s);assert.equal(m.netAssets,1070000);assert.equal(m.income,0);assert.equal(m.expense,0);assert.equal(m.journal.at(-1).valuationDelta,70000);
});
test('backdated edits replay before the exact-balance valuation rather than applying stale deltas',()=>{
 const s=base();s.entries=[e('valuation',0,{date:month+'-02',accountId:'invest',targetBalance:300000}),e('transfer',100000,{date:month+'-01',from:'bank',to:'invest'})];const result=F.ledger(s,month+'-03');assert.equal(result.balances.invest,300000);assert.equal(result.balances.bank,900000);assert.equal(result.netAssets,1200000);
});
test('every journal event balances and the ledger equation survives a mixed sequence',()=>{
 const s=base();for(let i=0;i<100;i++){s.entries.push(e('income',10100+i,{to:'bank',categoryId:'side'}),e('expense',1900+i,{from:i%2?'bank':'card',categoryId:'food'}));if(i%5===0)s.entries.push(e('repayment',2000,{from:'bank',to:'card'}),e('transfer',3000,{from:'bank',to:'saving'}));}
 const m=F.monthly(s);for(const j of m.journal)assert.equal(j.lines.reduce((n,l)=>n+l.debit,0),j.lines.reduce((n,l)=>n+l.credit,0));assert.equal(m.netAssets,1000000+m.income-m.expense);assert.equal(m.assets,m.netAssets+m.liabilities);
});
test('planned entries stay visible in the ledger but are excluded from actual statements',()=>{
 const s=base();s.entries=[e('expense',50000,{from:'bank',categoryId:'food',status:'planned'})];assert.equal(F.monthly(s).expense,0);assert.equal(F.ledger(s).balances.bank,1000000);assert.equal(F.ledger(s,day,true).balances.bank,950000);
});
test('reporting before the opening date yields zero, not an invented history',()=>{const s=base();const l=F.ledger(s,F.addDays(s.book.openingDate,-1));assert.equal(l.netAssets,0);assert.equal(l.balances.bank,0);});
test('monthly subscriptions retain the original month-end anchor',()=>{
 const s={active:true,cadence:'monthly',anchorDate:'2027-01-31'};assert.deepEqual(F.occurrences(s,'2027-01-01','2027-04-30'),['2027-01-31','2027-02-28','2027-03-31','2027-04-30']);
});
test('annual leap-day subscriptions use February month-end without drifting into March',()=>{
 const s={active:true,cadence:'yearly',anchorDate:'2024-02-29'};assert.deepEqual(F.occurrences(s,'2026-01-01','2028-12-31'),['2026-02-28','2027-02-28','2028-02-29']);assert.deepEqual(F.occurrences({...s,active:false},'2026-01-01','2028-12-31'),[]);
});
test('subscription charging is idempotent and appears once in expenses',()=>{
 const s=base();s.subscriptions=[{id:'sub',name:'Fixture',amount:9900,cadence:'monthly',anchorDate:month+'-01',accountId:'card',categoryId:'subscription',active:true,remindDays:3,color:'blue',memo:''}];s.entries.push(F.recordSubscription(s,'sub',month+'-01'));assert.throws(()=>F.recordSubscription(s,'sub',month+'-01'));assert.equal(F.monthly(s).expense,9900);assert.equal(F.subscriptionEvents(s,month+'-01',F.monthEnd(month))[0].paid,true);
});
function subscriptionFixture(){const s=base();s.subscriptions=[{id:'sub',name:'Original service',amount:10000,cadence:'monthly',anchorDate:month+'-01',accountId:'card',categoryId:'subscription',active:true,remindDays:3,color:'blue',memo:''}];return s;}
test('subscription setting edits preserve recorded amounts, names, payment accounts and categories',()=>{
 const s=subscriptionFixture();s.entries.push(F.recordSubscription(s,'sub',month+'-01'));Object.assign(s.subscriptions[0],{name:'Renamed service',amount:20000,accountId:'bank',categoryId:'living'});F.validateState(s);
 const recorded=F.subscriptionEvents(s,month+'-01',F.monthEnd(month));assert.equal(recorded.length,1);assert.equal(recorded[0].paid,true);assert.deepEqual([recorded[0].name,recorded[0].amount,recorded[0].accountId,recorded[0].categoryId],['Original service',10000,'card','subscription']);assert.equal(F.monthly(s).expense,10000);
 const next=F.shiftMonth(month,1),scheduled=F.subscriptionEvents(s,next+'-01',F.monthEnd(next));assert.deepEqual([scheduled[0].name,scheduled[0].amount,scheduled[0].accountId,scheduled[0].categoryId],['Renamed service',20000,'bank','living']);assert.equal(scheduled[0].paid,false);
});
test('pausing a subscription retains posted and planned linked entries while stopping generated schedules',()=>{
 const s=subscriptionFixture(),next=F.shiftMonth(month,1);s.entries.push(F.recordSubscription(s,'sub',month+'-01'),e('expense',12000,{date:next+'-01',description:'Explicit plan',from:'bank',categoryId:'living',status:'planned',subscriptionId:'sub',scheduledDate:next+'-01'}));s.subscriptions[0].active=false;F.validateState(s);
 const events=F.subscriptionEvents(s,month+'-01',F.monthEnd(F.shiftMonth(month,2)));assert.equal(events.length,2);assert.equal(events[0].paid,true);assert.equal(events[1].paid,false);assert.equal(events[1].amount,12000);assert.equal(events[1].name,'Explicit plan');assert.equal(F.monthly(s).expense,10000);
});
test('a monthly anchor edit cannot create a second charge even when the old date is outside the query',()=>{
 const s=subscriptionFixture(),previous=F.shiftMonth(month,-1);s.book.openingDate=previous+'-01';s.subscriptions[0].anchorDate=previous+'-01';s.entries.push(F.recordSubscription(s,'sub',previous+'-01'));s.subscriptions[0].anchorDate=previous+'-02';F.validateState(s);
 const events=F.subscriptionEvents(s,previous+'-01',F.monthEnd(previous));assert.deepEqual(events.map(r=>r.date),[previous+'-01']);assert.deepEqual(F.subscriptionEvents(s,previous+'-02',F.monthEnd(previous)),[]);assert.throws(()=>F.recordSubscription(s,'sub',previous+'-02'),/이미 연결/);
 const following=F.subscriptionEvents(s,month+'-01',F.monthEnd(month));assert.equal(following.length,1);assert.equal(following[0].date,month+'-02');assert.equal(following[0].paid,false);
});
test('a planned linked charge reserves its billing period after anchor edits',()=>{
 const s=subscriptionFixture(),previous=F.shiftMonth(month,-1);s.book.openingDate=previous+'-01';s.entries.push(e('expense',10000,{date:previous+'-01',description:'Original plan',from:'card',categoryId:'subscription',status:'planned',subscriptionId:'sub',scheduledDate:previous+'-01'}));s.subscriptions[0].anchorDate=previous+'-02';F.validateState(s);
 const events=F.subscriptionEvents(s,previous+'-01',F.monthEnd(previous));assert.equal(events.length,1);assert.equal(events[0].entry.id,s.entries[0].id);assert.equal(events[0].paid,false);assert.throws(()=>F.recordSubscription(s,'sub',previous+'-02'),/이미 연결/);assert.equal(F.monthly(s,previous).expense,0);
});
test('annual anchor edits reserve a calendar year and preserve the original linked schedule',()=>{
 const s=subscriptionFixture(),year=String(Number(day.slice(0,4))-1);s.book.openingDate=year+'-01-01';Object.assign(s.subscriptions[0],{cadence:'yearly',anchorDate:year+'-01-31'});s.entries.push(F.recordSubscription(s,'sub',year+'-01-31'));s.subscriptions[0].anchorDate=year+'-06-15';F.validateState(s);
 assert.deepEqual(F.subscriptionEvents(s,year+'-01-01',year+'-12-31').map(r=>r.date),[year+'-01-31']);assert.deepEqual(F.subscriptionEvents(s,year+'-06-01',year+'-12-31'),[]);assert.throws(()=>F.recordSubscription(s,'sub',year+'-06-15'),/이미 연결/);
});
test('cadence changes use the current billing period without discarding existing records',()=>{
 const s=subscriptionFixture(),year=String(Number(day.slice(0,4))-1);s.book.openingDate=year+'-01-01';s.subscriptions[0].anchorDate=year+'-01-01';s.entries.push(F.recordSubscription(s,'sub',year+'-01-01'));Object.assign(s.subscriptions[0],{cadence:'yearly',anchorDate:year+'-06-01'});
 assert.deepEqual(F.subscriptionEvents(s,year+'-01-01',year+'-12-31').map(r=>r.date),[year+'-01-01']);assert.throws(()=>F.recordSubscription(s,'sub',year+'-06-01'),/이미 연결/);
 Object.assign(s.subscriptions[0],{cadence:'monthly',anchorDate:year+'-01-02'});const events=F.subscriptionEvents(s,year+'-01-01',year+'-02-28');assert.deepEqual(events.map(r=>r.date),[year+'-01-01',year+'-02-02']);assert.equal(events[1].paid,false);F.validateState(s);
});
test('legacy multiple linked records in one period remain valid and visible but block another charge',()=>{
 const s=subscriptionFixture(),previous=F.shiftMonth(month,-1);s.book.openingDate=previous+'-01';s.subscriptions[0].anchorDate=previous+'-03';s.entries=[e('expense',10000,{date:previous+'-01',from:'card',categoryId:'subscription',subscriptionId:'sub',scheduledDate:previous+'-01'}),e('expense',20000,{date:previous+'-02',from:'bank',categoryId:'subscription',subscriptionId:'sub',scheduledDate:previous+'-02'})];F.validateState(s);
 const events=F.subscriptionEvents(s,previous+'-01',F.monthEnd(previous));assert.equal(events.length,2);assert.deepEqual(events.map(r=>r.amount),[10000,20000]);assert.equal(F.monthly(s,previous).expense,30000);assert.throws(()=>F.recordSubscription(s,'sub',previous+'-03'),/이미 연결/);
});
test('privacy projection exposes only allowed percentage fields, never account names or amounts',()=>{
 const s=F.demoState();s.book.name='PRIVATE_BOOK_87654321';s.accounts[0].name='PRIVATE_BANK_ACCOUNT';s.entries[0].description='PRIVATE_TRANSACTION';s.entries[0].memo='private@fixture.test';const share=F.safeShare(s,month,true),json=JSON.stringify(share);
 for(const secret of ['PRIVATE_BOOK','PRIVATE_BANK','PRIVATE_TRANSACTION','private@fixture.test',String(s.accounts[0].openingBalance),String(F.monthly(s).netAssets)])assert.equal(json.includes(secret),false);
 assert.deepEqual(Object.keys(share).sort(),['allocation','balanceDirection','composition','flow','period','version']);assert.equal(share.composition.reduce((n,x)=>n+x.percent,0),100);assert.equal(share.allocation.reduce((n,x)=>n+x.percent,0),100);assert(share.composition.every(r=>F.SHARE_GROUPS.includes(r.label)));
});
test('rounding composition preserves exactly 100 percent and excludes zero-value groups',()=>{assert.deepEqual(F.percentages([{label:'a',value:1},{label:'b',value:1},{label:'c',value:1},{label:'zero',value:0}]),[{label:'a',percent:34},{label:'b',percent:33},{label:'c',percent:33}]);assert.deepEqual(F.percentages([]),[]);});
test('rounded income-use percentages always add to 100, including half-percent ties',()=>{const s=base();s.entries=[e('income',200,{to:'bank',categoryId:'salary'}),e('expense',1,{from:'bank',categoryId:'food'})];const p=F.safeShare(s,month);assert.equal(p.flow.spent+p.flow.retained,100);});
test('backup validation rejects broken links, impossible dates, unsafe IDs and fractional KRW',()=>{
 const bad=base();bad.entries.push(e('expense',1,{from:'unknown',categoryId:'food'}));assert.throws(()=>F.validateState(bad));
 const duplicate=base();duplicate.accounts.push({...duplicate.accounts[0]});assert.throws(()=>F.validateState(duplicate));
 const unsafe=base();unsafe.categories[0].id='__proto__';assert.throws(()=>F.validateState(unsafe));
 const fractional=base();fractional.accounts[0].openingBalance=.1;assert.throws(()=>F.validateState(fractional));
 const wrongDate=base();wrongDate.entries.push(e('expense',1,{from:'bank',categoryId:'food',date:'2026-02-30'}));assert.throws(()=>F.validateState(wrongDate));
});
test('calendar export uses private reminders without embedding amounts or accounts',()=>{
 const s=F.demoState(),ics=F.calendarICS(s);assert(ics.includes('BEGIN:VALARM'));assert(ics.includes('BEGIN:VEVENT'));assert.equal(ics.includes('29000'),false);assert.equal(ics.includes('주거래 계좌'),false);assert(ics.endsWith('END:VCALENDAR\r\n'));
});
