import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { handleLabviumApi } from "../api.mjs";
import { discoveryKeys, paperDiscoveryKeys } from "../../frontend/app/lib/workspace/discovery-identity.mjs";

// Keep these disposable D1/R2 adapters local to this contract suite. No test
// reads a developer's research workspace or reaches a metadata/PDF provider.
class DB {
  database = new DatabaseSync(":memory:");
  ambiguous = null;
  constructor() {
    for (const name of readdirSync(new URL("../drizzle/", import.meta.url)).filter(name => name.endsWith(".sql")).sort()) {
      this.database.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
    }
  }
  prepare(sql) {
    const self = this;
    return { bind(...args) {
      return {
        _sql: sql, _args: args,
        async first() { return self.database.prepare(sql).get(...args) || null; },
        async all() { return { results: self.database.prepare(sql).all(...args) }; },
        async run() {
          const result = self.database.prepare(sql).run(...args);
          if (sql.startsWith("UPDATE labvium_workspaces") && Number(result.changes) === 1) {
            if (self.ambiguous === "throw") { self.ambiguous = null; throw new Error("Transport failure after commit"); }
            if (self.ambiguous === "metadata") { self.ambiguous = null; return {}; }
          }
          return { meta: { changes: Number(result.changes) } };
        },
      };
    } };
  }
  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const result = [];
      for (const statement of statements) result.push(await statement.run());
      this.database.exec("COMMIT");
      return result;
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
}

class Bucket {
  files = new Map();
  async put(key, value) { this.files.set(key, value instanceof Uint8Array ? new Uint8Array(value) : new TextEncoder().encode(value)); }
  async get(key, options) {
    const bytes = this.files.get(key);
    if (!bytes) return null;
    const value = options?.range ? bytes.slice(options.range.offset, options.range.offset + options.range.length) : bytes;
    return { size: bytes.length, body: new Response(value).body, async arrayBuffer() { return value.slice().buffer; } };
  }
  async delete(key) { this.files.delete(key); }
}

function environment() { return { LABVIUM_DB: new DB(), LABVIUM_PDFS: new Bucket() }; }
async function request(env, path, { method = "GET", body, user = "alice", headers = {} } = {}) {
  const options = { method, headers: { ...(user ? { "oai-authenticated-user-id": user } : {}), ...headers } };
  if (body instanceof FormData) options.body = body;
  else if (body !== undefined) { options.body = JSON.stringify(body); options.headers["Content-Type"] = "application/json"; }
  const response = await handleLabviumApi(new Request(`https://bandal.app/ku-ai/api${path}`, options), env);
  return {
    response, status: response.status,
    data: (response.headers.get("content-type") || "").includes("application/json") ? await response.json() : await response.arrayBuffer(),
  };
}

function work(changes = {}) {
  return {
    id: "10.1234/caprock-study", title: "Caprock containment evidence", authors: ["Jason Park", "Fixture Researcher"], year: "2025",
    doi: "10.1234/caprock-study", abstract: "Measured permeability and containment evidence.",
    url: "https://doi.org/10.1234/caprock-study", pdf_url: "https://arxiv.org/pdf/1706.03762", source: "Crossref",
    journal: "Fixture Geoscience", retrieved_at: "2026-10-18T03:00:00.000Z", topics: ["Carbon storage"], cited_by_count: 17,
    ...changes,
  };
}
async function save(env, value = work(), options = {}) {
  return request(env, "/papers/from-discovery", { method: "POST", body: { work: value }, ...options });
}
async function saved(env, value = work(), options = {}) {
  const result = await save(env, value, options);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data;
}
const pdfBytes = "%PDF-1.7\nDiscovery attachment fixture\n%%EOF";
function attachment(revision, { content = pdfBytes, name = "caprock.pdf" } = {}) {
  const form = new FormData();
  form.append("file", new File([content], name, { type: "application/pdf" }));
  if (revision !== undefined) form.append("expected_pdf_revision", revision);
  return form;
}
function commonIdentity(left, right) { return left.some(key => right.includes(key)); }

