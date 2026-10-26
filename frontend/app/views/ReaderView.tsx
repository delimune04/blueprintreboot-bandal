"use client";

import { Bold, ChevronLeft, ChevronRight, Eye, FileText, Heading2, Italic, Link2, List, ListOrdered, ListTodo, Pencil, Quote, RotateCcw, Save, Tags, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useReaderCompanion } from "../hooks/useReaderCompanion";
import { EmptyState, ErrorState, LoadingState, UnavailableState } from "../components/AsyncStates";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { PdfJsReader } from "../components/PdfJsReader";
import { FullTextWorkspace } from "../components/FullTextWorkspace";
import { NoteBlocksWorkspace } from "../components/NoteBlocksWorkspace";
import { PaperNextSteps } from "../components/PaperNextSteps";
import { ReaderFloatingMemos } from "../components/ReaderFloatingMemos";
import { ReaderSelectionAssistant, type ReaderAiRequest } from "../components/ReaderSelectionAssistant";
import { SaveStatus } from "../components/SaveStatus";
import { StatusBadge } from "../components/StatusBadge";
import { useApiResource } from "../hooks/useApiResource";
import { useModalFocus } from "../hooks/useModalFocus";
import { ApiClientError, apiClient, getWorkspaceMode } from "../lib/api/client";
import { useI18n } from "../lib/i18n/LocaleProvider";
import type { PdfPageSelection } from "../lib/pdf/selection-coordinates.mjs";
import { appendReaderHighlight, readReaderPreferences, selectionEvidenceDraft, updateReaderPreferences, type ReaderHighlight } from "../lib/reader/browser-reader-state.mjs";
import { citedBlockHighlights, mergeReaderHighlights } from "../lib/reader/floating-memo.mjs";

import type { CanonicalTag, EditablePaperMetadata, MetadataEnrichmentPreview, PaperTagCommandResponse, ReaderSnapshot, TagCandidateCollection } from "../lib/api/types";
import {
  applyMetadataEnrichmentCommandResult,
  applyMetadataCommandResult,
  applyPaperTagCommandResult,
  changedMetadataFields,
  createReaderEditorState,
  refreshDirtyDraftHeader,
  shouldWarnBeforeReplacement,
} from "../lib/reader/editor-state.mjs";
import { createExclusiveMutationGate } from "../lib/reader/mutation-coordinator.mjs";
import { formatPaperNoteMarkdown, type PaperNoteFormatAction } from "../lib/reader/note-formatting.mjs";
import { candidateReviewLoadFailure, createLatestPaperRequestGate, initialCandidateReview, savedCandidateReviewReady } from "../lib/reader/candidate-review-lifecycle.mjs";
import { readerResearchTabFromSearchParams, readerUtilityFromSearchParams } from "../lib/reader/reader-route-state.mjs";
import { DEFAULT_RESEARCH_PANEL_WIDTH, MAX_RESEARCH_PANEL_WIDTH, MIN_RESEARCH_PANEL_WIDTH, clampResearchPanelWidth, researchPanelWidthFromPointer } from "../lib/reader/split-pane.mjs";
import {
  beginRevisionSave,
  completeRevisionSave,
  draftStorageKey,
  editRevisionDraft,
  failRevisionSave,
  keepMyRevisionDraft,
  persistRevisionDraft,
  readPersistentRevisionDraft,
  receiveRemoteRevision,
  applyLatestRevisionDraft,
} from "../lib/drafts/revision-draft.mjs";


type EditorStatus = "clean" | "dirty" | "saving" | "saved" | "conflict" | "error";
type EnrichmentStatus = "idle" | "loading" | "ready" | "saving" | "saved" | "conflict" | "error";

type EnrichmentState = {
  status: EnrichmentStatus;
  preview: MetadataEnrichmentPreview | null;
  selectedFields: Array<keyof EditablePaperMetadata>;
  message: string;
};

type CandidateReviewStatus = "idle" | "loading" | "ready" | "conflict" | "error";

type CandidateReviewState = {
  status: CandidateReviewStatus;
  collection: TagCandidateCollection | null;
  message: string;
};

type TagBookState =
  | { status: "idle" | "loading" }
  | { status: "success"; data: CanonicalTag[] }
  | { status: "error"; message: string };

type ReaderUtility = "tags" | "full-text" | null;
type ResearchPanelTab = "note" | "blocks" | "details";
const RESEARCH_PANEL_TABS: ResearchPanelTab[] = ["note", "blocks", "details"];

const RESEARCH_PANEL_WIDTH_KEY = "blueprint-reboot:reader-research-panel-width";

function readerSessionStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

const FIELD_LABELS: Record<keyof EditablePaperMetadata, string> = {
  title: "Title",
  authors: "Authors",
  year: "Year",
  journal: "Journal",
  doi: "DOI",
  abstract: "Abstract",
  keywords: "Keywords",
};

function ReaderPdf({
  snapshot,
  layoutResizeActive,
  layoutResizeVersion,
  onCaptureLayoutAnchor,
  onSelectionChange,
  pageJump,
  highlights,
  onRemoveHighlight,
  selectionActions,
  annotationActions,
  memoRailsVisible,
}: {
  snapshot: ReaderSnapshot;
  layoutResizeActive: boolean;
  layoutResizeVersion: number;
  onCaptureLayoutAnchor: (capture: (() => void) | null) => void;
  onSelectionChange: (selection: PdfPageSelection | null) => void;
  pageJump: { page: number; token: number } | null;
  highlights: ReaderHighlight[];
  onRemoveHighlight: (id: string) => void;
  selectionActions?: ReactNode;
  annotationActions?: ReactNode;
  memoRailsVisible: boolean;
}) {
  const { t, locale } = useI18n();
  if (snapshot.pdf_state === "missing" || snapshot.paper.missing_pdf || !snapshot.paper.relative_pdf_path) {
    return (
      <div className="reader-missing-pdf">
      <EmptyState
        title={snapshot.paper.metadata_only ? (locale === "ko" ? "논문 보관함에 저장된 논문입니다" : "This paper is saved in your library") : t("Managed PDF missing")}
        description={snapshot.paper.metadata_only ? (locale === "ko" ? "공개 원문 PDF를 찾아 웹에서 읽기를 시작하세요. 가지고 있는 PDF 파일도 같은 논문에 연결할 수 있습니다." : "Find the open full-text PDF to start reading on the web. You can also connect a PDF file you already have to this paper.") : snapshot.unavailable_reason || "This paper record does not currently have an accessible PDF in the managed library."}
      />
      <Link className="reader-control" href={`/papers/${encodeURIComponent(snapshot.paper.paper_id)}${snapshot.paper.metadata_only ? "?open=reader" : ""}`}>{snapshot.paper.metadata_only ? (locale === "ko" ? "원문 PDF 찾아 읽기" : "Find the full PDF and read") : (locale === "ko" ? "논문 정보에서 원본 PDF 다시 연결" : "Reconnect the original PDF from paper details")}</Link>
      </div>
    );
  }
  return <PdfJsReader
    paperId={snapshot.paper.paper_id}
    paperTitle={snapshot.paper.title}
    layoutResizeActive={layoutResizeActive}
    layoutResizeVersion={layoutResizeVersion}
    onCaptureLayoutAnchor={onCaptureLayoutAnchor}
    onSelectionChange={onSelectionChange}
    pageJump={pageJump}
    highlights={highlights}
    onRemoveHighlight={onRemoveHighlight}
    selectionActions={selectionActions}
    annotationActions={annotationActions}
    memoRailsVisible={memoRailsVisible}
  />;
}


function commandSaveState(status: string): "saved" | "unsaved" | "saving" | "failed" | "changed_elsewhere" {
  const states: Record<string, "saved" | "unsaved" | "saving" | "failed" | "changed_elsewhere"> = {
    clean: "saved",
    dirty: "unsaved",
    saving: "saving",
    saved: "saved",
    conflict: "changed_elsewhere",
    error: "failed",
  };
  return states[status] ?? "failed";
}

function paperNoteBody(content: string): string {
  const text = String(content);
  const bodyStart = text.search(/^##\s+/m);
  if (!text.startsWith("# BluePrint Reading Note") || bodyStart < 0) return text;
  return text.slice(bodyStart).replace(/^##\s+Raw Notes\s*\n*/i, "");
}

function replacePaperNoteBody(content: string, body: string): string {
  const text = String(content);
  const bodyStart = text.search(/^##\s+/m);
  if (!text.startsWith("# BluePrint Reading Note") || bodyStart < 0) return body;
  const section = text.slice(bodyStart);
  const rawNotesHeading = section.match(/^##\s+Raw Notes\s*\n*/i)?.[0] ?? "";
  return `${text.slice(0, bodyStart)}${rawNotesHeading}${body}`;
}

function safeMarkdownPreviewUrl(value: string): string | null {
  try {
    const parsed = new URL(value, "https://blueprint.local");
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? value : null;
  } catch {
    return null;
  }
}

function renderPaperNoteInline(value: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^\s)]+\))/g;
  return value.split(pattern).filter((part) => part !== "").map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    const link = part.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/);
    if (link) {
      const href = safeMarkdownPreviewUrl(link[2]);
      return href ? <a key={index} href={href} target="_blank" rel="noreferrer">{link[1]}</a> : link[1];
    }
    return part;
  });
}

function PaperNoteMarkdownPreview({ content }: { content: string }) {
  const { t } = useI18n();
  return (
    <div className="reader-note__preview" aria-label={t("Rendered Paper Note preview")}>
      {content.split("\n").map((line, index) => {
        const heading = line.match(/^#{1,6}\s+(.*)$/);
        const task = line.match(/^\s*[-+*]\s+\[([ xX])\]\s+(.*)$/);
        const bullet = line.match(/^\s*[-+*]\s+(.*)$/);
        const numbered = line.match(/^\s*(\d+[.)])\s+(.*)$/);
        const quote = line.match(/^\s*>\s?(.*)$/);
        if (heading) return <h3 key={index}>{renderPaperNoteInline(heading[1])}</h3>;
        if (task) return <div className="reader-note__preview-task" key={index}><input type="checkbox" checked={task[1].toLowerCase() === "x"} disabled readOnly />{renderPaperNoteInline(task[2])}</div>;
        if (bullet) return <div className="reader-note__preview-list" key={index}>• {renderPaperNoteInline(bullet[1])}</div>;
        if (numbered) return <div className="reader-note__preview-list" key={index}>{numbered[1]} {renderPaperNoteInline(numbered[2])}</div>;
        if (quote) return <blockquote key={index}>{renderPaperNoteInline(quote[1])}</blockquote>;
        return line ? <p key={index}>{renderPaperNoteInline(line)}</p> : <div className="reader-note__preview-spacer" key={index} />;
      })}
    </div>
  );
}


function errorState(error: unknown): { status: EditorStatus; message: string } {
  if (error instanceof ApiClientError && error.kind === "conflict") {
    return { status: "conflict", message: "The saved version changed. Your draft is still here; reload the current version before retrying." };
  }
  if (error instanceof ApiClientError && error.kind === "invalid") {
    return { status: "error", message: "The draft was not accepted. Check the field values; nothing was saved." };
  }
  return { status: "error", message: "Save failed. Your draft remains unchanged." };
}

