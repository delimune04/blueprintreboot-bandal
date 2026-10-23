/**
 * A progressive enhancement: no CSS hides these elements. Animation only starts
 * once an observed section enters the viewport; the underlying document always
 * remains visible when animation support, JavaScript or motion permission fails.
 *
 * @param {HTMLElement} root
 * @param {{ preference: MediaQueryList, Observer?: typeof IntersectionObserver }} environment
 */
export function mountLabviumMotion(root, { preference, Observer }) {
  if (preference.matches || !Observer) return () => {};
  const selector = "[data-lv-reveal]";
  const seen = new WeakSet();
  const running = new Map();
  let disposed = false;
  const stop = (element) => {
    seen.add(element);
    observer.unobserve(element);
    running.get(element)?.cancel();
    running.delete(element);
  };
  const observer = new Observer((entries) => {
    if (disposed || preference.matches) return;
    for (const entry of entries) {
      if (!entry.isIntersecting || seen.has(entry.target)) continue;
      const element = entry.target;
      seen.add(element);
      observer.unobserve(element);
      if (element.contains(root.ownerDocument.activeElement) || typeof element.animate !== "function") continue;
      const order = Math.min(5, Math.max(0, Number(element.getAttribute("data-lv-order")) || 0));
      const animation = element.animate([
        { opacity: 0, transform: "translate3d(0, 22px, 0) scale(.985)" },
        { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
      ], { duration: 760, delay: order * 55, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "none" });
      running.set(element, animation);
      animation.finished.then(() => running.delete(element), () => running.delete(element));
    }
  }, { threshold: 0.08, rootMargin: "0px 0px -20px 0px" });
  const onFocus = (event) => {
    const element = event.target?.closest?.(selector);
    if (element && root.contains(element)) stop(element);
  };
  const onPreference = () => {
    if (!preference.matches) return;
    observer.disconnect();
    for (const animation of running.values()) animation.cancel();
    running.clear();
  };
  root.querySelectorAll(selector).forEach((element) => observer.observe(element));
  root.addEventListener("focusin", onFocus);
  preference.addEventListener?.("change", onPreference);
  return () => {
    disposed = true;
    observer.disconnect();
    for (const animation of running.values()) animation.cancel();
    running.clear();
    root.removeEventListener("focusin", onFocus);
    preference.removeEventListener?.("change", onPreference);
  };
}

/**
 * A pointer-following highlight for cards marked with data-lv-spotlight. It
 * writes two custom properties on the hovered card at most once per frame and
 * is skipped for reduced motion or devices without a fine hover pointer.
 *
 * @param {HTMLElement} root
 * @param {{ preference: MediaQueryList, finePointer: MediaQueryList, requestFrame?: (callback: () => void) => number, cancelFrame?: (handle: number) => void }} environment
 */
export function mountLabviumSpotlight(root, { preference, finePointer, requestFrame = globalThis.requestAnimationFrame, cancelFrame = globalThis.cancelAnimationFrame }) {
  if (preference.matches || !finePointer.matches || typeof requestFrame !== "function") return () => {};
  let frame = 0;
  let pending = null;
  const flush = () => {
    frame = 0;
    if (!pending) return;
    const { element, x, y } = pending;
    pending = null;
    element.style.setProperty("--lv-x", `${x}px`);
    element.style.setProperty("--lv-y", `${y}px`);
  };
  const onMove = (event) => {
    const element = event.target?.closest?.("[data-lv-spotlight]");
    if (!element || !root.contains(element)) return;
    const box = element.getBoundingClientRect();
    pending = { element, x: Math.round(event.clientX - box.left), y: Math.round(event.clientY - box.top) };
    if (!frame) frame = requestFrame(flush);
  };
  root.addEventListener("pointermove", onMove, { passive: true });
  return () => {
    root.removeEventListener("pointermove", onMove);
    if (frame) cancelFrame?.(frame);
    frame = 0;
    pending = null;
  };
}
