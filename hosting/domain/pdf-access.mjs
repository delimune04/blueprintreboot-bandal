import { fail, hasPdf } from "./core.mjs";
import { providerGet } from "./providers.mjs";
import { normalizeDiscoveryDoi, normalizeDiscoveryArxiv, normalizeDiscoveryOpenalex } from "../../frontend/app/lib/workspace/discovery-identity.mjs";

// Explicit repositories and publishers serving open-access research. Every
// redirect is checked against this same list by the import command.
const PDF_HOSTS = new Set(["arxiv.org", "export.arxiv.org", "aclanthology.org", "openaccess.thecvf.com", "proceedings.neurips.cc", "papers.nips.cc", "proceedings.mlr.press", "jmlr.org", "www.jmlr.org", "pmc.ncbi.nlm.nih.gov", "cdn.ncbi.nlm.nih.gov", "europepmc.org", "www.biorxiv.org", "biorxiv.org", "www.medrxiv.org", "medrxiv.org", "journals.plos.org", "elifesciences.org", "www.frontiersin.org", "frontiersin.org", "ojs.aaai.org", "zenodo.org", "osf.io"]);
function safeLink(value) {
  if (typeof value !== "string" || value.length > 4096 || /[\u0000-\u001f]/.test(value)) return "";
  try {
    const parsed = new URL(value), hostname = parsed.hostname.toLowerCase();
    if (!hostname.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.startsWith("[") || /(?:^|\.)(?:localhost|local|internal)$/.test(hostname)) return "";
    return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.toString() : "";
  } catch { return ""; }
}
export function canImportPdfUrl(value) {
  try { const parsed = new URL(value); return parsed.protocol === "https:" && PDF_HOSTS.has(parsed.hostname) && !parsed.username && !parsed.password && !parsed.port; } catch { return false; }
}
export function trustedPdfUrl(value) {
  if (!canImportPdfUrl(value)) fail(422, "This publisher cannot be imported directly. Open its source and attach the PDF file; your library entry is already saved.");
  return new URL(value);
}
function arxivIdentifier(value) {
  if (typeof value !== "string") return "";
  const raw = value.trim().replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\//i, "").replace(/^arxiv:\s*/i, "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^10\.48550\/arxiv\./i, "").replace(/\.pdf$/i, "");
  return normalizeDiscoveryArxiv(raw) ? raw : "";
}
/** Only established repository URL formats have deterministic PDF mappings. */
export function repositoryPdfUrl(value) {
  const arxiv = arxivIdentifier(value); if (arxiv) return `https://arxiv.org/pdf/${arxiv}`;
  const link = safeLink(value); if (!link) return "";
  const parsed = new URL(link), path = parsed.pathname;
  if (parsed.protocol !== "https:") return "";
  if (canImportPdfUrl(link) && /\.pdf$/i.test(path)) return link;
  if (["aclanthology.org", "www.aclweb.org", "aclweb.org"].includes(parsed.hostname)) {
    const identifier = /^\/(?:anthology\/)?(\d{4}\.[a-z0-9-]+\.\d+|[a-z]\d{2}-\d{4})(?:\/|\.pdf)?$/i.exec(path)?.[1];
    if (identifier) return `https://aclanthology.org/${identifier}.pdf`;
  }
  if (parsed.hostname === "openaccess.thecvf.com" && /\/html\/[^/]+\.html$/.test(path)) return `${parsed.origin}${path.replace("/html/", "/papers/").replace(/\.html$/, ".pdf")}`;
  if (["proceedings.neurips.cc", "papers.nips.cc"].includes(parsed.hostname)) {
    const match = /^(\/(?:paper_files\/)?paper\/\d{4})\/hash\/([a-f0-9]{32})-Abstract(-Conference)?\.html$/i.exec(path);
    if (match) return `https://proceedings.neurips.cc${match[1]}/file/${match[2]}-Paper${match[3] || ""}.pdf`;
  }
  if (parsed.hostname === "proceedings.mlr.press") {
    const match = /^\/(v\d+)\/([a-z0-9-]+)\.html$/i.exec(path);
    if (match) return `${parsed.origin}/${match[1]}/${match[2]}/${match[2]}.pdf`;
  }
  if (["jmlr.org", "www.jmlr.org"].includes(parsed.hostname)) {
    const match = /^\/papers\/v(\d+)\/([a-z0-9-]+)\.html$/i.exec(path);
    if (match) return `https://jmlr.org/papers/volume${match[1]}/${match[2]}/${match[2]}.pdf`;
  }
  return "";
}
function response(status, pdfUrl, sourceUrl, reason) { return { status, pdf_url: pdfUrl || "", source_url: sourceUrl || "", can_import: Boolean(pdfUrl && canImportPdfUrl(pdfUrl)), reason }; }
function exactIdentity(input) {
  const doi = normalizeDiscoveryDoi(input.doi) || normalizeDiscoveryDoi(input.id);
  const openalex = normalizeDiscoveryOpenalex(input.openalex_id) || normalizeDiscoveryOpenalex(input.id) || normalizeDiscoveryOpenalex(input.url);
  const arxiv = [input.id, input.url, input.pdf_url, input.arxiv_id, input.doi].map(arxivIdentifier).find(Boolean) || "";
  return { doi, openalex, arxiv };
}
function sourceFor(input, identity) {
  return safeLink(input.url) || (identity.doi ? `https://doi.org/${identity.doi}` : identity.arxiv ? `https://arxiv.org/abs/${identity.arxiv}` : identity.openalex ? `https://openalex.org/${identity.openalex}` : "");
}
function openalexAccess(row, identity, fallback) {
  if (!row || (identity.openalex && normalizeDiscoveryOpenalex(row.id) !== identity.openalex) || (identity.doi && normalizeDiscoveryDoi(row.doi) !== identity.doi)) return { mismatch: true };
  const entries = [row.best_oa_location && { ...row.best_oa_location, is_oa: row.best_oa_location.is_oa !== false }, ...(Array.isArray(row.locations) ? row.locations.slice(0, 100) : []), row.primary_location].filter(location => location?.is_oa === true);
  const candidates = entries.map(location => ({ pdf: safeLink(location.pdf_url) || repositoryPdfUrl(location.landing_page_url), source: safeLink(location.landing_page_url) })).filter(location => location.pdf);
  if (row.open_access?.is_oa === true) {
    const mapped = repositoryPdfUrl(row.open_access.oa_url); if (mapped) candidates.push({ pdf: mapped, source: safeLink(row.open_access.oa_url) });
  }
  const candidate = candidates.find(location => canImportPdfUrl(location.pdf)) || candidates[0];
  const source = candidate?.source || safeLink(row.best_oa_location?.landing_page_url) || safeLink(row.primary_location?.landing_page_url) || fallback;
  return candidate ? { result: response("open_access", candidate.pdf, source, canImportPdfUrl(candidate.pdf) ? "openalex_open_access" : "external_open_access") } : { source };
}
/** Resolve full text only from the work's exact identifiers or saved links.
 * It never queries by title, fetches an arbitrary caller URL, or mutates state.
 */
