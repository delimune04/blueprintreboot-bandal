// Pure, source-independent calculations. All money uses one currency and unit.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const ratio = (a, b) => finite(a) && finite(b) && b > 0 ? a / b : null;

export function calculateMetrics(financials = {}, quote = null) {
  const f = financials;
  const price = finite(quote?.price) && quote.price > 0 ? quote.price : null;
  const marketCap = finite(quote?.marketCap) && quote.marketCap > 0 ? quote.marketCap : null;
  const averageEquity = finite(f.equity) && finite(f.priorEquity) ? (f.equity + f.priorEquity) / 2 : null;
  const metric = (key, label, value, unit, formula, explanation) => ({ key, label, value, unit, formula, explanation, status: value === null ? 'unavailable' : 'calculated' });
  return [
    metric('per', 'PER', finite(quote?.reportedPE) && quote.reportedPE > 0 ? quote.reportedPE : quote?.basisConfirmed === true ? ratio(price, f.dilutedEPS) : null, '배', finite(quote?.reportedPE) ? '시세 제공자의 PERatio (TTM 기준, SEC 연간 EPS와 별도)' : '사용자가 분할 기준을 확인한 주가 ÷ 최근 연간 희석 EPS', '현재 시세 제공자의 TTM 비율을 사용해요. 제공자 없이 과거 EPS와 현재 주가를 임의로 섞지 않아요.'),
    metric('psr', 'PSR', finite(quote?.reportedPS) && quote.reportedPS > 0 ? quote.reportedPS : quote?.basisConfirmed === true ? ratio(marketCap, f.revenue) : null, '배', finite(quote?.reportedPS) ? '시세 제공자의 PriceToSalesRatioTTM (SEC 연간 매출과 별도)' : '현재 시가총액 ÷ 최근 연간 매출', '제공자의 TTM 매출 기준이에요. 연간 공시 매출로 직접 계산한 값과 다를 수 있어요.'),
    metric('roe', 'ROE', averageEquity > 0 && finite(f.netIncome) ? f.netIncome / averageEquity * 100 : null, '%', '연간 순이익 ÷ 기초·기말 평균 자기자본 × 100', '자기자본으로 얼마나 이익을 냈는지 살펴보는 지표예요. 음수 자기자본에는 적용하지 않아요.'),
    metric('eps', 'EPS', finite(f.dilutedEPS) ? f.dilutedEPS : null, 'USD/주', '공시된 연간 희석 주당순이익', '잠재 주식까지 반영한 주당 이익이에요. 과거 공시 EPS는 현재 주식분할 기준과 다를 수 있어요.'),
    metric('grossMargin', '매출총이익률', ratio(f.grossProfit, f.revenue) === null ? null : f.grossProfit / f.revenue * 100, '%', '매출총이익 ÷ 매출 × 100', '제품·서비스의 직접 원가를 제외한 비율이에요.'),
    metric('operatingMargin', '영업이익률', ratio(f.operatingIncome, f.revenue) === null ? null : f.operatingIncome / f.revenue * 100, '%', '영업이익 ÷ 매출 × 100', '연구개발·판매관리 등 영업비용까지 반영한 수익성이에요.'),
    metric('netMargin', '순이익률', ratio(f.netIncome, f.revenue) === null ? null : f.netIncome / f.revenue * 100, '%', '순이익 ÷ 매출 × 100', '세금과 영업 외 손익까지 반영한 최종 이익 비율이에요.'),
    metric('fcf', '잉여현금흐름 대용치', finite(f.freeCashFlow) ? f.freeCashFlow : null, 'USD', '영업활동 현금흐름 − 설비·생산자산 취득 지출', '생산자산 태그에는 소프트웨어·무형자산이 포함될 수 있어요. 엄밀한 FCFF·FCFE가 아니며 회사별 이자 분류 등에 영향을 받아요.'),
    metric('arr', 'ARR', null, 'USD', '회사가 정의·공시한 연간 반복매출', '일반 매출을 ARR로 바꾸지 않아요. 표준 SEC 전체기업 태그만으로 확인할 수 없어 IR의 정의와 공시를 확인해야 해요.'),
  ];
}

