# Bandal Finance research data and calculation contract

## Source routes and configuration

`hosting/finance/research.mjs` exposes read-only `/finance/api/companies/search?q=…`
and `/finance/api/companies/:ticker`. These routes contain public company data;
they never read private Quant strategies, account balances or broker credentials.
All outbound destinations are assembled from a validated ticker/CIK. User-supplied
URLs are never fetched. Provider redirects are rejected.

| Variable | Purpose | Missing or restricted provider behavior |
| --- | --- | --- |
| `SEC_USER_AGENT` | Operator name and contact email in the SEC request header, e.g. `BANDAL Finance support@bandal.app` | Search only the small static identity/official-IR directory. Return financial values as `null` and explain the missing connection. |
| `ALPHAVANTAGE_API_KEY` | Optional licensed server-side GLOBAL_QUOTE and OVERVIEW access | Price, provider TTM PER/PSR and analyst consensus stay unavailable. No key is embedded in client code or source links. |

The SEC company-ticker list is the dynamic search directory. A small fallback
directory contains company identities and official IR URLs, without financial
amounts or forecasts. The supported financial normalization is USD annual
US-GAAP for SEC filers. Korean listings, IFRS-only tags and custom company tags
are not silently treated as supported data.

SEC responses are capped at 10 MiB, with a 12-second timeout and conservative
per-isolate pacing; there is no retry loop after denial or throttling. Requests
for the same document coalesce while in flight. The byte-limited in-memory
cache holds at most 4 MiB of raw-equivalent JSON (parsed XBRL uses more memory),
with 24-hour ticker and 1-hour facts/submissions TTLs. This is not a cross-region
global rate limiter. Platform egress caching is requested; sustained multi-user
deployment should use a centralized refresh/cache policy to enforce the SEC's
aggregate access limit.

Alpha Vantage reads are capped at 512 KiB per response with 8-second timeouts.
Successful snapshots cache for 6 hours, failed snapshots for 5 minutes. Quota or
premium-access notices are treated as missing data. GLOBAL_QUOTE is presented
as end-of-day data, never as a live executable quote. OVERVIEW currently needs
the provider's applicable entitlement; the site operator must configure a key
and plan that permits the intended display. No paid subscription is created by
this code.

Primary references inspected during implementation (2026-10-24):

- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [SEC developer FAQ and access policy](https://www.sec.gov/about/webmaster-frequently-asked-questions)
- [Alpha Vantage quote endpoint](https://www.alphavantage.co/documentation/#latestprice)
- [Alpha Vantage company overview](https://www.alphavantage.co/documentation/#company-overview)

## Annual financial normalization

Choose the most recent annual revenue period of 330–400 days from a 10-K,
10-K/A, 20-F or 20-F/A. Every income/cash-flow duration used in metrics must
match both its start and end. A later quarter or YTD value cannot replace an
annual numerator. For duplicate periods, prefer the latest filed observation,
including amendments. The API returns the period, filing date, tag, unit and
SEC filing URL for each selected value.

Gross profit may be derived as revenue minus cost of revenue. If operating
expenses are absent, the residual gross profit minus operating income is marked
as derived and may include other operating adjustments. Operating cash flow
minus payments to acquire property, plant and equipment (or the standardized
productive-assets tag) is explicitly a free cash-flow **proxy**, not normalized FCFF or FCFE. The productive-assets fallback includes software and other intangible assets,
so its broader scope is explicitly warned in the response. Missing capital
expenditure is never zero-filled. Debt is not inferred from ambiguous partial debt tags.

ROE uses annual net income divided by average beginning/end equity, requiring
positive average equity. The beginning equity observation must be about one
year earlier. EPS is the reported diluted annual EPS. Current price is not
divided automatically by an old EPS that may use another stock-split basis.
When configured, PER and PSR use Alpha Vantage's reported TTM ratios and identify
their distinct basis. Manual calculations require explicit `basisConfirmed`.
ARR is always unavailable without a company-defined disclosure; ordinary sales
are never relabeled as ARR.

The money-flow diagram is an income-statement bridge:
revenue → cost of revenue + gross profit → operating costs + operating profit.
Each junction must reconcile to within the larger of USD 1 or 0.001% of sales.
Negative or inconsistent flows disable the Sankey instead of hiding a loss.
It is not a cash-flow statement or segment-revenue breakdown. Particle motion
is visual styling, not a time series or a financial velocity measurement.

## DCF assumptions

`calculateDCF` is a pure calculation with explicit growth, discount, perpetual
growth, horizon, share count and cash-flow type. Discount rate must exceed
perpetual growth. Forecast horizon is 1–15 years. Non-finite inputs, nonpositive
cash flow/share counts and singular Gordon formulas are rejected.

- `ocf-capex-proxy` (default): discounts the historical cash-flow proxy and
  returns an equity-reference value. Does **not** add cash or subtract debt;
  warns that this is neither a proper FCFF nor FCFE valuation.
- `fcff`: only for user-supplied unlevered free cash flow, discounted at its
  appropriate rate; EV + cash − debt is the equity bridge.
- `fcfe`: user-supplied equity cash flow; no duplicate cash/debt bridge.

Results expose every forecast and present value, the terminal-value share,
assumptions and a nine-cell growth/discount sensitivity. Values are assumptions,
not a verified fair price, consensus target or trading instruction. Historical
weighted-average diluted shares may be the only available share count; users
must verify current share counts and splits before interpreting a per-share value.

## Reports, opinions and unavailable information

SEC submissions supply dated 10-K, 10-Q, 8-K and related filing links. An 8-K
is described as an earnings filing only when Item 2.02 is actually present.
Filing dates and reporting-period dates remain separate. The interface links
to official IR for presentations, events and earnings calls; it does not invent
future earnings dates or claim an earnings announcement is a future event.

Configured Alpha Vantage OVERVIEW data can supply aggregate analyst rating
counts and a target price. These are labeled provider aggregates with retrieval
time, not individual analyst report titles or dates. Individual licensed
sell-side report documents are not reproduced. Without the provider, the
interface explains that analyst opinions are unavailable.

SWOT content is labeled as a financial-data checklist and research questions.
Only observed signs of operating profit/cash-flow proxy create quantitative
strength/weakness text. Competitive advantages, regulation and growth are
questions for original filings, not fabricated company-specific conclusions.

## Validation

`node --test tests/finance/research.test.mjs` covers period/unit alignment,
restatements, missing values, flow reconciliation, DCF arithmetic and sensitivity,
split-basis protection, SEC link validation, fixed provider destinations,
response-size guards and provider failure behavior through mocked responses.
Provider adapters remain separately subject to hosted networking, API plan,
quota and display entitlement. Passing fixture tests alone does not establish
that a production provider is connected.

A direct live-provider smoke check on 2026-10-24 successfully loaded NVIDIA
companyfacts and submissions, selected the annual 2025-01-27–2026-01-25 period,
and produced a reconciled income flow. This validates local provider networking;
hosted production networking remains a separate check.
