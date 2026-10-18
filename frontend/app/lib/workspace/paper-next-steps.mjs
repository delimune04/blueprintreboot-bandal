/** Citation edges require a verified OpenAlex work identity. */
export function openAlexWorkId(work) {
  return /(?:^|\/)(W\d+)$/.exec(String(work?.openalex_id || work?.id || "").replace(/\/$/, ""))?.[1] || "";
}

export function paperExplorationSource(paper) {
  const source = paper.external_source && typeof paper.external_source === "object" ? paper.external_source : {};
  return {
    ...source,
    id: source.id || paper.paper_id,
    title: paper.title || source.title || "",
    authors: paper.authors?.length ? paper.authors : source.authors || [],
    year: paper.year || source.year || "",
    doi: paper.doi || source.doi || "",
    arxiv_id: paper.arxiv_id || source.arxiv_id || "",
    abstract: paper.abstract || source.abstract || "",
    topics: source.topics?.length ? source.topics : paper.keywords?.length ? paper.keywords : paper.tags || [],
    url: source.url || "",
    pdf_url: source.pdf_url || "",
    source: source.source || "",
  };
}

export function relatedSearchPath(work, relation) {
  if (relation === "references" || relation === "cited_by") {
    const id = openAlexWorkId(work);
    if (!id) return "";
    return `/discover/related?${new URLSearchParams({ openalex_id: id, relation, limit: "12" })}`;
  }
  const topics = (work.topics || []).filter(value => typeof value === "string" && value.trim()).slice(0, 2);
  const query = (topics.length ? topics.join(" ") : String(work.title || "")).trim().slice(0, 300);
  if (!query) return "";
  return `/discover?${new URLSearchParams({ q: query, mode: "works", provider: "all", sort: "relevance", limit: "12" })}`;
}

/** A second click on an existing step returns there instead of creating a cycle. */
export function appendPaperTrail(trail, step) {
  const identity = openAlexWorkId(step.work) || step.work.id;
  const existing = trail.findIndex(item => (openAlexWorkId(item.work) || item.work.id) === identity && item.relation === step.relation);
  return existing < 0 ? [...trail, step] : [...trail.slice(0, existing), step];
}
