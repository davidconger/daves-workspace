# Process log and learnings

`README.md` describes what the pipeline *is*. This describes how it got there: what
was tried, what turned out to be wrong, and what is worth reusing next time.

**Status as of 2026-09-04:** `amscap-none` printed successfully at 50 mm. The SVG is
approved, all STL variants are watertight, and `toptab-half` is the chosen attachment
but has not been printed yet. Height, attachment style and a new attachment concept are
open for the next round.

---

## The through-line: measure, don't assume

Almost every real problem in this project was found by measuring something that looked
fine, and almost every wrong turn came from a number that was plausible but measured the
wrong thing. Three separate metrics had to be thrown away and replaced.

The habit that worked: **if a measurement decides a design choice, verify the
measurement before trusting the choice.** Twice, checking a suspicious-looking number
revealed a bug that would otherwise have shipped.

---

## How the work is organized

Numbered scripts, each doing one thing and leaving evidence behind:

| Script | Does |
|---|---|
| `1-analyze-palette.js` | What colours are actually in the source |
| `2-trace-layers.js` | Raster masks to Bézier paths |
| `3-measure-ball.js`, `3b-fit-rings.js` | Fit the baseball's circles |
| `4-build-svg.js` | Assemble the final SVG, score it against the source |
| `5-export-layers.js` | One SVG per colour, shared viewBox |
| `6-sweep-fit.js` | Sweep fit tolerance and report the tradeoff |
| `7-analyze-print.js` | Printability: connectivity, thin features, keyring spots |
| `8-build-stl.js` | Masks to watertight STLs, every variant |
| `9-preview-stl.js` | Render STLs to PNG so they can be judged without a slicer |

Shared logic lives in `lib-color.js`, `lib-curve.js`, `lib-layers.js`, `lib-mesh.js`, so
phases cannot drift apart in how they classify a pixel or fit a curve.

---

## Phase 1 — Vectorization

**The problem:** the only available source is a low-res raster with JPEG artifacts.

**What didn't work:** off-the-shelf auto-tracers (`potrace`, `imagetracerjs`, both since
removed). They trace the *pixel grid*, so every edge came back with stair-step wobble
baked into the curve.

**What worked:** treat the mask as a level set. Blur to a continuous field, extract the
0.5 iso-contour with sub-pixel marching squares, then fit Béziers to that. The contour
is smooth before fitting even begins, so the fit is not fighting the raster.

### The most useful idea: the marker, not the fine pen

The instinct is to fit as tightly as possible. That is wrong when the source is
imprecise. The source's edge ramp measures **4 px median, 6 px p90**, so edge position
is only known to about **±2 px**. Fitting tighter than that spends control points
encoding JPEG noise as though it were design.

| Tolerance | Dragon segments | Match |
|---|---|---|
| 0.35 px | 381 | +0.24% |
| 2.5 px | 103 | baseline |

That 0.24% is *agreement with noise*. The loose fit is smaller, smoother and more
honest. Like tracing with a marker whose tip is wider than the wobble instead of chasing
every irregularity with a fine pen.

**Generalizes to:** any fit against imperfect data. Measure the input's precision first,
then set tolerance to match it. A better score against a noisy reference is not a better
result.

### Two structural decisions

- **The baseball is drawn, not traced.** Its circles are fitted and re-emitted as exact
  geometry. A traced circle from a 600 px raster is a polygon pretending to be a circle.
- **The red score is 43.5% and that is correct.** The seams are idealized and thickened
  on purpose. Never tune against that number.

---

## Phase 2 — Printability, before any mesh work

Running `7-analyze-print.js` before building geometry caught a showstopper.

### The baseball is a separate piece

The ball's face is **39% of the logo's area**, ringed by a white gap that escapes to the
outside near the head. Nothing holds it in. A naive extrude drops it on the floor.

Fix: the plate footprint is the silhouette **unioned with the ball disc**, so the ball
sits *on* the plate. `8-build-stl.js` asserts single-component connectivity before
building anything. Fattening shapes to close the gap instead would have welded the ball
to the body and destroyed the white ring that makes it read as a baseball.

