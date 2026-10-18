/** Browser-owned PDFs and research state. No server filesystem access. */
import { validateCollaboration } from "../collaboration/model.mjs";
import { collaborationAfterRestore } from "../collaboration/restore.mjs";
export const BROWSER_WORKSPACE_KEY = "bandal.blueprint.demo.workspace.v1";
const DB_NAME = "labvium-browser-workspace";
const DB_VERSION = 1;
export const MAX_BROWSER_PDF_BYTES = 100 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 200 * 1024 * 1024;
let databasePromise;
let workspaceContract;
const objectUrls = new Map();

export function configureBrowserWorkspace(contract) { workspaceContract = contract; }
function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("IndexedDB is unavailable. Allow this site's browser storage to save a workspace."));
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("workspace")) database.createObjectStore("workspace", { keyPath: "key" });
        if (!database.objectStoreNames.contains("pdfs")) database.createObjectStore("pdfs", { keyPath: "key" });
      };
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = () => reject(request.error || new Error("The browser workspace could not be opened."));
      request.onblocked = () => reject(new Error("Another tab is blocking a browser storage update. Close that tab and retry."));
    }).catch((error) => { databasePromise = undefined; throw error; });
  }
  return databasePromise;
}
async function transact(stores, mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(stores, mode);
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error("Browser storage operation failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Browser storage operation was cancelled; no partial changes were saved."));
    try { operation(transaction, (value) => { result = value; }); }
    catch (error) { transaction.abort(); reject(error); }
  });
}
export async function sha256Blob(blob) { return sha256Bytes(new Uint8Array(await blob.arrayBuffer())); }
export async function sha256Bytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
export async function workspaceRevision(value) { return sha256Bytes(new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value))); }

const browserStorage = {
  async getItem(key) {
    const value = await transact(["workspace"], "readonly", (transaction, done) => {
      const request = transaction.objectStore("workspace").get(key);
      request.onsuccess = () => done(request.result?.value ?? null);
    });
    if (value !== null || key !== BROWSER_WORKSPACE_KEY) return value;
    // Preserve the legacy source. Migration does not delete the old copy and
    // never replaces corrupt content with a new seed.
    let legacy = null;
    try { legacy = globalThis.localStorage?.getItem(key) ?? null; } catch { /* IndexedDB can remain usable when localStorage is denied. */ }
    if (legacy !== null) {
      await this.compareAndSet(key, null, legacy, {});
      return this.getItem(key);
    }
    return null;
  },
  async setItem(key, value) {
    return transact(["workspace"], "readwrite", (transaction) => transaction.objectStore("workspace").put({ key, value: String(value) }));
  },
  async compareAndSet(key, expected, next, effects = {}) {
    return transact(["workspace", "pdfs"], "readwrite", (transaction, done) => {
      const workspaces = transaction.objectStore("workspace");
      const request = workspaces.get(key);
      request.onsuccess = () => {
        if ((request.result?.value ?? null) !== expected) { done(false); return; }
        const files = transaction.objectStore("pdfs");
        for (const file of effects.putFiles || []) files.put(file);
        for (const fileKey of effects.deleteFiles || []) files.delete(fileKey);
        workspaces.put({ key, value: next });
        done(true);
      };
    });
  },
};
export function getBrowserWorkspaceStorage() { return browserStorage; }
export async function getBrowserPdfRecord(key) {
  return transact(["pdfs"], "readonly", (transaction, done) => {
    const request = transaction.objectStore("pdfs").get(key);
    request.onsuccess = () => done(request.result ?? null);
  });
}
export async function listBrowserPdfRecords() {
  return transact(["pdfs"], "readonly", (transaction, done) => {
    const request = transaction.objectStore("pdfs").getAll();
    request.onsuccess = () => done(request.result || []);
  });
}
export async function listBrowserRecoveryWorkspaces() {
  return transact(["workspace"], "readonly", (transaction, done) => {
    const request = transaction.objectStore("workspace").getAll();
    request.onsuccess = () => done((request.result || []).filter((row) => row.key.startsWith("restore-")).map((row) => ({ recovery_id: row.key, kind: "workspace", created_at: row.created_at || "", summary: "Workspace retained before a confirmed backup restore.", value: row.value })));
  });
}
export async function restoreBrowserRecoveryWorkspace(recoveryId, options) {
  const snapshots = await listBrowserRecoveryWorkspaces();
  const snapshot = snapshots.find((row) => row.recovery_id === recoveryId);
  if (!snapshot) throw new Error("Workspace recovery copy not found.");
  const workspace = workspaceContract.validate(JSON.parse(snapshot.value));
  const files = (await listBrowserPdfRecords()).filter((file) => file.key.startsWith(`${recoveryId}-`));
  const pdfs = [];
  for (const file of files) {
    const key = file.key.slice(recoveryId.length + 1);
    pdfs.push({ key, paper_id: file.paper_id, filename: file.filename, sha256: file.sha256, kind: workspace.papers.some((paper) => paper.pdfId === key && !paper.pdfMissing) ? "active" : "recovery", created_at: file.created_at, data_base64: bytesToBase64(new Uint8Array(await file.blob.arrayBuffer())) });
  }
  return restoreBrowserWorkspace({ schema_version: 1, workspace, pdfs }, options);
}
export function cachedBrowserPdfUrl(paperId) { return objectUrls.get(paperId)?.url || ""; }
export function revokeBrowserPdfUrl(paperId) {
  const previous = objectUrls.get(paperId);
  if (previous) { URL.revokeObjectURL(previous.url); objectUrls.delete(paperId); }
}
export function cacheBrowserPdfUrl(paperId, blob, revision = "") {
  const previous = objectUrls.get(paperId);
  if (previous && previous.revision === revision) return previous.url;
  revokeBrowserPdfUrl(paperId);
  const url = URL.createObjectURL(blob);
  objectUrls.set(paperId, { url, revision });
  return url;
}
export async function loadBrowserPdfUrl(paperId, key = paperId) {
  if (cachedBrowserPdfUrl(paperId)) return cachedBrowserPdfUrl(paperId);
  const record = await getBrowserPdfRecord(key);
  return record ? cacheBrowserPdfUrl(paperId, record.blob, record.sha256) : "";
}
export async function validatePdfFile(file) {
  if (!(file instanceof Blob) || file.size < 8 || file.size > MAX_BROWSER_PDF_BYTES) throw new Error("PDF files must be between 8 bytes and 100 MiB.");
  const signature = new TextDecoder("ascii").decode(await file.slice(0, 1024).arrayBuffer());
  if (!signature.includes("%PDF-")) throw new Error("The selected file does not contain a PDF header.");
  if (file.name && !/\.pdf$/i.test(file.name)) throw new Error("Select files with a .pdf extension.");
  return { sha256: await sha256Blob(file), size_bytes: file.size };
}

