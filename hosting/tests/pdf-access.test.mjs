import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { handleLabviumApi } from "../api.mjs";
import { resolvePdfAccess } from "../domain/pdf-access.mjs";

// Keep these disposable D1/R2 adapters local to this contract suite. No test
// reads a developer's research workspace or reaches a metadata/PDF provider.
class DB {
  database = new DatabaseSync(":memory:");
  ambiguous = null;
  constructor() {
    for (const name of readdirSync(new URL("../drizzle/", import.meta.url)).filter(name => name.endsWith(".sql")).sort()) {
      this.database.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
    }
  }
  prepare(sql) {
    const self = this;
    return { bind(...args) {
      return {
        _sql: sql, _args: args,
        async first() { return self.database.prepare(sql).get(...args) || null; },
        async all() { return { results: self.database.prepare(sql).all(...args) }; },
        async run() {
          const result = self.database.prepare(sql).run(...args);
          if (sql.startsWith("UPDATE labvium_workspaces") && Number(result.changes) === 1) {
            if (self.ambiguous === "throw") { self.ambiguous = null; throw new Error("Transport failure after commit"); }
            if (self.ambiguous === "metadata") { self.ambiguous = null; return {}; }
          }
          return { meta: { changes: Number(result.changes) } };
        },
      };
    } };
  }
  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const result = [];
      for (const statement of statements) result.push(await statement.run());
      this.database.exec("COMMIT");
      return result;
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
}

class Bucket {
  files = new Map();
  async put(key, value) { this.files.set(key, value instanceof Uint8Array ? new Uint8Array(value) : new TextEncoder().encode(value)); }
  async get(key, options) {
    const bytes = this.files.get(key);
    if (!bytes) return null;
    const value = options?.range ? bytes.slice(options.range.offset, options.range.offset + options.range.length) : bytes;
    return { size: bytes.length, body: new Response(value).body, async arrayBuffer() { return value.slice().buffer; } };
  }
  async delete(key) { this.files.delete(key); }
}

function environment() { return { LABVIUM_DB: new DB(), LABVIUM_PDFS: new Bucket() }; }
async function request(env, path, { method = "GET", body, user = "alice", headers = {} } = {}) {
  const options = { method, headers: { ...(user ? { "oai-authenticated-user-id": user } : {}), ...headers } };
  if (body instanceof FormData) options.body = body;
  else if (body !== undefined) { options.body = JSON.stringify(body); options.headers["Content-Type"] = "application/json"; }
  const response = await handleLabviumApi(new Request(`https://bandal.app/ku-ai/api${path}`, options), env);
  return {
    response, status: response.status,
    data: (response.headers.get("content-type") || "").includes("application/json") ? await response.json() : await response.arrayBuffer(),
  };
}

const DOI = "10.1234/pdf-access-fixture";
const ALEX = "W2100000001";
const TRUSTED_PDF = "https://aclanthology.org/P19-1111.pdf";
const PDF_BYTES = "%PDF-1.7\nResolved open-access fixture\n%%EOF";
let savedFixtureSequence = 0;
function work(changes = {}) {
  const doi = `10.1234/pdf-access-saved-${++savedFixtureSequence}`;
  return {
    id: doi, title: "Exact identity fixture", authors: ["Fixture Researcher"], year: "2025", doi,
    abstract: "A metadata-only research fixture.", source: "Crossref", url: `https://doi.org/${doi}`, pdf_url: "", ...changes,
  };
}
function providerWork(changes = {}) {
  return {
    id: `https://openalex.org/${ALEX}`, doi: `https://doi.org/${DOI}`, display_name: "A different display title does not affect exact identity",
    open_access: { is_oa: true, oa_status: "green", oa_url: TRUSTED_PDF },
    best_oa_location: { is_oa: true, pdf_url: TRUSTED_PDF, landing_page_url: "https://aclanthology.org/P19-1111/" },
    primary_location: { is_oa: false, pdf_url: null, landing_page_url: `https://doi.org/${DOI}` }, locations: [], ...changes,
  };
}
async function saved(env, input = work()) {
  const result = await request(env, "/papers/from-discovery", { method: "POST", body: { work: input } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data;
}
function assertExactLookup(url, identity = `doi:${DOI}`) {
  const parsed = new URL(url);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.hostname, "api.openalex.org");
  assert.equal(decodeURIComponent(parsed.pathname), `/works/${identity}`);
  assert.equal(parsed.searchParams.has("search"), false);
  assert.equal(parsed.searchParams.has("search.title"), false);
}
async function withFetch(mock, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await callback(); } finally { globalThis.fetch = original; }
}

