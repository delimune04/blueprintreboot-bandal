// 전세·월세 실주거비. Pure functions shared by the page and its tests.

/**
 * One option's monthly cost in 원.
 * deposit: 보증금, rent: 월세, maintenance: 관리비, loan: 보증금 중 대출,
 * loanRate: 대출 연 금리(%), savingsRate: 내 돈을 예금했을 때 연 금리(%).
 * cash = 매달 실제로 나가는 돈(월세+관리비+대출이자),
 * total = cash + 내 보증금의 기회비용.
 */
export function monthlyCost({ deposit = 0, rent = 0, maintenance = 0, loan = 0, loanRate = 0, savingsRate = 0 }) {
  const borrowed = Math.min(Math.max(0, loan), Math.max(0, deposit));
  const ownFunds = Math.max(0, deposit - borrowed);
  const interest = (borrowed * loanRate) / 100 / 12;
  const opportunity = (ownFunds * savingsRate) / 100 / 12;
  const cash = rent + maintenance + interest;
  return { ownFunds, borrowed, interest, opportunity, cash, total: cash + opportunity };
}

/** 주택임대차보호법 제7조의2·시행령 제9조: 연 10%와 기준금리+연 2% 중 낮은 비율. */
export function legalCapRate(baseRate) {
  if (!Number.isFinite(baseRate) || baseRate < 0) return null;
  return Math.min(10, baseRate + 2);
}

/** Monthly rent for converting `amount` of deposit at an annual rate (%). */
export const rentForDeposit = (amount, ratePercent) => (Math.max(0, amount) * ratePercent) / 100 / 12;

/** Annual conversion rate (%) implied by two quotes on the same home. */
export function impliedRate(a, b) {
  const depositGap = a.deposit - b.deposit;
  const rentGap = b.rent - a.rent;
  if (!(depositGap !== 0) || !Number.isFinite(depositGap) || !Number.isFinite(rentGap)) return null;
  const rate = (rentGap * 12 * 100) / depositGap;
  return Number.isFinite(rate) ? rate : null;
}
