import { DEMO_PAPERS, DEMO_TAGS } from "./seed.mjs";
import { cachedBrowserPdfUrl, configureBrowserWorkspace, getBrowserWorkspaceStorage, getBrowserPdfRecord, cacheBrowserPdfUrl, revokeBrowserPdfUrl } from "./browser-storage.mjs";
import { handleBrowserCommand, validateBrowserPaper, validatePdfProvenance } from "./browser-commands.mjs";
import { getProjectExplorationState, saveProjectExplorationState, validateExploration, explorationRevision } from "../exploration/model.mjs";
import { getReviewDossier, reviewRevision } from "../review/model.mjs";
import { getProjectReview, saveProjectReview, freezeProjectReview } from "../../../../hosting/domain/review.mjs";
import { createResearchPagesStore, RESEARCH_PAGES_KEY } from "../workspace/pages.mjs";
import { prepareAiSources } from "../ai/sources.mjs";

export const DEMO_STORAGE_KEY = "bandal.blueprint.demo.workspace.v1";
const VERSION = 1;
const STAMP = "2026-10-13T15:12:18.000Z";
const BLOCK_TYPES = ["summary", "claim", "method", "evidence", "question", "idea", "limitation"];
const LINK_TYPES = ["related", "background", "key_reference", "supports_project", "raises_question", "idea_for_project"];
const METADATA_LIMITS = { title: 1000, authors: 5000, year: 4, journal: 1000, doi: 2048, abstract: 100000, keywords: 10000 };
const BLOCK_LIMITS = { title: 1000, text: 100000, page: 100, figure: 500, quote: 100000 };
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();

