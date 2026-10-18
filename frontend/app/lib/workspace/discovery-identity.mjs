/** Stable scholarly identifiers shared by discovery buttons and saved Papers.
 * Titles are display text: two publications with the same title stay distinct.
 */
export function normalizeDiscoveryDoi(value) {
  const raw = typeof value === "string" ? value.trim().replace(/^doi:\s*/i, "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "") : "";
  return /^10\.\d{4,9}\/[^\s\u0000-\u001f]+$/i.test(raw) ? raw.toLowerCase() : "";
}
export function normalizeDiscoveryArxiv(value) {
  let raw = typeof value === "string" ? value.trim() : "";
  raw = raw.replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\//i, "").replace(/^arxiv:\s*/i, "").replace(/^10\.48550\/arxiv\./i, "").replace(/\.pdf$/i, "").replace(/v\d+$/i, "");
  return /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7})$/i.test(raw) ? raw.toLowerCase() : "";
}
export function normalizeDiscoveryOpenalex(value) {
  const raw = typeof value === "string" ? value.trim().replace(/^https?:\/\/openalex\.org\//i, "") : "";
  return /^W\d+$/i.test(raw) ? raw.toUpperCase() : "";
}
export function discoveryKeys(work = {}) {
  const keys = new Set();
  for (const value of [work.doi, work.id, work.url]) {
    const doi = normalizeDiscoveryDoi(value); if (doi) keys.add(`doi:${doi}`);
  }
  for (const value of [work.arxiv_id, work.id, work.url, work.pdf_url, work.doi]) {
    const arxiv = normalizeDiscoveryArxiv(value); if (arxiv) keys.add(`arxiv:${arxiv}`);
  }
  for (const value of [work.openalex_id, work.id, work.url]) {
    const openalex = normalizeDiscoveryOpenalex(value); if (openalex) keys.add(`openalex:${openalex}`);
  }
  const source = typeof work.source === "string" ? work.source.trim().toLowerCase() : "";
  const externalId = typeof work.id === "string" ? work.id.trim() : "";
  if (source && externalId && !/[\u0000-\u001f]/.test(source + externalId)) keys.add(`external:${source}:${externalId}`);
  return [...keys].sort();
}
export function paperDiscoveryKeys(paper = {}) {
  return [...new Set([...(Array.isArray(paper.discovery_identifiers) ? paper.discovery_identifiers : []), ...discoveryKeys(paper.external_source || {}), ...discoveryKeys({ doi: paper.metadata?.doi || paper.doi, arxiv_id: paper.arxiv_id })])].sort();
}
export function validateDiscoveryIdentifiers(keys) {
  if (!Array.isArray(keys) || keys.length > 100 || new Set(keys).size !== keys.length || keys.some(key => {
    if (typeof key !== "string" || key.length > 2300 || /[\u0000-\u001f]/.test(key)) return true;
    if (key.startsWith("doi:")) return key !== `doi:${normalizeDiscoveryDoi(key.slice(4))}` || key === "doi:";
    if (key.startsWith("arxiv:")) return key !== `arxiv:${normalizeDiscoveryArxiv(key.slice(6))}` || key === "arxiv:";
    if (key.startsWith("openalex:")) return key !== `openalex:${normalizeDiscoveryOpenalex(key.slice(9))}` || key === "openalex:";
    return !/^external:[^:]+:.+$/.test(key);
  })) throw new Error("The saved scholarly identifiers are invalid.");
  return keys;
}
