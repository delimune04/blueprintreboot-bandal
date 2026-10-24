import { buildFinancialFlow, calculateMetrics } from '../../assetdist/finance/research-model.mjs';
import { createProfileSummaryService } from './profile-summary.mjs';
import { buildFinancialInsights } from './insights.mjs';
import { normalizeQuarterlyHistory, attachHistoricalValuations } from './history.mjs';
import { industryBenchmarks } from './peers.mjs';
import { createPriceService } from './prices.mjs';
import { createDebtService } from './debt.mjs';
import { createAnalystService, loadAnalystResearch } from './analysts.mjs';
import { createProfileService, fetchPublicCompanyLogo } from './public-data.mjs';
import { readPublicCache, writePublicCache } from './public-cache.mjs';
import { createPublicDataService } from './public-data.mjs';
import { loadCompanyOutlook } from './outlook.mjs';

const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SEC_API = 'https://data.sec.gov';
const MAX_BYTES = 10 * 1024 * 1024;
const FIELDS = ['revenue', 'costOfRevenue', 'grossProfit', 'operatingExpenses', 'operatingIncome', 'netIncome', 'operatingCashFlow', 'capex', 'freeCashFlow', 'equity', 'priorEquity', 'shares', 'dilutedEPS', 'cash', 'debt', 'assets', 'liabilities', 'researchDevelopment', 'sellingGeneralAdministrative', 'interestExpense', 'incomeTax'];
// Static identity/IR directory only. It contains no prices, financials or ratings.
const DIRECTORY = [
  ['NVDA', 'NVIDIA Corporation', '1045810', 'https://investor.nvidia.com/', '엔비디아'],
  ['MSFT', 'Microsoft Corporation', '789019', 'https://www.microsoft.com/en-us/investor/', '마이크로소프트'],
  ['AAPL', 'Apple Inc.', '320193', 'https://investor.apple.com/', '애플'],
  ['IREN', 'IREN Limited', '1878848', 'https://iren.gcs-web.com/', '아이렌 아이리스 에너지 iris energy'],
  ['GOOGL', 'Alphabet Inc.', '1652044', 'https://abc.xyz/investor/', '알파벳 구글'],
  ['GOOG', 'Alphabet Inc.', '1652044', 'https://abc.xyz/investor/', '알파벳 구글'],
  ['META', 'Meta Platforms, Inc.', '1326801', 'https://investor.atmeta.com/', '메타'],
  ['AMZN', 'Amazon.com, Inc.', '1018724', 'https://ir.aboutamazon.com/', '아마존'],
  ['TSLA', 'Tesla, Inc.', '1318605', 'https://ir.tesla.com/', '테슬라'],
  ['XOM', 'ExxonMobil Holdings Corp', '2115436', 'https://investor.exxonmobil.com/', '엑슨모빌 exxon mobil'],
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
  assets: ['Assets'], liabilities: ['Liabilities'], researchDevelopment: ['ResearchAndDevelopmentExpense'],
  sellingGeneralAdministrative: ['SellingGeneralAndAdministrativeExpense'], interestExpense: ['InterestExpenseDebt', 'InterestAndDebtExpense', 'InterestExpense'], incomeTax: ['IncomeTaxExpenseBenefit'],
};
const IFRS_TAGS = {
  revenue: ['Revenue'], costOfRevenue: ['CostOfSales'], grossProfit: ['GrossProfit'], operatingExpenses: ['OperatingExpense'],
  operatingIncome: ['ProfitLossFromOperatingActivities'], netIncome: ['ProfitLoss'], operatingCashFlow: ['CashFlowsFromUsedInOperatingActivities'],
  capex: ['PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'], dilutedEPS: ['DilutedEarningsLossPerShare'],
  shares: ['NumberOfSharesOutstanding'], equity: ['EquityAttributableToOwnersOfParent', 'Equity'], cash: ['CashAndCashEquivalents'],
  assets: ['Assets'], liabilities: ['Liabilities'], researchDevelopment: ['ResearchAndDevelopmentExpense'],
  sellingGeneralAdministrative: ['SellingGeneralAndAdministrativeExpense'], interestExpense: ['FinanceCosts'], incomeTax: ['IncomeTaxExpenseContinuingOperations'],
};
const ALIASES = { APPL: { ticker: 'AAPL', message: 'APPL은 Apple의 종목코드 AAPL로 보정했어요.' } };
const SECTORS = { NVDA: ['반도체', 'AI 반도체'], MSFT: ['소프트웨어', '클라우드·기업 소프트웨어'], AAPL: ['소비자 기술', '기기·서비스'], IREN: ['AI 인프라', 'AI 클라우드·비트코인 채굴'], GOOGL: ['인터넷', '검색·광고·클라우드'], GOOG: ['인터넷', '검색·광고·클라우드'], META: ['인터넷', '소셜 플랫폼·광고'], AMZN: ['커머스·클라우드', '유통·클라우드'], TSLA: ['자동차·에너지', '전기차·에너지 저장'], XOM: ['에너지', '석유·가스'], CVX: ['에너지', '석유·가스'] };
export function resolveTicker(value) { const searchedAs = String(value || '').trim().toUpperCase(); return { searchedAs, resolvedTicker: ALIASES[searchedAs]?.ticker || searchedAs, correction: ALIASES[searchedAs]?.message || null }; }
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
  return tags.flatMap((tag, priority) => (facts?.facts?.[taxonomy]?.[tag]?.units?.[unit] || []).filter(row => finite(row.val) && validDate(row.end) && validDate(row.filed)).map(row => ({ ...row, tag, unit, priority, taxonomy })));
}
function fieldObservations(facts, field, unit = 'USD') { return [...observations(facts, TAGS[field] || [], unit), ...observations(facts, IFRS_TAGS[field] || [], unit, 'ifrs-full').map(row => ({ ...row, priority: row.priority + 100 }))]; }
function latest(rows) { return rows.sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed) || a.priority - b.priority)[0] || null; }
function evidence(row, cik) {
  return row ? { value: row.val, unit: row.unit, tag: row.tag, taxonomy: row.taxonomy, provider: 'SEC EDGAR', basis: row.start ? '동일기간 연간 공시' : '기말 재무상태', start: row.start || null, end: row.end, asOf: row.end, filed: row.filed, form: row.form, url: filingUrl(cik, row.accn), accession: row.accn || null } : null;
}

