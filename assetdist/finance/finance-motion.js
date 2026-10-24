/* Bandal Finance motion layer. The app works without this file; it adds the
   motion toggle, sliding indicators, pointer light, count-ups, chart entrances
   and scroll reveals on top of what app.mjs renders. It never changes data. */
(() => {
  "use strict";

  const root = document.documentElement;
  root.classList.add("fx-js");

  const STORE_KEY = "bandal:motion"; // shared with the BANDAL STUDIO homepage
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

  let userPaused = root.classList.contains("motion-paused");
  const motionOff = () => userPaused || reduced.matches;

  /* Scroll reveals: once, then the content stays visible. */
  const REVEAL = ".feature-strip > div, .footer-mark";
  let revealObserver = null;
  function reveal(element) {
    element.classList.add("is-visible");
  }
  function revealAll() {
    $$(".fx-reveal:not(.is-visible)").forEach(reveal);
  }
  function setupReveals(scope) {
    const groups = new Map();
    for (const element of [scope, ...$$(REVEAL, scope)]) {
      if (!element.matches?.(REVEAL) || element.classList.contains("fx-reveal")) continue;
      const siblings = groups.get(element.parentElement) || 0;
      groups.set(element.parentElement, siblings + 1);
      element.style.setProperty("--i", String(siblings));
      // Anything already on screen is shown at once, so nothing blinks out.
      const box = element.getBoundingClientRect();
      if (motionOff() || !revealObserver || (box.height && box.top < window.innerHeight && box.bottom > 0))
        reveal(element);
      element.classList.add("fx-reveal");
      if (!element.classList.contains("is-visible")) revealObserver.observe(element);
    }
  }
  if ("IntersectionObserver" in window) {
    revealObserver = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          reveal(entry.target);
          revealObserver.unobserve(entry.target);
        }),
      { threshold: 0, rootMargin: "0px 0px -8% 0px" },
    );
  }
  // Keyboard focus never lands in content that is still waiting for its reveal.
  document.addEventListener("focusin", (event) => {
    const target = event.target.closest?.(".fx-reveal");
    if (target) reveal(target);
  });

  /* Count-ups run to the exact text app.mjs rendered; nothing is invented.
     Screen readers keep the final value; only an aria-hidden copy moves. */
  const COUNT =
    ".atlas-value, .metric-card > strong, .company-quote > strong, .price-current > strong, .result-metrics strong, .dcf-value, .return-number, .analyst-consensus strong, .debt-summary-facts strong, .arr-grid strong";
  const NUMBER = /^(\D*?)([+\-−]?)(\d[\d,]*(?:\.\d+)?)([\s\S]*)$/;
  const counting = new Set();
  let countObserver = null;
  function countUp(element) {
    if (element.dataset.fxCounted || motionOff()) return;
    const text = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && /\d/.test(node.nodeValue));
    const match = text && NUMBER.exec(text.nodeValue);
    if (!match) return;
    const [, prefix, sign, digits, suffix] = match;
    const target = Number(digits.replace(/,/g, ""));
    if (!Number.isFinite(target) || target === 0) return;
    element.dataset.fxCounted = "true";
    const decimals = (digits.split(".")[1] || "").length;
    const format = (value) =>
      prefix +
      sign +
      value.toLocaleString("ko-KR", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: digits.includes(","),
      }) +
      suffix;
    const spoken = document.createElement("span");
    spoken.className = "sr-only";
    spoken.textContent = text.nodeValue;
    const shown = document.createElement("span");
    shown.className = "fx-count";
    shown.setAttribute("aria-hidden", "true");
    shown.textContent = format(0);
    text.replaceWith(spoken, shown);
    const finalText = text.nodeValue;
    const job = { done: () => (shown.textContent = finalText) };
    counting.add(job);
    const start = performance.now();
    const duration = 1100;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      if (t >= 1 || motionOff()) {
        job.done();
        counting.delete(job);
        return;
      }
      shown.textContent = format(target * (1 - Math.pow(1 - t, 3)));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function finishCounts() {
    counting.forEach((job) => job.done());
    counting.clear();
  }
  if ("IntersectionObserver" in window) {
    countObserver = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          countObserver.unobserve(entry.target);
          countUp(entry.target);
        }),
      { threshold: 0.4 },
    );
  }

  /* Sliding indicators for the four tab-like groups. A group that app.mjs
     re-renders starts from where the previous one was, so it still slides. */
  const INDICATORS = [
    { group: ".tabs", active: ":scope > .tab.active" },
    { group: ".explorer-modes", active: ":scope > button.active" },
    { group: ".profile-tabs", active: ':scope > [aria-selected="true"]', underline: true },
    { group: ".price-range", active: ':scope > [aria-pressed="true"]' },
  ];
  const lastPlace = new Map();
  function placeIndicator(container, spec) {
    let bar = $(":scope > .fx-indicator", container);
    const fresh = !bar;
    if (fresh) {
      bar = document.createElement("span");
      bar.className = "fx-indicator";
      bar.setAttribute("aria-hidden", "true");
      container.prepend(bar);
      container.classList.add("has-indicator");
    }
    const active = $(spec.active, container);
    if (!active || !active.offsetWidth) {
      bar.style.opacity = "0";
      return;
    }
    const place = { x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight };
    const apply = ({ x, y, w, h }) => {
      bar.style.width = `${w}px`;
      if (spec.underline) {
        bar.style.transform = `translateX(${x}px)`;
      } else {
        bar.style.height = `${h}px`;
        bar.style.transform = `translate(${x}px, ${y}px)`;
      }
    };
    const previous = lastPlace.get(spec.group);
    if (fresh || bar.style.opacity === "0") {
      bar.style.transition = "none";
      apply(fresh && previous ? previous : place);
      void bar.offsetWidth; // commit the start before sliding
      bar.style.transition = "";
    }
    bar.style.opacity = "";
    apply(place);
    if (!previous || previous.x !== place.x || previous.y !== place.y) keepInView(container, active);
    lastPlace.set(spec.group, place);
  }
  // Scrollable groups (phone tab bar, profile tabs) keep the active item visible.
  function keepInView(container, active) {
    if (container.scrollWidth <= container.clientWidth + 1) return;
    const left = active.offsetLeft - 16;
    const right = active.offsetLeft + active.offsetWidth + 16 - container.clientWidth;
    const next = container.scrollLeft > left ? left : container.scrollLeft < right ? right : null;
    if (next !== null) container.scrollTo({ left: Math.max(0, next), behavior: motionOff() ? "auto" : "smooth" });
  }
  function syncIndicators() {
    for (const spec of INDICATORS) $$(spec.group).forEach((container) => placeIndicator(container, spec));
  }

  /* New content from app.mjs: stagger order, flow drawing, count-ups, reveals. */
  const STAGGER =
    "#quant-private, .quant-grid, .company-atlas, .search-results, .glossary-grid, .metrics-grid, .swot-grid, .company-insights > ul, #run-list, .debt-instruments, .arr-grid, .outlook-grid, .result-metrics";
  function index(parent) {
    [...parent.children].forEach((child, i) => child.style.setProperty("--i", String(i)));
  }
  function prepareFlow(svg) {
    if (svg.classList.contains("fx-ready")) return;
    $$(".flow-edge", svg).forEach((path, i) => {
      path.setAttribute("pathLength", "1");
      path.style.setProperty("--i", String(i));
    });
    $$(".flow-node", svg).forEach((node, i) => node.style.setProperty("--i", String(i)));
    svg.classList.add("fx-ready");
  }
  function process(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.parentElement?.matches(STAGGER)) index(node.parentElement);
    [node, ...$$(STAGGER, node)].filter((el) => el.matches(STAGGER)).forEach(index);
    [node, ...$$(".financial-flow", node)].filter((el) => el.matches(".financial-flow")).forEach(prepareFlow);
    if (countObserver && !motionOff()) {
      [node, ...$$(COUNT, node)].filter((el) => el.matches(COUNT)).forEach((el) => countObserver.observe(el));
    }
    setupReveals(node);
  }

  /* The hero headline changes with the tab; animate only a real change. */
  let headline = "";
  function headlineChanged(h1) {
    const text = h1.textContent;
    if (text === headline) return;
    const first = !headline;
    headline = text;
    if (first || motionOff() || !h1.animate) return;
    h1.animate(
      [
        { opacity: 0, transform: "translateY(10px)", filter: "blur(4px)" },
        { opacity: 1, transform: "none", filter: "blur(0)" },
      ],
      { duration: 520, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
  }

  let indicatorFrame = 0;
  const requestIndicators = () => {
    if (!indicatorFrame) {
      indicatorFrame = requestAnimationFrame(() => {
        indicatorFrame = 0;
        syncIndicators();
      });
    }
  };

  /* Pointer light on cards and depth in the hero illustration. */
  const SPOT = ".atlas-card, .metric-card, .feature-strip > div, .glossary-card, .swot-card, .result-metrics > div";
  let pointerFrame = 0;
  let lastPointer = null;
  function onPointer() {
    pointerFrame = 0;
    const event = lastPointer;
    const card = event.target.closest?.(SPOT);
    if (card) {
      const box = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${Math.round(event.clientX - box.left)}px`);
      card.style.setProperty("--my", `${Math.round(event.clientY - box.top)}px`);
    }
    const intro = event.target.closest?.(".page-intro");
    if (intro && !motionOff()) {
      const box = intro.getBoundingClientRect();
      intro.style.setProperty("--px", (((event.clientX - box.left) / box.width) * 2 - 1).toFixed(3));
      intro.style.setProperty("--py", (((event.clientY - box.top) / box.height) * 2 - 1).toFixed(3));
    }
  }
  function resetParallax() {
    const intro = $(".page-intro");
    intro?.style.removeProperty("--px");
    intro?.style.removeProperty("--py");
  }

  /* Motion toggle: a pressed toggle means motion is paused. */
  const toggle = $(".motion-toggle");
  function syncMotion(fromUser) {
    root.classList.toggle("motion-paused", userPaused);
    if (fromUser) {
      try {
        if (userPaused) localStorage.setItem(STORE_KEY, "paused");
        else localStorage.removeItem(STORE_KEY);
      } catch {
        /* Storage is a convenience only. */
      }
    }
    if (toggle) {
      toggle.setAttribute("aria-pressed", String(motionOff()));
      toggle.disabled = reduced.matches;
      const label = $("span", toggle);
      if (label) label.textContent = reduced.matches ? "모션 감소" : "모션 끄기";
      toggle.title = reduced.matches
        ? "시스템의 모션 감소 설정이 적용되었습니다."
        : userPaused
          ? "애니메이션이 멈춰 있습니다. 누르면 다시 켭니다."
          : "애니메이션 끄기";
      $("svg path", toggle)?.setAttribute("d", motionOff() ? "M7 4.5L15 10L7 15.5Z" : "M7 5v10M13 5v10");
    }
    if (motionOff()) {
      revealAll();
      finishCounts();
      resetParallax();
    }
  }

  function init() {
    syncMotion(false);
    toggle?.addEventListener("click", () => {
      userPaused = !userPaused;
      syncMotion(true);
    });
    reduced.addEventListener?.("change", () => syncMotion(false));

    process(document.body);
    const h1 = $(".page-intro h1");
    if (h1) headlineChanged(h1);
    syncIndicators();

    new MutationObserver((mutations) => {
      let indicators = false;
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          if (mutation.target === h1) headlineChanged(h1);
          mutation.addedNodes.forEach(process);
          indicators = true;
        } else if (mutation.attributeName !== "class" || !mutation.target.classList?.contains("fx-reveal")) {
          indicators = true;
        }
      }
      if (indicators) requestIndicators();
    }).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "aria-selected", "aria-pressed", "aria-current"],
    });
    window.addEventListener("resize", requestIndicators, { passive: true });
    document.fonts?.ready.then(requestIndicators);

    const topbar = $(".topbar");
    const onScroll = () => topbar?.classList.toggle("is-scrolled", window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    document.addEventListener(
      "pointermove",
      (event) => {
        if (!finePointer.matches) return;
        lastPointer = event;
        if (!pointerFrame) pointerFrame = requestAnimationFrame(onPointer);
      },
      { passive: true },
    );
    $(".page-intro")?.addEventListener("pointerleave", resetParallax);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
