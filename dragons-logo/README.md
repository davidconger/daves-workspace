# Dragons Elite Baseball — logo vectorization

Vector reconstruction of the Dragons Elite Baseball Club mark (dragonselitebbc.com),
built for 3D printing keychains and pendants. Personal, non-commercial use — this is
the club's mark.

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
no DXF conversion, no manual alignment. It builds a table of **products**, each pinned
to a real-world size on a named axis:

```
stl/keychain-56mm/emboss/{plate,green,red}.stl        + dragons-combined.stl
stl/keychain-56mm/amscap/{gray,green,white,red}.stl
stl/pendant-223mm-flush/amscap/{gray,green,white,red}.stl
stl/pendant-223mm-tiered/tiered/{gray,white,red,green}.stl
```

| Product | Size | Thick | Mount |
|---|---|---|---|
| `keychain-56mm` | 56 mm tall × 69.5 mm | 5.6 mm | internalised slot |
| `pendant-223mm-flush` | 223 mm wide × 178.3 mm | 15.0 mm | 33 mm chain bail, 23.5 mm hole |
| `pendant-223mm-tiered` | 223 mm wide × 178.3 mm | 15.0 mm | 33 mm chain bail, 23.5 mm hole |

The pendants measure 178.3 mm rather than the artwork's 179.6 mm because the flare
sweeping back from the head is cut short to clear the chain; the loop then becomes the
highest point.

Every shell reports **0 open edges**. Each style folder also gets a `manifest.json`
recording the final size and the mount's coordinates *after* recentring, which is what
lets the diagnostics cut a section through the mount without guessing where it is.

`node 9-preview-stl.js` renders each product to `preview/<product>.png`, including
true cross-sections through the mount.

### Artwork scales; hardware does not

The obvious way to resize is to scale the model in the slicer. That is wrong here.
Going from 50 mm to 56 mm would drag the keyring pocket from 4.0 mm to 4.5 mm and the
backing plate from 5.0 mm to 5.6 mm — but a split ring is the same wire whatever size
the logo is, and 5 mm of plate is 5 mm because that is what it takes to print stiff.

So `K` (millimetres per SVG unit) is derived per product from the silhouette's own
bounding box, and **every mount dimension is stored in millimetres and converted at
draw time**. Only the drawing scales.

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

**emboss** is one solid part: a 5.0 mm backing plate carrying the whole footprint, with
the green body and red seams standing 0.6 mm proud. Prints in a single material; add
colour with a filament swap at the 5.0 mm step, or leave it as a relief.

**amscap** is one STL per colour, flush at the top. Import them together as a
multi-part object and assign a filament to each.

**tiered** steps each colour to its own height above a common base, back of the image
to front — gray keyline lowest, then white ball, then red seams, then the green dragon
highest. Copied from the Mariners reference plaque.

### The internalised mount

Copied off the previous Issaquah keychain rather than invented. It is not a ring and
not a hole: it is a **half-disc pocket buried in the middle of the plate's thickness**,
opening at the outer edge, with a post standing across the mouth for the split ring to
loop around. Nothing protrudes and **nothing shows on either face** — the drawn
silhouette survives completely intact, flare and all.

Decoded from `Copy of Issaquah.stl` by grouping its triangles into axis-aligned planes
and reading the extents off directly:

| | Issaquah original | this build |
|---|---|---|
| pocket radius | 4.0 mm, centred on the edge | same |
| solid floor / roof | 1.0 mm each | same |
| post | 2.0 × 1.4 mm | 2.00 × 1.36 mm |
| opening each side | 3.0 mm | 2.94 / 2.96 mm |
| pocket behind the post | 2.75 mm | 2.64 mm |
| channel height | 4.0 mm (6 mm plate) | 3.02 mm (5 mm plate) |

It is built as three stacked extrusions: full plate for the floor, plate-minus-pocket
plus the post for the middle, full plate again for the roof. In plan the post is an
**island**, unconnected to anything; through the thickness it is a solid post from
build plate to top face, bonded to the floor below and the roof above. That is why the
strength figure is a shear area (5.6 mm² along the layer lines), not a beam
calculation — an earlier version of this README got that wrong.

**The bar has to be turned to match the edge.** Issaquah's mount sits on the flat top
of a letter `I`, so an axis-aligned post lands square in the mouth. The dragon's back
slopes 13.8° where the mount goes, and an axis-aligned post there measured **1.46 mm
of opening one side against 2.94 mm the other** — too tight for a 1.5 mm split-ring
wire. Fitting the local edge slope and rotating the post to lie across the chord
restores it to 2.94 / 2.96 mm. The pocket itself is a circle, so it needs no rotation.