/** Annual-only normalization: never mixes a quarter, YTD or another FY into a ratio. */
export function normalizeCompanyFacts(facts, cik) {
  const financials = Object.fromEntries(FIELDS.map(key => [key, null])), sources = {}, warnings = [];
  const revenue = latest(fieldObservations(facts, 'revenue').filter(annual));
  if (!revenue) return { financials, evidence: sources, period: null, history: [], warnings: ['표준 USD 연간 매출 공시를 찾지 못했어요. 비달러·기업 고유 태그는 원문에서 확인해 주세요.'] };
  const period = { start: revenue.start, end: revenue.end, filed: revenue.filed, form: revenue.form, sourceUrl: filingUrl(cik, revenue.accn) };
  const samePeriod = row => annual(row) && row.start === revenue.start && row.end === revenue.end;
  for (const key of ['revenue', 'costOfRevenue', 'grossProfit', 'operatingExpenses', 'operatingIncome', 'netIncome', 'operatingCashFlow', 'capex', 'dilutedEPS', 'researchDevelopment', 'sellingGeneralAdministrative', 'interestExpense', 'incomeTax']) {
    const row = latest(fieldObservations(facts, key, key === 'dilutedEPS' ? 'USD/shares' : 'USD').filter(samePeriod));
    if (row) { financials[key] = row.val; sources[key] = evidence(row, cik); }
  }
  const atEnd = row => !row.start && row.end === revenue.end && ['10-K', '10-K/A', '20-F', '20-F/A'].includes(row.form);
  for (const key of ['equity', 'cash', 'shares', 'assets', 'liabilities']) {
    const row = latest(fieldObservations(facts, key, key === 'shares' ? 'shares' : 'USD').filter(atEnd));
    if (row) { financials[key] = row.val; sources[key] = evidence(row, cik); }
  }
  if (financials.shares === null) {
    const row = latest([...observations(facts, ['WeightedAverageNumberOfDilutedSharesOutstanding'], 'shares'), ...observations(facts, ['WeightedAverageNumberOfOrdinarySharesOutstandingAdjustedForDilution'], 'shares', 'ifrs-full')].filter(samePeriod));
    if (row) { financials.shares = row.val; sources.shares = evidence(row, cik); warnings.push('주식 수는 기말 발행주식 대신 연간 희석 가중평균이에요. DCF에는 현재 주식분할 기준의 주식 수를 직접 확인해 주세요.'); }
  }
  const equity = latest(fieldObservations(facts, 'equity').filter(row => !row.start && row.end < revenue.end && days(row.end, revenue.end) >= 330 && days(row.end, revenue.end) <= 400 && ['10-K', '10-K/A', '20-F', '20-F/A'].includes(row.form)));
  if (equity) { financials.priorEquity = equity.val; sources.priorEquity = evidence(equity, cik); }
  const derive = (key, value, inputs, formula) => { financials[key] = value; sources[key] = { value, unit: 'USD', provider: 'SEC EDGAR 공시에서 계산', basis: '동일기간 연간 공시', derived: true, inputs, formula, start: period.start, end: period.end, asOf: period.end, filed: period.filed, url: period.sourceUrl }; };
  if (financials.grossProfit === null && finite(financials.revenue) && finite(financials.costOfRevenue)) derive('grossProfit', financials.revenue - financials.costOfRevenue, ['revenue', 'costOfRevenue'], '매출 − 매출원가');
  if (financials.operatingExpenses === null && finite(financials.grossProfit) && finite(financials.operatingIncome)) derive('operatingExpenses', financials.grossProfit - financials.operatingIncome, ['grossProfit', 'operatingIncome'], '매출총이익 − 영업이익 (조정 포함 잔여 영업비용)');
  if (finite(financials.operatingCashFlow) && finite(financials.capex) && financials.capex >= 0) derive('freeCashFlow', financials.operatingCashFlow - financials.capex, ['operatingCashFlow', 'capex'], '영업현금흐름 − 설비·생산자산 취득액');
  if (sources.capex?.tag === 'PaymentsToAcquireProductiveAssets') warnings.push('이 기업의 투자 지출은 표준 PaymentsToAcquireProductiveAssets 태그로, 설비 외 소프트웨어·무형자산 취득도 포함해요. 현금흐름 대용치 해석 시 범위를 확인해 주세요.');
  // Only a complete explicit borrowing total is used; incomplete long-term tags
  // are never silently relabeled as total company debt.
  const totalDebt = latest(observations(facts, ['LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities']).filter(atEnd));
  if (totalDebt) { financials.debt = totalDebt.val; sources.debt = evidence(totalDebt, cik); }
  warnings.push('ARR·부문별 매출·애널리스트 의견은 표준 전체기업 XBRL 데이터에 포함되지 않아요. 별도 공시·제공자를 확인해 주세요.');
  warnings.push('연간 공시 기준으로 분석하며 분기 실적이나 TTM으로 표시하지 않아요. 기말 주식 수와 EPS는 현재 주식분할 기준을 확인해야 해요.');
  if (String(Number(cik)) === '1878848') {
    warnings.push('IREN 매출원가는 감가상각·상각을 제외해요. 매출−해당 원가는 표준 매출총이익과 직접 비교할 수 없는 직접원가 차감잔액입니다. 영업손실에는 감가상각·비현금 손상차손 등이 포함돼요.');
    if (sources.grossProfit?.derived) { sources.grossProfit.formula = '매출 − 감가상각·상각 제외 직접원가'; sources.grossProfit.scope = '직접원가 차감잔액 (표준 매출총이익 아님)'; }
  }
  const annualRows = fieldObservations(facts, 'revenue').filter(annual), seen = new Set(), history = [];
  for (const r of annualRows.sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed) || a.priority - b.priority)) {
    const key = r.start + ':' + r.end; if (seen.has(key)) continue; seen.add(key);
    const annualItem = { start: r.start, end: r.end, revenue: r.val, source: evidence(r, cik) };
    for (const field of ['operatingIncome', 'netIncome', 'operatingCashFlow']) { const selected = latest(fieldObservations(facts, field).filter(item => annual(item) && item.start === r.start && item.end === r.end)); annualItem[field] = selected?.val ?? null; }
    history.push(annualItem); if (history.length >= 5) break;
  }
  return { financials, evidence: sources, period, history: history.reverse(), warnings };
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

