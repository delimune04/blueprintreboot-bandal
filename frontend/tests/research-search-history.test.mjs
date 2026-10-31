import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeResearchSearchQuery,readResearchSearchHistory,mergeResearchSearchHistory} from '../app/lib/workspace/research-search-history.mjs';
test('query history bounds text and ignores malformed values',()=>{
  assert.equal(normalizeResearchSearchQuery('a'.repeat(600)).length,500);
  for(const value of [null,42,{},[],undefined])assert.equal(normalizeResearchSearchQuery(value),'');
  assert.equal(normalizeResearchSearchQuery(' x '),' x ');
});
test('history is scoped and immutable and stores no result data',()=>{
  const original={router:{key:'keep'},other:9};const state=mergeResearchSearchHistory(original,'local:actor:space','caprock');
  assert.deepEqual(original,{router:{key:'keep'},other:9}); assert.equal(state.router,original.router);
  assert.equal(readResearchSearchHistory(state,'local:actor:space'),'caprock');
  for(const scope of ['browser:actor:space','local:other:space','local:actor:other'])assert.equal(readResearchSearchHistory(state,scope),'');
  assert.deepEqual(state['labvium.research-search.v1'],{scope:'local:actor:space',query:'caprock'});
  assert.equal(readResearchSearchHistory(mergeResearchSearchHistory(state,'local:actor:space',''),'local:actor:space'),'');
});