**Anyone importing the SVG into CAD has to do this union manually.**

### Wrong metric #1 — distance-to-edge is not a thin-feature test

First pass reported **16.58%** of the body too thin. That was nonsense: every shape
tapers to zero thickness at its own boundary, so distance-to-edge flags the entire
perimeter of everything.

The honest test is a **morphological opening** — erode by half a nozzle, dilate back,
see what fails to return. Real answer: **1.61%**, confined to the wingtips and tail tip.

**Generalizes to:** if a metric flags a huge fraction of your data, suspect the metric
before the data.

---

## Phase 3 — Mesh generation

### The best debugging of the project: earcut discards collinear vertices

First build produced **over 1,000 open edges**. Not a rounding issue — a structural one.

Narrowing it down:

1. Every polygon *with holes* was short on triangles; `red` (no holes) was perfect.
2. Shortfall scaled with vertex density but never reached zero, so it was a *rate*, not
   a threshold — that ruled out epsilon tuning.
3. Definitive: `green poly0` had **134 unused vertices and exactly 134 exactly-collinear
   ones.**

**earcut filters collinear vertices before clipping ears.** Correct for a flat cap, but
side walls built from *every* contour point then reference vertices the cap skipped, so
the two surfaces cannot meet. Resampled contours are full of straight runs, hence the
scale of the failure.

The fix is `triangulateStable()`: triangulate, see which vertices earcut actually
referenced, drop the rest, repeat until stable. Caps and walls share one vertex set **by
construction** — no epsilon to tune.

**Generalizes to:** when a library silently transforms its input, downstream code that
assumes the input survived will break in ways that look like numerical error. Find out
what it actually used rather than tuning a tolerance until symptoms fade.

### Wrong metric #2 — the manifold check was lying

After the fix, 160 open edges remained. They were a **false positive in the checker**.
Where the keyring hole passes through both the plate and the relief above it, the two
solids share an identical wall, and checking a merged triangle soup double-counts those
edges. Check **per solid**. Real answer: zero.

### Two opposite import conventions in one project

- `earcut` v3 is ESM, so CommonJS finds it on **`.default`**
- `fit-curve` is the exact opposite: **`module.exports`**, not `.default`

Both are resolved explicitly and asserted at import. A bare `try/catch` around one of
these once swallowed a `TypeError` and made every layer emit an empty path.

---

## Phase 4 — The attachment

### Wrong metric #3 — the keyring spot finder was useless

The largest inscribed circle in the whole logo is dead centre of the ball, at 10.12 mm.
Perfect, except that is the *floating piece*. The real candidate was the left wing at
6.11 mm.

### The lug was on the wrong part

The first top lug sat on the flare sweeping back from the head. Measured load path:
**0.42 mm** — about one nozzle width. A thin cantilever holding the entire keychain,
good for roughly 5 kg.

Moving it down onto the dragon's back put the load into the thickest part of the
silhouette: **4.00 mm, around 53 kg**. Same look, 10x the strength.

### Wrong metric #4 — reinforcement that walked away from the shape

Before the lug moved, an attempt to thicken the flare produced material with a **9-unit
gap** between it and the flare it was supposed to reinforce.

Cause: the code read each column's runs from **the same mask it was writing to**. Each
fill merged with the flare, so the next column read a lower bottom edge and filled lower
still. The reinforcement crept downward instead of thickening anything.

Fix: plan every column against the untouched mask, then write. That code is gone now
(the lug moved instead), but the lesson stayed and `trimFlare` is built the same way.

**Note how this was found:** by double-checking a load-path minimum that landed
suspiciously at the start of the scan. The measurement turned out to be correct — but
verifying it exposed the bug.

### Cutting on a scan grid sheds crumbs

Trimming the flare left 11–17 loose fragments. Clearing a run from its *detected* top
edge leaves a one-pixel ribbon wherever the true edge falls between scan steps, and that
ribbon breaks up. Overshoot past the edge on a full cut, and have the trim keep only the
largest piece — **reporting what it dropped**, so a cut that severs something real can
never pass silently. Result: one 0.1 sq-unit speck.