function browserStorage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}


function enrichmentStateForError(error: unknown, action: "fetch" | "apply"): Pick<EnrichmentState, "status" | "message"> {
  if (error instanceof ApiClientError && error.kind === "conflict") {
    return {
      status: "conflict",
      message: "The saved metadata changed. Your candidate preview and selected fields are still here; reload candidates before retrying.",
    };
  }
  return {
    status: "error",
    message: action === "fetch"
      ? "Candidates could not be retrieved. No metadata was changed."
      : "Selected metadata could not be saved. Your candidate selection and editor drafts remain unchanged.",
  };
}


function refreshedCandidatePreview(
  preview: MetadataEnrichmentPreview,
  metadata: EditablePaperMetadata,
  revision: string,
): MetadataEnrichmentPreview {
  return {
    ...preview,
    metadata_revision: revision,
    fields: preview.fields.map((field) => {
      const currentValue = metadata[field.field];
      const state = !field.candidate_value
        ? "unavailable"
        : field.candidate_value === currentValue
          ? "unchanged"
          : currentValue ? "conflict" : "available";
      return { ...field, current_value: currentValue, state };
    }),
  };
}


function candidateReviewFailure(error: unknown): Pick<CandidateReviewState, "status" | "message"> {
  if (error instanceof ApiClientError && error.kind === "conflict") {
    return { status: "conflict", message: "Paper tags or suggestions changed. Refresh suggestions before retrying; your Reader drafts remain untouched." };
  }
  return { status: "error", message: "Suggestions could not be completed. No Paper tags were changed." };
}


