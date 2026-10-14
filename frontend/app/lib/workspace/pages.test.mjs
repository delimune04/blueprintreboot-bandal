import assert from "node:assert/strict";
import test from "node:test";
import { blankResearchPage, createResearchPagesStore, newResearchBlock, RESEARCH_PAGES_KEY, researchPageInput, safeResearchUrl } from "./pages.mjs";
import { createResearchTemplate, RESEARCH_TEMPLATES } from "./templates.mjs";

function storage() { const data = new Map(); return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; }
test("hierarchical pages preserve explicit saves and reject stale edits and cycles", () => {
  const memory = storage(), store = createResearchPagesStore(memory);
  const parent = store.create({ ...blankResearchPage(), title: "Research" });
  const child = store.create({ ...blankResearchPage(parent.page.id), title: "Evidence" });
  const draft = researchPageInput(child.page); draft.blocks.push({ ...newResearchBlock("quote"), text: "Source evidence", source_links: [{ paper_id: "demo-ccs", url: "", label: "Original PDF" }] });
  assert.equal(store.list().items[1].blocks.length, 0, "draft edits must not save themselves");
  const saved = store.save(child.page.id, draft, child.revision);
  assert.equal(store.list().items[1].blocks[0].text, "Source evidence");
  assert.throws(() => store.save(child.page.id, draft, child.revision), /changed elsewhere/);
  assert.throws(() => store.save(parent.page.id, { ...researchPageInput(parent.page), parent_id: child.page.id }, saved.revision), /ancestor/);
  assert.equal(store.list().revision, saved.revision, "invalid cycle must not increment durable revision");
});
test("archive undo preserves page contents and child identities", () => {
  const store = createResearchPagesStore(storage()); const page = store.create({ ...blankResearchPage(), title: "Study", blocks: [{ ...newResearchBlock(), text: "A saved observation" }] });
  const archived = store.archive(page.page.id, true, page.revision, true);
  const restored = store.archive(page.page.id, false, archived.revision, true);
  assert.equal(restored.page.id, page.page.id); assert.equal(restored.page.blocks[0].text, "A saved observation");
});
test("corrupt stored pages and storage quota failures retain the previous bytes", () => {
  const memory = storage(); memory.setItem(RESEARCH_PAGES_KEY, "corrupt raw bytes");
  assert.throws(() => createResearchPagesStore(memory).list(), /preserved/); assert.equal(memory.getItem(RESEARCH_PAGES_KEY), "corrupt raw bytes");
  const durable = storage(); const store = createResearchPagesStore(durable); const page = store.create({ ...blankResearchPage(), title: "Study" }); const before = durable.getItem(RESEARCH_PAGES_KEY);
  durable.setItem = () => { throw new Error("Quota exhausted"); };
  assert.throws(() => store.save(page.page.id, { ...researchPageInput(page.page), title: "Changed" }, page.revision), /Quota/); assert.equal(durable.getItem(RESEARCH_PAGES_KEY), before);
});
test("source URLs are bounded to web protocols and invalid commands do not persist", () => {
  assert.equal(safeResearchUrl("javascript:alert(1)"), ""); assert.equal(safeResearchUrl("file:///private/research"), "");
  const store = createResearchPagesStore(storage());
  const input = { ...blankResearchPage(), title: "Study", blocks: [{ ...newResearchBlock(), source_links: [{ paper_id: "", url: "javascript:alert(1)", label: "Bad source" }] }] };
  assert.throws(() => store.create(input), /HTTP or HTTPS/); assert.equal(store.list().items.length, 0);
});
test("manual templates contain editable prompts and no claimed findings or AI output", () => {
  for (const template of RESEARCH_TEMPLATES) {
    const page = createResearchTemplate(template.id);
    assert.equal(page.handoff.verified_facts, ""); assert.equal(page.handoff.owner, "");
    assert.ok(page.blocks.every((block) => block.provenance === "manual" && block.source_links.length === 0 && !block.checked));
  }
  assert.match(createResearchTemplate("ccs-evidence").blocks.map((block) => block.text).join("\n"), /Data checksum/);
});
