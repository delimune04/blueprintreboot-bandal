export const RESEARCH_PAGES_KEY = "labvium.research-pages.v1";
const BLOCK_TYPES = ["paragraph", "heading", "quote", "checklist"];
const MAX_PAGES = 1000;
const clone = (value) => structuredClone(value);
const revision = (value) => Number(value).toString(16).padStart(64, "0");
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
function invalid(message = "The research page is invalid.") { const error = new Error(message); error.status = 422; throw error; }
function text(value, max, required = false) { if (typeof value !== "string" || value.length > max || value.includes("\0") || (required && !value.trim())) invalid(); return value; }
function boundedId(value, empty = false) { if (empty && value === "") return value; if (typeof value !== "string" || !/^[a-zA-Z0-9:_-]{1,160}$/.test(value)) invalid("Invalid object identity."); return value; }
export function safeResearchUrl(value) { try { const url = new URL(String(value)); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : ""; } catch { return ""; } }
function keys(value, allowed) { if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key))) invalid("Unknown research page fields."); }
export function validateResearchPageInput(value) {
  keys(value, ["parent_id", "title", "project_id", "blocks", "handoff"]);
  const parent_id = value.parent_id === null ? null : boundedId(value.parent_id);
  if (!Array.isArray(value.blocks) || value.blocks.length > 500) invalid("A page can contain at most 500 blocks.");
  const ids = new Set();
  const blocks = value.blocks.map((block) => {
    keys(block, ["id", "type", "text", "checked", "provenance", "source_links", "owner"]);
    boundedId(block.id); if (ids.has(block.id)) invalid("Block identities must be unique."); ids.add(block.id);
    if (!BLOCK_TYPES.includes(block.type) || !["manual", "ai"].includes(block.provenance) || typeof block.checked !== "boolean") invalid();
    if (!Array.isArray(block.source_links) || block.source_links.length > 50) invalid();
    return { id: block.id, type: block.type, text: text(block.text, 100000), checked: block.checked, provenance: block.provenance, owner: text(block.owner, 200), source_links: block.source_links.map((source) => {
      keys(source, ["paper_id", "url", "label"]); const url = text(source.url, 2048); if (url && !safeResearchUrl(url)) invalid("Source links must use HTTP or HTTPS.");
      return { paper_id: boundedId(source.paper_id, true), url, label: text(source.label, 500) };
    }) };
  });
  keys(value.handoff, ["verified_facts", "open_questions", "next_steps", "owner"]);
  return { parent_id, title: text(value.title, 200, true).trim(), project_id: boundedId(value.project_id, true), blocks, handoff: { verified_facts: text(value.handoff.verified_facts, 100000), open_questions: text(value.handoff.open_questions, 100000), next_steps: text(value.handoff.next_steps, 100000), owner: text(value.handoff.owner, 200) } };
}
export function validateResearchPagesState(value) {
  if (!object(value) || value.version !== 1 || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || !Array.isArray(value.pages) || value.pages.length > MAX_PAGES) invalid("Unsupported research page archive.");
  const ids = new Set();
  for (const page of value.pages) {
    boundedId(page.id); if (ids.has(page.id)) invalid("Duplicate page identity."); ids.add(page.id);
    if (typeof page.archived !== "boolean" || typeof page.created_at !== "string" || typeof page.updated_at !== "string") invalid();
    validateResearchPageInput(Object.fromEntries(["parent_id", "title", "project_id", "blocks", "handoff"].map((key) => [key, page[key]])));
  }
  for (const page of value.pages) {
    const parents = new Set([page.id]); let parent = page.parent_id;
    while (parent !== null) {
      if (parents.has(parent)) invalid("A research page cannot be its own ancestor.");
      parents.add(parent); const row = value.pages.find((candidate) => candidate.id === parent);
      if (!row) invalid("A research page parent is missing."); parent = row.parent_id;
    }
  }
  return clone(value);
}
export function blankResearchPage(parent_id = null) { return { parent_id, title: "", project_id: "", blocks: [], handoff: { verified_facts: "", open_questions: "", next_steps: "", owner: "" } }; }
export function newResearchBlock(type = "paragraph") { return { id: `block-${globalThis.crypto.randomUUID()}`, type, text: "", checked: false, provenance: "manual", source_links: [], owner: "" }; }
export function researchPageInput(page) { return Object.fromEntries(["parent_id", "title", "project_id", "blocks", "handoff"].map((key) => [key, clone(page[key])])); }
export function flattenResearchPageTree(pages, showArchived = false) {
  const rows = [];
  function visit(parent, depth, hidden = false) { for (const page of pages.filter((item) => item.parent_id === parent)) { const archived = hidden || page.archived; if (showArchived || !archived) rows.push({ page, depth }); visit(page.id, depth + 1, archived); } }
  visit(null, 0); return rows;
}
export function createResearchPagesStore(storageProvider = () => window.localStorage) {
  function load() {
    const storage = typeof storageProvider === "function" ? storageProvider() : storageProvider;
    if (!storage || typeof storage.getItem !== "function") throw new Error("Browser storage is unavailable.");
    const original = storage.getItem(RESEARCH_PAGES_KEY);
    if (original === null) return { storage, original, state: { version: 1, sequence: 1, pages: [] } };
    try { return { storage, original, state: validateResearchPagesState(JSON.parse(original)) }; }
    catch { const error = new Error("Saved research pages cannot be read. They have been preserved."); error.status = 503; throw error; }
  }
  function write(context, expected, mutation) {
    if (expected !== revision(context.state.sequence)) { const error = new Error("Research pages changed elsewhere. Reload before saving."); error.status = 409; throw error; }
    mutation(context.state); context.state.sequence += 1; validateResearchPagesState(context.state);
    if (context.storage.getItem(RESEARCH_PAGES_KEY) !== context.original) { const error = new Error("Research pages changed in another tab."); error.status = 409; throw error; }
    const next = JSON.stringify(context.state); context.storage.setItem(RESEARCH_PAGES_KEY, next);
    if (context.storage.getItem(RESEARCH_PAGES_KEY) !== next) throw new Error("Research page save could not be confirmed.");
    return revision(context.state.sequence);
  }
  return {
    list() { const context = load(); return { items: clone(context.state.pages), revision: revision(context.state.sequence) }; },
    export() { return clone(load().state); },
    create(input) {
      const context = load(); const values = validateResearchPageInput(input); if (context.state.pages.length >= MAX_PAGES) invalid("Research page limit reached.");
      const now = new Date().toISOString(); const page = { ...values, id: `page-${globalThis.crypto.randomUUID()}`, archived: false, created_at: now, updated_at: now };
      const next = write(context, revision(context.state.sequence), (state) => state.pages.push(page)); return { page: clone(page), revision: next };
    },
    save(id, input, expected) {
      const context = load(); const values = validateResearchPageInput(input); const page = context.state.pages.find((row) => row.id === id); if (!page) { const error = new Error("Research page not found."); error.status = 404; throw error; }
      if (page.archived) invalid("Unarchive this page before editing it.");
      const next = write(context, expected, () => Object.assign(page, values, { updated_at: new Date().toISOString() })); return { page: clone(page), revision: next };
    },
    archive(id, archived, expected, confirm) {
      if (confirm !== true) invalid("Confirm the page lifecycle change."); const context = load(); const page = context.state.pages.find((row) => row.id === id); if (!page) invalid("Research page not found.");
      const next = write(context, expected, () => { page.archived = archived; page.updated_at = new Date().toISOString(); }); return { page: clone(page), revision: next };
    },
    restore(archive, expected, confirm) {
      if (confirm !== true) invalid("Restore requires confirmation."); const incoming = validateResearchPagesState(archive); const context = load();
      const next = write(context, expected, (state) => { state.pages = incoming.pages; }); return { status: "restored", revision: next };
    },
  };
}
