import { buildFinancialFlow, calculateMetrics } from '../../assetdist/finance/research-model.mjs';

const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SEC_API = 'https://data.sec.gov';
const MAX_BYTES = 10 * 1024 * 1024;
const FIELDS = ['revenue', 'costOfRevenue', 'grossProfit', 'operatingExpenses', 'operatingIncome', 'netIncome', 'operatingCashFlow', 'capex', 'freeCashFlow', 'equity', 'priorEquity', 'shares', 'dilutedEPS', 'cash', 'debt'];
// Static identity/IR directory only. It contains no prices, financials or ratings.
const DIRECTORY = [
  ['NVDA', 'NVIDIA Corporation', '1045810', 'https://investor.nvidia.com/', '엔비디아'],
  ['MSFT', 'Microsoft Corporation', '789019', 'https://www.microsoft.com/en-us/investor/', '마이크로소프트'],
  ['AAPL', 'Apple Inc.', '320193', 'https://investor.apple.com/', '애플'],
  ['GOOGL', 'Alphabet Inc.', '1652044', 'https://abc.xyz/investor/', '알파벳 구글'],
  ['GOOG', 'Alphabet Inc.', '1652044', 'https://abc.xyz/investor/', '알파벳 구글'],
  ['META', 'Meta Platforms, Inc.', '1326801', 'https://investor.atmeta.com/', '메타'],
  ['AMZN', 'Amazon.com, Inc.', '1018724', 'https://ir.aboutamazon.com/', '아마존'],
  ['TSLA', 'Tesla, Inc.', '1318605', 'https://ir.tesla.com/', '테슬라'],
  ['XOM', 'Exxon Mobil Corporation', '34088', 'https://investor.exxonmobil.com/', '엑슨모빌'],
  ['CVX', 'Chevron Corporation', '93410', 'https://www.chevron.com/investors', '셰브론'],
].map(([ticker, name, cik, irUrl, aliases]) => ({ ticker, name, cik, irUrl, aliases }));
const TAGS = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'],
  costOfRevenue: ['CostOfRevenue', 'CostOfGoodsAndServicesSold'],
  grossProfit: ['GrossProfit'], operatingExpenses: ['OperatingExpenses'], operatingIncome: ['OperatingIncomeLoss'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss'], operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'], dilutedEPS: ['EarningsPerShareDiluted'],
  shares: ['CommonStockSharesOutstanding'], equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  cash: ['CashAndCashEquivalentsAtCarryingValue'],
};
const finite = value => typeof value === 'number' && Number.isFinite(value);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
const days = (start, end) => (Date.parse(end) - Date.parse(start)) / 86400000;
const annual = item => ['10-K', '10-K/A', '20-F', '20-F/A'].includes(item.form) && validDate(item.start) && validDate(item.end) && days(item.start, item.end) >= 330 && days(item.start, item.end) <= 400;
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });

function filingUrl(cik, accession, document) {
  if (!/^\d{1,10}$/.test(String(cik)) || !/^\d{10}-\d{2}-\d{6}$/.test(accession || '')) return null;
  const path = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-', '')}/`;
  return /^[A-Za-z0-9._-]+$/.test(document || '') ? path + document : path + accession + '-index.htm';
}

function observations(facts, tags, unit = 'USD', taxonomy = 'us-gaap') {
  return tags.flatMap((tag, priority) => (facts?.facts?.[taxonomy]?.[tag]?.units?.[unit] || []).filter(row => finite(row.val) && validDate(row.end) && validDate(row.filed)).map(row => ({ ...row, tag, unit, priority })));
}
function latest(rows) { return rows.sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed) || a.priority - b.priority)[0] || null; }
function evidence(row, cik) {
  return row ? { value: row.val, unit: row.unit, tag: row.tag, start: row.start || null, end: row.end, filed: row.filed, form: row.form, url: filingUrl(cik, row.accn), accession: row.accn || null } : null;
}

