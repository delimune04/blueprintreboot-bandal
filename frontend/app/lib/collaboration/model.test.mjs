import test from "node:test";
import assert from "node:assert/strict";
import { emptyCollaboration, validateCollaboration, getCollaborationSnapshot, applyCollaborationCommand } from "./model.mjs";
import { defaultTaskDueDate } from "./calendar.mjs";

const professor = { id: "professor-owner", name: "이 교수", email: "professor@example.edu", role: "owner", accepted: true };
const student = { id: "student-editor", name: "박 연구원", email: "student@example.edu", role: "editor", accepted: true };
const peer = { id: "peer-editor", name: "동료 연구원", email: "peer@example.edu", role: "editor", accepted: true };
const viewer = { id: "reader-viewer", name: "열람 구성원", email: "viewer@example.edu", role: "viewer", accepted: true };
const pending = { id: "pending-editor", name: "미참여", email: "pending@example.edu", role: "editor", accepted: false };
const members = [professor, student, peer, viewer, pending];
let sequence = 1;
const uuid = () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`;
const ctx = (actor = professor, extra = {}) => ({ actor, members, mode: "cloud", now: () => "2026-10-17T15:20:00.000Z", id: uuid, ...extra });
const workspace = () => ({ papers: [{ paper_id: "paper-ccs", metadata: { title: "CCS reservoir evidence" } }], projects: [{ project_id: "project-ccs", name: "CCS 프로젝트" }], researchPages: [{ id: "page-analysis", title: "시료 분석 노트" }] });
const rev = (state, actor = professor) => getCollaborationSnapshot(state, ctx(actor)).revision;
const event = (extra = {}) => ({ title: "연구실 미팅", description: "분석 결과 검토", start_date: "2026-10-20", end_date: "2026-10-20", all_day: false, start_time: "10:00", end_time: "11:00", participant_ids: [], project_id: "project-ccs", ...extra });
const idea = (extra = {}) => ({ title: "압력 조건 비교", body: "이 아이디어 어때요?", recipient_ids: [professor.id], source: { type: "paper", id: "paper-ccs", title: "사용자 표제", excerpt: "압력 조건이 다릅니다." }, ...extra });
const task = (extra = {}) => ({ title: "시료 분석 진행", description: "압력 조건별 자료를 정리해 주세요.", assignee_id: student.id, due_date: defaultTaskDueDate("2026-10-17T15:20:00.000Z"), priority: "normal", project_id: "project-ccs", source_idea_id: "", ...extra });
function create(state, type, value, actor = professor, requestId = uuid(), expected = rev(state, actor)) { return applyCollaborationCommand(state, ["collaboration", type], "POST", { [type.slice(0, -1)]: value, expected_revision: expected, request_id: requestId }, ctx(actor)); }
function patch(state, type, id, changes, actor = professor, expected = rev(state, actor)) { return applyCollaborationCommand(state, ["collaboration", type, id], "PATCH", { changes, expected_revision: expected }, ctx(actor)); }
function comment(state, type, id, body, actor = professor, requestId = uuid(), expected = rev(state, actor)) { return applyCollaborationCommand(state, ["collaboration", type, id, "comments"], "POST", { body, expected_revision: expected, request_id: requestId }, ctx(actor)); }
function preserves(state, fn, status = 422) { const before = structuredClone(state); assert.throws(fn, error => error.status === status && typeof error.code === "string"); assert.deepEqual(state, before); }

test("old workspaces read an empty extension without a migration or storage write", () => {
  const state = workspace(), before = structuredClone(state), snapshot = getCollaborationSnapshot(state, ctx());
  assert.deepEqual(state, before); assert.equal(Object.hasOwn(state, "collaboration"), false);
  assert.equal(snapshot.revision, "1".padStart(64, "0")); assert.equal(snapshot.time_zone, "Asia/Seoul");
  assert.equal(snapshot.members.length, 4); assert.ok(snapshot.members.every(row => row.accepted)); assert.equal(snapshot.permissions.can_comment, true);
  assert.deepEqual(validateCollaboration(undefined), emptyCollaboration()); assert.deepEqual(snapshot.events, []);
});

test("professor and student can ask and answer in either direction with verified source labels", () => {
  const state = workspace();
  const asked = create(state, "ideas", idea(), student);
  assert.equal(asked.result.author_id, student.id); assert.equal(asked.result.source.title, "CCS reservoir evidence");
  assert.equal(asked.ideas[0].source.available, true);
  assert.equal(getCollaborationSnapshot(state, ctx(professor)).notifications.length, 1);
  assert.equal(getCollaborationSnapshot(state, ctx(peer)).notifications.length, 0);
  const answered = comment(state, "ideas", asked.result_id, "염도 조건도 함께 확인해 보세요.", professor);
  assert.equal(answered.comments[0].author_id, professor.id); assert.equal(answered.comments[0].body, "염도 조건도 함께 확인해 보세요.");
  const reverse = create(state, "ideas", idea({ title: "다음 분석 방향", recipient_ids: [student.id], source: { type: "page", id: "page-analysis", title: "", excerpt: "" } }), professor);
  comment(state, "ideas", reverse.result_id, "두 온도 조건으로 비교하겠습니다.", student);
  assert.equal(state.collaboration.comments.length, 2);
  patch(state, "ideas", reverse.result_id, { status: "resolved" }, professor);
  assert.equal(state.collaboration.ideas[1].status, "resolved");
  preserves(state, () => patch(state, "ideas", asked.result_id, { status: "resolved" }, peer), 403);
});

test("shared calendar accepts participant editing, inclusive dates, timed spans and explicit deletion", () => {
  const state = workspace(), created = create(state, "events", event({ all_day: true, start_time: "10:00", end_time: "11:00", end_date: "2026-10-22" }));
  assert.equal(created.result.start_time, ""); assert.equal(created.result.end_time, "");
  const edited = patch(state, "events", created.result_id, { title: "주간 연구 미팅", participant_ids: [student.id] }, student);
  assert.equal(edited.result.created_by, professor.id); assert.equal(edited.result.title, "주간 연구 미팅");
  preserves(state, () => create(state, "events", event({ start_date: "2026-02-29" })));
  preserves(state, () => create(state, "events", event({ start_time: "11:00", end_time: "10:00" })));
  preserves(state, () => create(state, "events", event({ end_date: "2026-10-19" })));
  preserves(state, () => create(state, "events", event({ participant_ids: [pending.id] })));
  preserves(state, () => create(state, "events", event({ project_id: "foreign-project" })));
  preserves(state, () => applyCollaborationCommand(state, ["collaboration", "events", created.result_id], "DELETE", { expected_revision: rev(state), confirm: false }, ctx()));
  applyCollaborationCommand(state, ["collaboration", "events", created.result_id], "DELETE", { expected_revision: rev(state, student), confirm: true }, ctx(student));
  assert.equal(state.collaboration.events.length, 0); assert.equal(state.collaboration.requests.length, 1);
});

test("assigned task uses Korean +6 deadline and assignee submits before supervisor completes", () => {
  const state = workspace(), created = create(state, "tasks", task());
  assert.equal(created.result.due_date, "2026-10-24"); assert.equal(created.result.assigned_by, professor.id); assert.equal(created.result.assignee_id, student.id);
  assert.equal(getCollaborationSnapshot(state, ctx(student)).notifications[0].kind, "assignment");
  patch(state, "tasks", created.result_id, { status: "in_progress" }, student);
  comment(state, "tasks", created.result_id, "중간 자료를 정리했습니다.", student);
  const submitted = patch(state, "tasks", created.result_id, { status: "submitted" }, student);
  assert.equal(submitted.result.status, "submitted");
  const ownerInbox = getCollaborationSnapshot(state, ctx(professor)).notifications;
  assert.equal(ownerInbox.filter(row => row.kind === "submission").length, 1);
  assert.equal(getCollaborationSnapshot(state, ctx(peer)).notifications.length, 0);
  preserves(state, () => patch(state, "tasks", created.result_id, { status: "done" }, student), 403);
  preserves(state, () => patch(state, "tasks", created.result_id, { due_date: "2026-10-25" }, student), 403);
  preserves(state, () => patch(state, "tasks", created.result_id, { status: "submitted" }, peer), 403);
  patch(state, "tasks", created.result_id, { status: "done" }, professor);
  preserves(state, () => patch(state, "tasks", created.result_id, { status: "in_progress" }, student), 403);
  const reassigned = patch(state, "tasks", created.result_id, { status: "todo", assignee_id: peer.id }, professor);
  assert.equal(reassigned.result.assigned_by, professor.id); assert.equal(reassigned.result.assignee_name, peer.name);
  preserves(state, () => patch(state, "tasks", created.result_id, { assigned_by: peer.id }, professor));
  preserves(state, () => create(state, "tasks", task({ assignee_id: viewer.id })));
  preserves(state, () => patch(state, "tasks", created.result_id, { assignee_id: viewer.id }, professor));
});

test("an editor can assign another editor and retains supervisor authority after reassignment", () => {
  const state = workspace(), created = create(state, "tasks", task(), peer);
  assert.equal(created.result.assigned_by, peer.id);
  patch(state, "tasks", created.result_id, { status: "submitted" }, student);
  assert.equal(getCollaborationSnapshot(state, ctx(peer)).notifications.filter(row => row.kind === "submission").length, 1);
  assert.equal(getCollaborationSnapshot(state, ctx(professor)).notifications.filter(row => row.kind === "submission").length, 0);
  patch(state, "tasks", created.result_id, { status: "done" }, peer);
  patch(state, "tasks", created.result_id, { assignee_id: professor.id, status: "todo" }, professor);
  assert.equal(state.collaboration.tasks[0].assigned_by, peer.id);
  patch(state, "tasks", created.result_id, { description: "배정자의 후속 지시", status: "in_progress" }, peer);
  assert.equal(state.collaboration.tasks[0].description, "배정자의 후속 지시");
});

test("viewer, outsider, pending and forged elevated context cannot mutate shared records", () => {
  const state = workspace(); create(state, "events", event());
  preserves(state, () => create(state, "ideas", idea(), viewer), 403);
  const outsider = { ...student, id: "foreign-user" };
  preserves(state, () => getCollaborationSnapshot(state, ctx(outsider)), 403);
  preserves(state, () => create(state, "events", event(), pending), 403);
  preserves(state, () => create(state, "events", event(), { ...viewer, role: "owner" }), 403);
  assert.equal(getCollaborationSnapshot(state, ctx(viewer)).permissions.can_edit, false);
  assert.equal(getCollaborationSnapshot(state, ctx(viewer)).events.length, 1);
});

test("CAS conflict preserves concurrent records and retry dedup precedes the stale guard", () => {
  const state = workspace(), initial = rev(state), requestId = uuid(), firstBody = event();
  const first = create(state, "events", firstBody, professor, requestId, initial);
  const second = create(state, "ideas", idea(), student);
  assert.equal(state.collaboration.events.length, 1); assert.equal(state.collaboration.ideas.length, 1);
  const beforeRetry = structuredClone(state), retry = create(state, "events", { ...firstBody }, professor, requestId, initial);
  assert.equal(retry.result_id, first.result_id); assert.deepEqual(retry.result, first.result); assert.equal(retry.changed, false); assert.equal(retry.idempotent, true); assert.deepEqual(state, beforeRetry); assert.equal(retry.revision, second.revision);
  preserves(state, () => applyCollaborationCommand(state, ["collaboration", "events"], "POST", { event: firstBody, request_id: requestId }, ctx()));
  preserves(state, () => create(state, "events", { ...firstBody, title: "changed" }, professor, requestId, initial), 409);
  preserves(state, () => create(state, "events", firstBody, student, requestId, initial), 409);
  preserves(state, () => create(state, "ideas", idea(), professor, requestId, initial), 409);
  preserves(state, () => patch(state, "events", first.result_id, { title: "stale edit" }, professor, initial), 409);
  preserves(state, () => create(state, "tasks", task(), professor, uuid(), initial), 409);
  patch(state, "events", first.result_id, { title: "Updated later" }, professor);
  assert.deepEqual(create(state, "events", firstBody, professor, requestId, initial).result, first.result);
});

test("comment creation retries do not duplicate replies or notifications", () => {
  const state = workspace(), thread = create(state, "ideas", idea(), student), requestId = uuid(), expected = rev(state);
  const one = comment(state, "ideas", thread.result_id, "검토했습니다.", professor, requestId, expected), before = structuredClone(state);
  const retry = comment(state, "ideas", thread.result_id, "검토했습니다.", professor, requestId, expected);
  assert.equal(retry.result_id, one.result_id); assert.equal(retry.changed, false); assert.deepEqual(state, before);
  preserves(state, () => comment(state, "ideas", thread.result_id, "다른 답변", professor, requestId, expected), 409);
});

test("body-supplied authors, arbitrary recipients, unsafe sources and unknown fields are rejected", () => {
  const state = workspace();
  for (const value of [idea({ author_id: professor.id }), idea({ recipient_ids: ["foreign-user"] }), idea({ recipient_ids: [pending.id] }), idea({ recipient_ids: [student.id, student.id] }), idea({ source: { type: "paper", id: "foreign-paper", title: "외부 자료", excerpt: "" } }), idea({ source: { type: "paper", id: "paper-ccs", title: "", excerpt: "", url: "https://foreign.example" } }), idea({ source: { type: "none", id: "paper-ccs", title: "", excerpt: "" } })]) preserves(state, () => create(state, "ideas", value));
  preserves(state, () => create(state, "tasks", task({ assigned_by: "foreign-user" })));
  preserves(state, () => create(state, "tasks", task({ source_idea_id: "foreign-idea" })));
  preserves(state, () => create(state, "tasks", task({ due_date: "2026-11-31" })));
  const thread = create(state, "ideas", idea(), student);
  preserves(state, () => applyCollaborationCommand(state, ["collaboration", "ideas", thread.result_id, "comments"], "POST", { body: "Spoof", author_id: professor.id, expected_revision: rev(state), request_id: uuid() }, ctx(student)));
  preserves(state, () => applyCollaborationCommand(state, ["collaboration", "notifications", "read"], "POST", { ids: [], recipient_id: professor.id, expected_revision: rev(state) }, ctx(student)));
});

test("notifications are scoped to the current accepted actor and reading cannot touch another inbox", () => {
  const state = workspace(), created = create(state, "ideas", idea({ recipient_ids: [] }), student);
  const owner = getCollaborationSnapshot(state, ctx(professor)), colleague = getCollaborationSnapshot(state, ctx(peer));
  assert.equal(owner.notifications.length, 1); assert.equal(colleague.notifications.length, 1); assert.equal(getCollaborationSnapshot(state, ctx(student)).notifications.length, 0);
  preserves(state, () => applyCollaborationCommand(state, ["collaboration", "notifications", "read"], "POST", { ids: [owner.notifications[0].id], expected_revision: rev(state, peer) }, ctx(peer)), 403);
  const read = applyCollaborationCommand(state, ["collaboration", "notifications", "read"], "POST", { ids: [], expected_revision: rev(state) }, ctx());
  assert.ok(read.notifications[0].read_at); assert.equal(getCollaborationSnapshot(state, ctx(peer)).notifications[0].read_at, "");
  assert.equal(created.ideas.length, 1); assert.equal(Object.hasOwn(read, "requests"), false);
});

test("export and restore preserve history without granting foreign memberships or deleting removed sources", () => {
  const state = workspace(), shared = create(state, "ideas", idea(), student); create(state, "tasks", task({ source_idea_id: shared.result_id }));
  const imported = JSON.parse(JSON.stringify(state.collaboration)); assert.deepEqual(validateCollaboration(imported), state.collaboration);
  state.papers = []; state.projects = []; state.researchPages = [];
  const snapshot = getCollaborationSnapshot(state, ctx());
  assert.equal(snapshot.ideas[0].source.available, false); assert.equal(snapshot.ideas[0].source.title, "CCS reservoir evidence");
  assert.equal(snapshot.tasks[0].project_id, "project-ccs");
  comment(state, "ideas", shared.result_id, "원문은 제거되었지만 논의는 보존합니다.", professor);
  const remaining = members.filter(row => row.id !== student.id);
  assert.equal(getCollaborationSnapshot(state, ctx(professor, { members: remaining })).ideas[0].author_name, student.name);
  preserves(state, () => applyCollaborationCommand(state, ["collaboration", "tasks", state.collaboration.tasks[0].id], "PATCH", { changes: { assignee_id: student.id }, expected_revision: rev(state) }, ctx(professor, { members: remaining })));
  const missingField = structuredClone(state.collaboration); delete missingField.ideas[0].recipient_ids;
  assert.throws(() => validateCollaboration(missingField), error => error.status === 422);
  const normalizedAway = structuredClone(state.collaboration); normalizedAway.ideas[0].title = "  padded title  ";
  assert.throws(() => validateCollaboration(normalizedAway), error => error.status === 422);
  const malformed = structuredClone(state.collaboration); malformed.notifications[0].recipient_id = "../../foreign";
  assert.throws(() => validateCollaboration(malformed), error => error.status === 422);
  const dangling = structuredClone(state.collaboration); dangling.comments[0].target_id = "nonexistent-idea";
  assert.throws(() => validateCollaboration(dangling), error => error.status === 422);
  const spoof = structuredClone(state.collaboration); spoof.requests[0].actor_id = professor.id;
  assert.throws(() => validateCollaboration(spoof), error => error.status === 422);
});

test("capacity rejects the entire command and retains all existing records", () => {
  const state = workspace(); create(state, "events", event());
  state.collaboration.events = Array.from({ length: 2000 }, (_, index) => ({ ...state.collaboration.events[0], id: `event-${index}` }));
  preserves(state, () => create(state, "events", event()));
  assert.equal(state.collaboration.events.length, 2000);
});

test("long valid titles save and only derived notification summaries are bounded", () => {
  const state = workspace(), longOwner = { ...professor, name: "가".repeat(300) }, customMembers = [longOwner, student];
  const result = applyCollaborationCommand(state, ["collaboration", "ideas"], "POST", { idea: idea({ title: "나".repeat(300), recipient_ids: [student.id] }), expected_revision: "1".padStart(64, "0"), request_id: uuid() }, ctx(longOwner, { members: customMembers }));
  assert.equal(result.ideas[0].title.length, 300); assert.equal(state.collaboration.notifications[0].title.length, 500);
});

test("browser mode has exactly the real local actor and does not create pretend colleagues", () => {
  const state = workspace(), local = { ...professor, id: "local-browser", name: "이 브라우저", email: "" }, localCtx = ctx(local, { members: [local], mode: "browser" });
  const result = applyCollaborationCommand(state, ["collaboration", "ideas"], "POST", { idea: idea({ recipient_ids: [] }), expected_revision: "1".padStart(64, "0"), request_id: uuid() }, localCtx);
  assert.equal(result.members.length, 1); assert.equal(result.notifications.length, 0); assert.equal(result.actor.id, local.id); assert.equal(result.mode, "browser");
  preserves(state, () => getCollaborationSnapshot(state, ctx(professor, { mode: "browser" })), 403);
});