export function buildFinancialFlow(financials = {}, period = null) {
  const f = financials;
  const base = { nodes: [], links: [], currency: 'USD', period, status: 'unavailable', note: '같은 연간 기간의 매출·원가·영업비용·영업이익이 필요해요. 부문별 매출은 별도 IR 공시에서 확인해 주세요.' };
  const values = [f.revenue, f.costOfRevenue, f.grossProfit, f.operatingExpenses, f.operatingIncome];
  if (!values.every(finite) || values.some(value => value < 0) || f.revenue <= 0) return base;
  const tolerance = Math.max(1, f.revenue * 0.00001);
  if (Math.abs(f.revenue - f.costOfRevenue - f.grossProfit) > tolerance || Math.abs(f.grossProfit - f.operatingExpenses - f.operatingIncome) > tolerance) return { ...base, note: '동일 기간 금액의 회계식이 맞지 않아 흐름선을 만들지 않았어요. 원문 공시의 조정 항목을 확인해 주세요.' };
  return {
    ...base, status: 'available',
    nodes: [{ id: 'revenue', label: '매출', value: f.revenue }, { id: 'cost', label: '매출원가', value: f.costOfRevenue }, { id: 'gross', label: '매출총이익', value: f.grossProfit }, { id: 'opex', label: '영업비용', value: f.operatingExpenses }, { id: 'profit', label: '영업이익', value: f.operatingIncome }],
    links: [{ source: 'revenue', target: 'cost', value: f.costOfRevenue }, { source: 'revenue', target: 'gross', value: f.grossProfit }, { source: 'gross', target: 'opex', value: f.operatingExpenses }, { source: 'gross', target: 'profit', value: f.operatingIncome }].filter(link => link.value > 0),
    note: '매출에서 직접 원가와 영업비용을 거쳐 영업이익이 남는 흐름이에요. 영업비용은 총이익−영업이익의 잔여 조정액을 포함할 수 있어요. 입자의 속도는 연출이며 선의 금액을 읽어 주세요. 현금흐름표·부문별 매출과는 구분해요.',
  };
}

export function calculateDCF(input = {}) {
  const { freeCashFlow, growthRate = 0.05, discountRate = 0.1, terminalGrowthRate = 0.02, years = 5, shares, cash = 0, debt = 0, cashFlowType = 'ocf-capex-proxy' } = input;
  if (!finite(freeCashFlow) || freeCashFlow <= 0 || !finite(shares) || shares <= 0) throw new Error('양수 현금흐름과 주식 수를 입력해 주세요.');
  if (![growthRate, discountRate, terminalGrowthRate, cash, debt].every(finite) || growthRate < -0.9 || growthRate > 1 || discountRate <= 0 || discountRate > 0.5 || terminalGrowthRate < -0.1 || terminalGrowthRate >= discountRate || cash < 0 || debt < 0 || !Number.isInteger(years) || years < 1 || years > 15) throw new Error('성장률·할인율·영구성장률·기간을 확인해 주세요. 할인율은 영구성장률보다 커야 해요.');
  if (!['ocf-capex-proxy', 'fcff', 'fcfe'].includes(cashFlowType)) throw new Error('현금흐름의 종류를 확인해 주세요.');
  const forecast = Array.from({ length: years }, (_, i) => { const year = i + 1, cashFlow = freeCashFlow * (1 + growthRate) ** year; return { year, cashFlow, presentValue: cashFlow / (1 + discountRate) ** year }; });
  const terminalValue = forecast.at(-1).cashFlow * (1 + terminalGrowthRate) / (discountRate - terminalGrowthRate);
  const presentValueTerminal = terminalValue / (1 + discountRate) ** years;
  const presentValueForecast = forecast.reduce((total, row) => total + row.presentValue, 0);
  const value = presentValueForecast + presentValueTerminal;
  const enterpriseValue = cashFlowType === 'fcff' ? value : null;
  const equityValue = cashFlowType === 'fcff' ? value + cash - debt : value;
  if (![terminalValue, presentValueTerminal, value, equityValue, equityValue / shares].every(Number.isFinite)) throw new Error('가정에서 계산 가능한 범위를 넘었어요.');
  return { enterpriseValue, equityValue, perShare: equityValue / shares, terminalValue, presentValueTerminal, presentValueForecast, terminalWeight: presentValueTerminal / value, forecast, cashFlowType,
    assumptions: { freeCashFlow, growthRate, discountRate, terminalGrowthRate, years, shares, cash, debt },
    method: cashFlowType === 'fcff' ? '사용자 입력 FCFF → 기업가치 + 현금 − 부채' : cashFlowType === 'fcfe' ? '사용자 입력 FCFE → 자기자본가치 (현금·부채 중복 조정 없음)' : '영업현금흐름−설비투자 대용치의 현재가치 (자기자본 참고값)',
    warnings: cashFlowType === 'ocf-capex-proxy' ? ['영업현금흐름−설비·생산자산 취득액은 엄밀한 FCFF·FCFE가 아니에요. 차입·이자·운전자본·일회성 항목을 검토해야 해요.', '이 대용치에는 현금·부채를 가감하지 않아요. 실제 적정주가나 매수 의견이 아니에요.'] : ['현금흐름 유형에 맞는 할인율과 주식분할 기준을 사용해야 해요. 모든 미래 수치는 사용자 가정이에요.'],
  };
}

export function dcfSensitivity(input) {
  return [-0.02, 0, 0.02].flatMap(discountDelta => [-0.02, 0, 0.02].map(growthDelta => {
    const discountRate = input.discountRate + discountDelta, growthRate = input.growthRate + growthDelta;
    try { return { discountRate, growthRate, perShare: calculateDCF({ ...input, discountRate, growthRate }).perShare }; } catch { return { discountRate, growthRate, perShare: null }; }
  }));
}
