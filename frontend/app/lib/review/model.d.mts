export type ReviewKind = 'hypothesis' | 'decision' | 'failed_attempt' | 'question' | 'next_action';
export type ReviewStage = 'comparison' | 'decision' | 'handoff';
export interface ReviewContext { stage:ReviewStage;method:string;conditions:string;metric:string;value:string;unit:string;availability:'reported'|'not_reported'|'unavailable'|'extraction_failed';disposition:'pending'|'adopted'|'rejected'|'deferred';rationale:string;comparison_ids:string[];completed:boolean;origin_decision_id?:string }
export interface ReviewSource { kind:'paper'|'pdf_page'|'note_block'|'research_page';paper_id:string;page:number|null;block_id:string;research_page_id:string }
export interface ReviewRow { id:string;kind:ReviewKind;text:string;owner:string;due_date:string;status:'open'|'reviewed';provenance:'manual'|'ai';source_links:ReviewSource[];context?:ReviewContext }
export interface ReviewInput { schema_version:1;rows:ReviewRow[];checklist:Record<ReviewKind,boolean> }
export interface ReviewSourceInput { reference:ReviewSource;label:string;content:string }
export interface ReviewSnapshot { snapshot_id:string;version:number;created_at:string;reviewed_by:string;input:ReviewInput;source_fingerprint:string;source_inputs:ReviewSourceInput[] }
export interface ReviewDossier extends ReviewInput { source_fingerprint:string;snapshots:ReviewSnapshot[] }
export interface ReviewSourceDescriptor { key:string;reference:ReviewSource;label:string;url:string;excerpt:string;content?:string }
export interface ReviewCoverage { total_rows:number;substantive_rows:number;reviewed_claims:number;sourced_reviewed_claims:number;coverage_percent:number|null;unsourced_reviewed_rows:string[];missing_source_rows:string[];open_rows:number;unsourced_questions_actions:number;checklist_complete:boolean;can_freeze:boolean }
export interface ProjectReviewResponse { project_id:string;project_name:string;project_status:string;dossier:ReviewDossier;revision:string;sources:ReviewSourceDescriptor[];source_fingerprint:string;coverage:ReviewCoverage;draft_sources_stale:boolean;latest_snapshot_stale:boolean;draft_differs_from_snapshot:boolean;status?:'saved'|'frozen';snapshot?:ReviewSnapshot }
export const REVIEW_KINDS: ReviewKind[];
export const REVIEW_STAGES: ReviewStage[];
export const REVIEW_MAX_SNAPSHOTS:number;
export function blankReviewInput():ReviewInput;
export function reviewInput(dossier:ReviewInput):ReviewInput;
export function newReviewRow(kind?:ReviewKind):ReviewRow;
export function newWorkflowRow(stage?:ReviewStage):ReviewRow & {context:ReviewContext};
export function validateReviewSource(value:unknown):ReviewSource;
export function validateReviewInput(value:unknown):ReviewInput;
export function validateReviewDossier(value:unknown):ReviewDossier;
export function getReviewDossier(project:Record<string,unknown>):ReviewDossier;
export function reviewRevision(project:Record<string,unknown>):string;
export function reviewSourceKey(source:ReviewSource):string;
export function reviewSourceUrl(source:ReviewSource):string;
export function collectProjectReviewSources(state:Record<string,unknown>,projectId:string):ReviewSourceDescriptor[];
export function selectedReviewSources(input:ReviewInput,sources:ReviewSourceDescriptor[],strict?:boolean):ReviewSourceInput[];
export function reviewFingerprint(input:ReviewInput,sources:ReviewSourceDescriptor[]):Promise<string>;
export function reviewCoverage(input:ReviewInput,sources:ReviewSourceDescriptor[]):ReviewCoverage;
export function compareReviewSnapshots(previous:ReviewInput|null|undefined,current:ReviewInput):{added:ReviewRow[];changed:ReviewRow[];removed:ReviewRow[];checklist_changed:boolean};
export function exportReviewMarkdown(snapshot:ReviewSnapshot|ReviewInput,projectName?:string):string;
