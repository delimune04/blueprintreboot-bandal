import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../../assetdist/moaflow/finance.mjs';
import {graphFromLedger,focusAccountFlow,preferredFlowAccount} from '../../assetdist/moaflow/flow-model.mjs';

const month='2024-02';
let sequence=0;
function entry(kind,amount,fields={}){return{id:'flow-tx-'+(++sequence),kind,amount,date:month+'-10',description:'경로 검증',status:'posted',order:sequence,...fields};}
function base(){const state=F.blankState();state.book.openingDate='2024-01-01';state.accounts[0].openingBalance=1000000;return state;}

test('routes keep income, expenses, transfers, repayments and borrowing distinct',()=>{
 const state=base();state.entries=[entry('income',500000,{to:'bank',categoryId:'salary'}),entry('expense',50000,{from:'bank',categoryId:'food'}),entry('expense',30000,{from:'card',categoryId:'food'}),entry('transfer',100000,{from:'bank',to:'saving'}),entry('repayment',30000,{from:'bank',to:'card'}),entry('borrow',70000,{from:'card',to:'bank'})];F.validateState(state);
 const graph=graphFromLedger(state,month),find=(kind,from,to)=>graph.edges.find(e=>e.kind===kind&&e.from===from&&e.to===to);
 assert.equal(find('income','income:salary','account:bank').amount,500000);
 assert.equal(find('expense','account:bank','expense:food').amount,50000);
 assert.equal(find('expense','account:card','expense:food').label,'카드 사용');
 assert.equal(find('transfer','account:bank','account:saving').label,'저축 이체');
 assert.equal(find('repayment','account:bank','account:card').label,'카드대금 상환');
 assert.equal(find('borrow','account:card','account:bank').label,'차입');
 assert.equal(graph.summary.expense,80000);
 assert.equal(graph.summary.income,500000);
 assert.equal(graph.edges.filter(e=>e.kind==='expense').reduce((sum,e)=>sum+e.amount,0),graph.summary.expense);
 assert.equal(graph.nodes.find(n=>n.id==='account:card').balance,70000);
 assert.equal(graph.nodes.find(n=>n.id==='expense:food').group,'variable');
});

test('aggregation combines only the same route and kind and retains exact entry IDs',()=>{
 const state=base(),a=entry('transfer',100,{from:'bank',to:'saving'}),b=entry('transfer',200,{from:'bank',to:'saving'}),c=entry('transfer',50,{from:'saving',to:'bank'});state.entries=[a,b,c];
 const graph=graphFromLedger(state,month),forward=graph.edges.find(e=>e.from==='account:bank');
 assert.equal(graph.edges.length,2);assert.equal(forward.amount,300);assert.equal(forward.count,2);assert.deepEqual(forward.entryIds,[a.id,b.id]);
 assert.equal(graph.summary.expense,0);assert.equal(graph.summary.netAssets,1000000);
});

test('only the selected month actual entries become edges, while valuation remains in balances',()=>{
 const state=base();state.entries=[entry('income',100000,{to:'bank',categoryId:'salary'}),entry('income',200000,{date:'2024-01-20',to:'bank',categoryId:'salary'}),entry('expense',50000,{from:'bank',categoryId:'food',status:'planned'}),entry('transfer',100000,{from:'bank',to:'invest'}),entry('valuation',0,{accountId:'invest',targetBalance:180000})];F.validateState(state);
 const graph=graphFromLedger(state,month);
 assert.equal(graph.edges.length,2);assert.equal(graph.summary.expense,0);assert.equal(graph.nodes.find(n=>n.id==='account:invest').balance,180000);assert.equal(graph.asOf,'2024-02-29');
 assert.equal(graph.edges.some(e=>e.kind==='valuation'||e.kind==='opening'),false);
 assert.equal(graph.edges.flatMap(e=>e.entryIds).includes(state.entries[1].id),false);
});

test('future posted records and explicit planned records do not appear as live money movement',()=>{
 const state=base(),future=F.shiftMonth(F.monthOf(F.today()),1);state.entries=[entry('income',100000,{date:future+'-01',to:'bank',categoryId:'salary'}),entry('expense',1000,{date:F.today(),from:'bank',categoryId:'food',status:'planned'})];F.validateState(state);
 const futureGraph=graphFromLedger(state,future),currentGraph=graphFromLedger(state,F.monthOf(F.today()));
 assert.deepEqual(futureGraph.edges,[]);assert.deepEqual(currentGraph.edges,[]);assert.equal(futureGraph.asOf,F.today());
});

test('an account focus returns only its direct incoming and outgoing routes with neighbor nodes',()=>{
 const state=base();state.entries=[entry('income',1000,{to:'bank',categoryId:'salary'}),entry('transfer',300,{from:'bank',to:'saving'}),entry('transfer',100,{from:'saving',to:'bank'}),entry('expense',20,{from:'card',categoryId:'food'})];
 const graph=graphFromLedger(state,month),bank=focusAccountFlow(graph,'bank'),saving=focusAccountFlow(graph,'account:saving');
 assert.equal(bank.account.entityId,'bank');assert.equal(bank.incoming.length,2);assert.equal(bank.outgoing.length,1);assert(bank.incoming.every(e=>e.target===bank.account&&e.node===e.source));assert.equal(bank.outgoing[0].node.entityId,'saving');
 assert.equal(saving.incoming.length,1);assert.equal(saving.outgoing.length,1);assert.equal(saving.incoming[0].node.entityId,'bank');
 assert.deepEqual(focusAccountFlow(graph,'missing'),{account:null,incoming:[],outgoing:[]});
});

test('an empty ledger keeps its accounts and chooses an asset hub; received income has priority',()=>{
 const state=base(),empty=graphFromLedger(state,month);assert.equal(empty.nodes.length,state.accounts.length);assert.deepEqual(empty.edges,[]);assert.equal(preferredFlowAccount(empty),'bank');
 state.entries=[entry('income',100,{to:'invest',categoryId:'interest'}),entry('transfer',100000,{from:'bank',to:'saving'})];assert.equal(preferredFlowAccount(graphFromLedger(state,month)),'invest');
 state.accounts=state.accounts.filter(a=>a.type==='liability');state.entries=[];assert.equal(preferredFlowAccount(graphFromLedger(state,month)),'card');
 assert.equal(preferredFlowAccount({nodes:[],edges:[]}),null);
});

test('node namespaces preserve reused entity IDs and raw labels without mutating the ledger',()=>{
 const state=base();state.categories[0].id='bank';state.categories[0].name='급여 <테스트> "원본"';state.entries=[entry('income',1000,{to:'bank',categoryId:'bank'})];F.validateState(state);const before=JSON.stringify(state);
 const graph=graphFromLedger(state,month);assert.equal(graph.nodes.find(n=>n.id==='income:bank').label,'급여 <테스트> "원본"');assert(graph.nodes.some(n=>n.id==='account:bank'));assert.equal(new Set(graph.nodes.map(n=>n.id)).size,graph.nodes.length);assert.equal(JSON.stringify(state),before);
 assert.deepEqual(graphFromLedger(state,month).edges,graph.edges);
});

test('unsupported month values never silently produce an unrelated graph',()=>{
 const state=base();for(const invalid of ['2024-00','2024-13','2024-2','1999-12','2101-01','not-a-month',null])assert.throws(()=>graphFromLedger(state,invalid),/조회할 월/);
});
