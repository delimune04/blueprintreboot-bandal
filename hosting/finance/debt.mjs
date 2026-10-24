// Public SEC debt disclosure reader. Never consumes private ledger/broker data.
// Unknown fields remain null; a successful parse is not a completeness claim.
const MAX_FILING = 12 * 1024 * 1024;
const MAX_PACK = 220000;
const tickerOK = value => typeof value === 'string' && /^[A-Z0-9.-]{1,12}$/.test(value);
const cikOK = value => /^\d{1,10}$/.test(String(value)) && Number(value) > 0;
const dateOK = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clean = (value, limit = 500) => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : null;
const decode = value => value.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => { const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; }).replaceAll('&nbsp;', ' ').replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
const plain = value => clean(decode(value.replace(/<[^>]*>/g, ' ')), 1200);
function attributes(value) { const out = {}; for (const m of value.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)) out[m[1].toLowerCase()] = decode(m[2]); return out; }

export function safeDebtFilingUrl(value, cik) {
  if (!cikOK(cik) || typeof value !== 'string') return null;
  try {
    const u = new URL(value), match = /^\/Archives\/edgar\/data\/(\d{1,10})\/(\d{18})\/([A-Za-z0-9_.-]{1,150}\.html?)$/.exec(u.pathname);
    if (u.protocol !== 'https:' || u.hostname !== 'www.sec.gov' || u.username || u.password || u.port || u.search || !match || Number(match[1]) !== Number(cik)) return null;
    u.hash = ''; return u.href;
  } catch { return null; }
}
const safeFactsSource = (value, cik) => value === `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`;

const FACTS = [
  ['debtTotal', '장기 차입금 장부금액 (유동 포함·태그 범위 확인)', ['LongTermDebtAndFinanceLeaseObligationsIncludingCurrentMaturities', 'LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities', 'LongTermDebtCurrentAndNoncurrent', 'LongTermDebt'], 'instant'],
  ['shortTerm', '단기 차입금', ['ShortTermBorrowings', 'ShortTermDebtCurrent', 'CommercialPaper', 'CurrentBorrowings'], 'instant'],
  ['currentPortion', '장기 차입금의 유동 부분', ['LongTermDebtCurrent', 'LongTermDebtAndCapitalLeaseObligationsCurrent', 'CurrentPortionOfNoncurrentBorrowings'], 'instant'],
  ['longTerm', '비유동 장기 차입금', ['LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations', 'NoncurrentBorrowings'], 'instant'],
  ['convertible', '전환사채 장부금액', ['ConvertibleNotesPayable', 'ConvertibleNotesPayableCurrent', 'ConvertibleLongTermNotesPayable', 'ConvertibleBonds'], 'instant'],
  ['commercialPaper', '기업어음 잔액', ['CommercialPaper'], 'instant'],
  ['financeLeases', '금융리스 부채', ['FinanceLeaseLiability', 'CapitalLeaseObligations'], 'instant'],
  ['operatingLeases', '운용리스 부채', ['OperatingLeaseLiability'], 'instant'],
  ['debtIssuanceCosts', '미상각 발행비용·할인', ['DebtInstrumentUnamortizedDiscount', 'LongTermDebtUnamortizedDebtIssuanceExpense', 'DebtInstrumentUnamortizedDiscountAndDebtIssuanceCosts'], 'instant'],
  ['interestExpense', '공개된 연간 이자비용', ['InterestAndDebtExpense', 'InterestExpense', 'InterestExpenseNonOperating', 'FinanceCosts'], 'annual'],
  ['proceeds', '공개된 연간 차입 조달액', ['ProceedsFromIssuanceOfLongTermDebt', 'ProceedsFromDebtNetOfIssuanceCosts', 'ProceedsFromBorrowings'], 'annual'],
  ['repayments', '공개된 연간 차입 상환액', ['RepaymentsOfLongTermDebt', 'RepaymentsOfLongTermDebtAndCapitalSecurities', 'RepaymentsOfBorrowings'], 'annual'],
];
const MATURITIES = [
  ['next12Months', '향후 12개월', ['LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths', 'LongTermDebtMaturitiesRepaymentsOfPrincipalInYearOne']],
  ['year2', '2년 차', ['LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo']],
  ['year3', '3년 차', ['LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree']],
  ['year4', '4년 차', ['LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFour']],
  ['year5', '5년 차', ['LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFive']],
  ['thereafter', '5년 이후', ['LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive']],
];

