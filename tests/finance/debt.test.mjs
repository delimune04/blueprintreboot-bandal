import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDebtService, extractDebtFiling, normalizeDebtFacts, safeDebtFilingUrl, validateDebtPack } from '../../hosting/finance/debt.mjs';

const asOf = '2026-10-24T12:00:00Z', now = Date.parse(asOf), cik = '1234';
const url = 'https://www.sec.gov/Archives/edgar/data/1234/000000123426000001/example-20260630.htm';
const source = { cik, url, filedAt: '2026-08-01', periodEnd: '2026-06-30', retrievedAt: asOf };
const fact = (value, end = '2026-06-30', extra = {}) => ({ val: value, end, filed: '2026-08-01', form: '10-Q', accn: '0000001234-26-000001', ...extra });
const facts = tags => ({ cik: 1234, facts: { 'us-gaap': Object.fromEntries(Object.entries(tags).map(([tag, rows]) => [tag, { units: { USD: rows } }])) } });
const context = (id, member = 'ex:SeniorNotesMember', end = '2026-06-30', extra = '') => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier>0000001234</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="us-gaap:DebtInstrumentAxis">${member}</xbrldi:explicitMember>${extra}</xbrli:segment></xbrli:entity><xbrli:period><xbrli:instant>${end}</xbrli:instant></xbrli:period></xbrli:context>`;
const amount = (name, value, contextRef = 'current', options = '') => `<ix:nonFraction name="us-gaap:${name}" contextRef="${contextRef}" unitRef="USD" scale="6" id="${name}" ${options}>${value}</ix:nonFraction>`;
const pack = async ticker => JSON.parse(await readFile(new URL(`../../assetdist/finance/debt/${ticker}.json`, import.meta.url), 'utf8'));

test('debt fetch destinations bind exact SEC CIK, document identity and HTTPS', () => {
  assert.equal(safeDebtFilingUrl(url, cik), url);
  assert.equal(safeDebtFilingUrl(url + '#debt', cik), url);
  for (const candidate of [url.replace('/1234/', '/4321/'), url.replace('www.sec.gov', 'evil.example'), url.replace('https:', 'http:'), url + '?forward=secret', url.replace('/example-', '/../example-'), url.replace('www.sec.gov', 'user:password@www.sec.gov')]) assert.equal(safeDebtFilingUrl(candidate, cik), null);
});

test('standard facts keep latest reporting periods, units and unreported fields distinct', () => {
  const normalized = normalizeDebtFacts(facts({ LongTermDebtCurrent: [fact(20)], LongTermDebtNoncurrent: [fact(80)], ConvertibleNotesPayable: [fact(30, '2024-06-30')], InterestExpense: [fact(12, '2025-12-31', { start: '2025-01-01', form: '10-K' }), fact(4, '2026-06-30', { start: '2026-01-01' })] }), cik, asOf);
  assert.equal(normalized.summary.debtTotal.value, 100);
  assert.match(normalized.summary.debtTotal.source.formula, /currentPortion/);
  assert.equal(normalized.summary.interestExpense.value, 12);
  assert.equal(normalized.summary.convertible.status, 'historical-only');
  assert.equal(normalized.summary.shortTerm.value, null);
  assert.equal(normalized.maturities[0].value, null);
  assert.throws(() => normalizeDebtFacts(facts({}), '4321', asOf), /IDENTITY/);
});

test('different dates and lease-inclusive totals are not silently summed', () => {
  const normalized = normalizeDebtFacts(facts({ LongTermDebtCurrent: [fact(20)], LongTermDebtNoncurrent: [fact(80, '2025-12-31')], LongTermDebtAndFinanceLeaseObligationsIncludingCurrentMaturities: [fact(130)] }), cik, asOf);
  assert.equal(normalized.summary.debtTotal.value, 130);
  assert.equal(normalized.summary.debtTotal.source.formula, undefined);
  assert.equal(normalizeDebtFacts(facts({ LongTermDebtCurrent: [fact(20)], LongTermDebtNoncurrent: [fact(80, '2025-12-31')] }), cik, asOf).summary.debtTotal.value, null);
});

test('nested inline facts retain instrument amounts and separate classification/fair-value dimensions', () => {
  const classification = '<xbrldi:explicitMember dimension="us-gaap:LongtermDebtTypeAxis">us-gaap:ConvertibleDebtMember</xbrldi:explicitMember>';
  const html = context('current', 'ex:ConvertibleNotesMember', undefined, classification) + context('fair', 'ex:ConvertibleNotesMember', undefined, '<xbrldi:explicitMember dimension="us-gaap:FairValueByFairValueHierarchyLevelAxis">us-gaap:FairValueInputsLevelTwoMember</xbrldi:explicitMember>') + '<ix:nonNumeric name="us-gaap:DebtDisclosureTextBlock">' + amount('DebtInstrumentFaceAmount', '100') + amount('LongTermDebt', '98') + amount('LongTermDebt', '999', 'fair') + '<ix:nonFraction name="us-gaap:DebtInstrumentInterestRateStatedPercentage" contextRef="current" unitRef="number" scale="-2">0.25</ix:nonFraction>%</ix:nonNumeric>';
  const result = extractDebtFiling(html, source);
  assert.equal(result.instruments.length, 1);
  assert.equal(result.instruments[0].principal, 100000000);
  assert.equal(result.instruments[0].carryingAmount, 98000000);
  assert.equal(result.instruments[0].couponRate, .25);
  assert.equal(result.instruments[0].balanceConfirmed, false);
  assert.match(result.instruments[0].principalBasis, /잔존 원금/);
  assert.match(result.instruments[0].source.url, /#LongTermDebt$/);
  assert.equal(result.instruments[0].creditor, null);
});

test('same-year distinct bonds remain distinct while exact singular/plural spellings merge', () => {
  const html = context('current', 'ex:A2033JunConvertibleSeniorNotesMember') + context('singular', 'ex:A2033ConvertibleJunSeniorNoteMember') + context('dec', 'ex:A2033DecConvertibleSeniorNotesMember') + amount('LongTermDebt', '90') + amount('DebtInstrumentFaceAmount', '100', 'singular') + amount('LongTermDebt', '200', 'dec');
  const result = extractDebtFiling(html, source);
  assert.equal(result.instruments.length, 2);
  assert.equal(result.instruments.find(i => i.principal === 100000000).carryingAmount, 90000000);
});

test('historical redeemed instruments and unrelated entity contexts are not current balances', () => {
  const html = context('old', 'ex:OldNotesMember', '2025-06-30') + context('current').replace('0000001234', '0000004321') + amount('LongTermDebt', '100', 'old') + amount('LongTermDebt', '200');
  assert.equal(extractDebtFiling(html, source).instruments.length, 0);
  assert.throws(() => extractDebtFiling(html, { ...source, url: url.replace('sec.gov', 'example.com') }), /INVALID/);
  assert.throws(() => extractDebtFiling(html, { ...source, filedAt: '2030-01-01' }), /INVALID/);
});

test('one instrument name in two different borrowing entities keeps separate source scopes', () => {
  const legal = entity => `<xbrldi:explicitMember dimension="us-gaap:LegalEntityAxis">ex:${entity}Member</xbrldi:explicitMember>`;
  const html = context('a', 'ex:SeniorNotesMember', undefined, legal('SubsidiaryA')) + context('b', 'ex:SeniorNotesMember', undefined, legal('SubsidiaryB')) + amount('LongTermDebt', '10', 'a') + amount('LongTermDebt', '20', 'b');
  const rows = extractDebtFiling(html, source).instruments;
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map(row => row.id)).size, 2);
  assert.deepEqual(rows.map(row => row.carryingAmount), [10000000, 20000000]);
});

test('invalid numeric units and invalid maturity text do not invent terms', () => {
  const html = context('current') + amount('LongTermDebt', '100') + '<ix:nonFraction name="us-gaap:DebtInstrumentConvertibleConversionPrice1" contextRef="current" unitRef="EURPerShare" scale="0">20</ix:nonFraction><ix:nonNumeric name="us-gaap:DebtInstrumentMaturityDate" contextRef="current">not a date</ix:nonNumeric>';
  const result = extractDebtFiling(html, source);
  assert.equal(result.instruments[0].conversionPrice, undefined);
  assert.equal(result.instruments[0].maturity, undefined);
});

test('source failures are covered explicitly and unsafe filing URLs are never fetched', async () => {
  let calls = 0;
  const service = createDebtService({ clock: () => now, fetcher: async (target, init) => { calls++; assert.equal(target, url); assert.equal(init.redirect, 'error'); assert.ok(init.signal); assert.equal(init.headers.Authorization, undefined); return new Response('denied', { status: 403 }); } });
  const reports = [{ type: '10-Q', url: 'https://evil.example/collect', date: source.filedAt, periodEnd: source.periodEnd }, { type: '10-Q', url, date: source.filedAt, periodEnd: source.periodEnd }];
  const result = await service.get('TEST', { cik, reports, facts: facts({ LongTermDebt: [fact(100)] }) });
  assert.equal(calls, 1);
  assert.equal(result.summary.debtTotal.value, 100);
  assert.equal(result.coverage.instrumentDetails, 'fetch-failed');
  assert.equal(result.coverage.errors[0].reason, 'DEBT_HTTP_403');
  assert.equal((await service.get('TEST', { cik, reports })).coverage.instrumentDetails, 'fetch-failed');
  assert.equal(calls, 1);
});

test('reviewed pack read uses fixed public asset path without forwarding visitor credentials', async () => {
  const apple = await pack('AAPL'); let calls = 0;
  const assets = { fetch: async request => { calls++; assert.equal(new URL(request.url).pathname, '/finance/debt/AAPL.json'); assert.equal(new URL(request.url).search, ''); assert.equal(request.headers.get('cookie'), null); assert.equal(request.headers.get('authorization'), null); return Response.json(apple); } };
  const service = createDebtService({ clock: () => now, fetcher: async () => assert.fail('Reviewed pack must not fetch live docs') });
  const result = await service.get('AAPL', { cik: '320193', assets, request: new Request('https://bandal.app/finance/api/companies/AAPL?token=private', { headers: { Cookie: 'private', Authorization: 'secret' } }) });
  assert.equal(calls, 1);
  assert.equal(result.instruments.length, 2);
  assert.equal(result.coverage.completeness, 'partial');
});

test('actual reviewed packs distinguish IREN capacity, Apple historical maturities and MSFT original issuance', async () => {
  const iren = await pack('IREN'), apple = await pack('AAPL'), microsoft = await pack('MSFT');
  for (const [ticker, cik, p] of [['IREN', '1878848', iren], ['AAPL', '320193', apple], ['MSFT', '789019', microsoft]]) assert.equal(validateDebtPack(p, ticker, cik, now), p);
  const dd = iren.instruments.find(i => i.id === 'iren-ddtl');
  assert.equal(dd.principal, 413000000); assert.equal(dd.capacity, 1545000000); assert.equal(dd.undrawnCapacity, 1132000000);
  assert.equal(iren.instruments.filter(i => i.balanceConfirmed).reduce((sum, i) => sum + i.principal, 0), 7705649000);
  assert.equal(iren.instruments.find(i => i.id === 'iren-convertible-2032').conversionPrice, 51.4);
  assert.equal(iren.instruments.find(i => i.id === 'iren-aug-mfsa').principal, null);
  assert.match(iren.instruments.find(i => i.id === 'iren-aug-notes').creditor, /자문사/);
  assert.equal(apple.maturities[0].periodEnd, '2025-09-27'); assert.equal(apple.instruments[0].periodEnd, '2026-06-27');
  assert.equal(microsoft.instruments.reduce((n, i) => n + i.principal, 0), 46136000000);
  assert.equal(microsoft.instruments[0].originalIssueAmount, 3800000000); assert.equal(microsoft.instruments[0].principal, 520000000);
  assert.throws(() => validateDebtPack({ ...iren, cik: '320193' }, 'IREN', '1878848', now), /INVALID/);
  assert.throws(() => validateDebtPack({ ...iren, instruments: [{ ...iren.instruments[0], principal: -1 }] }, 'IREN', '1878848', now), /INVALID/);
});
