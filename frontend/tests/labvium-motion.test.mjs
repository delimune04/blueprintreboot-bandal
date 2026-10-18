import { test } from "node:test";
import assert from "node:assert/strict";
import { mountLabviumMotion } from "../app/components/labvium-motion.mjs";

function fixture({ reduced = false } = {}) {
  const focusListeners = new Map(), mediaListeners = new Map();
  const elements = Array.from({ length: 2 }, (_, index) => ({
    contains: () => false,
    getAttribute: () => String(index),
    calls: [],
    animate(keyframes, options) {
      const animation = { cancelled: false, cancel() { this.cancelled = true; }, finished: new Promise(() => {}) };
      this.calls.push({ keyframes, options, animation });
      return animation;
    },
  }));
  const root = {
    ownerDocument: { activeElement: null },
    contains: (element) => elements.includes(element),
    querySelectorAll: () => elements,
    addEventListener: (name, handler) => focusListeners.set(name, handler),
    removeEventListener: (name, handler) => { if (focusListeners.get(name) === handler) focusListeners.delete(name); },
  };
  const preference = {
    matches: reduced,
    addEventListener: (name, handler) => mediaListeners.set(name, handler),
    removeEventListener: (name, handler) => { if (mediaListeners.get(name) === handler) mediaListeners.delete(name); },
  };
  const instances = [];
  class Observer {
    observed = new Set();
    disconnectCount = 0;
    constructor(callback) { this.callback = callback; instances.push(this); }
    observe(element) { this.observed.add(element); }
    unobserve(element) { this.observed.delete(element); }
    disconnect() { this.observed.clear(); this.disconnectCount++; }
    enter(element) { this.callback([{ target: element, isIntersecting: true }]); }
  }
  return { root, preference, Observer, elements, focusListeners, mediaListeners, get observer() { return instances[0]; } };
}

test("reduced motion and missing observer leave static visible content and attach no listeners", () => {
  const reduced = fixture({ reduced: true });
  mountLabviumMotion(reduced.root, reduced)();
  assert.equal(reduced.observer, undefined);
  assert.equal(reduced.focusListeners.size, 0);
  assert.equal(reduced.mediaListeners.size, 0);
  const unavailable = fixture();
  mountLabviumMotion(unavailable.root, { preference: unavailable.preference })();
  assert.equal(unavailable.observer, undefined);
  assert.ok(unavailable.elements.every((element) => element.calls.length === 0));
});

test("sections animate only once and unobserve without retaining offscreen work", () => {
  const state = fixture();
  const dispose = mountLabviumMotion(state.root, state);
  const [first, second] = state.elements;
  assert.equal(state.observer.observed.size, 2);
  state.observer.enter(first);
  state.observer.enter(first);
  state.observer.enter(second);
  assert.equal(first.calls.length, 1);
  assert.equal(second.calls.length, 1);
  assert.equal(state.observer.observed.size, 0);
  assert.equal(first.calls[0].options.fill, "none");
  assert.equal(second.calls[0].options.delay, 55);
  dispose();
  assert.ok(state.elements.every((element) => element.calls[0].animation.cancelled));
  assert.equal(state.focusListeners.size, 0);
  assert.equal(state.mediaListeners.size, 0);
});

test("keyboard focus stops a running entrance and prevents later hidden focused controls", () => {
  const state = fixture();
  const dispose = mountLabviumMotion(state.root, state);
  const [element, upcoming] = state.elements;
  state.observer.enter(element);
  state.focusListeners.get("focusin")({ target: { closest: () => element } });
  assert.equal(element.calls[0].animation.cancelled, true);
  state.focusListeners.get("focusin")({ target: { closest: () => upcoming } });
  state.observer.enter(upcoming);
  assert.equal(upcoming.calls.length, 0);
  assert.equal(state.observer.observed.size, 0);
  dispose();
});

test("changing motion preference cancels animations; cleanup ignores queued observer callbacks", () => {
  const state = fixture();
  const dispose = mountLabviumMotion(state.root, state);
  state.observer.enter(state.elements[0]);
  state.preference.matches = true;
  state.mediaListeners.get("change")();
  assert.equal(state.elements[0].calls[0].animation.cancelled, true);
  assert.equal(state.observer.observed.size, 0);
  dispose();
  state.preference.matches = false;
  state.observer.enter(state.elements[1]);
  assert.equal(state.elements[1].calls.length, 0);
});
