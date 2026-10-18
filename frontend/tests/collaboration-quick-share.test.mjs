import assert from "node:assert/strict";
import test from "node:test";
import {createQuickIdeaDraft,sendQuickIdeaDraft} from "../app/lib/collaboration/quick-share.mjs";
const source={type:"paper",id:"saved-paper",title:"A saved paper",excerpt:"A source finding"};
const uuid="5af448fc-6d74-4ab3-b158-7a5f571150b1";
test("ambiguous quick-share retry retains the same request and posts only one question",async()=>{
 const draft=createQuickIdeaDraft(source,uuid),saved=new Map();let attempts=0;
 const request=async(path,init)=>{if(!init)return {revision:"current",permissions:{can_edit:true}};const key=init.body.request_id;if(!saved.has(key))saved.set(key,{result_id:"idea-one",payload:structuredClone(init.body.idea)});if(++attempts===1)throw new Error("Transport ended after commit");return saved.get(key);};
 await assert.rejects(sendQuickIdeaDraft(draft,{request,scope:"team-a",getScope:()=>"team-a"}),/Transport/);
 const result=await sendQuickIdeaDraft(draft,{request,scope:"team-a",getScope:()=>"team-a"});
 assert.equal(result.result_id,"idea-one");assert.equal(saved.size,1);assert.equal(draft.request_id,uuid);assert.equal(saved.get(uuid).payload.source.id,source.id);assert.equal(saved.get(uuid).payload.body,"이 아이디어 어때요?");
});
test("a workspace switch during lookup cannot send a source to another workspace",async()=>{
 let scope="team-a",posts=0;const request=async(path,init)=>{if(init){posts++;return {result_id:"wrong"};}scope="team-b";return {revision:"r",permissions:{can_edit:true}};};
 await assert.rejects(sendQuickIdeaDraft(createQuickIdeaDraft(source,uuid),{request,scope:"team-a",getScope:()=>scope}),/workspace changed/);assert.equal(posts,0);
});
test("read-only members cannot quick-post and unsafe source types cannot create a draft",async()=>{
 let calls=0;const request=async()=>{calls++;return {revision:"r",permissions:{can_edit:false}};};
 await assert.rejects(sendQuickIdeaDraft(createQuickIdeaDraft(source,uuid),{request,scope:"a",getScope:()=>"a"}),/editor role/);assert.equal(calls,1);
 assert.throws(()=>createQuickIdeaDraft({...source,type:"external-user"},uuid));
});