test("discovery identity normalizes DOI, arXiv versions and OpenAlex IDs without using titles", () => {
  const doiA = work({ id: "crossref-fixture-a", doi: "https://DOI.org/10.1234/CAPROCK-STUDY", url: "", pdf_url: "" });
  const doiB = work({ id: "openalex-fixture-b", doi: "10.1234/caprock-study", url: "", pdf_url: "" });
  assert.ok(commonIdentity(discoveryKeys(doiA), discoveryKeys(doiB)));
  const arxivA = work({ id: "https://arxiv.org/abs/1706.03762v3", arxiv_id: "1706.03762v3", doi: "", url: "https://arxiv.org/abs/1706.03762v3", pdf_url: "", source: "arXiv" });
  const arxivB = { ...arxivA, id: "https://arxiv.org/pdf/1706.03762v5.pdf", arxiv_id: "1706.03762", url: "https://arxiv.org/abs/1706.03762" };
  assert.ok(commonIdentity(discoveryKeys(arxivA), discoveryKeys(arxivB)));
  const alexA = work({ id: "https://openalex.org/w12345", openalex_id: "https://openalex.org/w12345", doi: "", url: "https://openalex.org/w12345", pdf_url: "", source: "OpenAlex" });
  const alexB = { ...alexA, id: "W12345", openalex_id: "W12345", url: "https://openalex.org/W12345" };
  assert.ok(commonIdentity(discoveryKeys(alexA), discoveryKeys(alexB)));
  assert.equal(commonIdentity(discoveryKeys(work()), discoveryKeys(work({ id: "10.1234/distinct", doi: "10.1234/distinct", url: "https://doi.org/10.1234/distinct", pdf_url: "" }))), false);
});

test("discovery save creates one metadata-only Library Paper with a visible destination and persisted source", async () => {
  const env = environment(), source = work(), result = await saved(env, source);
  assert.equal(result.status, "saved");
  assert.equal(result.destination, "library");
  assert.equal(result.paper_id, result.paper.paper_id);
  assert.equal(result.paper.title, source.title);
  assert.deepEqual(result.paper.authors, source.authors);
  assert.equal(result.paper.doi, source.doi);
  assert.equal(result.paper.abstract, source.abstract);
  assert.equal(result.paper.missing_pdf, true);
  assert.equal(result.paper.metadata_only, true);
  assert.deepEqual(result.paper.health, []);
  assert.equal(result.paper.pdf_sha256, "");
  assert.equal(result.paper.external_source.url, source.url);
  assert.equal(result.paper.external_source.pdf_url, source.pdf_url);
  assert.deepEqual(result.keys, paperDiscoveryKeys(result.paper));
  const library = await request(env, "/papers");
  assert.equal(library.data.total, 1);
  assert.equal(library.data.items[0].paper_id, result.paper_id);
  assert.equal((await request(env, `/papers/${result.paper_id}/pdf`)).status, 404);
  const state = await request(env, "/workspace");
  assert.equal(state.data.paper_count, 1);
  assert.equal(state.data.research_page_count, 0);
  assert.equal(state.data.pdf_count, 0);
  assert.equal(env.LABVIUM_PDFS.files.size, 0);
  assert.equal((await request(env, "/library/status")).data.missing_count, 0);
  const index = await request(env, "/papers/discovery-index");
  assert.deepEqual(index.data.items, [{ paper_id: result.paper_id, keys: result.keys }]);
});

test("reloads and normalized provider identities return the existing Paper while same titles remain separate", async () => {
  const env = environment(), first = await saved(env);
  const duplicate = await saved(env, work({ id: "alternate-provider-record", doi: "https://doi.org/10.1234/CAPROCK-STUDY", source: "OpenAlex" }));
  assert.equal(duplicate.status, "already_saved");
  assert.equal(duplicate.paper_id, first.paper_id);
  assert.equal(duplicate.destination, "library");
  assert.equal((await request(env, `/papers/${first.paper_id}`)).data.title, work().title);
  const another = await saved(env, work({ id: "10.1234/different-paper", doi: "10.1234/different-paper", url: "https://doi.org/10.1234/different-paper", pdf_url: "" }));
  assert.equal(another.status, "saved");
  assert.notEqual(another.paper_id, first.paper_id);
  assert.equal((await request(env, "/papers/discovery-index")).data.items.length, 2);
});

