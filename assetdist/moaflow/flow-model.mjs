import {monthly,monthOf,monthEnd,today} from './finance.mjs';

// This graph shows actual routes, not an allocation of income into invented
// buckets. Card use and repayments remain separate kinds of recorded activity.
const nodeId=(kind,id)=>kind+':'+encodeURIComponent(String(id));
const compareId=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
const edgeOrder=(a,b)=>b.amount-a.amount||compareId(a,b);
function assertMonth(month){
 if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||month<'2000-01'||month>'2100-12')throw new Error('흐름을 조회할 월을 확인해 주세요.');
}

export function graphFromLedger(state,month=monthOf(today())){
 assertMonth(month);
 const summary=monthly(state,month),end=monthEnd(month),asOf=end>today()?today():end;
 const accounts=new Map(state.accounts.map(a=>[a.id,a])),categories=new Map(state.categories.map(c=>[c.id,c]));
 const nodes=new Map(state.accounts.map(a=>[nodeId('account',a.id),{
  id:nodeId('account',a.id),kind:'account',entityId:a.id,label:a.name,color:a.color,
  accountType:a.type,group:a.group,balance:summary.balances[a.id]??0,
 }]));
 const edges=new Map();
 const ensureCategory=(kind,id)=>{
  const key=nodeId(kind,id),category=categories.get(id);
  if(!nodes.has(key))nodes.set(key,{id:key,kind,entityId:id,label:category?.name||'미분류',color:category?.color||(kind==='income'?'blue':'purple'),group:category?.group||'variable'});
  return key;
 };
 for(const entry of summary.entries){
  let from,to,label;
  if(entry.kind==='income'){
   from=ensureCategory('income',entry.categoryId);to=nodeId('account',entry.to);label='수입';
  }else if(entry.kind==='expense'){
   from=nodeId('account',entry.from);to=ensureCategory('expense',entry.categoryId);
   const source=accounts.get(entry.from);label=source?.group==='card'?'카드 사용':source?.type==='liability'?'부채 사용':'지출';
  }else if(entry.kind==='transfer'){
   from=nodeId('account',entry.from);to=nodeId('account',entry.to);
   const destination=accounts.get(entry.to);label=destination?.group==='investment'?'투자금 이동':destination?.group==='savings'?'저축 이체':'계좌 이체';
  }else if(entry.kind==='repayment'){
   from=nodeId('account',entry.from);to=nodeId('account',entry.to);
   label=accounts.get(entry.to)?.group==='card'?'카드대금 상환':'대출 상환';
  }else if(entry.kind==='borrow'){
   from=nodeId('account',entry.from);to=nodeId('account',entry.to);label='차입';
  }else continue; // Opening balances and valuation changes are not cash routes.
  if(!nodes.has(from)||!nodes.has(to))throw new Error('흐름에 연결된 계좌를 확인해 주세요.');
  const id='flow:'+entry.kind+':'+from+':'+to;
  if(!edges.has(id))edges.set(id,{id,from,to,kind:entry.kind,amount:0,entryIds:[],count:0,label});
  const edge=edges.get(id);edge.amount+=entry.amount;edge.entryIds.push(entry.id);edge.count++;
 }
 return{nodes:[...nodes.values()],edges:[...edges.values()].sort(edgeOrder),summary,asOf};
}

export function focusAccountFlow(graph,accountId){
 const nodes=new Map(graph.nodes.map(n=>[n.id,n]));
 const account=graph.nodes.find(n=>n.kind==='account'&&(n.entityId===accountId||n.id===accountId))||null;
 if(!account)return{account:null,incoming:[],outgoing:[]};
 const withNodes=(edge,incoming)=>({...edge,source:nodes.get(edge.from),target:nodes.get(edge.to),node:nodes.get(incoming?edge.from:edge.to)});
 return{
  account,
  incoming:graph.edges.filter(edge=>edge.to===account.id).map(edge=>withNodes(edge,true)).sort(edgeOrder),
  outgoing:graph.edges.filter(edge=>edge.from===account.id).map(edge=>withNodes(edge,false)).sort(edgeOrder),
 };
}

export function preferredFlowAccount(graph){
 const accountNodes=graph.nodes.filter(n=>n.kind==='account'),assets=accountNodes.filter(n=>n.accountType==='asset');
 const candidates=(assets.length?assets:accountNodes).map(node=>{
  const incoming=graph.edges.filter(e=>e.to===node.id),outgoing=graph.edges.filter(e=>e.from===node.id);
  return{node,income:incoming.filter(e=>e.kind==='income').reduce((sum,e)=>sum+e.amount,0),movement:[...incoming,...outgoing].filter(e=>e.kind==='transfer'||e.kind==='repayment'||e.kind==='borrow').reduce((sum,e)=>sum+e.amount,0),volume:[...incoming,...outgoing].reduce((sum,e)=>sum+e.amount,0)};
 });
 candidates.sort((a,b)=>b.income-a.income||b.movement-a.movement||b.volume-a.volume||Number(b.node.group==='cash')-Number(a.node.group==='cash')||accountNodes.indexOf(a.node)-accountNodes.indexOf(b.node));
 return candidates[0]?.node.entityId??null;
}
