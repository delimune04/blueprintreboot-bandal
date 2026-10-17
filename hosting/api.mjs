import * as c from "./domain/core.mjs";
import { ownerKey, requireWriteOrigin, loadWorkspace, saveWorkspace, putPrivateObject, readPrivateObject } from "./domain/store.mjs";
import { routeCommands } from "./domain/commands.mjs";
import { routeMaintenance, backupReadiness } from "./domain/maintenance.mjs";
import { routeResearch } from "./domain/research.mjs";
import { stageUploads } from "./domain/papers.mjs";
import { discover, related } from "./domain/providers.mjs";
import { generateCitedAnswer } from "./ai.mjs";
import { resolveWorkspaceAccess, routeWorkspaceMembership } from "./membership.mjs";
import { routeTagMaintenance } from "./domain/tag-maintenance.mjs";
import { routeProfile } from "./domain/profile.mjs";
import { explore } from "./domain/exploration.mjs";
import { getProjectExplorationState, saveProjectExplorationState } from "../frontend/app/lib/exploration/model.mjs";
import { routeReview } from "./domain/review.mjs";
import { routeContinuity } from "./domain/continuity.mjs";
import { prepareAiSources, selectAiEvidence } from "../frontend/app/lib/ai/sources.mjs";

const SIGN_IN_URL="/signin-with-chatgpt?return_to=%2Fku-ai%2F";
export const HOSTED_CAPABILITIES={pdf_upload:true,pdf_read:true,client_pdf_extraction:true,server_pdf_extraction:false,ocr:true,client_ocr:true,server_ocr:false,metadata_enrichment:true,tag_review:true,tag_merge:true,near_duplicate_tags:true,profile_rebuild:true,rename_pdf:true,cache_quarantine:true,paper_priority:true,backup:true,restore:true,note_import:true,research_pages:true,full_text_search:true,private_cloud_storage:true};
function reply(value,status=200,revision){const headers={"Content-Type":"application/json","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Vary":"oai-authenticated-user-id"};if(revision!==undefined)headers["X-Labvium-Workspace-Revision"]=c.rev(revision);return new Response(JSON.stringify(revision===undefined?value:{...value,workspace_revision:c.rev(revision)}),{status,headers});}
function displayName(request){const raw=request.headers.get("oai-authenticated-user-full-name")||"";try{return (request.headers.get("oai-authenticated-user-full-name-encoding")==="percent-encoded-utf-8"?decodeURIComponent(raw):raw).slice(0,300);}catch{return "";}}
async function boundedBytes(request,maximum){const length=Number(request.headers.get("content-length")||0);if(length>maximum)c.fail(413,"The request exceeds the supported size limit.");if(!request.body)return new Uint8Array();const reader=request.body.getReader(),chunks=[];let total=0;while(true){const{done,value}=await reader.read();if(done)break;total+=value.length;if(total>maximum){await reader.cancel();c.fail(413,"The request exceeds the supported size limit.");}chunks.push(value);}const result=new Uint8Array(total);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;}
async function commandBody(request,path){if(request.method==="GET"||request.method==="HEAD")return{};const contentType=request.headers.get("content-type")||"";if(path==="papers/upload"){if(!contentType.toLowerCase().startsWith("multipart/form-data"))c.fail(422,"PDF uploads require multipart form data.");const bytes=await boundedBytes(request,30*1024*1024);let form;try{form=await new Response(bytes,{headers:{"Content-Type":contentType}}).formData();}catch{c.fail(422,"The PDF upload form is unreadable.");}if([...form.keys()].some(key=>key!=="files"))c.fail(422,"Unknown PDF upload fields.");return form;}
 const limit=path==="backups/import-preview"?32*1024*1024:8*1024*1024,bytes=await boundedBytes(request,limit);if(!bytes.length)return{};if(!contentType.toLowerCase().startsWith("application/json"))c.fail(422,"Commands require a JSON body.");let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{c.fail(422,"The command body is not valid JSON.");}if(!c.object(body))c.fail(422,"The command body must be an object.");return body;
}
async function pdfResponse(request,paper,state,ctx){if(!c.hasPdf(paper,state))c.fail(404,"The managed PDF is missing.");const file=state.files[paper.pdfPath];let range=null;const raw=request.headers.get("range");if(raw){const match=/^bytes=(\d*)-(\d*)$/.exec(raw);if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{"Content-Range":`bytes */${file.size_bytes}`}});let start,end;if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<1)return new Response(null,{status:416,headers:{"Content-Range":`bytes */${file.size_bytes}`}});start=Math.max(0,file.size_bytes-suffix);end=file.size_bytes-1;}else{start=Number(match[1]);end=match[2]?Number(match[2]):file.size_bytes-1;}if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=file.size_bytes||end<start)return new Response(null,{status:416,headers:{"Content-Range":`bytes */${file.size_bytes}`}});end=Math.min(end,file.size_bytes-1);range={offset:start,length:end-start+1};}
 if(typeof file.key!=="string"||!file.key.startsWith(`labvium/${ctx.owner}/pdfs/`))c.fail(409,"Invalid private PDF reference.");const object=await ctx.env.LABVIUM_PDFS.get(file.key,range?{range}:undefined);if(!object)c.fail(404,"The managed PDF object is missing.");const headers={"Content-Type":"application/pdf","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Accept-Ranges":"bytes","Content-Length":String(range?range.length:file.size_bytes),"Content-Disposition":`inline; filename="paper.pdf"; filename*=UTF-8''${encodeURIComponent(paper.pdfPath.split("/").at(-1))}`,"Vary":"oai-authenticated-user-id","X-Labvium-Pdf-Sha256":file.sha256};if(range)headers["Content-Range"]=`bytes ${range.offset}-${range.offset+range.length-1}/${file.size_bytes}`;return new Response(object.body,{status:range?206:200,headers});
}
export async function handleLabviumApi(request,env){
 let loaded,owner;const created=[];
 try{
  const url=new URL(request.url);if(!url.pathname.startsWith("/ku-ai/api/"))c.fail(404,"API route not found.");const raw=url.pathname.slice("/ku-ai/api/".length);if(raw.length>1000)c.fail(422,"API path exceeds the supported limit.");let parts;try{parts=raw.split("/").filter(Boolean).map(decodeURIComponent);}catch{c.fail(422,"Invalid API path encoding.");}if(parts.some(part=>/[\\/\u0000-\u001f]/.test(part)||part===".."))c.fail(422,"Invalid API path.");const path=parts.join("/"),method=request.method.toUpperCase();if(!["GET","POST","PUT","PATCH","DELETE"].includes(method))c.fail(405,"Method not supported.");
  if(method!=="GET")requireWriteOrigin(request);
  if(path==="session"&&method==="GET"){const authenticated=Boolean(request.headers.get("oai-authenticated-user-id"));return reply({authenticated,storage:authenticated?"cloud":"browser",user:authenticated?{email:request.headers.get("oai-authenticated-user-email")||"",name:displayName(request)}:null,capabilities:HOSTED_CAPABILITIES,ai:{configured:Boolean(env.OPENAI_API_KEY),provider:env.OPENAI_API_KEY?"openai":null,model:env.OPENAI_API_KEY?(env.OPENAI_MODEL||null):null},sign_in_url:SIGN_IN_URL});}
  if(path==="discover"&&method==="GET")return reply(await discover(url.searchParams,env));
  if(path==="discover/related"&&method==="GET")return reply(await related(url.searchParams,env));
  if(path==="discover/explore"&&method==="GET")return reply(await explore(url.searchParams,env));
  if(parts[0]==="workspaces"){const body=await commandBody(request,path);return reply(await routeWorkspaceMembership(request,env,parts,body));}
  const access=await resolveWorkspaceAccess(request,env);owner=access.workspace_key;
  if(path==="exports/raw"&&method==="GET"){const row=await env.LABVIUM_DB.prepare("SELECT revision, state_json FROM labvium_workspaces WHERE owner_key = ?").bind(owner).first();if(!row)c.fail(404,"No saved workspace exists.");let value;try{value=JSON.parse(row.state_json);}catch{}if(value?.storage==="r2"){const object=await readPrivateObject(env,owner,value.key);if(!object)c.fail(503,"The retained raw state object is missing.");return new Response(object.body,{headers:{"Content-Type":"application/json","Content-Disposition":"attachment; filename=\"labvium-raw-state.json\"","Cache-Control":"private, no-store"}});}return new Response(row.state_json,{headers:{"Content-Type":"application/json","Content-Disposition":"attachment; filename=\"labvium-raw-state.json\"","Cache-Control":"private, no-store"}});}
  loaded=await loadWorkspace(env,owner);loaded.access=access;const state=loaded.state;
  const ctx={env,owner,revision:loaded.revision,fetch,putObject:async(kind,bytes,metadata)=>{const stored=await putPrivateObject(env,owner,kind,bytes,metadata);created.push(stored.key);return stored;},verifyObject:async(file)=>{const object=await readPrivateObject(env,owner,file.key);if(!object||object.size!==file.size_bytes||object.size>32*1024*1024)c.fail(409,"A retained private object is missing or has an invalid size.");const bytes=new Uint8Array(await object.arrayBuffer());if(await c.sha256(bytes)!==file.sha256)c.fail(409,"A retained private object's checksum failed.");return bytes;}};
  if(path==="workspace"&&method==="GET")return reply({mode:"cloud",storage:"cloud",workspace_id:access.workspace_key,role:access.role,title:access.title,permissions_revision:c.rev(access.permissions_revision),revision:c.rev(loaded.revision),paper_count:state.papers.length,project_count:state.projects.length,research_page_count:state.researchPages.length,pdf_count:Object.keys(state.files).length,updated_at:loaded.updated_at,capabilities:HOSTED_CAPABILITIES,limits:{structured_state_bytes:c.MAX_STATE_BYTES,pdf_bytes:25*1024*1024,portable_backup_pdf_bytes:20*1024*1024}},200,loaded.revision);
  if(parts[0]==="papers"&&parts.length===3&&parts[2]==="pdf"&&method==="GET")return await pdfResponse(request,c.paperById(state,parts[1]),state,ctx);
  if(path==="settings/summary"&&method==="GET"){const summary=c.settings(state);summary.backup_readiness=await backupReadiness(state,ctx);return reply(summary,200,loaded.revision);}
  if(path==="ai/sources"&&method==="GET")return reply(await prepareAiSources(state,{question:url.searchParams.get("q")||"",...(url.searchParams.get("project_id")?{project_id:url.searchParams.get("project_id")}:{paper_ids:(url.searchParams.get("paper_ids")||"").split(",").filter(Boolean)})}),200,loaded.revision);
  const body=await commandBody(request,path);
  if(path==="ai/answer"&&method==="POST"){if(!env.OPENAI_API_KEY)c.fail(503,"Connect a server API key to enable cited AI answers. Your saved research remains available.","ai_not_configured");c.strict(body,["question","locale","paper_ids","project_id","source_ids","sources_revision","task"]);const output=await generateCitedAnswer(env,await selectAiEvidence(state,body));return reply({...output,evidence_revision:body.sources_revision},200,loaded.revision);}
  let output;
  if(path==="papers/upload"&&method==="POST")output=await stageUploads(state,body.getAll("files"),ctx);
  else if(parts[0]==="projects"&&parts.length===3&&parts[2]==="exploration"){
    if(method==="GET")output=getProjectExplorationState(state,parts[1]);
    else if(method==="PUT")output=saveProjectExplorationState(state,parts[1],body);
    else c.fail(405,"Unsupported research exploration command.");
  }
  else output=await routeContinuity(parts,method,body,state,{...ctx,actor:request.headers.get("oai-authenticated-user-email")||"Account member"})??await routeReview(parts,method,body,state,ctx)??await routeMaintenance(parts,method,body,state,ctx)??routeResearch(parts,method,body,state)??await routeTagMaintenance(parts,method,body,url.searchParams,state,ctx)??await routeProfile(parts,method,body,state)??await routeCommands(parts,method,body,url.searchParams,state,ctx);
  if(output instanceof Response)return output;
  const revision=await saveWorkspace(env,owner,loaded);
  return reply(output,200,revision);
 }catch(error){
  // Clean only unique staged objects after a definite CAS conflict. Ambiguous
  // storage failures retain bytes because the database may have committed.
  if(error instanceof c.APIError&&error.status===409&&error.code==="conflict"&&owner)for(const key of created)await env.LABVIUM_PDFS?.delete(key).catch(()=>{});
  const status=error instanceof c.APIError||Number.isInteger(error?.status)?error.status:503;return reply({detail:error instanceof c.APIError||Number.isInteger(error?.status)?error.message:"The private workspace operation could not be completed. Saved data was preserved.",code:error.code||"unavailable",...(status===401?{sign_in_url:SIGN_IN_URL}:{})},status);
 }
}