test("arXiv and OpenAlex normalized identities deduplicate saved metadata", async () => {
  for (const [firstWork, alternate] of [
    [work({ id: "1706.03762v3", arxiv_id: "1706.03762v3", doi: "", source: "arXiv", url: "https://arxiv.org/abs/1706.03762v3" }), { id: "https://arxiv.org/abs/1706.03762v5", arxiv_id: "1706.03762" }],
    [work({ id: "https://openalex.org/W12345", openalex_id: "https://openalex.org/W12345", doi: "", source: "OpenAlex", url: "https://openalex.org/W12345", pdf_url: "" }), { id: "w12345", openalex_id: "w12345" }],
  ]) {
    const env = environment(), first = await saved(env, firstWork), again = await saved(env, { ...firstWork, ...alternate });
    assert.equal(again.status, "already_saved");
    assert.equal(again.paper_id, first.paper_id);
    assert.equal((await request(env, "/workspace")).data.paper_count, 1);
  }
});

test("a DOI match learns another provider ID for future provider-only saves without replacing the original source", async () => {
  const env = environment(), originalWork = work({ pdf_url: "" }), first = await saved(env, originalWork);
  const openalex = work({ id: "https://openalex.org/W999", openalex_id: "W999", source: "OpenAlex", url: "https://openalex.org/W999", pdf_url: "", title: "Alternative provider title" });
  const learned = await saved(env, openalex);
  assert.equal(learned.status, "already_saved");
  assert.equal(learned.paper_id, first.paper_id);
  assert.equal(learned.paper.title, originalWork.title);
  assert.deepEqual(learned.paper.external_source, first.paper.external_source);
  assert.ok(learned.keys.includes("openalex:W999"));
  const reloaded = (await request(env, `/papers/${first.paper_id}`)).data;
  assert.ok(paperDiscoveryKeys(reloaded).includes("openalex:W999"));
  const providerOnly = await saved(env, { ...openalex, doi: "", title: "Another title from a provider-only search" });
  assert.equal(providerOnly.status, "already_saved");
  assert.equal(providerOnly.paper_id, first.paper_id);
  assert.equal(providerOnly.paper.title, originalWork.title);
  assert.deepEqual(providerOnly.paper.external_source, first.paper.external_source);
  const index = await request(env, "/papers/discovery-index");
  assert.equal(index.data.items.length, 1);
  assert.ok(index.data.items[0].keys.includes("openalex:W999"));
  assert.equal((await request(env, "/workspace")).data.paper_count, 1);
});

test("identifiers spanning two existing Papers report ambiguity without merging or modifying either Paper", async () => {
  const env = environment();
  const doiPaper = await saved(env, work({ pdf_url: "", title: "Original DOI Paper" }));
  const alexWork = work({ id: "https://openalex.org/W999", openalex_id: "W999", doi: "", source: "OpenAlex", url: "https://openalex.org/W999", pdf_url: "", title: "Original OpenAlex Paper" });
  const alexPaper = await saved(env, alexWork);
  assert.notEqual(alexPaper.paper_id, doiPaper.paper_id);
  const beforeIndex = (await request(env, "/papers/discovery-index")).data.items;
  const beforeWorkspace = (await request(env, "/workspace")).data.workspace_revision;
  const ambiguous = await save(env, { ...alexWork, doi: work().doi, title: "Must not overwrite either title" });
  assert.equal(ambiguous.status, 409, JSON.stringify(ambiguous.data));
  assert.equal(ambiguous.data.code, "identity_ambiguous");
  assert.equal((await request(env, `/papers/${doiPaper.paper_id}`)).data.title, "Original DOI Paper");
  assert.equal((await request(env, `/papers/${alexPaper.paper_id}`)).data.title, "Original OpenAlex Paper");
  assert.deepEqual((await request(env, "/papers/discovery-index")).data.items, beforeIndex);
  const after = (await request(env, "/workspace")).data;
  assert.equal(after.workspace_revision, beforeWorkspace);
  assert.equal(after.paper_count, 2);
});

