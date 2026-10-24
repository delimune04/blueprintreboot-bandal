// Only normalized PUBLIC research is retained here. Private Quant/ledger data
// never passes this module. Namespaced keys cannot address private R2 objects.
const MAX_BYTES=768*1024;
const valid=t=>typeof t==='string'&&/^[A-Z0-9.-]{1,12}$/.test(t);
const privateKeys=new Set(['owner','ownerKey','account','accountNumber','credentials','connections','ledger','session','strategies','runs','orders','apiKey','apiSecret','accessKey','secretKey','password','userId']);
function hasPrivate(value,depth=0){if(!value||typeof value!=='object')return false;if(depth>30)return true;return Object.entries(value).some(([key,item])=>privateKeys.has(key)||hasPrivate(item,depth+1));}
const key=t=>'finance-public/research-v1/'+t+'.json';
function verified(p,t){return p&&!hasPrivate(p)&&['available','partial'].includes(p.status)&&p.company?.ticker===t&&/^\d{1,10}$/.test(String(p.company?.cik))&&Array.isArray(p.sources)&&p.sources.some(s=>s?.status==='available'&&['SEC companyfacts','Yahoo Finance'].includes(s.provider));}
export async function readPublicCache(env,ticker,{clock=()=>Date.now()}={}){
 if(!valid(ticker)||!env.LABVIUM_PDFS?.get)return null;
 try{const object=await env.LABVIUM_PDFS.get(key(ticker));if(!object||object.size>MAX_BYTES){await object?.body?.cancel();return null;}const text=await object.text();if(new TextEncoder().encode(text).length>MAX_BYTES)return null;const data=JSON.parse(text),date=Date.parse(data.collectedAt);if(data.schemaVersion!==1||!Number.isFinite(date)||date>clock()+300000||!verified(data.payload,ticker))return null;return data;}catch{return null;}
}
export async function writePublicCache(env,ticker,payload,{clock=()=>Date.now()}={}){
 if(!valid(ticker)||!env.LABVIUM_PDFS?.put||!verified(payload,ticker))return false;
 // Reject account-bearing fields even if a future caller passes the wrong model.
 if(['owner','ownerKey','account','strategies','credentials','connections','ledger','session'].some(k=>k in payload))return false;
 const {correction,searchedAs,resolvedTicker,history,metrics,fieldSources,insights,peerBenchmarks,...publicPayload}=payload;
 if(publicPayload.quarterlyHistory){const {metricSeries,...quarterly}=publicPayload.quarterlyHistory;publicPayload.quarterlyHistory=quarterly;}
 const content=JSON.stringify({schemaVersion:1,collectedAt:new Date(clock()).toISOString(),source:'Normalized public provider observations',payload:publicPayload});
 if(new TextEncoder().encode(content).length>MAX_BYTES)return false;
 try{await env.LABVIUM_PDFS.put(key(ticker),content,{httpMetadata:{contentType:'application/json'}});return true;}catch{return false;}
}
