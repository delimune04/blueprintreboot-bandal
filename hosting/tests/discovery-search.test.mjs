import test from "node:test";
import assert from "node:assert/strict";
import { discover, crossrefItem, openalexItem } from "../domain/providers.mjs";
import { authorMatches, canonicalArxivId, deduplicateWorks, discoveryOptions, prepareWorks, publicationDate } from "../domain/discovery-search.mjs";

const params = values => new URLSearchParams(values);
const title = "Attention Is All You Need";
const crossrefRow = (doi, authors, extra = {}) => ({ DOI: doi, title: [title], author: authors.map(([given, family]) => ({ given, family })), published: { "date-parts": [[2017, 6, 12]] }, "is-referenced-by-count": 100, ...extra });
const arxivFeed = (id = "1706.03762v7", paperTitle = title) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom"><opensearch:totalResults>1</opensearch:totalResults><entry><id>http://arxiv.org/abs/${id}</id><title>${paperTitle}</title><published>2017-06-12T17:57:34Z</published><updated>2023-08-02T10:30:00Z</updated><author><name>Ashish Vaswani</name><arxiv:affiliation>Google Brain</arxiv:affiliation></author><author><name>Noam Shazeer</name></author><summary>Transformer architecture.</summary></entry></feed>`;
const work = (id, props = {}) => ({ id, source: "OpenAlex", title, authors: ["Ashish Vaswani"], year: "2017", publication_date: "2017-06-12", doi: "", citation_count: null, ...props });

test("discovery validates independent title/author controls and rejects irrelevant author-profile filters", () => {
  assert.equal(discoveryOptions(params({ author: "Ashish Vaswani" })).q, "");
  assert.equal(discoveryOptions(params({ q: title })).provider, "crossref");
  assert.equal(discoveryOptions(params({ q: title, provider: "all", sort: "oldest", exact_title: "1" })).exact_title, true);
  for (const input of [{}, { q: "!!!" }, { author: "---" }, { author: "Vaswani", exact_title: "1" }, { q: title, exact_title: "true" }, { q: title, sort: "hindex" }, { q: title, provider: "arxiv", sort: "citations" }, { q: title, provider: "arxiv", sort: "popularity" }, { q: "Vaswani", provider: "all", mode: "authors" }, { q: "Vaswani", provider: "openalex", mode: "authors", author: "Ashish" }, { q: "Vaswani", provider: "openalex", mode: "authors", sort: "newest" }]) {
    assert.throws(() => discoveryOptions(params(input)), error => error.status === 422, JSON.stringify(input));
  }
});

test("title plus author narrows Crossref same-title results without merging different identities", async () => {
  let observed;
  const result = await discover(params({ q: title, author: "Ashish Vaswani", provider: "crossref", sort: "citations", exact_title: "1" }), {}, async value => {
    observed = new URL(value);
    return Response.json({ message: { "total-results": 4000, items: [
      crossrefRow("10.1000/original", [["Ashish", "Vaswani"]], { "is-referenced-by-count": 10000 }),
      crossrefRow("https://doi.org/10.1000/ORIGINAL", [["A.", "Vaswani"]], { "is-referenced-by-count": 10000 }),
      crossrefRow("10.1000/reupload", [["Ashish", "Vaswani"]], { published: { "date-parts": [[2025, 8, 23]] }, "is-referenced-by-count": 200 }),
      crossrefRow("10.1000/other-authors", [["Mary", "Smith"]], { abstract: "Ashish Vaswani is cited here", "is-referenced-by-count": 99999 }),
      crossrefRow("10.1000/extension", [["Ashish", "Vaswani"]], { title: [`${title} For Vision`] })
    ] } });
  });
  assert.equal(observed.searchParams.get("query.bibliographic"), title);
  assert.equal(observed.searchParams.get("query.author"), "Ashish Vaswani");
  assert.equal(observed.searchParams.has("query.title"), false);
  assert.equal(observed.searchParams.get("sort"), "is-referenced-by-count");
  assert.equal(observed.searchParams.get("order"), "desc");
  assert.ok(!observed.searchParams.get("select").split(",").includes("reference"));
  assert.deepEqual(result.items.map(item => item.doi), ["10.1000/original", "10.1000/reupload"]);
  assert.equal(result.total, 4000); assert.equal(result.provider_total, 4000); assert.equal(result.displayed_count, 2);
  assert.equal(result.duplicates_removed, 1); assert.equal(result.postfiltered_count, 2);
  assert.ok(result.warnings.includes("bounded_candidates_filtered"));
});

