# Bandal Finance

`/finance/` combines the existing MoaFlow ledger, company research and a private
Quant laboratory. Homepage order is LabVium, Harupyeon, Travel, CAPELLA,
Bandal Finance. The existing ledger is presented inside Finance at `#ledger`;
its legacy `/moaflow/` storage/API routes remain compatible, but it is no longer
a separate homepage project. Embedded branding does not change stored records.

## Source and deployment

The personal GitHub fork stores the reviewable homepage in `bandal-home/`,
Finance and existing ledger assets in `assetdist/finance/` and
`assetdist/moaflow/`, and server logic in `hosting/finance/` and
`hosting/moaflow/`. The actual BANDAL Site has its own source repository.
Copy only these bounded paths and the appended database migration into freshly
opened Site source. Copy homepage files to the Site `assetdist/` root. Preserve
the rest of the Site and its `.openai/hosting.json` identity and bindings.

GitHub commits/PR merges do not deploy the Site. Run the Sites source workflow,
build `hosting/build-site.mjs`, validate `hosting/validate-artifact.mjs`, save
the pushed source plus archive, and deploy that exact saved version. Record
GitHub and deployment states separately.

## Data and access

- Sites dispatch supplies identity; browser owner IDs are never trusted.
- Every private SQL operation includes the authenticated owner digest. A
  separate account key blocks stale tabs after a login changes in another tab.
- Private state is not browser-persisted or cached. The ledger retains its
  established browser/account storage and migration behavior.
- Brokerage credentials and old Quant tokens use AES-GCM with record, owner
  and provider bound as authenticated data. They never appear in API responses.
- Explicitly shared results contain dates, percentage returns and drawdowns;
  they exclude capital, positions, account labels and strategy parameters.
  Tokens are random, hashed at rest, expiring and revocable.
- Existing Quant Companion is single-account. Its optional bridge is
  restricted to one configured owner and read-only. See
  `finance-quant-runner.md`; do not route all visitors to the owner's runner.

## Financial research

SEC EDGAR supplies company identity, annual USD standard-tag financials and
filings. Each financial observation carries its period and source; unmatched
periods are not mixed. Animated flow amounts must reconcile before drawing.
DCF is an assumption-based calculator, with separate FCFF, FCFE and cash-flow
proxy handling. Public Yahoo Finance statistics supplement price, TTM metrics and analyst
estimates with a source field and date for each number. Current annual SEC
figures and Yahoo TTM values are kept separate. Source-backed IREN/Apple
business breakdowns and dated authored outlooks do not turn management targets
into realized revenue. Five years of sourced daily prices are visible with selectable ranges, market timestamps and delay labels. Real company logos are validated and served locally. Metric explanations, formulas and sources sit in accessible i disclosures. Four-quarter histories use real quarterly facts, with gaps instead of fabricated values. Exact provider-industry peer samples expose their arithmetic mean, sample count, members and date basis; they are not full-market industry averages.

DCF fetches annual OCF-minus-capex and share count from sources. Only growth, discount rate, terminal growth and horizon are editable. Anonymous EPS/revenue estimates are separate from named analyst ratings and targets. SEC debt notes provide dated instrument terms, maturity ladders, financing, collateral and convertible details where disclosed; coverage remains explicit.

See `finance-data.md`, `finance-coverage.md`, `finance-analysts.md` and `finance-debt.md`. Korean DART integration is not implemented.

Normalized, dated SEC snapshots and a collected company catalog back research when hosted provider access fails. Run `node scripts/refresh-finance-research.mjs` to refresh public snapshots before rebuilding and deploying. The UI displays collection time; these are not real-time financial feeds. The collector accepts any validated SEC ticker and bounded catalog batches; the explorer is generated from its verified index, rather than a hard-coded ticker list. Source-backed successful live lookups also enter a public-only R2 namespace, with exact identity and recursive private-field rejection. This cache never exposes private ledger or Quant objects.

No system can guarantee that every company publicly discloses every requested item. A search identity does not imply complete statements, named analyst EPS estimates, ARR or all debt covenants. The UI distinguishes unavailable data, economically meaningless ratios, disclosed facts and reviewed coverage. Current hosting can fail direct SEC/Yahoo reads; collected dated assets provide resilience, and issuers without a collected copy remain subject to provider availability.

`SEC_USER_AGENT` must identify the operator and contact email. Optional
`ALPHAVANTAGE_API_KEY` enables the quote/overview provider where the subscription
supports it. Missing keys, quotas and source failures are visible in the UI.
Quotes and analyst snapshots retain their own provider dates and period basis.

## Quant and real execution

The new configurable momentum/L1–L5 template is separate from the owner's
private Quant engine. Uploaded historical prices drive next-close simulation
with fees and slippage; this is not a continuously running broker paper account
or verified real-account performance. An explicitly labelled synthetic example
exists for learning. No result represents a return guarantee.

KIS domestic cash-equity and Upbit KRW limit-order adapters are implemented.
They require encrypted per-user credentials, current-version uploaded-price
simulation, explicit order confirmation, idempotency and an operator amount cap.
HTTP timeouts remain `unknown`; the server never automatically retries an
ambiguous order. These are explicitly confirmed orders, not an unattended live
strategy scheduler. Do not claim autonomous live execution is operational.

Real ordering remains locked until all operator settings exist:
`FINANCE_LIVE_TRADING_ENABLED=true`, `FINANCE_BROKER_LIVE_VERIFIED=true`,
`FINANCE_MAX_ORDER_KRW` and valid `FINANCE_CREDENTIAL_KEY`. Enabling these flags
requires separate broker/IP/receipt/reconciliation validation. Keys, account
details and actual orders were not used in implementation tests.

## Checks

```sh
node --test tests/finance/*.test.mjs tests/moaflow/*.test.mjs hosting/tests/worker.test.mjs
node --test frontend/tests/bandal-home.test.mjs
```

These include disposable SQLite two-user authorization checks, revision
conflicts, account-switch isolation, encrypted-vault binding, public result
projection, provider mocks, point-in-time execution, DCF and financial tie-outs.
The local preview uses synthetic identities only; it strips incoming dispatch
headers and is never included in the production Worker.