### A flat cut reads as damage

Chopping the flare square looked broken. The removal now eases off over 40 units, taking
material from the *lower* edge so the upper sweep carries through to a point — matching
how the original tip converges. Same cut, completely different read.

### Hanging is physics, not placement

A hanging part rotates until its centroid is under the pivot. Centroid x = 261,
ball centre x = 298, so the top lug hangs **12.5° nose-up**. Putting the lug over the
centroid would make it hang dead level but move it off the ball. This was surfaced as a
choice rather than silently decided.

---

## Phase 5 — Colour depth

The first AMS build ran every colour the full 2.6 mm, so all 13 layers held four
filaments: about **57 tool changes**, each with its own purge, for material buried where
it is never seen.

`amscap` stops colour after 0.6 mm and fills the rest with gray. Only the top **3
layers** are multi-colour — roughly a quarter of the changes, identical appearance.

Verified before shipping: the four colours tile the face with **zero overlapping
pixels**, and the 0.01% left uncovered is scattered sub-pixel specks narrower than one
extrusion.

---

## Why the STL is built from a render, not the path data

Counter-intuitive but important. The logo has stroked seams and overlapping painted
layers. A slicer needs the *resulting filled region*, not the drawing operations.
Rendering collapses everything into exactly what you see, then one contour pass recovers
polygons with sub-pixel accuracy. `white = plate − green − gray − red` guarantees the
parts tile exactly.

---

## Traps that cost real time

- **`@resvg/resvg-js` renders transparent by default.** Transparent reads as `(0,0,0)`,
  which classifies as gray. This once made a 97% build report 32.56%. Always set
  `background: '#ffffff'`.
- **Find the background by flood-filling from the border.** The ball's face is the same
  white as the page, so a colour test alone erases it.
- **`jimp@0.22.12` uses the classic API** — default export, `new Jimp(w,h,color)`,
  `getBufferAsync`, `writeAsync`. Newer docs describe a different API.
- **PowerShell here has no `&&`, `||` or heredocs.** Use `;` and `if ($?) { }`.
- **Delete stale build artifacts rather than leaving them.** A comparison PNG from
  before a change is a trap for whoever looks next.

---

## Capabilities now available without writing new code

- **Raster logo to clean SVG** — `lib-color.js` + `lib-curve.js` + phases 1–5
- **Mask to watertight STL** — `lib-mesh.js`, handles holes, multi-shell, per-solid
  manifold verification
- **Printability audit** — `7-analyze-print.js`: connectivity, exact distance transform,
  honest thin-feature test, keyring spot finder, heatmap
- **STL preview without a slicer** — `9-preview-stl.js`, orthographic z-buffer with
  Lambertian shading, grids every variant into one contact sheet
- **Tolerance sweep with evidence** — `6-sweep-fit.js`

### Reusing this for another team's logo

Most of the pipeline is logo-agnostic. Expect to change:

1. `lib-color.js` — the hue thresholds, derived from that logo's palette
2. `3-measure-ball.js` / `3b-fit-rings.js` — specific to a baseball; drop or replace
3. `4-build-svg.js` — the assembly and z-order
4. `8-build-stl.js` — the `BALL` union, the keyring positions, `SIZE_MM`

Reusable as-is: `lib-curve.js`, `lib-mesh.js`, `7-analyze-print.js`, `9-preview-stl.js`,
and the whole render-then-contour approach.

**Start with `7-analyze-print.js`.** Finding the disconnected-piece problem before
building any geometry saved rebuilding everything.

---

## Open items

- Height and overall proportions — `SIZE_MM`, `PLATE_H`, `RELIEF_H` at the top of
  `8-build-stl.js`
- A new attachment concept to evaluate; `applyKeyring` dispatches on a mode string, so
  it is one branch plus an `OPTIONS` entry, and the manifold, hang-angle and load-path
  reporting apply automatically
- `toptab-half` chosen but not yet printed
- `5-export-layers.js` fit params never retuned; `layers/gray.svg` is heavier than its
  siblings
- Watertightness is verified for every variant. **Printability is only verified for
  `amscap-none` at 50 mm.**
