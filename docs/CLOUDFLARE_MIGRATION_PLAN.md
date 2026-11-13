# BANDAL.app Cloudflare migration and multi-agent engineering plan

**Status:** discovery and implementation planning; no production migration has occurred.
**Scope:** all BANDAL services, independent Google/GitHub login, preservation of user data, and GitHub-based multi-agent development.
**Production cutover:** prohibited until owner approval after acceptance testing.

## 1. Verified starting point

The personal fork is `delimune04/blueprintreboot-bandal`. Its README describes the homepage and LabVium, Harupyeon, Travel, CAPELLA, and Bandal Finance. Finance includes the existing MoaFlow ledger and Quant laboratory. The repository contains a hosted LabVium frontend and Cloudflare Worker integration.

The current hosting integration documentation describes:
- A Cloudflare Worker build artifact and static asset layout.
- D1 binding `LABVIUM_DB` and R2 binding `LABVIUM_PDFS` for the existing LabVium integration.
- A Worker API entry point and owner-scoped data access.
- ChatGPT Sites identity via the `oai-authenticated-user-id` request header.
- A separate owner-operated Sites publication workflow and the requirement to preserve unrelated homepage/static assets.

The codebase already has a Cloudflare-oriented hosting layer. This is an audit and completion of the existing architecture, not a blind rewrite or framework replacement.

## 2. Target architecture

- **Source control:** this GitHub repository; protected `main`; required PR review and CI.
- **Runtime:** Cloudflare Workers, retaining the existing Vite/Vinext build path where compatible.
- **Static assets:** Worker static assets/build output; preserve every service route and asset namespace.
- **Relational data:** Cloudflare D1 for application records and identity mapping, with explicit migrations.
- **Private files:** Cloudflare R2 for private PDFs and user uploads, with owner-scoped object keys and server-side authorization.
- **Ephemeral/cache data:** KV only where justified (OAuth state, short-lived sessions, rate limits); durable records do not belong in KV.
- **Authentication:** Google OAuth and GitHub OAuth as separate identity providers, mapped to one internal immutable user ID.
- **Secrets:** Cloudflare Worker secrets; no client-side provider secrets or committed `.env` files.
- **AI development:** isolated agent branches and PRs, preview deployments, automated checks, and human-controlled production release.

Use a Worker Custom Domain when the Worker is the application origin. Verify current DNS records and existing origins before attaching the production hostname. Cloudflare documents that Custom Domains create the DNS record and certificate for the Worker; do not assume this is safe before the current zone is inspected.

## 3. Service inventory and preservation

The migration inventory must cover at minimum:

| Service/surface | Known source area | Preservation requirement |
|---|---|---|
| Main homepage | `bandal-home/`, `assetdist/` | Preserve layout, links, assets, metadata, and service order |
| LabVium | `frontend/`, `hosting/` | Preserve workspace ownership, papers, notes, projects, collaboration, private PDFs, routes, and API compatibility |
| Harupyeon | existing homepage/static/service source | Preserve user-facing behavior and any persisted records |
| Travel | existing homepage/static/service source | Preserve routes, content, and persisted records |
| CAPELLA | existing homepage/static/service source | Preserve app landing and download/test links |
| Bandal Finance | `assetdist/finance/`, `hosting/finance/` | Preserve company research, source provenance, DCF, Quant features, and access controls |
| MoaFlow ledger | `assetdist/moaflow/`, `hosting/moaflow/` | Preserve ledger data, account isolation, and legacy routes |
| Quant laboratory | Finance and existing Quant integration | Preserve owner-only boundaries, encrypted credentials, and explicit order-confirmation safety |

This is a minimum inventory, not evidence that every service already runs on the same Worker or shares the same data store. Before implementation, complete a route/asset/API/data inventory from the full repository and current production site.

## 4. Authentication and account migration

### Internal identity model
Create one immutable internal `user_id` per person. Provider identities are separate records keyed by `(provider, provider_subject)` and mapped to that internal ID. Store provider subject IDs, not just emails. A verified provider email is profile metadata, not the primary identity key.

### Login providers
- Google OAuth: authorization-code flow, PKCE where applicable, exact redirect URI allowlist, state and nonce validation, and issuer/audience/signature/expiry validation.
- GitHub OAuth: authorization-code flow, state validation, server-side code exchange, and verified account identity lookup. Request only minimum sign-in scopes.
- Both providers create or retrieve a provider identity mapped to the same internal account.
- Linking from an authenticated session requires fresh re-authentication and explicit confirmation.
- Never silently merge accounts just because email values match.
- Use secure HttpOnly/SameSite cookies, rotate sessions after login/linking, implement CSRF protection, logout/revocation, rate limits, and audit events.

### Legacy ChatGPT Sites identity
The existing `oai-authenticated-user-id` is a platform identity, not a portable OAuth credential. Do not assume it can be reproduced outside Sites. Build a one-time, owner-verified mapping from each legacy Sites subject to the new internal `user_id`. Do not trust a client-submitted legacy subject. Preserve mapping evidence and maintain an exception queue for unverified or ambiguous accounts.

