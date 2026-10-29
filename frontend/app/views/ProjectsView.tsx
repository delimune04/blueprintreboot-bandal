"use client";

import { useI18n } from "../lib/i18n/LocaleProvider";

import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { DataTableShell } from "../components/DataTableShell";
import { EmptyState, ErrorState, LoadingState, UnavailableState } from "../components/AsyncStates";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { StatusBadge } from "../components/StatusBadge";
import { SaveStatus } from "../components/SaveStatus";
import { Toolbar } from "../components/Toolbar";
import { useApiResource } from "../hooks/useApiResource";
import { useDisclosureFocus } from "../hooks/useDisclosureFocus";
import { ApiClientError, apiClient } from "../lib/api/client";
import { formatUiDate } from "../lib/presentation";
import type { EditableProjectMetadata, EditableProjectStatus, ProjectPriority } from "../lib/api/types";
import {
  beginRevisionSave,
  completeRevisionSave,
  createRevisionDraftState,
  draftStorageKey,
  editRevisionDraft,
  failRevisionSave,
  persistRevisionDraft,
  readPersistentRevisionDraft,
} from "../lib/drafts/revision-draft.mjs";

import { filterProjectCollection } from "../lib/projects/collection.mjs";

const EMPTY_PROJECT: EditableProjectMetadata = {
  name: "",
  description: "",
  status: "active",
  priority: "normal",
  tags: [],
};

