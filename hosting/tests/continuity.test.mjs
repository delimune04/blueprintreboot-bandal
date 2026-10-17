import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyWorkspace, rev } from "../domain/core.mjs";
import { blankContinuity, blankRun, continuityCommand, continuityResponse, getContinuity, affectedReviewRows, exportContinuity } from "../../frontend/app/lib/continuity/model.mjs";
import { blankReviewInput, newWorkflowRow, validateReviewInput, exportReviewMarkdown } from "../../frontend/app/lib/review/model.mjs";
import { checkEvidenceChanges, crossrefNotices } from "../domain/continuity.mjs";

function fixture(doi = "10.5555/continuity-test") {
  const state = emptyWorkspace(), project = { project_id:"p-1",name:"CCS",status:"active",links:[{paper_id:"paper-1"}],reviewDossier:{...blankReviewInput(),source_fingerprint:"",snapshots:[]} };
  state.projects.push(project);state.papers.push({paper_id:"paper-1",metadata:{title:"Caprock conditions",doi}});
  return {state,project};
}
const source = {kind:"paper",paper_id:"paper-1",page:null,block_id:"",research_page_id:""};
test("reproduction updates require the current revision and project-scoped links",()=>{
  const {state,project}=fixture(),run={...blankRun(),title:"Repeat permeability measurement",paper_ids:["paper-1"],dataset:"test.csv",data_version:"v1",commit_sha:"a".repeat(40),data_sha256:"b".repeat(64)};
  const saved=continuityCommand(state,"p-1","run",{expected_revision:rev(1),run});assert.equal(saved.dossier.runs[0].data_version,"v1");
  assert.throws(()=>continuityCommand(state,"p-1","run",{expected_revision:rev(1),run:{...run,data_version:"v2"}}),e=>e.status===409);
  assert.equal(getContinuity(project).runs[0].data_version,"v1");
  assert.throws(()=>continuityCommand(state,"p-1","run",{expected_revision:saved.revision,run:{...run,paper_ids:["foreign-paper"]}}),e=>e.status===422);
  assert.throws(()=>continuityCommand(state,"p-1","run",{expected_revision:saved.revision,run:{...run,data_url:"javascript:alert(1)"}}),e=>e.status===422);
  assert.throws(()=>continuityCommand(state,"p-1","run",{expected_revision:saved.revision,run:{...run,commit_sha:"main"}}),e=>e.status===422);
});
test("evidence notices propagate through comparison, decision and handoff, preserving resolution history",()=>{
  const {state,project}=fixture(),comparison={...newWorkflowRow("comparison"),text:"Compare A",source_links:[source]},decision={...newWorkflowRow("decision"),text:"Adopt A"},handoff={...newWorkflowRow("handoff"),text:"Repeat A"};
  decision.context.comparison_ids=[comparison.id];handoff.context.origin_decision_id=decision.id;
  project.reviewDossier.rows=[comparison,decision,handoff];
  const saved=continuityCommand(state,"p-1","signal",{expected_revision:rev(1),paper_id:"paper-1",kind:"correction",url:"https://doi.org/10.5555/correction",summary:"The original unit was corrected."});
  assert.equal(saved.affected_rows.length,3);assert.equal(affectedReviewRows(project,saved.dossier.signals).at(-1).row_id,handoff.id);
  const resolved=continuityCommand(state,"p-1","resolve",{expected_revision:saved.revision,signal_id:saved.dossier.signals[0].id,resolution:"Recomputed with the corrected unit.",confirm:true},"reviewer@lab.test");
  assert.equal(resolved.affected_rows.length,0);assert.equal(resolved.dossier.signals.length,1);assert.equal(resolved.dossier.signals[0].resolved_by,"reviewer@lab.test");
});
test("handoff onboarding fields survive validation, freezing inputs and Markdown export",()=>{
  const row={...newWorkflowRow("handoff"),text:"Start here"};Object.assign(row.context,{first_reading:"Caprock paper",reading_reason:"Describes our protocol",required_files:"input-v1.csv",first_task:"Run the reference experiment",open_questions:"Check the pressure boundary"});
  const input=validateReviewInput({...blankReviewInput(),rows:[row]});assert.equal(input.rows[0].context.required_files,"input-v1.csv");
  const md=exportReviewMarkdown(input,"CCS");assert.match(md,/First reading: Caprock paper/);assert.match(md,/First task: Run the reference experiment/);
});
test("provider failures remain unknown and preserve previous notices",async()=>{
  const {state,project}=fixture("10.5555/continuity-unavailable");
  continuityCommand(state,"p-1","signal",{expected_revision:rev(1),paper_id:"paper-1",kind:"other",url:"",summary:"Existing manual review"});
  const value=await checkEvidenceChanges(state,"p-1",{expected_revision:rev(2),paper_ids:["paper-1"]},{fetch:async()=>{throw new Error("offline");}});
  assert.equal(value.dossier.checks[0].status,"unavailable");assert.equal(value.dossier.signals.length,1);assert.equal(value.dossier.signals[0].source,"manual");assert.ok(project.continuity.checked_at);
});
test("only exact DOI provider notices are recorded, checks are deduplicated and ordinary metadata changes are ignored",async()=>{
  const doi="10.5555/continuity-retracted",{state}=fixture(doi);
  const fetchImpl=async url=>Response.json(String(url).includes("openalex")?{id:"https://openalex.org/W123456789",doi:`https://doi.org/${doi}`,is_retracted:true}:{message:{DOI:doi,"updated-by":[{DOI:"10.5555/continuity-correction",type:"correction"}]}});
  const one=await checkEvidenceChanges(state,"p-1",{expected_revision:rev(1),paper_ids:["paper-1"]},{fetch:fetchImpl});
  assert.equal(one.dossier.signals.length,2);assert.equal(one.dossier.checks[0].status,"checked");
  const two=await checkEvidenceChanges(state,"p-1",{expected_revision:one.revision,paper_ids:["paper-1"]},{fetch:fetchImpl});assert.equal(two.dossier.signals.length,2);
  assert.deepEqual(crossrefNotices({DOI:doi,indexed:{timestamp:Date.now()},relation:{"is-referenced-by":[{id:"10.5555/citation"}]}},doi),[]);
  assert.match(exportContinuity(two),/Evidence changes/);
});
test("absent extensions are read without mutating legacy project data",()=>{const {state,project}=fixture();const before=JSON.stringify(project);assert.deepEqual(continuityResponse(state,"p-1").dossier,blankContinuity());assert.equal(JSON.stringify(project),before);});