### Data migration
1. Inventory every D1 table, R2 object prefix, browser-local/IndexedDB store, and service-specific persistence mechanism.
2. Identify what is already in Cloudflare and what remains browser-local or in an external/owner-operated service.
3. Produce immutable, timestamped D1 exports and R2 object manifests/checksums.
4. Test restore into isolated staging resources.
5. Migrate users and legacy identity mappings before user-owned rows; preserve primary IDs, ownership, timestamps, revisions, and relationships.
6. Copy private objects without making them public; reconcile object counts and checksums.
7. Run row counts, foreign-key/integrity checks, owner-isolation tests, and sampled read/write tests.
8. Keep old storage read-only and available through the rollback window. Do not delete source data as part of cutover.

## 5. Multi-agent GitHub workflow

- Protect `main`; require pull requests, CI, and at least one human approval.
- Agents use isolated branches such as `agent/claude/<topic>`, `agent/codex/<topic>`, and `agent/chatgpt/<topic>`.
- One task owner per file set; do not concurrently edit shared migrations, auth middleware, routing, or shared types.
- Agents read root `AGENTS.md` and relevant service documentation before editing.
- CI runs formatting/lint/type checks, focused service tests, and Worker artifact validation where relevant.
- Each PR receives a preview deployment with isolated data bindings and synthetic fixtures only.
- Never give autonomous agents production Cloudflare credentials, production database access, production OAuth secrets, or DNS write permission.
- Production deploy is a separate owner-controlled release step with recorded artifact/commit SHA and rollback target.

## 6. Staged delivery

### Phase 0 — Discovery and baseline
- Enumerate every route, asset namespace, Worker entry point, D1 migration, R2 bucket/prefix, environment variable, external API, and data store.
- Record production hostname/DNS/origin, Cloudflare account/zone/resource IDs, GitHub Actions state, and current deployment commit.
- Capture baseline screenshots and route/API smoke tests.
- Produce a service-by-service parity matrix and data inventory.

### Phase 1 — Safe development foundation
- Add repository-wide agent instructions.
- Establish protected-main/PR/CI conventions and per-agent branch naming.
- Create isolated Cloudflare preview/staging resources.
- Add a secret inventory and deployment runbook without writing secret values into Git.

### Phase 2 — Authentication foundation
- Implement internal identity and session model.
- Add Google and GitHub sign-in.
- Add explicit identity linking and legacy Sites account-claim flow.
- Add authorization tests for cross-user and cross-workspace access.

### Phase 3 — Data and service parity
- Verify every service against the inventory.
- Complete migrations and private object handling.
- Preserve legacy URLs/API aliases during transition.
- Validate all service flows against staging.

### Phase 4 — Cutover rehearsal
- Perform backup and restore drill.
- Freeze or capture final source-data delta.
- Reconcile row/object counts and checksums.
- Run end-to-end login, account linking, upload/download, read/write, collaboration, Finance, and ledger tests.
- Confirm rollback to the prior Sites deployment and storage.

### Phase 5 — Owner-approved production cutover
- Attach the production hostname only after DNS/origin review.
- Deploy the exact validated Worker artifact.
- Verify all service routes, authentication, ownership isolation, uploads, and core workflows.
- Keep the previous deployment and source data available throughout the rollback window.
- Announce completion only after real hosted checks pass.

## 7. Acceptance criteria

- All listed service surfaces and public routes are accounted for in the parity matrix.
- Google and GitHub login both work; linking is explicit and secure.
- Legacy accounts are mapped only after verified ownership.
- Existing records and private objects are reconciled and restorable.
- No user can read or mutate another user's private data by changing request IDs or headers.
- All critical user journeys pass on Cloudflare preview/staging.
- Preview deployments use isolated non-production data and secrets.
- GitHub PR checks are green; production release requires human approval.
- DNS and production deployment change only with explicit owner approval.
- Rollback has been rehearsed and source data remains intact.

## 8. Owner inputs required before production provisioning

The repository can be prepared without these values, but production infrastructure cannot safely be provisioned without owner access and explicit resource selection:
- Cloudflare account access and confirmation that `bandal.app` is an active zone in that account.
- Current production DNS records and origin/hosting details.
- Existing D1 database and R2 bucket IDs, regions, bindings, and backup status.
- Google Cloud OAuth client setup and authorized redirect URIs.
- GitHub OAuth App setup and authorized callback URL.
- Decision on whether existing users must retain seamless access or can use a verified one-time account-claim flow.

Never request secrets in chat. Configure them directly in Cloudflare's dashboard/secret management after the application has been reviewed.

## 9. Current limitations / honest status

This plan and its branch do not create Cloudflare resources, alter DNS, provision OAuth clients, copy production data, run a production migration, or deploy the application. Those operations require authenticated Cloudflare account access, current production inventory, and separate owner-approved cutover.