/** Standardized companyfacts never supplies dimensional instrument terms. */
export function normalizeDebtFacts(facts, cik, asOf = new Date().toISOString()) {
  if (!cikOK(cik) || String(Number(facts?.cik)) !== String(Number(cik)) || !Number.isFinite(Date.parse(asOf))) throw new Error('DEBT_FACT_IDENTITY');
  const cutoff = asOf.slice(0, 10), sourceURL = `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`;
  function latest(tags, basis = 'instant') {
    // Prefer the newest reported period; the tag order breaks same-period ties.
    const options = [];
    for (const [rank, tag] of tags.entries()) for (const namespace of ['us-gaap', 'ifrs-full']) {
      for (const row of facts.facts?.[namespace]?.[tag]?.units?.USD || []) {
        if (!finite(row.val) || row.val < 0 || !dateOK(row.end) || row.end > cutoff || !dateOK(row.filed) || row.filed > cutoff || !['10-K', '10-K/A', '10-Q', '10-Q/A', '20-F', '20-F/A', '40-F', '40-F/A'].includes(row.form)) continue;
        const days = dateOK(row.start) ? (Date.parse(row.end) - Date.parse(row.start)) / 86400000 + 1 : null;
        if (basis === 'instant' && row.start || basis === 'annual' && !(days >= 330 && days <= 400)) continue;
        options.push({ row, rank, tag: namespace + ':' + tag });
      }
    }
    options.sort((a, b) => b.row.end.localeCompare(a.row.end) || b.row.filed.localeCompare(a.row.filed) || a.rank - b.rank);
    if (!options.length) return null;
    const { row, tag } = options[0], accn = /^\d{10}-\d{2}-\d{6}$/.test(row.accn || '') ? row.accn : null;
    return { value: row.val, currency: 'USD', periodEnd: row.end, source: { provider: 'SEC companyfacts', url: sourceURL, tag, unit: 'USD', start: row.start || null, end: row.end, filed: row.filed, accession: accn, basis: basis === 'annual' ? '연간 현금흐름·비용' : '보고일 잔액', retrievedAt: asOf } };
  }
  const items = FACTS.map(([key, label, tags, basis]) => { const item = latest(tags, basis); return { key, label, ...(item || { value: null, currency: 'USD', source: null }), status: item ? 'available' : 'not-disclosed-in-standard-tags' }; });
  const latestBalanceDate = items.filter(item => item.source && !item.source.start).map(item => item.periodEnd).sort().at(-1);
  for (const item of items) if (item.source) { item.stale = !!latestBalanceDate && Date.parse(latestBalanceDate) - Date.parse(item.periodEnd) > 400 * 86400000; if (item.stale) item.status = 'historical-only'; }
  const summary = Object.fromEntries(items.map(item => [item.key, item]));
  // Do not add different dates, overlapping tags, lease-inclusive debt or short-term notes.
  if (!summary.debtTotal.source && summary.currentPortion.source && summary.longTerm.source && summary.currentPortion.periodEnd === summary.longTerm.periodEnd && !/Lease/.test(summary.longTerm.source.tag)) {
    const a = summary.currentPortion, b = summary.longTerm;
    summary.debtTotal = { key: 'debtTotal', label: '장기 차입금 합계 (유동+비유동)', value: a.value + b.value, currency: 'USD', periodEnd: a.periodEnd, status: 'derived', source: { ...a.source, formula: 'currentPortion + longTerm; excludes separately disclosed short-term borrowings', inputs: [a.source, b.source], basis: '동일 보고일 장기 차입금 합산' } };
  }
  const maturities = MATURITIES.map(([key, label, tags]) => ({ key, label, ...(latest(tags) || { value: null, currency: 'USD', source: null }) }));
  return { status: items.some(item => item.source) ? 'partial' : 'unavailable', summary, instruments: [], maturities, sources: items.filter(item => item.source).map(item => item.source), coverage: { mode: 'standard-sec-facts', completeness: 'partial', reason: '표준 XBRL 차입·리스·만기 태그를 읽었습니다. 회사별 주석·계약의 모든 조건을 포함하는 것은 아니며, 미공개와 수집 실패는 별도로 표시합니다.', instrumentDetails: 'not-yet-read', missingFields: ['개별 대주', '담보', '약정', '전환·상환 세부조건'] }, asOf };
}

