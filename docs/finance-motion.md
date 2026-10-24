# Finance motion skin (v2)

`assetdist/finance/` gets the LabVium family look: Pretendard, a violet-indigo
palette, a moving hero and animated, readable research and Quant screens.
The data, API and account behaviour described in `BANDAL_FINANCE.md` are
unchanged.

## Files

- `finance-skin.css` (new) loads after `style.css` and only restyles it:
  tokens, glass sidebar and sticky top bar, hero stage (aura, grid, panning
  gradient headline, orbit lights with pointer depth), gradient buttons with a
  shine, sliding indicators under the sidebar tabs, analysis modes, profile
  tabs and price ranges, card pointer light and lift, self-drawing price,
  sparkline and equity charts, flow edges that draw before particles run, a
  dark private-Quant card, a footer wordmark and a compact phone layout.
- `finance-motion.js` (new) adds the motion toggle, indicators, count-ups,
  stagger order, pointer light, scroll reveals and the top-bar shadow. The app
  works without it.
- `style.css`: 300 `font-size` values of 7–15px were raised so functional
  text is at least 11px (phones had 7–9px body copy). SVG chart text and logo
  fallbacks keep their sizes. Nothing else changed in the file.
- `index.html`: Site Pretendard (`/fonts/pretendard/`, already shipped with
  the homepage), the new files, `/transitions.css`, the motion toggle, hero
  aura and company tape, footer wordmark, canonical and Open Graph tags. The
  first paint now matches the default research route instead of showing the
  ledger until the script switches.
- `app.mjs` and `explorer.mjs`: the fixes below and the company tape.

## Motion safety

Every animation sits inside `prefers-reduced-motion: no-preference` and
`:root:not(.motion-paused)`. The toggle uses the homepage key `bandal:motion`,
so a visitor who paused motion there arrives paused; it also stops the flow
particles and smooth scrolling. Count-ups end on the exact text `app.mjs`
rendered; screen readers get the final value and only an `aria-hidden` copy
moves. Reveals are limited to decorative blocks, never hide content without
the script and are off in print.

The company tape on the research hero lists the atlas snapshot with its
collected market cap and says it is not a live quote. It is decorative
(`aria-hidden`, outside the tab order); the atlas cards stay the accessible
way in, and clicking a pill opens that company.

## Fixes

- `sourceMarkup` labelled a basis as a period ("기간 Yahoo 제공 시가총액"); it
  is now "기준 …". A real period still wins.
- Opening a company replaced the history entry, so Back left Finance. Opening
  from the page now pushes an entry; Back and "← 기업 지형도로" return to the
  atlas at its scroll position.
- A slow company load that finished after the reader left research rewrote the
  URL to `#research/…` over the ledger or Quant view. The late result is
  dropped and its loading notice cleared.
- After pausing the flow particles, a newly rendered company showed "멈춤"
  while they stayed paused; the button now reads the shared state.
- A later `.button` background in `style.css` overrode `.danger-quiet` and
  `.live-button`, so "삭제"/"공유 종료" sat on solid purple and the live-order
  button lost its colour. `finance-skin.css` restores both.

Atlas cards keep both the source's collection date and the snapshot's
"수집" date, as `tests/finance/explorer.test.mjs` requires.

## Review follow-ups (#3)

- The embedded ledger is hidden, not destroyed, while a focus or visibility
  re-check confirms the same account, and it stays mounted across Finance tab
  switches, so unsaved ledger drafts survive. An account change or a failed
  check still removes it and locks the page.
- The strategy form saves against the revision it was filled from. Refreshing
  the run list no longer hands it a newer revision, so another tab's change
  returns the server's 409; the edits stay in the form and "최신 전략 불러오기"
  reloads the latest version only when asked.
- An anonymous browser ledger (`moaflow:browser:v1`) that cannot be parsed or
  validated is no longer replaced by an empty ledger. Nothing is written over
  it until the person chooses: download the original bytes, or keep them under
  `moaflow:browser:v1:unreadable:<time>` (copied and verified first) and start
  a new ledger. The regular full backup of the on-screen ledger is not offered
  as a backup of that original.

## Left for an owner decision

- Shared result pages (`?share=`) still show the research hero copy and load
  an atlas list they do not display.
- The 5Y price chart draws one hover circle per trading day (~1,250 nodes).

## Checks

`tests/finance/motion.test.mjs` runs with the other Finance tests and checks
the published ids, the research first paint, same-origin assets, motion
gating, the 11px floor and the basis label. `tests/finance/review-guards.test.mjs`
and `tests/moaflow/browser-ledger.test.mjs` cover the review follow-ups. The skin was also driven in
Chromium against a local server serving these files, proxying public
`/finance/api` reads from bandal.app and mocking signed-in Quant endpoints:
desktop and phone views of research, company profile, glossary, compare,
ledger and Quant; no horizontal overflow from 360px to 1680px; Back and close
navigation, the late-load race, flow pause, motion toggle and reduced motion.
Deploy through the Site workflow in `BANDAL_FINANCE.md`; GitHub merges do not
deploy.
