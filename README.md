# 랩비움 · BANDAL personal fork

Research reading, evidence capture, related-paper discovery and lab handoff on
[bandal.app/LabVium](https://bandal.app/LabVium). This independent repository belongs
to `delimune04/blueprintreboot-bandal` and retains the work and attribution of
Seoyeon Lee (Lilshawn-LSY) and Sanghyeon Park. The upstream repository is read-only.

- KR/EN interface, PDF reading, source-linked evidence blocks and research pages.
- Browser workspaces persist records and PDF bytes in IndexedDB. Authenticated
  personal/team workspaces use D1 and private R2 objects; owner/editor/viewer
  authorization is checked on the server. Sharing requires an explicit owner
  action; creating a workspace does not share existing personal material.
- Current scholarly discovery uses actual Crossref/arXiv/OpenAlex data. Missing
  author h-index or citation counts are unavailable rather than estimated.
- Explicit extraction/OCR, revision protection, verified backups and recoverable
  operations preserve source identities and existing Reading Note formats.
- Generative AI is optional and requires a server-side API key. With no key the
  assistant reports that it is disconnected and does not generate sample answers.

Build the hosted interface with `cd frontend && npm ci && npm run demo:build`.
The build prepares pinned, self-hosted OCR worker/core assets. English/Korean
recognition models download only after an explicit OCR action. See
[feature parity](docs/LABVIUM_FEATURE_PARITY.md),
[product direction](docs/LABVIUM_PRODUCT.md), and
[hosting integration](hosting/ROOT_INTEGRATION.md) for supported workflows and
platform limits. Never reuse the upstream Site identity for publication.

The following documentation describes the retained original local application
and its v1.6.5 release baseline; hosted extensions are documented above.

## Interactive paper relationship map

The project research map now uses a dark 3D sphere-and-link view with rotation,
zoom, pan, paper selection and current-view SVG export. Available scholarly
metadata drives approximate 3D distances; no generative model or API key is
required. See [3D map usage and distance method](docs/LABVIUM_3D_MAP.md).

Additional sign-in methods are documented in [the authentication rollout plan](docs/LABVIUM_AUTH_ROLLOUT.md).
They are configuration proposals. ChatGPT remains the only activated hosted
sign-in method until dedicated provider applications and authentication settings
are supplied and verified. Existing account ownership is unchanged.

## Lab collaboration

`/LabVium/collaboration` brings a shared monthly calendar, idea review threads,
assigned tasks and a personal notification inbox into the selected workspace.
Owners and accepted editors can share and edit events, ask for feedback in either
direction, and assign a task to an accepted editor. The task assignee reports
progress and submits work; its original assigner or the workspace owner confirms
completion. Calendar deadlines use Korean dates, with a visible six-day default
that can be changed before creation.

Saved papers, projects and research pages have an **이 아이디어 어때요?** action
that opens a discussion with its source. The composer can address named workspace
members. All discussion content remains visible to the workspace; recipients
control in-app notifications, not private access. Invite collaborators through
the existing team settings and grant editing permission before working together.
Guest mode stores only this browser's own records and has no shared roster.

Changes use revision checks, preserve drafts after conflicts and retain stable
request IDs for safe retries. Refreshes load new snapshots; simultaneous text
coauthoring, email delivery and external calendar synchronization are not enabled.
The updated in-app guide covers collaboration. The downloadable October 17 core
PDF remains separately labeled. See the
[collaboration contract](docs/LABVIUM_COLLABORATION_CONTRACT.md).

## Finding a specific paper

The **논문 찾기** page combines Crossref, arXiv and OpenAlex by default, with
individual sources still selectable. Search a title or topic together with an
author, or use an author name alone. Exact-title matching is optional. Results
show the applied criteria, authors, publication date, venue, available
affiliations and DOI/arXiv identifiers so equal titles remain distinguishable.
Only shared stable identifiers collapse duplicates; a title alone never merges
two publications.

Ordering supports relevance, citation count, newest, oldest and popularity.
Relevance prioritizes exact titles; equal-title matches use earliest publication
first so later reuploads do not bury a dated source solely for missing citations.
Popularity explicitly means cumulative citations divided by
`current year - publication year + 1`, within the bounded retrieved candidates;
it is not a usage or paper-quality metric. Missing metrics remain unavailable.
arXiv alone supports relevance and publication-date ordering, with no citation
or popularity option. Source failures are disclosed while successful sources
remain usable. The applied order and scope are displayed separately from draft
filters, which take effect when **검색** is chosen.

## What is BluePrintReboot?

BluePrintReboot is a local-first research workspace with an established Streamlit interface, a bounded FastAPI layer, and a desktop-first web Reader. It keeps PDFs, metadata, BluePrint Reading Notes, structured note blocks, project links, tags, and extracted text on the local machine.

The canonical managed PDF directory is `papers/`. Paper identity is the stable `paper_id` stored in `data/paper_index.csv`; Reading Notes, note blocks, project links, and extracted-text caches remain attached to that identity even when a PDF filename changes.

## Current Status

Current runtime target: **v1.6.5-visual-language-design-system-refinement**.

v1.6.5 is a visual language and design-system refinement. The desktop workspace
now uses a restrained hierarchy of technical rules, flatter collection and
document surfaces, tighter working geometry, structural mono metadata, and
quiet ordinary status labels. Dashboard is a workbench; Library and Tags are
catalogue surfaces; Project Detail is a dossier; Settings is a utility surface;
and Reader keeps minimal, hairline workspace chrome. Explicit saves,
browser-local drafts, conflict safety, stable routes, PDF identity, PDF
fit/zoom behavior, and local-first storage remain unchanged.

v1.6.0 focuses on the desktop Reader workspace: the PDF remains central, Paper and Note composition lives together in the right panel, and compact Tags/Full Text utilities open from the left without affecting the global Reader-navigation overlay. Paper Notes continue to save Markdown-compatible plain text explicitly, with Markdown-aware formatting and an optional rendered preview.

v1.5.12 closes the R-145 PDF foundation that v1.6.0 retains. The PDF.js Reader renders its backing canvas at `clamp(devicePixelRatio × 1.5, 1, 3)` while logical zoom, CSS dimensions, text-layer geometry, and page-normalized selection coordinates remain unchanged. Native fallback remains exclusive, and page/zoom changes still perform PDF.js rerenders while reusing the loaded document.

Full-text extraction now prefers the default pinned `pdf-inspector==0.2.6` adapter, then falls through to MarkItDown and pypdf. The adapter normalizes all upstream page fields to BluePrint's 1-based convention and produces BluePrint-owned document classification, per-page extraction/OCR state, Markdown/text, positioned-text data, provider information, and the cache's source-PDF revision. One deterministic page-ordered projection feeds the existing extracted-text cache and profile consumers. Extraction metadata distinguishes not-extracted, success, cached, stale, failed, and OCR-needed states; OCR-needed pages are not treated as generic failures, and valid previous caches remain preserved after failed refreshes.

Metadata enrichment preview reuses that canonical local PDF evidence path. One preview request uses a current SHA-256-validated extraction cache when available; otherwise it performs one bounded, non-persisting `pdf-inspector` -> MarkItDown -> pypdf pass and reuses the result for DOI and arXiv detection, PDF-profile parsing, and title fallback. Preview never creates, refreshes, or replaces the Full Text cache.

The Reader now includes a compact Full Text section backed only by the local FastAPI extraction service. Status reads are automatic, but extraction and re-extraction are explicit commands. Cached Markdown/plain text is displayed as escaped text, never third-party HTML. No automatic import extraction, background worker, OCR engine, search, selection persistence, Research Block capture, or Reader redesign is included.

v1.5.11 remains the completed **Library** workflow baseline: managed-PDF scan/import, server-backed metadata search and pagination, filters, explicit enrichment preview/selective apply, Paper Detail/Reader navigation, and exact-content reconnect for a missing managed PDF. `/papers/{paper_id}` and `/papers/{paper_id}/reader` remain stable canonical resource URLs.

v1.5.10 completes the bounded tag-management workflow. The Tag Book is now a canonical registry with explicit create, metadata/category edit, alias, and deprecate commands protected by a registry revision and the shared workspace lock. Canonical identities and aliases must be unique under the established normalization rule; a deprecated tag remains visible and historical Paper tag values, including legacy/noncanonical values, are never silently rewritten or deleted.

Paper-scoped tag candidates are persisted review records, not Paper tags. Generate/view candidates is non-mutating; a user can approve, reject, or promote an unresolved candidate to an active canonical tag. Only the separate **Apply** action uses the existing v1.5.7 Paper-tag command and its tag revision. Rejection remains persisted until an explicit regenerate/reset, and a deprecated or unresolved candidate cannot be applied. The small deterministic baseline measures the current rulebook rather than claiming semantic-tagging quality: 2 expected candidates present, 0 misses, 1 false positive, and precision-like 0.667 across three fixture cases.

v1.5.6 closes the everyday Project workspace: one Project page now keeps explicit metadata/status/priority editing, Paper links, and a bounded existing Note Block picker together. The picker reads only the selected Paper's stored blocks and reuses the canonical typed Project-link command, including duplicate truthfulness, revision conflicts, and controlled unavailable/orphan states. Project and link writes remain independent, revision-checked, lock-protected, and atomic; there is no autosave, combined save, or storage migration.

The immutable released baseline remains **v1.4.0-pdfjs-reader-foundation** and its verified tag/commit evidence is not relabeled as v1.5.12. The v1.5.1 Reader commands, v1.5.2 Projects/Tags reads, v1.5.3 safe Settings reads, v1.5.4 Project/Paper-link commands, v1.5.5 Note Block commands, v1.5.6 Project workspace closure, v1.5.7 Paper tags, v1.5.8 metadata enrichment, v1.5.9 PDF scan/import, v1.5.10 tag workflows, v1.5.11 Library workflow, official pinned `pdfjs-dist`, repository-local worker, managed PDF Range behavior, and Streamlit workflows remain in place.

The generated [current release status](docs/CURRENT_RELEASE_STATUS.md) is the canonical human-readable view of source control, automated validation, manual validation, publication, recurring operations, and unresolved evidence. Its source is the machine-readable `docs/tracker_sync_status.json` manifest.

The v1.4.3 control-plane repair makes Reader aggregates derive from their child checks and rejects evidence text that contradicts its controlled status. It changes no product, API, Reader, dependency, storage, or user-data behavior.

The app remains intentionally local-first and single-user:

- Runtime library data is ignored by Git.
- GitHub stores the application code, not the personal paper library.
- Crossref is optional; core reading and organization workflows work offline.
- Maintenance actions use preview and confirmation where files or records can change.

## Windows Quick Start

From a fresh clone in Windows PowerShell:

```powershell
git clone <repository-url> BluePrintReboot
cd BluePrintReboot
.\scripts\dev_setup.ps1 -IncludeFrontend -NodeHome "C:\Users\Public\tools\node-v24.18.0-win-x64"
.\scripts\dev_check.ps1 -NodeHome "C:\Users\Public\tools\node-v24.18.0-win-x64"
.\scripts\run_app.ps1
```

For a Streamlit-only machine, `.\scripts\dev_setup.ps1` still performs Python setup without requiring Node. That machine may use `.\scripts\dev_check.ps1 -PythonOnly`, but the prominently labeled partial result is not release-qualified.

After setup, `start_blueprint.bat` is available as a convenience launcher from File Explorer or Command Prompt. It starts the existing `.venv` app; it does not run setup automatically.

Add PDFs directly to `papers/`, then open **Library** in the web app and choose **Scan PDFs**. Review candidates, select new PDFs, and choose **Import selected**. A scan alone never registers a Paper. Imported Papers appear in the collection and can open in Paper Detail or Reader; metadata enrichment remains an explicit follow-up action.

## Bounded Local API

Streamlit remains a complete BluePrintReboot interface. The FastAPI service is local-only: its GET routes are bounded read models, while explicit Reader, Project/link, and managed-PDF scan/import commands form the exact mutation boundary. Project, Note Block, Tag, and Settings GET routes delegate through read-model services and adapters; they never serialize arbitrary storage dictionaries or perform migration, repair, normalization write-back, backup, restore, or configuration changes.

Start it from Windows PowerShell:

```powershell
.\scripts\run_api.ps1
```

The launcher uses the repository `.venv` and binds only to `127.0.0.1`. The local endpoints are:

- API documentation: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- Health summary: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)
- Library status: [http://127.0.0.1:8000/library/status](http://127.0.0.1:8000/library/status)
- Active paper collection: [http://127.0.0.1:8000/papers](http://127.0.0.1:8000/papers)
- Paper detail: `http://127.0.0.1:8000/papers/{paper_id}`
- Reader Snapshot: `GET http://127.0.0.1:8000/papers/{paper_id}/reader`
- Full-text status: `GET http://127.0.0.1:8000/papers/{paper_id}/full-text/status`
- Canonical cached full text: `GET http://127.0.0.1:8000/papers/{paper_id}/full-text`
- Explicit full-text extraction/re-extraction: `POST http://127.0.0.1:8000/papers/{paper_id}/full-text/extract`
- Managed PDF stream: `http://127.0.0.1:8000/papers/{paper_id}/pdf`
- Managed PDF scan preview: `POST http://127.0.0.1:8000/papers/scan`
- Managed PDF selective import: `POST http://127.0.0.1:8000/papers/import`
- Metadata enrichment preview: `POST http://127.0.0.1:8000/papers/{paper_id}/metadata/enrichment-preview`
- Metadata command: `PATCH http://127.0.0.1:8000/papers/{paper_id}/metadata`
- Reading Note command: `PUT http://127.0.0.1:8000/papers/{paper_id}/reading-note`
- Structured Note Block collection: `GET http://127.0.0.1:8000/papers/{paper_id}/note-blocks`
- Create structured Note Block: `POST http://127.0.0.1:8000/papers/{paper_id}/note-blocks`
- Update structured Note Block: `PATCH http://127.0.0.1:8000/papers/{paper_id}/note-blocks/{block_id}`
- Project collection: [http://127.0.0.1:8000/projects](http://127.0.0.1:8000/projects)
- Project detail: `GET http://127.0.0.1:8000/projects/{project_id}`
- Create Project: `POST http://127.0.0.1:8000/projects`
- Update Project metadata: `PATCH http://127.0.0.1:8000/projects/{project_id}`
- Archive Project: `POST http://127.0.0.1:8000/projects/{project_id}/archive`
- Add existing Paper link: `POST http://127.0.0.1:8000/projects/{project_id}/paper-links`
- Remove Paper link: `DELETE http://127.0.0.1:8000/projects/{project_id}/paper-links/{link_id}`
- Add Note Block link: `POST http://127.0.0.1:8000/projects/{project_id}/note-block-links`
- Remove Note Block link: `DELETE http://127.0.0.1:8000/projects/{project_id}/note-block-links/{link_id}`
- Canonical Tags: [http://127.0.0.1:8000/tags](http://127.0.0.1:8000/tags)
- Tag candidate summary: [http://127.0.0.1:8000/tags/summary](http://127.0.0.1:8000/tags/summary)
- Tag candidate review queue: [http://127.0.0.1:8000/tags/review-queue](http://127.0.0.1:8000/tags/review-queue)
- Canonical tag governance: `GET /tags/governance`, `POST /tags`, `PATCH /tags/{canonical_key}`, `POST|DELETE /tags/{canonical_key}/aliases`, and `POST /tags/{canonical_key}/deprecate`
- Paper tag candidates: `GET|POST /papers/{paper_id}/tag-candidates`, followed by `POST /papers/{paper_id}/tag-candidates/{candidate_id}/approve|reject|promote|apply`
- Safe Settings summary: [http://127.0.0.1:8000/settings/summary](http://127.0.0.1:8000/settings/summary)

`GET /papers` accepts `limit` (1-100, default 20), `offset` (default 0), `archive_status` (`active`, `archived`, or `all`; default `active`), bounded `q` metadata search, and exact `tag`, `year`, and reading `status` filters. Results are ordered by case-insensitive title and then stable `paper_id`; all query filters apply before pagination.

`GET /projects` and `GET /tags` accept `limit` (1-100, default 20) and `offset` (default 0). Projects are ordered by case-insensitive name then stable `project_id`; Tags are ordered by case-insensitive label then canonical key. `GET /projects/{project_id}` accepts `links_limit` (1-100, default 20) and `links_offset` (default 0). Missing linked Papers remain successful detail reads with `target_state: "orphaned"`; Note Block targets distinguish `available`, `orphaned_note_block`, `orphaned_paper`, and `unavailable`, without invented metadata or automatic link repair. Tag summary counts and the review queue derive only from persisted service output; a missing or unreadable candidate source is an explicit unavailable state. The queue does not generate candidates or apply tags.

`GET /settings/summary` has no query or write surface. It returns four strict sections: Application, Workspace, Data integrity, and Backup readiness. Its lightweight reader caps file discovery, index rows, per-file JSON reads, and total JSON bytes per request; checks only file presence and app-owned metadata; and never hashes or parses PDFs, extracts text, opens snapshot archives, verifies restores, or writes cache/report/status files. Missing diagnostics use `state: "unavailable"` with `count: null`, which is distinct from a verified zero.

Managed PDF scan and import are separate explicit `POST` commands. Scan returns only safe relative candidate paths and status; it has no registry persistence side effect. Import accepts only selected managed-relative `.pdf` paths, rechecks them under the shared workspace lock, and reports per-file imported, already-registered, missing, invalid, or unavailable outcomes. It never accepts arbitrary server filesystem paths, enriches metadata, tags a Paper, repairs moved files, or creates a broken record. Metadata enrichment preview is likewise a separate explicit `POST` with no persistence side effect. It returns only allowlisted current values, nonblank candidate values, field provenance, safe diagnostics, and candidate state; unavailable provider fields never mean “clear this stored value.” Metadata requests contain `changes` plus `expected_revision`, so only the fields selected from a preview mutate. Reading Note requests contain `content` plus `expected_sha256`. Both saves are explicit; there is no autosave or combined save endpoint. `404`, `409`, `422`, and `503` responses are controlled and do not expose local storage paths or submitted note content.

`POST /papers/reconnect` is the bounded explicit repair command for a scan candidate whose exact content uniquely matches one missing indexed Paper. It accepts only a Paper identity and managed-relative PDF path, rechecks the exact identity after acquiring the shared workspace lock, and updates only the existing index row's filename/path/hash signature fields. It refuses stale or ambiguous candidates without mutation and does not expose a local path or hash value to the browser.

Tag governance stores only canonical Tag Book records and never normalizes or migrates stored Paper tags as a side effect. Alias lookup is deterministic: duplicate aliases, aliases that collide with a canonical identity, canonical labels that collide with an alias, ambiguous aliases, and self-aliases are rejected. Deprecation preserves the canonical record and old relationships but prevents normal candidate approval/promotion/application. Candidate generation uses the existing rulebook/extraction path and saves a per-Paper review context only. It never changes `paper_index.csv`; applying a candidate delegates to the existing tag command with `expected_tags_revision`, so repeat apply is an honest no-op and stale Paper or review state is a controlled conflict.

Project update/archive requests use `expected_revision`; Paper-link add/remove requests use `expected_links_revision`. Both tokens are deterministic SHA-256 revisions over the complete relevant stored state. Commands acquire the shared workspace write lock, reload after lock acquisition, reject stale state without mutation, and verify persisted output. Project create/update/archive touch only Project storage; Paper-link commands touch only link storage. Archive preserves existing links and is not deletion.

Note Block create/update requests use `expected_revision`, a deterministic SHA-256 token over the complete normalized newest-first collection. Creation time determines the Reader order; `updated_at` never promotes an edited historical block, and block ID is only a deterministic creation-time tie-breaker. Identity and timestamps are server-owned; only the seven canonical content fields are accepted. Exact no-op updates do not rewrite the file. Note Block Project-link commands validate the Project, source Paper, and Paper-owned block identity and touch only Project-link storage. Exact duplicates return `unchanged`, unlink preserves the Project, Paper, and Note Block, and archived Project links remain read-only.

The equivalent direct command is `python -m uvicorn api.main:app --host 127.0.0.1 --port 8000` when the repository environment is active.

## Frontend Application Shell

The frontend lives in `frontend/` and requires Node.js 22.13 or newer. Start FastAPI first in one PowerShell window:

```powershell
.\scripts\run_api.ps1
```

After FastAPI is listening, launch the frontend in a second PowerShell window with the portable Node runtime:

```powershell
.\scripts\run_frontend.ps1 -NodeHome "C:\Users\Public\tools\node-v24.18.0-win-x64"
```

Open exactly [http://127.0.0.1:3000](http://127.0.0.1:3000). The launcher passes Vinext's supported `--hostname 127.0.0.1` option and never binds the frontend to an external interface. The same-origin frontend bridge connects to FastAPI at `http://127.0.0.1:8000` by default. Copy `frontend/.env.example` to `frontend/.env.local` only when that API address needs to change.

After the foreground frontend reports that it is ready, this non-invasive probe checks HTTP reachability:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:3000" -TimeoutSec 10
```

If the printed URL is not reachable, inspect the listener with `Get-NetTCPConnection -State Listen -LocalPort 3000` and inspect resolution with `[System.Net.Dns]::GetHostAddresses("localhost")`. `localhost` may prefer IPv6 loopback `::1`; that address is still local-machine-only, but it is not the canonical browser URL. A listener on `::1` indicates that the expected explicit IPv4 bind was not honored. Do not work around the issue with `0.0.0.0`, bare `::`, a LAN address, or any external interface.

Dashboard, Library, Papers, Paper Detail, Reader, Projects, Project Detail, Tags, and Settings use real API contracts with explicit loading, empty, error, and unavailable states; Project Detail also has a controlled not-found state. Library provides an explicit managed-PDF scan, preview, selection, and import workflow; only safe relative paths cross the API and import failures remain per-file. Projects provides an explicit create form. Active Project detail provides explicit edit/save/cancel/archive and a bounded picker for existing Papers; conflicts and offline failures preserve drafts or selections, duplicate links report an honest unchanged result, unlink requires confirmation, and archived Projects retain read detail without write controls. Settings remains read-only. The Reader retains its bounded explicit note/metadata saves, PDF.js canvas renderer as the primary path, conditional native fallback, and explicit backend-owned Full Text extraction/cache surface. No local filesystem path or source hash reaches the browser.

Node is resolved in this order: `-NodeHome`, `BLUEPRINT_NODE_HOME`, then `node.exe` and `npm.cmd` on `PATH`. Node 22.13.0 or newer is required. Run `.\scripts\frontend_setup.ps1 -NodeHome <path>` to install exactly from `frontend/package-lock.json` with `npm ci`; no script downloads Node or permanently edits `PATH`.

`pdf-inspector==0.2.6` is installed by the default `requirements.txt`. To add the optional MarkItDown PDF fallback:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-optional.txt
```

Manual environment commands are a troubleshooting fallback when the scripts cannot be used:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe scripts\smoke_check.py
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m streamlit run app.py
```

### Troubleshooting

- **PowerShell execution policy** - Run scripts from PowerShell with `.\scripts\dev_setup.ps1`. If local policy blocks a script, use a process-only bypass such as `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev_setup.ps1`.
- **Python not found** - Install Python 3, make sure either `py` or `python` is available on `PATH`, reopen PowerShell, and rerun `.\scripts\dev_setup.ps1`.
- **Missing `.venv`** - Run `.\scripts\dev_setup.ps1`. `.\scripts\dev_check.ps1`, `.\scripts\run_app.ps1`, and `start_blueprint.bat` expect the environment to already exist.
- **Portable Node not found** - Pass its directory with `-NodeHome`, or set `$env:BLUEPRINT_NODE_HOME` for the current shell. The directory must contain both `node.exe` and `npm.cmd`.
- **Missing frontend dependencies** - Run `.\scripts\frontend_setup.ps1 -NodeHome <portable-node-directory>`; setup uses `npm ci` and requires the committed lock file.
- **Port 8501 already in use** - Launch with another port, for example `.\scripts\run_app.ps1 -Port 8502`.

## Core Reading Workflow

The main loop is:

1. Add a paper to `papers/`.
2. Read the PDF.
3. Edit metadata, status, priority, and tags.
4. Write the BluePrint Reading Note and structured note blocks.
5. Link papers and useful note blocks to projects.
6. Retrieve papers, notes, tags, and project context later.

Current support includes:

- Fast recursive PDF/index sync from the canonical `papers/` directory without default metadata enrichment, with conservative hash reuse for unchanged indexed PDFs.
- Web Library scan/preview and selected import for PDFs already under `papers/`; scan never writes the index, repeated imports report existing registration, and per-file failures leave existing records intact.
- Stable paper identities and a local CSV metadata index.
- Search and filtering by metadata, status, priority, and tags.
- Reader Workspace with PDF viewing, the canonical BluePrint Reading Note, status, priority, tags, and explicit metadata-enrichment preview/selective apply.
- Reading Note headers refresh from accepted paper metadata while preserving existing note body sections and unsaved draft text.
- Manual/suggested tags, Edit metadata, DOI, DOI-less, and Crossref acceptance share one metadata coordinator; dirty bodies are never autosaved and explicit Save converges the latest header and body.
- Reader note state survives metadata-triggered reruns while the same paper remains active; dirty Reload still requires explicit Keep/Discard.
- Unsaved drafts are never autosaved. Switching papers, refreshing the browser, or restarting discards them; returning loads the last explicitly saved note.
- Reading status and priority use one explicit Apply action; active-paper note and PDF-renderer state remain stable across same-paper reruns.
- Structured note blocks for summaries, claims, methods, evidence, questions, ideas, and limitations.
- BluePrint Reading Note template download and confirmed local import into the Reading Note and structured note blocks, with duplicate source imports blocked unless explicitly forced.
- Full-text extraction with MarkItDown when available and `pypdf` fallback.
- SHA-256 cache freshness checks and safe stale-cache recovery.

## Metadata/Tag Workflow

- Explicit DOI extraction from PDFs through metadata assist, separate from the normal local scan.
- Crossref metadata preview and explicit acceptance with classified diagnostics.
- DOI-less metadata fallback for arXiv/preprint/workshop PDFs, including arXiv ID detection, optional arXiv metadata lookup, and weak title guesses from PDF text or filename.
- Web Reader enrichment previews current stored metadata beside each candidate and source, requires per-field selection before save, and preserves unselected manual values and unrelated drafts on success, failure, or conflict.
- Manual metadata editing when enrichment is incomplete or offline.
- Fallback metadata suggestions are previewed and user-applied; they do not claim perfect extraction.
- Deterministic tag suggestions and canonical tag governance through the local Tag Book.
- Minimal `PaperTextProfile` caches are derived from `paper_index.csv`, extracted-text abstract fallback, Reading Notes, and structured note blocks. They are rebuildable caches, not the source of truth.
- Tag Book configuration lives under `config/tag_book/`: `tag_book.json`, `method_lexicon.json`, `normalization_rules.json`, `blocked_terms.json`, and `candidate_patterns.json`.
- A canonical tag is the approved stored tag value; an alias is a matched spelling or phrase that resolves to a canonical tag; category and status control grouping and suggestion eligibility.
- Candidate tags are plausible new tags detected from metadata, filenames, and available extracted-text previews. They are preview-only until a user explicitly selects them as paper-local tags or promotes them later as canonical tags or aliases in Tag Manager.
- Tag suggestions include category, source, matched text, evidence, and reason. No LLM tagging, external ontology lookup, semantic synonym auto-merge, image parsing, or automatic retagging is performed.
- `normalization_rules.json` is loaded by the Tag Book helper for deterministic kebab-case normalization; full semantic normalization remains out of scope.
- Research projects linking papers and structured note blocks.
- Paper Hygiene recommendations using `{year}_{first_author}_{short_title}.pdf` without changing `paper_id`.

Crossref polite-access contact resolution uses:

1. `CROSSREF_MAILTO`
2. `BLUEPRINT_CONTACT_EMAIL`
3. the built-in local default

Example:

```powershell
$env:CROSSREF_MAILTO = "researcher@example.edu"
```

Crossref enrichment requires the base dependencies `requests`, `urllib3`, and `certifi`.

## Maintenance/Backup Workflow

The established Streamlit Settings workflow is organized into four action-capable sections:

- **System** - app/runtime information, workspace paths, extraction backends, and index details.
- **Library Maintenance** - Library Health Check, Tag Book, Drive Inbox Import, and Paper Hygiene.
- **External Services** - Crossref Diagnostics, dependency versions, and proxy/network status.
- **Backup** - light/full Backup Snapshot controls and manifest summaries.

The web Settings page is intentionally separate and read-only. It presents Application, Workspace, Data integrity, and Backup readiness summaries from the safe API, then directs users back to Streamlit for configuration, health actions, backup creation, restore, or repair.

Library Health Check reports missing/unindexed PDFs, duplicate identities, incomplete metadata, orphan records, structured app-owned corruption, quarantine state, backup concerns, noncanonical paths, and stale caches. Exact duplicate ignores are persistent, reversible, and bound to workspace-relative path plus SHA-256. No duplicate action automatically merges or deletes PDFs or linked user state.

`BLUEPRINT_INBOX_DIR` can point to a Google Drive for desktop synced folder such as `G:\My Drive\BluePrint\paper`. No Google Drive API or OAuth is used. Inbox PDFs are candidates only; the app uses an explicit preview/confirm workflow to copy one selected PDF into `papers/` and leaves the source untouched.

Backup Snapshot creates timestamped ZIP files under `exports/`:

- **Light** - index, projects, links, notes, note blocks, tag configuration, and relevant local settings.
- **Full** - everything in a light snapshot plus managed PDFs from `papers/`.

Each archive contains `manifest.json` with the app version, timestamp, included files, SHA-256 checksums, counts, and snapshot policy. Verify it in place with `.\.venv\Scripts\python.exe scripts\verify_snapshot.py <snapshot.zip>`. Before a rehearsal, run `.\.venv\Scripts\python.exe scripts\restore_check.py <snapshot.zip> <existing-empty-disposable-directory>`; this verifies the original and refuses unsafe/non-empty targets without extracting. Restore remains manual. The [new-PC restore checklist](docs/checklists/new_pc_restore_checklist.md) is canonical and supersedes the old project-level `backup_guideline.txt`.

Recommended move workflow:

1. Run Library Health Check on the old computer.
2. Create a full snapshot, or create a light snapshot and copy `papers/` separately.
3. Install BluePrintReboot on the new computer.
4. With the app stopped, extract the snapshot into the project root while preserving directory structure.
5. Start the app, scan papers, and run Library Health Check again.

Backup snapshots include the atomic `data/lifecycle_decisions.json` store because exact duplicate ignores affect visible behavior. Rebuildable extracted-text and PaperTextProfile caches, exports, and quarantine copies remain excluded. Recovery copies are separate evidence and should be preserved independently when needed.

## Development/Release Workflow

Foundation release documents:

- [Canonical current release status](docs/CURRENT_RELEASE_STATUS.md)
- [BluePrint principles](docs/BLUEPRINT_PRINCIPLES.md)
- [Roadmap](docs/ROADMAP.md)
- [Backlog](docs/BACKLOG.md)
- [Development workflow](docs/DEV_WORKFLOW.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Mandatory regression checklist](docs/checklists/regression_checklist.md)
- [Reader note state machine](docs/READER_NOTE_STATE_MACHINE.md)
- [Reader frontend parity checklist](docs/READER_FRONTEND_PARITY_CHECKLIST.md)
- [Lifecycle and recovery contract](docs/LIFECYCLE_AND_RECOVERY_CONTRACT.md)
- [Read-only domain contracts](docs/READ_ONLY_DOMAIN_CONTRACTS.md)
- [v1.6.5 Visual language & design system refinement release notes](docs/release_notes/v1.6.5.md)
- [v1.6.4 Visual hierarchy & density pass release notes](docs/release_notes/v1.6.4.md)
- [v1.6.3 Reader interaction & UX polish release notes](docs/release_notes/v1.6.3.md)
- [v1.1.0 FastAPI read-only foundation release notes](docs/release_notes/v1.1.0.md)
- [v1.1.1 Paper API release notes](docs/release_notes/v1.1.1.md)
- [v1.1.2 Rich Paper Metadata release notes](docs/release_notes/v1.1.2.md)
- [v1.2.0 Frontend Application Shell release notes](docs/release_notes/v1.2.0.md)
- [v1.2.1 Full-Stack Validation Gate release notes](docs/release_notes/v1.2.1.md)
- [v1.2.2 Runtime and Release Evidence Closure release notes](docs/release_notes/v1.2.2.md)
- [v1.3.0 Read-Only Reader/PDF Vertical Slice release notes](docs/release_notes/v1.3.0.md)
- [v1.3.1 Release-State Convergence and Repository Hygiene release notes](docs/release_notes/v1.3.1.md)
- [v1.4.0 PDF.js Reader Foundation release notes](docs/release_notes/v1.4.0.md)
- [v1.5.0 Read-only Reader Snapshot Vertical Slice release notes](docs/release_notes/v1.5.0.md)
- [v1.5.1 Reader Write Vertical Slice release notes](docs/release_notes/v1.5.1.md)
- [v1.5.2 Projects and Tags Read Parity release-note draft](docs/release_notes/v1.5.2.md)
- [v1.5.3 Settings and Health Safe Read Parity release-note draft](docs/release_notes/v1.5.3.md)
- [v1.5.4 Project Write and Paper–Project Link Commands release-note draft](docs/release_notes/v1.5.4.md)
- [v1.5.5 Note Block Write and Project Links release-note draft](docs/release_notes/v1.5.5.md)
- [v1.5.6 Project Workspace Closure release-note draft](docs/release_notes/v1.5.6.md)
- [v1.5.7 Paper Tag Apply/Remove release-note draft](docs/release_notes/v1.5.7.md)
- [v1.5.8 Metadata Enrichment Frontend release-note draft](docs/release_notes/v1.5.8.md)
- [v1.5.9 PDF Scan / Import Frontend release-note draft](docs/release_notes/v1.5.9.md)
- [v1.5.10 Tag Governance & Candidate Review release-note draft](docs/release_notes/v1.5.10.md)
- [Manual v1.0 smoke test checklist](docs/checklists/v1.0_smoke_test.md)
- [New-PC restore checklist](docs/checklists/new_pc_restore_checklist.md)
- [v1.0.26 Streamlit finalization release notes](docs/release_notes/v1.0.26.md)
- [v1.0.25 lifecycle and recovery release notes](docs/release_notes/v1.0.25.md)
- [v1.0.24 Reader validation and parity release notes](docs/release_notes/v1.0.24.md)
- [v1.0.23 Reader state-machine release notes](docs/release_notes/v1.0.23.md)
- [v1.0.22 note durability and validation release notes](docs/release_notes/v1.0.22.md)
- [v1.0.21 reader performance polish release notes](docs/release_notes/v1.0.21.md)
- [v1.0.20 safety release notes](docs/release_notes/v1.0.20.md)
- [v1.0.0-foundation release-note draft](docs/release_notes/v1.0_draft.md)

The release-qualified gate includes Python smoke, full pytest, frontend lint, and frontend test/build:

```powershell
.\scripts\dev_check.ps1 -NodeHome "C:\Users\Public\tools\node-v24.18.0-win-x64" -WriteEvidence
```

The evidence file is opt-in and ignored at `artifacts/validation-summary.json`. A deliberately requested Python-only check is available but partial:

```powershell
.\scripts\dev_check.ps1 -PythonOnly
```

`-PythonOnly` and `-SmokeOnly` never claim release readiness. For release hygiene work, also complete the [mandatory regression checklist](docs/checklists/regression_checklist.md), run `git diff --check`, and inspect `git status --short`.

The smoke path includes tracked-entry repository hygiene and canonical release-state reconciliation. Both reconciliation and the versioned external-tracker handoff work without network access:

```powershell
.\.venv\Scripts\python.exe scripts\check_repo_hygiene.py
.\.venv\Scripts\python.exe scripts\reconcile_release_state.py --check
.\.venv\Scripts\python.exe scripts\export_tracker_status.py
```

Tracker CSV defaults to ignored `artifacts/tracker_status.csv`; use `--output <path>` for an explicit destination.

Run a focused test file:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_library_health.py -q
```

Manual release validation is documented in [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md), [docs/checklists/regression_checklist.md](docs/checklists/regression_checklist.md), and [docs/checklists/v1.0_smoke_test.md](docs/checklists/v1.0_smoke_test.md).

Do not commit, push, merge, or tag release work until review and explicit release approval are complete.

## Project Structure

- `app.py` - Streamlit entry point.
- `ui_streamlit/` - application pages and workspace UI.
- `frontend/` - Vinext/Next.js TypeScript application shell, shared components, design tokens, and typed API client.
- `ingest/` - scanning, DOI, Crossref, tagging, and text-extraction helpers.
- `services/` - inbox import, filename hygiene, backup, health checks, and workflow orchestration.
- `storage/` - index, notes, note blocks, projects, links, and extracted-text caches.
- `config/` - contact/inbox helpers and user-editable tag configuration.
- `scripts/` - non-destructive setup, check, launch, and readiness utilities.
- `docs/` - release, roadmap, workflow, and checklist documentation.
- `tests/` - automated test suite.
- `papers/` - canonical managed PDF library; ignored by Git.
- `data/` - local metadata and caches; ignored by Git.
- `notes/` - Markdown reading notes; ignored by Git.
- `exports/` - snapshots and exports; ignored by Git.

## Version History

### v1.5.10-tag-governance-candidate-review

- Adds revision-checked canonical Tag Book management: create, bounded metadata/category edits, alias management, and non-destructive deprecation.
- Preserves historical and legacy/noncanonical Paper tag values; canonical and alias collisions are rejected rather than auto-corrected.
- Adds persisted Paper-scoped candidate review, explicit approve/reject/promote actions, and a separate Apply action that reuses the existing Paper-tag command.
- Records a deterministic rulebook candidate baseline; advanced tag intelligence, embeddings, LLMs, and broad semantic optimization remain deferred to v1.8.0.

### v1.5.9-pdf-scan-import-frontend

- Adds an explicit Library workflow for scanning PDFs already placed in `papers/`, previewing candidate state, selecting new files, and registering selected Papers.
- Keeps scan preview-only and path-safe; repeated scans/imports expose already-registered files instead of duplicate Paper records.
- Revalidates selected files under the workspace lock, uses existing atomic index persistence, and reports missing, invalid, unavailable, and duplicate outcomes per file.
- Leaves metadata enrichment and tagging explicit, subsequent Reader actions; no watcher, drag/drop, OCR, hashing redesign, moved-file repair, or broad folder management is added.

### v1.5.8-metadata-enrichment-frontend

- Adds a non-persistent, Paper-scoped metadata candidate preview over the existing Crossref, PDF DOI, arXiv, and local fallback capabilities.
- Shows stored value, candidate value, provenance, and unchanged/conflicting/available/unavailable state for every editable metadata field.
- Applies only selected nonblank candidate fields through the established metadata revision and persistence command; a stale revision requires a deliberate reload/retry.
- Retains unselected manual metadata and unrelated unsaved Reader metadata/Reading Note drafts during preview, apply, errors, and conflicts.

### v1.5.7-paper-tag-apply-remove

- Adds independent explicit Paper-tag add/remove commands with a tag-only revision, truthful no-ops, shared locking, atomic verification, and rollback.
- Preserves legacy/noncanonical stored tags while normalizing only the added tag through existing repository semantics.
- Refreshes the canonical Reading Note header after a successful tag mutation without replacing an unsaved note body.
- Adds Paper-local Reader controls with canonical Tag Book suggestions, visible tag state, remove actions, and conflict/error reload behavior.

### v1.5.6-project-workspace-closure

- Closes the Project workspace with explicit metadata/status/priority commands, distinct Paper and Note Block link collections, and bounded local counts.
- Lets a user select an existing Paper, load only that Paper's stored Note Blocks, select an allowlisted link type, and explicitly reuse the canonical typed Project-link command.
- Preserves independent dirty metadata drafts, optimistic Project/link revisions, shared workspace locking, atomic verification/rollback, local storage, Reader behavior, and Streamlit compatibility.

### v1.5.5-note-block-write-project-links

- Adds a bounded stored-order structured Note Block read model and an independent explicit create/update command service.
- Adds typed Note Block–Project add/unlink commands with exact duplicate truthfulness, optimistic link revisions, and non-destructive unlink.
- Extends Reader and Project Detail with independent draft-preserving Note Block workflows, typed summaries, explicit target states, and stable source navigation.
- Preserves local storage, Streamlit behavior, PDF.js lifecycle/Range handling, explicit-save policy, shared locking, atomic verification, and rollback contracts.

### v1.5.1-reader-write-vertical-slice

- Adds independent metadata and Reading Note command-service boundaries with strict request/response schemas.
- Rejects stale metadata revisions and note hashes before mutation and restores the original index/note state after a coupled metadata-header failure.
- Adds accessible web editors with separate explicit saves, draft-preserving conflict/error states, and explicit reload actions.
- Preserves the v1.5.0 snapshot, stable identity, PDF.js lifecycle, managed-PDF Range behavior, local-only binding, and Streamlit storage workflows.

### v1.5.0-reader-snapshot-readonly-vertical-slice

- Adds strict `GET /papers/{paper_id}/reader` adaptation over the existing domain snapshot builder.
- Loads paper, PDF availability, persisted-note content, canonical note header, and saved baseline in one frontend request.
- Shows the saved note as selectable plain text beside the existing PDF.js Reader with separate empty, warning, missing-PDF, not-found, and unavailable states.
- Adds no write API, editor, autosave, dependency, storage migration, or PDF.js/Range behavior change.

### v1.4.0-pdfjs-reader-foundation

- Makes a PDF.js canvas the primary web Reader while retaining a clearly labeled, conditional native browser fallback.
- Adds bounded page navigation, direct page entry, zoom controls, safe loading/error/retry states, and explicit task/document/render cleanup.
- Pins `pdfjs-dist` and bundles its worker locally through the client-only Vinext/Vite build with no CDN dependency.
- Removes the redundant one-byte probe and adds disabled-by-default, private-data-free development diagnostics for document loads, renders, cancellations, first-page duration, and observed request mode.
- Preserves the managed-root endpoint, stable `paper_id`, byte ranges, all storage formats, and every Streamlit write workflow.

### v1.3.1-release-state-convergence-and-repo-hygiene

- Separates PR #2 CI from the post-merge `main` run and validates truthful release-state transitions instead of freezing a provisional status.
- Removes the accidental tracked console-output file and adds narrow tracked-entry hygiene to smoke and hosted CI.
- Adds a versioned external-tracker mapping and deterministic standard-library CSV export without Drive API, OAuth, or network access.
- Adds no product feature and preserves the Reader/PDF, API, storage, and Streamlit contracts.

### v1.3.0-reader-pdf-readonly-vertical-slice

- Adds GET-only, range-capable managed PDF delivery with canonical-root containment and generic error responses.
- Extends the same-origin bridge for exact binary PDF streaming without exposing the FastAPI origin or local paths.
- Adds a dedicated dependency-free Reader route and Paper Detail entry action while leaving all notes and writes in Streamlit.

### v1.2.2-runtime-and-release-evidence-closure

- Corrects the Vinext launch flag so the canonical local frontend URL is `http://127.0.0.1:3000`.
- Adds deterministic launch diagnostics and a deliberate GitHub Actions `workflow_dispatch` trigger while preserving the full push/pull-request gate.
- Reconciles release evidence, checklists, roadmap/backlog state, version metadata, and the canonical tracker handoff without changing product or data contracts.

### v1.2.1-full-stack-validation-gate

- Adds one portable-Node-aware full gate across Python smoke, full pytest, frontend lint, and frontend build/tests.
- Adds deterministic frontend `npm ci` setup, opt-in safe JSON evidence, and independent Python/frontend CI jobs.
- Adds focused same-origin bridge tests while preserving the four GET-only API path shapes and all existing response contracts.
- Defines the next product milestone as a separate read-only Reader/PDF vertical slice.

### v1.2.0-frontend-application-shell

- Adds one persistent desktop research-workstation shell across seven routes.
- Integrates the four existing read-only API endpoints through a centralized typed client and same-origin local bridge.
- Adds shared async feedback, table, metadata, toolbar, status, navigation, and placeholder components with centralized design tokens.
- Preserves Streamlit unchanged as the primary interface for all write and Reader workflows.

### v1.1.2-rich-paper-metadata

- Extends domain and API `PaperDetail` with authors, journal, abstract, keywords, and arXiv ID.
- Keeps `GET /papers` lightweight and preserves v1.1.1 pagination, archive filtering, and ordering.
- Uses canonical stored index metadata and deterministic local arXiv detection without runtime enrichment or network access.

### v1.1.1-paper-api

- Adds paginated `GET /papers` with explicit archive filtering and deterministic ordering.
- Adds `GET /papers/{paper_id}` for active and archived paper detail.
- Maps frozen domain read models into strict public schemas without exposing raw CSV records or absolute paths.

### v1.1.0-fastapi-readonly-foundation

- Adds a dedicated FastAPI application factory and module-level application.
- Implements only `GET /health` and `GET /library/status` using the frozen read-model builders.
- Keeps Streamlit as the primary interface and adds no write API or paper/Reader routes.

### v1.0.26-streamlit-finalization-api-contract-freeze

- Fixes Reader manual/suggested tag synchronization with canonical Reading Note headers.
- Routes canonical metadata changes through one typed, Streamlit-independent mutation coordinator.
- Freezes JSON-safe Health, Library, Paper, Detail, and Reader read models without adding routes.
- Adds a read-only snapshot/disposable-target restore readiness check and final frontend parity criteria.

### v1.0.25-lifecycle-and-recovery-closure

- Adds structured app-owned corruption diagnosis and byte-preserving recovery-copy export.
- Adds confirmed, verified quarantine/restore for rebuildable caches only.
- Persists reversible exact-path/SHA duplicate ignores atomically and includes them in backup snapshots.
- Adds reversible metadata-only archive visibility without changing reading status or moving files.

### v1.0.24-reader-validation-and-parity-closure

- Combines status and priority persistence into one explicit Apply action and skips unchanged writes.
- Removes avoidable explicit reruns while retaining intentional reloads required for fresh records, disk transitions, or confirmation cleanup.
- Defines the Reader action/rerun contract and minimum future frontend parity requirements.
- The user later reported the v1.0.24 manual Reader smoke complete; remaining framework-level PDF rerenders are accepted.

### v1.0.23-reader-state-machine-closure

- Defines paper-scoped Saved, Unsaved changes, header-pending, and discard-confirmation states outside Streamlit rendering.
- Adds explicit Keep draft and Discard changes and reload choices for dirty Reload.
- Makes pending transitions idempotent and documents reload/header/replacement/append precedence.
- Keeps explicit Save, atomic note writes, note format, and `paper_id` semantics unchanged.

### v1.0.22-note-durability-and-validation-closure

- Routes Reading Note creation, save, and header refresh through the shared atomic text writer without changing filenames or Markdown format.
- Preserves existing note bytes and removes temporary files when replacement fails.
- Adds a read-only snapshot verifier and disposable ZIP regression coverage.
- Keeps Reader drafts explicit-save, `paper_id` semantics unchanged, and restore manual.

### v1.0.21-reader-performance-polish

- Reuses cached PDF SHA-256 metadata when path, size, and modified time show an indexed PDF is unchanged.
- Rehashes changed files and keeps duplicate/missing PDF detection deterministic and confirmation-gated.
- Adds Reader draft baselines so reload and metadata header refresh cannot silently overwrite unsaved note text.
- Adds short Streamlit feedback for note save/reload/header refresh and scan-related operations.
- Updates release docs and tests for the v1.0.21 Reader/hash polish without changing the Streamlit architecture.

### v1.0.20-safety-release-foundation

- Adds typed corrupt/invalid JSON store errors and shared JSON read helpers for app-owned JSON persistence.
- Keeps source-ish JSON writes on same-directory temp-file, flush/fsync, and atomic replacement paths.
- Surfaces corrupt JSON, backup snapshot concerns, severity, meaning, and next action in Library Health Check.
- Makes Backup Snapshot manifests explicit about included library data, excluded source/runtime/cache files, and intentionally excluded regenerable extracted-text/profile caches.
- Adds clearer Streamlit status, success, warning, error, and details-expander feedback around backup and health operations.
- Updates release docs and tests for the v1.0.20 safety foundation without changing Reader note UX or hash-performance behavior.

### v1.0.19-orphan-repair-and-storage-hardening

- Detects orphan extracted-text cache files whose `paper_id` no longer exists in the index.
- Adds export, reattach, and confirmed delete workflows for orphan Reading Note files and structured note-block files.
- Adds export, reattach, and unlink wording for orphan project links while preserving link notes where possible.
- Writes extracted-text `.txt` cache files through same-directory temporary files, flush/fsync, and atomic replacement.
- Preserves notes, note blocks, project links, PDFs, extracted text, and runtime user data by default; destructive repair actions require confirmation.

### v1.0.18-file-lifecycle-duplicate-policy

- Adds a read-only file lifecycle diagnosis layer for missing indexed PDFs, unindexed PDFs, same-hash duplicate candidates, duplicate rows, and likely reconnect candidates.
- Adds explicit same-hash duplicate actions in Library Health Check: keep, reconnect, ignore, and confirmed index-row removal.
- Reconnect preserves the selected `paper_id` and updates only file identity fields.
- Duplicate index-row removal deletes only the selected row after confirmation and warns that orphan records may remain for the orphan repair workflow.
- Keeps same-hash duplicate import behavior conservative; no automatic merge is performed.

### v1.0.17-reader-pdf-stabilization

- Makes native Streamlit PDF rendering the default Reader PDF path.
- Demotes HTML/base64 PDF rendering to an explicit experimental fallback with browser, Streamlit, file-size, and security-policy warnings.
- Adds a conservative large-PDF warning and blocks automatic large-file HTML/base64 rendering unless explicitly confirmed.
- Provides an external-open/local-path option for PDFs that are slow, blocked, or too large for in-app rendering.
- Preserves active Reader paper context across note save, tag apply, status/priority updates, and Reader project-link actions.
- Does not change tag suggestion logic, PDF profile extraction, metadata extraction, data schemas, FastAPI, or frontend architecture.

### v1.0.16-roadmap-release-evidence-sync

- Syncs ROADMAP, BACKLOG, regression checklist, release notes, and README against the implemented v1.0.10 through v1.0.15 state.
- Records validation expectations and automated evidence for the current `main` branch.
- Adds no product features, runtime migrations, paper/library data changes, or app version bump.

### v1.0.15-pdf-profile-extraction-repair

- Adds deterministic PDF text cleanup for profile extraction, including soft-wrap joining, line-break dehyphenation, common header/footer removal, downloaded-from/page-number noise removal, and safer author superscript cleanup.
- Extends `PaperTextProfile` with authors, DOI, article type, section headings, and extraction warnings.
- Extracts Abstract and Keywords from cached/full extracted PDF text and uses them to fill blank Crossref preview fields without overwriting non-empty current metadata.
- Adds explicit `pdf_abstract`, `pdf_keywords`, and `pdf_section_headings` tag suggestion sources.
- Keeps generated candidate tags preview-only; no LLM/API tagging and no automatic candidate application.

### v1.0.14-tag-quality-hygiene

- Adds deterministic cleanup for generated tag candidate phrases, including leaked section/source prefixes and low-information boilerplate tails.
- Classifies generated candidates as high, medium, weak, or rejected, with source-aware scoring that prefers title, keywords, and note Methods evidence over generic abstract fragments.
- Rejects duplicate candidate phrases already covered by canonical tags or aliases and preserves alias suggestions for safer future promotion review.
- Separates known canonical suggestions from candidate phrase suggestions in the UI and keeps rejected phrases in a collapsed debug view.
- Still defers full PDF methods/results extraction, LLM/API tagging, and automatic candidate application.

### v1.0.13-paper-text-profile-minimal

- Adds a JSON-backed minimal `PaperTextProfile` cache in `data/paper_profiles/{paper_id}.json`.
- Builds profiles from existing paper metadata, conservative abstract fallback text, Reading Note sections, and structured note blocks.
- Lets tag suggestion use profile title, abstract, keywords, and note sections with source-aware evidence while preserving Tag Book canonical/alias matching.
- Adds a Reader Workspace rebuild action and compact profile summary.
- Defers PDF methods/results extraction and weak keyphrase mining; profiles remain derived and rebuildable, not source-of-truth records.

### v1.0.12-tag-book-v2

- Adds dedicated Tag Book configuration under `config/tag_book/`.
- Routes default canonical tag, alias, validation, and suggestion flows through the Tag Book while preserving legacy config files for compatibility.
- Adds evidence-bearing grouped tag suggestions and preview-only method candidates.
- Adds Tag Book validation for duplicate canonicals, alias conflicts, normalized alias conflicts, blocked terms, and inactive statuses.
- Keeps paper, note, note-block, project, and project-link storage schemas unchanged.

### v1.0.11-scan-enrich-import-guard

- Keeps normal paper scanning focused on local PDF discovery, path/hash sync, and index row updates.
- Moves DOI extraction and Crossref lookup behind explicit metadata assist actions instead of the default scan path.
- Preserves existing DOI, metadata, tags, notes, note blocks, project links, and extracted-text data during cheap scans.
- Blocks duplicate external note imports at the service layer by default.
- Adds a deliberate force re-import path in the Streamlit import UI for intentional duplicate external note imports.

### v1.0.10-dev-bootstrap

- Adds Windows PowerShell scripts for setup, local checks, and Streamlit launch.
- Adds `start_blueprint.bat` as a simple launcher after setup.
- Makes the script-based Windows workflow the default README path.
- Adds text-inspection tests for the developer bootstrap scripts.
- Keeps app behavior, scanner/index/tag/PDF viewer behavior, and user data lifecycle unchanged.

### v1.0.9-atomic-json-writes

- Adds a shared atomic JSON write helper using same-directory temporary files, flush/fsync, and `os.replace`.
- Converts project, project-link, note-block, note-import log, canonical tag, and extracted-text metadata JSON writes to atomic writes.
- Preserves existing JSON formatting conventions and schemas.
- Keeps original target files unchanged when serialization or replacement fails.
- Adds no destructive cleanup behavior beyond removing failed temporary files.

### v1.0.8-orphan-record-repair-review

- Adds dedicated orphan note file, orphan note block file, and orphan project link review records in Library Health Check.
- Keeps orphan note and note block handling review-only with preserve/reattach/export guidance.
- Adds explicit confirmed removal for orphan project links only.
- Leaves papers, PDFs, notes, note blocks, and index rows untouched during orphan project-link removal.
- Preserves v1.0.6 missing-PDF repair and v1.0.7 same-hash duplicate review behavior.

### v1.0.7-same-hash-duplicate-review

- Adds classified duplicate PDF hash review groups for indexed duplicates, indexed + unindexed duplicates, and multiple unindexed duplicates.
- Shows enough context to choose a future canonical record/file: `pdf_sha256`, indexed/unindexed counts, indexed `paper_id`, title, filename, filepath, status, and cheap note/project-link counts when available.
- Marks unindexed duplicate files as "Do not add to index yet; handle later."
- Preserves v1.0.6 missing-PDF reconnect/remove behavior.
- Adds no automatic merge, PDF deletion, or index-row removal; real merge/remove workflow remains deferred.

### v1.0.6-missing-pdf-repair-workflow

- Adds explicit missing-PDF repair actions in Library Health Check.
- Reconnects a missing index record to a selected PDF in `papers/` while preserving `paper_id` and updating only filename, filepath, and `pdf_sha256`.
- Requires explicit confirmation before accepting a replacement PDF with a different SHA-256.
- Removes missing records from the index only after confirmation and leaves notes, note blocks, project links, PDFs, and caches untouched.
- Defers archive lifecycle, orphan cleanup, and full duplicate repair.

### v1.0.5-pdf-hash-identity-foundation

- Adds `pdf_sha256` to the paper index schema with non-destructive migration/backfill when PDFs are available.
- Preserves the existing `paper_id` when a scanned PDF's SHA-256 safely matches one existing record after a path rename.
- Leaves ambiguous same-hash duplicate content out of automatic merge/repair behavior and reports duplicate PDF hashes through Library Health Check.
- Introduces no repair UI, duplicate lifecycle workflow, viewer change, API, frontend migration, or packaging change.

### v1.0.4-baseline-regression-lock

- Locks the current Streamlit baseline with mandatory before/after regression validation.
- Adds a mandatory regression checklist and makes the smoke check require it.
- Aligns runtime version metadata with `1.0.4`.
- Introduces no product behavior changes.

### v1.0.2-google-docs-note-import

- Adds one canonical BluePrint Reading Note template under `docs/templates/`.
- Adds local one-way import from Markdown/text template files and Google Docs-exported `.docx` files.
- Previews parsed fields, detected sections, target paper matches, block counts, raw-note append behavior, and duplicate imports before apply.
- Appends imported Raw Notes into the Reading Note and creates structured note blocks only after explicit confirmation.
- Refreshes only the BluePrint Reading Note metadata header after accepted metadata updates; note body sections are preserved.
- Clarifies that structured blocks are retrieval/project-link cards while the Reading Note is the main paper note.

### v1.0.1-doi-less-metadata

- Adds DOI-less metadata candidates for arXiv/preprint/workshop PDFs.
- Detects modern and old-style arXiv IDs from filenames and PDF/extracted text.
- Adds optional arXiv metadata lookup with graceful offline/network failure diagnostics.
- Applies fallback metadata only after preview, preserving existing non-empty fields unless replacement is explicitly selected.

### v1.0.0-foundation

- Marks the stable foundation release target.
- Adds foundation principles, roadmap, backlog, development workflow, and release checklist docs.
- Keeps the app local-first, single-user, and Streamlit-based.
- Updates the runtime version reference to `1.0.0`.

### v0.9.9

- Adds a read-only release-readiness smoke-check script.
- Adds v1.0 manual smoke-test and new-PC restore checklists.
- Clarifies fresh-clone setup, Backup Snapshot manifest expectations, and manual restore validation.
- Updates the unpublished v1.0 draft without claiming a release.

### v0.9.8

- Reorganizes Settings into System, Library Maintenance, External Services, and Backup.
- Standardizes maintenance and diagnostic labels without changing service behavior.
- Restructures README startup, feature, development, and limitation guidance.
- Adds an unpublished v1.0 release-note draft under `docs/release_notes/`.

### v0.9.7

- Added light/full Backup Snapshots with checksummed manifests.
- Added the read-only Library Health Check.

### v0.9.6

- Added copy-only Drive Inbox Import while keeping `papers/` canonical.

### v0.9.5

- Hardened Crossref requests, diagnostics, contact identity, and non-empty metadata overlays.

### v0.9.4

- Added preview/confirm Paper Hygiene with stable paper identity.

### v0.9.0-v0.9.3

- Added projects, project links, tag governance, and workflow safety cleanup.

### v0.8.x

- Added structured note blocks and editing while preserving Markdown notes.

### v0.7.x

- Added full-text extraction, cache diagnostics, and stale-cache recovery.

### v0.5-v0.6

- Added metadata enrichment, tag suggestions, and the Reader Workspace.

## Known Limitations

- Visual PDF highlighting, coordinate annotations, OCR, graph visualization, Zotero integration, and relation graphs are not implemented.
- Google Drive support is local-folder based only; there is no Drive API or OAuth integration.
- BluePrint Reading Note import is local file import only; there is no Google OAuth, Google Docs API, live sync, or export to Google Docs.
- Structured note blocks are separate retrieval/project-link cards, not a live-synced replacement for the Reading Note.
- Backup restore is manual and should be performed while the app is stopped.
- Crossref depends on internet, TLS certificates, proxy settings, and provider availability.
- Image-only or scanned PDFs may yield no extracted text because OCR is not included.
- Native Streamlit PDF rendering is the default Reader path, but rendering can still vary by environment.
- The HTML/base64 PDF viewer is an explicit experimental fallback and may fail depending on browser, Streamlit, file size, or local security policy.
- Large PDFs are warned before rendering; large-file HTML/base64 fallback requires explicit confirmation.
- Same-hash duplicate rows are never auto-merged; users must choose keep, reconnect, ignore, or confirmed index-row removal.
- Orphan repair, metadata-only archive, and explicit verified rebuildable-cache quarantine are implemented; automatic destructive repair remains deferred.
- Extracted-text and paper-profile caches are excluded from backup snapshots by default because they are regenerable.
- Current restore, tag, and publication evidence is reported only in the [canonical current release status](docs/CURRENT_RELEASE_STATUS.md).

If Crossref reports an SSL/certificate problem, update the networking dependencies and check for TLS inspection:

```powershell
python -m pip install --upgrade requests urllib3 certifi
```
