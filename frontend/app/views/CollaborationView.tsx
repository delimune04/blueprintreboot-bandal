"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, MessageSquare, Bell, Plus, RefreshCw, Check, ArrowUpRight } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { LabviumMotion } from "../components/LabviumMotion";
import { Section } from "../components/Section";
import { StatusBadge } from "../components/StatusBadge";
import { ApiClientError, apiClient, getWorkspaceStorageScope, labviumRequest } from "../lib/api/client";
import { calendarDateInRange, addCalendarDays, todayInSeoul } from "../lib/collaboration/calendar.mjs";
import { createCollaborationMutationGate } from "../components/collaboration/mutation-gate.mjs";
import { dateLabel, memberName, newEvent, newIdea, newTask, useCollaborationDraft, EventForm, IdeaForm, TaskForm } from "../components/collaboration/CollaborationForms";
import type { CollaborationSnapshot, CollaborationTab, CalendarEvent, Task, TaskStatus, Mutation, ProjectOption, Source } from "../components/collaboration/types";
import "../lib/collaboration/collaboration.css";

const STATUS: Record<TaskStatus, string> = { todo: "할 일", in_progress: "진행 중", submitted: "검토 요청", done: "완료", cancelled: "취소" };
const TABS = [{ id: "calendar", label: "공유 캘린더", Icon: CalendarDays }, { id: "ideas", label: "아이디어·댓글", Icon: MessageSquare }, { id: "tasks", label: "업무 배정", Icon: ClipboardList }, { id: "inbox", label: "내 알림", Icon: Bell }] as const;
const noSelection = { id: "", revision: "", value: newEvent() };
const timestamp = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const sourceHref = (source: Source) => source.type === "paper" ? `/papers/${encodeURIComponent(source.id)}` : source.type === "project" ? `/projects/${encodeURIComponent(source.id)}` : `/workspace?page=${encodeURIComponent(source.id)}`;

function monthShift(month: string, delta: number) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthDays(month: string) {
  const [year, number] = month.split("-").map(Number);
  const offset = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
  const first = addCalendarDays(`${month}-01`, -offset);
  return Array.from({ length: 42 }, (_, index) => addCalendarDays(first, index));
}
const taskOverdue = (task: Task, today: string) => task.due_date < today && !["done", "cancelled"].includes(task.status);

function DraftConflict({ latest, busy, keep, latestValue }: { latest?: CalendarEvent | Task; busy: boolean; keep: () => void; latestValue: () => void }) {
  return <div className="collab-notice collab-notice--conflict" role="status"><p>편집을 시작한 뒤 공유 내용이 변경되었습니다. 최신 내용을 확인하고 사용할 초안을 선택해 주세요.</p>{latest ? <><details><summary>현재 저장된 내용 확인</summary><strong>{latest.title}</strong><p className="collab-prose">{latest.description}</p><p>{"due_date" in latest ? `마감 ${dateLabel(latest.due_date)} · ${latest.assignee_name} · ${STATUS[latest.status]}` : `${dateLabel(latest.start_date)} – ${dateLabel(latest.end_date)} · ${latest.all_day ? "종일" : `${latest.start_time}–${latest.end_time}`}`}</p></details><div className="collab-actions"><button className="reader-control reader-control--secondary" type="button" disabled={busy} onClick={keep}>내 초안을 유지하고 최신 버전에 적용</button><button className="reader-control reader-control--secondary" type="button" disabled={busy} onClick={latestValue}>현재 저장된 내용 사용</button></div><p className="collab-hint">선택 후 ‘변경 저장’을 눌러야 반영됩니다.</p></> : <p>이 항목이 삭제되었거나 더 이상 접근할 수 없습니다. 작성 내용은 유지되며 기존 항목을 덮어쓰지 않습니다.</p>}</div>;
}

