"use client";

import { ArrowLeft, ArrowRight, BookOpen, Check, ExternalLink, Network, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { apiClient, getWorkspaceRole, labviumRequest } from "../lib/api/client";
import type { PaperDetail, ProjectLinkType, ProjectListItem } from "../lib/api/types";
import { useI18n } from "../lib/i18n/LocaleProvider";
import { discoveryKeys } from "../lib/workspace/discovery-identity.mjs";
import { appendPaperTrail, openAlexWorkId, paperExplorationSource, relatedSearchPath, type ExplorationRelation, type PaperTrailStep } from "../lib/workspace/paper-next-steps.mjs";
import { safeResearchUrl } from "../lib/workspace/pages.mjs";
import type { DiscoveryResponse, ScholarlyWork } from "../lib/workspace/types";
import { Section } from "./Section";
import "./paper-next-steps.css";

type SavedIndex = { items: Array<{ paper_id: string; keys: string[] }> };
type SaveResponse = { status: "saved" | "already_saved"; paper_id: string; keys: string[] };

export function PaperNextSteps({ paperId }: { paperId: string }) {
  return <PaperNextStepsContent key={paperId} paperId={paperId} />;
}

function PaperNextStepsContent({ paperId }: { paperId: string }) {
  const { locale } = useI18n();
  const say = (ko: string, en: string) => locale === "ko" ? ko : en;
  const selectId = useId();
  const [paper, setPaper] = useState<PaperDetail | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [projectId, setProjectId] = useState("");
  const [linkType, setLinkType] = useState<ProjectLinkType>("related");
  const [linkedProjects, setLinkedProjects] = useState<string[]>([]);
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectNotice, setProjectNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [trail, setTrail] = useState<PaperTrailStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [savedIndex, setSavedIndex] = useState<SavedIndex["items"]>([]);
  const [savingId, setSavingId] = useState("");
  const alive = useRef(false);
  const generation = useRef(0);
  const explorationRequest = useRef<AbortController | null>(null);
  const saveRequest = useRef<AbortController | null>(null);
  const writeLock = useRef(false);
  const projectWriteLock = useRef(false);
  const canEdit = getWorkspaceRole() !== "viewer";
  const current = trail[trail.length - 1];
  const source = paper ? paperExplorationSource(paper) : null;

  useEffect(() => {
    alive.current = true;
    const token = ++generation.current;
    const controller = new AbortController();
    void Promise.allSettled([
      apiClient.getPaper(paperId), apiClient.getAllProjects(),
      labviumRequest<SavedIndex>("/papers/discovery-index", { signal: controller.signal }),
    ]).then(([paperResult, projectsResult, indexResult]) => {
      if (!alive.current || generation.current !== token) return;
      if (projectsResult.status === "fulfilled") setProjects(projectsResult.value.filter(project => project.status !== "archived"));
      else { setProjects([]); setProjectNotice(say("프로젝트를 불러오지 못했습니다. 페이지를 다시 열어 재시도하세요.", "Projects could not be loaded. Reopen this page to retry.")); }
      if (indexResult.status === "fulfilled") setSavedIndex(indexResult.value.items);
      if (paperResult.status === "fulfilled") {
        const next = paperResult.value;
        setPaper(next); setLinkedProjects(next.project_links.map(link => link.project_id));
        if (next.status === "read" || next.status === "finished") {
          const work = paperExplorationSource(next);
          void explore(work, openAlexWorkId(work) || work.doi ? "references" : "similar", [], token);
        }
      } else setLoadError(say("논문 정보를 불러오지 못했습니다. 페이지를 다시 열어 재시도하세요.", "Paper details could not be loaded. Reopen this page to retry."));
    });
    return () => { alive.current = false; generation.current += 1; controller.abort(); explorationRequest.current?.abort(); saveRequest.current?.abort(); };
    // Locale changes update presentation without restarting requests or resetting the trail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId]);

  async function explore(work: ScholarlyWork, relation: ExplorationRelation, base = trail, scope = generation.current) {
    explorationRequest.current?.abort();
    const controller = new AbortController(); explorationRequest.current = controller;
    setLoading(true); setNotice("");
    const valid = () => alive.current && generation.current === scope && explorationRequest.current === controller && !controller.signal.aborted;
    try {
      let resolved = work;
      if (relation !== "similar" && !openAlexWorkId(resolved) && resolved.doi) {
        const lookup = await labviumRequest<DiscoveryResponse>(`/discover?${new URLSearchParams({ q: resolved.doi, mode: "works", provider: "openalex", limit: "3" })}`, { signal: controller.signal });
        if (!valid()) return;
        const identities = discoveryKeys(resolved);
        const matches = lookup.items.filter(item => openAlexWorkId(item) && discoveryKeys(item).some(key => identities.includes(key)));
        if (matches.length === 1) resolved = { ...resolved, ...matches[0] };
      }
      const path = relatedSearchPath(resolved, relation);
      if (!path) { if (valid()) setNotice(say("확인된 인용 연결이 없습니다. ‘비슷한 주제’를 눌러 다른 논문을 찾아보세요.", "No verified citation identity is available. Choose Similar topics to continue.")); return; }
      const response = await labviumRequest<DiscoveryResponse>(path, { signal: controller.signal });
      if (!valid()) return;
      const ownKeys = discoveryKeys(resolved);
      const seen = new Set<string>();
      const items = response.items.filter(item => {
        const keys = discoveryKeys(item);
        if (keys.some(key => ownKeys.includes(key)) || seen.has(item.id)) return false;
        seen.add(item.id); return true;
      });
      setTrail(appendPaperTrail(base, { work: resolved, relation, response: { ...response, items } }));
    } catch (error) { if (valid()) setNotice(error instanceof Error ? error.message : say("관련 논문을 가져오지 못했습니다. 다시 눌러 재시도하세요.", "Related papers could not be loaded. Choose a relation to retry.")); }
    finally { if (valid()) setLoading(false); }
  }

  function returnTo(index: number) {
    explorationRequest.current?.abort(); explorationRequest.current = null; setLoading(false); setNotice("");
    setTrail(previous => previous.slice(0, index + 1));
  }

  function savedPaperId(work: ScholarlyWork) {
    const keys = discoveryKeys(work);
    const matches = [...new Set(savedIndex.filter(item => item.keys.some(key => keys.includes(key))).map(item => item.paper_id))];
    return matches.length === 1 ? matches[0] : "";
  }

  async function save(work: ScholarlyWork) {
    if (!canEdit || getWorkspaceRole() === "viewer" || writeLock.current || savedPaperId(work)) return;
    writeLock.current = true;
    const scope = generation.current;
    const controller = new AbortController(); saveRequest.current = controller; setSavingId(work.id); setNotice("");
    try {
      const response = await labviumRequest<SaveResponse>("/papers/from-discovery", { method: "POST", body: { work }, signal: controller.signal });
      if (!alive.current || generation.current !== scope || controller.signal.aborted) return;
      setSavedIndex(previous => [...previous.filter(item => item.paper_id !== response.paper_id), { paper_id: response.paper_id, keys: response.keys }]);
      setNotice(say("논문 보관함에 저장 완료 ✔ 원문 읽기와 프로젝트 연결은 저장한 논문에서 이어가세요.", "Saved to your paper library ✔ Open the saved paper to read it or link it to a project."));
    } catch (error) { if (alive.current && generation.current === scope && !controller.signal.aborted) setNotice(error instanceof Error ? error.message : say("저장하지 못했습니다. 다시 시도하세요.", "The paper could not be saved. Try again.")); }
    finally { writeLock.current = false; if (alive.current && generation.current === scope) setSavingId(""); }
  }

  async function addToProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paper || !projectId || projectWriteLock.current || projectLoading || !canEdit || getWorkspaceRole() === "viewer" || linkedProjects.includes(projectId)) return;
    projectWriteLock.current = true;
    const scope = generation.current;
    const targetId = projectId;
    setProjectLoading(true); setProjectNotice("");
    try {
      const project = await apiClient.getCompleteProject(targetId);
      if (!alive.current || generation.current !== scope || getWorkspaceRole() === "viewer") return;
      if (project.status === "archived") throw new Error(say("보관된 프로젝트에는 연결할 수 없습니다.", "Archived projects cannot receive a paper link."));
      if (project.links.some(link => link.target_type === "paper" && link.paper_id === paperId)) {
        setLinkedProjects(previous => [...new Set([...previous, targetId])]);
        setProjectNotice(say("이미 이 프로젝트에 연결된 논문입니다 ✔", "This paper is already linked to this project ✔")); return;
      }
      await apiClient.addProjectPaperLink(targetId, paperId, linkType, project.links_revision);
      if (!alive.current || generation.current !== scope) return;
      setLinkedProjects(previous => [...new Set([...previous, targetId])]);
      setProjectNotice(say(`‘${project.name}’에 연결 완료 ✔ 논문과 읽기 기록은 보관함에서도 계속 볼 수 있습니다.`, `Linked to “${project.name}” ✔ The paper and reading notes remain available in your library.`));
    } catch (error) { if (alive.current && generation.current === scope) setProjectNotice(error instanceof Error ? error.message : say("프로젝트에 연결하지 못했습니다. 선택한 프로젝트를 확인하고 다시 눌러주세요.", "The project link could not be saved. Check the project and try again.")); }
    finally { projectWriteLock.current = false; if (alive.current && generation.current === scope) setProjectLoading(false); }
  }

  const relationLabel = (relation: ExplorationRelation) => relation === "references" ? say("이 논문의 참고문헌", "References in this paper") : relation === "cited_by" ? say("이 논문을 인용한 후속 연구", "Later work citing this paper") : say("제목·주제가 비슷한 논문", "Papers with similar titles or topics");
  return <div className="paper-next-steps">
    <Section title={say("다음 읽을 논문 탐색", "Choose your next paper")} description={say("논문을 따라가며 읽을 거리를 넓히고, 필요한 자료만 보관함과 프로젝트에 모으세요.", "Follow papers to expand your reading, then save the sources useful to your research.")}>
      {loadError ? <p role="status">{loadError}</p> : !paper ? <p className="muted-text" role="status">{say("논문 정보 불러오는 중…", "Loading paper details…")}</p> : <>
        <div className="paper-next-steps__entry"><BookOpen size={16} /><span>{paper.status === "read" || paper.status === "finished" ? say("읽기 완료 · 다음 논문으로 이어가세요", "Finished reading · continue with another paper") : say("읽는 중에도 관련 논문을 미리 살펴볼 수 있어요", "Explore connected papers at any point in your reading")}</span></div>
        <div className="paper-next-steps__controls">
          <button type="button" className="reader-control reader-control--secondary" disabled={loading || !source || (!openAlexWorkId(source) && !source.doi)} onClick={() => source && void explore(source, "references", [])}><Network size={14} />{say("참고문헌부터", "Start with references")}</button>
          <button type="button" className="reader-control reader-control--secondary" disabled={loading || !source || (!openAlexWorkId(source) && !source.doi)} onClick={() => source && void explore(source, "cited_by", [])}>{say("후속 연구부터", "Start with citing works")}</button>
          <button type="button" className="reader-control reader-control--secondary" disabled={loading || !source} onClick={() => source && void explore(source, "similar", [])}>{say("비슷한 주제", "Similar topics")}</button>
        </div>
        {source && !openAlexWorkId(source) && !source.doi ? <p className="muted-text">{say("이 논문에는 확인된 인용 식별자가 없어 주제 검색으로 탐색합니다.", "No verified citation identifier is recorded for this paper; topic search is available.")}</p> : null}
      </>}
      {notice ? <p role="status" className="paper-next-steps__notice">{notice}</p> : null}
      {loading ? <p role="status" className="muted-text">{say("관련 논문을 찾는 중…", "Finding connected papers…")}</p> : null}
      {current ? <div className="paper-next-steps__exploration" aria-busy={loading}>
        <nav className="paper-next-steps__trail" aria-label={say("논문 탐색 경로", "Paper exploration trail")}>
          {trail.map((step, index) => <span key={`${step.work.id}:${step.relation}:${index}`}>{index ? <ArrowRight size={13} aria-hidden="true" /> : null}<button type="button" aria-current={index === trail.length - 1 ? "step" : undefined} className="text-link" onClick={() => returnTo(index)} title={step.work.title}>{step.work.title}</button></span>)}
        </nav>
        {trail.length > 1 ? <button type="button" className="text-link" onClick={() => returnTo(trail.length - 2)}><ArrowLeft size={14} />{say("이전 논문으로", "Previous paper")}</button> : null}
        <h3>{relationLabel(current.relation)}</h3>
        <p className="muted-text">{current.relation === "similar" ? say("검색 제공처가 반환한 제목·주제 관련 후보입니다. 두 논문 사이의 인용 관계나 연구 내용의 일치를 뜻하지 않습니다.", "These are title or topic search candidates from scholarly sources. A citation edge or agreement between the papers is not established.") : say("OpenAlex에 기록된 실제 인용 연결입니다. 수록 범위에 따라 일부 논문이 빠질 수 있습니다.", "These are citation connections recorded by OpenAlex. Coverage may omit some papers.")}</p>
        {current.response.warnings?.length ? <p role="status" className="muted-text">{say("일부 제공처 정보가 없어 현재 가져올 수 있는 결과를 표시합니다.", "Some source information is unavailable; available results are shown.")}</p> : null}
        {!current.response.items.length ? <p>{say("현재 표시할 관련 논문이 없습니다. 다른 연결 방식이나 주제 검색을 선택하세요.", "No connected papers were returned. Choose another relation or a topic search.")}</p> : <ol className="paper-next-steps__results">{current.response.items.map(work => {
          const savedId = savedPaperId(work);
          const url = safeResearchUrl(work.url);
          return <li key={work.id} className="paper-next-steps__result">
            <h4>{url ? <a href={url} target="_blank" rel="noreferrer">{work.title} <ExternalLink size={13} /></a> : work.title}</h4>
            <p>{[work.authors?.slice(0, 3).join(", "), work.year, work.journal].filter(Boolean).join(" · ")}</p>
            <div className="paper-next-steps__controls"><button type="button" className={`reader-control reader-control--secondary${savedId ? " paper-next-steps__saved" : ""}`} disabled={!canEdit || Boolean(savingId) || Boolean(savedId)} onClick={() => void save(work)}>{savedId ? <Check size={14} /> : <Plus size={14} />}{savedId ? say("저장 완료 ✔", "Saved ✔") : savingId === work.id ? say("저장 중…", "Saving…") : say("논문 보관함에 저장", "Save to paper library")}</button>{savedId ? <Link className="text-link" href={`/papers/${encodeURIComponent(savedId)}`}>{say("저장한 논문 열기", "Open saved paper")} <ArrowRight size={14} /></Link> : null}<button type="button" className="text-link" disabled={loading} onClick={() => void explore(work, openAlexWorkId(work) || work.doi ? "references" : "similar")}><Network size={14} />{say("이 논문에서 계속 탐색", "Keep exploring from this paper")}</button>{openAlexWorkId(work) || work.doi ? <button type="button" className="text-link" disabled={loading} onClick={() => void explore(work, "cited_by")}>{say("후속 연구", "Citing works")}</button> : null}</div>
          </li>;
        })}</ol>}
      </div> : null}
    </Section>
    {paper ? <Section title={say("이 논문을 연구 프로젝트에 연결", "Link this paper to a research project")} description={say("논문 보관함의 원본과 읽기 기록을 유지하면서, 선택한 프로젝트에서 같은 논문을 함께 봅니다.", "Keep the paper and reading notes in your library while making the same paper available in a chosen project.")}>
      <form className="paper-next-steps__project-form" onSubmit={event => void addToProject(event)}>
        <label className="reader-field" htmlFor={selectId}><span>{say("프로젝트 선택", "Choose a project")}</span><select id={selectId} value={projectId} disabled={!canEdit || projectLoading} onChange={event => { setProjectId(event.target.value); setProjectNotice(""); }}><option value="">{say("연결할 프로젝트를 선택하세요", "Select a destination project")}</option>{projects.map(project => <option key={project.project_id} value={project.project_id}>{project.name}{linkedProjects.includes(project.project_id) ? say(" · 연결됨 ✔", " · Linked ✔") : ""}</option>)}</select></label>
        <label className="reader-field"><span>{say("논문의 역할", "Paper’s role")}</span><select value={linkType} disabled={!canEdit || projectLoading} onChange={event => setLinkType(event.target.value as ProjectLinkType)}><option value="related">{say("관련 자료", "Related work")}</option><option value="background">{say("배경 지식", "Background")}</option><option value="key_reference">{say("핵심 참고문헌", "Key reference")}</option><option value="supports_project">{say("연구 근거", "Supports the project")}</option><option value="raises_question">{say("검토할 의문", "Raises a question")}</option></select></label>
        <button className="reader-control reader-control--secondary" type="submit" disabled={!canEdit || !projectId || projectLoading || linkedProjects.includes(projectId)}>{linkedProjects.includes(projectId) ? <Check size={14} /> : <Plus size={14} />}{projectLoading ? say("연결 중…", "Linking…") : linkedProjects.includes(projectId) ? say("연결 완료 ✔", "Linked ✔") : say("프로젝트에 연결", "Link to project")}</button>
        {projectId ? <Link className="text-link" href={`/projects/${encodeURIComponent(projectId)}`}>{say("프로젝트 열기", "Open project")} <ArrowRight size={14} /></Link> : null}
      </form>
      {!projects.length && !projectNotice ? <p className="muted-text">{say("프로젝트를 먼저 만들면 논문과 읽기 기록을 모아 연구를 이어갈 수 있습니다.", "Create a project to gather your papers and continue your research.")} <Link className="text-link" href="/projects">{say("프로젝트 만들기", "Create a project")}</Link></p> : null}
      {projectNotice ? <p role="status">{projectNotice}</p> : null}
      {!canEdit ? <p className="muted-text">{say("이 공간에서는 읽기만 가능합니다. 논문 저장·프로젝트 연결은 편집 권한이 필요합니다.", "This workspace grants read-only access. Saving and linking require editing permission.")}</p> : null}
    </Section> : null}
  </div>;
}
