# BluePrint UI Design System

## Purpose and scope

This document defines the shared desktop research-workspace foundation for
BluePrintReboot v1.6.5. It guides the application shell, navigation,
information exposure, density, interaction language, and the stable White /
Ink / Blueprint Blue palette. It does not authorize unrelated backend contract
changes or a page-specific workflow redesign; the bounded workflow commands
documented below remain governed by their service and recovery contracts.

The executable source of truth for numeric values and shared classes is
`frontend/app/globals.css` and the components under `frontend/app/components/`.
This document explains how to use those primitives consistently.

## Final palette: White / Ink / Blueprint Blue

The application is a cool white research surface, not a coloured dashboard.
White represents a working document or control surface; Ink carries content
and structure; Blueprint Blue identifies interaction and selection. Blue is
never a broad decorative background or a replacement for semantic feedback.

| Role | Token | Value | Use |
| --- | --- | --- | --- |
| Working surface | `--color-surface` | `#FFFFFF` | Editors, forms, inspectors, drawers, PDF/document surfaces. |
| Canvas | `--color-canvas` | `#F7F8F8` | General application background. |
| Subtle surface | `--color-surface-subtle` | `#FAFBFB` | Quiet control and table context. |
| Sidebar | `--color-sidebar` | `#F3F4F4` | Neutral navigation base. |
| Ink | `--color-text` | `#171A1B` | Main readable text. |
| Strong secondary ink | `--color-text-strong-secondary` | `#2B3032` | Dense structural surfaces such as the Reader stage. |
| Secondary ink | `--color-text-secondary` | `#596164` | Supporting copy and metadata. |
| Muted ink | `--color-text-muted` | `#7A8386` | De-emphasized structural detail. |
| Faint rule | `--color-rule-faint` | `#E3E6E6` | Ordinary rows and metadata separation. |
| Default rule | `--color-rule` | `#C9CED0` | Inputs, toolbars, and secondary boundaries. |
| Strong rule | `--color-rule-strong` | `#202425` | Major table, Reader, and section transitions only. |
| Blueprint Blue 700 | `--blue-700` | `#1769AA` | Strong links and hover emphasis. |
| Blueprint Blue 600 | `--blue-600` | `#1A73E8` | Links, strong interaction, and focus-adjacent emphasis. |
| Blueprint Blue 500 | `--blue-500` | `#4285F4` | Active interaction and selected structural markers. |
| Blueprint Blue 300 | `--blue-300` | `#8AB4F8` | Light interactive borders, especially canonical tags. |
| Blueprint Blue 100 | `--blue-100` | `#DDEBFF` | Restrained selected surfaces. |
| Blueprint Blue 050 | `--blue-050` | `#F3F7FF` | Faint canonical-tag and focus-adjacent context. |

## Semantic state palette

Semantic color carries domain meaning only. It layers on the White / Ink /
Blueprint Blue foundation: Blueprint Blue remains the interaction and
selection color, while the state palette identifies persistent state,
priority, relationship meaning, and actionable health. Do not use these
colors for ordinary rows, navigation destinations, broad card backgrounds, or
canonical tags.

| Tone | Tokens | Value | Meaning |
| --- | --- | --- | --- |
| Blue | `--state-blue`, `--state-blue-soft` | `#1A73E8`, `#E7F0FC` | Active work and Reading. |
| Green | `--state-green`, `--state-green-soft` | `#2E7D32`, `#E6F2EA` | Completed, healthy, or successfully saved. |
| Amber | `--state-amber`, `--state-amber-soft` | `#B26A00`, `#FAEEDB` | Attention, paused work, high priority, or an idea. |
| Rose | `--state-rose`, `--state-rose-soft` | `#B3261E`, `#F8E7E7` | Failure, conflict, offline, missing, or critical state. |
| Violet | `--state-violet`, `--state-violet-soft` | `#7452A8`, `#EFEAF7` | Questions and key-reference semantics. |
| Slate | `--state-slate`, `--state-slate-soft` | `#5F6B73`, `#EEF1F2` | Neutral, inactive, archived, background, or low-priority state. |

The normal presentation remains a small, strong-colored square marker with
normal Ink-readable text. Soft backgrounds are reserved for an exceptional
compact badge or an attention treatment; they are not decorative fills and
status labels must not become rounded pills.

## v1.6.5 visual-language grammar

BluePrint is a scientific notebook, technical drafting sheet, and local desktop
research tool. Its identity comes from information structure, calm density,
typographic roles, and a clear hierarchy of rules—not from decorative cards,
gradients, soft shadows, or generic dashboard styling.

