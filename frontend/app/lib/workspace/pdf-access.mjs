import { normalizeDiscoveryArxiv, normalizeDiscoveryDoi, normalizeDiscoveryOpenalex } from "./discovery-identity.mjs";
import { safeResearchUrl } from "./pages.mjs";

function text(value) { return typeof value === "string" ? value.trim() : ""; }
function decoded(value) { try { return decodeURIComponent(value); } catch { return ""; } }
function parsedUrl(value) { try { const url = new URL(text(value)); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url : null; } catch { return null; } }
function canonicalDoi(value) {
  const raw = text(value), url = parsedUrl(raw);
  if (url) return ["doi.org", "dx.doi.org"].includes(url.hostname.toLowerCase()) ? normalizeDiscoveryDoi(decoded(url.pathname.slice(1))) : "";
  return normalizeDiscoveryDoi(raw);
}
function canonicalArxiv(value) {
  const raw = text(value), url = parsedUrl(raw);
  let identifier = raw;
  if (url) {
    if (["arxiv.org", "www.arxiv.org", "export.arxiv.org"].includes(url.hostname.toLowerCase())) {
      const path = /^\/(?:abs|pdf)\/(.+?)\/?$/.exec(url.pathname)?.[1] || "";
      identifier = decoded(path);
    } else {
      identifier = canonicalDoi(raw);
      if (!identifier) return "";
    }
  } else identifier = canonicalDoi(raw) || raw;
  const base = normalizeDiscoveryArxiv(identifier);
  if (!base) return "";
  const version = /v([1-9]\d*)$/i.exec(identifier.replace(/\.pdf$/i, ""))?.[1];
  return version ? `${base}v${version}` : base;
}
function canonicalOpenalex(value) {
  const raw = text(value), url = parsedUrl(raw);
  if (url) return url.hostname.toLowerCase() === "openalex.org" ? normalizeDiscoveryOpenalex(decoded(url.pathname.slice(1).replace(/\/$/, ""))) : "";
  return normalizeDiscoveryOpenalex(raw.replace(/^openalex:/i, ""));
}
function records(input) {
  if (!input || typeof input !== "object") return [];
  return [input, input.metadata, input.external_source].filter(value => value && typeof value === "object");
}
function first(values, normalize) {
  for (const value of values) { const result = normalize(value); if (result) return result; }
  return "";
}

/** Exact identifiers only: titles and arbitrary URL substrings are never IDs. */
export function canonicalPdfIdentifiers(input = {}) {
  const rows = records(input);
  const aliases = Array.isArray(input.discovery_identifiers) ? input.discovery_identifiers : [];
  const values = rows.flatMap(row => [row.doi, row.id, row.url, row.pdf_url]);
  const arxivCandidates = [...rows.map(row => row.arxiv_id), ...values, ...aliases].map(canonicalArxiv).filter(Boolean);
  const arxivBase = normalizeDiscoveryArxiv(arxivCandidates[0]);
  // Access addresses concrete PDF bytes, so a recorded version of this same
  // identifier wins over an unversioned alias. Discovery dedup still uses the
  // separate version-free identity helper.
  const arxiv = arxivCandidates.find(value => /v[1-9]\d*$/i.test(value) && normalizeDiscoveryArxiv(value) === arxivBase) || arxivCandidates[0] || "";
  return {
    doi: first([...rows.map(row => row.doi), ...values, ...aliases], canonicalDoi),
    arxiv_id: arxiv,
    openalex_id: first([...rows.map(row => row.openalex_id), ...values, ...aliases], canonicalOpenalex),
  };
}

/** A recorded PDF URL wins; otherwise an exact arXiv ID provides its PDF URL. */
export function inferredPdfSource(input = {}) {
  const identifiers = canonicalPdfIdentifiers(input);
  const rows = records(input);
  const recordedPdf = first(rows.map(row => row.pdf_url), safeResearchUrl);
  const recordedSource = first(rows.map(row => row.url), safeResearchUrl);
  const arxivPdf = identifiers.arxiv_id ? `https://arxiv.org/pdf/${identifiers.arxiv_id}` : "";
  const source = recordedSource || (identifiers.arxiv_id ? `https://arxiv.org/abs/${identifiers.arxiv_id}` : identifiers.doi ? `https://doi.org/${identifiers.doi}` : identifiers.openalex_id ? `https://openalex.org/${identifiers.openalex_id}` : "");
  return { pdf_url: recordedPdf || arxivPdf, source_url: source, arxiv_id: identifiers.arxiv_id, inferred: !recordedPdf && Boolean(arxivPdf) };
}

export function publicPdfAccessPath(input = {}) {
  const identifiers = canonicalPdfIdentifiers(input);
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(identifiers)) if (value) query.set(name, value);
  return query.size ? `/discover/pdf-access?${query}` : "";
}

function failure(code, message, status) { const error = new Error(message); error.code = code; if (status) error.status = status; return error; }
function aborted(signal) { if (signal?.aborted) throw signal.reason || new DOMException("The download was cancelled.", "AbortError"); }
function filename(title) {
  const clean = text(title).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/g, " ").replace(/\s+/g, " ").replace(/\.pdf$/i, "").replace(/^[. ]+|[. ]+$/g, "");
  const name = Array.from(clean).slice(0, 160).join("").replace(/[. ]+$/g, "") || "paper";
  return `${/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name) ? `paper-${name}` : name}.pdf`;
}
async function managedPdfBlob(response, signal) {
  const maximum = 100 * 1024 * 1024;
  if (Number(response.headers.get("content-length") || 0) > maximum || !response.body) throw failure("pdf_unavailable", "The managed PDF is unavailable or exceeds the supported download size.");
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      aborted(signal);
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximum) throw failure("pdf_unavailable", "The managed PDF exceeds the supported download size.");
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const blob = new Blob(chunks, { type: "application/pdf" });
  const header = new TextDecoder("latin1").decode(await blob.slice(0, 4096).arrayBuffer());
  if (blob.size < 8 || !header.includes("%PDF-")) throw failure("invalid_pdf", "The managed document did not contain PDF bytes.");
  return blob;
}

/** Download verified bytes from the existing managed transport, including
 * browser blob URLs. Completion means handoff to the browser's download UI. */
export async function downloadManagedPdf(paperId, title, signal) {
  aborted(signal);
  if (typeof document === "undefined" || !document.body || typeof URL.createObjectURL !== "function") throw failure("download_unavailable", "This browser cannot download a managed PDF.");
  const { paperPdfUrl } = await import("../api/client");
  aborted(signal);
  const source = paperPdfUrl(paperId);
  if (!source) throw failure("pdf_unavailable", "No managed PDF is available for this paper.");
  const response = await fetch(source, { credentials: "same-origin", cache: "no-store", signal });
  if (!response.ok) throw failure("pdf_unavailable", "The managed PDF could not be downloaded.", response.status);
  const blob = await managedPdfBlob(response, signal);
  aborted(signal);
  const url = URL.createObjectURL(blob), anchor = document.createElement("a"); let handedOff = false;
  try {
    anchor.href = url; anchor.download = filename(title); anchor.hidden = true;
    document.body.appendChild(anchor); anchor.click(); handedOff = true;
  } finally {
    anchor.remove();
    if (handedOff) setTimeout(() => URL.revokeObjectURL(url), 1000);
    else URL.revokeObjectURL(url);
  }
}
