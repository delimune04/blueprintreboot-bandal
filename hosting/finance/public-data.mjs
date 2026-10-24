// Parse only JSON already published in Yahoo's public statistics page. No
// authenticated quoteSummary request, crumb extraction or script execution.
const MAX_HTML = 3 * 1024 * 1024;
const MAX_CHART = 256 * 1024;
const validTicker = ticker => typeof ticker === 'string' && /^[A-Z0-9.-]{1,12}$/.test(ticker);
const number = field => typeof field?.raw === 'number' && Number.isFinite(field.raw) ? field.raw : null;
const scalar = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : null;
const unixDate = value => Number.isFinite(value) && value > 0 && value < 1e11 ? new Date(value * 1000).toISOString() : null;
const providerDate = field => unixDate(field?.raw)?.slice(0, 10) || date(field?.fmt);
function rejectFutureActual(value, retrievedAt) {
  const observed = Date.parse(retrievedAt);
  if (!Number.isFinite(observed) || value && Date.parse(value) > observed + 300000) throw new Error('FUTURE_PUBLIC_OBSERVATION');
}
const decodeAttribute = text => text.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
const unavailable = (ticker, retrievedAt, reason) => ({ status: 'unavailable', ticker, currency: 'USD', provider: 'Yahoo Finance', price: null, marketCap: null, reportedPE: null, reportedPS: null, evidence: {}, unavailableReasons: {}, retrievedAt, reason, sourceUrl: `https://finance.yahoo.com/quote/${ticker}/key-statistics/` });

