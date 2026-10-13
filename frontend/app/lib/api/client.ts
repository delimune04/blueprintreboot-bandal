import type { ArchivePaperResponse, CandidateSummary, CanonicalTagGovernanceResponse, CanonicalTagGovernanceSnapshot, DashboardSnapshot, EditableNoteBlockContent, EditablePaperMetadata, EditableProjectMetadata, FullTextDocument, FullTextStatus, HealthSummary, LibraryStatus, ManagedPdfImportResponse, ManagedPdfReconnectResponse, ManagedPdfScanResponse, MetadataCommandResponse, MetadataEnrichmentPreview, NoteBlockCollection, NoteBlockCommandResponse, NoteBlockLinkCommandResponse, PaginatedPaperList, PaginatedProjectList, PaginatedTagList, PaperDetail, PaperLinkCommandResponse, PaperTagCommandResponse, ProjectCommandResponse, ProjectDetail, ProjectLinkType, ReaderSnapshot, ReadingNoteCommandResponse, ReadingStatusCommandResponse, RemoveManagedPdfResponse, SettingsSummary, TagCandidateApplyResponse, TagCandidateCollection, TagCandidateReviewQueue } from "./types";
import { collectAllPaginatedItems } from "./pagination.mjs";
import { demoPdfUrl, demoRequest, isDemoEnabled } from "../demo/adapter.mjs";

const API_BASE_URL = (process.env.NEXT_PUBLIC_BLUEPRINT_API_BASE_URL || "/api/blueprint").replace(/\/$/, "");