/** One source/basis per displayed number: market TTM never overwrites annual SEC facts. */
export function metricsWithSources(financials, evidence, quote = {}) {
  const sourceFor = (fields, formula) => {
    const records = fields.map(field => evidence?.[field]).filter(Boolean);
    return records.length === fields.length ? { provider: 'SEC EDGAR 공시에서 계산', url: records[0].url, asOf: records[0].end, filed: records[0].filed, basis: '연간 공시', formula, inputs: records } : null;
  };
  const direct = { eps: 'dilutedEPS', fcf: 'freeCashFlow' };
  const formulas = { roe: ['netIncome', 'equity', 'priorEquity'], grossMargin: ['grossProfit', 'revenue'], operatingMargin: ['operatingIncome', 'revenue'], netMargin: ['netIncome', 'revenue'] };
  const results = calculateMetrics(financials, quote).map(metric => {
    const marketField = metric.key === 'per' ? 'reportedPE' : metric.key === 'psr' ? 'reportedPS' : null;
    const source = marketField ? quote.evidence?.[marketField] || (metric.key === 'per' && quote.epsTTM <= 0 ? quote.evidence?.epsTTM : null) || (finite(metric.value) && quote.sourceUrl ? { provider: quote.provider, url: quote.sourceUrl, asOf: quote.latestTradingDay || quote.latestQuarter, retrievedAt: quote.retrievedAt, basis: 'TTM (제공자 보고)' } : null) : direct[metric.key] ? evidence?.[direct[metric.key]] || null : formulas[metric.key] ? sourceFor(formulas[metric.key], metric.formula) : null;
    const notMeaningful = metric.key === 'per' && metric.value === null && (quote.epsTTM <= 0 && finite(quote.epsTTM));
    const reason = notMeaningful ? 'TTM 주당순이익이 0 이하라 PER은 N/M(의미 없음)입니다. 적자를 양수 PER로 바꾸지 않았어요.' : metric.value === null ? quote.unavailableReasons?.[marketField] || (metric.key === 'arr' ? '기업이 정의한 ARR 공시가 필요하며 매출을 ARR로 대체하지 않아요.' : '해당 기간·정의와 일치하는 수치를 확인하지 못했어요.') : null;
    const formula = notMeaningful ? 'TTM EPS ≤ 0: 의미 있는 양수 PER을 산출하지 않음' : marketField && finite(metric.value) && source ? `${quote.provider || '시세 제공자'} 보고 ${metric.label} (TTM 기준, 연간 SEC 값과 별도)` : metric.formula;
    return { ...metric, formula, ...(marketField && finite(metric.value) && source ? { status: 'reported' } : {}), source, basis: source?.basis || (marketField ? 'TTM' : '연간 공시'), ...(notMeaningful ? { status: 'not-meaningful', displayValue: 'N/M' } : {}), reason };
  });
  const extras = [
    ['price', '주가', 'price', 'USD', '제공자가 보고한 시장 가격', '거래 기준시각을 함께 확인하세요. 실시간 실행 가격을 보장하지 않아요.'],
    ['marketCap', '시가총액', 'marketCap', 'USD', '제공자 시가총액', '주가와 발행주식 수에 따른 시장 가치예요.'],
    ['enterpriseValue', '기업가치 (EV)', 'enterpriseValue', 'USD', '제공자가 보고한 EV', '시가총액에 순차입금 등 제공자 조정을 반영한 값이에요.'],
    ['forwardPE', '예상 PER', 'forwardPE', '배', '주가 ÷ 컨센서스 예상 EPS', '실적 확정값이 아닌 애널리스트 추정치 기반이에요.'],
    ['epsTTM', 'EPS (TTM)', 'epsTTM', 'USD/주', '제공자 최근 12개월 EPS', '연간 SEC EPS와 기간·희석 기준이 다를 수 있어요.'],
    ['roeTTM', 'ROE (TTM)', 'roe', '%', '제공자 최근 12개월 자기자본이익률', '연간 공시 ROE와 구분해 비교하세요.'],
    ['revenueTTM', '매출 (TTM)', 'revenueTTM', 'USD', '제공자 최근 12개월 매출', '기업 회계연도와 다른 최근 12개월 합계예요.'],
    ['beta', '베타', 'beta', '배', '제공자 시장 민감도 추정', '과거 회귀기간과 비교지수에 따라 달라요.'],
    ['priceToBook', 'PBR', 'priceToBook', '배', '제공자 주가순자산비율', '회계상 순자산과 시장 가치의 비율이에요.'],
    ['roa', 'ROA (TTM)', 'roa', '%', '제공자 자산수익률', '연간 공시 기간과 다른 제공자 지표예요.'],
    ['operatingCashFlowTTM', '영업현금흐름 (TTM)', 'operatingCashFlowTTM', 'USD', '제공자 최근 12개월 영업현금흐름', '손익과 구분되는 현금흐름 지표예요.'],
    ['freeCashFlowTTM', 'FCF (제공자 정의)', 'freeCashFlowTTM', 'USD', 'Yahoo 제공자 정의 잉여현금흐름', 'SEC 연간 OCF−투자지출 대용치와 정의·기간이 다를 수 있어요.'],
    ['totalCash', '현금 (최근 보고)', 'totalCash', 'USD', '제공자 최근 보고 현금', '주가 시각과 재무 보고 기준일은 달라요.'],
    ['totalDebt', '부채 (제공자 정의)', 'totalDebt', 'USD', '제공자 최근 보고 부채', '부채 정의와 리스·단기 차입 포함 범위를 원문에서 확인해 주세요.'],
    ['sharesOutstanding', '발행주식 수 (제공자)', 'sharesOutstanding', '주', '제공자 발행주식 수', '희석 가중평균 주식 수와 다르며 DCF 입력 전 분할·기준일을 확인하세요.'],
  ];
  for (const [key, label, field, unit, formula, explanation] of extras) {
    const value = finite(quote[field]) ? quote[field] : null, notMeaningful = key === 'forwardPE' && (value !== null && value <= 0 || /N\/M/.test(quote.unavailableReasons?.forwardPE || ''));
    const source = quote.evidence?.[field] || (notMeaningful ? quote.evidence?.forwardEPS || (quote.sourceUrl ? { provider: quote.provider, url: quote.sourceUrl, asOf: quote.marketTime, retrievedAt: quote.retrievedAt, basis: 'Yahoo 예상 PER N/M 사유 (예상 이익 기준)' } : null) : null);
    results.push({ key, label, value: notMeaningful ? null : value, unit, formula, explanation, source, basis: source?.basis || '제공자 기준', status: notMeaningful ? 'not-meaningful' : value === null ? 'unavailable' : 'reported', reason: notMeaningful ? '예상 이익이 0 이하라 예상 PER은 해석하지 않아요.' : value === null ? quote.unavailableReasons?.[field] || '공개 제공자 수치를 확인하지 못했어요.' : null });
  }
  return results;
}