function Thread({ type, id, snapshot, scope, mutate, busy }: { type: "idea" | "task"; id: string; snapshot: CollaborationSnapshot; scope: string; mutate: Mutation; busy: boolean }) {
  const [text, setText] = useCollaborationDraft(scope, `comment:${type}:${id}`, () => "");
  const comments = snapshot.comments.filter(comment => comment.target_type === type && comment.target_id === id);
  async function send() {
    if (!text.trim()) return;
    const response = await mutate(`/collaboration/${type === "idea" ? "ideas" : "tasks"}/${encodeURIComponent(id)}/comments`, "POST", { body: text }, true);
    if (response) setText("");
  }
  return <section className="collab-thread" aria-label="댓글"><h3>댓글 <span>{comments.length}</span></h3>
    {comments.length ? <ol className="collab-comments">{comments.map(comment => <li key={comment.id}><div className="collab-meta"><strong>{comment.author_name}</strong><time dateTime={comment.created_at}>{timestamp(comment.created_at)}</time></div><p>{comment.body}</p></li>)}</ol> : <p className="muted-text">아직 댓글이 없습니다. 짧은 의견이나 다음 방향을 남겨주세요.</p>}
    {snapshot.permissions.can_edit ? <form onSubmit={event => { event.preventDefault(); void send(); }} className="collab-comment-form"><label className="reader-field"><span>댓글 남기기</span><textarea required rows={3} maxLength={10000} disabled={busy} value={text} onChange={event => setText(event.target.value)} placeholder="의견이나 확인할 내용을 적어주세요" /></label><button className="reader-control" disabled={busy || !text.trim()}>{busy ? "저장 중…" : "댓글 등록"}</button></form> : <p className="collab-hint">댓글을 남기려면 이 연구 공간의 편집 권한이 필요합니다.</p>}
  </section>;
}

