import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createDemoAdapter, DEMO_STORAGE_KEY, demoPdfUrl, isDemoEnabled } from "../app/lib/demo/adapter.mjs";
import { DEMO_PAPERS } from "../app/lib/demo/seed.mjs";

function workspace() {
  const values = new Map();
  const storage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
  return { storage, request: createDemoAdapter(storage), reload: () => createDemoAdapter(storage) };
}
async function read(request, path) {
  const response = await request(path);
  assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`);
  return response.json();
}
async function command(request, path, method, body, expected = 200) {
  const response = await request(path, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  assert.equal(response.status, expected, `${method} ${path}: ${await response.clone().text()}`);
  return response.json();
}

test("demo activation is explicit and PDF asset paths are allowlisted", () => {
  const previous = process.env.NEXT_PUBLIC_BANDAL_DEMO;
  try {
    delete process.env.NEXT_PUBLIC_BANDAL_DEMO;
    assert.equal(isDemoEnabled(), false);
    process.env.NEXT_PUBLIC_BANDAL_DEMO = "1";
    assert.equal(isDemoEnabled(), true);
    process.env.NEXT_PUBLIC_BANDAL_DEMO = "true";
    assert.equal(isDemoEnabled(), false);
    assert.equal(demoPdfUrl("demo-ccs"), "/bandal-demo/demo-ccs.pdf");
    assert.equal(demoPdfUrl("../../private.pdf"), "");
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_BANDAL_DEMO;
    else process.env.NEXT_PUBLIC_BANDAL_DEMO = previous;
  }
});

test("an isolated browser seeds authored PDFs, notes, blocks, Projects and tags", async () => {
  const { request, storage } = workspace();
  const library = await read(request, "/papers?limit=2&offset=0&archive_status=active");
  assert.equal(library.items.length, 2);
  assert.equal(library.total, 3);
  assert.equal(library.has_more, true);
  assert.equal((await read(request, "/papers?limit=2&offset=2")).items.length, 1);
  assert.equal((await read(request, "/papers?q=counts")).items[0].paper_id, "demo-muon");
  assert.equal((await read(request, "/papers?tag=ccs")).total, 1);
  assert.equal((await read(request, "/papers?status=reading")).total, 1);
  assert.equal((await read(request, "/projects")).total, 2);
  assert.equal((await read(request, "/tags")).total, 5);
  assert.equal((await read(request, "/health")).overall_state, "healthy");
  assert.equal((await read(request, "/library/status")).active_count, 3);
  assert.equal((await read(request, "/settings/summary")).backup_readiness.snapshot_available, false);
  assert.equal((await read(request, "/tags/summary")).candidate_count, 0);
  assert.equal((await read(request, "/tags/review-queue")).total, 0);
  assert.ok(storage.getItem(DEMO_STORAGE_KEY));
  for (const seed of DEMO_PAPERS) {
    const snapshot = await read(request, `/papers/${seed.paper_id}/reader`);
    assert.match(snapshot.paper.title, /^\[Demo\]/);
    assert.match(snapshot.paper.journal, /not a published paper/);
    assert.equal(snapshot.saved_note_baseline.sha256, createHash("sha256").update(snapshot.saved_note_content).digest("hex"));
    assert.equal(snapshot.pdf_state, "available");
    assert.equal((await read(request, `/papers/${seed.paper_id}/note-blocks`)).total, 1);
    assert.equal((await read(request, `/papers/${seed.paper_id}/full-text`)).content, seed.fullText);
    assert.equal((await read(request, `/papers/${seed.paper_id}/full-text/status`)).page_count, 2);
    assert.equal((await read(request, `/papers/${seed.paper_id}/tag-candidates`)).state, "not_generated");
  }
});

test("metadata saves refresh headers, preserve note bodies, persist and reject stale revisions", async () => {
  const { request, reload } = workspace();
  const baseline = await read(request, "/papers/demo-ccs/reader");
  const body = baseline.saved_note_content.slice(baseline.saved_note_content.indexOf("## One-line Summary"));
  const saved = await command(request, "/papers/demo-ccs/metadata", "PATCH", { changes: { title: "My CCS research", authors: "Jason Park; Example Coauthor" }, expected_revision: baseline.metadata_revision });
  assert.equal(saved.status, "saved");
  assert.deepEqual(saved.changed_fields, ["title", "authors"]);
  assert.match(saved.reading_note.content, /title: My CCS research/);
  assert.equal(saved.reading_note.content.slice(saved.reading_note.content.indexOf("## One-line Summary")), body);
  const after = await read(reload(), "/papers/demo-ccs/reader");
  assert.equal(after.paper.first_author, "Jason Park");
  assert.deepEqual(after.paper.authors, ["Jason Park", "Example Coauthor"]);
  assert.notEqual(after.metadata_revision, baseline.metadata_revision);
  await command(request, "/papers/demo-ccs/metadata", "PATCH", { changes: { title: "Overwrite" }, expected_revision: baseline.metadata_revision }, 409);
  assert.equal((await read(request, "/papers/demo-ccs")).title, "My CCS research");
  const noOp = await command(request, "/papers/demo-ccs/metadata", "PATCH", { changes: { title: "My CCS research" }, expected_revision: after.metadata_revision });
  assert.equal(noOp.status, "no_op");
  assert.equal(noOp.metadata_revision, after.metadata_revision);
});

test("reading status saves are explicit, revision guarded and visible on the dashboard read", async () => {
  const { request } = workspace();
  const baseline = await read(request, "/papers/demo-muon/reader");
  const saved = await command(request, "/papers/demo-muon/reading-status", "PATCH", { reading_status: "reading", expected_revision: baseline.paper.reading_status_revision });
  assert.equal(saved.reading_status, "reading");
  assert.notEqual(saved.reading_status_revision, baseline.paper.reading_status_revision);
  assert.equal((await read(request, "/papers?status=reading")).total, 2);
  await command(request, "/papers/demo-muon/reading-status", "PATCH", { reading_status: "finished", expected_revision: baseline.paper.reading_status_revision }, 409);
});

test("saved notes preserve unstructured text and exact body bytes through repeated saves and header refresh", async () => {
  const { request, reload } = workspace();
  const snapshot = await read(request, "/papers/demo-muon/reader");
  const body = "title: My own research question\nFree-form note without headings.\r\n\r\n<script>alert('plain text')</script>\n  Last line  ";
  const saved = await command(request, "/papers/demo-muon/reading-note", "PUT", { content: body, expected_sha256: snapshot.saved_note_baseline.sha256 });
  assert.ok(saved.content.endsWith(body));
  assert.equal(saved.sha256, createHash("sha256").update(saved.content).digest("hex"));
  assert.equal(saved.size_bytes, Buffer.byteLength(saved.content));
  const repeated = await command(request, "/papers/demo-muon/reading-note", "PUT", { content: saved.content, expected_sha256: saved.sha256 });
  assert.equal(repeated.status, "no_op");
  assert.equal(repeated.content, saved.content);
  await command(request, "/papers/demo-muon/metadata", "PATCH", { changes: { title: "Personal detector notes" }, expected_revision: snapshot.metadata_revision });
  const after = await read(reload(), "/papers/demo-muon/reader");
  assert.ok(after.saved_note_content.endsWith(body));
  await command(request, "/papers/demo-muon/reading-note", "PUT", { content: "Stale overwrite", expected_sha256: saved.sha256 }, 409);
  assert.ok((await read(request, "/papers/demo-muon/reader")).saved_note_content.endsWith(body));
});

test("metadata and note commands validate before writing anything", async () => {
  const { request, storage } = workspace();
  const baseline = await read(request, "/papers/demo-ccs/reader");
  const original = storage.getItem(DEMO_STORAGE_KEY);
  for (const changes of [{ year: "2200" }, { year: "abcd" }, { doi: "javascript:alert(1)" }, { title: null }, { title: "a".repeat(1001) }, { filepath: "/etc/passwd" }, {}]) {
    await command(request, "/papers/demo-ccs/metadata", "PATCH", { changes, expected_revision: baseline.metadata_revision }, 422);
  }
  await command(request, "/papers/demo-ccs/reading-note", "PUT", { content: null, expected_sha256: baseline.saved_note_baseline.sha256 }, 422);
  await command(request, "/papers/demo-ccs/reading-note", "PUT", { content: "a".repeat(2000000), expected_sha256: baseline.saved_note_baseline.sha256 }, 422);
  assert.equal(storage.getItem(DEMO_STORAGE_KEY), original);
  assert.equal((await request("/papers?limit=-1")).status, 422);
  assert.equal((await request("/papers?limit=101")).status, 422);
  assert.equal((await request("/papers?offset=1.5")).status, 422);
  assert.equal((await request("https://evil.test/papers")).status, 422);
});

test("header growth cannot save a note too large for the durable schema", async () => {
  const { request, storage } = workspace();
  const baseline = await read(request, "/papers/demo-ccs/reader");
  const headerLength = baseline.saved_note_content.indexOf("## One-line Summary");
  const saved = await command(request, "/papers/demo-ccs/reading-note", "PUT", { content: "a".repeat(2000000 - headerLength), expected_sha256: baseline.saved_note_baseline.sha256 });
  assert.equal(saved.content.length, 2000000);
  const before = storage.getItem(DEMO_STORAGE_KEY);
  await command(request, "/papers/demo-ccs/metadata", "PATCH", { changes: { title: "T".repeat(1000) }, expected_revision: baseline.metadata_revision }, 422);
  assert.equal(storage.getItem(DEMO_STORAGE_KEY), before);
  assert.equal((await read(request, "/papers/demo-ccs/reader")).saved_note_content, saved.content);
});

test("Note Blocks create and update persist with collection revisions", async () => {
  const { request, reload } = workspace();
  const baseline = await read(request, "/papers/demo-ccs/note-blocks");
  const created = await command(request, "/papers/demo-ccs/note-blocks", "POST", { block_type: "idea", title: "A follow-up", text: "Compare uncertainties.", page: "2", tags: ["ccs"], expected_revision: baseline.note_blocks_revision });
  assert.equal(created.status, "created");
  assert.equal(created.total, 2);
  const updated = await command(request, `/papers/demo-ccs/note-blocks/${created.block.id}`, "PATCH", { changes: { text: "Revised follow-up", block_type: "question" }, expected_revision: created.note_blocks_revision });
  assert.equal(updated.block.text, "Revised follow-up");
  assert.equal(updated.block.block_type, "question");
  assert.equal((await read(reload(), "/papers/demo-ccs/note-blocks")).items.find((block) => block.id === created.block.id).text, "Revised follow-up");
  await command(request, `/papers/demo-ccs/note-blocks/${created.block.id}`, "PATCH", { changes: { text: "Stale" }, expected_revision: created.note_blocks_revision }, 409);
  await command(request, "/papers/demo-ccs/note-blocks", "POST", { block_type: "unsafe", expected_revision: updated.note_blocks_revision }, 422);
});

test("Projects create, update and archive independent browser data", async () => {
  const { request, reload } = workspace();
  const created = await command(request, "/projects", "POST", { name: "My KU-AI demonstration", description: "Personal fork", status: "active", priority: "high", tags: ["ccs"] });
  assert.equal(created.status, "created");
  const key = created.project.project_id;
  const updated = await command(request, `/projects/${key}`, "PATCH", { changes: { name: "My presentation", status: "paused" }, expected_revision: created.project.project_revision });
  assert.equal(updated.project.name, "My presentation");
  assert.equal((await read(reload(), `/projects/${key}`)).status, "paused");
  await command(request, `/projects/${key}`, "PATCH", { changes: { name: "Stale" }, expected_revision: created.project.project_revision }, 409);
  const archived = await command(request, `/projects/${key}/archive`, "POST", { expected_revision: updated.project.project_revision });
  assert.equal(archived.project.status, "archived");
  await command(request, `/projects/${key}`, "PATCH", { changes: { status: "active" }, expected_revision: archived.project.project_revision }, 409);
});

test("paper and block Project links update both detail read models and reject stale link revisions", async () => {
  const { request, reload } = workspace();
  const baseline = await read(request, "/projects/demo-storage?links_limit=1&links_offset=0");
  assert.equal(baseline.links_has_more, true);
  const linked = await command(request, "/projects/demo-storage/paper-links", "POST", { paper_id: "demo-muon", link_type: "related", expected_links_revision: baseline.links_revision });
  assert.equal(linked.project.link_count, 3);
  assert.ok((await read(request, "/papers/demo-muon")).project_links.some((link) => link.project_id === "demo-storage"));
  const unchanged = await command(request, "/projects/demo-storage/paper-links", "POST", { paper_id: "demo-muon", link_type: "related", expected_links_revision: linked.project.links_revision });
  assert.equal(unchanged.status, "unchanged");
  assert.equal(unchanged.project.links_revision, linked.project.links_revision);
  await command(request, "/projects/demo-storage/paper-links", "POST", { paper_id: "demo-seismic", link_type: "related", expected_links_revision: baseline.links_revision }, 409);
  const blockLinked = await command(request, "/projects/demo-storage/note-block-links", "POST", { paper_id: "demo-muon", note_block_id: "block-demo-muon", link_type: "raises_question", expected_links_revision: linked.project.links_revision });
  assert.ok((await read(reload(), "/papers/demo-muon/note-blocks")).project_links.some((link) => link.link_id === blockLinked.link.link_id));
  const removedBlock = await command(request, `/projects/demo-storage/note-block-links/${blockLinked.link.link_id}`, "DELETE", { expected_links_revision: blockLinked.project.links_revision });
  const removed = await command(request, `/projects/demo-storage/paper-links/${linked.link.link_id}`, "DELETE", { expected_links_revision: removedBlock.project.links_revision });
  assert.equal(removed.project.link_count, 2);
});

test("canonical tags and aliases support guarded saves and manual paper application", async () => {
  const { request, reload } = workspace();
  const baseline = await read(request, "/tags/governance");
  const created = await command(request, "/tags", "POST", { label: "My evidence", category: "topic", description: "Personal research tag", suggestion_strength: 20, expected_revision: baseline.registry_revision });
  const key = created.tag.canonical_key;
  const alias = await command(request, `/tags/${key}/aliases`, "POST", { alias: "Evidence reading", expected_revision: created.registry_revision });
  const updated = await command(request, `/tags/${key}`, "PATCH", { changes: { label: "Evidence", suggestion_strength: 30 }, expected_revision: alias.registry_revision });
  const reader = await read(request, "/papers/demo-ccs/reader");
  const applied = await command(request, "/papers/demo-ccs/tags", "POST", { tag: "Evidence reading", expected_revision: reader.tags_revision });
  assert.ok(applied.tags.includes(key));
  assert.ok(applied.reading_note.content.includes(key));
  assert.equal((await read(reload(), "/tags/governance")).items.find((tag) => tag.canonical_key === key).label, "Evidence");
  await command(request, `/tags/${key}/aliases`, "POST", { alias: "CCS", expected_revision: updated.registry_revision }, 409);
  await command(request, `/tags/${key}`, "PATCH", { changes: { label: "Stale" }, expected_revision: baseline.registry_revision }, 409);
  const deprecated = await command(request, `/tags/${key}/deprecate`, "POST", { expected_revision: updated.registry_revision });
  assert.equal(deprecated.tag.status, "deprecated");
  const other = await read(request, "/papers/demo-muon/reader");
  await command(request, "/papers/demo-muon/tags", "POST", { tag: key, expected_revision: other.tags_revision }, 422);
  const removed = await command(request, "/papers/demo-ccs/tags", "DELETE", { tag: key, expected_revision: applied.tags_revision });
  assert.ok(!removed.tags.includes(key));
});

test("archiving a demo paper requires confirmation and retains PDFs and notes", async () => {
  const { request } = workspace();
  const baseline = await read(request, "/papers/demo-ccs/reader");
  await command(request, "/papers/demo-ccs/archive", "POST", { expected_lifecycle_revision: baseline.paper.lifecycle_revision, confirm: false }, 422);
  const archived = await command(request, "/papers/demo-ccs/archive", "POST", { expected_lifecycle_revision: baseline.paper.lifecycle_revision, confirm: true });
  assert.equal(archived.status, "archived");
  assert.equal((await read(request, "/papers?archive_status=active")).total, 2);
  assert.equal((await read(request, "/papers?archive_status=archived")).total, 1);
  const snapshot = await read(request, "/papers/demo-ccs/reader");
  assert.equal(snapshot.pdf_state, "available");
  assert.equal(snapshot.saved_note_content, baseline.saved_note_content);
});

test("unsupported commands reject without pretending an AI or server filesystem operation succeeded", async () => {
  const { request, storage } = workspace();
  await read(request, "/papers");
  const saved = storage.getItem(DEMO_STORAGE_KEY);
  for (const path of ["/ai/summary", "/server-filesystem/scan", "/papers/demo-ccs/unknown-command"]) {
    const failure = await command(request, path, "POST", {}, 501);
    assert.match(failure.detail, /demo|sample|local/i);
  }
  assert.equal(storage.getItem(DEMO_STORAGE_KEY), saved);
  assert.equal((await request("/papers/upload", { method: "POST", body: "{}" })).status, 422);
});

test("corrupt saved browser state is preserved and never silently reset", async () => {
  const { request, storage, reload } = workspace();
  await read(request, "/papers");
  for (const bad of ["{broken-json", "{}", JSON.stringify({ version: 500, papers: [], projects: [], tags: [], registryRev: 1 })]) {
    storage.setItem(DEMO_STORAGE_KEY, bad);
    const response = await reload()("/papers");
    assert.equal(response.status, 503);
    assert.match((await response.json()).detail, /preserved/);
    assert.equal(storage.getItem(DEMO_STORAGE_KEY), bad);
  }
});

test("quota failures retain the previous saved state and return a visible failure", async () => {
  const { request, storage, reload } = workspace();
  const baseline = await read(request, "/papers/demo-ccs/reader");
  const original = storage.getItem(DEMO_STORAGE_KEY);
  const originalSetter = storage.setItem;
  storage.setItem = () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); };
  const failure = await command(request, "/papers/demo-ccs/metadata", "PATCH", { changes: { title: "Unsaved title" }, expected_revision: baseline.metadata_revision }, 503);
  assert.match(failure.detail, /could not be saved/);
  assert.equal(storage.getItem(DEMO_STORAGE_KEY), original);
  storage.setItem = originalSetter;
  assert.equal((await read(reload(), "/papers/demo-ccs")).title, baseline.paper.title);
});

test("concurrent note saves retain the first acknowledged value and reject stale writes", async () => {
  const { request } = workspace();
  const baseline = await read(request, "/papers/demo-ccs/reader");
  const requests = ["First saved note", "Stale second note"].map((content) => request("/papers/demo-ccs/reading-note", { method: "PUT", body: JSON.stringify({ content, expected_sha256: baseline.saved_note_baseline.sha256 }) }));
  const responses = await Promise.all(requests);
  assert.deepEqual(responses.map((response) => response.status), [200, 409]);
  assert.ok((await read(request, "/papers/demo-ccs/reader")).saved_note_content.endsWith("First saved note"));
});

test("another tab changing storage during an async save causes a conflict", async () => {
  const { request, storage } = workspace();
  const baseline = await read(request, "/papers/demo-ccs/reader");
  const originalGetter = storage.getItem;
  let reads = 0;
  const other = JSON.parse(originalGetter(DEMO_STORAGE_KEY));
  other.papers[0].metadata.title = "Other tab"; other.papers[0].metadataRev += 1;
  const newer = JSON.stringify(other);
  storage.getItem = (key) => {
    reads += 1;
    if (reads === 2) storage.setItem(key, newer);
    return originalGetter(key);
  };
  await command(request, "/papers/demo-ccs/reading-note", "PUT", { content: "My draft", expected_sha256: baseline.saved_note_baseline.sha256 }, 409);
  assert.equal(originalGetter(DEMO_STORAGE_KEY), newer);
});

test("aborted requests never persist a command", async () => {
  const { request, storage } = workspace();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(request("/papers", { signal: controller.signal }), { name: "AbortError" });
  assert.equal(storage.getItem(DEMO_STORAGE_KEY), null);
});