### Where the mount goes: hanging is physics

**A hanging part rotates until its area centroid is directly below the pivot.** The
centroid is at x = 261, about 3 mm left of the ball's centre at x = 298, so mounting
over the ball — the intuitive choice — tips the keychain **14.7° nose-up**.

Both the slot and the chain loop are therefore placed at the centroid's own x, and both
hang **dead level** by construction. The loop keeps working because a disc centred on
the balance line adds material symmetrically about it, so it cannot shift the balance
it was placed to satisfy.

The slot also needs the mount to sit somewhere with material behind it. Measured across
the whole candidate window, the dragon's back carries **35–39 mm of continuous solid**
below the edge — ample for an 8 mm pocket.

### The chain loop

The first version was invented — 22 mm across with a 12 mm hole — and it was wrong twice
over: too small for the chain actually in use, and sunk in a way that bit a notch out of
the green band running along the dragon's back. It was replaced by the bail off the
**Issaquah pendant**, which was sized to that chain, and measured rather than eyeballed.

Finding it took some digging. `Copy of Issaquah.3mf` turned out to be the *keychain*
plate — 17 copies of the "I", no loop. `Issaquah (3).3mf` has the pendant; its
`Metadata/top_1.png` thumbnail shows the bail immediately, and its two build items scale
by 0.56 and 0.59 in XY. `measure-loop.js` slices a mesh at a z-plane, scanline-fills the
closed section loops, then flood-fills the background so that any pocket which never
reaches the border is reported as a genuine hole. Run over each object in the 3mf:

| | size (model units) | hole |
| --- | --- | --- |
| `object_3.model` object 3 | 140 × 399 × 14 | 42.0 × 30.4, one |
| `object_6.model` object 6 | 120 × 377 × 15 | none |

399 × 0.56 = 223.4 mm, which is the pendant, so object 3 at 0.56 is the one. Dumping the
filled section as a PNG shows a rounded arch, and scanning it row by row shows it is
something simpler — **two exactly concentric circles**, outer r29.5 and inner r21 centred
9.6 units above the letter's top edge, holding to a tenth of a unit all the way round:

| y | measured half width | circle r29.5 at (0, 170) |
| --- | --- | --- |
| 192.7 | 19.0 | 18.8 |
| 170.0 | 29.4 | 29.5 |
| 161.5 | 28.2 | 28.2 |

After the 0.56: a **23.5 mm hole in a 4.8 mm wall, 33 mm across**. Like the slot, those
figures are stored in millimetres and converted at draw time, because a chain is the same
chain whatever the logo is scaled to.

**One deliberate difference.** Issaquah sinks the *hole* 6.4 mm (scaled) below the
silhouette edge, so the arch's legs land on the edge and the flat top of the "I" forms
the hole's floor. Repeating that on the dragon would cut straight through the green,
because the gray keyline it would have to stay inside is only about **3 mm** deep there.
So `embed` is set equal to the wall instead, which puts the hole exactly **tangent** to
the edge. It costs nothing: the opening becomes a full 23.5 mm circle rather than
Issaquah's 23.5 × 17.0 mm arch — if anything more generous — and the joint into the body
is still a **23.1 mm chord**.

### The loop grows out from behind the artwork

The original `addLug` painted its disc gray and erased every other colour across the
whole disc. On a lug hanging off an edge that is invisible; on a loop deliberately sunk
into the body it erased a lune of green and left a notch in the band along the dragon's
back. The fix is a `behind` mode that paints gray **only where the plate was empty
before** and erases nothing, so the green curve carries on unbroken and the loop reads as
emerging from behind it.

Because the previous build failed at exactly this point, it is now counted rather than
trusted: the ring branch snapshots every colour mask, and the build prints how much of
each was lost inside the lug. Anything but zero on a drawn colour is the notch coming
back.

### The feed slot

A closed ring has to be threaded onto the chain while the chain is open. The Issaquah
bail is not closed — it is **split at 12 o'clock**, so a link can be fed in sideways. The
first pass here missed that and copied the ring as a plain annulus.

