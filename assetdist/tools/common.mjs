// Shared helpers for 반달 도구함 pages. Pure formatting functions are tested;
// the DOM helpers degrade quietly when BANDAL UI or storage is unavailable.

const numberFormat = new Intl.NumberFormat('ko-KR');

export const won = (value) => `${numberFormat.format(Math.round(value || 0))}원`;
export const num = (value, digits = 0) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value || 0);

/** Parses "4,000만", "1억 2천", "4천만원", "3500000" or "350만원" into 원. Returns NaN when unreadable. */
export function parseAmount(text) {
  const raw = String(text ?? '').replace(/[,\s원]/g, '');
  if (!raw) return NaN;
  if (/^\d+(\.\d+)?$/.test(raw)) return Math.round(Number(raw));
  const units = { 억: 1e8, 천만: 1e7, 백만: 1e6, 만: 1e4 };
  const token = /(\d+(?:\.\d+)?)(억|천만|백만|만|천)?/y;
  let total = 0, last = null, index = 0;
  while (index < raw.length) {
    token.lastIndex = index;
    const match = token.exec(raw);
    if (!match) return NaN;
    const [whole, digits, unit] = match;
    // After 억, a bare 천 means 천만 ("1억 2천"); on its own it is 천 원.
    const scale = unit === '천' ? (last === '억' ? 1e7 : 1e3) : unit ? units[unit] : 1;
    total += Number(digits) * scale;
    last = unit || null;
    index += whole.length;
  }
  return Number.isFinite(total) ? Math.round(total) : NaN;
}

/** 41,234,000 → "4,123만 4,000원" style reading aid. */
export function koreanAmount(value) {
  const amount = Math.round(value || 0);
  if (amount <= 0) return '0원';
  const eok = Math.floor(amount / 1e8);
  const man = Math.floor((amount % 1e8) / 1e4);
  const rest = amount % 1e4;
  const parts = [];
  if (eok) parts.push(`${numberFormat.format(eok)}억`);
  if (man) parts.push(`${numberFormat.format(man)}만`);
  if (rest) parts.push(numberFormat.format(rest));
  return `${parts.join(' ')}원`;
}

/** Formats an amount field on blur and shows a Korean reading in its hint. */
export function bindAmount(input, hint, onChange) {
  const update = () => {
    const value = parseAmount(input.value);
    input.setAttribute('aria-invalid', String(input.value.trim() !== '' && !Number.isFinite(value)));
    if (hint) hint.textContent = Number.isFinite(value) && value > 0 ? koreanAmount(value) : '';
    onChange?.(value);
  };
  input.addEventListener('input', update);
  input.addEventListener('blur', () => {
    const value = parseAmount(input.value);
    if (Number.isFinite(value)) input.value = numberFormat.format(value);
  });
  update();
}

export const ui = () => window.BandalUI;
export const toast = (message) => ui()?.toast?.(message);

const memory = new Map();
export const store = {
  get: (key, fallback) => ui()?.store?.get(key, fallback) ?? (memory.has(key) ? memory.get(key) : fallback),
  set: (key, value) => { memory.set(key, value); return ui()?.store?.set(key, value) ?? false; },
  remove: (key) => { memory.delete(key); ui()?.store?.remove(key); },
};

export async function copy(text, html) {
  try {
    if (html && window.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      })]);
    } else {
      await navigator.clipboard.writeText(text);
    }
    toast('복사했어요.');
    return true;
  } catch {
    toast('복사하지 못했어요. 직접 선택해 복사해 주세요.');
    return false;
  }
}
