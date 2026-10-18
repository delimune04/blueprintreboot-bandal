import { choice, fail, text } from "./core.mjs";

export const DISCOVERY_SORTS = ["relevance", "citations", "newest", "oldest", "popularity"];

export function discoveryOptions(params) {
  const q = text(params.get("q") || "", 300).trim();
  const author = text(params.get("author") || "", 200).trim();
  const provider = choice(params.get("provider") || "crossref", ["all", "crossref", "arxiv", "openalex"]);
  const mode = choice(params.get("mode") || "works", ["works", "authors"]);
  const sort = choice(params.get("sort") || "relevance", DISCOVERY_SORTS);
  const exactValue = params.get("exact_title");
  if (exactValue !== null && !["0", "1"].includes(exactValue)) fail(422, "Exact title must be zero or one.");
  const exact_title = exactValue === "1";
  const limit = Number(params.get("limit") || 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail(422, "Discovery limit must be between one and 50.");
  if (!q && !author) fail(422, "Enter a paper title, topic, or author name.");
  if (exact_title && !q) fail(422, "Exact-title search requires a title.");
  if (q && !searchTokens(q).length || author && !searchTokens(author).length) fail(422, "Search text must include letters or numbers.");
  if (mode === "authors") {
    if (provider !== "openalex") fail(422, "Author profiles require the OpenAlex provider.");
    if (!q || author || exact_title || sort !== "relevance") fail(422, "Author profiles use a name query without paper filters or paper sorting.");
  }
  if (provider === "arxiv" && ["citations", "popularity"].includes(sort)) fail(422, "arXiv does not supply citation counts. Select another source for citation or popularity sorting.");
  return { q, author, provider, mode, sort, exact_title, limit };
}

// Use plain tokens in provider query languages. URLSearchParams handles URL
// encoding; punctuation never becomes an injected field, operator, or filter.
export function searchTokens(value) {
  return String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en").match(/[\p{L}\p{N}]+/gu) || [];
}
export const normalizedSearch = value => searchTokens(value).join(" ");
export const queryPhrase = value => `"${searchTokens(value).join(" ")}"`;
export const queryWords = value => searchTokens(value).map(token => `"${token}"`).join(" AND ");
export const queryTerms = (value, field) => searchTokens(value).map(token => `${field}:"${token}"`).join(" AND ");

export function publicationDate(value) {
  const parts = Array.isArray(value) ? value : typeof value === "string" && /^\d{4}(?:-\d{2})?(?:-\d{2})?$/.test(value) ? value.split("-").map(Number) : [];
  if (!parts.length || parts.length > 3 || !parts.every(Number.isInteger) || parts[0] < 1 || parts[0] > 9999) return null;
  if (parts.length > 1 && (parts[1] < 1 || parts[1] > 12)) return null;
  if (parts.length > 2) {
    const date = new Date(0); date.setUTCFullYear(parts[0], parts[1] - 1, parts[2]); date.setUTCHours(0, 0, 0, 0);
    if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2]) return null;
  }
  return parts.map((part, index) => String(part).padStart(index ? 2 : 4, "0")).join("-");
}

export function authorMatches(authors, query) {
  const wanted = searchTokens(query);
  if (!wanted.length) return true;
  return authors.some(name => {
    const tokens = searchTokens(name);
    const substantive = wanted.filter(token => token.length > 1);
    if (substantive.length && !substantive.some(token => tokens.includes(token))) return false;
    const surname = String(query).includes(",") ? searchTokens(String(query).split(",")[0]).at(-1) : wanted.at(-1);
    if (surname?.length > 1 && !tokens.includes(surname)) return false;
    // A full name must occur within one byline. Initials and comma-reversed
    // names are supported without mixing tokens from two different authors.
    return wanted.every(token => tokens.some(actual => actual === token || token.length === 1 && actual.startsWith(token) || actual.length === 1 && token.startsWith(actual)));
  });
}

export function titleMatches(title, query) {
  const actual = new Set(searchTokens(title));
  return searchTokens(query).every(token => actual.has(token));
}

export function canonicalArxivId(value) {
  const raw = String(value || "").trim().replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, "").replace(/\.pdf$/i, "").replace(/v\d+$/i, "");
  return /^(?:\d{4}\.\d{4,5}|[a-z][a-z.\-]+(?:\.[A-Z]{2})?\/\d{7})$/i.test(raw) ? raw.toLowerCase() : "";
}

function identities(item) {
  const keys = [];
  const doi = String(item.doi || "").trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").toLowerCase();
  if (/^10\.\d{4,9}\/\S+$/.test(doi)) keys.push(`doi:${doi}`);
  const arxiv = canonicalArxivId(item.arxiv_id || item.url) || (item.source === "arXiv" ? canonicalArxivId(item.id) : "");
  if (arxiv) keys.push(`arxiv:${arxiv}`);
  // DataCite's arXiv DOI and the native arXiv identifier are one work.
  const doiArxiv = /^10\.48550\/arxiv\.(.+)$/i.exec(doi)?.[1];
  if (doiArxiv && canonicalArxivId(doiArxiv)) keys.push(`arxiv:${canonicalArxivId(doiArxiv)}`);
  if (item.id) keys.push(`provider:${item.source}:${String(item.id).trim().toLowerCase()}`);
  return keys;
}

