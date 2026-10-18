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
      const order = Math.min(4, Math.max(0, Number(element.getAttribute("data-lv-order")) || 0));
      const animation = element.animate([
        { opacity: 0, transform: "translate3d(0, 14px, 0)" },
        { opacity: 1, transform: "translate3d(0, 0, 0)" },
      ], { duration: 640, delay: order * 55, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "none" });
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
