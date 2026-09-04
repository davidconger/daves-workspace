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

const SIZE_MM = 50;
const K = SIZE_MM / S;  // millimetres per SVG unit

// Ball outer edge = rOuter 134.0 + wOuter 7.0 / 2. Anything inside this radius
// is baseball, and unioning it into the plate is what stops the face dropping
// out of the print.
const BALL = { cx: 297.51, cy: 313.23, r: 137.5 };

const PLATE_H = 2.0;    // backing plate thickness
const RELIEF_H = 0.6;   // how far the body stands proud in the emboss style
const FLUSH_H = 2.6;    // total height of the flush multi-material build

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

  throw new Error(`unknown keyring mode: ${mode}`);
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

function recenter(tris) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of tris) for (const p of t) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  const dx = (minX + maxX) / 2, dy = (minY + maxY) / 2;
  for (const t of tris) for (const p of t) { p[0] -= dx; p[1] -= dy; }
  return { w: maxX - minX, h: maxY - minY };
}

(async () => {
  if (require.main !== module) return;
  const base = await renderMasks();

  const px2 = (SS * SS);
  console.log(`Render ${W}x${W}px, ${SIZE_MM}mm wide, 1px = ${(K / SS).toFixed(4)}mm`);
  const plateParts = components(base.plate);
  console.log(`Plate footprint: ${plateParts.length} piece(s)` +
    (plateParts.length === 1 ? '  (connected - the ball is held)' : '  !! still detached'));
  console.log();

  const OPTIONS = ['none', 'winghole', 'tab', 'toptab-half', 'toptab-short'];

  for (const keyring of OPTIONS) {
    const { masks: m, hole, dropped } = applyKeyring(base, keyring);
    const parts = components(m.plate);
    const debris = dropped && dropped.length
      ? `\n   trim dropped ${dropped.length} loose piece(s): ${dropped.map((a) => a.toFixed(1)).join(', ')} sq units`
      : '';

    // A hanging part rotates until its centroid is directly below the pivot,
    // so this is the angle the logo will actually sit at on a keyring.
    let hang = '';
    if (hole) {
      const [cx, cy] = centroid(m.plate);
      const deg = Math.atan2(cx - hole[0], cy - hole[1]) * 180 / Math.PI;
      hang = `, hangs ${Math.abs(deg) < 0.05 ? 'level' : `${deg.toFixed(1)}deg off upright`}`;
    }
    // For a top lug the load runs from the hole down into the dragon's back, so
    // report the narrowest row across that span and what it survives. PLA breaks
    // near 50 MPa; layer lines and stress risers make the real figure lower, so
    // this is an upper bound, not a promise.
    let load = '';
    if (keyring.startsWith('toptab')) {
      const [hx, hy] = hole;
      const lp = jointWidth(m.plate, hx - TOPTAB.r, hx + TOPTAB.r, hy - TOPTAB.hole, hy + TOPTAB.r);
      const area = lp.mm * (PLATE_H + RELIEF_H);
      load = `\n   load path ${lp.mm.toFixed(2)}mm wide at y=${lp.at}` +
        `, ${area.toFixed(1)}mm^2, breaks near ${(area * 50 / 9.81).toFixed(1)}kg`;
    }
    console.log(`== ${keyring}${hang}${load}${debris}` +
      (parts.length === 1 ? '' : `   !! plate split into ${parts.length} pieces`));

    // --- emboss: one solid part -----------------------------------------
    {
      const dir = path.join('stl', `emboss-${keyring}`);
      fs.mkdirSync(dir, { recursive: true });
      const solids = {
        plate: solidFor(m.plate, 0, PLATE_H),
        green: solidFor(m.green, PLATE_H, PLATE_H + RELIEF_H),
        red: solidFor(m.red, PLATE_H, PLATE_H + RELIEF_H),
      };
      // Each solid is checked on its own. Where the keyring hole passes through
      // both the plate and the relief above it, the two share an identical wall,
      // so a check over the merged triangle soup double counts those edges and
      // reports a leak that isn't there.
      const bad = Object.entries(solids)
        .map(([n, t]) => [n, mesh.checkManifold(t).bad])
        .filter(([, b]) => b > 0);

      const tris = [...solids.plate, ...solids.green, ...solids.red];
      const size = recenter(tris);
      const f = path.join(dir, 'dragons-keychain.stl');
      mesh.writeBinarySTL(tris, f);
      console.log(`${f}`);
      console.log(`   ${tris.length} triangles, ${size.w.toFixed(1)} x ${size.h.toFixed(1)} x ${(PLATE_H + RELIEF_H).toFixed(1)} mm` +
        `, open edges: ${bad.length ? bad.map(([n, b]) => `${n}=${b}`).join(' ') : '0 (all 3 solids closed)'}`);
    }

    // --- ams: one STL per colour, flush face ------------------------------
    {
      const dir = path.join('stl', `ams-${keyring}`);
      fs.mkdirSync(dir, { recursive: true });
      const all = [];
      const per = {};
      for (const name of ['gray', 'green', 'red', 'white']) {
        per[name] = solidFor(m[name], 0, FLUSH_H);
        all.push(...per[name].map((t) => t.map((p) => p.slice())));
      }
      // Centre every colour by the same offset so the parts still line up.
      const flat = [];
      for (const name of Object.keys(per)) flat.push(...per[name]);
      const size = recenter(flat);
      let total = 0;
      for (const name of Object.keys(per)) {
        const f = path.join(dir, `${name}.stl`);
        mesh.writeBinarySTL(per[name], f);
        const chk = mesh.checkManifold(per[name]);
        total += per[name].length;
        console.log(`   ${f.padEnd(34)} ${String(per[name].length).padStart(6)} tris, open edges: ${chk.bad}`);
      }
      console.log(`   ${dir}: ${total} triangles, ${size.w.toFixed(1)} x ${size.h.toFixed(1)} x ${FLUSH_H} mm`);
    }
    // --- ams-cap: colour only in the top layers, gray below ---------------
    // Same flush face as `ams`, but the colours stop after RELIEF_H and gray
    // fills the rest. Only those top layers contain more than one filament, so
    // the tool changes and the purge that goes with them drop by about 4x, and
    // nothing is lost: the material saved was buried where it is never seen.
    {
      const dir = path.join('stl', `amscap-${keyring}`);
      fs.mkdirSync(dir, { recursive: true });
      const per = {
        gray: [solidFor(m.plate, 0, PLATE_H), solidFor(m.gray, PLATE_H, FLUSH_H)],
        green: [solidFor(m.green, PLATE_H, FLUSH_H)],
        red: [solidFor(m.red, PLATE_H, FLUSH_H)],
        white: [solidFor(m.white, PLATE_H, FLUSH_H)],
      };
      // Centre every colour by the same offset so the parts still line up.
      const flat = [];
      for (const shells of Object.values(per)) for (const s of shells) flat.push(...s);
      const size = recenter(flat);
      let total = 0;
      for (const [name, shells] of Object.entries(per)) {
        const tris = shells.flat();
        const f = path.join(dir, `${name}.stl`);
        mesh.writeBinarySTL(tris, f);
        // Gray is two shells stacked, so they are checked one at a time; merged
        // they would share the face at PLATE_H and double count its edges.
        const bad = shells.map((s) => mesh.checkManifold(s).bad).reduce((a, b) => a + b, 0);
        total += tris.length;
        console.log(`   ${f.padEnd(34)} ${String(tris.length).padStart(6)} tris, open edges: ${bad}`);
      }
      const layers = Math.round(RELIEF_H / 0.2);
      console.log(`   ${dir}: ${total} triangles, ${size.w.toFixed(1)} x ${size.h.toFixed(1)} x ${FLUSH_H} mm` +
        `, colour in the top ${layers} layers only (${RELIEF_H} mm at 0.2)`);
    }
    console.log();
  }
})();

module.exports = { renderMasks, applyKeyring, xform, W, SS, PAD, S, K, columnRuns, jointWidth, centroid };
