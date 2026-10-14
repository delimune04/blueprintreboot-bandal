import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createDemoAdapter, createDemoSeed, DEMO_STORAGE_KEY } from "../demo/adapter.mjs";
import { blankReviewInput, newWorkflowRow, reviewInput, exportReviewMarkdown } from "./model.mjs";

// Exercise the actual JSX callbacks without a browser, using the same React
// runtime as the app. Browser layout and interaction checks remain separate.
const componentSource = readFileSync(new URL("../../components/ReviewWorkflow.tsx", import.meta.url), "utf8");
const componentJs = ts.transpileModule(componentSource, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
  .replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")))
  .replaceAll('"../lib/review/model.mjs"', JSON.stringify(new URL("./model.mjs", import.meta.url).href));
const { ReviewWorkflow, ReviewContextEditor, FrozenWorkflowContext } = await import(`data:text/javascript;base64,${Buffer.from(componentJs).toString("base64")}`);

function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== "object") return [];
  return [node, ...descendants(node.props?.children)];
}
function label(node) {
  if (Array.isArray(node)) return node.map(label).join("");
  if (node === null || node === undefined || typeof node === "boolean") return "";
  return typeof node === "object" ? label(node.props?.children) : String(node);
}
function derive(row, rows) {
  let result;
  const editor = ReviewContextEditor({ row, rows, readonly: false, ko: false, update() {}, add(value) { result = value; } });
  const button = descendants(editor).find(node => node.type === "button" && label(node).startsWith("Carry evidence"));
  assert.ok(button, "The derivation action is present");
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  return result;
}
function setup(t) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const core = new Map([[DEMO_STORAGE_KEY, JSON.stringify(createDemoSeed())]]);
  const pages = new Map();
  const localStorage = { getItem: key => pages.get(key) ?? null, setItem: (key, value) => pages.set(key, value), removeItem: key => pages.delete(key) };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request: async (_name, options, callback) => (callback || options)() } } });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else delete globalThis.window;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator); else delete globalThis.navigator;
  });
  const storage = {
    getItem: async key => core.get(key) ?? null,
    setItem: async (key, value) => core.set(key, value),
    compareAndSet: async (key, expected, value) => { if (core.get(key) !== expected) return false; core.set(key, value); return true; },
  };
  function session() {
    const adapter = createDemoAdapter(storage);
    return async (method = "GET", body, suffix = "") => {
      const response = await adapter(`/projects/demo-storage/review${suffix}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json() };
    };
  }
  return { core, session };
}

test("component-derived evidence chain survives guest save, reload, freeze and export with stale writes rejected", async t => {
  const { core, session } = setup(t), request = session();
  const initial = await request();
  assert.equal(initial.status, 200);
  const comparison = newWorkflowRow("comparison");
  Object.assign(comparison, { text: "[Local QA fixture] Compare protocol A", provenance: "ai", status: "reviewed", source_links: [initial.data.sources[0].reference] });
  Object.assign(comparison.context, { method: "Fixture protocol A", conditions: "Synthetic room-temperature condition", metric: "Synthetic score", value: "42", unit: "N/A", availability: "reported", rationale: "Fixture evidence only; not an experimental result." });
  const decision = derive(comparison, [comparison]);
  assert.equal(decision.provenance, "ai");
  assert.equal(decision.status, "open");
  assert.deepEqual(decision.source_links, comparison.source_links);
  assert.notEqual(decision.source_links[0], comparison.source_links[0]);
  assert.deepEqual(decision.context.comparison_ids, [comparison.id]);
  decision.status = "reviewed";
  decision.context.disposition = "rejected";
  decision.text = "[Local QA fixture] Reject protocol A until the control is repeated";
  const handoff = derive(decision, [comparison, decision]);
  assert.equal(handoff.provenance, "ai");
  assert.equal(handoff.status, "open");
  assert.equal(handoff.context.origin_decision_id, decision.id);
  assert.deepEqual(handoff.context.comparison_ids, [comparison.id]);
  handoff.owner = "Fixture successor";
  handoff.due_date = "2026-10-20";
  const dossier = blankReviewInput();
  dossier.rows = [comparison, decision, handoff];
  dossier.checklist = Object.fromEntries(Object.keys(dossier.checklist).map(kind => [kind, true]));
  const saved = await request("PUT", { dossier, expected_revision: initial.data.revision });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const reloaded = await session()();
  assert.deepEqual(reviewInput(reloaded.data.dossier), dossier);

  const beforeStaleWrite = core.get(DEMO_STORAGE_KEY);
  const staleSave = await request("PUT", { dossier, expected_revision: initial.data.revision });
  const staleFreeze = await request("POST", { expected_revision: initial.data.revision, reviewed_by: "Fixture reviewer", confirm: true }, "/freeze");
  assert.equal(staleSave.status, 409);
  assert.equal(staleFreeze.status, 409);
  assert.equal(core.get(DEMO_STORAGE_KEY), beforeStaleWrite);

  const frozen = await request("POST", { expected_revision: reloaded.data.revision, reviewed_by: "Fixture reviewer", confirm: true }, "/freeze");
  assert.equal(frozen.status, 200, JSON.stringify(frozen.data));
  assert.deepEqual(frozen.data.snapshot.input, dossier);
  assert.equal(frozen.data.snapshot.source_inputs.length, 1);
  const snapshotBytes = JSON.stringify(frozen.data.snapshot);
  const markdown = exportReviewMarkdown(frozen.data.snapshot, "Local QA fixture");
  for (const expected of ["Value: 42", "Unit: N/A", "Disposition: rejected", `Origin decision record ID: \`${decision.id}\``, "AI origin", "owner: Fixture successor", "First action completed: no"]) assert.ok(markdown.includes(expected), expected);
  const changed = reviewInput(frozen.data.dossier);
  changed.rows[2].context.completed = true;
  const changedSave = await request("PUT", { dossier: changed, expected_revision: frozen.data.revision });
  assert.equal(changedSave.status, 200);
  const final = await session()();
  assert.equal(final.data.dossier.rows[2].context.completed, true);
  assert.equal(JSON.stringify(final.data.dossier.snapshots[0]), snapshotBytes);
});

