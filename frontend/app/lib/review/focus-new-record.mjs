// The caller supplies an explicitly added record, never an initial/loaded row.
export function focusNewReviewRecord(root, identity) {
  const record = root.getElementById(`review-${identity}`);
  const input = record?.querySelector('textarea');
  if (!input || input.matches(':disabled')) return false;
  // Instant movement respects reduced-motion preferences and avoids racing focus.
  // The record's scroll-margin keeps its heading below the fixed application bar.
  record.scrollIntoView({ behavior: 'instant', block: 'start' });
  input.focus({ preventScroll: true });
  return true;
}
