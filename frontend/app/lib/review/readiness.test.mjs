import test from 'node:test';
import assert from 'node:assert/strict';
import { blankReviewInput, newReviewRow, reviewCoverage, REVIEW_KINDS } from './model.mjs';
import { reviewReadiness } from './readiness.mjs';
function input() {
  const draft = blankReviewInput();
  const row = newReviewRow('question'); row.text = 'Which boundary condition needs checking?';
  draft.rows.push(row); for (const kind of REVIEW_KINDS) draft.checklist[kind] = true;
  return { draft, coverage: reviewCoverage(draft, []), viewer:false, archived:false, busy:false, dirty:false, evidenceChanges:0, staleSources:false, reviewedBy:'Researcher', snapshotCount:0 };
}
test('saved open question can be frozen without claiming it was verified', () => {
  const value = input(), before = JSON.stringify(value);
  assert.deepEqual(reviewReadiness(value), []); assert.equal(JSON.stringify(value), before);
});
test('each blocking condition is actionable and no information is silently changed', () => {
  const value = input(); value.draft = blankReviewInput(); value.coverage = reviewCoverage(value.draft, []); value.reviewedBy = '  '; value.dirty=true;
  assert.deepEqual(reviewReadiness(value).map(x=>x.code), ['empty','checklist','save','reviewer']);
  assert.deepEqual(reviewReadiness(value).find(x=>x.code==='checklist').kinds, REVIEW_KINDS);
});
test('rights, busy, stale evidence, source problems and retention are preserved', () => {
  const value = input(); Object.assign(value,{viewer:true,archived:true,busy:true,staleSources:true,evidenceChanges:2,snapshotCount:20});
  value.coverage.unsourced_reviewed_rows=['a']; value.coverage.missing_source_rows=['b']; value.draft.rows[0].text=' ';
  assert.deepEqual(reviewReadiness(value).map(x=>x.code), ['viewer','archived','busy','blank','unsourced','missing','changed','stale','limit']);
});
