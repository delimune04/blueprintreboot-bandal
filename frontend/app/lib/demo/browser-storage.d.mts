export const BROWSER_WORKSPACE_KEY: string;
export const MAX_BROWSER_PDF_BYTES: number;
export const MAX_BACKUP_BYTES: number;
export interface BrowserPdfRecord { key: string; paper_id: string; filename: string; sha256: string; kind: "active" | "recovery"; created_at: string; blob: Blob; }
export interface BrowserWorkspaceArchive { schema_version: 1; revision: string; workspace: unknown; pdfs: Array<Omit<BrowserPdfRecord, "blob"> & {data_base64:string}>; }
export function configureBrowserWorkspace(contract: {seed:()=>unknown;validate:(state:unknown)=>unknown}):void;
export function getBrowserWorkspaceStorage(): {getItem(key:string):Promise<string|null>;setItem(key:string,value:string):Promise<unknown>;compareAndSet(key:string,expected:string|null,next:string,effects?:{putFiles?:BrowserPdfRecord[];deleteFiles?:string[]}):Promise<boolean>};
export function getBrowserPdfRecord(key:string):Promise<BrowserPdfRecord|null>;
export function listBrowserPdfRecords():Promise<BrowserPdfRecord[]>;
export function listBrowserRecoveryWorkspaces():Promise<Array<{recovery_id:string;kind:"workspace";created_at:string;summary:string;value:string}>>;
export function restoreBrowserRecoveryWorkspace(recoveryId:string,options:{expected_revision:string;confirm:true}):Promise<{status:"restored";revision:string;recovery_id:string}>;
export function cachedBrowserPdfUrl(paperId:string):string;
export function cacheBrowserPdfUrl(paperId:string,blob:Blob,revision?:string):string;
export function revokeBrowserPdfUrl(paperId:string):void;
export function loadBrowserPdfUrl(paperId:string,key?:string):Promise<string>;
export function sha256Blob(blob:Blob):Promise<string>;
export function sha256Bytes(bytes:Uint8Array):Promise<string>;
export function workspaceRevision(value:unknown):Promise<string>;
export function validatePdfFile(file:Blob&{name?:string}):Promise<{sha256:string;size_bytes:number}>;
export function getMaintenanceSnapshot():Promise<{revision:string;paper_count:number;project_count:number;pdf_count:number;recovery_count:number;bytes:number;storage:"indexeddb"}>;
export function exportBrowserWorkspace():Promise<BrowserWorkspaceArchive>;
export function previewBrowserWorkspaceRestore(archive:unknown):Promise<{valid:boolean;revision:string;paper_count:number;pdf_count:number;total_bytes:number;warnings:string[]}>;
export function restoreBrowserWorkspace(archive:unknown,options:{expected_revision:string;confirm:true}):Promise<{status:"restored";revision:string;recovery_id:string}>;
