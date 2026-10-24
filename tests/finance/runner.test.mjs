import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { handleRunnerRequest, runnerConfiguration, sanitizeRunnerDashboard } from '../../hosting/finance/runner.mjs';
import { encryptCredentials } from '../../hosting/finance/brokers.mjs';

const ALICE='a'.repeat(64), BOB='b'.repeat(64), SECRET=Buffer.alloc(32,7).toString('base64');
const ACCESS='access-secret-token-1234567890', REFRESH='refresh-secret-token-1234567890';
function environment(extra={}) {
  const sql=new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE finance_connections(id TEXT PRIMARY KEY,owner_key TEXT,provider TEXT,label TEXT,credentials_json TEXT,created_at TEXT)');
  const db={prepare(query){return {values:[],bind(...values){this.values=values;return this;},async first(){return sql.prepare(query).get(...this.values)||null;},async run(){return{meta:{changes:Number(sql.prepare(query).run(...this.values).changes)}};}};}};
  return {sql,db,env:{FINANCE_CREDENTIAL_KEY:SECRET,FINANCE_QUANT_RUNNER_URL:'https://quant.bandal.app',FINANCE_QUANT_RUNNER_OWNER:ALICE,...extra}};
}
function tokens(extra={}) {return {access_token:ACCESS,refresh_token:REFRESH,token_type:'bearer',expires_in:900,...extra};}
function dashboard(){return {as_of:'2026-10-24T12:00:00+09:00',mode:'PAPER_LOCAL',total_asset_krw:1000,initial_asset_krw:900,cumulative_return_pct:11.1,day_return_pct:1,history:[{date:'2026-10-23',total_krw:990}],sleeves:[{key:'momentum',label:'PRIVATE_LABEL',value_krw:500,weight_pct:50}],access_token:ACCESS,raw_parameters:'PRIVATE_STRATEGY'};}
function status(){return {as_of:'2026-10-24T12:00:00+09:00',paper_enabled:true,emergency_halted:false,halt_reason:'PRIVATE_PATH_OR_SECRET',raw_live_switch_armed:false,live_control_available:true,tracks:[{key:'T1-KR',label:'PRIVATE_LABEL',enabled:true,schedule:'PRIVATE_SCHEDULE'}],safety:{dry_run:true,report_paper_mode:true},credentials:REFRESH};}
async function call(e,path,{owner=ALICE,method='GET',body,fetcher=async()=>{throw new Error('Unexpected network request');}}={}) {
  const request=new Request('https://bandal.app/finance/api/'+path,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  try {const response=await handleRunnerRequest(request,e.env,path,{owner,db:e.db,readBody:r=>r.json(),fetcher});return{status:response?.status,data:response?await response.json():null,response};}
  catch(error){return{status:error.status||500,data:{error:error.message}};}
}
async function pair(e,options={}) {return call(e,'runner/pair',{method:'POST',body:{pairingCode:'12345678',confirmReplaceDevice:true},fetcher:async()=>Response.json(tokens()),...options});}

test('runner config requires fixed public HTTPS origin and full tenant digest',()=>{
  const base={FINANCE_QUANT_RUNNER_URL:'https://quant.bandal.app',FINANCE_QUANT_RUNNER_OWNER:ALICE};
  assert.equal(runnerConfiguration(base).origin,'https://quant.bandal.app');
  for(const origin of ['http://quant.bandal.app','https://localhost','https://localhost.','https://127.0.0.1','https://[::1]','https://quant.internal','https://quant.internal.','https://quant..bandal.app','https://quant.bandal.app/private','https://user:pass@quant.bandal.app','https://quant.bandal.app?secret=x','https://quant.bandal.app#x','https://quant.bandal.app:8443']) assert.equal(runnerConfiguration({...base,FINANCE_QUANT_RUNNER_URL:origin}),null,origin);
  assert.equal(runnerConfiguration({...base,FINANCE_QUANT_RUNNER_OWNER:'alice'}),null);
});
test('runner bridge is optional and never reveals another account configuration',async()=>{
  const e=environment();assert.deepEqual((await call(e,'runner/config',{owner:BOB})).data,{configured:false,connected:false,readOnly:true,replacesExistingDevice:true});
  for(const path of ['runner/dashboard','runner/pair','runner/disconnect'])assert.equal((await call(e,path,{owner:BOB})).status,404);
  assert.equal((await call(e,'runner/config',{owner:null})).status,401);
  assert.equal((await call(environment({FINANCE_QUANT_RUNNER_URL:''}),'runner/dashboard')).status,404);
});
test('pairing requires acknowledgement of current Quant device replacement, denies browser URL selection',async()=>{
  const e=environment();let count=0;
  for(const body of [{pairingCode:'12345678'},{pairingCode:'12345678',confirmReplaceDevice:false},{pairingCode:'1234567x',confirmReplaceDevice:true},{pairingCode:'12345678',confirmReplaceDevice:true,url:'https://attacker.example'}]){
    const result=await call(e,'runner/pair',{method:'POST',body,fetcher:async()=>{count++;return Response.json(tokens());}});assert.equal(result.status,422);
  }
  assert.equal(count,0);assert.equal(e.sql.prepare('SELECT count(*) AS n FROM finance_connections').get().n,0);
});
test('pairing sends the exact existing API contract and encrypts all tokens at rest',async()=>{
  const e=environment();let seen;
  const result=await pair(e,{fetcher:async(url,options)=>{seen={url,options,body:JSON.parse(options.body)};return Response.json(tokens());}});
  assert.equal(result.status,201);assert.equal(seen.url,'https://quant.bandal.app/api/v1/auth/pair');assert.equal(seen.options.redirect,'error');
  assert.equal(seen.body.pairing_code,'12345678');assert.equal(seen.body.device_id,`bandal-finance-${ALICE.slice(0,48)}`);assert.equal(Object.hasOwn(seen.body,'owner'),false);
  const serialized=JSON.stringify(e.sql.prepare('SELECT * FROM finance_connections').get());
  for(const secret of [ACCESS,REFRESH,'12345678'])assert.equal(serialized.includes(secret),false);
  assert.equal(result.response.headers.get('cache-control'),'private, no-store');assert.equal(JSON.stringify(result.data).includes(ACCESS),false);
});
test('misconfigured encryption fails before consuming the one-time pairing code',async()=>{
  const e=environment({FINANCE_CREDENTIAL_KEY:'bad-key'});let calls=0;
  const result=await pair(e,{fetcher:async()=>{calls++;return Response.json(tokens());}});
  assert.ok(result.status>=400);assert.equal(calls,0);
});
test('only owner can read saved connection and allowlisted metrics exclude secret fields',async()=>{
  const e=environment();await pair(e);
  assert.equal((await call(e,'runner/dashboard',{owner:BOB})).status,404);
  const calls=[];const result=await call(e,'runner/dashboard',{fetcher:async(url,options)=>{calls.push(url);assert.equal(options.headers.Authorization,`Bearer ${ACCESS}`);return Response.json(url.endsWith('/dashboard')?dashboard():status());}});
  assert.equal(result.status,200);assert.equal(result.data.dashboard.totalAssetKrw,1000);assert.equal(result.data.status.liveControlAvailable,false);
  assert.equal(result.data.status.tracks[0].label,'국내 모멘텀');assert.equal(result.data.dashboard.sleeves[0].label,'모멘텀');
  const serialized=JSON.stringify(result.data);for(const secret of [ACCESS,REFRESH,'PRIVATE_','credentials','raw_parameters','halt_reason'])assert.equal(serialized.includes(secret),false);
  assert.deepEqual(calls.sort(),['https://quant.bandal.app/api/v1/bot/status','https://quant.bandal.app/api/v1/dashboard']);
});
test('expired access token refreshes privately before fetching dashboard and preserves token secrecy',async()=>{
  const e=environment();await pair(e);const row=e.sql.prepare('SELECT * FROM finance_connections').get();
  const credentials=await encryptCredentials({accessToken:ACCESS,refreshToken:REFRESH,expiresAt:0,origin:'https://quant.bandal.app'},SECRET,{owner:ALICE,id:row.id,provider:'quant'});
  e.sql.prepare('UPDATE finance_connections SET credentials_json=? WHERE id=?').run(credentials,row.id);
  const calls=[];const result=await call(e,'runner/dashboard',{fetcher:async(url,options)=>{calls.push(url);if(url.endsWith('/refresh')){assert.equal(JSON.parse(options.body).refresh_token,REFRESH);return Response.json(tokens({access_token:ACCESS+'-new',refresh_token:REFRESH+'-new'}));}assert.equal(options.headers.Authorization,`Bearer ${ACCESS}-new`);return Response.json(url.endsWith('/dashboard')?dashboard():status());}});
  assert.equal(result.status,200);assert.equal(calls[0],'https://quant.bandal.app/api/v1/auth/refresh');assert.equal(JSON.stringify(result.data).includes(REFRESH),false);
});
test('upstream failures and malicious payloads never echo error bodies or follow redirects',async()=>{
  const e=environment();await pair(e);
  const result=await call(e,'runner/dashboard',{fetcher:async()=>Response.json({debug:ACCESS},{status:401})});
  assert.equal(result.status,409);assert.equal(JSON.stringify(result.data).includes(ACCESS),false);
  const huge=await call(e,'runner/dashboard',{fetcher:async()=>new Response('x',{headers:{'Content-Length':'9999999'}})});assert.equal(huge.status,502);
  const malformed=await pair(e,{fetcher:async()=>Response.json(tokens({expires_in:Infinity}))});assert.equal(malformed.status,502);
});
test('changing configured server prevents forwarding stored credentials to a new origin',async()=>{
  const e=environment();await pair(e);e.env.FINANCE_QUANT_RUNNER_URL='https://new.bandal.app';let calls=0;
  const result=await call(e,'runner/dashboard',{fetcher:async()=>{calls++;return Response.json({});}});assert.equal(result.status,409);assert.equal(calls,0);
});
test('disconnect removes only the owner Quant connection and cannot change runner state',async()=>{
  const e=environment();await pair(e);e.sql.prepare('INSERT INTO finance_connections VALUES(?,?,?,?,?,?)').run('broker',ALICE,'kis','broker','encrypted','2026-10-24');
  assert.equal((await call(e,'runner/disconnect',{owner:BOB,method:'DELETE'})).status,404);
  assert.equal((await call(e,'runner/disconnect',{method:'DELETE'})).status,200);
  assert.equal(e.sql.prepare('SELECT count(*) AS n FROM finance_connections').get().n,1);
  assert.equal((await call(e,'runner/dashboard')).data.connected,false);
  assert.equal((await call(e,'runner/bot/paper',{method:'POST',body:{enabled:true}})).status,404);
});
test('sanitizer bounds all arrays and rejects non-finite metrics',()=>{
  const value=sanitizeRunnerDashboard({...dashboard(),total_asset_krw:Infinity,history:Array(400).fill({date:'2026-10-24',total_krw:2}),sleeves:Array(20).fill({key:'secret',label:ACCESS,value_krw:1})},status());
  assert.equal(value.dashboard.totalAssetKrw,null);assert.equal(value.dashboard.history.length,180);assert.equal(value.dashboard.sleeves.length,10);assert.equal(JSON.stringify(value).includes(ACCESS),false);
});
