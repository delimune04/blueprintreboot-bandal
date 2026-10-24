'use strict';
(() => {
  const form = document.querySelector('.search-form');
  if (!form) return;
  const input = document.getElementById('tip-search');
  const cards = [...document.querySelectorAll('.tip-card')];
  const status = document.getElementById('result-status');
  const empty = document.getElementById('empty-state');
  const normalise = (value) => value.normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/g, ' ').trim();
  let index = null, loading = null, unavailable = false, debounce;
  const ensureIndex = () => {
    if (loading) return loading;
    loading = fetch('/harupyeon/search-index.json', {cache: 'no-cache'})
      .then((res) => {if (!res.ok) throw new Error('search index unavailable'); return res.json();})
      .then((data) => {index = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, normalise(value)]));})
      .catch(() => {unavailable = true;})
      .finally(() => {applySearch();});
    return loading;
  };
  function applySearch(updateUrl = false) {
    const query = normalise(input.value);
    const words = query.split(' ').filter(Boolean);
    let count = 0;
    for (const card of cards) {
      const text = index?.[card.dataset.tipId] ?? normalise(card.dataset.search);
      const matches = words.every((word) => text.includes(word));
      card.hidden = !matches;
      if (matches) count += 1;
    }
    empty.hidden = count > 0;
    status.textContent = query ? `${count}개의 검색 결과${unavailable ? ' · 제목·요약에서 검색' : (!index ? ' · 본문 검색 준비 중' : '')}` : `${cards.length}개의 글`;
    if (updateUrl) {
      const url = new URL(location.href);
      if (input.value.trim()) url.searchParams.set('q', input.value.trim());
      else url.searchParams.delete('q');
      history.replaceState(null, '', url);
    }
    for (const link of document.querySelectorAll('.category-nav a')) {
      const url = new URL(link.href);
      if (input.value.trim()) url.searchParams.set('q', input.value.trim());
      else url.searchParams.delete('q');
      link.href = url.href;
    }
  }
  input.addEventListener('focus', ensureIndex, {once: true});
  input.addEventListener('input', () => {clearTimeout(debounce); ensureIndex(); debounce = setTimeout(() => applySearch(true), 120);});
  form.addEventListener('submit', (event) => {event.preventDefault(); ensureIndex(); applySearch(true);});
  document.getElementById('clear-search').addEventListener('click', () => {input.value = ''; applySearch(true); input.focus();});
  input.value = new URL(location.href).searchParams.get('q') ?? '';
  if (input.value) {ensureIndex(); applySearch();}
})();