test("author matching handles initials, accents, and reversed names within one byline only", () => {
  assert.equal(authorMatches(["Vaswani, Ashish"], "Ashish Vaswani"), true);
  assert.equal(authorMatches(["A. Vaswani"], "Ashish Vaswani"), true);
  assert.equal(authorMatches(["José M. García"], "Jose Garcia"), true);
  assert.equal(authorMatches(["Ashish Smith", "Mary Vaswani"], "Ashish Vaswani"), false);
  assert.equal(authorMatches(["Maria Vaswanich"], "Vaswani"), false);
  assert.equal(authorMatches(["John V."], "Vaswani"), false);
  assert.equal(authorMatches(["A. V."], "Ashish Vaswani"), false);
  assert.equal(authorMatches(["Ashish V."], "Ashish Vaswani"), false);
});

test("OpenAlex author-only search targets bylines, preserves author profiles, and constrains combined title queries", async () => {
  let observed;
  const result = await discover(params({ author: "Jose Garcia", provider: "openalex", sort: "newest" }), {}, async value => {
    observed = new URL(value);
    return Response.json({ meta: { count: 500 }, results: [
      { id: "https://openalex.org/W901", display_name: "Geology", publication_date: "2020-12-01", authorships: [{ author: { display_name: "José M. García" } }] },
      { id: "https://openalex.org/W902", display_name: "Jose Garcia in the abstract", abstract_inverted_index: { Jose: [0], Garcia: [1] }, authorships: [{ author: { display_name: "Somebody Else" } }] },
      { id: "https://openalex.org/W903", display_name: "Split names", authorships: [{ author: { display_name: "Jose Smith" } }, { author: { display_name: "Anna Garcia" } }] }
    ] });
  });
  assert.equal(observed.searchParams.get("filter"), 'raw_author_name.search:"jose garcia"~2');
  assert.equal(observed.searchParams.has("search"), false); assert.equal(observed.searchParams.has("search.title"), false);
  assert.equal(observed.searchParams.get("sort"), "publication_date:desc");
  assert.equal(result.items.length, 1); assert.equal(result.items[0].id, "https://openalex.org/W901");
  const profiles = await discover(params({ q: "Author fixture profile", provider: "openalex", mode: "authors" }), {}, async () => Response.json({ meta: { count: 1 }, results: [{ id: "https://openalex.org/A901", display_name: "Author", works_count: 30, cited_by_count: 200 }] }));
  assert.equal(profiles.items[0].name, "Author"); assert.equal(profiles.items[0].h_index, null); assert.equal(profiles.items[0].works_count, 30);
});

test("OpenAlex and arXiv query punctuation cannot inject search fields or filters", async () => {
  let openalexUrl, arxivUrl;
  await discover(params({ q: 'attention") OR (filter:evil)', author: 'Ashish",cited_by_count:>0', provider: "openalex" }), {}, async value => { openalexUrl = new URL(value); return Response.json({ meta: { count: 0 }, results: [] }); });
  assert.equal(openalexUrl.searchParams.get("search.title"), '"attention" AND "or" AND "filter" AND "evil"');
  assert.equal(openalexUrl.searchParams.get("filter"), 'raw_author_name.search:"ashish cited by count 0"~2');
  await discover(params({ q: 'attention") OR au:evil', author: 'Vaswani") OR ti:all', provider: "arxiv" }), {}, async value => { arxivUrl = new URL(value); return new Response("<feed></feed>"); });
  assert.equal(arxivUrl.searchParams.get("search_query"), '(ti:"attention" AND ti:"or" AND ti:"au" AND ti:"evil") AND (au:"vaswani" AND au:"or" AND au:"ti" AND au:"all")');
});

test("arXiv returns original publication date separately from updates and never invents citations", async () => {
  let observed;
  const result = await discover(params({ q: title, author: "A Vaswani", exact_title: "1", provider: "arxiv", sort: "oldest" }), {}, async value => { observed = new URL(value); return new Response(arxivFeed()); });
  assert.equal(observed.searchParams.get("search_query"), '(ti:"attention is all you need") AND (au:"a" AND au:"vaswani")');
  assert.equal(observed.searchParams.get("sortBy"), "submittedDate"); assert.equal(observed.searchParams.get("sortOrder"), "ascending");
  assert.equal(result.items[0].arxiv_id, "1706.03762"); assert.equal(result.items[0].publication_date, "2017-06-12");
  assert.equal(result.items[0].year, "2017"); assert.match(result.items[0].updated_at, /^2023/);
  assert.equal(result.items[0].citation_count, null); assert.equal(result.items[0].popularity_score, null);
  assert.deepEqual(result.items[0].affiliations, ["Google Brain"]);
});

