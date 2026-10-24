import test from 'node:test';
import assert from 'node:assert/strict';
import { findReviewRecords } from './navigation.mjs';
const rows = [
  { id:'one', text:'Check baseline drift',owner:'Kim',due_date:'2026-11-01',status:'open' },
  { id:'two',text:'조건 비교',owner:'Lee',due_date:'',status:'reviewed',context:{method:'Detector A',conditions:'300 K',rationale:'온도 보정 필요',comparison_ids:['one']} },
  { id:'three',text:'Unresolved drift question',owner:'Lee',due_date:'',status:'open' },
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