export function parseYahooStatisticsHtml(html, ticker, retrievedAt = new Date().toISOString()) {
  if (!validTicker(ticker) || typeof html !== 'string' || html.length > MAX_HTML) throw new Error('INVALID_PUBLIC_PAGE');
  let modules = null;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const [, attributes, body] = match;
    if (!/\btype=["']application\/json["']/i.test(attributes) || !/\bdata-sveltekit-fetched\b/.test(attributes)) continue;
    const rawUrl = /\bdata-url="([^"]+)"/.exec(attributes)?.[1];
    if (!rawUrl) continue;
    let target;
    try { target = new URL(decodeAttribute(rawUrl)); } catch { continue; }
    if (target.origin !== 'https://query1.finance.yahoo.com' || target.pathname !== `/v10/finance/quoteSummary/${ticker}` || body.length > 1024 * 1024) continue;
    try {
      const envelope = JSON.parse(body);
      if (envelope.status !== 200 || typeof envelope.body !== 'string') continue;
      const payload = JSON.parse(envelope.body), result = payload.quoteSummary?.result;
      if (payload.quoteSummary?.error || !Array.isArray(result) || result.length !== 1) continue;
      const found = result[0];
      if (found?.price?.symbol !== ticker || found.price.currency !== 'USD' || !['EQUITY', 'ETF'].includes(found.price.quoteType)) continue;
      modules = found; break;
    } catch { /* A page may contain unrelated, malformed JSON blocks. */ }
  }
  if (!modules) throw new Error('PUBLIC_COMPANY_JSON_UNAVAILABLE');
  const p = modules.price, stats = modules.defaultKeyStatistics || {}, f = modules.financialData || {}, summary = modules.summaryDetail || {};
  const financialsInUSD = f.financialCurrency === 'USD';
  const sourceUrl = `https://finance.yahoo.com/quote/${ticker}/key-statistics/`;
  const marketTime = unixDate(p.regularMarketTime), periodEnd = providerDate(stats.mostRecentQuarter);
  rejectFutureActual(marketTime, retrievedAt); rejectFutureActual(periodEnd, retrievedAt);
  const result = { ...unavailable(ticker, retrievedAt, null), status: 'available', name: String(p.longName || p.shortName || ticker).slice(0, 300), sourceUrl,
    latestTradingDay: marketTime?.slice(0, 10) || null, marketTime, latestQuarter: periodEnd, freshness: `Yahoo 공개 페이지 조회 스냅샷 · 거래소 지연 ${Number.isFinite(p.exchangeDataDelayedBy) ? p.exchangeDataDelayedBy : '미확인'}분 · 실시간 체결가 아님`,
    exchange: typeof p.exchangeName === 'string' ? p.exchangeName.slice(0, 100) : null, financialCurrency: typeof f.financialCurrency === 'string' ? f.financialCurrency.slice(0, 10) : null, evidence: {}, unavailableReasons: {} };
  const assign = (key, value, field, unit, basis, market = false) => {
    result[key] = scalar(value);
    if (result[key] !== null) result.evidence[key] = { value: result[key], provider: 'Yahoo Finance', url: sourceUrl, field, unit, basis, asOf: market ? marketTime : periodEnd, periodEnd: market ? null : periodEnd, retrievedAt };
  };
  const ratioBasis = 'Yahoo 제공 TTM 지표; 가격 기준 시각과 최근 보고 분기는 별도 표시';
  assign('price', number(p.regularMarketPrice) > 0 ? number(p.regularMarketPrice) : null, 'price.regularMarketPrice', 'USD', '정규시장 가격', true);
  assign('marketCap', number(p.marketCap) > 0 ? number(p.marketCap) : null, 'price.marketCap', 'USD', 'Yahoo 제공 시가총액', true);
  assign('reportedPE', number(summary.trailingPE) ?? number(stats.trailingPE), number(summary.trailingPE) === null ? 'defaultKeyStatistics.trailingPE' : 'summaryDetail.trailingPE', '배', ratioBasis, true);
  assign('reportedPS', number(summary.priceToSalesTrailing12Months) ?? number(stats.priceToSalesTrailing12Months), number(summary.priceToSalesTrailing12Months) === null ? 'defaultKeyStatistics.priceToSalesTrailing12Months' : 'summaryDetail.priceToSalesTrailing12Months', '배', ratioBasis, true);
  assign('forwardPE', number(stats.forwardPE) ?? number(summary.forwardPE), number(stats.forwardPE) === null ? 'summaryDetail.forwardPE' : 'defaultKeyStatistics.forwardPE', '배', 'Yahoo 제공 예상 이익 기준; 실제 실적과 구분', true);
  assign('epsTTM', financialsInUSD ? number(stats.trailingEps) : null, 'defaultKeyStatistics.trailingEps', 'USD/주', 'Yahoo 제공 최근 12개월 희석 EPS');
  assign('forwardEPS', financialsInUSD ? number(stats.forwardEps) : null, 'defaultKeyStatistics.forwardEps', 'USD/주', 'Yahoo 제공 예상 EPS; 미래 전망');
  assign('roe', number(f.returnOnEquity) === null ? null : number(f.returnOnEquity) * 100, 'financialData.returnOnEquity', '%', 'Yahoo 제공 TTM 자기자본수익률; SEC 연간 평균자본 계산과 별도');
  assign('roa', number(f.returnOnAssets) === null ? null : number(f.returnOnAssets) * 100, 'financialData.returnOnAssets', '%', 'Yahoo 제공 자산수익률');
  assign('beta', number(stats.beta) ?? number(summary.beta), number(stats.beta) === null ? 'summaryDetail.beta' : 'defaultKeyStatistics.beta', '배', 'Yahoo 제공 베타; 추정 기간은 제공자 정의');
  assign('enterpriseValue', number(stats.enterpriseValue), 'defaultKeyStatistics.enterpriseValue', 'USD', 'Yahoo 제공 기업가치', true);
  assign('priceToBook', number(stats.priceToBook), 'defaultKeyStatistics.priceToBook', '배', 'Yahoo 제공 주가순자산비율', true);
  assign('sharesOutstanding', number(stats.sharesOutstanding), 'defaultKeyStatistics.sharesOutstanding', '주', 'Yahoo 제공 발행주식 수; 거래 시각과 공시일은 다를 수 있음');
  for (const [key, field, basis] of [
    ['revenueTTM', 'totalRevenue', 'TTM 매출'], ['grossProfitTTM', 'grossProfits', 'TTM 매출총이익'], ['operatingCashFlowTTM', 'operatingCashflow', 'TTM 영업현금흐름'], ['freeCashFlowTTM', 'freeCashflow', '제공자 정의 잉여현금흐름'], ['totalCash', 'totalCash', '최근 보고 현금'], ['totalDebt', 'totalDebt', '최근 보고 부채']]) {
    assign(key, financialsInUSD ? number(f[field]) : null, `financialData.${field}`, 'USD', `Yahoo 제공 ${basis}; 연간 SEC 값과 별도`);
  }
  assign('netIncomeTTM', financialsInUSD ? number(stats.netIncomeToCommon) : null, 'defaultKeyStatistics.netIncomeToCommon', 'USD', 'Yahoo 제공 TTM 보통주 귀속 순이익');
  if (!financialsInUSD) {
    for (const key of ['epsTTM', 'forwardEPS', 'netIncomeTTM', 'revenueTTM', 'grossProfitTTM', 'operatingCashFlowTTM', 'freeCashFlowTTM', 'totalCash', 'totalDebt']) result.unavailableReasons[key] = '재무 통화가 USD로 확인되지 않아 달러 금액으로 표시하지 않아요. 달러 표시 ADR의 거래 통화와 본국 재무 통화는 다를 수 있어요.';
  }
  for (const [key, field] of [['grossMarginTTM', 'grossMargins'], ['operatingMarginTTM', 'operatingMargins'], ['netMarginTTM', 'profitMargins']]) assign(key, number(f[field]) === null ? null : number(f[field]) * 100, `financialData.${field}`, '%', 'Yahoo 제공 TTM 비율');
  if (result.reportedPE !== null && result.reportedPE <= 0 || result.epsTTM !== null && result.epsTTM <= 0) {
    result.reportedPE = null; delete result.evidence.reportedPE;
    result.unavailableReasons.reportedPE = '최근 12개월 EPS가 0 이하라 양수 PER 비교가 의미 없어 N/M으로 표시해요. 결측을 임의의 양수로 채우지 않아요.';
  }
  if (result.forwardPE !== null && result.forwardPE <= 0) { result.forwardPE = null; delete result.evidence.forwardPE; result.unavailableReasons.forwardPE = '예상 EPS가 0 이하인 제공자 추정이라 Forward PER은 N/M이에요.'; }
  const fdEvidence = { provider: 'Yahoo Finance', url: `https://finance.yahoo.com/quote/${ticker}/analysis/`, retrievedAt, basis: 'Yahoo 제공 애널리스트 집계; 개별 리포트/회사 가이던스 아님' };
  result.analystTargetPrice = number(f.targetMeanPrice);
  result.analystConsensus = { recommendation: typeof f.recommendationKey === 'string' ? f.recommendationKey.slice(0, 40) : null, mean: number(f.recommendationMean), analystCount: number(f.numberOfAnalystOpinions), targetMean: result.analystTargetPrice, targetLow: number(f.targetLowPrice), targetHigh: number(f.targetHighPrice), source: fdEvidence };
  const e = modules.calendarEvents?.earnings || {}, chart = modules.earningsGaap?.earningsChart || {};
  const earningsDate = providerDate(e.earningsDate?.[0]);
  const estimatesInUSD = financialsInUSD || modules.earningsGaap?.financialCurrency === 'USD';
  result.nextQuarterEstimates = { earningsDate, isEarningsDateEstimate: e.isEarningsDateEstimate === true, periodEnd: providerDate(chart.currentPeriodEndDate), fiscalQuarter: typeof chart.currentFiscalQuarter === 'string' ? chart.currentFiscalQuarter : null, calendarQuarter: typeof chart.currentCalendarQuarter === 'string' ? chart.currentCalendarQuarter : null,
    epsAverage: estimatesInUSD ? number(e.earningsAverage) : null, epsLow: estimatesInUSD ? number(e.earningsLow) : null, epsHigh: estimatesInUSD ? number(e.earningsHigh) : null, revenueAverage: estimatesInUSD ? number(e.revenueAverage) : null, revenueLow: estimatesInUSD ? number(e.revenueLow) : null, revenueHigh: estimatesInUSD ? number(e.revenueHigh) : null, currency: estimatesInUSD ? 'USD' : null, source: { ...fdEvidence, url: sourceUrl, basis: `Yahoo earnings calendar 애널리스트 예상; EPS GAAP/조정 기준은 제공자가 명시하지 않아 확인 필요${estimatesInUSD ? '' : '; 예상 실적 통화 미확인으로 금액 비표시'}` } };
  result.reason = result.price === null ? '공개 페이지에 가격이 없지만 확인 가능한 기본 지표를 표시해요.' : null;
  return result;
}

