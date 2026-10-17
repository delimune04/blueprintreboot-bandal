# LabVium 3D paper map

The project research-exploration view renders one sphere per real paper record.
It keeps the surrounding research workspace and existing save/revision contract.
The map has no decorative/fabricated papers, and rendering never changes saved
metadata, PDF bytes, exploration identities or account permissions.

## Interaction

- Mouse drag rotates; wheel zooms; right drag pans.
- One-finger touch rotates; pinch zooms; two-finger drag pans.
- Click/tap a paper to select it; double-click or Focus selected centres it.
- Fit map restores the whole view. Arrow keys rotate, Shift+arrows pan, +/- zoom,
  and 0 resets the view when the stage is focused.
- The paper list offers keyboard-accessible selection and focus actions.
- SVG export saves the current projected view without uploading research.
- A projected SVG view remains interactive when WebGL is unavailable.

## Meaning of distance and colour

The map uses AI-free metadata similarity, not a statistical correlation
coefficient or a scientific-quality judgment. Shared indexed references use
cosine-normalized bibliographic coupling; provider topic IDs use Jaccard overlap;
title/abstract/topic text uses TF-IDF cosine. Configured weights are reference
0.42, topic 0.22, text 0.28, and citation 0.08. Available metadata components are
renormalized within their 0.92 budget; citation never contributes more than 0.08.
Missing evidence remains unknown rather than being invented as zero similarity.

A higher score requests a shorter 3D pair distance (36–210 world units). A
bounded deterministic stress optimizer approximates all pair distances together;
three dimensions cannot preserve an arbitrary pairwise matrix exactly. Very
sparse records receive only weak neutral separation, so their apparent positions
should not be interpreted as measured relatedness. Colours identify groups
connected by strong computed metadata similarity; a citation alone does not
join colour groups. Group colours are navigation aids, not research fields.

Up to 200 papers are rendered. Larger graphs prioritise a selected paper and its
neighbors. Selecting a paper within the display budget changes emphasis without
repositioning the graph or resetting the camera. Adding/removing papers or
changing their metadata can recompute the derived layout.

## Rendering and verification

Three.js loads in a separate lazy chunk. Pixel density is capped at two, frames
are requested only for view/selection/size changes, and resources are disposed
when the map unmounts. There is no automatic rotation loop.

Focused tests cover deterministic pair scoring and layout, missing evidence,
monotonic target distances, preservation of identities, selection stability,
finite 3D coordinates, the rendering cap, and metadata-based groups. The build
and TypeScript checks are separate from real browser/GPU/touch-device testing.