test("workflow displays missing units and frozen context, and exposes disabled add/derive controls when read-only", () => {
  const row = newWorkflowRow("comparison"); row.text = "Fixture comparison";
  Object.assign(row.context, { availability: "reported", value: "42", unit: "", method: "Fixture method", conditions: "Fixture conditions", rationale: "Fixture rationale" });
  const props = { rows: [row], readonly: true, ko: false, update() {}, add() { assert.fail("Read-only render must not add records"); } };
  const workflow = ReviewWorkflow(props);
  assert.match(renderToStaticMarkup(workflow), /42 \(unit missing\)/);
  assert.ok(descendants(workflow).filter(node => node.type === "button").every(node => node.props.disabled));
  const editor = ReviewContextEditor({ ...props, row });
  assert.equal(descendants(editor).find(node => node.type === "button").props.disabled, true);
  const frozen = renderToStaticMarkup(FrozenWorkflowContext({ row, ko: false }));
  for (const expected of ["Fixture method", "Fixture conditions", "Fixture rationale", "42", "reported"]) assert.ok(frozen.includes(expected), expected);
});

test("archived guest projects reject workflow mutations without replacing saved data", async t => {
  const { core, session } = setup(t);
  const seed = JSON.parse(core.get(DEMO_STORAGE_KEY)); seed.projects[0].status = "archived";
  core.set(DEMO_STORAGE_KEY, JSON.stringify(seed));
  const request = session(), initial = await request(), before = core.get(DEMO_STORAGE_KEY);
  const dossier = blankReviewInput(), row = newWorkflowRow("handoff"); row.text = "[Local QA fixture] This must not save"; dossier.rows = [row];
  const saved = await request("PUT", { dossier, expected_revision: initial.data.revision });
  assert.equal(saved.status, 409);
  assert.match(saved.data.detail, /Restore this project/);
  assert.equal(core.get(DEMO_STORAGE_KEY), before);
});
