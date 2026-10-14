"use client";

import { useI18n } from "../lib/i18n/LocaleProvider";

import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
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
import {
  applyLatestRevisionDraft,
  beginRevisionSave,
  completeRevisionSave,
  createRevisionDraftState,
  draftStorageKey,
  editRevisionDraft,
  failRevisionSave,
  keepMyRevisionDraft,
  persistRevisionDraft,
  readPersistentRevisionDraft,
  receiveRemoteRevision,
} from "../lib/drafts/revision-draft.mjs";
import type { RevisionDraftState } from "../lib/drafts/revision-draft.mjs";

const CATEGORIES = [
  "field", "organism", "method", "assay", "gene_or_protein", "cell_line_or_sample",
  "tissue_or_cell_type", "concept", "model_or_algorithm", "paper_type", "dataset", "other",
];

const CATEGORY_LABELS: Record<string, string> = {
  field: "Field", organism: "Organism", method: "Method", assay: "Assay", gene_or_protein: "Gene or protein",
  cell_line_or_sample: "Cell line or sample", tissue_or_cell_type: "Tissue or cell type", concept: "Concept",
  model_or_algorithm: "Model or algorithm", paper_type: "Paper type", dataset: "Dataset", other: "Other",
};

function categoryLabel(value: string): string {
  return CATEGORY_LABELS[value] ?? value.replaceAll("_", " ");
}

