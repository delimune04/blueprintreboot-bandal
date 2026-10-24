/** Independent ledger engine. Whooing public API contracts informed the account model;
 * this is not recovered Whooing server source. All amounts are integer KRW. */
export const VERSION=1;
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const uuid=()=>{if(crypto.randomUUID)return crypto.randomUUID();const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
export const won=n=>`${Math.round(n).toLocaleString('ko-KR')}원`;
export const compact=n=>Math.abs(n)>=1e8?`${(n/1e8).toFixed(2)}억`:Math.abs(n)>=1e4?`${(n/1e4).toFixed(1).replace(/\.0$/,'')}만`:Math.round(n).toLocaleString('ko-KR');
export const monthOf=d=>d.slice(0,7);
export const monthEnd=m=>new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5,7)),0)).toISOString().slice(0,10);
export const addDays=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
export function shiftMonth(m,n){const d=new Date(m+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,7);}
export const dateInMonth=(m,day)=>`${m}-${String(Math.min(day,Number(monthEnd(m).slice(8)))).padStart(2,'0')}`;
export const KIND_LABELS={income:'수입',expense:'지출',transfer:'이체·투자',repayment:'카드·대출 상환',borrow:'빌린 돈',valuation:'자산가치 갱신'};
export const ASSET_GROUPS={cash:'현금성 자산',savings:'저축·예적금',investment:'투자자산',other:'기타자산',card:'신용카드',loan:'대출'};
export const SHARE_GROUPS=['생활','고정','교통','자기계발','여가','기타'];
export const COLORS=['blue','green','purple','orange','pink','cyan'];
const categorySeed=[
 ['salary','급여','income','variable','기타','blue'],['side','부수입','income','variable','기타','purple'],['interest','이자·배당','income','variable','기타','green'],['other-income','기타 수입','income','variable','기타','cyan'],
 ['housing','주거·공과금','expense','fixed','고정','orange'],['subscription','구독·통신','expense','fixed','고정','pink'],['insurance','보험·이자','expense','fixed','고정','orange'],
 ['food','식비','expense','variable','생활','purple'],['living','생활용품','expense','variable','생활','purple'],['transit','교통','expense','variable','교통','blue'],['shopping','쇼핑','expense','variable','생활','pink'],['leisure','문화·여가','expense','variable','여가','cyan'],['education','배움·성장','expense','variable','자기계발','green'],['health','건강','expense','variable','기타','green'],['other-expense','기타 지출','expense','variable','기타','orange']
];
export function blankState(day=today()){
 return {version:VERSION,sample:false,book:{name:'나의 가계부',openingDate:shiftMonth(monthOf(day),-12)+'-01',currency:'KRW'},
  accounts:[{id:'bank',name:'주거래 계좌',type:'asset',group:'cash',openingBalance:0,color:'blue',memo:''},{id:'saving',name:'저축 계좌',type:'asset',group:'savings',openingBalance:0,color:'green',memo:''},{id:'invest',name:'투자 계좌',type:'asset',group:'investment',openingBalance:0,color:'purple',memo:''},{id:'card',name:'신용카드',type:'liability',group:'card',openingBalance:0,color:'orange',memo:''}],
  categories:categorySeed.map(([id,name,type,group,shareGroup,color])=>({id,name,type,group,shareGroup,color})),entries:[],subscriptions:[],settings:{monthlyBudget:2000000,reminderDays:3,notifications:false,hideAmounts:false},updatedAt:new Date().toISOString()};
}
export function demoState(day=today()){
 const s=blankState(day);s.sample=true;s.book.name='나의 작은 회사';s.book.openingDate=shiftMonth(monthOf(day),-5)+'-01';
 s.accounts[0].openingBalance=3200000;s.accounts[1].openingBalance=7500000;s.accounts[2].openingBalance=5400000;s.accounts[3].openingBalance=240000;
 s.accounts.push({id:'loan',name:'학자금 대출',type:'liability',group:'loan',openingBalance:1500000,color:'pink',memo:'예시 데이터'});
 const sub=(id,name,amount,dayOfMonth,color)=>({id,name,amount,cadence:'monthly',anchorDate:dateInMonth(monthOf(s.book.openingDate),dayOfMonth),accountId:'card',categoryId:'subscription',active:true,remindDays:3,color,memo:''});
 s.subscriptions=[sub('sub-chatgpt','ChatGPT',29000,12,'green'),sub('sub-youtube','YouTube Premium',14900,7,'pink'),sub('sub-netflix','Netflix',17000,21,'orange'),sub('sub-icloud','iCloud+',3300,26,'blue')];
 let seq=1;const insert=(m,d,kind,amount,description,fields={})=>{const date=dateInMonth(m,d);if(date>day)return;s.entries.push({id:`demo-${seq}`,date,kind,amount,description,status:'posted',order:seq++,...fields});};
 for(let i=-5;i<=0;i++){
  const m=shiftMonth(monthOf(day),i),variation=(i+5)*13000;
  insert(m,5,'income',2800000,'이번 달 급여',{to:'bank',categoryId:'salary'});insert(m,15,'income',420000+variation,'작은 프로젝트',{to:'bank',categoryId:'side'});insert(m,20,'income',24500,'이자·배당',{to:'bank',categoryId:'interest'});
  insert(m,3,'expense',550000,'월세와 관리비',{from:'bank',categoryId:'housing'});insert(m,4,'expense',125000,'장보기',{from:'card',categoryId:'food'});insert(m,8,'expense',168000+variation,'식사와 커피',{from:'card',categoryId:'food'});insert(m,17,'expense',98000,'식비',{from:'bank',categoryId:'food'});
  insert(m,6,'expense',73000,'대중교통',{from:'card',categoryId:'transit'});insert(m,10,'expense',88000,'생활용품',{from:'card',categoryId:'living'});insert(m,16,'expense',174000,'옷과 필요한 물건',{from:'card',categoryId:'shopping'});insert(m,19,'expense',125000,'책과 강의',{from:'bank',categoryId:'education'});insert(m,22,'expense',65000,'문화생활',{from:'card',categoryId:'leisure'});insert(m,11,'expense',85000,'보험료',{from:'bank',categoryId:'insurance'});
  insert(m,13,'transfer',400000,'꾸준히 저축',{from:'bank',to:'saving'});insert(m,18,'transfer',300000,'투자계좌로 이동',{from:'bank',to:'invest'});insert(m,23,'repayment',870000,'카드대금 납부',{from:'bank',to:'card'});
  for(const sub of s.subscriptions){const date=dateInMonth(m,Number(sub.anchorDate.slice(8)));if(date<=day)insert(m,Number(date.slice(8)),'expense',sub.amount,sub.name,{from:sub.accountId,categoryId:sub.categoryId,subscriptionId:sub.id,scheduledDate:date});}
  if(i<0)insert(m,25,'valuation',0,'투자자산 월말 평가',{accountId:'invest',targetBalance:5400000+(i+6)*345000});
 }
 return s;
}
function check(ok,message){if(!ok)throw new Error(message);}
export function validDate(d){return typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&d>='2000-01-01'&&d<='2100-12-31'&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;}
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
const text=(s,max)=>typeof s==='string'&&s.length<=max;
const money=n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000000000;
export function validateState(s){
 check(s&&s.version===VERSION&&typeof s.sample==='boolean','지원하는 모아흐름 백업이 아니에요.');
 check(s.book&&text(s.book.name,60)&&s.book.name.trim()&&validDate(s.book.openingDate)&&s.book.currency==='KRW','가계부 이름과 시작일을 확인해 주세요.');
 for(const [key,max]of [['accounts',50],['categories',80],['entries',15000],['subscriptions',100]])check(Array.isArray(s[key])&&s[key].length<=max,`${key} 데이터가 올바르지 않거나 너무 많아요.`);
 check(s.accounts.length>0,'계좌를 한 개 이상 만들어 주세요.');
 const acc=new Map(),cats=new Map(),ids=new Set();
 for(const a of s.accounts){check(validId(a.id)&&!acc.has(a.id)&&text(a.name,60)&&a.name.trim()&&['asset','liability'].includes(a.type)&&Object.keys(ASSET_GROUPS).includes(a.group)&&((a.type==='asset')===!['card','loan'].includes(a.group))&&money(a.openingBalance)&&COLORS.includes(a.color)&&text(a.memo??'',200),'계좌 데이터가 올바르지 않아요.');acc.set(a.id,a);}
 for(const c of s.categories){check(validId(c.id)&&!cats.has(c.id)&&text(c.name,40)&&c.name.trim()&&['income','expense'].includes(c.type)&&['fixed','variable'].includes(c.group)&&SHARE_GROUPS.includes(c.shareGroup)&&COLORS.includes(c.color),'분류 데이터가 올바르지 않아요.');cats.set(c.id,c);}
 const subIds=new Set();
 for(const r of s.subscriptions){check(validId(r.id)&&!subIds.has(r.id)&&text(r.name,60)&&r.name.trim()&&money(r.amount)&&r.amount>0&&['monthly','yearly'].includes(r.cadence)&&validDate(r.anchorDate)&&acc.has(r.accountId)&&cats.get(r.categoryId)?.type==='expense'&&typeof r.active==='boolean'&&Number.isInteger(r.remindDays)&&r.remindDays>=0&&r.remindDays<=14&&COLORS.includes(r.color)&&text(r.memo??'',200),'구독 정보를 확인해 주세요.');subIds.add(r.id);}
 const charges=new Set();
 for(const e of s.entries){
  check(validId(e.id)&&!ids.has(e.id)&&Object.hasOwn(KIND_LABELS,e.kind)&&validDate(e.date)&&e.date>=s.book.openingDate&&text(e.description,120)&&e.description.trim()&&text(e.memo??'',500)&&['posted','planned'].includes(e.status)&&Number.isSafeInteger(e.order)&&e.order>=0,'거래 날짜·내용·상태를 확인해 주세요.');
  check(money(e.amount)&&(e.kind==='valuation'||e.amount>0),'거래 금액은 1원 이상의 정수로 입력해 주세요.');
  if(e.kind==='income')check(acc.get(e.to)?.type==='asset'&&cats.get(e.categoryId)?.type==='income','수입을 받을 자산 계좌와 수입 분류를 확인해 주세요.');
  if(e.kind==='expense')check(acc.has(e.from)&&cats.get(e.categoryId)?.type==='expense','결제 계좌와 지출 분류를 확인해 주세요.');
  if(e.kind==='transfer')check(acc.get(e.from)?.type==='asset'&&acc.get(e.to)?.type==='asset'&&e.from!==e.to,'자산 계좌 두 개를 다르게 선택해 주세요.');
  if(e.kind==='repayment')check(acc.get(e.from)?.type==='asset'&&acc.get(e.to)?.type==='liability','돈이 나갈 자산 계좌와 갚을 부채를 선택해 주세요.');
  if(e.kind==='borrow')check(acc.get(e.from)?.type==='liability'&&acc.get(e.to)?.type==='asset','부채 계좌와 돈을 받을 자산 계좌를 선택해 주세요.');
  if(e.kind==='valuation')check(acc.has(e.accountId)&&money(e.targetBalance),'평가액을 확인해 주세요.');
  if(e.subscriptionId){check(e.kind==='expense'&&subIds.has(e.subscriptionId)&&validDate(e.scheduledDate),'구독 결제의 연결 정보가 올바르지 않아요.');const key=e.subscriptionId+'|'+e.scheduledDate;check(!charges.has(key),'같은 구독 결제를 두 번 기록할 수 없어요.');charges.add(key);}
  ids.add(e.id);
 }
 check(s.settings&&money(s.settings.monthlyBudget)&&Number.isInteger(s.settings.reminderDays)&&s.settings.reminderDays>=0&&s.settings.reminderDays<=14&&typeof s.settings.notifications==='boolean'&&typeof s.settings.hideAmounts==='boolean','설정 값을 확인해 주세요.');
 return s;
}
// A stored browser ledger that cannot be read is reported, never replaced by an empty one.
export function readStoredLedger(raw){
 if(raw===null||raw===undefined||raw==='')return{status:'missing'};
 let record;try{record=JSON.parse(raw);}catch{return{status:'invalid',raw,reason:'저장 형식을 읽을 수 없어요'};}
 if(record===null)return{status:'missing'};
 try{if(typeof record!=='object'||!record.state)throw new Error('가계부 자료가 비어 있어요');return{status:'valid',record:{...record,state:validateState(record.state)}};}
 catch(error){return{status:'invalid',raw,reason:error.message||'가계부 자료를 확인할 수 없어요'};}
}
// Copies the unreadable original byte for byte and verifies it before freeing the main key.
export function keepUnreadableLedger(storage,key,now=new Date()){
 const raw=storage.getItem(key);if(raw===null)return null;
 const copy=`${key}:unreadable:${now.toISOString()}`;
 try{storage.setItem(copy,raw);}catch{throw new Error('브라우저 저장 공간이 부족해 원본을 따로 보관하지 못했어요. 원본을 먼저 내려받아 주세요.');}
 if(storage.getItem(copy)!==raw)throw new Error('원본을 그대로 보관했는지 확인하지 못했어요. 원본을 먼저 내려받아 주세요.');
 storage.removeItem(key);return copy;
}
export function ledger(state,asOf=today(),includePlanned=false){
 const accounts=new Map(state.accounts.map(a=>[a.id,a])),balances=Object.fromEntries(state.accounts.map(a=>[a.id,asOf<state.book.openingDate?0:a.openingBalance]));
 const journal=[];if(asOf<state.book.openingDate)return{balances,journal,assets:0,liabilities:0,netAssets:0};
 const pair=(debit,credit,amount)=>[{accountId:debit,debit:amount,credit:0},{accountId:credit,debit:0,credit:amount}];
 for(const a of state.accounts)if(a.openingBalance)journal.push({id:'opening-'+a.id,date:state.book.openingDate,kind:'opening',lines:a.type==='asset'?pair(a.id,'equity:opening',a.openingBalance):pair('equity:opening',a.id,a.openingBalance)});
 const entries=state.entries.filter(e=>e.date<=asOf&&(e.status==='posted'||includePlanned)).sort((a,b)=>a.date.localeCompare(b.date)||a.order-b.order||a.id.localeCompare(b.id));
 for(const e of entries){let lines=[],delta=0;
  if(e.kind==='income')lines=pair(e.to,'income:'+e.categoryId,e.amount);
  if(e.kind==='expense')lines=pair('expense:'+e.categoryId,e.from,e.amount);
  if(['transfer','repayment','borrow'].includes(e.kind))lines=pair(e.to,e.from,e.amount);
  if(e.kind==='valuation'){
   delta=e.targetBalance-balances[e.accountId];const asset=accounts.get(e.accountId).type==='asset';
   if(delta)lines=(asset===(delta>0))?pair(e.accountId,'equity:valuation',Math.abs(delta)):pair('equity:valuation',e.accountId,Math.abs(delta));
  }
  for(const line of lines){const account=accounts.get(line.accountId);if(account)balances[account.id]+=(account.type==='asset'?1:-1)*(line.debit-line.credit);}
  journal.push({...e,lines,valuationDelta:delta});
 }
 const assets=state.accounts.filter(a=>a.type==='asset').reduce((s,a)=>s+balances[a.id],0),liabilities=state.accounts.filter(a=>a.type==='liability').reduce((s,a)=>s+balances[a.id],0);
 return{balances,journal,assets,liabilities,netAssets:assets-liabilities};
}
export function monthly(state,month=monthOf(today())){
 const entries=state.entries.filter(e=>monthOf(e.date)===month&&e.status==='posted'&&e.date<=today()),incomeByCategory={},expenseByCategory={};let income=0,expense=0;
 for(const e of entries){if(e.kind==='income'){income+=e.amount;incomeByCategory[e.categoryId]=(incomeByCategory[e.categoryId]||0)+e.amount;}if(e.kind==='expense'){expense+=e.amount;expenseByCategory[e.categoryId]=(expenseByCategory[e.categoryId]||0)+e.amount;}}
 const end=monthEnd(month),asOf=end>today()?today():end,current=ledger(state,asOf),before=ledger(state,addDays(month+'-01',-1));
 const fixed=Object.entries(expenseByCategory).filter(([id])=>state.categories.find(c=>c.id===id)?.group==='fixed').reduce((sum,[,v])=>sum+v,0);
 return{entries,income,expense,net:income-expense,fixed,variable:expense-fixed,savingsRate:income?Math.round((income-expense)/income*100):null,incomeByCategory,expenseByCategory,...current,assetChange:current.netAssets-before.netAssets};
}
export function assetHistory(state,month=monthOf(today()),count=6){return Array.from({length:count},(_,i)=>{const m=shiftMonth(month,i-count+1),date=monthEnd(m)>today()?today():monthEnd(m);return{month:m,date,...ledger(state,date)};});}
export function occurrences(subscription,start,end){
 if(!subscription.active||end<subscription.anchorDate)return[];let m=monthOf(start);const result=[];
 for(let i=0;m<=monthOf(end)&&i<132;i++,m=shiftMonth(m,1)){
  if(subscription.cadence==='yearly'&&m.slice(5)!==subscription.anchorDate.slice(5,7))continue;
  const date=dateInMonth(m,Number(subscription.anchorDate.slice(8)));
  if(date>=start&&date<=end&&date>=subscription.anchorDate)result.push(date);
 }return result;
}
// Linked entries are the historical source of truth. Current settings generate
// only unrecorded periods: a month for monthly billing, a year for yearly billing.
// This also applies after a cadence change; legacy records themselves stay intact.
const subscriptionPeriod=(subscription,date)=>date.slice(0,subscription.cadence==='yearly'?4:7);
export function subscriptionEvents(state,start,end){
 const linked=new Map(state.subscriptions.map(s=>[s.id,[]]));
 for(const e of state.entries)if(e.subscriptionId)linked.get(e.subscriptionId)?.push(e);
 return state.subscriptions.flatMap(s=>{
  const records=linked.get(s.id),periods=new Set(records.map(e=>subscriptionPeriod(s,e.scheduledDate)));
  const recorded=records.filter(e=>e.scheduledDate>=start&&e.scheduledDate<=end).map(e=>({...s,date:e.scheduledDate,entry:e,paid:e.status==='posted',amount:e.amount,name:e.description,accountId:e.from,categoryId:e.categoryId,memo:e.memo??''}));
  const scheduled=occurrences(s,start,end).filter(date=>!periods.has(subscriptionPeriod(s,date))).map(date=>({...s,date,paid:false}));
  return[...recorded,...scheduled];
 }).sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name));
}
export function reminders(state,day=today()){
 return subscriptionEvents(state,addDays(day,-14),addDays(day,14)).filter(s=>!s.paid&&s.date<=addDays(day,s.remindDays)).map(s=>({id:s.id+'-'+s.date,subscriptionId:s.id,name:s.name,date:s.date,overdue:s.date<day,amount:s.amount,deepLink:'/moaflow/#subscriptions'}));
}
export function recordSubscription(state,id,date){
 const s=state.subscriptions.find(s=>s.id===id);check(s&&validDate(date),'구독과 결제일을 확인해 주세요.');check(date<=today(),'미래의 결제는 아직 완료로 기록할 수 없어요.');
 check(occurrences(s,date,date).includes(date),'등록한 구독의 결제일이 아니에요.');check(!state.entries.some(e=>e.subscriptionId===id&&subscriptionPeriod(s,e.scheduledDate)===subscriptionPeriod(s,date)),'이 결제 주기에는 이미 연결한 기록이 있어요. 기존 기록을 수정해 주세요.');
 return{id:uuid(),kind:'expense',date,amount:s.amount,description:s.name,from:s.accountId,categoryId:s.categoryId,status:'posted',order:Date.now(),subscriptionId:id,scheduledDate:date,memo:'구독 결제 기록'};
}
export function percentages(items){const rows=items.filter(x=>x.value>0),total=rows.reduce((s,x)=>s+x.value,0);if(!total)return[];const points=rows.map((r,i)=>({...r,i,raw:r.value/total*100,percent:Math.floor(r.value/total*100)}));let rest=100-points.reduce((s,x)=>s+x.percent,0);const sorted=[...points].sort((a,b)=>(b.raw-b.percent)-(a.raw-a.percent)||a.i-b.i);for(let i=0;i<rest;i++)sorted[i].percent++;return points.map(p=>({label:p.label,percent:p.percent}));}
export function safeShare(state,month,includeAssets=false){
 check(/^\d{4}-(0[1-9]|1[0-2])$/.test(month),'공유할 월을 확인해 주세요.');const m=monthly(state,month),byGroup={};
 for(const [id,value]of Object.entries(m.expenseByCategory)){const c=state.categories.find(c=>c.id===id),name=SHARE_GROUPS.includes(c?.shareGroup)?c.shareGroup:'기타';byGroup[name]=(byGroup[name]||0)+value;}
 const payload={version:1,period:month,composition:percentages(Object.entries(byGroup).map(([label,value])=>({label,value}))),flow:m.income&&m.expense/m.income<=10?{spent:Math.round(m.expense/m.income*100),retained:100-Math.round(m.expense/m.income*100)}:null,balanceDirection:m.net>0?'surplus':m.net<0?'deficit':'even'};
 if(includeAssets){const grouped={};for(const a of state.accounts.filter(a=>a.type==='asset')){const label=ASSET_GROUPS[a.group];grouped[label]=(grouped[label]||0)+Math.max(0,m.balances[a.id]);}payload.allocation=percentages(Object.entries(grouped).map(([label,value])=>({label,value})));}
 return payload;
}
export function calendarICS(state,day=today()){
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//BANDAL//MoaFlow//KO','CALSCALE:GREGORIAN','METHOD:PUBLISH'];const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const escape=s=>s.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/[,;]/g,'\\$&');
 for(const s of subscriptionEvents(state,day,addDays(day,366)).filter(e=>!e.paid)){
  lines.push('BEGIN:VEVENT',`UID:${s.id}-${s.date}@moaflow.bandal.app`,`DTSTAMP:${stamp}`,`DTSTART;VALUE=DATE:${s.date.replaceAll('-','')}`,`DTEND;VALUE=DATE:${addDays(s.date,1).replaceAll('-','')}`,`SUMMARY:${escape(s.name)} 구독 결제일`,'DESCRIPTION:모아흐름에서 결제 내용을 확인해 주세요.',`URL:https://bandal.app/moaflow/#subscriptions`,'BEGIN:VALARM',`TRIGGER:-P${s.remindDays}D`,'ACTION:DISPLAY','DESCRIPTION:구독 결제일을 확인해 주세요.','END:VALARM','END:VEVENT');
 }lines.push('END:VCALENDAR');return lines.join('\r\n')+'\r\n';
}
