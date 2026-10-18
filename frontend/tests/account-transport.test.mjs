import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import ts from "typescript";
import { readFile } from "node:fs/promises";

const original={window:globalThis.window,fetch:globalThis.fetch,demo:process.env.NEXT_PUBLIC_BANDAL_DEMO,base:process.env.NEXT_PUBLIC_BANDAL_DEMO_BASE};
const entry=new URL("../app/lib/api/client.ts",import.meta.url);
const compiled=ts.transpileModule(await readFile(entry,"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const code=compiled.replace(/((?:from\s*|import\s*\(\s*)["'])(\.{1,2}\/[^"']+)(["'])/g,(_m,before,path,after)=>before+new URL(path,entry).href+after);
let serial=0;
async function client(fetcher){process.env.NEXT_PUBLIC_BANDAL_DEMO="1";process.env.NEXT_PUBLIC_BANDAL_DEMO_BASE="/LabVium";const store=new Map(),win=new EventTarget();win.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};win.location={origin:"https://bandal.app"};globalThis.window=win;globalThis.fetch=fetcher;return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}#${serial++}`);}
afterEach(()=>{globalThis.window=original.window;globalThis.fetch=original.fetch;if(original.demo===undefined)delete process.env.NEXT_PUBLIC_BANDAL_DEMO;else process.env.NEXT_PUBLIC_BANDAL_DEMO=original.demo;if(original.base===undefined)delete process.env.NEXT_PUBLIC_BANDAL_DEMO_BASE;else process.env.NEXT_PUBLIC_BANDAL_DEMO_BASE=original.base;});
test("successful sign-in selects the stable account workspace and sends saves only to the cloud API",async()=>{
 const personal="a".repeat(64),calls=[];
 const c=await client(async(url,init={})=>{calls.push({url,init});if(url.endsWith("/session"))return Response.json({authenticated:true,storage:"cloud",user:{email:"a@lab.test"}});if(url.endsWith("/workspaces"))return Response.json({personal_workspace_id:personal,items:[{workspace_id:personal,role:"owner"}]});return Response.json({status:"saved"},{headers:{"X-Labvium-Workspace-Revision":"b".repeat(64)}});});
 const session=await c.initializeWorkspaceTransport();assert.equal(session.authenticated,true);assert.equal(c.getWorkspaceMode(),"cloud");assert.equal(c.getWorkspaceScope(),personal);
 await c.labviumRequest("/projects",{method:"POST",body:{name:"Cloud project"}});const saved=calls.at(-1);assert.equal(saved.url,"/LabVium/api/projects");assert.equal(saved.init.credentials,"same-origin");assert.equal(saved.init.headers["X-Labvium-Workspace"],personal);
 assert.equal(c.workspaceDownloadUrl("/ku-ai/api/backups/old?raw=1"),`/LabVium/api/backups/old?raw=1&workspace=${personal}`);
 assert.equal(c.workspaceDownloadUrl("/LabVium/api/backups/new?workspace=other"),`/LabVium/api/backups/new?workspace=${personal}`);
 assert.throws(()=>c.workspaceDownloadUrl("https://other.test/ku-ai/api/backups/no"),/Download must belong/);
 assert.throws(()=>c.workspaceDownloadUrl("/LabViumish/api/backups/no"),/Download must belong/);
});
test("a failed workspace lookup after sign-in retains authenticated cloud identity and blocks through connection_error",async()=>{
 const c=await client(async url=>url.endsWith("/session")?Response.json({authenticated:true,storage:"cloud"}):Response.json({detail:"unavailable"},{status:503}));
 const session=await c.initializeWorkspaceTransport();assert.equal(session.authenticated,true);assert.equal(session.storage,"cloud");assert.equal(session.connection_error,true);assert.equal(c.getWorkspaceMode(),"cloud");
});
test("an unknown connection failure is explicitly distinguishable from a confirmed guest session",async()=>{
 const failed=await client(async()=>{throw new Error("offline");});assert.equal((await failed.initializeWorkspaceTransport()).connection_error,true);
 const guest=await client(async()=>Response.json({authenticated:false,storage:"browser"}));const session=await guest.initializeWorkspaceTransport();assert.equal(session.authenticated,false);assert.equal(session.connection_error,undefined);
});
