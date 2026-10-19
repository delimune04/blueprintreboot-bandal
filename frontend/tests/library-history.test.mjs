import assert from 'node:assert/strict';
import test from 'node:test';
import {DEFAULT_LIBRARY_FILTERS as defaults,readLibraryHistory,mergeLibraryHistory,normalizeLibraryFilters} from '../app/lib/library/library-history.mjs';
test('all filters and page survive a paper visit and return to the original entry',()=>{
 const filters={searchInput:'CCS',q:'CCS',tag:'reservoir',tagInput:'reservoir',year:'2026',readingStatus:'reading',archiveStatus:'all',offset:40};
 const original={__NA:true,tree:['library']}; const library=mergeLibraryHistory(original,'user:workspace',filters);
 const paper={}; assert.deepEqual(readLibraryHistory(paper,'user:workspace'),defaults);
 assert.deepEqual(readLibraryHistory(library,'user:workspace'),filters); assert.deepEqual(original,{__NA:true,tree:['library']});
 assert.deepEqual(library.tree,['library']); assert.equal(library.__NA,true);
});
test('workspace and actor switches never restore another workspace query',()=>{
 const state=mergeLibraryHistory(null,'userA:workspaceA',{...defaults,q:'private',searchInput:'private'});
 for(const scope of ['userA:workspaceB','userB:workspaceA','browser:']) assert.deepEqual(readLibraryHistory(state,scope),defaults);
});
test('clear replaces the remembered values without adding history entries',()=>{
 const before=mergeLibraryHistory({router:1},'scope',{...defaults,q:'x',offset:20});
 assert.deepEqual(readLibraryHistory(mergeLibraryHistory(before,'scope',defaults),'scope'),defaults);
});
test('malformed, oversized, and incomplete state remains bounded and usable',()=>{
 for(const state of [null,undefined,{},[],{['labvium.library.v1']:{scope:'s',filters:null}}]) assert.deepEqual(readLibraryHistory(state,'s'),defaults);
 assert.deepEqual(normalizeLibraryFilters({offset:-20,archiveStatus:'delete',readingStatus:'unknown',q:42}),defaults);
 assert.equal(normalizeLibraryFilters({offset:39}).offset,20);
 assert.equal(normalizeLibraryFilters({q:'x'.repeat(501)}).q.length,500);
 assert.equal(normalizeLibraryFilters({offset:Infinity}).offset,0);
});
test('draft query and applied query remain distinct across quick navigation',()=>{
 const filters={...defaults,q:'old',searchInput:'new',offset:20};
 assert.deepEqual(readLibraryHistory(mergeLibraryHistory(null,'s',filters),'s'),filters);
});
