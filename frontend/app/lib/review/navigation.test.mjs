import test from 'node:test';
import assert from 'node:assert/strict';
import { findReviewRecords } from './navigation.mjs';
const rows = [
  { id:'one', kind:'hypothesis', text:'Check baseline drift',owner:'Kim',due_date:'2026-11-01',status:'open' },
  { id:'two',kind:'failed_attempt',text:'조건 비교',owner:'Lee',due_date:'',status:'reviewed',context:{method:'Detector A',conditions:'300 K',rationale:'온도 보정 필요',comparison_ids:['one']} },
  { id:'three',kind:'question',text:'Unresolved drift question',owner:'Lee',due_date:'',status:'open' },
];
test('search and status combine, with stable original row numbers and identity', () => {
  const result=findReviewRecords(rows,' drift  LEE ','open');
  assert.equal(result.length,1);assert.equal(result[0].row,rows[2]);assert.equal(result[0].number,3);
});
test('search covers method, conditions, Korean notes and due dates', () => {
  for(const query of ['detector 300','온도 보정','Ｄｅｔｅｃｔｏｒ']) assert.equal(findReviewRecords(rows,query)[0].row.id,'two');
  assert.equal(findReviewRecords(rows,'2026-11-01')[0].row.id,'one');
});
test('empty and unmatched queries, status changes and clearing never mutate dossier', () => {
  const before=JSON.stringify(rows);assert.equal(findReviewRecords(rows,'').length,3);
  assert.equal(findReviewRecords(rows,'unknown').length,0);assert.equal(findReviewRecords(rows,'','reviewed').length,1);
  assert.equal(findReviewRecords([]).length,0);assert.equal(JSON.stringify(rows),before);
});

test('record kind intersects with search and review status without changing original numbering', () => {
  const before = JSON.stringify(rows);
  assert.deepEqual(findReviewRecords(rows,'Lee','open','question').map(x => x.number), [3]);
  assert.equal(findReviewRecords(rows,'Lee','reviewed','question').length, 0);
  assert.equal(findReviewRecords(rows,'300','reviewed','failed_attempt')[0].row, rows[1]);
  assert.equal(findReviewRecords(rows,'','all','next_action').length, 0);
  assert.equal(findReviewRecords(rows,'','all','all').length,3);
  assert.equal(JSON.stringify(rows), before);
});
test('every record kind can be selected alone and with identical text', () => {
  const kinds = ['hypothesis','decision','failed_attempt','question','next_action'];
  const mixed = kinds.map((kind,index)=>({...rows[0], id:String(index), kind}));
  for (const [index, kind] of kinds.entries()) {
    const result = findReviewRecords(mixed,'drift','open',kind);
    assert.equal(result.length,1); assert.equal(result[0].row,mixed[index]);
    assert.equal(result[0].number,index+1);
  }
});
