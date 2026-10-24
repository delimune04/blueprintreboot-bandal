/* BANDAL UI behaviour shared by the studio's subpages. Pages work without this
   file; it adds the motion toggle (same "bandal:motion" preference as the
   homepage), the product bar's scrolled state, reveals, card pointer light,
   reading progress, count-ups to numbers already in the page, a toast helper
   and the studio project list in the footer. */
(() => {
  'use strict';

  const root = document.documentElement;
  root.classList.add('bu-js');

  const STORE_KEY = 'bandal:motion';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

  // One registry for every subpage footer; the homepage keeps its own markup.
  const PROJECTS = [
    { href: '/LabVium', label: 'LabVium' },
    { href: '/harupyeon/', label: '하루편' },
    { href: '/travel/', label: '여행 설계' },
    { href: '/capella/', label: 'CAPELLA' },
    { href: '/finance/', label: 'Bandal Finance' },
    { href: '/tools/', label: '반달 도구함' },
  ];

  let userPaused = root.classList.contains('motion-paused');
  const motionOff = () => userPaused || reduced.matches;

  /* Motion toggle */
  const toggles = $$('.bu-motion');
  function syncMotion(fromUser) {
    root.classList.toggle('motion-paused', userPaused);
    if (fromUser) {
      try {
        if (userPaused) localStorage.setItem(STORE_KEY, 'paused');
        else localStorage.removeItem(STORE_KEY);
      } catch { /* Storage is a convenience only. */ }
    }
    const label = reduced.matches ? '모션 감소' : userPaused ? '모션 켜기' : '모션 끄기';
    for (const toggle of toggles) {
      toggle.setAttribute('aria-pressed', String(motionOff()));
      toggle.disabled = reduced.matches;
      toggle.setAttribute('aria-label', reduced.matches ? '시스템 설정에 따라 모션 감소 적용 중' : label);
      toggle.title = reduced.matches ? '시스템의 모션 감소 설정이 적용되었습니다.' : label;
      const text = $('span', toggle);
      if (text) text.textContent = label;
      $('svg path', toggle)?.setAttribute('d', userPaused && !reduced.matches ? 'M7 4.5L15 10L7 15.5Z' : 'M7 5v10M13 5v10');
    }
    if (motionOff()) revealAll();
  }
  toggles.forEach(toggle => toggle.addEventListener('click', () => {
    userPaused = !userPaused;
    syncMotion(true);
  }));
  reduced.addEventListener?.('change', () => syncMotion(false));

  /* Reveal once, then leave content visible. */
  const reveals = $$('.bu-reveal');
  $$('[data-bu-stagger]').forEach(group => {
    $$('.bu-reveal', group).forEach((element, index) => element.style.setProperty('--bu-i', String(Math.min(index, 6))));
  });
  function reveal(element) {
    if (element.classList.contains('is-visible')) return;
    element.classList.add('is-visible');
    $$('[data-bu-count]', element).forEach(countUp);
    if (element.hasAttribute('data-bu-count')) countUp(element);
  }
  function revealAll() { reveals.forEach(reveal); }
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      reveal(entry.target);
      observer.unobserve(entry.target);
    }), { threshold: 0.1, rootMargin: '0px 0px -5% 0px' });
    reveals.forEach(element => observer.observe(element));
  } else {
    revealAll();
  }
  // Keyboard focus never lands in content that is still waiting for its reveal.
  document.addEventListener('focusin', event => {
    const target = event.target.closest?.('.bu-reveal');
    if (target) reveal(target);
  });

  // Counts up to the number already written in the page; no data is invented.
  const counted = new WeakSet();
  function countUp(element) {
    const target = Number.parseInt(element.textContent.replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(target) || target <= 0 || motionOff() || counted.has(element)) return;
    counted.add(element);
    const finalText = element.textContent;
    const start = performance.now();
    const duration = 1200;
    const step = now => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      element.textContent = t >= 1 || motionOff() ? finalText : String(Math.round(target * eased));
      if (t < 1 && !motionOff()) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  $$('[data-bu-count]').filter(element => !element.closest('.bu-reveal')).forEach(countUp);

  /* Product bar state and reading progress share one scroll handler. */
  const bar = $('.bu-bar');
  const progress = $('.bu-progress');
  const progressTarget = progress?.dataset.target ? $(progress.dataset.target) : null;
  let scrollPending = false;
  function onScroll() {
    scrollPending = false;
    bar?.classList.toggle('is-scrolled', window.scrollY > 8);
    if (!progress) return;
    let ratio;
    if (progressTarget) {
      const rect = progressTarget.getBoundingClientRect();
      const span = rect.height - window.innerHeight * 0.6;
      ratio = span > 0 ? (window.innerHeight * 0.25 - rect.top) / span : 0;
    } else {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      ratio = max > 0 ? window.scrollY / max : 0;
    }
    progress.style.setProperty('--bu-progress', String(Math.min(1, Math.max(0, ratio))));
  }
  const requestScroll = () => {
    if (scrollPending) return;
    scrollPending = true;
    requestAnimationFrame(onScroll);
  };
  window.addEventListener('scroll', requestScroll, { passive: true });
  window.addEventListener('resize', requestScroll, { passive: true });
  onScroll();

  /* Card pointer light follows the pointer on devices that hover. */
  document.addEventListener('pointermove', event => {
    if (!finePointer.matches) return;
    const card = event.target.closest?.('.bu-card, .bu-hero');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--bu-x', `${event.clientX - rect.left}px`);
    card.style.setProperty('--bu-y', `${event.clientY - rect.top}px`);
  }, { passive: true });

  /* Footer studio list: rendered from the registry above. */
  for (const slot of $$('[data-bu-projects]')) {
    const here = slot.dataset.buProjects;
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', 'BANDAL 프로젝트');
    for (const project of PROJECTS) {
      const link = document.createElement('a');
      link.href = project.href;
      link.textContent = project.label;
      if (project.href === here) link.setAttribute('aria-current', 'page');
      nav.append(link);
    }
    slot.append(nav);
    slot.hidden = false;
  }

  /* Toast helper for page scripts. */
  let toastTimer = 0;
  function toast(message) {
    let element = $('.bu-toast');
    if (!element) {
      element = document.createElement('div');
      element.className = 'bu-toast';
      element.setAttribute('role', 'status');
      element.setAttribute('aria-live', 'polite');
      document.body.append(element);
    }
    element.textContent = message;
    requestAnimationFrame(() => element.classList.add('is-on'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('is-on'), 2600);
  }

  // Best-effort local storage for per-visitor conveniences (bookmarks, drafts).
  const store = {
    get(key, fallback) {
      try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : JSON.parse(value);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    },
  };

  window.BandalUI = Object.freeze({ toast, store, motionOff, projects: PROJECTS });
  syncMotion(false);
})();
