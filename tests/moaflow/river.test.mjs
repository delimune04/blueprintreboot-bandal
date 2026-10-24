import test from 'node:test';
import assert from 'node:assert/strict';
import {blankState,demoState,validateState} from '../../assetdist/moaflow/finance.mjs';
import {graphFromLedger} from '../../assetdist/moaflow/flow-model.mjs';
import {buildRiverScene,renderRiver} from '../../assetdist/moaflow/river.mjs';

test('group branches preserve recorded amounts and the exact editable transactions',()=>{
 const state=demoState('2026-10-23'),graph=graphFromLedger(state,'2026-10'),scene=buildRiverScene(graph,'bank','group:fixed');
 const fixed=scene.nodes.find(n=>n.key==='group:fixed'),children=scene.nodes.filter(n=>n.key.startsWith('leaf:'));
 assert.equal(fixed.amount,635000);
 assert.equal(children.reduce((n,c)=>n+c.amount,0),fixed.amount);
 assert.deepEqual(new Set(children.flatMap(c=>c.entryIds)),new Set(fixed.entryIds));
 assert.equal(scene.incomingTotal,3309500);
 assert.equal(scene.outgoingTotal,2428000);
});

test('card expansion distinguishes usage from repayment and never duplicates a return connection',()=>{
 const state=demoState('2026-10-23'),graph=graphFromLedger(state,'2026-10');
 const primary=buildRiverScene(graph,'bank',null),card=primary.nodes.find(n=>n.entityId==='card');
 assert.equal(card.kind,'repayment');
 const expanded=buildRiverScene(graph,'bank',card.key),children=expanded.nodes.filter(n=>n.key.startsWith('leaf:'));
 assert(children.length>0);assert(children.every(n=>n.kind==='expense'&&n.caption==='카드 사용'));
 assert(children.every(n=>n.entityId!=='bank'));
 const ids=children.flatMap(n=>n.entryIds);
 assert.equal(new Set(ids).size,ids.length);
});

test('hidden values cannot leak through labels, hover titles, accessible names or SVG text',()=>{
 const state=demoState('2026-10-23'),scene=buildRiverScene(graphFromLedger(state,'2026-10'),'bank');
 const html=renderRiver(scene,{hide:true});
 for(const amount of ['2,800,000','635,000','8,294,000'])assert.equal(html.includes(amount),false);
 assert(html.includes('••••'));
 assert(html.includes('animateMotion'));
});

test('reduced motion renders a static graph with no motion instructions',()=>{
 const scene=buildRiverScene(graphFromLedger(demoState('2026-10-23'),'2026-10'),'bank');
 const html=renderRiver(scene,{reduced:true});
 assert.equal(html.includes('animateMotion'),false);
 assert(html.includes('data-motion="reduced"'));
});

test('an empty real ledger has an editable account and no invented flow or transactions',()=>{
 const state=validateState(blankState('2026-10-23')),scene=buildRiverScene(graphFromLedger(state,'2026-10'),'bank');
 assert.equal(scene.hasRecords,false);assert.equal(scene.connections.length,0);
 assert.equal(scene.nodes.length,1);assert.equal(scene.focus.entityId,'bank');
 assert.deepEqual(scene.focus.entryIds,[]);assert.equal(scene.focus.amount,0);
});

test('user-defined account labels are escaped before becoming chart markup',()=>{
 const state=blankState('2026-10-23');state.accounts[0].name='<img src=x onerror=alert(1)>';
 const html=renderRiver(buildRiverScene(graphFromLedger(state,'2026-10'),'bank'));
 assert.equal(html.includes('<img'),false);assert(html.includes('&lt;img'));
});

test('collapsed incoming and card-detail routes keep their actual direction in the detail dialog',()=>{
 const state=blankState('2026-10-23');
 for(let i=0;i<8;i++){
  state.categories.push({id:'incoming'+i,name:'수입 출처 '+i,type:'income',group:'variable',shareGroup:'기타',color:'blue'});
  state.categories.push({id:'spending'+i,name:'카드 분류 '+i,type:'expense',group:'variable',shareGroup:'생활',color:'purple'});
  state.entries.push({id:'income'+i,kind:'income',date:'2026-10-01',amount:100+i,description:'추가 수입',status:'posted',order:i,to:'bank',categoryId:'incoming'+i});
  state.entries.push({id:'expense'+i,kind:'expense',date:'2026-10-01',amount:20+i,description:'카드 사용',status:'posted',order:i,from:'card',categoryId:'spending'+i});
 }
 state.entries.push({id:'repayment',kind:'repayment',date:'2026-10-01',amount:100,description:'카드 상환',status:'posted',order:10,from:'bank',to:'card'});
 validateState(state);
 const graph=graphFromLedger(state,'2026-10'),base=buildRiverScene(graph,'bank',null);
 const incomingBundle=base.nodes.find(n=>n.key==='incoming:other');
 assert.equal(incomingBundle.routeFrom,incomingBundle.label);
 assert.equal(incomingBundle.routeTo,'주거래 계좌');
 const card=base.nodes.find(n=>n.entityId==='card'),expanded=buildRiverScene(graph,'bank',card.key);
 const cardBundle=expanded.nodes.find(n=>n.key==='leaf:leaf:other');
 assert.equal(cardBundle.routeFrom,'신용카드');
 assert.equal(cardBundle.routeTo,cardBundle.label);
});
