# BANDAL KU-AI demonstration fork

Personal source: https://github.com/delimune04/blueprintreboot-bandal

Read-only upstream: https://github.com/Lilshawn-LSY/BluePrintReboot

Baseline: main commit `f3c18a89eb5adad9b8f5b23ee809a999bff99a14` (v1.6.5).
The original BluePrint code and authorship are retained. This fork hosts a
personal sample demonstration of the existing research-workspace interfaces.

## Hosted demonstration

The static React entry uses the original Dashboard, Library, PDF Reader,
Projects, Tags and Settings views. Hash routes allow the app to live under
`/ku-ai/` without replacing the BANDAL homepage or requiring a server fallback.

The opt-in demo adapter implements existing typed client contracts with three
authored sample PDFs and browser-local sample workspace state. These are
synthetic demonstration materials, not real publications or research results.
Explicit Save commands persist the sample notes/metadata/links to this
browser's local storage. Other browsers/devices have independent workspaces.

Local filesystem scanning/import, PDF uploads, remote metadata enrichment and
Python PDF extraction are not supported in this static demonstration. Such
commands return an explicit unavailable result; they must not report success.
The original local application remains available for full functionality.
No LLM functionality is represented as implemented.

## Build and validate

```sh
git config core.hooksPath .bandal-hooks
cd frontend
npm ci
npm run demo:test
npm run demo:build
```

The static output is `frontend/dist-demo/`. The build enables demonstration
mode only for this static entry. `npm run dev`/`npm run build` continue to use
the normal local FastAPI bridge. Frontend deployment manifests are optional
for local development; the shared upstream Site identity is removed.

Copy the validated static output into the existing BANDAL Site's `dist/ku-ai/`
and publish through its normal Sites workflow. Fetch current BANDAL source
first, and keep every other path unchanged except the homepage's demo link.

## Safe personal updates

Use `origin` for this personal repository. Keep `upstream` fetch-only and its
push URL set to `DISABLED-UPSTREAM-PUSH`. Do not open upstream PRs for personal
changes. To import a future upstream change, fetch and inspect it deliberately
in this fork before adapting/rebuilding the demonstration.
