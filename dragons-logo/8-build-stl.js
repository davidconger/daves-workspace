// Phase 8: build printable STLs from the finished logo.
//
// Two styles, because they solve different problems:
//
//   emboss - one solid part. A backing plate carries the whole footprint, with
//            the green body and red seams standing proud of it. Prints in a
//            single material; colour can be added with filament swaps at the
//            step height, or left as a relief.
//
//   ams    - one STL per colour, all the same height so the face is flush.
//            The four parts tile the footprint exactly with no overlaps, which
//            is what a multi-material printer wants.
//
// Both styles must solve the same structural problem: the baseball face is a
// free-floating disc in the artwork, ringed by a white gap that escapes to the
// outside near the head. Nothing holds it in. The backing plate is what holds
// it, so the plate footprint is the silhouette unioned with the ball disc.

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { classify, WHITE, GREEN, GRAY, RED } = require('./lib-color');
const { cleanMask } = require('./lib-layers');
const mesh = require('./lib-mesh');

const SRC_SVG = 'dragons-elite-logo-bold.svg';
const S = 600;          // SVG user units
const SS = 3;           // supersample factor for the render
const PAD = 60;         // working margin in SVG units, room for a keyring tab
const W = (S + 2 * PAD) * SS;

// Scale is per-product, not global. The artwork scales but the hardware does
// not: a pendant four times the size of the keychain still hangs on a real
// chain, and a plate still has to be thick enough to survive a pocket. So
// millimetre-denominated features are converted through MM at draw time rather
// than baked in as SVG constants.
let K = 50 / S;   // millimetres per SVG unit
let MM = 1 / K;   // SVG units per millimetre

// Ball outer edge = rOuter 134.0 + wOuter 7.0 / 2. Anything inside this radius
// is baseball, and unioning it into the plate is what stops the face dropping
// out of the print.
const BALL = { cx: 297.51, cy: 313.23, r: 137.5 };

// Thicknesses, also per-product. Set by configure() before anything is drawn.
let PLATE_H = 5.0;    // solid backing below the face
let RELIEF_H = 0.6;   // how far the face stands proud, and how deep colour runs
let FLUSH_H = 5.6;    // total height

/**
 * What actually gets built.
 *
 * `sizeMm` is pinned to a named axis because the two products were specified
 * differently and the logo is landscape: the keychain was asked for by height,
 * the pendant by width. Anchoring each to the axis it was specified on avoids a
 * silent aspect-ratio mistake.
 *
 * Measured off the references: the Issaquah keychain is a 6.0mm base with a
 * 3.0mm raised layer; its pendant, as placed in "Issaquah (3).3mf", is 70.8 x
 * 222.4mm with the top layer 15mm thick, and the Mariners concept is 12.8mm.
 */
const PRODUCTS = [
  {
    name: 'keychain-56mm',
    axis: 'h', sizeMm: 56,
    plateH: 5.0, reliefH: 0.6,
    mount: 'slot',
    styles: ['emboss', 'amscap'],
  },
  {
    name: 'pendant-223mm-flush',
    axis: 'w', sizeMm: 223,
    plateH: 14.4, reliefH: 0.6,   // 15.0mm total, colour only in the top 0.6
    mount: 'ring',
    styles: ['amscap'],
  },
  {
    name: 'pendant-223mm-tiered',
    axis: 'w', sizeMm: 223,
    plateH: 11.4, reliefH: 0.6,
    mount: 'ring',
    styles: ['tiered'],
    // Lowest to highest, back of the image to front: the gray keyline is the
    // frame, the ball sits inside it, the seams sit on the ball, and the dragon
    // stands in front of all of it. Heights are above the base plate.
    tiers: { gray: 0.0, white: 1.2, red: 2.4, green: 3.6 },
  },
];

