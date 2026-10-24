# Source-grounded company outlook

`assetdist/finance/outlooks/AAPL.json` and `IREN.json` are dated, AI-authored
Korean summaries of retrieved public sources. They are generated during the
authoring task, with human-readable source references. They do not call a model
when a visitor opens the site, require a model key, or present a new price target.

The pack separates reported results, management guidance, third-party analyst
estimates and author inference. Every summary/watch/risk item and numerical
estimate has source IDs; each source stores a URL, publisher, publication date
when known, and retrieval time. A missing publication date stays `null`.

As of 2026-10-24, the next **announcements** are Apple's FY2026 Q4 on November 2
and IREN's FY2027 Q1 on November 5. Those quarters have already ended. They are
not the same as the currently operating October–December quarter. The pack
labels both periods and does not promote an upcoming-report consensus into
guidance for the following quarter. Official next-quarter numbers not found in
the retrieved sources remain explicitly unavailable.

IREN's August 26 operating ARR, contracted ARR reported on August 27 for 2026 capacity, and December 31
operational target remain separate. ARR is the company's operating run-rate
definition, not GAAP recognized sales; commissioning and customer acceptance
conditions are retained. Annual IREN business segments and quarterly Apple
product categories each carry their own period and reconcile to their own total.
IREN's cost-of-revenue figure explicitly excludes depreciation and amortization;
the app must not infer a standard gross margin from it.

Apple's numeric Q4 management outlook is attributed to Reuters' reporting of
the earnings call, not falsely described as a number printed in Apple's press
release. MarketBeat's public EPS and sales estimates are provider aggregates.
Its IREN page still lists FY2026 Q3 as its last reported period, so that pack
warns that the page's update coverage is limited. Analyst counts, timestamped
estimate revisions and GAAP/adjusted comparability are not invented.

`hosting/finance/outlook.mjs` loads only a validated ticker's fixed same-origin
asset path through `ASSETS`. It rejects future/cross-company/corrupt records,
unknown source IDs, unsupported source hosts, nonfinite values and unreconciled
segment totals. Once the scheduled announcement date passes or the authored
pack is more than seven days old, the returned object is labelled stale and
must not be called a fresh next-quarter forecast.

## Reviewed refresh

```sh
node scripts/refresh-finance-outlooks.mjs
node scripts/refresh-finance-outlooks.mjs --verify-sources
node scripts/refresh-finance-outlooks.mjs --from /absolute/path/reviewed.json
node --test tests/finance/outlook.test.mjs
```

Default mode validates the packs. Verification checks ordinary source
reachability without redirects, authentication workarounds or retries. It never
advances `asOf`, because a reachable page is not evidence that an old summary
has been rechecked. To refresh facts, review the new source material and import
an updated pack, run the tests, then rebuild and publish through the normal Site
workflow. No unattended refresh or publication is created by this script.
