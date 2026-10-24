import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountApi,ACCOUNT_CHANGED} from '../../assetdist/moaflow/cloud.mjs';

test('an open ledger keeps its intended account when the server session changes',async()=>{
 let currentServerAccount='alice',changes=0,requests=0;
 const saved={alice:{revision:3,name:'Alice ledger'},bob:{revision:3,name:'Bob ledger'}};
 const api=createAccountApi({getAccountKey:()=> 'alice',onAccountChanged:()=>changes++,fetcher:async(path,options)=>{
  requests++;
  if(options.headers.get('X-Moaflow-Account')!==currentServerAccount)return Response.json({code:ACCOUNT_CHANGED},{status:409});
  if(options.method==='PUT')saved[currentServerAccount]=JSON.parse(options.body);
  return Response.json(saved[currentServerAccount]);
 }});
 assert.equal((await api('state')).name,'Alice ledger');
 currentServerAccount='bob';
 await assert.rejects(api('state',{method:'PUT',body:{revision:3,name:'Alice edit'}}),e=>e.code===ACCOUNT_CHANGED);
 assert.equal(saved.bob.name,'Bob ledger');
 await assert.rejects(api('shares',{method:'POST',body:{confirm:true}}),e=>e.code===ACCOUNT_CHANGED);
 assert.equal(requests,2,'subsequent private requests stop until the page is reopened');
 assert.equal(changes,1);
});

test('anonymous public shares do not claim an account',async()=>{
 const api=createAccountApi({getAccountKey:()=>null,onAccountChanged:()=>assert.fail('must not lock'),fetcher:async(path,options)=>{
  assert.equal(options.headers.has('X-Moaflow-Account'),false);
  assert.equal(options.credentials,'same-origin');
  return Response.json({payload:{period:'2026-10'}});
 }});
 assert.equal((await api('shares/public-token')).payload.period,'2026-10');
});

test('a revision conflict remains recoverable and does not lock the account',async()=>{
 let attempts=0;
 const api=createAccountApi({getAccountKey:()=> 'alice',onAccountChanged:()=>assert.fail('revision conflict is not account change'),fetcher:async()=>++attempts===1?Response.json({error:'version conflict'},{status:409}):Response.json({revision:4})});
 await assert.rejects(api('state',{method:'PUT',body:{revision:2}}),e=>e.status===409&&e.code!==ACCOUNT_CHANGED);
 assert.equal((await api('state')).revision,4);
});
