import {focusAccountFlow} from './flow-model.mjs';
import {won,ASSET_GROUPS} from './finance.mjs';
import {escape as esc} from './charts.mjs';

const colors={blue:'#7d9acb',purple:'#9b7bd4',green:'#77aa9a',orange:'#d6a080',pink:'#c58da8',cyan:'#76a8b7'};
const unique=items=>[...new Set(items)];
const sum=items=>items.reduce((n,e)=>n+e.amount,0);
const entryIds=items=>unique(items.flatMap(e=>e.entryIds));
const color=n=>colors[n?.color]||colors.purple;
const trim=(text,max=17)=>[...text].length>max?[...text].slice(0,max-1).join('')+'…':text;
const icons={bank:'M3 8 12 3l9 5H3m2 3v8m5-8v8m4-8v8m5-8v8M3 21h18',income:'m4 16 6-6 4 4 6-8m-6 0h6v6',saving:'M12 21V11m0 4C3 15 3 8 3 8s9-1 9 7m0-4c0-8 9-8 9-8s1 8-9 8',investment:'M5 20v-7m7 7V8m7 12V3',card:'M3 9h18M6 16h5M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2',fixed:'m3 11 9-8 9 8M6 9v12h12V9m-9 12v-7h6v7',expense:'M5 4h14v17l-3-2-4 2-4-2-3 2V4m4 5h6m-6 4h6'};

function collapse(items,prefix,limit=7){
 if(items.length<=limit)return items;
 const tail=items.slice(limit-1);
 return[...items.slice(0,limit-1),{key:prefix+'other',label:`그 외 ${tail.length}개 경로`,caption:'눌러서 모든 기록 보기',amount:sum(tail),entryIds:entryIds(tail),color:'#a58dc4',entityKind:'bundle',children:tail,canExpand:true}];
}

export function buildRiverScene(graph,accountId,expanded='group:fixed'){
 const focus=focusAccountFlow(graph,accountId),nodes=[],connections=[];
 if(!focus.account)return{nodes,connections,width:1360,height:520,focus:null,incomingTotal:0,outgoingTotal:0};
 const describe=e=>({key:e.id,label:e.node.label,caption:e.label,amount:e.amount,entryIds:e.entryIds,color:color(e.node),entityKind:e.node.kind,entityId:e.node.entityId,accountType:e.node.accountType,group:e.node.group,source:e.source,target:e.target,kind:e.kind,icon:e.node.kind==='income'?'income':e.node.group==='card'?'card':e.node.group==='savings'?'saving':e.node.group==='investment'?'investment':e.node.kind==='account'?'bank':'expense'});
 let incoming=focus.incoming.map(describe),outgoing=focus.outgoing.filter(e=>e.kind!=='expense').map(describe);
 for(const group of ['fixed','variable']){
  const edges=focus.outgoing.filter(e=>e.kind==='expense'&&e.node.group===group);
  if(!edges.length)continue;
  outgoing.push({key:'group:'+group,label:group==='fixed'?'고정 지출':'생활비',caption:group==='fixed'?'주거 · 구독 · 정기 지출':'이 계좌의 일상 지출',amount:sum(edges),entryIds:entryIds(edges),color:group==='fixed'?'#c391af':'#a189c8',entityKind:'group',group,children:edges.map(describe),canExpand:true,icon:group==='fixed'?'fixed':'expense',kind:'expense'});
 }
 outgoing.sort((a,b)=>b.amount-a.amount);
 for(const n of outgoing.filter(n=>n.entityKind==='account')){
  const next=focusAccountFlow(graph,n.entityId).outgoing.filter(e=>e.target.id!==focus.account.id).map(describe);
  n.children=next;n.canExpand=next.length>0;
 }
 incoming=collapse(incoming,'incoming:').map(n=>({...n,canExpand:false}));outgoing=collapse(outgoing,'outgoing:');
 const active=outgoing.find(n=>n.key===expanded&&n.canExpand),leaves=active?collapse(active.children,'leaf:',7):[];
 const height=Math.max(500,Math.max(incoming.length,outgoing.length,leaves.length)*84+96);
 const place=(list,x,w)=>list.map((n,i)=>({...n,x,y:(height-list.length*84)/2+i*84,w,h:72}));
 incoming=place(incoming,24,232).map(n=>({...n,routeFrom:n.label,routeTo:focus.account.label}));outgoing=place(outgoing,779,232).map(n=>({...n,routeFrom:focus.account.label,routeTo:n.label}));
 const hub={...focus.account,key:'hub',label:focus.account.label,caption:ASSET_GROUPS[focus.account.group]||'중심 계좌',amount:focus.account.balance,color:'#8b68cc',entityKind:'account',entryIds:entryIds([...focus.incoming,...focus.outgoing]),x:441,y:height/2-79,w:234,h:158,hub:true,icon:focus.account.group==='card'?'card':focus.account.group==='investment'?'investment':focus.account.group==='savings'?'saving':'bank'};
 nodes.push(...incoming,hub,...outgoing);
 const makeConnection=(from,to,n)=>{const x1=from.x+from.w+2,y1=from.y+from.h/2,x2=to.x-2,y2=to.y+to.h/2,curve=Math.max(70,(x2-x1)*.5),path=`M${x1},${y1} C${x1+curve},${y1} ${x2-curve},${y2} ${x2},${y2}`;connections.push({...n,key:'connection:'+connections.length,from:from.key,to:to.key,routeFrom:from.label,routeTo:to.label,path,color:n.color||'#9a7ccf'});};
 for(const n of incoming)makeConnection(n,hub,n);
 for(const n of outgoing)makeConnection(hub,n,n);
 if(active){
  const parent=outgoing.find(n=>n.key===active.key),placed=place(leaves,1118,218);
  nodes.push(...placed.map(n=>({...n,key:'leaf:'+n.key,canExpand:false,routeFrom:parent.label,routeTo:n.label})));
  for(let i=0;i<placed.length;i++)makeConnection(parent,nodes[nodes.length-placed.length+i],placed[i]);
 }
 return{nodes,connections,width:active?1360:1050,height,focus:hub,incomingTotal:sum(focus.incoming),outgoingTotal:sum(focus.outgoing),expanded:active?.key||null,hasRecords:!!(incoming.length||outgoing.length),secondary:active?.entityKind==='account',asOf:graph.asOf};
}