// Keyring geometry, in SVG units (1 unit = 0.0833mm at 50mm wide). All options
// use a 3mm hole, which clears the 1.5mm wire of a standard split ring.
const HOLE = { x: 90, y: 247, r: 18 };            // straight through the wing
const TAB = { x: 22, y: 247, r: 40, hole: 18 };   // lug off the left edge

// Top lug, for hanging the logo the way it is drawn: directly over the centre of
// the ball and merged into the dragon's back, so the load runs into the thickest
// part of the silhouette instead of the thin flare. `embed` is how deep the lug
// sinks into the back, which sets the width of that joint. The flare is cut back
// to clear it, and `trim` is how far right that cut runs.
const TOPTAB = { r: 42, hole: 18, embed: 22, trim: { half: 350, short: 372 } };

// Internalised mount, copied off the Issaquah keychain rather than invented.
// Decoded from "Copy of Issaquah.stl": a half-disc pocket of radius exactly
// 4.0mm centred on the outer edge, with a 2.0 x 1.4mm bar across its mouth for
// the split ring to loop around, buried under 1.0mm of solid above and below.
// Nothing protrudes, so the drawn outline is left completely intact.
//
// Every figure is in millimetres and converted at draw time, because a keyring
// is the same size whatever the logo is scaled to.
const SLOT = { r: 4.0, barW: 2.0, barD: 1.4, wall: 1.0 };

// Pendant mount: a real protruding loop, as both references use. A 12mm hole
// takes a heavy curb chain, which the 6mm slot channel could never do.
const RING = { outer: 11.0, hole: 6.0, embed: 5.0 };


const toMask = (x, y) => [(x + PAD) * SS, (y + PAD) * SS];

function disc(mask, cx, cy, r, value) {
  const [mx, my] = toMask(cx, cy);
  const mr = r * SS;
  const x0 = Math.max(0, Math.floor(mx - mr)), x1 = Math.min(W - 1, Math.ceil(mx + mr));
  const y0 = Math.max(0, Math.floor(my - mr)), y1 = Math.min(W - 1, Math.ceil(my + mr));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (Math.hypot(x - mx, y - my) <= mr) mask[y * W + x] = value;
    }
  }
}

function rect(mask, x0, y0, x1, y1, value) {
  const [ax, ay] = toMask(x0, y0);
  const [bx, by] = toMask(x1, y1);
  for (let y = Math.max(0, Math.round(ay)); y <= Math.min(W - 1, Math.round(by)); y++) {
    for (let x = Math.max(0, Math.round(ax)); x <= Math.min(W - 1, Math.round(bx)); x++) {
      mask[y * W + x] = value;
    }
  }
}

/** Area centroid, in SVG units. A hanging part rotates until this sits directly
 *  below the pivot, so it is what actually decides the hang angle. */
function centroid(mask) {
  let n = 0, sx = 0, sy = 0;
  for (let i = 0; i < W * W; i++) {
    if (!mask[i]) continue;
    n++; sx += i % W; sy += (i / W) | 0;
  }
  return [sx / n / SS - PAD, sy / n / SS - PAD];
}

/** Vertical midpoint of the first run of material down a column, in SVG units. */
function firstRunCentre(mask, x, yFrom, yTo) {
  let start = null;
  for (let y = yFrom; y <= yTo; y += 0.5) {
    const [mx, my] = toMask(x, y);
    const on = mask[Math.round(my) * W + Math.round(mx)];
    if (on && start === null) start = y;
    else if (!on && start !== null) return (start + y) / 2;
  }
  return start === null ? null : (start + yTo) / 2;
}

/** Runs of material down a column, in SVG units. */
function columnRuns(mask, x, yFrom, yTo) {
  const runs = [];
  let start = null;
  for (let y = yFrom; y <= yTo; y += 0.5) {
    const [mx, my] = toMask(x, y);
    const on = mask[Math.round(my) * W + Math.round(mx)];
    if (on && start === null) start = y;
    else if (!on && start !== null) { runs.push([start, y]); start = null; }
  }
  if (start !== null) runs.push([start, yTo]);
  return runs;
}

