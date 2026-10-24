# BANDAL site refresh (2026-10-24)

Brings every bandal.app subpage that LabVium and Bandal Finance had not yet
covered onto the LabVium design. It also adds a new project, 반달 도구함 (`/tools/`).
The source of each page lives in this repository under `assetdist/` and
`bandal-home/`. Publishing it is a separate BANDAL Site operation (see below).

## What changed

| Area | Pages | Change |
| --- | --- | --- |
| Shared UI | `assetdist/bandal-ui/` | One set of LabVium tokens and components: product bar, hero stage, glass card, buttons, cards, chips, fields, footer. It shares the homepage's `bandal:motion` toggle. Subpage footers list the studio projects from one registry in `bandal-ui.js`. |
| Harupyeon | `/harupyeon/`, 3 categories, 71 articles | New shell and library styles. Adds full-text search, tag and saved filters, sorting, per-browser saved and read marks, checkable checklists, an active table of contents with progress, related articles from `catalog.json`, and share and print actions. Article bodies are byte-identical to the live pages. |
| CAPELLA | `/capella/`, `/support/`, `/privacy/` | New landing with a lens showcase and a web preview. The preview covers the controls the support page documents: filter strength, exposure, grain, vignette, ratio and date stamp. It works on a drawn scene or a visitor photo, processed only in the browser. The support page gains FAQ search. Policy and support text is unchanged. |
| Privacy hub | `/privacy/` | Same cards and wording on BANDAL UI, plus a card for 반달 도구함. |
| Travel | `/travel/` and its 3 notices | `travel-skin.css` is now the last style layer, with a hero onboarding. Quick-start city chips come from `CITY_CATALOG`. The hard-coded "6 CITIES 초기 버전" label and the stale six-city help text are gone. The legal notices use a restyled `legal.css` with unchanged text. |
| Homepage | `bandal-home/` (v11) | Adds chapter 06 반달 도구함 (nav, chapter rail, directory, footer). STUDIO becomes 07. The stale "오사카·교토·로마" directory text is gone. `sitemap.xml` is now generated. |
| New: 반달 도구함 | `/tools/` + 5 tools | 연봉 실수령액, 글자수·바이트, 학점, 전세·월세 실주거비, 논문 인용. Everything is computed in the browser; only the citation tool contacts Crossref, and it sends only the DOI. |

## Generated, not hand-typed

| Command | Produces |
| --- | --- |
| `node scripts/site/harupyeon-shell.mjs` | Applies the shell to newly generated Harupyeon pages. It is safe to re-run and skips pages that already have it. It also rewrites `assetdist/harupyeon/catalog.json`. |
| `node scripts/site/tools-build.mjs` | Builds the tool menu, footer and hub cards from `assetdist/tools/tools.json`. It also generates the 연봉별 실수령액 table from `salary.mjs`, the Harupyeon related cards from `catalog.json`, and `bandal-home/sitemap.xml` from each page's canonical URL. `--check` fails when anything is stale, and CI runs it. |
| `python3 scripts/site/wage-tax-table.py <별표2 text> <json>` | Writes `tools/salary/tax-table.json` from the `pdftotext -layout` output of 소득세법 시행령 [별표 2]. It refuses gaps and non-monotonic columns. |
| `node scripts/site/check-baseline.mjs <site>/assetdist` | Lists Site files that changed after the 2026-10-24 baseline, so they are merged by hand instead of overwritten. |

## Salary calculator basis

- 국민연금 4.75% (9.5% total). 기준소득월액 is floored to 1,000원, with a lower limit of 410,000원 and an upper limit of 6,590,000원 (2026-07 to 2027-06).
- 건강보험 3.595%, 장기요양 = 건강보험료 × 13.14%, 고용보험 0.9%, 지방소득세 = 근로소득세 × 10%. Each amount is truncated below 10원.
- The 근로소득 간이세액표 body (646 rows plus the formulas above 10,000천원) comes from 별표2 as revised on 2024-02-29. The 8–20세 자녀 deduction uses the amounts for pay from 2026-03-01: 20,830원, 45,830원, then 33,330원 for each further child.
- **Owner check before publishing:** confirm with Hometax's 간이세액표 조회 that the 2026-02-27 revision changed only the child deduction and left the main table as it was.

## Publishing

1. Open fresh BANDAL Site source as described in `hosting/ROOT_INTEGRATION.md`.
2. Run `node scripts/site/check-baseline.mjs <site>/assetdist`. Merge anything it lists by hand.
3. Copy `assetdist/{bandal-ui,harupyeon,travel,capella,privacy,tools}` into the Site's `assetdist/`. Copy `bandal-home/{index.html,bandal-home.css,bandal-home.js,sitemap.xml}` into its root.
4. Rebuild and validate with `hosting/build-site.mjs` and `hosting/validate-artifact.mjs`. Then save and deploy through the Site workflow.
5. Hosted checks still to do: `/`, each subpage, `/tools/*` on a phone and a desktop, the CAPELLA photo preview with a real photo, and a citation lookup against the live Crossref API.

## Revenue notes for 반달 도구함

- Each tool page has a canonical URL, JSON-LD (WebApplication and BreadcrumbList), a dated basis section and links into Harupyeon. That gives it a chance to earn search traffic for queries such as "연봉 실수령액 계산기", "글자수 세기" and "학점 계산기".
- No ad or analytics code is included. Adding an ad network takes three steps: approval for the domain, an `ads.txt` at the Site root, and an update to the privacy hub and the `/tools/#privacy` section. The text on those pages currently states that nothing leaves the browser.
- Travel already carries the existing Travelpayouts flight search referral. These changes do not alter it.
- 69 of the 71 Harupyeon articles declare the momento-youth blog post as their canonical URL. Search engines therefore credit the blog, not bandal.app, which is a deliberate choice by the content generator. The sitemap lists only pages whose canonical URL is on bandal.app.