export function parseYahooChart(payload, ticker, retrievedAt = new Date().toISOString()) {
  const meta = payload?.chart?.result?.[0]?.meta;
  if (!validTicker(ticker) || payload?.chart?.error || meta?.symbol !== ticker || meta.currency !== 'USD' || !Number.isFinite(meta.regularMarketPrice) || meta.regularMarketPrice <= 0) throw new Error('INVALID_PUBLIC_CHART');
  const sourceUrl = `https://finance.yahoo.com/quote/${ticker}/`, marketTime = unixDate(meta.regularMarketTime);
  rejectFutureActual(marketTime, retrievedAt);
  return { ...unavailable(ticker, retrievedAt, '공개 차트 가격만 확인됐어요. 기본 지표는 별도 자료가 필요해요.'), status: 'available', price: meta.regularMarketPrice, sourceUrl, marketTime, latestTradingDay: marketTime?.slice(0, 10) || null, freshness: 'Yahoo 공개 차트 조회 시각·거래 시각 별도; 실시간 체결가 아님', evidence: { price: { value: meta.regularMarketPrice, provider: 'Yahoo Finance', url: sourceUrl, field: 'chart.meta.regularMarketPrice', unit: 'USD', basis: '정규시장 가격', asOf: marketTime, retrievedAt } } };
}

