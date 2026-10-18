import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createCollaborationMutationGate } from "../app/components/collaboration/mutation-gate.mjs";
import { todayInSeoul, addCalendarDays } from "../app/lib/collaboration/calendar.mjs";

const require = createRequire(import.meta.url);
const cache = new Map();
const api = { getWorkspaceStorageScope: () => "actor:lab", apiClient: { getAllProjects: async () => [] }, labviumRequest: async () => { throw new Error("SSR must not submit commands"); }, ApiClientError: class extends Error {} };
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const source = readFileSync(path, "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiledModule = { exports: {} }; cache.set(path, compiledModule.exports);
  const localRequire = name => {
    if (name.endsWith(".css")) return {};
    if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
    if (name.endsWith("/api/client")) return api;
    if (name.endsWith("/i18n/LocaleProvider")) return { useI18n: () => ({ locale: "ko", t: value => value }) };
    if (!name.startsWith(".")) return require(name);
    const location = resolve(dirname(path), name);
    if (name.endsWith(".mjs")) return require(location);
    const found = [location, `${location}.tsx`, `${location}.ts`].find(existsSync);
    if (!found) throw new Error(`Missing test dependency: ${location}`);
    return load(found);
  };
  new Function("require", "module", "exports", compiled)(localRequire, compiledModule, compiledModule.exports);
  cache.set(path, compiledModule.exports); return compiledModule.exports;
}
const { CollaborationSurface } = load(fileURLToPath(new URL("../app/views/CollaborationView.tsx", import.meta.url)));
const { TaskForm, EventForm, newTask, newEvent, validDraftShape } = load(fileURLToPath(new URL("../app/components/collaboration/CollaborationForms.tsx", import.meta.url)));
const actor = { id: "professor", name: "이 교수", email: "prof@example.test", role: "owner", accepted: true };
const student = { id: "student", name: "김 학생", email: "student@example.test", role: "editor", accepted: true };
const viewer = { id: "viewer", name: "읽기 구성원", email: "viewer@example.test", role: "viewer", accepted: true };
const date = todayInSeoul();
const snapshot = {
  revision: "a".repeat(64), actor, members: [actor, student, viewer], mode: "cloud", time_zone: "Asia/Seoul", permissions: { can_edit: true, can_assign: true },
  events: [{ ...newEvent(), id: "meeting", title: "주간 연구 검토", start_date: date, end_date: date, created_by: actor.id, created_by_name: actor.name, created_at: "2026-10-18T00:00:00Z", updated_at: "2026-10-18T00:00:00Z" }],
  ideas: [{ id: "idea1", title: "염도 조건을 나누면 어떨까요?", body: "조건별로 비교합시다.", recipient_ids: [student.id], source: { type: "paper", id: "paper1", title: "공극률 실험", excerpt: "조건 A", available: true }, status: "open", author_id: actor.id, author_name: actor.name, created_at: "2026-10-18T00:00:00Z", updated_at: "2026-10-18T00:00:00Z" }],
  tasks: [{ ...newTask(student.id), id: "task1", title: "실험 조건 세 가지 비교", description: "표에 단위를 적어주세요.", assigned_by: actor.id, assigned_by_name: actor.name, assignee_name: student.name, due_date: date, status: "todo", created_at: "2026-10-18T00:00:00Z", updated_at: "2026-10-18T00:00:00Z" }],
  comments: [{ id: "comment1", target_type: "idea", target_id: "idea1", body: "좋습니다. 온도도 확인해 주세요.", author_id: student.id, author_name: student.name, created_at: "2026-10-18T01:00:00Z", updated_at: "2026-10-18T01:00:00Z" }],
  notifications: [{ id: "notice1", title: "새 연구 의견이 도착했습니다", target_type: "idea", target_id: "idea1", actor_id: student.id, actor_name: student.name, created_at: "2026-10-18T01:00:00Z", read_at: "" }],
};
const render = (overrides = {}, props = {}) => renderToStaticMarkup(React.createElement(CollaborationSurface, { initial: { ...snapshot, ...overrides }, scope: "actor:lab", ...props }));

