"use client";

import { BookOpen, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { EmptyState, ErrorState, LoadingState, UnavailableState } from "./AsyncStates";
import { FirstPageThumbnail } from "./FirstPageThumbnail";
import { StatusBadge } from "./StatusBadge";
import { useApiResource } from "../hooks/useApiResource";
import { apiClient } from "../lib/api/client";
import { isDemoEnabled } from "../lib/demo/adapter.mjs";
import { patchPaperReadingStatus } from "../lib/library/reading-status-collection.mjs";
import { formatAuthorSummary } from "../lib/presentation";
import { abstractDisplayParagraphs } from "../lib/abstract-display.mjs";

const DEMO_MODE = isDemoEnabled();

function projectContext(count: number): string {
  if (count === 0) return "Not linked to a project";
  return `Linked to ${count} project${count === 1 ? "" : "s"}`;
}

export function LibraryPaperInspector({ paperId, onDismiss, onEnrich, enrichmentBusy, enrichmentContent, onLibraryChanged, onReadingStatusSaved }: {
  paperId: string;
  onDismiss: () => void;
  onEnrich: (paperId: string) => void;
  enrichmentBusy: boolean;
  enrichmentContent?: ReactNode;
  onLibraryChanged: () => void;
  onReadingStatusSaved: (update: { paperId: string; previousStatus: string; readingStatus: "unread" | "reading" | "read" | "finished" }) => void;
}) {
  const resource = useApiResource(`library-inspector:${paperId}`, () => apiClient.getPaper(paperId));
  const [abstractExpanded, setAbstractExpanded] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [removalBusy, setRemovalBusy] = useState(false);
  const [removalMessage, setRemovalMessage] = useState("");
  const abstractParagraphs = useMemo(
    () => resource.status === "success" ? abstractDisplayParagraphs(resource.data.abstract) : [],
    [resource],
  );
  const saveReadingStatus = async (readingStatus: "unread" | "reading" | "read" | "finished") => {
    if (resource.status !== "success") return;
    setStatusBusy(true); setStatusMessage("");
    try {
      const result = await apiClient.saveReadingStatus(
        resource.data.paper_id,
        readingStatus,
        resource.data.reading_status_revision,
      );
      const previousStatus = resource.data.status;
      resource.updateData((paper) => patchPaperReadingStatus(
        paper,
        result.reading_status,
        result.reading_status_revision,
      ));
      onReadingStatusSaved({
        paperId: resource.data.paper_id,
        previousStatus,
        readingStatus: result.reading_status,
      });
      setStatusMessage(`Reading status: ${result.reading_status === "finished" ? "Finished" : result.reading_status === "read" ? "Read" : result.reading_status === "reading" ? "Reading" : "Unread"}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Reading status could not be saved.");
    } finally { setStatusBusy(false); }
  };
  const removePdf = async () => {
    if (resource.status !== "success") return;
    if (!window.confirm("Remove only the managed PDF bytes? The Paper record, metadata, Reading Note, Note Blocks, Tags, and Project links will remain. A verified recovery copy will be created first.")) return;
    setRemovalBusy(true); setRemovalMessage("");
    try {
      const result = await apiClient.removeManagedPdf(resource.data.paper_id, resource.data.pdf_revision);
      setRemovalMessage(result.message);
      onLibraryChanged();
      resource.retry();
    } catch (error) {
      setRemovalMessage(error instanceof Error ? error.message : "The managed PDF could not be removed safely.");
    } finally { setRemovalBusy(false); }
  };
  const archivePaper = async () => {
    if (resource.status !== "success") return;
    if (!window.confirm("Remove this Paper from the active Library? It will be archived. Its managed PDF, metadata, Reading Note, Note Blocks, Tags, and Project links will all be preserved.")) return;
    setRemovalBusy(true); setRemovalMessage("");
    try {
      const result = await apiClient.archivePaper(resource.data.paper_id, resource.data.lifecycle_revision);
      setRemovalMessage(result.message);
      onLibraryChanged();
      resource.retry();
    } catch (error) {
      setRemovalMessage(error instanceof Error ? error.message : "The Paper could not be archived safely.");
    } finally { setRemovalBusy(false); }
  };

  return (
    <aside className="library-paper-inspector" aria-label="Selected paper">
      {resource.status === "loading" ? <LoadingState label="Loading selected paper" /> : null}
      {resource.status === "unavailable" ? <UnavailableState description={resource.message} onRetry={resource.retry} /> : null}
      {resource.status === "not-found" ? <EmptyState title="Paper not found" description="Choose another paper from the collection." /> : null}
      {resource.status === "error" ? <ErrorState description={resource.message} onRetry={resource.retry} /> : null}
      {resource.status === "success" ? (
        <>
          <div className="library-paper-inspector__heading">
            <p className="eyebrow">Selected paper</p>
            <button className="icon-button" type="button" onClick={onDismiss} aria-label="Close selected paper"><X size={16} /></button>
          </div>
          <div className="library-paper-inspector__identity">
            <FirstPageThumbnail paperId={resource.data.paper_id} available={!resource.data.missing_pdf && Boolean(resource.data.relative_pdf_path)} />
            <div className="library-paper-inspector__identity-copy">
              <h2>{resource.data.title || "Untitled paper"}</h2>
              <p className="library-paper-inspector__citation">{[formatAuthorSummary(resource.data.authors, resource.data.first_author), resource.data.journal, resource.data.year].filter(Boolean).join(" · ")}</p>
              <div className="badge-row">
                <StatusBadge>{resource.data.status}</StatusBadge>
                {resource.data.priority ? <StatusBadge>{resource.data.priority}</StatusBadge> : null}
                {resource.data.missing_pdf ? <StatusBadge tone="rose">Missing PDF</StatusBadge> : null}
              </div>
              <div className="library-paper-inspector__actions">
                {!resource.data.missing_pdf && resource.data.relative_pdf_path ? <Link className="reader-action" href={`/papers/${encodeURIComponent(resource.data.paper_id)}/reader`}><BookOpen size={16} />Open Reader</Link> : null}
                <Link className="text-link" href={`/papers/${encodeURIComponent(resource.data.paper_id)}`}>View Paper Detail</Link>
                <button className="reader-control reader-control--secondary" type="button" disabled={DEMO_MODE || enrichmentBusy} title={DEMO_MODE ? "외부 메타데이터 조회는 로컬 앱에서 이용할 수 있습니다." : undefined} onClick={() => onEnrich(resource.data.paper_id)}>{enrichmentBusy ? "Loading…" : "Find metadata"}</button>
              </div>
            </div>
          </div>
          <section className="library-paper-inspector__section library-paper-inspector__metadata-summary" aria-labelledby="selected-paper-metadata">
            <h3 id="selected-paper-metadata">Metadata</h3>
            <dl><div><dt>Title</dt><dd>{resource.data.title ? "present" : "missing"}</dd></div><div><dt>Authors</dt><dd>{resource.data.authors.length ? "present" : "missing"}</dd></div><div><dt>DOI</dt><dd>{resource.data.doi ? "present" : "missing"}</dd></div></dl>
          </section>
          <section className="library-paper-inspector__section" aria-labelledby="selected-paper-abstract">
            <h3 id="selected-paper-abstract">Abstract</h3>
            {abstractParagraphs.length ? <div className={abstractExpanded ? "library-paper-inspector__abstract is-expanded" : "library-paper-inspector__abstract"}>{abstractParagraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div> : <p className="library-paper-inspector__abstract">No abstract yet.</p>}
            {abstractParagraphs.length ? <button className="text-link library-paper-inspector__abstract-toggle" type="button" aria-expanded={abstractExpanded} onClick={() => setAbstractExpanded((current) => !current)}>{abstractExpanded ? "Show less" : "Show more"}</button> : null}
          </section>
          <section className="library-paper-inspector__section" aria-labelledby="selected-paper-organization">
            <h3 id="selected-paper-organization">Organization</h3>
            <label className="library-paper-inspector__status"><span>Reading status</span><select value={resource.data.status} disabled={statusBusy} onChange={(event) => void saveReadingStatus(event.target.value as "unread" | "reading" | "read" | "finished")}><option value="unread">Unread</option><option value="reading">Reading</option><option value="read">Read</option><option value="finished">Finished</option></select></label>
            {statusMessage ? <p className="reader-editor__status" role="status">{statusMessage}</p> : null}
            <p className="library-paper-inspector__context">{projectContext(resource.data.project_links.length)}</p>
            {resource.data.tags.length ? <div className="tag-list">{resource.data.tags.map((item) => <StatusBadge presentation="chip" taxonomy="canonical" key={item}>{item}</StatusBadge>)}</div> : <p className="library-paper-inspector__context">No tags yet</p>}
          </section>
          <section className="library-paper-inspector__section library-paper-inspector__removal" aria-labelledby="selected-paper-removal">
            <h3 id="selected-paper-removal">Remove safely</h3>
            <p>Remove PDF file creates a verified recovery copy first and leaves the Paper as Missing PDF.</p>
            <button className="reader-control reader-control--secondary" type="button" disabled={DEMO_MODE || removalBusy || resource.data.missing_pdf} title={DEMO_MODE ? "샘플 PDF는 웹 시연에서 삭제하지 않습니다." : undefined} onClick={() => void removePdf()}>{removalBusy ? "Working…" : "Remove PDF file"}</button>
            <p>Remove Paper from Library archives it from active views. It does not delete the managed PDF or any Paper-owned research.</p>
            <button className="reader-control reader-control--secondary" type="button" disabled={removalBusy || resource.data.archived} onClick={() => void archivePaper()}>{resource.data.archived ? "Archived" : "Remove Paper from Library"}</button>
            <p className="library-paper-inspector__context">Permanent deletion is intentionally unavailable in this release.</p>
            {removalMessage ? <p className="reader-editor__status" role="status">{removalMessage}</p> : null}
          </section>
          {enrichmentContent ? <section className="library-paper-inspector__section library-paper-inspector__enrichment" aria-label="Metadata enrichment">{enrichmentContent}</section> : null}
        </>
      ) : null}
    </aside>
  );
}