function nodeIcon(n){const x=n.x+(n.hub?20:14),y=n.y+(n.hub?18:19),size=n.hub?38:33,path=icons[n.icon]||icons.expense;return`<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="11" fill="${n.color}" opacity=".12"/><svg x="${x+7}" y="${y+7}" width="${size-14}" height="${size-14}" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="none" stroke="${n.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;}

export function renderRiver(scene,{hide=false,paused=false,reduced=false}={}){
 const money=n=>hide?'••••':won(n),max=Math.max(...scene.connections.map(c=>c.amount),1);
 const node=n=>{const title=n.hub?`${n.label} · 기록 잔액 ${money(n.amount)}`:`${n.label} · ${n.caption} · ${money(n.amount)} · ${n.entryIds.length}개 기록`;return`<g class="river-node${n.hub?' river-hub':''}" role="button" tabindex="0" data-action="river-node" data-id="${esc(n.key)}" data-river-node="${esc(n.key)}" data-river-info="${esc(title)}" aria-label="${esc(n.label)} ${money(n.amount)} 흐름 상세"><title>${esc(title)}</title><rect class="river-card-shadow" x="${n.x}" y="${n.y+4}" width="${n.w}" height="${n.h}" rx="${n.hub?21:16}"/><rect class="river-card" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.hub?21:16}"/>${nodeIcon(n)}${n.hub?`<text class="river-hub-badge" x="${n.x+71}" y="${n.y+35}">지금 보고 있는 계좌</text><text class="river-hub-title" x="${n.x+20}" y="${n.y+82}">${esc(trim(n.label,13))}</text><text class="river-hub-amount" x="${n.x+20}" y="${n.y+113}">${money(n.amount)}</text><text class="river-hub-caption" x="${n.x+20}" y="${n.y+138}">기록 잔액 · ${scene.asOf}</text>`:`<text class="river-node-title" x="${n.x+59}" y="${n.y+24}">${esc(trim(n.label,11))}</text><text class="river-node-amount" x="${n.x+59}" y="${n.y+45}">${money(n.amount)}</text><text class="river-node-caption" x="${n.x+59}" y="${n.y+61}">${esc(trim(n.caption,17))}</text>`}</g>${n.canExpand?`<g class="river-expand${scene.expanded===n.key?' expanded':''}" role="button" tabindex="0" data-action="river-expand" data-id="${esc(n.key)}" aria-label="${esc(n.label)} 세부 흐름 ${scene.expanded===n.key?'접기':'펼치기'}"><circle cx="${n.x+n.w}" cy="${n.y+n.h/2}" r="12"/><path d="m${n.x+n.w-3},${n.y+n.h/2-4} 4,4 -4,4"/></g>`:''}`;};
 const routes=scene.connections.map((c,i)=>{
  const width=3+Math.sqrt(c.amount/max)*12,duration=(5.4+(i%4)*1.1).toFixed(1),particles=Math.max(2,Math.round(2+Math.sqrt(c.amount/max)*4)),title=`${c.label} · ${c.caption||c.label} · ${money(c.amount)} · ${c.entryIds.length}개 기록`;
  return`<g class="river-route" data-river-route="${esc(c.key)}" data-from="${esc(c.from)}" data-to="${esc(c.to)}"><defs><linearGradient id="river-gradient-${i}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1360" y2="0"><stop stop-color="#bcaae7"/><stop offset="52%" stop-color="${c.color}"/><stop offset="100%" stop-color="#a695d8"/></linearGradient></defs><path class="river-water" d="${c.path}" stroke="url(#river-gradient-${i})" stroke-width="${width}"/><path class="river-current" d="${c.path}" stroke="${c.color}" stroke-width="1.2"/><path class="river-hit" d="${c.path}" role="button" tabindex="0" aria-label="${esc(c.label)} ${money(c.amount)} 연결 거래 보기" data-action="river-node" data-id="${esc(c.key)}" data-river-info="${esc(title)}"><title>${esc(title)}</title></path>${Array.from({length:particles},(_,p)=>`<g class="river-particle" aria-hidden="true"><circle cx="-12" r="2" fill="${c.color}" opacity=".14"/><circle cx="-6" r="2.4" fill="${c.color}" opacity=".3"/><circle r="3.3" fill="${c.color}"/><circle cx=".2" cy="-.6" r="1.2" fill="#fff" opacity=".9"/>${reduced?'':`<animateMotion path="${c.path}" dur="${duration}s" begin="${(-p*Number(duration)/particles).toFixed(2)}s" repeatCount="indefinite" rotate="auto"/>`}</g>`).join('')}</g>`;
 }).join('');
 return`<div class="river-scroll${paused?' is-paused':''}${reduced?' reduced-motion':''}" tabindex="0" aria-label="계좌 사이 돈의 흐름. 좌우로 이동하거나 항목을 선택해 상세를 확인하세요."><svg class="river-svg" viewBox="0 0 ${scene.width} ${scene.height}" role="group" aria-label="입자가 이동하는 계좌별 돈의 흐름" data-motion="${reduced?'reduced':paused?'paused':'running'}"><defs><pattern id="river-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".65" fill="#d1c6e5" opacity=".55"/></pattern></defs><rect width="100%" height="100%" fill="url(#river-grid)"/><text class="river-column-label" x="32" y="32">들어온 곳</text><text class="river-column-label" x="449" y="32">중심 계좌</text><text class="river-column-label" x="787" y="32">이어지는 흐름</text>${scene.expanded?'<text class="river-column-label" x="1126" y="32">세부 내역</text>':''}${routes}${scene.nodes.map(node).join('')}</svg></div>`;
}

export function syncRiverMotion(root,paused=false){
 const svg=root.querySelector('.river-svg');if(!svg)return;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,stop=paused||reduced||document.hidden;
 if(stop)svg.pauseAnimations?.();else svg.unpauseAnimations?.();
 svg.dataset.motion=reduced?'reduced':stop?'paused':'running';
 svg.closest('.river-scroll')?.classList.toggle('is-paused',stop);
}

export function highlightRiver(root,key){
 const routes=[...root.querySelectorAll('.river-route')];
 for(const route of routes){const active=!!key&&(route.dataset.riverRoute===key||route.dataset.from===key||route.dataset.to===key);route.classList.toggle('is-highlighted',active);route.classList.toggle('is-dimmed',!!key&&!active);}
}
