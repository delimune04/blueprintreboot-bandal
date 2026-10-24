import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { canonicalPdfIdentifiers, inferredPdfSource, publicPdfAccessPath } from "../app/lib/workspace/pdf-access.mjs";

const require = createRequire(import.meta.url);

test("exact arXiv identifiers from every scholarly identity field resolve to one canonical PDF", () => {
  const examples = [
    [{ id: "arxiv:1706.03762v7" }, "1706.03762v7"], [{ arxiv_id: "1706.03762v2" }, "1706.03762v2"],
    [{ url: "https://arxiv.org/abs/1706.03762v5?context=cs#abstract" }, "1706.03762v5"],
    [{ pdf_url: "https://export.arxiv.org/pdf/1706.03762v3.pdf?download=1" }, "1706.03762v3"],
    [{ doi: "https://doi.org/10.48550/arXiv.1706.03762" }, "1706.03762"],
    [{ external_source: { id: "1706.03762", source: "arXiv" } }, "1706.03762"],
    [{ discovery_identifiers: ["arxiv:1706.03762"] }, "1706.03762"],
  ];
  for (const [example, expected] of examples) {
    assert.equal(canonicalPdfIdentifiers(example).arxiv_id, expected, JSON.stringify(example));
    assert.equal(new URL(publicPdfAccessPath(example), "https://example.test").searchParams.get("arxiv_id"), expected);
  }
  assert.equal(canonicalPdfIdentifiers({ url: "https://arxiv.org/abs/hep-th/9901001v4" }).arxiv_id, "hep-th/9901001v4");
  assert.equal(inferredPdfSource({ id: "arxiv:1706.03762v2" }).pdf_url, "https://arxiv.org/pdf/1706.03762v2");
  assert.equal(inferredPdfSource({ arxiv_id: "1706.03762", external_source: { url: "https://arxiv.org/abs/1706.03762v2" } }).pdf_url, "https://arxiv.org/pdf/1706.03762v2");
});

test("canonical identity query encodes DOI delimiters and combines exact supplied identifiers", () => {
  const value = { metadata: { doi: "https://doi.org/10.1234%2Ffoo%2Bbar?utm=source#abstract" }, external_source: { openalex_id: "https://openalex.org/w123?view=compact", arxiv_id: "hep-th/9901001v2" } };
  assert.deepEqual(canonicalPdfIdentifiers(value), { doi: "10.1234/foo+bar", arxiv_id: "hep-th/9901001v2", openalex_id: "W123" });
  const path = publicPdfAccessPath({ doi: "10.1234/a&b=2", openalex_id: "W123" });
  const url = new URL(path, "https://example.test");
  assert.equal(url.pathname, "/discover/pdf-access"); assert.equal(url.searchParams.get("doi"), "10.1234/a&b=2"); assert.equal(url.searchParams.get("b"), null);
  assert.equal(url.searchParams.get("openalex_id"), "W123"); assert.equal([...url.searchParams.keys()].length, 2);
});

test("stored Paper metadata takes precedence and exact legacy aliases remain usable", () => {
  assert.equal(canonicalPdfIdentifiers({ doi: "10.1234/edited", external_source: { doi: "10.1234/imported" } }).doi, "10.1234/edited");
  assert.deepEqual(canonicalPdfIdentifiers({ discovery_identifiers: ["doi:10.1234/SAVED", "openalex:W15"] }), { doi: "10.1234/saved", arxiv_id: "", openalex_id: "W15" });
  assert.equal(publicPdfAccessPath({ title: "arxiv:1706.03762", abstract: "10.1234/example" }), "", "prose never establishes paper identity");
  for (const url of ["https://arxiv.org.evil.test/abs/1706.03762", "https://evil.test/pdf/1706.03762", "javascript:1706.03762", "https://user:password@arxiv.org/abs/1706.03762"]) assert.equal(canonicalPdfIdentifiers({ url }).arxiv_id, "");
});

test("source inference preserves recorded PDF URLs and explains which arXiv PDF was inferred", () => {
  const recorded = inferredPdfSource({ external_source: { pdf_url: "https://publisher.test/open.pdf", url: "https://publisher.test/paper", arxiv_id: "1706.03762" } });
  assert.deepEqual(recorded, { pdf_url: "https://publisher.test/open.pdf", source_url: "https://publisher.test/paper", arxiv_id: "1706.03762", inferred: false });
  const inferred = inferredPdfSource({ arxiv_id: "hep-th/9901001v3", pdf_url: "javascript:alert(1)" });
  assert.deepEqual(inferred, { pdf_url: "https://arxiv.org/pdf/hep-th/9901001v3", source_url: "https://arxiv.org/abs/hep-th/9901001v3", arxiv_id: "hep-th/9901001v3", inferred: true });
  assert.equal(inferredPdfSource({ doi: "10.1234/example" }).source_url, "https://doi.org/10.1234/example");
  assert.equal(inferredPdfSource({ openalex_id: "W5" }).source_url, "https://openalex.org/W5");
  assert.deepEqual(inferredPdfSource(), { pdf_url: "", source_url: "", arxiv_id: "", inferred: false });
});