/**
 * Narrowest horizontal section of material across a band of rows.
 *
 * This is the load path for a top lug: everything hung on the keyring is carried
 * by the material between the hole and the dragon's back, so its thinnest row
 * decides whether the keychain survives being yanked out of a pocket.
 */
function jointWidth(mask, x0, x1, y0, y1) {
  let min = Infinity, at = null;
  for (let y = y0; y <= y1; y += 0.5) {
    let w = 0;
    for (let x = x0; x <= x1; x += 0.5) {
      const [mx, my] = toMask(x, y);
      if (mask[Math.round(my) * W + Math.round(mx)]) w += 0.5;
    }
    if (w > 0 && w < min) { min = w; at = y; }
  }
  return { mm: min * K, at };
}

/**
 * Top edge of the main body in a column, skipping the thin flare above it.
 * Anything starting above y=110 is flare or horn, not body.
 */
function bodyTop(mask, x) {
  for (const [a] of columnRuns(mask, x, 0, 260)) if (a > 110) return a;
  return null;
}

/**
 * Shorten the thin flare trailing back from the head, ending it in a point.
 *
 * Cutting a rectangle out instead would clip into the head where it rises above
 * the same band, so each column's first run is identified and only removed if it
 * is thin enough to be the flare. Past the cut the removal eases off over
 * `taper`, taking material from the lower edge so the upper sweep carries
 * through to a tip, matching how the original tip converges rather than leaving
 * a flat chop. Planned before writing, so that clearing one column cannot change
 * what the next column reads.
 */
function trimFlare(m, x0, x1, taper = 40) {
  const plan = [];
  for (let x = x0; x <= x1 + taper; x += 0.5) {
    const runs = columnRuns(m.plate, x, 0, 200);
    if (!runs.length) continue;
    const [a, b] = runs[0];
    if (a > 110 || b - a > 30) continue; // body or head, leave alone
    // Overshoot upward only where the whole run is going, so a top edge landing
    // between scan steps cannot leave a ribbon behind; inside the taper the cut
    // starts mid-run, where there is nothing above to miss.
    const cut = x <= x1 ? 1 : 1 - (x - x1) / taper;
    plan.push([x, cut >= 1 ? a - 1 : b - (b - a) * cut, b]);
  }
  for (const [x, a, b] of plan) {
    for (const k of Object.keys(m)) rect(m[k], x, a, x + 0.5, b + 1, 0);
  }
  return keepLargest(m);
}

/**
 * Drop everything but the largest piece of the plate, from every layer.
 *
 * Cutting along a curve on a half-unit grid leaves specks behind where the
 * tapering tip falls between samples, and a speck is a loose fragment in the
 * slicer, not a design decision. Whatever is discarded is returned rather than
 * swallowed, so a cut that severs something real cannot pass silently.
 */
function keepLargest(m) {
  const parts = components(m.plate);
  if (parts.length <= 1) return [];
  parts.sort((a, b) => b.length - a.length);
  const dropped = parts.slice(1);
  for (const part of dropped) {
    for (const s of part) for (const k of Object.keys(m)) m[k][s] = 0;
  }
  return dropped.map((p) => p.length / (SS * SS));
}

/** Connected pieces of a mask, each as its list of pixel indices, largest first. */
function components(mask) {
  const seen = new Uint8Array(W * W);
  const parts = [];
  for (let s = 0; s < W * W; s++) {
    if (!mask[s] || seen[s]) continue;
    const part = [];
    const st = [s];
    seen[s] = 1;
    while (st.length) {
      const p = st.pop();
      part.push(p);
      const x = p % W;
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        if (q < 0 || q >= W * W) continue;
        if (Math.abs((q % W) - x) > 1) continue;
        if (mask[q] && !seen[q]) { seen[q] = 1; st.push(q); }
      }
    }
    parts.push(part);
  }
  return parts.sort((a, b) => b.length - a.length);
}

