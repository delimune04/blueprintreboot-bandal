export type CollaborationRole = 'owner' | 'editor' | 'viewer';
export interface CollaborationMember { id:string;name:string;email:string;role:CollaborationRole;accepted:boolean }
export interface CollaborationActor { id:string;name:string;email:string;role:CollaborationRole }
export interface CollaborationContext { actor:CollaborationActor;members:CollaborationMember[];mode:'cloud'|'browser';now?:()=>string;id?:()=>string }
export interface CollaborationSource { type:'paper'|'project'|'page'|'none';id:string;title:string;excerpt:string;available?:boolean }
export interface CollaborationEventInput { title:string;description:string;start_date:string;end_date:string;all_day:boolean;start_time:string;end_time:string;participant_ids:string[];project_id:string }
export interface CollaborationEvent extends CollaborationEventInput { id:string;created_by:string;created_by_name:string;created_at:string;updated_at:string }
export interface CollaborationIdeaInput { title:string;body:string;recipient_ids:string[];source:CollaborationSource }
export interface CollaborationIdea extends CollaborationIdeaInput { id:string;status:'open'|'resolved';author_id:string;author_name:string;created_at:string;updated_at:string }
export type CollaborationTaskStatus = 'todo'|'in_progress'|'submitted'|'done'|'cancelled';
export interface CollaborationTaskInput { title:string;description:string;assignee_id:string;due_date:string;priority:'normal'|'high';project_id:string;source_idea_id:string }
export interface CollaborationTask extends CollaborationTaskInput { id:string;assignee_name:string;assigned_by:string;assigned_by_name:string;status:CollaborationTaskStatus;created_at:string;updated_at:string }
export interface CollaborationComment { id:string;target_type:'idea'|'task';target_id:string;body:string;author_id:string;author_name:string;created_at:string;updated_at:string }
export interface CollaborationNotification { id:string;recipient_id:string;kind:'idea'|'reply'|'assignment'|'submission'|'task_status';target_type:'idea'|'task';target_id:string;title:string;actor_id:string;actor_name:string;created_at:string;read_at:string }
export type CollaborationRecord = CollaborationEvent | CollaborationIdea | CollaborationTask | CollaborationComment;
export interface CollaborationRequest { request_id:string;actor_id:string;fingerprint:string;result_id:string;result_type:'event'|'idea'|'task'|'comment';result:CollaborationRecord;created_at:string }
export interface CollaborationState { version:1;revision:number;events:CollaborationEvent[];ideas:CollaborationIdea[];tasks:CollaborationTask[];comments:CollaborationComment[];notifications:CollaborationNotification[];requests:CollaborationRequest[] }
export interface CollaborationSnapshot { revision:string;actor:CollaborationMember;members:CollaborationMember[];events:CollaborationEvent[];ideas:CollaborationIdea[];tasks:CollaborationTask[];comments:CollaborationComment[];notifications:CollaborationNotification[];permissions:{can_edit:boolean;can_assign:boolean;can_comment:boolean};mode:'cloud'|'browser';time_zone:'Asia/Seoul' }
export interface CollaborationCommandResult extends CollaborationSnapshot { status:'saved';result_id:string;result?:CollaborationRecord;idempotent:boolean;changed:boolean }
export interface CollaborationWorkspace { collaboration?:CollaborationState;papers?:Array<{paper_id:string;metadata?:{title?:string};title?:string}>;projects?:Array<{project_id:string;name?:string;title?:string}>;researchPages?:Array<{id:string;title?:string}>;[key:string]:unknown }
export function emptyCollaboration():CollaborationState;
export function validateCollaboration(value:unknown):CollaborationState;
export function getCollaborationSnapshot(state:CollaborationWorkspace,ctx:CollaborationContext):CollaborationSnapshot;
export function applyCollaborationCommand(state:CollaborationWorkspace,parts:string[],method:string,body:Record<string,unknown>,ctx:CollaborationContext):CollaborationCommandResult|CollaborationSnapshot|null;
