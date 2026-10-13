# BANDAL Personal Fork Scope

This checkout belongs to `delimune04/blueprintreboot-bandal`, an independent
personal demonstration fork. `Lilshawn-LSY/BluePrintReboot` is read-only upstream.
Never commit, push, create a branch or PR, or change settings in the upstream
repository. All requested personal edits belong only to this fork.

The hosted demo is built with `cd frontend && npm run demo:build` and mounted at
`https://bandal.app/ku-ai/`. The normal local Python/Vinext application remains
the default runtime. Demo mode is opt-in and stores sample-workspace changes in
this browser only; it must never claim server saves, real publication data, or
an LLM integration. Preserve upstream author attribution.

Do not reuse the upstream `frontend/.openai/hosting.json` Site identity. Hosting
publication belongs to the BANDAL Site checkout, with current source fetched
before a bounded update. Preserve the homepage and unrelated services.

When opening this fork, configure `git config core.hooksPath .bandal-hooks`.
The tracked pre-push hook permits only the personal repository. Connector API
writes must independently verify the exact personal repository target.

# BluePrintReboot Agent Guide


## Purpose


BluePrintReboot is a local-first, single-user research workspace for reading,
annotating, organizing, linking, and retrieving scientific papers.


Prefer changes that improve the core research workflow, data integrity,
reliability, maintainability, or release readiness.


Do not introduce unrelated architecture, hosted-service assumptions,
multi-user behavior, or speculative infrastructure.


## Before Implementing


Before changing code:


1. Inspect the existing implementation and tests for the affected subsystem.
2. Read the relevant repository documentation instead of guessing architecture.
3. Prefer extending an existing pattern over introducing a parallel abstraction.
4. Identify the persistent state and invariants affected by the change.
5. Keep the task bounded to the requested feature.


Use these documents as the primary repository guidance:


- `README.md` — current product/runtime overview.
- `docs/BLUEPRINT_PRINCIPLES.md` — product scope and local-first principles.
- `docs/DEV_WORKFLOW.md` — development and validation workflow.
- `docs/LIFECYCLE_AND_RECOVERY_CONTRACT.md` — storage and recovery safety.
- `docs/READ_ONLY_DOMAIN_CONTRACTS.md` — read-side API/domain boundaries.
- `docs/READER_NOTE_STATE_MACHINE.md` — Reader note state behavior.
- `docs/READER_FRONTEND_PARITY_CHECKLIST.md` — Reader/frontend parity invariants.
- `docs/RELEASE_CHECKLIST.md` — release-specific acceptance criteria.
- `docs/CURRENT_RELEASE_STATUS.md` — current generated release status.


Read only the documents relevant to the task, but do not bypass an applicable
contract because it was not explicitly mentioned in the user prompt.


## Architecture


Preserve the established layered architecture unless the task explicitly
requires changing it:


- local files and stores own persistent state;
- services/read models own domain behavior;
- FastAPI exposes bounded, explicit contracts;
- the frontend consumes those contracts;
- Streamlit remains a supported interface where existing parity requires it.


Do not bypass service or command boundaries by writing directly from API or UI
code into storage when an established domain boundary exists.


Prefer one coherent vertical slice over duplicated implementation paths.


## Data Safety


Runtime research data is user-controlled and must be treated conservatively.


Do not casually inspect, rewrite, delete, migrate, normalize, or regenerate:


- `papers/`
- runtime contents of `data/`
- runtime contents of `notes/`
- `exports/`
- extracted-text caches
- personal configuration or research data


Use test fixtures, temporary directories, mocks, or disposable stores for
automated tests.


Preserve stable identities such as `paper_id`.


Never silently replace corrupt critical user state with an empty store.
Never invent repair success.
Never auto-delete or auto-merge user data unless an explicitly approved
contract requires it.


Destructive or irreversible actions must remain explicit and confirmation-gated.


## Write Semantics


Preserve existing safety patterns where applicable:



Fix regressions caused by the task before finishing.

For documentation-only or repository-guidance-only changes, the full code gate
is not required unless the changed document participates in generated release
state or the task explicitly requires it. At minimum run:

git diff --check
git status --short

Never claim a manual browser check, real-data validation, hosted CI run, merge,
tag, GitHub Release, or external tracker update unless it was actually
performed and observed.

Git and Release Control

The user is the product owner and final release authority.

Unless explicitly requested:

do not create or switch branches;
do not commit;
do not push;
do not open or merge pull requests;
do not create tags or GitHub Releases;
do not modify external roadmap/tracker state.

At the end of an implementation task, leave the working tree ready for review
and report:

what was implemented;
the materially changed files or subsystems;
tests and validation actually run;
any unresolved risks, assumptions, or manual checks still required.
Environment

The supported cloud development environment is GitHub Codespaces.

Expected workspace:

/workspaces/BluePrintReboot

Python dependencies live in .venv.
Frontend dependencies are installed from the committed lockfile with npm ci.

The frontend requires Node.js 22.13 or newer.

Do not hard-code the historical Windows portable-Node path into
cross-platform application code.

Windows PowerShell scripts remain supported for Windows development and should
not be removed merely because Codespaces uses Linux.

Decision Rule

When several implementations are possible, prefer the one that:

preserves user data most conservatively;
reuses existing architecture and contracts;
is easiest to verify with deterministic tests;
introduces the least new state and hidden behavior;
keeps the local-first research workflow understandable to one user.
