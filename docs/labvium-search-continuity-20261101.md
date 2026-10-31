# Saved-evidence search continuity — 2026-11-01

## Reproduced issue
On the public `/LabVium/search` page, searching `caprock`, opening its cited
Reader result and pressing browser Back cleared the term. Researchers had to
retype an exact phrase or identifier to continue checking evidence.

## Change
- Preserve only the search input (up to 500 characters) on its browser history
  entry. Mode, account and workspace scope must match before restoration.
- Back/Forward and reload restore the input, with an explicit instruction to
  choose Search to check current saved material. No automatic search, cached
  results, URL query parameter or shared-data write is introduced.
- Restoration cancels a pending request and clears old results/errors, so late
  responses cannot appear as evidence for a restored term.
- Editing, including clearing the input, updates the current entry immediately.
  Router fields are preserved. History failure does not block ordinary search.
- Existing applied-query labels, failed-retry preservation and locale support
  remain unchanged. No API, database, permissions, PDF or research record change.

## Verification
The eight existing provenance tests and eight new continuity/pure-history tests
cover restoration without requests, scope isolation, pending-request abort,
blank/invalid/oversized input, router fields, unrelated-route guards, unavailable
history, escaping and Korean/English notices. Full tests, builds, asset-preservation
checks, deployment and public UI verification are recorded in the execution
receipt; passing source tests alone is not publication.