test("exact arXiv identifiers resolve without provider requests and preserve explicitly selected versions", async () => {
  for (const [input, expected] of [
    [{ arxiv_id: "1706.03762" }, "https://arxiv.org/pdf/1706.03762"],
    [{ arxiv_id: "1706.03762v3" }, "https://arxiv.org/pdf/1706.03762v3"],
    [{ id: "https://arxiv.org/abs/1706.03762v3", source: "arXiv" }, "https://arxiv.org/pdf/1706.03762v3"],
    [{ url: "https://arxiv.org/abs/1706.03762v5" }, "https://arxiv.org/pdf/1706.03762v5"],
    [{ arxiv_id: "1706.03762", id: "1706.03762v3", url: "https://arxiv.org/abs/1706.03762v3", source: "arXiv" }, "https://arxiv.org/pdf/1706.03762v3"],
  ]) {
    let calls = 0;
    const result = await resolvePdfAccess(input, {}, async () => { calls++; throw new Error("arXiv exact IDs need no lookup"); });
    assert.equal(calls, 0);
    assert.equal(result.status, "open_access");
    assert.equal(result.pdf_url, expected);
    assert.equal(result.can_import, true);
  }
});

test("established ACL, CVF and NeurIPS pages and known repository PDFs resolve without title searches", async () => {
  const hash = "0123456789abcdef0123456789abcdef";
  for (const [sourceUrl, expected] of [
    ["https://aclanthology.org/P19-1111/", "https://aclanthology.org/P19-1111.pdf"],
    ["https://aclanthology.org/2024.acl-long.1/", "https://aclanthology.org/2024.acl-long.1.pdf"],
    ["https://openaccess.thecvf.com/content/CVPR2023/html/Fixture_Study_CVPR_2023_paper.html", "https://openaccess.thecvf.com/content/CVPR2023/papers/Fixture_Study_CVPR_2023_paper.pdf"],
    [`https://proceedings.neurips.cc/paper_files/paper/2023/hash/${hash}-Abstract-Conference.html`, `https://proceedings.neurips.cc/paper_files/paper/2023/file/${hash}-Paper-Conference.pdf`],
    [`https://proceedings.neurips.cc/paper/2017/hash/${hash}-Abstract.html`, `https://proceedings.neurips.cc/paper/2017/file/${hash}-Paper.pdf`],
    ["https://proceedings.mlr.press/v202/fixture23a/fixture23a.pdf", "https://proceedings.mlr.press/v202/fixture23a/fixture23a.pdf"],
  ]) {
    let calls = 0;
    const result = await resolvePdfAccess({ url: sourceUrl }, {}, async () => { calls++; throw new Error("Established repository mapping needs no provider search"); });
    assert.equal(calls, 0);
    assert.equal(result.status, "open_access", sourceUrl);
    assert.equal(result.pdf_url, expected);
    assert.equal(result.source_url, sourceUrl);
    assert.equal(result.can_import, true);
  }
});

test("DOI resolution requests one exact OpenAlex work and chooses a verified open-access PDF", async () => {
  const calls = [];
  const result = await resolvePdfAccess({ doi: DOI }, {}, async url => {
    calls.push(String(url)); assertExactLookup(url);
    return Response.json(providerWork());
  });
  assert.equal(calls.length, 1);
  assert.equal(result.status, "open_access");
  assert.equal(result.pdf_url, TRUSTED_PDF);
  assert.equal(result.can_import, true);
  assert.ok(result.source_url.startsWith("https://"));
});

test("OpenAlex identity resolution uses an exact work and rejects a mismatched provider ID", async () => {
  const calls = [];
  const exact = await resolvePdfAccess({ openalex_id: ALEX }, {}, async url => {
    calls.push(String(url)); assertExactLookup(url, ALEX); return Response.json(providerWork());
  });
  assert.equal(calls.length, 1);
  assert.equal(exact.status, "open_access");
  assert.equal(exact.pdf_url, TRUSTED_PDF);
  const mismatch = await resolvePdfAccess({ openalex_id: "W2100000002" }, {}, async url => { assertExactLookup(url, "W2100000002"); return Response.json(providerWork({ id: "https://openalex.org/W999999" })); });
  assert.equal(mismatch.status, "source_only");
  assert.equal(mismatch.reason, "identifier_mismatch");
  assert.equal(mismatch.can_import, false);
  assert.equal(mismatch.pdf_url, "");
});

test("a DOI mismatch is not accepted as an open-access PDF candidate", async () => {
  const result = await resolvePdfAccess({ doi: "10.1234/pdf-access-mismatch" }, {}, async () => Response.json(providerWork({ doi: "https://doi.org/10.1234/different-paper" })));
  assert.equal(result.status, "source_only");
  assert.equal(result.reason, "identifier_mismatch");
  assert.equal(result.pdf_url, "");
  assert.equal(result.can_import, false);
});