async function currentWorkspace() {
  let raw = await browserStorage.getItem(BROWSER_WORKSPACE_KEY);
  if (raw === null) {
    if (!workspaceContract) throw new Error("Open the workspace once before using maintenance.");
    const seed = JSON.stringify(workspaceContract.seed());
    await browserStorage.compareAndSet(BROWSER_WORKSPACE_KEY, null, seed, {});
    raw = await browserStorage.getItem(BROWSER_WORKSPACE_KEY);
  }
  if (!workspaceContract) throw new Error("The workspace schema is unavailable.");
  const workspace = workspaceContract.validate(JSON.parse(raw));
  return { raw, workspace, revision: await workspaceRevision(raw) };
}
export async function getMaintenanceSnapshot() {
  const current = await currentWorkspace();
  const files = await listBrowserPdfRecords();
  return { revision: current.revision, paper_count: current.workspace.papers.length, project_count: current.workspace.projects.length, pdf_count: current.workspace.papers.filter((paper) => !paper.pdfMissing).length, recovery_count: files.filter((file) => file.kind === "recovery").length, bytes: files.reduce((total, file) => total + file.blob.size, 0), storage: "indexeddb" };
}
function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}
function base64ToBytes(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error("A backup PDF is not valid base64.");
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
export async function exportBrowserWorkspace() {
  const current = await currentWorkspace();
  const files = await listBrowserPdfRecords();
  const backupWorkspace = structuredClone(current.workspace);
  // Include the bundled examples as real PDF bytes too: a full backup must
  // remain readable independently of this deployment's static assets.
  for (const paper of backupWorkspace.papers.filter((paper) => !paper.pdfId && !paper.pdfMissing && /^demo-(ccs|muon|seismic)$/.test(paper.paper_id))) {
    const prefix = (process.env.NEXT_PUBLIC_BANDAL_DEMO_BASE || "").replace(/\/$/, "");
    const response = await fetch(`${prefix}/bandal-demo/${paper.paper_id}.pdf`);
    if (!response.ok) throw new Error("A bundled example PDF could not be included. No incomplete backup was produced.");
    const blob = await response.blob(), verified = await validatePdfFile(blob);
    const key = `pdf-sample-${paper.paper_id}`;
    files.push({ key, paper_id: paper.paper_id, filename: `${paper.paper_id}.pdf`, sha256: verified.sha256, kind: "active", created_at: new Date().toISOString(), blob });
    paper.pdfId = key; paper.pdfSha256 = verified.sha256;
  }
  if (files.reduce((total, file) => total + file.blob.size, 0) > MAX_BACKUP_BYTES) throw new Error("This browser backup exceeds the 200 MiB export limit.");
  const pdfs = [];
  for (const file of files) {
    const actualHash = await sha256Blob(file.blob);
    if (actualHash !== file.sha256) throw new Error("A stored PDF failed its checksum. The existing workspace was preserved.");
    pdfs.push({ key: file.key, paper_id: file.paper_id, filename: file.filename, sha256: actualHash, kind: file.kind, created_at: file.created_at, data_base64: bytesToBase64(new Uint8Array(await file.blob.arrayBuffer())) });
  }
  const latest = await browserStorage.getItem(BROWSER_WORKSPACE_KEY);
  if (latest !== current.raw) throw new Error("The workspace changed during backup. Retry the export.");
  return { schema_version: 1, revision: await workspaceRevision(backupWorkspace), workspace: backupWorkspace, pdfs };
}
async function validateBackup(archive) {
  if (!archive || archive.schema_version !== 1 || !Array.isArray(archive.pdfs) || archive.pdfs.length > 2000 || !workspaceContract) throw new Error("This is not a supported browser workspace backup.");
  const workspace = workspaceContract.validate(structuredClone(archive.workspace));
  // Keep member references as historical attribution only. Browser restore
  // never manufactures account memberships or turns retained people into a
  // selectable team. Invalid collaboration bytes reject the whole restore.
  if (workspace.collaboration !== undefined) validateCollaboration(workspace.collaboration);
  const keys = new Set();
  const files = [];
  let bytes = 0;
  for (const file of archive.pdfs) {
    if (!file || typeof file.key !== "string" || !/^[a-z0-9-]{1,180}$/.test(file.key) || keys.has(file.key) || !["active", "recovery"].includes(file.kind) || typeof file.filename !== "string" || file.filename.length > 255 || !/^[0-9a-f]{64}$/.test(file.sha256)) throw new Error("A backup PDF record is invalid or duplicated.");
    keys.add(file.key);
    if (file.data_base64.length > Math.ceil(MAX_BROWSER_PDF_BYTES * 4 / 3) + 4) throw new Error("A backup PDF exceeds 100 MiB.");
    const data = base64ToBytes(file.data_base64);
    bytes += data.byteLength;
    if (bytes > MAX_BACKUP_BYTES) throw new Error("The backup exceeds the 200 MiB restore limit.");
    const blob = new Blob([data], { type: "application/pdf" });
    const verified = await validatePdfFile(blob);
    if (verified.sha256 !== file.sha256) throw new Error("A backup PDF checksum did not match. Nothing was restored.");
    if (file.kind === "active" && !workspace.papers.some((paper) => paper.paper_id === file.paper_id)) throw new Error("An active backup PDF refers to an unknown Paper.");
    files.push({ key: file.key, paper_id: file.paper_id, filename: file.filename, sha256: file.sha256, kind: file.kind, created_at: file.created_at || new Date().toISOString(), blob });
  }
  for (const paper of workspace.papers) {
    if (paper.pdfId && !paper.pdfMissing && !files.some((file) => file.key === paper.pdfId && file.paper_id === paper.paper_id && file.kind === "active" && (!paper.pdfSha256 || paper.pdfSha256 === file.sha256))) throw new Error("The backup is missing an active Paper's matching PDF.");
  }
  return { workspace, files, bytes };
}
export async function previewBrowserWorkspaceRestore(archive) {
  try {
    const validated = await validateBackup(archive), current = await currentWorkspace();
    return { valid: true, revision: current.revision, paper_count: validated.workspace.papers.length, pdf_count: validated.files.filter((file) => file.kind === "active").length, total_bytes: validated.bytes, warnings: ["Restore replaces the current browser workspace after confirmation. A recovery copy of the current workspace and PDFs will be retained."] };
  } catch (error) { return { valid: false, revision: "", paper_count: 0, pdf_count: 0, total_bytes: 0, warnings: [error.message || "Backup validation failed."] }; }
}
export async function restoreBrowserWorkspace(archive, options) {
  if (!options || options.confirm !== true || !/^[0-9a-f]{64}$/.test(options.expected_revision || "")) throw new Error("Restore requires explicit confirmation and the current workspace revision.");
  const validated = await validateBackup(archive), current = await currentWorkspace();
  if (current.revision !== options.expected_revision) throw new Error("The workspace changed after the restore preview. Review a new preview before restoring.");
  const existing = await listBrowserPdfRecords();
  const recoveryId = `restore-${crypto.randomUUID()}`;
  const nextWorkspace = structuredClone(validated.workspace);
  const collaboration = collaborationAfterRestore(current.workspace.collaboration, nextWorkspace.collaboration);
  if (collaboration !== undefined) nextWorkspace.collaboration = collaboration;
  const next = JSON.stringify(nextWorkspace);
  const result = await transact(["workspace", "pdfs"], "readwrite", (transaction, done) => {
    const workspaces = transaction.objectStore("workspace"), request = workspaces.get(BROWSER_WORKSPACE_KEY);
    request.onsuccess = () => {
      if (request.result?.value !== current.raw) { done(false); return; }
      const files = transaction.objectStore("pdfs");
      workspaces.put({ key: recoveryId, value: current.raw, created_at: new Date().toISOString() });
      for (const file of existing) files.put({ ...file, key: `${recoveryId}-${file.key}`, kind: "recovery" });
      for (const file of existing) files.delete(file.key);
      for (const file of validated.files) files.put(file);
      workspaces.put({ key: BROWSER_WORKSPACE_KEY, value: next });
      done(true);
    };
  });
  if (!result) throw new Error("The workspace changed in another tab. Nothing was restored.");
  for (const paperId of objectUrls.keys()) revokeBrowserPdfUrl(paperId);
  globalThis.dispatchEvent?.(new Event("labvium:workspace-changed"));
  return { status: "restored", revision: await workspaceRevision(next), recovery_id: recoveryId };
}
