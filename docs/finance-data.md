# Bandal Finance company data contract

Bandal Finance combines annual SEC financial statements, publicly served Yahoo
Finance observations, and reviewed source summaries. Each displayed value owns
its own source URL, unit, reporting basis and date. A collection timestamp never
becomes a substitute for a quote's exchange timestamp or a statement's fiscal end.

## Search and explorer

- `/finance/api/companies/search?q=...` searches the collected SEC company catalog.
- `APPL` resolves to Apple's actual ticker `AAPL`. Search and direct lookup return
  `searchedAs`, `resolvedTicker` and an explicit correction message.
- `/finance/api/companies/explore` returns the curated, supported snapshot sample
  with per-field sources and missing/N/M states. Its rankings are **within that
  sample**, not worldwide company rankings.
- `/finance/api/companies/:ticker` returns a complete public company payload.
  It does not read private Quant strategies, account balances or broker secrets.

The searchable SEC identity catalog is separate from the verified snapshot index.
The explorer uses `snapshots/index.json`; it is not restricted to the original ten
companies. The collector accepts arbitrary SEC tickers or bounded catalog batches,
and retains previous valid records after failures. See `finance-coverage.md`.
Company identity alone does not guarantee disclosure of every metric.
XOM's new holding-company CIK 2115436 can have partial annual data; predecessor
CIK34088 statements are not silently relabeled as the new entity.
Provider industry classifications take precedence when available. Exact-industry,
same-definition observed peer samples disclose members, N and dates.

Actual Yahoo logos are downloaded as validated raster assets and served locally.
Profile summaries, five-year daily prices, quarterly history, anonymous consensus,
named ratings and debt-note records retain independent source dates.
`history` is the four-quarter view; `quarterlyHistory` stores up to eight raw
normalized quarters for rolling valuation calculations. Storage omits recomputable
history/metrics/fieldSources views to avoid duplicating evidence. Historical
valuation gaps remain when EPS, shares, periods or split basis are not confirmed.

## Public market data

`hosting/finance/public-data.mjs` reads only the already-public
`https://finance.yahoo.com/quote/{ticker}/key-statistics/` page. It parses JSON
already included in that page, validates the exact requested symbol and USD quote
currency, and never executes page scripts. It does not request the authenticated
quoteSummary API, obtain a crumb, create cookies, solve challenges or bypass a
401/403/429. If the statistics page is unavailable, the fixed public chart route
may provide its own price only; a chart cannot fill missing fundamental ratios.

Every observed field has `quote.evidence[field]` with provider, page URL, raw field
name, unit, `asOf`/reporting period, retrieval time and basis. The adapter retains:
price, market capitalization, trailing and forward PE, PSR, EPS, ROE, ROA, beta,
EV, PBR, share count, reported cash/debt, TTM revenue/cash flows/margins, analyst
aggregates and the upcoming earnings calendar's estimates where available.
These are provider observations, not normalized SEC annual values.

Financial-currency confirmation is separate from USD trading currency. A USD ADR
cannot relabel non-USD EPS, income or cash flows as USD. Dates use raw Unix values
before formatted text; future actual trade/reporting dates are rejected. Future
estimate periods and anticipated earnings dates are allowed and labelled forecasts.
PE for actual or forecast losses is **N/M**, with its source and reason preserved.
Negative EPS, ROE and income remain negative rather than being replaced by zero.

The statistics reader is bounded to 3 MiB and 10 seconds; short quote chart reads to 256 KiB; five-year histories to 768 KiB.
Only fixed symbol-validated Yahoo destinations are allowed, redirects are rejected,
and concurrent requests coalesce. Successful normalized values cache for five minutes,
failures for one minute. Public page formats may change; failed parsing produces an
explicit unavailable state and keeps prior dated snapshots rather than guessing.

Optional `ALPHAVANTAGE_API_KEY` supports the pre-existing GLOBAL_QUOTE/OVERVIEW
adapter. Without a key, the public Yahoo path is used; no paid provider key is
required for the collected Yahoo observations. No provider key is exposed in
source links or browser bundles.

## Annual financials and derived metrics