class DemoFailure extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function fail(status, message) { throw new DemoFailure(status, message); }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function strict(value, keys) {
  if (!object(value) || Object.keys(value).some((key) => !keys.includes(key))) fail(422, "Unknown or invalid command fields.");
}
function textField(value, max, required = false) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim()) || value.includes("\u0000")) fail(422, "A text field is empty, too large, or invalid.");
  return value;
}
function choice(value, options) {
  if (!options.includes(value)) fail(422, "A submitted state is not supported.");
  return value;
}
function boundedTags(value) {
  if (!Array.isArray(value) || value.length > 25) fail(422, "Tags must be a bounded list.");
  return [...new Set(value.map((tag) => textField(tag, 100, true).trim()))];
}
function revision(value) { return Number(value).toString(16).padStart(64, "0"); }
function guard(expected, value) {
  if (typeof expected !== "string" || !HASH_PATTERN.test(expected)) fail(422, "An expected revision is required.");
  if (expected !== revision(value)) fail(409, "The saved version changed. Reload the current version before retrying.");
}
function id() { return globalThis.crypto.randomUUID(); }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
async function hash(value) {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function reply(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Bandal-Demo": "browser-local" } });
}
function header(paper) {
  return { template_version: "1.0", paper_id: paper.paper_id, title: paper.metadata.title, doi: paper.metadata.doi, arxiv_id: "", year: paper.metadata.year, first_author: authors(paper)[0] || "", tags: paper.tags.join(", ") };
}
function headerText(paper) {
  const values = header(paper);
  return `# BluePrint Reading Note\n\n${Object.entries(values).map(([key, value]) => `${key}: ${String(value).replace(/[\r\n]/g, " ")}`).join("\n")}\n`;
}
function canonicalNote(content, paper) {
  const recognized = /^\s*# BluePrint (?:External )?Reading Note[^\r\n]*\r?\n/.exec(content);
  if (!recognized) return textField(`${headerText(paper)}\n${content}`, 2000000);
  let offset = recognized[0].length;
  const seenFields = new Set();
  // Only consume known header fields and separators. Unstructured note bodies
  // without Markdown sections remain intact after a metadata refresh.
  while (offset < content.length) {
    const line = /^(?:\r?\n|(?<field>template_version|paper_id|title|doi|arxiv_id|year|first_author|tags):[^\r\n]*(?:\r?\n|$))/.exec(content.slice(offset));
    if (!line) break;
    if (line.groups?.field && seenFields.has(line.groups.field)) break;
    offset += line[0].length;
    if (line.groups?.field) seenFields.add(line.groups.field);
    else if (seenFields.size) break;
  }
  const body = content.slice(offset);
  return textField(`${headerText(paper)}\n${body}`, 2000000);
}
function authors(paper) { return paper.metadata.authors.split(/[;,]/).map((part) => part.trim()).filter(Boolean); }

export function createDemoSeed() {
  const papers = DEMO_PAPERS.map((sample) => {
    const metadata = Object.fromEntries(Object.keys(METADATA_LIMITS).map((key) => [key, sample[key]]));
    const paper = { paper_id: sample.paper_id, metadata, tags: [...sample.tags], status: sample.status, priority: sample.priority, archived: false, metadataRev: 1, tagsRev: 1, statusRev: 1, lifecycleRev: 1, blocksRev: 1, fullText: sample.fullText, note: "", noteExists: true, blocks: [{ id: `block-${sample.paper_id}`, paper_id: sample.paper_id, title: "", text: "", page: "", figure: "", quote: "", tags: [], ...sample.block, created_at: STAMP, updated_at: STAMP }] };
    paper.note = canonicalNote(sample.note, paper);
    return paper;
  });
  const projects = [
    { project_id: "demo-storage", name: "[Demo] Subsurface screening", description: "An authored sample Project linking CCS and seismic reading. Edit this browser copy to prepare a KU-AI demonstration.", status: "active", priority: "high", tags: ["ccs", "reservoir"], created_at: STAMP, updated_at: STAMP, projectRev: 1, linksRev: 1, links: [{ link_id: "demo-link-ccs", target_type: "paper", target_id: "demo-ccs", paper_id: "demo-ccs", link_type: "key_reference", created_at: STAMP }, { link_id: "demo-link-seismic", target_type: "paper", target_id: "demo-seismic", paper_id: "demo-seismic", link_type: "background", created_at: STAMP }] },
    { project_id: "demo-detector", name: "[Demo] Muon detector notebook", description: "A fictional detector study for practicing Paper, Note Block and Project links. No real experimental results are included.", status: "active", priority: "normal", tags: ["muon", "tomography"], created_at: STAMP, updated_at: STAMP, projectRev: 1, linksRev: 1, links: [{ link_id: "demo-link-muon", target_type: "paper", target_id: "demo-muon", paper_id: "demo-muon", link_type: "related", created_at: STAMP }, { link_id: "demo-link-block-muon", target_type: "note_block", target_id: "block-demo-muon", paper_id: "demo-muon", link_type: "supports_project", created_at: STAMP }] },
  ];
  return { version: VERSION, papers, projects, tags: structuredClone(DEMO_TAGS), registryRev: 1 };
}

function validateMetadata(changes, partial = true) {
  strict(changes, Object.keys(METADATA_LIMITS));
  if (partial && !Object.keys(changes).length) fail(422, "At least one metadata change is required.");
  const result = {};
  for (const [key, value] of Object.entries(changes)) result[key] = textField(value, METADATA_LIMITS[key]);
  if ("year" in result && result.year.trim() && (!/^\d{4}$/.test(result.year.trim()) || Number(result.year) < 1000 || Number(result.year) > 2100)) fail(422, "Year must be a reasonable four-digit year.");
  if ("doi" in result) {
    result.doi = result.doi.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
    if (result.doi && !/^10\.\d{4,9}\/\S+$/i.test(result.doi)) fail(422, "DOI is not valid.");
  }
  return result;
}
function validateProject(input, partial = false) {
  strict(input, ["name", "description", "status", "priority", "tags"]);
  if (partial && !Object.keys(input).length) fail(422, "At least one Project change is required.");
  const output = partial ? {} : { description: "", status: "active", priority: "normal", tags: [] };
  if (!partial || "name" in input) output.name = textField(input.name, 200, true).trim();
  if ("description" in input) output.description = textField(input.description, 5000);
  if ("status" in input) output.status = choice(input.status, ["active", "paused", "done"]);
  if ("priority" in input) output.priority = choice(input.priority, ["low", "normal", "high"]);
  if ("tags" in input) output.tags = boundedTags(input.tags);
  return output;
}
function validateBlock(input, partial = false) {
  strict(input, ["block_type", ...Object.keys(BLOCK_LIMITS), "tags", "provenance"]);
  if (partial && !Object.keys(input).length) fail(422, "At least one Note Block change is required.");
  const output = partial ? {} : { title: "", text: "", page: "", figure: "", quote: "", tags: [] };
  if (!partial || "block_type" in input) output.block_type = choice(input.block_type, BLOCK_TYPES);
  for (const [key, max] of Object.entries(BLOCK_LIMITS)) if (key in input) output[key] = textField(input[key], max);
  if ("tags" in input) output.tags = boundedTags(input.tags);
  if ("provenance" in input) { try { output.provenance = validatePdfProvenance(input.provenance); } catch (error) { fail(422, error.message); } }
  return output;
}
function validateTag(input, partial = false) {
  strict(input, ["label", "category", "description", "suggestion_strength"]);
  if (partial && !Object.keys(input).length) fail(422, "At least one tag change is required.");
  const output = partial ? {} : { description: "", suggestion_strength: 1 };
  if (!partial || "label" in input) output.label = textField(input.label, 200, true).trim();
  if (!partial || "category" in input) output.category = textField(input.category, 100, true).trim();
  if ("description" in input) output.description = textField(input.description, 2000);
  if ("suggestion_strength" in input) {
    if (!Number.isInteger(input.suggestion_strength) || input.suggestion_strength < 0 || input.suggestion_strength > 100) fail(422, "Tag strength must be an integer between 0 and 100.");
    output.suggestion_strength = input.suggestion_strength;
  }
  return output;
}
function counter(value) { return Number.isSafeInteger(value) && value > 0; }
function validateState(state) {
  try {
    if (!object(state) || state.version !== VERSION || !Array.isArray(state.papers) || !Array.isArray(state.projects) || !Array.isArray(state.tags) || !counter(state.registryRev) || state.papers.length > 1000 || state.projects.length > 1000 || state.tags.length > 1000) throw new Error();
    const unique = (rows, key) => rows.every((row) => object(row) && typeof row[key] === "string" && /^[a-z0-9-]{1,100}$/.test(row[key])) && new Set(rows.map((row) => row[key])).size === rows.length;
    if (!unique(state.papers, "paper_id") || !unique(state.projects, "project_id") || !unique(state.tags, "canonical_key")) throw new Error();
    for (const paper of state.papers) {
      if (!validateBrowserPaper(paper) || typeof paper.archived !== "boolean" || typeof paper.noteExists !== "boolean" || ![paper.metadataRev, paper.tagsRev, paper.statusRev, paper.lifecycleRev, paper.blocksRev].every(counter) || !Array.isArray(paper.blocks) || paper.blocks.length > 1000 || !unique(paper.blocks, "id")) throw new Error();
      validateMetadata(paper.metadata, false);
      if (Object.keys(paper.metadata).length !== Object.keys(METADATA_LIMITS).length) throw new Error();
      boundedTags(paper.tags); choice(paper.status, ["unread", "reading", "read", "finished"]); choice(paper.priority, ["low", "normal", "high"]); textField(paper.note, 2000000); textField(paper.fullText, 2000000);
      for (const block of paper.blocks) {
        if (block.paper_id !== paper.paper_id || typeof block.created_at !== "string" || typeof block.updated_at !== "string") throw new Error();
        validateBlock(Object.fromEntries(["block_type", ...Object.keys(BLOCK_LIMITS), "tags"].map((key) => [key, block[key]])));
        if (block.provenance) validatePdfProvenance(block.provenance);
      }
    }
    for (const project of state.projects) {
      if (project.researchTrail !== undefined) validateExploration(project.researchTrail);
      explorationRevision(project); getReviewDossier(project); reviewRevision(project);
      validateProject({ name: project.name, description: project.description, status: project.status === "archived" ? "active" : project.status, priority: project.priority, tags: project.tags });
      choice(project.status, ["active", "paused", "done", "archived"]);
      if (!counter(project.projectRev) || !counter(project.linksRev) || !Array.isArray(project.links) || project.links.length > 1000 || !unique(project.links, "link_id") || typeof project.created_at !== "string" || typeof project.updated_at !== "string") throw new Error();
      for (const link of project.links) {
        choice(link.link_type, LINK_TYPES); choice(link.target_type, ["paper", "note_block"]);
        if (typeof link.target_id !== "string" || typeof link.paper_id !== "string" || typeof link.created_at !== "string" || !state.papers.some((paper) => paper.paper_id === link.paper_id && (link.target_type === "paper" ? link.target_id === paper.paper_id : paper.blocks.some((block) => block.id === link.target_id)))) throw new Error();
      }
    }
    for (const tag of state.tags) {
      validateTag({ label: tag.label, category: tag.category, description: tag.description, suggestion_strength: tag.suggestion_strength });
      choice(tag.status, ["active", "deprecated"]);
      if (!Array.isArray(tag.aliases) || tag.aliases.length > 100) throw new Error();
      tag.aliases.forEach((alias) => textField(alias, 200, true));
    }
    return state;
  } catch {
    fail(503, "The saved browser demo workspace is unreadable. It has been preserved; no reset was performed.");
  }
}
function listItem(paper) {
  return { paper_id: paper.paper_id, title: paper.metadata.title, first_author: authors(paper)[0] || "", year: paper.metadata.year, status: paper.status, priority: paper.priority, tags: [...paper.tags], archived: paper.archived, missing_pdf: Boolean(paper.pdfMissing), health: paper.pdfMissing ? ["missing_pdf"] : [] };
}
function paperDetail(paper, state) {
  return { ...listItem(paper), authors: authors(paper), journal: paper.metadata.journal, abstract: paper.metadata.abstract, keywords: paper.metadata.keywords.split(/[;,]/).map((part) => part.trim()).filter(Boolean), arxiv_id: "", filename: paper.filename || `${paper.paper_id}.pdf`, relative_pdf_path: paper.pdfMissing ? "" : paper.pdfId || `bandal-demo/${paper.paper_id}.pdf`, doi: paper.metadata.doi, project_links: state.projects.flatMap((project) => project.links.filter((link) => link.paper_id === paper.paper_id && link.target_type === "paper").map((link) => ({ project_id: project.project_id, link_type: link.link_type, target_type: link.target_type }))), note_available: paper.noteExists, extracted_text_available: Boolean(paper.fullText || paper.fullTextCache?.content), profile_available: false, lifecycle_state: paper.archived ? "archived" : "active", recoverable_warnings: paper.pdfMissing ? ["missing_pdf"] : [], reading_status_revision: revision(paper.statusRev), pdf_revision: revision(paper.pdfVersion || 1), priority_revision: revision(paper.priorityRev || 1), lifecycle_revision: revision(paper.lifecycleRev) };
}
async function persistedNote(paper) {
  return { exists: paper.noteExists, content: paper.note, sha256: await hash(paper.note), size_bytes: encoder.encode(paper.note).byteLength };
}
async function reader(paper, state) {
  const note = await persistedNote(paper);
  return { paper: paperDetail(paper, state), editable_metadata: { ...paper.metadata }, metadata_revision: revision(paper.metadataRev), tags_revision: revision(paper.tagsRev), pdf_state: paper.pdfMissing ? "missing" : "available", saved_note_available: note.exists, saved_note_content: note.content, canonical_note_header: header(paper), saved_note_baseline: { exists: note.exists, sha256: note.sha256, size_bytes: note.size_bytes }, warnings: ["Browser workspace. Saved changes stay on this device until exported; they are not synced to GitHub."], unavailable_reason: paper.pdfMissing ? "This Paper's PDF attachment is missing. Saved notes and recovery copies are retained." : "" };
}
function projectItem(project) {
  return { project_id: project.project_id, name: project.name, description: project.description, status: project.status, priority: project.priority, tags: [...project.tags], created_at: project.created_at, updated_at: project.updated_at, project_revision: revision(project.projectRev), link_count: project.links.length, linked_paper_count: project.links.filter((link) => link.target_type === "paper").length, linked_note_block_count: project.links.filter((link) => link.target_type === "note_block").length };
}
function projectState(project) { return { ...projectItem(project), links_revision: revision(project.linksRev) }; }
function page(items, params, prefix = "") {
  const rawLimit = params.get(`${prefix}limit`) ?? "20";
  const rawOffset = params.get(`${prefix}offset`) ?? "0";
  if (!/^\d+$/.test(rawLimit) || !/^\d+$/.test(rawOffset)) fail(422, "Pagination must use non-negative integers.");
  const limit = Number(rawLimit), offset = Number(rawOffset);
  if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(offset) || limit < 1 || limit > 100) fail(422, "Pagination is outside the allowed range.");
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset, has_more: offset + limit < items.length };
}
function linkTarget(link, state) {
  const paper = state.papers.find((row) => row.paper_id === link.paper_id);
  const block = paper?.blocks.find((row) => row.id === link.target_id);
  const summary = listItem(paper);
  return { ...link, target_state: "available", paper: link.target_type === "paper" ? { paper_id: summary.paper_id, title: summary.title, first_author: summary.first_author, year: summary.year, status: summary.status, priority: summary.priority, tags: summary.tags, archived: summary.archived } : null, note_block: link.target_type === "note_block" ? { block_id: block.id, paper_id: paper.paper_id, source_paper_title: paper.metadata.title, block_type: block.block_type, title: block.title, text_preview: block.text.slice(0, 300), page: block.page, figure: block.figure, tags: [...block.tags] } : null };
}
function projectDetail(project, state, params) {
  const pagination = page(project.links.map((link) => linkTarget(link, state)), params, "links_");
  return { ...projectItem(project), links: pagination.items, links_total: pagination.total, links_limit: pagination.limit, links_offset: pagination.offset, links_has_more: pagination.has_more, links_revision: revision(project.linksRev), orphaned_link_count: 0 };
}
function noteBlocks(paper, state) {
  return { source_paper: { paper_id: paper.paper_id, title: paper.metadata.title }, items: structuredClone(paper.blocks), total: paper.blocks.length, note_blocks_revision: revision(paper.blocksRev), project_links_state: "available", project_links: state.projects.flatMap((project) => project.links.filter((link) => link.target_type === "note_block" && link.paper_id === paper.paper_id).map((link) => ({ link_id: link.link_id, project_id: project.project_id, project_name: project.name, project_status: project.status, note_block_id: link.target_id, link_type: link.link_type, links_revision: revision(project.linksRev) }))) };
}
function fullText(paper, includeContent) {
  if (paper.fullTextCache) return { ...paper.fullTextCache, state: paper.fullTextCache.source_pdf_sha256 && paper.pdfSha256 !== paper.fullTextCache.source_pdf_sha256 ? "stale" : paper.fullTextCache.state, is_stale: Boolean(paper.fullTextCache.source_pdf_sha256 && paper.pdfSha256 !== paper.fullTextCache.source_pdf_sha256), can_extract: !paper.pdfMissing, ...(includeContent ? {} : { content: undefined }) };
  if (!paper.fullText) return { paper_id: paper.paper_id, state: "not_extracted", extraction_state: "not_extracted", source: "", provider: "", provider_version: "", content_format: "plain_text", classification: "unknown", page_count: 0, char_count: 0, ocr_needed_pages: [], extracted_at: "", has_content: false, is_stale: false, can_extract: !paper.pdfMissing, previous_cache_preserved: false, message: "Extract selectable text from this PDF, then optionally run on-device English and Korean OCR for scanned pages.", ...(includeContent ? { content: "" } : {}) };
  return { paper_id: paper.paper_id, state: "cached", extraction_state: "success", source: "authored_demo", provider: "BANDAL sample text", provider_version: "1", content_format: "plain_text", classification: "text", page_count: 2, char_count: paper.fullText.length, ocr_needed_pages: [], extracted_at: STAMP, has_content: true, is_stale: false, can_extract: !paper.pdfMissing, previous_cache_preserved: false, message: "Authored sample text supplied with this example PDF. Use Extract to read selectable text from the actual PDF; no OCR or AI is performed.", ...(includeContent ? { content: paper.fullText } : {}) };
}
function health(state) { const missing = state.papers.filter((paper) => paper.pdfMissing).length; return { overall_state: missing ? "degraded" : "healthy", blocking_issues: 0, warning_count: missing, corrupt_critical_state_count: 0, quarantine_count: 0, missing_pdf_count: missing, duplicate_review_count: 0 }; }
function library(state) { const missing = state.papers.filter((paper) => paper.pdfMissing).length; return { active_count: state.papers.filter((paper) => !paper.archived).length, archived_count: state.papers.filter((paper) => paper.archived).length, missing_count: missing, duplicate_count: 0, corrupt_count: 0, quarantine_count: 0, degraded: Boolean(missing), workspace_warnings: missing ? ["Some PDF attachments are missing. Notes are retained; use recovery/reconnect."] : [] }; }
function settings(state) {
  const resources = [
    ["papers", "PDF Library", state.papers.length], ["notes", "Saved Paper Notes", state.papers.filter((paper) => paper.noteExists).length], ["projects", "Projects", state.projects.length], ["tags", "Canonical tags", state.tags.length], ["note_blocks", "Note Blocks", state.papers.reduce((total, paper) => total + paper.blocks.length, 0)], ["project_links", "Project links", state.projects.reduce((total, project) => total + project.links.length, 0)], ["tag_candidate_reviews", "Candidate reviews", state.papers.reduce((total, paper) => total + (paper.candidates?.length || 0), 0)],
  ].map(([code, label, count]) => ({ code, label, count, state: count ? "healthy" : "empty", summary: "This browser's private research workspace." }));
  const missing = state.papers.filter((paper) => paper.pdfMissing).length;
  return { application: { state: "healthy", product_version: "1.6.5 · 랩비움", api_state: "available", api_contract_version: "browser-workspace-v1", summary: "Browser workspace with IndexedDB storage. GitHub holds application code, not your research data." }, workspace: { state: "healthy", resources, summary: "Explicit saves and PDFs persist on this device. Sign-in cloud workspaces remain separate; browser data is not automatically synchronized." }, data_integrity: { state: missing ? "warning" : "healthy", issues: missing ? [{ code: "missing_pdfs", state: "warning", count: missing, severity: "warning", explanation: "Some Paper attachments have been removed; research notes are retained.", next_action: "Use Maintenance to reconnect a verified recovery copy or select the same PDF again." }] : [], summary: "Saved research metadata passed schema validation. PDF checksums are verified during upload, reconnect and backup export." }, backup_readiness: { state: "warning", snapshot_available: false, last_updated_at: null, summary: "Use Maintenance to export a complete backup, including PDF bytes. Clearing site data removes this device's workspace. Browser storage is not an external backup." } };
}

