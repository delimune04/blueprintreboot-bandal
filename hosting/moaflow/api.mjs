import {validateState,safeShare,reminders} from '../../assetdist/moaflow/finance.mjs';
const PREFIX='/moaflow/api';
const LIMIT=2500000;
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'oai-authenticated-user-id','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const fail=(status,message,code)=>{throw Object.assign(new Error(message),{status,...(code?{code}:{})});};
const digest=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');
function displayName(request){let name=request.headers.get('oai-authenticated-user-full-name')||'';try{if(request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8')name=decodeURIComponent(name);}catch{name='';}return name.slice(0,80)||'나의 계정';}
function checkOrigin(request){const url=new URL(request.url),origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');if(origin&&origin!==url.origin||site==='cross-site'||site==='same-site')fail(403,'이 사이트에서 다시 시도해 주세요.');}
async function readBody(request){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))fail(415,'JSON 형식이 필요해요.');
 if(Number(request.headers.get('content-length'))>LIMIT)fail(413,'백업 파일이 너무 커요.');
 const reader=request.body?.getReader();if(!reader)fail(422,'입력 내용이 없어요.');let size=0;const chunks=[];
 while(true){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>LIMIT){await reader.cancel();fail(413,'지원하는 데이터 크기를 넘었어요.');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{fail(422,'JSON을 읽을 수 없어요.');}if(!body||typeof body!=='object'||Array.isArray(body))fail(422,'입력 형식을 확인해 주세요.');return body;
}
async function getState(db,owner){return await db.prepare('SELECT revision,state_json,updated_at FROM moaflow_ledgers WHERE owner_key=?').bind(owner).first();}
async function getShare(db,token){
 if(!/^[A-Za-z0-9_-]{32}$/.test(token))fail(404,'공유 링크를 찾을 수 없어요.');
 const row=await db.prepare('SELECT id,owner_key,payload_json,created_at,expires_at,revoked_at FROM moaflow_shares WHERE token_hash=?').bind(await digest(token)).first();
 if(!row||row.revoked_at||row.expires_at<=new Date().toISOString())fail(404,'종료되었거나 만료된 공유 링크예요.');return row;
}
export async function handleMoaflowApi(request,env){
 try{
  const url=new URL(request.url),path=url.pathname.slice(PREFIX.length).replace(/^\//,''),method=request.method;
  const rawUser=request.headers.get('oai-authenticated-user-id'),owner=rawUser?await digest('moaflow:'+rawUser):null;
  if(method==='OPTIONS')return new Response(null,{status:204,headers:{Allow:'GET,POST,PUT,DELETE,OPTIONS'}});
  if(method!=='GET'&&method!=='HEAD'){checkOrigin(request);if(!owner)fail(401,'로그인하면 계정 저장과 친구 공유를 사용할 수 있어요.');}
  if(path==='session'&&method==='GET')return json({authenticated:!!owner,user:owner?{key:owner.slice(0,24),name:displayName(request)}:null,storage:owner?'cloud':'browser',signInUrl:'/signin-with-chatgpt?return_to=%2Fmoaflow%2F',signOutUrl:'/signout-with-chatgpt?return_to=%2Fmoaflow%2F',notifications:{inApp:true,calendar:true,nativePush:false}});
  // This header binds a tab's loaded data to the current authenticated account;
  // it is not authentication. Sites dispatch remains the sole identity source.
  // A session changed in another tab must never write the old account's state
  // to the new account, even when both happen to have the same CAS revision.
  const privateRequest=['state','reminders','shares'].includes(path)||!['GET','HEAD'].includes(method);
  if(privateRequest){
   if(!owner)fail(401,'가계부는 로그인한 본인만 열 수 있어요.');
   if(request.headers.get('x-moaflow-account')!==owner.slice(0,24))fail(409,'로그인 계정이 바뀌었어요. 이 탭의 기록을 백업한 뒤 페이지를 새로 열어 주세요.','ACCOUNT_CHANGED');
  }
  if(!env.LABVIUM_DB?.prepare)fail(503,'저장 공간을 준비하고 있어요. 잠시 후 다시 시도해 주세요.');const db=env.LABVIUM_DB;
  if(path==='health'&&method==='GET'){await db.prepare('SELECT 1 FROM moaflow_ledgers LIMIT 1').first();return json({ok:true,version:1});}
  if(path==='state'){
   if(!owner)fail(401,'가계부는 로그인한 본인만 열 수 있어요.');
   if(method==='GET'){const row=await getState(db,owner);return json(row?{revision:row.revision,state:JSON.parse(row.state_json),updatedAt:row.updated_at}:{revision:0,state:null});}
   if(method==='PUT'){
    const b=await readBody(request);if(!Number.isInteger(b.revision)||b.revision<0)fail(422,'저장 버전을 확인해 주세요.');
    const state=validateState(b.state);if(state.sample)fail(422,'예시 데이터는 계정에 자동 저장하지 않아요. 내 가계부로 시작해 주세요.');
    const now=new Date().toISOString(),content=JSON.stringify(state);
    let result;if(b.revision===0){result=await db.prepare('INSERT OR IGNORE INTO moaflow_ledgers(owner_key,revision,state_json,updated_at) VALUES(?,1,?,?)').bind(owner,content,now).run();}
    else result=await db.prepare('UPDATE moaflow_ledgers SET revision=revision+1,state_json=?,updated_at=? WHERE owner_key=? AND revision=?').bind(content,now,owner,b.revision).run();
    if(!result.meta?.changes)fail(409,'다른 기기에서 수정한 내용이 있어요. 백업을 저장한 뒤 최신 자료를 불러와 주세요.');
    return json({revision:b.revision+1,updatedAt:now});
   }
  }
  if(path==='reminders'&&method==='GET'){
   if(!owner)fail(401,'로그인이 필요해요.');const row=await getState(db,owner);const list=row?reminders(validateState(JSON.parse(row.state_json))).map(r=>({id:r.id,dueDate:r.date,overdue:r.overdue,title:r.name+' 결제일 확인',body:'모아흐름에서 구독 내역을 확인해 주세요.',deepLink:r.deepLink})):[];
   return json({notifications:list,delivery:{inApp:true,nativePushConfigured:false},timezone:'Asia/Seoul'});
  }
  if(path==='shares'){
   if(!owner)fail(401,'로그인 후 친구 공유를 사용할 수 있어요.');
   if(method==='GET'){const rows=await db.prepare('SELECT id,created_at,expires_at,revoked_at FROM moaflow_shares WHERE owner_key=? ORDER BY CASE WHEN revoked_at IS NULL AND expires_at>? THEN 0 ELSE 1 END,created_at DESC LIMIT 50').bind(owner,new Date().toISOString()).all();return json({shares:rows.results});}
   if(method==='POST'){
    const b=await readBody(request);if(b.confirm!==true||!/^\d{4}-(0[1-9]|1[0-2])$/.test(b.month)||typeof b.includeAssets!=='boolean'||![1,7,30].includes(b.days))fail(422,'공유 기간과 공개 항목을 확인해 주세요.');
    const row=await getState(db,owner);if(!row)fail(422,'가계부를 먼저 저장해 주세요.');
    const count=await db.prepare('SELECT COUNT(*) AS n FROM moaflow_shares WHERE owner_key=? AND revoked_at IS NULL AND expires_at>?').bind(owner,new Date().toISOString()).first();if(count.n>=30)fail(429,'사용 중인 공유 링크가 30개예요. 이전 공유를 종료해 주세요.');
    const state=validateState(JSON.parse(row.state_json)),payload=safeShare(state,b.month,b.includeAssets);
    const bytes=crypto.getRandomValues(new Uint8Array(24)),token=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
    const id=crypto.randomUUID(),created=new Date().toISOString(),expires=new Date(Date.now()+b.days*86400000).toISOString();
    await db.prepare('INSERT INTO moaflow_shares(id,owner_key,token_hash,payload_json,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(id,owner,await digest(token),JSON.stringify(payload),created,expires).run();
    return json({id,url:`${url.origin}/moaflow/?share=${token}`,createdAt:created,expiresAt:expires,payload},201);
   }
  }
  const revoke=/^shares\/([^/]+)\/revoke$/.exec(path);
  if(revoke&&method==='POST'){
   const result=await db.prepare('UPDATE moaflow_shares SET revoked_at=? WHERE id=? AND owner_key=? AND revoked_at IS NULL').bind(new Date().toISOString(),revoke[1],owner).run();if(!result.meta?.changes)fail(404,'공유 자료를 찾을 수 없어요.');return json({revoked:true});
  }
  const comment=/^shares\/([^/]+)\/comments(?:\/([^/]+))?$/.exec(path);
  if(comment){
   const share=await getShare(db,comment[1]);
   if(method==='POST'&&!comment[2]){
    const b=await readBody(request);if(typeof b.nickname!=='string'||!b.nickname.trim()||b.nickname.length>24||typeof b.text!=='string'||!b.text.trim()||b.text.length>500)fail(422,'별명 24자, 조언 500자 이내로 입력해 주세요.');
    const id=crypto.randomUUID(),now=new Date().toISOString(),hourAgo=new Date(Date.now()-3600000).toISOString();
    const inserted=await db.prepare('INSERT INTO moaflow_comments(id,share_id,author_key,nickname,body,created_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM moaflow_comments WHERE author_key=? AND created_at>?)<10 AND (SELECT COUNT(*) FROM moaflow_comments WHERE share_id=?)<100').bind(id,share.id,owner,b.nickname.trim(),b.text.trim(),now,owner,hourAgo,share.id).run();
    if(!inserted.meta?.changes)fail(429,'조언을 너무 자주 남겼거나 이 공유의 댓글이 가득 찼어요.');return json({id,nickname:b.nickname.trim(),text:b.text.trim(),createdAt:now},201);
   }
   if(method==='DELETE'&&comment[2]){const result=await db.prepare('DELETE FROM moaflow_comments WHERE id=? AND share_id=? AND (author_key=? OR ?=?)').bind(comment[2],share.id,owner,owner,share.owner_key).run();if(!result.meta?.changes)fail(404,'지울 수 있는 댓글이 아니에요.');return json({deleted:true});}
  }
  const shared=/^shares\/([^/]+)$/.exec(path);
  if(shared&&method==='GET'){
   const row=await getShare(db,shared[1]);const comments=await db.prepare('SELECT id,author_key,nickname,body,created_at FROM moaflow_comments WHERE share_id=? ORDER BY created_at ASC LIMIT 100').bind(row.id).all();
   return json({payload:JSON.parse(row.payload_json),createdAt:row.created_at,expiresAt:row.expires_at,owner:owner===row.owner_key,comments:comments.results.map(c=>({id:c.id,nickname:c.nickname,text:c.body,createdAt:c.created_at,canDelete:owner===row.owner_key||owner===c.author_key}))});
  }
  fail(404,'요청한 기능을 찾을 수 없어요.');
 }catch(error){const status=error.status||(error.message?.match(/확인|데이터|분류|가계부|입력|거래|구독|계좌|같은|지원/) ?422:500);return json({error:status===500?'저장 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.':error.message,...(error.code==='ACCOUNT_CHANGED'?{code:error.code}:{})},status);}
}