type CreateTagDraft = { label: string; category: string; description: string };
type TagEditDraft = { label: string; category: string; description: string; strength: number; aliasText: string };
type TagEditor = { target: string; state: RevisionDraftState<TagEditDraft> };

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function TagsView() {
  const { t } = useI18n();
  const { triggerRef: createTriggerRef, restoreTriggerFocus } = useDisclosureFocus<HTMLButtonElement>();
  const resource = useApiResource("tags", async () => {
    const [summary, governance, queue] = await Promise.all([
      apiClient.getTagSummary(),
      apiClient.getTagGovernance(),
      apiClient.getTagReviewQueue(),
    ]);
    return { summary, governance, queue };
  });
  const [selectedKey, setSelectedKey] = useState("");
  const createDraftKey = draftStorageKey("canonical-tag-create", "new");
  const [createDraft, setCreateDraft] = useState(() => createRevisionDraftState<CreateTagDraft>({
    draft: { label: "", category: "other", description: "" },
    revision: "",
    record: readPersistentRevisionDraft(browserStorage(), draftStorageKey("canonical-tag-create", "new")),
  }));
  const [draftStorageReady, setDraftStorageReady] = useState(false);
  const [tagEditor, setTagEditor] = useState<TagEditor | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [registrySearch, setRegistrySearch] = useState("");

  const selected = resource.status === "success"
    ? resource.data.governance.items.find((tag) => tag.canonical_key === selectedKey)
    : undefined;
  const selectedEditor = tagEditor && tagEditor.target === selected?.canonical_key ? tagEditor.state : null;

  useEffect(() => {
    const restored = createRevisionDraftState<CreateTagDraft>({
      draft: { label: "", category: "other", description: "" },
      revision: "",
      record: readPersistentRevisionDraft(browserStorage(), createDraftKey),
    });
    setCreateDraft(restored);
    setShowCreate(JSON.stringify(restored.draft) !== JSON.stringify(restored.baseline));
    setDraftStorageReady(true);
  }, [createDraftKey]);

  useEffect(() => {
    if (!draftStorageReady) return;
    persistRevisionDraft(browserStorage(), createDraftKey, createDraft);
  }, [createDraft, createDraftKey, draftStorageReady]);

  const updateCreateDraft = (update: (state: typeof createDraft) => typeof createDraft) => {
    setCreateDraft((current) => {
      const next = update(current);
      if (draftStorageReady) persistRevisionDraft(browserStorage(), createDraftKey, next);
      return next;
    });
  };

  useEffect(() => {
    if (!selected) return;
    setTagEditor((current) => {
      if (current?.target === selected.canonical_key) return current;
      const key = draftStorageKey("canonical-tag-edit", selected.canonical_key);
      return {
        target: selected.canonical_key,
        state: createRevisionDraftState<TagEditDraft>({
          draft: {
            label: selected.label,
            category: selected.category,
            description: selected.description,
            strength: selected.suggestion_strength,
            aliasText: "",
          },
          revision: resource.status === "success" ? resource.data.governance.registry_revision : "",
          record: readPersistentRevisionDraft(browserStorage(), key),
        }),
      };
    });
  }, [resource, selected]);

  useEffect(() => {
    if (!tagEditor) return;
    if (!draftStorageReady) return;
    persistRevisionDraft(
      browserStorage(),
      draftStorageKey("canonical-tag-edit", tagEditor.target),
      tagEditor.state,
    );
  }, [draftStorageReady, tagEditor]);

  const updateTagEditor = (update: (state: RevisionDraftState<TagEditDraft>) => RevisionDraftState<TagEditDraft>) => {
    setTagEditor((current) => {
      if (!current) return current;
      const state = update(current.state);
      if (draftStorageReady) persistRevisionDraft(browserStorage(), draftStorageKey("canonical-tag-edit", current.target), state);
      return { ...current, state };
    });
  };

  const run = async (action: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await action();
      setNotice(success);
      resource.retry();
    } catch (error) {
      setNotice(error instanceof ApiClientError ? error.message : "The tag update could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const createCanonicalTag = async () => {
    if (resource.status !== "success" || busy) return;
    const started = beginRevisionSave({
      ...createDraft,
      revision: resource.data.governance.registry_revision,
      remoteRevision: resource.data.governance.registry_revision,
    });
    if (!started.request) return;
    const request = started.request;
    updateCreateDraft(() => started.state);
    setBusy(true);
    try {
      const response = await apiClient.createCanonicalTag({
        label: request.draft.label,
        category: request.draft.category,
        description: request.draft.description,
        suggestionStrength: 1,
        expectedRevision: request.revision,
      });
      updateCreateDraft((current) => {
        const saved = completeRevisionSave(current, request.token, {
          value: request.draft,
          revision: response.registry_revision,
        });
        if (saved.saveState !== "saved") return saved;
        return createRevisionDraftState({
          draft: { label: "", category: "other", description: "" },
          revision: response.registry_revision,
        });
      });
      setNotice("Canonical tag created. No Paper tags were changed.");
      resource.retry();
    } catch (error) {
      let latestRevision = "";
      if (error instanceof ApiClientError && error.kind === "conflict") {
        try {
          latestRevision = (await apiClient.getTagGovernance()).registry_revision;
        } catch { /* preserve the draft until the Tag Book is reachable */ }
      }
      updateCreateDraft((current) => {
        const failed = failRevisionSave(current, request.token, error instanceof ApiClientError ? error.kind : "error");
        return {
          ...failed,
          revision: latestRevision || failed.revision,
          remoteRevision: latestRevision || failed.remoteRevision,
          lastError: failed.saveState === "changed_elsewhere"
            ? "The Tag Book changed elsewhere. Your new-tag draft is preserved; refresh it before retrying."
            : error instanceof ApiClientError ? error.message : "The tag update could not be completed.",
        };
      });
    } finally {
      setBusy(false);
    }
  };

  const saveCanonicalTagMetadata = async () => {
    if (!selected || !tagEditor || tagEditor.target !== selected.canonical_key || resource.status !== "success" || busy) return;
    const started = beginRevisionSave({
      ...tagEditor.state,
      revision: resource.data.governance.registry_revision,
      remoteRevision: resource.data.governance.registry_revision,
    });
    if (!started.request) return;
    const request = started.request;
    updateTagEditor(() => started.state);
    setBusy(true);
    try {
      const response = await apiClient.updateCanonicalTag(selected.canonical_key, {
        label: request.draft.label,
        category: request.draft.category,
        description: request.draft.description,
        suggestionStrength: request.draft.strength,
      }, request.revision);
      updateTagEditor((current) => completeRevisionSave(current, request.token, {
        value: {
          label: response.tag.label,
          category: response.tag.category,
          description: response.tag.description,
          strength: response.tag.suggestion_strength,
          aliasText: request.draft.aliasText,
        },
        revision: response.registry_revision,
      }));
      setNotice("Canonical tag metadata saved.");
      resource.retry();
    } catch (error) {
      let remote: { value: TagEditDraft; revision: string } | null = null;
      if (error instanceof ApiClientError && error.kind === "conflict") {
        try {
          const latest = await apiClient.getTagGovernance();
          const tag = latest.items.find((item) => item.canonical_key === selected.canonical_key);
          if (tag) remote = {
            value: { label: tag.label, category: tag.category, description: tag.description, strength: tag.suggestion_strength, aliasText: tagEditor.state.draft.aliasText },
            revision: latest.registry_revision,
          };
        } catch { /* retain local metadata until the registry is reachable */ }
      }
      updateTagEditor((current) => {
        let failed = failRevisionSave(current, request.token, error instanceof ApiClientError ? error.kind : "error");
        if (remote) failed = receiveRemoteRevision(failed, { ...remote, changedElsewhere: true });
        return { ...failed, lastError: failed.saveState === "changed_elsewhere" ? "This canonical tag changed elsewhere. Your draft and latest saved value are both preserved." : error instanceof ApiClientError ? error.message : "Save failed. Your draft is preserved locally." };
      });
    } finally {
      setBusy(false);
    }
  };

  const addCanonicalAlias = async () => {
    if (!selected || !tagEditor || tagEditor.target !== selected.canonical_key || resource.status !== "success" || busy || !tagEditor.state.draft.aliasText.trim()) return;
    const started = beginRevisionSave({
      ...tagEditor.state,
      revision: resource.data.governance.registry_revision,
      remoteRevision: resource.data.governance.registry_revision,
    });
    if (!started.request) return;
    const request = started.request;
    updateTagEditor(() => started.state);
    setBusy(true);
    try {
      const response = await apiClient.addCanonicalTagAlias(selected.canonical_key, request.draft.aliasText, request.revision);
      updateTagEditor((current) => completeRevisionSave(current, request.token, {
        value: {
          label: response.tag.label,
          category: response.tag.category,
          description: response.tag.description,
          strength: response.tag.suggestion_strength,
          aliasText: "",
        },
        revision: response.registry_revision,
      }));
      setNotice("Alias saved. Existing Paper tags were not rewritten.");
      resource.retry();
    } catch (error) {
      let remote: { value: TagEditDraft; revision: string } | null = null;
      if (error instanceof ApiClientError && error.kind === "conflict") {
        try {
          const latest = await apiClient.getTagGovernance();
          const tag = latest.items.find((item) => item.canonical_key === selected.canonical_key);
          if (tag) remote = {
            value: { label: tag.label, category: tag.category, description: tag.description, strength: tag.suggestion_strength, aliasText: "" },
            revision: latest.registry_revision,
          };
        } catch { /* retain the alias draft until the registry is reachable */ }
      }
      updateTagEditor((current) => {
        let failed = failRevisionSave(current, request.token, error instanceof ApiClientError ? error.kind : "error");
        if (remote) failed = receiveRemoteRevision(failed, { ...remote, changedElsewhere: true });
        return {
          ...failed,
          lastError: failed.saveState === "changed_elsewhere"
            ? "This canonical tag changed elsewhere. Your alias draft and latest saved value are both preserved."
            : error instanceof ApiClientError ? error.message : "Save failed. Your alias draft is preserved locally.",
        };
      });
    } finally {
      setBusy(false);
    }
  };

  const refreshCreateDraftAfterConflict = async () => {
    try {
      const latest = await apiClient.getTagGovernance();
      updateCreateDraft((current) => ({
        ...current,
        revision: latest.registry_revision,
        remoteRevision: latest.registry_revision,
        saveState: "unsaved",
        lastError: "",
      }));
      resource.retry();
    } catch (error) {
      updateCreateDraft((current) => ({
        ...current,
        lastError: error instanceof ApiClientError ? error.message : "The Tag Book is unavailable. Your draft remains preserved locally.",
      }));
    }
  };

  function closeCreate() {
    setShowCreate(false);
    restoreTriggerFocus();
  }

  return (
    <div className="page-stack">
      <PageHeader title={t("Tags")} description={t("Review suggestions, browse the tag book, and manage one tag at a time.")} actions={<button ref={createTriggerRef} className="reader-control" type="button" onClick={() => setShowCreate((current) => !current)} aria-expanded={showCreate} aria-controls="create-canonical-tag"><Plus size={15} />{t("Create tag")}</button>} />
      {resource.status === "loading" ? <LoadingState label={t("Loading tags")} /> : null}
      {resource.status === "unavailable" ? <UnavailableState description={t(resource.message)} onRetry={resource.retry} /> : null}
      {resource.status === "error" ? <ErrorState title={t("Tag Book unavailable")} description={t(resource.message)} onRetry={resource.retry} /> : null}
      {resource.status === "not-found" ? <ErrorState description={t(resource.message)} onRetry={resource.retry} /> : null}
      {resource.status === "success" ? (
        <>
          <Section title={t("Review candidates")} description={t("Review each Paper’s saved suggestions before you apply a tag.")}>
            {resource.data.summary.availability === "unavailable" ? <p className="muted-text">{t("Candidate summary unavailable.")}</p> : <p className="toolbar-note">{resource.data.summary.candidate_count === 0 ? t("No candidate evidence yet.") : t(`${resource.data.summary.candidate_count} saved candidate${resource.data.summary.candidate_count === 1 ? "" : "s"} across ${resource.data.summary.evaluated_paper_count} Paper${resource.data.summary.evaluated_paper_count === 1 ? "" : "s"}. ${resource.data.summary.quality_counts.high} high-confidence.`)}</p>}
            {resource.data.queue.items.length === 0 ? <EmptyState title={t("No candidates to review")} description={t("Generate suggestions from a Paper when you are ready; nothing is generated from this page.")} /> : (
              <DataTableShell label={t("Papers with tag candidates")}>
                <table>
                  <thead><tr><th>{t("Paper")}</th><th>{t("To review")}</th><th>{t("Progress")}</th><th>{t("Suggestions")}</th><th /></tr></thead>
                  <tbody>{resource.data.queue.items.map((item) => (
                    <tr key={item.paper_id}>
                      <td><strong>{item.title}</strong></td>
                      <td>{item.candidate_count}</td>
                      <td>{t("{unresolved} unresolved · {resolved} ready · {approved} approved", { unresolved: item.unresolved_count, resolved: item.resolved_count, approved: item.approved_count })}</td>
                      <td>{item.candidate_labels.length ? <div className="tag-list">{item.candidate_labels.map((label) => <StatusBadge presentation="chip" taxonomy="candidate" key={label}>{label}</StatusBadge>)}</div> : <span className="muted-text">{t("No labels available")}</span>}</td>
                      <td><Link className="reader-control" href={`/papers/${encodeURIComponent(item.paper_id)}/reader?utility=tags&review=tag-candidates`}>{t("Review")}</Link></td>
                    </tr>
                  ))}</tbody>
                </table>
              </DataTableShell>
            )}
          </Section>

          <Section title={t("Tag registry")} description={t(`${resource.data.governance.items.length} tag${resource.data.governance.items.length === 1 ? "" : "s"}.`)}>
            <Toolbar label={t("Tag registry search")}><label className="search-shell tag-registry-search"><span className="sr-only">{t("Search tags")}</span><input type="search" value={registrySearch} placeholder={t("Search label, category, or alias…")} onChange={(event) => setRegistrySearch(event.target.value)} /></label></Toolbar>
            {resource.data.governance.items.length === 0 ? (
              <EmptyState title={t("Tag Book is empty")} description={t("Create an explicit canonical tag to begin managing the registry.")} />
            ) : (
              <DataTableShell label={t("Tag registry")}>
                <table>
                  <thead><tr><th>{t("Tag")}</th><th>{t("Category")}</th><th>{t("Aliases")}</th><th /></tr></thead>
                  <tbody>{resource.data.governance.items.filter((tag) => [tag.label, tag.category, ...tag.aliases].join(" ").toLocaleLowerCase().includes(registrySearch.trim().toLocaleLowerCase())).map((tag) => (
                    <tr key={tag.canonical_key}>
                      <td><strong>{tag.label}</strong><details className="tag-advanced-details"><summary>{t("Advanced details")}</summary><span className="mono-id">{tag.canonical_key}</span></details></td><td>{t(categoryLabel(tag.category))}</td>
                      <td><div className="tag-list">{tag.aliases.length ? tag.aliases.map((value) => <StatusBadge presentation="chip" taxonomy="alias" key={value}>{value}</StatusBadge>) : <span className="muted-text">{t("None stored")}</span>}</div></td>
                      <td><button className="reader-control reader-control--secondary" type="button" disabled={busy || Boolean(tagEditor?.state.activeSave)} onClick={() => setSelectedKey(tag.canonical_key)}>{t("Manage tag")}</button></td>
                    </tr>
                  ))}{resource.data.governance.items.filter((tag) => [tag.label, tag.category, ...tag.aliases].join(" ").toLocaleLowerCase().includes(registrySearch.trim().toLocaleLowerCase())).length === 0 ? <tr><td colSpan={5} className="muted-text">{t("No tags match this search.")}</td></tr> : null}</tbody>
                </table>
              </DataTableShell>
            )}
          </Section>

          {showCreate ? <Section title={t("Create tag")} description={t("Create a registry entry when you need one.")}>
            <form id="create-canonical-tag" className="project-command-panel project-command-panel--disclosure" onSubmit={(event) => { event.preventDefault(); void createCanonicalTag(); }}>
              <div className="project-form-grid">
                <label className="reader-field"><span>{t("Label")}</span><input value={createDraft.draft.label} onChange={(event) => updateCreateDraft((current) => editRevisionDraft(current, { ...current.draft, label: event.target.value }))} required maxLength={200} /></label>
                <label className="reader-field"><span>{t("Category")}</span><select value={createDraft.draft.category} onChange={(event) => updateCreateDraft((current) => editRevisionDraft(current, { ...current.draft, category: event.target.value }))}>{CATEGORIES.map((category) => <option key={category} value={category}>{t(categoryLabel(category))}</option>)}</select></label>
                <label className="reader-field project-form-wide"><span>{t("Description (optional)")}</span><textarea value={createDraft.draft.description} onChange={(event) => updateCreateDraft((current) => editRevisionDraft(current, { ...current.draft, description: event.target.value }))} maxLength={2000} rows={2} /></label>
              </div>
              <div className="reader-editor__actions"><SaveStatus state={createDraft.saveState} /><button className="reader-action" type="submit" disabled={busy || Boolean(createDraft.activeSave) || !createDraft.draft.label.trim()}>{t("Create tag")}</button><button className="reader-control reader-control--secondary" type="button" disabled={Boolean(createDraft.activeSave)} onClick={closeCreate}>{t("Close")}</button></div>
              {createDraft.lastError ? <p className="reader-editor__status" role="status">{t(createDraft.lastError)}{t("Your draft remains preserved locally.")}</p> : null}
              {createDraft.saveState === "changed_elsewhere" ? <div className="reader-editor__actions"><button className="reader-control reader-control--secondary" type="button" onClick={() => void refreshCreateDraftAfterConflict()}>{t("Refresh Tag Book and keep my draft")}</button></div> : null}
            </form>
          </Section> : null}

          {selected ? <Section title={t(`Manage ${selected.label}`)} description={t("Update the selected tag, its aliases, or its availability.")}>
            {!selectedEditor ? <p className="muted-text">{t("Loading the locally preserved tag draft…")}</p> : <>
              <form className="project-command-panel" onSubmit={(event) => {
                event.preventDefault();
                void saveCanonicalTagMetadata();
              }}>
                <div className="project-form-grid">
                  <label className="reader-field"><span>{t("Label")}</span><input value={selectedEditor.draft.label} onChange={(event) => updateTagEditor((current) => editRevisionDraft(current, { ...current.draft, label: event.target.value }))} required maxLength={200} /></label>
                  <label className="reader-field"><span>{t("Category")}</span><select value={selectedEditor.draft.category} onChange={(event) => updateTagEditor((current) => editRevisionDraft(current, { ...current.draft, category: event.target.value }))}>{CATEGORIES.map((category) => <option key={category} value={category}>{t(categoryLabel(category))}</option>)}</select></label>
                  <label className="reader-field"><span>{t("Suggestion strength")}</span><input value={selectedEditor.draft.strength} onChange={(event) => updateTagEditor((current) => editRevisionDraft(current, { ...current.draft, strength: Number(event.target.value) }))} type="number" min="0" max="100" required /></label>
                  <label className="reader-field project-form-wide"><span>{t("Description")}</span><textarea value={selectedEditor.draft.description} onChange={(event) => updateTagEditor((current) => editRevisionDraft(current, { ...current.draft, description: event.target.value }))} rows={2} maxLength={2000} /></label>
                </div>
                <div className="reader-editor__actions"><SaveStatus state={selectedEditor.saveState} /><button className="reader-action" type="submit" disabled={busy || Boolean(selectedEditor.activeSave) || selectedEditor.saveState === "changed_elsewhere" || !selectedEditor.draft.label.trim()}>{t("Save metadata")}</button></div>
                {selectedEditor.lastError ? <p className="reader-editor__status" role="status">{t(selectedEditor.lastError)}</p> : null}
                {selectedEditor.saveState === "changed_elsewhere" ? <div className="reader-editor__actions">
                  <button className="reader-control reader-control--secondary" type="button" onClick={() => updateTagEditor(keepMyRevisionDraft)}>{t("Keep my draft")}</button>
                  <button className="reader-control reader-control--secondary" type="button" onClick={() => updateTagEditor(applyLatestRevisionDraft)}>{t("Use latest saved version")}</button>
                </div> : null}
                {selectedEditor.saveState === "changed_elsewhere" ? <details className="reader-conflict-review"><summary>{t("Review local and latest server values")}</summary><p><strong>{t("My draft:")}</strong> {selectedEditor.draft.label} · {selectedEditor.draft.category}</p><p><strong>{t("Latest server value:")}</strong> {selectedEditor.remote.label} · {selectedEditor.remote.category}</p></details> : null}
              </form>
              <div className="project-command-panel">
                <div className="reader-note__heading"><h3>{t("Aliases")}</h3><StatusBadge>{selected.aliases.length}</StatusBadge></div>
                <div className="tag-list alias-chip-list">{selected.aliases.length ? selected.aliases.map((value) => <span key={value} className="alias-chip"><span>{value}</span><button className="icon-button alias-chip__remove" type="button" disabled={busy} aria-label={t(`Remove alias ${value}`)} onClick={() => { if (window.confirm(t(`Remove alias “${value}” from ${selected.label}? Historical Paper tags will remain.`))) void run(() => apiClient.removeCanonicalTagAlias(selected.canonical_key, value, resource.data.governance.registry_revision), `Alias “${value}” removed from the registry only.`); }}><X size={13} aria-hidden="true" /></button></span>) : <span className="muted-text">{t("No aliases yet.")}</span>}</div>
                <div className="project-link-form"><label className="reader-field"><span>{t("New alias")}</span><input value={selectedEditor.draft.aliasText} onChange={(event) => updateTagEditor((current) => editRevisionDraft(current, { ...current.draft, aliasText: event.target.value }))} maxLength={200} /></label><button className="reader-control" type="button" disabled={busy || Boolean(selectedEditor.activeSave) || selectedEditor.saveState === "changed_elsewhere" || !selectedEditor.draft.aliasText.trim()} onClick={() => void addCanonicalAlias()}>{t("Add alias")}</button></div>
                <details className="tag-advanced-details"><summary>{t("Advanced registry details")}</summary><span className="mono-id">{t("Canonical key:")} {selected.canonical_key}</span></details>
                <details className="tag-advanced-details"><summary>{t("Advanced lifecycle")}</summary>{selected.status === "active" ? <button className="reader-control reader-control--danger" type="button" disabled={busy} onClick={() => { if (window.confirm(t(`Deprecate ${selected.label}? Historical Paper references will remain.`))) void run(() => apiClient.deprecateCanonicalTag(selected.canonical_key, resource.data.governance.registry_revision), "Tag deprecated. Historical references remain visible."); }}>{t("Deprecate tag")}</button> : <p className="muted-text">{t("Lifecycle: deprecated. This canonical tag remains available for historical inspection.")}</p>}</details>
              </div>
            </>}
          </Section> : null}
          {notice ? <p className="reader-editor__status">{t(notice)}</p> : null}
        </>
      ) : null}
    </div>
  );
}