const TERM_TAGS = {
  DebtInstrumentFaceAmount: 'principal', DebtInstrumentCarryingAmount: 'carryingAmount', LongTermDebt: 'carryingAmount', LongTermDebtCurrent: 'currentPortion', LongTermDebtNoncurrent: 'noncurrentPortion',
  DebtInstrumentInterestRateStatedPercentage: 'couponRate', DebtInstrumentInterestRateEffectivePercentage: 'effectiveRate', DebtInstrumentConvertibleConversionPrice1: 'conversionPrice',
  DebtInstrumentConvertibleConversionRate: 'conversionRate', DebtInstrumentMaturityDate: 'maturity', DebtInstrumentMaturityDate1: 'maturity', DebtInstrumentDateOfIssuance: 'issuedAt', DebtInstrumentIssuanceDate: 'issuedAt',
  DebtInstrumentUnamortizedDiscountAndDebtIssuanceCosts: 'issuanceCosts', DebtInstrumentUnamortizedDiscount: 'issuanceCosts',
  DebtInstrumentUnamortizedDiscountPremiumAndDebtIssuanceCostsNet: 'issuanceCosts', DebtInstrumentUnusedBorrowingCapacityAmount: 'undrawnCapacity', DebtInstrumentBasisSpreadOnVariableRate1: 'spreadRate',
};
const instrumentKey = member => {
  // Issuers sometimes alternate singular/plural or Jun placement between two
  // debt tables. Exact token sets merge those spellings; never merge by year alone.
  const local = member.split(':').pop().replace(/Member$/, '').replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d{4})/g, '$1 $2');
  return member.split(':')[0] + ':' + local.toLowerCase().split(/\s+/).filter(word => word !== 'a').map(word => word === 'notes' ? 'note' : word).sort().join('|');
};

/** Inline XBRL uses DebtInstrumentAxis members to keep one bond's terms together.
 * It deliberately ignores arbitrary prose numbers and unclassified company tags. */
