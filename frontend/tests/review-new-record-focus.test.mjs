import assert from 'node:assert/strict';
import test from 'node:test';
import {focusNewReviewRecord} from '../app/lib/review/focus-new-record.mjs';
import {readFileSync} from 'node:fs';
test('focus targets the identified editor with instant header-safe scroll',()=>{
 const calls=[];const input={matches:s=>{assert.equal(s,':disabled');return false;},focus:o=>calls.push(['focus',o])};
 const record={querySelector:s=>{assert.equal(s,'textarea');return input;},scrollIntoView:o=>calls.push(['scroll',o])};
 const root={getElementById:id=>{assert.equal(id,'review-row-special:1');return record;}};
 assert.equal(focusNewReviewRecord(root,'row-special:1'),true);
 assert.deepEqual(calls,[['scroll',{behavior:'instant',block:'start'}],['focus',{preventScroll:true}]]);
});
test('removed, missing or disabled records never move focus',()=>{
 for(const record of [null,{querySelector:()=>null},{querySelector:()=>({matches:()=>true})}])assert.equal(focusNewReviewRecord({getElementById:()=>record},'missing'),false);
});
test('all explicit add paths share guarded handler and no initial autofocus',()=>{
 const code=readFileSync(new URL('../app/views/ProjectReviewView.tsx',import.meta.url),'utf8');
 assert.equal((code.match(/add=\{addRow\}/g)||[]).length,2);
 assert.match(code,/onClick=\{\(\) => addRow\(newReviewRow\(\)\)\}/);
 assert.match(code,/if \(readonly \|\| draft.rows.length >= 100\) return/);
 assert.match(code,/current.rows.length >= 100 \? current/);
 assert.match(code,/if \(!identity\) return/);
 assert.match(code,/pendingRowFocus.current = null/);
 assert.doesNotMatch(code,/autoFocus/);
});
