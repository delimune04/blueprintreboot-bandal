export type HealthState = "healthy" | "degraded" | "blocked" | string;

export interface HealthSummary {
  overall_state: HealthState;
  blocking_issues: number;
  warning_count: number;
  corrupt_critical_state_count: number;
  quarantine_count: number;
  missing_pdf_count: number;
  duplicate_review_count: number;
}

export interface LibraryStatus {
  active_count: number;
  archived_count: number;
  missing_count: number;
  duplicate_count: number;
  corrupt_count: number;
  quarantine_count: number;
  degraded: boolean;
  workspace_warnings: string[];
}

export interface PaperListItem {
  paper_id: string;
  title: string;
  first_author: string;
  year: string;
  status: string;
  priority: string;
  tags: string[];
  archived: boolean;
  missing_pdf: boolean;
  metadata_only?: boolean;
  health: string[];
}


export interface ProjectLink {
  project_id: string;
  link_type: string;
  target_type: string;
}

export interface PaperDetail extends PaperListItem {
  external_source?: import("../workspace/types").ScholarlyWork;
  discovery_identifiers?: string[];
  authors: string[];
  journal: string;
  abstract: string;
  keywords: string[];
  arxiv_id: string;
  filename: string;
  relative_pdf_path: string;
  doi: string;
  project_links: ProjectLink[];
  note_available: boolean;
  extracted_text_available: boolean;
  profile_available: boolean;
  lifecycle_state: string;
  recoverable_warnings: string[];
  reading_status_revision: string;
  pdf_revision: string;
  lifecycle_revision: string;
}

export type ReaderPdfState = "available" | "missing";

export interface ReaderNoteHeader {
  template_version: string;
  paper_id: string;
  title: string;
  doi: string;
  arxiv_id: string;
  year: string;
  first_author: string;
  tags: string;
}

export interface ReaderNoteBaseline {
  exists: boolean;
  sha256: string;
  size_bytes: number;
}

export interface EditablePaperMetadata {
  title: string;
  authors: string;
  year: string;
  journal: string;
  doi: string;
  abstract: string;
  keywords: string;
}

export interface ReaderSnapshot {
  paper: PaperDetail;
  editable_metadata: EditablePaperMetadata;
  metadata_revision: string;
  tags_revision: string;
  pdf_state: ReaderPdfState;
  saved_note_available: boolean;
  saved_note_content: string;
  canonical_note_header: ReaderNoteHeader;
  saved_note_baseline: ReaderNoteBaseline;
  warnings: string[];
  unavailable_reason: string;
}

export type FullTextCacheState = "not_extracted" | "success" | "cached" | "stale" | "failed" | "ocr_needed";
export type FullTextExtractionState = "not_extracted" | "success" | "failed" | "ocr_needed";

export interface FullTextStatus {
  paper_id: string;
  state: FullTextCacheState;
  extraction_state: FullTextExtractionState;
  source: string;
  provider: string;
  provider_version: string;
  content_format: "markdown" | "plain_text";
  classification: "text" | "scanned" | "image-based" | "mixed" | "unknown";
  page_count: number;
  char_count: number;
  ocr_needed_pages: number[];
  extracted_at: string;
  has_content: boolean;
  is_stale: boolean;
  can_extract: boolean;
  previous_cache_preserved: boolean;
  message: string;
}

export interface FullTextDocument extends FullTextStatus {
  content: string;
}

export type NoteBlockType = "summary" | "claim" | "method" | "evidence" | "question" | "idea" | "limitation";

export interface EditableNoteBlockContent {
  block_type: NoteBlockType;
  title: string;
  text: string;
  page: string;
  figure: string;
  quote: string;
  tags: string[];
  provenance?: {
    source: "pdf_selection";
    page: number;
    coordinate_space: "page-normalized";
    rectangles: Array<{ x: number; y: number; width: number; height: number }>;
    quote: string;
  };
}

export interface NoteBlock extends EditableNoteBlockContent {
  id: string;
  paper_id: string;
  created_at: string;
  updated_at: string;
}

export interface NoteBlockProjectLink {
  link_id: string;
  project_id: string;
  project_name: string;
  project_status: ProjectStatus | "unavailable";
  note_block_id: string;
  link_type: ProjectLinkType;
  links_revision: string;
}

export interface NoteBlockCollection {
  source_paper: { paper_id: string; title: string };
  items: NoteBlock[];
  total: number;
  note_blocks_revision: string;
  project_links: NoteBlockProjectLink[];
  project_links_state: "available" | "unavailable";
}

export interface NoteBlockCommandResponse {
  status: "created" | "saved" | "no_op";
  block: NoteBlock;
  note_blocks_revision: string;
  total: number;
}
export interface DeleteNoteBlockResponse {
  status: "deleted";
  note_blocks_revision: string;
  total: number;
}

export interface PersistedReadingNote {
  exists: boolean;
  content: string;
  sha256: string;
  size_bytes: number;
}

