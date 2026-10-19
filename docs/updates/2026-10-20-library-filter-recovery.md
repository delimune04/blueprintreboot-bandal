# Library filter recovery — 2026-10-20

## Observed workflow
On public v65, searching for `muon` while selecting Finished returned no papers.
The Korean active summary displayed the internal enum `finished`, offered only
reset-all, and suggested finding/importing papers instead of relaxing criteria.

## Change
- Removable chips show search, tag, year, reading status and nondefault archive scope.
- Removing one criterion preserves the rest, resets pagination and closes stale
  inspection/enrichment state. Keyboard focus returns to the associated input.
- Search removal cancels a pending debounce; pending and clearing search are
  labeled separately from the applied query.
- Korean and English labels are human-readable. The table heading identifies
  reading status instead of naming one status. Research text is not translated.
- Restrictive-filter emptiness suggests changing criteria. Empty all-papers
  and active-only views provide appropriate discovery/import guidance.
- Existing actor/workspace-scoped Back, Forward and reload restoration remains.

## Boundaries
Client-only changes. No database, API, PDFs, paper records, migrations, account
access, permissions, authentication or unrelated BANDAL service changes.

## Verification
- TypeScript noEmit and scoped ESLint passed.
- Native Vinext and hosted static builds passed.
- Complete frontend/domain/hosting Node suite passed 607/607 tests.
- 29 added lifecycle/localization checks cover removal, preserved criteria,
  pagination, inspector reset, focus targets, pending search, history, empty
  states and colon-containing research text.
- Independent review found no remaining substantive issues after fixes.
- Local preview infrastructure was unreachable from the cloud browser; public
  browser interaction is verified separately after deployment.
- Python backend checks were not run: this UI-only environment has no pytest.

Publication, public interaction and email receipts are recorded separately.
