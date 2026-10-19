"use client";

import { useI18n } from "../lib/i18n/LocaleProvider";

import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { EmptyState, ErrorState, LoadingState, UnavailableState } from "../components/AsyncStates";
import { DataTableShell } from "../components/DataTableShell";
import { LibraryPaperInspector } from "../components/LibraryPaperInspector";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { StatusBadge } from "../components/StatusBadge";
import { Toolbar } from "../components/Toolbar";
import { useApiResource } from "../hooks/useApiResource";
import { useModalFocus } from "../hooks/useModalFocus";
import { ApiClientError, apiClient, getWorkspaceMode, getWorkspaceStorageScope } from "../lib/api/client";
import { patchReadingStatusCollection, readingStatusChangeRequiresCollectionRefresh } from "../lib/library/reading-status-collection.mjs";
import { isMetadataOnlyPaper } from "../lib/library/paper-file-state.mjs";
import type { EditablePaperMetadata, ManagedPdfImportResponse, ManagedPdfScanResponse, MetadataEnrichmentPreview } from "../lib/api/types";

import { readLibraryHistory, mergeLibraryHistory } from "../lib/library/library-history.mjs";

const PAGE_SIZE = 20;
const READING_STATUSES = ["unread", "reading", "read", "finished"];
const READING_STATUS_LABELS: Record<string, string> = { unread: "Unread", reading: "Reading", read: "Read", finished: "Finished" };
type LibraryFilterName = "search" | "tag" | "year" | "reading" | "archive";
const FIELD_LABELS: Record<keyof EditablePaperMetadata, string> = {
  title: "Title", authors: "Authors", year: "Year", journal: "Journal", doi: "DOI", abstract: "Abstract", keywords: "Keywords",
};

function scanTone(status: string): "green" | "amber" | "rose" | "slate" {
  if (status === "new" || status === "imported" || status === "reconnected") return "green";
  if (["already_registered", "duplicate_content", "reconnect_available", "reconnect_ambiguous"].includes(status)) return "amber";
  if (["invalid", "unavailable", "missing"].includes(status)) return "rose";
  return "slate";
}

function friendlyCommandError(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "The PDF action could not be completed.";
}

function libraryNeedsAttention(data: { health: { overall_state: string }; status: { degraded: boolean; missing_count: number; duplicate_count: number; quarantine_count: number; workspace_warnings: string[] } }): boolean {
  return data.health.overall_state !== "healthy" || data.status.degraded || data.status.missing_count > 0 || data.status.duplicate_count > 0 || data.status.quarantine_count > 0 || data.status.workspace_warnings.length > 0;
}

function libraryAttentionMessage(data: { status: { missing_count: number; duplicate_count: number; quarantine_count: number; workspace_warnings: string[] } }, t: (source: string) => string): string {
  const concerns = [
    data.status.missing_count ? `${data.status.missing_count} missing PDF${data.status.missing_count === 1 ? "" : "s"}` : "",
    data.status.duplicate_count ? `${data.status.duplicate_count} duplicate${data.status.duplicate_count === 1 ? "" : "s"} to review` : "",
    data.status.quarantine_count ? `${data.status.quarantine_count} quarantined item${data.status.quarantine_count === 1 ? "" : "s"}` : "",
  ].filter(Boolean).map((concern) => t(concern));
  return concerns.length ? `${concerns.join(" · ")}. ${t("Review Diagnostics for the next safe action.")}` : t(data.status.workspace_warnings[0] || "Review Diagnostics for the next safe action.");
}