test("verified open-access locations can supply a link without authorizing unknown-host PDF downloads", async () => {
  const doi = "10.1234/pdf-access-unknown-host", remotePdf = "https://repository.fixture.example/paper.pdf";
  const row = providerWork({ doi: `https://doi.org/${doi}`, open_access: { is_oa: true, oa_status: "green", oa_url: remotePdf }, best_oa_location: null, locations: [{ is_oa: true, pdf_url: remotePdf, landing_page_url: "https://repository.fixture.example/paper" }] });
  const calls = [];
  const result = await resolvePdfAccess({ doi }, {}, async url => { calls.push(String(url)); assertExactLookup(url, `doi:${doi}`); return Response.json(row); });
  assert.equal(result.status, "open_access");
  assert.equal(result.pdf_url, remotePdf);
  assert.equal(result.can_import, false);
  assert.equal(calls.length, 1);
});

test("closed-access primary locations do not become open-access merely because they advertise a PDF URL", async () => {
  const doi = "10.1234/pdf-access-closed";
  const row = providerWork({
    doi: `https://doi.org/${doi}`,
    open_access: { is_oa: false, oa_status: "closed", oa_url: null }, best_oa_location: null,
    primary_location: { is_oa: false, pdf_url: TRUSTED_PDF, landing_page_url: `https://doi.org/${DOI}` }, locations: [],
  });
  const result = await resolvePdfAccess({ doi }, {}, async () => Response.json(row));
  assert.equal(result.status, "source_only");
  assert.equal(result.pdf_url, "");
  assert.equal(result.can_import, false);
});

test("provider failures preserve the source link and never invent a PDF URL", async () => {
  for (const [index, fetchImpl] of [async () => { throw new Error("provider unavailable"); }, async () => new Response("Unavailable", { status: 503 })].entries()) {
    const doi = `10.1234/pdf-access-failure-${index}`;
    const result = await resolvePdfAccess({ doi, url: `https://doi.org/${doi}` }, {}, fetchImpl);
    assert.equal(result.status, "source_only");
    assert.equal(result.source_url, `https://doi.org/${doi}`);
    assert.equal(result.pdf_url, "");
    assert.equal(result.can_import, false);
  }
});

test("unverified arbitrary stored PDF URLs are never fetched or treated as importable", async () => {
  for (const pdfUrl of ["http://127.0.0.1/private.pdf", "https://attacker.example/paper.pdf"]) {
    let calls = 0;
    const result = await resolvePdfAccess({ pdf_url: pdfUrl, url: "https://publisher.example/paper", source: "Fixture provider" }, {}, async () => { calls++; throw new Error("Must not fetch arbitrary URLs"); });
    assert.equal(calls, 0);
    assert.equal(result.status, "source_only");
    assert.equal(result.can_import, false);
    if (pdfUrl.startsWith("http://127.")) assert.equal(result.pdf_url, "");
  }
});

test("public PDF access accepts exact IDs without creating or authenticating a workspace", async () => {
  const env = environment();
  const result = await withFetch(async () => { throw new Error("arXiv must resolve locally"); }, () => request(env, "/discover/pdf-access?arxiv_id=1706.03762v3", { user: null }));
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.status, "open_access");
  assert.equal(result.data.pdf_url, "https://arxiv.org/pdf/1706.03762v3");
  assert.equal(result.data.can_import, true);
  assert.equal(env.LABVIUM_DB.database.prepare("SELECT COUNT(*) AS total FROM labvium_workspaces").get().total, 0);
});

test("public PDF access rejects malformed IDs, arbitrary URL fields and unsupported queries before network access", async () => {
  const env = environment(), calls = [];
  await withFetch(async url => { calls.push(String(url)); throw new Error("Invalid queries must not reach providers"); }, async () => {
    for (const query of [
      "", "doi=invalid", "arxiv_id=not-an-arxiv-id", "openalex_id=A123", "url=http%3A%2F%2F127.0.0.1%2Fprivate.pdf",
      "pdf_url=https%3A%2F%2Farxiv.org%2Fpdf%2F1706.03762", "q=Attention+is+all+you+need", "title=Fixture",
      "arxiv_id=1706.03762&url=https%3A%2F%2Fattacker.example", "doi=10.1234%2Ffixture&doi=10.1234%2Fother",
    ]) {
      const result = await request(env, `/discover/pdf-access?${query}`, { user: null });
      assert.equal(result.status, 422, `${query}: ${JSON.stringify(result.data)}`);
    }
  });
  assert.equal(calls.length, 0);
});

