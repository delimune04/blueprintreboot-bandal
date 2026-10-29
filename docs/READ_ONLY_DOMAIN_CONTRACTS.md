# Read-Only Domain Contracts

v1.0.26 freezes five plain-dictionary contracts in `services/library_read_model.py`. They contain JSON primitives only, use predictable empty-string/list/false defaults, expose workspace-safe relative paths, and never serialize pandas, `Path`, Streamlit state, exceptions, or absolute private paths. Builders read current state without creating, migrating, or saving files.

| Contract | HTTP adapter | Stable purpose |
|---|---|---|
| `HealthSummary` | `GET /health` | Overall healthy/degraded/blocked state and stable blocking, warning, corruption, quarantine, missing, and duplicate counts. |
| `LibraryStatus` | `GET /library/status` | Active/archived/missing/duplicate/corrupt/quarantine counts, degraded flag, and generic workspace warnings. |
| `PaperListItem` | `GET /papers` | List-only identity, citation summary, reading state, tags, archive/missing flags, and compact health labels. |
| `PaperDetail` | `GET /papers/{paper_id}` | List fields plus filename, safe relative PDF path, DOI, project-link summaries, note/cache/profile availability, lifecycle state, and recoverable warnings. |
| `ReaderSnapshot` | `GET /papers/{paper_id}/reader` | Paper detail, resolved PDF state, persisted note content/availability, canonical header values, content hash/size baseline, warnings, and unavailable reason. |

These remain domain builders rather than HTTP code. The FastAPI adapter calls them instead of reparsing CSV/JSON or importing `ui_streamlit`. Mutable session drafts are deliberately excluded.

## Implemented in v1.1.0

The initial local read-only API implements exactly:

| Route | Response contract | Behavior |
|---|---|---|
| `GET /health` | `HealthSummary` | Returns HTTP 200 for valid healthy, degraded, and blocked domain states. |
| `GET /library/status` | `LibraryStatus` | Returns HTTP 200 whenever a valid status contract is available, including degraded state. |

Both routes use strict Pydantic response schemas with undeclared fields forbidden. A genuine builder/storage failure becomes a generic HTTP 503 response without exception, path, environment, contact, or configuration details.

At v1.1.0, paper lists, paper detail, Reader snapshots, PDF serving, notes, tags, projects, write actions, CORS, authentication, caching, background work, databases, and frontend work remained deferred.

## Implemented in v1.1.1

The Paper API adapts the frozen `PaperListItem` and `PaperDetail` builders through explicit strict Pydantic models:

| Route | Contract | Behavior |
|---|---|---|
| `GET /papers` | `PaginatedPaperList` containing `PaperListItem` values | Defaults to active papers, supports `active`/`archived`/`all`, and paginates with `limit`, `offset`, `total`, and `has_more`. |
| `GET /papers/{paper_id}` | `PaperDetail` | Returns active or archived detail by stable ID; unknown IDs return a structured 404. |

Collection ordering follows the established domain rule: case-insensitive title ascending, then `paper_id` ascending. Archive state comes only from the existing `is_archived` lifecycle field; absent archive values remain active, and reading `status` stays independent.

The HTTP mapper normalizes strings, years, tags, and booleans, rejects missing paper identity/title, strips path components from filenames, rejects unsafe absolute/traversal PDF paths, and allowlists every response field. It never receives or returns an arbitrary CSV row.

The frozen domain detail currently provides DOI, safe PDF/lifecycle state, project-link summaries, and note/cache/profile availability. Journal, abstract, keywords, and arXiv identifiers remain outside the v1.1.1 API rather than being read directly from storage; they require a deliberate future domain-contract extension.

## Extended in v1.1.2

`PaperDetail` now also contains `authors: list[str]`, `journal: str`, `abstract: str`, `keywords: list[str]`, and `arxiv_id: str`. `PaperListItem` is unchanged, so `GET /papers` remains a lightweight collection contract while `GET /papers/{paper_id}` carries rich citation metadata.

Canonical sources and precedence are:

| Public field | Canonical source | Normalization |
|---|---|---|
| `authors` | `paper_index.csv` `authors` column | Existing semicolon serialization becomes an ordered list; whitespace and empty entries are removed, and commas inside names are preserved. |
| `journal` | `paper_index.csv` `journal` column | Outer whitespace is removed; missing/None/NaN becomes `""`. |
| `abstract` | `paper_index.csv` `abstract` column | The complete stored value is preserved with outer whitespace removed; no summarization or truncation. |
| `keywords` | `paper_index.csv` `keywords` column | Existing comma serialization becomes an ordered list; whitespace and empty entries are removed. |
| `arxiv_id` | Existing Reading Note identity rule | A normalized explicit `arxiv_id` wins when present; otherwise the first identifier detected deterministically from stored DOI, filename, title, abstract, and keywords is used. |

Older indexes need no migration during reads: the read-only index snapshot supplies safe defaults for absent canonical columns. PaperTextProfile is a derived cache and is not a fallback for this contract. API reads do not call Crossref, OpenAlex, arXiv, PDF extraction, or any other network/enrichment path, and they do not parse extracted full text.

## Extended in v1.5.11

`GET /papers` remains the existing bounded Paper collection contract, extended with optional `q`, `tag`, `year`, and reading `status` query parameters. The Paper read model constructs normalized internal search context from stored title, authors, journal, DOI, tags, and keywords; it does not expose that context or any raw index row. Search normalizes a read-only copy with NFKC and case folding, then requires every whitespace-separated query term as a literal substring, regardless of order. Punctuation (including DOI slashes, periods and hyphens) stays literal, not regular-expression or Boolean syntax. Empty/whitespace-only queries impose no text restriction; filters are applied before pagination, and the existing active/archived lifecycle selection remains orthogonal to reading status.