export function LibraryView() {
  const { t, locale } = useI18n();
  const say = (ko: string, en: string) => locale === "ko" ? ko : en;
  const browserWorkspace = getWorkspaceMode() !== "local";
  const selectionControls = useRef(new Map<string, HTMLButtonElement>());
  const filterControls = useRef<Partial<Record<LibraryFilterName, HTMLInputElement | HTMLSelectElement | null>>>({});
  const importTriggerRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const resource = useApiResource("library", async () => {
    const [health, status] = await Promise.all([apiClient.getHealth(), apiClient.getLibraryStatus()]);
    return { health, status };
  });
  const historyScope = `${getWorkspaceMode()}:${getWorkspaceStorageScope()}`;
  const [initialFilters] = useState(() => readLibraryHistory(null, historyScope));
  const [restoredScope, setRestoredScope] = useState("");
  const [searchInput, setSearchInput] = useState(initialFilters.searchInput);
  const [q, setQ] = useState(initialFilters.q);
  const [tag, setTag] = useState(initialFilters.tag);
  const [tagInput, setTagInput] = useState(initialFilters.tagInput);
  const [year, setYear] = useState(initialFilters.year);
  const [readingStatus, setReadingStatus] = useState(initialFilters.readingStatus);
  const [archiveStatus, setArchiveStatus] = useState<"active" | "archived" | "all">(initialFilters.archiveStatus);
  const [offset, setOffset] = useState(initialFilters.offset);
  const [selectedPaperId, setSelectedPaperId] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const collection = useApiResource(
    `library-papers:${q}:${tag}:${year}:${readingStatus}:${archiveStatus}:${offset}`,
    () => apiClient.getPapers({ limit: PAGE_SIZE, offset, archiveStatus, q, tag, year, status: readingStatus }),
  );
  const [scan, setScan] = useState<ManagedPdfScanResponse | null>(null);
  const [scanError, setScanError] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<ManagedPdfImportResponse | null>(null);
  const [importError, setImportError] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [reconnectBusy, setReconnectBusy] = useState("");
  const [reconnectMessage, setReconnectMessage] = useState("");
  const [enrichmentPaperId, setEnrichmentPaperId] = useState("");
  const [enrichment, setEnrichment] = useState<MetadataEnrichmentPreview | null>(null);
  const [enrichmentError, setEnrichmentError] = useState("");
  const [enrichmentBusy, setEnrichmentBusy] = useState(false);
  const [selectedFields, setSelectedFields] = useState<Array<keyof EditablePaperMetadata>>([]);
  const canonicalTags = useApiResource("library-canonical-tags", apiClient.getAllTags);

  const closeImport = () => { setShowImport(false); setDragActive(false); dragDepthRef.current = 0; };
  const activeImportDialogRef = useModalFocus<HTMLElement>({ active: showImport, onRequestClose: closeImport, restoreFocusRef: importTriggerRef });

  const resetCollection = () => { setOffset(0); setSelectedPaperId(""); setEnrichmentPaperId(""); setEnrichment(null); setSelectedFields([]); };
  const clearFilters = () => { setSearchInput(""); setQ(""); setTag(""); setTagInput(""); setYear(""); setReadingStatus(""); setArchiveStatus("active"); resetCollection(); filterControls.current.search?.focus(); };
  const removeFilter = (filter: LibraryFilterName) => {
    if (filter === "search") { setSearchInput(""); setQ(""); }
    if (filter === "tag") { setTag(""); setTagInput(""); }
    if (filter === "year") setYear("");
    if (filter === "reading") setReadingStatus("");
    if (filter === "archive") setArchiveStatus("active");
    resetCollection();
    // Move focus before the chip unmounts, without a delayed callback that could
    // steal focus after navigation or another interaction. Inputs stay mounted.
    filterControls.current[filter]?.focus();
  };
  const selectPaper = (paperId: string) => { setSelectedPaperId(paperId); setEnrichmentPaperId(""); setEnrichment(null); setSelectedFields([]); };
  const changePage = (nextOffset: number) => { setOffset(nextOffset); setSelectedPaperId(""); setEnrichmentPaperId(""); setEnrichment(null); setSelectedFields([]); };
  const closeInspector = () => {
    const dismissedPaperId = selectedPaperId;
    setSelectedPaperId(""); setEnrichmentPaperId(""); setEnrichment(null); setSelectedFields([]);
    requestAnimationFrame(() => selectionControls.current.get(dismissedPaperId)?.focus());
  };
  const scanPdfs = async () => {
    setScanBusy(true); setScanError(""); setImportError(""); setImportResult(null); setReconnectMessage("");
    try { setScan(await apiClient.scanManagedPdfs()); setSelectedPaths([]); }
    catch (error) { setScan(null); setScanError(friendlyCommandError(error)); }
    finally { setScanBusy(false); }
  };
  const openImport = () => { setShowImport(true); if (!browserWorkspace) void scanPdfs(); };
  const importSelected = async () => {
    if (!selectedPaths.length) return;
    setImportBusy(true); setImportError("");
    try { setImportResult(await apiClient.importManagedPdfs(selectedPaths)); setSelectedPaths([]); collection.retry(); resource.retry(); }
    catch (error) { setImportError(friendlyCommandError(error)); }
    finally { setImportBusy(false); }
  };
  const toggleSelection = (relativePath: string) => setSelectedPaths((current) => current.includes(relativePath)
    ? current.filter((item) => item !== relativePath)
    : [...current, relativePath]);
  const uploadPdfs = async (files: File[]) => {
    const pdfs = files.filter((file) => file.name.toLowerCase().endsWith(".pdf") && (!file.type || file.type === "application/pdf"));
    const rejected = files.length - pdfs.length;
    if (rejected) setImportError(`Only PDF files can be imported. ${rejected} unsupported file${rejected === 1 ? " was" : "s were"} not uploaded.`);
    if (!pdfs.length) return;
    setImportBusy(true); setImportResult(null);
    try {
      setImportResult(await apiClient.uploadManagedPdfs(pdfs));
      collection.retry(); resource.retry();
    } catch (error) { setImportError(friendlyCommandError(error)); }
    finally { setImportBusy(false); }
  };
  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault(); dragDepthRef.current += 1; setDragActive(true);
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes("Files")) event.preventDefault();
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) { dragDepthRef.current = 0; setDragActive(false); }
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault(); dragDepthRef.current = 0; setDragActive(false);
    void uploadPdfs(Array.from(event.dataTransfer.files));
  };
  const reconnect = async (paperId: string, relativePath: string) => {
    setReconnectBusy(relativePath); setReconnectMessage(""); setImportError("");
    try {
      const result = await apiClient.reconnectManagedPdf(paperId, relativePath);
      setReconnectMessage(result.message); collection.retry(); resource.retry(); await scanPdfs();
    } catch (error) { setImportError(friendlyCommandError(error)); }
    finally { setReconnectBusy(""); }
  };
  const previewEnrichment = async (paperId: string) => {
    setEnrichmentPaperId(paperId); setEnrichment(null); setSelectedFields([]); setEnrichmentError(""); setEnrichmentBusy(true);
    try { setEnrichment(await apiClient.previewMetadataEnrichment(paperId)); }
    catch (error) { setEnrichmentError(friendlyCommandError(error)); }
    finally { setEnrichmentBusy(false); }
  };
  const applyEnrichment = async () => {
    if (!enrichment || !selectedFields.length) return;
    const fields = new Map(enrichment.fields.map((field) => [field.field, field]));
    const changes = Object.fromEntries(selectedFields.map((field) => [field, fields.get(field)?.candidate_value || ""])) as Partial<EditablePaperMetadata>;
    setEnrichmentBusy(true); setEnrichmentError("");
    try {
      await apiClient.saveReaderMetadata(enrichment.paper_id, changes, enrichment.metadata_revision);
      setEnrichment(null); setSelectedFields([]); setEnrichmentPaperId(""); collection.retry();
    } catch (error) { setEnrichmentError(friendlyCommandError(error)); }
    finally { setEnrichmentBusy(false); }
  };
  const toggleField = (field: keyof EditablePaperMetadata) => setSelectedFields((current) => current.includes(field) ? current.filter((item) => item !== field) : [...current, field]);
  const updateReadingStatus = ({ paperId, previousStatus, readingStatus: nextStatus }: { paperId: string; previousStatus: string; readingStatus: "unread" | "reading" | "read" | "finished" }) => {
    if (readingStatusChangeRequiresCollectionRefresh(readingStatus, previousStatus, nextStatus)) {
      collection.retry();
      return;
    }
    collection.updateData((current) => patchReadingStatusCollection(current, paperId, nextStatus));
  };
  const attention = resource.status === "success" && libraryNeedsAttention(resource.data);

  useEffect(() => {
    const restore = () => {
      if (!/\/(?:library|papers)\/?$/.test(window.location.pathname)) return;
      const filters = readLibraryHistory(window.history.state, historyScope);
      setSearchInput(filters.searchInput); setQ(filters.q); setTag(filters.tag); setTagInput(filters.tagInput);
      setYear(filters.year); setReadingStatus(filters.readingStatus); setArchiveStatus(filters.archiveStatus); setOffset(filters.offset);
      setSelectedPaperId(""); setEnrichmentPaperId(""); setEnrichment(null); setSelectedFields([]);
      setRestoredScope(historyScope);
    };
    restore();
    window.addEventListener("popstate", restore);
    window.addEventListener("bandal-demo:navigation", restore);
    return () => {
      window.removeEventListener("popstate", restore);
      window.removeEventListener("bandal-demo:navigation", restore);
    };
  }, [historyScope]);

  // Keep context on this browser history entry, not in the URL or shared records.
  useEffect(() => {
    if (restoredScope !== historyScope) return;
    try {
      window.history.replaceState(mergeLibraryHistory(window.history.state, historyScope,
        { searchInput, q, tag, tagInput, year, readingStatus, archiveStatus, offset }), "");
    } catch { /* Browsing still works when history storage is unavailable. */ }
  }, [restoredScope, historyScope, searchInput, q, tag, tagInput, year, readingStatus, archiveStatus, offset]);

  useEffect(() => {
    if (restoredScope !== historyScope || searchInput === q) return;
    const timer = window.setTimeout(() => {
      setQ(searchInput);
      resetCollection();
    }, 260);
    return () => window.clearTimeout(timer);
  }, [searchInput, q, restoredScope, historyScope]);

  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.setAttribute("directory", "");
  }, [showImport]);

  const canonicalTagValue = (value: string) => {
    const match = canonicalTags.status === "success"
      ? canonicalTags.data.find((item) => item.label.localeCompare(value, undefined, { sensitivity: "accent" }) === 0)
      : undefined;
    return match?.canonical_key || value;
  };

  const archiveLabel = t(archiveStatus === "active" ? "Active papers" : archiveStatus === "archived" ? "Archived papers" : "All papers");
  const tagLabel = canonicalTags.status === "success" ? canonicalTags.data.find((item) => item.canonical_key === tag)?.label : undefined;
  const activeFilters: { key: LibraryFilterName; name: string; value: string }[] = [
    { key: "search", name: t(searchInput === q ? "Search" : searchInput ? "Pending search" : "Clearing search"), value: searchInput || q },
    { key: "tag", name: t("Tag"), value: tag ? tagLabel || tagInput || tag : "" },
    { key: "year", name: t("Year"), value: year },
    { key: "reading", name: t("Reading status"), value: readingStatus ? t(READING_STATUS_LABELS[readingStatus]) : "" },
    { key: "archive", name: t("Library state"), value: archiveStatus !== "active" ? archiveLabel : "" },
  ];
  const hasFilters = activeFilters.some((filter) => filter.value);
  const hasRestrictiveFilters = Boolean(searchInput || q || tag || year || readingStatus || archiveStatus === "archived");

  return (
    <div className="page-stack library-page" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <PageHeader title={t("Library")} description={say("논문 찾기에서 저장한 논문이 모이는 곳입니다. 논문을 열어 읽고, 하이라이트와 메모를 남긴 뒤 연구 프로젝트에 연결하세요.", "Papers saved from Discover live here. Open a paper to read, highlight and take notes, then connect it to your research project.")} actions={<><Link className="reader-control reader-control--secondary" href="/discover">{t("Discover")}</Link><button ref={importTriggerRef} className="reader-control" type="button" onClick={openImport} disabled={scanBusy || importBusy || Boolean(reconnectBusy)}>{scanBusy ? t("Scanning PDFs…") : t(browserWorkspace ? "Add PDFs" : "Scan / import")}</button></>} />
      <div className="library-review-guidance"><strong>{say("논문 찾기 → 논문 보관함 → 읽기·하이라이트·메모 → 연구 프로젝트", "Discover → Library → Read, highlight and take notes → Research project")}</strong><p>{say("검색으로 저장하면 서지정보와 초록이 보관됩니다. PDF가 없는 논문은 제목을 눌러 원문을 확인하고 PDF를 연결하면 읽기를 시작할 수 있습니다.", "Saving a search result keeps its citation details and abstract. Open a paper without a PDF to visit its source and attach a PDF before reading.")}</p></div>
      {importResult ? <div className="operation-result-strip" role="status"><span>{t("Import completed ·")} {importResult.imported_count}{t("imported ·")} {importResult.results.filter((item) => item.status === "already_registered" || item.status === "duplicate_content").length}{t("duplicate")}{importResult.results.filter((item) => item.status === "already_registered" || item.status === "duplicate_content").length === 1 ? "" : t("s")}</span><button className="text-link" type="button" onClick={() => setShowImport(true)}>{t("Details")}</button><button className="icon-button" type="button" aria-label={t("Dismiss import result")} onClick={() => setImportResult(null)}>×</button></div> : null}
      {dragActive ? <div className="library-drop-overlay" role="status" aria-live="polite"><strong>{t("Drop PDFs to import")}</strong><span>{t("PDF files only")}</span></div> : null}
      {attention ? <div className="library-attention" role="alert"><div><strong>{t("Library needs attention")}</strong><p>{libraryAttentionMessage(resource.data, t)}</p></div><Link className="text-link" href="/settings/diagnostics">{t("Review Diagnostics")}</Link></div> : null}
      <Section title={t("Papers")}>
        <Toolbar label={t("Library collection filters")}>
          <label className="library-filter-field library-toolbar__search"><span>{t("Search")}</span><span className="search-shell"><input ref={(node) => { filterControls.current.search = node; }} type="search" value={searchInput} placeholder={t("Title, author, journal, DOI…")} onChange={(event) => setSearchInput(event.target.value)} /></span></label>
          <label className="library-filter-field"><span>{t("Tag")}</span><input ref={(node) => { filterControls.current.tag = node; }} className="library-filter" list="library-canonical-tags" value={tagInput} placeholder={t("Any tag")} onChange={(event) => { setTagInput(event.target.value); setTag(canonicalTagValue(event.target.value)); resetCollection(); }} /><datalist id="library-canonical-tags">{canonicalTags.status === "success" ? canonicalTags.data.map((item) => <option key={item.canonical_key} value={item.label} />) : null}</datalist></label>
          <label className="library-filter-field library-filter-field--year"><span>{t("Year")}</span><input ref={(node) => { filterControls.current.year = node; }} className="library-filter library-filter--year" value={year} inputMode="numeric" maxLength={4} placeholder={t("Any")} onChange={(event) => { setYear(event.target.value); resetCollection(); }} /></label>
          <label className="library-filter-field"><span>{t("Reading status")}</span><select ref={(node) => { filterControls.current.reading = node; }} className="library-filter" value={readingStatus} onChange={(event) => { setReadingStatus(event.target.value); resetCollection(); }}><option value="">{t("Any status")}</option>{READING_STATUSES.map((status) => <option key={status} value={status}>{t(READING_STATUS_LABELS[status])}</option>)}</select></label>
          <label className="library-filter-field"><span>{t("Library state")}</span><select ref={(node) => { filterControls.current.archive = node; }} className="library-filter" value={archiveStatus} onChange={(event) => { setArchiveStatus(event.target.value as "active" | "archived" | "all"); resetCollection(); }}><option value="active">{t("Active papers only")}</option><option value="archived">{t("Archived papers only")}</option><option value="all">{t("All papers")}</option></select></label>
        </Toolbar>
        <div className="active-filter-bar" aria-live="polite">
          <div className="active-filter-bar__criteria">
            <span>{t("Showing:")} <strong>{archiveLabel}</strong></span>
            {hasFilters ? <div className="library-filter-chips" role="group" aria-label={t("Active filters")}>
              {activeFilters.filter((filter) => filter.value).map((filter) => {
                const label = `${filter.name}: ${filter.value}`;
                return <button key={filter.key} className="reader-control reader-control--secondary library-filter-chip" type="button" aria-label={t("Remove filter: {label}", { label })} onClick={() => removeFilter(filter.key)}><span>{label}</span><span aria-hidden="true">×</span></button>;
              })}
            </div> : null}
          </div>
          <button className="reader-control reader-control--secondary" type="button" onClick={clearFilters} disabled={!hasFilters}>{t("Reset filters")}</button>
        </div>
        <div id="paper-collection" className={selectedPaperId ? "library-collection-layout library-collection-layout--with-inspector" : "library-collection-layout"}>
          <div className="library-collection-layout__table">
            {collection.status === "loading" ? <LoadingState label={t("Searching papers")} /> : null}
            {collection.status === "unavailable" ? <UnavailableState description={t(collection.message)} onRetry={collection.retry} /> : null}
            {collection.status === "error" || collection.status === "not-found" ? <ErrorState description={t(collection.message)} onRetry={collection.retry} /> : null}
            {collection.status === "success" ? <>
              {collection.data.items.length === 0 ? <EmptyState title={t(hasRestrictiveFilters ? "No matching papers" : archiveStatus === "all" ? "No papers yet" : "No active papers")} description={t(hasRestrictiveFilters ? "Saved papers may be hidden by these filters. Remove a filter above or reset filters to broaden your search." : archiveStatus === "all" ? "Save a paper from Discover or import a PDF you already have." : "Save a paper from Discover or import a PDF you already have. To find archived papers, change Library state.")} /> : <DataTableShell label={t("Paper collection")}><table className="library-paper-table"><colgroup><col className="library-paper-table__title" /><col className="library-paper-table__author" /><col className="library-paper-table__year" /><col className="library-paper-table__reading" /><col className="library-paper-table__tags" /><col className="library-paper-table__inspect" /></colgroup><thead><tr><th>{t("Title")}</th><th>{t("Author")}</th><th>{t("Year")}</th><th>{t("Reading status")}</th><th>{t("Tags")}</th><th><span className="sr-only">{t("Actions")}</span></th></tr></thead><tbody>{collection.data.items.map((paper) => <tr className="library-paper-row" data-selected={selectedPaperId === paper.paper_id || undefined} key={paper.paper_id}><td><div className="library-paper-row__title"><Link className="paper-link" href={`/papers/${encodeURIComponent(paper.paper_id)}`}>{paper.title || t("Untitled paper")}</Link>{isMetadataOnlyPaper(paper) ? <Link className="library-paper-file-state text-link" href={`/papers/${encodeURIComponent(paper.paper_id)}`}>{say("서지정보 저장 · PDF 연결 필요", "Citation saved · Attach a PDF")}</Link> : null}</div></td><td>{paper.first_author || "—"}</td><td className="structural-value">{paper.year || "—"}</td><td><div className="badge-row"><StatusBadge>{paper.status}</StatusBadge>{paper.missing_pdf && !isMetadataOnlyPaper(paper) ? <StatusBadge tone="rose">{t("Missing PDF")}</StatusBadge> : null}</div></td><td>{paper.tags.length ? <div className="tag-list library-paper-row__tags" title={paper.tags.join(", ")}>{paper.tags.slice(0, 2).map((item) => <StatusBadge presentation="chip" taxonomy="canonical" key={item}>{item}</StatusBadge>)}{paper.tags.length > 2 ? <StatusBadge presentation="chip" taxonomy="canonical">{<>+{paper.tags.length - 2}<span className="sr-only">: {paper.tags.slice(2).join(", ")}</span></>}</StatusBadge> : null}</div> : <span className="muted-text">—</span>}</td><td><button ref={(node) => { if (node) selectionControls.current.set(paper.paper_id, node); else selectionControls.current.delete(paper.paper_id); }} className="reader-control reader-control--secondary" type="button" aria-pressed={selectedPaperId === paper.paper_id} aria-label={t(`Inspect ${paper.title || "untitled paper"}`)} onClick={() => selectPaper(paper.paper_id)}>{t("Inspect")}</button></td></tr>)}</tbody></table></DataTableShell>}
              <div className="library-pagination"><span className="toolbar-note">{t("{count} matching papers", { count: collection.data.total })}</span><div className="reader-editor__actions"><button className="reader-control reader-control--secondary" type="button" disabled={offset === 0} onClick={() => changePage(Math.max(0, offset - PAGE_SIZE))}>{t("Previous")}</button><button className="reader-control reader-control--secondary" type="button" disabled={!collection.data.has_more} onClick={() => changePage(offset + PAGE_SIZE)}>{t("Next")}</button></div></div>
            </> : null}
          </div>
          {selectedPaperId ? <LibraryPaperInspector key={selectedPaperId} paperId={selectedPaperId} onDismiss={closeInspector} onLibraryChanged={() => { collection.retry(); resource.retry(); }} onReadingStatusSaved={updateReadingStatus} onEnrich={previewEnrichment} enrichmentBusy={enrichmentBusy} enrichmentContent={enrichmentPaperId === selectedPaperId ? <MetadataEnrichmentPanel enrichment={enrichment} error={enrichmentError} busy={enrichmentBusy} selectedFields={selectedFields} onToggleField={toggleField} onApply={applyEnrichment} onRetry={() => previewEnrichment(selectedPaperId)} onClose={() => { setEnrichmentPaperId(""); setEnrichment(null); setSelectedFields([]); }} /> : undefined} /> : null}
        </div>
      </Section>

      {showImport ? <div className="library-operation-backdrop"><section ref={activeImportDialogRef} className="library-operation-drawer" role="dialog" aria-modal="true" aria-labelledby="library-import-title" tabIndex={-1}><div className="library-operation-drawer__heading"><div><h2 id="library-import-title">{t(browserWorkspace ? "Add PDFs" : "Scan and import PDFs")}</h2><p>{t(browserWorkspace ? "Choose your PDFs or a folder. Existing workspace files can be checked separately." : "Preview managed PDFs or choose local PDF files to add.")}</p></div><button className="reader-control reader-control--secondary" type="button" onClick={closeImport}>{t("Close")}</button></div><div className="reader-editor__actions"><input ref={fileInputRef} className="sr-only" type="file" accept="application/pdf,.pdf" multiple onChange={(event) => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; void uploadPdfs(files); }} /><button className="reader-control" type="button" disabled={importBusy} onClick={() => fileInputRef.current?.click()}>{importBusy ? t("Importing PDFs…") : t("Choose PDFs")}</button><input ref={folderInputRef} className="sr-only" type="file" multiple onChange={(event) => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; const pdfs = files.filter((file) => file.name.toLowerCase().endsWith(".pdf")); if (!pdfs.length) setImportError("No PDF files were found in this folder."); else void uploadPdfs(pdfs); }} /><button className="reader-control reader-control--secondary" type="button" disabled={importBusy} onClick={() => folderInputRef.current?.click()}>{t("Choose folder")}</button>{browserWorkspace ? <button className="reader-control reader-control--secondary" type="button" disabled={scanBusy || importBusy} onClick={() => void scanPdfs()}>{t("Check workspace files")}</button> : null}<span className="toolbar-note">{t("You can also drag PDFs onto Library.")}</span></div>
        {scanError ? <ErrorState title={t("PDF scan unavailable")} description={scanError} onRetry={scanPdfs} /> : null}
        {scan?.status === "unavailable" ? <UnavailableState title={t("PDF scan unavailable")} description={t(scan.message)} onRetry={scanPdfs} /> : null}
        {scan?.status === "ok" ? <div className="pdf-import-workflow"><p className="pdf-import-workflow__summary" role="status">{t(scan.message)}</p>{scan.candidates.length === 0 ? <EmptyState title={t("No PDFs found")} description={t("Add PDF files to the managed papers directory and scan when ready.")} /> : <DataTableShell label={t("PDF scan candidates")}><table><thead><tr><th>{t("Select")}</th><th>{t("PDF")}</th><th>{t("Status")}</th><th>{t("Details")}</th><th>{t("Repair")}</th></tr></thead><tbody>{scan.candidates.map((candidate) => <tr key={candidate.relative_path}><td><input aria-label={t(`Select ${candidate.relative_path}`)} type="checkbox" checked={selectedPaths.includes(candidate.relative_path)} disabled={!candidate.can_import || importBusy} onChange={() => toggleSelection(candidate.relative_path)} /></td><td><strong>{candidate.filename}</strong><small className="mono-id">{candidate.relative_path}</small></td><td><StatusBadge tone={scanTone(candidate.status)}>{candidate.status.replaceAll("_", " ")}</StatusBadge></td><td>{t(candidate.message)}</td><td>{candidate.can_reconnect ? <button className="reader-control reader-control--secondary" type="button" disabled={Boolean(reconnectBusy)} onClick={() => reconnect(candidate.reconnect_paper_id, candidate.relative_path)}>{reconnectBusy === candidate.relative_path ? t("Reconnecting…") : t("Reconnect existing Paper")}</button> : candidate.status === "reconnect_ambiguous" ? <span className="muted-text">{t("Manual review required")}</span> : "—"}</td></tr>)}</tbody></table></DataTableShell>}{scan.candidates.some((candidate) => candidate.can_import) ? <div className="reader-editor__actions"><button className="reader-control" type="button" onClick={importSelected} disabled={!selectedPaths.length || importBusy || scanBusy}>{importBusy ? t("Importing selected PDFs…") : t(`Import selected (${selectedPaths.length})`)}</button><span className="toolbar-note">{t("Only new PDFs can be selected. Duplicates and reconnects do not create a second paper.")}</span></div> : null}</div> : null}
        {importError ? <ErrorState title={t("PDF command unavailable")} description={importError} onRetry={scanPdfs} /> : null}
        {reconnectMessage ? <p className="reader-editor__status" role="status">{t(reconnectMessage)}</p> : null}
        {importResult ? <div className="pdf-import-result" role="status"><p><strong>{t(importResult.message)}</strong></p><ul>{importResult.results.map((result) => <li key={`${result.relative_path}-${result.filename}`}><StatusBadge tone={scanTone(result.status)}>{result.status.replaceAll("_", " ")}</StatusBadge> {result.filename}: {t(result.message)}{result.paper_id ? <Link className="text-link" href={`/papers/${encodeURIComponent(result.paper_id)}`}>{t("Open Paper Detail")}</Link> : null}</li>)}</ul></div> : null}
      </section></div> : null}
    </div>
  );
}