test("concurrent discovery saves converge on one Library Paper", async () => {
  const env = environment();
  await request(env, "/workspace");
  const [first, second] = await Promise.all([save(env), save(env)]);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.equal(first.data.paper_id, second.data.paper_id);
  assert.deepEqual([first.data.status, second.data.status].sort(), ["already_saved", "saved"]);
  assert.equal((await request(env, "/workspace")).data.paper_count, 1);
});

test("retry after an ambiguous post-commit discovery response does not duplicate research", async () => {
  for (const mode of ["throw", "metadata"]) {
    const env = environment();
    await request(env, "/workspace");
    env.LABVIUM_DB.ambiguous = mode;
    assert.equal((await save(env)).status, 503);
    const index = await request(env, "/papers/discovery-index");
    assert.equal(index.data.items.length, 1);
    const retry = await saved(env);
    assert.equal(retry.status, "already_saved");
    assert.equal(retry.paper_id, index.data.items[0].paper_id);
    assert.equal((await request(env, "/workspace")).data.paper_count, 1);
  }
});

test("discovery index and saved Papers remain account-isolated", async () => {
  const env = environment(), alice = await saved(env);
  assert.equal((await request(env, "/papers/discovery-index", { user: null })).status, 401);
  assert.deepEqual((await request(env, "/papers/discovery-index", { user: "bob" })).data.items, []);
  assert.equal((await request(env, `/papers/${alice.paper_id}`, { user: "bob" })).status, 404);
  const foreignAttach = await request(env, `/papers/${alice.paper_id}/pdf-attachment`, { method: "POST", user: "bob", body: attachment(alice.paper.pdf_revision) });
  assert.equal(foreignAttach.status, 404);
  const bob = await saved(env, work(), { user: "bob" });
  assert.equal(bob.status, "saved");
  assert.notEqual(bob.paper_id, alice.paper_id);
  assert.equal((await request(env, "/workspace")).data.paper_count, 1);
  assert.equal((await request(env, "/workspace", { user: "bob" })).data.paper_count, 1);
});

test("attaching a PDF preserves the saved Paper, note, blocks and project links", async () => {
  const env = environment(), initial = await saved(env), paperId = initial.paper_id;
  const reader = (await request(env, `/papers/${paperId}/reader`)).data;
  const note = await request(env, `/papers/${paperId}/reading-note`, { method: "PUT", body: { content: "## Summary\nKeep my original reasoning.", expected_sha256: reader.saved_note_baseline.sha256 } });
  assert.equal(note.status, 200, JSON.stringify(note.data));
  const blocksBefore = (await request(env, `/papers/${paperId}/note-blocks`)).data;
  const block = await request(env, `/papers/${paperId}/note-blocks`, { method: "POST", body: { block_type: "claim", text: "Stable evidence", expected_revision: blocksBefore.note_blocks_revision } });
  assert.equal(block.status, 200, JSON.stringify(block.data));
  const project = (await request(env, "/projects", { method: "POST", body: { name: "Containment research" } })).data.project;
  const linked = await request(env, `/projects/${project.project_id}/paper-links`, { method: "POST", body: { paper_id: paperId, link_type: "background", expected_links_revision: project.links_revision } });
  assert.equal(linked.status, 200, JSON.stringify(linked.data));
  const projectLinks = (await request(env, `/projects/${project.project_id}`)).data.links;
  const savedReader = (await request(env, `/papers/${paperId}/reader`)).data;
  const result = await request(env, `/papers/${paperId}/pdf-attachment`, { method: "POST", body: attachment(initial.paper.pdf_revision) });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.status, "attached");
  assert.equal(result.data.paper_id, paperId);
  assert.equal(result.data.paper.paper_id, paperId);
  assert.equal(result.data.paper.missing_pdf, false);
  assert.notEqual(result.data.pdf_revision, initial.paper.pdf_revision);
  const afterReader = (await request(env, `/papers/${paperId}/reader`)).data;
  assert.equal(afterReader.saved_note_content, savedReader.saved_note_content);
  assert.equal(afterReader.saved_note_baseline.sha256, savedReader.saved_note_baseline.sha256);
  assert.equal(afterReader.metadata_revision, savedReader.metadata_revision);
  assert.equal((await request(env, `/papers/${paperId}/note-blocks`)).data.items[0].id, block.data.block.id);
  const stableLinks = links => links.map(({ paper, ...link }) => link);
  assert.deepEqual(stableLinks((await request(env, `/projects/${project.project_id}`)).data.links), stableLinks(projectLinks));
  assert.equal(new TextDecoder().decode((await request(env, `/papers/${paperId}/pdf`)).data), pdfBytes);
  assert.equal((await request(env, "/workspace")).data.paper_count, 1);
  const retry = await request(env, `/papers/${paperId}/pdf-attachment`, { method: "POST", body: attachment(result.data.pdf_revision, { name: "renamed.pdf" }) });
  assert.equal(retry.status, 200, JSON.stringify(retry.data));
  assert.equal(retry.data.status, "already_attached");
  assert.equal(retry.data.paper_id, paperId);
  assert.equal(retry.data.pdf_revision, result.data.pdf_revision);
});