export function createPublicDataService({ fetcher = globalThis.fetch, clock = () => Date.now() } = {}) {
  const cache = new Map(), pending = new Map();
  async function request(url, max) {
    const response = await fetcher(url, { headers: { Accept: 'text/html,application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('PUBLIC_PROVIDER_UNAVAILABLE'); }
    if (Number(response.headers.get('Content-Length')) > max) { await response.body?.cancel(); throw new Error('PUBLIC_RESPONSE_TOO_LARGE'); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('PUBLIC_EMPTY_RESPONSE');
    let size = 0; const chunks = [];
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > max) { await reader.cancel(); throw new Error('PUBLIC_RESPONSE_TOO_LARGE'); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder().decode(bytes);
  }
  return async function get(ticker) {
    if (!validTicker(ticker)) throw new Error('INVALID_TICKER');
    const cached = cache.get(ticker); if (cached?.expires > clock()) return cached.value;
    if (pending.has(ticker)) return pending.get(ticker);
    const work = (async () => {
      const retrievedAt = new Date(clock()).toISOString(); let value;
      try { value = parseYahooStatisticsHtml(await request(`https://finance.yahoo.com/quote/${ticker}/key-statistics/`, MAX_HTML), ticker, retrievedAt); }
      catch {
        // A different public product (chart) can supply only its own quote. No
        // auth retry, cookies, crumbs or protected endpoint is attempted.
        try { value = parseYahooChart(JSON.parse(await request(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`, MAX_CHART)), ticker, retrievedAt); }
        catch { value = unavailable(ticker, retrievedAt, 'Yahoo 공개 자료를 현재 조회할 수 없어요. 인증·접근 제한을 우회하지 않았어요.'); }
      }
      if (cache.size >= 24) cache.delete(cache.keys().next().value);
      cache.set(ticker, { value, expires: clock() + (value.status === 'available' ? 300000 : 60000) });
      return value;
    })();
    pending.set(ticker, work); try { return await work; } finally { pending.delete(ticker); }
  };
}
export const fetchPublicMarketData = createPublicDataService();
