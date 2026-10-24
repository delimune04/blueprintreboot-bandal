import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as F from '../../assetdist/moaflow/finance.mjs';

const KEY='moaflow:browser:v1';
const memory=(entries={},{failWrite=false,corruptWrite=false}={})=>{const data=new Map(Object.entries(entries));return{data,getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>{if(failWrite)throw new Error('QuotaExceededError');data.set(k,corruptWrite?v.slice(1):String(v));},removeItem:k=>data.delete(k)};};
const app=readFileSync(new URL('../../assetdist/moaflow/app.mjs',import.meta.url),'utf8');
const fn=name=>app.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*(?:\\n [^\\n]*)*`,'m'))?.[0]||'';

test('a missing browser ledger is distinguished from one that cannot be read',()=>{
 for(const raw of [null,'','null'])assert.equal(F.readStoredLedger(raw).status,'missing');
 const valid=F.readStoredLedger(JSON.stringify({state:F.blankState(),revision:0,dirty:false}));assert.equal(valid.status,'valid');assert.equal(valid.record.state.sample,false);
 for(const raw of ['{"state":{"version":1', '{"state":{"version":99}}','{"revision":3}','"text"']){const result=F.readStoredLedger(raw);assert.equal(result.status,'invalid',raw);assert.equal(result.raw,raw,'the original bytes are kept');assert(result.reason);}
});

test('keeping an unreadable original copies it byte for byte before freeing the main key',()=>{
 const raw='{"state":{"version":1,"broken":true}\u0000 꼬리',storage=memory({[KEY]:raw});
 const copy=F.keepUnreadableLedger(storage,KEY,new Date('2026-10-24T06:00:00Z'));
 assert.equal(copy,KEY+':unreadable:2026-10-24T06:00:00.000Z');assert.equal(storage.getItem(copy),raw);assert.equal(storage.getItem(KEY),null);
 assert.equal(F.keepUnreadableLedger(memory(),KEY),null,'nothing to keep');
});

test('when the copy cannot be written or verified the original stays in place',()=>{
 const raw='{"not":"a ledger"}';
 for(const options of [{failWrite:true},{corruptWrite:true}]){const storage=memory({[KEY]:raw},options);assert.throws(()=>F.keepUnreadableLedger(storage,KEY),/원본을 먼저 내려받아/);assert.equal(storage.getItem(KEY),raw);}
});

test('the ledger app never writes over an unreadable browser original without a decision',()=>{
 assert.match(fn('persist'),/storageKey\(\)===REAL_KEY&&browserLedger\.status==='invalid'\)\{[^}]*askBrowserRecovery\(\);return false;\}/);
 assert.match(fn('startReal'),/const stored=inspectBrowserLedger\(\);if\(stored\.status==='invalid'\)return askBrowserRecovery\(\);/);
 assert.doesNotMatch(fn('startReal'),/catch\{state=F\.blankState\(\);\}/,'an unreadable ledger is no longer swapped for an empty one');
 assert.match(app,/case'confirm-keep-browser-original':\{if\(inspectBrowserLedger\(\)\.status!=='invalid'\)\{closeModal\(\);break;\}F\.keepUnreadableLedger\(localStorage,REAL_KEY\);/);
 assert.match(app,/case'download-browser-original':\{let raw=null;try\{raw=localStorage\.getItem\(REAL_KEY\);\}catch\{\}[^}]*download\(raw,/,'the download is the stored original, not the on-screen ledger');
 assert.match(fn('askBrowserRecovery'),/전체 백업은 이 원본의 백업이 아니에요/);
});
