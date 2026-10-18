import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { createDemoAdapter, createDemoSeed } from "../app/lib/demo/adapter.mjs";
import { BROWSER_WORKSPACE_KEY, getBrowserWorkspaceStorage, getBrowserPdfRecord, listBrowserPdfRecords, exportBrowserWorkspace, previewBrowserWorkspaceRestore, restoreBrowserWorkspace, getMaintenanceSnapshot } from "../app/lib/demo/browser-storage.mjs";
import { browserWorkspaceRequest } from "../app/lib/workspace/browser-request.mjs";
import { paperDiscoveryKeys } from "../app/lib/workspace/discovery-identity.mjs";
import { validateArchive } from "../../hosting/domain/maintenance.mjs";

const values = new Map();
globalThis.window = { localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } };
const work = { id: "10.1234/research", title: "Reservoir geometry", authors: ["Park, Jason", "Lee, S"], year: "2026", doi: "10.1234/research", abstract: "Measured reservoir geometry.", url: "https://doi.org/10.1234/research", pdf_url: "https://arxiv.org/pdf/2601.12345", source: "Crossref", references: ["https://doi.org/10.1234/background"], topics: ["CCS"] };
const pdf = () => new File(["%PDF-1.7\nSaved research PDF fixture\n%%EOF"], "research.pdf", { type: "application/pdf" });
async function request(api, path, method = "GET", body) {
  const response = await api(path, { method, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) });
  assert.ok(response, `Owned route ${path}`);
  return { status: response.status, data: await response.json() };
}
async function reset() {
  values.clear();
  const storage = getBrowserWorkspaceStorage(), raw = await storage.getItem(BROWSER_WORKSPACE_KEY), files = await listBrowserPdfRecords(), seed = createDemoSeed();
  seed.papers = []; seed.projects = [];
  await storage.compareAndSet(BROWSER_WORKSPACE_KEY, raw, JSON.stringify(seed), { deleteFiles: files.map(file => file.key) });
  return createDemoAdapter();
}
function attachment(file, expected) { const form = new FormData(); form.set("file", file); form.set("expected_pdf_revision", expected); return form; }

test("browser discovery commands create real Library Papers and reload a persisted saved index", async () => {
  await reset();
  const saved = await request(browserWorkspaceRequest, "/papers/from-discovery", "POST", { work });
  assert.equal(saved.status, 200); assert.equal(saved.data.status, "saved"); assert.equal(saved.data.destination, "library");
  const api = createDemoAdapter(), detail = await request(api, `/papers/${saved.data.paper_id}`);
  assert.equal(detail.data.metadata_only, true); assert.equal(detail.data.missing_pdf, true); assert.equal(detail.data.filename, "");
  assert.deepEqual(detail.data.authors, work.authors);
  assert.equal(detail.data.external_source.references[0], work.references[0]);
  assert.deepEqual(detail.data.health, []);
  assert.equal((await request(api, "/library/status")).data.missing_count, 0);
  const index = await request(browserWorkspaceRequest, "/papers/discovery-index");
  assert.equal(index.data.items[0].paper_id, saved.data.paper_id);
  assert.ok(index.data.items[0].keys.includes("doi:10.1234/research"));
  assert.equal((await request(api, "/papers")).data.total, 1);
  assert.equal((await listBrowserPdfRecords()).length, 0);
});

test("browser saves deduplicate canonical identifiers across tabs and preserve learned provider aliases", async () => {
  const first = await reset(), second = createDemoAdapter();
  const concurrent = await Promise.all([request(first, "/papers/from-discovery", "POST", { work }), request(second, "/papers/from-discovery", "POST", { work: { ...work, doi: "https://doi.org/10.1234/RESEARCH" } })]);
  assert.deepEqual(concurrent.map(value => value.status), [200, 200]);
  assert.equal(concurrent[0].data.paper_id, concurrent[1].data.paper_id);
  assert.equal((await request(first, "/papers")).data.total, 1);
  const learned = await request(second, "/papers/from-discovery", "POST", { work: { ...work, source: "OpenAlex", id: "https://openalex.org/W999", openalex_id: "W999" } });
  const detail = (await request(createDemoAdapter(), `/papers/${learned.data.paper_id}`)).data;
  assert.ok(paperDiscoveryKeys(detail).includes("openalex:W999"));
  const providerOnly = await request(first, "/papers/from-discovery", "POST", { work: { ...work, source: "OpenAlex", id: "https://openalex.org/w999", openalex_id: "w999", doi: "", url: "https://openalex.org/W999" } });
  assert.equal(providerOnly.data.status, "already_saved"); assert.equal(providerOnly.data.paper_id, learned.data.paper_id);
  const sameTitle = await request(first, "/papers/from-discovery", "POST", { work: { ...work, id: "10.1234/different", doi: "10.1234/different", url: "https://doi.org/10.1234/different", pdf_url: "" } });
  assert.equal(sameTitle.data.status, "saved"); assert.notEqual(sameTitle.data.paper_id, learned.data.paper_id);
});

