// Ordinary public Yahoo chart data. No session, cookie, crumb or paid quote API.
const MAX_RESPONSE = 768 * 1024;
const MAX_POINTS = 1600;
const validTicker = value => typeof value === 'string' && /^[A-Z0-9.-]{1,12}$/.test(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const scalar = value => finite(value) ? value : null;
const text = (value, max = 100) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : null;
const positive = value => finite(value) && value > 0 ? value : null;
function stamp(value) { return finite(value) && value > 0 && value < 1e11 ? new Date(value * 1000).toISOString() : null; }
function dateInZone(timestamp, zone) {
  try {
    const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp * 1000)).map(p => [p.type, p.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch { return stamp(timestamp)?.slice(0, 10) || null; }
}
export function parsePriceHistory(payload, ticker, retrievedAt = new Date().toISOString()) {
  const rows = payload?.chart?.result, retrieved = Date.parse(retrievedAt);
  if (!validTicker(ticker) || !Number.isFinite(retrieved) || payload?.chart?.error || !Array.isArray(rows) || rows.length !== 1) throw new Error('INVALID_PRICE_HISTORY');
  const result = rows[0], meta = result?.meta;
  if (meta?.symbol !== ticker || !/^[A-Z]{3}$/.test(meta.currency || '') || !['EQUITY', 'ETF'].includes(meta.instrumentType) || !positive(meta.regularMarketPrice)) throw new Error('INVALID_PRICE_IDENTITY');
  const marketTime = stamp(meta.regularMarketTime);
  if (!marketTime || Date.parse(marketTime) > retrieved + 300000) throw new Error('INVALID_PRICE_OBSERVATION_TIME');
  const timestamps = result.timestamp, quote = result.indicators?.quote?.[0], adjusted = result.indicators?.adjclose?.[0]?.adjclose;
  if (!Array.isArray(timestamps) || timestamps.length > MAX_POINTS || !Array.isArray(quote?.close) || quote.close.length !== timestamps.length) throw new Error('INVALID_PRICE_SERIES');
  const points = [], seen = new Set();
  for (let index = 0; index < timestamps.length; index++) {
    const unix = timestamps[index], observedAt = stamp(unix), close = positive(quote.close[index]);
    if (!observedAt || Date.parse(observedAt) > retrieved + 300000 || !close) continue;
    const day = dateInZone(unix, meta.exchangeTimezoneName);
    if (!day || seen.has(day)) continue;
    seen.add(day);
    points.push({ date: day, timestamp: observedAt, close, adjustedClose: positive(adjusted?.[index]), volume: finite(quote.volume?.[index]) && quote.volume[index] >= 0 ? quote.volume[index] : null });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  const source = { provider: 'Yahoo Finance', url: `https://finance.yahoo.com/quote/${ticker}/history/`, field: 'chart.indicators.quote.close', unit: meta.currency, basis: 'Yahoo 일별 종가(close)는 주식분할을 조정하며 adjustedClose는 배당 등 추가 조정을 포함; 현재 주식 수 기준과 구분', asOf: marketTime, retrievedAt };
  // chartPreviousClose is the beginning of the requested RANGE, not yesterday.
  // Never use it to report the daily percentage change.
  const previousClose = positive(meta.regularMarketPreviousClose) ?? positive(meta.previousClose);
  const change = previousClose ? meta.regularMarketPrice - previousClose : null;
  const normalizedQuote = { price: meta.regularMarketPrice, previousClose, change, changePercent: previousClose ? change / previousClose * 100 : null,
    marketTime, marketState: text(meta.marketState, 30), exchange: text(meta.fullExchangeName || meta.exchangeName), exchangeTimezoneName: text(meta.exchangeTimezoneName), exchangeTimezoneShortName: text(meta.timezone, 30), delayMinutes: scalar(meta.exchangeDataDelayedBy), currency: meta.currency, source: { ...source, field: 'chart.meta.regularMarketPrice', basis: '정규시장 가격 · 거래소 기준 시각 별도' } };
  for (const prefix of ['preMarket', 'postMarket']) {
    const at = stamp(meta[prefix + 'Time']), price = positive(meta[prefix + 'Price']);
    normalizedQuote[prefix] = price && at && Date.parse(at) <= retrieved + 300000 ? { price, marketTime: at, change: scalar(meta[prefix + 'Change']), changePercent: scalar(meta[prefix + 'ChangePercent']), source: { ...source, field: `chart.meta.${prefix}Price`, asOf: at, basis: prefix === 'preMarket' ? '장전 가격' : '시간외 가격' } } : null;
  }
  const splitRows = Object.values(result.events?.splits || {});
  if (splitRows.length > 200) throw new Error('INVALID_SPLIT_HISTORY');
  const splits = splitRows.filter(event => event && positive(event.numerator) && positive(event.denominator) && stamp(event.date) && event.date * 1000 <= retrieved + 300000).map(event => ({ date: dateInZone(event.date, meta.exchangeTimezoneName), numerator: event.numerator, denominator: event.denominator, source: { ...source, field: 'chart.events.splits', basis: '공개 시세 제공자의 주식분할 기록' } })).sort((a, b) => a.date.localeCompare(b.date));
  return { status: points.length ? 'available' : 'partial', ticker, currency: meta.currency, interval: '1d', range: '5y', closeBasis: 'split-adjusted', adjustedCloseBasis: 'split-and-distribution-adjusted', points, splits, quote: normalizedQuote, source,
    start: points[0]?.date || null, end: points.at(-1)?.date || null, retrievedAt, asOf: marketTime,
    freshness: `일별 공개 시세 · 거래소 지연 ${normalizedQuote.delayMinutes ?? '미확인'}분 · 실시간 체결가 아님`,
    reason: points.length ? null : '정규시장 가격은 확인했으나 일별 종가가 없습니다.' };
}

async function boundedJson(response) {
  if (!response.ok) { await response.body?.cancel(); throw new Error('PUBLIC_PRICES_UNAVAILABLE'); }
  if (Number(response.headers.get('Content-Length')) > MAX_RESPONSE) { await response.body?.cancel(); throw new Error('PRICE_HISTORY_TOO_LARGE'); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('EMPTY_PRICE_RESPONSE');
  const chunks = []; let length = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > MAX_RESPONSE) { await reader.cancel(); throw new Error('PRICE_HISTORY_TOO_LARGE'); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function createPriceService({ fetcher = globalThis.fetch, clock = () => Date.now() } = {}) {
  const cache = new Map(), pending = new Map();
  const get = async ticker => {
    if (!validTicker(ticker)) throw new Error('INVALID_TICKER');
    const cached = cache.get(ticker); if (cached?.expires > clock()) return cached.value;
    if (pending.has(ticker)) return pending.get(ticker);
    const work = (async () => {
      const retrievedAt = new Date(clock()).toISOString(); let value;
      try {
        const response = await fetcher(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5y&includePrePost=false&events=div%2Csplits`, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
        value = parsePriceHistory(await boundedJson(response), ticker, retrievedAt);
      } catch {
        value = { status: 'unavailable', ticker, currency: null, points: [], quote: null, retrievedAt, reason: '공개 일별 시세를 현재 읽을 수 없습니다.', source: { provider: 'Yahoo Finance', url: `https://finance.yahoo.com/quote/${ticker}/history/`, retrievedAt } };
      }
      if (cache.size >= 16) cache.delete(cache.keys().next().value);
      cache.set(ticker, { value, expires: clock() + (value.status === 'available' ? 300000 : 60000) }); return value;
    })();
    pending.set(ticker, work); try { return await work; } finally { pending.delete(ticker); }
  };
  get.get = get; return get;
}
export const fetchPublicPriceHistory = createPriceService();