export function extractDebtFiling(html, { cik, url, filedAt, periodEnd, retrievedAt = new Date().toISOString() } = {}) {
  const safeURL = safeDebtFilingUrl(url, cik);
  if (!safeURL || typeof html !== 'string' || html.length > MAX_FILING || !dateOK(periodEnd) || !dateOK(filedAt) || filedAt > retrievedAt.slice(0, 10) || periodEnd > retrievedAt.slice(0, 10)) throw new Error('INVALID_DEBT_FILING');
  const contexts = new Map();
  for (const match of html.matchAll(/<xbrli:context\b([^>]*)>([\s\S]*?)<\/xbrli:context>/gi)) {
    const attr = attributes(match[1]), body = match[2], identifier = /<xbrli:identifier\b[^>]*>(\d+)<\/xbrli:identifier>/i.exec(body)?.[1];
    if (!attr.id || Number(identifier) !== Number(cik)) continue;
    const members = [...body.matchAll(/<xbrldi:explicitMember\b([^>]*)>([^<]+)<\/xbrldi:explicitMember>/gi)].map(m => ({ axis: attributes(m[1]).dimension, member: decode(m[2]) }));
    const debtMember = members.find(m => /(?:DebtInstrument|LongtermDebt|LongTermDebt|DebtAndCapitalLeaseObligations)Axis$/.test(m.axis || ''));
    // Additional dimensions (fair value level, callable/convertible alternative)
    // are distinct bases and must not overwrite the debt's reported principal.
    if (!debtMember || members.some(m => m !== debtMember && !/(?:LegalEntity|LongtermDebtType|LongTermDebtType)Axis$/.test(m.axis || ''))) continue;
    const instant = /<xbrli:instant>([^<]+)<\/xbrli:instant>/i.exec(body)?.[1], end = /<xbrli:endDate>([^<]+)<\/xbrli:endDate>/i.exec(body)?.[1];
    const start = /<xbrli:startDate>([^<]+)<\/xbrli:startDate>/i.exec(body)?.[1];
    if ((!dateOK(instant) && !dateOK(end)) || (instant || end) > periodEnd) continue;
    const legalEntity = members.find(m => /LegalEntityAxis$/.test(m.axis || ''))?.member || null;
    contexts.set(attr.id, { member: debtMember.member, legalEntity, end: instant || end, start: start || null, current: (instant || end) === periodEnd });
    if (contexts.size > 12000) throw new Error('TOO_MANY_DEBT_CONTEXTS');
  }
  const grouped = new Map();
  for (const match of html.matchAll(/<ix:(nonFraction|nonNumeric)\b([^>]*)>/gi)) {
    const a = attributes(match[2]), local = a.name?.split(':').pop(), key = TERM_TAGS[local], ctx = contexts.get(a.contextref);
    if (!key || !ctx || !/^(?:us-gaap|ifrs-full):/.test(a.name || '') || a['xsi:nil'] === 'true') continue;
    // Opening-tag iteration also visits numeric tags inside TextBlock wrappers.
    const contentStart = match.index + match[0].length, contentEnd = html.indexOf(`</ix:${match[1]}>`, contentStart);
    if (contentEnd < contentStart || contentEnd - contentStart > 4000) continue;
    const raw = plain(html.slice(contentStart, contentEnd)); let value;
    if (['maturity', 'issuedAt'].includes(key)) {
      const parsedDate = Date.parse(raw || '');
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw || '') ? raw : Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString() : null;
      value = typeof parsed === 'string' && dateOK(parsed.slice(0, 10)) ? parsed.slice(0, 10) : null;
    } else {
      // Source tags tell units: money, rate fraction and USD/share stay separate.
      if (!/^[\d,.\-+()\s]+$/.test(raw || '') || !/^-?\d{1,2}$/.test(a.scale || '0')) continue;
      value = Number(raw.replace(/[(),\s]/g, '').replace(/^\+/, '')) * 10 ** Number(a.scale || 0);
      if (a.sign === '-' || /^\(/.test(raw)) value = -Math.abs(value);
      if (!finite(value) || value < 0) continue;
      if (['couponRate', 'effectiveRate', 'spreadRate'].includes(key)) {
        // Some issuers tag a displayed percentage at scale=0. The public
        // document's adjacent '%' wins over an inconsistent XBRL scaling tag.
        const suffix = html.slice(contentEnd + `</ix:${match[1]}>`.length, contentEnd + `</ix:${match[1]}>`.length + 100).replace(/<[^>]*>/g, '').trimStart();
        if (suffix.startsWith('%')) value = Number(raw.replace(/[,\s]/g, ''));
        else { if (value > 1) continue; value *= 100; }
        value = Math.round(value * 1e8) / 1e8;
      }
      else if (!/(?:usd|USD|usdPerShare|USDPerShare)/.test(a.unitref || '') && key !== 'conversionRate') continue;
    }
    if (value === null) continue;
    const groupKey = instrumentKey(ctx.member) + ':' + (ctx.legalEntity || 'consolidated');
    if (!grouped.has(groupKey)) grouped.set(groupKey, { member: ctx.member, legalEntity: ctx.legalEntity, records: {} });
    const row = grouped.get(groupKey), existing = row.records[key];
    if (existing && (existing.context.end > ctx.end || existing.context.end === ctx.end && !(local === 'LongTermDebt' && existing.source.tag.endsWith(':DebtInstrumentCarryingAmount')))) continue;
    const source = { provider: 'SEC EDGAR · inline XBRL', url: safeURL + (a.id && /^[\w.-]{1,150}$/.test(a.id) ? '#' + a.id : ''), tag: a.name, context: a.contextref, member: ctx.member, legalEntity: ctx.legalEntity, end: ctx.end, filed: filedAt, retrievedAt, basis: ctx.start ? `${ctx.start} ~ ${ctx.end}` : '보고일 잔액·계약 조건' };
    row.records[key] = { value, source, context: ctx };
    if (grouped.size > 250) throw new Error('TOO_MANY_DEBT_INSTRUMENTS');
  }
  const instruments = [];
  for (const row of grouped.values()) {
    // A historical redemption mentioned in a new filing is not outstanding debt.
    const hasCurrentBalance = ['principal', 'carryingAmount', 'currentPortion', 'noncurrentPortion'].some(key => row.records[key]?.context.current && !row.records[key].context.start);
    if (!hasCurrentBalance) continue;
    const label = row.member.split(':').pop().replace(/Member$/, '').replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
    const fields = Object.fromEntries(Object.entries(row.records).map(([key, record]) => [key, record.value]));
    instruments.push({ id: row.member + (row.legalEntity ? ':' + row.legalEntity : ''), name: clean(label, 200), borrower: row.legalEntity, type: /convert/i.test(row.member) || fields.conversionPrice !== undefined ? '전환사채' : /lease/i.test(row.member) ? '리스' : /revolv|credit|loan|facility/i.test(row.member) ? '차입·신용한도' : '채무 증권', currency: 'USD', ...fields, coupon: fields.couponRate !== undefined ? fields.couponRate + '%' : null, creditor: null, collateral: null, purpose: null, conversionTerms: null, principalBasis: row.records.principal ? 'XBRL 명목 발행·계약액; 잔존 원금·인출액은 별도 확인' : null, balanceConfirmed: false, source: (row.records.carryingAmount || row.records.principal || Object.values(row.records)[0]).source, fieldSources: Object.fromEntries(Object.entries(row.records).map(([key, record]) => [key, record.source])), coverage: 'standard-inline-xbrl-only', missingFields: ['creditor', 'collateral', 'purpose', 'conversionTerms'].filter(key => !fields[key]) });
  }
  return { status: instruments.length ? 'partial' : 'unavailable', instruments, source: { provider: 'SEC EDGAR', url: safeURL, filed: filedAt, end: periodEnd, retrievedAt }, coverage: { mode: 'inline-xbrl-debt-instrument-axis', completeness: 'partial', contextsRead: contexts.size, instrumentsRead: instruments.length, reason: instruments.length ? '공시 본문의 개별 채무 XBRL 태그를 읽었습니다. 표준 태그 없는 계약 조항은 자동 추정하지 않습니다.' : '이 공시에서 현재 잔액이 있는 표준 개별 채무 태그를 찾지 못했습니다. 부채가 없다는 뜻은 아닙니다.' } };
}

