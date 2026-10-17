import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as THREE from "three";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../app/components/ResearchMap3D.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const layout = {
  nodes: [{ id: "a", x: -70, y: 15, z: 30, radius: 6, degree: 1, cluster: 0 }, { id: "b", x: 70, y: -15, z: -30, radius: 6, degree: 1, cluster: 1 }],
  edges: [{ id: "ab", source: "a", target: "b", kind: "shares_topics", similarity: 0.6 }],
};

function environment(t, { webgl = true, initialWidth = 800 } = {}) {
  const previous = Object.fromEntries(["window", "document", "ResizeObserver"].map((key) => [key, globalThis[key]]));
  const frames = new Map(); let frameId = 0;
  const refs = []; const effects = []; const states = [];
  const renderers = []; const orbitInstances = [];
  const selected = []; const zooms = [];
  let resizeCallback;
  class Element extends EventTarget {
    clientWidth = initialWidth; clientHeight = 560; removed = false; captured = new Set(); children = [];
    setAttribute() {}
    focus() { this.focused = true; }
    appendChild(child) { this.children.push(child); }
    remove() { this.removed = true; }
    getBoundingClientRect() { return { left: 0, top: 0, width: host.clientWidth || 1000, height: host.clientHeight }; }
    setPointerCapture(id) { this.captured.add(id); }
    hasPointerCapture(id) { return this.captured.has(id); }
    releasePointerCapture(id) { this.captured.delete(id); }
    getContext(kind) { return kind === "2d" ? { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} } : null; }
  }
  const host = new Element(); const svg = new Element();
  class Renderer {
    constructor() { if (!webgl) throw new Error("No WebGL"); this.domElement = new Element(); renderers.push(this); }
    setPixelRatio(value) { this.dpr = value; }
    setSize(width, height) { this.size = [width, height]; }
    render(scene, camera) { this.scene = scene; this.camera = camera; this.drawCount = (this.drawCount || 0) + 1; }
    dispose() { this.disposed = true; }
  }
  class Controls {
    constructor(camera, element) { this.camera = camera; this.element = element; this.target = new THREE.Vector3(); this.touches = {}; this.listeners = new Map(); orbitInstances.push(this); }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    update() { this.listeners.get("change")?.(); }
    dispose() { this.disposed = true; }
  }
  globalThis.window = { devicePixelRatio: 4, requestAnimationFrame: (fn) => { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame: (id) => frames.delete(id), addEventListener() {}, removeEventListener() {} };
  globalThis.document = { createElement: () => new Element() };
  globalThis.ResizeObserver = class { constructor(callback) { resizeCallback = callback; } observe() {} disconnect() { this.disconnected = true; } };
  t.after(() => { for (const key of Object.keys(previous)) if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key]; });
  const api = { current: null };
  const react = {
    forwardRef: (fn) => (props) => fn(props, api),
    useId: () => "test-gradient",
    useRef: (value) => { const ref = { current: refs.length === 0 ? host : refs.length === 1 ? svg : value }; refs.push(ref); return ref; },
    useState: (initial) => { const index = states.length; states.push(initial); return [initial, (value) => { states[index] = value; }]; },
    useEffect: (effect) => effects.push(effect),
    useImperativeHandle: (ref, create) => { ref.current = create(); },
  };
  const module = { exports: {} };
  const localRequire = (name) => name === "react" ? react : name === "three" ? { ...THREE, WebGLRenderer: Renderer } : name === "three/addons/controls/OrbitControls.js" ? { OrbitControls: Controls } : name === "./ResearchMap" ? { mapClusterColor: (cluster) => ["#329ee8", "#edbd73"][cluster % 2] } : require(name);
  new Function("require", "module", "exports", compiled)(localRequire, module, module.exports);
  module.exports.ResearchMap3D({ layout, works: new Map([{ id: "a", title: "Alpha & evidence", year: 2024 }, { id: "b", title: "Beta", year: 2025 }].map((work) => [work.id, work])), selectedId: null, onSelect: (id) => selected.push(id), locale: "ko", height: 560, descriptionId: "help", onZoomChange: (zoom) => zooms.push(zoom) });
  const cleanups = effects.map((effect) => effect()).filter((cleanup) => typeof cleanup === "function");
  function flush() { for (let step = 0; frames.size && step < 10; step++) { const entries = [...frames.entries()]; frames.clear(); for (const [, fn] of entries) fn(); } assert.equal(frames.size, 0, "no perpetual animation loop"); }
  function dispatch(element, type, values = {}) { const event = new Event(type, { cancelable: true }); Object.assign(event, { pointerId: 1, button: 0, clientX: 300, clientY: 250, shiftKey: false, ...values }); element.dispatchEvent(event); return event; }
  flush();
  return { host, svg, states, refs, renderers, orbitInstances, selected, zooms, api: api.current, flush, dispatch, resize: () => resizeCallback(), cleanup: () => cleanups.forEach((cleanup) => cleanup()) };
}

