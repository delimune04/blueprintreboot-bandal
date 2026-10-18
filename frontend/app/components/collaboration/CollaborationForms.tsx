"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { addCalendarDays, defaultTaskDueDate, todayInSeoul } from "../../lib/collaboration/calendar.mjs";
import type { EventDraft, IdeaDraft, Member, ProjectOption, TaskDraft, Idea } from "./types";

export const dateLabel = (value: string) => value ? value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1.$2.$3") : "";
export const memberName = (member?: Member) => member?.name || member?.email || "구성원";
export const newEvent = (): EventDraft => ({ title: "", description: "", start_date: todayInSeoul(), end_date: todayInSeoul(), all_day: true, start_time: "09:00", end_time: "10:00", participant_ids: [], project_id: "" });
export const newIdea = (): IdeaDraft => ({ title: "", body: "이 아이디어 어때요?", recipient_ids: [], source: { type: "none", id: "", title: "", excerpt: "" } });
export const newTask = (actorId: string): TaskDraft => ({ title: "", description: "", assignee_id: actorId, due_date: defaultTaskDueDate(), priority: "normal", project_id: "", source_idea_id: "" });

export function validDraftShape(value: unknown, expected: unknown): boolean {
  if (typeof expected === "string") return typeof value === "string" && value.length <= 200000;
  if (typeof expected === "boolean") return typeof value === "boolean";
  if (Array.isArray(expected)) return Array.isArray(value) && value.length <= 1000 && value.every(item => typeof item === "string" && item.length <= 1000);
  if (expected && typeof expected === "object") return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.entries(expected).every(([key, item]) => validDraftShape((value as Record<string, unknown>)[key], item)));
  return typeof value === typeof expected;
}

