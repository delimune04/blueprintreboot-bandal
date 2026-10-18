import * as c from "./core.mjs";
import { discoveryKeys, paperDiscoveryKeys, normalizeDiscoveryDoi, normalizeDiscoveryArxiv, normalizeDiscoveryOpenalex, validateDiscoveryIdentifiers } from "../../frontend/app/lib/workspace/discovery-identity.mjs";
import { paperPdfAccess, trustedPdfUrl } from "./pdf-access.mjs";

const TEXT = { id: 2048, title: 1000, year: 4, doi: 2048, abstract: 100000, url: 4096, pdf_url: 4096, source: 100, journal: 1000, arxiv_id: 200, openalex_id: 200, retrieved_at: 100, updated_at: 100, publication_date: 100, relation: 100 };
function list(value, max, limit) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > limit) c.fail(422, "The scholarly metadata list exceeds its supported limit.");
  return value.map(entry => c.text(entry, max, true).trim());
}
function url(value) {
  if (!value) return "";
  let parsed; try { parsed = new URL(value); } catch { c.fail(422, "The scholarly source URL is invalid."); }
  if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) c.fail(422, "The scholarly source requires a public HTTP or HTTPS URL.");
  return value;
}
/** Bounded source snapshot; does not fetch a provider or an arbitrary URL. */
export function normalizeDiscoveryWork(input) {
  if (!c.object(input)) c.fail(422, "Select a scholarly work to save.");
  const work = {};
  for (const [field, maximum] of Object.entries(TEXT)) work[field] = input[field] === undefined || input[field] === null ? "" : c.text(input[field], maximum, field === "title").trim();
  c.text(work.title, 1000, true);
  if (work.year && !/^\d{4}$/.test(work.year)) c.fail(422, "Publication year must contain four digits.");
  if (work.doi && !normalizeDiscoveryDoi(work.doi)) c.fail(422, "The scholarly DOI is invalid.");
  work.doi = normalizeDiscoveryDoi(work.doi);
  if (work.arxiv_id && !normalizeDiscoveryArxiv(work.arxiv_id)) c.fail(422, "The scholarly arXiv identifier is invalid.");
  work.arxiv_id = normalizeDiscoveryArxiv(work.arxiv_id);
  if (work.openalex_id && !normalizeDiscoveryOpenalex(work.openalex_id)) c.fail(422, "The scholarly OpenAlex identifier is invalid.");
  work.openalex_id = normalizeDiscoveryOpenalex(work.openalex_id);
  work.url = url(work.url); work.pdf_url = url(work.pdf_url);
  work.authors = list(input.authors, 500, 100);
  if (work.authors.join("; ").length > c.METADATA_LIMITS.authors) c.fail(422, "The author list exceeds this Paper's supported metadata limit.");
  for (const field of ["topics", "keywords", "affiliations", "providers"]) work[field] = list(input[field], 1000, 100);
  work.references = list(input.references, 2048, 1500);
  work.related_ids = list(input.related_ids, 200, 100);
  work.topic_ids = list(input.topic_ids, 200, 100);
  for (const field of ["citation_count", "cited_by_count"]) {
    const value = input[field];
    if (value !== undefined && value !== null && (!Number.isSafeInteger(value) || value < 0)) c.fail(422, "The scholarly citation count is invalid.");
    work[field] = value ?? null;
  }
  if (!discoveryKeys(work).length) c.fail(422, "A DOI, arXiv, OpenAlex, or provider identifier is required to save this work.");
  return work;
}
export function validateDiscoverySource(work) { normalizeDiscoveryWork(work); return work; }
export function discoveryIndex(state) {
  return { items: state.papers.map(paper => ({ paper_id: paper.paper_id, keys: paperDiscoveryKeys(paper) })).filter(row => row.keys.length) };
}
export function saveDiscoveryPaper(state, body, detail = c.paperDetail) {
  c.strict(body, ["work"]);
  const work = normalizeDiscoveryWork(body.work), keys = discoveryKeys(work), identities = new Set(keys);
  const matches = state.papers.filter(paper => paperDiscoveryKeys(paper).some(key => identities.has(key)));
  if (matches.length > 1) c.fail(409, "These scholarly identifiers match more than one saved Paper. Review the library; no Papers were merged.", "identity_ambiguous");
  if (matches.length) {
    const paper = matches[0], known = paperDiscoveryKeys(paper), aliases = [...new Set([...known, ...keys])].sort();
    if (aliases.length > 100) c.fail(422, "This Paper reached its scholarly identifier limit. Its saved research was retained.");
    validateDiscoveryIdentifiers(aliases);
    // Learning another provider's explicit ID from the same DOI/arXiv record
    // keeps future provider-only results idempotent. Existing notes and user
    // metadata stay authoritative; no Paper records are merged.
    if (JSON.stringify(known) !== JSON.stringify(aliases)) paper.discovery_identifiers = aliases;
    if (!paper.external_source) paper.external_source = work;
    return { status: "already_saved", paper_id: paper.paper_id, paper: detail(paper, state), destination: "library", keys: paperDiscoveryKeys(paper) };
  }
  if (state.papers.length >= 1000) c.fail(422, "This workspace supports at most 1,000 Papers.");
  const paper = { paper_id: c.id("paper-"), metadata: c.metadata({ title: work.title, authors: work.authors.join("; "), year: work.year, journal: work.journal, doi: work.doi, abstract: work.abstract, keywords: [...new Set([...work.keywords, ...work.topics])].join(", ") }, false), arxiv_id: work.arxiv_id || normalizeDiscoveryArxiv(work.id) || normalizeDiscoveryArxiv(work.doi), external_source: work, tags: [], status: "unread", priority: "normal", archived: false, metadataRev: 1, tagsRev: 1, statusRev: 1, priorityRev: 1, lifecycleRev: 1, blocksRev: 1, pdfRev: 1, pdfVersion: 1, candidatesRev: 1, pdfMissing: true, note: "", noteExists: false, blocks: [], fullText: "", created_at: c.now(), updated_at: c.now() };
  paper.discovery_identifiers = keys;
  state.papers.push(paper);
  return { status: "saved", paper_id: paper.paper_id, paper: detail(paper, state), destination: "library", keys: paperDiscoveryKeys(paper) };
}
export async function attachDiscoveryPdf(state, paperId, form, ctx) {
  if (!(form instanceof FormData) || [...form.keys()].some(key => !["file", "expected_pdf_revision"].includes(key)) || form.getAll("file").length !== 1 || form.getAll("expected_pdf_revision").length !== 1) c.fail(422, "Attach one PDF file with its expected PDF revision.");
  const paper = c.paperById(state, paperId); c.guard(form.get("expected_pdf_revision"), paper.pdfRev || 1);
  const file = form.get("file"), filename = String(file?.name || "").replaceAll("\\", "/").split("/").at(-1);
  if (!(file instanceof Blob) || !filename || !/\.pdf$/i.test(filename) || filename.length > 220 || /^[a-z]:/i.test(filename) || /[\u0000-\u001f]/.test(filename) || file.size < 8 || file.size > 25 * 1024 * 1024) c.fail(422, "Choose a PDF file of up to 25 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!new TextDecoder("latin1").decode(bytes.slice(0, 4096)).includes("%PDF-")) c.fail(422, "The selected file has no PDF header.");
  const sha256 = await c.sha256(bytes);
  if (c.hasPdf(paper, state)) {
    if (state.files[paper.pdfPath].sha256 !== sha256) c.fail(409, "This Paper already has a PDF. Its current attachment and annotations were preserved.");
    return { status: "already_attached", paper_id: paper.paper_id, paper: c.paperDetail(paper, state), pdf_revision: c.rev(paper.pdfRev || 1) };
  }
  if (paper.pdfSha256 && paper.pdfSha256 !== sha256) c.fail(409, "Select this Paper's original PDF to preserve its page annotations. The saved research was retained.");
  let path = filename, sequence = 2; while (state.files[path]) path = `${filename.replace(/\.pdf$/i, "")} (${sequence++}).pdf`;
  const stored = await ctx.putObject("pdfs", bytes, { contentType: "application/pdf" });
  state.files[path] = { ...stored, filename: path };
  paper.pdfPath = path; paper.pdfSha256 = sha256; paper.pdfMissing = false; paper.pdfRev = (paper.pdfRev || 1) + 1; paper.updated_at = c.now();
  return { status: "attached", paper_id: paper.paper_id, paper: c.paperDetail(paper, state), pdf_revision: c.rev(paper.pdfRev) };
}

async function readPdfBytes(response, signal) {
  const maximum = 25 * 1024 * 1024;
  if (Number(response.headers.get("content-length") || 0) > maximum) c.fail(413, "The source PDF exceeds the 25 MiB hosted limit. Attach a smaller PDF or use the local application.");
  if (!response.body) c.fail(503, "The source returned no PDF bytes. Your library entry and notes were retained.");
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new DOMException("PDF import timed out.", "AbortError");
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > maximum) { await reader.cancel(); c.fail(413, "The source PDF exceeds the 25 MiB hosted limit. Your library entry and notes were retained."); }
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
/** Fetches only the saved provider URL, with a host check before every hop. */
export async function importSourcePdf(state, paperId, body, ctx) {
  c.strict(body, ["expected_pdf_revision"]);
  const paper = c.paperById(state, paperId); c.guard(body.expected_pdf_revision, paper.pdfRev || 1);
  if (c.hasPdf(paper, state)) return { status: "already_attached", paper_id: paper.paper_id, paper: c.paperDetail(paper, state), pdf_revision: c.rev(paper.pdfRev || 1) };
  const access = await paperPdfAccess(paper, state, ctx.env || {}, ctx.fetch || fetch);
  if (!access.can_import || !access.pdf_url) c.fail(422, access.reason === "provider_unavailable" ? "The public full-text lookup is temporarily unavailable. Open the source or attach the PDF file; your saved research was retained." : "No directly importable open-access PDF was found for this exact work. Open the source or attach the PDF file; your saved research was retained.");
  let source = trustedPdfUrl(access.pdf_url);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
  try {
    let response;
    for (let redirects = 0; redirects <= 3; redirects++) {
      response = await (ctx.fetch || fetch)(source.toString(), { redirect: "manual", signal: controller.signal, headers: { Accept: "application/pdf", "User-Agent": "Labvium/1.0 (explicit open-access PDF import)" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location"); await response.body?.cancel();
        if (!location || redirects === 3) c.fail(503, "The source redirected too many times. Download and attach its PDF file instead.");
        source = trustedPdfUrl(new URL(location, source).toString()); continue;
      }
      if (!response.ok) { await response.body?.cancel(); c.fail(503, "The publisher could not provide its open-access PDF. Open the source and attach a PDF file; your saved research was retained."); }
      break;
    }
    const bytes = await readPdfBytes(response, controller.signal);
    if (!new TextDecoder("latin1").decode(bytes.slice(0, 4096)).includes("%PDF-")) c.fail(422, "The source returned a web page instead of a PDF. Open the source and attach the PDF file; your library entry is already saved.");
    const form = new FormData();
    form.set("file", new File([bytes], `${paper.paper_id}.pdf`, { type: "application/pdf" })); form.set("expected_pdf_revision", body.expected_pdf_revision);
    return await attachDiscoveryPdf(state, paperId, form, ctx);
  } catch (error) {
    if (error instanceof c.APIError) throw error;
    c.fail(503, controller.signal.aborted ? "The PDF download timed out. Your library entry and notes were retained; attach the PDF file to continue." : "The PDF download failed. Your library entry and notes were retained; attach the PDF file to continue.");
  } finally { clearTimeout(timer); }
}