test("composite search finds original arXiv among reuploads, survives a source outage, and discloses bounded totals", async () => {
  const result = await discover(params({ q: title, author: "Ashish Vaswani", provider: "all", sort: "oldest", limit: "21" }), {}, async value => {
    const url = new URL(value);
    if (url.hostname === "api.openalex.org") throw new Error("OpenAlex temporarily unavailable");
    if (url.hostname === "api.crossref.org") return Response.json({ message: { "total-results": 2000, items: [crossrefRow("10.1000/2025-copy", [["Ashish", "Vaswani"]], { published: { "date-parts": [[2025, 8, 23]] } }), crossrefRow("10.1000/2024-other", [["Other", "Author"]])] } });
    return new Response(arxivFeed());
  });
  assert.equal(result.items.length, 2); assert.equal(result.items[0].source, "arXiv"); assert.equal(result.items[0].year, "2017");
  assert.equal(result.items[1].doi, "10.1000/2025-copy");
  assert.equal(result.provider_total, null); assert.equal(result.total, 2); assert.equal(result.total_is_provider_count, false);
  assert.deepEqual(result.provider_totals, { crossref: 2000, arxiv: 1 });
  assert.equal(result.sort_scope, "provider_candidates"); assert.equal(result.candidate_count, 3); assert.ok(result.candidate_limit <= 300);
  assert.ok(result.warnings.includes("openalex_unavailable"));
});

test("composite citation search uses source-supported sorts and orders missing arXiv counts last", async () => {
  const urls = [];
  const result = await discover(params({ q: "Composite citation fixture", provider: "all", sort: "citations" }), {}, async value => {
    const url = new URL(value); urls.push(url);
    if (url.hostname === "api.openalex.org") return Response.json({ meta: { count: 10 }, results: [{ id: "https://openalex.org/W904", display_name: "Composite citation fixture", cited_by_count: 1000, publication_year: 2020 }] });
    if (url.hostname === "api.crossref.org") return Response.json({ message: { "total-results": 20, items: [{ ...crossrefRow("10.1000/citation-fixture", []), title: ["Composite citation fixture"], "is-referenced-by-count": 12 }] } });
    return new Response(arxivFeed("1706.03763v1", "Composite citation fixture"));
  });
  assert.deepEqual(result.items.map(item => item.citation_count), [1000, 12, null]);
  assert.equal(urls.find(url => url.hostname === "export.arxiv.org").searchParams.get("sortBy"), "relevance");
  assert.ok(result.warnings.includes("arxiv_citation_counts_unavailable"));
});

test("relevance keeps an earlier same-title arXiv paper visible beyond twenty later reuploads", async () => {
  const result = await discover(params({ q: title, author: "Ashish Vaswani", provider: "all", exact_title: "1", sort: "relevance", limit: "20" }), {}, async value => {
    const url = new URL(value);
    if (url.hostname === "api.openalex.org") return Response.json({ meta: { count: 25 }, results: Array.from({ length: 25 }, (_, index) => ({ id: `https://openalex.org/W${91000 + index}`, doi: `https://doi.org/10.1000/relevance-reupload-${index}`, display_name: title, authorships: [{ author: { display_name: "Ashish Vaswani" } }], publication_year: 2025, publication_date: "2025-08-23", cited_by_count: 10000 + index })) });
    if (url.hostname === "api.crossref.org") return Response.json({ message: { "total-results": 0, items: [] } });
    return new Response(arxivFeed());
  });
  assert.equal(result.candidate_count, 26); assert.equal(result.displayed_count, 20);
  assert.equal(result.items[0].source, "arXiv"); assert.equal(result.items[0].arxiv_id, "1706.03762");
  assert.equal(result.items[0].publication_date, "2017-06-12"); assert.equal(result.items[0].citation_count, null);
  assert.equal(result.items.some(item => item.doi === "10.1000/relevance-reupload-24"), true);
  const sameTitles = [work("late", { year: "2025", publication_date: "2025-08-23", citation_count: 10000 }), work("early", { source: "arXiv", publication_date: "2017-06-12", citation_count: null })];
  assert.equal(prepareWorks(sameTitles, { q: title, sort: "citations" }).items[0].id, "late");
  assert.equal(prepareWorks(sameTitles, { q: title, sort: "newest" }).items[0].id, "late");
  assert.equal(prepareWorks(sameTitles, { q: title, sort: "popularity" }, 2026).items[0].id, "late");
});