export interface MetadataCommandResponse {
  status: "saved" | "no_op";
  metadata: EditablePaperMetadata;
  metadata_revision: string;
  changed_fields: Array<keyof EditablePaperMetadata>;
  note_header_status: "updated" | "unchanged" | "not_present" | "not_required";
  canonical_note_header: ReaderNoteHeader;
  canonical_note_header_text: string;
  reading_note: PersistedReadingNote;
}

export interface ReadingStatusCommandResponse {
  status: "saved" | "no_op";
  reading_status: "unread" | "reading" | "read" | "finished";
  reading_status_revision: string;
}

export interface RemoveManagedPdfResponse {
  status: "removed" | "already_missing";
  paper_id: string;
  pdf_removed: boolean;
  recovery_copy_created: boolean;
  message: string;
}

export interface ArchivePaperResponse {
  status: "archived" | "already_archived";
  paper_id: string;
  lifecycle_revision: string;
  message: string;
}

export type MetadataEnrichmentFieldName = keyof EditablePaperMetadata;
export type MetadataEnrichmentFieldState = "unchanged" | "conflict" | "available" | "unavailable";

export interface MetadataEnrichmentFieldPreview {
  field: MetadataEnrichmentFieldName;
  current_value: string;
  candidate_value: string;
  source: string;
  state: MetadataEnrichmentFieldState;
}

export interface MetadataEnrichmentPreview {
  paper_id: string;
  metadata_revision: string;
  candidate_sources: string[];
  fields: MetadataEnrichmentFieldPreview[];
  diagnostics: string[];
}

export interface PaperTagCommandResponse {
  status: "saved" | "no_op";
  tags: string[];
  tags_revision: string;
  note_header_status: "updated" | "unchanged" | "not_present";
  canonical_note_header: ReaderNoteHeader;
  canonical_note_header_text: string;
  reading_note: PersistedReadingNote;
}

export interface CanonicalTagGovernanceItem {
  canonical_key: string;
  label: string;
  category: string;
  aliases: string[];
  status: string;
  suggestion_strength: number;
  description: string;
}

export interface CanonicalTagGovernanceSnapshot {
  items: CanonicalTagGovernanceItem[];
  registry_revision: string;
}

export interface CanonicalTagGovernanceResponse {
  status: "created" | "saved" | "no_op" | "deprecated";
  tag: CanonicalTagGovernanceItem;
  registry_revision: string;
}

export interface TagCandidateEvidence {
  source: string;
  source_label: string;
  matched_text: string;
  snippet: string;
}

export type TagCandidateState = "unresolved" | "resolved" | "approved" | "rejected" | "applied";

export interface TagCandidateItem {
  candidate_id: string;
  tag_text: string;
  normalized_tag: string;
  resolved_canonical: string;
  canonical_status: string;
  category: string;
  source: string;
  source_label: string;
  matched_text: string;
  evidence: TagCandidateEvidence[];
  score: number;
  confidence: number;
  quality: string;
  reason: string;
  state: TagCandidateState;
  generated_kind: "known_canonical" | "new_candidate" | "weak_candidate" | "rejected_candidate";
}

export interface TagCandidateCollection {
  paper_id: string;
  review_revision: string;
  tags_revision: string;
  state: "not_generated" | "generated";
  items: TagCandidateItem[];
}

export interface TagCandidateApplyResponse {
  candidate: TagCandidateItem;
  review_revision: string;
  paper_tag: PaperTagCommandResponse;
}

export interface ReadingNoteCommandResponse {
  status: "created" | "saved" | "no_op";
  content: string;
  sha256: string;
  size_bytes: number;
}

export type ManagedPdfScanStatus = "new" | "already_registered" | "duplicate_content" | "reconnect_available" | "reconnect_ambiguous" | "invalid" | "unavailable";

export interface ManagedPdfScanCandidate {
  relative_path: string;
  filename: string;
  status: ManagedPdfScanStatus;
  message: string;
  can_import: boolean;
  can_reconnect: boolean;
  reconnect_paper_id: string;
  size_bytes: number;
}

export interface ManagedPdfScanResponse {
  status: "ok" | "unavailable";
  message: string;
  candidates: ManagedPdfScanCandidate[];
}

export type ManagedPdfImportStatus = "imported" | "already_registered" | "duplicate_content" | "missing" | "invalid" | "unavailable";

export interface ManagedPdfImportResult {
  relative_path: string;
  filename: string;
  status: ManagedPdfImportStatus;
  message: string;
  can_import: boolean;
  size_bytes: number;
  paper_id: string;
}

export interface ManagedPdfImportResponse {
  message: string;
  imported_count: number;
  results: ManagedPdfImportResult[];
}

export interface ManagedPdfReconnectResponse {
  status: "reconnected";
  paper_id: string;
  relative_path: string;
  message: string;
}

