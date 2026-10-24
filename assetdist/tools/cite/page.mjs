// 논문 인용 생성기 page. Only the DOI is sent, to Crossref's public API; the
// list of recent citations stays in this browser.
import { STYLES, fromCrossref, parseDoi } from './cite.mjs';
import { copy, store } from '../common.mjs';

const form = document.getElementById('cite-form');
if (form) {
  const $ = (id) => document.getElementById(id);
  const RECENT = 'tools:cite:recent';
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const status = $('cite-status');
  let work = null;
  let style = store.get('tools:cite:style', 'apa');
  if (!STYLES.some((s) => s.id === style)) style = 'apa';
  let controller = null;

  const TYPE = { 'journal-article': '학술지 논문', 'proceedings-article': '학술대회 논문', 'book-chapter': '책의 장', book: '책', 'posted-content': '사전 공개 논문', dissertation: '학위논문', report: '보고서' };

  $('style-tabs').innerHTML = STYLES.map((s) => `<button type="button" role="tab" id="tab-${s.id}" data-style="${s.id}" aria-selected="${s.id === style}" aria-controls="style-panel">${s.label}</button>`).join('');

  function renderStyle() {
    if (!work) return;
    const current = STYLES.find((s) => s.id === style);
    const out = current.format(work);
    $('style-tabs').querySelectorAll('[data-style]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.style === style)));
    $('style-panel').setAttribute('aria-labelledby', `tab-${style}`);
    $('style-panel').innerHTML = `<p class="tool-result__label">${current.label}</p><p class="cite-text${style === 'bibtex' ? ' cite-text--code' : ''}" id="cite-text">${out.html}</p><div class="tool-result__actions"><button type="button" class="bu-btn bu-btn--sm" data-copy="rich">${style === 'bibtex' ? '복사' : '서식 유지 복사'}</button>${style === 'bibtex' ? '' : '<button type="button" class="bu-btn bu-btn--ghost bu-btn--sm" data-copy="plain">텍스트만 복사</button>'}</div>`;
  }

  function renderMeta() {
    const w = work;
    const authors = w.authors.map((a) => a.literal || `${a.given ? `${a.given} ` : ''}${a.family}`);
    $('meta').innerHTML = `<p class="bu-label" style="margin:0">${escape(TYPE[w.type] || '문헌')}</p><h2>${escape(w.subtitle ? `${w.title}: ${w.subtitle}` : w.title || '제목 없음')}</h2><p>${escape(authors.slice(0, 6).join(', '))}${authors.length > 6 ? ` 외 ${authors.length - 6}명` : ''}</p><dl>${[
      ['게재', w.container], ['연도', w.year], ['권·호', [w.volume, w.issue].filter(Boolean).join('(') + (w.issue && w.volume ? ')' : '')], ['쪽', w.pages || w.article], ['출판사', w.publisher], ['DOI', w.doi],
    ].filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${k === 'DOI' ? `<a class="bu-link" href="https://doi.org/${escape(v)}" rel="noopener noreferrer">${escape(v)}</a>` : escape(v)}</dd>`).join('')}</dl>`;
  }

  function renderRecent() {
    const list = store.get(RECENT, []);
    const items = Array.isArray(list) ? list.filter((r) => r && typeof r.doi === 'string').slice(0, 10) : [];
    $('recent-section').hidden = !items.length;
    $('recent').innerHTML = items.map((r) => `<li><span><strong>${escape(r.title || r.doi)}</strong>${escape(r.doi)}</span><button type="button" class="bu-btn bu-btn--ghost bu-btn--sm" data-doi="${escape(r.doi)}">다시 보기</button></li>`).join('');
  }

  async function lookup(raw) {
    const doi = parseDoi(raw);
    if (!doi) { status.textContent = 'DOI 형식이 아니에요. 10.으로 시작하는 값을 넣어 주세요.'; $('doi').setAttribute('aria-invalid', 'true'); return; }
    $('doi').removeAttribute('aria-invalid');
    controller?.abort();
    controller = new AbortController();
    status.textContent = 'Crossref에서 서지 정보를 찾는 중이에요…';
    try {
      const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (res.status === 404) { status.textContent = 'Crossref에 등록되지 않은 DOI예요. 오타를 확인하거나 다른 DOI를 넣어 주세요.'; return; }
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      work = fromCrossref(data.message);
      if (!work.title) { status.textContent = '이 DOI에는 제목 정보가 없어 인용을 만들 수 없어요.'; return; }
      $('output').hidden = false;
      renderMeta();
      renderStyle();
      status.textContent = `${work.title.slice(0, 60)}${work.title.length > 60 ? '…' : ''} · 인용을 만들었어요.`;
      const recent = (store.get(RECENT, []) || []).filter((r) => r && r.doi !== work.doi);
      store.set(RECENT, [{ doi: work.doi, title: work.title }, ...recent].slice(0, 10));
      renderRecent();
      const url = new URL(location.href);
      url.searchParams.set('doi', work.doi);
      history.replaceState(null, '', url);
    } catch (error) {
      if (error.name === 'AbortError') return;
      status.textContent = 'Crossref에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
    }
  }

  form.addEventListener('submit', (event) => { event.preventDefault(); lookup($('doi').value); });
  $('style-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-style]');
    if (!button) return;
    style = button.dataset.style;
    store.set('tools:cite:style', style);
    renderStyle();
  });
  $('style-tabs').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const index = STYLES.findIndex((s) => s.id === style);
    style = STYLES[(index + (event.key === 'ArrowRight' ? 1 : STYLES.length - 1)) % STYLES.length].id;
    renderStyle();
    $(`tab-${style}`).focus();
  });
  $('style-panel').addEventListener('click', (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button || !work) return;
    const out = STYLES.find((s) => s.id === style).format(work);
    copy(out.text, button.dataset.copy === 'rich' && style !== 'bibtex' ? out.html : undefined);
  });
  $('recent').addEventListener('click', (event) => {
    const button = event.target.closest('[data-doi]');
    if (!button) return;
    $('doi').value = button.dataset.doi;
    lookup(button.dataset.doi);
    window.scrollTo({ top: 0, behavior: window.BandalUI?.motionOff?.() ? 'auto' : 'smooth' });
  });
  $('clear-recent').addEventListener('click', () => { store.remove(RECENT); renderRecent(); });

  renderRecent();
  const initial = new URL(location.href).searchParams.get('doi');
  if (initial) { $('doi').value = initial; lookup(initial); }
}
