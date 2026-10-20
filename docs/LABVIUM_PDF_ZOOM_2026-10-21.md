# PDF reading-position continuity — 2026-10-21

## Observed on public v66
While reading the table on page 2 of the authored CCS sample, increasing zoom
from 120% to 145% moved the visible source toward the previous page/footer.
A second measurement showed the page-relative viewport center changing from
0.19671 to 0.15721 instead of retaining the same source position.

## Change
- Manual zoom, 100% reset and width/page fit retain the page-relative vertical
  source position at the viewport center, using the existing layout anchor.
- Rapid successive changes keep the first anchor until final geometry commits.
- Explicit page navigation supersedes a pending anchor; only the latest page
  jump remains scheduled. Paper switches and unmount cancel pending frames.
- Memo/panel layout changes retain the existing fit-then-restore ordering.
  Late canvas completion cannot consume a newer geometry anchor.
- Same-scale mode changes do not manufacture another render. A loaded-paper
  guard prevents a prior paper's page preference from reaching the new paper.
- This is viewport continuity, not a new saved bookmark or horizontal-pan feature.
  Scroll limits still apply at the document boundaries.

## Verification
- 18 new real-component lifecycle checks; full Node suite 625/625 passed.
- TypeScript, native Vinext build, hosted static build, scoped ESLint passed.
- Python smoke:149 passed,0 failed,1 optional markitdown warning.
- Full Python pytest:854/854 passed; pinned dependency consistency check passed.
- Independent review found and corrected a memo-layout scheduling regression;
  zoom/memo/interaction review suite31/31 passed afterward.
- Full-project ESLint still reports9 pre-existing errors in8 byte-unchanged
  files plus1 existing logo warning. No full-lint success is claimed.
- Local preview could not be reached in this environment. Public interaction
  verification, deployment and email receipts are recorded separately.

No API, database, migration, PDF bytes, note content, authentication or access
changes. Unrelated BANDAL service assets must remain unchanged during integration.

## Separate observation, not fixed here
Entering the current/out-of-range page number can leave the existing rendering
indicator or unnormalized input visible. This predates the zoom change and is
not included in its completion claim.
