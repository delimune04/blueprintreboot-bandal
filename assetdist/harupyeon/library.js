'use strict';
// Harupyeon library behaviour. Pages stay readable without it: lists, category
// pages and articles are plain links. This adds full-text search, sort, tag and
// saved filters, per-visitor saved/read marks, interactive checklists, the
// table-of-contents position and related articles. Saved, read and checklist
// state lives only in this browser (best-effort localStorage).
(() => {
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const normalise = (value) => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/g, ' ').trim();
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const memory = new Map();
  const store = window.BandalUI?.store || {
    get: (key, fallback) => (memory.has(key) ? memory.get(key) : fallback),
    set: (key, value) => { memory.set(key, value); return false; },
    remove: (key) => memory.delete(key),
  };
  const toast = (message) => window.BandalUI?.toast?.(message);
  const SAVED = 'harupyeon:saved';
  const READ = 'harupyeon:read';
  const idList = (key) => {
    const value = store.get(key, []);
    return new Set(Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []);
  };
  const BOOKMARK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 3.5h9v13l-4.5-3.2-4.5 3.2z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const BOOKMARK_OUTLINE = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 3.5h9v13l-4.5-3.2-4.5 3.2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

  function toggleSaved(id) {
    const saved = idList(SAVED);
    const on = !saved.has(id);
    if (on) saved.add(id); else saved.delete(id);
    const persisted = store.set(SAVED, [...saved]);
    toast(on ? (persisted ? '저장한 글에 담았어요. 이 브라우저에만 보관돼요.' : '저장했어요. 이 창을 닫으면 사라져요.') : '저장한 글에서 뺐어요.');
    return on;
  }

  /* ---------- Library and category pages ---------- */
  const form = $('.search-form');
  const cards = $$('.tip-card');
  if (form && cards.length) {
    const input = $('#tip-search');
    const status = $('#result-status');
    const empty = $('#empty-state');
    const list = $('#tip-list');
    const original = cards.slice();
    const minutes = new Map(cards.map((card) => [card, Number.parseInt($('.card-meta span:last-child', card)?.textContent, 10) || 0]));
    const tagsOf = new Map(cards.map((card) => [card, $$('.tags span', card).map((tag) => tag.textContent.trim())]));
    let index = null, loading = null, unavailable = false, debounce = 0;
    let activeTag = null, savedOnly = false, sort = 'default';

    // Saved toggle and read mark on each card; both sit above the card link.
    const read = idList(READ);
    for (const card of cards) {
      const id = card.dataset.tipId;
      const title = $('h2 a', card)?.textContent.trim() || '글';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'haru-save';
      const sync = (on) => {
        button.setAttribute('aria-pressed', String(on));
        button.setAttribute('aria-label', `${title} ${on ? '저장 취소' : '저장하기'}`);
        button.innerHTML = on ? BOOKMARK : BOOKMARK_OUTLINE;
      };
      sync(idList(SAVED).has(id));
      button.addEventListener('click', () => { sync(toggleSaved(id)); if (savedOnly) apply(); updateSavedChip(); });
      card.append(button);
      if (read.has(id)) {
        const mark = document.createElement('span');
        mark.className = 'haru-read';
        mark.textContent = '✓ 읽음';
        $('.card-meta', card)?.append(mark);
      }
    }

    // Toolbar: the most common tags in this list, saved filter and sort.
    const counts = new Map();
    for (const tags of tagsOf.values()) for (const tag of tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    const topTags = [...counts].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')).slice(0, 8);
    const toolbar = document.createElement('div');
    toolbar.className = 'haru-toolbar';
    toolbar.innerHTML = `<div class="bu-chips" role="group" aria-label="주제로 좁히기">${topTags.map(([tag, n]) => `<button type="button" class="bu-chip" data-tag="${escape(tag)}" aria-pressed="false">#${escape(tag)}<small>${n}</small></button>`).join('')}</div><div class="haru-toolbar__end"><button type="button" class="bu-chip" data-saved aria-pressed="false">저장한 글<small>0</small></button><label class="bu-sr" for="haru-sort">정렬</label><select id="haru-sort" class="bu-input"><option value="default">기본 순서</option><option value="short">짧은 글부터</option><option value="long">긴 글부터</option></select></div>`;
    list.before(toolbar);
    const savedChip = $('[data-saved]', toolbar);
    function updateSavedChip() {
      const saved = idList(SAVED);
      $('small', savedChip).textContent = String(cards.filter((card) => saved.has(card.dataset.tipId)).length);
    }
    updateSavedChip();
    toolbar.addEventListener('click', (event) => {
      const tagButton = event.target.closest('[data-tag]');
      if (tagButton) {
        activeTag = activeTag === tagButton.dataset.tag ? null : tagButton.dataset.tag;
        $$('[data-tag]', toolbar).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tag === activeTag)));
        apply(true);
      }
      if (event.target.closest('[data-saved]')) {
        savedOnly = !savedOnly;
        savedChip.setAttribute('aria-pressed', String(savedOnly));
        apply(true);
      }
    });
    $('#haru-sort', toolbar).addEventListener('change', (event) => { sort = event.target.value; apply(true); });

    const ensureIndex = () => {
      if (loading) return loading;
      loading = fetch('/harupyeon/search-index.json', { cache: 'no-cache' })
        .then((res) => { if (!res.ok) throw new Error('search index unavailable'); return res.json(); })
        .then((data) => { index = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, normalise(value)])); })
        .catch(() => { unavailable = true; })
        .finally(() => { apply(); });
      return loading;
    };

    function apply(updateUrl = false) {
      const query = normalise(input.value);
      const words = query.split(' ').filter(Boolean);
      const saved = idList(SAVED);
      let count = 0;
      for (const card of cards) {
        const text = index?.[card.dataset.tipId] ?? normalise(card.dataset.search);
        const matches = words.every((word) => text.includes(word))
          && (!activeTag || tagsOf.get(card).includes(activeTag))
          && (!savedOnly || saved.has(card.dataset.tipId));
        card.hidden = !matches;
        if (matches) count += 1;
      }
      const ordered = sort === 'default' ? original : original.slice().sort((a, b) => (sort === 'short' ? 1 : -1) * (minutes.get(a) - minutes.get(b)));
      list.append(...ordered);
      empty.hidden = count > 0;
      const filters = [query && '검색', activeTag && `#${activeTag}`, savedOnly && '저장한 글'].filter(Boolean);
      status.textContent = filters.length
        ? `${count}개의 글 · ${filters.join(' · ')}${query ? (unavailable ? ' · 제목·요약에서 검색' : (!index ? ' · 본문 검색 준비 중' : '')) : ''}`
        : `${cards.length}개의 글`;
      if (updateUrl) {
        const url = new URL(location.href);
        if (input.value.trim()) url.searchParams.set('q', input.value.trim());
        else url.searchParams.delete('q');
        history.replaceState(null, '', url);
      }
      for (const link of $$('.category-nav a')) {
        const url = new URL(link.href);
        if (input.value.trim()) url.searchParams.set('q', input.value.trim());
        else url.searchParams.delete('q');
        link.href = url.href;
      }
    }

    input.addEventListener('focus', ensureIndex, { once: true });
    input.addEventListener('input', () => { clearTimeout(debounce); ensureIndex(); debounce = setTimeout(() => apply(true), 120); });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      ensureIndex();
      apply(true);
      $('#library')?.scrollIntoView({ block: 'start' });
    });
    $('#clear-search').addEventListener('click', () => {
      input.value = '';
      activeTag = null;
      savedOnly = false;
      $$('[aria-pressed]', toolbar).forEach((b) => b.setAttribute('aria-pressed', 'false'));
      apply(true);
      input.focus();
    });
    input.value = new URL(location.href).searchParams.get('q') ?? '';
    if (input.value) { ensureIndex(); apply(); }
  }

  /* ---------- Article pages ---------- */
  const article = $('.article-body[data-tip-id]');
  if (!article) return;
  const tipId = article.dataset.tipId;
  const intro = $('.article-intro');

  // Save and share.
  const actions = document.createElement('div');
  actions.className = 'haru-actions';
  actions.innerHTML = `<button type="button" class="bu-btn bu-btn--ghost bu-btn--sm" data-save aria-pressed="false"></button><button type="button" class="bu-btn bu-btn--ghost bu-btn--sm" data-share>링크 공유</button><button type="button" class="bu-btn bu-btn--ghost bu-btn--sm" data-print>인쇄 · PDF</button>`;
  intro?.append(actions);
  const saveButton = $('[data-save]', actions);
  const syncSave = (on) => {
    saveButton.setAttribute('aria-pressed', String(on));
    saveButton.innerHTML = `${on ? BOOKMARK : BOOKMARK_OUTLINE}<span>${on ? '저장한 글' : '나중에 읽기'}</span>`;
    $('svg', saveButton).setAttribute('width', '16');
    $('svg', saveButton).setAttribute('height', '16');
  };
  syncSave(idList(SAVED).has(tipId));
  saveButton.addEventListener('click', () => syncSave(toggleSaved(tipId)));
  $('[data-share]', actions).addEventListener('click', async () => {
    const url = location.href.split('#')[0];
    const title = $('h1')?.textContent.trim() || document.title;
    if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title, url }); return; } catch { /* fall back to copying */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('링크를 복사했어요.');
    } catch {
      toast('주소창의 링크를 복사해 주세요.');
    }
  });
  $('[data-print]', actions).addEventListener('click', () => window.print());

  // Checklists become checkable; ticks are kept per article in this browser.
  const checkKey = `harupyeon:check:${tipId}`;
  const stored = store.get(checkKey, []);
  const checked = new Set(Array.isArray(stored) ? stored.filter((value) => typeof value === 'string') : []);
  $$('.body-checklist', article).forEach((box, boxIndex) => {
    const items = $$('li', box);
    if (!items.length) return;
    box.classList.add('is-interactive');
    const status = document.createElement('p');
    status.className = 'haru-check-status';
    box.prepend(status);
    const update = () => {
      const done = items.filter((_, i) => checked.has(`${boxIndex}:${i}`)).length;
      status.innerHTML = `<span>${done === items.length ? '모두 확인했어요' : `${items.length}개 중 ${done}개 확인`}</span>${done ? '<button type="button">처음부터</button>' : ''}`;
    };
    items.forEach((item, i) => {
      const key = `${boxIndex}:${i}`;
      const label = document.createElement('label');
      label.className = 'haru-check';
      const tick = document.createElement('input');
      tick.type = 'checkbox';
      tick.checked = checked.has(key);
      const text = document.createElement('span');
      text.append(...item.childNodes);
      label.append(tick, text);
      item.append(label);
      tick.addEventListener('change', () => {
        if (tick.checked) checked.add(key); else checked.delete(key);
        store.set(checkKey, [...checked]);
        update();
      });
    });
    status.addEventListener('click', (event) => {
      if (!event.target.closest('button')) return;
      items.forEach((item, i) => { checked.delete(`${boxIndex}:${i}`); $('input', item).checked = false; });
      store.set(checkKey, [...checked]);
      update();
    });
    update();
  });

  // Table of contents follows the section in view; collapsed on phones.
  const toc = $('.article-toc');
  const tocLinks = $$('.article-toc a[href^="#"]');
  const sections = tocLinks.map((link) => document.getElementById(decodeURIComponent(link.getAttribute('href').slice(1)))).filter(Boolean);
  if (toc && window.matchMedia('(max-width: 900px)').matches) $('details', toc)?.removeAttribute('open');
  const meter = document.createElement('div');
  meter.className = 'haru-toc-progress';
  meter.setAttribute('aria-hidden', 'true');
  meter.innerHTML = '<span></span>';
  $('details', toc)?.after(meter);
  let markedRead = idList(READ).has(tipId);
  let pending = false;
  function onScroll() {
    pending = false;
    const line = window.innerHeight * 0.3;
    let current = null;
    for (const section of sections) if (section.getBoundingClientRect().top <= line) current = section;
    for (const link of tocLinks) {
      const active = current && link.getAttribute('href') === `#${current.id}`;
      link.classList.toggle('is-active', Boolean(active));
      if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
    }
    const rect = article.getBoundingClientRect();
    const span = rect.height - window.innerHeight * 0.6;
    const ratio = Math.min(1, Math.max(0, span > 0 ? (window.innerHeight * 0.25 - rect.top) / span : 0));
    meter.style.setProperty('--bu-progress', String(ratio));
    if (!markedRead && ratio > 0.85) {
      markedRead = true;
      const read = idList(READ);
      read.add(tipId);
      store.set(READ, [...read]);
    }
  }
  window.addEventListener('scroll', () => { if (!pending) { pending = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();

  // Related articles from the catalog: same life stage first, shared tags rank higher.
  const end = $('.article-end', article);
  fetch('/harupyeon/catalog.json', { cache: 'no-cache' })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error('catalog unavailable'))))
    .then((catalog) => {
      const tips = Array.isArray(catalog?.tips) ? catalog.tips : [];
      const self = tips.find((tip) => tip.id === tipId);
      if (!self || !end) return;
      const scored = tips.filter((tip) => tip.id !== tipId).map((tip) => ({
        tip,
        score: (tip.slug === self.slug ? 2 : 0) + tip.tags.filter((tag) => self.tags.includes(tag)).length * 3,
      })).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || a.tip.n - b.tip.n).slice(0, 3);
      if (!scored.length) return;
      const section = document.createElement('section');
      section.className = 'haru-related';
      section.setAttribute('aria-labelledby', 'haru-related-title');
      section.innerHTML = `<h2 id="haru-related-title">함께 읽으면 좋은 글</h2><div class="bu-grid">${scored.map(({ tip }) => `<article class="bu-card"><p class="bu-card__meta"><span class="bu-tag">${escape(tip.category)}</span>${tip.minutes ? `<span>${tip.minutes}분 읽기</span>` : ''}</p><h3><a class="bu-card__link" href="${escape(tip.href)}">${escape(tip.title)}</a></h3><p>${escape(tip.summary)}</p></article>`).join('')}</div>`;
      end.before(section);
    })
    .catch(() => { /* Related articles are optional. */ });
})();
