export interface ReproductionRun { id:string;title:string;paper_ids:string[];review_row_ids:string[];dataset:string;data_version:string;data_url:string;data_sha256:string;repository_url:string;commit_sha:string;environment:string;procedure:string;result:string;artifact_url:string;status:'planned'|'running'|'completed'|'failed';created_at:string;updated_at:string }
export interface EvidenceSignal { id:string;paper_id:string;kind:'retraction'|'correction'|'contradictory'|'other';source:'manual'|'OpenAlex'|'Crossref';url:string;summary:string;observed_at:string;status:'open'|'reviewed';resolution:string;resolved_at:string;resolved_by:string }
export interface ContinuityDossier { schema_version:1;runs:ReproductionRun[];signals:EvidenceSignal[];checked_at:string;checks:Array<{paper_id:string;title:string;status:'checked'|'unavailable'|'no_doi';message:string;checked_at:string}> }
export interface ContinuityResponse { project_id:string;project_name:string;project_status:string;revision:string;dossier:ContinuityDossier;papers:Array<{paper_id:string;title:string;doi:string}>;review_rows:Array<{id:string;kind:string;text:string}>;affected_rows:Array<{row_id:string;kind:string;text:string;signal_ids:string[]}> }
export function blankRun():ReproductionRun;
export function blankContinuity():ContinuityDossier;
export function validateRun(v:unknown):ReproductionRun;
export function validateSignal(v:unknown):EvidenceSignal;
export function validateContinuity(v:unknown):ContinuityDossier;
export function getContinuity(project:Record<string,unknown>):ContinuityDossier;
export function continuityRevision(project:Record<string,unknown>):string;
export function affectedReviewRows(project:Record<string,unknown>,signals:EvidenceSignal[]):ContinuityResponse['affected_rows'];
export function continuityResponse(state:Record<string,unknown>,projectId:string):ContinuityResponse;
export function continuityCommand(state:Record<string,unknown>,projectId:string,action:string,command:Record<string,unknown>,actor?:string):ContinuityResponse & {status:string};
export function exportContinuity(data:ContinuityResponse):string;