async function renderMasks() {
  const svg = fs.readFileSync(SRC_SVG);
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: S * SS },
    background: '#ffffff',
  }).render().asPng();

  const Jimp = require('jimp');
  const img = await Jimp.read(png);
  const rw = img.bitmap.width;

  const cls = new Uint8Array(W * W).fill(WHITE);
  const off = PAD * SS;
  img.scan(0, 0, rw, rw, function (x, y, idx) {
    const d = this.bitmap.data;
    cls[(y + off) * W + (x + off)] = classify(d[idx], d[idx + 1], d[idx + 2]);
  });

  // Background is what the border floods into. The ball's face is the same
  // white as the page, so this is the only safe way to tell them apart.
  const bg = new Uint8Array(W * W);
  const st = [];
  for (let x = 0; x < W; x++) st.push(x, (W - 1) * W + x);
  for (let y = 0; y < W; y++) st.push(y * W, y * W + W - 1);
  while (st.length) {
    const i = st.pop();
    if (bg[i] || cls[i] !== WHITE) continue;
    bg[i] = 1;
    const x = i % W, y = (i / W) | 0;
    if (x > 0) st.push(i - 1);
    if (x < W - 1) st.push(i + 1);
    if (y > 0) st.push(i - W);
    if (y < W - 1) st.push(i + W);
  }

  const m = (test) => {
    const a = new Uint8Array(W * W);
    for (let i = 0; i < W * W; i++) if (test(i)) a[i] = 1;
    return a;
  };

  const plate = m((i) => !bg[i]);
  disc(plate, BALL.cx, BALL.cy, BALL.r, 1);

  const green = m((i) => cls[i] === GREEN);
  const red = m((i) => cls[i] === RED);
  const gray = m((i) => cls[i] === GRAY);
  const white = m((i) => plate[i] && !green[i] && !red[i] && !gray[i]);

  for (const a of [plate, green, red, gray, white]) {
    cleanMask(a, W, W, 40 * SS * SS, 40 * SS * SS);
  }
  return { plate, green, red, gray, white };
}

/**
 * The x a mount has to sit on for the piece to hang the way the logo is drawn.
 *
 * A hanging part rotates until its area centroid is directly below the pivot,
 * so this is simply the centroid's own x - not the middle of the ball, which is
 * 36 units to the right of it and tips the keychain about 14 degrees over.
 */
function balanceX(plate) {
  return centroid(plate)[0];
}

/**
 * Apply a keyring option. Returns the modified masks plus the hole centre, so
 * the hang angle can be checked against the finished footprint.
 *
 * The top lug variants differ only in how far the flare trailing back from the
 * head is cut away before the lug is merged onto it.
 */
