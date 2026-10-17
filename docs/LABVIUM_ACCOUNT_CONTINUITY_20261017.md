# LabVium account storage and research continuity

This release updates the personal fork only. The read-only upstream remains
`Lilshawn-LSY/BluePrintReboot`. Publication belongs to the existing public
BANDAL Site, `appgprj_6ac4aedf72708191a95725b515d35593`.

## Product routes

- `/ku-ai/#/`: LabVium introduction with all twelve feature destinations.
- `/ku-ai/#/account`: platform sign-in, selected workspace, persisted counts,
  save time, and a preview/confirm flow for copying browser data to an empty
  account workspace. The browser original is retained.
- `/ku-ai/#/projects/:id/continuity`: dataset versions, code commits,
  environments, procedures, result links, source papers and review references;
  provider and manual evidence notices and their review outcomes.
- `/ku-ai/#/guide`: the Korean customer guide. The same guide is available at
  `/ku-ai/help/LabVium_User_Guide_KO.pdf`.

## Identity, persistence and conflicts

Platform-supplied identity remains the only account identity. D1 workspaces and
private R2 objects retain their existing keys. No new OAuth provider or shadow
user database is introduced. A failed session/access lookup pauses editing;
it cannot silently present the guest workspace as the account workspace.

Successful account writes publish a small client event. A visible tab checks
workspace revision on focus and every thirty seconds. Remote changes produce
a reload notice instead of overwriting open editors. Existing per-record
revision checks and the workspace CAS still reject stale writes.

## New persistent state

The optional `project.continuity` field is validated on load, save, backup and
restore. Legacy projects are read without generating or rewriting this field.
It retains up to 100 reproduction records and 200 evidence notices. The latest
explicit provider check retains one batch of up to six paper results.

Manual notices identify themselves as manual. Automatic checks query only the
allowlisted OpenAlex and Crossref APIs for exact DOI matches. OpenAlex's explicit
retraction marker and Crossref's deposited `updated-by` notices are recorded;
ordinary metadata timestamp changes and citations are not treated as
corrections. Unavailable providers remain unknown. This is an on-demand check,
not scheduled monitoring or an automated scientific validity judgment.

Open notices propagate from paper evidence through comparison references,
decisions and handoff origins. Affected records appear in both continuity and
review views. A new handoff snapshot is blocked until the notice's human review
outcome is recorded. Old snapshots and notices remain retained.

Handoff context adds optional first-reading, reading-rationale, required-files,
first-task and open-question fields. They survive validation, snapshot capture
and Markdown export; old snapshots require no migration.

## Sharing and ownership

Only an owner may transfer a non-personal workspace to an already accepted
member. The previous owner becomes an editor. An atomic D1 batch guards every
write with the current owner, recipient membership and permission revision.
User IDs, workspace IDs and private object paths are not moved or rewritten.
The app sends no invitation or transfer emails.

## Backup fixes

Portable exports are standalone archives, without the API revision envelope
that previously made re-import fail. Scoped direct export URLs authorize the
selected workspace. Bundled sample PDF keys now follow the portable import
contract. The actual browser export is tested against cloud archive validation.

## Delivery verification

TypeScript, frontend builds, existing frontend/domain tests, real SQLite D1
fixtures, account transport tests and new reproduction/evidence/transfer tests
are run before publication. Tests use disposable records and fake identities.
They do not log in to a customer's account or inspect existing research data.

Managed browser QA is unavailable because the required control-browser skill
is not installed. Physical cross-device sign-in and visual browser interaction
must not be represented as manually verified. PDF pages are rendered and
visually inspected separately.

Generative AI remains disconnected until the owner supplies a server API key.
The optional dedicated hostname has been registered with Sites but requires
authoritative DNS verification before it can be advertised as live. The working
publication address remains `https://bandal.app/ku-ai/` until that verification.