export async function resolvePdfAccess(input = {}, env = {}, fetchImpl = fetch) {
  const identity = exactIdentity(input), source = sourceFor(input, identity), storedPdf = safeLink(input.pdf_url);
  if (storedPdf && canImportPdfUrl(storedPdf)) return response("open_access", storedPdf, source || storedPdf, "saved_pdf_link");
  if (identity.arxiv) return response("open_access", `https://arxiv.org/pdf/${identity.arxiv}`, source || `https://arxiv.org/abs/${identity.arxiv}`, "arxiv");
  const mapped = repositoryPdfUrl(input.url) || repositoryPdfUrl(input.id);
  if (mapped) return response("open_access", mapped, source || mapped, "repository_pdf");
  if (!identity.doi && !identity.openalex) return response(source || storedPdf ? "source_only" : "unavailable", "", source || storedPdf, "no_exact_identifier");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
  let providerFailure = false, resolvedSource = source;
  try {
    try {
      const endpoint = identity.openalex ? `https://api.openalex.org/works/${identity.openalex}` : `https://api.openalex.org/works/doi:${encodeURIComponent(identity.doi)}`;
      const row = await providerGet(endpoint, env, fetchImpl, { signal: controller.signal, timeoutMs: 6500 });
      const access = openalexAccess(row, identity, source);
      if (access.mismatch) return response("source_only", "", source, "identifier_mismatch");
      if (access.result) return access.result;
      resolvedSource = access.source || source;
    } catch { providerFailure = true; }
    if (identity.doi && !controller.signal.aborted) {
      try {
        const data = await providerGet(`https://api.crossref.org/works/${encodeURIComponent(identity.doi)}`, env, fetchImpl, { signal: controller.signal, timeoutMs: 4000 });
        const row = data?.message;
        if (normalizeDiscoveryDoi(row?.DOI) !== identity.doi) return response("source_only", "", resolvedSource, "identifier_mismatch");
        const landing = safeLink(row.resource?.primary?.URL) || safeLink(row.URL) || resolvedSource;
        const mappedCrossref = repositoryPdfUrl(landing);
        const explicit = (Array.isArray(row.link) ? row.link.slice(0, 100) : []).filter(link => link?.["content-type"] === "application/pdf").map(link => safeLink(link.URL)).find(link => link && canImportPdfUrl(link));
        if (mappedCrossref || explicit) return response("open_access", mappedCrossref || explicit, landing, "crossref_repository_pdf");
        resolvedSource = landing;
      } catch { providerFailure = true; }
    }
    return response(resolvedSource || storedPdf ? "source_only" : "unavailable", "", resolvedSource || storedPdf, providerFailure ? "provider_unavailable" : "no_open_access_pdf");
  } finally { clearTimeout(timer); }
}
export function pdfAccessQuery(params) {
  const allowed = ["doi", "arxiv_id", "openalex_id"];
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) fail(422, "PDF access accepts exact DOI, arXiv, or OpenAlex identifiers only.");
  const input = {};
  for (const key of allowed) {
    const raw = params.get(key); if (raw === null || raw === "") continue;
    if (raw.length > 2048 || /[\u0000-\u001f]/.test(raw)) fail(422, "The scholarly identifier is invalid.");
    const valid = key === "doi" ? normalizeDiscoveryDoi(raw) : key === "arxiv_id" ? arxivIdentifier(raw) : normalizeDiscoveryOpenalex(raw);
    if (!valid) fail(422, "The scholarly identifier is invalid.");
    input[key] = valid;
  }
  if (!Object.keys(input).length) fail(422, "Supply a DOI, arXiv, or OpenAlex identifier to resolve this PDF.");
  return input;
}
export async function paperPdfAccess(paper, state, env = {}, fetchImpl = fetch) {
  if (hasPdf(paper, state)) return response("available", `/ku-ai/api/papers/${encodeURIComponent(paper.paper_id)}/pdf`, safeLink(paper.external_source?.url), "managed_pdf");
  const source = paper.external_source || {};
  return resolvePdfAccess({ ...source, doi: paper.metadata?.doi || source.doi || "", arxiv_id: paper.arxiv_id || source.arxiv_id || "" }, env, fetchImpl);
}