export function validateDebtPack(pack, ticker, cik, now = Date.now()) {
  if (!tickerOK(ticker) || pack?.version !== 1 || pack.ticker !== ticker || !cikOK(cik) || Number(pack.cik) !== Number(cik) || !Number.isFinite(Date.parse(pack.asOf)) || Date.parse(pack.asOf) > now + 300000 || !Array.isArray(pack.instruments) || pack.instruments.length > 250 || !Array.isArray(pack.sources) || !pack.sources.length || pack.sources.length > 40 || !pack.coverage || pack.coverage.completeness !== 'partial') throw new Error('INVALID_DEBT_PACK');
  for (const source of pack.sources) if ((!safeDebtFilingUrl(source.url?.split('#')[0], cik) && !safeFactsSource(source.url, cik)) || !dateOK(source.filed) || source.filed > pack.asOf.slice(0, 10) || !Number.isFinite(Date.parse(source.retrievedAt)) || Date.parse(source.retrievedAt) > Date.parse(pack.asOf) + 300000) throw new Error('INVALID_DEBT_SOURCE');
  for (const item of [...Object.values(pack.summary || {}), ...(pack.maturities || [])]) if (!item || typeof item !== 'object' || item.value != null && (!finite(item.value) || item.value < 0) || item.periodEnd && (!dateOK(item.periodEnd) || item.periodEnd > pack.asOf.slice(0, 10)) || item.source && !safeDebtFilingUrl(item.source.url?.split('#')[0], cik) && !safeFactsSource(item.source.url, cik)) throw new Error('INVALID_DEBT_SUMMARY');
  for (const item of pack.instruments) {
    if (!clean(item.name, 250) || item.name.length > 250 || !safeDebtFilingUrl(item.source?.url?.split('#')[0], cik)) throw new Error('INVALID_DEBT_INSTRUMENT');
    for (const key of ['principal', 'carryingAmount', 'capacity', 'couponRate', 'effectiveRate', 'conversionPrice', 'issuanceCosts']) if (item[key] != null && (!finite(item[key]) || item[key] < 0)) throw new Error('INVALID_DEBT_AMOUNT');
    for (const [key, value] of Object.entries(item)) if (typeof value === 'string' && (value.length > 1600 || /[\u0000-\u001f]/.test(value))) throw new Error('INVALID_DEBT_TEXT');
  }
  return pack;
}

