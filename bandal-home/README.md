# BANDAL STUDIO homepage (v9 "night chapters + Finance")

Redesigned `https://bandal.app/` homepage. The page source lives in the BANDAL
Site checkout (`assetdist/` root), not in this repository; this folder holds the
new homepage files so they can be reviewed and then copied into that checkout.

Baseline: the v7 homepage (`bandal:design` = `20261023-five-projects-v7`) as
published on 2026-10-23. All of its copy, links, anchors (`#projects`,
`#harupyeon`, `#momento`, `#travel`, `#capella`, `#tokyo`, `#about`,
`#app-projects`) and accessibility affordances are kept.

## What changed

- **Type and identity**: Pretendard Variable (same OFL 1.1 subset as LabVium),
  one consistent heading weight, gradient second lines, pill navigation.
- **Hero**: same horizon, rising moon, constellation and orbit. Lights now
  travel along the orbit rings, the orbit and stars lean toward the pointer, and
  the headline recedes while the moon rises.
- **Projects**: MoaFlow gets its own chapter (it was only in the nav and the
  directory), so the order matches the navigation and directory: 01 LabVium,
  02 Harupyeon, 03 Travel, 04 CAPELLA, 05 MoaFlow, 06 Bandal Finance.
  MoaFlow keeps its independent page and chapter. Finance is a separate hub at
  `/finance/`, linking the existing ledger with company analysis and Quant.
  The hero scroll cue leads to LabVium; About is numbered 07. Each chapter has its own accent, a
  parallax numeral and a glass card whose illustration animates in: flowing
  money streams, a research map that draws itself, an article list that
  staggers in with a count-up to the existing total, a route with a travelling
  light, and a lens that focuses with a shutter flash.
- **Page**: background hue follows the chapter in view; marquee speeds up and
  leans with scroll; the About statement lights up word by word; chapter rail
  on wide screens; header hides on scroll down; directory cards have
  tilt, spotlight and gradient borders; footer has a large wordmark reveal.
- **Phone**: full-screen menu with numbered links, focus moves into it and
  Escape returns focus to the toggle. The compact menu starts at 1020px
  and scrolls vertically on short screens, keeping every project accessible.
- **Motion safety**: every continuous animation is inside
  `prefers-reduced-motion: no-preference` and `:root:not(.motion-paused)`.
  The motion toggle now remembers the visitor's choice (localStorage,
  best-effort). Without JavaScript, or with reduced motion, all content is
  visible and static.
- **Fix carried from v7**: on phones, sentences joined by a hidden `<br>` no
  longer run together ("쉽게.다음" → "쉽게. 다음").

New copy that did not exist on v7 (please review): the MoaFlow chapter
headline "내 돈의 흐름을, 한눈에." (built from the directory text), its
description (from the MoaFlow page description), the "06 PROJECTS" hero
footer label, and the chapter rail labels.

## Files

| File | Destination in the Site checkout |
| --- | --- |
| `index.html` | `assetdist/index.html` (replaces v7) |
| `bandal-home.css` | `assetdist/bandal-home.css` (new) |
| `bandal-home.js` | `assetdist/bandal-home.js` (new) |
| `fonts/pretendard/` | `assetdist/fonts/pretendard/` (new) |

The page still uses these existing Site files unchanged: `/favicon.svg`,
`/horizon.png`, `/crescent-flat.svg`, `/transitions.css`, `/transitions.js`,
`/moaflow/mark.svg`, `/LabVium/brand/labvium-symbol-v1.png`,
`/capella-icon-starlight-lens.png`.

v7's `styles.css`, `studio-motion.css`, `project-panels.css`,
`labvium-brand.css`, `main.js` and `studio-motion.js` are no longer loaded by
the homepage. Leave them in place: rolling back is restoring the v7
`index.html`. Subpages (MoaFlow, Harupyeon, Travel, CAPELLA, privacy) use their
own stylesheets and are not affected.

## Publishing

Follow `hosting/ROOT_INTEGRATION.md`: open fresh Site source, copy the four
entries above into `assetdist/`, rebuild with `hosting/build-site.mjs`, validate
with `hosting/validate-artifact.mjs`, then save and deploy through the Site
workflow. Only the Site owner publishes.

## Checks

`frontend/tests/bandal-home.test.mjs` (part of `npm test` in `frontend/`)
verifies that every v7 link and anchor is still present, that assets are
same-origin, and that every animation is gated by both motion settings.
It also checks actual section order, visible chapter and directory numbers,
primary/footer menu order, chapter jump targets, the LabVium scroll cue, and
Finance module links. Publishing remains a separate Site operation; a GitHub
commit or merge alone does not verify deployment.
