"use client";

import { ArrowLeft, ArrowRight, Bookmark, Check, ChevronDown, Download, ExternalLink, List, LoaderCircle, Map as MapIcon, Network, RefreshCw, Save, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { PageHeader } from "../components/PageHeader";
import { SaveStatus } from "../components/SaveStatus";
import { ResearchMap } from "../components/ResearchMap";
import { apiClient, ApiClientError, getWorkspaceRole, labviumRequest } from "../lib/api/client";
import { useI18n } from "../lib/i18n/LocaleProvider";
import { applyLatestRevisionDraft, beginRevisionSave, completeRevisionSave, createRevisionDraftState, draftStorageKey, editRevisionDraft, failRevisionSave, keepMyRevisionDraft, persistRevisionDraft, readPersistentRevisionDraft, receiveRemoteRevision, revisionDraftEqual, type RevisionDraftState } from "../lib/drafts/revision-draft.mjs";
import { emptyExploration, mergeExploration, validateExploration, EXPLORATION_LIMITS, type Exploration, type ExplorationEdge, type ExplorationWork, type ExploreResponse } from "../lib/exploration/model.mjs";
import "../lib/exploration/exploration.css";

type Mode = "balanced" | "foundations" | "recent" | "bridges";
type Snapshot = { project_id: string; exploration: Exploration; revision: string };
type QueueState = "to_read" | "reading" | "read";
type ResultFilter = "all" | "saved" | "queue";

function safeUrl(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : ""; } catch { return ""; }
}
function seedFor(work: ExplorationWork) {
  const openalex = /(?:^|\/)(W\d+)$/i.exec(String(work.openalex_id || work.id));
  return openalex?.[1] || work.doi || "";
}
function stableWorkId(works: ExplorationWork[], work: ExplorationWork | null | undefined) {
  if (!work) return null;
  if (works.some((row) => row.id === work.id)) return work.id;
  const doi = (value: string) => value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim().toLowerCase();
  return work.doi ? works.find((row) => doi(row.doi) === doi(work.doi))?.id || null : null;
}
function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function storage() { try { return window.localStorage; } catch { return null; } }
function errorMessage(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
function edgeKey(edge: ExplorationEdge) { return `${edge.source}\u0000${edge.target}\u0000${edge.kind}`; }

function ExplorationWorkspace({ projectId, snapshot, projectName }: { projectId: string; snapshot: Snapshot; projectName: string }) {
  const { locale } = useI18n();
  const tr = useCallback((ko: string, en: string) => locale === "ko" ? ko : en, [locale]);
  const key = draftStorageKey("project-exploration", projectId);
  const protectedDraft = useRef(false);
  const [editor, setEditor] = useState<RevisionDraftState<Exploration>>(() => {
    let record = readPersistentRevisionDraft(storage(), key);
    try { if (storage()?.getItem(key) && !record) protectedDraft.current = true; } catch { /* Device draft storage may be unavailable while server saves still work. */ }
    if (record) {
      try { validateExploration(record.draft); validateExploration(record.baseline); if (record.remote) validateExploration(record.remote); }
      catch { protectedDraft.current = true; record = null; }
    }
    return createRevisionDraftState({ draft: snapshot.exploration, revision: snapshot.revision, record });
  });
  const editorRef = useRef(editor);
  const [draftStorageError, setDraftStorageError] = useState(false);
  const [query, setQuery] = useState((editor.draft.topic || "").slice(0, 300));
  const [seedInput, setSeedInput] = useState("");
  const [mode, setMode] = useState<Mode>("balanced");
  const [selectedId, setSelectedId] = useState<string | null>(editor.draft.path.at(-1) || editor.draft.works[0]?.id || null);
  const [response, setResponse] = useState<ExploreResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [mobileTab, setMobileTab] = useState<"list" | "map">("list");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [showDismissed, setShowDismissed] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [pathCursor, setPathCursor] = useState(Math.max(0, editor.draft.path.length - 1));
  const [loadingLatest, setLoadingLatest] = useState(false);
  const sequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const histories = useRef(new Map<string, ExploreResponse>());
  const saving = useRef(false);
  const reloading = useRef(false);
  const detailRef = useRef<HTMLElement | null>(null);
  const readOnly = getWorkspaceRole() === "viewer";
  const exploration = editor.draft;
  const selected = exploration.works.find((work) => work.id === selectedId) || null;
  const dirty = !revisionDraftEqual(editor.draft, editor.baseline);

  useEffect(() => { editorRef.current = editor; }, [editor]);
  useEffect(() => {
    if (protectedDraft.current) return;
    const ok = persistRevisionDraft(storage(), key, editor);
    if (!ok && editor.saveState !== "saved") setDraftStorageError(true);
  }, [editor, key]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  useEffect(() => () => { sequence.current += 1; requestController.current?.abort(); }, []);

  const edit = useCallback((change: (current: Exploration) => Exploration) => {
    setEditor((current) => {
      const next = change(current.draft);
      const updated = editRevisionDraft(current, { ...next, updated_at: new Date().toISOString() });
      editorRef.current = updated; return updated;
    });
  }, []);

  async function reloadLatest() {
    if (reloading.current || saving.current) return;
    reloading.current = true;
    setLoadingLatest(true);
    try {
      const latest = await labviumRequest<Snapshot>(`/projects/${encodeURIComponent(projectId)}/exploration`);
      setEditor((current) => receiveRemoteRevision(current, { value: latest.exploration, revision: latest.revision, changedElsewhere: !revisionDraftEqual(current.draft, current.baseline) && latest.revision !== current.revision }));
      setMessage(tr("최신 저장본을 불러왔어요. 작성 중인 내용은 유지됩니다.", "Loaded the latest saved graph. Your draft was retained."));
    } catch (error) { setMessage(errorMessage(error, tr("최신 저장본을 불러오지 못했어요.", "The latest saved graph could not be loaded."))); }
    finally { reloading.current = false; setLoadingLatest(false); }
  }

  async function save() {
    if (readOnly || saving.current || reloading.current || protectedDraft.current) return;
    const begun = beginRevisionSave(editorRef.current);
    if (!begun.request) return;
    saving.current = true; setEditor(begun.state); editorRef.current = begun.state;
    try {
      const saved = await labviumRequest<Snapshot>(`/projects/${encodeURIComponent(projectId)}/exploration`, { method: "PUT", body: { exploration: begun.request.draft, expected_revision: begun.request.revision } });
      setEditor((current) => completeRevisionSave(current, begun.request!.token, { value: saved.exploration, revision: saved.revision }));
    } catch (error) {
      const kind = error instanceof ApiClientError ? error.kind : "error";
      setEditor((current) => failRevisionSave(current, begun.request!.token, kind, errorMessage(error, tr("저장하지 못했어요. 작성 중인 내용은 유지됩니다.", "The graph could not be saved. Your draft was retained."))));
      if (kind === "conflict") {
        try {
          const latest = await labviumRequest<Snapshot>(`/projects/${encodeURIComponent(projectId)}/exploration`);
          setEditor((current) => latest.revision === current.revision ? { ...current, saveState: "failed", lastError: errorMessage(error, tr("프로젝트에서 이 변경을 저장할 수 없어요. 작성본은 유지됩니다.", "This project cannot accept the change. Your draft was retained.")) } : receiveRemoteRevision(current, { value: latest.exploration, revision: latest.revision, changedElsewhere: true }));
        } catch { /* The draft remains protected until a latest value can be read. */ }
      }
    } finally { saving.current = false; }
  }

  async function search(event?: FormEvent<HTMLFormElement>, from?: ExplorationWork) {
    event?.preventDefault();
    const q = query.trim(), seed = from ? seedFor(from) : seedInput.trim();
    if ((!q && !seed) || busy) return;
    if (from && !seed) { setMessage(tr("이 자료에는 추적 가능한 OpenAlex ID나 DOI가 없어요. 제목으로 다시 검색해 주세요.", "This source has no traceable OpenAlex ID or DOI. Search its title instead.")); return; }
    const token = ++sequence.current, controller = new AbortController();
    requestController.current?.abort(); requestController.current = controller;
    setBusy(true); setMessage("");
    try {
      const params = new URLSearchParams({ mode, limit: "20" }); if (q) params.set("q", q); if (seed) params.set("seed", seed);
      const result = await labviumRequest<ExploreResponse>(`/discover/explore?${params}`, { signal: controller.signal });
      if (token !== sequence.current || controller.signal.aborted) return;
      const merged = mergeExploration(editorRef.current.draft, result);
      let next = merged.exploration;
      const seedId = stableWorkId(next.works, result.seed);
      const pathFull = Boolean(seedId && next.path.at(-1) !== seedId && next.path.length >= EXPLORATION_LIMITS.path);
      if (seedId && next.path.at(-1) !== seedId && next.path.length < EXPLORATION_LIMITS.path) next = { ...next, path: [...next.path, seedId] };
      if (!next.topic) next = { ...next, topic: q || result.seed?.title || "" };
      edit(() => next);
      setResponse(result);
      if (seedId) { histories.current.set(seedId, result); setSelectedId(seedId); setPathCursor(pathFull ? -1 : Math.max(0, next.path.length - 1)); }
      else if (result.items[0]) setSelectedId(stableWorkId(next.works, result.items[0]));
      setDetailsOpen(true); setResultFilter("all");
      if (merged.truncated) setMessage(tr(`그래프의 ${EXPLORATION_LIMITS.works}개 자료 한도에 도달했어요. 기존 자료와 경로를 유지했습니다. JSON을 내보내고 다른 프로젝트에서 새 탐색을 시작하거나 불필요한 자료를 직접 제거해 주세요.`, `The graph reached its ${EXPLORATION_LIMITS.works}-source limit. Existing sources and paths were retained. Export JSON and begin another project, or explicitly remove sources you no longer need.`));
      else if (pathFull) setMessage(tr(`탐색 경로 ${EXPLORATION_LIMITS.path}단계 한도에 도달해 기존 경로를 유지했습니다. 새 결과는 지도에 반영했지만 경로에 추가하지 않았어요. JSON을 내보내고 다른 프로젝트에서 새 경로를 시작해 주세요.`, `The ${EXPLORATION_LIMITS.path}-step path limit was reached. Existing steps were retained and new results were merged without adding a path entry. Export JSON and start another project for a new trail.`));
      else if (!result.items.length) setMessage(tr("현재 조건에서 새 후보를 찾지 못했어요. 주제를 넓히거나 다른 탐색 방식을 선택해 보세요.", "No candidates were found for these conditions. Broaden the question or try another exploration mode."));
    } catch (error) {
      if (token !== sequence.current || controller.signal.aborted) return;
      setMessage(errorMessage(error, tr("자료를 불러오지 못했어요. 저장된 그래프와 작성 내용은 유지됩니다.", "Sources could not be retrieved. The saved graph and your draft were retained.")));
    } finally { if (token === sequence.current) { setBusy(false); requestController.current = null; } }
  }

  function selectWork(id: string) {
    setSelectedId(id); setDetailsOpen(true);
    if (window.matchMedia("(max-width: 850px)").matches) requestAnimationFrame(() => { detailRef.current?.scrollIntoView({ block: "start" }); detailRef.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true }); });
  }
  function moveMobileTab(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "list" : event.key === "End" ? "map" : mobileTab === "list" ? "map" : "list";
    setMobileTab(next);
    event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next === "list" ? 0 : 1]?.focus();
  }
  function travel(index: number) {
    const id = exploration.path[index]; if (!id) return;
    selectWork(id); setPathCursor(index); setResponse(histories.current.get(id) || null);
  }
  function toggleSaved(id: string) {
    edit((current) => ({ ...current, saved_ids: current.saved_ids.includes(id) ? current.saved_ids.filter((value) => value !== id) : [...current.saved_ids, id] }));
  }
  function toggleDismissed(id: string) {
    edit((current) => ({ ...current, dismissed_ids: current.dismissed_ids.includes(id) ? current.dismissed_ids.filter((value) => value !== id) : [...current.dismissed_ids, id] }));
  }
  function queueWork(id: string, state: QueueState | "") {
    const existing = editorRef.current.draft.queue.find((entry) => entry.work_id === id);
    if (!state && existing?.note && !window.confirm(tr("대기열에서 제거하면 이 자료의 대기열 메모도 제거됩니다. 계속할까요?", "Removing this source from the queue also removes its queue note. Continue?"))) return;
    edit((current) => ({ ...current, queue: state ? current.queue.some((entry) => entry.work_id === id) ? current.queue.map((entry) => entry.work_id === id ? { ...entry, state } : entry) : [...current.queue, { work_id: id, state, note: "" }] : current.queue.filter((entry) => entry.work_id !== id) }));
  }
  function removeWork(work: ExplorationWork) {
    if (!window.confirm(tr(`「${work.title}」를 이 그래프에서만 제거할까요? 탐색 경로와 이 자료에 작성한 대기열 메모도 제거됩니다.`, `Remove “${work.title}” from this graph? Its path entries and queue notes will also be removed.`))) return;
    edit((current) => ({ ...current, works: current.works.filter((row) => row.id !== work.id), edges: current.edges.filter((edge) => edge.source !== work.id && edge.target !== work.id), path: current.path.filter((id) => id !== work.id), saved_ids: current.saved_ids.filter((id) => id !== work.id), dismissed_ids: current.dismissed_ids.filter((id) => id !== work.id), queue: current.queue.filter((row) => row.work_id !== work.id) }));
    setSelectedId(null);
  }

  const visibleWorks = useMemo(() => exploration.works.filter((work) => showDismissed || !exploration.dismissed_ids.includes(work.id)), [exploration.works, exploration.dismissed_ids, showDismissed]);
  const sourceIds = response ? new Set(response.items.map((work) => stableWorkId(exploration.works, work)).filter(Boolean)) : null;
  const candidates = (resultFilter === "saved" ? exploration.works.filter((work) => exploration.saved_ids.includes(work.id)) : resultFilter === "queue" ? exploration.queue.map((row) => exploration.works.find((work) => work.id === row.work_id)).filter((work): work is ExplorationWork => Boolean(work)) : response ? visibleWorks.filter((work) => sourceIds?.has(work.id)) : visibleWorks).filter((work) => showDismissed || !exploration.dismissed_ids.includes(work.id));
  const selectedQueue = selected ? exploration.queue.find((entry) => entry.work_id === selected.id) : undefined;
  const explanationWork = response?.items.find((work) => stableWorkId(exploration.works, work) === selectedId);
  const selectedEdges = selected ? exploration.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id) : [];
  const selectedResponse = stableWorkId(exploration.works, response?.seed) === selectedId ? response : null;
  const cssMode = busy ? " research-exploration--busy" : "";
  const modeLabel = (value: Mode) => ({ balanced: tr("균형 있게", "Balanced"), foundations: tr("선행 연구", "Foundations"), recent: tr("최근 연구", "Recent"), bridges: tr("분야 연결", "Bridges") })[value];
  const relationLabel = (kind: string) => ({ cites: tr("실제 인용", "Recorded citation"), shares_references: tr("참고문헌 공유", "Shared references"), shares_topics: tr("주제 공유", "Shared topics"), text_similarity: tr("텍스트 유사성", "Text similarity") })[kind] || kind;
  const providerLabel = (provider: string) => provider === "Labvium deterministic ranking" ? tr("랩비움 메타데이터 계산", provider) : provider;
  function reasonText(reason: ExplorationWork["reasons"][number], work: ExplorationWork) {
    if (locale === "en") return reason.text;
    const count = reason.evidence_count ?? 0;
    const missingFields: Record<string, string> = { references: "참고문헌", citation_count: "인용 수", abstract: "초록", publication_year: "출판 연도", topic_ids: "주제 분류" };
    return ({ seed_cites_work: "기준 논문의 제공처 참고문헌에 이 자료가 포함되어 있습니다.", work_cites_seed: "제공처가 이 자료에서 기준 논문으로 향하는 인용을 기록했습니다.", shared_references: `기준 논문과 참고문헌 ${count}개를 공유합니다. 참고문헌 수로 정규화한 문헌 결합도이며, 두 논문 사이의 직접 인용을 뜻하지는 않습니다.`, shared_topics: `제공처가 분류한 주제 ${count}개를 공유합니다. 주제 분류의 일치이며 직접 인용 관계는 아닙니다.`, text_similarity: "제목, 제공된 초록, 키워드와 주제 이름의 단어를 TF-IDF 방식으로 비교했습니다. 의미나 인과관계의 검증은 아닙니다.", recency: `출판 연도는 ${work.year || "미상"}입니다. ‘최근 연구’ 방식은 이 요소의 비중을 높입니다.`, citation_context: `제공처에 인용 ${count}회가 기록되어 있습니다. 순위에서 작은 비중으로 사용하며 논문의 품질을 판정하지 않습니다.`, missing_evidence: `제공되지 않은 정보: ${Object.entries(work.evidence || {}).filter(([, value]) => value === "missing").map(([field]) => missingFields[field] || field).join(", ") || "일부 메타데이터"}. 누락된 근거를 추정해 채우지 않았습니다.`, diversity: "메타데이터와 참고문헌이 비슷한 자료의 반복을 줄여 탐색 범위를 넓혔습니다. 순위는 자료 탐색을 위한 것이며 과학적 품질 점수가 아닙니다." })[reason.kind] || reason.text;
  }
  function warningText(warning: string) {
    if (locale === "en") return warning;
    return ({
      "Citation and abstract coverage depends on provider indexing. A missing link does not establish that two papers are unrelated.": "인용과 초록의 범위는 제공처의 색인에 따라 달라집니다. 연결이 없다고 두 논문이 무관한 것은 아닙니다.",
      "Scores rank exploration candidates using metadata and reference evidence; they do not measure scientific quality, truth, or author reputation.": "순위는 메타데이터와 참고문헌 근거로 탐색 후보를 정렬한 결과입니다. 과학적 품질, 진위나 저자의 평판을 평가하지 않습니다.",
      "No resolved OpenAlex seed is available. Citation-neighborhood expansion and shared-reference retrieval are unavailable; starter results use actual provider metadata only.": "OpenAlex에서 기준 논문을 확인하지 못했습니다. 인용 주변이나 공유 참고문헌을 확장할 수 없으며, 첫 후보는 실제 제공처 메타데이터로만 표시합니다.",
      "Crossref fallback has DOI-only reference coverage, no OpenAlex topic IDs, and no citing-work expansion. Missing evidence remains unavailable.": "Crossref 대체 검색은 DOI로 된 참고문헌만 다루며 OpenAlex 주제와 인용한 논문 확장을 제공하지 않습니다. 누락된 근거는 미상으로 남깁니다.",
      "The requested seed could not be resolved unambiguously. No placeholder or inferred original paper was created.": "요청한 기준 논문을 하나로 확인하지 못했습니다. 임의의 기준 논문을 만들지 않았습니다.",
      "The seed title did not identify one exact indexed work. Choose a returned work before expanding its citation neighborhood.": "논문 제목과 정확하게 일치하는 색인 자료 하나를 확인하지 못했습니다. 결과에서 자료를 선택해 인용 주변을 탐색해 주세요.",
      "The DOI matched several OpenAlex work IDs. Select a specific work to expand; no seed was assumed.": "DOI에 여러 OpenAlex 자료가 일치했습니다. 기준 논문을 가정하지 않았으므로 결과에서 자료를 직접 선택해 주세요.",
      "The seed is marked retracted by OpenAlex. It remains visible as the explicit seed; recommendations exclude works marked retracted.": "기준 논문은 OpenAlex에서 철회된 자료로 표시됩니다. 직접 고른 기준 논문은 유지하지만 철회 표시가 있는 자료는 새 후보에서 제외합니다.",
    })[warning] || (/provider unavailable/.test(warning) ? "일부 제공처에 연결하지 못했습니다. 기존 연구 자료는 유지되며 확인 가능한 근거만 표시합니다." : /provider rate limit/.test(warning) ? "일부 제공처의 요청 한도에 도달했습니다. 잠시 뒤 다시 검색해 주세요." : /deadline|lookup budget/.test(warning) ? "일부 조회가 시간 또는 요청 한도에 도달했습니다. 현재 지도는 확인된 범위만 보여 줍니다." : warning);
  }
  const topicSuggestions = /ccs|carbon|co2|이산화탄소|탄소|저장|지중/i.test(exploration.topic || query) ? [
    [tr("저장 부지 선정", "Site selection"), "carbon dioxide geological storage site screening"],
    [tr("저류층과 주입", "Reservoir and injection"), "CO2 storage reservoir injectivity pressure management"],
    [tr("덮개암과 누출", "Caprock and leakage"), "CO2 storage caprock integrity leakage risk"],
    [tr("모니터링과 검증", "Monitoring and verification"), "carbon storage monitoring verification uncertainty"],
  ] : exploration.topic.trim() ? [[tr("분야 개관", "Field overview"), `${exploration.topic} review`], [tr("방법과 검증", "Methods and validation"), `${exploration.topic} methods validation`], [tr("한계와 불확실성", "Limits and uncertainty"), `${exploration.topic} uncertainty limitations`]] : [[tr("CCS로 시작하기", "Start with CCS"), "carbon dioxide geological storage"]];

  function renderWork(work: ExplorationWork) {
    const saved = exploration.saved_ids.includes(work.id), queued = exploration.queue.find((entry) => entry.work_id === work.id), dismissed = exploration.dismissed_ids.includes(work.id);
    return <article key={work.id} className={`research-source${selectedId === work.id ? " research-source--selected" : ""}${dismissed ? " research-source--dismissed" : ""}`}>
      <button type="button" className="research-source__select" aria-pressed={selectedId === work.id} onClick={() => selectWork(work.id)}>
        <span className="research-source__title">{work.title}</span>
        <span className="research-source__byline">{work.year || tr("연도 미상", "Year unavailable")}{work.authors?.length ? ` · ${work.authors.slice(0, 2).join(", ")}${work.authors.length > 2 ? " et al." : ""}` : ""}</span>
        <span className="research-source__signals">{work.source || work.providers?.join(" · ") || tr("출처 정보 없음", "Source unavailable")}{saved ? <span><Bookmark size={12} />{tr("보관", "Saved")}</span> : null}{queued ? <span><Check size={12} />{queued.state === "to_read" ? tr("읽을 자료", "To read") : queued.state === "reading" ? tr("읽는 중", "Reading") : tr("읽음", "Read")}</span> : null}</span>
      </button>
      <div className="research-source__actions">
        <button type="button" className="research-icon-control" title={saved ? tr("보관 해제", "Unsave") : tr("후보 보관", "Save candidate")} aria-label={`${saved ? tr("보관 해제", "Unsave") : tr("후보 보관", "Save candidate")}: ${work.title}`} aria-pressed={saved} disabled={readOnly} onClick={() => toggleSaved(work.id)}><Bookmark size={17} fill={saved ? "currentColor" : "none"} /></button>
        <button type="button" className="research-icon-control" title={dismissed ? tr("후보 다시 표시", "Restore candidate") : tr("후보 숨기기", "Dismiss candidate")} aria-label={`${dismissed ? tr("후보 다시 표시", "Restore candidate") : tr("후보 숨기기", "Dismiss candidate")}: ${work.title}`} disabled={readOnly} onClick={() => toggleDismissed(work.id)}>{dismissed ? <RefreshCw size={16} /> : <X size={17} />}</button>
      </div>
    </article>;
  }

  return <div className={`page-stack research-exploration${cssMode}`}>
    <Breadcrumbs items={[{ label: tr("프로젝트", "Projects"), href: "/projects" }, { label: projectName, href: `/projects/${encodeURIComponent(projectId)}` }, { label: tr("연구 탐색", "Research exploration") }]} />
    <PageHeader title={tr("질문에서 연구의 지도로", "From a question to a research map")} description={projectName} actions={<><SaveStatus state={editor.saveState} /><button className="reader-control" type="button" disabled={readOnly || loadingLatest || !dirty || editor.saveState === "saving" || editor.saveState === "changed_elsewhere" || protectedDraft.current} onClick={() => void save()}><Save size={16} />{tr("그래프 저장", "Save graph")}</button><button type="button" className="reader-control reader-control--secondary" onClick={() => downloadJson({ schema: "labvium.project-exploration.v1", project_id: projectId, exploration }, "labvium-research-exploration.json")}><Download size={16} />JSON</button></>} />
    {readOnly ? <p className="research-notice">{tr("읽기 권한으로 보고 있어요. 검색 결과를 살펴볼 수 있지만 이 프로젝트에 변경 내용을 저장할 수는 없습니다.", "You have read-only access. You can explore results, but cannot save changes to this project.")}</p> : null}
    {protectedDraft.current ? <div className="research-notice research-notice--warning" role="alert"><p>{tr("이 기기의 이전 임시 저장본을 읽지 못했어요. 원본은 보존되어 있습니다. 새로 작성하기 전에 내려받아 주세요.", "A previous draft on this device could not be read. Its bytes were preserved; download it before starting a new draft.")}</p><button type="button" className="reader-control reader-control--secondary" onClick={() => downloadJson({ raw: storage()?.getItem(key) }, "labvium-unreadable-exploration-draft.json")}>{tr("임시 저장본 내려받기", "Download draft bytes")}</button><button type="button" className="reader-control reader-control--secondary" onClick={() => { if (window.confirm(tr("이전 임시 저장본 대신 현재 저장된 그래프로 계속할까요?", "Continue with the saved graph and replace the unreadable local draft?"))) { protectedDraft.current = false; setEditor((current) => ({ ...current })); } }}>{tr("저장된 그래프로 계속", "Continue with saved graph")}</button></div> : null}
    {draftStorageError ? <p className="research-notice research-notice--warning" role="status">{tr("이 기기에 임시 저장할 공간이 부족하거나 저장이 차단됐어요. 이 화면을 떠나기 전에 그래프를 저장하거나 JSON을 내려받아 주세요.", "Device draft storage is full or unavailable. Save the graph or download its JSON before leaving this screen.")}</p> : null}
    {editor.saveState === "changed_elsewhere" ? <div className="research-conflict" role="alert"><strong>{tr("다른 곳에서 변경됐어요", "Changed elsewhere")}</strong><p>{tr("작성 중인 그래프와 최신 저장본을 각각 유지하고 있어요. 최신 내용을 확인한 뒤 사용할 버전을 선택해 주세요.", "Your draft and the latest saved graph are separate. Review the current saved version before choosing which to keep.")}</p><div className="research-control-row"><button type="button" className="reader-control reader-control--secondary" disabled={loadingLatest} onClick={() => void reloadLatest()}>{tr("최신본 확인", "Check latest")}</button><button type="button" className="reader-control reader-control--secondary" disabled={loadingLatest || editor.remoteRevision === editor.revision} onClick={() => downloadJson(editor.remote, "labvium-latest-exploration.json")}>{tr("최신본 내려받기", "Download latest")}</button><button type="button" className="reader-control" disabled={loadingLatest || editor.remoteRevision === editor.revision} onClick={() => setEditor((current) => keepMyRevisionDraft(current))}>{tr("내 작성본 유지", "Keep my draft")}</button><button type="button" className="reader-control reader-control--secondary" disabled={loadingLatest || editor.remoteRevision === editor.revision} onClick={() => { if (window.confirm(tr("작성 중인 내용을 최신 저장본으로 바꿀까요?", "Replace your draft with the latest saved graph?"))) setEditor((current) => applyLatestRevisionDraft(current)); }}>{tr("최신 저장본 사용", "Use latest")}</button></div></div> : editor.lastError ? <p className="research-notice research-notice--warning" role="alert">{editor.lastError}</p> : null}

    <section className="research-question" aria-labelledby="research-question-title">
      <div className="research-section-heading"><div><h2 id="research-question-title">{tr("어떤 질문을 탐색하나요?", "What question are you exploring?")}</h2><p>{tr("프로젝트의 질문을 적고, 검색 방향을 골라 첫 자료를 찾아보세요.", "Write a project question, choose a search direction, and find a starting source.")}</p></div><span className="research-quiet-count">{exploration.works.length}/{EXPLORATION_LIMITS.works} {tr("자료", "sources")}</span></div>
      <label className="reader-field"><span>{tr("연구 주제 또는 질문", "Research topic or question")}</span><textarea value={exploration.topic} maxLength={500} rows={2} disabled={readOnly} onChange={(event) => { const value = event.target.value; edit((current) => ({ ...current, topic: value })); if (!query || query === exploration.topic) setQuery(value.slice(0, 300)); }} placeholder={tr("예: CCS 저장 부지를 평가할 때 어떤 불확실성을 먼저 줄여야 할까?", "e.g. Which uncertainties should be reduced first when evaluating a CCS storage site?")} /></label>
      <div className="research-topic-suggestions"><span>{tr("검색 방향 예시", "Search direction templates")}</span>{topicSuggestions.map(([label, value]) => <button key={value} type="button" onClick={() => { setQuery(value.slice(0, 300)); setSeedInput(""); }}>{label}<ArrowRight size={13} /></button>)}</div>
      <form className="research-search" onSubmit={(event) => void search(event)}>
        <label className="reader-field research-search__query"><span>{tr("검색어", "Search terms")}</span><input maxLength={300} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr("제목, 연구 주제, 방법", "Title, topic, or method")} /></label>
        <label className="reader-field"><span>{tr("탐색 방식", "Explore by")}</span><select value={mode} onChange={(event) => setMode(event.target.value as Mode)}>{(["balanced", "foundations", "recent", "bridges"] as Mode[]).map((value) => <option value={value} key={value}>{modeLabel(value)}</option>)}</select></label>
        <button className="reader-control" type="submit" disabled={busy || (!query.trim() && !seedInput.trim())}>{busy ? <LoaderCircle size={17} className="loading-icon" /> : <Search size={17} />}{tr(busy ? "자료 찾는 중…" : "첫 자료 찾기", busy ? "Finding sources…" : "Find a starting paper")}</button>
        {busy ? <button type="button" className="reader-control reader-control--secondary" onClick={() => { requestController.current?.abort(); sequence.current += 1; setBusy(false); setMessage(tr("검색을 취소했어요. 기존 그래프는 유지됩니다.", "Search cancelled. The existing graph was retained.")); }}>{tr("취소", "Cancel")}</button> : null}
      </form>
      <details className="research-seed-input"><summary>{tr("이미 아는 논문의 DOI 또는 OpenAlex ID로 시작", "Start from a known DOI or OpenAlex ID")}</summary><label className="reader-field"><span>{tr("기준 논문", "Seed paper")}</span><input maxLength={500} value={seedInput} onChange={(event) => setSeedInput(event.target.value)} placeholder="10.… / W… / https://openalex.org/W…" /></label></details>
      <p className="research-hint">{tr("검색 방향은 미리 작성한 템플릿이에요. 논문의 품질 평가나 AI 추천이 아닙니다. 보관하는 것은 서지 정보이며 PDF를 자동으로 내려받지 않습니다.", "Directions are editable templates. Rankings use scholarly metadata, not AI or a judgment of scientific quality. Saving a candidate stores its metadata; PDFs are not downloaded automatically.")}</p>
    </section>

    {message ? <p className="research-notice" role="status">{message}</p> : null}
    {response?.warnings?.length ? <div className="research-coverage" role="status">{response.warnings.map((warning, index) => <p key={index}>{warningText(warning)}</p>)}</div> : null}
    {exploration.path.length ? <nav className="research-path" aria-label={tr("탐색 경로", "Exploration path")}><button type="button" className="research-icon-control" disabled={pathCursor <= 0} onClick={() => travel(pathCursor - 1)} aria-label={tr("탐색 경로 뒤로", "Previous exploration step")}><ArrowLeft size={17} /></button><ol>{exploration.path.map((id, index) => <li key={`${id}-${index}`}><button type="button" aria-current={pathCursor === index ? "step" : undefined} onClick={() => travel(index)} title={exploration.works.find((work) => work.id === id)?.title}>{index + 1}. {exploration.works.find((work) => work.id === id)?.title || id}</button></li>)}</ol><button type="button" className="research-icon-control" disabled={pathCursor >= exploration.path.length - 1} onClick={() => travel(pathCursor + 1)} aria-label={tr("탐색 경로 앞으로", "Next exploration step")}><ArrowRight size={17} /></button></nav> : null}

    <div className="research-mobile-tabs" onKeyDown={moveMobileTab} role="tablist" aria-label={tr("탐색 보기", "Exploration view")}><button type="button" role="tab" tabIndex={mobileTab === "list" ? 0 : -1} aria-selected={mobileTab === "list"} aria-controls="research-source-panel" onClick={() => setMobileTab("list")}><List size={17} />{tr("자료 목록", "Sources")}</button><button type="button" role="tab" tabIndex={mobileTab === "map" ? 0 : -1} aria-selected={mobileTab === "map"} aria-controls="research-map-panel" onClick={() => setMobileTab("map")}><MapIcon size={17} />{tr("관계 지도", "Map")}</button></div>
    <div className={`research-workspace${selected ? " research-workspace--has-selection" : ""}`}>
      <section id="research-map-panel" tabIndex={-1} className={`research-map-panel${mobileTab === "map" ? " research-mobile-panel--active" : ""}`} aria-labelledby="research-map-title">
        <div className="research-section-heading"><div><h2 id="research-map-title">{tr("자료 사이의 관계", "Relationships between sources")}</h2><p>{tr("실선 화살표는 기록된 인용, 점선은 계산된 연관성입니다.", "Solid arrows are recorded citations. Dashed lines are computed relationships.")}</p></div></div>
        {visibleWorks.length ? <ResearchMap works={visibleWorks} edges={exploration.edges} selectedId={selectedId} onSelect={selectWork} locale={locale} /> : <div className="research-map-empty"><Network size={44} strokeWidth={1} /><h3>{tr("첫 자료를 찾으면 지도가 시작됩니다", "Your map starts with a first source")}</h3><p>{tr("검색 결과에서 논문을 골라 연결된 자료를 따라가 보세요.", "Choose a paper from the results, then follow its related sources.")}</p><span>01 — 02 — 03</span></div>}
      </section>
      <section id="research-source-panel" tabIndex={-1} className={`research-results${mobileTab === "list" ? " research-mobile-panel--active" : ""}`} aria-labelledby="research-results-title">
        <div className="research-section-heading"><div><h2 id="research-results-title">{resultFilter === "queue" ? tr("읽기 대기열", "Reading queue") : resultFilter === "saved" ? tr("보관한 후보", "Saved candidates") : response?.seed ? tr("다음에 살펴볼 자료", "Where to explore next") : tr("탐색할 자료", "Sources to explore")}</h2><p>{response?.seed && resultFilter === "all" ? response.seed.title : tr("자료를 선택하면 근거와 다음 탐색 방향을 볼 수 있어요.", "Select a source to inspect its evidence and explore further.")}</p></div><span className="research-quiet-count">{candidates.length}</span></div>
        <div className="research-result-tabs" role="group" aria-label={tr("자료 필터", "Filter sources")}>{(["all", "saved", "queue"] as ResultFilter[]).map((filter) => <button type="button" key={filter} aria-pressed={resultFilter === filter} onClick={() => setResultFilter(filter)}>{filter === "all" ? tr("발견한 자료", "Discovered") : filter === "saved" ? `${tr("보관", "Saved")} ${exploration.saved_ids.length}` : `${tr("대기열", "Queue")} ${exploration.queue.length}`}</button>)}</div>
        <div className="research-source-list" aria-busy={busy}>{candidates.length ? candidates.map(renderWork) : <p className="research-empty-copy">{resultFilter === "queue" ? tr("읽을 자료를 대기열에 추가하고 검토 메모를 남겨보세요.", "Add a source to your reading queue and keep review notes.") : resultFilter === "saved" ? tr("관심 있는 자료의 책갈피 버튼을 눌러 보관하세요.", "Use a source’s bookmark button to save it as a candidate.") : tr("연구 질문으로 검색하거나 알고 있는 논문을 기준으로 시작하세요.", "Search a research question, or start from a paper you already know.")}</p>}</div>
        {exploration.dismissed_ids.length ? <label className="research-show-dismissed"><input type="checkbox" checked={showDismissed} onChange={(event) => setShowDismissed(event.target.checked)} />{tr(`숨긴 후보 ${exploration.dismissed_ids.length}개도 표시`, `Include ${exploration.dismissed_ids.length} dismissed candidates`)}</label> : null}
        {response ? <details className="research-source-coverage"><summary>{tr("검색 범위와 순위 해석", "Coverage and ranking")}</summary><p>{tr("인용 수는 연구의 정확성을 뜻하지 않습니다. 순위는 현재 질문과 기준 논문에 대한 메타데이터 신호를 조합합니다. 누락된 정보는 추정하지 않습니다.", "Citation counts do not establish correctness. Ranking combines metadata signals for this question and seed. Missing information is not estimated.")}</p><p>{response.coverage?.providers?.join(" · ")}{response.retrieved_at ? ` · ${new Date(response.retrieved_at).toLocaleString(locale === "ko" ? "ko-KR" : "en-US")}` : ""}</p><p>{tr("인용 연결 범위", "Citation coverage")}: {response.coverage?.citation_graph === "available" ? tr("이 응답의 자료에서 확인 가능", "Available for this response") : response.coverage?.citation_graph === "partial" ? tr("일부만 확인 가능", "Partial") : tr("확인할 수 없음", "Unavailable")}</p></details> : null}
      </section>

    {selected ? <section ref={detailRef} className="research-inspector" aria-labelledby="research-selected-title"><button type="button" className="research-inspector__toggle" aria-expanded={detailsOpen} aria-controls="research-selected-body" onClick={() => setDetailsOpen((open) => !open)}><span>{tr("선택한 자료", "Selected source")}</span><ChevronDown size={18} className={detailsOpen ? "is-open" : ""} /></button><div id="research-selected-body" hidden={!detailsOpen}><button className="research-mobile-return research-inline-link" type="button" onClick={() => { const panel = document.getElementById(mobileTab === "map" ? "research-map-panel" : "research-source-panel"); panel?.scrollIntoView({ block: "start" }); panel?.focus({ preventScroll: true }); }}><ArrowLeft size={14} />{tr("탐색 화면으로 돌아가기", "Return to exploration")}</button>
      <div className="research-inspector__heading"><div><p className="research-quiet-count">{selected.year || tr("연도 미상", "Year unavailable")} · {selected.journal || selected.source || selected.providers?.join(" · ")}</p><h2 id="research-selected-title" tabIndex={-1}>{selected.title}</h2><p>{selected.authors?.join(", ") || tr("저자 정보 없음", "Authors unavailable")}</p></div><div className="research-control-row"><button type="button" className="reader-control" disabled={busy || !seedFor(selected)} onClick={() => void search(undefined, selected)}><Network size={16} />{tr("이 자료에서 이어 탐색", "Explore from here")}</button><button type="button" className="reader-control reader-control--secondary" disabled={readOnly} aria-pressed={exploration.saved_ids.includes(selected.id)} onClick={() => toggleSaved(selected.id)}><Bookmark size={16} />{exploration.saved_ids.includes(selected.id) ? tr("후보 보관됨", "Candidate saved") : tr("후보 보관", "Save candidate")}</button></div></div>
      <div className="research-inspector__columns"><div className="research-inspector__reading">
        {selected.abstract ? <p className="research-abstract">{selected.abstract}</p> : <p className="research-hint">{tr("이 출처에서 초록을 제공하지 않아요. 원문에서 연구 범위를 확인해 주세요.", "An abstract is unavailable from this source. Check the publication for its scope.")}</p>}
        <div className="research-control-row">{safeUrl(selected.url) ? <a className="text-link" href={safeUrl(selected.url)} target="_blank" rel="noreferrer">{tr("출처 열기", "Open source")}<ExternalLink size={14} /></a> : null}{safeUrl(selected.pdf_url) ? <a className="text-link" href={safeUrl(selected.pdf_url)} target="_blank" rel="noreferrer">{tr("제공처 PDF", "Provider PDF")}<ExternalLink size={14} /></a> : null}{selected.doi ? <span className="research-doi">DOI: {selected.doi}</span> : null}</div>
        {explanationWork?.reasons?.length ? <div className="research-evidence"><h3>{tr("왜 이 자료가 연결됐나요?", "Why is this source connected?")}</h3><p className="research-hint">{response?.seed ? `${tr("기준 자료", "Relative to")}: ${response.seed.title}` : `${tr("검색어", "Query")}: ${response?.q || query}`}</p><ul>{explanationWork.reasons.map((reason, index) => <li key={index}><span>{reasonText(reason, explanationWork)}</span><small>{providerLabel(reason.provider)}{reason.evidence_count != null ? ` · ${reason.evidence_count}` : ""}</small></li>)}</ul></div> : null}
        {selectedEdges.length ? <div className="research-evidence"><h3>{tr("지도에 확인된 연결", "Relationships in this map")}</h3><ul>{selectedEdges.slice(0, 12).map((edge) => { const otherId = edge.source === selected.id ? edge.target : edge.source, other = exploration.works.find((work) => work.id === otherId); return <li key={edgeKey(edge)}><span className={`research-edge-label research-edge-label--${edge.kind === "cites" ? "citation" : "computed"}`}>{relationLabel(edge.kind)}{edge.kind === "cites" ? edge.source === selected.id ? ` · ${tr("이 자료가 인용", "This work cites")}` : ` · ${tr("이 자료를 인용", "Cites this work")}` : ""}</span><button type="button" className="research-inline-link" onClick={() => selectWork(otherId)}>{other?.title || otherId}</button><small>{providerLabel(edge.evidence?.provider || "")}{edge.evidence?.shared_reference_ids?.length ? ` · ${tr("공유 참고문헌", "Shared references")} ${edge.evidence.shared_reference_ids.length}` : ""}{edge.evidence?.method ? ` · ${locale === "ko" ? edge.kind === "shares_references" ? "참고문헌 교집합을 문헌 수로 정규화" : edge.kind === "shares_topics" ? "제공처 주제 ID의 자카드 유사도" : edge.kind === "text_similarity" ? "메타데이터 TF-IDF 코사인 유사도" : edge.evidence.method : edge.evidence.method}` : ""}</small>{safeUrl(edge.evidence?.url) ? <a className="text-link" href={safeUrl(edge.evidence.url)} target="_blank" rel="noreferrer">{tr("연결 출처 확인", "Inspect relationship source")}<ExternalLink size={12} /></a> : null}</li>; })}</ul></div> : <p className="research-hint">{tr("현재 지도에는 이 자료와 연결된 인용 근거가 없어요. ‘이어 탐색’으로 출처를 조회해 보세요.", "There is no linked citation evidence for this source in the current map. Explore from it to retrieve relationships.")}</p>}
        {selectedResponse ? <p className="research-hint">{tr("현재 추천 목록은 이 자료를 기준으로 조회한 결과입니다.", "The current candidate list was retrieved from this seed.")}</p> : null}
        {explanationWork?.rank_components ? <details className="research-score-details"><summary>{tr("메타데이터 순위 신호 보기", "Inspect metadata ranking signals")}</summary><dl>{Object.entries(explanationWork.rank_components).map(([name, value]) => <div key={name}><dt>{name.replaceAll("_", " ")}</dt><dd>{typeof value === "number" ? value.toFixed(3) : String(value)}</dd></div>)}</dl><p>{tr("검색 순위의 계산 요소이며 논문의 품질 점수가 아닙니다.", "These are search-ranking components, not paper-quality scores.")}</p></details> : null}
      </div><aside className="research-queue-editor" aria-labelledby="research-queue-title"><h3 id="research-queue-title">{tr("읽고 판단할 자료", "Plan the next read")}</h3><label className="reader-field"><span>{tr("읽기 상태", "Reading state")}</span><select disabled={readOnly} value={selectedQueue?.state || ""} onChange={(event) => queueWork(selected.id, event.target.value as QueueState | "")}><option value="">{tr("대기열에 없음", "Not in queue")}</option><option value="to_read">{tr("읽을 자료", "To read")}</option><option value="reading">{tr("읽는 중", "Reading")}</option><option value="read">{tr("읽음", "Read")}</option></select></label><label className="reader-field"><span>{tr("확인할 질문 또는 검토 메모", "Question to check or review note")}</span><textarea rows={5} maxLength={5000} disabled={readOnly || !selectedQueue} value={selectedQueue?.note || ""} onChange={(event) => { const note = event.target.value; edit((current) => ({ ...current, queue: current.queue.map((entry) => entry.work_id === selected.id ? { ...entry, note } : entry) })); }} placeholder={tr("이 논문을 읽고 어떤 가정이나 근거를 확인할까요?", "Which assumption or evidence should you check when reading this paper?")} /></label><p className="research-hint">{tr("읽기 상태와 메모는 그래프 저장 버튼으로 함께 저장됩니다. 보관·대기열은 PDF 라이브러리와 별개입니다.", "Queue state and notes are saved with Save graph. Candidates and queue entries are separate from the PDF library.")}</p><button type="button" className="research-inline-link research-remove" disabled={readOnly} onClick={() => removeWork(selected)}>{tr("이 그래프에서 자료 제거", "Remove source from this graph")}</button></aside></div>
    </div></section> : null}
    </div>
    <footer className="research-footer"><p>{tr("검색 결과를 검토하고 필요한 후보만 보관하세요. 그래프를 저장해도 논문 원문은 자동으로 복제되지 않습니다.", "Review results and keep useful candidates. Saving the graph does not copy the publication itself.")}</p><button type="button" className="text-link" disabled={loadingLatest} onClick={() => void reloadLatest()}><RefreshCw size={14} />{tr("저장본 새로 확인", "Check saved graph")}</button></footer>
  </div>;
}