async function boundedText(response, maximum) {
  if (!response.ok) { await response.body?.cancel(); throw new Error('DEBT_HTTP_' + response.status); }
  if (Number(response.headers.get('content-length')) > maximum) { await response.body?.cancel(); throw new Error('DEBT_SIZE_LIMIT'); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('DEBT_EMPTY');
  const chunks = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maximum) { await reader.cancel(); throw new Error('DEBT_SIZE_LIMIT'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let p = 0; for (const chunk of chunks) { bytes.set(chunk, p); p += chunk.length; } return new TextDecoder().decode(bytes);
}

export function createDebtService({ fetcher = fetch, clock = () => Date.now() } = {}) {
  const cache = new Map();
  return {
    async get(ticker, { cik, reports = [], facts = null, request = new Request('https://bandal.app/finance/'), env = {}, assets = env.ASSETS, userAgent = env.SEC_USER_AGENT, allowNetwork = true } = {}) {
      if (!tickerOK(ticker) || !cikOK(cik)) return null;
      const key = ticker + ':' + Number(cik), cached = cache.get(key);
      if (cached && cached.until > clock()) return cached.value;
      const asOf = new Date(clock()).toISOString();
      let result;
      try { result = facts ? normalizeDebtFacts(facts, cik, asOf) : null; } catch { result = null; }
      let pack = null;
      if (assets?.fetch) {
        try {
          const target = new URL(request.url); target.pathname = `/finance/debt/${ticker}.json`; target.search = ''; target.hash = '';
          const response = await assets.fetch(new Request(target, { method: 'GET', headers: { Accept: 'application/json' } }));
          pack = validateDebtPack(JSON.parse(await boundedText(response, MAX_PACK)), ticker, cik, clock());
        } catch { /* Reviewed detail is optional and identity-checked. */ }
      }
      if (pack) {
        // Historical maturity tables stay dated. Do not relabel them latestquarter.
        result = { ...(result || {}), ...pack, status: 'partial', summary: result?.summary || pack.summary, sources: [...(result?.sources || []), ...pack.sources], coverage: { ...pack.coverage, factsStatus: result?.status || 'not-requested', stale: clock() - Date.parse(pack.asOf) > 30 * 86400000 } };
      } else {
        const outcomes = [], chosen = [];
        for (const report of reports) {
          if (!['10-K', '10-Q', '20-F', '40-F', '10-K/A', '10-Q/A'].includes(report.type) || !safeDebtFilingUrl(report.url, cik) || !dateOK(report.date) || !dateOK(report.periodEnd)) continue;
          if (!chosen.length || /10-K|20-F|40-F/.test(report.type) && !chosen.some(r => /10-K|20-F|40-F/.test(r.type))) chosen.push(report);
          if (chosen.length === 2) break;
        }
        // One shared budget covers both documents, rather than two serial
        // ten-second stalls on a company lookup when SEC is unreachable.
        const deadline = allowNetwork && chosen.length ? AbortSignal.timeout(8000) : null;
        if (allowNetwork) for (const report of chosen) {
          try {
            const ua = typeof userAgent === 'string' && userAgent.includes('@') && !/[\r\n]/.test(userAgent) ? userAgent : 'BANDAL Finance support@bandal.app';
            const response = await fetcher(report.url, { headers: { Accept: 'text/html', 'User-Agent': ua }, redirect: 'error', signal: deadline });
            outcomes.push(extractDebtFiling(await boundedText(response, MAX_FILING), { cik, url: report.url, filedAt: report.date, periodEnd: report.periodEnd, retrievedAt: asOf }));
          } catch (error) { outcomes.push({ status: 'fetch-failed', source: { provider: 'SEC EDGAR', url: report.url, filed: report.date, end: report.periodEnd, retrievedAt: asOf }, error: String(error?.message || 'DEBT_SOURCE_FAILED').slice(0, 100), instruments: [] }); }
        }
        const seen = new Set(), instruments = outcomes.flatMap(outcome => outcome.instruments).filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
        result = { ...(result || {}), status: instruments.length || result?.status === 'partial' ? 'partial' : 'unavailable', ticker, cik: String(Number(cik)), asOf, summary: result?.summary || {}, instruments, maturities: result?.maturities || [], sources: [...(result?.sources || []), ...outcomes.map(outcome => outcome.source)], coverage: { ...(result?.coverage || {}), mode: 'sec-facts-and-inline-filings', completeness: 'partial', instrumentDetails: instruments.length ? 'parsed-standard-tags' : outcomes.some(o => o.status === 'fetch-failed') ? 'fetch-failed' : allowNetwork ? 'no-standard-instrument-tags' : 'not-requested', documentsRead: outcomes.filter(o => o.status !== 'fetch-failed').length, documentsAttempted: outcomes.length, errors: outcomes.filter(o => o.error).map(o => ({ url: o.source.url, reason: o.error })), reason: '공개 SEC 태그에서 확인된 숫자만 수록합니다. 태그 없는 회사별 조항·비공개 대주·신규 계약까지 완전한 목록을 보장하지 않습니다.' } };
      }
      cache.set(key, { until: clock() + (result.status === 'unavailable' ? 60000 : 15 * 60000), value: result });
      if (cache.size > 12) cache.delete(cache.keys().next().value);
      return result;
    },
  };
}