`SEC_USER_AGENT` identifies the operator and contact email for SEC requests.
`normalizeCompanyFacts` supports standard USD US-GAAP and IFRS tags, selecting the
latest annual 330–400 day period from 10-K/20-F filings and amendments. Durations
must match both fiscal start and end; balance-sheet observations must match the
selected year end. Later quarters/YTD cannot replace annual numerators.

The payload includes revenue, direct costs, profit/loss, operating/cash flows,
capital spending, FCF proxy, equity, assets/liabilities, EPS, shares, cash,
R&D, SG&A, interest and tax when matching tags exist, plus five annual history
points. Per-field evidence preserves taxonomy, tag, filing date, period and filing
URL. Derived amounts identify formulas and inputs. Incomplete long-term debt tags
are not silently called total company debt; provider-defined debt remains a
separate Yahoo metric with its own source/basis.

Annual ROE uses net income divided by positive average beginning/end equity.
Annual EPS/margins/OCF-capex are separate from Yahoo TTM measures. Provider-reported
PER/PSR are used on their reported TTM basis. Manual ratios still require explicit
split-basis confirmation. Missing ARR is not inferred from sales. IREN's company-
defined operating ARR is sourced separately from contracted ARR and future targets.

## Income and business diagrams

A positive operating-income flow reconciles revenue = direct costs + gross
residual, and gross residual = operating costs + operating income. Inconsistent
amounts disable the diagram instead of forcing a balance. A consistent operating
loss is shown as a **negative loss node and an accounting deficit bridge**; this
line is not a cash inflow, loan or financing source. Particle speed is styling.

IREN's direct cost explicitly excludes depreciation/amortization. Its revenue-
direct-cost residual is labelled **direct-cost contribution**, not comparable
standard gross profit. Residual operating costs may include noncash impairment.
Quarterly Apple product/service breakdowns and annual IREN business breakdowns
retain their own distinct period frames and official source citations. They are
not combined into one artificial statement or relabelled as each other's period.

## Collected snapshots and outlook

`node scripts/refresh-finance-research.mjs` performs normal sequential declared
SEC reads and public Yahoo page reads, then atomically writes only normalized
public observations to `assetdist/finance/snapshots/`. It never publishes or
schedules itself, and preserves an older file after failure. Default collection
covers the 10 curated symbols; `--tickers AAPL,IREN` performs a bounded refresh.

Runtime ASSETS reads use fixed same-origin paths. Validated snapshots collected
within 24 hours are preferred. After 24 hours the normal providers are tried; an
older fallback is clearly marked. A stored Yahoo price retains its own exchange
and retrieval times, not the page-view timestamp. Partial public-only snapshots
must have no asserted annual SEC period/financials and must have validated Yahoo
identity, currency and source provenance. Malformed/future/mismatched snapshots
are rejected. Snapshot refresh requires a normal source build and Site publication;
no recurring task was created.

The outlook loader reads fixed reviewed source packs in `finance/outlooks/`.
These are dated **AI-authored, source-based summaries**, not a live connected model.
Official guidance, analyst estimates, reported results and inferences have distinct
labels and citations. Future dates are never represented as completed results.
Source packs become stale after seven days or after a scheduled earnings date.
IREN's operational, contracted and target ARR stay separate. DCF is an explicitly
assumed FCFF/FCFE/proxy calculator with nine-cell sensitivity; it is not an analyst
rating, guaranteed fair value or trading signal.

## Verification

`node --test tests/finance/research.test.mjs tests/finance/public-data.test.mjs`
covers exact symbol/currency/source dates, IFRS and annual period alignment,
restatements, APPL correction, loss N/M, loss accounting bridges, mixed-basis
provenance, public-provider limits, snapshot freshness, partial-data retention,
explorer sample scope and DCF mathematics. Provider requests in tests are fixtures;
actual collected snapshots retain their source evidence for independent review.

References:

- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [SEC access policy](https://www.sec.gov/about/webmaster-frequently-asked-questions)
- [Yahoo IREN statistics](https://finance.yahoo.com/quote/IREN/key-statistics/)
- [Yahoo Apple statistics](https://finance.yahoo.com/quote/AAPL/key-statistics/)
- [Alpha Vantage documentation](https://www.alphavantage.co/documentation/)
