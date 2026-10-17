import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { createDemoAdapter, createDemoSeed, demoPdfUrl } from "../app/lib/demo/adapter.mjs";
import { BROWSER_WORKSPACE_KEY, getBrowserWorkspaceStorage, listBrowserPdfRecords, getBrowserPdfRecord, sha256Blob, exportBrowserWorkspace, previewBrowserWorkspaceRestore, restoreBrowserWorkspace, getMaintenanceSnapshot } from "../app/lib/demo/browser-storage.mjs";
import { extractPdfPages, extractedPagesContent } from "../app/lib/demo/pdf-extraction.mjs";

function fixturePdf(text = "CCS research fixture") {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const stream = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET`;
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let content = "%PDF-1.4\n", positions = [0];
  objects.forEach((object, index) => { positions.push(content.length); content += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = content.length;
  content += `xref\n0 6\n0000000000 65535 f \n${positions.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new File([content], "research.pdf", { type: "application/pdf" });
}
async function reset() {
  const storage = getBrowserWorkspaceStorage();
  const existing = await storage.getItem(BROWSER_WORKSPACE_KEY);
  const files = await listBrowserPdfRecords();
  await storage.compareAndSet(BROWSER_WORKSPACE_KEY, existing, JSON.stringify(createDemoSeed()), { deleteFiles: files.map((file) => file.key) });
  return createDemoAdapter();
}
async function request(api, path, method = "GET", body) {
  const response = await api(path, { method, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() };
}
async function upload(api, file = fixturePdf()) { const body = new FormData(); body.append("files", file); return request(api, "/papers/upload", "POST", body); }

test("uploaded PDFs, metadata and blobs commit atomically and survive adapter recreation", async () => {
  const api = await reset(), file = fixturePdf();
  const response = await upload(api, file);
  assert.equal(response.status, 200);
  assert.equal(response.data.imported_count, 1);
  const paperId = response.data.results[0].paper_id;
  const paper = await request(createDemoAdapter(), `/papers/${paperId}/reader`);
  assert.equal(paper.status, 200);
  assert.equal(paper.data.paper.title, "research");
  assert.equal(paper.data.pdf_state, "available");
  assert.match(demoPdfUrl(paperId), /^blob:/);
  const stored = await getBrowserPdfRecord(response.data.results[0].relative_path);
  assert.equal(await sha256Blob(stored.blob), await sha256Blob(file));
  const repeated = await upload(api, file);
  assert.equal(repeated.data.imported_count, 0);
  assert.equal(repeated.data.results[0].status, "duplicate_content");
  assert.equal((await request(api, "/papers")).data.total, 4);
});

test("invalid PDFs are reported per file without storing fake paper records", async () => {
  const api = await reset();
  const response = await upload(api, new File(["This is not a PDF"], "bad.pdf", { type: "application/pdf" }));
  assert.equal(response.status, 200);
  assert.equal(response.data.imported_count, 0);
  assert.equal(response.data.results[0].status, "invalid");
  assert.equal((await request(api, "/papers")).data.total, 3);
  assert.equal((await listBrowserPdfRecords()).length, 0);
});

test("PDF removal keeps verified recovery bytes, notes and identity, and reconnect restores them", async () => {
  const api = await reset(), uploaded = await upload(api), paperId = uploaded.data.results[0].paper_id;
  const initial = (await request(api, `/papers/${paperId}/reader`)).data;
  const note = await request(api, `/papers/${paperId}/reading-note`, "PUT", { content: "Keep my research", expected_sha256: initial.saved_note_baseline.sha256 });
  const removed = await request(api, `/papers/${paperId}/remove-pdf`, "POST", { expected_pdf_revision: initial.paper.pdf_revision, confirm: true });
  assert.equal(removed.status, 200);
  assert.equal(removed.data.recovery_copy_created, true);
  const after = (await request(api, `/papers/${paperId}/reader`)).data;
  assert.equal(after.pdf_state, "missing");
  assert.equal(after.saved_note_content, note.data.content);
  const scan = await request(api, "/papers/scan", "POST", {});
  assert.equal(scan.data.candidates[0].can_reconnect, true);
  const reconnected = await request(api, "/papers/reconnect", "POST", { paper_id: paperId, relative_path: scan.data.candidates[0].relative_path });
  assert.equal(reconnected.status, 200);
  assert.equal((await request(api, `/papers/${paperId}/reader`)).data.pdf_state, "available");
  assert.equal((await request(api, `/papers/${paperId}/reader`)).data.saved_note_content, note.data.content);
});

test("verified page extraction stores searchable text with actual page markers and hash guards", async () => {
  const api = await reset(), file = fixturePdf(), uploaded = await upload(api, file), paperId = uploaded.data.results[0].paper_id;
  const source_pdf_sha256 = await sha256Blob(file);
  assert.equal((await request(api, `/papers/${paperId}/full-text/status`)).data.state, "not_extracted");
  const extracted = await request(api, `/papers/${paperId}/full-text/extract`, "POST", { provider: "browser-pdfjs", pages: [{ page_number: 1, text: "CCS evidence" }, { page_number: 2, text: "" }], source_pdf_sha256 });
  assert.equal(extracted.status, 200);
  assert.equal(extracted.data.provider, "browser-pdfjs");
  assert.deepEqual(extracted.data.ocr_needed_pages, [2]);
  assert.equal(extracted.data.classification, "mixed");
  assert.match(extracted.data.content, /--- Page 1 ---\n\nCCS evidence/);
  assert.deepEqual(extracted.data.pages, [{ page_number: 1, text: "CCS evidence" }, { page_number: 2, text: "" }]);
  const rejected = await request(api, `/papers/${paperId}/full-text/extract`, "POST", { pages: [{ page_number: 1, text: "Wrong source" }], source_pdf_sha256: "a".repeat(64) });
  assert.equal(rejected.status, 409);
  assert.equal((await request(api, `/papers/${paperId}/full-text`)).data.content, extracted.data.content);
});

test("OCR cache retains page evidence and confidence, and invalid provenance preserves the previous cache", async () => {
  const api = await reset(), file = fixturePdf(), uploaded = await upload(api, file), paperId = uploaded.data.results[0].paper_id;
  const source_pdf_sha256 = await sha256Blob(file), reader = (await request(api, `/papers/${paperId}/reader`)).data;
  const payload = { provider: "browser-pdfjs+tesseract", pages: [{ page_number: 1, text: "OCR 연구 근거" }], ocr_pages: [{ page_number: 1, confidence: 78.5 }], source_pdf_sha256, expected_pdf_revision: reader.paper.pdf_revision };
  const saved = await request(api, `/papers/${paperId}/full-text/extract`, "POST", payload);
  assert.equal(saved.status, 200); assert.equal(saved.data.provider, "browser-pdfjs+tesseract");
  assert.deepEqual(saved.data.pages, payload.pages); assert.deepEqual(saved.data.ocr_pages, payload.ocr_pages);
  assert.match(saved.data.message, /not proof of accuracy/);
  const invalid = await request(api, `/papers/${paperId}/full-text/extract`, "POST", { ...payload, ocr_pages: [{ page_number: 1, confidence: 200 }] });
  assert.equal(invalid.status, 422);
  assert.equal((await request(api, `/papers/${paperId}/full-text`)).data.content, saved.data.content);
});

test("priority uses its own revision and PDF rename retains the stored bytes and paper identity", async () => {
  const api = await reset(), file = fixturePdf(), uploaded = await upload(api, file), paperId = uploaded.data.results[0].paper_id;
  const paper = (await request(api, `/papers/${paperId}`)).data;
  assert.match(paper.priority_revision, /^[a-f0-9]{64}$/);
  const saved = await request(api, `/papers/${paperId}/priority`, "PATCH", { priority: "high", expected_revision: paper.priority_revision });
  assert.equal(saved.status, 200); assert.equal(saved.data.priority, "high");
  assert.equal((await request(api, `/papers/${paperId}/priority`, "PATCH", { priority: "low", expected_revision: paper.priority_revision })).status, 409);
  const renamed = await request(api, `/papers/${paperId}/rename-pdf`, "POST", { filename: "연구-attachment.pdf", expected_pdf_revision: paper.pdf_revision, confirm: true });
  assert.equal(renamed.status, 200); assert.equal(renamed.data.paper_id, paperId);
  const stored = await getBrowserPdfRecord(uploaded.data.results[0].relative_path);
  assert.equal(stored.filename, "연구-attachment.pdf"); assert.equal(await sha256Blob(stored.blob), await sha256Blob(file));
  assert.equal((await request(api, `/papers/${paperId}/rename-pdf`, "POST", { filename: "../unsafe.pdf", expected_pdf_revision: renamed.data.pdf_revision, confirm: true })).status, 422);
  assert.equal((await request(api, `/papers/${paperId}/rename-pdf`, "POST", { filename: "again.pdf", expected_pdf_revision: paper.pdf_revision, confirm: true })).status, 409);
});

test("cache quarantine retains verified text in recovery and guarded restore preserves page evidence", async () => {
  const api = await reset(), file = fixturePdf(), uploaded = await upload(api, file), paperId = uploaded.data.results[0].paper_id;
  const extracted = await request(api, `/papers/${paperId}/full-text/extract`, "POST", { provider: "browser-pdfjs", pages: [{ page_number: 1, text: "Verified cached evidence" }], source_pdf_sha256: await sha256Blob(file) });
  const before = await getMaintenanceSnapshot();
  const quarantine = await request(api, `/papers/${paperId}/full-text/quarantine`, "POST", { expected_revision: before.revision, confirm: true });
  assert.equal(quarantine.status, 200); assert.equal(quarantine.data.status, "quarantined");
  assert.equal((await request(api, `/papers/${paperId}/full-text/status`)).data.state, "not_extracted");
  const recovery = (await request(api, "/recovery")).data;
  const copy = recovery.items.find((item) => item.recovery_id === quarantine.data.recovery_id); assert.equal(copy.kind, "full_text_cache");
  assert.equal((await request(api, `/recovery/${encodeURIComponent(copy.recovery_id)}/restore`, "POST", { expected_revision: before.revision, confirm: true })).status, 409);
  assert.equal((await request(api, `/recovery/${encodeURIComponent(copy.recovery_id)}/restore`, "POST", { expected_revision: recovery.workspace_revision, confirm: true })).status, 200);
  const restored = (await request(api, `/papers/${paperId}/full-text`)).data;
  assert.equal(restored.content, extracted.data.content); assert.deepEqual(restored.pages, extracted.data.pages);
});

test("Crossref preview uses the fixed public fallback after CORS failure and never applies a candidate", async () => {
  const api = await reset(), originalFetch = globalThis.fetch, calls = [];
  const before = (await request(api, "/papers/demo-ccs/reader")).data;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith("https://api.crossref.org/")) throw new TypeError("CORS blocked");
    return Response.json({ items: [{ title: "A different publication to review", authors: ["First Author"], year: 2025, doi: "10.example/review", journal: "Fixture", abstract: "<p>Safe candidate text</p>", keywords: ["CCS"] }] });
  };
  try {
    const preview = await request(api, "/papers/demo-ccs/metadata/enrichment-preview", "POST", {});
    assert.equal(preview.status, 200); assert.equal(calls.length, 2);
    assert.match(calls[1], /^\/ku-ai\/api\/discover\?q=.+&provider=crossref&limit=5$/);
    assert.equal(preview.data.fields.find((field) => field.field === "title").candidate_value, "A different publication to review");
    assert.equal(preview.data.fields.find((field) => field.field === "abstract").candidate_value, "Safe candidate text");
    assert.equal((await request(api, "/papers/demo-ccs/reader")).data.metadata_revision, before.metadata_revision);
    assert.equal((await request(api, "/papers/demo-ccs")).data.title, before.paper.title);
  } finally { globalThis.fetch = originalFetch; }
});