/** Annual-only normalization: never mixes a quarter, YTD or another FY into a ratio. */
export function normalizeCompanyFacts(facts, cik) {
  const financials = Object.fromEntries(FIELDS.map(key => [key, null])), sources = {}, warnings = [];
  const revenue = latest(observations(facts, TAGS.revenue).filter(annual));
  if (!revenue) return { financials, evidence: sources, period: null, warnings: ['표준 USD 연간 매출 공시를 찾지 못했어요. IFRS·비달러·기업 고유 태그는 원문에서 확인해 주세요.'] };
  const period = { start: revenue.start, end: revenue.end, filed: revenue.filed, form: revenue.form, sourceUrl: filingUrl(cik, revenue.accn) };
  const samePeriod = row => annual(row) && row.start === revenue.start && row.end === revenue.end;
  for (const key of ['revenue', 'costOfRevenue', 'grossProfit', 'operatingExpenses', 'operatingIncome', 'netIncome', 'operatingCashFlow', 'capex', 'dilutedEPS']) {
    const row = latest(observations(facts, TAGS[key], key === 'dilutedEPS' ? 'USD/shares' : 'USD').filter(samePeriod));
    if (row) { financials[key] = row.val; sources[key] = evidence(row, cik); }
  }
  const atEnd = row => !row.start && row.end === revenue.end && ['10-K', '10-K/A', '20-F', '20-F/A'].includes(row.form);
  for (const key of ['equity', 'cash', 'shares']) {
    const row = latest(observations(facts, TAGS[key], key === 'shares' ? 'shares' : 'USD').filter(atEnd));
    if (row) { financials[key] = row.val; sources[key] = evidence(row, cik); }
  }
  if (financials.shares === null) {
    const row = latest(observations(facts, ['WeightedAverageNumberOfDilutedSharesOutstanding'], 'shares').filter(samePeriod));
    if (row) { financials.shares = row.val; sources.shares = evidence(row, cik); warnings.push('주식 수는 기말 발행주식 대신 연간 희석 가중평균이에요. DCF에는 현재 주식분할 기준의 주식 수를 직접 확인해 주세요.'); }
  }
  const equity = latest(observations(facts, TAGS.equity).filter(row => !row.start && row.end < revenue.end && days(row.end, revenue.end) >= 330 && days(row.end, revenue.end) <= 400 && ['10-K', '10-K/A', '20-F', '20-F/A'].includes(row.form)));
  if (equity) { financials.priorEquity = equity.val; sources.priorEquity = evidence(equity, cik); }
  const derive = (key, value, inputs, formula) => { financials[key] = value; sources[key] = { value, unit: 'USD', derived: true, inputs, formula, start: period.start, end: period.end, url: period.sourceUrl }; };
  if (financials.grossProfit === null && finite(financials.revenue) && finite(financials.costOfRevenue)) derive('grossProfit', financials.revenue - financials.costOfRevenue, ['revenue', 'costOfRevenue'], '매출 − 매출원가');
  if (financials.operatingExpenses === null && finite(financials.grossProfit) && finite(financials.operatingIncome)) derive('operatingExpenses', financials.grossProfit - financials.operatingIncome, ['grossProfit', 'operatingIncome'], '매출총이익 − 영업이익 (조정 포함 잔여 영업비용)');
  if (finite(financials.operatingCashFlow) && finite(financials.capex) && financials.capex >= 0) derive('freeCashFlow', financials.operatingCashFlow - financials.capex, ['operatingCashFlow', 'capex'], '영업현금흐름 − 설비·생산자산 취득액');
  if (sources.capex?.tag === 'PaymentsToAcquireProductiveAssets') warnings.push('이 기업의 투자 지출은 표준 PaymentsToAcquireProductiveAssets 태그로, 설비 외 소프트웨어·무형자산 취득도 포함해요. 현금흐름 대용치 해석 시 범위를 확인해 주세요.');
  // Debt is deliberately not inferred from one ambiguous long-term debt tag.
  warnings.push('ARR·부문별 매출·애널리스트 의견은 표준 전체기업 XBRL 데이터에 포함되지 않아요. 별도 공시·제공자를 확인해 주세요.');
  warnings.push('연간 공시 기준으로 분석하며 분기 실적이나 TTM으로 표시하지 않아요. 기말 주식 수와 EPS는 현재 주식분할 기준을 확인해야 해요.');
  return { financials, evidence: sources, period, warnings };
}