test("3D controls change perspective on demand and selecting a paper preserves the camera", (t) => {
  const env = environment(t);
  const renderer = env.renderers[0]; const orbit = env.orbitInstances[0];
  assert.equal(orbit.autoRotate, false); assert.equal(orbit.enableDamping, false); assert.equal(renderer.dpr, 2);
  const start = renderer.camera.position.clone();
  env.api.zoomBy(1.25); env.flush();
  assert.ok(renderer.camera.position.length() < start.length());
  const zoomed = renderer.camera.position.clone();
  env.refs[3].current = "a"; env.refs[2].current.updateSelection(); env.flush();
  assert.deepEqual(renderer.camera.position.toArray(), zoomed.toArray());
  assert.equal(env.renderers.length, 1);
  const alpha = renderer.scene.children.find((object) => object.userData.paperId === "a");
  assert.equal(alpha.material.emissiveIntensity, 0.85);
  env.api.focus("a"); env.flush();
  assert.deepEqual(orbit.target.toArray(), [-70, 15, 30]);
  const snapshot = env.api.snapshotSvg();
  assert.match(snapshot, /Alpha &amp; evidence/); assert.match(snapshot, /<circle/); assert.match(snapshot, /Perspective projection/);
  env.api.reset(); env.flush(); assert.deepEqual(orbit.target.toArray(), [0, 0, 0]);
  let disposedGeometry = 0; alpha.geometry.addEventListener("dispose", () => disposedGeometry++);
  env.cleanup();
  assert.equal(disposedGeometry, 1); assert.equal(renderer.disposed, true); assert.equal(orbit.disposed, true); assert.equal(renderer.domElement.removed, true);
});

test("WebGL loss removes its canvas and the projected map remains rotatable, zoomable and exportable", (t) => {
  const env = environment(t); const renderer = env.renderers[0];
  // Lose the context midway through a gesture; SVG starts with a clean pointer set.
  env.dispatch(renderer.domElement, "pointerdown");
  env.dispatch(renderer.domElement, "webglcontextlost"); env.flush();
  assert.equal(renderer.domElement.removed, true); assert.equal(env.states[0], "svg");
  const before = env.states[2].nodes.map((node) => [node.x, node.y]);
  env.dispatch(env.svg, "pointerdown");
  env.dispatch(env.svg, "pointermove", { clientX: 380, clientY: 275 });
  env.dispatch(env.svg, "pointerup", { clientX: 380, clientY: 275 }); env.flush();
  assert.notDeepEqual(env.states[2].nodes.map((node) => [node.x, node.y]), before);
  const oldZoom = env.zooms.at(-1);
  env.dispatch(env.svg, "wheel", { deltaY: -100 }); env.flush(); assert.ok(env.zooms.at(-1) > oldZoom);
  assert.match(env.api.snapshotSvg(), /<line/); assert.deepEqual(env.selected, [], "rotating cannot select a paper");
  env.cleanup();
});

test("an unsupported WebGL browser gets an operable 3D projection and an initially hidden narrow map fits on reveal", (t) => {
  const env = environment(t, { webgl: false, initialWidth: 0 });
  assert.equal(env.states[0], "svg"); assert.equal(env.renderers.length, 0);
  env.host.clientWidth = 280; env.resize(); env.flush();
  assert.equal(env.states[2].width, 280);
  for (const node of env.states[2].nodes) assert.ok(node.x > 0 && node.x < 280 && node.y > 0 && node.y < 560);
  const paper = env.states[2].nodes.find((node) => node.id === "a");
  env.dispatch(env.svg, "pointerdown", { clientX: paper.x, clientY: paper.y });
  env.dispatch(env.svg, "pointerup", { clientX: paper.x, clientY: paper.y });
  assert.deepEqual(env.selected, ["a"]);
  env.cleanup();
});