test("citation provenance survives block edits; linked block deletion rejects until unlink", async () => {
  const api = await reset(), baseline = (await request(api, "/papers/demo-ccs/note-blocks")).data;
  const provenance = { source: "pdf_selection", page: 2, coordinate_space: "page-normalized", quote: "A source quotation", rectangles: [{ x: 0.1, y: 0.2, width: 0.4, height: 0.03 }] };
  const created = await request(api, "/papers/demo-ccs/note-blocks", "POST", { block_type: "evidence", text: "My interpretation", quote: provenance.quote, page: "2", provenance, expected_revision: baseline.note_blocks_revision });
  assert.equal(created.status, 200);
  assert.deepEqual(created.data.block.provenance, provenance);
  const edited = await request(api, `/papers/demo-ccs/note-blocks/${created.data.block.id}`, "PATCH", { changes: { title: "Edited finding" }, expected_revision: created.data.note_blocks_revision });
  assert.deepEqual(edited.data.block.provenance, provenance);
  const project = (await request(api, "/projects/demo-storage")).data;
  const linked = await request(api, "/projects/demo-storage/note-block-links", "POST", { paper_id: "demo-ccs", note_block_id: created.data.block.id, link_type: "related", expected_links_revision: project.links_revision });
  const deleted = await request(api, `/papers/demo-ccs/note-blocks/${created.data.block.id}`, "DELETE", { expected_revision: edited.data.note_blocks_revision, confirm: true });
  assert.equal(deleted.status, 409);
  await request(api, `/projects/demo-storage/note-block-links/${linked.data.link.link_id}`, "DELETE", { expected_links_revision: linked.data.project.links_revision });
  assert.equal((await request(api, `/papers/demo-ccs/note-blocks/${created.data.block.id}`, "DELETE", { expected_revision: edited.data.note_blocks_revision, confirm: true })).status, 200);
  const recovery = (await request(api, "/recovery")).data;
  assert.equal((await request(api, `/recovery/${encodeURIComponent(recovery.items[0].recovery_id)}/restore`, "POST", { expected_revision: recovery.workspace_revision, confirm: true })).status, 200);
  assert.deepEqual((await request(api, "/papers/demo-ccs/note-blocks")).data.items.find((block) => block.id === created.data.block.id).provenance, provenance);
});

