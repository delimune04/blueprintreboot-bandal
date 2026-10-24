// Numerical reading of already-normalized public disclosures. This is a
// deterministic calculation, not runtime AI or an investment recommendation.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : null;
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
const percent = value => `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(value)}%`;
const number = value => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(value);
function money(value) {
  const absolute = Math.abs(value);
  if (absolute >= 1e12) return `$${number(value / 1e12)}조`;
  if (absolute >= 1e9) return `$${number(value / 1e9)}B`;
  if (absolute >= 1e6) return `$${number(value / 1e6)}M`;
  return `$${number(value)}`;
}
function sourceIsUsable(source, value, unit = 'USD') {
  if (!source || !finite(value) || typeof source.provider !== 'string' || !source.provider.trim()) return false;
  let url; try { url = new URL(source.url || source.sourceUrl); } catch { return false; }
  if (url.protocol !== 'https:' || (source.unit || source.currency) !== unit) return false;
  // A stale source reference cannot silently validate a different number.
  return finite(source.value) && Math.abs(source.value - value) <= Math.max(1e-9, Math.abs(value) * 1e-12);
}
function dateOf(source) { return day(source?.end || source?.periodEnd || source?.asOf?.slice?.(0, 10)); }
function samePeriod(sources, { duration = true } = {}) {
  if (!sources.length || sources.some(source => !dateOf(source))) return false;
  const ends = new Set(sources.map(dateOf));
  if (ends.size !== 1) return false;
  return !duration || sources.every(source => day(source.start)) && new Set(sources.map(source => source.start)).size === 1;
}
const annualPeriod = source => day(source?.start) && dateOf(source) && days(source.start, dateOf(source)) >= 330 && days(source.start, dateOf(source)) <= 400;
const quarterPeriod = row => day(row?.start) && day(row?.end) && days(row.start, row.end) >= 65 && days(row.start, row.end) <= 110;
function combined(value, unit, inputs, formula, period, basis) {
  return { provider: '공개 공시 수치에서 계산', value, unit, url: inputs[0].url || inputs[0].sourceUrl, start: period?.start || null, end: period?.end || dateOf(inputs[0]), asOf: period?.end || dateOf(inputs[0]), filed: inputs.map(source => source.filed).filter(Boolean).sort().at(-1) || null, derived: true, basis, formula, inputs };
}

