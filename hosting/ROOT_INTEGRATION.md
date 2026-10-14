# Labvium on the existing BANDAL Site

This scaffold belongs only to `delimune04/blueprintreboot-bandal`. The read-only
upstream repository must never receive commits, branches, pushes or deployment
configuration from this work.

## Verified platform conventions

- Existing Site: `appgprj_6ac4aedf72708191a95725b515d35593`.
- Existing audience: public. Preserve this audience and the main homepage.
- Plugin root: `/root/.codex/plugins/cache/openai-curated-remote/sites/1.0.2-remix-b.1`.
- Source helper: `<plugin-root>/scripts/site-workflow.mjs`.
- Native packager accepts `dist/server/index.js` for a Worker and copies the whole
  regular `dist` tree. It copies root `drizzle/` into `dist/.openai/drizzle`.
- The Vinext/Cloudflare layout is `dist/client` for assets plus the `ASSETS`
  fetcher. `server/wrangler.json` records that binding and the asset directory.
- The tiny Worker ESM starter alone copies only one inline JS file. The custom
  builder here bundles API modules and preserves the multi-asset layout instead.
- Sites provisions logical bindings from source `.openai/hosting.json`; database
  and bucket IDs in generated Wrangler metadata are local placeholders.

## Owner integration steps

1. Open fresh main Site source through Sites get-site, a same-Site source
   credential, and the source helper. Only the Site owner publishes.
2. Preserve the existing main `dist/` as tracked `assetdist/`. It contains all
   homepage, Harupyeon and unrelated service assets. Replace only
   `assetdist/ku-ai` with the newly built personal-fork frontend.
3. Copy `hosting/` source from this personal fork to main Site `hosting/`,
   excluding `node_modules`, temporary build output and runtime state.
   Copy `hosting/drizzle/` to main Site root `drizzle/` as well. Once a SQL
   migration is applied, retain it and append later migrations.
4. Preserve all source hosting metadata and the exact Site ID, remove `static`,
   and add `d1: "LABVIUM_DB"`, `r2: "LABVIUM_PDFS"`. The file
   `manifest.example.json` illustrates these fields; do not overwrite unrelated
   existing manifest fields with that example.
5. Install the pinned `hosting/package-lock.json` dependencies once, or pass an
   already installed esbuild module to the builder. Build from the copied Site
   source, so the resulting artifact matches the exact source that is pushed:

   ```text
   node hosting/build-site.mjs --esbuild /workspace/scratch/ccd50d18e223/blueprint-bandal/hosting/node_modules/esbuild/lib/main.js
   node hosting/validate-artifact.mjs /workspace/sites/bandal-studio
   ```

   Run those in `/workspace/sites/bandal-studio`. The builder defaults to its
   parent checkout, `assetdist/` input and `dist/` output. For remote rebuilds,
   install hosting dependencies and run the same build without `--esbuild`.
6. Run meaningful API/domain tests and `node --test hosting/tests/worker.test.mjs`.
   The artifact validator checks Worker ESM, binding declarations, migration
   presence, and every source asset's SHA256 against the output asset.
7. Package with the Site source helper from that checkout, passing the complete
   prior opening result, credential through hidden stdin, ordered remaining
   checks as `commands`, and an absolute archive path. It owns commit/push and
   archive creation. Use its exact `project_id`, `commit_sha` and `archive`.
8. Because the existing Site is public, use `save_site_version` then
   `deploy_site_version`, preserving returned saved version IDs on retry. Poll
   only nonterminal deployment state. Do not use a private-only publication call.

## Runtime boundary

- API mount: `/ku-ai/api` and `/ku-ai/api/*`.
- Domain entry: `handleLabviumApi(request, env)` from `hosting/api.mjs`.
- Owner identity: the platform's `oai-authenticated-user-id` header. Workspace
  reads and writes are owner-scoped; browser JSON owner IDs are not trusted.
- Anonymous visitors may use public sample mode and public discovery, but cannot
  persist account records. Worker ingress rejects anonymous writes before API
  dispatch and rejects cross-origin authenticated writes.
- Sign in using a top-level anchor, not fetch or router prefetch:
  `/signin-with-chatgpt?return_to=%2Fku-ai%2F`, with `target="_top"`.
- D1: `env.LABVIUM_DB`; R2: `env.LABVIUM_PDFS`.
- Existing static directory-index URLs are preserved. SPA fallback is restricted
  to extensionless Labvium HTML requests, leaving unrelated missing pages as 404.
- Generated Wrangler uses worker-first routing so API authorization executes
  before any asset fallback.

## Verification limit

Unit tests exercise the router and asset fetcher contract. Hosted verification
must additionally confirm `/`, an unrelated existing article, `/ku-ai/`, API
anonymous-write rejection, signed-in save/reload, and a private PDF upload/read.
The scaffold does not claim that these hosted requests have already run.
