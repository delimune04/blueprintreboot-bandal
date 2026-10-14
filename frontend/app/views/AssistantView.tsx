"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { apiClient, initializeWorkspaceTransport, getWorkspaceMode, labviumRequest } from "../lib/api/client";
import type { PaperListItem, ProjectListItem } from "../lib/api/types";
import { useI18n } from "../lib/i18n/LocaleProvider";
import { blankResearchPage, newResearchBlock } from "../lib/workspace/pages.mjs";

type Citation = { source_id: string; paper_id: string; title: string; page: number | null; block_id?: string; kind: string; quote: string };
type Answer = { answer: string; claims: Array<{ text: string; citations: Citation[] }>; open_questions: string[]; limitations: string[]; provider: string; model: string; generated_at: string };

export function AssistantView() {
  const { locale } = useI18n();
  const tr = (ko: string, en: string) => locale === "ko" ? ko : en;
  const [papers, setPapers] = useState<PaperListItem[]>([]);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [paperId, setPaperId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [question, setQuestion] = useState("");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [notice, setNotice] = useState("");
  const token = useRef(0);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    let cancelled = false;
    Promise.all([apiClient.getAllPapers({ archiveStatus: "active" }), apiClient.getAllProjects(), initializeWorkspaceTransport()])
      .then(([paperRows, projectRows, session]) => {
        if (cancelled) return;
        setPapers(paperRows); setProjects(projectRows);
        setConfigured(getWorkspaceMode() === "cloud" && session.ai?.configured === true);
      }).catch((error) => { if (!cancelled) setNotice(error instanceof Error ? error.message : "Workspace unavailable"); });
    return () => { cancelled = true; controller.abort(); };
  }, []);
  async function ask() {
    if (!configured || busy || !question.trim() || (!paperId && !projectId)) return;
    const current = ++token.current;
    setBusy(true); setNotice(""); setAnswer(null);
    try {
      const value = await labviumRequest<Answer>("/ai/answer", { method: "POST", signal: lifetime.current?.signal, body: {
        question, locale, ...(projectId ? { project_id: projectId } : { paper_ids: [paperId] }),
      } });
      if (current === token.current && !lifetime.current?.signal.aborted) setAnswer(value);
    } catch (error) { if (current === token.current && !lifetime.current?.signal.aborted) setNotice(error instanceof Error ? error.message : tr("답변을 만들지 못했습니다.", "The answer could not be generated.")); }
    finally { if (current === token.current && !lifetime.current?.signal.aborted) setBusy(false); }
  }
  async function save() {
    if (!answer || saving) return;
    setSaving(true); setNotice("");
    try {
      const blocks = answer.claims.map((claim) => ({ ...newResearchBlock("paragraph"),
        text: `${claim.text}\n\n${claim.citations.map((citation) => `“${citation.quote}” — ${citation.title}${citation.page ? `, p. ${citation.page}` : ""}`).join("\n")}`,
        provenance: "ai", source_links: claim.citations.map((citation) => ({ paper_id: citation.paper_id, url: "", label: `${citation.title}${citation.page ? ` · p. ${citation.page}` : ""}` })),
      }));
      const page = { ...blankResearchPage(), title: question.slice(0, 200), project_id: projectId, blocks,
        handoff: { verified_facts: "", open_questions: answer.open_questions.join("\n"), next_steps: "", owner: "" } };
      await labviumRequest("/research/pages", { method: "POST", body: { page } });
      setNotice(tr("AI 초안을 연구 노트에 저장했습니다. 확인된 사실로 표시하기 전에 원문을 검토해주세요.", "AI draft saved to research notes. Review the original sources before recording verified facts."));
    } catch (error) { setNotice(error instanceof Error ? error.message : tr("저장하지 못했습니다.", "The draft could not be saved.")); }
    finally { setSaving(false); }
  }
  return <div className="page-stack">
    <PageHeader title={tr("근거를 확인하는 연구 도우미", "A research assistant with traceable evidence")} description={tr("논문의 주장과 근거를 확인하고, 프로젝트의 남은 질문을 정리합니다.", "Check claims against their sources and identify unanswered project questions.")} />
    {!configured ? <Section title={tr("생성형 AI 연결이 필요합니다", "Generative AI is not connected")}>
      <p>{tr("현재 이 작업 공간에는 모델 API가 연결되어 있지 않습니다. 요약이나 답변을 생성했다고 표시하지 않습니다. 논문 읽기, 근거 수집, 검색과 인수인계 정리는 계속 사용할 수 있습니다.", "No model API is connected to this workspace. No summaries or answers have been generated. Paper reading, evidence capture, search, and handoff organization remain available.")}</p>
      <div className="lab-result-actions"><Link className="reader-control" href="/workspace">{tr("연구 노트 정리하기", "Organize research notes")}</Link><Link className="reader-control reader-control--secondary" href="/discover">{tr("관련 논문 찾기", "Discover related papers")}</Link></div>
    </Section> : null}
    <Section title={tr("질문과 자료 선택", "Choose a question and sources")}>
      <label className="reader-field"><span>{tr("프로젝트", "Project")}</span><select value={projectId} onChange={(event) => { setProjectId(event.target.value); setAnswer(null); }} disabled={busy}><option value="">{tr("논문 한 편 선택", "Choose one paper")}</option>{projects.filter((project) => project.status !== "archived").map((project) => <option key={project.project_id} value={project.project_id}>{project.name}</option>)}</select></label>
      {!projectId ? <label className="reader-field"><span>{tr("논문", "Paper")}</span><select value={paperId} onChange={(event) => { setPaperId(event.target.value); setAnswer(null); }} disabled={busy}><option value="">{tr("자료 선택", "Choose a source")}</option>{papers.map((paper) => <option key={paper.paper_id} value={paper.paper_id}>{paper.title}</option>)}</select></label> : null}
      <label className="reader-field"><span>{tr("연구 질문", "Research question")}</span><textarea value={question} maxLength={4000} rows={4} onChange={(event) => setQuestion(event.target.value)} placeholder={tr("어떤 근거가 결론을 뒷받침하며, 아직 확인하지 못한 것은 무엇인가?", "Which evidence supports the conclusion, and what remains unverified?")} disabled={busy} /></label>
      <div className="lab-result-actions"><button className="reader-control" disabled={!configured || busy || !question.trim() || (!paperId && !projectId)} onClick={() => void ask()}>{tr(busy ? "근거 확인 중…" : "근거가 있는 답변 만들기", busy ? "Checking evidence…" : "Generate a cited answer")}</button><button className="reader-control reader-control--secondary" disabled={busy} onClick={() => setQuestion(tr("연구 질문, 방법, 핵심 결과와 한계를 정리하고 각 주장에 원문 근거를 붙여줘.", "Summarize the research question, methods, findings and limitations with source evidence for every claim."))}>{tr("논문 정리 질문 사용", "Use a paper-summary question")}</button></div>
      <p className="muted-text">{tr("선택한 자료의 추출 본문과 근거 블록을 사용합니다. 결과는 검토 전 초안이며 자동으로 저장하지 않습니다.", "Uses extracted text and evidence blocks from your selected sources. Results are drafts and are not saved automatically.")}</p>
    </Section>
    {notice ? <p role="status" className="reader-editor__status">{notice}</p> : null}
    {answer ? <Section title={tr("검토할 초안", "Draft for review")}>
      <p>{answer.answer}</p>
      {answer.claims.map((claim, index) => <article key={index} className="lab-discovery-row"><p>{claim.text}</p>{claim.citations.map((citation) => <blockquote key={`${citation.source_id}-${citation.quote}`}><p>{citation.quote}</p><Link href={`/papers/${encodeURIComponent(citation.paper_id)}/reader?${new URLSearchParams(citation.block_id ? { block: citation.block_id } : citation.page ? { page: String(citation.page) } : {})}`}>{citation.title}{citation.page ? ` · p. ${citation.page}` : ""}</Link><small> · {citation.kind}</small></blockquote>)}</article>)}
      {answer.open_questions.length ? <><h3>{tr("남은 질문", "Open questions")}</h3><ul>{answer.open_questions.map((item, index) => <li key={index}>{item}</li>)}</ul></> : null}
      {answer.limitations.length ? <><h3>{tr("답변의 한계", "Coverage limits")}</h3><ul>{answer.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></> : null}
      <p className="muted-text">{answer.provider} · {answer.model} · {new Date(answer.generated_at).toLocaleString(locale === "ko" ? "ko-KR" : "en-US")}</p>
      <button className="reader-control" onClick={() => void save()} disabled={saving}>{tr(saving ? "저장 중…" : "초안을 연구 노트에 저장", saving ? "Saving…" : "Save draft to research notes")}</button>
    </Section> : null}
  </div>;
}
