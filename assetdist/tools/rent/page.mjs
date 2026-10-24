// 전세·월세 실주거비 비교 page. Conditions are kept in this browser only.
import { impliedRate, legalCapRate, monthlyCost, rentForDeposit } from './rent.mjs';
import { bindAmount, koreanAmount, num, parseAmount, store, won } from '../common.mjs';

const host = document.getElementById('options');
if (host) {
  const $ = (id) => document.getElementById(id);
  const KEY = 'tools:rent:v1';
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Example conditions so the page shows a comparison at once; visitors replace them.
  const EXAMPLES = [
    { name: '전세', deposit: 200000000, rent: 0, maintenance: 100000, loan: 160000000, loanRate: 4.0 },
    { name: '반전세', deposit: 100000000, rent: 400000, maintenance: 100000, loan: 60000000, loanRate: 4.0 },
    { name: '월세', deposit: 10000000, rent: 700000, maintenance: 100000, loan: 0, loanRate: 0 },
  ];
  const saved = store.get(KEY, null);
  const options = Array.isArray(saved?.options) && saved.options.length === 3
    ? saved.options.map((o, i) => ({ ...EXAMPLES[i], ...o }))
    : EXAMPLES.map((o) => ({ ...o }));
  if (saved?.savings !== undefined) $('savings').value = saved.savings;
  if (saved?.months) $('months').value = String(saved.months);
  if (saved?.baseRate !== undefined) $('base-rate').value = saved.baseRate;

  const FIELDS = [
    ['deposit', '보증금', 'amount'],
    ['rent', '월세', 'amount'],
    ['maintenance', '관리비', 'amount'],
    ['loan', '보증금 중 대출', 'amount'],
    ['loanRate', '대출 연 금리', 'rate'],
  ];
  host.innerHTML = options.map((o, i) => `<article class="rent-card bu-card bu-reveal" data-i="${i}">
    <div class="rent-card__head"><span class="rent-card__letter" aria-hidden="true">${'ABC'[i]}</span><label class="bu-sr" for="name-${i}">집 ${'ABC'[i]} 이름</label><input class="rent-card__name" id="name-${i}" data-field="name" maxlength="20" value="${escape(o.name)}"></div>
    ${FIELDS.map(([key, label, kind]) => `<div class="bu-field"><label for="${key}-${i}">${label}</label><div class="tool-unit"><input class="bu-input" id="${key}-${i}" data-field="${key}" type="text" inputmode="${kind === 'rate' ? 'decimal' : 'numeric'}" value="${kind === 'rate' ? o[key] : num(o[key])}"><span aria-hidden="true">${kind === 'rate' ? '%' : '원'}</span></div>${kind === 'amount' ? `<p class="tool-hint" id="${key}-${i}-hint"></p>` : ''}</div>`).join('')}
    <dl class="tool-rows rent-card__result" id="result-${i}"></dl>
  </article>`).join('');

  const read = (i) => {
    const card = host.querySelector(`[data-i="${i}"]`);
    const value = (key) => card.querySelector(`[data-field="${key}"]`).value;
    const amount = (key) => { const v = parseAmount(value(key)); return Number.isFinite(v) ? v : 0; };
    return {
      name: value('name').trim() || `집 ${'ABC'[i]}`,
      deposit: amount('deposit'), rent: amount('rent'), maintenance: amount('maintenance'), loan: amount('loan'),
      loanRate: Math.max(0, Number(value('loanRate')) || 0),
    };
  };

  function render() {
    const savingsRate = Math.max(0, Number($('savings').value) || 0);
    const months = Number($('months').value) || 24;
    const rows = [0, 1, 2].map((i) => {
      const o = read(i);
      const c = monthlyCost({ ...o, savingsRate });
      const used = o.deposit > 0 || o.rent > 0;
      $(`result-${i}`).innerHTML = used ? [
        ['매달 나가는 돈', won(c.cash), `월세 + 관리비 + 대출이자 ${won(c.interest)}`],
        ['보증금 기회비용', won(c.opportunity), `내 돈 ${koreanAmount(c.ownFunds)} × ${num(savingsRate, 1)}%`],
        ['한 달 실주거비', won(c.total), `${months}개월 ${koreanAmount(c.total * months)}`],
      ].map(([label, value, note], k) => `<div${k === 2 ? ' class="is-total"' : ''}><dt>${label}<small>${note}</small></dt><dd>${value}</dd></div>`).join('') : '<div><dt>조건을 입력하면 계산해요.</dt><dd></dd></div>';
      return { i, o, c, used };
    });
    const used = rows.filter((r) => r.used).sort((a, b) => a.c.total - b.c.total);
    host.querySelectorAll('.rent-card').forEach((card) => card.classList.toggle('is-best', used.length > 1 && Number(card.dataset.i) === used[0].i));
    const verdict = $('verdict');
    if (used.length < 2) {
      verdict.innerHTML = '<p class="tool-result__label">비교 결과</p><p class="tool-sub">두 가지 이상 조건을 넣으면 비교해 드려요.</p>';
    } else {
      const best = used[0];
      verdict.innerHTML = `<p class="tool-result__label">${months}개월 기준 실주거비가 가장 적은 조건</p><strong class="tool-big">${escape(best.o.name)} · 월 ${won(best.c.total)}</strong><dl class="tool-rows">${used.slice(1).map((r) => `<div><dt>${escape(r.o.name)}보다<small>한 달 ${won(r.c.total - best.c.total)} 차이</small></dt><dd>${months}개월 ${koreanAmount((r.c.total - best.c.total) * months)} 적어요</dd></div>`).join('')}</dl><p class="bu-help" style="margin-top:.8rem">기회비용을 뺀 ‘매달 나가는 돈’만 보면 순서가 달라질 수 있어요. 보증금을 돌려받지 못할 위험과 이사·중개 비용은 들어 있지 않아요.</p>`;
    }
    renderConversion(rows);
    store.set(KEY, { options: rows.map((r) => r.o), savings: $('savings').value, months, baseRate: $('base-rate').value });
  }

  function renderConversion(rows) {
    const base = $('base-rate').value === '' ? NaN : Number($('base-rate').value);
    const cap = legalCapRate(base);
    const amount = parseAmount($('convert-amount').value);
    const offer = $('offer-rate').value === '' ? NaN : Number($('offer-rate').value);
    const implied = rows[0].used && rows[1].used ? impliedRate(rows[0].o, rows[1].o) : null;
    const lines = [];
    if (cap === null || !Number.isFinite(amount) || amount <= 0) {
      $('convert-big').textContent = '—';
      $('convert-sub').textContent = cap === null ? '기준금리를 넣어 주세요.' : '바꿀 보증금을 넣어 주세요.';
    } else {
      const monthly = rentForDeposit(amount, cap);
      $('convert-big').textContent = `월 ${won(Math.floor(monthly))}까지`;
      $('convert-sub').textContent = `상한 비율 연 ${num(cap, 2)}% (연 10%와 기준금리 ${num(base, 2)}% + 2% 중 낮은 값)`;
      lines.push(['법정 상한 비율', `연 ${num(cap, 2)}%`, '주택임대차보호법 제7조의2']);
      if (Number.isFinite(offer) && offer > 0) {
        const offered = rentForDeposit(amount, offer);
        lines.push(['제안받은 조건', `월 ${won(Math.floor(offered))}`, offer > cap ? `연 ${num(offer, 2)}% · 상한보다 높아요` : `연 ${num(offer, 2)}% · 상한 이내예요`]);
      }
    }
    if (implied !== null) lines.push([`${rows[0].o.name} ↔ ${rows[1].o.name} 전환율`, `연 ${num(implied, 2)}%`, cap === null ? '비교표 A·B 조건 기준' : implied > cap ? '상한보다 높아요 · 계약 중 전환이라면 확인해 보세요' : '상한 이내예요']);
    $('convert-rows').innerHTML = lines.map(([label, value, note]) => `<div><dt>${escape(label)}<small>${escape(note)}</small></dt><dd>${value}</dd></div>`).join('');
  }

  host.querySelectorAll('[data-field]').forEach((input) => {
    const hint = document.getElementById(`${input.id}-hint`);
    if (hint) bindAmount(input, hint, render);
    else input.addEventListener('input', render);
  });
  bindAmount($('convert-amount'), $('convert-hint'), render);
  for (const id of ['savings', 'months', 'base-rate', 'offer-rate']) $(id).addEventListener('input', render);
  $('months').addEventListener('change', render);
  $('convert-form').addEventListener('submit', (event) => event.preventDefault());
  render();
}