- Use the canvas for ordinary reading, lists, metadata, and section context.
  Reserve white surfaces for actual work: editors, forms, inspectors, drawers,
  and PDF/document areas.
- Prefer aligned rows, tables, list rules, and section boundaries to enclosing
  every content group in a bordered panel. A boundary remains appropriate when
  it describes an input surface, selected inspector, modal, drawer, or another
  functional containment relationship.
- The shared structural tokens are `--rule-faint` for quiet row separation,
  `--rule` for ordinary control and inspector boundaries, and `--rule-strong`
  for major table, toolbar, workspace, and section structure. Do not turn
  strong rules into a box around every surface. `--border` aliases the default
  rule for compatible controls.
- Use `--radius-sm` for controls and working surfaces. `--radius-md` is still
  deliberately small and should be reserved for the few bounded surfaces that
  benefit from it. Shadows indicate an actual overlay or floating surface;
  ordinary panels and collection surfaces are flat.
- BluePrint has exactly two font roles. Main Sans uses the local/system
  `Pretendard`-style stack (`Pretendard`, Korean system fallbacks, and
  system-ui) for all human-readable content: navigation, titles, prose,
  editors, controls, tables, metadata labels, and helper text. Technical Mono
  uses `IBM Plex Mono` with local system-mono fallbacks only for structural
  notation, compact statuses, page values, counts, years where useful, and
  identifiers such as DOI or arXiv. These are local/system role stacks, not
  runtime network font dependencies. There is no third serif role.
- Avoid all-caps marketing eyebrows. When compact context notation is useful,
  use a quiet mono label with an accent rule rather than a repeated promotional
  label.
- Ordinary domain metadata is a quiet inline, mono status marker. Strong
  rectangular badges are reserved for exceptional or actionable states such as
  Missing PDF, Conflict, Offline, Failed, or Archived. This is a visual
  distinction only; it never changes the underlying state semantics.
- Selection uses a restrained surface change plus an inset accent rule. Hover
  changes color, a rule, or a subtle background only. Do not use lift, scale,
  or decorative motion.

Page archetypes express the same grammar in different proportions: Dashboard
is a compact workbench; Library and Tags are catalogue/index surfaces;
Project Detail is a dossier; Settings is a quiet utility surface; and Reader
is an instrument workspace with the strongest alignment, hairline separation,
and least decorative chrome. The optional drafting-grid motif is intentionally
not used behind prose, editable content, or PDF pages.

## Application shell and navigation

Normal application pages use the shared left sidebar and retain the established
primary destinations: Dashboard, Library, Projects, Tags, and Settings. The
expanded sidebar remains the normal working width. Its explicit toggle changes
it to an icon rail; icon labels remain available through accessible names and
tooltips. The normal-page collapsed preference is session-scoped and survives
route navigation and reloads in that browser session.

Reader is a workspace exception. It does not reserve the expanded sidebar
column. A narrow left-edge reveal zone opens the normal sidebar as a fixed
overlay, so the PDF never resizes or shifts. The revealed navigation includes
an explicit close control and a pin/unpin control. Reader overlay state is
separate from the normal-page collapsed preference and must never overwrite it.

Do not add navigation destinations, global search, command palettes, sync
controls, or other controls without an implemented product capability.

## Breadcrumbs and top chrome

Top-level pages do not display breadcrumbs. The active sidebar item already
provides that location context.

Nested object pages use the shared `Breadcrumbs` component:

- `Library / <paper identity>` for Paper Detail.
- `Library / <paper identity> / Reader` for Reader.
- `Projects / <project name>` for Project Detail.
- `Tags / <tag name>` when a tag-detail route exists.

Breadcrumb identities must be compact, navigable where meaningful, and allowed
to truncate rather than force a large layout. In Reader, the fixed navigation
trigger has a reserved structural grid slot: the `Library` parent label and
final `Reader` label never truncate, while only the intervening Paper title may
shrink. When a breadcrumb provides the parent route, do not also add a
standalone "Back to …" link.

The shell does not spend persistent top-chrome space on a version label or a
duplicate local-workspace label. Product version, API contract version, and
other maintenance data belong primarily in Settings diagnostics.

Settings may sit in a visually secondary, lower navigation group when the
shell has enough height. This changes emphasis, not route availability or
keyboard access.