test("rendered shared calendar exposes exact dates, keyboard buttons and distinct task deadlines", () => {
  const html = render();
  assert.match(html, /공유 캘린더/); assert.match(html, /한국 시간 · Asia\/Seoul/);
  assert.match(html, /aria-label="이전 달"/); assert.match(html, /aria-label="다음 달"/);
  assert.equal((html.match(/class="collab-day /g) || []).length, 42);
  assert.match(html, /aria-label="[^"]+일정 1개, 업무 마감 1개"/);
  assert.match(html, /collab-day-item--task/); assert.match(html, /주간 연구 검토/);
  assert.match(html, /href="\/collaboration\/tasks\/task1"/);
});

test("rendered idea thread includes actual source, recipient and simple comments in both directions", () => {
  const html = render({}, { ideaId: "idea1" });
  assert.match(html, /aria-current="page"[^>]*><[^>]*.*?/);
  assert.match(html, /href="\/papers\/paper1"/); assert.match(html, /공극률 실험/);
  assert.match(html, /조건별로 비교합시다/); assert.match(html, /좋습니다。|좋습니다\. 온도도 확인해 주세요/);
  assert.match(html, /알림 대상: 김 학생/); assert.match(html, /댓글 남기기/);
  assert.match(html, /검토 완료로 표시/); assert.match(html, /이 아이디어로 업무 배정/);
});

test("viewer markup exposes shared reading without write controls or terminal assignee actions", () => {
  const readonly = render({ actor: viewer, permissions: { can_edit: false, can_assign: false } }, { ideaId: "idea1" });
  assert.match(readonly, /읽기 전용으로 보고 있습니다/);
  for (const label of ["일정 추가", "아이디어 묻기", "검토 완료로 표시", "댓글 등록", "완료 승인", "업무 배정</button>"]) assert.ok(!readonly.includes(label), label);
  const terminal = render({ actor: student, tasks: [{ ...snapshot.tasks[0], status: "done" }] }, { taskId: "task1" });
  assert.ok(!terminal.includes("진행 시작</button>")); assert.ok(!terminal.includes("제출·검토 요청</button>"));
});

test("browser workspace tells the truth about single-device storage and in-app notifications", () => {
  const html = render({ mode: "browser", members: [actor] }, { initialTab: "inbox" });
  assert.match(html, /이 기기의 개인 공간/); assert.match(html, /다른 사람에게 알림이 전달되지 않습니다/);
  assert.match(html, /이메일이나 문자로 발송되지는 않습니다/);
  assert.match(html, /href="\/collaboration\/ideas\/idea1"/); assert.match(html, /읽지 않음 1/);
});

test("rendered task form uses actual six-day date, accepted writable assignees and bounded controls", () => {
  const draft = newTask(student.id);
  const html = renderToStaticMarkup(React.createElement(TaskForm, { draft, change() {}, members: [actor, student, viewer, { ...student, id: "pending", name: "아직 미참여", accepted: false }], projects: [], ideas: [], busy: false, onSave() {}, onCancel() {}, editing: false }));
  assert.equal(draft.due_date, addCalendarDays(date, 6));
  assert.match(html, new RegExp(`value="${draft.due_date}"`)); assert.match(html, /오늘부터 6일 뒤/);
  assert.ok(!html.includes("읽기 구성원")); assert.ok(!html.includes("아직 미참여"));
  assert.match(html, /한국 시간 23:59까지/); assert.match(html, /닫기 · 초안 유지/);
  const locked = renderToStaticMarkup(React.createElement(EventForm, { draft: newEvent(), change() {}, members: [actor], projects: [], busy: true, onSave() {}, onCancel() {}, editing: false }));
  assert.match(locked, /<fieldset disabled=""/); assert.match(locked, /저장 중…/);
});

test("restored draft validation rejects mismatched nested shapes instead of crashing editors", () => {
  const expected = { id: "", revision: "", value: newEvent() };
  assert.equal(validDraftShape({ ...expected, value: { ...expected.value, title: "남아 있는 초안", participant_ids: ["student"] } }, expected), true);
  assert.equal(validDraftShape({ ...expected, value: null }, expected), false);
  assert.equal(validDraftShape({ ...expected, value: { ...expected.value, participant_ids: [{ id: "student" }] } }, expected), false);
  assert.equal(validDraftShape({ ...expected, value: { ...expected.value, all_day: "yes" } }, expected), false);
});

test("mutation gate locks double clicks and never reports a result before the server confirms", async () => {
  const calls = []; let resolve;
  const gate = createCollaborationMutationGate({ id: () => "request-one", request: async (path, options) => { calls.push({ path, ...options }); return new Promise(done => { resolve = done; }); } });
  const first = gate.run("/collaboration/ideas", "POST", { idea: { title: "A" } }, "old", true);
  assert.equal(gate.locked, true);
  assert.equal(await gate.run("/collaboration/ideas", "POST", { idea: { title: "A" } }, "old", true), null);
  assert.equal(calls.length, 1); assert.equal(calls[0].body.expected_revision, "old");
  resolve({ revision: "new" }); assert.deepEqual(await first, { revision: "new" }); assert.equal(gate.locked, false);
});

test("ambiguous retry reuses request id after refresh while changed text and a new workspace get new identities", async () => {
  let number = 0; const calls = []; let fail = true;
  const request = async (path, options) => { calls.push({ path, ...options }); if (fail) { fail = false; throw new Error("Connection interrupted after commit"); } return { revision: "saved" }; };
  const gate = createCollaborationMutationGate({ request, id: () => `request-${++number}` });
  await assert.rejects(gate.run("/collaboration/ideas", "POST", { idea: { title: "A" } }, "old", true));
  await gate.run("/collaboration/ideas", "POST", { idea: { title: "A" } }, "refreshed", true);
  assert.equal(calls[0].body.request_id, calls[1].body.request_id); assert.equal(calls[1].body.expected_revision, "refreshed");
  await gate.run("/collaboration/ideas", "POST", { idea: { title: "B" } }, "saved", true);
  assert.notEqual(calls[1].body.request_id, calls[2].body.request_id);
  const otherWorkspace = createCollaborationMutationGate({ request, id: () => `request-${++number}` });
  await otherWorkspace.run("/collaboration/ideas", "POST", { idea: { title: "A" } }, "other", true);
  assert.notEqual(calls[0].body.request_id, calls[3].body.request_id);
});
