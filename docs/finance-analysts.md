# Public analyst research

`hosting/finance/analysts.mjs` reads the contents of ordinary Yahoo Finance
analysis pages and the visible free analyst table on Stock Analysis forecast
pages. It does not execute page scripts, use cookies, extract authentication
crumbs, call authenticated quoteSummary APIs, or access Pro-only forecasts.
Each request uses a fixed provider host, a validated ticker, a 10-second timeout,
a 3 MiB response limit and no redirects. Successful normalized results have a
15-minute process cache; failures have a one-minute cache. At most 20 tickers
remain cached.

The result distinguishes these different observations:

- `consensus`: target-price aggregates and Strong Buy / Buy / Hold / Sell /
  Strong Sell counts. Different provider fields can have different respondent
  counts; the fields are not forced to reconcile.
- `estimates`: current announcement quarter (`0q`), following quarter (`+1q`),
  current fiscal year and following year. Each contains EPS and revenue
  average/low/high, its own analyst count, reporting currency, EPS accounting
  methodology, revisions, and source. A completed quarter can still be an
  unpublished estimated result. These are anonymous consensus estimates,
  never attributed to a named analyst.
- `ratings`: dated named analyst opinions from the visible Stock Analysis /
  TipRanks table plus recent Yahoo firm-level opinion changes. Analyst names
  remain null when the page supplies only the firm. Ratings preserve the
  provider's actual vocabulary (for example Overweight or Outperform); they
  are not silently converted into Strong Buy. Target prices are forecasts,
  not realized stock prices or individual earnings estimates.

Source URL, provider, observation date, publication date where available and
the exact public field/table location accompany every estimate or rating.
`coverage` explains which source parts were found and records source fetch
failures separately. A free page does not establish complete coverage of all
analysts or access to an analyst's full report. The UI must preserve this limit.

Refresh public packs with:

```
node scripts/refresh-finance-analysts.mjs --tickers IREN,AAPL,MSFT
```

The optional `--from-directory` mode normalizes public pages previously
downloaded during a reviewed collection session. Files must be named
`TICKER-yahoo.html` and `TICKER-stockanalysis.html`; they are not copied into the
published product. Failed refreshes preserve a prior verified pack. Existing
pack dates are never bumped by merely rereading the pack.

`loadAnalystResearch(request, env, ticker)` validates and reads a bounded
same-origin public pack without forwarding user headers or query parameters.
It marks a pack stale after 24 hours. `createAnalystService({fetcher,clock})`
returns an on-demand callable service for any validated ticker. The caller can
choose a fresh live result or explicitly label an older bundled result when a
provider is unavailable.