The selected sidebar destination uses a neutral white surface plus a 2px
Signal Blue inset rule, not a broad blue fill. Collapse, pin, close, and
secondary shell controls remain neutral until hover or focus.

Reader is the most instrument-like application surface. Its active tabs,
utility controls, fit modes, and resize/focus affordances use Signal Blue as
an underline, border, text/icon, or focus treatment. Inactive controls stay
Ink/neutral; large blue Reader backgrounds are not part of the grammar.

## Information hierarchy

Every UI decision should place information in one of four tiers.

| Tier | Meaning | Typical examples |
| --- | --- | --- |
| Primary | Required to complete the current task; visible by default. | Paper title, author, year, project name. |
| Contextual | Helps understand or choose. | Abstract, journal, tags, reading status. |
| Operational | Temporary state beside the active operation. | Saving, Saved, Extracting, Failed, Conflict. |
| Diagnostic | Implementation or maintenance detail. | UUIDs, raw ISO timestamps, cache provider/version, storage internals, API versions. |

Do not surface diagnostic data as ordinary content merely because it is
available in an API response. Put it in Settings or a clearly advanced,
diagnostic context. Existing safety errors remain visible and actionable.

## Status taxonomy

Use status presentation according to its meaning, not according to its API
field name.

- **Domain state** is persistent and meaningful to a person: Unread, Reading,
  Finished, Active, Archived, or priority. It may appear normally.
- **Operational state** is temporary: Saving, Extracting, Conflict, Failed, or
  a reload requirement. Keep it adjacent to the control or operation it
  describes, with an accessible live announcement where appropriate.
- **System health** is diagnostic: Healthy, Clean, Cached, Ready, or internal
  service state. Keep ordinary healthy state quiet on task surfaces; surface
  abnormal or actionable state clearly. Settings is the intended health and
  diagnostics surface.

Do not change the meaning of backend states while changing their display.

### State tone mapping

`semantic-tones` is the central domain-value-to-tone mapping used by compact
status markers. It accepts normalized backend values but does not infer tones
for taxonomy chips.

| Domain state | Tone |
| --- | --- |
| Reading: Unread | Slate |
| Reading: Reading | Blue |
| Reading: Read or Finished | Green |
| Project: Active / Paused / Done / Archived | Blue / Amber / Green / Slate |
| Priority: Low / Normal / High / Urgent or Critical | Slate / Slate / Amber / Rose |
| Operational and health: Healthy, Clean, Available, Ready, Success | Green |
| Operational and health: Warning, Stale, OCR needed | Amber |
| Operational and health: Conflict, Failed, Offline, Unavailable | Rose |

`SaveStatus` continues to communicate only the existing explicit-save state;
its saved result is green, active saving work is blue, and conflicts/failures
remain rose. No state color changes command timing, revisions, drafts, or
conflict recovery.

Avoid duplicate state: show a save state beside the editor or command it
describes, not again in a parent context. Likewise, quiet ordinary system
health such as an active lifecycle state belongs out of persistent workspace
chrome; exceptional, actionable, or unavailable state remains visible close to
the affected work.

## Tag and status notation

Tag-like values have distinct visual meaning and must not collapse into a row
of colourful pills.

- **Canonical tags** are compact, near-square labels with restrained padding,
  a Signal Blue left rule, a Blue Line border, and the faintest blue context.
  Use them for the
  maintained taxonomy on Papers, Projects, Library rows, Tags, and Reader.
- **Aliases and imported keywords** are small neutral rectangular labels with
  a faint/default rule. They have no blue emphasis by default.
- **Candidate or generated suggestions** are quieter still: plain inline text
  or a very light rectangular treatment. Long natural-language suggestions may
  wrap within their table/list cell rather than force a capsule or overflow.

This hierarchy communicates canonical taxonomy > alias > candidate without
changing tag semantics, candidate review, or persistence.

`StatusBadge` has parallel levels: a small mono label with a square marker for
ordinary states such as Active, Reading, Available, High priority, link type,
or Saved; and a small unfilled/semantic rectangular badge for exceptional
states. Preserve semantic danger, warning, and success colours, and keep Save
Status explicit and adjacent to its operation.

### Explicit-save draft states

For a user-authored explicit-save surface, use exactly this visible vocabulary:
**Saved**, **Unsaved changes**, **Saving...**, **Save failed**, **Changed
elsewhere**, and **Offline**. Do not make revision hashes, `409`, stale
revision, or reload terminology the primary label. A local draft remains until
the matching server response is confirmed; an edit during a request remains
Unsaved changes after the earlier snapshot succeeds. Changed elsewhere keeps
the local draft and latest server value separate and must provide an explicit
keep-my-draft/use-latest path. A save status belongs next to its editor/action
and uses the shared `SaveStatus` presentation.