export function reportsFromSubmissions(submissions, cik) {
  const f = submissions?.filings?.recent || {}, out = [];
  for (let i = 0; i < Math.min(f.form?.length || 0, 1000); i++) {
    const form = f.form[i];
    if (!['10-K', '10-K/A', '10-Q', '10-Q/A', '20-F', '8-K', '6-K'].includes(form) || !validDate(f.filingDate?.[i])) continue;
    const url = filingUrl(cik, f.accessionNumber?.[i], f.primaryDocument?.[i]);
    if (!url) continue;
    const earnings = form === '8-K' && String(f.items?.[i] || '').split(',').map(value => value.trim()).includes('2.02');
    out.push({ title: earnings ? '실적 공시 (8-K · Item 2.02)' : `${form} ${form.startsWith('10-K') || form === '20-F' ? '연간 보고서' : form.startsWith('10-Q') ? '분기 보고서' : '수시 공시'}`, type: form, date: f.filingDate[i], periodEnd: validDate(f.reportDate?.[i]) ? f.reportDate[i] : null, earnings, url, provider: 'SEC EDGAR' });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 16);
}

function swotChecklist(f) {
  const strengths = [], weaknesses = [], opportunities = ['신제품·신규 시장의 성장 가능성은 사업보고서와 실적발표에서 확인해 주세요.'], threats = ['경쟁·규제·고객 집중·주식보상 위험은 원문의 Risk Factors를 확인해 주세요.'];
  if (finite(f.operatingIncome)) (f.operatingIncome > 0 ? strengths : weaknesses).push(f.operatingIncome > 0 ? '해당 연간 기간에 영업이익이 발생했어요. 지속성은 추가 확인이 필요해요.' : '해당 연간 기간의 영업손익이 0 이하예요. 손실 원인과 자금 여력을 확인해 주세요.');
  if (finite(f.freeCashFlow)) (f.freeCashFlow > 0 ? strengths : weaknesses).push(f.freeCashFlow > 0 ? '영업현금흐름에서 유형자산 투자 후 양의 현금이 남았어요.' : '유형자산 투자 후 현금흐름 대용치가 0 이하예요. 성장 투자와 자금 부족을 구별해 주세요.');
  return { strengths, weaknesses, opportunities, threats, basis: '공시 숫자에서 만든 점검 항목과 후속 조사 질문이에요. 회사의 경쟁력·미래 전망을 확정한 SWOT 보고서나 투자의견이 아니에요.' };
}

