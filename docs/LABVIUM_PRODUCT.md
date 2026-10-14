# 랩비움: evidence-first research workspace

랩비움 is the personal BANDAL edition of the BluePrintReboot research workspace.
The shared upstream project by 이서연 (Lilshawn-LSY) and 박상현 remains read-only.
This fork is where the hosted product and personal demonstration evolve.

## Product workflow

1. Upload or select PDFs. Preserve stable paper identities and verify duplicate
   content before registering another copy.
2. Read the original, select evidence, and explicitly save Paper Notes and typed
   Note Blocks. Extraction, manual interpretation and AI drafts have different
   provenance; a model's output does not become a verified fact automatically.
3. Organize research in hierarchical pages. Paragraph, heading, quote and
   checklist blocks can be reordered and linked to source papers, web sources
   and a project. Page edits remain drafts until **Save page** is chosen.
4. Retrieve saved evidence or search scholarly sources. Follow actual OpenAlex
   reference/citation relationships instead of treating keyword matches as a
   citation graph. Missing fields remain unavailable.
5. Prepare a handoff with separate verified facts, open questions, next steps and
   an owner. Export the page as Markdown or preserve the workspace in a backup.

For scanned PDFs, the optional OCR action performs actual on-device Tesseract
recognition using English and Korean models. First use downloads language data;
a run is limited to 20 scanned pages. Progress and cancellation are visible, and
source checksums and recognition provenance are retained with the extracted
text. Verify formulas, tables and wording against the original: recognition
confidence is not proof of accuracy, and OCR does not add selectable PDF text
coordinates or highlight geometry to image-only pages.

Guest metadata enrichment uses a real Crossref lookup with a same-origin
discovery fallback, followed by a reviewable save. Guest priority changes,
logical managed-PDF renaming and text-cache quarantine/recovery are implemented.
The rename does not modify the file on the user's computer or change a paper's
stable identity. Deterministic search-profile rebuild and canonical-tag
near-duplicate/merge maintenance are cloud capabilities; their guest controls
remain gated until a guest implementation exists. These differences mean this
release must not be described as complete original-application parity.

## Optional AI connection

An authenticated cited-answer server route exists, but no server AI key is
configured in the current deployment. The AI connection is therefore
disconnected; the product must not fabricate an answer or claim a model was
called. Manual notes, pasted-AI provenance labels, browser OCR and deterministic
metadata/text operations remain distinct from an active AI service.

## Manual templates

The page template selector provides Blank, Literature Review, Lab Handoff,
Industry Decision Record and CCS Evidence Review. Templates insert editable
prompts and unchecked tasks. They do not contain made-up measurements, claimed
findings, citations, simulations or pre-approved decisions.

The industry and CCS templates ask for:

- Metric, value, unit, range, source/page, evidence kind, uncertainty and reviewer.
- Assumptions, conflicting evidence, risk, next measurement and responsible owner.
- Code commit, data checksum, configuration, software version and output registry.

These are structured notebook prompts. A numerical geological model, audit
certification or engineering approval is not implemented by these templates.

## Persistence and safety

Signed-in account and selected shared-workspace requests use the unified cloud
transport. Creating and switching separate lab/company workspaces is implemented.
Workspace membership distinguishes owner, editor and viewer; only the
owner manages email access grants, and grants are claimed after trusted login.
The interface sends no invitation email by itself, and implementation/testing did
not add actual members to a user's workspace. Viewer requests cannot mutate
research or permissions. Guest requests use
an isolated browser workspace; uploaded PDF bytes and primary Paper/Project
state live in IndexedDB, while guest research pages have a separately validated,
versioned browser store. Switching mode does not silently copy or synchronize
guest records into an account.

Explicit saves carry an expected revision or note checksum. Corrupt stored state
is preserved and reported rather than replaced with an empty notebook. Backup
restore is previewed and confirmed, and newer edits made after preview cause a
conflict. Browser research-page restore retains a separate recovery snapshot;
if the PDF transaction fails, the page restore is rolled back using its revision.

Cloud account snapshots and portable exports are different artifacts. A cloud
snapshot can preserve account-bound PDF references without containing PDF bytes.
The interface reports this distinction. A guest full backup includes actual
stored PDF bytes and the bundled teaching PDFs; light backups require PDF
attachments separately. Read the restore preview's missing-PDF count.
The cloud portable export currently limits included active PDF bytes to 20 MiB;
larger workspaces can retain account-bound verified snapshots instead of
pretending a metadata-only file is an offline backup.

## Scholarly metrics policy

Discovery is guided by the selected research question, provider search relevance
and actual citation relationships. Author h-index is supplementary author-level
context. It is not a measure of one paper's truth, methodological quality or
relevance. It must be shown with the provider, author identity and available
update date. An absent metric is not assigned zero, fabricated or reconstructed
from incomplete search results.

OpenAlex author names are ambiguous: resolve an author to its stable ID and
review the profile before using a metric. The Leiden Manifesto identifies
discipline, career age and database coverage as important sources of distortion.

Primary references checked on 2026-10-14:

- [OpenAlex authors](https://help.openalex.org/data/authors/): author identities
  and bibliometric summary fields.
- [OpenAlex authentication](https://help.openalex.org/api/authentication/),
  updated 2026-10-12: basic keyless queries are permitted; a free key raises the
  allowance. Older February 2026 guides describing universally required keys
  are not the current policy.
- [OpenAlex API quick reference](https://help.openalex.org/api/llm-quick-reference/):
  author ID resolution, filter syntax and current API limits.
- [Crossref REST access](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/)
  and [rate-limit announcement](https://www.crossref.org/blog/announcing-changes-to-rest-api-rate-limits/):
  public access requires no signup; an identifying contact enables the polite
  pool. List queries have stricter limits than singleton lookups.
- [Leiden Manifesto](https://doi.org/10.1038/520429a), Nature 520, 429–431 (2015):
  metrics supplement expert judgement and must account for field differences.

## Proposed industry extensions — not implemented

1. Evidence register with typed units, measured/modeled/assumed classifications,
   uncertainty intervals, immutable source-page references and reviewer signoff.
2. Decision review that requires alternatives, conflicting evidence, acceptance
   criteria and a documented next measurement before approval.
3. Reproduction packages with checked data checksums, code/environment locks,
   executable runs and an output registry. A filled notebook prompt alone is
   not a reproducibility check.
4. Extend the implemented owner/editor/viewer workspaces with real-time
   coediting, organization SSO, review queues, a durable activity audit and
   retention policies. These extensions remain proposed; current access control
   and owner-managed email grants are already implemented.
5. CCS screening/model integration with site-specific evidence, unit checking,
   pressure and containment analysis, groundwater considerations and validated
   monitoring. Do not market a sample ranking as geological feasibility.

Prioritize these after reliability, portable recovery and the complete research
workflow have been verified with real project owners.