function applyKeyring(masks, mode) {
  const out = {};
  for (const [k, v] of Object.entries(masks)) out[k] = Uint8Array.from(v);

  if (mode === 'none') return { masks: out, hole: null };

  if (mode === 'winghole') {
    for (const k of Object.keys(out)) disc(out[k], HOLE.x, HOLE.y, HOLE.r, 0);
    return { masks: out, hole: [HOLE.x, HOLE.y] };
  }

  if (mode === 'tab') {
    addLug(out, TAB.x, TAB.y, TAB.r, TAB.hole);
    return { masks: out, hole: [TAB.x, TAB.y] };
  }

  if (mode.startsWith('toptab')) {
    // Cut the flare back before the lug goes on, so the column scan reads the
    // original silhouette rather than the lug it is about to sit next to.
    const variant = mode.split('-')[1];
    const dropped = trimFlare(out, 200, TOPTAB.trim[variant]);

    // Directly over the centre of the ball, merged into the dragon's back.
    const cx = BALL.cx;
    const top = bodyTop(out.plate, cx);
    const y = top + TOPTAB.embed - TOPTAB.r;
    addLug(out, cx, y, TOPTAB.r, TOPTAB.hole);

    return { masks: out, hole: [cx, y], dropped };
  }

  if (mode === 'slot') {
    // Nothing is added to the outline and nothing is cut through it: the pocket
    // is a void buried in the middle of the plate's thickness, so the plan masks
    // are returned untouched and only the z-banded plate build knows about it.
    // That is the whole point of the internalised mount - unlike every lug
    // option above, the drawn silhouette survives intact, flare and all.
    const cx = balanceX(out.plate);
    const edge = bodyTop(out.plate, cx);
    const slot = slotMasks(out.plate, cx, edge);
    // The ring bears on the outer face of the bar, which is the chord through
    // the pocket centre, so that point is the pivot the piece hangs from.
    return { masks: out, hole: [cx, edge], slot };
  }

  if (mode === 'ring') {
    // A real protruding loop for a chain. Sitting it on the balance line keeps
    // the hang level, and because the lug is a disc centred on that same line
    // the material it adds is symmetric about it, so the balance survives.
    const cx = balanceX(out.plate);
    const edge = bodyTop(out.plate, cx);
    const r = RING.outer * MM;
    const cy = edge - r + RING.embed * MM;
    addLug(out, cx, cy, r, RING.hole * MM);
    return { masks: out, hole: [cx, cy] };
  }

  throw new Error(`unknown keyring mode: ${mode}`);
}

/**
 * Local slope of the back edge, as dy/dx in SVG units.
 *
 * Issaquah's mount sits on the flat top of a letter, so an axis-aligned bar
 * lands square in the mouth. The dragon's back slopes about 24 degrees where
 * the balance point falls, and an axis-aligned bar there sits off-centre in the
 * opening - measured 1.46mm one side against 2.94mm the other. Fitting the
 * edge and turning the bar to match puts it back in the middle.
 */
function edgeSlope(plate, cx, r) {
  const xs = [], ys = [];
  for (let d = -r; d <= r; d += r / 8) {
    const y = bodyTop(plate, cx + d);
    if (y === null || !isFinite(y)) continue;
    xs.push(cx + d); ys.push(y);
  }
  if (xs.length < 3) return 0;
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den === 0 ? 0 : num / den;
}

/** Rectangle turned to an arbitrary direction. `u` points into the material. */
function rotRect(mask, cx, cy, ux, uy, halfW, from, to, value) {
  const reach = Math.max(Math.abs(from), Math.abs(to)) + halfW;
  const x0 = Math.floor(cx - reach), x1 = Math.ceil(cx + reach);
  const y0 = Math.floor(cy - reach), y1 = Math.ceil(cy + reach);
  for (let y = y0; y <= y1; y += 1 / SS) {
    for (let x = x0; x <= x1; x += 1 / SS) {
      const dx = x - cx, dy = y - cy;
      const along = dx * ux + dy * uy;
      const across = dx * -uy + dy * ux;
      if (along < from || along > to || Math.abs(across) > halfW) continue;
      const [mxp, myp] = toMask(x, y);
      const ix = Math.round(mxp), iy = Math.round(myp);
      if (ix >= 0 && ix < W && iy >= 0 && iy < W) mask[iy * W + ix] = value;
    }
  }
}

/**
 * Pocket and bar for the internalised mount, as plan masks.
 *
 * The pocket is a full disc centred on the silhouette edge; the half that falls
 * outside the plate is simply not material, and that is what opens the mouth.
 * Because the disc is centred on the edge, the chord it opens along is the edge
 * itself, so turning the bar to lie across that chord divides the mouth evenly
 * however the back happens to slope.
 *
 * Both masks are clipped to the original footprint, so the bar can never stand
 * proud of the silhouette however the edge curves across its width.
 */