/** Scope is an authenticated workspace/actor identity, never a global shared draft. */
export function useCollaborationDraft<T>(scope: string, name: string, initial: () => T) {
  const key = `labvium.collaboration.draft:${scope}:${name}`;
  const [restored] = useState<{ value: T; rejectedRaw: string | null }>(() => {
    const fallback = initial();
    let raw: string | null = null;
    try { raw = typeof window !== "undefined" ? window.sessionStorage.getItem(key) : null; if (!raw) return { value: fallback, rejectedRaw: null }; const parsed = JSON.parse(raw) as unknown; return validDraftShape(parsed, fallback) ? { value: parsed as T, rejectedRaw: null } : { value: fallback, rejectedRaw: raw }; } catch { return { value: fallback, rejectedRaw: raw }; }
  });
  const rejectedRaw = useRef(restored.rejectedRaw);
  const edited = useRef(false);
  const [value, setValue] = useState<T>(restored.value);
  useEffect(() => {
    if (rejectedRaw.current !== null && !edited.current) return;
    try {
      if (rejectedRaw.current !== null) { const recoveryKey = `${key}:unreadable:${Date.now()}`; window.sessionStorage.setItem(recoveryKey, rejectedRaw.current); rejectedRaw.current = null; }
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch { /* Keeping the visible draft does not require browser storage. */ }
  }, [key, value]);
  const change: Dispatch<SetStateAction<T>> = useCallback(next => { edited.current = true; setValue(next); }, []);
  return [value, change] as const;
}

export function RecipientPicker({ members, selected, onChange, disabled = false, label = "받는 사람" }: { members: Member[]; selected: string[]; onChange: (value: string[]) => void; disabled?: boolean; label?: string }) {
  const accepted = members.filter(member => member.accepted);
  return <fieldset className="collab-recipients" disabled={disabled}><legend>{label}</legend>
    <label className="collab-check"><input type="checkbox" checked={!selected.length} onChange={() => onChange([])} />연구실 전체</label>
    {accepted.map(member => <label key={member.id} className={`collab-check ${selected.includes(member.id) ? "is-selected" : ""}`}><input type="checkbox" checked={selected.includes(member.id)} onChange={event => onChange(event.target.checked ? [...selected, member.id] : selected.filter(id => id !== member.id))} />{memberName(member)}{member.role === "owner" ? <span className="muted-text">관리자</span> : null}</label>)}
    <p className="collab-hint">선택한 사람에게 알림을 보냅니다. 내용은 이 연구 공간의 구성원이 함께 볼 수 있습니다.</p>
  </fieldset>;
}

function ProjectField({ value, onChange, projects }: { value: string; onChange: (value: string) => void; projects: ProjectOption[] }) {
  return <label className="reader-field"><span>연결 프로젝트</span><select value={value} onChange={event => onChange(event.target.value)}><option value="">연결하지 않음</option>{value && !projects.some(project => project.project_id === value) ? <option value={value}>기존 연결 프로젝트</option> : null}{projects.map(project => <option key={project.project_id} value={project.project_id}>{project.name}</option>)}</select></label>;
}

export function EventForm({ draft, change, members, projects, busy, onSave, onCancel, editing }: { draft: EventDraft; change: (draft: EventDraft) => void; members: Member[]; projects: ProjectOption[]; busy: boolean; onSave: () => void; onCancel: () => void; editing: boolean }) {
  const update = (patch: Partial<EventDraft>) => change({ ...draft, ...patch });
  return <form className="collab-form" onSubmit={event => { event.preventDefault(); onSave(); }}><fieldset disabled={busy}>
    <div className="collab-form-title"><h3>{editing ? "일정 편집" : "새 공유 일정"}</h3><span>한국 시간 · Asia/Seoul</span></div>
    <label className="reader-field"><span>일정 제목</span><input required maxLength={200} value={draft.title} onChange={event => update({ title: event.target.value })} placeholder="예: CCS 주간 연구 미팅" /></label>
    <div className="collab-form-grid"><label className="reader-field"><span>시작 날짜</span><input required type="date" value={draft.start_date} onChange={event => update({ start_date: event.target.value, ...(draft.end_date < event.target.value ? { end_date: event.target.value } : {}) })} /></label><label className="reader-field"><span>마지막 날짜</span><input required type="date" min={draft.start_date} value={draft.end_date} onChange={event => update({ end_date: event.target.value })} /></label></div>
    <label className="collab-check"><input type="checkbox" checked={draft.all_day} onChange={event => update({ all_day: event.target.checked })} />종일 일정</label>
    {!draft.all_day ? <div className="collab-form-grid"><label className="reader-field"><span>시작 시간</span><input required type="time" value={draft.start_time} onChange={event => update({ start_time: event.target.value })} /></label><label className="reader-field"><span>종료 시간</span><input required type="time" min={draft.start_date === draft.end_date ? draft.start_time : undefined} value={draft.end_time} onChange={event => update({ end_time: event.target.value })} /></label></div> : null}
    <label className="reader-field"><span>장소·내용</span><textarea rows={3} maxLength={10000} value={draft.description} onChange={event => update({ description: event.target.value })} /></label>
    <ProjectField projects={projects} value={draft.project_id} onChange={project_id => update({ project_id })} />
    <RecipientPicker label="참석자" members={members} selected={draft.participant_ids} onChange={participant_ids => update({ participant_ids })} />
    <div className="collab-actions"><button className="reader-control" disabled={busy || !draft.title.trim()}>{busy ? "저장 중…" : editing ? "변경 저장" : "일정 등록"}</button><button type="button" className="reader-control reader-control--secondary" onClick={onCancel}>닫기 · 초안 유지</button></div>
  </fieldset></form>;
}

export function IdeaForm({ draft, change, members, busy, onSave, onCancel }: { draft: IdeaDraft; change: (draft: IdeaDraft) => void; members: Member[]; busy: boolean; onSave: () => void; onCancel: () => void }) {
  return <form className="collab-form" onSubmit={event => { event.preventDefault(); onSave(); }}><fieldset disabled={busy}><h3>이 아이디어 어때요?</h3>
    <label className="reader-field"><span>제목</span><input required maxLength={200} value={draft.title} onChange={event => change({ ...draft, title: event.target.value })} placeholder="함께 검토할 아이디어를 짧게 적어주세요" /></label>
    <label className="reader-field"><span>아이디어·질문</span><textarea required rows={5} maxLength={20000} value={draft.body} onChange={event => change({ ...draft, body: event.target.value })} /></label>
    {draft.source.type !== "none" ? <div className="collab-source"><strong>{draft.source.title}</strong>{draft.source.excerpt ? <p>{draft.source.excerpt}</p> : null}</div> : <p className="collab-hint">논문·연구 페이지·프로젝트의 ‘이 아이디어 어때요?’ 버튼으로 원문을 연결해 바로 물어볼 수도 있습니다.</p>}
    <RecipientPicker members={members} selected={draft.recipient_ids} onChange={recipient_ids => change({ ...draft, recipient_ids })} />
    <div className="collab-actions"><button className="reader-control" disabled={busy || !draft.title.trim() || !draft.body.trim()}>{busy ? "공유 중…" : "아이디어 공유"}</button><button type="button" className="reader-control reader-control--secondary" onClick={onCancel}>닫기 · 초안 유지</button></div>
  </fieldset></form>;
}

export function TaskForm({ draft, change, members, projects, ideas, busy, onSave, onCancel, editing }: { draft: TaskDraft; change: (draft: TaskDraft) => void; members: Member[]; projects: ProjectOption[]; ideas: Idea[]; busy: boolean; onSave: () => void; onCancel: () => void; editing: boolean }) {
  const update = (patch: Partial<TaskDraft>) => change({ ...draft, ...patch });
  const selectable = members.filter(member => member.accepted && member.role !== "viewer");
  return <form className="collab-form" onSubmit={event => { event.preventDefault(); onSave(); }}><fieldset disabled={busy}><h3>{editing ? "업무 편집" : "새 업무 배정"}</h3>
    <label className="reader-field"><span>할 일</span><input required maxLength={200} value={draft.title} onChange={event => update({ title: event.target.value })} placeholder="예: CCS 후보지 3곳의 공극률 자료 비교" /></label>
    <label className="reader-field"><span>요청 내용·완료 기준</span><textarea rows={4} maxLength={20000} value={draft.description} onChange={event => update({ description: event.target.value })} /></label>
    <div className="collab-form-grid"><label className="reader-field"><span>담당자</span><select required value={draft.assignee_id} onChange={event => update({ assignee_id: event.target.value })}><option value="">담당자 선택</option>{draft.assignee_id && !selectable.some(member => member.id === draft.assignee_id) ? <option value={draft.assignee_id} disabled>참여하지 않은 이전 담당자</option> : null}{selectable.map(member => <option key={member.id} value={member.id}>{memberName(member)}</option>)}</select></label><label className="reader-field"><span>우선순위</span><select value={draft.priority} onChange={event => update({ priority: event.target.value as TaskDraft["priority"] })}><option value="normal">보통</option><option value="high">높음</option></select></label></div>
    <div className="collab-form-grid"><label className="reader-field"><span>마감 날짜 · 한국 시간 23:59까지</span><input required type="date" value={draft.due_date} onChange={event => update({ due_date: event.target.value })} /></label><div className="collab-deadline"><button type="button" className="reader-control reader-control--secondary" onClick={() => update({ due_date: addCalendarDays(todayInSeoul(), 6) })}>오늘부터 6일 뒤</button><span>{dateLabel(draft.due_date)}까지 진행</span></div></div>
    <div className="collab-form-grid"><ProjectField projects={projects} value={draft.project_id} onChange={project_id => update({ project_id })} /><label className="reader-field"><span>연결 아이디어</span><select value={draft.source_idea_id} onChange={event => update({ source_idea_id: event.target.value })}><option value="">연결하지 않음</option>{ideas.map(idea => <option key={idea.id} value={idea.id}>{idea.title}</option>)}</select></label></div>
    <p className="collab-hint">담당자에게 연구실 알림을 보냅니다. 제출한 업무는 배정자 또는 관리자가 완료 처리합니다.</p>
    <div className="collab-actions"><button className="reader-control" disabled={busy || !draft.title.trim() || !draft.assignee_id || !draft.due_date}>{busy ? "저장 중…" : editing ? "변경 저장" : "업무 배정"}</button><button type="button" className="reader-control reader-control--secondary" onClick={onCancel}>닫기 · 초안 유지</button></div>
  </fieldset></form>;
}