test("paper PDF access reads are owner-isolated and leave saved workspace state unchanged", async () => {
  const env = environment(), first = await saved(env), calls = [];
  const before = env.LABVIUM_DB.database.prepare("SELECT revision,state_json FROM labvium_workspaces").all();
  await withFetch(async url => { calls.push(String(url)); assertExactLookup(url, `doi:${first.paper.doi}`); return Response.json(providerWork({ doi: `https://doi.org/${first.paper.doi}` })); }, async () => {
    assert.equal((await request(env, `/papers/${first.paper_id}/pdf-access`, { user: null })).status, 401);
    assert.equal((await request(env, `/papers/${first.paper_id}/pdf-access`, { user: "bob" })).status, 404);
    assert.equal(calls.length, 0);
    const result = await request(env, `/papers/${first.paper_id}/pdf-access`);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.status, "open_access");
    assert.equal(result.data.pdf_url, TRUSTED_PDF);
    assert.equal(result.data.can_import, true);
  });
  const afterAlice = env.LABVIUM_DB.database.prepare("SELECT revision,state_json FROM labvium_workspaces").all().filter(row => row.state_json.includes(first.paper_id));
  assert.deepEqual(afterAlice, before);
  assert.equal(env.LABVIUM_PDFS.files.size, 0);
  assert.equal((await request(env, `/papers/${first.paper_id}`)).data.missing_pdf, true);
});

test("managed PDFs report available without requesting a metadata provider", async () => {
  const env = environment(), first = await saved(env);
  const form = new FormData(); form.append("file", new File([PDF_BYTES], "fixture.pdf", { type: "application/pdf" })); form.append("expected_pdf_revision", first.paper.pdf_revision);
  const attached = await request(env, `/papers/${first.paper_id}/pdf-attachment`, { method: "POST", body: form });
  assert.equal(attached.status, 200, JSON.stringify(attached.data));
  let calls = 0;
  const result = await withFetch(async () => { calls++; throw new Error("Managed PDFs need no provider"); }, () => request(env, `/papers/${first.paper_id}/pdf-access`));
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.status, "available");
  assert.equal(result.data.can_import, false);
  assert.equal(calls, 0);
});

test("DOI-only source import resolves an exact verified OA PDF and attaches it to the saved Paper", async () => {
  const env = environment(), first = await saved(env), calls = [];
  const result = await withFetch(async (url, options) => {
    calls.push(String(url));
    if (new URL(url).hostname === "api.openalex.org") { assertExactLookup(url, `doi:${first.paper.doi}`); return Response.json(providerWork({ doi: `https://doi.org/${first.paper.doi}` })); }
    assert.equal(String(url), TRUSTED_PDF);
    assert.equal(options.redirect, "manual");
    return new Response(PDF_BYTES, { headers: { "Content-Type": "application/pdf" } });
  }, () => request(env, `/papers/${first.paper_id}/import-source-pdf`, { method: "POST", body: { expected_pdf_revision: first.paper.pdf_revision } }));
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.status, "attached");
  assert.equal(result.data.paper_id, first.paper_id);
  assert.equal(result.data.paper.missing_pdf, false);
  assert.equal(calls.length, 2);
  assert.equal((await request(env, "/workspace")).data.paper_count, 1);
  assert.equal(new TextDecoder().decode((await request(env, `/papers/${first.paper_id}/pdf`)).data), PDF_BYTES);
});

test("mismatched DOI provider responses and hostile OA redirects never attach a PDF", async () => {
  for (const mode of ["mismatch", "redirect"]) {
    const env = environment(), first = await saved(env), calls = [];
    const result = await withFetch(async (url, options) => {
      calls.push(String(url));
      if (new URL(url).hostname === "api.openalex.org") {
        assertExactLookup(url, `doi:${first.paper.doi}`);
        return Response.json(providerWork({ doi: mode === "mismatch" ? "https://doi.org/10.1234/wrong-paper" : `https://doi.org/${first.paper.doi}` }));
      }
      assert.equal(String(url), TRUSTED_PDF);
      assert.equal(options.redirect, "manual");
      return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private.pdf" } });
    }, () => request(env, `/papers/${first.paper_id}/import-source-pdf`, { method: "POST", body: { expected_pdf_revision: first.paper.pdf_revision } }));
    assert.equal(result.status, 422, JSON.stringify(result.data));
    assert.equal(calls.length, mode === "mismatch" ? 1 : 2);
    const paper = (await request(env, `/papers/${first.paper_id}`)).data;
    assert.equal(paper.missing_pdf, true);
    assert.equal(paper.pdf_revision, first.paper.pdf_revision);
    assert.equal(env.LABVIUM_PDFS.files.size, 0);
  }
});