## Layout archetypes

Future page work follows one of these three structures.

### Collection

Library, Projects, and Tags are high-density collection surfaces:

```text
Header
Toolbar / actions
Collection (list or table)
Optional inspector or context surface
```

Library keeps the collection as the primary surface. At wide desktop widths,
its selected-paper inspector is a bounded side-by-side dossier and the table
column remains shrinkable. Between roughly 1280px and 1440px, the same
inspector becomes a bounded right overlay so opening it never creates
body-level horizontal overflow. Table scrolling, when needed, remains local to
the table shell; title is the flexible column while author, year, reading,
tags, and Inspect have deliberate constrained widths. The inspector preserves
its existing close and focus-return behavior in both presentations.

### Detail

Paper Detail, Project Detail, and comparable objects prioritize inspection:

```text
Breadcrumb
Object header + primary action
Main information
Context / secondary information
```

Use the shared `page-stack--detail` modifier for a bounded detail reading
width (about 1200–1400px). Project Detail starts with a compact metadata row,
not a large fact-card strip: status, priority, updated time, linked-material
counts, and project tags belong together near the identity. Linked research
material appears ahead of editing and lower-frequency management.

### Workspace

Reader prioritizes the active work area:

```text
Compact workspace chrome and toolbars
Maximum main workspace area
Optional contextual panels
```

Do not use this foundation pass to turn one archetype into another or to
redesign the existing Library, Reader panel, Projects, Tags, Dashboard, or
Settings workflows.

Dashboard uses the shared `page-stack--dashboard` modifier (about
1200–1350px) for a readable working surface. Broad collection surfaces keep
the default shell width. Reader remains unrestricted because its PDF workspace
is the active surface.

### Workspace information hierarchy patterns

Collection creation and management controls are progressive disclosures. A
Projects or Tags collection leads with items to review; a create form appears
only after its explicit action, except when a locally preserved draft needs to
be recovered. Object details lead with the object and its related research
material. Forms that create or manage links are secondary to linked Paper and
Note Block cards.

When a temporary collection disclosure closes, focus returns to the action
that opened it. A selected-item inspector returns focus to the selected row's
control when dismissed. This keeps the browse → inspect → continue loop fully
keyboard operable without inventing modal behavior where a stacked layout is
already sufficient.

Diagnostic information does not share the default task surface. Settings may
describe real workspace/application information and link to Diagnostics;
verbose health, integrity, count, API, and backup details belong in that
dedicated diagnostic context. Attention states should link directly there.

Abstracts and other extracted prose use a bounded readable content column
(about 65–80 characters). Display adapters may join extraction soft-wrapped
lines, but must preserve blank-line paragraph boundaries and never write the
normalized value back to persistent metadata.

## Spacing, typography, and controls

Use the shared spacing scale from `globals.css`. The canonical increments are
4px (`--space-1`), 8px (`--space-2`), 12px (`--space-3`), 16px
(`--space-4`), 24px (`--space-6`), 32px (`--space-8`), and 48px
(`--space-12`). `--space-5` intentionally aliases `--space-4` and
`--space-10` intentionally aliases `--space-12` for existing component
compatibility; new work should choose canonical tokens rather than introduce
arbitrary values.

- Use 4–8px for inline and micro separation, 12–16px for compact controls and
  related content, 24px for grouped content, 32px for sections, and 48px only
  for major separation.
- Page titles use `--font-size-xl`; section titles use `--font-size-md`; body
  copy uses `--font-size-base`; helper and metadata copy use
  `--font-size-sm` or `--font-size-xs`.
- Tables use compact 12px cell padding (`--space-3`), a strong header baseline,
  and faint ordinary-row separators. Preserve readable headers and horizontal
  scrolling rather than forcing data to wrap badly or becoming row cards.
- Standard controls use `--control-height` (36px); compact shell controls use
  `--control-height-compact` (32px). Reuse `reader-control`, its secondary
  variant, and the existing semantic button patterns rather than creating a
  second control system.
- Use `--rule-faint`, `--rule`, and `--rule-strong` according to structural
  importance. `--radius-sm` is 3px and `--radius-md` is 4px: keep the
  interface precise without making controls harsh. Focus must remain plainly
  visible through the shared Blueprint Blue focus ring and border. Disabled
  controls must retain their label and visibly communicate that they cannot be
  used.

