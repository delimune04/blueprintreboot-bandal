# Public debt disclosure ingestion

`hosting/finance/debt.mjs` reads public SEC material and has no access to
ledger, strategy, broker, credential or account-owner storage.

`createDebtService().get(ticker, {cik, reports, facts, assets, request,
userAgent})` returns a partial, dated disclosure view. It first validates a
same-origin reviewed pack against ticker and CIK. Otherwise it normalizes SEC
companyfacts and reads at most two identity-checked filings: the latest provided
quarter/annual report and a provided annual report. Failure of a debt source does
not invalidate the rest of a company profile.

The standardized facts cover short/long-term borrowings, current portions,
convertibles, commercial paper, separate lease liabilities, annual financing
flows and the maturity ladder. Each value retains its own reporting date,
filing date, taxonomy tag, units and source. Different dates and overlapping debt
tags are never added. Missing values remain null, including when a company uses
a custom tag. A historical observation is not a current zero.

The inline XBRL reader uses `DebtInstrumentAxis` contexts to associate reported
amounts with the right bond/facility. Other valuation dimensions do not overwrite
principal. It reads standard carrying/face amounts, coupon, effective rate,
conversion price, dates and unused commitment tags. It recognizes nested numeric
tags inside disclosure text blocks and distinguishes percentage display units.
Some issuers alternate singular/plural member names between two tables; exact
token-set matching merges those variants, never every bond with the same year.
An original face amount or financing commitment is not automatically an
outstanding balance. `principalBasis` and `balanceConfirmed` express this limit.

Arbitrary prose amounts and custom tags are not assigned a financial meaning by
guessing. Filings without suitable standardized instrument tags show their
coverage and source-fetch status. A result is never labelled exhaustive.

Reviewed packs currently cover:

| Company | Material actually read | Coverage |
| --- | --- | --- |
| IREN | FY2026 10-K Notes 17, 23, 30 and Item 9B | Six convertible series; remaining principal versus carrying value; coupons, conversion prices, first redemption dates, issuance costs and capped-call distinctions; drawn versus undrawn GPU facilities; arranger/agent versus lender; collateral, covenants and limited guarantees; August 2026 Blue Owl/PIMCO-related Mackenzie facilities with funding-relative maturities |
| AAPL | Q3 FY2026 10-Q Note 6 and FY2025 10-K Note 9 | Latest term notes and commercial paper; annual maturity ladder retains its older date; carrying value versus nominal principal versus fair value; swaps and publicly undisclosed series-level details |
| MSFT | FY2026 10-K Notes 10 and 13 | Thirteen issuance cohorts, remaining nominal amounts versus original issuance, rate and maturity ranges, debt versus separate lease obligations |

These packs do not claim all private counterparties or every omitted agreement
clause is publicly known. In particular, an agent or arranger is not represented
as the beneficial lender, and PIMCO's disclosed role as adviser to certain
investors is not represented as ownership of every note.

Run `node scripts/refresh-finance-debt.mjs` to validate reviewed packs without
changing dates. `--tickers AMD,ORCL` performs ordinary declared SEC ingestion for
other issuers and retains existing reviewed packs. Explicit `--from pack.json`
validates and imports a newly reviewed pack. No command deploys or schedules work.
Runtime HTML reads are bounded to 12 MiB, share an eight-second timeout across both documents,
reject redirects, require HTTPS `www.sec.gov/Archives/edgar/data/{same CIK}/...`,
and never forward browser cookies or authorization. Reviewed assets are bounded
to 220 KB and are fetched using fixed same-origin paths without visitor headers.