function CalendarPanel({ snapshot, scope, projects, mutate, busy }: { snapshot: CollaborationSnapshot; scope: string; projects: ProjectOption[]; mutate: Mutation; busy: boolean }) {
  const today = todayInSeoul();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState(today);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useCollaborationDraft(scope, "event", () => ({ ...noSelection, value: newEvent() }));
  const [inspected, setInspected] = useState("");
  const selected = snapshot.events.find(event => event.id === inspected);
  const activeTasks = snapshot.tasks.filter(task => task.status !== "cancelled");
  const eventsFor = (date: string) => snapshot.events.filter(event => calendarDateInRange(date, event.start_date, event.end_date));
  const tasksFor = (date: string) => activeTasks.filter(task => task.due_date === date);
  const edit = (event: CalendarEvent) => { if (draft.id !== event.id && draft.value.title.trim() && !window.confirm("현재 일정 초안을 바꾸고 선택한 일정을 편집할까요?")) return; const { title, description, start_date, end_date, all_day, start_time, end_time, participant_ids, project_id } = event; setDraft({ id: event.id, revision: snapshot.revision, value: { title, description, start_date, end_date, all_day, start_time, end_time, participant_ids, project_id } }); setShowForm(true); };
  async function save() {
    const value = { ...draft.value, ...(draft.value.all_day ? { start_time: "", end_time: "" } : {}) };
    const result = await mutate(`/collaboration/events${draft.id ? `/${encodeURIComponent(draft.id)}` : ""}`, draft.id ? "PATCH" : "POST", draft.id ? { changes: value } : { event: value }, !draft.id, draft.id ? draft.revision : undefined);
    if (result) { setDay(value.start_date); setMonth(value.start_date.slice(0, 7)); setShowForm(false); setDraft({ id: "", revision: "", value: newEvent() }); }
  }
  async function remove(event: CalendarEvent) {
    if (!window.confirm(`‘${event.title}’ 일정을 삭제할까요?`)) return;
    if (await mutate(`/collaboration/events/${encodeURIComponent(event.id)}`, "DELETE", { confirm: true })) { setInspected(""); if (draft.id === event.id) { setShowForm(false); setDraft({ id: "", revision: "", value: newEvent() }); } }
  }
  return <Section title="연구실 일정" actions={snapshot.permissions.can_edit ? <button className="reader-control" disabled={busy} onClick={() => { if (!draft.value.title.trim()) setDraft({ id: "", revision: "", value: { ...newEvent(), start_date: day, end_date: day } }); setShowForm(true); }}><Plus size={15} />일정 추가</button> : undefined}>
    {showForm && draft.id && draft.revision !== snapshot.revision ? <DraftConflict latest={snapshot.events.find(event => event.id === draft.id)} busy={busy} keep={() => setDraft({ ...draft, revision: snapshot.revision })} latestValue={() => { const latest = snapshot.events.find(event => event.id === draft.id); if (latest) edit(latest); }} /> : null}
    {showForm && snapshot.permissions.can_edit ? <EventForm draft={draft.value} change={value => setDraft({ ...draft, value })} members={snapshot.members} projects={projects} busy={busy} onSave={() => void save()} onCancel={() => setShowForm(false)} editing={Boolean(draft.id)} /> : null}
    <div className="collab-calendar-toolbar"><div className="collab-actions"><button className="reader-control reader-control--secondary" aria-label="이전 달" onClick={() => { const next = monthShift(month, -1); setMonth(next); setDay(`${next}-01`); }}><ChevronLeft size={17} /></button><h3 aria-live="polite">{Number(month.slice(0, 4))}년 {Number(month.slice(5))}월</h3><button className="reader-control reader-control--secondary" aria-label="다음 달" onClick={() => { const next = monthShift(month, 1); setMonth(next); setDay(`${next}-01`); }}><ChevronRight size={17} /></button></div><button className="reader-control reader-control--secondary" onClick={() => { setMonth(today.slice(0, 7)); setDay(today); }}>오늘</button></div>
    <div className="collab-calendar-legend"><span><i className="collab-dot" />공유 일정</span><span><i className="collab-dot collab-dot--task" />업무 마감</span><span>한국 시간 기준</span></div>
    <div className="collab-calendar" role="group" aria-label={`${month} 달력. 날짜를 선택하면 아래 목록에 일정과 마감이 표시됩니다.`}><div className="collab-weekdays">{["일", "월", "화", "수", "목", "금", "토"].map(label => <span key={label}>{label}</span>)}</div><div className="collab-days">{monthDays(month).map(date => {
      const events = eventsFor(date), tasks = tasksFor(date), total = events.length + tasks.length;
      return <button type="button" key={date} className={`collab-day ${date.slice(0, 7) !== month ? "is-other-month" : ""} ${date === today ? "is-today" : ""} ${date === day ? "is-selected" : ""}`} aria-pressed={date === day} aria-label={`${dateLabel(date)}${date === today ? " 오늘" : ""}, 일정 ${events.length}개, 업무 마감 ${tasks.length}개`} onClick={() => { setDay(date); if (date.slice(0, 7) !== month) setMonth(date.slice(0, 7)); }}><span className="collab-day-number">{Number(date.slice(-2))}</span><span className="collab-day-items">{events.slice(0, 2).map(event => <span className="collab-day-item" key={event.id}><i className="collab-dot" />{event.title}</span>)}{tasks.slice(0, Math.max(0, 2 - events.length)).map(task => <span className="collab-day-item collab-day-item--task" key={task.id}><i className="collab-dot collab-dot--task" />{task.title}</span>)}{total > 2 ? <span className="collab-day-more">+{total - 2}</span> : null}</span><span className="collab-day-dots" aria-hidden="true">{events.length ? <i className="collab-dot" /> : null}{tasks.length ? <i className="collab-dot collab-dot--task" /> : null}</span></button>;
    })}</div></div>
    <div className="collab-agenda"><h3>{dateLabel(day)} 일정·마감</h3>{!eventsFor(day).length && !tasksFor(day).length ? <p className="muted-text">이 날짜에는 등록된 일정이나 업무 마감이 없습니다.</p> : null}
      {eventsFor(day).map(event => <div className="collab-agenda-row" key={event.id}><span className="collab-agenda-time">{event.all_day ? "종일" : day === event.start_date ? event.start_time : day === event.end_date ? `~${event.end_time}` : "계속"}</span><button className="collab-title-button" onClick={() => setInspected(event.id)}><i className="collab-dot" />{event.title}</button>{snapshot.permissions.can_edit ? <button className="reader-control reader-control--secondary" onClick={() => edit(event)} disabled={busy}>편집</button> : null}</div>)}
      {tasksFor(day).map(task => <div className="collab-agenda-row" key={task.id}><span className="collab-agenda-time">마감</span><Link href={`/collaboration/tasks/${encodeURIComponent(task.id)}`} className="collab-task-link"><i className="collab-dot collab-dot--task" />{task.title}</Link><span>{task.assignee_name} · {STATUS[task.status]}</span></div>)}
    </div>
    {selected ? <section className="collab-inspector" aria-label="일정 상세"><div className="collab-inspector-heading"><h3>{selected.title}</h3><button className="reader-control reader-control--secondary" onClick={() => setInspected("")}>닫기</button></div><p>{dateLabel(selected.start_date)}{selected.start_date !== selected.end_date ? ` – ${dateLabel(selected.end_date)}` : ""} · {selected.all_day ? "종일" : `${selected.start_time}–${selected.end_time}`} · 한국 시간</p><p className="collab-prose">{selected.description}</p><p className="muted-text">참석: {selected.participant_ids.length ? selected.participant_ids.map(id => memberName(snapshot.members.find(member => member.id === id))).join(", ") : "연구실 전체"}</p><p className="muted-text">등록: {selected.created_by_name}</p>{selected.project_id ? <Link href={`/projects/${encodeURIComponent(selected.project_id)}`}>연결 프로젝트 열기</Link> : null}{snapshot.permissions.can_edit ? <div className="collab-actions"><button className="reader-control reader-control--secondary" disabled={busy} onClick={() => edit(selected)}>일정 편집</button><button className="reader-control reader-control--secondary" disabled={busy} onClick={() => void remove(selected)}>일정 삭제</button></div> : null}</section> : null}
  </Section>;
}