Primary actions are the one action that advances the current task. Secondary
actions are neutral alternatives. Destructive or irreversible actions retain a
distinct danger treatment and their existing confirmation requirements.

Project Detail exposes Edit Project as its ordinary primary action. Reload and
Archive are lower-frequency recovery/destructive actions and may share a
compact secondary disclosure, while remaining keyboard-discoverable. Linked
Paper and Note Block rows reserve their visible space for identity, compact
citation/context, relationship, exceptional target state, and navigation;
unlink is a labelled secondary row action and keeps its confirmation behavior.
Ordinary rows target roughly 56–72px where their content permits. Two-line
title clamping is acceptable when the full label remains exposed accessibly.

## Copy and edit behavior

Use a page title and, at most, one concise user-facing sentence. Omit section
descriptions when the section title and content are self-explanatory. Prefer
plain product language over implementation language such as “contract,”
“command,” “deterministic,” “revision-checked,” “allowlisted,” “read model,”
or “stored record.” Safety and error messages may explain necessary constraints
in direct, user-facing terms.

Do not introduce a global read/edit mode. Editor surfaces may keep directly
editable controls, but informational fields should not turn into inputs merely
for visual consistency. Preserve explicit Save, reload, conflict, and
revision-safety behavior.

## Reader interaction patterns

Reader top chrome is a single compact desktop row where practical. Breadcrumbs
provide Paper identity and expose a truncated Paper title through the existing
full-title tooltip; do not add a second visible title heading. A visually
hidden document heading may preserve semantic hierarchy. Tags and Full Text
remain immediate utility controls. Ordinary active lifecycle state is quiet;
archived, unavailable, conflict, and other exceptional state remains visible
where relevant.

The Reader keeps compact Paper context at the top of the research panel. Its
persistent modes are **Note**, **Blocks**, and **Details**. Switching modes
hides inactive work without destroying its editor, selection, draft, preview,
conflict, or link-management state. The Note mode is the default, and tabs
retain semantic roles, visible focus, and ordinary keyboard focus order.

Paper context is informational: author, year, DOI/arXiv when present, panel
collapse, and a meaningful restored-draft notice. Paper Note `SaveStatus`
belongs only beside the Paper Note editor; metadata `SaveStatus` belongs only
in Details. The Paper Note formatting toolbar uses compact icon or typographic
controls with an accessible name and title for every icon-only action. Its
selection-preservation behavior is part of the control contract.

On desktop, the research panel is session-resizable from 320px to 520px. A
pointer resize must be paired with an accessible range control and reset
action. Tags and Full Text open as overlay utility drawers by default: an
overlay does not add a grid column or reduce the PDF stage width. Opening a
drawer moves focus into it; Escape and its close control return focus to the
initiating control.

PDF controls provide previous/next page, zoom, fit width, fit page, and manual
zoom. Fit width uses the usable PDF stage width; fit page considers both stage
dimensions. Manual zoom leaves fit mode cleanly. Logical PDF/text-layer
geometry remains independent of backing-canvas high-DPI rendering.

The utility drawer header names the currently open utility and includes Close.
Do not repeat a full Tags/Full Text tab switcher inside the drawer unless a
future workflow has a material reason for one. Its overlay, focus management,
Escape behavior, and PDF-position preservation remain unchanged.

When a browser-local draft is restored, show a compact live `Draft restored`
notice or the existing unsaved state. Normal in-app navigation does not
interrupt work with a confirmation when that draft is safely preserved.
Explicit discard, deliberate replacement with a saved version, and destructive
operations retain their confirmation semantics.

Collection toolbars use the shared `Toolbar` structure. Prefer structured
controls for known values, including searchable canonical-tag suggestions and
reading-status selects. Text search may debounce before refresh, every filter
change resets pagination, and a collection title remains a normal navigation
link with a separate Inspect action for contextual inspection.

### Library Reading Status refresh rule

The revision-checked Reading Status command uses the canonical `paper_id` and
updates visible Library state only after its server response succeeds. For an
unfiltered Library collection (or a collection filtered only by unrelated
fields), the response patches the matching row and open inspector locally; it
does not reload the full collection, `/health`, or `/library/status`. When an
active exact Reading Status filter means the Paper could enter or leave the
result set, only the Paper collection is re-read. A failed command leaves the
previous visible row and inspector state intact; normal Dashboard reads update
when Dashboard is opened.

## Relationship labels, bounded operations, and removal

