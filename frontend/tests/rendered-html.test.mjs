import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { readFile } from "./ui-source.mjs";
import test from "node:test";
import { fileURLToPath } from "node:url";

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? listFiles(path) : [path];
  }))).flat();
}

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const workerPromise = import(workerUrl.href);

async function render(pathname = "/") {
  const { default: worker } = await workerPromise;
  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the stable research workspace shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>랩비움<\/title>/i);
  assert.match(html, /class="app-shell"/);
  assert.match(html, /aria-label="주요 메뉴"/);
  for (const label of ["연구 홈", "논문 보관함", "연구 프로젝트", "태그", "설정"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  assert.match(html, /연구 현황을 불러오는 중/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("all required routes render inside the shared shell", async () => {
  for (const path of ["/dashboard", "/library", "/papers", "/papers/example-paper", "/papers/example-paper/reader", "/projects", "/projects/example-project", "/tags", "/settings"]) {
    const response = await render(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, /class="app-shell(?:\s|")/, path);
    assert.match(html, /aria-label="주요 메뉴"/, path);
  }
});

test("uses a fixed Reader workspace with bounded PDF.js and explicit mutation commands", async () => {
  const [detail, readerView, reader, adapter, controller, client, shell, sidebar, packageJson, packageLock, workerSource, workerDeclaration] = await Promise.all([
    readFile(new URL("../app/views/PaperDetailView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/ReaderView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/PdfJsReader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/pdf/pdfjs-adapter.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/pdf/reader-controller.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/api/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/SidebarNavigation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
    readFile(new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../types/pdf-worker.d.ts", import.meta.url), "utf8"),
  ]);

  assert.match(detail, /Open Reader/);
  assert.match(detail, /encodeURIComponent\(resource\.data\.paper_id\)/);
  assert.match(detail, /Reader unavailable/);
  assert.match(readerView, /className="reader-workspace"/);
  assert.match(readerView, /reader-layout--with-utility/);
  assert.match(readerView, /reader-research-panel/);
  assert.match(readerView, /reader-paper-context/);
  assert.match(readerView, /reader-utility-drawer/);
  assert.match(readerView, /Paper metadata/);
  assert.match(readerView, /Metadata updates/);
  assert.match(readerView, /metadata-review-dialog/);
  assert.match(readerView, /Apply selected/);
  assert.match(readerView, /previewMetadataEnrichment/);
  assert.match(readerView, /Paper Note/);
  assert.match(readerView, /Paper Note formatting/);
  assert.match(readerView, /Markdown-compatible plain text/);
  assert.match(readerView, /function paperNoteBody/);
  assert.match(readerView, /function replacePaperNoteBody/);
  assert.match(readerView, /Note Blocks/);
  assert.match(readerView, /Save Metadata/);
  assert.match(readerView, /Save Paper Note/);
  assert.match(readerView, /Reload current metadata/);
  assert.match(readerView, /Reload current Paper Note/);
  assert.match(readerView, /<Breadcrumbs items=/);
  assert.match(readerView, /Loading Reader snapshot/);
  assert.match(readerView, /Managed PDF missing/);
  assert.match(readerView, /<PdfJsReader\s+paperId=\{snapshot\.paper\.paper_id\}/);
  assert.match(readerView, /current\.saved_note_content/);
  assert.match(readerView, /saved_note_unavailable/);
  assert.match(readerView, /reader-note__textarea/);
  assert.doesNotMatch(readerView, /<object\b/);
  assert.match(reader, /<canvas\b/);
  assert.match(reader, /Previous PDF page/);
  assert.match(reader, /Next PDF page/);
  assert.match(reader, /PDF page number/);
  assert.match(reader, /Zoom out/);
  assert.match(reader, /Zoom in/);
  assert.match(reader, /Fit width/);
  assert.match(reader, /Fit page/);
  assert.match(reader, /Set manual zoom to 100 percent/);
  assert.match(reader, /Loading PDF\.js Reader/);
  assert.match(reader, /Retry PDF\.js/);
  assert.match(reader, /Use native viewer fallback/);
  assert.match(reader, /if \(fallbackActive\)/);
  assert.match(reader, /role="img" aria-label=\{t\("PDF page \{page\}"/);
  assert.match(reader, /Browser PDF viewer unavailable/);
  assert.match(reader, /<object[^>]+data=\{pdfUrl\}[^>]+type="application\/pdf"/s);
  assert.match(reader, /NEXT_PUBLIC_BLUEPRINT_READER_DIAGNOSTICS === "1"/);
  assert.match(reader, /reader-pdf-page-stack/);
  assert.match(reader, /ContinuousPdfPage/);
  assert.match(reader, /IntersectionObserver/);
  assert.match(reader, /canvasRenderGeometry/);
  assert.match(reader, /createPdfTextLayer/);
  assert.match(reader, /viewportRoot\.scrollTo/);
  assert.match(readerView, /apiClient\.saveReaderMetadata/);
  assert.match(readerView, /applyMetadataEnrichmentCommandResult/);
  assert.match(readerView, /apiClient\.saveReadingNote/);
  assert.doesNotMatch(readerView, /contentEditable|dangerouslySetInnerHTML|autosave/i);
  assert.match(readerView, /saveSelectionEvidence/);
  assert.match(readerView, /approveTagCandidate/);
  assert.match(readerView, /rejectTagCandidate/);
  assert.match(readerView, /promoteTagCandidate/);
  assert.doesNotMatch(readerView, /candidate\.confidence|candidate\.score/);
  assert.match(client, /getReaderSnapshot/);
  assert.match(client, /\/papers\/\$\{encodeURIComponent\(paperId\)\}\/reader/);
  assert.match(client, /\/papers\/\$\{encodeURIComponent\(paperId\)\}\/pdf/);
  assert.doesNotMatch(client, /bytes=0-0|getPaperPdf|probePaperPdf/);
  assert.doesNotMatch(client, /http:\/\/127\.0\.0\.1:8000/);
  assert.match(adapter, /typeof window === "undefined"/);
  assert.match(adapter, /import\("pdfjs-dist\/legacy\/build\/pdf\.mjs"\)/);
  assert.match(adapter, /import\("pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs\?url"\)/);
  assert.doesNotMatch(adapter, /import\("pdfjs-dist"\)/);
  assert.doesNotMatch(adapter, /["']pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?url["']/);
  assert.match(workerDeclaration, /declare module "pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs\?url"/);
  assert.doesNotMatch(workerDeclaration, /declare module "pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?url"/);
  assert.doesNotMatch(adapter, /https?:\/\//);
  assert.match(controller, /documentLoadCount/);
  assert.match(controller, /renderCancellationCount/);
  assert.equal(JSON.parse(packageJson).dependencies["pdfjs-dist"], "5.7.284");
  assert.equal(JSON.parse(packageLock).packages[""].dependencies["pdfjs-dist"], "5.7.284");
  assert.match(workerSource, /function onFailure\(ex\) \{\s+if \(terminated\) \{\s+return;/);
  assert.doesNotMatch(workerSource, /function onFailure\(ex\) \{\s+ensureNotTerminated\(\);/);
  assert.match(shell, /isReaderRoute/);
  assert.equal(JSON.parse(packageJson).version, "1.6.5");
  assert.match(shell, /NORMAL_SIDEBAR_PREFERENCE_KEY/);
  assert.doesNotMatch(shell, /packageMetadata\.version|applicationVersion/);
  assert.doesNotMatch(sidebar, /v\{applicationVersion\}|Research workspace · v/);
  assert.match(sidebar, /sidebar-nav--secondary/);
  assert.doesNotMatch(shell, /Local workspace|version-label/);
  assert.doesNotMatch(shell, /v1\.5\.4|Project commands/);
});

test("production build contains the repository-local PDF.js worker asset", async () => {
  const files = await listFiles(fileURLToPath(new URL("../dist", import.meta.url)));
  assert.ok(files.some((path) => /pdf\.worker\.min-[^/]+\.mjs$/i.test(path)), files.join("\n"));
});

test("Reader workspace keeps browser, research, PDF, and utility scrolling intentionally separated", async () => {
  const [reader, css, shell] = await Promise.all([
    readFile(new URL("../app/views/ReaderView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AppShell.tsx", import.meta.url), "utf8"),
  ]);

  for (const selector of [
    ".app-shell--reader { display: block; height: 100dvh; overflow: hidden; }",
    ".reader-workspace",
    ".reader-research-panel__content",
    ".reader-canvas-viewport",
    ".reader-utility-drawer__content",
    "overscroll-behavior: contain",
    ".reader-layout--with-utility",
  ]) {
    assert.ok(css.includes(selector), selector);
  }
  assert.match(reader, /activeUtility === "tags"/);
  assert.match(reader, /activeUtility === "full-text"/);
  assert.match(reader, /setActiveUtility\(null\)/);
  assert.match(reader, /PaperNoteMarkdownPreview/);
  assert.match(reader, /Rendered Paper Note preview/);
  assert.match(reader, /notePreviewOpen/);
  assert.match(reader, /preserveNoteSelection/);
  assert.match(reader, /onMouseDown=\{preserveNoteSelection\}/);
  assert.match(shell, /reader-navigation-zone/);
  assert.match(css, /\.app-shell--reader\[data-reader-sidebar-open="true"\] \.sidebar/);
  assert.match(css, /grid-template-areas: "stage research"/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) var\(--reader-research-width\)/);
  assert.match(css, /\.reader-research-panel \{ grid-area: research;[\s\S]*border-left/);
  assert.match(css, /\.reader-utility-drawer \{ position: absolute; inset: 0 auto 0 0;[\s\S]*border-right/);
});

test("Reader snapshot states remain independent and stale paper state is hidden", async () => {
  const [readerView, resourceHook] = await Promise.all([
    readFile(new URL("../app/views/ReaderView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/hooks/useApiResource.ts", import.meta.url), "utf8"),
  ]);

  assert.match(readerView, /reader-snapshot:\$\{paperId\}:\$\{retryCount\}/);
  assert.match(readerView, /apiClient\.getReaderSnapshot\(paperId\)/);
  assert.doesNotMatch(readerView, /apiClient\.getPaper\(paperId\)/);
  assert.match(resourceHook, /current\.resourceKey === activeResourceKey && current\.status === "success"/);
  assert.match(resourceHook, /if \(state\.resourceKey !== activeResourceKey\) return \{ status: "loading", retry, updateData \}/);
  assert.match(readerView, /snapshot\.pdf_state === "missing"/);
  assert.match(readerView, /saved_note_baseline\.exists/);
  assert.match(readerView, /No persisted note exists/);
  assert.match(readerView, /persisted note could not be read/);
  assert.match(readerView, /Retry local API/);
  assert.match(readerView, /<ReaderPdf\s+snapshot=\{snapshot\}/);
  assert.match(readerView, /<ReaderWorkspace key=\{resource\.data\.paper\.paper_id\}/);
  assert.match(readerView, /Draft restored/);
});

test("keeps tokens, API access, and page views separated", async () => {
  const [css, client, shell, papers, projects, tags, packageJson] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/api/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/PapersView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/ProjectsView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/views/TagsView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  for (const token of ["--color-canvas", "--space-4", "--space-12", "--font-size-base", "--radius-md", "--border", "--shadow-subtle", "--sidebar-width", "--sidebar-collapsed-width", "--control-height", "--content-padding", "--z-sidebar"]) {
    assert.match(css, new RegExp(token));
  }
  assert.match(client, /const API_BASE_URL/);
  assert.match(client, /getHealth/);
  assert.match(client, /getLibraryStatus/);
  assert.match(client, /getPapers/);
  assert.match(client, /getPaper/);
  assert.match(client, /getProjects/);
  assert.match(client, /getProject/);
  assert.match(client, /getTags/);
  assert.match(client, /getTagSummary/);
  assert.doesNotMatch(shell, /fetch\s*\(/);
  assert.doesNotMatch(papers, /fetch\s*\(/);
  assert.doesNotMatch(projects, /fetch\s*\(/);
  assert.doesNotMatch(tags, /fetch\s*\(/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton|drizzle/);
});