export function createResearchService({ fetcher = globalThis.fetch, clock = () => Date.now() } = {}) {
  const publicMarket = createPublicDataService({ fetcher, clock });
  const priceService = createPriceService({fetcher,clock});
  const profileService = createProfileService({fetcher,clock});
  const debtService = createDebtService({fetcher,clock});
  const analystService = createAnalystService({fetcher,clock});
  async function decorate(payload, request, env, quote, alias, rawFacts = null) {
    const ticker = payload.company.ticker;
    const [profileResult, priceResult, debtResult, analystPack] = await Promise.allSettled([
      payload.company.profile || quote.profile || (!payload.collectedAt ? profileService.get(ticker) : null),
      payload.priceHistory || (payload.collectedAt ? {status:'unavailable',points:[],reason:'이 수집본에는 일별 가격이 없습니다.'} : priceService.get(ticker)),
      debtService.get(ticker,{cik:payload.company.cik,reports:payload.reports,assets:env.ASSETS,request,userAgent:env.SEC_USER_AGENT,allowNetwork:!payload.collectedAt,facts:rawFacts}),
      (payload.analystResearch?.status==='available'?payload.analystResearch:null) || loadAnalystResearch(request,env,ticker,{clock})
    ]);
    const profileEnvelope=profileResult.status==='fulfilled'?profileResult.value:null;
    const profile=profileEnvelope?.profile||profileEnvelope;
    const [editedSector,editedIndustry] = SECTORS[ticker] || ['기타','분류 확인 중'];
    const sector = profile?.sector || quote.profile?.sector || payload.company.sector || editedSector;
    const industry = profile?.industry || quote.profile?.industry || payload.company.industry || editedIndustry;
    const classificationSource = profile?.source || quote.profile?.source || payload.company.classificationSource || 'BANDAL 탐색용 편집 분류';
    const priceHistory = priceResult.status==='fulfilled' ? priceResult.value : {status:'unavailable',points:[]};
    const debtFetched=debtResult.status==='fulfilled'?debtResult.value:null;
    const debt=debtFetched?.status!=='unavailable'&&debtFetched?debtFetched:payload.debt||debtFetched||{status:'unavailable',instruments:[],coverage:{reason:'부채 주석 수집을 확인하지 못했습니다.'}};
    let analystResearch = analystPack.status==='fulfilled' ? analystPack.value : null;
    if (!analystResearch && !payload.collectedAt) {try {analystResearch=await analystService(ticker);}catch{}}
    const reviewedProfile=await createProfileSummaryService({assets:env.ASSETS,clock,request}).get(ticker);
    const logo = payload.company.logo || quote.logo || profileEnvelope?.logo || null;
    const company = {...payload.company,sector,industry,classificationSource,profile,
      ...(logo?{logo:{...logo,url:logo.url?.startsWith('/finance/logos/')?logo.url:`/finance/api/companies/${ticker}/logo`,originalUrl:logo.originalUrl||logo.url}}:{}),
      ...(reviewedProfile?.description?{description:reviewedProfile.description,descriptionSource:reviewedProfile.source,profileSummary:reviewedProfile}:profile?.description?{description:profile.description,descriptionSource:profile.source}:{})};
    let peerBenchmarks = {metrics:{},status:'unavailable',reason:'동일 업종·동일 기준의 비교 표본이 부족합니다.'};
    const peerIndex=await bundledSnapshot(request,env,'index');
    if (peerIndex?.companies?.length && typeof classificationSource==='object') {
      const peerRows=[];
      for(const item of peerIndex.companies.filter(row=>row.industry===industry&&row.ticker!==ticker).slice(0,20)){
        const peer=await bundledSnapshot(request,env,item.ticker);if(peer?.payload)peerRows.push({...peer.payload,metrics:metricsWithSources(peer.payload.financials,peer.payload.evidence,peer.payload.quote)});
      }
      peerBenchmarks=industryBenchmarks({...payload,company,quote,metrics:metricsWithSources(payload.financials,payload.evidence,quote)},peerRows);
      for(const b of Object.values(peerBenchmarks.metrics))Object.assign(b,{value:b.mean,count:b.n,industry,methodology:peerBenchmarks.reason,note:'비교 표본: '+b.sample.map(row=>row.ticker).join(', ')+' · 기준일 '+b.dates.join(', ')});
    }
    const outlook = await loadCompanyOutlook(request, env, ticker, { clock });
    const descriptionReference = outlook?.sources.find(source => outlook.business?.sourceIds?.includes(source.id));
    const descriptionSource = descriptionReference ? { provider: '기업 공식 발표', url: descriptionReference.url, publishedAt: descriptionReference.publishedAt, retrievedAt: descriptionReference.retrievedAt, basis: '사업 설명의 출처 기반 요약' } : null;
    if(payload.evidence?.grossProfit?.derived&&ticker!=='IREN')payload.evidence.grossProfit.scope='공시 매출−원가 차감액 (원가 포함 범위 확인)';
    const flow = buildFinancialFlow(payload.financials, payload.period);
    if(payload.evidence?.grossProfit?.derived&&ticker!=='IREN'){const gross=flow.nodes?.find(n=>n.id==='gross');if(gross)gross.label='매출−공시 원가';flow.note+=' 공시 원가의 감가상각 포함 범위를 별도 확인해야 하며, 계산 차감액을 표준 매출총이익과 동일시하지 않습니다.';}
    const accountingNotes = ticker === 'IREN' ? ['IREN의 매출원가는 감가상각·상각을 제외합니다. 직접원가 차감잔액을 다른 회사의 표준 매출총이익과 같은 기준으로 비교하면 안 됩니다.'] : [];
    if (ticker === 'IREN' && flow.nodes?.length) { const gross = flow.nodes.find(node => node.id === 'gross'); if (gross) gross.label = '직접원가 차감잔액'; const costs = flow.nodes.find(node => node.id === 'opex'); if (costs) costs.label = '기타 비용·상각·손상차손'; flow.note += ' IREN 직접원가는 감가상각·상각 제외 기준이며 잔여 영업비용에는 비현금 손상차손 등이 포함됩니다.'; }
    const metrics = metricsWithSources(payload.financials, payload.evidence, quote);
    if(payload.evidence?.grossProfit?.derived&&ticker!=='IREN'){const m=metrics.find(m=>m.key==='grossMargin');if(m){m.label='공시 원가 차감률';m.explanation='공시된 매출에서 공시 원가를 뺀 계산 비율입니다. 기업에 따라 원가의 감가상각 포함 범위가 다르므로 표준 매출총이익률이나 산업 평균으로 직접 비교하지 않습니다.';}}
    if (outlook?.arr?.operating && finite(outlook.arr.operating.value)) {
      const metric = metrics.find(item => item.key === 'arr'), definition = outlook.arr, observed = definition.operating;
      const reference = outlook.sources.find(source => observed.sourceIds?.includes(source.id));
      if (metric && reference) Object.assign(metric, { label: '운영 ARR (회사 정의)', value: observed.value, status: 'reported', basis: '회사 정의 비GAAP 운영 지표', reason: null, explanation: definition.definition,
        source: { provider: 'IREN 공식 발표', url: reference.url, asOf: observed.effectiveAt, publishedAt: reference.publishedAt, retrievedAt: reference.retrievedAt, basis: '운영 ARR · 계약 ARR 및 향후 운영 목표와 별도', unit: definition.currency } });
    }
    if (ticker === 'IREN') { const margin = metrics.find(metric => metric.key === 'grossMargin'); if (margin) { margin.label = '직접원가 차감잔액률'; margin.explanation = '감가상각·상각을 제외한 직접원가만 차감한 비율입니다. 일반 매출총이익률과 직접 비교하지 마세요.'; } }
    const consensus = quote.analystConsensus;
    const opinions = consensus && (consensus.analystCount > 0 || finite(consensus.targetMean)) ? { status: 'available', provider: quote.provider, retrievedAt: quote.retrievedAt, ratings: [], recommendation: consensus.recommendation || null, analystCount: consensus.analystCount || null, targetMean: consensus.targetMean ?? null, targetLow: consensus.targetLow ?? null, targetHigh: consensus.targetHigh ?? null, analystTargetPrice: consensus.targetMean ?? null, source: consensus.source || null, reason: 'Yahoo가 집계한 애널리스트 의견·목표가예요. 회사의 공식 가이던스나 개별 보고서 원문이 아니에요.' } : payload.opinions;
    return { ...payload, company: { ...company, ...(outlook?.business?.description ? { description: outlook.business.description, descriptionSource } : {}) }, priceHistory, debt, analystResearch, peerBenchmarks, insights:buildFinancialInsights({...payload,company,metrics,history:payload.quarterlyHistory||payload.history,annualHistory:payload.annualHistory||payload.history}), coverage:{scope:'SEC 등록 기업 · 공개된 항목만 표시',metrics:Object.fromEntries(metrics.map(m=>[m.key,{state:finite(m.value)?'available':m.status==='not-meaningful'?'not-meaningful':'unavailable',reason:m.reason||null}])),quarterly:{available:!!payload.quarterlyHistory?.quarters?.length,count:payload.quarterlyHistory?.quarters?.length||0},price:{available:priceHistory?.status==='available'},debt:debt?.coverage||null,analysts:analystResearch?.coverage||null}, metrics, quote, flow, opinions, outlook, business: outlook?.business ? { ...outlook.business, descriptionSource } : null, arr: outlook?.arr || null, history: attachHistoricalValuations(payload.quarterlyHistory || (payload.history?.metricSeries?payload.history:{status:'unavailable',quarters:[],metricSeries:{}}),priceHistory), annualHistory:payload.annualHistory || (Array.isArray(payload.history)?payload.history:[]), accountingNotes,
      fieldSources: { ...(payload.evidence || {}), ...(quote.evidence || {}) }, ...(alias?.correction ? alias : {}) };
  }
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
  async function bundledSnapshot(request, env, name) {
    if (!env.ASSETS?.fetch || !/^(?:catalog|index|[A-Z0-9.-]{1,12})$/.test(name)) return null;
    const key = 'snapshot:' + name, existing = cache.get(key);
    if (existing && existing.expires > clock()) return existing.value;
    const max = name === 'catalog' ? 3 * 1024 * 1024 : 768 * 1024;
    try {
      const target = new URL(request.url);
      target.pathname = '/finance/snapshots/' + name + '.json'; target.search = ''; target.hash = '';
      // ASSETS is the platform's static binding, not a fetch to a visitor URL.
      const response = await env.ASSETS.fetch(new Request(target, { method: 'GET' }));
      if (!response.ok || Number(response.headers.get('Content-Length')) > max) { await response.body?.cancel(); return null; }
      const reader = response.body?.getReader(); if (!reader) return null;
      const chunks = []; let size = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > max) { await reader.cancel(); return null; } chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const data = JSON.parse(new TextDecoder().decode(bytes)), collected = Date.parse(data?.collectedAt);
      if (data?.schemaVersion !== 1 || typeof data.collectedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.collectedAt) || !Number.isFinite(collected) || collected > clock() + 300000) return null;
      if (name === 'index') {
        if(!Array.isArray(data.companies)||data.companies.length>30000||!data.companies.every(c=>/^[A-Z0-9.-]{1,12}$/.test(c.ticker||'')&&typeof c.name==='string'))return null;
      } else if (name === 'catalog') {
        if (!Array.isArray(data.companies) || !data.companies.length || data.companies.length > 30000 || data.source?.url !== TICKERS_URL) return null;
        if (!data.companies.every(company => /^[A-Z0-9.-]{1,12}$/.test(company.ticker || '') && typeof company.name === 'string' && company.name.length <= 300 && /^\d{1,10}$/.test(String(company.cik)))) return null;
      } else {
        const p = data.payload, known = DIRECTORY.find(company => company.ticker === name);
        if (!['available', 'partial'].includes(p?.status) || p.company?.ticker !== name || p.company.currency !== 'USD' || !/^\d{1,10}$/.test(String(p.company.cik))) return null;
        if (known && Number(known.cik) !== Number(p.company.cik)) {
          // Corporate reorganizations can retain a ticker under a new CIK.
          // A current collected SEC catalog must corroborate a replacement;
          // never let an arbitrary snapshot override identity on its own.
          const identityCatalog = await bundledSnapshot(request, env, 'catalog');
          const listed = identityCatalog?.companies.find(company => company.ticker === name);
          if (!listed || Number(listed.cik) !== Number(p.company.cik)) return null;
        }
        if (!FIELDS.every(field => p.financials?.[field] == null || finite(p.financials?.[field])) || !Array.isArray(p.reports) || p.reports.length > 50 || !Array.isArray(p.sources) || !Array.isArray(p.limitations)) return null;
        if (p.status === 'partial') {
          if (p.period !== null || !FIELDS.every(field => p.financials?.[field] == null) || p.quote?.status !== 'available' || p.quote.ticker !== name || p.quote.provider !== 'Yahoo Finance' || p.quote.currency !== 'USD' || p.quote.sourceUrl !== `https://finance.yahoo.com/quote/${name}/key-statistics/` && p.quote.sourceUrl !== `https://finance.yahoo.com/quote/${name}/`) return null;
          if (!p.sources.some(source => source.provider === 'Yahoo Finance' && source.status === 'available' && source.url === p.quote.sourceUrl)) return null;
        } else {
          if (!p.period || !validDate(p.period.start) || !validDate(p.period.end) || !validDate(p.period.filed) || days(p.period.start, p.period.end) < 330 || days(p.period.start, p.period.end) > 400 || !String(p.period.sourceUrl || '').startsWith(`https://www.sec.gov/Archives/edgar/data/${Number(p.company.cik)}/`)) return null;
          if (!p.sources.some(source => source.provider === 'SEC companyfacts' && source.status === 'available' && source.url === `${SEC_API}/api/xbrl/companyfacts/CIK${String(p.company.cik).padStart(10, '0')}.json`)) return null;
        }
      }
      remember(key, data, 300000, size);
      return data;
    } catch { return null; }
  }
  function snapshotAge(snapshot) { return Math.max(0, (clock() - Date.parse(snapshot.collectedAt)) / 3600000); }
  async function snapshotResponse(snapshot, ticker, env, reason, request, alias) {
    const p = snapshot.payload, ageHours = snapshotAge(snapshot), stale = ageHours > 24;
    // Price snapshots retain the provider's quote timestamp, not the current page
    // view timestamp. A stale collected quote is not silently called current.
    const storedQuote = p.quote?.status === 'available' && (p.quote.ticker === ticker || p.quote.provider === 'Alpha Vantage') && typeof p.quote.retrievedAt === 'string' && Date.parse(p.quote.retrievedAt) <= clock() + 300000 ? p.quote : null;
    const quote = storedQuote && !stale ? { ...storedQuote, cached: true } : await marketSnapshot(ticker, env);
    const effectiveQuote = quote.status === 'available' ? quote : storedQuote ? { ...storedQuote, cached: true, stale: true, freshness: `${storedQuote.freshness || '공개 시세 스냅샷'} · 보관 자료, 새 조회 실패` } : quote;
    const ratings = Object.entries(effectiveQuote.analystRatings || {}).filter(([, count]) => Number.isInteger(count) && count >= 0).map(([rating, count]) => ({ rating, count }));
    const notice = `공개 기업자료 스냅샷${p.status === 'partial' ? ' (Yahoo 지표, 연간 SEC 재무 미확인)' : ' (SEC 공시·제공자별 지표)'} · 수집 ${snapshot.collectedAt} · 실시간 갱신 아님.${stale ? ' 수집 후 24시간이 지났으며 새 원문 조회가 실패해 이전 자료를 보여드려요.' : ' 수집 후 24시간 이내 저장 자료예요.'}`;
    return json(await decorate({ ...p, asOf: snapshot.collectedAt, collectedAt: snapshot.collectedAt, dataMode: 'snapshot', snapshot: { collectedAt: snapshot.collectedAt, ageHours: Math.round(ageHours * 100) / 100, stale, reason },
      metrics: calculateMetrics(p.financials, effectiveQuote), flow: buildFinancialFlow(p.financials, p.period), quote: effectiveQuote,
      opinions: { status: ratings.length ? 'available' : 'unavailable', ratings, analystTargetPrice: quote.analystTargetPrice || null, provider: 'Alpha Vantage', retrievedAt: quote.retrievedAt || null, reason: ratings.length ? '제공자의 집계 의견이에요. 개별 보고서 원문·작성일·분석가 목록은 제공하지 않아요.' : '확인 가능한 애널리스트 리서치 제공자가 연결되지 않았어요. 공식 실적 원문을 먼저 확인해 주세요.' },
      sources: [...p.sources.filter(source => typeof source?.provider === 'string' && source.provider.startsWith('SEC')).map(source => ({ ...source, snapshotCollectedAt: snapshot.collectedAt })), ...(effectiveQuote.status === 'available' ? [{ provider: effectiveQuote.provider, url: effectiveQuote.sourceUrl, retrievedAt: effectiveQuote.retrievedAt, status: 'available' }] : [])],
      limitations: [notice, ...p.limitations.filter(message => typeof message === 'string' && !/시세 제공자|PER·PSR/.test(message)), ...(effectiveQuote.status === 'unavailable' ? [effectiveQuote.reason] : ['PER·PSR은 제공자의 TTM 지표이고, 나머지 SEC 수치는 스냅샷의 연간 공시 기준이에요. 시점과 분모가 달라요.'])] }, request, env, effectiveQuote, alias));
  }
  let lastRequestAt = 0;
  async function marketSnapshot(ticker, env) {
    const unavailable = { status: 'unavailable', price: null, marketCap: null, reportedPE: null, reportedPS: null, provider: 'Alpha Vantage', reason: '시세 제공자 API 키가 연결되지 않았어요. PER·PSR은 확인되지 않은 숫자로 채우지 않아요.' };
    const key = String(env.ALPHAVANTAGE_API_KEY || '').trim();
    if (!key || key.length > 200 || /[\r\n]/.test(key)) return publicMarket(ticker);
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
  async function catalog(env, request) {
    const snapshot = request ? await bundledSnapshot(request, env, 'catalog') : null;
    function snapshotCatalog() {
      return { companies: snapshot.companies.map(company => { const known = DIRECTORY.find(item => item.ticker === company.ticker); return { ...company, irUrl: known?.irUrl || null, aliases: known?.aliases || '' }; }), source: { provider: 'SEC EDGAR 수집 스냅샷', url: TICKERS_URL, status: 'snapshot', collectedAt: snapshot.collectedAt, retrievedAt: snapshot.collectedAt, stale: snapshotAge(snapshot) > 24 } };
    }
    if (snapshot && snapshotAge(snapshot) <= 24) return snapshotCatalog();
    try {
      const body = await fetchJson(TICKERS_URL, env, 24 * 3600000);
      const companies = Object.values(body).filter(row => typeof row?.ticker === 'string' && /^[A-Z0-9.-]{1,12}$/.test(row.ticker) && typeof row.title === 'string' && row.title.length <= 300 && Number.isInteger(row.cik_str) && row.cik_str > 0 && row.cik_str < 1e10).map(row => {
        const known = DIRECTORY.find(item => item.ticker === row.ticker);
        return { ticker: row.ticker, name: row.title, cik: String(row.cik_str), irUrl: known?.irUrl || null, aliases: known?.aliases || '' };
      });
      if (!companies.length) throw new Error('SEC_INVALID_CATALOG');
      return { companies, source: { provider: 'SEC EDGAR', url: TICKERS_URL, status: 'available' } };
    } catch {
      if (snapshot) return snapshotCatalog();
      return { companies: DIRECTORY, source: { provider: 'BANDAL 공식 IR 주소록', url: 'https://www.sec.gov/edgar/search/', status: 'directory-only' } };
    }
  }
  return async function handle(request, env = {}, path) {
    if (!path?.startsWith('companies/')) return null;
    if (request.method !== 'GET') return json({ error: '기업 자료는 GET으로 조회해 주세요.' }, 405);
    const url = new URL(request.url), query = (url.searchParams.get('q') || '').trim();
    if (path === 'companies/explore') {
      const index=await bundledSnapshot(request,env,'index');
      const entries=index?.companies?.length?index.companies:DIRECTORY.filter(company=>company.ticker!=='GOOG');
      const loaded = await Promise.all(entries.slice(0,150).map(async entry => {
        const snapshot = await bundledSnapshot(request, env, entry.ticker), p = snapshot?.payload, quote = p?.quote || {}, f = p?.financials || {}, storedMetrics=p?.metrics||metricsWithSources(f,p?.evidence,quote), metric = key => storedMetrics.find(item => item.key === key)?.value ?? null;
        const [editedSector,editedIndustry] = SECTORS[entry.ticker] || ['기타','분류 확인 중'];
        const sector=p?.company?.sector||quote.profile?.sector||editedSector,industry=p?.company?.industry||quote.profile?.industry||editedIndustry;
        return { logo:p?.company?.logo||quote.logo?{...(p?.company?.logo||quote.logo),url:p?.company?.logo?.url?.startsWith('/finance/logos/')?p.company.logo.url:`/finance/api/companies/${entry.ticker}/logo`}:null,ticker: entry.ticker, name: p?.company?.name || entry.name, sector, industry, price: quote.price ?? null, marketCap: quote.marketCap ?? null, per: quote.reportedPE > 0 ? quote.reportedPE : null, perStatus: quote.epsTTM <= 0 && finite(quote.epsTTM) ? 'not-meaningful' : quote.reportedPE > 0 ? 'reported' : 'unavailable', psr: quote.reportedPS ?? null, psrStatus: finite(quote.reportedPS) ? 'reported' : 'unavailable', roe: metric('roe'), epsTTM: quote.epsTTM ?? null,
          revenue: f.revenue ?? null, netIncome: f.netIncome ?? null, period: p?.period || null, asOf: snapshot?.collectedAt || null, dataMode: snapshot ? 'snapshot' : 'identity-only', sources: p ? { revenue: p.evidence?.revenue, price: quote.evidence?.price, marketCap: quote.evidence?.marketCap, per: quote.evidence?.reportedPE || (quote.epsTTM <= 0 ? quote.evidence?.epsTTM : null), psr: quote.evidence?.reportedPS, roe: storedMetrics.find(item => item.key === 'roe')?.source } : {}, status: p?.status || 'unavailable', classificationSource: 'BANDAL 탐색용 편집 분류' };
      }));
      return json({ companies: loaded, asOf: new Date(clock()).toISOString(), scope: '저장된 공개 데이터가 있는 주요 기업 · 전체 기업은 검색으로 탐색', rankingNote: '표시된 표본 내 순위이며 전세계 전체 기업 순위가 아닙니다. 공시 연도·시장 시각·연간/TTM 기준을 확인하세요.' });
    }
    if (path === 'companies/search') {
      if (!query || query.length > 100) return json({ error: '기업명 또는 종목코드를 100자 이내로 입력해 주세요.' }, 422);
      const alias = resolveTicker(query), { companies, source } = await catalog(env, request), needle = alias.resolvedTicker.toLocaleLowerCase();
      const results = companies.filter(company => `${company.ticker} ${company.name} ${company.aliases}`.toLocaleLowerCase().includes(needle)).sort((a, b) => (b.ticker.toLowerCase() === needle ? 1 : 0) - (a.ticker.toLowerCase() === needle ? 1 : 0) || a.ticker.localeCompare(b.ticker)).slice(0, 20).map(({ aliases, ...company }) => company);
      return json({ results, ...alias, resolvedTicker: alias.correction ? alias.resolvedTicker : results.length === 1 ? results[0].ticker : null, source: { ...source, retrievedAt: source.retrievedAt || new Date(clock()).toISOString() }, limitations: source.status === 'directory-only' ? ['SEC 목록을 불러오지 못해 주요 미국 기업 주소록만 검색했어요. 최신 재무 수치는 포함하지 않아요.'] : [...(source.status === 'snapshot' ? [`SEC 기업 목록 스냅샷 · 수집 ${source.collectedAt}${source.stale ? ' · 24시간 경과, 새 목록 조회 실패' : ''}`] : []), '현재 SEC에 등록된 미국 상장·공시 기업을 지원해요. 한국 주식 공시는 별도 제공자가 필요해요.'] });
    }
    const suffix=path.slice('companies/'.length).split('/');
    const alias = resolveTicker(suffix[0]), ticker = alias.resolvedTicker;
    if (!/^[A-Z0-9.-]{1,12}$/.test(ticker)) return json({ error: '유효한 SEC 종목코드를 입력해 주세요.' }, 422);
    let snapshot = await bundledSnapshot(request, env, ticker);
    const stored=await readPublicCache(env,ticker,{clock});
    if(stored&&(!snapshot||Date.parse(stored.collectedAt)>Date.parse(snapshot.collectedAt)))snapshot=stored;
    if(suffix.length>1){
      if(suffix.length!==2||!['prices','logo'].includes(suffix[1]))return json({error:'자료 경로를 확인해 주세요.'},404);
      if(suffix[1]==='prices')return json(snapshot?.payload?.priceHistory||await priceService.get(ticker));
      const descriptor=snapshot?.payload?.company?.logo||snapshot?.payload?.quote?.logo;
      if(descriptor?.url?.startsWith('/finance/logos/')&&env.ASSETS?.fetch){const target=new URL(request.url);target.pathname=descriptor.url;target.search='';return env.ASSETS.fetch(new Request(target));}
      try{const logo=await fetchPublicCompanyLogo(descriptor?.originalUrl||descriptor?.url,{fetcher});return new Response(logo.bytes,{headers:{'Content-Type':logo.contentType,'Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});}catch{return new Response(null,{status:404,headers:{'Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'}});}
    }
    if (snapshot && snapshotAge(snapshot) <= 24) return snapshotResponse(snapshot, ticker, env, 'collected-cache', request, alias);
    const { companies, source: catalogSource } = await catalog(env, request), entry = companies.find(company => company.ticker === ticker);
    if (!entry && snapshot) return snapshotResponse(snapshot, ticker, env, 'provider-unavailable', request, alias);
    if (!entry) return json({ error: catalogSource.status === 'available' ? 'SEC 목록에서 기업을 찾지 못했어요.' : '현재 주소록에서 기업을 찾지 못했어요. SEC 연결 후 전체 기업을 검색할 수 있어요.', code: catalogSource.status === 'available' ? 'COMPANY_NOT_FOUND' : 'CATALOG_UNAVAILABLE' }, catalogSource.status === 'available' ? 404 : 503);
    const { aliases, ...company } = entry, cik = company.cik.padStart(10, '0'), factsUrl = `${SEC_API}/api/xbrl/companyfacts/CIK${cik}.json`, submissionsUrl = `${SEC_API}/submissions/CIK${cik}.json`;
    const [outcomes, quote] = await Promise.all([Promise.allSettled([fetchJson(factsUrl, env, 3600000), fetchJson(submissionsUrl, env, 3600000)]), marketSnapshot(ticker, env)]);
    const asOf = new Date(clock()).toISOString();
    let normalized = { financials: Object.fromEntries(FIELDS.map(key => [key, null])), evidence: {}, period: null, history: [], warnings: [] };
    const limitations = [];
    if (outcomes[0].status === 'fulfilled' && String(outcomes[0].value.cik).replace(/^0+/, '') === String(Number(cik))) normalized = normalizeCompanyFacts(outcomes[0].value, company.cik);
    else limitations.push('SEC 재무 원문을 불러오지 못했어요. 값을 추정하지 않았으며 공식 공시·IR 링크에서 확인할 수 있어요.');
    if (!normalized.period && snapshot) return snapshotResponse(snapshot, ticker, env, 'provider-unavailable', request, alias);
    let reports = [];
    if (outcomes[1].status === 'fulfilled' && String(outcomes[1].value.cik).replace(/^0+/, '') === String(Number(cik))) reports = reportsFromSubmissions(outcomes[1].value, company.cik);
    else limitations.push('최신 보고서·실적 공시 목록을 가져오지 못했어요. 아래 공식 IR과 EDGAR에서 확인해 주세요.');
    if (company.irUrl) reports.push({ title: '공식 IR · 실적발표·자료', type: 'IR', date: null, url: company.irUrl, provider: '기업 공식 IR' });
    reports.push({ title: 'SEC EDGAR 전체 공시', type: 'IR', date: null, url: `https://www.sec.gov/edgar/browse/?CIK=${company.cik}&owner=exclude`, provider: 'SEC EDGAR' });
    const f = normalized.financials;
    const ratings = Object.entries(quote.analystRatings || {}).filter(([, count]) => Number.isInteger(count) && count >= 0).map(([rating, count]) => ({ rating, count }));
    const enriched=await decorate({ company: { ...company, currency: 'USD' }, status: normalized.period ? 'available' : quote.status === 'available' ? 'partial' : 'unavailable', dataMode: 'live-source', asOf, period: normalized.period, financials: f, evidence: normalized.evidence, annualHistory: normalized.history, quarterlyHistory:outcomes[0].status==='fulfilled'?normalizeQuarterlyHistory(outcomes[0].value,company.cik,{limit:8,asOf:asOf.slice(0,10)}):null, history: normalized.history, metrics: calculateMetrics(f, quote), flow: buildFinancialFlow(f, normalized.period), reports, swot: swotChecklist(f), quote,
      opinions: { status: ratings.length ? 'available' : 'unavailable', ratings, analystTargetPrice: quote.analystTargetPrice || null, provider: 'Alpha Vantage', retrievedAt: quote.retrievedAt || null, reason: ratings.length ? '제공자의 집계 의견이에요. 개별 보고서 원문·작성일·분석가 목록은 제공하지 않아요.' : '확인 가능한 애널리스트 리서치 제공자가 연결되지 않았어요. 공식 실적 원문을 먼저 확인해 주세요.' },
      sources: [{ provider: 'SEC companyfacts', url: factsUrl, retrievedAt: fetchedAt.get(factsUrl) || null, status: normalized.period ? 'available' : 'unavailable' }, { provider: 'SEC submissions', url: submissionsUrl, retrievedAt: fetchedAt.get(submissionsUrl) || null, status: outcomes[1].status === 'fulfilled' && reports.some(report => report.provider === 'SEC EDGAR' && report.date) ? 'available' : 'unavailable' }, ...(quote.status === 'available' ? [{ provider: quote.provider, url: quote.sourceUrl, retrievedAt: quote.retrievedAt, status: 'available' }] : [])], limitations: [...limitations, ...normalized.warnings, ...(quote.status === 'unavailable' ? [quote.reason] : ['PER·PSR은 제공자의 TTM 지표이고, 나머지 SEC 수치는 연간 공시 기준이에요. 시점과 분모가 달라요.'])] }, request, env, quote, alias, outcomes[0].status==='fulfilled'?outcomes[0].value:null);
    if(enriched.status==='available'||enriched.status==='partial')await writePublicCache(env,ticker,enriched,{clock});
    return json(enriched);
  };
}

const service = createResearchService();
export const handleResearchRequest = (request, env, path) => service(request, env, path);