export interface PaginatedPaperList {
  items: PaperListItem[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface ProjectListItem {
  project_id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  tags: string[];
  created_at: string;
  updated_at: string;
  project_revision: string;
  link_count: number;
  linked_paper_count: number;
  linked_note_block_count: number;
}

export interface LinkedPaperSummary {
  paper_id: string;
  title: string;
  first_author: string;
  year: string;
  status: string;
  priority: string;
  tags: string[];
  archived: boolean;
}

export type ProjectTargetState = "available" | "orphaned" | "orphaned_note_block" | "orphaned_paper" | "unavailable" | "not_applicable";

export interface LinkedNoteBlockSummary {
  block_id: string;
  paper_id: string;
  source_paper_title: string;
  block_type: NoteBlockType;
  title: string;
  text_preview: string;
  page: string;
  figure: string;
  tags: string[];
}

export interface ProjectLinkTarget {
  link_id: string;
  link_type: string;
  target_type: string;
  target_id: string;
  target_state: ProjectTargetState;
  paper_id: string;
  created_at: string;
  paper: LinkedPaperSummary | null;
  note_block: LinkedNoteBlockSummary | null;
}

export interface ProjectDetail extends ProjectListItem {
  links: ProjectLinkTarget[];
  links_total: number;
  links_limit: number;
  links_offset: number;
  links_has_more: boolean;
  links_revision: string;
  orphaned_link_count: number;
}

export type ProjectStatus = "active" | "paused" | "done" | "archived";
export type EditableProjectStatus = Exclude<ProjectStatus, "archived">;
export type ProjectPriority = "low" | "normal" | "high";
export type ProjectLinkType = "related" | "background" | "key_reference" | "supports_project" | "raises_question" | "idea_for_project";

export interface EditableProjectMetadata {
  name: string;
  description: string;
  status: EditableProjectStatus;
  priority: ProjectPriority;
  tags: string[];
}

export interface ProjectCommandState {
  project_id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  tags: string[];
  created_at: string;
  updated_at: string;
  project_revision: string;
  links_revision: string;
  link_count: number;
  linked_paper_count: number;
  linked_note_block_count: number;
}

export interface ProjectCommandResponse {
  status: "created" | "saved" | "no_op" | "archived" | "already_archived";
  project: ProjectCommandState;
}

export interface PaperLinkCommandState {
  link_id: string;
  project_id: string;
  paper_id: string;
  link_type: ProjectLinkType;
  created_at: string;
}

export interface PaperLinkCommandResponse {
  status: "created" | "unchanged" | "removed";
  project: ProjectCommandState;
  link: PaperLinkCommandState;
}

export interface NoteBlockLinkCommandState {
  link_id: string;
  project_id: string;
  paper_id: string;
  note_block_id: string;
  link_type: ProjectLinkType;
  created_at: string;
}

export interface NoteBlockLinkCommandResponse {
  status: "created" | "unchanged" | "removed";
  project: ProjectCommandState;
  link: NoteBlockLinkCommandState;
}

export interface PaginatedProjectList {
  items: ProjectListItem[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface CanonicalTag {
  canonical_key: string;
  label: string;
  category: string;
  aliases: string[];
  status: string;
  suggestion_strength: number;
}

export interface PaginatedTagList {
  items: CanonicalTag[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  source_state: "canonical" | "legacy_fallback";
}

export interface CandidateSummary {
  availability: "available" | "unavailable";
  state: "populated" | "empty" | "unavailable";
  source: "paper_index" | "none";
  evaluated_paper_count: number;
  candidate_count: number;
  known_canonical_match_count: number;
  quality_counts: {
    high: number;
    medium: number;
    weak: number;
    rejected: number;
  };
}

export interface TagCandidateReviewQueueItem {
  paper_id: string;
  title: string;
  candidate_count: number;
  unresolved_count: number;
  resolved_count: number;
  approved_count: number;
  candidate_labels: string[];
}

export interface TagCandidateReviewQueue {
  items: TagCandidateReviewQueueItem[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export type SettingsState = "healthy" | "warning" | "unavailable" | "empty";

export interface SettingsWorkspaceResource {
  code: "papers" | "notes" | "projects" | "tags" | "note_blocks" | "project_links" | "tag_candidate_reviews";
  label: string;
  state: SettingsState;
  count: number | null;
  summary: string;
}

export interface SettingsIntegrityIssue {
  code: "missing_pdfs" | "unindexed_pdfs" | "orphan_notes" | "orphan_note_blocks" | "orphan_project_links" | "corrupt_json" | "corrupt_index";
  state: "healthy" | "warning" | "unavailable";
  count: number | null;
  severity: "warning" | "error";
  explanation: string;
  next_action: string;
}

export interface SettingsSummary {
  application: {
    state: "healthy";
    product_version: string;
    api_state: "available";
    api_contract_version: string;
    summary: string;
  };
  workspace: {
    state: SettingsState;
    resources: SettingsWorkspaceResource[];
    summary: string;
  };
  data_integrity: {
    state: "healthy" | "warning" | "unavailable";
    issues: SettingsIntegrityIssue[];
    summary: string;
  };
  backup_readiness: {
    state: "healthy" | "warning" | "unavailable";
    snapshot_available: boolean | null;
    last_updated_at: string | null;
    summary: string;
    evidence_state?: "absent" | "invalid" | "stale" | "verified_full" | "verified_light" | "unavailable" | null;
    snapshot_type?: "full" | "light" | null;
  };
}

export interface DashboardSnapshot {
  health: HealthSummary;
  library: LibraryStatus;
  papers: PaginatedPaperList;
  projects: ProjectListItem[];
}