export function deduplicateWorks(items) {
  const groups = [], keyGroups = new Map();
  for (const item of items) {
    const keys = identities(item), matches = [...new Set(keys.map(key => keyGroups.get(key)).filter(Boolean))];
    const group = matches[0] || { item, keys: new Set(), removed: false };
    if (!matches.length) groups.push(group);
    for (const match of matches.slice(1)) { match.removed = true; for (const key of match.keys) { group.keys.add(key); keyGroups.set(key, group); } }
    for (const key of keys) { group.keys.add(key); keyGroups.set(key, group); }
    if (matches.length) {
      // Keep the preferred source's actual metadata. Only fill absent fields
      // from a record sharing a stable identity, and retain source attribution.
      group.item = { ...group.item };
      for (const candidate of [...matches.slice(1).map(match => match.item), item]) {
        group.item.providers = [...new Set([...(group.item.providers || [group.item.source]), ...(candidate.providers || [candidate.source])])];
        for (const field of ["doi", "arxiv_id", "openalex_id", "journal", "publication_date", "pdf_url", "abstract"])
          if (!group.item[field] && candidate[field]) group.item[field] = candidate[field];
        if (!group.item.affiliations?.length && candidate.affiliations?.length) group.item.affiliations = candidate.affiliations;
      }
      // Counts from different indexes are not interchangeable. Preserve the
      // selected record's null count rather than borrowing another source's.
    }
  }
  const unique = groups.filter(group => !group.removed).map(group => group.item);
  return { items: unique, duplicates_removed: items.length - unique.length };
}

const citationCount = item => Number.isSafeInteger(item.citation_count) && item.citation_count >= 0 ? item.citation_count : Number.isSafeInteger(item.cited_by_count) && item.cited_by_count >= 0 ? item.cited_by_count : null;
const compareKnown = (a, b, direction) => a === null ? b === null ? 0 : 1 : b === null ? -1 : direction * (a < b ? -1 : a > b ? 1 : 0);
const publicationSortKey = item => {
  const date = publicationDate(item.publication_date) || publicationDate(item.year);
  // A partial date sorts by its earliest possible day. Its actual precision is
  // retained in the public metadata; this does not establish original status.
  return date ? `${date.slice(0, 4)}-${date.slice(5, 7) || "01"}-${date.slice(8, 10) || "01"}` : null;
};

export function prepareWorks(items, options, currentYear = new Date().getUTCFullYear()) {
  const q = normalizedSearch(options.q);
  const queryDoi = String(options.q || "").trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").toLowerCase();
  const queryArxiv = canonicalArxivId(options.q) || canonicalArxivId(/^10\.48550\/arxiv\.(.+)$/i.exec(queryDoi)?.[1]);
  const queryIsIdentifier = /^10\.\d{4,9}\/\S+$/.test(queryDoi) || !!queryArxiv;
  const matchesQuery = item => /^10\.\d{4,9}\/\S+$/.test(queryDoi) ? String(item.doi || "").toLowerCase() === queryDoi || !!queryArxiv && canonicalArxivId(item.arxiv_id || item.url || item.id) === queryArxiv : queryArxiv ? canonicalArxivId(item.arxiv_id || item.url || item.id) === queryArxiv : titleMatches(item.title, options.q);
  const filtered = items.filter(item => (!options.author || authorMatches(item.authors || [], options.author)) && (queryIsIdentifier ? matchesQuery(item) : (!options.exact_title || normalizedSearch(item.title) === q) && (!(options.q && options.author) || matchesQuery(item))));
  const postfiltered_count = items.length - filtered.length;
  const ranked = filtered.map((item, index) => {
    const citations = citationCount(item), year = /^\d{4}$/.test(String(item.year)) ? Number(item.year) : null;
    const popularity_score = citations !== null && year !== null && year > 0 && year <= currentYear ? citations / Math.max(1, currentYear - year + 1) : null;
    return { ...item, citation_count: citations, cited_by_count: citations, popularity_score, popularity_basis: popularity_score === null ? null : "annual_citations", _index: index };
  });
  ranked.sort((a, b) => {
    if (options.sort === "citations") return compareKnown(a.citation_count, b.citation_count, -1) || a._index - b._index;
    if (options.sort === "popularity") return compareKnown(a.popularity_score, b.popularity_score, -1) || compareKnown(a.citation_count, b.citation_count, -1) || a._index - b._index;
    if (["newest", "oldest"].includes(options.sort)) {
      return compareKnown(publicationSortKey(a), publicationSortKey(b), options.sort === "newest" ? -1 : 1) || a._index - b._index;
    }
    const exactA = q && normalizedSearch(a.title) === q ? 1 : 0, exactB = q && normalizedSearch(b.title) === q ? 1 : 0;
    // Identical titles can have many later records. Give the earlier dated
    // record a fair position even when its source supplies no citation count.
    // Non-exact matches continue in provider relevance order.
    return exactB - exactA || (exactA && exactB ? compareKnown(publicationSortKey(a), publicationSortKey(b), 1) || compareKnown(a.citation_count, b.citation_count, -1) : 0) || a._index - b._index;
  });
  const deduplicated = deduplicateWorks(ranked.map(({ _index, ...item }) => item));
  return { ...deduplicated, postfiltered_count };
}
