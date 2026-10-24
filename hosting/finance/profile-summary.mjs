// Reviewed Korean summaries of the captured public business profiles. This is a
// source-backed editorial pack, not an online model or an automatic translation.
const MAX_PACK = 75 * 1024;
const validTicker = value => typeof value === 'string' && /^[A-Z0-9.-]{1,12}$/.test(value);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const validText = value => typeof value === 'string' && value.trim().length >= 20 && value.length <= 1000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);

export function validateProfileSummary(item, ticker, now = Date.now()) {
  if (!validTicker(ticker) || item?.ticker !== ticker || !validText(item.description) || !validDate(item.authoredAt) || Date.parse(item.authoredAt) > now + 300000) return null;
  const source = item.source;
  if (source?.provider !== 'Yahoo Finance' || source.url !== `https://finance.yahoo.com/quote/${ticker}/profile/` || source.field !== 'assetProfile' || !validDate(source.retrievedAt) || Date.parse(source.retrievedAt) > now + 300000 || Date.parse(source.retrievedAt) > Date.parse(item.authoredAt) + 300000) return null;
  return { ticker, description: item.description.trim(), source: { provider: source.provider, url: source.url, field: source.field, retrievedAt: source.retrievedAt, basis: '공개 기업 프로필을 읽고 요약한 한국어 사업 소개; 회사가 공시한 실적 수치·가이던스와 별도' }, authoredAt: item.authoredAt,
    sourceDescriptionSha256: typeof item.sourceDescriptionSha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sourceDescriptionSha256) ? item.sourceDescriptionSha256 : null,
    label: '공개 기업 소개를 요약한 한국어 설명', method: 'reviewed-source-summary' };
}

async function boundedPack(response) {
  if (!response?.ok) { await response?.body?.cancel(); throw new Error('PROFILE_SUMMARY_UNAVAILABLE'); }
  if (Number(response.headers.get('Content-Length')) > MAX_PACK) { await response.body?.cancel(); throw new Error('PROFILE_SUMMARY_TOO_LARGE'); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('PROFILE_SUMMARY_EMPTY');
  const chunks = []; let length = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > MAX_PACK) { await reader.cancel(); throw new Error('PROFILE_SUMMARY_TOO_LARGE'); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function createProfileSummaryService({ assets, clock = () => Date.now(), request } = {}) {
  let cache = null, pending = null;
  async function load() {
    if (cache?.expires > clock()) return cache.value;
    if (pending) return pending;
    pending = (async () => {
      let value = null;
      try {
        if (typeof assets?.fetch !== 'function') return null;
        const response = await assets.fetch(new Request(new URL('/finance/profiles/KOREAN.json', request?.url || 'https://bandal.app')));
        const pack = await boundedPack(response);
        if (pack?.schemaVersion !== 1 || pack.language !== 'ko' || !pack.companies || Array.isArray(pack.companies) || typeof pack.companies !== 'object' || Object.keys(pack.companies).length > 100) return null;
        value = pack.companies;
      } catch { /* A missing or invalid editorial pack must not hide raw sources. */ }
      finally { cache = { value, expires: clock() + (value ? 3600000 : 60000) }; }
      return value;
    })();
    try { return await pending; } finally { pending = null; }
  }
  return { async get(ticker) { if (!validTicker(ticker)) throw new Error('INVALID_TICKER'); const pack = await load(); return validateProfileSummary(pack?.[ticker], ticker, clock()); } };
}
