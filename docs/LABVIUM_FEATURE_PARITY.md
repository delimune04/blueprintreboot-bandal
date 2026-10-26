# 랩비움 hosted workflows and parity limits

This matrix distinguishes implemented interfaces from workflow replacements and
from capabilities that still require the original Python application. It is a
source-level inventory; it does not claim that production hosting, login or live
provider calls passed testing merely because a route exists.

| Workflow | Hosted account | Guest browser | Original local application |
| --- | --- | --- | --- |
| Dashboard, catalogue, Paper Detail, Reader | Unified account API transport | IndexedDB-backed adapter | Existing Python API |
| Explicit metadata, note, reading-state and tag saves | Expected-revision commands | Revision/checksum guarded commands | Existing command/service layer |
| PDF file upload | Account storage endpoint | Actual PDF blobs, checksum checks | Managed filesystem upload service |
| PDF folder inbox | Browser folder picker copies selected PDFs | Same safe copy workflow | External/local synced-folder inbox |
| Local arbitrary path scan or rename | Not exposed as a cloud filesystem operation | Not exposed | Streamlit/service workflow remains available |
| PDF text extraction and cached text | Account Reader integration | Actual PDF.js extraction | Existing extraction service |
| Optional scanned-page OCR | Opt-in browser Tesseract recognition; authenticated save of actual text/provenance | Opt-in browser Tesseract, English + Korean models | Original provider configuration; not established by this web implementation |
| External metadata enrichment | Preview/apply through the account service | Direct Crossref lookup with same-origin discovery fallback; preview before apply | Existing enrichment services |
| Typed Note Blocks and Project links | Account commands | Guest commands, source provenance | Existing API/service contracts |
| Project/block removal and recovery | Explicit maintenance commands | Retained recovery snapshots | Existing broader Streamlit lifecycle tooling |
| Paper/project archive undo | Unarchive commands | Unarchive commands | Existing local state; API parity depends on local backend version |
| Paper priority and managed attachment name | Guarded priority and name commands | Guarded priority save and logical attachment rename; stable paper identity | Original metadata/file hygiene services |
| Text-cache quarantine and recovery | Confirmed quarantine + recovery | Actual cached-text snapshot, checksum verification and guarded recovery | Existing rebuildable-cache services |
| Paper search-profile rebuild | Derived profile endpoint; no claimed LLM run | Not implemented in guest mode; controls remain capability-gated | Existing profile service |
| Canonical-tag merge and similar-name review | Preview-token guarded merge with record impact | Not implemented in guest mode; controls remain capability-gated | Existing tag governance services |
| Relationship edits | Explicit PATCH command | Explicit PATCH command | Local native contract may not include hosted extension |
| External `.md`/`.txt`/`.docx` note import | Preview + confirmed import endpoints | Single state transaction, SHA source history | Existing Streamlit note-import service |
| Research pages and editable hierarchy | `/research/pages` account routes | Versioned guest pages store | Hosted extension, no claimed original Python parity |
| Page templates and research handoff | Editable prompt templates | Same prompts, no invented findings | Hosted extension |
| Search saved research evidence | `/search` account endpoint | Literal saved-state search | Hosted extension; no claim of embedding search |
| Crossref/arXiv/OpenAlex discovery | Current scholarly API queries | Same public discovery backend | Hosted extension |
| OpenAlex references/citing works | Provider's actual relationship endpoints | Same public discovery backend | Hosted extension |
| Author h-index | OpenAlex author profile field or unavailable | Same verified profile lookup | No fabricated or paper-level score |
| Cited AI answers | Optional authenticated server route; disconnected without a server key | No hosted AI connection claimed | Depends on the original application's own provider setup |
| Cloud snapshot download/restore | Account-bound snapshot and confirmed restore | Not a cloud snapshot | Local ZIP snapshot service |
| Portable export | `/exports/workspace`, coverage reported by returned data | Records + actual PDF bytes + research pages | Existing full/light ZIP archive |
| Downloaded backup import | Validated staged import preview + confirm | Validated byte hashes + confirm | Original ZIP verification; extraction originally manual |
| Health refresh | Safe diagnostic read model | Validated state + attachment diagnostics | Broader filesystem integrity checks |
| Critical-state quarantine/manual orphan deletion | No unsupported button | No unsupported button | Existing local advanced services |
| Separate lab/company workspaces and owner/editor/viewer roles | Implemented workspace creation/switching, trusted-login membership, owner-managed email grants and guarded reads/writes | Isolated device workspace, not multi-user sharing | Single-user original application |
| Real-time coediting, organization SSO, advanced activity audit | Proposed, not implemented by ordinary workspace membership | Not applicable | Not provided |

## Web maintenance workflow

