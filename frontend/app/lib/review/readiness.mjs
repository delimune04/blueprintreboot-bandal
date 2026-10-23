import { REVIEW_KINDS, REVIEW_MAX_SNAPSHOTS } from './model.mjs';

// Presentation only: never marks a record reviewed or changes the save contract.
export function reviewReadiness({ draft, coverage, viewer, archived, busy, dirty, evidenceChanges, staleSources, reviewedBy, snapshotCount }) {
  const reasons = [];
  if (viewer) reasons.push({ code: 'viewer' });
  if (archived) reasons.push({ code: 'archived' });
  if (busy) reasons.push({ code: 'busy' });
  if (!draft.rows.length) reasons.push({ code: 'empty' });
  if (draft.rows.some(row => !row.text.trim())) reasons.push({ code: 'blank' });
  const missing = REVIEW_KINDS.filter(kind => !draft.checklist[kind]);
  if (missing.length) reasons.push({ code: 'checklist', kinds: missing });
  if (coverage.unsourced_reviewed_rows.length) reasons.push({ code: 'unsourced', count: coverage.unsourced_reviewed_rows.length });
  if (coverage.missing_source_rows.length) reasons.push({ code: 'missing', count: coverage.missing_source_rows.length });
  if (evidenceChanges) reasons.push({ code: 'changed', count: evidenceChanges });
  if (staleSources) reasons.push({ code: 'stale' });
  if (dirty) reasons.push({ code: 'save' });
  if (!reviewedBy.trim()) reasons.push({ code: 'reviewer' });
  if (snapshotCount >= REVIEW_MAX_SNAPSHOTS) reasons.push({ code: 'limit' });
  return reasons;
}
