# Library navigation continuity — 2026-10-19

## Observed issue
On production v64, filtering the library with `CCS`, opening the matching demo
paper, and using browser Back cleared the query and returned the entire list.
Researchers reviewing several papers had to reconstruct their filters each time.

## Change
Restore the search draft/applied query, tag, year, reading/archive status and
page offset from that library browser-history entry. Clear filters replaces that
entry's stored filters. History is isolated by the current actor/workspace scope;
queries are not added to URLs or shared workspace records. New library visits
start with default filters. Browser Back, Forward and reload can resume the
same entry. React hydration starts from consistent defaults and then restores.

## Scope
No database, PDF, paper, permissions, authentication or team changes. Preserve
router history fields and make failed history writes non-fatal. Values are
validated before use. Pending search text stays distinct from its applied query.

## Verification
Production issue reproduced in the cloud browser before editing. TypeScript,
static and Vinext builds passed. The complete automated suite passed 578/578 tests, including five pure history tests and five lifecycle tests. Independent review confirmed same-route Back/Forward, hydration, pending search and scope isolation.
Publication and post-release interaction receipts are recorded separately.