function MetadataEnrichmentPanel({ enrichment, error, busy, selectedFields, onToggleField, onApply, onRetry, onClose }: {
  enrichment: MetadataEnrichmentPreview | null;
  error: string;
  busy: boolean;
  selectedFields: Array<keyof EditablePaperMetadata>;
  onToggleField: (field: keyof EditablePaperMetadata) => void;
  onApply: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  if (error) return <ErrorState title={t("Metadata preview unavailable")} description={error} onRetry={onRetry} />;
  if (busy && !enrichment) return <LoadingState label={t("Fetching metadata candidates")} />;
  if (!enrichment) return null;
  const updateCount = enrichment.fields.filter((field) => field.candidate_value && field.state !== "unchanged").length;
  return <div className="metadata-enrichment"><div className="library-paper-inspector__enrichment-heading"><h3>{t("Metadata enrichment")}</h3><p>{t("{count} updates found · Choose fields before applying.", { count: updateCount })}</p></div><DataTableShell label={t("Metadata candidate comparison")}><table className="metadata-enrichment-table"><colgroup><col className="metadata-enrichment-table__apply" /><col className="metadata-enrichment-table__field" /><col /><col /></colgroup><thead><tr><th>{t("Apply")}</th><th>{t("Field")}</th><th>{t("Current")}</th><th>{t("Candidate")}</th></tr></thead><tbody>{enrichment.fields.map((field) => { const selectable = Boolean(field.candidate_value) && field.state !== "unchanged"; return <tr key={field.field}><td data-label={t("Apply")}><input type="checkbox" aria-label={t("Select {field} candidate", { field: t(FIELD_LABELS[field.field]) })} checked={selectedFields.includes(field.field)} disabled={!selectable || busy} onChange={() => onToggleField(field.field)} /></td><td data-label={t("Field")}><strong>{t(FIELD_LABELS[field.field])}</strong></td><td data-label={t("Current")}><span className="metadata-enrichment-table__value">{field.current_value || "—"}</span></td><td data-label={t("Candidate")}><span className="metadata-enrichment-table__value">{field.candidate_value || t("Unavailable")}</span></td></tr>; })}</tbody></table></DataTableShell>{enrichment.candidate_sources.length ? <p className="metadata-enrichment__sources">{t("Candidate sources:")} {enrichment.candidate_sources.join(", ")}</p> : null}{enrichment.diagnostics.length ? <details className="metadata-enrichment__details"><summary>{t("Candidate details")}</summary><ul>{enrichment.diagnostics.map((diagnostic) => <li key={diagnostic}>{diagnostic}</li>)}</ul></details> : null}<div className="reader-editor__actions"><button className="reader-control" type="button" disabled={!selectedFields.length || busy} onClick={onApply}>{busy ? t("Applying…") : t("Apply selected fields")}</button><button className="reader-control reader-control--secondary" type="button" disabled={busy} onClick={onRetry}>{t("Fetch fresh candidates")}</button><button className="reader-control reader-control--secondary" type="button" disabled={busy} onClick={onClose}>{t("Close")}</button></div></div>;
}