/** PDF assets have a bounded stable allowlist, never a user-supplied path. */
export function demoPdfUrl(paperId) {
  if (cachedBrowserPdfUrl(paperId)) return cachedBrowserPdfUrl(paperId);
  return DEMO_PAPERS.some((paper) => paper.paper_id === paperId) ? `/bandal-demo/${paperId}.pdf` : "";
}
export function isDemoEnabled() { return process.env.NEXT_PUBLIC_BANDAL_DEMO === "1"; }

/** A factory makes the persistence boundary deterministic in tests. */
export function createDemoAdapter(storageProvider = getBrowserWorkspaceStorage) {
  let pending = Promise.resolve();
  return function request(path, init = {}) {
    const next = pending.then(() => {
      const locks = globalThis.navigator?.locks;
      const reviewWrite = (init.method || "GET").toUpperCase() !== "GET" && /^\/projects\/[^/?]+\/review(?:\/freeze)?\/?(?:\?|$)/.test(path);
      const run = (pagesLocked = false) => locks?.request ? locks.request("labvium:browser-workspace", () => execute(path, init, pagesLocked)) : execute(path, init, pagesLocked);
      // Lock order is pages, then core: backups/page commands also enter the
      // page lock before reading core state. Hold it through the IDB CAS.
      return reviewWrite && locks?.request ? locks.request("labvium:research-pages", { mode: "exclusive", ...(init.signal ? { signal: init.signal } : {}) }, () => run(true)) : run();
    });
    pending = next.catch(() => undefined);
    return next;
  };

  async function execute(path, init, reviewPagesLocked = false) {
    try {
      if (init.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      let storage;
      try { storage = await (typeof storageProvider === "function" ? storageProvider() : storageProvider); }
      catch { fail(503, "Browser storage is unavailable. Enable site storage to use this isolated demo."); }
      if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") fail(503, "Browser storage is unavailable.");
      let original;
      try { original = await storage.getItem(DEMO_STORAGE_KEY); }
      catch { fail(503, "The saved browser demo workspace could not be read."); }
      let state;
      if (original === null) {
        state = createDemoSeed();
        try { if (storage.compareAndSet) await storage.compareAndSet(DEMO_STORAGE_KEY, null, JSON.stringify(state), {}); else await storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state)); original = await storage.getItem(DEMO_STORAGE_KEY); state = validateState(JSON.parse(original)); }
        catch { fail(503, "The demo workspace could not be saved. Check browser storage availability and quota."); }
      } else {
        try { state = validateState(JSON.parse(original)); }
        catch (error) { if (error instanceof DemoFailure) throw error; fail(503, "The saved browser demo workspace is unreadable. It has been preserved; no reset was performed."); }
      }
      const url = new URL(path, "https://bandal-demo.invalid");
      if (url.origin !== "https://bandal-demo.invalid" || !url.pathname.startsWith("/")) fail(422, "Invalid demo API path.");
      const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
      const method = (init.method || "GET").toUpperCase();
      let body = {};
      if (typeof FormData !== "undefined" && init.body instanceof FormData && parts[0] === "papers" && parts[1] === "upload") body = init.body;
      else if (init.body !== undefined && init.body !== null) {
        const commandLimit = parts[0] === "projects" && parts.length === 3 && parts[2] === "exploration" && method === "PUT" ? 8 * 1024 * 1024 : 2500000;
        if (typeof init.body !== "string" || encoder.encode(init.body).byteLength > commandLimit) {
          if (parts[0] === "papers" && parts[1] === "upload") fail(501, "PDF upload is unavailable in this browser demo. Use the three authored sample PDFs, or run the original app with its local Python backend.");
          fail(422, "Demo commands require a bounded JSON body.");
        }
        try { body = JSON.parse(init.body); } catch { fail(422, "The command body is not valid JSON."); }
        if (!object(body)) fail(422, "The command body must be an object.");
      }
      const before = JSON.stringify(state);
      const effects = { putFiles: [], deleteFiles: [], revokedPaperIds: [] };
      const reviewWrite = parts[0] === "projects" && parts[2] === "review" && method !== "GET";
      const pagesRaw = reviewWrite ? window.localStorage.getItem(RESEARCH_PAGES_KEY) : null;
      if (reviewWrite && !reviewPagesLocked && method === "POST" && parts[3] === "freeze") {
        const project = state.projects.find((row) => row.project_id === parts[1]);
        if (project?.reviewDossier?.rows.some((row) => row.source_links.some((source) => source.kind === "research_page"))) fail(503, "This browser cannot safely freeze research-page evidence across tabs. Use a browser with Web Locks support or an account workspace. Your saved review remains unchanged.");
      }
      const output = await route(parts, method, body, url.searchParams, state, effects);
      if (init.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      if (JSON.stringify(state) !== before) {
        // Preserve newer work if another tab saves during async SHA-256 work.
        try {
          const serialized = JSON.stringify(state);
          // Without Web Locks this synchronous check protects ordinary draft
          // saves from observed page edits; page-backed freezing is refused
          // above because localStorage and the IDB CAS cannot be one atomic
          // transaction. Never describe that fallback as an atomic freeze.
          if (reviewWrite && window.localStorage.getItem(RESEARCH_PAGES_KEY) !== pagesRaw) fail(409, "Research pages changed while reviewing. Reload the sources before saving or freezing.");
          if (storage.compareAndSet) {
            if (!await storage.compareAndSet(DEMO_STORAGE_KEY, original, serialized, effects)) fail(409, "The browser workspace changed in another tab. Reload before saving.");
          } else {
            if (await storage.getItem(DEMO_STORAGE_KEY) !== original) fail(409, "The browser workspace changed in another tab. Reload before saving.");
            if (effects.putFiles.length || effects.deleteFiles.length) fail(503, "PDF writes require IndexedDB transaction support.");
            await storage.setItem(DEMO_STORAGE_KEY, serialized);
          }
          if (await storage.getItem(DEMO_STORAGE_KEY) !== serialized) fail(503, "Browser storage did not confirm the save.");
        } catch (error) {
          if (error instanceof DemoFailure) throw error;
          fail(503, "The demo change could not be saved. The previously saved workspace has been retained.");
        }
      }
      for (const paperId of effects.revokedPaperIds) revokeBrowserPdfUrl(paperId);
      for (const file of effects.putFiles.filter((file) => file.kind === "active")) cacheBrowserPdfUrl(file.paper_id, file.blob, file.sha256);
      if (storage.compareAndSet) for (const paper of state.papers) if (paper.pdfId && !paper.pdfMissing && !cachedBrowserPdfUrl(paper.paper_id)) {
        const file = await getBrowserPdfRecord(paper.pdfId);
        if (file) cacheBrowserPdfUrl(paper.paper_id, file.blob, file.sha256);
      }
      if (JSON.stringify(state) !== before) globalThis.dispatchEvent?.(new Event("labvium:workspace-changed"));
      return reply(output);
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      if (error instanceof DemoFailure) return reply({ detail: error.message }, error.status);
      return reply({ detail: "The browser demo could not complete this operation. Your saved workspace has not been reset." }, 503);
    }
  }
}

