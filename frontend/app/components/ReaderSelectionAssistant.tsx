"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getWorkspaceMode, initializeWorkspaceTransport, labviumRequest } from "../lib/api/client";
import type { AiEvidencePreview } from "../lib/ai/sources.mjs";
import type { PdfPageSelection } from "../lib/pdf/selection-coordinates.mjs";
import { useI18n } from "../lib/i18n/LocaleProvider";
import "./ReaderAnnotations.css";

type Answer = { answer: string; claims: Array<{ text: string; citations: Array<{ source_id: string; quote: string; title: string; page: number | null }> }>; limitations: string[]; open_questions: string[] };
export interface ReaderAiRequest { token: number; action: "explain" | "summary"; selection: PdfPageSelection | null; }

export function ReaderSelectionAssistant({ paperId, request, onClose, onUseDraft }: {
  paperId: string; request: ReaderAiRequest | null; onClose: () => void; onUseDraft: (text: string) => void;
}) {
  const { locale } = useI18n();
  const tr = (ko: string, en: string) => locale === "ko" ? ko : en;
  const [configured, setConfigured] = useState(false);
  const [preview, setPreview] = useState<AiEvidencePreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [question, setQuestion] = useState(() => request?.action === "explain"
    ? tr(`다음 원문 구간의 개념과 논리를 단계별로 설명하고, 가정과 수식의 의미를 구분해줘. 원문에서 확인할 수 없는 내용은 명시해줘.\n\n${request.selection?.text ?? ""}`, `Explain the concepts and reasoning in this excerpt step by step, separating assumptions and equations. State what the source does not establish.\n\n${request.selection?.text ?? ""}`).slice(0, 4000)
    : tr("이 논문의 연구 질문, 방법, 핵심 결과와 한계를 원문 근거와 함께 요약해줘.", "Summarize the paper’s research question, methods, main findings and limitations with original source evidence."));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const panelRef = useRef<HTMLElement | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const invalidate = useCallback(() => { controller.current?.abort(); generation.current++; }, []);
  useEffect(() => {
    let active = true;
    initializeWorkspaceTransport().then((session) => { if (active) setConfigured(getWorkspaceMode() === "cloud" && session.ai?.configured === true); }).catch(() => { if (active) setConfigured(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    invalidate(); controller.current = new AbortController();
    if (!request) return invalidate;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return invalidate;
  // The immutable request snapshots the selection before focus changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.token, paperId, invalidate]);

  function close() { controller.current?.abort(); generation.current++; onClose(); previousFocus.current?.focus(); }
  async function prepare() {
    if (busy || !question.trim()) return;
    const current = ++generation.current; setBusy(true); setMessage(""); setAnswer(null);
    try {
      const params = new URLSearchParams({ paper_ids: paperId, q: question.slice(0, 4000) });
      const value = await labviumRequest<AiEvidencePreview>(`/ai/sources?${params}`, { signal: controller.current?.signal });
      if (current !== generation.current) return;
      setPreview(value);
      const preferred = request?.selection ? value.sources.filter((source) => source.page === request.selection?.pageNumber) : value.sources;
      setSelected((preferred.length ? preferred : value.sources).slice(0, 8).map((source) => source.id));
      if (!value.sources.length) setMessage(tr("사용할 원문 근거가 없습니다. PDF 전문을 추출하거나 선택 구간을 근거로 저장한 뒤 다시 시도해주세요.", "No source evidence is available. Extract full text or save the excerpt as cited evidence, then retry."));
    } catch (error) { if (current === generation.current) setMessage(error instanceof Error ? error.message : tr("원문 근거를 불러오지 못했습니다.", "Evidence could not be loaded.")); }
    finally { if (current === generation.current) setBusy(false); }
  }
  async function generate() {
    if (!configured || busy || !preview || !selected.length || selected.length > 30) return;
    const current = ++generation.current; setBusy(true); setMessage("");
    try {
      const value = await labviumRequest<Answer>("/ai/answer", { method: "POST", signal: controller.current?.signal, body: { paper_ids: [paperId], question: question.slice(0, 4000), locale, task: request?.action === "summary" ? "summary" : "question", source_ids: selected, sources_revision: preview.revision } });
      if (current === generation.current) setAnswer(value);
    } catch (error) { if (current === generation.current) setMessage(error instanceof Error ? error.message : tr("AI 초안을 생성하지 못했습니다.", "AI draft generation failed.")); }
    finally { if (current === generation.current) setBusy(false); }
  }
  if (!request) return null;
  return <aside ref={panelRef} tabIndex={-1} className="reader-selection-assistant" role="region" aria-label={tr("원문과 함께 보는 AI 도우미", "AI assistant beside the source")} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
    <header className="reader-floating-memo__header"><strong>{tr(request.action === "summary" ? "논문 요약" : "선택 구간 설명", request.action === "summary" ? "Paper summary" : "Explain selected excerpt")}</strong><button className="reader-research-panel__collapse" aria-label={tr("AI 도우미 닫기", "Close AI assistant")} type="button" onClick={close}><X size={16} /></button></header>
    <div className="reader-selection-assistant__content">
      {request.selection ? <details open><summary>{tr(`선택 원문 · ${request.selection.pageNumber}쪽`, `Selected source · p. ${request.selection.pageNumber}`)}</summary><blockquote>{request.selection.text}</blockquote></details> : null}
      {!configured ? <div><strong>{tr("AI가 아직 연결되어 있지 않습니다", "AI is not connected yet")}</strong><p>{tr("API 키가 연결되면 이 논문과 선택 구간을 설명·요약할 수 있습니다. 지금은 원문 근거를 확인하고 메모를 작성할 수 있습니다.", "Once a model API is configured, explain or summarize this paper and its selected excerpt. Source review and notes are available now.")}</p><Link href="/settings" className="text-link">{tr("설정에서 연결 상태 보기", "View connection status in Settings")}</Link></div> : null}
      <label className="reader-field"><span>{tr("이 원문에 대한 질문", "Question about this source")}</span><textarea rows={4} maxLength={4000} value={question} disabled={busy} onChange={(event) => { setQuestion(event.target.value); setPreview(null); setAnswer(null); }} /></label>
      <button className="reader-control reader-control--secondary" type="button" disabled={busy || !question.trim()} onClick={() => void prepare()}>{tr(busy ? "처리 중…" : "설명에 사용할 원문 확인", busy ? "Working…" : "Review source excerpts")}</button>
      {preview ? <div><p className="muted-text">{tr("AI에게 보낼 구간을 직접 선택하세요. 표시한 일부 구간만을 근거로 사용합니다.", "Choose the excerpts to send to AI. Only selected excerpts will be used.")}</p>{preview.sources.map((source) => <details key={source.id}><summary><label><input type="checkbox" checked={selected.includes(source.id)} disabled={busy} onChange={(event) => setSelected((current) => event.target.checked ? [...current, source.id] : current.filter((id) => id !== source.id))} />{source.title}{source.page ? ` · p. ${source.page}` : ""}</label></summary><blockquote>{source.text}</blockquote></details>)}<button className="reader-control" type="button" disabled={!configured || busy || !selected.length || selected.length > 30} onClick={() => void generate()}>{tr("선택한 근거를 전송하고 AI 초안 받기", "Send selected excerpts and generate AI draft")}</button></div> : null}
      {message ? <p role="status">{message}</p> : null}
      {answer ? <div><strong>{tr("AI 초안 · 원문 검토 필요", "AI draft · verify against the source")}</strong><p>{answer.answer}</p>{answer.claims.map((claim, index) => <article key={index}><p>{claim.text}</p>{claim.citations.map((citation) => <blockquote key={`${citation.source_id}:${citation.quote}`}>{citation.quote}<small> — {citation.title}{citation.page ? ` · p. ${citation.page}` : ""}</small></blockquote>)}</article>)}{answer.limitations.map((item, index) => <p className="muted-text" key={index}>{item}</p>)}<button className="reader-control reader-control--secondary" type="button" onClick={() => onUseDraft(`[${tr("AI 초안 · 검증 전", "AI draft · unverified")}]\n${answer.answer}\n\n${answer.claims.map((claim) => `${claim.text}\n${claim.citations.map((citation) => `“${citation.quote}” — ${citation.title}${citation.page ? `, p. ${citation.page}` : ""}`).join("\n")}`).join("\n\n")}`)}>{tr("연구 노트 임시 내용에 추가", "Append to Paper Note draft")}</button></div> : null}
    </div>
  </aside>;
}