function IdeasPanel({ snapshot, scope, mutate, busy, initialId, projects, openTask }: { snapshot: CollaborationSnapshot; scope: string; mutate: Mutation; busy: boolean; initialId?: string; projects: ProjectOption[]; openTask: (ideaId: string) => void }) {
  void projects;
  const [selectedId, setSelectedId] = useState(initialId || "");
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("all");
  const [draft, setDraft] = useCollaborationDraft(scope, "idea", newIdea);
  useEffect(() => { let active = true; if (initialId) queueMicrotask(() => { if (active) setSelectedId(initialId); }); return () => { active = false; }; }, [initialId]);
  const selected = snapshot.ideas.find(idea => idea.id === selectedId);
  const rows = snapshot.ideas.filter(idea => filter === "all" || idea.status === filter).slice().reverse();
  async function save() {
    const result = await mutate("/collaboration/ideas", "POST", { idea: draft }, true);
    if (result) { setSelectedId(result.result_id || result.ideas.at(-1)?.id || ""); setDraft(newIdea()); setShowForm(false); }
  }
  return <Section title="서로 묻고 함께 검토하기" actions={snapshot.permissions.can_edit ? <button className="reader-control" disabled={busy} onClick={() => setShowForm(true)}><Plus size={15} />아이디어 묻기</button> : undefined}>
    {showForm && snapshot.permissions.can_edit ? <IdeaForm draft={draft} change={setDraft} members={snapshot.members} busy={busy} onSave={() => void save()} onCancel={() => setShowForm(false)} /> : null}
    <div className="collab-actions collab-filter" aria-label="아이디어 상태 필터">{[["all", "전체"], ["open", "검토 중"], ["resolved", "검토 완료"]].map(([value, label]) => <button key={value} className="reader-control reader-control--secondary" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
    <div className="collab-split"><div className="collab-list" aria-label="아이디어 목록">{rows.length ? rows.map(idea => <button key={idea.id} className={`collab-list-row ${idea.id === selectedId ? "is-selected" : ""}`} onClick={() => setSelectedId(idea.id)} aria-pressed={idea.id === selectedId}><span className="collab-meta"><span>{idea.status === "resolved" ? "검토 완료" : "검토 중"}</span><time dateTime={idea.created_at}>{timestamp(idea.created_at)}</time></span><strong>{idea.title}</strong><span>{idea.author_name} · 댓글 {snapshot.comments.filter(comment => comment.target_type === "idea" && comment.target_id === idea.id).length}</span></button>) : <p className="collab-empty">아직 아이디어가 없습니다. 교수·동료 누구나 같은 방식으로 질문하고 답할 수 있습니다.</p>}</div>
      <div className="collab-detail">{selected ? <><div className="collab-meta"><span>{selected.status === "resolved" ? "검토 완료" : "검토 중"}</span><span>{selected.author_name}</span></div><h3 className="collab-detail-title">{selected.title}</h3><p className="collab-prose">{selected.body}</p><p className="collab-hint">알림 대상: {selected.recipient_ids.length ? selected.recipient_ids.map(id => memberName(snapshot.members.find(member => member.id === id))).join(", ") : "연구실 전체"}</p>{selected.source.type !== "none" ? <div className="collab-source"><span>연결한 연구 자료</span>{selected.source.available !== false ? <Link href={sourceHref(selected.source)}>{selected.source.title}<ArrowUpRight size={14} /></Link> : <strong>{selected.source.title} · 원문을 열 수 없음</strong>}{selected.source.excerpt ? <p>{selected.source.excerpt}</p> : null}</div> : null}<div className="collab-actions">{snapshot.permissions.can_edit && (selected.author_id === snapshot.actor.id || snapshot.actor.role === "owner") ? <button disabled={busy} className="reader-control reader-control--secondary" onClick={() => void mutate(`/collaboration/ideas/${encodeURIComponent(selected.id)}`, "PATCH", { changes: { status: selected.status === "open" ? "resolved" : "open" } })}><Check size={14} />{selected.status === "open" ? "검토 완료로 표시" : "다시 검토하기"}</button> : null}{snapshot.permissions.can_assign ? <button className="reader-control reader-control--secondary" disabled={busy} onClick={() => openTask(selected.id)}>이 아이디어로 업무 배정</button> : null}</div><Thread key={selected.id} type="idea" id={selected.id} snapshot={snapshot} scope={scope} mutate={mutate} busy={busy} /></> : <p className="collab-empty">아이디어를 선택하면 내용과 댓글을 함께 볼 수 있습니다.{initialId && !selected ? " 요청한 아이디어가 없거나 현재 공간의 자료가 아닙니다." : ""}</p>}</div>
    </div>
  </Section>;
}

function TasksPanel({ snapshot, scope, mutate, busy, initialId, sourceIdeaId, sourceGeneration, projects }: { snapshot: CollaborationSnapshot; scope: string; mutate: Mutation; busy: boolean; initialId?: string; sourceIdeaId: string; sourceGeneration: number; projects: ProjectOption[] }) {
  const [selectedId, setSelectedId] = useState(initialId || "");
  const [showForm, setShowForm] = useState(Boolean(sourceIdeaId));
  const [filter, setFilter] = useState("mine");
  const [includeClosed, setIncludeClosed] = useState(false);
  const [draft, setDraft] = useCollaborationDraft(scope, "task", () => ({ id: "", revision: "", value: newTask(snapshot.actor.id) }));
  const appliedSource = useRef("");
  useEffect(() => { let active = true; if (initialId) queueMicrotask(() => { if (active) { setSelectedId(initialId); setFilter("all"); setIncludeClosed(true); } }); return () => { active = false; }; }, [initialId]);
  useEffect(() => { let active = true; const seed = `${sourceGeneration}:${sourceIdeaId}`; if (sourceIdeaId && appliedSource.current !== seed) queueMicrotask(() => { if (!active) return; appliedSource.current = seed; const idea = snapshot.ideas.find(item => item.id === sourceIdeaId); setDraft(current => ({ id: "", revision: "", value: { ...current.value, source_idea_id: sourceIdeaId, title: current.value.title || idea?.title || "" } })); setShowForm(true); }); return () => { active = false; }; }, [sourceIdeaId, sourceGeneration, snapshot.ideas, setDraft]);
  const selected = snapshot.tasks.find(task => task.id === selectedId);
  const rows = snapshot.tasks.filter(task => (filter === "all" || (filter === "assigned" ? task.assigned_by === snapshot.actor.id : task.assignee_id === snapshot.actor.id)) && (includeClosed || !["done", "cancelled"].includes(task.status))).slice().sort((left, right) => left.due_date.localeCompare(right.due_date));
  const today = todayInSeoul();
  const canManage = (task: Task) => snapshot.permissions.can_edit && (task.assigned_by === snapshot.actor.id || snapshot.actor.role === "owner");
  async function save() {
    const result = await mutate(`/collaboration/tasks${draft.id ? `/${encodeURIComponent(draft.id)}` : ""}`, draft.id ? "PATCH" : "POST", draft.id ? { changes: draft.value } : { task: draft.value }, !draft.id, draft.id ? draft.revision : undefined);
    if (result) { setSelectedId(draft.id || result.result_id || result.tasks.at(-1)?.id || ""); setFilter("all"); setShowForm(false); setDraft({ id: "", revision: "", value: newTask(snapshot.actor.id) }); }
  }
  function edit(task: Task) { if (draft.id !== task.id && draft.value.title.trim() && !window.confirm("현재 업무 초안을 바꾸고 선택한 업무를 편집할까요?")) return; const { title, description, assignee_id, due_date, priority, project_id, source_idea_id } = task; setDraft({ id: task.id, revision: snapshot.revision, value: { title, description, assignee_id, due_date, priority, project_id, source_idea_id } }); setShowForm(true); }
  return <Section title="담당자와 마감이 분명한 업무" actions={snapshot.permissions.can_assign ? <button className="reader-control" disabled={busy} onClick={() => setShowForm(true)}><Plus size={15} />업무 배정</button> : undefined}>
    {showForm && draft.id && draft.revision !== snapshot.revision ? <DraftConflict latest={snapshot.tasks.find(task => task.id === draft.id)} busy={busy} keep={() => setDraft({ ...draft, revision: snapshot.revision })} latestValue={() => { const latest = snapshot.tasks.find(task => task.id === draft.id); if (latest) edit(latest); }} /> : null}
    {showForm && snapshot.permissions.can_assign ? <TaskForm draft={draft.value} change={value => setDraft({ ...draft, value })} members={snapshot.members} projects={projects} ideas={snapshot.ideas} busy={busy} onSave={() => void save()} onCancel={() => setShowForm(false)} editing={Boolean(draft.id)} /> : null}
    <div className="collab-actions collab-filter" aria-label="업무 필터">{[["mine", "내가 할 일"], ["assigned", "내가 배정한 일"], ["all", "전체 업무"]].map(([value, label]) => <button key={value} className="reader-control reader-control--secondary" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}<label className="collab-check"><input type="checkbox" checked={includeClosed} onChange={event => setIncludeClosed(event.target.checked)} />완료·취소 포함</label></div>
    <div className="collab-split"><div className="collab-list" aria-label="업무 목록">{rows.length ? rows.map(task => <button key={task.id} className={`collab-list-row ${task.id === selectedId ? "is-selected" : ""}`} onClick={() => setSelectedId(task.id)} aria-pressed={task.id === selectedId}><span className="collab-meta"><span className={taskOverdue(task, today) ? "collab-overdue" : ""}>{dateLabel(task.due_date)} 마감{taskOverdue(task, today) ? " · 기한 지남" : ""}</span><span>{STATUS[task.status]}</span></span><strong>{task.title}</strong><span>{task.assignee_name}{task.priority === "high" ? " · 우선순위 높음" : ""}</span></button>) : <p className="collab-empty">이 필터에 해당하는 업무가 없습니다.</p>}</div>
      <div className="collab-detail">{selected ? <><div className="collab-meta"><StatusBadge tone={selected.status === "done" ? "green" : selected.status === "submitted" ? "amber" : "slate"}>{STATUS[selected.status]}</StatusBadge>{selected.priority === "high" ? <span>우선순위 높음</span> : null}</div><h3 className="collab-detail-title">{selected.title}</h3><dl className="collab-task-meta"><div><dt>담당자</dt><dd>{selected.assignee_name}</dd></div><div><dt>배정자</dt><dd>{selected.assigned_by_name}</dd></div><div><dt>마감</dt><dd className={taskOverdue(selected, today) ? "collab-overdue" : ""}>{dateLabel(selected.due_date)} 한국 시간 23:59{taskOverdue(selected, today) ? " · 기한 지남" : ""}</dd></div></dl><p className="collab-prose">{selected.description || "추가 요청 내용이 없습니다."}</p><div className="collab-actions">{selected.project_id ? <Link href={`/projects/${encodeURIComponent(selected.project_id)}`}>연결 프로젝트</Link> : null}{selected.source_idea_id ? <Link href={`/collaboration/ideas/${encodeURIComponent(selected.source_idea_id)}`}>연결 아이디어</Link> : null}</div><div className="collab-actions collab-task-actions">{snapshot.permissions.can_edit && (canManage(selected) || (selected.assignee_id === snapshot.actor.id && !["done", "cancelled"].includes(selected.status))) ? (canManage(selected) ? (["todo", "in_progress", "submitted", "done", "cancelled"] as TaskStatus[]) : (["in_progress", "submitted"] as TaskStatus[])).filter(status => status !== selected.status).map(status => <button className="reader-control reader-control--secondary" disabled={busy} key={status} onClick={() => { if (status === "cancelled" && !window.confirm(`‘${selected.title}’ 업무를 취소할까요?`)) return; void mutate(`/collaboration/tasks/${encodeURIComponent(selected.id)}`, "PATCH", { changes: { status } }); }}>{status === "in_progress" ? "진행 시작" : status === "submitted" ? "제출·검토 요청" : status === "done" ? "완료 승인" : status === "cancelled" ? "업무 취소" : "할 일로 돌리기"}</button>) : null}{canManage(selected) ? <button disabled={busy} className="reader-control reader-control--secondary" onClick={() => edit(selected)}>내용·마감 편집</button> : null}</div><Thread key={selected.id} type="task" id={selected.id} snapshot={snapshot} scope={scope} mutate={mutate} busy={busy} /></> : <p className="collab-empty">업무를 선택하면 요청 내용과 진행 상태, 댓글을 볼 수 있습니다.{initialId && !selected ? " 요청한 업무가 없거나 현재 공간의 자료가 아닙니다." : ""}</p>}</div>
    </div>
  </Section>;
}

function InboxPanel({ snapshot, mutate, busy }: { snapshot: CollaborationSnapshot; mutate: Mutation; busy: boolean }) {
  const unread = snapshot.notifications.filter(notice => !notice.read_at).length;
  const [onlyUnread, setOnlyUnread] = useState(false);
  const rows = snapshot.notifications.filter(notice => !onlyUnread || !notice.read_at).slice().reverse();
  return <Section title={`내 연구실 알림${unread ? ` · 읽지 않음 ${unread}` : ""}`} actions={<button className="reader-control reader-control--secondary" disabled={busy || !unread || !snapshot.permissions.can_edit} onClick={() => void mutate("/collaboration/notifications/read", "POST", { ids: [] })}>모두 읽음</button>}><label className="collab-check"><input type="checkbox" checked={onlyUnread} onChange={event => setOnlyUnread(event.target.checked)} />읽지 않은 알림만 보기</label><p className="collab-hint">이 공간에서 받은 질문·댓글·업무 알림입니다. 이메일이나 문자로 발송되지는 않습니다.</p><ol className="collab-inbox">{rows.map(notice => <li key={notice.id} className={notice.read_at ? "is-read" : "is-unread"}><span className="collab-notice-marker" aria-label={notice.read_at ? "읽음" : "읽지 않음"} /><div><Link href={`/collaboration/${notice.target_type === "idea" ? "ideas" : "tasks"}/${encodeURIComponent(notice.target_id)}`}>{notice.title}</Link><p>{notice.actor_name} · <time dateTime={notice.created_at}>{timestamp(notice.created_at)}</time></p></div>{!notice.read_at && snapshot.permissions.can_edit ? <button className="reader-control reader-control--secondary" disabled={busy} onClick={() => void mutate("/collaboration/notifications/read", "POST", { ids: [notice.id] })}>읽음</button> : null}</li>)}</ol>{!rows.length ? <p className="collab-empty">{onlyUnread ? "읽지 않은 알림이 없습니다." : "아직 받은 알림이 없습니다."}</p> : null}</Section>;
}

/** Initial snapshot injection also allows real rendered-markup verification. */
export function CollaborationSurface({ initial, scope, initialTab = "calendar", ideaId, taskId }: { initial: CollaborationSnapshot; scope: string; initialTab?: CollaborationTab; ideaId?: string; taskId?: string }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [tab, setTab] = useState<CollaborationTab>(ideaId ? "ideas" : taskId ? "tasks" : initialTab);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [sourceIdeaId, setSourceIdeaId] = useState("");
  const [sourceGeneration, setSourceGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error" | "conflict"; text: string } | null>(null);
  const active = useRef(true);
  const readSerial = useRef(0);
  const saved = useRef(snapshot);
  useEffect(() => { saved.current = snapshot; }, [snapshot]);
  const [gate] = useState(() => createCollaborationMutationGate({ request: (path, options) => labviumRequest<CollaborationSnapshot>(path, options) }));
  const invalidateRead = useCallback(() => { readSerial.current++; }, []);
  const refresh = useCallback(async (manual = false) => {
    if (gate.locked || (!manual && document.visibilityState === "hidden")) return;
    const serial = ++readSerial.current;
    if (manual) setRefreshing(true);
    try { const response = await labviumRequest<CollaborationSnapshot>("/collaboration"); if (active.current && serial === readSerial.current) { saved.current = response; setSnapshot(response); if (manual) setNotice({ type: "success", text: "최신 내용을 불러왔습니다. 작성 중인 내용은 유지됩니다." }); } }
    catch (error) { if (active.current && serial === readSerial.current && manual) setNotice({ type: "error", text: `최신 내용을 불러오지 못했습니다. ${error instanceof Error ? error.message : "다시 시도해 주세요."}` }); }
    finally { if (active.current && serial === readSerial.current) setRefreshing(false); }
  }, [gate]);
  useEffect(() => {
    active.current = true;
    void apiClient.getAllProjects().then(result => { if (active.current) setProjects(result.map(project => ({ project_id: project.project_id, name: project.name }))); }).catch(() => { /* Existing links and core collaboration remain usable. */ });
    const interval = window.setInterval(() => void refresh(), 30000);
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { active.current = false; invalidateRead(); window.clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, [refresh, invalidateRead]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) setTab(ideaId ? "ideas" : taskId ? "tasks" : initialTab); }); return () => { active = false; }; }, [initialTab, ideaId, taskId]);
  const mutate: Mutation = async (path, method, body, idempotent = false, expectedRevision) => {
    if (gate.locked || !saved.current.permissions.can_edit) return null;
    ++readSerial.current; setRefreshing(false); setBusy(true); setNotice(null);
    try { const response = await gate.run(path, method, body, expectedRevision || saved.current.revision, idempotent); if (response && active.current) { saved.current = response; setSnapshot(response); window.dispatchEvent(new CustomEvent("labvium:collaboration-changed")); setNotice({ type: "success", text: snapshot.mode === "browser" ? "이 기기에 저장했습니다." : "연구 공간에 저장했습니다." }); } return response; }
    catch (error) { if (active.current) setNotice({ type: error instanceof ApiClientError && error.status === 409 ? "conflict" : "error", text: error instanceof ApiClientError && error.status === 409 ? "다른 구성원이 먼저 변경했습니다. 최신 내용을 불러온 뒤 작성 내용을 확인하고 다시 저장해 주세요. 입력 내용은 유지됩니다." : `저장하지 못했습니다. 입력 내용은 유지됩니다. ${error instanceof Error ? error.message : "연결을 확인한 뒤 다시 시도해 주세요."}` }); return null; }
    finally { if (active.current) setBusy(false); }
  };
  const unread = snapshot.notifications.filter(item => !item.read_at).length;
  return <div className="page-stack page-stack--detail collab-page"><LabviumMotion scope=".collab-page" /><PageHeader title="연구실 협업" description="같은 일정에서 만나고, 아이디어를 검토하고, 다음 일을 함께 진행하세요." actions={<button className="reader-control reader-control--secondary" disabled={busy || refreshing} onClick={() => void refresh(true)}><RefreshCw size={15} />{refreshing ? "불러오는 중…" : "최신 내용"}</button>} />
    <div className="collab-context"><span>한국 시간 · Asia/Seoul</span><span>{memberName(snapshot.actor)} · {snapshot.actor.role === "owner" ? "관리자" : snapshot.actor.role === "viewer" ? "읽기 전용" : "편집 구성원"}</span>{snapshot.mode === "browser" ? <p>현재는 이 기기의 개인 공간입니다. 동료와 함께 쓰려면 로그인 후 같은 연구실 공간에 참여해 주세요. 다른 사람에게 알림이 전달되지 않습니다. <Link href="/team">공유 공간 설정</Link></p> : <p>현재 선택한 연구 공간의 구성원이 함께 볼 수 있습니다. <Link href="/team">구성원·권한 관리</Link></p>}</div>
    {!snapshot.permissions.can_edit ? <p className="collab-readonly" role="status">읽기 전용으로 보고 있습니다. 일정·댓글·업무를 변경하려면 관리자에게 편집 권한을 요청하세요.</p> : null}
    {notice ? <div className={`collab-notice collab-notice--${notice.type}`} role={notice.type === "success" ? "status" : "alert"}><p>{notice.text}</p>{notice.type === "conflict" ? <button className="reader-control reader-control--secondary" disabled={busy || refreshing} onClick={() => void refresh(true)}>작성 내용 유지하고 최신 내용 불러오기</button> : null}</div> : null}
    <nav className="collab-tabs" aria-label="연구실 협업 메뉴">{TABS.map(({ id, label, Icon }) => <button key={id} className={tab === id ? "is-active" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}><Icon size={17} /><span>{label}</span>{id === "inbox" && unread ? <span className="collab-count">{unread}</span> : null}</button>)}</nav>
    <div hidden={tab !== "calendar"} data-lv-reveal><CalendarPanel snapshot={snapshot} scope={scope} projects={projects} mutate={mutate} busy={busy} /></div>
    <div hidden={tab !== "ideas"} data-lv-reveal><IdeasPanel snapshot={snapshot} scope={scope} projects={projects} mutate={mutate} busy={busy} initialId={ideaId} openTask={id => { setSourceIdeaId(id); setSourceGeneration(value => value + 1); setTab("tasks"); }} /></div>
    <div hidden={tab !== "tasks"} data-lv-reveal><TasksPanel snapshot={snapshot} scope={scope} projects={projects} mutate={mutate} busy={busy} initialId={taskId} sourceIdeaId={sourceIdeaId} sourceGeneration={sourceGeneration} /></div>
    <div hidden={tab !== "inbox"} data-lv-reveal><InboxPanel snapshot={snapshot} mutate={mutate} busy={busy} /></div>
  </div>;
}

export function CollaborationView(props: { initialTab?: CollaborationTab; ideaId?: string; taskId?: string }) {
  const [scope, setScope] = useState(() => getWorkspaceStorageScope());
  const [loaded, setLoaded] = useState<{ scope: string; snapshot: CollaborationSnapshot } | null>(null);
  const [error, setError] = useState("");
  const serial = useRef(0);
  const invalidate = useCallback(() => { serial.current++; }, []);
  const load = useCallback(async () => {
    const token = ++serial.current, requestedScope = getWorkspaceStorageScope();
    setError("");
    try { const snapshot = await labviumRequest<CollaborationSnapshot>("/collaboration"); if (serial.current === token && requestedScope === getWorkspaceStorageScope()) { setScope(requestedScope); setLoaded({ scope: requestedScope, snapshot }); } }
    catch (failure) { if (serial.current === token) setError(failure instanceof Error ? failure.message : "연구실 협업을 불러오지 못했습니다."); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); const changed = () => { setScope(getWorkspaceStorageScope()); setLoaded(null); void load(); }; window.addEventListener("labvium:workspace-mode", changed); return () => { active = false; invalidate(); window.removeEventListener("labvium:workspace-mode", changed); }; }, [load, invalidate]);
  if (error) return <div className="page-stack collab-page"><PageHeader title="연구실 협업" /><p role="alert">{error}</p><button className="reader-control" onClick={() => void load()}>다시 불러오기</button></div>;
  if (!loaded || loaded.scope !== scope) return <div className="page-stack collab-page"><PageHeader title="연구실 협업" /><p role="status">연구실 일정과 업무를 불러오는 중…</p></div>;
  return <CollaborationSurface key={scope} initial={loaded.snapshot} scope={scope} {...props} />;
}