export function createResearchService({ fetcher = globalThis.fetch, clock = () => Date.now() } = {}) {
  const cache = new Map(), pending = new Map();
  const fetchedAt = new Map();
  let cacheBytes = 0;
  function remember(key, value, ttl, bytes) {
    if (cache.has(key)) { cacheBytes -= cache.get(key).bytes; cache.delete(key); }
    // Parsed XBRL is many times larger than JSON. Bound raw-equivalent cached
    // bytes as well as entries so an isolate cannot accumulate every issuer.
    if (bytes > 4 * 1024 * 1024) return;
    while (cache.size && (cache.size >= 12 || cacheBytes + bytes > 4 * 1024 * 1024)) { const oldest = cache.keys().next().value; cacheBytes -= cache.get(oldest).bytes; cache.delete(oldest); }
    cache.set(key, { value, expires: clock() + ttl, bytes }); cacheBytes += bytes;
  }
  let lastRequestAt = 0;
  async function marketSnapshot(ticker, env) {
    const unavailable = { status: 'unavailable', price: null, marketCap: null, reportedPE: null, reportedPS: null, provider: 'Alpha Vantage', reason: '시세 제공자 API 키가 연결되지 않았어요. PER·PSR은 확인되지 않은 숫자로 채우지 않아요.' };
    const key = String(env.ALPHAVANTAGE_API_KEY || '').trim();
    if (!key || key.length > 200 || /[\r\n]/.test(key)) return unavailable;
    const cacheKey = 'market:' + ticker, cached = cache.get(cacheKey);
    if (cached && cached.expires > clock()) return cached.value;
    const requestData = async functionName => {
      const target = new URL('https://www.alphavantage.co/query');
      target.search = new URLSearchParams({ function: functionName, symbol: ticker, apikey: key }).toString();
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetcher(target.toString(), { headers: { Accept: 'application/json' }, redirect: 'error', signal: controller.signal });
        if (!response.ok) { await response.body?.cancel(); throw new Error('MARKET_PROVIDER_UNAVAILABLE'); }
        if (Number(response.headers.get('Content-Length')) > 524288) { await response.body?.cancel(); throw new Error('MARKET_RESPONSE_TOO_LARGE'); }
        const reader = response.body?.getReader(); if (!reader) throw new Error('MARKET_EMPTY_RESPONSE');
        const chunks = []; let size = 0;
        while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 524288) { await reader.cancel(); throw new Error('MARKET_RESPONSE_TOO_LARGE'); } chunks.push(value); }
        const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        const data = JSON.parse(new TextDecoder().decode(bytes));
        if (!data || typeof data !== 'object' || Array.isArray(data) || data.Information || data.Note || data['Error Message']) throw new Error('MARKET_QUOTA_OR_ACCESS_LIMIT');
        return data;
      } finally { clearTimeout(timer); }
    };
    let snapshot;
    try {
      const data = await Promise.allSettled([requestData('GLOBAL_QUOTE'), requestData('OVERVIEW')]);
      const quote = data[0].status === 'fulfilled' ? data[0].value['Global Quote'] : null;
      const overview = data[1].status === 'fulfilled' && data[1].value.Symbol === ticker && data[1].value.Currency === 'USD' ? data[1].value : null;
      const number = value => typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : null;
      const price = quote?.['01. symbol'] === ticker && validDate(quote?.['07. latest trading day']) ? number(quote['05. price']) : null;
      snapshot = { status: price > 0 || overview ? 'available' : 'unavailable', provider: 'Alpha Vantage', price: price > 0 ? price : null, marketCap: number(overview?.MarketCapitalization), reportedPE: number(overview?.PERatio), reportedPS: number(overview?.PriceToSalesRatioTTM),
        latestTradingDay: price > 0 ? quote['07. latest trading day'] : null, latestQuarter: validDate(overview?.LatestQuarter) ? overview.LatestQuarter : null, retrievedAt: new Date(clock()).toISOString(), freshness: '종가·제공자 공시 갱신 기준 (실시간 아님)', sourceUrl: 'https://www.alphavantage.co/documentation/', reason: price > 0 || overview ? null : '시세 제공자가 요청을 제한했거나 값이 확인되지 않았어요.',
        analystTargetPrice: number(overview?.AnalystTargetPrice), analystRatings: Object.fromEntries(['StrongBuy', 'Buy', 'Hold', 'Sell', 'StrongSell'].map(rating => [rating, number(overview?.['AnalystRating' + rating])])) };
    } catch { snapshot = { ...unavailable, reason: '시세 제공자의 응답을 확인하지 못했어요. 잠시 후 다시 조회해 주세요.' }; }
    remember(cacheKey, snapshot, snapshot.status === 'available' ? 6 * 3600000 : 300000, 2048);
    return snapshot;
  }
  async function fetchJson(url, env, ttl) {
    const ua = String(env.SEC_USER_AGENT || '').trim();
    if (!/^[^\r\n]{8,200}$/.test(ua) || !ua.includes('@')) throw new Error('SEC_USER_AGENT_NOT_CONFIGURED');
    // Every destination is assembled internally; redirects cannot become SSRF.
    if (![TICKERS_URL].includes(url) && !/^https:\/\/data\.sec\.gov\/(?:api\/xbrl\/companyfacts|submissions)\/CIK\d{10}\.json$/.test(url)) throw new Error('PROVIDER_URL_REJECTED');
    const cached = cache.get(url);
    if (cached && cached.expires > clock()) return cached.value;
    if (pending.has(url)) return pending.get(url);
    const work = (async () => {
      // Conservative per-isolate pacing plus bounded cache; no retry storm on 403/429.
      const wait = Math.max(0, lastRequestAt + 150 - Date.now());
      lastRequestAt = Date.now() + wait;
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetcher(url, { headers: { 'User-Agent': ua, Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' }, redirect: 'error', signal: controller.signal, cf: { cacheTtl: Math.floor(ttl / 1000), cacheEverything: true } });
        if (!response.ok) { await response.body?.cancel(); throw new Error(response.status === 403 || response.status === 429 ? 'SEC_RATE_OR_ACCESS_LIMIT' : 'SEC_PROVIDER_UNAVAILABLE'); }
        if (Number(response.headers.get('Content-Length')) > MAX_BYTES) { await response.body?.cancel(); throw new Error('SEC_RESPONSE_TOO_LARGE'); }
        const reader = response.body?.getReader();
        if (!reader) throw new Error('SEC_EMPTY_RESPONSE');
        const chunks = []; let size = 0;
        while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_BYTES) { await reader.cancel(); throw new Error('SEC_RESPONSE_TOO_LARGE'); } chunks.push(value); }
        const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        const value = JSON.parse(new TextDecoder().decode(bytes));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SEC_INVALID_RESPONSE');
        if (fetchedAt.size >= 30) fetchedAt.delete(fetchedAt.keys().next().value);
        fetchedAt.set(url, new Date(clock()).toISOString());
        remember(url, value, ttl, size);
        return value;
      } finally { clearTimeout(timer); }
    })();
    pending.set(url, work);
    try { return await work; } finally { pending.delete(url); }
  }
  async function catalog(env) {
    try {
      const body = await fetchJson(TICKERS_URL, env, 24 * 3600000);
      const companies = Object.values(body).filter(row => typeof row?.ticker === 'string' && /^[A-Z0-9.-]{1,12}$/.test(row.ticker) && typeof row.title === 'string' && row.title.length <= 300 && Number.isInteger(row.cik_str) && row.cik_str > 0 && row.cik_str < 1e10).map(row => {
        const known = DIRECTORY.find(item => item.ticker === row.ticker);
        return { ticker: row.ticker, name: row.title, cik: String(row.cik_str), irUrl: known?.irUrl || null, aliases: known?.aliases || '' };
      });
      if (!companies.length) throw new Error('SEC_INVALID_CATALOG');
      return { companies, source: { provider: 'SEC EDGAR', url: TICKERS_URL, status: 'available' } };
    } catch {
      return { companies: DIRECTORY, source: { provider: 'BANDAL 공식 IR 주소록', url: 'https://www.sec.gov/edgar/search/', status: 'directory-only' } };
    }
  }
  return async function handle(request, env = {}, path) {
    if (!path?.startsWith('companies/')) return null;
    if (request.method !== 'GET') return json({ error: '기업 자료는 GET으로 조회해 주세요.' }, 405);
    const url = new URL(request.url), query = (url.searchParams.get('q') || '').trim();
    if (path === 'companies/search') {
      if (!query || query.length > 100) return json({ error: '기업명 또는 종목코드를 100자 이내로 입력해 주세요.' }, 422);
      const { companies, source } = await catalog(env), needle = query.toLocaleLowerCase();
      const results = companies.filter(company => `${company.ticker} ${company.name} ${company.aliases}`.toLocaleLowerCase().includes(needle)).sort((a, b) => (b.ticker.toLowerCase() === needle ? 1 : 0) - (a.ticker.toLowerCase() === needle ? 1 : 0) || a.ticker.localeCompare(b.ticker)).slice(0, 20).map(({ aliases, ...company }) => company);
      return json({ results, source: { ...source, retrievedAt: new Date(clock()).toISOString() }, limitations: source.status === 'directory-only' ? ['SEC 목록을 불러오지 못해 주요 미국 기업 주소록만 검색했어요. 최신 재무 수치는 포함하지 않아요.'] : ['현재 SEC에 등록된 미국 상장·공시 기업을 지원해요. 한국 주식 공시는 별도 제공자가 필요해요.'] });
    }
    const ticker = path.slice('companies/'.length).toUpperCase();
    if (!/^[A-Z0-9.-]{1,12}$/.test(ticker)) return json({ error: '유효한 SEC 종목코드를 입력해 주세요.' }, 422);
    const { companies, source: catalogSource } = await catalog(env), entry = companies.find(company => company.ticker === ticker);
    if (!entry) return json({ error: catalogSource.status === 'available' ? 'SEC 목록에서 기업을 찾지 못했어요.' : '현재 주소록에서 기업을 찾지 못했어요. SEC 연결 후 전체 기업을 검색할 수 있어요.', code: catalogSource.status === 'available' ? 'COMPANY_NOT_FOUND' : 'CATALOG_UNAVAILABLE' }, catalogSource.status === 'available' ? 404 : 503);
    const { aliases, ...company } = entry, cik = company.cik.padStart(10, '0'), factsUrl = `${SEC_API}/api/xbrl/companyfacts/CIK${cik}.json`, submissionsUrl = `${SEC_API}/submissions/CIK${cik}.json`;
    const [outcomes, quote] = await Promise.all([Promise.allSettled([fetchJson(factsUrl, env, 3600000), fetchJson(submissionsUrl, env, 3600000)]), marketSnapshot(ticker, env)]);
    const asOf = new Date(clock()).toISOString();
    let normalized = { financials: Object.fromEntries(FIELDS.map(key => [key, null])), evidence: {}, period: null, warnings: [] };
    const limitations = [];
    if (outcomes[0].status === 'fulfilled' && String(outcomes[0].value.cik).replace(/^0+/, '') === String(Number(cik))) normalized = normalizeCompanyFacts(outcomes[0].value, company.cik);
    else limitations.push('SEC 재무 원문을 불러오지 못했어요. 값을 추정하지 않았으며 공식 공시·IR 링크에서 확인할 수 있어요.');
    let reports = [];
    if (outcomes[1].status === 'fulfilled' && String(outcomes[1].value.cik).replace(/^0+/, '') === String(Number(cik))) reports = reportsFromSubmissions(outcomes[1].value, company.cik);
    else limitations.push('최신 보고서·실적 공시 목록을 가져오지 못했어요. 아래 공식 IR과 EDGAR에서 확인해 주세요.');
    if (company.irUrl) reports.push({ title: '공식 IR · 실적발표·자료', type: 'IR', date: null, url: company.irUrl, provider: '기업 공식 IR' });
    reports.push({ title: 'SEC EDGAR 전체 공시', type: 'IR', date: null, url: `https://www.sec.gov/edgar/browse/?CIK=${company.cik}&owner=exclude`, provider: 'SEC EDGAR' });
    const f = normalized.financials;
    const ratings = Object.entries(quote.analystRatings || {}).filter(([, count]) => Number.isInteger(count) && count >= 0).map(([rating, count]) => ({ rating, count }));
    return json({ company: { ...company, currency: 'USD' }, status: normalized.period ? 'available' : 'unavailable', asOf, period: normalized.period, financials: f, evidence: normalized.evidence, metrics: calculateMetrics(f, quote), flow: buildFinancialFlow(f, normalized.period), reports, swot: swotChecklist(f), quote,
      opinions: { status: ratings.length ? 'available' : 'unavailable', ratings, analystTargetPrice: quote.analystTargetPrice || null, provider: 'Alpha Vantage', retrievedAt: quote.retrievedAt || null, reason: ratings.length ? '제공자의 집계 의견이에요. 개별 보고서 원문·작성일·분석가 목록은 제공하지 않아요.' : '확인 가능한 애널리스트 리서치 제공자가 연결되지 않았어요. 공식 실적 원문을 먼저 확인해 주세요.' },
      sources: [{ provider: 'SEC companyfacts', url: factsUrl, retrievedAt: fetchedAt.get(factsUrl) || null, status: normalized.period ? 'available' : 'unavailable' }, { provider: 'SEC submissions', url: submissionsUrl, retrievedAt: fetchedAt.get(submissionsUrl) || null, status: outcomes[1].status === 'fulfilled' && reports.some(report => report.provider === 'SEC EDGAR' && report.date) ? 'available' : 'unavailable' }, ...(quote.status === 'available' ? [{ provider: 'Alpha Vantage', url: quote.sourceUrl, retrievedAt: quote.retrievedAt, status: 'available' }] : [])], limitations: [...limitations, ...normalized.warnings, ...(quote.status === 'unavailable' ? [quote.reason] : ['PER·PSR은 제공자의 TTM 지표이고, 나머지 SEC 수치는 연간 공시 기준이에요. 시점과 분모가 달라요.'])] });
  };
}

const service = createResearchService();
export const handleResearchRequest = (request, env, path) => service(request, env, path);
