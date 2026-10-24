// SEC quarterly observations. Annual values and YTD totals are never drawn as
// quarters. A difference must use the same tag, unit and fiscal-year start.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const days = (start, end) => (Date.parse(end) - Date.parse(start)) / 86400000;
const nextDay = value => new Date(Date.parse(value) + 86400000).toISOString().slice(0, 10);
const FORMS = new Set(['10-Q', '10-Q/A', '10-K', '10-K/A', '20-F', '20-F/A', '6-K']);
const TAGS = {
  revenue: [['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'], ['Revenue']],
  costOfRevenue: [['CostOfRevenue', 'CostOfGoodsAndServicesSold'], ['CostOfSales']],
  grossProfit: [['GrossProfit'], ['GrossProfit']],
  operatingIncome: [['OperatingIncomeLoss'], ['ProfitLossFromOperatingActivities']],
  netIncome: [['NetIncomeLoss', 'ProfitLoss'], ['ProfitLoss']],
  operatingCashFlow: [['NetCashProvidedByUsedInOperatingActivities'], ['CashFlowsFromUsedInOperatingActivities']],
  capex: [['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'], ['PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities']],
  dilutedEPS: [['EarningsPerShareDiluted'], ['DilutedEarningsLossPerShare']],
  researchDevelopment: [['ResearchAndDevelopmentExpense'], ['ResearchAndDevelopmentExpense']],
  sellingGeneralAdministrative: [['SellingGeneralAndAdministrativeExpense'], ['SellingGeneralAndAdministrativeExpense']],
  interestExpense: [['InterestExpenseDebt', 'InterestAndDebtExpense', 'InterestExpense'], ['FinanceCosts']],
  incomeTax: [['IncomeTaxExpenseBenefit'], ['IncomeTaxExpenseContinuingOperations']],
  equity: [['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'], ['EquityAttributableToOwnersOfParent', 'Equity']],
  assets: [['Assets'], ['Assets']],
  liabilities: [['Liabilities'], ['Liabilities']],
  cash: [['CashAndCashEquivalentsAtCarryingValue'], ['CashAndCashEquivalents']],
  shares: [['CommonStockSharesOutstanding'], ['NumberOfSharesOutstanding']],
};
const BALANCE_FIELDS = new Set(['equity', 'assets', 'liabilities', 'cash', 'shares']);
const unitFor = field => field === 'dilutedEPS' ? 'USD/shares' : field === 'shares' ? 'shares' : 'USD';
function filingUrl(cik, accession) {
  return /^\d{1,10}$/.test(String(cik)) && /^\d{10}-\d{2}-\d{6}$/.test(accession || '') ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-', '')}/${accession}-index.htm` : null;
}
function rowsFor(facts, field, asOf) {
  return (TAGS[field] || []).flatMap((tags, taxonomyIndex) => tags.flatMap((tag, priority) => {
    const taxonomy = taxonomyIndex ? 'ifrs-full' : 'us-gaap', unit = unitFor(field);
    return (facts?.facts?.[taxonomy]?.[tag]?.units?.[unit] || []).filter(row => finite(row.val) && validDate(row.end) && validDate(row.filed) && FORMS.has(row.form) && (!row.start || validDate(row.start)) && (!asOf || row.end <= asOf && row.filed <= asOf)).map(row => ({ ...row, tag, taxonomy, unit, priority: taxonomyIndex * 100 + priority }));
  }));
}
const byFreshness = (a, b) => b.filed.localeCompare(a.filed) || a.priority - b.priority || String(b.accn || '').localeCompare(String(a.accn || ''));
function source(row, cik) {
  return { provider: 'SEC EDGAR', value: row.val, tag: row.tag, taxonomy: row.taxonomy, unit: row.unit, start: row.start || null, end: row.end, asOf: row.end, filed: row.filed, form: row.form, accession: row.accn || null, url: filingUrl(cik, row.accn), basis: row.start ? '개별 분기 공시' : '분기말 재무상태' };
}
function quarterCandidates(rows, cik, additive = true) {
  const direct = rows.filter(row => row.start && days(row.start, row.end) >= 65 && days(row.start, row.end) <= 110).map(row => ({ ...row, evidence: source(row, cik), direct: true }));
  if (!additive) return direct;
  const derived = [], groups = new Map();
  const groupKey = row => [row.start, row.tag, row.taxonomy, row.unit].join('|');
  for (const row of rows) { const key = groupKey(row); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
  // Iterating observations rather than whole taxonomies keeps this work bounded
  // by a single issuer's public facts response.
  for (const current of rows) {
    if (!current.start || days(current.start, current.end) < 150 || days(current.start, current.end) > 400) continue;
    const previous = groups.get(groupKey(current)).filter(row => row.end < current.end && row.filed <= current.filed && days(row.end, current.end) >= 66 && days(row.end, current.end) <= 111).sort((a, b) => {
      // The current filing's comparative/restated value is the strongest match.
      const sameA = !!a.accn && a.accn === current.accn, sameB = !!b.accn && b.accn === current.accn;
      return Number(sameB) - Number(sameA) || byFreshness(a, b);
    })[0];
    if (!previous || current.form.endsWith('/A') && previous.accn !== current.accn) continue;
    const start = nextDay(previous.end), value = current.val - previous.val;
    derived.push({ ...current, start, val: value, direct: false, evidence: { provider: 'SEC EDGAR 공시에서 계산', value, unit: current.unit, start, end: current.end, asOf: current.end, filed: current.filed, url: filingUrl(cik, current.accn), derived: true, basis: '동일 회계연도 누적액 차이로 계산한 개별 분기', formula: `${current.start}~${current.end} 누적액 − ${previous.start}~${previous.end} 누적액`, inputs: [source(current, cik), source(previous, cik)] } });
  }
  return [...direct, ...derived];
}
function pickQuarter(rows, start, end) {
  return rows.filter(row => row.start === start && row.end === end).sort((a, b) => b.filed.localeCompare(a.filed) || Number(b.direct) - Number(a.direct) || a.priority - b.priority)[0] || null;
}
function derivedEvidence(value, quarter, inputs, formula, basis = '개별 분기 공시에서 계산') {
  return { provider: 'SEC EDGAR 공시에서 계산', value, unit: formula.includes('× 100') ? '%' : 'USD', start: quarter.start, end: quarter.end, asOf: quarter.end, filed: inputs.map(item => item.filed).filter(Boolean).sort().at(-1) || null, url: inputs[0]?.url || null, derived: true, formula, basis, inputs };
}

export function normalizeQuarterlyHistory(facts, cik, { limit = 4, asOf = null } = {}) {
  const safeLimit = Number.isInteger(limit) && limit >= 1 && limit <= 20 ? limit : 4;
  const dateLimit = validDate(asOf) ? asOf : null;
  const rows = Object.fromEntries(Object.keys(TAGS).map(field => [field, rowsFor(facts, field, dateLimit)]));
  const candidates = Object.fromEntries(Object.keys(TAGS).filter(field => !BALANCE_FIELDS.has(field)).map(field => [field, quarterCandidates(rows[field], cik, field !== 'dilutedEPS')]));
  // Revenue anchors the reporting period. A company with only annual reports
  // has no invented four-quarter series.
  const seen = new Set(), anchors = [];
  for (const row of candidates.revenue.sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed) || Number(b.direct) - Number(a.direct) || a.priority - b.priority)) {
    if (seen.has(row.end)) continue;
    seen.add(row.end); anchors.push(row);
    if (anchors.length >= safeLimit) break;
  }
  const quarters = anchors.reverse().map(anchor => {
    const quarter = { start: anchor.start, end: anchor.end, label: anchor.end, financials: {}, metrics: {}, evidence: {} };
    for (const field of Object.keys(TAGS)) {
      const row = BALANCE_FIELDS.has(field) ? rows[field].filter(item => !item.start && item.end === quarter.end).sort(byFreshness)[0] : pickQuarter(candidates[field], quarter.start, quarter.end);
      quarter.financials[field] = row?.val ?? null;
      if (row) quarter.evidence[field] = row.evidence || source(row, cik);
    }
    const f = quarter.financials, e = quarter.evidence;
    const derive = (field, value, fields, formula) => { f[field] = value; e[field] = derivedEvidence(value, quarter, fields.map(key => e[key]).filter(Boolean), formula); };
    if (!finite(f.grossProfit) && finite(f.revenue) && finite(f.costOfRevenue)) derive('grossProfit', f.revenue - f.costOfRevenue, ['revenue', 'costOfRevenue'], '분기 매출 − 분기 매출원가');
    if (finite(f.operatingCashFlow) && finite(f.capex) && f.capex >= 0) derive('freeCashFlow', f.operatingCashFlow - f.capex, ['operatingCashFlow', 'capex'], '분기 영업현금흐름 − 분기 설비·생산자산 취득액');
    else f.freeCashFlow = null;
    const priorEquity = rows.equity.filter(row => !row.start && row.end < quarter.start && days(row.end, quarter.end) >= 66 && days(row.end, quarter.end) <= 111).sort((a, b) => b.end.localeCompare(a.end) || byFreshness(a, b))[0];
    f.priorEquity = priorEquity?.val ?? null;
    if (priorEquity) e.priorEquity = source(priorEquity, cik);
    const metric = (key, value, fields, formula, basis) => {
      quarter.metrics[key] = finite(value) ? value : null;
      if (finite(value)) e[key] = derivedEvidence(value, quarter, fields.map(field => e[field]).filter(Boolean), formula, basis);
    };
    metric('eps', f.dilutedEPS, ['dilutedEPS'], '분기 공시 희석 EPS', '개별 분기 공시 (연간·TTM EPS와 별도)');
    if (e.dilutedEPS) e.eps = e.dilutedEPS;
    metric('fcf', f.freeCashFlow, ['freeCashFlow'], '분기 영업현금흐름 − 분기 설비·생산자산 취득액', '개별 분기 현금흐름 대용치 (연간 값과 별도)');
    for (const [key, numerator] of [['grossMargin', 'grossProfit'], ['operatingMargin', 'operatingIncome'], ['netMargin', 'netIncome']]) metric(key, f.revenue > 0 && finite(f[numerator]) ? f[numerator] / f.revenue * 100 : null, [numerator, 'revenue'], `분기 ${numerator} ÷ 분기 매출 × 100`, '개별 분기 수익률 (연간·TTM과 별도)');
    const averageEquity = finite(f.equity) && finite(f.priorEquity) ? (f.equity + f.priorEquity) / 2 : null;
    metric('roe', averageEquity > 0 && finite(f.netIncome) ? f.netIncome / averageEquity * 4 * 100 : null, ['netIncome', 'equity', 'priorEquity'], '분기 순이익 ÷ 기초·기말 평균자본 × 4 × 100', '분기 ROE 연율화 (최근 12개월 실제 ROE와 별도)');
    // Quarter-end historical prices/split-adjusted EPS are needed for these;
    // current price is intentionally not backfilled into prior quarters.
    for (const key of ['per', 'psr', 'arr', 'forwardPE', 'beta']) quarter.metrics[key] = null;
    if (String(Number(cik)) === '1878848' && e.grossMargin) e.grossMargin.basis = '감가상각·상각 제외 직접원가 차감잔액률 (표준 매출총이익률 아님)';
    return quarter;
  });
  const keys = [...new Set([...Object.keys(TAGS), 'freeCashFlow', 'eps', 'fcf', 'grossMargin', 'operatingMargin', 'netMargin', 'roe', 'per', 'psr', 'arr', 'forwardPE', 'beta'])];
  const metricSeries = Object.fromEntries(keys.map(key => [key, quarters.map(quarter => {
    const value = Object.hasOwn(quarter.metrics, key) ? quarter.metrics[key] : quarter.financials[key];
    return { periodType:['per','psr','epsTTM'].includes(key)?'ttm':key==='roe'?'annualized-quarter':'quarter',periodEnd: quarter.end, periodStart: quarter.start, label: quarter.label, value: finite(value) ? value : null, status: finite(value) ? 'available' : 'unavailable', source: quarter.evidence[key] || null };
  })]));
  return { status: quarters.length ? quarters.length === safeLimit ? 'available' : 'partial' : 'unavailable', currency: 'USD', quarters, metricSeries, limitations: ['분기는 SEC 표준 USD 태그의 개별 기간 또는 동일 회계연도 누적액 차이에서 구합니다. 연간 값은 분기로 나누지 않습니다.', '누적 EPS 차이는 희석 가중평균 주식 수의 차이로 부정확할 수 있어 사용하지 않습니다. PER·PSR·ARR의 과거 값은 별도 시점 자료가 없으면 비워 둡니다.', ...(quarters.length < safeLimit ? [`요청한 ${safeLimit}개 중 확인된 개별 분기는 ${quarters.length}개입니다. 외국기업의 연간 공시만 있거나 표준 분기 태그가 없으면 추가 분기 자료가 필요합니다.`] : [])] };
}