async function route(parts, method, body, params, state, effects) {
  if (parts.join("/") === "ai/sources" && method === "GET") {
    try { return await prepareAiSources(state, { question: params.get("q") || "", ...(params.get("project_id") ? { project_id: params.get("project_id") } : { paper_ids: (params.get("paper_ids") || "").split(",").filter(Boolean) }) }); }
    catch (error) { fail(Number.isInteger(error.status) ? error.status : 503, error.message); }
  }
  if (parts[0] === "projects" && parts.length >= 3 && ["exploration", "review"].includes(parts[2])) {
    try {
      if (parts[2] === "exploration" && parts.length === 3) {
        if (method === "GET") return getProjectExplorationState(state, parts[1]);
        if (method === "PUT") return saveProjectExplorationState(state, parts[1], body);
      }
      if (parts[2] === "review") {
        const reviewState = { ...state, researchPages: createResearchPagesStore().list().items };
        if (parts.length === 3 && method === "GET") return await getProjectReview(reviewState, parts[1]);
        if (parts.length === 3 && method === "PUT") return await saveProjectReview(reviewState, parts[1], body);
        if (parts.length === 4 && parts[3] === "freeze" && method === "POST") return await freezeProjectReview(reviewState, parts[1], body);
      }
      fail(405, "Unsupported project research command.");
    } catch (error) { fail(Number.isInteger(error.status) ? error.status : 503, error.message || "The project research operation failed. Saved data was preserved."); }
  }
  const handled = await handleBrowserCommand(parts, method, body, params, state, effects, { fail, guard, revision, canonicalNote, persistedNote, header, headerText, fullText, paperDetail, projectState, noteBlocks });
  if (handled.handled) return handled.value;
  const path = parts.join("/");
  if (method === "GET") {
    if (path === "health") return health(state);
    if (path === "library/status") return library(state);
    if (path === "settings/summary") return settings(state);
    if (path === "papers") {
      const archive = choice(params.get("archive_status") || "active", ["active", "archived", "all"]);
      const q = (params.get("q") || "").toLowerCase();
      const items = state.papers.filter((paper) => (archive === "all" || paper.archived === (archive === "archived")) && (!params.get("tag") || paper.tags.includes(params.get("tag"))) && (!params.get("year") || paper.metadata.year === params.get("year")) && (!params.get("status") || paper.status === params.get("status")) && (!q || `${paper.metadata.title} ${paper.metadata.authors} ${paper.metadata.abstract} ${paper.tags.join(" ")}`.toLowerCase().includes(q))).map(listItem);
      return page(items, params);
    }
    if (path === "projects") return page(state.projects.map(projectItem), params);
    if (path === "tags") return { ...page(state.tags.map((tag) => ({ canonical_key: tag.canonical_key, label: tag.label, category: tag.category, aliases: [...tag.aliases], status: tag.status, suggestion_strength: tag.suggestion_strength })), params), source_state: "canonical" };
    if (path === "tags/governance") return { items: structuredClone(state.tags), registry_revision: revision(state.registryRev) };
    if (path === "tags/summary") return { availability: "available", state: "empty", source: "none", evaluated_paper_count: 0, candidate_count: 0, known_canonical_match_count: 0, quality_counts: { high: 0, medium: 0, weak: 0, rejected: 0 } };
    if (path === "tags/review-queue") return page([], params);
    if (parts[0] === "projects" && parts.length === 2) {
      const project = state.projects.find((row) => row.project_id === parts[1]);
      if (!project) fail(404, "Project not found.");
      return projectDetail(project, state, params);
    }
  }
  if (parts[0] === "papers" && ["scan", "import", "upload", "reconnect"].includes(parts[1])) fail(501, "Local PDF scanning, import, upload and reconnect require the original app's Python filesystem backend. This demo uses three authored sample PDFs.");
  if (parts[0] === "papers" && parts.length >= 2) {
    const paper = state.papers.find((row) => row.paper_id === parts[1]);
    if (!paper) fail(404, "Paper not found.");
    const action = parts.slice(2).join("/");
    if (method === "GET") {
      if (!action) return paperDetail(paper, state);
      if (action === "reader") return reader(paper, state);
      if (action === "full-text") return fullText(paper, true);
      if (action === "full-text/status") return fullText(paper, false);
      if (action === "note-blocks") return noteBlocks(paper, state);
      if (action === "tag-candidates") return { paper_id: paper.paper_id, review_revision: revision(1), tags_revision: revision(paper.tagsRev), state: "not_generated", items: [] };
    }
    if (action.startsWith("tag-candidates") || action === "metadata/enrichment-preview" || action === "full-text/extract") fail(501, "AI suggestions, external metadata enrichment and PDF extraction are unavailable in browser demo mode. Saved sample text and manual edits remain available.");
    if (method === "PATCH" && action === "metadata") {
      strict(body, ["changes", "expected_revision"]); guard(body.expected_revision, paper.metadataRev);
      const changes = validateMetadata(body.changes);
      const changed_fields = Object.keys(changes).filter((key) => paper.metadata[key] !== changes[key]);
      const oldNote = paper.note;
      if (changed_fields.length) {
        Object.assign(paper.metadata, changes); paper.metadataRev += 1;
        if (paper.noteExists) paper.note = canonicalNote(paper.note, paper);
      }
      return { status: changed_fields.length ? "saved" : "no_op", metadata: { ...paper.metadata }, metadata_revision: revision(paper.metadataRev), changed_fields, note_header_status: !paper.noteExists ? "not_present" : oldNote === paper.note ? "unchanged" : "updated", canonical_note_header: header(paper), canonical_note_header_text: headerText(paper), reading_note: await persistedNote(paper) };
    }
    if (method === "PATCH" && action === "reading-status") {
      strict(body, ["reading_status", "expected_revision"]); guard(body.expected_revision, paper.statusRev);
      const value = choice(body.reading_status, ["unread", "reading", "read", "finished"]);
      const changed = value !== paper.status;
      if (changed) { paper.status = value; paper.statusRev += 1; }
      return { status: changed ? "saved" : "no_op", reading_status: paper.status, reading_status_revision: revision(paper.statusRev) };
    }
    if (method === "PUT" && action === "reading-note") {
      strict(body, ["content", "expected_sha256"]);
      textField(body.content, 2000000);
      if (typeof body.expected_sha256 !== "string" || !HASH_PATTERN.test(body.expected_sha256)) fail(422, "An expected note hash is required.");
      if (body.expected_sha256 !== await hash(paper.note)) fail(409, "The saved note changed. Reload the current version before retrying.");
      const content = canonicalNote(body.content, paper);
      const changed = content !== paper.note || !paper.noteExists;
      const status = !paper.noteExists ? "created" : changed ? "saved" : "no_op";
      if (changed) { paper.note = content; paper.noteExists = true; }
      const note = await persistedNote(paper);
      return { status, content: note.content, sha256: note.sha256, size_bytes: note.size_bytes };
    }
    if (["POST", "DELETE"].includes(method) && action === "tags") {
      strict(body, ["tag", "expected_revision"]); guard(body.expected_revision, paper.tagsRev);
      const value = textField(body.tag, 100, true).trim();
      const tag = state.tags.find((row) => [row.canonical_key, row.label, ...row.aliases].some((item) => item.toLowerCase() === value.toLowerCase()));
      const key = tag?.canonical_key || value;
      if (method === "POST" && tag?.status === "deprecated") fail(422, "A deprecated canonical tag cannot be added.");
      const next = method === "POST" ? [...new Set([...paper.tags, key])] : paper.tags.filter((item) => item !== key);
      if (next.length > 25) fail(422, "A paper can have at most 25 tags in this demo.");
      const changed = !same(next, paper.tags), oldNote = paper.note;
      if (changed) { paper.tags = next; paper.tagsRev += 1; if (paper.noteExists) paper.note = canonicalNote(paper.note, paper); }
      return { status: changed ? "saved" : "no_op", tags: [...paper.tags], tags_revision: revision(paper.tagsRev), note_header_status: !paper.noteExists ? "not_present" : oldNote === paper.note ? "unchanged" : "updated", canonical_note_header: header(paper), canonical_note_header_text: headerText(paper), reading_note: await persistedNote(paper) };
    }
    if (method === "POST" && action === "archive") {
      strict(body, ["expected_lifecycle_revision", "confirm"]); guard(body.expected_lifecycle_revision, paper.lifecycleRev);
      if (body.confirm !== true) fail(422, "Archiving requires explicit confirmation.");
      const changed = !paper.archived;
      if (changed) { paper.archived = true; paper.lifecycleRev += 1; }
      return { status: changed ? "archived" : "already_archived", paper_id: paper.paper_id, lifecycle_revision: revision(paper.lifecycleRev), message: "Archived in this browser's demo workspace. The sample PDF and saved notes are retained." };
    }
    if (action === "remove-pdf") fail(501, "The bundled sample PDFs cannot be removed. Filesystem removal and recovery require the original local app.");
    if (method === "POST" && action === "note-blocks") {
      strict(body, ["expected_revision", "block_type", ...Object.keys(BLOCK_LIMITS), "tags", "provenance"]); guard(body.expected_revision, paper.blocksRev);
      const input = { ...body }; delete input.expected_revision;
      const content = validateBlock(input);
      if (paper.blocks.length >= 1000) fail(422, "This demo's Note Block limit was reached.");
      const now = new Date().toISOString();
      const block = { ...content, id: `block-${id()}`, paper_id: paper.paper_id, created_at: now, updated_at: now };
      paper.blocks.push(block); paper.blocksRev += 1;
      return { status: "created", block, note_blocks_revision: revision(paper.blocksRev), total: paper.blocks.length };
    }
    if (method === "PATCH" && parts.length === 4 && parts[2] === "note-blocks") {
      strict(body, ["changes", "expected_revision"]); guard(body.expected_revision, paper.blocksRev);
      const block = paper.blocks.find((row) => row.id === parts[3]);
      if (!block) fail(404, "Note Block not found.");
      const changes = validateBlock(body.changes, true);
      const changed = Object.entries(changes).some(([key, value]) => !same(value, block[key]));
      if (changed) { Object.assign(block, changes); block.updated_at = new Date().toISOString(); paper.blocksRev += 1; }
      return { status: changed ? "saved" : "no_op", block, note_blocks_revision: revision(paper.blocksRev), total: paper.blocks.length };
    }
  }
  if (parts[0] === "projects") {
    if (method === "POST" && parts.length === 1) {
      if (state.projects.length >= 1000) fail(422, "This demo's Project limit was reached.");
      const values = validateProject(body), now = new Date().toISOString();
      const project = { ...values, project_id: `project-${id()}`, created_at: now, updated_at: now, projectRev: 1, linksRev: 1, links: [] };
      state.projects.push(project);
      return { status: "created", project: projectState(project) };
    }
    const project = state.projects.find((row) => row.project_id === parts[1]);
    if (!project) fail(404, "Project not found.");
    if (method === "PATCH" && parts.length === 2) {
      strict(body, ["changes", "expected_revision"]); guard(body.expected_revision, project.projectRev);
      if (project.status === "archived") fail(409, "Archived Projects cannot be edited.");
      const changes = validateProject(body.changes, true);
      const changed = Object.entries(changes).some(([key, value]) => !same(value, project[key]));
      if (changed) { Object.assign(project, changes); project.projectRev += 1; project.updated_at = new Date().toISOString(); }
      return { status: changed ? "saved" : "no_op", project: projectState(project) };
    }
    if (method === "POST" && parts.length === 3 && parts[2] === "archive") {
      strict(body, ["expected_revision"]); guard(body.expected_revision, project.projectRev);
      const changed = project.status !== "archived";
      if (changed) { project.status = "archived"; project.projectRev += 1; project.updated_at = new Date().toISOString(); }
      return { status: changed ? "archived" : "already_archived", project: projectState(project) };
    }
    if (["paper-links", "note-block-links"].includes(parts[2]) && ["POST", "DELETE"].includes(method)) {
      const blockLink = parts[2] === "note-block-links";
      strict(body, method === "POST" ? ["paper_id", ...(blockLink ? ["note_block_id"] : []), "link_type", "expected_links_revision"] : ["expected_links_revision"]);
      guard(body.expected_links_revision, project.linksRev);
      if (project.status === "archived") fail(409, "Archived Projects cannot be linked.");
      let link, status;
      if (method === "POST" && parts.length === 3) {
        const paper = state.papers.find((row) => row.paper_id === body.paper_id);
        if (!paper || paper.archived) fail(404, "An active Paper is required.");
        if (blockLink && !paper.blocks.some((block) => block.id === body.note_block_id)) fail(404, "Note Block not found.");
        const type = choice(body.link_type, LINK_TYPES), target = blockLink ? body.note_block_id : paper.paper_id;
        link = project.links.find((row) => row.target_type === (blockLink ? "note_block" : "paper") && row.target_id === target && row.link_type === type);
        status = link ? "unchanged" : "created";
        if (!link) {
          if (project.links.length >= 1000) fail(422, "This demo's Project link limit was reached.");
          link = { link_id: `link-${id()}`, target_type: blockLink ? "note_block" : "paper", target_id: target, paper_id: paper.paper_id, link_type: type, created_at: new Date().toISOString() };
          project.links.push(link); project.linksRev += 1;
        }
      } else if (method === "DELETE" && parts.length === 4) {
        link = project.links.find((row) => row.link_id === parts[3] && row.target_type === (blockLink ? "note_block" : "paper"));
        if (!link) fail(404, "Project link not found.");
        project.links = project.links.filter((row) => row.link_id !== link.link_id); project.linksRev += 1; status = "removed";
      } else fail(501, "This Project link operation is not implemented in the hosted demo.");
      const result = { link_id: link.link_id, project_id: project.project_id, paper_id: link.paper_id, link_type: link.link_type, created_at: link.created_at, ...(blockLink ? { note_block_id: link.target_id } : {}) };
      if (status !== "unchanged") project.updated_at = new Date().toISOString();
      return { status, project: projectState(project), link: result };
    }
  }
  if (parts[0] === "tags" && method !== "GET") {
    guard(body.expected_revision, state.registryRev);
    if (method === "POST" && parts.length === 1) {
      strict(body, ["label", "category", "description", "suggestion_strength", "expected_revision"]);
      const input = { ...body }; delete input.expected_revision;
      const values = validateTag(input);
      const normalize = (value) => value.trim().toLowerCase();
      if (state.tags.some((tag) => [tag.label, tag.canonical_key, ...tag.aliases].some((value) => normalize(value) === normalize(values.label)))) fail(409, "That tag name already exists.");
      if (state.tags.length >= 1000) fail(422, "This demo's tag limit was reached.");
      const tag = { ...values, canonical_key: `tag-${id()}`, aliases: [], status: "active" };
      state.tags.push(tag); state.registryRev += 1;
      return { status: "created", tag, registry_revision: revision(state.registryRev) };
    }
    const tag = state.tags.find((row) => row.canonical_key === parts[1]);
    if (!tag) fail(404, "Canonical tag not found.");
    let changed = false, status = "saved";
    if (method === "PATCH" && parts.length === 2) {
      strict(body, ["changes", "expected_revision"]);
      const changes = validateTag(body.changes, true);
      if (changes.label && state.tags.some((other) => other !== tag && [other.label, other.canonical_key, ...other.aliases].some((value) => value.toLowerCase() === changes.label.toLowerCase()))) fail(409, "That tag label is already used.");
      changed = Object.entries(changes).some(([key, value]) => tag[key] !== value);
      if (changed) Object.assign(tag, changes);
    } else if (["POST", "DELETE"].includes(method) && parts.length === 3 && parts[2] === "aliases") {
      strict(body, ["alias", "expected_revision"]);
      const alias = textField(body.alias, 200, true).trim();
      if (method === "POST") {
        if (state.tags.some((other) => other !== tag && [other.label, other.canonical_key, ...other.aliases].some((value) => value.toLowerCase() === alias.toLowerCase()))) fail(409, "That alias belongs to another canonical tag.");
        if (!tag.aliases.some((value) => value.toLowerCase() === alias.toLowerCase())) { if (tag.aliases.length >= 100) fail(422, "Alias limit reached."); tag.aliases.push(alias); changed = true; }
      } else {
        const next = tag.aliases.filter((value) => value !== alias); changed = next.length !== tag.aliases.length; tag.aliases = next;
      }
    } else if (method === "POST" && parts.length === 3 && parts[2] === "deprecate") {
      strict(body, ["expected_revision"]); changed = tag.status !== "deprecated"; tag.status = "deprecated"; status = "deprecated";
    } else fail(501, "This canonical tag operation is not implemented in the hosted demo.");
    if (changed) state.registryRev += 1;
    return { status: changed ? status : "no_op", tag, registry_revision: revision(state.registryRev) };
  }
  fail(501, "This operation is not implemented in the browser demo. Run the original local app for filesystem, AI or recovery operations.");
}

configureBrowserWorkspace({ seed: createDemoSeed, validate: validateState });
export const demoRequest = createDemoAdapter();
