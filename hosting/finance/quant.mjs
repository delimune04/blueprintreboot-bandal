// Public configurable teaching template. This is not the owner's private Quant engine.
export const DEFAULT_PARAMETERS = Object.freeze({
  lookbackDays: 20, rebalanceDays: 5, momentumThreshold: 0, maxExposure: 0.9,
  defensiveDrawdowns: [0.03, 0.06, 0.09, 0.12, 0.15], feeBps: 15, slippageBps: 5,
});
const invalid = message => { throw Object.assign(new Error(message), { status: 422 }); };
const finite = (value, min, max, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid(`${label} 범위를 확인해 주세요.`);
  return value;
};
export function validateParameters(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('전략 파라미터를 확인해 주세요.');
  const allowed = new Set(Object.keys(DEFAULT_PARAMETERS));
  if (Object.keys(input).some(key => !allowed.has(key))) invalid('지원하지 않는 전략 파라미터예요.');
  const p = { ...DEFAULT_PARAMETERS, ...input };
  finite(p.lookbackDays, 2, 250, '모멘텀 관측일');
  finite(p.rebalanceDays, 1, 30, '리밸런싱 간격');
  if (!Number.isInteger(p.lookbackDays) || !Number.isInteger(p.rebalanceDays)) invalid('관측일과 간격은 정수로 입력해 주세요.');
  finite(p.momentumThreshold, -0.5, 0.5, '절대 모멘텀 기준');
  finite(p.maxExposure, 0, 1, '최대 투자 비중');
  finite(p.feeBps, 0, 100, '수수료');
  finite(p.slippageBps, 0, 100, '슬리피지');
  if (!Array.isArray(p.defensiveDrawdowns) || p.defensiveDrawdowns.length !== 5) invalid('방어 단계는 다섯 개가 필요해요.');
  p.defensiveDrawdowns = p.defensiveDrawdowns.map((n, i, list) => {
    finite(n, 0.001, 0.8, '방어 낙폭');
    if (i && n <= list[i - 1]) invalid('방어 낙폭은 작은 값부터 입력해 주세요.');
    return n;
  });
  return p;
}
export function validatePrices(input, minimum = 5) {
  if (!Array.isArray(input) || input.length < minimum || input.length > 2500) invalid(`가격은 ${minimum}~2,500개가 필요해요.`);
  return input.map((row, i) => {
    if (!row || typeof row !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date || '') ||
        !Number.isFinite(Date.parse(row.date)) || new Date(row.date).toISOString().slice(0, 10) !== row.date ||
        (i && row.date <= input[i - 1].date)) invalid('가격 날짜는 유효한 날짜로 중복 없이 오름차순이어야 해요.');
    return { date: row.date, close: finite(row.close, 0.00000001, 1e12, '종가') };
  });
}
export function simulatePaper(parameters, input) {
  const p = validateParameters(parameters);
  if (!input || typeof input !== 'object') invalid('모의투자 입력을 확인해 주세요.');
  const prices = validatePrices(input.prices, p.lookbackDays + 3);
  const initialCapital = finite(input.initialCapital, 1000, 1e12, '시작 자금');
  const dataLabel = input.dataLabel === 'sample' ? 'sample' : 'uploaded';
  let benchmark = null;
  if (input.benchmark !== undefined) {
    benchmark = validatePrices(input.benchmark, prices.length);
    if (benchmark.length !== prices.length || benchmark.some((row, i) => row.date !== prices[i].date)) invalid('비교 자산의 날짜는 가격 자료와 같아야 해요.');
  }
  let cash = initialCapital, units = 0, peak = initialCapital, pendingTarget = null;
  let previousEquity = initialCapital, maxDrawdown = 0, defenseLevel = 0;
  const feeRate = p.feeBps / 10000, slippage = p.slippageBps / 10000;
  const curve = [], trades = [], returns = [];
  for (let i = 0; i < prices.length; i++) {
    const { date, close } = prices[i];
    // A signal observed at close t is first executed at close t+1.
    // It therefore cannot earn the t->t+1 price move.
    if (pendingTarget !== null) {
      const equity = cash + units * close;
      const desiredUnits = equity * pendingTarget / close;
      const delta = desiredUnits - units;
      if (Math.abs(delta * close) > Math.max(0.01, equity * 0.000001)) {
        if (delta > 0) {
          const executionPrice = close * (1 + slippage);
          const quantity = Math.min(delta, cash / (executionPrice * (1 + feeRate)));
          const notional = quantity * executionPrice, fee = notional * feeRate;
          cash -= notional + fee; units += quantity;
          if (quantity > 0) trades.push({ date, side: 'buy', quantity, price: executionPrice, fee });
        } else {
          const quantity = Math.min(-delta, units), executionPrice = close * (1 - slippage);
          const notional = quantity * executionPrice, fee = notional * feeRate;
          cash += notional - fee; units -= quantity;
          if (quantity > 0) trades.push({ date, side: 'sell', quantity, price: executionPrice, fee });
        }
      }
      pendingTarget = null;
    }
    const equity = cash + units * close;
    peak = Math.max(peak, equity);
    const drawdown = (peak - equity) / peak;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    defenseLevel = p.defensiveDrawdowns.filter(level => drawdown >= level).length;
    if (i) returns.push(equity / previousEquity - 1);
    curve.push({ date, equity, returnPct: (equity / initialCapital - 1) * 100, drawdownPct: drawdown * 100,
      exposure: equity ? units * close / equity : 0, defenseLevel });
    previousEquity = equity;
    if (i >= p.lookbackDays && (i - p.lookbackDays) % p.rebalanceDays === 0) {
      const absolute = close / prices[i - p.lookbackDays].close - 1;
      const relative = benchmark ? benchmark[i].close / benchmark[i - p.lookbackDays].close - 1 : 0;
      const invest = absolute > p.momentumThreshold && absolute > relative;
      pendingTarget = invest ? p.maxExposure * (1 - defenseLevel / 5) : 0;
    }
  }
  const mean = returns.reduce((n, r) => n + r, 0) / returns.length;
  const variance = returns.length > 1 ? returns.reduce((n, r) => n + (r - mean) ** 2, 0) / (returns.length - 1) : 0;
  const volatility = Math.sqrt(variance);
  const finalEquity = curve.at(-1).equity;
  const annualized = (finalEquity / initialCapital) ** (252 / Math.max(1, prices.length - 1)) - 1;
  return {
    type: 'paper', dataLabel, initialCapital, finalEquity,
    totalReturnPct: (finalEquity / initialCapital - 1) * 100, maxDrawdownPct: maxDrawdown * 100,
    annualizedReturnPct: Number.isFinite(annualized) ? annualized * 100 : null,
    volatilityPct: volatility * Math.sqrt(252) * 100,
    sharpe: volatility ? mean / volatility * Math.sqrt(252) : null,
    curve, trades, parametersSnapshot: p,
    methodology: {
      template: 'public-dual-momentum-l1-l5-v1', privateQuantImported: false,
      execution: 'Signal at close t; fractional paper execution at close t+1, fees and slippage included.',
      relativeMomentum: benchmark ? 'uploaded benchmark' : 'zero-return cash',
      annualization: '252 bars/year; meaningful only for daily trading-day inputs',
      limitations: 'User-supplied prices; no dividends, tax, liquidity or FX model. Historical simulation is not broker paper execution or future returns.',
    },
  };
}
export function publicPerformance(run) {
  return {
    type: 'paper', dataLabel: run.dataLabel === 'sample' ? 'sample' : 'uploaded',
    startDate: run.curve[0].date, endDate: run.curve.at(-1).date,
    totalReturnPct: run.totalReturnPct, maxDrawdownPct: run.maxDrawdownPct,
    curve: run.curve.map(point => ({ date: point.date, returnPct: point.returnPct, drawdownPct: point.drawdownPct })),
    disclosure: '사용자가 입력한 가격으로 실행한 과거 모의 계산입니다. 실계좌 수익 인증이 아니며 투자금·전략·계좌는 공개하지 않습니다.',
  };
}