function ReaderWorkspace({ snapshot }: { snapshot: ReaderSnapshot }) {
  const { t, locale } = useI18n();
  const companion = useReaderCompanion(snapshot.paper.title, locale);
  const extendedReaderCommands = getWorkspaceMode() !== "local";
  const searchParams = useSearchParams();
  const readerSearch = searchParams.toString();
  const noteBlockId = searchParams.get("noteBlock")?.trim() ?? "";
  const mutationGate = useRef(createExclusiveMutationGate());
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const metadataTriggerRef = useRef<HTMLButtonElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const linkTriggerRef = useRef<HTMLButtonElement | null>(null);
  const utilityDrawerRef = useRef<HTMLElement | null>(null);
  const utilityTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobilePanelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const linkSelectionRef = useRef({ start: 0, end: 0 });
  const researchTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const candidateReviewSectionRef = useRef<HTMLDivElement | null>(null);
  const readerLayoutRef = useRef<HTMLDivElement | null>(null);
  const researchResizePointerRef = useRef<number | null>(null);
  const researchPanelWidthRef = useRef(DEFAULT_RESEARCH_PANEL_WIDTH);
  const keyboardResizeFrameRef = useRef<number | null>(null);
  const capturePdfLayoutAnchorRef = useRef<(() => void) | null>(null);
  const memoRailsVisibleRef = useRef(false);
  const candidateRequestGateRef = useRef(createLatestPaperRequestGate());
  const candidateAbortControllerRef = useRef<AbortController | null>(null);
  const tagBookRequestRef = useRef(0);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [readingStatus, setReadingStatus] = useState<"unread" | "reading" | "read" | "finished">(
    snapshot.paper.status === "reading" || snapshot.paper.status === "read" || snapshot.paper.status === "finished" ? snapshot.paper.status : "unread",
  );
  const [readingStatusRevision, setReadingStatusRevision] = useState(snapshot.paper.reading_status_revision);
  const [readingStatusMessage, setReadingStatusMessage] = useState("");
  const [researchPanelCollapsed, setResearchPanelCollapsed] = useState(false);
  const [narrowReader, setNarrowReader] = useState(false);
  const [pdfSelection, setPdfSelection] = useState<PdfPageSelection | null>(null);
  const [readerHighlights, setReaderHighlights] = useState<ReaderHighlight[]>([]);
  const [citedHighlights, setCitedHighlights] = useState<ReaderHighlight[]>([]);
  const [memoRailsVisible, setMemoRailsVisible] = useState(false);
  const [aiRequest, setAiRequest] = useState<ReaderAiRequest | null>(null);
  const visibleHighlights = useMemo(() => mergeReaderHighlights(readerHighlights, citedHighlights), [readerHighlights, citedHighlights]);
  const [selectionMessage, setSelectionMessage] = useState("");
  const [pageJump, setPageJump] = useState<{ page: number; token: number } | null>(null);
  const [blockRefreshToken, setBlockRefreshToken] = useState(0);
  const [researchPanelWidth, setResearchPanelWidth] = useState(DEFAULT_RESEARCH_PANEL_WIDTH);
  const [researchPanelResizing, setResearchPanelResizing] = useState(false);
  const [researchPanelResizeVersion, setResearchPanelResizeVersion] = useState(0);
  const [activeResearchTab, setActiveResearchTab] = useState<ResearchPanelTab>(() => readerResearchTabFromSearchParams(searchParams));
  const [blocksVisited, setBlocksVisited] = useState(() => readerResearchTabFromSearchParams(searchParams) === "blocks");
  const [activeUtility, setActiveUtility] = useState<ReaderUtility>(() => readerUtilityFromSearchParams(searchParams));
  const candidateReviewRequested = searchParams.get("review") === "tag-candidates";
  const [draftRestored, setDraftRestored] = useState(false);
  const [notePreviewOpen, setNotePreviewOpen] = useState(false);
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const [metadataReviewOpen, setMetadataReviewOpen] = useState(false);
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const noteDraftKey = useMemo(
    () => draftStorageKey("paper-note", snapshot.paper.paper_id),
    [snapshot.paper.paper_id],
  );
  const metadataDraftKey = useMemo(
    () => draftStorageKey("paper-metadata", snapshot.paper.paper_id),
    [snapshot.paper.paper_id],
  );
  const [editor, setEditor] = useState(() => createReaderEditorState(
    snapshot,
    readPersistentRevisionDraft(browserStorage(), draftStorageKey("paper-note", snapshot.paper.paper_id)),
    readPersistentRevisionDraft(browserStorage(), draftStorageKey("paper-metadata", snapshot.paper.paper_id)),
  ));
  // Client components are rendered once on the server, where localStorage is
  // unavailable. Do not let that clean server-rendered state erase the real
  // browser draft before this client-only restoration completes.
  const [draftStorageReady, setDraftStorageReady] = useState(false);
  const [enrichment, setEnrichment] = useState<EnrichmentState>({
    status: "idle",
    preview: null,
    selectedFields: [],
    message: "",
  });
  const [candidateReview, setCandidateReview] = useState<CandidateReviewState>(() => initialCandidateReview() as CandidateReviewState);
  const [tagBook, setTagBook] = useState<TagBookState>({ status: "idle" });
  const closeMobilePanel = useCallback(() => setResearchPanelCollapsed(true), []);
  const mobilePanelRef = useModalFocus<HTMLElement>({ active: !companion.detached && narrowReader && !researchPanelCollapsed && !metadataReviewOpen && !linkPopoverOpen, onRequestClose: closeMobilePanel, restoreFocusRef: mobilePanelTriggerRef });
  useEffect(() => {
    const preferences = readReaderPreferences(browserStorage(), snapshot.paper.paper_id);
    setReaderHighlights(preferences.value.highlights);
    if (!preferences.ok) setSelectionMessage(preferences.message);
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => { setNarrowReader(media.matches); if (media.matches) setResearchPanelCollapsed(true); };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [snapshot.paper.paper_id]);
  const closeMetadataReview = useCallback(() => {
    if (enrichment.status !== "saving") setMetadataReviewOpen(false);
  }, [enrichment.status]);
  const closeLinkPopover = useCallback(() => setLinkPopoverOpen(false), []);
  const metadataDialogRef = useModalFocus<HTMLDivElement>({
    active: metadataReviewOpen,
    onRequestClose: closeMetadataReview,
    restoreFocusRef: metadataTriggerRef,
  });
  const linkDialogRef = useModalFocus<HTMLFormElement>({
    active: linkPopoverOpen,
    onRequestClose: closeLinkPopover,
    initialFocusRef: linkInputRef,
    restoreFocusRef: linkTriggerRef,
  });
  useEffect(() => {
    const savedWidth = Number(readerSessionStorage()?.getItem(RESEARCH_PANEL_WIDTH_KEY));
    if (Number.isFinite(savedWidth) && savedWidth > 0) {
      const width = clampResearchPanelWidth(savedWidth);
      researchPanelWidthRef.current = width;
      setResearchPanelWidth(width);
    }
  }, []);
  useEffect(() => {
    setEditor(createReaderEditorState(
      snapshot,
      readPersistentRevisionDraft(browserStorage(), noteDraftKey),
      readPersistentRevisionDraft(browserStorage(), metadataDraftKey),
    ));
    const noteDraft = readPersistentRevisionDraft(browserStorage(), noteDraftKey);
    const metadataDraft = readPersistentRevisionDraft(browserStorage(), metadataDraftKey);
    setDraftRestored(Boolean(
      (noteDraft && JSON.stringify(noteDraft.draft) !== JSON.stringify(noteDraft.baseline))
      || (metadataDraft && JSON.stringify(metadataDraft.draft) !== JSON.stringify(metadataDraft.baseline)),
    ));
    setDraftStorageReady(true);
    setReadingStatus(snapshot.paper.status === "reading" || snapshot.paper.status === "read" || snapshot.paper.status === "finished" ? snapshot.paper.status : "unread");
    setReadingStatusRevision(snapshot.paper.reading_status_revision);
    setReadingStatusMessage("");
  }, [metadataDraftKey, noteDraftKey, snapshot]);
  useEffect(() => {
    const routeParams = new URLSearchParams(readerSearch);
    const requestedResearchTab = readerResearchTabFromSearchParams(routeParams);
    setActiveResearchTab(requestedResearchTab);
    if (requestedResearchTab === "blocks") setBlocksVisited(true);
    setActiveUtility(readerUtilityFromSearchParams(routeParams));
  }, [readerSearch]);
  useEffect(() => {
    if (activeResearchTab === "blocks") setBlocksVisited(true);
  }, [activeResearchTab]);
  useEffect(() => {
    readerSessionStorage()?.setItem(RESEARCH_PANEL_WIDTH_KEY, String(researchPanelWidth));
  }, [researchPanelWidth]);
  useEffect(() => () => {
    if (keyboardResizeFrameRef.current !== null) window.cancelAnimationFrame(keyboardResizeFrameRef.current);
  }, []);
  useEffect(() => {
    if (!draftStorageReady) return;
    persistRevisionDraft(browserStorage(), noteDraftKey, editor.note);
  }, [draftStorageReady, editor.note, noteDraftKey]);
  useEffect(() => {
    if (!draftStorageReady) return;
    persistRevisionDraft(browserStorage(), metadataDraftKey, editor.metadata);
  }, [draftStorageReady, editor.metadata, metadataDraftKey]);

  const updateNote = (update: (note: typeof editor.note) => typeof editor.note) => {
    setEditor((current) => {
      const note = update(current.note);
      // Persist in the same event turn as the editor state change. The effect
      // above is a second guard for non-input transitions.
      if (draftStorageReady) persistRevisionDraft(browserStorage(), noteDraftKey, note);
      return { ...current, note };
    });
  };
  const updateMetadata = (update: (metadata: typeof editor.metadata) => typeof editor.metadata) => {
    setEditor((current) => {
      const metadata = update(current.metadata);
      if (draftStorageReady) persistRevisionDraft(browserStorage(), metadataDraftKey, metadata);
      return { ...current, metadata };
    });
  };
  useEffect(() => {
    if (activeUtility !== "tags" || tagBook.status !== "idle") return;
    const requestId = tagBookRequestRef.current + 1;
    tagBookRequestRef.current = requestId;
    setTagBook({ status: "loading" });
    void apiClient.getAllTags()
      .then((data) => {
        if (tagBookRequestRef.current !== requestId) return;
        setTagBook({ status: "success", data });
      })
      .catch((error) => {
        if (tagBookRequestRef.current !== requestId) return;
        setTagBook({
          status: "error",
          message: error instanceof ApiClientError ? error.message : "Canonical tag suggestions could not be loaded.",
        });
      });
  }, [activeUtility, tagBook.status]);
  useEffect(() => {
    const paperId = snapshot.paper.paper_id;
    const requestGate = candidateRequestGateRef.current;
    candidateAbortControllerRef.current?.abort();
    candidateAbortControllerRef.current = null;
    requestGate.invalidate(paperId);
    setSelectedSuggestions([]);
    setCandidateReview(initialCandidateReview() as CandidateReviewState);
    return () => {
      candidateAbortControllerRef.current?.abort();
      candidateAbortControllerRef.current = null;
      requestGate.invalidate(paperId);
    };
  }, [snapshot.paper.paper_id]);
  useEffect(() => {
    if (activeUtility !== "tags" || candidateReview.status !== "idle") return;
    const paperId = snapshot.paper.paper_id;
    const request = candidateRequestGateRef.current.begin(paperId);
    const controller = new AbortController();
    candidateAbortControllerRef.current?.abort();
    candidateAbortControllerRef.current = controller;
    setCandidateReview((state) => ({ ...state, status: "loading", message: "Loading saved suggestions…" }));
    void apiClient.getTagCandidates(paperId, { signal: controller.signal })
      .then((collection) => {
        if (!candidateRequestGateRef.current.isCurrent(request)) return;
        setSelectedSuggestions([]);
        setCandidateReview(savedCandidateReviewReady(collection) as CandidateReviewState);
      })
      .catch(() => {
        if (!candidateRequestGateRef.current.isCurrent(request) || controller.signal.aborted) return;
        setCandidateReview(candidateReviewLoadFailure() as CandidateReviewState);
      })
      .finally(() => {
        if (candidateRequestGateRef.current.isCurrent(request)) candidateAbortControllerRef.current = null;
      });
  }, [activeUtility, candidateReview.status, snapshot.paper.paper_id]);
  useEffect(() => {
    if (!activeUtility) return;
    window.requestAnimationFrame(() => utilityDrawerRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setActiveUtility(null);
      window.requestAnimationFrame(() => utilityTriggerRef.current?.focus());
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [activeUtility]);
  useEffect(() => {
    if (activeUtility !== "tags" || !candidateReviewRequested) return;
    window.requestAnimationFrame(() => candidateReviewSectionRef.current?.scrollIntoView({ block: "start" }));
  }, [activeUtility, candidateReviewRequested]);
  const metadataChanged = useMemo(
    () => changedMetadataFields(editor.metadata.draft, editor.metadata.baseline),
    [editor.metadata.draft, editor.metadata.baseline],
  );
  const hasDirtyDraft = shouldWarnBeforeReplacement(
    editor.metadata.draft,
    editor.metadata.baseline,
    editor.note.draft,
    editor.note.baseline,
  ) || Boolean(editor.tags.draft.trim());

  const beginMutation = () => {
    const token = mutationGate.current.tryAcquire();
    if (token !== null) setMutationBusy(true);
    return token;
  };

  const finishMutation = (token: number) => {
    if (mutationGate.current.release(token)) setMutationBusy(false);
  };

  const jumpToPage = (page: number) => {
    if (!Number.isInteger(page) || page < 1) return;
    setPageJump((current) => ({ page, token: (current?.token ?? 0) + 1 }));
    if (narrowReader) { setResearchPanelCollapsed(true); setActiveUtility(null); }
  };
  const saveHighlight = (selection: PdfPageSelection = pdfSelection!) => {
    if (!selection) return;
    if (extendedReaderCommands) { void saveSelectionEvidence("highlight"); return; }
    const saved = updateReaderPreferences(browserStorage(), snapshot.paper.paper_id, (current) => appendReaderHighlight(current, selection, crypto.randomUUID()));
    if (saved.ok) { setReaderHighlights(saved.value.highlights); setSelectionMessage("Highlight saved in this browser."); }
    else setSelectionMessage(saved.message);
  };
  const removeHighlight = (id: string) => {
    const saved = updateReaderPreferences(browserStorage(), snapshot.paper.paper_id, (current) => ({ ...current, highlights: current.highlights.filter((highlight) => highlight.id !== id) }));
    if (saved.ok) { setReaderHighlights(saved.value.highlights); setSelectionMessage("Highlight removed."); }
    else setSelectionMessage(saved.message);
  };
  const saveSelectionEvidence = async (mode: "evidence" | "highlight" = "evidence") => {
    if (!pdfSelection || mutationBusy || !extendedReaderCommands) return;
    const selection = pdfSelection;
    if (selection.rectangles.length > 200) { setSelectionMessage("Select a shorter excerpt before saving."); return; }
    const token = beginMutation();
    if (token === null) return;
    setSelectionMessage("Saving cited evidence…");
    try {
      const collection = await apiClient.getNoteBlocks(snapshot.paper.paper_id);
      const existing = collection.items.find((block) => {
        const source = block.provenance;
        return source?.source === "pdf_selection" && source.page === selection.pageNumber && source.quote === selection.text && JSON.stringify(source.rectangles) === JSON.stringify(selection.rectangles);
      });
      const created = existing ? { block: existing } : await apiClient.createNoteBlock(snapshot.paper.paper_id, selectionEvidenceDraft(selection), collection.note_blocks_revision);
      setBlockRefreshToken((current) => current + 1);
      const provenance = created.block.provenance;
      const confirmed = created.block.paper_id === snapshot.paper.paper_id && provenance?.source === "pdf_selection"
        && provenance.page === selection.pageNumber && provenance.coordinate_space === selection.coordinateSpace
        && provenance.quote === selection.text && provenance.rectangles.length === selection.rectangles.length
        && provenance.rectangles.every((rect, index) => ["x", "y", "width", "height"].every((key) => rect[key as keyof typeof rect] === selection.rectangles[index][key as keyof typeof rect]));
      if (!confirmed) {
        setSelectionMessage("A block was saved, but its PDF provenance could not be confirmed. Review the block before retrying.");
        return;
      }
      setCitedHighlights(citedBlockHighlights(existing ? collection.items : [created.block, ...collection.items], snapshot.paper.paper_id));
      if (mode === "evidence") {
        setBlocksVisited(true); setActiveResearchTab("blocks");
        if (!narrowReader) setResearchPanelCollapsed(false);
      }
      setPdfSelection((current) => current && JSON.stringify(current) === JSON.stringify(selection) ? null : current);
      const highlighted = updateReaderPreferences(browserStorage(), snapshot.paper.paper_id, (current) => appendReaderHighlight(current, selection, crypto.randomUUID()));
      if (highlighted.ok) setReaderHighlights(highlighted.value.highlights);
      setSelectionMessage(mode === "highlight" ? "Highlight saved ✔️ · Reopen it in this paper’s Blocks." : "Evidence block saved with its Paper, page and selection coordinates.");
    } catch (error) {
      setSelectionMessage(error instanceof ApiClientError && error.kind === "conflict" ? "The block collection changed. Your PDF selection is preserved; retry explicitly." : "Evidence was not saved. Your PDF selection is preserved.");
    } finally { finishMutation(token); }
  };

  const saveReadingStatus = async (nextStatus: "unread" | "reading" | "read" | "finished") => {
    if (mutationBusy) return;
    const mutationToken = beginMutation();
    if (mutationToken === null) return;
    setReadingStatusMessage("Saving reading status…");
    try {
      const response = await apiClient.saveReadingStatus(
        snapshot.paper.paper_id,
        nextStatus,
        readingStatusRevision,
      );
      setReadingStatus(response.reading_status);
      setReadingStatusRevision(response.reading_status_revision);
      setReadingStatusMessage(`Reading status saved: ${response.reading_status === "finished" ? "Finished" : response.reading_status === "read" ? "Read" : response.reading_status === "reading" ? "Reading" : "Unread"}.`);
    } catch (error) {
      setReadingStatusMessage(error instanceof ApiClientError ? error.message : "Reading status could not be saved.");
    } finally {
      finishMutation(mutationToken);
    }
  };

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasDirtyDraft) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
    };
  }, [hasDirtyDraft]);

  const saveMetadata = async () => {
    if (!metadataChanged.length || mutationBusy) return;
    const started = beginRevisionSave(editor.metadata);
    if (!started.request) return;
    const mutationToken = beginMutation();
    if (mutationToken === null) return;
    const request = started.request;
    const changes = Object.fromEntries(
      changedMetadataFields(request.draft, editor.metadata.baseline).map((field) => [field, request.draft[field]]),
    ) as Partial<EditablePaperMetadata>;
    updateMetadata(() => ({ ...started.state, status: "saving", message: "Saving metadata…" }));
    try {
      const response = await apiClient.saveReaderMetadata(
        snapshot.paper.paper_id,
        changes,
        request.revision,
      );
      setEditor((current) => {
        const updated = applyMetadataCommandResult(current, response);
        const saved = completeRevisionSave(current.metadata, request.token, {
          value: response.metadata,
          revision: response.metadata_revision,
        });
        const metadata = {
          ...saved,
          status: saved.saveState === "saved" ? "saved" as const : "dirty" as const,
          message: saved.saveState === "saved"
            ? updated.metadata.message
            : "The saved metadata is current. Newer local edits are still unsaved.",
        };
        persistRevisionDraft(browserStorage(), metadataDraftKey, metadata);
        persistRevisionDraft(browserStorage(), noteDraftKey, updated.note);
        return { ...updated, metadata };
      });
    } catch (error) {
      let latest: ReaderSnapshot | null = null;
      if (error instanceof ApiClientError && error.kind === "conflict") {
        try { latest = await apiClient.getReaderSnapshot(snapshot.paper.paper_id); } catch { /* preserve the local draft until retry */ }
      }
      updateMetadata((current) => {
        let failed = failRevisionSave(current, request.token, error instanceof ApiClientError ? error.kind : "error");
        if (latest) failed = receiveRemoteRevision(failed, {
          value: latest.editable_metadata,
          revision: latest.metadata_revision,
          changedElsewhere: true,
        });
        return {
          ...failed,
          status: failed.saveState === "changed_elsewhere" ? "conflict" : "error",
          message: failed.saveState === "changed_elsewhere"
            ? "This metadata changed elsewhere. Your local draft and latest saved values are both preserved."
            : failed.saveState === "offline"
              ? "The local API is unavailable. Your metadata draft is preserved locally."
              : "Save failed. Your metadata draft remains preserved locally.",
        };
      });
    } finally {
      finishMutation(mutationToken);
    }
  };

  const fetchMetadataCandidates = async (preserveSelection = false) => {
    if (enrichment.status === "loading" || enrichment.status === "saving") return;
    setEnrichment((current) => ({
      ...current,
      status: "loading",
      message: "Fetching metadata candidates…",
    }));
    try {
      const preview = await apiClient.previewMetadataEnrichment(snapshot.paper.paper_id);
      setEnrichment((current) => {
        const selectable = new Set(
          preview.fields
            .filter((field) => field.candidate_value && field.state !== "unchanged")
            .map((field) => field.field),
        );
        const selectedFields = preserveSelection
          ? current.selectedFields.filter((field) => selectable.has(field))
          : [];
        return {
          status: "ready",
          preview,
          selectedFields,
          message: preview.candidate_sources.length
            ? "Metadata updates are ready for review. Nothing has been saved."
            : "No metadata updates are available. Nothing has been saved.",
        };
      });
    } catch (error) {
      const failure = enrichmentStateForError(error, "fetch");
      setEnrichment((current) => ({ ...current, ...failure }));
    }
  };

  const toggleCandidateField = (field: keyof EditablePaperMetadata) => {
    setEnrichment((current) => ({
      ...current,
      selectedFields: current.selectedFields.includes(field)
        ? current.selectedFields.filter((item) => item !== field)
        : [...current.selectedFields, field],
      message: "",
    }));
  };

  const applySelectedCandidates = async () => {
    if (!enrichment.preview || !enrichment.selectedFields.length || mutationBusy) return;
    const fieldsByName = new Map(enrichment.preview.fields.map((field) => [field.field, field]));
    const selectedFields = enrichment.selectedFields.filter((field) => {
      const candidate = fieldsByName.get(field);
      return Boolean(candidate?.candidate_value && candidate.state !== "unchanged");
    });
    if (!selectedFields.length) return;
    const mutationToken = beginMutation();
    if (mutationToken === null) return;
    const changes = Object.fromEntries(selectedFields.map((field) => [
      field,
      fieldsByName.get(field)?.candidate_value ?? "",
    ])) as Partial<EditablePaperMetadata>;
    setEnrichment((current) => ({ ...current, status: "saving", message: "Applying selected metadata fields…" }));
    try {
      const response = await apiClient.saveReaderMetadata(
        snapshot.paper.paper_id,
        changes,
        enrichment.preview.metadata_revision,
      );
      setEditor((current) => applyMetadataEnrichmentCommandResult(current, response, selectedFields));
      setEnrichment((current) => {
        if (!current.preview) return current;
        const preview = refreshedCandidatePreview(current.preview, response.metadata, response.metadata_revision);
        return {
          status: "saved",
          preview,
          selectedFields: current.selectedFields.filter((field) => {
            const candidate = preview.fields.find((item) => item.field === field);
            return Boolean(candidate?.candidate_value && candidate.state !== "unchanged");
          }),
          message: response.status === "no_op"
            ? "Selected fields already matched the saved metadata."
            : `Saved selected fields: ${response.changed_fields.join(", ") || "none"}.`,
        };
      });
    } catch (error) {
      const failure = enrichmentStateForError(error, "apply");
      setEnrichment((current) => ({ ...current, ...failure }));
    } finally {
      finishMutation(mutationToken);
    }
  };

  const saveNote = async () => {
    if (mutationBusy) return;
    const started = beginRevisionSave(editor.note);
    if (!started.request) return;
    const mutationToken = beginMutation();
    if (mutationToken === null) return;
    const request = started.request;
    updateNote(() => ({
      ...started.state,
      sha256: started.state.revision,
      status: "saving",
      message: "Saving Paper Note…",
    }));
    try {
      const response = await apiClient.saveReadingNote(
        snapshot.paper.paper_id,
        request.draft,
        request.revision,
      );
      updateNote((current) => {
        const saved = completeRevisionSave(current, request.token, {
          value: response.content,
          revision: response.sha256,
        });
        return {
          ...saved,
          sha256: saved.revision,
          exists: true,
          status: saved.saveState === "saved" ? "saved" : "dirty",
          message: saved.saveState === "saved"
            ? response.status === "no_op" ? "Paper Note already matched the saved version." : "Paper Note saved."
            : "The saved version is current. Newer local edits are still unsaved.",
        };
      });
    } catch (error) {
      let latest: ReaderSnapshot | null = null;
      if (error instanceof ApiClientError && error.kind === "conflict") {
        try {
          latest = await apiClient.getReaderSnapshot(snapshot.paper.paper_id);
        } catch {
          // The conflict itself remains actionable even if a just-restarted
          // backend cannot yet supply the latest copy.
        }
      }
      updateNote((current) => {
        let failed = failRevisionSave(
          current,
          request.token,
          error instanceof ApiClientError ? error.kind : "error",
        );
        if (latest) {
          failed = receiveRemoteRevision(failed, {
            value: latest.saved_note_content,
            revision: latest.saved_note_baseline.sha256,
            changedElsewhere: true,
          });
        }
        return {
          ...failed,
          sha256: failed.revision,
          exists: latest ? latest.saved_note_baseline.exists : current.exists,
          status: failed.saveState === "changed_elsewhere" ? "conflict" : "error",
          message: failed.saveState === "changed_elsewhere"
            ? latest
              ? "This Paper Note changed elsewhere. Your local draft and the latest saved version are both preserved."
              : "This Paper Note changed elsewhere. Your local draft is preserved; refresh the latest saved version to resolve it."
            : failed.saveState === "offline"
              ? "The local API is unavailable. Your Paper Note draft is preserved locally."
              : "Save failed. Your Paper Note draft remains preserved locally.",
        };
      });
    } finally {
      finishMutation(mutationToken);
    }
  };

  const changePaperTag = async (operation: "add" | "remove", tag: string) => {
    const selectedTag = tag.trim();
    if (!selectedTag || mutationBusy) return;
    const mutationToken = beginMutation();
    if (mutationToken === null) return;
    setEditor((current) => ({
      ...current,
      tags: {
        ...current.tags,
        status: "saving",
        message: operation === "add" ? "Adding Paper tag…" : "Removing Paper tag…",
      },
    }));
    try {
      const response = operation === "add"
        ? await apiClient.addPaperTag(snapshot.paper.paper_id, selectedTag, editor.tags.revision)
        : await apiClient.removePaperTag(snapshot.paper.paper_id, selectedTag, editor.tags.revision);
      setEditor((current) => {
        const updated = applyPaperTagCommandResult(current, response);
        return {
          ...updated,
          tags: {
            ...updated.tags,
            draft: operation === "add" ? "" : current.tags.draft,
          },
        };
      });
    } catch (error) {
      const failure = errorState(error);
      setEditor((current) => ({
        ...current,
        tags: { ...current.tags, ...failure },
      }));
    } finally {
      finishMutation(mutationToken);
    }
  };

  const reloadMetadata = async () => {
    try {
      const current = await apiClient.getReaderSnapshot(snapshot.paper.paper_id);
      setEditor((state) => {
        const noteDirty = state.note.draft !== state.note.baseline;
        const refreshed = noteDirty
          ? refreshDirtyDraftHeader(state.note.draft, current.saved_note_content)
          : { content: current.saved_note_content, changed: false };
        const metadata = receiveRemoteRevision(state.metadata, {
          value: current.editable_metadata,
          revision: current.metadata_revision,
          changedElsewhere: current.metadata_revision !== state.metadata.revision
            && changedMetadataFields(state.metadata.draft, state.metadata.baseline).length > 0,
        });
        const next = {
          ...state,
          metadata: {
            ...metadata,
            status: metadata.saveState === "saved" ? "clean" as const : "conflict" as const,
            message: metadata.saveState === "saved"
              ? "Current metadata loaded."
              : "The latest saved metadata was loaded separately. Choose which version to keep.",
          },
          note: {
            ...state.note,
            draft: refreshed.content,
            baseline: current.saved_note_content,
            sha256: current.saved_note_baseline.sha256,
            exists: current.saved_note_baseline.exists,
            status: refreshed.content === current.saved_note_content ? "clean" as const : "dirty" as const,
            message: refreshed.changed
              ? "The current canonical header was applied; the unsaved note body was retained."
              : state.note.message,
          },
        };
        persistRevisionDraft(browserStorage(), metadataDraftKey, next.metadata);
        persistRevisionDraft(browserStorage(), noteDraftKey, next.note);
        return next;
      });
    } catch {
      updateMetadata((current) => ({
        ...current,
        saveState: "offline",
        status: "error",
        message: "Current metadata could not be loaded. Your draft remains preserved locally.",
      }));
    }
  };

  const reloadNote = async () => {
    try {
      const current = await apiClient.getReaderSnapshot(snapshot.paper.paper_id);
      updateNote((note) => {
        const received = receiveRemoteRevision(note, {
          value: current.saved_note_content,
          revision: current.saved_note_baseline.sha256,
          changedElsewhere: current.saved_note_baseline.sha256 !== note.revision
            && !Object.is(note.draft, note.baseline),
        });
        return {
          ...received,
          sha256: received.revision,
          exists: current.saved_note_baseline.exists,
          status: received.saveState === "saved" ? "clean" : "conflict",
          message: received.saveState === "saved"
            ? "Current Paper Note loaded."
            : "The latest saved Paper Note was loaded separately. Choose which version to keep.",
        };
      });
    } catch {
      updateNote((current) => ({
        ...current,
        saveState: "offline",
        status: "error",
        message: "Current Paper Note could not be loaded. Your draft remains preserved locally.",
      }));
    }
  };

  const reloadPaperTags = async () => {
    try {
      const current = await apiClient.getReaderSnapshot(snapshot.paper.paper_id);
      setEditor((state) => {
        const noteDirty = state.note.draft !== state.note.baseline;
        const refreshed = noteDirty && current.saved_note_content
          ? refreshDirtyDraftHeader(state.note.draft, current.saved_note_content)
          : { content: state.note.draft, changed: false };
        return {
          ...state,
          tags: {
            ...state.tags,
            values: [...current.paper.tags],
            revision: current.tags_revision,
            status: "clean",
            message: "Current Paper tags loaded. Your selected tag is still here.",
          },
          note: current.saved_note_available ? {
            ...state.note,
            draft: refreshed.content,
            baseline: current.saved_note_content,
            sha256: current.saved_note_baseline.sha256,
            exists: current.saved_note_baseline.exists,
            status: refreshed.content === current.saved_note_content ? "clean" : "dirty",
            message: refreshed.changed
              ? "The current canonical header was applied; the unsaved note body was retained."
              : state.note.message,
          } : state.note,
        };
      });
    } catch {
      setEditor((current) => ({
        ...current,
        tags: { ...current.tags, status: "error", message: "Current Paper tags could not be loaded. Your selected tag remains unchanged." },
      }));
    }
  };

  const generateTagCandidates = async (resetRejections = false) => {
    if (candidateReview.status === "loading" || mutationBusy) return;
    const mutationToken = beginMutation();
    if (mutationToken === null) return;
    setCandidateReview((current) => ({ ...current, status: "loading", message: "Finding suggested tags…" }));
    try {
      const collection = await apiClient.generateTagCandidates(snapshot.paper.paper_id, resetRejections);
      setSelectedSuggestions([]);
      setCandidateReview({
        status: "ready",
        collection,
        message: collection.items.length
          ? "Suggestions are ready to review. Nothing has been applied to this Paper."
          : "No suggested tags are available for this Paper.",
      });
    } catch (error) {
      setCandidateReview((current) => ({ ...current, ...candidateReviewFailure(error) }));
    } finally {
      finishMutation(mutationToken);
    }
  };

  const applySelectedSuggestions = async () => {
    const collection = candidateReview.collection;
    if (!collection || candidateReview.status === "loading" || mutationBusy) return;
    const selected = collection.items.filter((candidate) => (
      selectedSuggestions.includes(candidate.candidate_id)
      && candidate.resolved_canonical
      && candidate.canonical_status === "active"
      && (candidate.state === "resolved" || candidate.state === "approved")
    ));
    if (!selected.length) return;
    const mutationToken = beginMutation();
    if (mutationToken === null) return;
    setCandidateReview((current) => ({ ...current, status: "loading", message: "Applying selected suggested tags…" }));
    try {
      let nextCollection = collection;
      let tagsRevision = editor.tags.revision;
      let latestPaperTag: PaperTagCommandResponse | null = null;
      for (const candidate of selected) {
        const response = await apiClient.applyTagCandidate(
          snapshot.paper.paper_id,
          candidate.candidate_id,
          nextCollection.review_revision,
          tagsRevision,
        );
        tagsRevision = response.paper_tag.tags_revision;
        latestPaperTag = response.paper_tag;
        nextCollection = {
          ...nextCollection,
          review_revision: response.review_revision,
          tags_revision: response.paper_tag.tags_revision,
          items: nextCollection.items.map((item) => (
            item.candidate_id === response.candidate.candidate_id ? response.candidate : item
          )),
        };
        // Publish each confirmed command: a later batch failure must not hide
        // a tag that was already saved successfully.
        setEditor((current) => applyPaperTagCommandResult(current, response.paper_tag));
        setCandidateReview((current) => ({ ...current, collection: nextCollection }));
      }
      if (latestPaperTag) setEditor((current) => applyPaperTagCommandResult(current, latestPaperTag));
      setSelectedSuggestions([]);
      setCandidateReview({
        status: "ready",
        collection: nextCollection,
        message: selected.length === 1 ? "Suggested tag applied." : `${selected.length} suggested tags applied.`,
      });
    } catch (error) {
      setCandidateReview((current) => ({ ...current, ...candidateReviewFailure(error) }));
    } finally {
      finishMutation(mutationToken);
    }
  };

  const reviewSuggestion = async (candidateId: string, action: "approve" | "reject" | "promote") => {
    const collection = candidateReview.collection;
    if (!collection || candidateReview.status === "loading" || mutationBusy) return;
    const token = beginMutation();
    if (token === null) return;
    setCandidateReview((current) => ({ ...current, status: "loading", message: "Saving suggestion review…" }));
    try {
      const next = action === "approve" ? await apiClient.approveTagCandidate(snapshot.paper.paper_id, candidateId, collection.review_revision)
        : action === "reject" ? await apiClient.rejectTagCandidate(snapshot.paper.paper_id, candidateId, collection.review_revision)
          : await apiClient.promoteTagCandidate(snapshot.paper.paper_id, candidateId, collection.review_revision);
      setCandidateReview({ status: "ready", collection: next, message: action === "promote" ? "Canonical tag created or resolved. Apply it explicitly to tag this Paper." : "Suggestion review saved. Paper tags are unchanged." });
      setSelectedSuggestions((current) => current.filter((id) => id !== candidateId));
      if (action === "promote") setTagBook({ status: "idle" });
    } catch (error) { setCandidateReview((current) => ({ ...current, ...candidateReviewFailure(error) })); }
    finally { finishMutation(token); }
  };

  const updateMetadataField = (field: keyof EditablePaperMetadata, value: string) => {
    updateMetadata((current) => {
      const draft = { ...current.draft, [field]: value };
      const updated = editRevisionDraft(current, draft);
      return {
        ...updated,
        status: changedMetadataFields(draft, current.baseline).length ? "dirty" : "clean",
        message: "",
      };
    });
  };

  const formatPaperNote = (action: PaperNoteFormatAction, explicitLinkUrl?: string) => {
    const textarea = noteTextareaRef.current;
    const currentValue = paperNoteBody(editor.note.draft);
    const selectionStart = action === "link" && explicitLinkUrl !== undefined
      ? linkSelectionRef.current.start
      : textarea?.selectionStart ?? currentValue.length;
    const selectionEnd = action === "link" && explicitLinkUrl !== undefined
      ? linkSelectionRef.current.end
      : textarea?.selectionEnd ?? currentValue.length;
    if (action === "link" && explicitLinkUrl === undefined) {
      linkSelectionRef.current = { start: selectionStart, end: selectionEnd };
      if (companion.detached) companion.attach();
      setLinkPopoverOpen(true);
      return;
    }
    const formatted = formatPaperNoteMarkdown(currentValue, selectionStart, selectionEnd, action, { url: explicitLinkUrl });
    const nextDraft = replacePaperNoteBody(editor.note.draft, formatted.value);
    updateNote((current) => {
      const updated = editRevisionDraft(
        current,
        replacePaperNoteBody(current.draft, formatted.value),
      );
      return {
        ...updated,
        sha256: updated.revision,
        status: nextDraft === current.baseline ? "clean" : "dirty",
        message: "",
      };
    });
    if (!(action === "link" && explicitLinkUrl !== undefined)) {
      window.requestAnimationFrame(() => {
        textarea?.focus();
        textarea?.setSelectionRange(formatted.selectionStart, formatted.selectionEnd);
      });
    }
  };

  const preserveNoteSelection = (event: ReactMouseEvent<HTMLButtonElement>) => {
    // Keep the textarea selection in place while a toolbar command runs. This
    // prevents a toolbar click from moving formatting to an unrelated caret.
    event.preventDefault();
  };

  const availableSuggestions = candidateReview.collection?.items.filter((candidate) => (
    candidate.resolved_canonical
    && candidate.canonical_status === "active"
    && (candidate.state === "resolved" || candidate.state === "approved")
  )) ?? [];
  const tagLabel = (tag: string) => (
    tagBook.status === "success"
      ? tagBook.data.find((item) => item.canonical_key === tag)?.label || tag
      : tag
  );
  const enrichmentChanges = enrichment.preview?.fields.filter((field) => (
    Boolean(field.candidate_value) && field.state !== "unchanged"
  )) ?? [];
  const noteUnavailable = snapshot.warnings.includes("saved_note_unavailable");
  const detailHref = `/papers/${encodeURIComponent(snapshot.paper.paper_id)}`;
  const openUtility = (utility: Exclude<ReaderUtility, null>, trigger: HTMLButtonElement) => {
    if (narrowReader) setResearchPanelCollapsed(true);
    utilityTriggerRef.current = trigger;
    setActiveUtility((current) => current === utility ? null : utility);
  };
  const closeUtility = () => {
    setActiveUtility(null);
    window.requestAnimationFrame(() => utilityTriggerRef.current?.focus());
  };
  const moveResearchTab = (event: ReactKeyboardEvent<HTMLButtonElement>, tab: ResearchPanelTab) => {
    const currentIndex = RESEARCH_PANEL_TABS.indexOf(tab);
    const nextIndex = event.key === "ArrowRight" ? (currentIndex + 1) % RESEARCH_PANEL_TABS.length
      : event.key === "ArrowLeft" ? (currentIndex - 1 + RESEARCH_PANEL_TABS.length) % RESEARCH_PANEL_TABS.length
        : event.key === "Home" ? 0
          : event.key === "End" ? RESEARCH_PANEL_TABS.length - 1
            : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    setActiveResearchTab(RESEARCH_PANEL_TABS[nextIndex]);
    window.requestAnimationFrame(() => researchTabRefs.current[nextIndex]?.focus());
  };
  const capturePdfLayoutAnchor = useCallback((capture: (() => void) | null) => {
    capturePdfLayoutAnchorRef.current = capture;
  }, []);
  const updateMemoRailsVisibility = useCallback((visible: boolean) => {
    if (memoRailsVisibleRef.current === visible) return;
    // Preserve the active reading position before reserving or releasing the
    // note margins. The viewer then fits the actual remaining center width.
    capturePdfLayoutAnchorRef.current?.();
    memoRailsVisibleRef.current = visible;
    setMemoRailsVisible(visible);
  }, []);
  const applyResearchPanelWidth = useCallback((width: number) => {
    const nextWidth = clampResearchPanelWidth(width);
    researchPanelWidthRef.current = nextWidth;
    readerLayoutRef.current?.style.setProperty("--reader-research-width", `${nextWidth}px`);
    return nextWidth;
  }, []);
  const finishResearchPanelResize = useCallback(() => {
    const width = researchPanelWidthRef.current;
    researchResizePointerRef.current = null;
    setResearchPanelWidth(width);
    setResearchPanelResizing(false);
    setResearchPanelResizeVersion((current) => current + 1);
  }, []);
  const beginResearchPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    capturePdfLayoutAnchorRef.current?.();
    researchResizePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setResearchPanelResizing(true);
  };
  const moveResearchPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (researchResizePointerRef.current !== event.pointerId) return;
    const containerRight = readerLayoutRef.current?.getBoundingClientRect().right;
    if (!containerRight) return;
    event.preventDefault();
    const width = researchPanelWidthFromPointer({
      containerRight,
      clientX: event.clientX,
      minimum: MIN_RESEARCH_PANEL_WIDTH,
      maximum: MAX_RESEARCH_PANEL_WIDTH,
    });
    applyResearchPanelWidth(width);
    event.currentTarget.setAttribute("aria-valuenow", String(width));
    event.currentTarget.setAttribute("aria-valuetext", `${width} pixels`);
  };
  const endResearchPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (researchResizePointerRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    finishResearchPanelResize();
  };
  const resizeResearchPanelWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 16;
    const current = researchPanelWidthRef.current;
    const nextWidth = event.key === "ArrowLeft"
      ? current + step
      : event.key === "ArrowRight"
        ? current - step
        : event.key === "Home"
          ? MIN_RESEARCH_PANEL_WIDTH
          : event.key === "End"
            ? MAX_RESEARCH_PANEL_WIDTH
            : current;
    if (nextWidth === current) return;
    event.preventDefault();
    capturePdfLayoutAnchorRef.current?.();
    const width = applyResearchPanelWidth(nextWidth);
    setResearchPanelWidth(width);
    setResearchPanelResizing(true);
    if (keyboardResizeFrameRef.current !== null) window.cancelAnimationFrame(keyboardResizeFrameRef.current);
    keyboardResizeFrameRef.current = window.requestAnimationFrame(() => {
      keyboardResizeFrameRef.current = null;
      finishResearchPanelResize();
    });
  };
  const layoutStyle = { "--reader-research-width": `${researchPanelWidth}px` } as CSSProperties;
  return (
    <div className="reader-workspace" data-companion-open={companion.detached}>
      <header className="reader-workspace__chrome">
        <h1 className="sr-only">Reader: {editor.metadata.draft.title || snapshot.paper.title}</h1>
        <span className="reader-workspace__navigation-slot" aria-hidden="true" />
        <Breadcrumbs items={[{ label: t("Library"), href: "/library" }, { label: editor.metadata.draft.title || snapshot.paper.title, href: detailHref }, { label: t("Reader") }]} />
        <div className="reader-workspace__utilities" aria-label={t("Reader utilities")}>
          <button className="reader-control reader-control--secondary" type="button" onClick={() => {
            if (companion.detached) companion.attach();
            else if (companion.open()) { setResearchPanelCollapsed(false); setActiveUtility(null); }
          }}>{t(companion.detached ? "Bring notes back" : "Dual monitor · notes window")}</button>
          <button ref={mobilePanelTriggerRef} className="reader-control reader-control--secondary reader-mobile-panel-toggle" type="button" aria-controls="reader-research-panel" aria-expanded={!researchPanelCollapsed} onClick={() => setResearchPanelCollapsed((current) => !current)}>{t("Notes and blocks")}</button>
          <button
            className={activeUtility === "tags" ? "reader-control reader-control--active" : "reader-control reader-control--secondary"}
            type="button"
            aria-pressed={activeUtility === "tags"}
            onClick={(event) => openUtility("tags", event.currentTarget)}
          ><Tags size={15} />{t("Tags")}</button>
          <button
            className={activeUtility === "full-text" ? "reader-control reader-control--active" : "reader-control reader-control--secondary"}
            type="button"
            aria-pressed={activeUtility === "full-text"}
            onClick={(event) => openUtility("full-text", event.currentTarget)}
          ><FileText size={15} />{t("Full Text")}</button>
          {snapshot.paper.lifecycle_state !== "active" ? <StatusBadge>{snapshot.paper.lifecycle_state}</StatusBadge> : null}
        </div>
      {companion.blocked ? <p role="status" className="reader-companion-message">{t("Allow pop-ups for this site, then choose the notes window again. Nothing was moved.")}</p> : null}
      </header>
      <div ref={readerLayoutRef} className={`${activeUtility ? "reader-layout reader-layout--with-utility" : "reader-layout"}${researchPanelResizing ? " is-resizing" : ""}`} data-research-collapsed={researchPanelCollapsed} style={layoutStyle}>
        {!companion.detached && narrowReader && !researchPanelCollapsed ? <button className="reader-mobile-panel-backdrop" aria-label={t("Close research panel")} type="button" onClick={() => setResearchPanelCollapsed(true)} /> : null}
        <div ref={companion.slot} className="reader-companion-slot" />
        {companion.host ? createPortal(<>
          {companion.detached ? <header className="reader-companion-heading"><strong>{snapshot.paper.title}</strong><p>{t("Move this window to your second monitor. Keep the PDF window open; notes and page links stay connected.")}</p><button className="reader-control" type="button" onClick={companion.attach}>{t("Bring notes back")}</button><button className="reader-control reader-control--secondary" type="button" onClick={() => setAiRequest({ token: Date.now(), action: "summary", selection: null })}>{t("Summarize paper with AI")}</button></header> : null}
        <aside ref={mobilePanelRef} id="reader-research-panel" className="reader-research-panel" aria-label={t("Paper Note and Note Blocks")} data-collapsed={researchPanelCollapsed} role={!companion.detached && narrowReader && !researchPanelCollapsed ? "dialog" : undefined} aria-modal={!companion.detached && narrowReader && !researchPanelCollapsed ? true : undefined}>
          {researchPanelCollapsed ? (
            <button className="reader-research-panel__collapse" type="button" aria-label={t("Expand research panel")} onClick={() => setResearchPanelCollapsed(false)}><ChevronRight size={16} /></button>
          ) : (
            <>
              <section className="reader-paper-context" aria-label={t("Paper and Note context")}>
                <div className="reader-paper-context__heading">
                  <div>
                    <strong>{editor.metadata.draft.authors || "Authors unknown"}</strong>
                    <span>{[editor.metadata.draft.journal, editor.metadata.draft.year].filter(Boolean).join(" · ") || "Citation metadata is incomplete."}</span>
                    {editor.metadata.draft.doi ? <span className="reader-paper-context__identifier">DOI {editor.metadata.draft.doi}</span> : snapshot.paper.arxiv_id ? <span className="reader-paper-context__identifier">arXiv {snapshot.paper.arxiv_id}</span> : null}
                  </div>
                  <button hidden={companion.detached} className="reader-research-panel__collapse" type="button" aria-label={t("Collapse research panel")} onClick={() => setResearchPanelCollapsed(true)}><ChevronLeft size={16} /></button>
                </div>
                <label className="reader-paper-context__status"><span>{t("Reading status")}</span><StatusBadge>{readingStatus}</StatusBadge><select value={readingStatus} disabled={mutationBusy} onChange={(event) => void saveReadingStatus(event.target.value as "unread" | "reading" | "read" | "finished")}><option value="unread">{t("Unread")}</option><option value="reading">{t("Reading")}</option><option value="read">{t("Read")}</option><option value="finished">{t("Finished")}</option></select></label>
                {readingStatusMessage ? <p className="reader-editor__status" role="status">{t(readingStatusMessage)}</p> : null}
                {draftRestored ? <div className="reader-paper-context__actions"><span className="draft-restored-notice" role="status">{t("Draft restored")}</span></div> : null}
              </section>
              <div className="reader-panel-tabs" role="tablist" aria-label={t("Research panel tasks")}>
                {RESEARCH_PANEL_TABS.map((tab, index) => <button ref={(node) => { researchTabRefs.current[index] = node; }} key={tab} id={`reader-tab-${tab}`} className={activeResearchTab === tab ? "reader-panel-tabs__tab is-active" : "reader-panel-tabs__tab"} type="button" role="tab" aria-selected={activeResearchTab === tab} aria-controls={`reader-panel-${tab}`} onKeyDown={(event) => moveResearchTab(event, tab)} onClick={() => setActiveResearchTab(tab)}>{t(tab === "note" ? "Note" : tab === "blocks" ? "Blocks" : "Details")}</button>)}
              </div>
              <div className="reader-research-panel__content">
          <section id="reader-panel-details" className="reader-editor reader-metadata-editor" aria-labelledby="reader-tab-details" role="tabpanel" hidden={activeResearchTab !== "details"}>
            <div className="reader-note__heading">
              <div>
                <h2 id="metadata-editor-title">{t("Paper metadata")}</h2>
              </div>
              <SaveStatus state={editor.metadata.saveState} />
            </div>
            <div className="reader-editor__fields">
              {(Object.keys(FIELD_LABELS) as Array<keyof EditablePaperMetadata>).map((field) => {
                const changed = metadataChanged.includes(field);
                const multiline = field === "abstract";
                return (
                  <label className={changed ? "reader-field reader-field--changed" : "reader-field"} key={field}>
                    <span>{t(FIELD_LABELS[field])}{changed ? t(" (changed)") : ""}</span>
                    {multiline ? (
                      <textarea
                        rows={5}
                        value={editor.metadata.draft[field]}
                        onChange={(event) => updateMetadataField(field, event.target.value)}
                      />
                    ) : (
                      <input
                        type="text"
                        inputMode={field === "year" ? "numeric" : "text"}
                        value={editor.metadata.draft[field]}
                        onChange={(event) => updateMetadataField(field, event.target.value)}
                      />
                    )}
                  </label>
                );
              })}
            </div>
            <p className="reader-editor__status" role="status" aria-live="polite">
              {editor.metadata.message || `${metadataChanged.length} changed field${metadataChanged.length === 1 ? "" : "s"}.`}
            </p>
            <div className="reader-editor__actions">
              <button className="reader-control" type="button" disabled={!metadataChanged.length || mutationBusy || Boolean(editor.metadata.activeSave) || editor.metadata.saveState === "changed_elsewhere"} onClick={saveMetadata}>
                <Save size={15} />{editor.metadata.saveState === "saving" ? "Saving…" : "Save Metadata"}
              </button>
              <button ref={metadataTriggerRef} className="reader-control reader-control--secondary" type="button" disabled={enrichment.status === "saving" || mutationBusy} onClick={() => { if (companion.detached) companion.attach(); setMetadataReviewOpen(true); void fetchMetadataCandidates(enrichment.status === "conflict"); }}><RotateCcw size={15} />{t(enrichment.status === "loading" ? "Checking…" : "Find updates")}</button>
              {editor.metadata.saveState === "changed_elsewhere" ? <>
                <button className="reader-control reader-control--secondary" type="button" disabled={editor.metadata.remoteRevision === editor.metadata.revision} onClick={() => updateMetadata((current) => {
                  const kept = keepMyRevisionDraft(current);
                  return { ...kept, status: "dirty", message: "Your local metadata draft will be saved against the latest version." };
                })}>{t("Keep my draft")}</button>
                <button className="reader-control reader-control--secondary" type="button" onClick={() => {
                  if (!window.confirm("Use the latest saved metadata and discard the local draft?")) return;
                  updateMetadata((current) => {
                    const latest = applyLatestRevisionDraft(current);
                    return { ...latest, status: "clean", message: "Latest saved metadata in use." };
                  });
                }}>{t("Use latest saved version")}</button>
                <button className="reader-control reader-control--secondary" type="button" onClick={reloadMetadata}><RotateCcw size={15} />{t("Reload current metadata")}</button>
                <details className="reader-note__conflict-review"><summary>{t("Review local and latest")}</summary><h3>{t("My draft")}</h3><pre>{JSON.stringify(editor.metadata.draft, null, 2)}</pre><h3>{t("Latest saved value")}</h3><pre>{JSON.stringify(editor.metadata.remote, null, 2)}</pre></details>
              </> : null}
            </div>
          </section>

          <section id="reader-panel-note" className="reader-editor reader-note" aria-labelledby="reader-tab-note" role="tabpanel" hidden={activeResearchTab !== "note"}>
            <div className="reader-note__heading">
              <div>
                <h2 id="reading-note-editor-title">{t("Paper Note")}</h2>
              </div>
              {noteUnavailable ? <StatusBadge tone="rose">{t("Unavailable")}</StatusBadge> : <SaveStatus state={editor.note.saveState} />}
            </div>
            {noteUnavailable ? (
              <div className="reader-note__message" role="status">
                The persisted note could not be read. Saving is disabled until the current version can be loaded.
              </div>
            ) : null}
            <div className="reader-note__formatting" role="toolbar" aria-label={t("Paper Note formatting")}>
              <button className="reader-control reader-control--secondary" type="button" title={t("Heading")} aria-label={t("Heading")} disabled={noteUnavailable || notePreviewOpen} onMouseDown={preserveNoteSelection} onClick={() => formatPaperNote("heading")}><Heading2 size={15} /></button>
              <button className="reader-control reader-control--secondary" type="button" title={t("Bold")} aria-label={t("Bold")} disabled={noteUnavailable || notePreviewOpen} onMouseDown={preserveNoteSelection} onClick={() => formatPaperNote("bold")}><Bold size={15} /></button>
              <button className="reader-control reader-control--secondary" type="button" title={t("Italic")} aria-label={t("Italic")} disabled={noteUnavailable || notePreviewOpen} onMouseDown={preserveNoteSelection} onClick={() => formatPaperNote("italic")}><Italic size={15} /></button>
              <button className="reader-control reader-control--secondary" type="button" title={t("Bullets")} aria-label={t("Bullets")} disabled={noteUnavailable || notePreviewOpen} onMouseDown={preserveNoteSelection} onClick={() => formatPaperNote("bullets")}><List size={15} /></button>
              <button className="reader-control reader-control--secondary" type="button" title={t("Numbered list")} aria-label={t("Numbered list")} disabled={noteUnavailable || notePreviewOpen} onMouseDown={preserveNoteSelection} onClick={() => formatPaperNote("numbered")}><ListOrdered size={15} /></button>
              <button className="reader-control reader-control--secondary" type="button" title={t("Task list")} aria-label={t("Task list")} disabled={noteUnavailable || notePreviewOpen} onMouseDown={preserveNoteSelection} onClick={() => formatPaperNote("task")}><ListTodo size={15} /></button>
              <button className="reader-control reader-control--secondary" type="button" title={t("Quote")} aria-label={t("Quote")} disabled={noteUnavailable || notePreviewOpen} onMouseDown={preserveNoteSelection} onClick={() => formatPaperNote("quote")}><Quote size={15} /></button>
              <button ref={linkTriggerRef} className="reader-control reader-control--secondary" type="button" title={t("Link")} aria-label={t("Link")} disabled={noteUnavailable || notePreviewOpen} onMouseDown={preserveNoteSelection} onClick={() => formatPaperNote("link")}><Link2 size={15} /></button>
              <button className={notePreviewOpen ? "reader-control reader-control--active" : "reader-control reader-control--secondary"} type="button" title={notePreviewOpen ? "Edit note" : "Preview note"} aria-label={notePreviewOpen ? "Edit note" : "Preview note"} disabled={noteUnavailable} aria-pressed={notePreviewOpen} onClick={() => setNotePreviewOpen((current) => !current)}>{notePreviewOpen ? <Pencil size={15} /> : <Eye size={15} />}</button>
            </div>
            {notePreviewOpen ? <PaperNoteMarkdownPreview content={paperNoteBody(editor.note.draft)} /> : (
              <label className="reader-field">
                <span className="sr-only">{t("Paper Note")}</span>
                <textarea
                  ref={noteTextareaRef}
                  className="reader-note__textarea"
                  rows={18}
                  value={paperNoteBody(editor.note.draft)}
                  disabled={noteUnavailable}
                  onChange={(event) => updateNote((current) => {
                    const nextDraft = replacePaperNoteBody(current.draft, event.target.value);
                    const updated = editRevisionDraft(current, nextDraft);
                    return {
                      ...updated,
                      sha256: updated.revision,
                      status: nextDraft === current.baseline ? "clean" : "dirty",
                      message: "",
                    };
                  })}
                />
              </label>
            )}
            <p className="reader-editor__status" role="status" aria-live="polite">
              {editor.note.message || (editor.note.exists ? "Markdown-compatible plain text. Local drafts are preserved until an explicit Save succeeds." : "No persisted note exists; Save will create it.")}
            </p>
            <div className="reader-editor__actions">
              <button className="reader-control" type="button" disabled={editor.note.draft === editor.note.baseline || mutationBusy || Boolean(editor.note.activeSave) || editor.note.saveState === "changed_elsewhere" || noteUnavailable} onClick={saveNote}>
                <Save size={15} />{t(editor.note.saveState === "saving" ? "Saving…" : "Save Paper Note")}
              </button>
              {editor.note.saveState === "changed_elsewhere" ? <>
                <button className="reader-control reader-control--secondary" type="button" disabled={editor.note.remoteRevision === editor.note.revision} onClick={() => updateNote((current) => {
                  const kept = keepMyRevisionDraft(current);
                  return { ...kept, sha256: kept.revision, status: "dirty", message: "Your local draft will be saved against the latest version when you choose Save." };
                })}>{t("Keep my draft")}</button>
                <button className="reader-control reader-control--secondary" type="button" onClick={() => {
                  if (!window.confirm("Use the latest saved Paper Note and discard the local draft?")) return;
                  updateNote((current) => {
                    const latest = applyLatestRevisionDraft(current);
                    return { ...latest, sha256: latest.revision, status: "clean", message: "Latest saved Paper Note in use." };
                  });
                }}>{t("Use latest saved version")}</button>
                <button className="reader-control reader-control--secondary" type="button" onClick={reloadNote}><RotateCcw size={15} />{t("Reload current Paper Note")}</button>
                <details className="reader-note__conflict-review"><summary>{t("Review local and latest")}</summary><h3>{t("My draft")}</h3><pre>{paperNoteBody(editor.note.draft)}</pre><h3>{t("Latest saved value")}</h3><pre>{paperNoteBody(editor.note.remote)}</pre></details>
              </> : null}
            </div>
          </section>
          <section id="reader-panel-blocks" role="tabpanel" aria-labelledby="reader-tab-blocks" hidden={activeResearchTab !== "blocks"}>
            {blocksVisited ? <NoteBlocksWorkspace key={snapshot.paper.paper_id} paperId={snapshot.paper.paper_id} focusBlockId={noteBlockId} refreshToken={blockRefreshToken} onChanged={() => setBlockRefreshToken((current) => current + 1)} onJumpToPage={jumpToPage} mutationBusy={mutationBusy} acquireMutation={beginMutation} releaseMutation={finishMutation} /> : null}
          </section>
          <PaperNextSteps key={`${snapshot.paper.paper_id}:${readingStatus}`} paperId={snapshot.paper.paper_id} />
              </div>
            </>
          )}
        </aside>
      <ReaderSelectionAssistant key={`${snapshot.paper.paper_id}:${aiRequest?.token ?? "closed"}`} paperId={snapshot.paper.paper_id} request={aiRequest} onClose={() => setAiRequest(null)} onUseDraft={(text) => {
        if (noteUnavailable) { setSelectionMessage("The Paper Note is unavailable. Copy the AI draft before leaving."); return; }
        updateNote((current) => {
          const draft = `${current.draft.trimEnd()}\n\n${text}\n`;
          return { ...editRevisionDraft(current, draft), status: "dirty", message: "AI draft appended. Verify it against the source and choose Save explicitly." };
        });
        setActiveResearchTab("note"); setResearchPanelCollapsed(false);
      }} />
        </>, companion.host) : null}
        {!companion.detached && !researchPanelCollapsed && !narrowReader ? (
          <div
            className="reader-panel-resize"
            role="separator"
            tabIndex={0}
            aria-controls="reader-research-panel"
            aria-orientation="vertical"
            aria-label={t("Resize research panel. Use Left and Right Arrow keys.")}
            aria-valuemin={MIN_RESEARCH_PANEL_WIDTH}
            aria-valuemax={MAX_RESEARCH_PANEL_WIDTH}
            aria-valuenow={researchPanelWidth}
            aria-valuetext={`${researchPanelWidth} pixels`}
            onPointerDown={beginResearchPanelResize}
            onPointerMove={moveResearchPanelResize}
            onPointerUp={endResearchPanelResize}
            onPointerCancel={endResearchPanelResize}
            onKeyDown={resizeResearchPanelWithKeyboard}
          />
        ) : null}
        <section className="reader-stage" aria-label={t("Managed PDF viewing region")}>
          <ReaderPdf
            snapshot={snapshot}
            layoutResizeActive={researchPanelResizing}
            layoutResizeVersion={researchPanelResizeVersion}
            onCaptureLayoutAnchor={capturePdfLayoutAnchor}
            onSelectionChange={setPdfSelection}
            pageJump={pageJump}
            highlights={visibleHighlights}
            onRemoveHighlight={removeHighlight}
            memoRailsVisible={memoRailsVisible}
            annotationActions={<ReaderFloatingMemos key={snapshot.paper.paper_id} paperId={snapshot.paper.paper_id} onVisibilityChange={updateMemoRailsVisibility} selection={pdfSelection} refreshToken={blockRefreshToken} mutationBusy={mutationBusy} acquireMutation={beginMutation} releaseMutation={finishMutation} onSaved={() => setBlockRefreshToken((current) => current + 1)} onHighlights={setCitedHighlights} onJumpToPage={jumpToPage} />}
            selectionActions={<div className="reader-selection-capture" aria-live="polite">{pdfSelection ? <><strong>{t("Selected text · Page {page}", { page: pdfSelection.pageNumber })}</strong><blockquote>{pdfSelection.text}</blockquote><div className="reader-editor__actions"><button className="reader-control" type="button" disabled={mutationBusy || !extendedReaderCommands} title={!extendedReaderCommands ? t("Cited selection blocks require the browser or cloud workspace.") : undefined} onClick={() => void saveSelectionEvidence()}><Quote size={15} />{t("Save as cited evidence")}</button><button className="reader-control reader-control--secondary" type="button" disabled={mutationBusy} onClick={() => saveHighlight()}>{t("Highlight")}</button><button className="reader-control reader-control--secondary" type="button" onClick={() => setAiRequest({ token: Date.now(), action: "explain", selection: structuredClone(pdfSelection) })}>{t("Explain selected text with AI")}</button><button className="reader-control reader-control--secondary" type="button" onClick={() => setPdfSelection(null)}>{t("Clear selection")}</button></div></> : <span className="muted-text">{t("Select PDF text to save a cited evidence block or highlight.")}</span>}<button className="reader-control reader-control--secondary" type="button" onClick={() => setAiRequest({ token: Date.now(), action: "summary", selection: null })}>{t("Summarize paper with AI")}</button>{selectionMessage ? <p role="status">{t(selectionMessage)}</p> : null}</div>}
          />
        </section>
        {activeUtility ? (
          <aside ref={utilityDrawerRef} className="reader-utility-drawer" aria-label={t("Reader utilities")} tabIndex={-1}>
            <div className="reader-utility-drawer__header">
              <h2 id="reader-utility-drawer-title">{t(activeUtility === "tags" ? "Tags" : "Full Text")}</h2>
              <button className="reader-research-panel__collapse" type="button" aria-label={t("Close utility drawer")} onClick={closeUtility}><X size={16} /></button>
            </div>
            <div id="reader-utility-panel" className="reader-utility-drawer__content" role="region" aria-labelledby="reader-utility-drawer-title">
              {activeUtility === "full-text" ? <FullTextWorkspace key={`full-text:${snapshot.paper.paper_id}`} paperId={snapshot.paper.paper_id} onJumpToPage={jumpToPage} /> : null}
              {activeUtility === "tags" ? (
                <section className="reader-utility-section" aria-labelledby="paper-tags-editor-title">
                  <div className="reader-note__heading">
                    <h2 id="paper-tags-editor-title">{t("Tags")}</h2>
                    <SaveStatus state={commandSaveState(editor.tags.status)} />
                  </div>
                  <div>
                    <h3>{t("Current")}</h3>
                    <div className="tag-list" aria-label={t("Current Paper tags")}>
                      {editor.tags.values.length ? editor.tags.values.map((tag) => (
                        <button className="reader-tag-chip" type="button" key={tag} disabled={mutationBusy} onClick={() => changePaperTag("remove", tag)} aria-label={`Remove ${tagLabel(tag)}`}>
                          {tagLabel(tag)} <span aria-hidden="true">×</span>
                        </button>
                      )) : <span className="muted-text">{t("No tags yet.")}</span>}
                    </div>
                  </div>
                  <div>
                    <h3>{t("Add tag")}</h3>
                    <div className="reader-utility-section__add-tag">
                      <input type="text" list="reader-canonical-tag-options" aria-label={t("Add a tag")} value={editor.tags.draft} disabled={mutationBusy} onChange={(event) => setEditor((current) => ({
                        ...current,
                        tags: { ...current.tags, draft: event.target.value, status: event.target.value.trim() ? "dirty" : "clean", message: "" },
                      }))} />
                      <datalist id="reader-canonical-tag-options">
                        {tagBook.status === "success" ? tagBook.data.map((tag) => <option key={tag.canonical_key} value={tag.label} />) : null}
                      </datalist>
                      <button className="reader-control" type="button" disabled={!editor.tags.draft.trim() || mutationBusy} onClick={() => changePaperTag("add", editor.tags.draft)}><Save size={15} />{editor.tags.status === "saving" ? "Adding…" : "Add"}</button>
                    </div>
                    {tagBook.status === "error" ? <p className="reader-editor__status" role="status">{tagBook.message} <button className="text-link" type="button" onClick={() => setTagBook({ status: "idle" })}>{t("Retry suggestions")}</button></p> : null}
                    {editor.tags.status === "conflict" ? <button className="reader-control reader-control--secondary" type="button" onClick={reloadPaperTags}><RotateCcw size={15} />{t("Reload tags")}</button> : null}
                  </div>
                  <div ref={candidateReviewSectionRef}>
                    <div className="reader-note__heading"><h3>{t("Review suggestions")}</h3><button className="reader-control reader-control--secondary" type="button" disabled={candidateReview.status === "loading" || mutationBusy} onClick={() => generateTagCandidates(false)}><RotateCcw size={15} />{t(candidateReview.status === "loading" ? "Finding…" : "Suggest tags")}</button></div>
                    <p className="muted-text">{t("Suggestions use saved metadata and deterministic rules. They are not LLM output.")}</p>
                    <p className="reader-editor__status" role="status" aria-live="polite">{t(candidateReview.message)}</p>
                    {candidateReview.collection?.items.length ? (
                      <div className="reader-suggestion-list" aria-label={t("Suggested tags to review")}>
                        {candidateReview.collection.items.map((candidate) => {
                          const applicable = availableSuggestions.some((item) => item.candidate_id === candidate.candidate_id);
                          const disabled = candidateReview.status === "loading" || mutationBusy;
                          return <article className="reader-candidate-row" key={candidate.candidate_id}><div className="reader-note__heading"><label className="reader-suggestion"><input type="checkbox" aria-label={t("Select {tag} to apply", { tag: candidate.tag_text })} checked={selectedSuggestions.includes(candidate.candidate_id)} disabled={disabled || !applicable} onChange={() => setSelectedSuggestions((current) => current.includes(candidate.candidate_id) ? current.filter((id) => id !== candidate.candidate_id) : [...current, candidate.candidate_id])} />{candidate.tag_text}</label><StatusBadge>{candidate.state}</StatusBadge></div><p className="muted-text">{candidate.reason || candidate.source_label}</p>{candidate.evidence.slice(0, 3).map((evidence, index) => <blockquote key={index}>{evidence.snippet || evidence.matched_text}</blockquote>)}<div className="reader-candidate-row__actions"><button className="reader-control reader-control--secondary" type="button" disabled={disabled || !applicable || candidate.state === "approved"} onClick={() => void reviewSuggestion(candidate.candidate_id, "approve")}>{t("Approve")}</button><button className="reader-control reader-control--secondary" type="button" disabled={disabled || candidate.state === "applied" || candidate.state === "rejected"} onClick={() => void reviewSuggestion(candidate.candidate_id, "reject")}>{t("Reject")}</button>{!candidate.resolved_canonical ? <button className="reader-control reader-control--secondary" type="button" disabled={disabled || candidate.state === "rejected" || candidate.quality === "rejected"} onClick={() => void reviewSuggestion(candidate.candidate_id, "promote")}>{t("Promote to canonical tag")}</button> : null}</div></article>;
                        })}
                      </div>
                    ) : candidateReview.status === "ready" ? <p className="muted-text">{t("No suggested tags are ready to apply.")}</p> : null}
                    {candidateReview.status === "error" ? <button className="reader-control reader-control--secondary" type="button" disabled={mutationBusy} onClick={() => {
                      setSelectedSuggestions([]);
                      setCandidateReview(initialCandidateReview() as CandidateReviewState);
                    }}><RotateCcw size={15} />{t("Retry loading suggestions")}</button> : null}
                    <button className="reader-control" type="button" disabled={!selectedSuggestions.length || candidateReview.status === "loading" || mutationBusy} onClick={applySelectedSuggestions}><Save size={15} />{t("Apply selected")}</button>
                    {candidateReview.status === "conflict" ? <button className="reader-control reader-control--secondary" type="button" onClick={() => generateTagCandidates(false)}><RotateCcw size={15} />{t("Refresh suggestions")}</button> : null}
                  </div>
                </section>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>

      {linkPopoverOpen ? (
        <div className="metadata-review-backdrop" role="presentation">
          <form ref={linkDialogRef} className="reader-link-dialog" role="dialog" aria-modal="true" aria-labelledby="paper-note-link-title" onSubmit={(event) => { event.preventDefault(); if (!linkUrl.trim()) return; formatPaperNote("link", linkUrl.trim()); closeLinkPopover(); }}>
            <div className="reader-note__heading"><h2 id="paper-note-link-title">{t("Add link")}</h2><button className="reader-research-panel__collapse" type="button" aria-label={t("Close link dialog")} onClick={closeLinkPopover}><X size={16} /></button></div>
            <label className="reader-field"><span>{t("Link address")}</span><input ref={linkInputRef} type="url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://example.org" /></label>
            <div className="reader-editor__actions"><button className="reader-control" type="submit" disabled={!linkUrl.trim()}>{t("Insert link")}</button><button className="reader-control reader-control--secondary" type="button" onClick={closeLinkPopover}>{t("Cancel")}</button></div>
          </form>
        </div>
      ) : null}
      {metadataReviewOpen ? (
        <div className="metadata-review-backdrop" role="presentation">
          <div className="metadata-review-dialog" role="dialog" aria-modal="true" aria-labelledby="metadata-enrichment-title" tabIndex={-1} ref={metadataDialogRef}>
            <div className="reader-note__heading">
              <div><h2 id="metadata-enrichment-title">{t("Metadata updates")}</h2></div>
              <button className="reader-research-panel__collapse" type="button" aria-label={t("Close metadata updates")} disabled={enrichment.status === "saving"} onClick={closeMetadataReview}><X size={16} /></button>
            </div>
            <p className="reader-editor__status" role="status" aria-live="polite">{enrichment.message || "Looking for metadata updates. Nothing is applied automatically."}</p>
            {metadataChanged.length ? <p className="metadata-enrichment__notice">{t("Your unsaved metadata edits stay separate; only checked updates are applied.")}</p> : null}
            {enrichmentChanges.length ? <div className="metadata-review-list" aria-label={t("Metadata candidate comparison")}>
              {enrichmentChanges.map((field) => <label className="metadata-review-field" key={field.field}>
                <input type="checkbox" checked={enrichment.selectedFields.includes(field.field)} disabled={mutationBusy || enrichment.status === "saving"} onChange={() => toggleCandidateField(field.field)} aria-label={`Select ${FIELD_LABELS[field.field]} update`} />
                <span><strong>{FIELD_LABELS[field.field]}</strong><small>Current: {field.current_value || "—"}</small><small>Suggested: {field.candidate_value}</small></span>
              </label>)}
            </div> : enrichment.status === "ready" ? <p className="muted-text">{t("No metadata updates need review.")}</p> : null}
            <div className="reader-editor__actions">
              <button className="reader-control reader-control--secondary" type="button" disabled={enrichment.status === "loading" || enrichment.status === "saving" || mutationBusy} onClick={() => fetchMetadataCandidates(enrichment.status === "conflict")}><RotateCcw size={15} />{enrichment.status === "loading" ? "Checking…" : "Check again"}</button>
              <button className="reader-control" type="button" disabled={!enrichment.selectedFields.length || enrichment.status === "loading" || enrichment.status === "saving" || mutationBusy} onClick={applySelectedCandidates}><Save size={15} />{enrichment.status === "saving" ? "Applying…" : "Apply selected"}</button>
              {enrichment.status === "conflict" ? <button className="reader-control reader-control--secondary" type="button" onClick={() => fetchMetadataCandidates(true)}><RotateCcw size={15} />{t("Refresh updates")}</button> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


export function ReaderView({ paperId }: { paperId: string }) {
  const { t } = useI18n();
  const [retryCount, setRetryCount] = useState(0);
  const resource = useApiResource(
    `reader-snapshot:${paperId}:${retryCount}`,
    () => apiClient.getReaderSnapshot(paperId),
  );
  return (
    <div className="page-stack reader-page-stack">
      {resource.status === "loading" ? <LoadingState label={t("Loading Reader snapshot")} /> : null}
      {resource.status === "unavailable" ? (
        <div className="reader-metadata-state">
          <UnavailableState description={resource.message} />
          <button className="reader-control" type="button" onClick={() => setRetryCount((value) => value + 1)}>{t("Retry local API")}</button>
        </div>
      ) : null}
      {resource.status === "not-found" ? <EmptyState title={t("Paper not found")} description={t("This paper is not available in your library.")} /> : null}
      {resource.status === "error" ? (
        <div className="reader-metadata-state">
          <ErrorState description={resource.message} />
          <button className="reader-control" type="button" onClick={() => setRetryCount((value) => value + 1)}>{t("Retry local API")}</button>
        </div>
      ) : null}
      {resource.status === "success" ? (
        <ReaderWorkspace key={resource.data.paper.paper_id} snapshot={resource.data} />
      ) : null}
    </div>
  );
}