test("PDF attachment rejects stale revisions, invalid bytes and arbitrary remote URL commands", async () => {
  const env = environment(), first = await saved(env), path = `/papers/${first.paper_id}/pdf-attachment`;
  assert.equal((await request(env, path, { method: "POST", body: attachment(undefined) })).status, 422);
  assert.equal((await request(env, path, { method: "POST", body: attachment("0".repeat(64)) })).status, 409);
  assert.equal((await request(env, path, { method: "POST", body: attachment(first.paper.pdf_revision, { content: "this is not a PDF" }) })).status, 422);
  assert.equal((await request(env, path, { method: "POST", body: { url: "http://127.0.0.1/private.pdf", expected_pdf_revision: first.paper.pdf_revision } })).status, 422);
  assert.equal((await request(env, `/papers/${first.paper_id}/import-source-pdf`, { method: "POST", body: { url: "https://attacker.example/a.pdf", expected_pdf_revision: first.paper.pdf_revision } })).status, 422);
  const attached = await request(env, path, { method: "POST", body: attachment(first.paper.pdf_revision) });
  assert.equal(attached.status, 200, JSON.stringify(attached.data));
  const stale = await request(env, path, { method: "POST", body: attachment(first.paper.pdf_revision, { content: "%PDF-1.7\nChanged bytes\n%%EOF" }) });
  assert.equal(stale.status, 409);
  assert.equal(new TextDecoder().decode((await request(env, `/papers/${first.paper_id}/pdf`)).data), pdfBytes);
  assert.equal((await request(env, "/workspace")).data.paper_count, 1);
});