function slotMasks(plate, cx, edgeY) {
  const r = SLOT.r * MM;
  const pocket = new Uint8Array(W * W);
  disc(pocket, cx, edgeY, r, 1);

  // Inward normal to the edge. SVG counts y downward, so +y is into the body.
  const m = edgeSlope(plate, cx, r);
  const L = Math.hypot(1, m);
  const ux = -m / L, uy = 1 / L;

  const bar = new Uint8Array(W * W);
  rotRect(bar, cx, edgeY, ux, uy, (SLOT.barW * MM) / 2, -r, SLOT.barD * MM, 1);

  for (let i = 0; i < W * W; i++) {
    if (!plate[i]) { pocket[i] = 0; bar[i] = 0; }
  }
  return { pocket, bar, slope: m };
}

/** Merge a lug into the plate, coloured gray so it reads as part of the outline. */
function addLug(m, x, y, r, holeR) {
  disc(m.plate, x, y, r, 1);
  disc(m.gray, x, y, r, 1);
  for (const k of Object.keys(m)) {
    if (k !== 'plate' && k !== 'gray') disc(m[k], x, y, r, 0);
  }
  for (const k of Object.keys(m)) disc(m[k], x, y, holeR, 0);
}

// Contour coordinates are in supersampled, padded pixels; map back to
// millimetres with y flipped, since SVG counts y downward and STL counts up.
const xform = (p) => [
  (p[0] / SS - PAD) * K,
  (S - (p[1] / SS - PAD)) * K,
];

function solidFor(mask, z0, z1) {
  const loops = mesh.maskToLoops(mask, W, W, { sigma: 1.2, spacing: 2.5 });
  return mesh.extrude(mesh.buildPolygons(loops), z0, z1, xform);
}

/**
 * The plate between z0 and z1, split into bands when it carries a slot mount.
 *
 * The pocket has to be a void in the middle of the thickness, solid above and
 * below, or it would show on the face. Three extrusions stacked face to face
 * give exactly that. The bar becomes an island in the middle band - separated
 * from the plate in plan, but joined to the floor and roof it is sandwiched
 * between - which is precisely how the Issaquah file is put together.
 */
function plateSolids(mask, slot, z0, z1) {
  if (!slot) return [solidFor(mask, z0, z1)];
  const mid = Uint8Array.from(mask);
  for (let i = 0; i < W * W; i++) {
    if (slot.pocket[i]) mid[i] = 0;
    if (slot.bar[i]) mid[i] = 1;
  }
  return [
    solidFor(mask, z0, z0 + SLOT.wall),
    solidFor(mid, z0 + SLOT.wall, z1 - SLOT.wall),
    solidFor(mask, z1 - SLOT.wall, z1),
  ];
}

/** Footprint of a mask in SVG units, used to pin a product to a target size. */
function footprintUnits(mask) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < W * W; i++) {
    if (!mask[i]) continue;
    const x = i % W, y = (i / W) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { w: (x1 - x0) / SS, h: (y1 - y0) / SS };
}

function recenter(tris) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of tris) for (const p of t) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  const dx = (minX + maxX) / 2, dy = (minY + maxY) / 2;
  for (const t of tris) for (const p of t) { p[0] -= dx; p[1] -= dy; }
  return { w: maxX - minX, h: maxY - minY, dx, dy };
}

/** Point the module's scale and thickness at one product before drawing it. */
function configure(p, fp) {
  K = p.sizeMm / (p.axis === 'w' ? fp.w : fp.h);
  MM = 1 / K;
  PLATE_H = p.plateH;
  RELIEF_H = p.reliefH;
  FLUSH_H = PLATE_H + RELIEF_H;
}

/** Write one named part, checking each shell separately. */
function writePart(dir, name, shells) {
  const tris = shells.flat();
  const f = path.join(dir, `${name}.stl`);
  mesh.writeBinarySTL(tris, f);
  // Stacked shells share a face where they meet, so a check over the merged
  // soup would double count those edges and report a leak that is not there.
  const bad = shells.reduce((a, s) => a + mesh.checkManifold(s).bad, 0);
  console.log(`     ${(name + '.stl').padEnd(12)} ${String(tris.length).padStart(7)} tris, open edges: ${bad}`);
  return { tris: tris.length, bad };
}

