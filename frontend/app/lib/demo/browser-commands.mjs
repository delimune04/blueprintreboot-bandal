import { DEMO_PAPERS } from "./seed.mjs";
import { getBrowserPdfRecord, listBrowserPdfRecords, listBrowserRecoveryWorkspaces, restoreBrowserRecoveryWorkspace, validatePdfFile, sha256Blob, workspaceRevision } from "./browser-storage.mjs";
import { extractPdfPages, extractedPagesContent } from "./pdf-extraction.mjs";

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const result = (value) => ({ handled: true, value });
const sample = (paper) => DEMO_PAPERS.some((row) => row.paper_id === paper.paper_id);
function strict(body, keys, fail) { if (!object(body) || Object.keys(body).some((key) => !keys.includes(key))) fail(422, "Unknown or invalid command fields."); }
function safeName(value) { return String(value || "paper.pdf").split(/[\\/]/).pop().replace(/[\u0000-\u001f]/g, "").slice(0, 255) || "paper.pdf"; }
export function validatePdfProvenance(value) {
  if (!object(value) || value.source !== "pdf_selection" || !Number.isInteger(value.page) || value.page < 1 || value.page > 10000 || value.coordinate_space !== "page-normalized" || typeof value.quote !== "string" || !value.quote.trim() || value.quote.length > 100000 || !Array.isArray(value.rectangles) || !value.rectangles.length || value.rectangles.length > 200) throw new Error("PDF citation provenance is invalid.");
  const rectangles = value.rectangles.map((rectangle) => {
    if (!object(rectangle) || ["x", "y", "width", "height"].some((key) => !Number.isFinite(rectangle[key]) || rectangle[key] < 0 || rectangle[key] > 1) || rectangle.width <= 0 || rectangle.height <= 0 || rectangle.x + rectangle.width > 1.000001 || rectangle.y + rectangle.height > 1.000001) throw new Error("PDF citation rectangles must be normalized page coordinates.");
    return { x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height };
  });
  return { source: "pdf_selection", page: value.page, coordinate_space: "page-normalized", quote: value.quote, rectangles };
}
export function validateBrowserPaper(paper) {
  if (!object(paper) || (!sample(paper) && !/^paper-[a-f0-9-]{36}$/.test(paper.paper_id))) return false;
  if (paper.pdfId !== undefined && (typeof paper.pdfId !== "string" || !/^[a-z0-9-]{1,180}$/.test(paper.pdfId))) return false;
  if (paper.pdfSha256 !== undefined && !/^[0-9a-f]{64}$/.test(paper.pdfSha256)) return false;
  if (paper.pdfMissing !== undefined && typeof paper.pdfMissing !== "boolean") return false;
  if (paper.filename !== undefined && (typeof paper.filename !== "string" || paper.filename.length > 255)) return false;
  if (paper.fullTextCache && !validTextCache(paper.fullTextCache)) return false;
  if (paper.pdfVersion !== undefined && (!Number.isSafeInteger(paper.pdfVersion) || paper.pdfVersion < 1)) return false;
  if (paper.reviewRev !== undefined && (!Number.isSafeInteger(paper.reviewRev) || paper.reviewRev < 1)) return false;
  if (paper.priorityRev !== undefined && (!Number.isSafeInteger(paper.priorityRev) || paper.priorityRev < 1)) return false;
  if (paper.candidates && (!Array.isArray(paper.candidates) || paper.candidates.length > 1000 || paper.candidates.some((candidate) => !object(candidate) || !/^[0-9a-f]{64}$/.test(candidate.candidate_id || "") || !["unresolved", "resolved", "approved", "rejected", "applied"].includes(candidate.state) || !["high", "medium", "weak"].includes(candidate.quality) || typeof candidate.tag_text !== "string" || candidate.tag_text.length > 200 || !Array.isArray(candidate.evidence) || candidate.evidence.length > 100))) return false;
  if (paper.noteRecoveryCopies && (!Array.isArray(paper.noteRecoveryCopies) || paper.noteRecoveryCopies.length > 100 || paper.noteRecoveryCopies.some((note) => !object(note) || typeof note.id !== "string" || typeof note.content !== "string" || note.content.length > 2000000 || typeof note.created_at !== "string"))) return false;
  if (paper.deletedBlocks && (!Array.isArray(paper.deletedBlocks) || paper.deletedBlocks.length > 100 || paper.deletedBlocks.some((block) => !object(block) || block.paper_id !== paper.paper_id || typeof block.id !== "string" || typeof block.text !== "string" || block.text.length > 100000))) return false;
  if (paper.cacheRecoveryCopies && (!Array.isArray(paper.cacheRecoveryCopies) || paper.cacheRecoveryCopies.length > 100 || paper.cacheRecoveryCopies.some((copy) => !object(copy) || typeof copy.id !== "string" || typeof copy.created_at !== "string" || !/^[a-f0-9]{64}$/.test(copy.sha256 || "") || !validTextCache(copy.cache)))) return false;
  return true;
}
function validTextCache(cache) {
  if (!object(cache) || typeof cache.content !== "string" || cache.content.length > 2100000 || !Array.isArray(cache.ocr_needed_pages)) return false;
  if (cache.pages !== undefined) {
    if (!Array.isArray(cache.pages) || !cache.pages.length || cache.pages.length > 1000 || cache.pages.some((page, index) => !object(page) || page.page_number !== index + 1 || typeof page.text !== "string" || page.text.length > 200000 || page.text.includes("\u0000")) || cache.pages.reduce((sum, page) => sum + page.text.length, 0) > 2000000 || extractedPagesContent(cache.pages) !== cache.content) return false;
  }
  if (cache.ocr_pages !== undefined && (!Array.isArray(cache.ocr_pages) || cache.ocr_pages.length > 20 || cache.ocr_pages.some((page) => !object(page) || !Number.isInteger(page.page_number) || page.page_number < 1 || page.page_number > (cache.pages?.length || cache.page_count || 1000) || !Number.isFinite(page.confidence) || page.confidence < 0 || page.confidence > 100) || new Set(cache.ocr_pages.map((page) => page.page_number)).size !== cache.ocr_pages.length)) return false;
  return true;
}
async function pdfBlob(paper, effects, fail) {
  if (paper.pdfMissing) fail(409, "The Paper's PDF attachment is missing.");
  if (paper.pdfId) {
    const record = effects.putFiles.find((file) => file.key === paper.pdfId) || await getBrowserPdfRecord(paper.pdfId);
    if (!record) fail(503, "The saved PDF attachment could not be read. Existing research has been preserved.");
    return record.blob;
  }
  if (sample(paper)) {
    const prefix = (process.env.NEXT_PUBLIC_BANDAL_DEMO_BASE || "").replace(/\/$/, "");
    const response = await fetch(`${prefix}/bandal-demo/${paper.paper_id}.pdf`);
    if (!response.ok) fail(503, "The bundled sample PDF could not be loaded.");
    return response.blob();
  }
  fail(503, "This Paper does not have an accessible PDF.");
}
function candidateCollection(paper, contract) {
  return { paper_id: paper.paper_id, review_revision: contract.revision(paper.reviewRev || 1), tags_revision: contract.revision(paper.tagsRev), state: paper.candidates ? "generated" : "not_generated", items: structuredClone(paper.candidates || []) };
}
function candidateSummary(state) {
  const all = state.papers.flatMap((paper) => paper.candidates || []), quality_counts = { high: 0, medium: 0, weak: 0, rejected: 0 };
  for (const item of all) quality_counts[item.state === "rejected" ? "rejected" : item.quality] += 1;
  return { availability: "available", state: all.length ? "populated" : "empty", source: all.length ? "paper_index" : "none", evaluated_paper_count: state.papers.filter((paper) => paper.candidates).length, candidate_count: all.length, known_canonical_match_count: all.filter((item) => item.resolved_canonical).length, quality_counts };
}
function validatePages(body, fail) {
  if (!Array.isArray(body.pages) || !body.pages.length || body.pages.length > 1000 || !/^[0-9a-f]{64}$/.test(body.source_pdf_sha256 || "")) fail(422, "Extraction requires verified PDF pages and a source hash.");
  let characters = 0;
  const pages = body.pages.map((page, index) => {
    if (!object(page) || page.page_number !== index + 1 || typeof page.text !== "string" || page.text.length > 200000 || page.text.includes("\u0000")) fail(422, "Extracted pages must be contiguous text pages starting at page one, bounded to 200,000 characters per page.");
    characters += page.text.length;
    if (characters > 2000000) fail(422, "Extracted text exceeds the browser size limit; nothing was truncated.");
    return { page_number: page.page_number, text: page.text };
  });
  const ocr_needed_pages = pages.filter((page) => !page.text.trim()).map((page) => page.page_number);
  const provider = body.provider || "browser-pdfjs";
  if (!["browser-pdfjs", "browser-pdfjs+tesseract"].includes(provider)) fail(422, "Unsupported PDF extraction provider.");
  const ocr_pages = body.ocr_pages || [];
  if (!Array.isArray(ocr_pages) || ocr_pages.length > 20 || ocr_pages.some((page) => !object(page) || !Number.isInteger(page.page_number) || page.page_number < 1 || page.page_number > pages.length || !Number.isFinite(page.confidence) || page.confidence < 0 || page.confidence > 100) || new Set(ocr_pages.map((page) => page.page_number)).size !== ocr_pages.length || (provider === "browser-pdfjs+tesseract" && !ocr_pages.length) || (provider === "browser-pdfjs" && ocr_pages.length)) fail(422, "OCR provenance requires bounded page numbers and actual engine confidence values.");
  const imagePages = new Set([...ocr_pages.map((page) => page.page_number), ...ocr_needed_pages]).size;
  return { pages, provider, ocr_pages, source_pdf_sha256: body.source_pdf_sha256, page_count: pages.length, char_count: characters, ocr_needed_pages, classification: imagePages === pages.length ? "scanned" : imagePages ? "mixed" : "text" };
}

