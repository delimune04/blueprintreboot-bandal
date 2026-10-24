// 학점 계산기 page. Courses are kept in this browser (best-effort localStorage).
import { PASS_FAIL, SCALES, byTerm, convert, neededAverage, summarize, truncate2 } from './gpa.mjs';
import { num, store } from '../common.mjs';

const body = document.getElementById('rows');
if (body) {
  const $ = (id) => document.getElementById(id);
  const KEY = 'tools:gpa:v1';
  const TERMS = ['1-1', '1-2', '2-1', '2-2', '3-1', '3-2', '4-1', '4-2', '계절', '기타'];
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const saved = store.get(KEY, null);
  let scale = saved?.scale === '4.3' ? '4.3' : '4.5';
  let courses = Array.isArray(saved?.courses) && saved.courses.length
    ? saved.courses.map((c) => ({ term: TERMS.includes(c.term) ? c.term : '1-1', name: String(c.name || '').slice(0, 60), credits: Number(c.credits) || 3, grade: String(c.grade || 'A+'), major: Boolean(c.major) }))
    : [
      { term: '1-1', name: '', credits: 3, grade: 'A+', major: true },
      { term: '1-1', name: '', credits: 3, grade: SCALES[scale].grades[1][0], major: false },
      { term: '1-1', name: '', credits: 2, grade: 'P', major: false },
    ];
  if (saved?.target) $('target').value = saved.target;
  if (saved?.remaining !== undefined) $('remaining').value = saved.remaining;

  const gradeOptions = (selected) => [...SCALES[scale].grades.map(([g]) => g), ...PASS_FAIL]
    .map((g) => `<option value="${g}"${g === selected ? ' selected' : ''}>${g}</option>`).join('');
  const termOptions = (selected) => TERMS.map((t) => `<option value="${t}"${t === selected ? ' selected' : ''}>${t}</option>`).join('');

  function draw() {
    body.innerHTML = courses.map((c, i) => `<tr data-i="${i}">
      <td><select class="bu-input" data-field="term" aria-label="${i + 1}번째 과목 학기">${termOptions(c.term)}</select></td>
      <td><input class="bu-input" data-field="name" type="text" maxlength="60" value="${escape(c.name)}" placeholder="과목명 (선택)" aria-label="${i + 1}번째 과목명"></td>
      <td><select class="bu-input" data-field="credits" aria-label="${i + 1}번째 과목 학점">${[0.5, 1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}"${n === c.credits ? ' selected' : ''}>${n}</option>`).join('')}</select></td>
      <td><select class="bu-input" data-field="grade" aria-label="${i + 1}번째 과목 성적">${gradeOptions(c.grade)}</select></td>
      <td><input type="checkbox" data-field="major"${c.major ? ' checked' : ''} aria-label="${i + 1}번째 과목 전공"></td>
      <td><button type="button" class="gpa-remove" data-remove aria-label="${i + 1}번째 과목 삭제">×</button></td>
    </tr>`).join('');
    $('scale-table').innerHTML = SCALES[scale].grades.map(([g, p]) => `<tr><th scope="row">${g}</th><td>${p.toFixed(1)}</td></tr>`).join('') + '<tr><th scope="row">P / NP</th><td>평점 제외</td></tr>';
    document.querySelectorAll('[data-scale]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scale === scale)));
    $('target').max = String(SCALES[scale].max);
    compute();
  }

  function compute() {
    const s = summarize(courses, scale);
    const max = SCALES[scale].max;
    const other = scale === '4.5' ? 4.3 : 4.5;
    $('gpa').textContent = s.gpa === null ? '—' : `${truncate2(s.gpa).toFixed(2)} / ${max}`;
    $('gpa-sub').textContent = s.gpa === null ? '평점에 들어가는 과목을 입력해 주세요.' : `계산값 ${num(s.gpa, 4)} · 비례 환산 ${other} 만점 ${num(convert(s.gpa, max, other), 2)} · 4.0 만점 ${num(convert(s.gpa, max, 4), 2)}`;
    $('summary').innerHTML = [
      ['이수학점', `${num(s.earned, 1)}학점`, `P ${num(s.passCredits, 1)}학점 포함 · F·NP 제외`],
      ['평점 반영 학점', `${num(s.gpaCredits, 1)}학점`, 'P·NP 제외'],
      ['전공 평점', s.majorGpa === null ? '—' : `${truncate2(s.majorGpa).toFixed(2)}`, `${num(s.majorCredits, 1)}학점`],
    ].map(([label, value, note]) => `<div><dt>${label}<small>${note}</small></dt><dd>${value}</dd></div>`).join('');
    const terms = byTerm(courses, scale).filter((t) => t.gpa !== null);
    $('terms').innerHTML = terms.length > 1 ? terms.map((t) => `<div><span>${escape(t.term)} 학기 · ${num(t.gpaCredits, 1)}학점</span><strong>${truncate2(t.gpa).toFixed(2)}</strong></div>`).join('') : '';
    const target = Number($('target').value);
    const remaining = Number($('remaining').value);
    const needed = neededAverage({ gpa: s.gpa, credits: s.gpaCredits, remaining, target });
    const out = $('needed');
    if (!(target > 0) || needed === null) out.textContent = '남은 학점을 넣으면 필요한 평균을 알려 드려요.';
    else if (needed > max) out.innerHTML = `남은 ${num(remaining)}학점을 모두 ${max}로 받아도 ${num(target, 2)}에 닿기 어려워요. 남은 학점을 늘려 다시 계산해 보세요.`;
    else if (needed <= 0) out.innerHTML = '지금 평점으로 이미 목표를 넘었어요.';
    else out.innerHTML = `남은 ${num(remaining)}학점에서 평균 <strong>${(Math.ceil(needed * 100) / 100).toFixed(2)}</strong> 이상이 필요해요.`;
    store.set(KEY, { scale, courses, target: $('target').value, remaining: $('remaining').value });
  }

  const edit = (event) => {
    const row = event.target.closest('tr[data-i]');
    const field = event.target.dataset.field;
    if (!row || !field) return;
    const course = courses[Number(row.dataset.i)];
    course[field] = field === 'major' ? event.target.checked : field === 'credits' ? Number(event.target.value) : event.target.value;
    compute();
  };
  body.addEventListener('input', edit);
  body.addEventListener('change', edit);
  body.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove]');
    if (!remove) return;
    courses.splice(Number(remove.closest('tr').dataset.i), 1);
    draw();
  });
  $('add-row').addEventListener('click', () => {
    const lastTerm = courses.at(-1)?.term || '1-1';
    courses.push({ term: lastTerm, name: '', credits: 3, grade: SCALES[scale].grades[0][0], major: false });
    draw();
    body.querySelector('tr:last-child [data-field="name"]')?.focus();
  });
  $('add-term').addEventListener('click', () => {
    const lastTerm = courses.at(-1)?.term || '1-1';
    const next = TERMS[Math.min(TERMS.indexOf(lastTerm) + 1, TERMS.length - 1)];
    courses.push({ term: next, name: '', credits: 3, grade: SCALES[scale].grades[0][0], major: false });
    draw();
  });
  $('reset').addEventListener('click', () => {
    courses = [{ term: '1-1', name: '', credits: 3, grade: SCALES[scale].grades[0][0], major: false }];
    draw();
  });
  // Switching scales keeps the letter: A0 ↔ A, B0 ↔ B …; 4.3's minus grades become the 4.5 base grade.
  const relabel = (grade, to) => {
    if (PASS_FAIL.includes(grade) || grade === 'F' || grade.endsWith('+')) return grade;
    const letter = grade[0];
    return to === '4.5' ? `${letter}0` : letter;
  };
  document.querySelectorAll('[data-scale]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.scale === scale) return;
    scale = button.dataset.scale;
    courses.forEach((c) => { c.grade = relabel(c.grade, scale); });
    draw();
  }));
  $('target').addEventListener('input', compute);
  $('remaining').addEventListener('input', compute);
  draw();
}