test("explicit source import attaches only the saved trusted open-access URL to the same Paper", async () => {
  const env = environment(), first = await saved(env), calls = [], originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    assert.equal(String(url), first.paper.external_source.pdf_url);
    assert.equal(options.redirect, "manual");
    return new Response(pdfBytes, { headers: { "Content-Type": "application/pdf" } });
  };
  try {
    const result = await request(env, `/papers/${first.paper_id}/import-source-pdf`, { method: "POST", body: { expected_pdf_revision: first.paper.pdf_revision } });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.status, "attached");
    assert.equal(result.data.paper_id, first.paper_id);
    assert.equal(result.data.paper.missing_pdf, false);
    assert.equal((await request(env, "/workspace")).data.paper_count, 1);
    const again = await request(env, `/papers/${first.paper_id}/import-source-pdf`, { method: "POST", body: { expected_pdf_revision: result.data.pdf_revision } });
    assert.equal(again.status, 200, JSON.stringify(again.data));
    assert.equal(again.data.status, "already_attached");
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("source PDF import blocks untrusted hosts and redirect escapes before any untrusted fetch", async () => {
  for (const sourceUrl of ["http://127.0.0.1/private.pdf", "https://attacker.example/paper.pdf", "https://arxiv.org/pdf/1706.03762"]) {
    const env = environment(), first = await saved(env, work({ pdf_url: sourceUrl })), calls = [], originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      calls.push(String(url));
      assert.equal(String(url), "https://arxiv.org/pdf/1706.03762");
      assert.equal(options.redirect, "manual");
      return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private.pdf" } });
    };
    try {
      const result = await request(env, `/papers/${first.paper_id}/import-source-pdf`, { method: "POST", body: { expected_pdf_revision: first.paper.pdf_revision } });
      assert.equal(result.status, 422, JSON.stringify(result.data));
      assert.equal(calls.length, sourceUrl.startsWith("https://arxiv.org/") ? 1 : 0);
      assert.equal((await request(env, `/papers/${first.paper_id}`)).data.missing_pdf, true);
      assert.equal(env.LABVIUM_PDFS.files.size, 0);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test("source PDF import bounds redirect loops and rejects HTML while preserving the metadata-only Paper", async () => {
  for (const mode of ["redirect-loop", "html"]) {
    const env = environment(), first = await saved(env), calls = [], originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      calls.push(String(url));
      assert.equal(new URL(url).hostname, "arxiv.org");
      assert.equal(options.redirect, "manual");
      if (mode === "redirect-loop") return new Response(null, { status: 302, headers: { Location: "/pdf/1706.03762" } });
      return new Response("<!doctype html><title>Publisher login</title>", { headers: { "Content-Type": "text/html" } });
    };
    try {
      const result = await request(env, `/papers/${first.paper_id}/import-source-pdf`, { method: "POST", body: { expected_pdf_revision: first.paper.pdf_revision } });
      assert.equal(result.status, mode === "redirect-loop" ? 503 : 422, JSON.stringify(result.data));
      assert.equal(calls.length, mode === "redirect-loop" ? 4 : 1);
      const after = (await request(env, `/papers/${first.paper_id}`)).data;
      assert.equal(after.missing_pdf, true);
      assert.equal(after.pdf_revision, first.paper.pdf_revision);
      assert.deepEqual(after.external_source, first.paper.external_source);
      assert.equal(env.LABVIUM_PDFS.files.size, 0);
      assert.equal((await request(env, "/workspace")).data.paper_count, 1);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test("backups retain discovery source and identity for metadata-only Papers", async () => {
  const env = environment(), first = await saved(env);
  const portable = await request(env, "/exports/workspace");
  assert.equal(portable.status, 200, JSON.stringify(portable.data));
  assert.equal(portable.data.workspace.papers[0].paper_id, first.paper_id);
  assert.match(JSON.stringify(portable.data.workspace.papers[0]), /https:\/\/arxiv\.org\/pdf\/1706\.03762/);
  const current = await request(env, "/workspace");
  const backup = await request(env, "/backups", { method: "POST", body: { kind: "full", expected_revision: current.data.workspace_revision } });
  assert.equal(backup.status, 200, JSON.stringify(backup.data));
  const archive = await request(env, `/backups/${backup.data.backup_id}`);
  assert.match(JSON.stringify(archive.data.workspace.papers[0]), /https:\/\/arxiv\.org\/pdf\/1706\.03762/);
  const imported = await request(env, "/backups/import-preview", { method: "POST", body: { archive: portable.data } });
  assert.equal(imported.status, 200, JSON.stringify(imported.data));
  const restored = await request(env, `/backups/${imported.data.backup_id}/restore`, { method: "POST", body: { expected_revision: imported.data.workspace_revision, confirm: true } });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  const after = (await request(env, `/papers/${first.paper_id}`)).data;
  assert.deepEqual(after.external_source, first.paper.external_source);
  assert.deepEqual(paperDiscoveryKeys(after), first.keys);
  assert.equal(after.missing_pdf, true);
  assert.equal((await saved(env)).status, "already_saved");
});