export function buildFinancialInsights(payload = {}) {
  const f = payload.financials || {}, evidence = payload.evidence || {}, period = payload.period;
  const summary = [], financialHighlights = [], checks = {};
  const annualHistory = (Array.isArray(payload.annualHistory) ? payload.annualHistory : Array.isArray(payload.history) ? payload.history : []).filter(annualPeriod).sort((a, b) => a.end.localeCompare(b.end));
  const quarterHistory = payload.quarterlyHistory?.quarters || (Array.isArray(payload.history?.quarters) ? payload.history.quarters : []);
  const quarters = [...quarterHistory].filter(quarterPeriod).sort((a, b) => a.end.localeCompare(b.end));
  const add = (key, label, text, value, unit, source, { highlight = true } = {}) => {
    summary.push({ key, label, text, source, kind: 'derived-fact' });
    if (highlight) financialHighlights.push({ key, label, value, unit, period: { start: source.start || null, end: source.end || source.asOf || null }, source, kind: 'derived-fact' });
    checks[key] = { state: 'available' };
  };
  const unavailable = (key, reason) => { checks[key] = { state: 'unavailable', reason }; };
  const rowRevenueIsProven = row => sourceIsUsable(row?.source, row?.revenue) && row.source.start === row.start && dateOf(row.source) === row.end;
  const annualCurrent = period && annualHistory.find(row => row.start === period.start && row.end === period.end);
  const currentRevenue = annualCurrent && rowRevenueIsProven(annualCurrent) ? annualCurrent : sourceIsUsable(evidence.revenue, f.revenue) && annualPeriod(period) && evidence.revenue.start === period.start && dateOf(evidence.revenue) === period.end ? { ...period, revenue: f.revenue, source: evidence.revenue } : null;
  const previousRevenue = currentRevenue && annualHistory.filter(row => row.end < currentRevenue.end && days(row.end, currentRevenue.end) >= 330 && days(row.end, currentRevenue.end) <= 400 && row.revenue > 0 && rowRevenueIsProven(row)).at(-1);
  if (currentRevenue && previousRevenue && currentRevenue.revenue >= 0) {
    const value = (currentRevenue.revenue / previousRevenue.revenue - 1) * 100;
    const source = combined(value, '%', [currentRevenue.source, previousRevenue.source], '(당기 연간 매출 ÷ 전기 연간 매출 − 1) × 100', currentRevenue, '연속 연간 공시 매출 비교');
    add('annualRevenueGrowth', '연간 매출 변화', `${currentRevenue.end} 종료 연간 매출은 ${money(currentRevenue.revenue)}로, ${previousRevenue.end} 종료 연간 ${money(previousRevenue.revenue)} 대비 ${percent(Math.abs(value))} ${value >= 0 ? '증가' : '감소'}했습니다.`, value, '%', source);
  } else unavailable('annualRevenueGrowth', '출처와 통화가 확인된 연속 연간 매출이 두 기간 필요합니다.');

  if (f.revenue > 0 && sourceIsUsable(evidence.revenue, f.revenue) && sourceIsUsable(evidence.operatingIncome, f.operatingIncome) && annualPeriod(evidence.revenue) && samePeriod([evidence.revenue, evidence.operatingIncome])) {
    const value = f.operatingIncome / f.revenue * 100, source = combined(value, '%', [evidence.operatingIncome, evidence.revenue], '연간 영업손익 ÷ 같은 기간 매출 × 100', { start: evidence.revenue.start, end: dateOf(evidence.revenue) }, '동일 기간 연간 공시');
    add('annualOperatingMargin', '연간 영업이익률', `${source.end} 종료 연간 매출 ${money(f.revenue)}와 영업${f.operatingIncome >= 0 ? '이익' : '손실'} ${money(Math.abs(f.operatingIncome))}에 따른 영업이익률은 ${percent(value)}입니다.`, value, '%', source);
  } else unavailable('annualOperatingMargin', '매출과 영업손익의 출처·기간·통화가 일치하지 않습니다.');

  const latest = quarters.at(-1), priorQuarter = latest && quarters.filter(row => days(row.end, latest.end) >= 330 && days(row.end, latest.end) <= 400 && Math.abs(days(row.start, row.end) - days(latest.start, latest.end)) <= 10).at(-1);
  function quarterMargin(quarter) {
    const qf = quarter?.financials || {}, qe = quarter?.evidence || {};
    if (!(qf.revenue > 0) || !sourceIsUsable(qe.revenue, qf.revenue) || !sourceIsUsable(qe.operatingIncome, qf.operatingIncome) || qe.revenue.start !== quarter.start || dateOf(qe.revenue) !== quarter.end || !samePeriod([qe.revenue, qe.operatingIncome])) return null;
    const value = qf.operatingIncome / qf.revenue * 100;
    return { value, source: combined(value, '%', [qe.operatingIncome, qe.revenue], '개별 분기 영업손익 ÷ 같은 분기 매출 × 100', quarter, '개별 분기 공시') };
  }
  const latestMargin = quarterMargin(latest), previousMargin = quarterMargin(priorQuarter);
  if (latestMargin) {
    let text = `${latest.start}~${latest.end} 개별 분기 영업이익률은 ${percent(latestMargin.value)}입니다.`, source = latestMargin.source;
    if (previousMargin) {
      const delta = latestMargin.value - previousMargin.value;
      text += ` 전년 동기 ${percent(previousMargin.value)} 대비 ${number(Math.abs(delta))}%p ${delta >= 0 ? '상승' : '하락'}했습니다.`;
      source = { ...source, comparisons: [{ value: previousMargin.value, source: previousMargin.source }], changePercentagePoints: delta };
    }
    add('quarterOperatingMargin', '최근 분기 수익성', text, latestMargin.value, '%', source);
    checks.quarterOperatingMarginYoY = previousMargin ? { state: 'available' } : { state: 'unavailable', reason: '같은 길이의 전년 동기 분기 매출·영업손익을 모두 확인하지 못했습니다.' };
  } else unavailable('quarterOperatingMargin', '출처가 확인된 최근 개별 분기 매출과 영업손익이 필요합니다.');

  const cashInputs = [evidence.operatingCashFlow, evidence.capex];
  if (sourceIsUsable(evidence.operatingCashFlow, f.operatingCashFlow) && sourceIsUsable(evidence.capex, f.capex) && f.capex >= 0 && annualPeriod(evidence.operatingCashFlow) && samePeriod(cashInputs)) {
    const value = f.operatingCashFlow - f.capex, source = combined(value, 'USD', cashInputs, '동일 기간 영업현금흐름 − 설비·생산자산 취득 지출', { start: evidence.operatingCashFlow.start, end: dateOf(evidence.operatingCashFlow) }, '공시 현금흐름 대용치; 엄밀한 FCFF·FCFE 아님');
    let text = `${source.end} 종료 연간 영업현금흐름은 ${money(f.operatingCashFlow)}, 설비·생산자산 취득 지출은 ${money(f.capex)}로 차감 후 ${money(value)}입니다.`;
    if (f.operatingCashFlow > 0) text += ` 투자 지출은 영업현금흐름의 ${percent(f.capex / f.operatingCashFlow * 100)}입니다.`;
    add('cashAfterInvestment', '현금 창출과 투자', text, value, 'USD', source);
    if (f.operatingCashFlow > 0) financialHighlights.push({ key: 'capexBurden', label: '투자 지출 / 영업현금흐름', value: f.capex / f.operatingCashFlow * 100, unit: '%', period: { start: source.start, end: source.end }, source: combined(f.capex / f.operatingCashFlow * 100, '%', cashInputs, '설비·생산자산 취득 지출 ÷ 같은 기간 영업현금흐름 × 100', source, '같은 기간 현금흐름'), kind: 'derived-fact' });
  } else unavailable('cashAfterInvestment', '같은 기간·통화의 영업현금흐름과 음수가 아닌 투자 지출이 필요합니다.');

  const balanceFields = [['assets', '총자산'], ['liabilities', '총부채'], ['equity', '자기자본']];
  const balances = balanceFields.filter(([key]) => sourceIsUsable(evidence[key], f[key]) && dateOf(evidence[key]));
  if (balances.length && samePeriod(balances.map(([key]) => evidence[key]), { duration: false })) {
    const source = combined(null, 'USD', balances.map(([key]) => evidence[key]), '공시 재무상태표 항목 나란히 표시; 차입금과 총부채는 별도', { end: dateOf(evidence[balances[0][0]]) }, '동일 결산일 재무상태표');
    add('balanceSheet', '재무상태 규모', `${source.end} 기준 ${balances.map(([key, label]) => `${label} ${money(f[key])}`).join(', ')}입니다.`, null, 'USD', source, { highlight: false });
    for (const [key, label] of balances) financialHighlights.push({ key, label, value: f[key], unit: 'USD', period: { start: null, end: dateOf(evidence[key]) }, source: evidence[key], kind: 'derived-fact' });
  } else unavailable('balanceSheet', '같은 결산일의 출처가 확인된 자산·총부채·자기자본을 찾지 못했습니다.');

  // A liability total is never substituted for interest-bearing borrowings.
  // Do not mix annual SEC cash with a later Yahoo debt figure.
  const borrowingScope = evidence.debt?.tag === 'LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities' || evidence.debt?.scope === 'total-borrowings' || evidence.debt?.field === 'financialData.totalDebt';
  if (borrowingScope && sourceIsUsable(evidence.cash, f.cash) && sourceIsUsable(evidence.debt, f.debt) && f.cash >= 0 && f.debt > 0 && samePeriod([evidence.cash, evidence.debt], { duration: false }) && evidence.cash.provider === evidence.debt.provider) {
    const value = f.cash / f.debt * 100, source = combined(value, '%', [evidence.cash, evidence.debt], '공시 현금및현금성자산 ÷ 같은 결산일 공시 차입금 합계 × 100', { end: dateOf(evidence.cash) }, '공시 차입금 범위에 대한 현금 비율; 상환능력 보장 아님');
    add('cashToBorrowings', '현금과 공시 차입금', `${source.end}의 현금및현금성자산 ${money(f.cash)}는 같은 결산일 공시 차입금 ${money(f.debt)}의 ${percent(value)}입니다. 차입금의 리스 등 포함 범위는 출처 기준입니다.`, value, '%', source);
  } else unavailable('cashToBorrowings', '같은 결산일·제공자·통화의 현금과 명시적 차입금 합계가 모두 필요합니다. 총부채를 차입금으로 대체하지 않습니다.');
  return { summary, financialHighlights, coverage: { status: summary.length ? 'available' : 'unavailable', method: 'source-backed-deterministic-calculations', runtimeAI: false, checks, generatedFrom: payload.asOf || payload.collectedAt || null } };
}