`POST /papers/reconnect` is an explicit managed-PDF command rather than a read-model route. Its scan preview exposes only safe relative paths, controlled state, and stable Paper identity where a unique repair is available. The command rechecks the exact hash identity under the shared lock and updates only the existing Paper row's managed-file identity fields. It never serializes an absolute path, SHA-256 value, raw exception, or stored Paper metadata.

## Consumed by the v1.2.0 frontend shell

The initial desktop-first web shell consumed `GET /health`, `GET /library/status`, `GET /papers`, and `GET /papers/{paper_id}` through a centralized typed client. Browser components do not call FastAPI directly; a same-origin server bridge forwards only allowlisted GET paths to the configured local API URL.

Dashboard, Library, Papers, and Paper Detail render explicit loading, empty, error, and unavailable states. Projects, Tags, and Settings do not invent domain data while their contracts are absent. The frontend adds no write operation and does not change any frozen API or domain response shape.

## Reader Snapshot HTTP slice in v1.5.0

`GET /papers/{paper_id}/reader` now calls `build_reader_snapshot(paper_id)` once and adapts its result through strict `ReaderSnapshotResponse`, `ReaderNoteHeader`, and `ReaderNoteBaseline` schemas. The nested paper uses the established `PaperDetail` adapter. Header and baseline dictionaries are field-allowlisted, PDF state is limited to `available` or `missing`, warning values are normalized strings, and malformed domain values become the existing generic unavailable boundary.

The exact persisted `saved_note_content` string is returned without trimming, Markdown parsing, hashing, or another file read in the API layer. An unknown paper is a generic 404; missing PDF, missing note, and a recoverable unreadable-note warning remain HTTP 200 snapshot states. The route accepts no filesystem path and exposes no Streamlit state, pandas object, exception detail, environment value, or arbitrary storage dictionary.

The same-origin bridge allowlists only the exact `papers/{paper_id}/reader` shape as JSON. It does not forward `Range` for this route and leaves the existing managed-PDF streaming and Range contract unchanged. The web Reader uses one snapshot request and presents the saved note as selectable plain text; editing and every write action remain in Streamlit.

## Full-text extraction HTTP slice in v1.5.12

The full-text service remains the sole owner of extraction/cache behavior. `GET /papers/{paper_id}/full-text/status` returns bounded cache, provider, classification, character/page-count, stale, and OCR-needed state. `GET /papers/{paper_id}/full-text` returns that same status plus the canonical cached Markdown/plain-text projection. Neither read exposes cache paths, source PDF paths, SHA-256 values, third-party objects, or raw provider errors.

`POST /papers/{paper_id}/full-text/extract` is an explicit command with a strict `force` boolean. It delegates to the existing `pdf-inspector`-first, MarkItDown, then pypdf workflow and never schedules background work or extracts on import. Failed refresh preserves a prior valid cache; corrupt cache metadata is not overwritten through this route. The same-origin bridge allowlists only these exact method/path pairs.

Metadata enrichment preview may read a current SHA-256-validated canonical extraction cache as local evidence. When no current cache exists, it resolves one bounded non-persisting `pdf-inspector`-first fallback result and shares it across DOI/arXiv detection, PDF-profile parsing, and title fallback. This preview path never calls the explicit Full Text extraction command, writes cache metadata/content, changes Paper extraction state, or exposes paths, fingerprints, third-party objects, or raw provider errors.

## Integrity and coherent-read hardening in v1.5.13

Library Health treats parseable data as healthy only when it satisfies the store contract. Registry-owned JSON validates its top-level shape and required item fields; malformed entries are corruption and are never filtered into an apparently empty valid state. Note Block files validate object identity, owning `paper_id`, block type, and duplicate IDs. `paper_index.csv` validation requires its identity/path columns, a non-empty unique safe `paper_id` per row, and at least one usable filename or filepath. Diagnostics are read-only and never repair, normalize, or overwrite user state.

`data/tag_candidate_reviews.json` is included in the shared persistent-state registry, Health diagnostics, Settings resource counts/integrity warnings, and backup coverage. A missing store remains a valid empty state; a corrupt or malformed store is distinct from empty and blocks dependent writes.

Reader snapshots now use exactly one index snapshot for paper detail, editable metadata, and revision baselines. They do not combine rows from multiple CSV reads or depend on a later `.iloc[0]`. Managed PDF availability uses the same `papers/`-bounded resolver as PDF serving and Full Text, including the filename-only legacy fallback.

Related API reads share a short-lived Health result keyed by diagnostic arguments. Completion of a same-process workspace write invalidates it immediately through the workspace mutation generation; changes from another local process are stale for at most one second. This preserves the separate `/health`, `/library/status`, and `/papers` contracts without repeating a full disk scan during one dashboard load.

Collection APIs remain paginated. The frontend Projects list exposes previous/next pages, while Paper/Project/Tag selectors collect successive pages until `has_more` is false. Project link detail collects every link page only while project and link revisions remain unchanged; revision drift fails the read instead of mixing revisions. Entities after the first 100 are therefore not silently inaccessible.

## v1.6.3 Tags candidate-review queue

`GET /tags/review-queue` is a bounded read-only view over already-persisted
per-Paper candidate-review contexts. It returns only safe Paper display fields,
aggregate candidate-state counts, and a short candidate-label preview. It does
not invoke candidate generation, mutate a review context, apply a Paper tag,
or expose storage paths or raw records. Missing review storage is an empty
queue; malformed review storage remains an explicit unavailable read state.