test("rulebook candidates support reject, promote, approve and explicit apply including Korean labels", async () => {
  const api = await reset(), reader = (await request(api, "/papers/demo-muon/reader")).data;
  await request(api, "/papers/demo-muon/metadata", "PATCH", { changes: { keywords: "새 연구 개념, CCS" }, expected_revision: reader.metadata_revision });
  const generated = (await request(api, "/papers/demo-muon/tag-candidates/generate", "POST", { reset_rejections: false })).data;
  const novel = generated.items.find((item) => item.tag_text === "새 연구 개념");
  assert.equal(novel.state, "unresolved");
  const promoted = (await request(api, `/papers/demo-muon/tag-candidates/${novel.candidate_id}/promote`, "POST", { expected_review_revision: generated.review_revision, category: "concept" })).data;
  const approved = (await request(api, `/papers/demo-muon/tag-candidates/${novel.candidate_id}/approve`, "POST", { expected_review_revision: promoted.review_revision })).data;
  const applied = await request(api, `/papers/demo-muon/tag-candidates/${novel.candidate_id}/apply`, "POST", { expected_review_revision: approved.review_revision, expected_tags_revision: reader.tags_revision });
  assert.equal(applied.status, 200);
  assert.ok(applied.data.paper_tag.tags.includes(applied.data.candidate.resolved_canonical));
  assert.equal((await request(api, "/tags/governance")).data.items.find((tag) => tag.canonical_key === applied.data.candidate.resolved_canonical).label, "새 연구 개념");
});

