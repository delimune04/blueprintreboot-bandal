import { discoveryIndex, saveDiscoveryPaper } from "../../../../hosting/domain/discovery-library.mjs";
import { validatePdfFile } from "../demo/browser-storage.mjs";

/** Uses the demo adapter's existing transaction/effects boundary, never a
 * separate metadata store. A saved discovery work is an ordinary library Paper.
 */
export async function handleBrowserDiscovery(parts, method, body, state, effects, contract) {
  const path = parts.join("/");
  if (path === "papers/discovery-index" && method === "GET") return { handled: true, value: discoveryIndex(state) };
  if (path === "papers/from-discovery" && method === "POST") return { handled: true, value: saveDiscoveryPaper(state, body, contract.paperDetail) };
  if (parts[0] !== "papers" || parts.length !== 3 || parts[2] !== "pdf-attachment" || method !== "POST") return { handled: false };
  const { fail, guard, revision, paperDetail } = contract;
  if (!(body instanceof FormData) || [...body.keys()].some(key => !["file", "expected_pdf_revision"].includes(key)) || body.getAll("file").length !== 1 || body.getAll("expected_pdf_revision").length !== 1) fail(422, "Attach one PDF file with its expected PDF revision.");
  const paper = state.papers.find(row => row.paper_id === parts[1]); if (!paper) fail(404, "Paper not found.");
  guard(body.get("expected_pdf_revision"), paper.pdfVersion || 1);
  const file = body.get("file"); let verified;
  try { verified = await validatePdfFile(file); } catch (error) { fail(422, error.message); }
  if (!paper.pdfMissing) {
    if (paper.pdfSha256 !== verified.sha256) fail(409, "This Paper already has a PDF. Its current attachment and annotations were preserved.");
    return { handled: true, value: { status: "already_attached", paper_id: paper.paper_id, paper: paperDetail(paper, state), pdf_revision: revision(paper.pdfVersion || 1) } };
  }
  if (paper.pdfSha256 && paper.pdfSha256 !== verified.sha256) fail(409, "Select this Paper's original PDF to preserve its page annotations. The saved research was retained.");
  const filename = String(file.name || "paper.pdf").split(/[\\/]/).at(-1);
  if (filename.length > 255 || /^[a-z]:/i.test(filename) || /[\u0000-\u001f]/.test(filename)) fail(422, "The PDF filename is invalid.");
  const key = `pdf-${crypto.randomUUID()}`;
  effects.putFiles.push({ key, paper_id: paper.paper_id, filename, sha256: verified.sha256, kind: "active", created_at: new Date().toISOString(), blob: file });
  paper.pdfId = key; paper.filename = filename; paper.pdfSha256 = verified.sha256; paper.pdfMissing = false; paper.pdfVersion = (paper.pdfVersion || 1) + 1; paper.updated_at = new Date().toISOString();
  effects.revokedPaperIds.push(paper.paper_id);
  return { handled: true, value: { status: "attached", paper_id: paper.paper_id, paper: paperDetail(paper, state), pdf_revision: revision(paper.pdfVersion) } };
}