function downloader({ response, onFetch, clickError } = {}) {
  const sourceCalls = [], fetchCalls = [], blobs = [], timers = [], revoked = [], anchors = [];
  const sourceUrl = "blob:managed-original";
  const loaded = { exports: {} };
  const output = ts.transpileModule(readFileSync(new URL("../app/lib/workspace/pdf-access.mjs", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const localRequire = name => name === "../api/client" ? { paperPdfUrl: id => { sourceCalls.push(id); return sourceUrl; } } : require(new URL(`../app/lib/workspace/${name}`, import.meta.url).pathname);
  const document = { body: { appendChild(anchor) { anchor.appended = true; } }, createElement(tag) { assert.equal(tag, "a"); const anchor = { click() { this.clicked = true; if (clickError) throw clickError; }, remove() { this.removed = true; } }; anchors.push(anchor); return anchor; } };
  class BlobURL extends URL {
    static createObjectURL(blob) { blobs.push(blob); return "blob:temporary-download"; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  const fetch = async (url, options) => { fetchCalls.push({ url, options }); onFetch?.(url, options); return response || new Response("%PDF-1.7\nactual bytes\n%%EOF", { headers: { "Content-Type": "application/pdf" } }); };
  new Function("require", "module", "exports", "fetch", "document", "URL", "setTimeout", output)(localRequire, loaded, loaded.exports, fetch, document, BlobURL, callback => { timers.push(callback); });
  return { download: loaded.exports.downloadManagedPdf, sourceCalls, fetchCalls, blobs, timers, revoked, anchors };
}

test("managed download fetches actual PDF bytes and hands a sanitized local PDF to the browser", async () => {
  const d = downloader(), controller = new AbortController();
  await d.download("paper-a", "../Carbon: storage / study?.PDF", controller.signal);
  assert.deepEqual(d.sourceCalls, ["paper-a"]); assert.equal(d.fetchCalls[0].url, "blob:managed-original");
  assert.equal(d.fetchCalls[0].options.credentials, "same-origin"); assert.equal(d.fetchCalls[0].options.cache, "no-store"); assert.equal(d.fetchCalls[0].options.signal, controller.signal);
  assert.equal(d.blobs[0].type, "application/pdf"); assert.equal(await d.blobs[0].text(), "%PDF-1.7\nactual bytes\n%%EOF");
  assert.equal(d.anchors[0].href, "blob:temporary-download"); assert.equal(d.anchors[0].download, "Carbon storage study.pdf");
  assert.equal(d.anchors[0].clicked, true); assert.equal(d.anchors[0].appended, true); assert.equal(d.anchors[0].removed, true);
  assert.deepEqual(d.revoked, [], "the browser can consume the blob before disposal"); d.timers[0](); assert.deepEqual(d.revoked, ["blob:temporary-download"]);
});

test("managed download never saves sign-in HTML, failed HTTP responses or advertised oversize responses as PDF", async () => {
  for (const [response, code, status] of [
    [new Response("<!doctype html><title>Sign in</title>", { headers: { "Content-Type": "text/html" } }), "invalid_pdf"],
    [new Response("Unauthorized", { status: 401 }), "pdf_unavailable", 401],
    [new Response("%PDF-1.7\nbytes", { headers: { "Content-Length": String(101 * 1024 * 1024) } }), "pdf_unavailable"],
  ]) {
    const d = downloader({ response }); await assert.rejects(d.download("paper-a", "Study"), error => error.code === code && (!status || error.status === status));
    assert.equal(d.anchors.length, 0); assert.equal(d.blobs.length, 0);
  }
});

test("cancellation prevents a download before fetch or after bytes arrive", async () => {
  const first = new AbortController(); first.abort(); const early = downloader();
  await assert.rejects(early.download("paper-a", "Study", first.signal), { name: "AbortError" }); assert.equal(early.fetchCalls.length, 0);
  const second = new AbortController(), late = downloader({ onFetch: () => second.abort() });
  await assert.rejects(late.download("paper-a", "Study", second.signal), { name: "AbortError" }); assert.equal(late.blobs.length, 0); assert.equal(late.anchors.length, 0);
});

test("download handoff errors still remove the anchor and release the temporary Blob URL", async () => {
  const d = downloader({ clickError: new Error("Blocked by browser") });
  await assert.rejects(d.download("paper-a", "CON"), /Blocked by browser/);
  assert.equal(d.anchors[0].download, "paper-CON.pdf"); assert.equal(d.anchors[0].removed, true); assert.deepEqual(d.revoked, ["blob:temporary-download"]); assert.equal(d.timers.length, 0);
});