test("IndexedDB compare-and-set rejects separate adapter stale writes without losing the first note", async () => {
  const api = await reset(), second = createDemoAdapter(), reader = (await request(api, "/papers/demo-ccs/reader")).data;
  const saves = await Promise.all([request(api, "/papers/demo-ccs/reading-note", "PUT", { content: "First research", expected_sha256: reader.saved_note_baseline.sha256 }), request(second, "/papers/demo-ccs/reading-note", "PUT", { content: "Second research", expected_sha256: reader.saved_note_baseline.sha256 })]);
  assert.deepEqual(saves.map((save) => save.status).sort(), [200, 409]);
});

test("external note import atomically preserves prior notes, creates typed blocks and prevents duplicate application", async () => {
  const api = await reset();
  const source = { source_name: "field-notes.md", content: "# BluePrint Reading Note\n\npaper_id: demo-ccs\ntitle: [Demo] Screening a CO2 Storage Site\n\n## Summary\n새로운 연구 요약\n\n## Questions\nWhich observation changes the conclusion?\n", target_paper_id: "demo-ccs" };
  const before = (await request(api, "/papers/demo-ccs/reader")).data;
  const preview = await request(api, "/note-import/preview", "POST", source);
  assert.equal(preview.status, 200);
  assert.equal(preview.data.block_candidates.length, 2);
  assert.equal(preview.data.matching_papers[0].paper_id, "demo-ccs");
  const imported = await request(api, "/note-import", "POST", { ...source, expected_revision: preview.data.workspace_revision, confirm: true });
  assert.equal(imported.status, 200);
  assert.equal(imported.data.imported_block_count, 2);
  assert.ok(imported.data.reading_note.content.includes(before.saved_note_content));
  assert.ok(imported.data.reading_note.content.includes("새로운 연구 요약"));
  assert.equal((await request(api, "/papers/demo-ccs/note-blocks")).data.total, 3);
  const repeated = await request(api, "/note-import/preview", "POST", source);
  assert.equal(repeated.data.duplicate, true);
  assert.equal((await request(api, "/note-import", "POST", { ...source, expected_revision: repeated.data.workspace_revision, confirm: true })).status, 409);
  const recovery = (await request(api, "/recovery")).data, note = recovery.items.find((item) => item.kind === "reading_note");
  assert.ok(note);
  assert.equal((await request(api, `/recovery/${encodeURIComponent(note.recovery_id)}/restore`, "POST", { expected_revision: recovery.workspace_revision, confirm: true })).status, 200);
  assert.equal((await request(api, "/papers/demo-ccs/reader")).data.saved_note_content, before.saved_note_content);
});