export class ApiClientError extends Error {
  constructor(message: string, public readonly kind: "unavailable" | "read-model" | "not-found" | "conflict" | "invalid" | "error", public readonly status?: number) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function request<T>(
  path: string,
  options: { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: object | FormData; notFoundMessage?: string; signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response;
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
    const requestBody: BodyInit | undefined = options.body === undefined
      ? undefined
      : isFormData
        ? options.body as FormData
        : JSON.stringify(options.body);
    if (options.body !== undefined && !isFormData) headers["Content-Type"] = "application/json";
    const init: RequestInit = {
      method: options.method ?? "GET",
      headers,
      body: requestBody,
      cache: "no-store",
      signal: options.signal,
    };
    response = isDemoEnabled()
      ? await demoRequest(path, init)
      : await fetch(`${API_BASE_URL}${path}`, init);
  } catch {
    throw new ApiClientError("The local BluePrintReboot API could not be reached.", "unavailable");
  }

  if (!response.ok) {
    if (response.status === 501) {
      const failure = await response.json().catch(() => ({})) as { detail?: string };
      throw new ApiClientError(failure.detail || "This operation is unavailable in the browser demonstration.", "error", 501);
    }
    if (response.status === 503) {
      const failureState = response.headers.get("X-Blueprint-Error-State");
      if (failureState === "api-unavailable") {
        throw new ApiClientError("The local BluePrintReboot API could not be reached.", "unavailable", 503);
      }
      if (failureState === "command-unavailable") {
        throw new ApiClientError("The local command could not be completed. Retry after checking the API.", "error", 503);
      }
      throw new ApiClientError("The local read model could not be read. Check the local data state and retry.", "read-model", 503);
    }
    if (response.status === 404) throw new ApiClientError(options.notFoundMessage ?? "The requested paper was not found.", "not-found", 404);
    if (response.status === 409) throw new ApiClientError("The saved version changed. Reload the current version before retrying.", "conflict", 409);
    if (response.status === 422) throw new ApiClientError("The submitted command data is invalid.", "invalid", 422);
    throw new ApiClientError(`The local API returned HTTP ${response.status}.`, "error", response.status);
  }
  return response.json() as Promise<T>;
}

export function paperPdfUrl(paperId: string): string {
  if (isDemoEnabled()) {
    const base = (process.env.NEXT_PUBLIC_BANDAL_DEMO_BASE || "").replace(/\/$/, "");
    return `${base}${demoPdfUrl(paperId)}`;
  }
  return `${API_BASE_URL}/papers/${encodeURIComponent(paperId)}/pdf`;
}

type PaperListOptions = { limit?: number; offset?: number; archiveStatus?: "active" | "archived" | "all"; q?: string; tag?: string; year?: string; status?: string };

function getPapers(options: PaperListOptions = {}) {
  const params = new URLSearchParams({
    limit: String(options.limit ?? 20),
    offset: String(options.offset ?? 0),
    archive_status: options.archiveStatus ?? "active",
  });
  if (options.q) params.set("q", options.q);
  if (options.tag) params.set("tag", options.tag);
  if (options.year) params.set("year", options.year);
  if (options.status) params.set("status", options.status);
  return request<PaginatedPaperList>(`/papers?${params}`);
}

function getProjects(options: { limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams({
    limit: String(options.limit ?? 20),
    offset: String(options.offset ?? 0),
  });
  return request<PaginatedProjectList>(`/projects?${params}`);
}

function getProject(projectId: string, options: { linksLimit?: number; linksOffset?: number } = {}) {
  const params = new URLSearchParams({
    links_limit: String(options.linksLimit ?? 20),
    links_offset: String(options.linksOffset ?? 0),
  });
  return request<ProjectDetail>(
    `/projects/${encodeURIComponent(projectId)}?${params}`,
    { notFoundMessage: "The requested Project was not found." },
  );
}

async function getCompleteProject(projectId: string): Promise<ProjectDetail> {
  let first: ProjectDetail | null = null;
  const links: ProjectDetail["links"] = [];
  let offset = 0;
  while (true) {
    const page = await getProject(projectId, { linksLimit: 100, linksOffset: offset });
    if (first === null) first = page;
    if (
      page.project_revision !== first.project_revision
      || page.links_revision !== first.links_revision
      || page.links_total !== first.links_total
    ) {
      throw new ApiClientError("The Project changed while its links were being loaded. Retry the read.", "conflict", 409);
    }
    links.push(...page.links);
    if (!page.links_has_more) {
      return {
        ...first,
        links,
        links_limit: links.length,
        links_offset: 0,
        links_has_more: false,
      };
    }
    if (page.links.length === 0) {
      throw new ApiClientError("The Project link response did not make progress.", "read-model");
    }
    offset += page.links.length;
  }
}

function getTags(options: { limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams({
    limit: String(options.limit ?? 20),
    offset: String(options.offset ?? 0),
  });
  return request<PaginatedTagList>(`/tags?${params}`);
}

export const apiClient = {
  getHealth: () => request<HealthSummary>("/health"),
  getLibraryStatus: () => request<LibraryStatus>("/library/status"),
  scanManagedPdfs: () => request<ManagedPdfScanResponse>("/papers/scan", { method: "POST", body: {} }),
  importManagedPdfs: (relativePaths: string[]) => request<ManagedPdfImportResponse>(
    "/papers/import",
    { method: "POST", body: { relative_paths: relativePaths } },
  ),
  uploadManagedPdfs: (files: File[]) => {
    const body = new FormData();
    files.forEach((file) => body.append("files", file, file.name));
    return request<ManagedPdfImportResponse>("/papers/upload", { method: "POST", body });
  },
  reconnectManagedPdf: (paperId: string, relativePath: string) => request<ManagedPdfReconnectResponse>(
    "/papers/reconnect",
    { method: "POST", body: { paper_id: paperId, relative_path: relativePath } },
  ),
  removeManagedPdf: (paperId: string, expectedPdfRevision: string) => request<RemoveManagedPdfResponse>(
    `/papers/${encodeURIComponent(paperId)}/remove-pdf`,
    { method: "POST", body: { expected_pdf_revision: expectedPdfRevision, confirm: true } },
  ),
  archivePaper: (paperId: string, expectedLifecycleRevision: string) => request<ArchivePaperResponse>(
    `/papers/${encodeURIComponent(paperId)}/archive`,
    { method: "POST", body: { expected_lifecycle_revision: expectedLifecycleRevision, confirm: true } },
  ),
  getPapers,
  getAllPapers: (options: Omit<PaperListOptions, "limit" | "offset"> = {}) => collectAllPaginatedItems(
    ({ limit, offset }) => getPapers({ ...options, limit, offset }),
  ),
  getPaper: (paperId: string) => request<PaperDetail>(`/papers/${encodeURIComponent(paperId)}`),
  getProjects,
  getAllProjects: () => collectAllPaginatedItems(getProjects),
  getProject,
  getCompleteProject,
  createProject: (project: EditableProjectMetadata) => request<ProjectCommandResponse>(
    "/projects",
    { method: "POST", body: project },
  ),
  updateProject: (
    projectId: string,
    changes: Partial<EditableProjectMetadata>,
    expectedRevision: string,
  ) => request<ProjectCommandResponse>(
    `/projects/${encodeURIComponent(projectId)}`,
    {
      method: "PATCH",
      body: { changes, expected_revision: expectedRevision },
      notFoundMessage: "The requested Project was not found.",
    },
  ),
  archiveProject: (projectId: string, expectedRevision: string) => request<ProjectCommandResponse>(
    `/projects/${encodeURIComponent(projectId)}/archive`,
    {
      method: "POST",
      body: { expected_revision: expectedRevision },
      notFoundMessage: "The requested Project was not found.",
    },
  ),
  addProjectPaperLink: (
    projectId: string,
    paperId: string,
    linkType: ProjectLinkType,
    expectedLinksRevision: string,
  ) => request<PaperLinkCommandResponse>(
    `/projects/${encodeURIComponent(projectId)}/paper-links`,
    {
      method: "POST",
      body: {
        paper_id: paperId,
        link_type: linkType,
        expected_links_revision: expectedLinksRevision,
      },
      notFoundMessage: "The requested Project or Paper was not found.",
    },
  ),
  removeProjectPaperLink: (
    projectId: string,
    linkId: string,
    expectedLinksRevision: string,
  ) => request<PaperLinkCommandResponse>(
    `/projects/${encodeURIComponent(projectId)}/paper-links/${encodeURIComponent(linkId)}`,
    {
      method: "DELETE",
      body: { expected_links_revision: expectedLinksRevision },
      notFoundMessage: "The requested Project or Paper link was not found.",
    },
  ),
  addProjectNoteBlockLink: (
    projectId: string,
    paperId: string,
    noteBlockId: string,
    linkType: ProjectLinkType,
    expectedLinksRevision: string,
  ) => request<NoteBlockLinkCommandResponse>(
    `/projects/${encodeURIComponent(projectId)}/note-block-links`,
    {
      method: "POST",
      body: {
        paper_id: paperId,
        note_block_id: noteBlockId,
        link_type: linkType,
        expected_links_revision: expectedLinksRevision,
      },
      notFoundMessage: "The requested Project, Paper, or Note Block was not found.",
    },
  ),
  removeProjectNoteBlockLink: (
    projectId: string,
    linkId: string,
    expectedLinksRevision: string,
  ) => request<NoteBlockLinkCommandResponse>(
    `/projects/${encodeURIComponent(projectId)}/note-block-links/${encodeURIComponent(linkId)}`,
    {
      method: "DELETE",
      body: { expected_links_revision: expectedLinksRevision },
      notFoundMessage: "The requested Project or Note Block link was not found.",
    },
  ),
  getTags,
  getAllTags: () => collectAllPaginatedItems(getTags),
  getTagSummary: () => request<CandidateSummary>("/tags/summary"),
  getTagReviewQueue: (options: { limit?: number; offset?: number } = {}) => request<TagCandidateReviewQueue>(`/tags/review-queue?${new URLSearchParams({ limit: String(options.limit ?? 50), offset: String(options.offset ?? 0) })}`),
  getTagGovernance: () => request<CanonicalTagGovernanceSnapshot>("/tags/governance"),
  createCanonicalTag: (input: { label: string; category: string; description: string; suggestionStrength: number; expectedRevision: string }) => request<CanonicalTagGovernanceResponse>(
    "/tags",
    { method: "POST", body: { label: input.label, category: input.category, description: input.description, suggestion_strength: input.suggestionStrength, expected_revision: input.expectedRevision } },
  ),
  updateCanonicalTag: (canonicalKey: string, changes: { label?: string; category?: string; description?: string; suggestionStrength?: number }, expectedRevision: string) => {
    const { suggestionStrength, ...supportedChanges } = changes;
    return request<CanonicalTagGovernanceResponse>(
      `/tags/${encodeURIComponent(canonicalKey)}`,
      { method: "PATCH", body: { changes: { ...supportedChanges, ...(suggestionStrength === undefined ? {} : { suggestion_strength: suggestionStrength }) }, expected_revision: expectedRevision } },
    );
  },
  addCanonicalTagAlias: (canonicalKey: string, alias: string, expectedRevision: string) => request<CanonicalTagGovernanceResponse>(
    `/tags/${encodeURIComponent(canonicalKey)}/aliases`,
    { method: "POST", body: { alias, expected_revision: expectedRevision } },
  ),
  removeCanonicalTagAlias: (canonicalKey: string, alias: string, expectedRevision: string) => request<CanonicalTagGovernanceResponse>(
    `/tags/${encodeURIComponent(canonicalKey)}/aliases`,
    { method: "DELETE", body: { alias, expected_revision: expectedRevision } },
  ),
  deprecateCanonicalTag: (canonicalKey: string, expectedRevision: string) => request<CanonicalTagGovernanceResponse>(
    `/tags/${encodeURIComponent(canonicalKey)}/deprecate`,
    { method: "POST", body: { expected_revision: expectedRevision } },
  ),
  getSettingsSummary: () => request<SettingsSummary>("/settings/summary"),
  getReaderSnapshot: (paperId: string) => request<ReaderSnapshot>(`/papers/${encodeURIComponent(paperId)}/reader`),
  getFullTextStatus: (paperId: string) => request<FullTextStatus>(
    `/papers/${encodeURIComponent(paperId)}/full-text/status`,
  ),
  getFullText: (paperId: string) => request<FullTextDocument>(
    `/papers/${encodeURIComponent(paperId)}/full-text`,
  ),
  extractFullText: (paperId: string, force = false) => request<FullTextDocument>(
    `/papers/${encodeURIComponent(paperId)}/full-text/extract`,
    { method: "POST", body: { force } },
  ),
  getNoteBlocks: (paperId: string) => request<NoteBlockCollection>(
    `/papers/${encodeURIComponent(paperId)}/note-blocks`,
  ),
  createNoteBlock: (
    paperId: string,
    content: EditableNoteBlockContent,
    expectedRevision: string,
  ) => request<NoteBlockCommandResponse>(
    `/papers/${encodeURIComponent(paperId)}/note-blocks`,
    { method: "POST", body: { ...content, expected_revision: expectedRevision } },
  ),
  updateNoteBlock: (
    paperId: string,
    blockId: string,
    changes: Partial<EditableNoteBlockContent>,
    expectedRevision: string,
  ) => request<NoteBlockCommandResponse>(
    `/papers/${encodeURIComponent(paperId)}/note-blocks/${encodeURIComponent(blockId)}`,
    { method: "PATCH", body: { changes, expected_revision: expectedRevision } },
  ),
  saveReaderMetadata: (
    paperId: string,
    changes: Partial<EditablePaperMetadata>,
    expectedRevision: string,
  ) => request<MetadataCommandResponse>(
    `/papers/${encodeURIComponent(paperId)}/metadata`,
    { method: "PATCH", body: { changes, expected_revision: expectedRevision } },
  ),
  saveReadingStatus: (
    paperId: string,
    readingStatus: "unread" | "reading" | "read" | "finished",
    expectedRevision: string,
  ) => request<ReadingStatusCommandResponse>(
    `/papers/${encodeURIComponent(paperId)}/reading-status`,
    { method: "PATCH", body: { reading_status: readingStatus, expected_revision: expectedRevision } },
  ),
  previewMetadataEnrichment: (paperId: string) => request<MetadataEnrichmentPreview>(
    `/papers/${encodeURIComponent(paperId)}/metadata/enrichment-preview`,
    { method: "POST", body: {} },
  ),
  addPaperTag: (
    paperId: string,
    tag: string,
    expectedRevision: string,
  ) => request<PaperTagCommandResponse>(
    `/papers/${encodeURIComponent(paperId)}/tags`,
    { method: "POST", body: { tag, expected_revision: expectedRevision } },
  ),
  removePaperTag: (
    paperId: string,
    tag: string,
    expectedRevision: string,
  ) => request<PaperTagCommandResponse>(
    `/papers/${encodeURIComponent(paperId)}/tags`,
    { method: "DELETE", body: { tag, expected_revision: expectedRevision } },
  ),
  getTagCandidates: (paperId: string, options: { signal?: AbortSignal } = {}) => request<TagCandidateCollection>(
    `/papers/${encodeURIComponent(paperId)}/tag-candidates`,
    { signal: options.signal },
  ),
  generateTagCandidates: (paperId: string, resetRejections = false) => request<TagCandidateCollection>(
    `/papers/${encodeURIComponent(paperId)}/tag-candidates/generate`,
    { method: "POST", body: { reset_rejections: resetRejections } },
  ),
  approveTagCandidate: (paperId: string, candidateId: string, expectedReviewRevision: string) => request<TagCandidateCollection>(
    `/papers/${encodeURIComponent(paperId)}/tag-candidates/${encodeURIComponent(candidateId)}/approve`,
    { method: "POST", body: { expected_review_revision: expectedReviewRevision } },
  ),
  rejectTagCandidate: (paperId: string, candidateId: string, expectedReviewRevision: string) => request<TagCandidateCollection>(
    `/papers/${encodeURIComponent(paperId)}/tag-candidates/${encodeURIComponent(candidateId)}/reject`,
    { method: "POST", body: { expected_review_revision: expectedReviewRevision } },
  ),
  promoteTagCandidate: (paperId: string, candidateId: string, expectedReviewRevision: string, category?: string) => request<TagCandidateCollection>(
    `/papers/${encodeURIComponent(paperId)}/tag-candidates/${encodeURIComponent(candidateId)}/promote`,
    { method: "POST", body: { expected_review_revision: expectedReviewRevision, ...(category ? { category } : {}) } },
  ),
  applyTagCandidate: (paperId: string, candidateId: string, expectedReviewRevision: string, expectedTagsRevision: string) => request<TagCandidateApplyResponse>(
    `/papers/${encodeURIComponent(paperId)}/tag-candidates/${encodeURIComponent(candidateId)}/apply`,
    { method: "POST", body: { expected_review_revision: expectedReviewRevision, expected_tags_revision: expectedTagsRevision } },
  ),
  saveReadingNote: (
    paperId: string,
    content: string,
    expectedSha256: string,
  ) => request<ReadingNoteCommandResponse>(
    `/papers/${encodeURIComponent(paperId)}/reading-note`,
    { method: "PUT", body: { content, expected_sha256: expectedSha256 } },
  ),
  getDashboard: async (): Promise<DashboardSnapshot> => {
    const [health, library, papers, projects] = await Promise.all([
      request<HealthSummary>("/health"),
      request<LibraryStatus>("/library/status"),
      getPapers({ limit: 5, offset: 0, archiveStatus: "active", status: "reading" }),
      collectAllPaginatedItems(getProjects),
    ]);
    return { health, library, papers, projects };
  },
};
