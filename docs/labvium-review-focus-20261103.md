# New review record focus — 2026-11-03

## Observed problem
On the public project review page, adding a comparison left focus on the top
workflow button while its new editor appeared below the viewport. Researchers
had to find the newly appended draft before entering their reasoning.

## Change
All explicit additions (comparison, decision/failure, first action, derived
record and ordinary review record) now move focus to that new record's research
text field after it renders. An instant header-offset scroll makes the editor
visible without animation. Derived text is not selected or replaced.

The request is consumed once. Initial loading, existing-field edits, refresh,
saving and later rendering do not trigger focus. Read-only/archived workspaces
and the 100-record cap remain enforced. No data schema, API, permissions,
source links, saved content, storage or snapshot behavior changed.

## Verification
Independent reviewer and behavioral tests cover all add paths, preserved prior
text/evidence, once-only focus, passive mount/edit/refresh, read-only/archived
states and the record cap. DOM helper tests cover exact identity, missing and
disabled targets. Execution receipt records full tests/build and public UI QA.
The local preview could not be reached from the separate browser environment;
this does not count as a successful browser preview.