test("all-source failure stays an explicit unavailable error", async () => {
  await assert.rejects(discover(params({ q: "all-source-outage-fixture", provider: "all" }), {}, async () => { throw new Error("offline"); }), error => error.status === 502 && error.code === "provider_unavailable");
});

test("canonical identity dedup joins DOI/arXiv aliases but retains same-title different DOI works", () => {
  const items = [work("https://openalex.org/W905", { doi: "10.48550/arxiv.1706.03762", citation_count: 100 }), work("1706.03762v7", { source: "arXiv", arxiv_id: "1706.03762", url: "https://arxiv.org/abs/1706.03762v7" }), work("https://openalex.org/W906", { doi: "10.1000/reupload", publication_date: "2025-08-23", year: "2025" })];
  const result = deduplicateWorks(items);
  assert.equal(result.duplicates_removed, 1); assert.equal(result.items.length, 2);
  assert.deepEqual(result.items[0].providers, ["OpenAlex", "arXiv"]); assert.equal(result.items[0].citation_count, 100);
  assert.equal(result.items[1].doi, "10.1000/reupload");
  assert.equal(canonicalArxivId("https://arxiv.org/pdf/hep-th/9901001v3.pdf"), "hep-th/9901001");
});

test("relevance promotes normalized exact titles; citation/date sorts put unknowns last and popularity is explicit annual citations", () => {
  const items = [work("near", { title: `${title} For Vision`, citation_count: 100000, year: "2024", publication_date: "2024-01-01" }), work("2017", { title: "ATTENTION IS ALL YOU NEED!", citation_count: 1000 }), work("new", { citation_count: 200, year: "2025", publication_date: "2025-08-23" }), work("unknown", { year: "", publication_date: null })];
  const options = { q: title, author: "", sort: "relevance", exact_title: false };
  assert.deepEqual(prepareWorks(items, options, 2026).items.map(item => item.id), ["2017", "new", "unknown", "near"]);
  assert.deepEqual(prepareWorks(items, { ...options, sort: "citations" }, 2026).items.map(item => item.id), ["near", "2017", "new", "unknown"]);
  assert.deepEqual(prepareWorks(items, { ...options, sort: "newest" }, 2026).items.map(item => item.id), ["new", "near", "2017", "unknown"]);
  assert.deepEqual(prepareWorks(items, { ...options, sort: "oldest" }, 2026).items.map(item => item.id), ["2017", "near", "new", "unknown"]);
  const annual = prepareWorks(items, { ...options, sort: "popularity" }, 2026).items;
  assert.equal(annual.find(item => item.id === "2017").popularity_score, 100); assert.equal(annual.find(item => item.id === "new").popularity_score, 100);
  assert.equal(annual[0].popularity_basis, "annual_citations"); assert.equal(annual.at(-1).popularity_score, null);
  assert.equal(prepareWorks([work("future", { year: "2029", citation_count: 500 })], { ...options, sort: "popularity" }, 2026).items[0].popularity_score, null);
});

test("metadata keeps source affiliations, actual date precision, missing citations, and existing references", () => {
  const crossref = crossrefItem(crossrefRow("10.1000/metadata", [["Ashish", "Vaswani"]], { published: { "date-parts": [[2017]] }, author: [{ given: "Ashish", family: "Vaswani", affiliation: [{ name: "Google Brain" }] }], reference: [{ DOI: "10.1000/reference" }], "is-referenced-by-count": undefined, "container-title": ["NeurIPS"] }));
  assert.equal(crossref.publication_date, "2017"); assert.equal(crossref.citation_count, null); assert.deepEqual(crossref.affiliations, ["Google Brain"]); assert.deepEqual(crossref.references, ["https://doi.org/10.1000/reference"]);
  const openalex = openalexItem({ id: "https://openalex.org/W907", display_name: title, publication_year: 2017, publication_date: "2017-06-12", authorships: [{ raw_author_name: "A Vaswani", institutions: [{ display_name: "Google" }] }], referenced_works: ["https://openalex.org/W1"], topics: [{ id: "https://openalex.org/T1", display_name: "AI" }] });
  assert.deepEqual(openalex.authors, ["A Vaswani"]); assert.deepEqual(openalex.affiliations, ["Google"]); assert.deepEqual(openalex.references, ["https://openalex.org/W1"]);
  assert.equal(publicationDate([2024, 2, 29]), "2024-02-29"); assert.equal(publicationDate([2023, 2, 29]), null); assert.equal(publicationDate("2020-13-20"), null); assert.equal(publicationDate([2020, 6]), "2020-06");
});

