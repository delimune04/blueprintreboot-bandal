'use strict';
// CAPELLA support and privacy pages: FAQ search on support, the current
// section in the privacy table of contents. Both pages read fully without it.
(() => {
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const normalise = (value) => String(value || '').normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/g, ' ').trim();

  const faq = $('.faq');
  if (faq) {
    const items = $$('details', faq);
    const heading = $('h2', faq);
    const tools = document.createElement('div');
    tools.innerHTML = '<div class="bu-search capella-faq-search"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><label class="bu-sr" for="faq-search">자주 묻는 질문 검색</label><input id="faq-search" type="search" autocomplete="off" placeholder="예: 저장, 권한, 날짜 스탬프"></div><div class="capella-faq-tools"><p id="faq-status" role="status" aria-live="polite"></p><button type="button" class="bu-btn bu-btn--ghost bu-btn--sm" id="faq-expand">모두 펼치기</button></div><p class="capella-faq-empty" id="faq-empty" hidden>찾는 질문이 없어요. <a href="mailto:support@bandal.app?subject=CAPELLA%20Support">support@bandal.app</a>으로 알려 주세요.</p>';
    heading.after(...tools.childNodes);
    const input = $('#faq-search');
    const status = $('#faq-status');
    const empty = $('#faq-empty');
    const expand = $('#faq-expand');
    const texts = new Map(items.map((item) => [item, normalise(item.textContent)]));
    const update = () => {
      const words = normalise(input.value).split(' ').filter(Boolean);
      let shown = 0;
      for (const item of items) {
        const match = words.every((word) => texts.get(item).includes(word));
        item.hidden = !match;
        if (match) shown += 1;
        if (words.length && match) item.open = true;
      }
      empty.hidden = shown > 0;
      status.textContent = words.length ? `${shown}개의 질문` : `${items.length}개의 질문`;
    };
    input.addEventListener('input', update);
    expand.addEventListener('click', () => {
      const open = !items.filter((item) => !item.hidden).every((item) => item.open);
      items.forEach((item) => { if (!item.hidden) item.open = open; });
      expand.textContent = open ? '모두 접기' : '모두 펼치기';
    });
    update();
  }

  const tocLinks = $$('.toc a[href^="#"]');
  const sections = tocLinks.map((link) => document.getElementById(link.getAttribute('href').slice(1))).filter(Boolean);
  if (sections.length) {
    let pending = false;
    const onScroll = () => {
      pending = false;
      const line = window.innerHeight * 0.3;
      let current = null;
      for (const section of sections) if (section.getBoundingClientRect().top <= line) current = section;
      for (const link of tocLinks) {
        const active = Boolean(current) && link.getAttribute('href') === `#${current.id}`;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
      }
    };
    window.addEventListener('scroll', () => { if (!pending) { pending = true; requestAnimationFrame(onScroll); } }, { passive: true });
    onScroll();
  }
})();