test("Project deletion retains a guarded recovery copy and link edits preserve target identity", async () => {
  const api = await reset(), project = (await request(api, "/projects/demo-storage")).data;
  const link = project.links[0];
  const updated = await request(api, `/projects/demo-storage/paper-links/${link.link_id}`, "PATCH", { changes: { link_type: "supports_project" }, expected_links_revision: project.links_revision });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.link.paper_id, link.paper_id);
  assert.equal(updated.data.link.link_type, "supports_project");
  assert.equal((await request(api, "/projects/demo-storage", "DELETE", { expected_revision: updated.data.project.project_revision, confirm: true })).status, 200);
  assert.equal((await request(api, "/projects/demo-storage")).status, 404);
  const recovery = (await request(api, "/recovery")).data, copy = recovery.items.find((item) => item.kind === "project");
  assert.equal((await request(api, `/recovery/${encodeURIComponent(copy.recovery_id)}/restore`, "POST", { expected_revision: recovery.workspace_revision, confirm: true })).status, 200);
  assert.equal((await request(api, "/projects/demo-storage")).data.links[0].link_type, "supports_project");
});

test("full backups include original PDF bytes and reject tampering before restore", async () => {
  const api = await reset(), file = fixturePdf(), uploaded = await upload(api, file);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(file, { headers: { "Content-Type": "application/pdf" } });
  try {
    const archive = await exportBrowserWorkspace();
    assert.equal(archive.pdfs.filter((entry) => entry.kind === "active").length, 4);
    const preview = await previewBrowserWorkspaceRestore(archive);
    assert.equal(preview.valid, true);
    const altered = structuredClone(archive); altered.pdfs[0].sha256 = "0".repeat(64);
    assert.equal((await previewBrowserWorkspaceRestore(altered)).valid, false);
    const current = await getMaintenanceSnapshot();
    await assert.rejects(restoreBrowserWorkspace(altered, { expected_revision: current.revision, confirm: true }), /checksum/);
    assert.equal((await request(api, `/papers/${uploaded.data.results[0].paper_id}`)).status, 200);
    const restored = await restoreBrowserWorkspace(archive, { expected_revision: current.revision, confirm: true });
    assert.equal(restored.status, "restored");
    assert.equal((await getMaintenanceSnapshot()).paper_count, 4);
  } finally { globalThis.fetch = originalFetch; }
});

test("PDF extraction counts real page text, reports OCR needs and releases document resources", async () => {
  let cleaned = 0, destroyed = 0;
  const loadingTaskFactory = async () => ({ promise: Promise.resolve({ numPages: 2, getPage: async (page) => ({ getTextContent: async () => ({ items: page === 1 ? [{ str: "Hello", hasEOL: false, transform: [1, 0, 0, 1, 0, 100] }, { str: "research", hasEOL: true, transform: [1, 0, 0, 1, 50, 100] }] : [] }), cleanup: () => { cleaned += 1; } }), destroy: async () => { destroyed += 1; } }) });
  const extracted = await extractPdfPages(fixturePdf(), { loadingTaskFactory });
  assert.equal(extracted.pages[0].text, "Hello research");
  assert.deepEqual(extracted.ocr_needed_pages, [2]);
  assert.equal(cleaned, 2);
  assert.equal(destroyed, 1);
  assert.match(extractedPagesContent(extracted.pages), /--- Page 2 ---/);
});

test("the browser export, including bundled sample PDF bytes, is accepted by the cloud import contract", async()=>{
  await reset();
  const originalFetch=globalThis.fetch;
  try{
    const {readFile}=await import("node:fs/promises");
    globalThis.fetch=async url=>new Response(await readFile(new URL(`../public/bandal-demo/${String(url).split('/').at(-1)}`,import.meta.url)),{headers:{"Content-Type":"application/pdf"}});
    const archive=await exportBrowserWorkspace();
    const {validateArchive}=await import("../../hosting/domain/maintenance.mjs");
    const checked=await validateArchive(archive);
    assert.equal(checked.workspace.papers.length,3);assert.equal(checked.files.length,3);
    assert.ok(archive.pdfs.every(pdf=>pdf.key.startsWith("pdf-")));
  }finally{globalThis.fetch=originalFetch;}
});
