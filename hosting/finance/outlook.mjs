// Public, reviewed source summaries. No user data or runtime model credentials.
const LIMIT = 120000;
const SOURCE_HOSTS = new Set(['www.apple.com', 'investor.apple.com', 'iren.gcs-web.com', 'www.globenewswire.com', 'www.marketbeat.com', 'www.reuters.com', 'www.sec.gov']);
const KINDS = new Set(['reported', 'management-guidance', 'analyst-estimate', 'inference']);
const isoDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) && Number.isFinite(Date.parse(value));
const text = (value, max = 1200) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);

export function validateCompanyOutlook(value, ticker, now = Date.now()) {
  if (!value || typeof value !== 'object' || value.version !== 1 || value.ticker !== ticker || !/^[A-Z0-9.-]{1,12}$/.test(ticker)) throw new Error('Invalid outlook identity.');
  if (!isoDate(value.asOf) || Date.parse(value.asOf) > now + 300000 || !text(value.periodLabel, 200)) throw new Error('Invalid outlook period.');
  if (value.mode !== 'curated-source-summary' || value.label !== 'AI 작성·출처 기반 요약') throw new Error('Outlook must distinguish a dated authored summary from a runtime model.');
  if (!Array.isArray(value.sources) || !value.sources.length || value.sources.length > 12) throw new Error('Outlook sources required.');
  const sourceIds = new Set();
  for (const source of value.sources) {
    if (!text(source.id, 80) || sourceIds.has(source.id) || !text(source.title, 300) || !isoDate(source.retrievedAt) || Date.parse(source.retrievedAt) > Date.parse(value.asOf) + 300000) throw new Error('Invalid source metadata.');
    if (source.publishedAt !== null && (!isoDate(source.publishedAt) || Date.parse(source.publishedAt) > Date.parse(value.asOf))) throw new Error('Future publication cannot support an outlook.');
    const url = new URL(source.url);
    if (url.protocol !== 'https:' || !SOURCE_HOSTS.has(url.hostname) || url.username || url.password || url.port) throw new Error('Unsupported outlook source.');
    sourceIds.add(source.id);
  }
  const cite = item => {
    if (!Array.isArray(item.sourceIds) || !item.sourceIds.length || item.sourceIds.some(id => !sourceIds.has(id))) throw new Error('Unknown outlook citation.');
  };
  for (const key of ['summary', 'watchItems', 'riskFactors']) {
    if (!Array.isArray(value[key]) || value[key].length > 10) throw new Error('Invalid outlook list.');
    for (const item of value[key]) {
      if (!text(item.text) || (key === 'summary' && !KINDS.has(item.kind))) throw new Error('Invalid outlook statement.');
      cite(item);
    }
  }
  for (const key of ['officialGuidance', 'consensus']) {
    const block = value[key];
    if (!block || !['available', 'partial', 'unavailable'].includes(block.status) || !Array.isArray(block.items) || block.items.length > 12) throw new Error('Invalid outlook estimate block.');
    for (const item of block.items) {
      if (!text(item.label, 200) || !text(item.text)) throw new Error('Invalid estimate label.');
      if (item.kind && !KINDS.has(item.kind)) throw new Error('Invalid estimate kind.');
      if (item.value !== undefined && !Number.isFinite(item.value)) throw new Error('Nonfinite estimate.');
      if (item.valueRange !== undefined && (!Array.isArray(item.valueRange) || item.valueRange.length !== 2 || !item.valueRange.every(Number.isFinite) || item.valueRange[0] > item.valueRange[1])) throw new Error('Invalid guidance range.');
      cite(item);
    }
  }
  if (value.nextEarnings) {
    if (!isoDate(value.nextEarnings.date) || value.nextEarnings.status !== 'company-announced') throw new Error('Invalid event date.');
    cite(value.nextEarnings);
  }
  if (value.business) {
    const b = value.business;
    if (b.currency !== 'USD' || !b.period || !isoDate(b.period.start) || !isoDate(b.period.end) || Date.parse(b.period.end) > Date.parse(value.asOf) || !Number.isFinite(b.totalRevenue) || b.totalRevenue <= 0 || !Array.isArray(b.segments) || b.segments.length > 12) throw new Error('Invalid business breakdown.');
    let total = 0;
    for (const segment of b.segments) {
      if (!text(segment.label, 120) || !Number.isFinite(segment.value) || segment.value < 0) throw new Error('Invalid segment amount.');
      cite(segment); total += segment.value;
    }
    if (Math.abs(total - b.totalRevenue) > Math.max(1, b.totalRevenue * 0.000001)) throw new Error('Business segments do not reconcile.');
    if (!['quarterly', 'annual'].includes(b.period.basis) || Date.parse(b.period.start) >= Date.parse(b.period.end)) throw new Error('Invalid business duration.');
    if (b.income && (Object.values(b.income).some(amount => !Number.isFinite(amount)) || b.income.revenue !== b.totalRevenue)) throw new Error('Invalid business income amounts.');
    cite(b);
  }
  if (value.arr) {
    if (!text(value.arr.definition) || value.arr.currency !== 'USD') throw new Error('Invalid ARR definition.');
    cite(value.arr);
    for (const key of ['operating', 'contracted', 'target']) {
      const item = value.arr[key];
      if (!item || !Number.isFinite(item.value) || item.value < 0 || !text(item.label, 120)) throw new Error('Invalid ARR basis.');
      if (key !== 'target' && (!isoDate(item.effectiveAt) || Date.parse(item.effectiveAt) > Date.parse(value.asOf))) throw new Error('Future ARR cannot be reported as realized.');
      if (key === 'target' && !isoDate(item.targetDate)) throw new Error('ARR target date required.');
      cite(item);
    }
  }
  return value;
}

/** Fixed same-origin asset read, never a public URL proxy. */
export async function loadCompanyOutlook(request, env, ticker, { clock = () => Date.now() } = {}) {
  if (!/^[A-Z0-9.-]{1,12}$/.test(ticker || '') || !env.ASSETS?.fetch) return null;
  try {
    const target = new URL(request.url);
    target.pathname = `/finance/outlooks/${ticker}.json`; target.search = ''; target.hash = '';
    const response = await env.ASSETS.fetch(new Request(target, { method: 'GET', headers: { Accept: 'application/json' } }));
    if (!response.ok) return null;
    if (Number(response.headers.get('Content-Length')) > LIMIT) { await response.body?.cancel(); return null; }
    const reader = response.body?.getReader(); if (!reader) return null;
    const chunks = []; let size = 0;
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > LIMIT) { await reader.cancel(); return null; } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const outlook = validateCompanyOutlook(JSON.parse(new TextDecoder().decode(bytes)), ticker, clock());
    const ageDays = Math.max(0, (clock() - Date.parse(outlook.asOf)) / 86400000);
    const eventPassed = !!outlook.nextEarnings && Date.parse(outlook.nextEarnings.date + 'T23:59:59Z') < clock();
    return { ...outlook, stale: ageDays > 7 || eventPassed, ageDays: Math.round(ageDays * 10) / 10, eventPassed,
      freshnessNote: eventPassed ? '예정 발표일이 지났습니다. 당시 관점의 보관 요약이며 새 발표를 확인해야 합니다.' : ageDays > 7 ? '작성 후 7일이 지난 보관 요약입니다. 새 발표·예상치 변동을 확인해 주세요.' : '표시한 자료 수집 시점의 출처 기반 요약이며 자동 실시간 분석이 아닙니다.' };
  } catch { return null; }
}
