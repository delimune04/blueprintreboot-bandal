// An observed peer sample, not an asserted average of every company in a market.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const providerOf = source => typeof source?.provider === 'string' ? source.provider : null;
const normalizedIndustry = text => typeof text === 'string' ? text.trim().toLowerCase().replace(/\s+/g, ' ') : null;
function industryIdentity(data) {
  const c = data?.company || {}, q = data?.quote || {}, profile = q.profile || data?.profile || {};
  const industry = profile.industry || q.industry || c.industry;
  const source = profile.source || profile.classificationSource || q.profileSource || q.classificationSource || c.classificationSource || c.industrySource;
  // The hand-edited homepage categories are useful navigation, but cannot prove
  // an industry comparator set or be relabeled as provider classification.
  return normalizedIndustry(industry) && providerOf(source) ? { industry, key: normalizedIndustry(industry), provider: providerOf(source), source } : null;
}
function comparableMetric(data, key) {
  if(key==='grossMargin'&&(data?.evidence?.grossProfit?.derived||data?.evidence?.grossProfit?.scope))return null;
  const row = (data?.metrics || []).find(metric => metric?.key === key), source = row?.source;
  if (!row || !finite(row.value) || row.status === 'not-meaningful' || !providerOf(source) || !row.unit || !source.basis) return null;
  if (['per', 'forwardPE', 'psr', 'priceToBook'].includes(key) && row.value <= 0) return null;
  return { ...row, signature: [providerOf(source), row.unit, source.basis].join('|') };
}

export function industryBenchmarks(company, snapshots = []) {
  const identity = industryIdentity(company), subject = company?.company?.ticker;
  const out = { status: 'unavailable', scope: 'observed-peer-sample', industry: identity?.industry || company?.company?.industry || null, classificationSource: identity?.source || null, excludesSubject: true, metrics: {}, peers: [], reason: null };
  if (!identity) { out.reason = '제공자가 확인한 동일 산업 분류가 없어 산업 평균을 계산하지 않았습니다.'; return out; }
  const seen = new Set();
  const peers = snapshots.filter(data => {
    const ticker = data?.company?.ticker, classification = industryIdentity(data);
    if (!ticker || ticker === subject || seen.has(ticker) || !classification || classification.key !== identity.key || classification.provider !== identity.provider) return false;
    // Multiple share classes of one issuer must not double-weight the issuer.
    const issuer = data.company.cik ? `CIK:${Number(data.company.cik)}` : `TICKER:${ticker}`;
    if (seen.has(issuer) || company?.company?.cik && data.company.cik && Number(company.company.cik) === Number(data.company.cik)) return false;
    seen.add(ticker); seen.add(issuer); return true;
  });
  out.peers = peers.map(data => ({ ticker: data.company.ticker, name: data.company.name, classificationSource: industryIdentity(data).source }));
  for (const metric of company.metrics || []) {
    const target = comparableMetric(company, metric.key);
    const candidates = peers.map(data => ({ data, row: comparableMetric(data, metric.key) })).filter(({ row }) => row && row.unit === metric.unit);
    const signatures = [...new Set(candidates.map(({ row }) => row.signature))];
    // A loss-making subject can still show its peers' meaningful positive PER.
    // Without the subject's comparable value, use only an unambiguous common
    // peer definition and explicitly mark that the subject is not comparable.
    const signature = target?.signature || (signatures.length === 1 ? signatures[0] : null);
    if (!signature) continue;
    const selected = candidates.filter(({ row }) => row.signature === signature), definition = target || selected[0]?.row;
    const sample = selected.map(({ data, row }) => ({ ticker: data.company.ticker, value: row.value, source: row.source }));
    if (!sample.length) continue;
    const values = sample.map(row => row.value).sort((a, b) => a - b), n = values.length;
    const mean = values.reduce((sum, value) => sum + value / n, 0);
    if (!finite(mean)) continue;
    out.metrics[metric.key] = { mean, median: n % 2 ? values[(n - 1) / 2] : values[n / 2 - 1] / 2 + values[n / 2] / 2, n, unit: definition.unit, basis: definition.source.basis, provider: definition.source.provider, subjectComparable: !!target, scope: 'observed-peer-sample', label: `동일 산업 표본 평균 · ${n}개사`, sample, dates: [...new Set(sample.map(row => row.source.asOf || row.source.periodEnd || row.source.end).filter(Boolean))].sort() };
  }
  out.status = Object.keys(out.metrics).length ? 'available' : 'unavailable';
  out.reason = out.status === 'available' ? '현재 확보한 동일 산업 회사 중 지표 정의·단위·제공자가 일치하는 표본의 단순평균입니다. 해당 기업은 제외하며 전체 산업 평균이 아닙니다. 표본별 기준일은 다를 수 있습니다.' : '현재 확보한 동일 산업 회사 중 같은 정의·단위·제공자의 비교 수치가 없습니다.';
  return out;
}