/** Join provider closing prices only when split-event coverage is explicit. */
export function attachHistoricalValuations(history, priceHistory, { limit = 4 } = {}) {
  const quarters = (history?.quarters || []).map(quarter => ({ ...quarter, financials: { ...quarter.financials }, metrics: { ...quarter.metrics }, evidence: { ...quarter.evidence }, metricReasons: {} }));
  const rawPoints = priceHistory?.points || priceHistory?.prices || priceHistory?.observations || [];
  const points = (Array.isArray(rawPoints) ? rawPoints : []).map(point => ({ ...point, date: point.date?.slice?.(0, 10) || point.time?.slice?.(0, 10), close: point.close })).filter(point => validDate(point.date) && finite(point.close) && point.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  const splitCoverage = Array.isArray(priceHistory?.splits) || priceHistory?.splitEventsAvailable === true;
  const splits = (priceHistory?.splits || []).map(item => ({ ...item, date: item.date?.slice?.(0, 10) })).filter(item => validDate(item.date));
  for (let i = 0; i < quarters.length; i++) {
    const quarter = quarters[i], lastFour = quarters.slice(Math.max(0, i - 3), i + 1), consecutive = lastFour.length === 4 && lastFour.every((item, j) => !j || nextDay(lastFour[j - 1].end) === item.start);
    const quote = points.filter(point => point.date <= quarter.end && days(point.date, quarter.end) <= 7).at(-1);
    const commonReason = priceHistory?.currency && priceHistory.currency !== 'USD' ? '달러 재무와 같은 USD 과거 시세가 아닙니다.' : !quote ? '분기말 7일 이내의 실제 종가를 확인하지 못했습니다.' : !splitCoverage ? '과거 주식분할 내역의 확인 범위가 없어 종가와 공시 EPS·주식 수의 기준 일치를 확인하지 못했습니다.' : splits.some(split => split.date > quote.date) ? '분기말 이후 주식분할이 있어 과거 종가와 재작성 EPS·주식 수의 기준 일치를 확인하지 못했습니다.' : !consecutive ? '같은 회계 기준으로 연속된 최근 4개 분기가 필요합니다.' : null;
    const closeLabel = priceHistory?.closeBasis === 'split-adjusted' ? '제공자가 주식분할을 조정한 종가 (배당·분배금 추가 조정 전)' : '제공자 종가 (주식분할 조정 기준 확인 필요)';
    const priceSource = quote ? { ...(priceHistory.source || {}), provider: priceHistory.source?.provider || priceHistory.provider || 'Yahoo Finance', url: priceHistory.source?.url || priceHistory.sourceUrl || null, value: quote.close, asOf: quote.date, field: 'historical.close', unit: 'USD', basis: `분기말 또는 직전 거래일 ${closeLabel}; 사후 공시와 비교한 회고 계산` } : null;
    const set = (key, value, inputs, formula, reason) => {
      quarter.metrics[key] = finite(value) ? value : null;
      if (finite(value)) quarter.evidence[key] = { ...derivedEvidence(value, quarter, inputs, formula, `분기말 ${closeLabel}와 해당 분기까지 TTM 공시의 회고 계산 (사후 공시 포함)`), unit: '배', marketSource: priceSource };
      else quarter.metricReasons[key] = reason;
    };
    const eps = consecutive && lastFour.every(item => finite(item.metrics.eps)) ? lastFour.reduce((sum, item) => sum + item.metrics.eps, 0) : null;
    const revenue = consecutive && lastFour.every(item => finite(item.financials.revenue)) ? lastFour.reduce((sum, item) => sum + item.financials.revenue, 0) : null;
    if (finite(eps)) {
      quarter.metrics.epsTTM = eps;
      quarter.evidence.epsTTM = { ...derivedEvidence(eps, quarter, lastFour.map(item => item.evidence.eps), '최근 4개 개별 분기 희석 EPS 합계', '개별 분기 공시 EPS의 최근 12개월 합계; 보고서의 연간 가중평균 EPS와 차이 가능'), unit: 'USD/주' };
    } else quarter.metrics.epsTTM = null;
    set('per', !commonReason && eps > 0 ? quote.close / eps : null, [priceSource, ...lastFour.map(item => item.evidence.eps)].filter(Boolean), '분기말 종가 ÷ 최근 4개 개별 분기 희석 EPS 합계', commonReason || (finite(eps) && eps <= 0 ? '최근 4개 분기 EPS 합계가 0 이하라 PER은 N/M입니다.' : '최근 4개 개별 분기 희석 EPS를 모두 확인하지 못했습니다.'));
    set('psr', !commonReason && revenue > 0 && quarter.financials.shares > 0 ? quote.close * quarter.financials.shares / revenue : null, [priceSource, quarter.evidence.shares, ...lastFour.map(item => item.evidence.revenue)].filter(Boolean), '분기말 종가 × 분기말 실제 발행주식 수 ÷ 최근 4개 분기 매출', commonReason || (!(revenue > 0) ? '최근 4개 분기의 양수 매출 합계를 확인하지 못했습니다.' : '분기말 실제 발행주식 수를 확인하지 못했습니다.'));
    if (quote && (!priceHistory.currency || priceHistory.currency === 'USD')) {
      quarter.metrics.price = quote.close; quarter.evidence.price = priceSource;
      if (splitCoverage && !splits.some(split => split.date > quote.date) && quarter.financials.shares > 0) { quarter.metrics.marketCap = quote.close * quarter.financials.shares; quarter.evidence.marketCap = { ...derivedEvidence(quarter.metrics.marketCap, quarter, [priceSource, quarter.evidence.shares].filter(Boolean), '분기말 종가 × 분기말 실제 발행주식 수', '분기말 공시 주식 수를 사용한 사후 시가총액 근사치'), unit: 'USD' }; }
    }
  }
  const selected = quarters.slice(-(Number.isInteger(limit) && limit >= 1 && limit <= 20 ? limit : 4));
  const keys = [...new Set([...Object.keys(history?.metricSeries || {}),...quarters.flatMap(q=>[...Object.keys(q.financials||{}),...Object.keys(q.metrics||{})]), 'per', 'psr', 'epsTTM', 'price', 'marketCap'])];
  const metricSeries = Object.fromEntries(keys.map(key => [key, selected.map(quarter => {
    const value = Object.hasOwn(quarter.metrics, key) ? quarter.metrics[key] : quarter.financials[key], reason = quarter.metricReasons[key] || null;
    return { periodType:['per','psr','epsTTM'].includes(key)?'ttm':key==='roe'?'annualized-quarter':'quarter',periodEnd: quarter.end, periodStart: quarter.start, label: quarter.label, value: finite(value) ? value : null, status: finite(value) ? 'available' : reason?.includes('N/M') ? 'not-meaningful' : 'unavailable', source: quarter.evidence[key] || null, reason };
  })]));
  return { ...history, status: selected.length ? selected.length === limit ? 'available' : 'partial' : 'unavailable', quarters: selected, metricSeries, limitations: [...(history?.limitations || []), '과거 PER·PSR은 분기말 실제 종가와 사후 발표된 해당 분기까지의 실적을 비교한 회고 계산이며, 당시 알려진 정보만 사용하는 투자성과가 아닙니다. 분할 기준이 확인되지 않으면 계산하지 않습니다.'] };
}