export async function handleBrowserCommand(parts, method, body, params, state, effects, contract) {
  const { fail, guard, revision } = contract;
  const path = parts.join("/");
  if (parts[0] === "note-import" && method === "POST" && parts.length <= 2) {
    strict(body, ["source_name", "content", "target_paper_id", "expected_revision", "confirm", "force_reimport"], fail);
    if (typeof body.source_name !== "string" || !body.source_name.trim() || body.source_name.length > 255 || typeof body.content !== "string" || !body.content.trim() || body.content.length > 2000000 || body.content.includes("\u0000")) fail(422, "Choose a bounded non-empty research note file.");
    const source_sha256 = await workspaceRevision(body.content), header_fields = {};
    for (const line of body.content.split(/\r?\n/).slice(0, 30)) {
      const field = /^(paper_id|title|doi|arxiv_id|year|first_author|tags|template_version):\s*(.*)$/.exec(line);
      if (field) header_fields[field[1]] = field[2];
      if (/^##\s/.test(line)) break;
    }
    const sections = [], sectionPattern = /^##\s+(.+)\r?\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/gm;
    let section;
    while ((section = sectionPattern.exec(body.content))) sections.push({ title: section[1].trim(), text: section[2].trim() });
    const sectionType = (title) => /(?:one.line summary|summary|요약)/i.test(title) ? "summary" : /(?:claim|주장)/i.test(title) ? "claim" : /(?:method|방법)/i.test(title) ? "method" : /(?:evidence|result|근거|결과)/i.test(title) ? "evidence" : /(?:question|질문)/i.test(title) ? "question" : /(?:idea|아이디어)/i.test(title) ? "idea" : /(?:limitation|한계)/i.test(title) ? "limitation" : null;
    const block_candidates = sections.filter((section) => section.text && sectionType(section.title)).slice(0, 50).map((section) => ({ block_type: sectionType(section.title), title: section.title.slice(0, 1000), text: section.text }));
    if (block_candidates.some((block) => block.text.length > 100000)) fail(422, "An imported note section exceeds the 100,000-character Note Block limit.");
    const duplicate = (state.noteImports || []).some((entry) => entry.source_sha256 === source_sha256 && (!body.target_paper_id || entry.paper_id === body.target_paper_id));
    const matching_papers = state.papers.filter((paper) => paper.paper_id === header_fields.paper_id || (header_fields.doi && paper.metadata.doi === header_fields.doi) || (header_fields.title && paper.metadata.title.toLocaleLowerCase() === header_fields.title.toLocaleLowerCase())).map((paper) => ({ paper_id: paper.paper_id, title: paper.metadata.title, score: paper.paper_id === header_fields.paper_id ? 100 : 80, reason: "Explicit source header matches saved Paper metadata; review the target before importing." }));
    const workspace_revision = await workspaceRevision(state);
    if (parts[1] === "preview") return result({ source_sha256, header_fields, sections, block_candidates, matching_papers, duplicate, workspace_revision });
    if (parts.length !== 1) fail(404, "Note import operation not found.");
    if (body.confirm !== true || body.expected_revision !== workspace_revision) fail(409, "Review the current note import preview and explicitly confirm before applying.");
    if (duplicate && body.force_reimport !== true) fail(409, "This source has already been imported into the selected Paper.");
    const paper = state.papers.find((paper) => paper.paper_id === body.target_paper_id);
    if (!paper) fail(404, "Select an existing target Paper for this note import.");
    if (paper.blocks.length + block_candidates.length > 1000) fail(422, "The imported blocks would exceed this Paper's block limit.");
    const content = `${paper.noteExists ? paper.note.trimEnd() + "\n\n" : ""}## Imported source: ${safeName(body.source_name)}\n\n${body.content}`;
    const canonical = contract.canonicalNote(content, paper);
    const importedAt = now();
    if (paper.noteExists) paper.noteRecoveryCopies = [...(paper.noteRecoveryCopies || []), { id: `note-${uuid()}`, content: paper.note, created_at: importedAt }].slice(-100);
    paper.note = canonical; paper.noteExists = true;
    for (const block of block_candidates) paper.blocks.push({ ...block, id: `block-${uuid()}`, paper_id: paper.paper_id, page: "", figure: "", quote: "", tags: [], created_at: importedAt, updated_at: importedAt, source_import: { source_sha256, source_name: body.source_name, imported_at: importedAt, provenance: "external_note" } });
    if (block_candidates.length) paper.blocksRev += 1;
    state.noteImports = [...(state.noteImports || []), { source_sha256, source_name: body.source_name, paper_id: paper.paper_id, imported_at: importedAt }].slice(-1000);
    return result({ status: "imported", paper_id: paper.paper_id, source_sha256, imported_block_count: block_candidates.length, note_blocks_revision: revision(paper.blocksRev), reading_note: await contract.persistedNote(paper) });
  }
  if (method === "GET" && path === "workspace") return result({ revision: await workspaceRevision(state), storage: "indexeddb", paper_count: state.papers.length });
  if (method === "GET" && path === "recovery") {
    const files = await listBrowserPdfRecords(), workspaces = await listBrowserRecoveryWorkspaces();
    return result({ workspace_revision: await workspaceRevision(state), items: [
      ...(state.deletedProjects || []).map((project) => ({ recovery_id: `project:${project.project_id}`, kind: "project", created_at: project.deleted_at, summary: `Deleted Project: ${project.name}` })),
      ...state.papers.flatMap((paper) => (paper.deletedBlocks || []).map((block) => ({ recovery_id: `block:${paper.paper_id}:${block.id}`, kind: "note_block", created_at: block.deleted_at, summary: `Deleted Note Block: ${block.title || block.block_type}` }))),
      ...state.papers.flatMap((paper) => (paper.noteRecoveryCopies || []).map((note) => ({ recovery_id: `note:${paper.paper_id}:${note.id}`, kind: "reading_note", created_at: note.created_at, summary: `Reading Note before external import: ${paper.metadata.title}` }))),
      ...state.papers.flatMap((paper) => (paper.cacheRecoveryCopies || []).map((cache) => ({ recovery_id: `cache:${paper.paper_id}:${cache.id}`, kind: "full_text_cache", created_at: cache.created_at, summary: `Quarantined text cache: ${paper.metadata.title}` }))),
      ...files.filter((file) => file.kind === "recovery" && state.papers.some((paper) => paper.paper_id === file.paper_id && paper.pdfMissing && paper.pdfSha256 === file.sha256)).map((file) => ({ recovery_id: `pdf:${file.key}`, kind: "pdf", created_at: file.created_at, summary: `Removed PDF: ${file.filename}` })),
      ...workspaces.map((row) => ({ recovery_id: row.recovery_id, kind: row.kind, created_at: row.created_at, summary: row.summary })),
    ] });
  }
  if (method === "POST" && parts[0] === "recovery" && parts.length === 3 && parts[2] === "restore") {
    strict(body, ["expected_revision", "confirm"], fail);
    if (body.confirm !== true) fail(422, "Recovery restore requires explicit confirmation.");
    if (body.expected_revision !== await workspaceRevision(state)) fail(409, "The workspace changed after recovery review. Reload before restoring.");
    const recoveryId = parts[1];
    if (recoveryId.startsWith("restore-")) return result(await restoreBrowserRecoveryWorkspace(recoveryId, { expected_revision: body.expected_revision, confirm: true }));
    if (recoveryId.startsWith("project:")) {
      const project = state.deletedProjects?.find((project) => project.project_id === recoveryId.slice(8));
      if (!project) fail(404, "Project recovery copy not found.");
      if (state.projects.some((current) => current.project_id === project.project_id)) fail(409, "That Project already exists. The current Project was not overwritten.");
      if (project.links.some((link) => !state.papers.some((paper) => paper.paper_id === link.paper_id && (link.target_type === "paper" || paper.blocks.some((block) => block.id === link.target_id))))) fail(409, "Restore this Project's missing source Paper or Note Block first.");
      const restored = { ...project, projectRev: project.projectRev + 1, updated_at: now() }; delete restored.deleted_at;
      state.projects.push(restored); state.deletedProjects = state.deletedProjects.filter((row) => row !== project);
      return result({ status: "restored", recovery_id: recoveryId });
    }
    if (recoveryId.startsWith("block:")) {
      const [, paperId, blockId] = recoveryId.split(":"), paper = state.papers.find((paper) => paper.paper_id === paperId), block = paper?.deletedBlocks?.find((block) => block.id === blockId);
      if (!block) fail(404, "Note Block recovery copy not found.");
      if (paper.blocks.some((current) => current.id === block.id)) fail(409, "That Note Block already exists; no current block was replaced.");
      const restored = { ...block, updated_at: now() }; delete restored.deleted_at;
      paper.blocks.push(restored); paper.blocksRev += 1; paper.deletedBlocks = paper.deletedBlocks.filter((row) => row !== block);
      return result({ status: "restored", recovery_id: recoveryId });
    }
    if (recoveryId.startsWith("note:")) {
      const [, paperId, noteId] = recoveryId.split(":"), paper = state.papers.find((paper) => paper.paper_id === paperId), note = paper?.noteRecoveryCopies?.find((note) => note.id === noteId);
      if (!note) fail(404, "Reading Note recovery copy not found.");
      const current = { id: `note-${uuid()}`, content: paper.note, created_at: now() };
      paper.note = contract.canonicalNote(note.content, paper); paper.noteExists = true;
      paper.noteRecoveryCopies = [...paper.noteRecoveryCopies.filter((row) => row !== note), current].slice(-100);
      return result({ status: "restored", recovery_id: recoveryId, reading_note: await contract.persistedNote(paper) });
    }
    if (recoveryId.startsWith("cache:")) {
      const [, paperId, cacheId] = recoveryId.split(":"), paper = state.papers.find((paper) => paper.paper_id === paperId), copy = paper?.cacheRecoveryCopies?.find((copy) => copy.id === cacheId);
      if (!copy) fail(404, "Text cache recovery copy not found.");
      if (paper.fullText || paper.fullTextCache?.has_content) fail(409, "A current text cache exists. Quarantine it before restoring this copy.");
      if (copy.sha256 !== await workspaceRevision(copy.cache)) fail(503, "The text cache recovery checksum did not match. No current cache was changed.");
      paper.fullTextCache = copy.cache; paper.cacheRecoveryCopies = paper.cacheRecoveryCopies.filter((row) => row !== copy);
      return result({ status: "restored", recovery_id: recoveryId });
    }
    if (recoveryId.startsWith("pdf:")) {
      const file = await getBrowserPdfRecord(recoveryId.slice(4)), paper = state.papers.find((paper) => paper.paper_id === file?.paper_id);
      if (!file || !paper) fail(404, "PDF recovery copy not found.");
      if (!paper.pdfMissing || await sha256Blob(file.blob) !== paper.pdfSha256) fail(409, "The recovery copy does not match a missing PDF; no attachment was replaced.");
      const key = `pdf-${uuid()}`;
      effects.putFiles.push({ ...file, key, kind: "active" }); paper.pdfId = key; paper.pdfMissing = false; paper.pdfVersion = (paper.pdfVersion || 1) + 1;
      return result({ status: "restored", recovery_id: recoveryId });
    }
    fail(404, "Recovery copy not found.");
  }
  if (method === "GET" && path === "tags/summary") return result(candidateSummary(state));
  if (method === "GET" && path === "tags/review-queue") {
    const rows = state.papers.filter((paper) => paper.candidates?.length).map((paper) => ({ paper_id: paper.paper_id, title: paper.metadata.title, candidate_count: paper.candidates.length, unresolved_count: paper.candidates.filter((item) => item.state === "unresolved").length, resolved_count: paper.candidates.filter((item) => item.state === "resolved").length, approved_count: paper.candidates.filter((item) => item.state === "approved").length, candidate_labels: paper.candidates.map((item) => item.tag_text) }));
    const limit = Math.min(100, Math.max(1, Number(params.get("limit") || 50))), offset = Math.max(0, Number(params.get("offset") || 0));
    return result({ items: rows.slice(offset, offset + limit), total: rows.length, limit, offset, has_more: offset + limit < rows.length });
  }
  if (method === "POST" && path === "papers/upload") {
    if (!(body instanceof FormData)) fail(422, "Select PDF files for upload.");
    const files = body.getAll("files");
    if (!files.length || files.length > 50) fail(422, "Select between 1 and 50 PDFs at a time.");
    const results = [];
    for (const file of files) {
      let verified;
      try { verified = await validatePdfFile(file); } catch (error) { results.push({ relative_path: "", filename: safeName(file?.name), status: "invalid", message: error.message, can_import: false, size_bytes: file?.size || 0, paper_id: "" }); continue; }
      const duplicate = state.papers.find((paper) => !paper.pdfMissing && paper.pdfSha256 === verified.sha256);
      if (duplicate) { results.push({ relative_path: duplicate.pdfId || "", filename: safeName(file.name), status: "duplicate_content", message: "An identical PDF is already in this browser library. Existing notes were retained.", can_import: false, size_bytes: file.size, paper_id: duplicate.paper_id }); continue; }
      const missing = state.papers.filter((paper) => paper.pdfMissing && paper.pdfSha256 === verified.sha256);
      const filename = safeName(file.name), key = `pdf-${uuid()}`;
      if (missing.length === 1) {
        const paper = missing[0];
        effects.putFiles.push({ key, paper_id: paper.paper_id, filename, sha256: verified.sha256, kind: "active", created_at: now(), blob: file });
        paper.pdfId = key; paper.filename = filename; paper.pdfMissing = false; paper.pdfVersion = (paper.pdfVersion || 1) + 1;
        results.push({ relative_path: key, filename, status: "imported", message: "Reconnected the identical PDF to its existing Paper and saved research.", can_import: false, size_bytes: file.size, paper_id: paper.paper_id });
        continue;
      }
      if (missing.length > 1) { results.push({ relative_path: "", filename, status: "unavailable", message: "More than one missing Paper matches this PDF. Choose an explicit reconnect target.", can_import: false, size_bytes: file.size, paper_id: "" }); continue; }
      if (state.papers.length >= 1000) fail(422, "This browser workspace supports at most 1,000 Papers.");
      const paper_id = `paper-${uuid()}`;
      const paper = { paper_id, metadata: { title: filename.replace(/\.pdf$/i, ""), authors: "", year: "", journal: "", doi: "", abstract: "", keywords: "" }, tags: [], status: "unread", priority: "normal", archived: false, metadataRev: 1, tagsRev: 1, statusRev: 1, lifecycleRev: 1, blocksRev: 1, fullText: "", note: "", noteExists: false, blocks: [], pdfId: key, pdfSha256: verified.sha256, pdfMissing: false, pdfVersion: 1, filename };
      state.papers.push(paper);
      effects.putFiles.push({ key, paper_id, filename, sha256: verified.sha256, kind: "active", created_at: now(), blob: file });
      results.push({ relative_path: key, filename, status: "imported", message: "Saved the selected PDF in this browser's IndexedDB workspace.", can_import: false, size_bytes: file.size, paper_id });
    }
    return result({ message: "Selected files were checked and saved locally. No server folder was scanned.", imported_count: results.filter((entry) => entry.status === "imported").length, results });
  }
  if (method === "POST" && path === "papers/scan") {
    const files = await listBrowserPdfRecords();
    return result({ status: "ok", message: "This lists PDF records already stored in this browser. Select files or a folder to add PDFs; the web app cannot scan your computer's folders automatically.", candidates: files.map((file) => {
      const paper = state.papers.find((paper) => paper.paper_id === file.paper_id);
      const reconnect = file.kind === "recovery" && paper?.pdfMissing && file.sha256 === paper.pdfSha256;
      return { relative_path: file.key, filename: file.filename, status: reconnect ? "reconnect_available" : "already_registered", message: reconnect ? "Verified recovery copy can reconnect this missing PDF." : "Stored browser PDF; no new import is needed.", can_import: false, can_reconnect: Boolean(reconnect), reconnect_paper_id: reconnect ? paper.paper_id : "", size_bytes: file.blob.size };
    }) });
  }
  if (method === "POST" && path === "papers/import") {
    strict(body, ["relative_paths"], fail);
    if (!Array.isArray(body.relative_paths) || body.relative_paths.length > 50) fail(422, "Choose a bounded list of browser PDF records.");
    const results = [];
    for (const key of body.relative_paths) {
      const file = await getBrowserPdfRecord(String(key));
      results.push({ relative_path: String(key), filename: file?.filename || "", status: file ? "already_registered" : "missing", message: file ? "This browser record is already stored. Use explicit reconnect for a recovery copy." : "This browser record was not found. Select a PDF file to import.", can_import: false, size_bytes: file?.blob.size || 0, paper_id: file?.paper_id || "" });
    }
    return result({ message: "Browser records checked. New PDFs are added through file/folder selection.", imported_count: 0, results });
  }
  if (method === "POST" && path === "papers/reconnect") {
    strict(body, ["paper_id", "relative_path"], fail);
    const paper = state.papers.find((paper) => paper.paper_id === body.paper_id), file = await getBrowserPdfRecord(body.relative_path);
    if (!paper || !file) fail(404, "The Paper or browser recovery record was not found.");
    if (!paper.pdfMissing || !paper.pdfSha256 || file.sha256 !== paper.pdfSha256 || await sha256Blob(file.blob) !== paper.pdfSha256) fail(409, "Reconnect requires the exact verified PDF bytes for a missing Paper.");
    const key = `pdf-${uuid()}`;
    effects.putFiles.push({ ...file, key, kind: "active", paper_id: paper.paper_id });
    paper.pdfId = key; paper.filename = file.filename; paper.pdfMissing = false; paper.pdfVersion = (paper.pdfVersion || 1) + 1;
    return result({ status: "reconnected", paper_id: paper.paper_id, relative_path: key, message: "Verified recovery PDF reconnected. Existing notes, blocks and links were retained." });
  }
  if (parts[0] === "papers" && parts.length >= 3) {
    const paper = state.papers.find((paper) => paper.paper_id === parts[1]);
    if (!paper) fail(404, "Paper not found.");
    const action = parts.slice(2).join("/");
    if (method === "PATCH" && action === "priority") {
      strict(body, ["priority", "expected_revision"], fail); guard(body.expected_revision, paper.priorityRev || 1);
      if (!["low", "normal", "high"].includes(body.priority)) fail(422, "Priority must be low, normal or high.");
      const changed = paper.priority !== body.priority;
      if (changed) { paper.priority = body.priority; paper.priorityRev = (paper.priorityRev || 1) + 1; }
      return result({ status: changed ? "saved" : "no_op", priority: paper.priority, priority_revision: revision(paper.priorityRev || 1) });
    }
    if (method === "POST" && action === "rename-pdf") {
      strict(body, ["filename", "expected_pdf_revision", "confirm"], fail); guard(body.expected_pdf_revision, paper.pdfVersion || 1);
      if (body.confirm !== true || typeof body.filename !== "string" || !/\.pdf$/i.test(body.filename) || body.filename !== safeName(body.filename) || body.filename.length < 5) fail(422, "Choose a safe .pdf filename and explicitly confirm the rename.");
      if (paper.pdfMissing) fail(409, "Reconnect the missing PDF before renaming its attachment.");
      const changed = (paper.filename || `${paper.paper_id}.pdf`) !== body.filename;
      if (changed) {
        if (paper.pdfId) { const file = await getBrowserPdfRecord(paper.pdfId); if (!file) fail(503, "The PDF attachment could not be read for rename."); effects.putFiles.push({ ...file, filename: body.filename }); }
        paper.filename = body.filename; paper.pdfVersion = (paper.pdfVersion || 1) + 1;
      }
      return result({ status: changed ? "renamed" : "no_op", paper_id: paper.paper_id, filename: paper.filename || `${paper.paper_id}.pdf`, pdf_revision: revision(paper.pdfVersion || 1), message: "The browser attachment filename was updated. Paper identity and original selected file were retained." });
    }
    if (method === "POST" && action === "full-text/quarantine") {
      strict(body, ["expected_revision", "confirm"], fail);
      if (body.confirm !== true || body.expected_revision !== await workspaceRevision(state)) fail(409, "Review the current workspace and confirm cache quarantine.");
      if (!paper.fullText && !paper.fullTextCache) return result({ status: "no_op", paper_id: paper.paper_id });
      const cache = contract.fullText(paper, true), copy = { id: `cache-${uuid()}`, cache, sha256: await workspaceRevision(cache), created_at: now() };
      paper.cacheRecoveryCopies = [...(paper.cacheRecoveryCopies || []), copy].slice(-100); paper.fullText = ""; delete paper.fullTextCache;
      return result({ status: "quarantined", paper_id: paper.paper_id, recovery_id: `cache:${paper.paper_id}:${copy.id}`, message: "The saved text cache was retained in recovery and detached. The PDF, metadata and research notes were preserved." });
    }
    if (method === "POST" && action === "remove-pdf") {
      strict(body, ["expected_pdf_revision", "confirm"], fail); guard(body.expected_pdf_revision, paper.pdfVersion || 1);
      if (body.confirm !== true) fail(422, "PDF removal requires explicit confirmation.");
      if (paper.pdfMissing) return result({ status: "already_missing", paper_id: paper.paper_id, pdf_removed: false, recovery_copy_created: false, message: "This Paper's PDF attachment is already missing." });
      const blob = await pdfBlob(paper, effects, fail), sha256 = await sha256Blob(blob);
      if (paper.pdfSha256 && paper.pdfSha256 !== sha256) fail(409, "The PDF changed before removal. It has been retained.");
      const key = `recovery-${uuid()}`;
      effects.putFiles.push({ key, paper_id: paper.paper_id, filename: paper.filename || `${paper.paper_id}.pdf`, sha256, kind: "recovery", created_at: now(), blob });
      if (paper.pdfId) effects.deleteFiles.push(paper.pdfId);
      effects.revokedPaperIds.push(paper.paper_id);
      paper.pdfSha256 = sha256; paper.pdfMissing = true; paper.pdfVersion = (paper.pdfVersion || 1) + 1;
      return result({ status: "removed", paper_id: paper.paper_id, pdf_removed: true, recovery_copy_created: true, message: "Removed this workspace's PDF attachment after retaining a verified recovery copy. Paper notes and links remain." });
    }
    if (method === "POST" && action === "unarchive") {
      strict(body, ["expected_lifecycle_revision", "confirm"], fail); guard(body.expected_lifecycle_revision, paper.lifecycleRev);
      if (body.confirm !== true) fail(422, "Restoring visibility requires explicit confirmation.");
      const changed = paper.archived; paper.archived = false; if (changed) paper.lifecycleRev += 1;
      return result({ status: changed ? "restored" : "no_op", paper_id: paper.paper_id, lifecycle_revision: revision(paper.lifecycleRev) });
    }
    if (method === "DELETE" && parts[2] === "note-blocks" && parts.length === 4) {
      strict(body, ["expected_revision", "confirm"], fail); guard(body.expected_revision, paper.blocksRev);
      if (body.confirm !== true) fail(422, "Note Block deletion requires explicit confirmation.");
      const block = paper.blocks.find((block) => block.id === parts[3]);
      if (!block) fail(404, "Note Block not found.");
      if (state.projects.some((project) => project.links.some((link) => link.target_type === "note_block" && link.target_id === block.id))) fail(409, "Unlink this Note Block from its Projects before deleting it.");
      paper.deletedBlocks = [...(paper.deletedBlocks || []), { ...block, deleted_at: now() }].slice(-100);
      paper.blocks = paper.blocks.filter((block) => block.id !== parts[3]); paper.blocksRev += 1;
      return result({ status: "deleted", note_blocks_revision: revision(paper.blocksRev), total: paper.blocks.length });
    }
    if (method === "POST" && action === "full-text/extract") {
      strict(body, ["force", "ocr", "pages", "provider", "source_pdf_sha256", "expected_pdf_revision", "ocr_pages"], fail);
      if (body.expected_pdf_revision) guard(body.expected_pdf_revision, paper.pdfVersion || 1);
      const blob = await pdfBlob(paper, effects, fail);
      let extraction;
      try { extraction = body.pages ? validatePages(body, fail) : await extractPdfPages(blob, { ocr: body.ocr === true }); }
      catch (error) { if (error.status) throw error; fail(422, error.message || "This PDF could not be extracted. The previous text cache was retained."); }
      const actual = await sha256Blob(blob);
      if (extraction.source_pdf_sha256 !== actual) fail(409, "The extracted pages belong to a different PDF version.");
      paper.pdfSha256 = actual;
      const content = extractedPagesContent(extraction.pages), has_content = extraction.char_count > 0;
      const ocr_pages = extraction.ocr_pages || [], usedOcr = ocr_pages.length > 0;
      paper.fullTextCache = { paper_id: paper.paper_id, state: has_content ? "success" : "ocr_needed", extraction_state: has_content ? "success" : "ocr_needed", source: usedOcr ? "pdf_ocr" : "pdf", provider: usedOcr ? "browser-pdfjs+tesseract" : "browser-pdfjs", provider_version: usedOcr ? "PDF.js 5.7.284 / Tesseract.js 7.0.0" : "5.7.284", content_format: "plain_text", classification: extraction.classification, page_count: extraction.page_count, char_count: extraction.char_count, pages: extraction.pages, ocr_needed_pages: extraction.ocr_needed_pages, ocr_pages, extracted_at: now(), has_content, is_stale: false, can_extract: true, previous_cache_preserved: false, message: usedOcr ? "OCR text was recognized on this device using English and Korean language models. Check it against the PDF; confidence values are not proof of accuracy." : extraction.ocr_needed_pages.length ? "Selectable text extracted where available. Empty pages need OCR; no OCR was performed." : "Selectable PDF text extracted in this browser with PDF.js.", source_pdf_sha256: actual, content };
      return result(paper.fullTextCache);
    }
    if (method === "POST" && action === "metadata/enrichment-preview") {
      strict(body, [], fail);
      let data, source, candidate;
      try {
        const url = paper.metadata.doi ? `https://api.crossref.org/works/${encodeURIComponent(paper.metadata.doi)}` : `https://api.crossref.org/works?rows=1&query.bibliographic=${encodeURIComponent(paper.metadata.title)}`;
        const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error("Crossref lookup failed.");
        const lookup = await response.json(); data = paper.metadata.doi ? lookup.message : lookup.message?.items?.[0]; source = "Crossref";
        if (!data) throw new Error("No metadata candidate was found.");
      } catch {
        try {
          const prefix = (process.env.NEXT_PUBLIC_BANDAL_DEMO_BASE || "/ku-ai").replace(/\/$/, "");
          const response = await fetch(`${prefix}/api/discover?q=${encodeURIComponent(paper.metadata.doi || paper.metadata.title)}&provider=crossref&limit=5`, { signal: AbortSignal.timeout(10000) });
          if (!response.ok) throw new Error("The metadata fallback is unavailable.");
          const match = (await response.json()).items?.[0];
          if (!match || typeof match.title !== "string") throw new Error("No matching metadata candidate was found.");
          source = "Crossref";
          candidate = { title: match.title, authors: Array.isArray(match.authors) ? match.authors.join("; ") : "", year: match.year == null ? "" : String(match.year), journal: match.journal || "", doi: match.doi || "", abstract: typeof match.abstract === "string" ? match.abstract.replace(/<[^>]*>/g, "") : "", keywords: Array.isArray(match.keywords) ? match.keywords.join(", ") : "" };
        } catch { fail(503, "External metadata could not be reached. Existing metadata and drafts were retained; try a DOI or retry the lookup."); }
      }
      candidate ||= { title: data.title?.[0] || "", authors: (data.author || []).map((author) => [author.given, author.family].filter(Boolean).join(" ")).join("; "), year: String(data.published?.["date-parts"]?.[0]?.[0] || data.issued?.["date-parts"]?.[0]?.[0] || ""), journal: data["container-title"]?.[0] || "", doi: data.DOI || "", abstract: typeof data.abstract === "string" ? data.abstract.replace(/<[^>]*>/g, "") : "", keywords: (data.subject || []).join(", ") };
      return result({ paper_id: paper.paper_id, metadata_revision: revision(paper.metadataRev), candidate_sources: [source], fields: Object.entries(candidate).map(([field, candidate_value]) => ({ field, current_value: paper.metadata[field], candidate_value, source, state: !candidate_value ? "unavailable" : candidate_value === paper.metadata[field] ? "unchanged" : paper.metadata[field] ? "conflict" : "available" })), diagnostics: ["Preview only. Check the publication match before explicitly applying selected fields."] });
    }
    if (method === "GET" && action === "tag-candidates") return result(candidateCollection(paper, contract));
    if (method === "POST" && action === "tag-candidates/generate") {
      strict(body, ["reset_rejections"], fail);
      const original = paper.candidates || [], corpus = `${paper.metadata.title}\n${paper.metadata.abstract}\n${paper.metadata.keywords}\n${paper.fullTextCache?.content || paper.fullText}\n${paper.note}\n${paper.blocks.map((block) => `${block.title} ${block.text}`).join("\n")}`;
      const lower = corpus.toLocaleLowerCase(), candidates = [];
      for (const tag of state.tags.filter((tag) => tag.status === "active")) {
        const term = [tag.label, ...tag.aliases, tag.canonical_key].find((value) => value.length >= 2 && lower.includes(value.toLocaleLowerCase()));
        if (!term || paper.tags.includes(tag.canonical_key)) continue;
        const index = lower.indexOf(term.toLocaleLowerCase()), candidate_id = await workspaceRevision(`${paper.paper_id}:${tag.canonical_key}`), prior = original.find((item) => item.candidate_id === candidate_id);
        candidates.push({ candidate_id, tag_text: tag.label, normalized_tag: tag.canonical_key, resolved_canonical: tag.canonical_key, canonical_status: tag.status, category: tag.category, source: "deterministic_browser_rulebook", source_label: "Rulebook text match", matched_text: term, evidence: [{ source: "workspace_text", source_label: "Saved research text", matched_text: term, snippet: corpus.slice(Math.max(0, index - 80), index + 160) }], score: 1, confidence: 0.8, quality: "high", reason: "A maintained canonical label or alias occurs in saved research text. This is a deterministic match, not an AI prediction.", state: prior && !(body.reset_rejections && prior.state === "rejected") ? prior.state : "resolved", generated_kind: "known_canonical" });
      }
      for (const term of paper.metadata.keywords.split(/[;,]/).map((value) => value.trim()).filter((value) => value.length >= 2 && value.length <= 80 && !/^(?:demo|paper|study|research|unknown)$/i.test(value)).slice(0, 20)) {
        if (state.tags.some((tag) => [tag.label, tag.canonical_key, ...tag.aliases].some((value) => value.toLocaleLowerCase() === term.toLocaleLowerCase())) || paper.tags.includes(term)) continue;
        const candidate_id = await workspaceRevision(`${paper.paper_id}:keyword:${term}`), prior = original.find((item) => item.candidate_id === candidate_id);
        candidates.push({ candidate_id, tag_text: term, normalized_tag: term, resolved_canonical: prior?.resolved_canonical || "", canonical_status: prior?.canonical_status || "", category: prior?.category || "other", source: "metadata_keyword", source_label: "Author metadata keyword", matched_text: term, evidence: [{ source: "keywords", source_label: "Saved metadata keywords", matched_text: term, snippet: paper.metadata.keywords.slice(0, 240) }], score: 0.5, confidence: 0.5, quality: "medium", reason: "This saved keyword is not in the maintained vocabulary. Review it and explicitly promote it before using it as a canonical tag; no semantic inference was performed.", state: prior && !(body.reset_rejections && prior.state === "rejected") ? prior.state : "unresolved", generated_kind: "new_candidate" });
      }
      paper.candidates = candidates; paper.reviewRev = (paper.reviewRev || 1) + 1;
      return result(candidateCollection(paper, contract));
    }
    if (method === "POST" && parts[2] === "tag-candidates" && parts.length === 5) {
      const operation = parts[4];
      strict(body, ["expected_review_revision", "expected_tags_revision", "category"], fail); guard(body.expected_review_revision, paper.reviewRev || 1);
      const candidate = paper.candidates?.find((item) => item.candidate_id === parts[3]);
      if (!candidate) fail(404, "Tag candidate not found.");
      if (!["approve", "reject", "promote", "apply"].includes(operation)) fail(422, "Unknown candidate review action.");
      if (candidate.state === "applied" && operation !== "apply") fail(409, "An applied candidate cannot be reviewed again.");
      if (operation === "approve") { if (!candidate.resolved_canonical) fail(409, "Promote or resolve this keyword before approving it as a canonical tag."); candidate.state = "approved"; }
      if (operation === "reject") candidate.state = "rejected";
      if (operation === "promote") {
        if (candidate.resolved_canonical) fail(409, "This candidate is already a canonical tag; approve and apply it instead.");
        const tag = { canonical_key: `tag-${uuid()}`, label: candidate.tag_text, category: body.category || "other", description: "Promoted from an explicitly reviewed candidate.", aliases: [], status: "active", suggestion_strength: 1 };
        state.tags.push(tag); state.registryRev += 1; candidate.resolved_canonical = tag.canonical_key; candidate.canonical_status = "active"; candidate.category = tag.category; candidate.state = "resolved";
      }
      paper.reviewRev = (paper.reviewRev || 1) + 1;
      if (operation === "apply") {
        guard(body.expected_tags_revision, paper.tagsRev);
        if (!["approved", "applied"].includes(candidate.state) || !candidate.resolved_canonical) fail(409, "Approve a resolved canonical candidate before applying it.");
        if (!paper.tags.includes(candidate.resolved_canonical)) { if (paper.tags.length >= 25) fail(422, "Paper tag limit reached."); paper.tags.push(candidate.resolved_canonical); paper.tagsRev += 1; if (paper.noteExists) paper.note = contract.canonicalNote(paper.note, paper); }
        candidate.state = "applied";
        return result({ candidate, review_revision: revision(paper.reviewRev), paper_tag: { status: "saved", tags: [...paper.tags], tags_revision: revision(paper.tagsRev), note_header_status: paper.noteExists ? "updated" : "not_present", canonical_note_header: contract.header(paper), canonical_note_header_text: contract.headerText(paper), reading_note: await contract.persistedNote(paper) } });
      }
      return result(candidateCollection(paper, contract));
    }
  }
  if (parts[0] === "projects" && parts.length >= 2) {
    const project = state.projects.find((project) => project.project_id === parts[1]);
    if (!project) return { handled: false };
    if (method === "POST" && parts.length === 3 && parts[2] === "unarchive") {
      strict(body, ["expected_revision", "confirm"], fail); guard(body.expected_revision, project.projectRev);
      if (body.confirm !== true) fail(422, "Restoring visibility requires explicit confirmation.");
      if (project.status === "archived") { project.status = "active"; project.projectRev += 1; project.updated_at = now(); }
      return result({ status: "saved", project: contract.projectState(project) });
    }
    if (method === "DELETE" && parts.length === 2) {
      strict(body, ["expected_revision", "confirm"], fail); guard(body.expected_revision, project.projectRev);
      if (body.confirm !== true) fail(422, "Project deletion requires explicit confirmation.");
      state.deletedProjects = [...(state.deletedProjects || []), { ...project, deleted_at: now() }].slice(-100);
      state.projects = state.projects.filter((row) => row.project_id !== project.project_id);
      return result({ status: "deleted", project_id: project.project_id });
    }
    if (method === "PATCH" && parts.length === 4 && ["paper-links", "note-block-links"].includes(parts[2])) {
      strict(body, ["changes", "expected_links_revision"], fail); guard(body.expected_links_revision, project.linksRev);
      strict(body.changes, ["link_type"], fail);
      const link = project.links.find((link) => link.link_id === parts[3]);
      if (!link) fail(404, "Project link not found.");
      if (!["related", "background", "key_reference", "supports_project", "raises_question", "idea_for_project"].includes(body.changes.link_type)) fail(422, "Invalid relationship type.");
      if (project.links.some((other) => other !== link && other.target_type === link.target_type && other.target_id === link.target_id && other.link_type === body.changes.link_type)) fail(409, "That relationship already exists.");
      if (link.link_type !== body.changes.link_type) { link.link_type = body.changes.link_type; project.linksRev += 1; project.updated_at = now(); }
      return result({ status: "saved", project: contract.projectState(project), link: { link_id: link.link_id, project_id: project.project_id, paper_id: link.paper_id, link_type: link.link_type, created_at: link.created_at, ...(link.target_type === "note_block" ? { note_block_id: link.target_id } : {}) } });
    }
  }
  return { handled: false };
}
