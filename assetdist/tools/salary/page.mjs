// 연봉 실수령액 계산기 page. Inputs stay in this browser; the URL carries them
// only when the visitor copies a share link.
import { calculateSalary, RATES } from './salary.mjs';
import { bindAmount, copy, koreanAmount, num, parseAmount, won } from '../common.mjs';

const form = document.getElementById('salary-form');
if (form) {
  const $ = (id) => document.getElementById(id);
  const amount = $('amount');
  const nontax = $('nontax');
  const family = $('family');
  const children = $('children');
  const severance = $('severance');
  let mode = 'annual';
  let percent = 100;
  let table = null;
  let last = null;

  family.innerHTML = Array.from({ length: 11 }, (_, i) => `<option value="${i + 1}">${i + 1}명${i === 0 ? ' (본인만)' : ''}</option>`).join('') + '<option value="12">12명</option><option value="13">13명</option>';
  const fillChildren = () => {
    const max = Math.max(0, Number(family.value) - 1);
    const current = Math.min(Number(children.value || 0), max);
    children.innerHTML = Array.from({ length: max + 1 }, (_, i) => `<option value="${i}">${i ? `${i}명` : '없음'}</option>`).join('');
    children.value = String(current);
  };

  // Restore from a shared link, if any.
  const params = new URLSearchParams(location.search);
  if (params.get('m') === 'monthly') mode = 'monthly';
  if (Number.isFinite(parseAmount(params.get('a')))) amount.value = num(parseAmount(params.get('a')));
  if (Number.isFinite(parseAmount(params.get('n')))) nontax.value = num(parseAmount(params.get('n')));
  family.value = String(Math.min(13, Math.max(1, Number.parseInt(params.get('f'), 10) || 1)));
  fillChildren();
  children.value = String(Math.min(Number(family.value) - 1, Math.max(0, Number.parseInt(params.get('c'), 10) || 0)));
  if ([80, 120].includes(Number(params.get('p')))) percent = Number(params.get('p'));
  severance.checked = params.get('s') === '1';

  const syncMode = () => {
    form.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('amount-label').textContent = mode === 'annual' ? '연봉 (세전)' : '월급 (세전, 비과세 포함)';
    $('severance-row').hidden = mode !== 'annual';
    form.querySelectorAll('[data-add]').forEach((b) => {
      const step = Number(b.dataset.add) / (mode === 'annual' ? 1 : 10);
      b.dataset.step = String(step);
      b.textContent = `${step > 0 ? '+' : '−'}${koreanAmount(Math.abs(step)).replace(/원$/, '')}`;
    });
  };
  const syncPercent = () => form.querySelectorAll('[data-percent]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.percent) === percent)));

  const SLICES = [
    ['pension', '국민연금', '#7c3aed'],
    ['health', '건강보험', '#6366f1'],
    ['care', '장기요양', '#a78bfa'],
    ['employment', '고용보험', '#c4b5fd'],
    ['incomeTax', '근로소득세', '#f59e0b'],
    ['localTax', '지방소득세', '#fbbf24'],
  ];

  function render() {
    if (!table) return;
    const value = parseAmount(amount.value);
    const nonTaxable = parseAmount(nontax.value);
    if (!Number.isFinite(value) || value <= 0) {
      $('net').textContent = '—';
      $('net-sub').textContent = mode === 'annual' ? '연봉을 입력해 주세요.' : '월급을 입력해 주세요.';
      $('rows').innerHTML = '';
      $('stack').innerHTML = '';
      $('legend').innerHTML = '';
      last = null;
      return;
    }
    const input = {
      [mode === 'annual' ? 'annual' : 'monthly']: value,
      nonTaxable: Number.isFinite(nonTaxable) ? nonTaxable : 0,
      family: Number(family.value),
      children: Number(children.value),
      percent,
      severanceIncluded: mode === 'annual' && severance.checked,
    };
    const r = calculateSalary(table, input);
    last = { input, r };
    $('net').textContent = won(r.net);
    $('net-sub').textContent = `연 환산 약 ${koreanAmount(r.annualNet)} · 세전 월 ${won(r.gross)}에서 ${num(r.rate * 100, 1)}% 공제`;
    const insurance = r.pension + r.health + r.care + r.employment;
    $('rows').innerHTML = [
      ['월 세전 급여', r.gross, `비과세 ${won(r.nonTaxable)} 포함`],
      ['국민연금', -r.pension, `기준소득월액 ${won(r.pensionBase)} × 4.75%`],
      ['건강보험', -r.health, '과세 급여 × 3.595%'],
      ['장기요양보험', -r.care, '건강보험료 × 0.9448% ÷ 7.19%'],
      ['고용보험', -r.employment, '과세 급여 × 0.9%'],
      ['근로소득세', -r.incomeTax, `간이세액표 ${percent}% · 가족 ${input.family}명${input.children ? ` · 자녀 ${input.children}명` : ''}`],
      ['지방소득세', -r.localTax, '근로소득세 × 10%'],
      ['공제 합계', -r.deductions, `4대보험 ${won(insurance)} · 세금 ${won(r.incomeTax + r.localTax)}`],
    ].map(([label, amountValue, note], index, list) => `<div${index === list.length - 1 ? ' class="is-total"' : ''}><dt>${label}<small>${note}</small></dt><dd>${amountValue < 0 ? '−' : ''}${won(Math.abs(amountValue))}</dd></div>`).join('');
    const total = Math.max(1, r.gross);
    $('stack').innerHTML = `<span style="flex:0 0 ${(r.net / total) * 100}%;background:#e4f6ef"></span>${SLICES.map(([key, , color]) => `<span style="flex:0 0 ${(r[key] / total) * 100}%;background:${color}"></span>`).join('')}`;
    $('legend').innerHTML = `<span><i style="background:#e4f6ef;outline:1px solid #b9e4d2"></i>실수령</span>${SLICES.map(([, label, color]) => `<span><i style="background:${color}"></i>${label}</span>`).join('')}`;
  }

  const shareUrl = () => {
    const url = new URL(location.href.split('?')[0]);
    url.searchParams.set('m', mode);
    url.searchParams.set('a', String(parseAmount(amount.value) || 0));
    url.searchParams.set('n', String(parseAmount(nontax.value) || 0));
    url.searchParams.set('f', family.value);
    url.searchParams.set('c', children.value);
    url.searchParams.set('p', String(percent));
    if (mode === 'annual' && severance.checked) url.searchParams.set('s', '1');
    return url.href;
  };

  bindAmount(amount, $('amount-hint'), render);
  bindAmount(nontax, null, render);
  family.addEventListener('change', () => { fillChildren(); render(); });
  children.addEventListener('change', render);
  severance.addEventListener('change', render);
  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('click', (event) => {
    const modeButton = event.target.closest('[data-mode]');
    if (modeButton && modeButton.dataset.mode !== mode) {
      const value = parseAmount(amount.value);
      mode = modeButton.dataset.mode;
      if (Number.isFinite(value) && value > 0) amount.value = num(mode === 'monthly' ? Math.round(value / 12) : value * 12);
      amount.dispatchEvent(new Event('input'));
      syncMode();
      render();
    }
    const percentButton = event.target.closest('[data-percent]');
    if (percentButton) { percent = Number(percentButton.dataset.percent); syncPercent(); render(); }
    const add = event.target.closest('[data-add]');
    if (add) {
      const next = Math.max(0, (parseAmount(amount.value) || 0) + Number(add.dataset.step));
      amount.value = num(next);
      amount.dispatchEvent(new Event('input'));
    }
  });
  $('copy-result').addEventListener('click', () => {
    if (!last) return;
    const { r } = last;
    copy([
      `월 예상 실수령액 ${won(r.net)} (세전 ${won(r.gross)})`,
      `국민연금 ${won(r.pension)} · 건강보험 ${won(r.health)} · 장기요양 ${won(r.care)} · 고용보험 ${won(r.employment)}`,
      `근로소득세 ${won(r.incomeTax)} · 지방소득세 ${won(r.localTax)}`,
      `${RATES.basis} 추정 · 반달 도구함 ${shareUrl()}`,
    ].join('\n'));
  });
  $('share-result').addEventListener('click', () => copy(shareUrl()));

  syncMode();
  syncPercent();
  fetch(new URL('./tax-table.json', import.meta.url))
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((data) => { table = data; render(); })
    .catch(() => {
      $('net').textContent = '—';
      $('net-sub').textContent = '세액표를 불러오지 못했어요. 새로고침해 주세요.';
    });
}