Project relationship types are semantic metadata, not primary interactions.
Use `RelationshipLabel` consistently for linked Papers and Note Blocks in
Project Detail and Reader context. Labels are compact rectangular notations
with a 2px semantic side rule and no bright pill fill: Related and Background
are Slate, Key reference and Raises question are Violet, Supports Project is
Green, and Idea for Project is Amber. Blueprint Blue remains reserved for
interaction and canonical-tag structure.

## Selected-Paper first-page thumbnails

`FirstPageThumbnail` is a contextual Paper-identity aid, not collection
decoration. It mounts only after the Library inspector has loaded its selected
Paper, or on an open Paper Detail page; ordinary Library rows never request or
render thumbnails. The shared client component uses the existing local managed
PDF URL and PDF.js adapter to render only page 1 into a bounded canvas, then
cancels/destroys the task and document when its surface closes or changes. It
does not add an endpoint, persistent thumbnail cache, background rendering, or
Reader state.

The inspector preview is a compact 88px-wide slot beside the Paper identity;
Paper Detail uses a contextual 132px-wide preview in its metadata context. A
faint structural rule contains the canvas without a card or shadow. Loading
reserves the same geometry; missing or unavailable managed PDFs show a concise
`First page preview unavailable` document fallback. The accessible preview
label is intentionally concise and does not attempt to reproduce page content.

Library scan, import, reconnect, and upload feedback uses a compact operation
result strip. Full per-file detail belongs in the bounded Library operation
drawer; it must not grow the collection page below the toolbar. PDF drop state
is temporary and appears only while files are dragged over Library.

`Remove PDF file` deletes only managed PDF bytes after a verified recovery copy
in the workspace recovery area. The Paper record, metadata, Reading Note, Note
Blocks, Tags, and Project links remain, and the Paper is shown as Missing PDF.
`Remove Paper from Library` is an archive action that removes it from active
Library views while preserving its managed PDF and all related research.
Permanent Paper deletion is deliberately unavailable until a complete
research-data deletion/recovery contract exists.

The shared BluePrint mark is an inline vector Constructed B: an Ink datum line,
quiet construction outline, and Blueprint Blue geometric counters. It must be
recognizable at 16–32px, remain readable in the collapsed sidebar, expose no
separate focus target, and work in monochrome. Do not substitute raster artwork,
gradients, generic book/science imagery, or a plain text `B`.

## Accessibility and responsiveness

Maintain semantic headings, labelled navigation, keyboard-reachable controls,
visible focus, and live status feedback for active operations. Icon-only
controls require accessible names. Collapsed navigation must remain operable
without hover; Reader hover reveal always has explicit open, close, and pin
controls as alternatives.

The primary target is a desktop research workspace. At narrower widths,
collections may scroll horizontally and normal navigation may compact, but
content, controls, and all navigation destinations must remain accessible.
Respect reduced-motion preferences and do not make hover the sole way to reach
an action.

## LabVium web skin (hosted build only)

The hosted LabVium build (`frontend/demo`, mounted at `/LabVium`) layers a
modern presentation over this foundation without changing shared tokens,
component contracts, or the local application's appearance. Its stylesheets
load after the shared ones and every rule is scoped to
`[data-bandal-demo="true"]`:

- `demo/skin.css` sets the LabVium palette (logo violet `#7c3aed` / deep
  `#5b21b6`, with an indigo gradient for primary emphasis), softer rules,
  8–16px radii, light elevation for working surfaces, round status markers,
  a translucent account strip and app bar, and the bundled Pretendard
  Variable typeface (`demo/fonts/pretendard`, OFL 1.1, unicode-range
  subsets served from the same origin).
- `demo/home.css` owns the landing page: an aria-hidden hero aura, the
  glass workflow card, collaboration and feature cards, and the closing panel.
- At 64rem and below the account strip scrolls away on ordinary pages and the
  compact app bar stays sticky; the Reader keeps the strip because its shell
  never scrolls.

Motion in this skin is decorative and opt-in. Every animation sits inside
`@media (prefers-reduced-motion: no-preference)`. Content entrances (route
fade, staggered page sections, dialogs, drawers, menus) use `backwards` fill
only, so no transform remains after they finish and fixed overlays keep the
viewport as their containing block. The Reader workspace is excluded from
content entrances, and nothing in the skin changes PDF stage geometry.
Landing-page section reveals and the pointer-following card highlight come
from `labvium-motion.mjs`, which never hides content before it runs and skips
touch-first pointers and reduced motion.
