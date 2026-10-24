// 글자수 세기 page. The text never leaves the browser; a draft is kept in
// localStorage only while the visitor leaves "임시 저장" switched on.
import { countText, tidyBlankLines, tidySpaces } from './count.mjs';
import { copy, num, store, toast } from '../common.mjs';

const area = document.getElementById('text');
if (area) {
  const $ = (id) => document.getElementById(id);
  const DRAFT = 'tools:char-count:draft';
  const KEEP = 'tools:char-count:keep';
  const goal = $('goal');
  const unit = $('goal-unit');
  const keep = $('keep-draft');
  const LABELS = {
    chars: ['공백 포함', '자'],
    charsNoSpace: ['공백 제외', '자'],
    utf8Bytes: ['UTF-8 바이트', '바이트'],
    legacyBytes: ['한글 2바이트', '바이트'],
  };
  let undo = null;

  keep.checked = store.get(KEEP, false) === true;
  if (keep.checked) area.value = String(store.get(DRAFT, '') || '');

  function render() {
    if (keep.checked) store.set(DRAFT, area.value);
    const c = countText(area.value);
    $('chars').textContent = `${num(c.chars)}자`;
    $('stats').innerHTML = [
      ['공백 제외', `${num(c.charsNoSpace)}자`],
      ['UTF-8 바이트', num(c.utf8Bytes)],
      ['한글 2바이트', num(c.legacyBytes)],
      ['단어', num(c.words)],
      ['문장', num(c.sentences)],
      ['줄 · 문단', `${num(c.lines)} · ${num(c.paragraphs)}`],
    ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
    const target = Math.max(0, Math.floor(Number(goal.value) || 0));
    const [label, suffix] = LABELS[unit.value];
    $('goal-suffix').textContent = suffix;
    const value = c[unit.value];
    const meter = $('meter');
    const status = $('goal-status');
    if (!target) {
      meter.style.width = '0';
      status.textContent = '목표 분량을 넣으면 남은 양을 알려 드려요.';
      status.classList.remove('is-over');
      return;
    }
    meter.style.width = `${Math.min(100, (value / target) * 100)}%`;
    meter.classList.toggle('is-over', value > target);
    status.classList.toggle('is-over', value > target);
    status.textContent = value > target
      ? `${label} 기준 ${num(value - target)}${suffix} 넘었어요.`
      : `${label} 기준 ${num(target - value)}${suffix} 남았어요 (${num((value / target) * 100, 0)}%).`;
  }

  area.addEventListener('input', render);
  goal.addEventListener('input', render);
  unit.addEventListener('change', render);
  document.querySelectorAll('[data-goal]').forEach((button) => button.addEventListener('click', () => { goal.value = button.dataset.goal; render(); }));
  keep.addEventListener('change', () => {
    store.set(KEEP, keep.checked);
    if (keep.checked) { store.set(DRAFT, area.value); toast('이 브라우저에 임시 저장해요.'); }
    else { store.remove(DRAFT); toast('임시 저장한 글을 지웠어요.'); }
  });
  const replace = (next) => {
    if (next === area.value) { toast('바꿀 부분이 없어요.'); return; }
    undo = area.value;
    area.value = next;
    render();
    toast('정리했어요. 지우기 옆 되돌리기로 돌아갈 수 있어요.');
    $('clear-text').textContent = '되돌리기';
  };
  $('tidy-spaces').addEventListener('click', () => replace(tidySpaces(area.value)));
  $('tidy-lines').addEventListener('click', () => replace(tidyBlankLines(area.value)));
  $('copy-text').addEventListener('click', () => copy(area.value));
  $('clear-text').addEventListener('click', () => {
    if (undo !== null) {
      area.value = undo;
      undo = null;
      $('clear-text').textContent = '지우기';
      render();
      return;
    }
    if (!area.value) return;
    undo = area.value;
    area.value = '';
    $('clear-text').textContent = '되돌리기';
    render();
    area.focus();
  });
  area.addEventListener('input', () => {
    if (undo !== null) { undo = null; $('clear-text').textContent = '지우기'; }
  });
  render();
}
