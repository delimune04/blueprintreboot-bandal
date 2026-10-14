/** Local lexical retrieval and consent preview; no model or network calls. */
export const AI_TASKS = ["question", "summary", "compare", "gaps", "handoff"];
function fail(message, status = 422) { const error = new Error(message); error.status = status; throw error; }
const words = (value) => String(value).normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
const hash = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((b) => b.toString(16).padStart(2, "0")).join("");
export function rankEvidence(sources, query) {
  const tokens = [...new Set(words(query))], bags = sources.map((source) => { const bag = new Map(); for (const word of words(`${source.title} ${source.text}`)) bag.set(word, (bag.get(word) || 0) + 1); return bag; });
  const lengths = bags.map((bag) => [...bag.values()].reduce((a, b) => a + b, 0)), average = lengths.reduce((a, b) => a + b, 0) / Math.max(1, bags.length) || 1;
  const frequency = new Map(tokens.map((token) => [token, bags.filter((bag) => bag.has(token)).length]));
  return sources.map((source, index) => ({ ...source, retrieval_score: tokens.reduce((score, token) => { const tf = bags[index].get(token) || 0, df = frequency.get(token); return score + Math.log(1 + (bags.length - df + 0.5) / (df + 0.5)) * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * lengths[index] / average)); }, 0), sequence: index })).sort((a, b) => b.retrieval_score - a.retrieval_score || a.sequence - b.sequence).map((source) => { const value = { ...source }; delete value.sequence; return value; });
}
export async function prepareAiSources(state, input) {
  if (!input || typeof input.question !== "string" || input.question.length > 4000) fail("Enter a research question of up to 4000 characters.");
  if (input.paper_ids !== undefined && (!Array.isArray(input.paper_ids) || input.paper_ids.length > 100 || input.paper_ids.some((id) => typeof id !== "string"))) fail("Select a bounded Paper collection.");
  let selected = input.paper_ids ? new Set(input.paper_ids) : null, projectLinks = null;
  if (input.project_id) {
    const project = state.projects.find((row) => row.project_id === input.project_id); if (!project) fail("Project not found.", 404);
    projectLinks = project.links;
    const linked = new Set(project.links.map((link) => link.paper_id)); selected = selected ? new Set([...selected].filter((id) => linked.has(id))) : linked;
  }
  if (!selected || !selected.size) fail("Choose a Paper or a project with linked Papers before preparing an AI request.");
  for (const id of selected) if (!state.papers.some((paper) => paper.paper_id === id)) fail("A selected Paper is unavailable or outside this workspace.", 404);
  const sources = []; let availableUnits = 0, omittedUnits = 0, scannedCharacters = 0, excludedPdfPages = 0;
  const sourceContexts = [];
  function add(paper, kind, content, page = null, block_id = null) {
    if (!content?.trim()) return; availableUnits++;
    if (scannedCharacters + content.length > 4000000 || sources.length >= 2000) { omittedUnits++; return; }
    scannedCharacters += content.length;
    for (let offset = 0, index = 0; offset < content.length && sources.length < 2000; offset += 1500, index++) {
      const text = content.slice(offset, offset + 1700); if (!text.trim()) continue;
      const currentPdfHash = state.files?.[paper.pdfPath]?.sha256 || paper.pdfSha256 || "";
      sources.push({ id: `${paper.paper_id}:${kind}:${block_id || page || 0}:${index}`, paper_id: paper.paper_id, title: paper.metadata.title, page, ...(block_id ? { block_id } : {}), text, kind, source_pdf_sha256: currentPdfHash, extraction_sha256: paper.fullTextCache?.sha256 || paper.fullTextCache?.source_pdf_sha256 || "", extraction_provider: paper.fullTextCache?.provider || "" });
    }
  }
  for (const paper of state.papers.filter((row) => selected.has(row.paper_id) && !row.archived)) {
    const paperLinks = projectLinks?.filter((link) => link.paper_id === paper.paper_id);
    const wholePaper = !paperLinks || paperLinks.some((link) => link.target_type === "paper");
    const actualHash = state.files?.[paper.pdfPath]?.sha256 || paper.pdfSha256 || "", cacheHash = paper.fullTextCache?.sha256 || paper.fullTextCache?.source_pdf_sha256 || "";
    const currentCache = !paper.pdfMissing && /^[a-f0-9]{64}$/.test(actualHash) && cacheHash === actualHash;
    sourceContexts.push({ paper_id: paper.paper_id, actualHash, cacheHash, missing: Boolean(paper.pdfMissing), extraction_provider: paper.fullTextCache?.provider || "" });
    if (wholePaper && currentCache) for (const page of paper.fullTextCache?.pages || []) add(paper, "pdf-page", page.text, page.page_number);
    else if (wholePaper) excludedPdfPages += paper.fullTextCache?.pages?.length || 0;
    for (const block of paper.blocks || []) if (wholePaper || paperLinks.some((link) => link.target_type === "note_block" && link.target_id === block.id)) add(paper, "note-block", block.text, Number(block.page) || null, block.id);
    if (wholePaper && paper.noteExists) add(paper, "reading-note", paper.note);
  }
  if (!sources.length) fail("Extract a selected PDF or save its research notes before preparing an AI request.");
  const ranked = rankEvidence(sources, input.question), selectedSources = ranked.slice(0, 40);
  return { sources: selectedSources, revision: await hash(JSON.stringify({ question: input.question, contexts: sourceContexts, sources: selectedSources })), coverage: { method: "BM25 lexical retrieval", paper_count: selected.size, available_units: availableUnits, candidate_chunks: sources.length, returned_chunks: selectedSources.length, omitted_units: omittedUnits, excluded_pdf_pages: excludedPdfPages, limited: omittedUnits > 0 || sources.length > 40 || excludedPdfPages > 0, semantic_search: false } };
}
export async function selectAiEvidence(state, input) {
  const preview = await prepareAiSources(state, input);
  if (input.sources_revision !== preview.revision) fail("The selected evidence or question changed. Preview the sources again before sending.", 409);
  if (!Array.isArray(input.source_ids) || !input.source_ids.length || input.source_ids.length > 30 || new Set(input.source_ids).size !== input.source_ids.length) fail("Select one to thirty evidence excerpts.");
  const available = new Map(preview.sources.map((source) => [source.id, source]));
  const sources = input.source_ids.map((id) => { const source = available.get(id); if (!source) fail("A selected excerpt is outside the current evidence preview.", 409); const value = { ...source }; delete value.retrieval_score; return value; });
  if (!AI_TASKS.includes(input.task || "question")) fail("Unsupported research task.");
  return { question: input.question, locale: input.locale === "en" ? "en" : "ko", task: input.task || "question", sources };
}
