import { COLLABORATION_TIME_ZONE, validateCalendarDate, validateCalendarTime } from "./calendar.mjs";

const LIMITS = { events: 2000, ideas: 2000, tasks: 2000, comments: 10000, notifications: 20000, requests: 10000 };
const EVENT_INPUT = ["title", "description", "start_date", "end_date", "all_day", "start_time", "end_time", "participant_ids", "project_id"];
const TASK_INPUT = ["title", "description", "assignee_id", "due_date", "priority", "project_id", "source_idea_id"];
const TASK_STATUSES = ["todo", "in_progress", "submitted", "done", "cancelled"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clone = value => structuredClone(value);
const revision = value => value.toString(16).padStart(64, "0");
function fail(message, status = 422, code = "invalid") { const error = new Error(message); error.status = status; error.code = code; throw error; }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function keys(value, allowed) { if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail("알 수 없거나 허용되지 않은 입력 항목이 있습니다."); }
function text(value, max = 4000, required = false) { if (typeof value !== "string" || value.length > max || value.includes("\0") || (required && !value.trim())) fail("입력 내용이 비어 있거나 허용된 길이를 초과했습니다."); return value; }
function identity(value, empty = false) { if (empty && value === "") return ""; if (typeof value !== "string" || !/^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,199}$/u.test(value)) fail("자료 또는 구성원 식별자가 올바르지 않습니다."); return value; }
function list(value, max = 101) { if (!Array.isArray(value) || value.length > max) fail("선택한 구성원이 너무 많습니다."); const result = value.map(item => identity(item)); if (new Set(result).size !== result.length) fail("같은 구성원을 중복 선택할 수 없습니다."); return result; }
function choice(value, values) { if (!values.includes(value)) fail("지원하지 않는 상태입니다."); return value; }
function timestamp(value, optional = false) {
  text(value, 40, !optional); if (optional && value === "") return value;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail("기록 시각이 올바르지 않습니다.");
  validateCalendarDate(value.slice(0, 10)); validateCalendarTime(value.slice(11, 16)); if (+value.slice(17, 19) > 59) fail("기록 시각이 올바르지 않습니다."); return value;
}
function uniqueRows(value, key, max) { if (!Array.isArray(value) || value.length > max) fail("보관 가능한 협업 기록 수를 초과했습니다. 기존 기록은 유지됩니다.", 422, "capacity"); if (new Set(value.map(row => row?.[key])).size !== value.length) fail("협업 기록의 식별자가 중복되었습니다."); return value; }
function normalizedEvent(input) {
  keys(input, EVENT_INPUT);
  const output = { title: text(input.title, 300, true).trim(), description: text(input.description ?? "", 10000), start_date: validateCalendarDate(input.start_date), end_date: validateCalendarDate(input.end_date), all_day: input.all_day, start_time: text(input.start_time ?? "", 5), end_time: text(input.end_time ?? "", 5), participant_ids: list(input.participant_ids ?? []), project_id: identity(input.project_id ?? "", true) };
  if (typeof output.all_day !== "boolean") fail("종일 일정 여부를 선택해 주세요.");
  if (output.end_date < output.start_date) fail("종료 날짜는 시작 날짜보다 빠를 수 없습니다.");
  if (output.all_day) { output.start_time = ""; output.end_time = ""; }
  else { validateCalendarTime(output.start_time); validateCalendarTime(output.end_time); if (`${output.end_date} ${output.end_time}` <= `${output.start_date} ${output.start_time}`) fail("종료 시각은 시작 시각보다 늦어야 합니다."); }
  return output;
}
function sourceValue(input) {
  keys(input, ["type", "id", "title", "excerpt"]);
  const value = { type: choice(input.type, ["paper", "project", "page", "none"]), id: identity(input.id ?? "", input.type === "none"), title: text(input.title ?? "", 1000), excerpt: text(input.excerpt ?? "", 10000) };
  if (value.type === "none" && value.id !== "") fail("출처 없는 아이디어에 자료 식별자를 지정할 수 없습니다.");
  return value;
}
function normalizedIdea(input) { keys(input, ["title", "body", "recipient_ids", "source"]); return { title: text(input.title, 300, true).trim(), body: text(input.body, 20000, true), recipient_ids: list(input.recipient_ids ?? []), source: sourceValue(input.source ?? { type: "none", id: "", title: "", excerpt: "" }) }; }
function normalizedTask(input) { keys(input, TASK_INPUT); return { title: text(input.title, 300, true).trim(), description: text(input.description ?? "", 20000), assignee_id: identity(input.assignee_id), due_date: validateCalendarDate(input.due_date), priority: choice(input.priority ?? "normal", ["normal", "high"]), project_id: identity(input.project_id ?? "", true), source_idea_id: identity(input.source_idea_id ?? "", true) }; }
function retainedRecord(input, output) { if (Object.keys(input).length !== Object.keys(output).length || JSON.stringify(canonical(input)) !== JSON.stringify(canonical(output))) fail("저장된 협업 기록에 빠진 항목이나 잘못된 값이 있습니다."); if (output.updated_at && Date.parse(output.updated_at) < Date.parse(output.created_at)) fail("수정 시각은 생성 시각보다 빠를 수 없습니다."); if (output.read_at && Date.parse(output.read_at) < Date.parse(output.created_at)) fail("알림 확인 시각이 올바르지 않습니다."); return output; }
function eventRecord(value) { keys(value, [...EVENT_INPUT, "id", "created_by", "created_by_name", "created_at", "updated_at"]); return retainedRecord(value, { ...normalizedEvent(Object.fromEntries(EVENT_INPUT.map(key => [key, value[key]]))), id: identity(value.id), created_by: identity(value.created_by), created_by_name: text(value.created_by_name, 300, true), created_at: timestamp(value.created_at), updated_at: timestamp(value.updated_at) }); }
function ideaRecord(value) { keys(value, ["id", "title", "body", "recipient_ids", "source", "status", "author_id", "author_name", "created_at", "updated_at"]); return retainedRecord(value, { ...normalizedIdea(Object.fromEntries(["title", "body", "recipient_ids", "source"].map(key => [key, value[key]]))), id: identity(value.id), status: choice(value.status, ["open", "resolved"]), author_id: identity(value.author_id), author_name: text(value.author_name, 300, true), created_at: timestamp(value.created_at), updated_at: timestamp(value.updated_at) }); }
function taskRecord(value) { keys(value, [...TASK_INPUT, "id", "assignee_name", "assigned_by", "assigned_by_name", "status", "created_at", "updated_at"]); return retainedRecord(value, { ...normalizedTask(Object.fromEntries(TASK_INPUT.map(key => [key, value[key]]))), id: identity(value.id), assignee_name: text(value.assignee_name, 300, true), assigned_by: identity(value.assigned_by), assigned_by_name: text(value.assigned_by_name, 300, true), status: choice(value.status, TASK_STATUSES), created_at: timestamp(value.created_at), updated_at: timestamp(value.updated_at) }); }
function commentRecord(value) { keys(value, ["id", "target_type", "target_id", "body", "author_id", "author_name", "created_at", "updated_at"]); return retainedRecord(value, { id: identity(value.id), target_type: choice(value.target_type, ["idea", "task"]), target_id: identity(value.target_id), body: text(value.body, 10000, true), author_id: identity(value.author_id), author_name: text(value.author_name, 300, true), created_at: timestamp(value.created_at), updated_at: timestamp(value.updated_at) }); }
function notificationRecord(value) { keys(value, ["id", "recipient_id", "kind", "target_type", "target_id", "title", "actor_id", "actor_name", "created_at", "read_at"]); return retainedRecord(value, { id: identity(value.id), recipient_id: identity(value.recipient_id), kind: choice(value.kind, ["idea", "reply", "assignment", "submission", "task_status"]), target_type: choice(value.target_type, ["idea", "task"]), target_id: identity(value.target_id), title: text(value.title, 500, true), actor_id: identity(value.actor_id), actor_name: text(value.actor_name, 300, true), created_at: timestamp(value.created_at), read_at: timestamp(value.read_at, true) }); }
function requestRecord(value) {
  keys(value, ["request_id", "actor_id", "fingerprint", "result_id", "result_type", "result", "created_at"]);
  if (typeof value.request_id !== "string" || !UUID.test(value.request_id)) fail("요청 식별자가 올바르지 않습니다.");
  const type = choice(value.result_type, ["event", "idea", "task", "comment"]), result = ({ event: eventRecord, idea: ideaRecord, task: taskRecord, comment: commentRecord })[type](value.result);
  const output = { request_id: value.request_id, actor_id: identity(value.actor_id), fingerprint: text(value.fingerprint, 60000, true), result_id: identity(value.result_id), result_type: type, result, created_at: timestamp(value.created_at) };
  if (output.result_id !== result.id || output.actor_id !== (result.created_by || result.author_id || result.assigned_by)) fail("저장된 요청과 작성자 정보가 일치하지 않습니다.");
  return output;
}
export function emptyCollaboration() { return { version: 1, revision: 1, events: [], ideas: [], tasks: [], comments: [], notifications: [], requests: [] }; }
/** Validate imported data without requiring historical authors to remain members. */
export function validateCollaboration(value) {
  if (value === undefined) return emptyCollaboration();
  keys(value, ["version", "revision", ...Object.keys(LIMITS)]);
  if (value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision >= Number.MAX_SAFE_INTEGER) fail("협업 자료의 버전이 올바르지 않습니다.");
  const result = { version: 1, revision: value.revision };
  for (const [name, validator] of Object.entries({ events: eventRecord, ideas: ideaRecord, tasks: taskRecord, comments: commentRecord, notifications: notificationRecord, requests: requestRecord })) result[name] = uniqueRows(value[name], name === "requests" ? "request_id" : "id", LIMITS[name]).map(validator);
  const ids = [...result.events, ...result.ideas, ...result.tasks, ...result.comments, ...result.notifications].map(row => row.id);
  if (new Set(ids).size !== ids.length) fail("협업 기록 간 식별자가 중복되었습니다.");
  const targetExists = (type, id) => result[type === "idea" ? "ideas" : "tasks"].some(row => row.id === id);
  if (result.comments.some(row => !targetExists(row.target_type, row.target_id)) || result.notifications.some(row => !targetExists(row.target_type, row.target_id)) || result.tasks.some(row => row.source_idea_id && !result.ideas.some(idea => idea.id === row.source_idea_id))) fail("협업 자료에 존재하지 않는 대화 또는 업무가 연결되어 있습니다.");
  return result;
}
function context(ctx) {
  if (!object(ctx) || !object(ctx.actor) || !Array.isArray(ctx.members) || ctx.members.length > 101 || !["cloud", "browser"].includes(ctx.mode)) fail("작업공간 구성원 정보를 확인할 수 없습니다.", 403, "forbidden");
  const members = ctx.members.filter(member => member?.accepted === true).map(member => ({ id: identity(member.id), name: text(member.name || member.email || "작업공간 구성원", 300, true), email: text(member.email || "", 320), role: choice(member.role, ["owner", "editor", "viewer"]), accepted: true }));
  if (new Set(members.map(member => member.id)).size !== members.length) fail("작업공간 구성원 정보가 중복되었습니다.", 403, "forbidden");
  const actor = members.find(member => member.id === ctx.actor.id);
  if (!actor || actor.role !== ctx.actor.role || (ctx.mode === "browser" && (members.length !== 1 || actor.id !== members[0].id))) fail("현재 작업공간에 참여한 계정으로 다시 로그인해 주세요.", 403, "forbidden");
  return { actor, members, mode: ctx.mode };
}
function sourceRecord(state, source) {
  if (source.type === "paper") return (state.papers || []).find(row => row.paper_id === source.id);
  if (source.type === "project") return (state.projects || []).find(row => row.project_id === source.id);
  if (source.type === "page") return (state.researchPages || []).find(row => row.id === source.id);
  return undefined;
}
export function getCollaborationSnapshot(state, ctx) {
  const allowed = context(ctx), data = validateCollaboration(state.collaboration), canEdit = ["owner", "editor"].includes(allowed.actor.role);
  return { revision: revision(data.revision), actor: clone(allowed.actor), members: clone(allowed.members), events: clone(data.events), ideas: data.ideas.map(idea => ({ ...clone(idea), source: { ...clone(idea.source), available: idea.source.type !== "none" && !!sourceRecord(state, idea.source) } })), tasks: clone(data.tasks), comments: clone(data.comments), notifications: clone(data.notifications.filter(row => row.recipient_id === allowed.actor.id)), permissions: { can_edit: canEdit, can_assign: canEdit, can_comment: canEdit }, mode: allowed.mode, time_zone: COLLABORATION_TIME_ZONE };
}
function ensureMembers(ids, ctx) { if (ids.some(id => !ctx.members.some(member => member.id === id))) fail("현재 작업공간에 참여한 구성원만 선택할 수 있습니다."); }
function ensureAssignee(id, ctx) { ensureMembers([id], ctx); if (!ctx.members.some(member => member.id === id && ["owner", "editor"].includes(member.role))) fail("업무 담당자는 편집 권한이 있는 구성원이어야 합니다."); }
function ensureProject(value, state) { if (value && !(state.projects || []).some(row => row.project_id === value)) fail("현재 작업공간의 프로젝트를 선택해 주세요."); }
function ensureSource(value, state) { if (value.type === "none") return value; const row = sourceRecord(state, value); if (!row) fail("현재 작업공간에서 출처 자료를 찾을 수 없습니다."); return { ...value, title: text(row.metadata?.title || row.title || row.name || value.title, 1000, true) }; }
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); return value; }
function makeId(kind, ctx, data) { const uuid = ctx.id ? ctx.id() : globalThis.crypto.randomUUID(); if (typeof uuid !== "string" || !UUID.test(uuid)) fail("새 기록의 식별자를 생성하지 못했습니다.", 503, "identity_error"); const value = `${kind}-${uuid}`; if (Object.keys(LIMITS).some(name => name !== "requests" && data[name].some(row => row.id === value))) fail("새 기록의 식별자가 중복되었습니다. 다시 시도해 주세요.", 409, "conflict"); return value; }
function isSupervisor(row, actor) { return actor.role === "owner" || row.assigned_by === actor.id; }
function ensureEdit(actor) { if (!["owner", "editor"].includes(actor.role)) fail("이 작업공간은 보기 권한으로 참여하고 있어 편집할 수 없습니다.", 403, "forbidden"); }
/** The transport owns its read/check/save lock and must recheck current membership at CAS. */
export function applyCollaborationCommand(state, parts, method, body, ctx) {
  if (!Array.isArray(parts) || parts[0] !== "collaboration") return null;
  if (method === "GET" && parts.length === 1) return getCollaborationSnapshot(state, ctx);
  const known = (parts.length === 2 && ["events", "ideas", "tasks"].includes(parts[1]) && method === "POST") || (parts.length === 3 && ["events", "ideas", "tasks"].includes(parts[1]) && ["PATCH", "DELETE"].includes(method) && (method !== "DELETE" || parts[1] === "events")) || (parts.length === 4 && ["ideas", "tasks"].includes(parts[1]) && parts[3] === "comments" && method === "POST") || (parts.length === 3 && parts[1] === "notifications" && parts[2] === "read" && method === "POST");
  if (!known) return null;
  const allowed = context(ctx); ensureEdit(allowed.actor);
  const next = validateCollaboration(state.collaboration), actor = allowed.actor;
  const isCreate = method === "POST" && ((parts.length === 2 && ["events", "ideas", "tasks"].includes(parts[1])) || parts[3] === "comments");
  let fingerprint = "";
  if (isCreate) {
    const inputKey = parts[3] === "comments" ? "body" : parts[1].slice(0, -1);
    keys(body, [inputKey, "expected_revision", "request_id"]);
    if (typeof body.request_id !== "string" || !UUID.test(body.request_id)) fail("다시 시도할 수 있는 요청 식별자가 필요합니다.");
    if (typeof body.expected_revision !== "string" || !/^[a-f0-9]{64}$/.test(body.expected_revision)) fail("저장할 기준 버전이 필요합니다.");
    fingerprint = JSON.stringify(canonical({ method, parts, [inputKey]: body[inputKey] })); text(fingerprint, 60000, true);
    const previous = next.requests.find(row => row.request_id === body.request_id);
    if (previous) {
      if (previous.actor_id !== actor.id || previous.fingerprint !== fingerprint) fail("이미 사용된 요청 식별자의 내용이나 작성자가 다릅니다.", 409, "conflict");
      return { ...getCollaborationSnapshot(state, ctx), status: "saved", result_id: previous.result_id, result: clone(previous.result), idempotent: true, changed: false };
    }
  } else {
    keys(body, parts[1] === "notifications" ? ["ids", "expected_revision"] : method === "DELETE" ? ["expected_revision", "confirm"] : ["changes", "expected_revision"]);
  }
  if (typeof body.expected_revision !== "string" || !/^[a-f0-9]{64}$/.test(body.expected_revision)) fail("저장할 기준 버전이 필요합니다.");
  if (body.expected_revision !== revision(next.revision)) fail("다른 구성원이 내용을 변경했습니다. 새로 불러온 뒤 저장해 주세요.", 409, "conflict");
  const now = timestamp(ctx.now ? ctx.now() : new Date().toISOString());
  let result, resultType = "", resultId = "";
  function notify(recipientIds, kind, targetType, row, title) {
    for (const recipientId of new Set(recipientIds)) if (recipientId !== actor.id && allowed.members.some(member => member.id === recipientId)) next.notifications.push({ id: makeId("notice", ctx, next), recipient_id: recipientId, kind, target_type: targetType, target_id: row.id, title: text(title.slice(0, 500), 500, true), actor_id: actor.id, actor_name: actor.name, created_at: now, read_at: "" });
  }
  if (parts[1] === "notifications") {
    const ids = list(body.ids, 20000), rows = next.notifications.filter(row => row.recipient_id === actor.id);
    if (ids.some(id => !rows.some(row => row.id === id))) fail("본인에게 전달된 알림만 읽음으로 표시할 수 있습니다.", 403, "forbidden");
    for (const row of rows) if ((!ids.length || ids.includes(row.id)) && !row.read_at) row.read_at = now;
  } else if (parts[3] === "comments") {
    resultType = "comment"; const targetType = parts[1] === "ideas" ? "idea" : "task", target = next[parts[1]].find(row => row.id === parts[2]);
    if (!target) fail("대화 또는 업무를 찾을 수 없습니다.", 404, "not_found");
    result = { id: makeId("comment", ctx, next), target_type: targetType, target_id: target.id, body: text(body.body, 10000, true), author_id: actor.id, author_name: actor.name, created_at: now, updated_at: now };
    next.comments.push(result);
    const participants = next.comments.filter(row => row.target_type === targetType && row.target_id === target.id).map(row => row.author_id);
    const audience = targetType === "idea" ? [target.author_id, ...(target.recipient_ids.length ? target.recipient_ids : allowed.members.map(member => member.id)), ...participants] : [target.assigned_by, target.assignee_id, ...participants];
    notify(audience, "reply", targetType, target, `${actor.name}님이 ${target.title}에 댓글을 남겼습니다.`);
  } else if (parts[1] === "events") {
    if (isCreate) {
      const values = normalizedEvent(body.event); ensureMembers(values.participant_ids, allowed); ensureProject(values.project_id, state);
      result = { ...values, id: makeId("event", ctx, next), created_by: actor.id, created_by_name: actor.name, created_at: now, updated_at: now }; next.events.push(result); resultType = "event";
    } else {
      const index = next.events.findIndex(row => row.id === parts[2]); if (index < 0) fail("일정을 찾을 수 없습니다.", 404, "not_found");
      if (method === "DELETE") { if (body.confirm !== true) fail("일정 삭제를 확인해 주세요."); result = next.events.splice(index, 1)[0]; }
      else { keys(body.changes, EVENT_INPUT); if (!Object.keys(body.changes).length) fail("변경할 일정 내용이 필요합니다."); const values = normalizedEvent({ ...Object.fromEntries(EVENT_INPUT.map(key => [key, next.events[index][key]])), ...body.changes }); if ("participant_ids" in body.changes) ensureMembers(values.participant_ids, allowed); if ("project_id" in body.changes) ensureProject(values.project_id, state); result = { ...next.events[index], ...values, updated_at: now }; next.events[index] = result; }
    }
  } else if (parts[1] === "ideas") {
    if (isCreate) {
      const values = normalizedIdea(body.idea); ensureMembers(values.recipient_ids, allowed); values.source = ensureSource(values.source, state);
      result = { ...values, id: makeId("idea", ctx, next), status: "open", author_id: actor.id, author_name: actor.name, created_at: now, updated_at: now }; next.ideas.push(result); resultType = "idea";
      notify(values.recipient_ids.length ? values.recipient_ids : allowed.members.map(member => member.id), "idea", "idea", result, `${actor.name}님이 의견을 요청했습니다: ${result.title}`);
    } else {
      result = next.ideas.find(row => row.id === parts[2]); if (!result) fail("아이디어를 찾을 수 없습니다.", 404, "not_found");
      if (result.author_id !== actor.id && actor.role !== "owner") fail("작성자 또는 관리자만 대화를 마무리할 수 있습니다.", 403, "forbidden");
      keys(body.changes, ["status"]); result.status = choice(body.changes.status, ["open", "resolved"]); result.updated_at = now;
    }
  } else if (parts[1] === "tasks") {
    if (isCreate) {
      const values = normalizedTask(body.task); ensureAssignee(values.assignee_id, allowed); ensureProject(values.project_id, state); if (values.source_idea_id && !next.ideas.some(row => row.id === values.source_idea_id)) fail("이 작업공간의 아이디어만 업무에 연결할 수 있습니다.");
      result = { ...values, id: makeId("task", ctx, next), assignee_name: allowed.members.find(member => member.id === values.assignee_id).name, assigned_by: actor.id, assigned_by_name: actor.name, status: "todo", created_at: now, updated_at: now }; next.tasks.push(result); resultType = "task";
      notify([result.assignee_id], "assignment", "task", result, `${actor.name}님이 업무를 배정했습니다: ${result.title}`);
    } else {
      result = next.tasks.find(row => row.id === parts[2]); if (!result) fail("업무를 찾을 수 없습니다.", 404, "not_found");
      keys(body.changes, [...TASK_INPUT, "status"]); if (!Object.keys(body.changes).length) fail("변경할 업무 내용이 필요합니다.");
      const supervisor = isSupervisor(result, actor);
      if (!supervisor && (result.assignee_id !== actor.id || Object.keys(body.changes).some(key => key !== "status") || !["in_progress", "submitted"].includes(body.changes.status) || ["done", "cancelled"].includes(result.status))) fail("담당자는 진행 또는 제출 상태를 변경할 수 있습니다. 업무 배정 내용과 완료 확인은 배정자 또는 관리자가 수정합니다.", 403, "forbidden");
      const values = normalizedTask({ ...Object.fromEntries(TASK_INPUT.map(key => [key, result[key]])), ...Object.fromEntries(Object.entries(body.changes).filter(([key]) => key !== "status")) });
      if ("assignee_id" in body.changes) ensureAssignee(values.assignee_id, allowed); if ("project_id" in body.changes) ensureProject(values.project_id, state); if ("source_idea_id" in body.changes && values.source_idea_id && !next.ideas.some(row => row.id === values.source_idea_id)) fail("이 작업공간의 아이디어만 업무에 연결할 수 있습니다.");
      const oldAssignee = result.assignee_id, oldStatus = result.status;
      Object.assign(result, values, { updated_at: now }); if ("assignee_id" in body.changes) result.assignee_name = allowed.members.find(member => member.id === result.assignee_id).name;
      if ("status" in body.changes) result.status = choice(body.changes.status, TASK_STATUSES);
      if (oldAssignee !== result.assignee_id) notify([result.assignee_id], "assignment", "task", result, `${actor.name}님이 업무를 배정했습니다: ${result.title}`);
      if (oldStatus !== result.status) {
        if (result.status === "submitted") notify([result.assigned_by], "submission", "task", result, `${actor.name}님이 검토를 요청했습니다: ${result.title}`);
        else if (supervisor) notify([result.assignee_id], "task_status", "task", result, `${actor.name}님이 업무 상태를 변경했습니다: ${result.title}`);
      }
    }
  }
  resultId = result?.id || "";
  if (isCreate) next.requests.push({ request_id: body.request_id, actor_id: actor.id, fingerprint, result_id: resultId, result_type: resultType, result: clone(result), created_at: now });
  next.revision += 1;
  const checked = validateCollaboration(next);
  state.collaboration = checked;
  return { ...getCollaborationSnapshot(state, ctx), status: "saved", result_id: resultId, ...(result ? { result: clone(result) } : {}), idempotent: false, changed: true };
}