`MaintenanceView` loads the workspace revision, backup registry, recovery list,
paper/project catalogue and safe settings diagnostics. It provides only concrete
commands: create/download backup; preview imported archive; confirmed restore;
preview/apply external notes; file/folder PDF upload; restore archives; edit
project relationships; explicitly delete saved blocks/projects; and restore
recovery snapshots. Priority changes, managed attachment names, cache quarantine,
search-profile rebuild and tag merge/review are exposed through their concrete
revision-guarded endpoints. External-note and advanced-maintenance controls are
capability-gated. Viewers see read-only research surfaces; state-changing
maintenance controls remain disabled.

The folder picker is a web copy workflow, not unattended access to an arbitrary
path or an operating-system watcher. The user selects the files. Cloud metadata
snapshots that contain only PDF references are labeled accordingly and are not
described as offline PDF backups.

Health refresh re-reads diagnostics. It must never imply that corrupt critical
state has been repaired, quarantined, normalized or discarded. Cache extraction
and PDF reconnect belong to their implemented Reader/upload command boundaries.
No guessed repair-success controls are introduced. Rebuilding a search profile
uses saved metadata/text and does not invent research findings. Tag similarity is
a review hint, while applying a merge requires a reviewed impact preview tied to
the current workspace state.

## OCR, metadata and AI boundaries

The OCR action runs Tesseract on the user's device after explicit invocation.
It downloads the pinned English and Korean language models on first use and
uses a local cache where available. A run accepts at most 20 scanned pages;
larger selections are rejected rather than silently skipping pages. Recognition
progress, cancellation, source PDF checksum, recognized page numbers and engine
confidence are recorded. Existing cached text is retained when recognition
fails or is cancelled. Actual confidence values are not an accuracy guarantee,
and OCR does not create PDF selection/highlight coordinates for scanned images.

Guest metadata lookup first requests Crossref directly, then can use the
same-origin discovery endpoint when direct retrieval is unavailable. Returned
candidates are still reviewed before a metadata save; a failed lookup does not
invent bibliographic information.

The cited-answer server route is optional. The current deployment configuration
has no server AI key, so AI remains disconnected and no model output is claimed.
Manual research, pasted-AI provenance labels, OCR and deterministic profile/tag
operations must not be presented as a connected LLM feature. Basic separate
lab/company workspaces and owner/editor/viewer permissions are implemented;
real-time coediting, organization SSO and advanced activity auditing remain
future extensions. No actual members were added or invitation emails sent by
this implementation work.

## New research-page invariants

- Parent IDs must exist; cycles and duplicate page/block IDs are rejected.
- Text/collection sizes and URLs are bounded. Only HTTP(S) web source URLs are
  permitted; paper source links use stable paper IDs.
- Manual and pasted-AI provenance remain explicit. The notebook does not invent
  a generator execution, verification or citation.
- Draft block changes, reorder and removal remain local to the editor until
  **Save page**. Navigating away warns about unsaved content.
- Save commands guard the entire page registry revision. A stale draft must be
  reviewed/reloaded before retrying; it is never silently used to overwrite newer
  state.
- Guest restore also checks that pages did not change after its preview. Research
  page recovery is retained separately from the PDF/metadata IndexedDB recovery.

## Verification performed by the feature owner

Focused deterministic checks in `frontend/app/lib/workspace/` cover:

- Unsaved edits staying outside durable state, stale revision rejection and
  hierarchy-cycle rejection.
- Archive undo retaining content and stable identities.
- Corrupt storage and quota failures preserving existing bytes.
- Protocol-safe source links and templates containing no invented findings.
- Complete guest backups carrying three bundled PDFs and research pages.
- Restore refusing to overwrite research edits made after preview.
- Saved research search and aborted requests.

Commands:

```sh
cd frontend
node --test app/lib/workspace/pages.test.mjs app/lib/workspace/browser-request.test.mjs
npx tsc --noEmit --incremental false
npx eslint app/views/ResearchWorkspaceView.tsx app/views/DiscoverView.tsx app/views/MaintenanceView.tsx app/lib/workspace
```

Additional account login, live discovery, cross-device persistence, visual and
restore acceptance checks belong to the integration owner. Record their actual
results separately; source-level parity does not establish them.

## Reader zoom and two-screen notes (2026-10-26)

The managed PDF reader supports 10–300% zoom presets and width/page fitting,
including below 50% for short or narrow viewports. A page render failure leaves
navigation/zoom available and displays retry/fallback actions above the document.

Use **Dual monitor · notes window** to move the existing notes/blocks and optional
AI source-review panel into a companion window, then drag that window to another
monitor. This moves one live React editor, rather than duplicating editable state.
Source-page links still control the original PDF. Close the companion or choose
**Bring notes back** to return it without saving or discarding drafts. Keep the
original PDF window open. Popup blocking is reported without changing the layout.
Link and metadata dialogs return to the main window before opening. No screen
permission, account/data sharing change, or additional model connection is used.
