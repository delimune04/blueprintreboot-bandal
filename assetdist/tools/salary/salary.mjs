// 연봉·월급 실수령액 추정. Pure functions shared by the page and its tests.
// Every rate below carries its basis; the page prints the same notes.

export const RATES = Object.freeze({
  basis: '2026년 7월 이후 급여 기준',
  // 국민연금 9.5%(근로자 4.75%), 기준소득월액 상·하한 2026.7–2027.6
  pension: { rate: 0.0475, min: 410000, max: 6590000 },
  // 건강보험 7.19%(근로자 3.595%), 장기요양 = 건강보험료 × (0.9448% / 7.19%), 약 13.14%
  health: { rate: 0.03595 },
  care: { ofHealth: 0.009448 / 0.0719 },
  // 고용보험 실업급여 근로자 0.9%
  employment: { rate: 0.009 },
  // 지방소득세 = 근로소득세 × 10%
  local: { rate: 0.1 },
  // 소득세법 시행령 별표2 비고 3, 2026. 3. 1. 이후 지급분: 8세 이상 20세 이하 자녀 공제
  child: { one: 20830, two: 45830, extra: 33330 },
});

const floor10 = (value) => Math.floor(value / 10) * 10;

/** Monthly 간이세액 for taxable monthly pay (원), family 1+ (본인 포함), children 8–20. */
export function withholdingTax(table, taxable, family = 1, children = 0, percent = 100) {
  if (!table || !Array.isArray(table.rows)) throw new Error('세액표가 없어요.');
  const people = Math.max(1, Math.floor(family));
  const kids = Math.max(0, Math.min(Math.floor(children), people - 1));
  const column = (count) => {
    const index = Math.min(count, 11) + 1;
    const thousand = taxable / 1000;
    if (thousand < table.rows[0][0]) return 0;
    if (thousand < 10000) {
      const row = table.rows.find((r) => r[0] <= thousand && thousand < r[1]);
      return row ? row[index] : 0;
    }
    const base = table.at10000[index - 2];
    const over = (limit) => taxable - limit;
    if (thousand <= 10000) return base;
    if (thousand <= 14000) return base + over(10000000) * 0.98 * 0.35 + 25000;
    if (thousand <= 28000) return base + 1397000 + over(14000000) * 0.98 * 0.38;
    if (thousand <= 30000) return base + 6610600 + over(28000000) * 0.98 * 0.4;
    if (thousand <= 45000) return base + 7394600 + over(30000000) * 0.4;
    if (thousand <= 87000) return base + 13394600 + over(45000000) * 0.42;
    return base + 31034600 + over(87000000) * 0.45;
  };
  // 비고 4: 11명 초과는 11명 세액에서 (10명 − 11명 세액) × 초과 인원을 뺍니다.
  let tax = people <= 11 ? column(people) : column(11) - (column(10) - column(11)) * (people - 11);
  tax = Math.max(0, tax);
  if (kids > 0) {
    const credit = kids === 1 ? RATES.child.one : RATES.child.two + RATES.child.extra * (kids - 2);
    tax = Math.max(0, tax - credit);
  }
  return floor10(tax * (percent / 100));
}

/**
 * input: { annual | monthly (원), nonTaxable (월, 원), family, children, percent (80|100|120), severanceIncluded }
 * Returns monthly amounts in 원; every deduction is truncated below 10원.
 */
export function calculateSalary(table, input) {
  const months = input.severanceIncluded ? 13 : 12;
  const gross = Math.max(0, Math.floor(input.monthly ?? (input.annual || 0) / months));
  const nonTaxable = Math.max(0, Math.min(Math.floor(input.nonTaxable || 0), gross));
  const taxable = gross - nonTaxable;
  const pensionBase = Math.min(RATES.pension.max, Math.max(RATES.pension.min, Math.floor(taxable / 1000) * 1000));
  const pension = taxable > 0 ? floor10(pensionBase * RATES.pension.rate) : 0;
  const health = floor10(taxable * RATES.health.rate);
  const care = floor10(health * RATES.care.ofHealth);
  const employment = floor10(taxable * RATES.employment.rate);
  const incomeTax = withholdingTax(table, taxable, input.family || 1, input.children || 0, input.percent || 100);
  const localTax = floor10(incomeTax * RATES.local.rate);
  const deductions = pension + health + care + employment + incomeTax + localTax;
  const net = gross - deductions;
  return {
    months, gross, nonTaxable, taxable, pensionBase,
    pension, health, care, employment, incomeTax, localTax,
    deductions, net,
    annualNet: net * 12,
    rate: gross > 0 ? deductions / gross : 0,
  };
}
