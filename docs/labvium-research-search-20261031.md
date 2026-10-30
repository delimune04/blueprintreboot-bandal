# Research search result provenance — 2026-10-31

## Reproduced problem
On the public `/LabVium/search` page, searching `caprock` and then changing only
the input to `muon` left the caprock evidence visible without identifying its
applied query. A researcher could mistake old evidence for the newly typed term.

## Bounded change
- Each successful result snapshot stores the submitted, trimmed query together
  with its items and shows that query above the result list, including zero hits.
- Editing the form does not search automatically or relabel existing results.
  A polite status explains that Search must be chosen to apply the changed term.
- An in-flight request identifies its submitted term. Input may still be edited;
  a late successful response is labelled with the captured term, not the edit.
- A failed request names the failed term and keeps the last successful result
  snapshot explicitly labelled. Retry clears the old error.
- Existing abort handling prevents superseded/unmounted requests from replacing
  results. Both Korean and English UI are supported; query text is React-escaped.

No retrieval algorithm, API, permissions, persistent storage, PDF, research data,
other page or account change. No automatic requests or AI service calls.

## Verification
Eight focused hook/SSR regression tests exercise passive initial render,
whitespace, edits during requests, returning to the applied term, zero results,
failed retry, superseded requests, unmount and English/HTML escaping.
Run `node --test frontend/tests/research-search-criteria.test.mjs`.
Full regression/build and publication receipts are recorded separately in the
2026-10-31 execution evidence; source preparation is not publication.
