import test from "node:test";
import assert from "node:assert/strict";
import { createLibraryQueryMatcher } from "../domain/library-search.mjs";
import { routeCommands } from "../domain/commands.mjs";

test("Library terms normalize copies, preserve literal punctuation and require every term", () => {
  const cases = [
    ["  ＭＵＯＮ　tomography\n", "Tomography of Muon", true],
    ["10.1234/A-B", "doi:10.1234/a-b", true],
    ["a.b", "aXb", false], ["[]*", "literal []*", true],
    ["muon absent", "Muon tomography", false],
    ["", "anything", true], ["\t　", "", true],
    ["muon muon", "Muon", true], ["지진파 저장", "저장 지진파", true],
    ["Ａ", "ᴬ", true],
  ];
  for (const [query, text, expected] of cases) assert.equal(createLibraryQueryMatcher(query)(text), expected, query);
});

test("hosted Library matches across existing fields before pagination, never mutates", async () => {
  const base = { tags: ["tomography"], archived: false, status: "unread", priority: "normal", metadataRev: 1, statusRev: 1, tagsRev: 1, lifecycleRev: 1, blocksRev: 1, note: "geometry condition", noteExists: true, blocks: [{title:"boundary",text:"shielding"}], pdfPath: "", fullTextCache: {content:"detector response"} };
  const state = { papers: [
    {...structuredClone(base), paper_id:"paper-a", metadata:{title:"Muon study",authors:"Ada",year:"2026",journal:"J",doi:"10.1234/a-b"}},
    {...structuredClone(base), paper_id:"paper-b", metadata:{title:"Muon second",authors:"Ada",year:"2026"}, archived:true},
  ], projects: [], files: {} };
  const before = JSON.stringify(state);
  const query = async values => routeCommands(["papers"], "GET", null, new URLSearchParams(values), state, {});
  assert.equal((await query({q:"tomography muon"})).total, 1);
  assert.equal((await query({q:"geometry detector shielding"})).total, 1);
  assert.equal((await query({q:"ＡＤＡ　ＭＵＯＮ"})).total, 1);
  assert.equal((await query({q:"10.1234/A-B Ada"})).total, 1);
  assert.equal((await query({q:"muon absent"})).total, 0);
  assert.equal((await query({q:"muon",status:"reading"})).total, 0);
  assert.equal((await query({q:"muon",year:"2025"})).total, 0);
  const result = await query({q:"muon tomography",archive_status:"all",limit:"1",offset:"1"});
  assert.equal(result.total,2); assert.equal(result.items.length,1); assert.equal(result.has_more,false);
  assert.equal(JSON.stringify(state), before);
});