The split announced itself as an *absence*. Running the hole finder across all 21
Issaquah STLs, `Issaquah (14).stl` is dimensionally identical to `(6)` and `(9)` —
120 × 377 × 15 — but reports **zero enclosed holes**, because the cut lets the flood fill
escape. `(10)` and `(11)` are the bail on its own, 59 × 59 × 8 mm, and differ from each
other the same way. "No hole" was the measurement.

Sectioning at successive z-planes showed a radial cut centred on the ring's centre line
but could not explain its shape, because **the profile varies through the thickness** and
every section was taken across it. `measure-loop.js` gained an `AXIS` option that
permutes the coordinates so the same code can cut edge-on, and the answer was immediate:
the two ends are each chamfered to a point at mid-depth, so the gap is an **hourglass**.
Measured at the wall, in model units:

| z | 14.50 | 15.57 | 16.64 | **17.71** | 18.79 | 19.86 | 20.93 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| gap | 9.20 | 6.80 | 4.80 | **2.40** | 3.60 | 5.60 | 8.00 |

Both branches are straight and meet exactly at the middle, so it is a true V rather than
a channel: **6.0 mm at each face, pinching to a 1.42 mm throat**. A link is sprung past
the throat and then cannot fall back out.

**What gets copied is the mouth and the throat, not the angle.** Those two numbers are
what a link has to pass, and they are proven against the chain he actually uses. The
reference achieves them across an 8 mm ring; ours is the full 15 mm, so holding the
*angle* instead would force a mouth of about 10 mm on a 33 mm ring. Keeping the
dimensions and letting the angle fall out gives 17° here against the reference's 30°,
which only means a longer, gentler funnel.

Implementing it needs geometry rather than a mask, since a plan mask has no way to say
"narrower in the middle". The slot is cut at its full mouth width in every colour mask,
and two triangular prisms are added back, tapering to the throat at mid-depth. They are
deliberately sunk 0.8 mm into the ring: a slicer welds an overlap reliably, whereas two
exactly coincident faces are a coin toss.

Measured back off the finished mesh, which is the only thing that counts:

| depth (mm) | 1.6 | 3.1 | 4.5 | 6.0 | **7.5** | 9.0 | 10.5 | 11.9 | 13.4 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gap (mm) | 6.15 | 5.10 | 3.90 | 2.60 | **1.40** | 2.60 | 3.90 | 5.10 | 6.15 |

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

The pendants need the same cut, for a blunter reason: the loop lands on the edge at
x = 261 and the untrimmed flare runs out to x = 255, straight over the top of it, so a
chain through the hole would foul it. Scanning the render for where the neighbouring
features end gives the number to cut to:

| feature | leftmost x |
| --- | --- |
| flare, untrimmed | 255 |
| lower spike | 343 |
| upper spike | 357 |

Cutting to **322** leaves the flare reaching about 20 units — 8 mm at pendant scale —
past the nearer spike, which is the "little bit further" it reads as in the drawing, and
clears the loop by a wide margin. The trim sweeps up two fragments of 0.08 mm², which is
grid dust rather than anything real; the build prints their area so a cut that severed
something would show as a figure far too large to be a speck.

**A hanging part rotates until its centroid is under the pivot.** The centroid sits at
x = 261, about 3 mm left of the ball centre at x = 298, so the top lug variants hang
12.5° nose-up rather than dead level. The slot and ring mounts sit on the centroid
instead and hang level; `balanceX()` is the one-line difference.

To change size or thickness, edit the `PRODUCTS` table at the top of
`8-build-stl.js` — `sizeMm`, the axis it is pinned to, `plateH` and `reliefH`.
Issaquah's own base is **6.0 mm**, not 5.0 mm, and its total is 9.0 mm against this
build's 5.6 mm; raising `plateH` is a one-number change if an exact match is wanted.

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
node 8-build-stl.js       # writes stl/<product>/<style>/, watertight
node 9-preview-stl.js     # renders each product to preview/<product>.png
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
node verify-slot.js [stl/keychain-56mm/emboss]
```

Probes the **built mesh** for the mount's solid and void bands by ray parity, along the
edge rather than along x, and reports the openings either side of the post. This is the
check that caught the axis-aligned post sitting off-centre in a sloping mouth.

```powershell
node probe-balance.js     # centroid x, and the solid depth available for a pocket
node mount-dims.js        # groups an STL into axis-aligned planes; how Issaquah was decoded
node measure-issaquah.js  # shell decomposition + signed volume per shell
node probe-mount.js       # ASCII cross-sections of a reference STL
node measure-pendants.js  # pendant bounds (its chain-hole detection is unreliable)
```

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