test("DOI and arXiv identifier queries use exact provider lookup paths", async () => {
  let doiUrl, arxivUrl;
  const doiResult = await discover(params({ q: "https://doi.org/10.1234/exact-discovery", author: "Ashish Vaswani", provider: "crossref" }), {}, async value => { doiUrl = new URL(value); return Response.json({ message: crossrefRow("10.1234/exact-discovery", [["Ashish", "Vaswani"]]) }); });
  assert.equal(decodeURIComponent(doiUrl.pathname), "/works/10.1234/exact-discovery"); assert.equal(doiUrl.searchParams.has("query.bibliographic"), false); assert.equal(doiResult.items.length, 1);
  const arxivResult = await discover(params({ q: "1706.03762v7", author: "Ashish Vaswani", provider: "arxiv" }), {}, async value => { arxivUrl = new URL(value); return new Response(arxivFeed()); });
  assert.equal(arxivUrl.searchParams.get("id_list"), "1706.03762"); assert.equal(arxivUrl.searchParams.get("search_query"), '(au:"ashish" AND au:"vaswani")'); assert.equal(arxivResult.items.length, 1);
});

test("DOI delimiters stay in an OpenAlex singleton identity and cannot inject filter clauses", async () => {
  let observed;
  const doi = "10.1234/foo,publication_year:2020";
  await discover(params({ q: doi, author: "Ashish Vaswani", provider: "openalex" }), {}, async value => { observed = new URL(value); return Response.json({ id: "https://openalex.org/W908", doi: `https://doi.org/${doi}`, display_name: title, authorships: [{ author: { display_name: "Ashish Vaswani" } }] }); });
  assert.equal(decodeURIComponent(observed.pathname), `/works/doi:${doi}`);
  assert.equal(observed.searchParams.has("filter"), false); assert.equal(observed.searchParams.has("search"), false);
});

test("a retained exact-title checkbox allows precise DOI/arXiv queries and always filters unrelated identifiers", async () => {
  const doi = "10.1234/exact-checkbox";
  for (const author of ["", "Ashish Vaswani"]) {
    const doiResult = await discover(params({ q: doi, author, provider: "crossref", exact_title: "1" }), {}, async () => Response.json({ message: crossrefRow(doi, [["Ashish", "Vaswani"]]) }));
    assert.equal(doiResult.items.length, 1); assert.equal(doiResult.items[0].doi, doi);
    const arxivResult = await discover(params({ q: "1706.03762", author, provider: "arxiv", exact_title: "1" }), {}, async () => new Response(arxivFeed().replace("</feed>", "<entry><id>https://arxiv.org/abs/1801.12345v1</id><title>Unrelated article</title><published>2018-01-01T00:00:00Z</published><author><name>Ashish Vaswani</name></author></entry></feed>")));
    assert.equal(arxivResult.items.length, 1); assert.equal(arxivResult.items[0].arxiv_id, "1706.03762");
  }
  const target = work("target", { doi }), unrelated = work("unrelated", { doi: "10.1234/other-checkbox" });
  assert.deepEqual(prepareWorks([target, unrelated], { q: doi, author: "", exact_title: true, sort: "relevance" }).items.map(item => item.id), ["target"]);
  assert.deepEqual(prepareWorks([target, unrelated], { q: doi, author: "Ashish Vaswani", exact_title: true, sort: "relevance" }).items.map(item => item.id), ["target"]);
});

test("a transitive identity bridge retains all source attribution and only fills missing metadata", () => {
  const result = deduplicateWorks([
    work("oa-bridge", { doi: "10.1000/bridge", citation_count: 5 }),
    work("1706.03764v1", { source: "arXiv", arxiv_id: "1706.03764", pdf_url: "https://arxiv.org/pdf/1706.03764", abstract: "Actual arXiv summary" }),
    work("crossref-bridge", { source: "Crossref", doi: "10.1000/bridge", arxiv_id: "1706.03764" })
  ]);
  assert.equal(result.items.length, 1); assert.equal(result.duplicates_removed, 2);
  assert.deepEqual(result.items[0].providers, ["OpenAlex", "arXiv", "Crossref"]);
  assert.equal(result.items[0].abstract, "Actual arXiv summary"); assert.equal(result.items[0].citation_count, 5);
});
