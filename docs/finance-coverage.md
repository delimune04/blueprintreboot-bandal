# Public company data coverage

The SEC ticker directory and the set of collected financial snapshots are different datasets. A company appearing in search establishes its SEC identity; it does not establish that every field, analyst report, logo or financing term has been disclosed or successfully retrieved.

The public research service attempts source retrieval for the requested ticker. The published snapshot index (`assetdist/finance/snapshots/index.json`) lists only existing, verified collected company files. The company explorer uses that index rather than treating its sample as the whole market. Each snapshot retains the source URL, financial period, filing/publication date, market observation time and collection time independently. A failure must not turn into a fabricated zero or an estimate presented as reported fact.

## Refreshing any SEC ticker

Run `node scripts/refresh-finance-research.mjs --tickers AAPL,IREN,AMD` with a descriptive `SEC_USER_AGENT` containing the operator's contact email. The script accepts 1–100 validated tickers, performs sequential issuer requests and atomically replaces only validated results. It does not use a paid provider key, access private accounts, bypass authentication, publish the website or schedule itself.

A complete directory can be processed in bounded alphabetically ordered batches:

```
node scripts/refresh-finance-research.mjs --all --offset 0 --limit 25
node scripts/refresh-finance-research.mjs --all --offset 25 --limit 25
```

`--limit` is restricted to 1–100. `.cache/finance-research-checkpoint.json` records completed tickers, failures, the batch's next offset and source collection time after each company. Rerunning a failed batch is safe: old verified files remain if retrieval fails or would replace annual financials with a less complete quote-only result. The collector rebuilds the published index from verified files at the end. Normalized company files are limited to 768 KiB; it stores primary annual/quarter records and their evidence, then the runtime reconstructs duplicate metric and chart views. Actual provider-published logo images are validated by the public-data helper and saved under the same-origin `/finance/logos/` path with their original source and collection time; an unavailable image does not discard independently verified financial facts. The directory may change between runs; for a long full-directory ingestion, compare its collection timestamp and restart/reconcile the alphabetic offsets if the directory changes.

## Honest gaps and comparisons

Quarterly graphs use actual quarter observations or explicitly sourced duration differences, with missing observations retained as gaps. Industry benchmarks describe their observed same-industry sample and sample size rather than claiming to be a whole-industry average. Anonymous aggregate earnings estimates are not attributed to a named analyst. A rating's publication date and named firm or analyst remain distinct from its target financial quarter.

ARR is a company-defined operating metric, not a universal accounting field. A company that does not publish ARR cannot acquire one by relabeling revenue. Negative earnings can make PER not meaningful. Annual USD standardized XBRL fields do not cover all issuers, foreign currencies, custom accounting tags or notes. Undisclosed lending/conversion terms, unavailable estimates, provider restrictions and extraction failures must be described as such. No public-source application can truthfully guarantee that every detail exists for every company.

The runtime and collector use ordinary public SEC and market-provider requests. Provider access failures can differ between the local collection environment and the deployed Worker. In that case the deployed page can serve explicitly dated verified collected data, preserving its age and failure status. A wider search directory alone does not solve a runtime provider outage.
