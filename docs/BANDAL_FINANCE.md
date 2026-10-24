# Bandal Finance

`/finance/` combines the existing MoaFlow ledger, company research and a private
Quant laboratory. Homepage order is LabVium, Harupyeon, Travel, CAPELLA,
MoaFlow, Bandal Finance. MoaFlow remains available independently at `/moaflow/`.

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
proxy handling. Missing ARR, segment revenue and analyst opinions remain
unavailable rather than being inferred from unrelated numbers. Coverage is
SEC-listed issuers; Korean DART integration is not implemented.

Normalized, dated SEC snapshots and a collected company catalog back research when hosted provider access fails. Run `node scripts/refresh-finance-research.mjs` to refresh public snapshots before rebuilding and deploying. The UI displays collection time; these are not real-time financial feeds.

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