(async () => {
  if (require.main !== module) return;
  const base = await renderMasks();
  const fp = footprintUnits(base.plate);

  const plateParts = components(base.plate);
  console.log(`Render ${W}x${W}px. Footprint ${fp.w.toFixed(1)} x ${fp.h.toFixed(1)} SVG units ` +
    `(aspect ${(fp.w / fp.h).toFixed(3)}:1, landscape)`);
  console.log(`Plate: ${plateParts.length} piece(s)` +
    (plateParts.length === 1 ? '  (connected - the ball is held)' : '  !! still detached'));

  for (const p of PRODUCTS) {
    configure(p, fp);
    const total = PLATE_H + (p.tiers ? Math.max(...Object.values(p.tiers)) : RELIEF_H);

    console.log(`\n${'='.repeat(72)}\n${p.name}`);
    console.log(`  ${(fp.w * K).toFixed(1)} x ${(fp.h * K).toFixed(1)} mm artwork ` +
      `(pinned by ${p.axis === 'w' ? 'width' : 'height'} to ${p.sizeMm}mm), ` +
      `${total.toFixed(1)}mm thick`);
    console.log(`  1 SVG unit = ${K.toFixed(4)} mm`);

    const { masks: m, hole, slot } = applyKeyring(base, p.mount);
    const parts = components(m.plate);
    if (parts.length !== 1) console.log(`  !! plate split into ${parts.length} pieces`);

    // A hanging part rotates until its centroid sits directly below the pivot,
    // so this is the angle it will actually sit at on a ring.
    if (hole) {
      const [cx, cy] = centroid(m.plate);
      const deg = Math.atan2(cx - hole[0], cy - hole[1]) * 180 / Math.PI;
      console.log(`  hangs ${Math.abs(deg) < 0.05 ? 'level' : `${deg.toFixed(1)}deg off upright`}`);
    }

    if (p.mount === 'slot') {
      const chan = PLATE_H - 2 * SLOT.wall;
      // The bar is not a beam spanning the mouth - it is a post, joined to the
      // solid floor below it and the solid roof above it. A ring pulling on it
      // therefore shears those two bonds, and since the part prints flat the
      // load runs along the layers rather than trying to peel them apart.
      const shear = 2 * SLOT.barW * SLOT.barD;
      const gap = (2 * SLOT.r - SLOT.barW) / 2;
      console.log(`  slot mount: r${SLOT.r}mm pocket, ${chan.toFixed(1)}mm channel, ` +
        `post ${SLOT.barW} x ${SLOT.barD}mm, ${SLOT.wall}mm floor and roof`);
      console.log(`  edge slope ${(Math.atan(slot.slope) * 180 / Math.PI).toFixed(1)}deg, ` +
        `bar turned to match: ${gap.toFixed(2)}mm opening each side of the post`);
      console.log(`  post joins floor and roof over ${shear.toFixed(1)}mm2 in shear ` +
        `(order of 30MPa along the layers)`);
    }
    if (p.mount === 'ring') {
      // Where the loop meets the back, the two circles cut a chord: that width
      // is the whole load path, so it is the number worth knowing.
      const chord = 2 * Math.sqrt(RING.outer ** 2 - (RING.outer - RING.embed) ** 2);
      console.log(`  chain loop: ${(RING.outer * 2)}mm across, ${(RING.hole * 2)}mm hole, ` +
        `${(RING.outer - RING.hole).toFixed(1)}mm ring wall`);
      console.log(`  sunk ${RING.embed}mm into the back, joining it over a ${chord.toFixed(1)}mm chord`);
    }

    for (const style of p.styles) {
      const dir = path.join('stl', p.name, style);
      fs.mkdirSync(dir, { recursive: true });
      console.log(`\n   ${style}:`);

      let per;
      if (style === 'emboss') {
        // One solid part: plate plus whatever stands proud of it.
        per = {
          plate: plateSolids(m.plate, slot, 0, PLATE_H),
          green: [solidFor(m.green, PLATE_H, FLUSH_H)],
          red: [solidFor(m.red, PLATE_H, FLUSH_H)],
        };
      } else if (style === 'amscap') {
        // Flush face, colour only in the top RELIEF_H. Everything below is one
        // filament, so the tool changes and the purge that goes with them are
        // confined to a few layers and nothing is lost - the material saved was
        // buried where it could never be seen.
        per = {
          gray: [...plateSolids(m.plate, slot, 0, PLATE_H), solidFor(m.gray, PLATE_H, FLUSH_H)],
          green: [solidFor(m.green, PLATE_H, FLUSH_H)],
          red: [solidFor(m.red, PLATE_H, FLUSH_H)],
          white: [solidFor(m.white, PLATE_H, FLUSH_H)],
        };
      } else if (style === 'tiered') {
        // Each colour rises to its own height above a common base, back of the
        // image to front. Gray sits at the base top, so it needs no riser.
        const t = p.tiers;
        per = { gray: plateSolids(m.plate, slot, 0, PLATE_H) };
        for (const name of ['white', 'red', 'green']) {
          per[name] = [solidFor(m[name], PLATE_H, PLATE_H + t[name])];
        }
        if (t.gray > 0) per.gray.push(solidFor(m.gray, PLATE_H, PLATE_H + t.gray));
      } else {
        throw new Error(`unknown style: ${style}`);
      }

      // Centre every colour by the same offset so the parts still line up.
      const flat = [];
      for (const shells of Object.values(per)) for (const s of shells) flat.push(...s);
      const size = recenter(flat);

      let tris = 0, bad = 0;
      for (const [name, shells] of Object.entries(per)) {
        const r = writePart(dir, name, shells);
        tris += r.tris; bad += r.bad;
      }

      if (style === 'emboss') {
        // Also ship it as a single file, since it is one material anyway.
        mesh.writeBinarySTL(flat, path.join(dir, 'dragons-combined.stl'));
      }
      if (style === 'tiered') {
        const t = p.tiers;
        console.log(`     steps above the ${PLATE_H}mm base: ` +
          Object.entries(t).sort((a, b) => a[1] - b[1])
            .map(([n, v]) => `${n} +${v.toFixed(1)}`).join('  ->  '));
      }

      // Record where the mount ended up so a section can be cut through it
      // without guessing. The plate is recentred after it is built, so this is
      // the only point at which the mount's final coordinates are known.
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
        product: p.name, style, mount: p.mount,
        mountXY: hole ? [hole[0] * K - size.dx, (S - hole[1]) * K - size.dy] : null,
        sizeMm: [+size.w.toFixed(2), +size.h.toFixed(2), +total.toFixed(2)],
        plateH: PLATE_H, reliefH: RELIEF_H,
        slot: p.mount === 'slot' ? { ...SLOT, slopeDeg: +(Math.atan(slot.slope) * 180 / Math.PI).toFixed(2) } : null,
        ring: p.mount === 'ring' ? RING : null,
        tiers: p.tiers || null,
        parts: Object.keys(per),
      }, null, 2));

      console.log(`     ${dir}: ${tris} triangles, ` +
        `${size.w.toFixed(1)} x ${size.h.toFixed(1)} x ${total.toFixed(1)} mm` +
        (bad ? `,  !! ${bad} open edges` : ',  all shells closed'));
    }
  }
  console.log();
})();

module.exports = { renderMasks, applyKeyring, xform, W, SS, PAD, S, columnRuns, jointWidth, centroid, footprintUnits };