export function ProjectResearchView({ projectId }: { projectId: string }) {
  const { locale } = useI18n();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [errorProject, setErrorProject] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    void Promise.all([labviumRequest<Snapshot>(`/projects/${encodeURIComponent(projectId)}/exploration`, { signal: controller.signal }), apiClient.getProject(projectId)])
      .then(([saved, project]) => { if (current) { validateExploration(saved.exploration || emptyExploration()); setSnapshot(saved); setName(project.name); setError(""); } })
      .catch((failure) => { if (current && !controller.signal.aborted) { setErrorProject(projectId); setError(errorMessage(failure, "The project exploration could not be loaded.")); } });
    return () => { current = false; controller.abort(); };
  }, [projectId, attempt]);
  if (error && errorProject === projectId) return <div className="page-stack"><PageHeader title={locale === "ko" ? "연구 탐색" : "Research exploration"} /><p role="alert">{error === "The project exploration could not be loaded." && locale === "ko" ? "프로젝트 탐색을 불러오지 못했어요." : error}</p><button type="button" className="reader-control" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>{locale === "ko" ? "다시 시도" : "Retry"}</button></div>;
  if (!snapshot || snapshot.project_id !== projectId) return <div className="research-loading" role="status"><LoaderCircle size={20} className="loading-icon" />{locale === "ko" ? "프로젝트의 연구 지도를 불러오는 중…" : "Loading the project research map…"}</div>;
  return <ExplorationWorkspace key={projectId} projectId={projectId} snapshot={snapshot} projectName={name} />;
}