test("attaching a PDF keeps browser Paper and note identities with revision protection", async () => {
  const api = await reset(), saved = await request(api, "/papers/from-discovery", "POST", { work }), id = saved.data.paper_id;
  const reader = (await request(api, `/papers/${id}/reader`)).data;
  const note = await request(api, `/papers/${id}/reading-note`, "PUT", { content: "My measured result", expected_sha256: reader.saved_note_baseline.sha256 });
  const block = await request(api, `/papers/${id}/note-blocks`, "POST", { expected_revision: "1".padStart(64, "0"), block_type: "claim", text: "Observed geometry" });
  const attached = await request(browserWorkspaceRequest, `/papers/${id}/pdf-attachment`, "POST", attachment(pdf(), saved.data.paper.pdf_revision));
  assert.equal(attached.status, 200); assert.equal(attached.data.status, "attached"); assert.equal(attached.data.paper_id, id);
  assert.equal(attached.data.paper.metadata_only, false); assert.equal(attached.data.paper.missing_pdf, false);
  const reloaded = (await request(createDemoAdapter(), `/papers/${id}/reader`)).data;
  assert.equal(reloaded.saved_note_content, note.data.content); assert.equal(reloaded.paper.external_source.doi, work.doi);
  assert.equal((await request(api, `/papers/${id}/note-blocks`)).data.items[0].id, block.data.block.id);
  const records = await listBrowserPdfRecords(); assert.equal(records.length, 1); assert.equal(records[0].paper_id, id);
  assert.equal(await (await getBrowserPdfRecord(records[0].key)).blob.text(), await pdf().text());
  assert.equal((await request(api, `/papers/${id}/pdf-attachment`, "POST", attachment(pdf(), saved.data.paper.pdf_revision))).status, 409);
  assert.equal((await listBrowserPdfRecords()).length, 1);
  const removed = await request(api, `/papers/${id}/remove-pdf`, "POST", { expected_pdf_revision: reloaded.paper.pdf_revision, confirm: true });
  assert.equal(removed.status, 200);
  const missing = (await request(api, `/papers/${id}`)).data;
  assert.equal(missing.metadata_only, false); assert.equal((await request(api, "/library/status")).data.missing_count, 1);
});

test("failed browser attachment CAS publishes neither bytes nor changed note state", async () => {
  const api = await reset(), saved = await request(api, "/papers/from-discovery", "POST", { work }), storage = getBrowserWorkspaceStorage();
  const before = await storage.getItem(BROWSER_WORKSPACE_KEY);
  const rejecting = createDemoAdapter({ getItem: storage.getItem.bind(storage), setItem: storage.setItem.bind(storage), compareAndSet: async (_key, _expected, _next, effects) => effects.putFiles.length ? false : true });
  const result = await request(rejecting, `/papers/${saved.data.paper_id}/pdf-attachment`, "POST", attachment(pdf(), saved.data.paper.pdf_revision));
  assert.equal(result.status, 409); assert.equal(await storage.getItem(BROWSER_WORKSPACE_KEY), before);
  assert.equal((await listBrowserPdfRecords()).length, 0);
});

test("browser exports restore discovery sources, learned IDs and PDF bytes and are accepted by cloud import", async () => {
  const api = await reset(), saved = await request(api, "/papers/from-discovery", "POST", { work });
  const second = await request(api, "/papers/from-discovery", "POST", { work: { ...work, id: "10.1234/second", doi: "10.1234/second", url: "https://doi.org/10.1234/second", pdf_url: "" } });
  await request(api, `/papers/${saved.data.paper_id}/pdf-attachment`, "POST", attachment(pdf(), saved.data.paper.pdf_revision));
  const archive = await exportBrowserWorkspace();
  assert.equal(archive.workspace.papers.length, 2); assert.equal(archive.pdfs.length, 1);
  assert.equal((await previewBrowserWorkspaceRestore(archive)).valid, true);
  const cloud = await validateArchive(archive); assert.equal(cloud.workspace.papers[1].external_source.doi, "10.1234/second");
  const snapshot = await getMaintenanceSnapshot(); await restoreBrowserWorkspace(archive, { expected_revision: snapshot.revision, confirm: true });
  const restored = (await request(createDemoAdapter(), `/papers/${second.data.paper_id}`)).data;
  assert.equal(restored.metadata_only, true); assert.equal(restored.external_source.doi, "10.1234/second");
  assert.ok(paperDiscoveryKeys(restored).includes("doi:10.1234/second"));
});

test("invalid discovery source state is retained and reported instead of silently reset", async () => {
  const api = await reset(), saved = await request(api, "/papers/from-discovery", "POST", { work }), storage = getBrowserWorkspaceStorage();
  const raw = await storage.getItem(BROWSER_WORKSPACE_KEY), value = JSON.parse(raw);
  value.papers[0].external_source.pdf_url = "javascript:alert(1)";
  const corrupt = JSON.stringify(value); await storage.compareAndSet(BROWSER_WORKSPACE_KEY, raw, corrupt, {});
  assert.equal((await request(createDemoAdapter(), `/papers/${saved.data.paper_id}`)).status, 503);
  assert.equal(await storage.getItem(BROWSER_WORKSPACE_KEY), corrupt);
});
