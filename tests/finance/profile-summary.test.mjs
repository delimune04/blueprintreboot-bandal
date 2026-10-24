import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createProfileSummaryService, validateProfileSummary } from '../../hosting/finance/profile-summary.mjs';

const now = Date.parse('2026-10-24T23:59:00Z');
const item = { ticker:'AAPL',description:'아이폰과 맥 등 기기를 판매하고 관련 소프트웨어와 구독 서비스를 제공합니다. 기기 판매와 앱·콘텐츠·서비스가 사업을 구성합니다.',authoredAt:'2026-10-24T05:00:00Z',source:{provider:'Yahoo Finance',url:'https://finance.yahoo.com/quote/AAPL/profile/',field:'assetProfile',retrievedAt:'2026-10-24T04:46:48Z'} };
test('reviewed summaries retain source collection date separately from authorship and validate exact identity',()=>{
  const found=validateProfileSummary(item,'AAPL',now);assert.equal(found.source.retrievedAt,item.source.retrievedAt);assert.equal(found.authoredAt,item.authoredAt);assert.equal(found.method,'reviewed-source-summary');
  assert.equal(validateProfileSummary(item,'IREN',now),null);assert.equal(validateProfileSummary({...item,source:{...item.source,url:'https://evil.example/'}},'AAPL',now),null);
  assert.equal(validateProfileSummary({...item,authoredAt:'2027-01-01T00:00:00Z'},'AAPL',now),null);assert.equal(validateProfileSummary({...item,source:{...item.source,retrievedAt:'2027-01-01T00:00:00Z'}},'AAPL',now),null);
});
test('reader uses one fixed asset path, coalesces reads and does not fetch company-controlled URLs',async()=>{
  let calls=0;const service=createProfileSummaryService({clock:()=>now,request:new Request('https://bandal.app/finance/api/companies/AAPL',{headers:{Cookie:'private=do-not-forward'}}),assets:{fetch:async request=>{calls++;assert.equal(new URL(request.url).origin,'https://bandal.app');assert.equal(new URL(request.url).pathname,'/finance/profiles/KOREAN.json');assert.equal(request.headers.get('cookie'),null);return Response.json({schemaVersion:1,language:'ko',companies:{AAPL:item}});}}});
  const [a,b]=await Promise.all([service.get('AAPL'),service.get('AAPL')]);assert.equal(a.description,b.description);assert.equal(calls,1);assert.equal(await service.get('IREN'),null);await assert.rejects(service.get('../SECRET'),/TICKER/);
});
test('missing, malformed or oversized summary packs fall back without inventing a brief',async()=>{
  for(const response of [()=>new Response('missing',{status:404}),()=>new Response('{'),()=>new Response('{}',{headers:{'Content-Length':String(76*1024)}}),()=>Response.json({schemaVersion:99,language:'ko',companies:{AAPL:item}})]){
    const service=createProfileSummaryService({clock:()=>now,assets:{fetch:async()=>response()}});assert.equal(await service.get('AAPL'),null);
  }
});
test('all shipped Korean briefs are grounded in captured source profiles and are readable concise original text',async()=>{
  const pack=JSON.parse(await readFile(new URL('../../assetdist/finance/profiles/KOREAN.json',import.meta.url),'utf8'));
  assert.equal(pack.language,'ko');assert.ok(Object.keys(pack.companies).length>=25);
  for(const [ticker,row] of Object.entries(pack.companies)){
    const found=validateProfileSummary(row,ticker,now);assert.ok(found,ticker);assert.match(found.description,/[가-힣]/);assert.ok(found.description.length<400,ticker+' should be concise');
    const snapshot=JSON.parse(await readFile(new URL(`../../assetdist/finance/snapshots/${ticker}.json`,import.meta.url),'utf8'));const payload=snapshot.payload||snapshot;const profile=payload.company?.profile||payload.quote?.profile||payload.profile;
    assert.ok(profile?.description?.length>30,ticker+' captured profile missing');assert.equal(found.source.retrievedAt,profile.source.retrievedAt,ticker+' source date changed');assert.equal(found.source.url,profile.source.url);assert.equal(found.sourceDescriptionSha256,createHash('sha256').update(profile.description).digest('hex'),ticker+' source description changed');
  }
});