type ProjectCreateDraft = { project: EditableProjectMetadata; tagText: string };

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function parsedTags(value: string): string[] {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

export function ProjectsView() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { triggerRef: createTriggerRef, restoreTriggerFocus } = useDisclosureFocus<HTMLButtonElement>();
  const [offset, setOffset] = useState(0);
  const pageSize = 20;
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [sort, setSort] = useState<"updated" | "name" | "priority">("updated");
  const resource = useApiResource("projects", apiClient.getAllProjects);
  const createDraftKey = draftStorageKey("project-create", "new");
  const [createState, setCreateState] = useState(() => createRevisionDraftState<ProjectCreateDraft>({
    draft: { project: EMPTY_PROJECT, tagText: "" },
    revision: "",
    record: readPersistentRevisionDraft(browserStorage(), draftStorageKey("project-create", "new")),
  }));
  const [showCreate, setShowCreate] = useState(() => !Object.is(createState.draft, createState.baseline) && JSON.stringify(createState.draft) !== JSON.stringify(createState.baseline));
  const [draftStorageReady, setDraftStorageReady] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const dirtyCreate = showCreate && JSON.stringify(createState.draft) !== JSON.stringify(createState.baseline);
  const visibleProjects = useMemo(() => {
    if (resource.status !== "success") return [];
    const priorityRank: Record<string, number> = { high: 0, normal: 1, low: 2 };
    return filterProjectCollection(resource.data, search, statusFilter, priorityFilter)
      .sort((left, right) => {
        if (sort === "updated") return right.updated_at.localeCompare(left.updated_at) || left.name.localeCompare(right.name);
        if (sort === "priority") return (priorityRank[left.priority] ?? 9) - (priorityRank[right.priority] ?? 9) || left.name.localeCompare(right.name);
        return left.name.localeCompare(right.name);
      });
  }, [priorityFilter, resource, search, sort, statusFilter]);
  const pagedProjects = visibleProjects.slice(offset, offset + pageSize);

  useEffect(() => {
    const restored = createRevisionDraftState<ProjectCreateDraft>({
      draft: { project: EMPTY_PROJECT, tagText: "" },
      revision: "",
      record: readPersistentRevisionDraft(browserStorage(), createDraftKey),
    });
    setCreateState(restored);
    setShowCreate(JSON.stringify(restored.draft) !== JSON.stringify(restored.baseline));
    setDraftRestored(JSON.stringify(restored.draft) !== JSON.stringify(restored.baseline));
    setDraftStorageReady(true);
  }, [createDraftKey]);

  useEffect(() => {
    if (!draftStorageReady) return;
    persistRevisionDraft(browserStorage(), createDraftKey, createState);
  }, [createDraftKey, createState, draftStorageReady]);

  function updateCreate(update: (state: typeof createState) => typeof createState) {
    setCreateState((current) => {
      const next = update(current);
      if (draftStorageReady) persistRevisionDraft(browserStorage(), createDraftKey, next);
      return next;
    });
  }

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirtyCreate) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [dirtyCreate]);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const started = beginRevisionSave(createState);
    if (!started.request) return;
    const request = started.request;
    updateCreate(() => ({ ...started.state, saveState: "saving", lastError: "" }));
    try {
      const response = await apiClient.createProject({ ...request.draft.project, tags: parsedTags(request.draft.tagText) });
      updateCreate((current) => {
        const saved = completeRevisionSave(current, request.token, {
          value: {
            project: {
              name: response.project.name,
              description: response.project.description,
              status: response.project.status === "archived" ? "active" : response.project.status,
              priority: response.project.priority,
              tags: [...response.project.tags],
            },
            tagText: response.project.tags.join(", "),
          },
          revision: response.project.project_revision,
        });
        if (saved.saveState !== "saved") {
          const transferred = createRevisionDraftState({
            draft: saved.draft.project,
            baseline: saved.baseline.project,
            revision: saved.revision,
          });
          persistRevisionDraft(
            browserStorage(),
            draftStorageKey("project-metadata", response.project.project_id),
            {
              ...transferred,
              draft: saved.draft.project,
              baseline: saved.baseline.project,
              remote: saved.remote.project,
              remoteRevision: saved.remoteRevision,
              generation: saved.generation,
              saveState: "unsaved",
            },
          );
          return saved;
        }
        router.push(`/projects/${encodeURIComponent(response.project.project_id)}`);
        return saved;
      });
    } catch (error) {
      updateCreate((current) => ({
        ...failRevisionSave(current, request.token, error instanceof ApiClientError ? error.kind : "error"),
        lastError: error instanceof ApiClientError ? error.message : "The Project could not be created.",
      }));
    }
  }

  function closeCreate() {
    setShowCreate(false);
    restoreTriggerFocus();
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={t("Projects")}
        description={t("Organize related papers and note blocks.")}
        actions={(
          <button ref={createTriggerRef} className="reader-control" type="button" onClick={() => setShowCreate((current) => !current)} aria-expanded={showCreate} aria-controls="create-project-panel">
            <Plus size={15} />{t("Create Project")} </button>
        )}
      />
      {resource.status === "loading" ? <LoadingState label={t("Loading Projects")} /> : null}
      {resource.status === "unavailable" ? <UnavailableState description={t(resource.message)} onRetry={resource.retry} /> : null}
      {resource.status === "error" ? <ErrorState title={t("Projects couldn't be loaded")} description={t(resource.message)} onRetry={resource.retry} /> : null}
      {resource.status === "not-found" ? <ErrorState description={t(resource.message)} onRetry={resource.retry} /> : null}
      {resource.status === "success" ? (
        <Section title={t("All projects")} description={t(`${visibleProjects.length} Project${visibleProjects.length === 1 ? "" : "s"}.`)}>
          <Toolbar label={t("Project collection filters")}>
            <label className="library-filter-field library-toolbar__search"><span>{t("Search")}</span><span className="search-shell"><input ref={searchRef} type="search" aria-describedby="project-search-help" value={search} placeholder={t("Name, description, or tag…")} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} /></span></label>
            <label className="library-filter-field"><span>{t("Status")}</span><select className="library-filter" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setOffset(0); }}><option value="">{t("All statuses")}</option><option value="active">{t("Active")}</option><option value="paused">{t("Paused")}</option><option value="done">{t("Done")}</option><option value="archived">{t("Archived")}</option></select></label>
            <label className="library-filter-field"><span>{t("Priority")}</span><select className="library-filter" value={priorityFilter} onChange={(event) => { setPriorityFilter(event.target.value); setOffset(0); }}><option value="">{t("All priorities")}</option><option value="high">{t("High")}</option><option value="normal">{t("Normal")}</option><option value="low">{t("Low")}</option></select></label>
            <label className="library-filter-field"><span>{t("Sort")}</span><select className="library-filter" value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setOffset(0); }}><option value="updated">{t("Recently updated")}</option><option value="name">{t("Name")}</option><option value="priority">{t("Priority")}</option></select></label>
            <button type="button" className="reader-control reader-control--secondary" disabled={!search && !statusFilter && !priorityFilter} onClick={() => { setSearch(""); setStatusFilter(""); setPriorityFilter(""); setOffset(0); searchRef.current?.focus(); }}>{t("Reset filters")}</button>
          </Toolbar>
          <p id="project-search-help" className="muted-text">{t("Matches every search word across project names, descriptions and tags.")}</p>
          {visibleProjects.length === 0 ? (
            <EmptyState title={resource.data.length ? t("No matching projects") : t("No projects yet")} description={resource.data.length ? t("Change the filters to see more projects.") : t("Create a project when you are ready to connect related work.")} />
          ) : (
            <>
              <DataTableShell label={t("Projects")}>
                <table>
                <thead><tr><th>{t("Project")}</th><th>{t("Status")}</th><th>{t("Priority")}</th><th>{t("Tags")}</th><th>{t("Paper links")}</th><th>{t("Note Block links")}</th><th>{t("Updated")}</th></tr></thead>
                <tbody>
                  {pagedProjects.map((project) => (
                    <tr key={project.project_id}>
                      <td>
                        <Link className="paper-link" href={`/projects/${encodeURIComponent(project.project_id)}`}>{project.name}</Link>
                      </td>
                      <td><StatusBadge>{project.status}</StatusBadge></td>
                      <td><StatusBadge>{project.priority}</StatusBadge></td>
                      <td>
                        <div className="tag-list">
                          {project.tags.length
                            ? project.tags.map((tag) => <StatusBadge presentation="chip" taxonomy="canonical" key={tag}>{tag}</StatusBadge>)
                            : <span className="muted-text">{t("None stored")}</span>}
                        </div>
                      </td>
                      <td>{project.linked_paper_count}</td>
                      <td>{project.linked_note_block_count}</td>
                      <td>{formatUiDate(project.updated_at, locale)}</td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </DataTableShell>
              <div className="reader-editor__actions" aria-label={t("Project pages")}>
                <button className="reader-control reader-control--secondary" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>{t("Previous")}</button>
                <span className="muted-text">{t("Showing {start}–{end} of {total}", { start: offset + 1, end: offset + pagedProjects.length, total: visibleProjects.length })}</span>
                <button className="reader-control reader-control--secondary" type="button" disabled={offset + pagedProjects.length >= visibleProjects.length} onClick={() => setOffset(offset + pagedProjects.length)}>{t("Next")}</button>
              </div>
            </>
          )}
        </Section>
      ) : null}
      {showCreate ? (
        <Section title={t("Create Project")} description={t("Your draft stays on this device until you create the project.")}>
          <form id="create-project-panel" className="project-command-panel project-command-panel--disclosure" onSubmit={createProject}>
            <div className="project-form-grid">
              <label className="reader-field">
                <span>{t("Name")}</span>
                <input required maxLength={200} value={createState.draft.project.name} onChange={(event) => updateCreate((current) => editRevisionDraft(current, { ...current.draft, project: { ...current.draft.project, name: event.target.value } }))} />
              </label>
              <label className="reader-field">
                <span>{t("Description")}</span>
                <textarea rows={4} maxLength={5000} value={createState.draft.project.description} onChange={(event) => updateCreate((current) => editRevisionDraft(current, { ...current.draft, project: { ...current.draft.project, description: event.target.value } }))} />
              </label>
              <label className="reader-field">
                <span>{t("Status")}</span>
                <select value={createState.draft.project.status} onChange={(event) => updateCreate((current) => editRevisionDraft(current, { ...current.draft, project: { ...current.draft.project, status: event.target.value as EditableProjectStatus } }))}>
                  <option value="active">{t("Active")}</option><option value="paused">{t("Paused")}</option><option value="done">{t("Done")}</option>
                </select>
              </label>
              <label className="reader-field">
                <span>{t("Priority")}</span>
                <select value={createState.draft.project.priority} onChange={(event) => updateCreate((current) => editRevisionDraft(current, { ...current.draft, project: { ...current.draft.project, priority: event.target.value as ProjectPriority } }))}>
                  <option value="low">{t("Low")}</option><option value="normal">{t("Normal")}</option><option value="high">{t("High")}</option>
                </select>
              </label>
              <label className="reader-field project-form-wide">
                <span>{t("Tags (comma separated)")}</span>
                <input maxLength={2524} value={createState.draft.tagText} onChange={(event) => updateCreate((current) => editRevisionDraft(current, { ...current.draft, tagText: event.target.value }))} />
              </label>
            </div>
            <p className="reader-editor__status" role="status">{createState.lastError || (draftRestored ? "Draft restored" : createState.saveState === "offline" ? "The local API is unavailable. Your Project draft is preserved locally." : "")}</p>
            <div className="reader-editor__actions">
              <SaveStatus state={createState.saveState} />
              <button className="reader-control" type="submit" disabled={Boolean(createState.activeSave) || !dirtyCreate}>{createState.saveState === "saving" ? t("Creating Project…") : t("Create Project")}</button>
              <button className="reader-control reader-control--secondary" type="button" onClick={closeCreate} disabled={Boolean(createState.activeSave)}><X size={15} />{t("Close")}</button>
            </div>
          </form>
        </Section>
      ) : null}
    </div>
  );
}
