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
| `node scripts/site/site-build.mjs` | Builds the tool menu, footer and hub cards from `assetdist/tools/tools.json`. It also generates the 연봉별 실수령액 table from `salary.mjs`, the Harupyeon related cards from `catalog.json`, `bandal-home/sitemap.xml` from each page's canonical URL, and the AdSense tag, `ads.txt` and ad disclosure from `scripts/site/adsense.json`. Run it after `harupyeon-shell.mjs`. `--check` fails when anything is stale, and CI runs it. |
| `python3 scripts/site/wage-tax-table.py <별표2 text> <json>` | Writes `tools/salary/tax-table.json` from the `pdftotext -layout` output of 소득세법 시행령 [별표 2]. It refuses gaps and non-monotonic columns. |
| `node scripts/site/check-baseline.mjs <site>/assetdist` | Lists Site files that changed after the 2026-10-24 baseline, so they are merged by hand instead of overwritten. |

## Salary calculator basis

- 국민연금 4.75% (9.5% total). 기준소득월액 is floored to 1,000원, with a lower limit of 410,000원 and an upper limit of 6,590,000원 (2026-07 to 2027-06).
- 건강보험 3.595%, 장기요양 = 건강보험료 × (0.9448% / 7.19%), 약 13.14%, 고용보험 0.9%, 지방소득세 = 근로소득세 × 10%. Each amount is truncated below 10원.
- The 근로소득 간이세액표 body (646 rows plus the formulas above 10,000천원) comes from 별표2 as revised on 2024-02-29. The 8–20세 자녀 deduction uses the amounts for pay from 2026-03-01: 20,830원, 45,830원, then 33,330원 for each further child.
- **Owner check before publishing:** confirm with Hometax's 간이세액표 조회 that the 2026-02-27 revision changed only the child deduction and left the main table as it was.

## Publishing

1. Open fresh BANDAL Site source as described in `hosting/ROOT_INTEGRATION.md`.
2. Run `node scripts/site/check-baseline.mjs <site>/assetdist`. Merge anything it lists by hand.
3. Copy `assetdist/{bandal-ui,harupyeon,travel,capella,privacy,tools}` into the Site's `assetdist/`. Copy `bandal-home/{index.html,bandal-home.css,bandal-home.js,sitemap.xml}` into its root, plus `bandal-home/ads.txt` once AdSense is set.
4. Rebuild and validate with `hosting/build-site.mjs` and `hosting/validate-artifact.mjs`. Then save and deploy through the Site workflow.
5. Hosted checks still to do: `/`, each subpage, `/tools/*` on a phone and a desktop, the CAPELLA photo preview with a real photo, a citation lookup against the live Crossref API, and `https://bandal.app/ads.txt` once AdSense is set.

## AdSense

The site is ready for AdSense but ships no ad code until a publisher ID is set.

| Page | With a publisher ID set |
| --- | --- |
| `/tools/` and the 5 tools | `google-adsense-account` meta + the AdSense script (Auto ads) |
| 하루편 list, categories and the 2 articles whose canonical URL is on bandal.app | same |
| Homepage | `google-adsense-account` meta only, for site verification; no ads |
| `/privacy/` and `/tools/#privacy` | an ad disclosure section (Google cookies, opt-out links) |
| Site root | `ads.txt` with `google.com, pub-…, DIRECT, f08c47fec0942fa0` |
| CAPELLA, Travel, privacy and legal pages | never; the CAPELLA policy states that its pages carry no ads |

Steps:

1. Sign in at <https://adsense.google.com> with the account that should receive payments, choose "Get started" and enter `bandal.app`. The account page shows the publisher ID (`ca-pub-` + 16 digits).
2. Put that ID in `scripts/site/adsense.json` (`"client": "ca-pub-…"`), run `node scripts/site/site-build.mjs`, commit, and publish as above (including `ads.txt`).
3. In AdSense → Sites → bandal.app, confirm the site (meta tag or ads.txt method; both are present) and request review. Approval is Google's decision and can take days to weeks.
4. Before or right after approval, turn on the European regulations message in AdSense → Privacy & messaging, so visitors from the EEA, UK and Switzerland get Google's certified consent prompt.
5. After approval, turn on Auto ads for bandal.app. To place fixed ad units later, create them in AdSense and add the slots to the tool pages.

Setting `client` back to `null` and rebuilding removes every trace again (verified by test).

## GPT/Codex에게 넘길 지시문

```text
delimune04/blueprintreboot-bandal의 main 브랜치(PR #7 머지 이후)를 BANDAL Site(bandal.app)에 반영해 줘.
1. hosting/ROOT_INTEGRATION.md 순서대로 Site 최신 소스를 연다.
2. node scripts/site/check-baseline.mjs <Site>/assetdist 를 실행해서 changed/missing 으로 나온 파일은 덮어쓰지 말고 내용을 비교해 수동 병합한다.
3. 이 저장소의 assetdist/{bandal-ui,harupyeon,travel,capella,privacy,tools} 를 Site의 assetdist/ 로 복사한다.
4. bandal-home/{index.html,bandal-home.css,bandal-home.js,sitemap.xml} 를 Site 루트(assetdist/)로 복사한다. bandal-home/ads.txt 가 있으면 함께 복사한다.
5. hosting/build-site.mjs 로 빌드하고 hosting/validate-artifact.mjs 로 검증한 뒤, Site 워크플로로 save → deploy 한다.
6. 배포 후 /, /harupyeon/, /travel/, /capella/, /privacy/, /tools/ 와 도구 5개, /sitemap.xml 이 200으로 열리는지 확인하고 결과를 알려 줘.
LabVium(/LabVium)과 Finance(/finance/), 그 밖의 기존 서비스 파일은 건드리지 마.
```

## Revenue notes for 반달 도구함

- Each tool page has a canonical URL, JSON-LD (WebApplication and BreadcrumbList), a dated basis section and links into Harupyeon. That gives it a chance to earn search traffic for queries such as "연봉 실수령액 계산기", "글자수 세기" and "학점 계산기".
- Travel already carries the existing Travelpayouts flight search referral. These changes do not alter it.
- 69 of the 71 Harupyeon articles declare the momento-youth blog post as their canonical URL. Search engines therefore credit the blog, not bandal.app, which is a deliberate choice by the content generator. The sitemap and the ad tag cover only pages whose canonical URL is on bandal.app.
