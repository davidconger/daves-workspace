# Dragons Elite Baseball — logo vectorization

Vector reconstruction of the Dragons Elite Baseball Club mark (dragonselitebbc.com),
built for 3D printing a keychain. Personal, non-commercial use — this is the club's mark.

![logo](build/render-dragons-elite-logo.png)

## What's here

| File | Use |
|---|---|
| `dragons-elite-logo.svg` | Full-colour vector. Closest match to the original. |
| `dragons-elite-logo-bold.svg` | Same, with thickened seams. **Use this one for printing.** |
| `layers/base.svg` | Full silhouette — the backing plate. |
| `layers/green.svg` | Dragon body. |
| `layers/gray.svg` | Outline and both baseball rings. |
| `layers/white.svg` | Baseball face. |
| `layers/red.svg` | Seams and the dragon's eye. |
| `source-logo-600.jpg` | Best raster available (600×600, from the club's CDN). |

All SVGs share a `0 0 600 600` viewBox, so the layers stack in perfect registration.
Every layer is a **closed filled path** — no strokes — which is what CAD and slicer
tools need in order to extrude reliably.

## Why it isn't a straight auto-trace

No vector source is published. The best raster anywhere on the site is a 600×600 JPEG,
and JPEG ringing around the high-contrast red-on-white stitching traces into confetti.

So this is a hybrid:

- **The dragon is curve-fitted** from the raster (see *Fitting smooth edges* below).
  It's an organic shape with no underlying formula, so it has to come from the image.
- **The baseball is reconstructed.** A least-squares circle fit on the source gave
  centre `(297.5, 313.2)` and these radii:

  | Feature | Radius |
  |---|---|
  | White face | 112.5 |
  | Inner gray ring | 112.5 → 122.5 |
  | White gap | 122.5 → 130.5 |
  | Outer gray ring | 130.5 → 137.5 |

  The seams are quadratic Béziers whose endpoints land exactly on the face radius
  (±84 vertically, so `√(112.5² − 84²) = 74.8` horizontally) and whose midpoints sit
  at the measured waist, 38.5 in from centre. Stitches are drawn as a fishbone —
  a continuous spine with barbs on both sides — which is what the original actually
  uses, not crossing dashes. Density and barb length were measured off an 8× crop:
  about 25 stitches across the 168 px span, each barb reaching ~5 px.

Reconstructing the ball is the right call for printing, not just a shortcut. See
**Minimum feature size** below.

## Fitting smooth edges

The hard part is fitting a curve that follows the *general* edge without chasing
pixel-level inconsistency. Tracing a binary mask can't do it: thresholding throws
away the sub-pixel information, so the tracer is stuck either following the pixel
staircase exactly or guessing at removing it afterwards. An early build upscaled
masks 4× with nearest-neighbour and traced those, which reproduced every stair step
faithfully — technically accurate, visibly jagged, and bad geometry to extrude.

`lib-curve.js` does it as a level-set problem instead:

```
binary mask
  -> Gaussian blur into a continuous scalar field
  -> extract the 0.5 isocontour with linear interpolation   (sub-pixel, no staircase)
  -> resample, detect corners, Taubin smooth
  -> fit cubic beziers
```

The blur is the whole trick. It turns the mask into a smooth field whose 0.5 level
set already sits at the average edge, and because a Gaussian of sigma `s` attenuates
detail below roughly `2s` wavelength, **sigma is a direct physical control over what
counts as noise**. The source is a 600 px JPEG carrying 1–2 px of ringing and
antialias wobble, while the narrowest real feature is the ~6 px outline band, so
`sigma = 1.4` sits in that gap. A Gaussian is symmetric, so on a straight edge the
0.5 crossing doesn't move; curved edges pull inward by about `s²/r`, well under a
pixel here.

Two details that matter:

- **Corners are detected and pinned** before smoothing, using turn angle across a
  multi-sample window. Without this the dragon's wingtips and horns get rounded off.
- **Smoothing is Taubin, not Laplacian.** A plain Laplacian pass smooths but deflates
  the shape; Taubin follows it with a slightly larger negative pass, so detail is
  removed without the contour shrinking.

## How thick should the marker be?

Think of tracing the logo by hand. A fine pen has to wobble to follow every
irregularity; a marker covers the edge in one confident stroke because the tip is
wider than the wobble. The fitting tolerance is that tip width, and it should be set
to the edge's actual positional uncertainty — no tighter.

That uncertainty is measurable. `measureEdgeWidth` in `lib-layers.js` scans the source
for transitions between the logo body and the white background and records how many
pixels the ramp takes:

```
Source edge ramp: 4px median, 6px p90  ->  edge known to about +/-2.0px
```

An early build fitted at **0.35 px**, roughly six times tighter than the source
supports, so the curve spent its control points encoding JPEG artifacts as if they
were design. `6-sweep-fit.js` sweeps the two knobs and prices that precision:

| sigma | tolerance | match | dragon segments |
|---|---|---|---|
| 2.0 | 0.35 | 97.58% | 381 |
| 2.0 | 1.5 | 97.43% | 133 |
| 2.0 | **2.5** | **97.34%** | **103** |

Going from 0.35 to 2.5 costs **0.24%** of pixel agreement and removes **73%** of the
segments. That 0.24% is agreement with noise, so the loose fit is both smaller and
more honest. Visually it is not a wash — at the tight tolerance the green edge carries
visible lumps; at 2.5 it is a single clean stroke.

Sigma is bounded the same way. It tracks the measured ramp, and past about 2.6 the
match score starts falling, which is the signal that it has stopped removing noise and
started eroding real shape.

The whole dragon silhouette is now **59 Bézier segments** (it was 790), which is
finally in the same league as the baseball's two circles and two quadratics — and that
economy is exactly what makes both read as clean.

## Two structural decisions

**The outline is a difference, not a band.** Earlier builds traced the gray outline
as its own ~6 px region. That's exactly the thin feature that smoothing erodes, and
a gap in it becomes a gap in the print. Instead, `base`/the gray layer is the full
solid silhouette with green painted on top, so the outline is the difference of two
large, well-conditioned shapes — continuous by construction.

**The ball is behind the dragon.** In the original the body crosses in front of the
rings at the upper right. Painting the ball last drew its rings across the green and
was the single largest error in the diff map.

## Accuracy

Each build is rendered back to a bitmap and diffed against the source per colour:

```
dragons-elite-logo.svg         97.34%   white 99.0%  green 98.1%  gray 91.9%  red 43.5%
dragons-elite-logo-bold.svg    97.37%   white 98.6%  green 98.1%  gray 91.8%  red 64.5%
```

Don't chase the last percent. A tighter fit scores higher only by reproducing the
source's JPEG noise, and the red score is low **by design** because the seams are
idealized and, in the bold variant, thickened. Judge the seams from
`build/cmp-seam.png` and the edges from `build/tolerance-compare.png` instead.

## STL

`node 8-build-stl.js` writes finished, watertight STLs directly. No CAD round trip,
no DXF conversion, no manual alignment.

```
stl/emboss-<option>/dragons-keychain.stl   one solid part
stl/ams-<option>/{gray,green,white,red}.stl       four parts, colour full depth
stl/amscap-<option>/{gray,green,white,red}.stl    four parts, colour in the top 3 layers
```

with `<option>` one of `none`, `winghole`, `tab`, `toptab-half`, `toptab-short`.

Every solid reports **0 open edges**. `node 9-preview-stl.js` renders them all to
`build/stl-preview-emboss.png` and `build/stl-preview-ams.png` so they can be judged
without opening a slicer.

### Prefer `amscap` over `ams`

Both give the same flush, four-colour face. The difference is depth: `ams` runs each
colour the full 2.6 mm, so **every one of the 13 layers holds four filaments** — around
57 tool changes, each with its own purge, for material buried where it is never seen.

`amscap` stops the colours after 0.6 mm and fills the rest with gray, so only the top
**3 layers** are multi-colour. Same appearance, roughly a quarter of the tool changes.

The gray STL is two stacked shells — the full-footprint base, then the gray part of the
face — which is why it is checked one shell at a time. Merged, the shared face at
`PLATE_H` would be counted twice and reported as a leak. The four colours tile the face
with **no overlaps at all**, and the 0.01% left uncovered is scattered sub-pixel specks
on the outlines, narrower than a single extrusion.

Flip it in the slicer if you want the colour against the build plate for a glossier
face. The STLs are built colour-up so the previews and raw files read the right way up.

**The geometry is built from a render of the finished SVG, not from the path data.**
That sounds like the long way round, but the logo contains stroked seams and
overlapping painted layers, and what a slicer needs is the *resulting* filled region,
not the individual drawing operations. Rendering collapses all of it into exactly the
shape you see, and one contour pass recovers it as polygons — using the same level-set
extractor as the tracing work, so it keeps sub-pixel accuracy.

### The baseball is a separate piece

This is the one thing that has to be solved before anything can be printed. The ball's
face is ringed by a white gap that escapes to the outside near the head, so nothing
holds it in. It is **39% of the logo's area**, floating free, and a naive extrude drops
it out of the print. The gap measures 0.59 mm at 50 mm scale.

The fix is the backing plate: the plate footprint is the silhouette **unioned with the
ball disc** (r = 137.5 from the fitted centre), so the ball sits *on* the plate instead
of floating in it. `8-build-stl.js` asserts the footprint is a single connected
component before it builds anything. Closing the gap by fattening shapes instead would
have welded the ball to the body and destroyed the white ring that makes it read as a
baseball.

### Thin features are fine

An early check reported 16.58% of the body as too thin, which was wrong.
Distance-to-edge counts *every* boundary as thin, because all shapes taper to zero
thickness at their own edge. The honest test is a morphological opening — erode by half
a nozzle, dilate back, and see what fails to return:

| Limit | Lost at 50 mm |
|---|---|
| 1 nozzle, 0.40 mm | 0.31% |
| 2 walls, 0.80 mm | 1.61% |
| 3 walls, 1.20 mm | 3.82% |

The loss is confined to the wingtips and the tail tip, which print slightly blunted.
Run `node 7-analyze-print.js` for the heatmap.

### Choosing a variant

**emboss** is one solid part: a 2.0 mm backing plate carrying the whole footprint, with
the green body and red seams standing 0.6 mm proud. Prints in a single material; add
colour with a filament swap at the 2.0 mm step, or leave it as a relief.

**ams** is one STL per colour, all 2.6 mm tall so the face is flush. The four parts
tile the footprint exactly with no overlaps. Import them together as a multi-part
object and assign a filament to each.

**Keyring**: all five options use a 3 mm hole, which clears the 1.5 mm wire of a
standard split ring.

| Option | Hangs | Load path | Notes |
|---|---|---|---|
| `none` | — | — | No attachment. Magnet, stand, or your own hole |
| `winghole` | 76° off upright | 6.1 mm of stock | Invisible, adds no shape |
| `tab` | 80° off upright | full body | Lug on the left edge, not part of the logo |
| `toptab-half` | 12.5° off upright | 4.0 mm, ~53 kg | Lug on the dragon's back, flare cut to half |
| `toptab-short` | 12.5° off upright | 4.0 mm, ~53 kg | Same, flare cut back further |

The wing hole sits at the point of maximum material in the left wing, found by distance
transform. The largest inscribed circle in the whole logo is dead centre of the ball,
which is useless, because that is the floating piece.

### Where the top lug goes, and why the flare gets cut

The top lug exists so the logo hangs the way it is drawn, so it sits directly over the
centre of the ball and merges into the dragon's back. That matters structurally as well
as visually: the flare sweeping back from the head passes through the same area, and it
is only **0.42 mm** thick — about one nozzle width. A lug hung on the flare is a thin
cantilever carrying the entire keychain, and measured out at roughly 5 kg. Moving it
down onto the back puts the load into the thickest part of the silhouette instead:
**4.0 mm**, around 53 kg.

That leaves the flare running over the top of the lug, so it is shortened. The cut is
not a rectangle — the head rises into the same band further right, so a rectangular
crop clips it. Each column's first run is measured instead and removed only if it is
thin enough to be flare. Past the cut point the removal eases off over 40 units, taking
material from the *lower* edge so the upper sweep carries through to a point. A flat
chop reads as damage; a taper reads as the original artwork, which converges the same
way.

**A hanging part rotates until its centroid is under the pivot.** The centroid sits at
x = 261, about 3 mm left of the ball centre at x = 298, so the top lug variants hang
12.5° nose-up rather than dead level. Putting the lug over the centroid instead would
make the tilt zero by construction, at the cost of the lug no longer being centred on
the ball. Change `const cx = BALL.cx` in `applyKeyring` to swap.

To change size, edit `SIZE_MM` in `8-build-stl.js`.

## Minimum feature size

At a 50 mm keychain, `600 px ≈ 50 mm`, so **1 px ≈ 0.083 mm**.

| Feature | Source | At 50 mm | Printable? |
|---|---|---|---|
| Original stitch stroke | ~4 px | 0.33 mm | No |
| `dragons-elite-logo.svg` seam | 3–3.5 px | ~0.29 mm | No, display only |
| `dragons-elite-logo-bold.svg` seam | 5.5–6.5 px | ~0.5 mm | Yes, embossed |
| Two-perimeter colour change | ~10 px | 0.8 mm | Yes |

The STL builds use the **bold** variant for exactly this reason. With a 0.4 mm nozzle a
slicer needs roughly 0.5 mm to lay down a solid feature, and about 0.8 mm before a
colour change reads cleanly. **Print at 60 mm or larger if you want crisp red seams.**

## Importing the SVG elsewhere

If you'd rather build the solid in CAD than use the generated STLs:

- **Fusion 360** — `Insert → Insert SVG` onto a sketch plane, scale to 50 mm wide,
  extrude the base 2 mm and the detail layers 0.6 mm more.
- **Blender** — `File → Import → Scalable Vector Graphics`, then
  `Object Data Properties → Geometry → Extrude`. Blender imports SVG at 1 unit = 1
  metre, so scale up by 1000 before exporting.
- **Tinkercad** — import `layers/base.svg` as the plate, then each colour layer on top.
  Every layer shares the same viewBox, so centred imports land correctly.

In all of these you must still union the ball disc into the plate yourself, or the ball
will drop out. That is the whole reason `8-build-stl.js` exists.

## Rebuilding

Node 24, no Python needed.

```powershell
npm install
node 2-trace-layers.js    # colour split + curve fitting -> build/paths.json
node 3b-fit-rings.js      # circle fit, prints the BALL constants
node 4-build-svg.js       # assembles both SVGs, scores against the source
node 5-export-layers.js   # exports layers/ as filled paths
node 6-sweep-fit.js       # optional: re-derive the fitting tolerance
node 7-analyze-print.js   # connectivity + minimum feature check
node 8-build-stl.js       # writes stl/, watertight
node 9-preview-stl.js     # renders stl/ to build/stl-preview.png
```

Shared modules:

- `lib-color.js` — the colour classifier.
- `lib-layers.js` — mask construction, cleanup, and the edge-width measurement.
- `lib-curve.js` — level-set contour extraction, smoothing and Bézier fitting.
- `lib-mesh.js` — polygon assembly, triangulation, extrusion and STL output.

The first three are shared by every phase specifically so the trace, the sweep and the
layer export cannot drift apart.

Diagnostics:

```powershell
node crop-compare.js dragons-elite-logo.svg 205 210 95 200 5 cmp-seam
```

Crops the same region from the source and from a rendered SVG and stacks them, which
is how the seam and outline work was validated. Arguments are
`<svg> <x> <y> <w> <h> <zoom> <name>` in 600-unit space.

### Notes for future work

- **Classify by measured hue, thresholded at the true 50% mix.** Nearest-RGB fails
  outright: the midpoint of a green→white antialiased edge is `(165,224,147)`, nearer
  mid-gray than either parent, which paints a false gray halo along every green edge.
  A "chroma first" rule fixes the halo but puts the green/gray boundary out in the
  shallow tail of the gradient where noise dominates, giving a visibly ragged mask.
  `lib-color.js` uses `greenness = g - (r+b)/2` and `redness = r - (g+b)/2` cut at half
  their pure-colour values, which lands the boundary where the gradient is steepest.
- **Find the background by flood-filling from the image border.** The baseball's face
  is the same white as the backdrop, so "white == background" carves a hole in the logo.
- `@resvg/resvg-js` renders a **transparent** background by default, which reads as
  `(0,0,0)` and scores as gray. Always pass `background: '#ffffff'` when diffing. This
  once made a 97% build report 32%.
- **Don't wrap a fitting call in a bare `try/catch`.** `fit-curve` exports the function
  as `module.exports`, not `.default`; importing it wrong threw a `TypeError` that a
  catch swallowed, and every layer silently emitted an empty path.
- **Measure the source's precision before choosing a fit tolerance.** Fitting tighter
  than the edge ramp is overfitting, and it shows up as visible wobble even though the
  match score says it is more accurate.
- **`earcut` discards collinear vertices before it clips ears.** That is correct for a
  flat cap, but side walls built from every contour point then reference a vertex the
  cap skipped, leaving a hole in the solid exactly there. On resampled contours, which
  contain long straight runs, this produced over a thousand open edges. `lib-mesh.js`
  triangulates, checks which vertices earcut actually referenced, drops the rest and
  repeats, so caps and walls share one vertex set by construction — no epsilon to tune.
- **`earcut` is published as ESM, so CommonJS finds it on `.default`. `fit-curve` does
  the exact opposite.** Two libraries in the same project, two conventions. Resolve
  both explicitly and assert.
- **Check each solid separately for open edges.** Where the keyring hole passes through
  both the plate and the relief above it, the two solids share an identical wall, and a
  check over the merged triangle soup double counts those edges and reports a leak that
  isn't there.
- **Distance-to-edge is not a thin-feature test.** Every shape tapers to zero thickness
  at its own boundary, so that metric flags the entire perimeter. Use a morphological
  opening instead: it reported 1.61% where the naive measure claimed 16.58%.
- **Never read a mask you are in the middle of writing.** An earlier version of the
  flare edit read each column's runs from the same mask it was filling, so every fill
  merged with the flare, the next column read a lower edge and filled lower again, and
  the reinforcement walked away from the shape it was supposed to thicken. Plan every
  column against the untouched mask first, then write.
- **Cutting along a scan grid sheds crumbs.** Clearing a run from its detected top edge
  leaves a one-pixel ribbon wherever the true edge falls between scan steps, and that
  ribbon breaks into loose fragments. Overshoot past the edge on a full cut, and have
  the trim discard everything but the largest piece — *reporting* what it dropped, so a
  cut that severs something real can never pass silently.
