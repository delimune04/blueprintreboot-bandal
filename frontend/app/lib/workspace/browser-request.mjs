import { createResearchPagesStore, validateResearchPagesState } from "./pages.mjs";
import { BROWSER_WORKSPACE_KEY, exportBrowserWorkspace, getBrowserWorkspaceStorage, getMaintenanceSnapshot, previewBrowserWorkspaceRestore, restoreBrowserWorkspace } from "../demo/browser-storage.mjs";
import { searchWorkspace } from "./search.mjs";

const stagedBackups = new Map();
const PAGE_RECOVERY_KEY = "labvium.research-pages.recovery.v1";
const pagesStore = () => createResearchPagesStore();
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
function reject(status, message) { const error = new Error(message); error.status = status; throw error; }
function pageRecoveries() {
  const raw = window.localStorage.getItem(PAGE_RECOVERY_KEY); if (raw === null) return [];
  try { const rows = JSON.parse(raw); if (!Array.isArray(rows) || rows.length > 100) throw new Error(); for (const row of rows) { if (!/^research-pages-[a-z0-9-]+$/.test(row.recovery_id)) throw new Error(); validateResearchPagesState(row.state); } return rows; }
  catch { reject(503, "Research page recovery records cannot be read. They have been preserved."); }
}
function retainPageRecovery(state) {
  const records = pageRecoveries();
  if (records.length >= 100) reject(422, "The research page recovery history is full. Existing recovery copies have been retained; no restore was applied.");
  const record = { recovery_id: `research-pages-${crypto.randomUUID()}`, kind: "research_pages", created_at: new Date().toISOString(), summary: `Research pages before restore (${state.pages.length})`, state };
  const serialized = JSON.stringify([record, ...records]);
  window.localStorage.setItem(PAGE_RECOVERY_KEY, serialized);
  if (window.localStorage.getItem(PAGE_RECOVERY_KEY) !== serialized) reject(503, "Research page recovery could not be confirmed. Nothing was restored.");
}
async function snapshot() {
  const [workspace, pages] = await Promise.all([getMaintenanceSnapshot(), Promise.resolve(pagesStore().list())]);
  return { workspace_revision: workspace.revision, browser_revision: workspace.revision, pages_revision: pages.revision, mode: "browser", paper_count: workspace.paper_count, project_count: workspace.project_count ?? 0, pdf_count: workspace.pdf_count, research_page_count: pages.items.length, capabilities: ["backups", "backup_restore", "pdf_upload", "research_pages", "note_import", "project_delete", "note_block_delete", "link_edit", "rename_pdf", "cache_quarantine", "paper_priority"] };
}
function record(archive, kind) { return { backup_id: `backup-${crypto.randomUUID()}`, created_at: new Date().toISOString(), kind, verified: true, portable: true, pdf_coverage: kind === "full" ? "bytes" : "none", pdf_count: archive.pdfs.filter((file) => file.kind === "active").length, size_bytes: new TextEncoder().encode(JSON.stringify(archive)).byteLength }; }
function stageBackup(entry) {
  // Downloaded files own portability. Keep only recent tab-local previews so
  // repeated large exports cannot accumulate indefinitely in browser memory.
  while (stagedBackups.size >= 3) stagedBackups.delete(stagedBackups.keys().next().value);
  stagedBackups.set(entry.record.backup_id, entry);
}
async function preview(backup) {
  const checked = await previewBrowserWorkspaceRestore(backup.archive);
  if (!checked.valid) reject(422, checked.warnings.join(" "));
  validateResearchPagesState(backup.archive.research_pages);
  const current = await snapshot();
  backup.previewPagesRevision = current.pages_revision;
  return { backup_id: backup.record.backup_id, verified: true, kind: backup.record.kind, paper_count: checked.paper_count, project_count: backup.archive.workspace.projects.length, missing_pdf_count: backup.archive.workspace.papers.filter((paper) => paper.pdfMissing).length, workspace_revision: current.workspace_revision, research_page_count: backup.archive.research_pages.pages.length, message: checked.warnings.join(" ") };
}
/** Guest-only mirror of the cloud endpoint contracts. Null delegates ownership. */
export async function browserWorkspaceRequest(path, init = {}) {
  const coordinatePages = /^\/(?:research\/pages|backups|exports\/workspace|recovery\/research-pages-)/.test(path);
  // All cooperating tabs serialize their page/backup commands before the
  // localStorage revision compare. PDF publication still uses the IDB CAS.
  if (coordinatePages && globalThis.navigator?.locks?.request) {
    return globalThis.navigator.locks.request("labvium:research-pages", { mode: "exclusive", ...(init.signal ? { signal: init.signal } : {}) }, () => executeBrowserWorkspaceRequest(path, init));
  }
  return executeBrowserWorkspaceRequest(path, init);
}
async function executeBrowserWorkspaceRequest(path, init = {}) {
  const url = new URL(path, "https://labvium.invalid");
  const parts = url.pathname.split("/").filter(Boolean);
  const ownedRecovery = parts[0] === "recovery" && ((parts.length === 1 && (init.method || "GET") === "GET") || parts[1]?.startsWith("research-pages-"));
  const owned = ownedRecovery || (parts[0] === "research" && parts[1] === "pages") || ["workspace", "backups", "exports", "discover", "search"].includes(parts[0]);
  if (!owned) return null;
  try {
    if (init.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const method = (init.method || "GET").toUpperCase();
    const body = init.body == null ? {} : JSON.parse(init.body);
    if (ownedRecovery && parts.length === 1 && method === "GET") {
      const { demoRequest } = await import("../demo/adapter.mjs");
      const response = await demoRequest(path, init); if (!response.ok) return response;
      const data = await response.json();
      return reply({ ...data, items: [...pageRecoveries().map((row) => ({ recovery_id: row.recovery_id, kind: row.kind, created_at: row.created_at, summary: row.summary })), ...data.items] });
    }
    if (ownedRecovery && method === "POST" && parts[2] === "restore") {
      if (body.confirm !== true) reject(422, "Recovery requires confirmation.");
      const current = await snapshot(); if (body.expected_revision !== current.workspace_revision) reject(409, "The workspace changed before recovery. Refresh maintenance.");
      const recovery = pageRecoveries().find((row) => row.recovery_id === parts[1]); if (!recovery) reject(404, "Research page recovery not found.");
      retainPageRecovery(pagesStore().export());
      pagesStore().restore(recovery.state, current.pages_revision, true);
      return reply({ status: "restored", workspace_revision: current.workspace_revision });
    }
    if (parts[0] === "discover") return fetch(`/ku-ai/api${url.pathname}${url.search}`, { ...init, credentials: "same-origin" });
    if (parts[0] === "search" && method === "GET") {
      await getMaintenanceSnapshot();
      const raw = await getBrowserWorkspaceStorage().getItem(BROWSER_WORKSPACE_KEY);
      if (init.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      const q = (url.searchParams.get("q") || "").trim();
      if (!q || q.length > 500) reject(422, "Enter a search query of up to 500 characters.");
      const items = searchWorkspace(JSON.parse(raw), pagesStore().list().items, q, url.searchParams.get("project_id") || "");
      return reply({ items, total: items.length, q, source: "saved_workspace" });
    }
    if (parts[0] === "research") {
      const store = pagesStore();
      if (method === "GET" && parts.length === 2) return reply(store.list());
      if (method === "GET" && parts.length === 3) { const state = store.list(); const page = state.items.find((row) => row.id === parts[2]); if (!page) reject(404, "Research page not found."); return reply({ page, revision: state.revision }); }
      if (method === "POST" && parts.length === 2) return reply(store.create(body.page));
      if (method === "PUT" && parts.length === 3) return reply(store.save(parts[2], body.page, body.expected_revision));
      if (method === "POST" && parts.length === 4 && ["archive", "unarchive"].includes(parts[3])) return reply(store.archive(parts[2], parts[3] === "archive", body.expected_revision, body.confirm));
      reject(501, "This research page operation is unavailable.");
    }
    if (parts[0] === "workspace" && method === "GET" && parts.length === 1) return reply(await snapshot());
    if (parts[0] === "exports" && parts[1] === "workspace" && method === "GET") return reply({ ...await exportBrowserWorkspace(), research_pages: pagesStore().export() });
    if (parts[0] === "backups") {
      if (method === "GET" && parts.length === 1) return reply({ items: [...stagedBackups.values()].map((row) => row.record), workspace_revision: (await snapshot()).workspace_revision });
      if (method === "POST" && parts.length === 1) {
        const current = await snapshot(); if (body.expected_revision !== current.workspace_revision) reject(409, "The workspace changed. Refresh maintenance before creating a backup.");
        if (!["light", "full"].includes(body.kind)) reject(422, "Choose a light or full backup.");
        const beforePages = pagesStore().export();
        const archive = { ...await exportBrowserWorkspace(), research_pages: beforePages };
        if (pagesStore().list().revision !== current.pages_revision) reject(409, "Research pages changed during backup. Retry the export.");
        if (body.kind === "light") { archive.pdfs = []; archive.workspace.papers.forEach((paper) => { if (paper.pdfId) paper.pdfMissing = true; }); }
        const checked = await previewBrowserWorkspaceRestore(archive); if (!checked.valid) reject(422, checked.warnings.join(" "));
        const entry = { archive, record: record(archive, body.kind) }; stageBackup(entry);
        return reply(entry.record);
      }
      if (method === "POST" && parts[1] === "import-preview" && parts.length === 2) {
        if (!body.archive || typeof body.archive !== "object" || Array.isArray(body.archive)) reject(422, "Select a supported JSON workspace backup.");
        const archive = structuredClone(body.archive); if (!archive.research_pages) archive.research_pages = { version: 1, sequence: 1, pages: [] };
        validateResearchPagesState(archive.research_pages);
        const checked = await previewBrowserWorkspaceRestore(archive); if (!checked.valid) reject(422, checked.warnings.join(" "));
        const kind = archive.pdfs.length ? "full" : "light";
        const entry = { archive, record: record(archive, kind) }; stageBackup(entry);
        return reply(await preview(entry));
      }
      const backup = stagedBackups.get(parts[1]); if (!backup) reject(404, "This backup preview expired. Select your downloaded backup file again.");
      if (method === "GET" && parts.length === 2) return reply(backup.archive);
      if (method === "POST" && parts[2] === "restore-preview") return reply(await preview(backup));
      if (method === "POST" && parts[2] === "restore") {
        if (body.confirm !== true) reject(422, "Restore requires explicit confirmation.");
        const current = await snapshot(); if (current.workspace_revision !== body.expected_revision || current.pages_revision !== backup.previewPagesRevision) reject(409, "The workspace or research pages changed after preview. Review it again before restoring.");
        validateResearchPagesState(backup.archive.research_pages);
        const previousPages = pagesStore().export();
        retainPageRecovery(previousPages);
        const result = pagesStore().restore(backup.archive.research_pages, current.pages_revision, true);
        try { await restoreBrowserWorkspace(backup.archive, { expected_revision: current.browser_revision, confirm: true }); }
        catch (error) { try { pagesStore().restore(previousPages, result.revision, true); } catch { reject(503, "The PDF restore failed and another tab changed research pages. Research page recovery is required; current data has not been cleared."); } throw error; }
        return reply({ status: "restored", workspace_revision: (await snapshot()).workspace_revision });
      }
    }
    reject(501, "This maintenance operation is unavailable.");
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return reply({ detail: error.message || "The browser workspace operation failed. Saved data has been retained." }, error.status || 503);
  }
}
