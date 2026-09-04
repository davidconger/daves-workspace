// Print feasibility analysis.
//
// Two things decide how this logo can be built as an STL, and neither is a
// matter of opinion:
//
//   1. How many separate pieces is the silhouette? Anything not connected to
//      the main body is a part that falls off the print bed.
//   2. How thin does it get? A feature narrower than the nozzle cannot be
//      printed at all, and one narrower than two extrusion widths has no
//      perimeter pair and snaps.
//
// Local thickness is measured with an exact Euclidean distance transform
// (Felzenszwalb & Huttenlocher). The distance from a point to the nearest
// background pixel is the radius of the largest circle fitting inside the
// shape there, so 2x that distance is the local thickness.

const Jimp = require('jimp');
const { buildMasks } = require('./lib-layers');

const TARGET_MM = 50;      // keychain width across the 600px artwork
const NOZZLE = 0.4;
const LAYER = 0.2;

// 1D squared distance transform of a sampled function.
function edt1d(f, n) {
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    for (;;) {
      const a = v[k];
      s = ((f[q] + q * q) - (f[a] + a * a)) / (2 * q - 2 * a);
      if (s <= z[k] && k > 0) k--; else break;
    }
    k++;
    v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const a = v[k];
    d[q] = (q - a) * (q - a) + f[a];
  }
  return d;
}

// Exact Euclidean distance (in pixels) from every foreground pixel to the
// nearest background pixel.
function distanceTransform(mask, w, h) {
  const BIG = 1e12;
  const f = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) f[i] = mask[i] ? BIG : 0;

  const col = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y] = f[y * w + x];
    const d = edt1d(col, h);
    for (let y = 0; y < h; y++) f[y * w + x] = d[y];
  }
  const row = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) row[x] = f[y * w + x];
    const d = edt1d(row, w);
    for (let x = 0; x < w; x++) f[y * w + x] = Math.sqrt(d[x]);
  }
  return f;
}

// 8-connected components of the foreground.
function components(mask, w, h) {
  const lab = new Int32Array(w * h).fill(-1);
  const sizes = [];
  for (let s = 0; s < w * h; s++) {
    if (mask[s] !== 1 || lab[s] !== -1) continue;
    const id = sizes.length;
    let n = 0;
    const st = [s];
    lab[s] = id;
    while (st.length) {
      const p = st.pop();
      n++;
      const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (mask[q] === 1 && lab[q] === -1) { lab[q] = id; st.push(q); }
        }
      }
    }
    sizes.push(n);
  }
  return { lab, sizes };
}

(async () => {
  const { masks, w, h } = await buildMasks('source-logo-600.jpg');
  const sil = masks.silhouette;
  const mmPerPx = TARGET_MM / w;

  console.log(`Target size: ${TARGET_MM}mm across ${w}px  ->  1px = ${mmPerPx.toFixed(4)}mm`);
  console.log(`Nozzle ${NOZZLE}mm, layer ${LAYER}mm\n`);

  // --- connectivity ------------------------------------------------------
  const { lab, sizes } = components(sil, w, h);
  const order = sizes.map((n, i) => [i, n]).sort((a, b) => b[1] - a[1]);
  console.log(`Separate pieces: ${sizes.length}`);
  for (const [id, n] of order.slice(0, 6)) {
    const pct = (100 * n / sizes.reduce((a, b) => a + b, 0)).toFixed(2);
    console.log(`  piece ${id}: ${n} px (${pct}%)`);
  }
  if (order.length > 1) {
    console.log(`  -> ${order.length - 1} piece(s) would print detached.`);
  }
  console.log();

  // --- thickness ---------------------------------------------------------
  // Distance-to-edge alone is a bad printability test, because every shape
  // tapers to zero thickness at its own boundary. The honest test is a
  // morphological opening: erode by half the nozzle, dilate back, and see what
  // failed to return. Those are the features genuinely too narrow to extrude.
  const dist = distanceTransform(sil, w, h);

  const openingLoss = (rPx) => {
    const core = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (dist[i] >= rPx) core[i] = 1;
    const inv = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) inv[i] = core[i] ? 0 : 1;
    const toCore = distanceTransform(inv, w, h);
    let lost = 0, total = 0;
    const lostMask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (!sil[i]) continue;
      total++;
      if (toCore[i] > rPx) { lost++; lostMask[i] = 1; }
    }
    return { pct: 100 * lost / total, lostMask };
  };

  console.log('Features lost to a morphological opening (= too narrow to extrude):');
  const widths = [
    ['1 nozzle  0.40mm', NOZZLE],
    ['2 walls   0.80mm', NOZZLE * 2],
    ['3 walls   1.20mm', NOZZLE * 3],
  ];
  let lostMask = null;
  for (const [name, mm] of widths) {
    const rPx = (mm / 2) / mmPerPx;
    const r = openingLoss(rPx);
    if (mm === NOZZLE * 2) lostMask = r.lostMask;
    console.log(`  ${name}: ${r.pct.toFixed(2)}% of the body`);
  }

  // Smallest print size at which nothing is lost at 2 perimeters.
  console.log('\nSize needed so no feature falls below 2 perimeters (0.80mm):');
  for (const mm of [50, 60, 75, 90, 110]) {
    const sc = mm / w;
    const rPx = (NOZZLE * 2 / 2) / sc;
    console.log(`  ${String(mm).padStart(3)}mm wide: ${openingLoss(rPx).pct.toFixed(2)}% lost`);
  }

  // --- gap between the two pieces ---------------------------------------
  if (order.length > 1) {
    const [idA] = order[0], [idB] = order[1];
    const a = new Uint8Array(w * h), bInv = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (lab[i] === idA) a[i] = 1;
      bInv[i] = lab[i] === idA ? 0 : 1;
    }
    const dToA = distanceTransform(bInv, w, h);
    let gap = Infinity;
    for (let i = 0; i < w * h; i++) if (lab[i] === idB) gap = Math.min(gap, dToA[i]);
    console.log(`\nGap between the two pieces: ${gap.toFixed(1)}px = ${(gap * mmPerPx).toFixed(2)}mm`);
    console.log(`  closing it needs an outward offset of ${(gap * mmPerPx / 2).toFixed(2)}mm on each side`);
  }

  // --- keyring hole ------------------------------------------------------
  // A hole needs a solid collar around it. Look for the point with the most
  // material (largest inscribed circle) in each corner region.
  console.log('\nBest keyring hole locations (largest inscribed circle):');
  const spots = [];
  for (let i = 0; i < w * h; i++) {
    if (!sil[i]) continue;
    const x = i % w, y = (i / w) | 0;
    spots.push([dist[i], x, y]);
  }
  spots.sort((a, b) => b[0] - a[0]);
  const chosen = [];
  for (const [d, x, y] of spots) {
    if (chosen.some((c) => Math.hypot(c[1] - x, c[2] - y) < 90)) continue;
    chosen.push([d, x, y]);
    if (chosen.length === 4) break;
  }
  for (const [d, x, y] of chosen) {
    console.log(`  (${x}, ${y})  material radius ${d.toFixed(1)}px = ${(d * mmPerPx).toFixed(2)}mm`);
  }

  // --- heatmap -----------------------------------------------------------
  const out = new Jimp(w, h, 0xffffffff);
  for (let i = 0; i < w * h; i++) {
    if (!sil[i]) continue;
    const x = i % w, y = (i / w) | 0;
    const detached = lab[i] !== order[0][0];
    let c;
    if (lostMask && lostMask[i]) c = [220, 30, 30];
    else if (detached) c = [150, 120, 220];
    else c = [90, 180, 90];
    out.setPixelColor(Jimp.rgbaToInt(c[0], c[1], c[2], 255), x, y);
  }
  for (const [d, x, y] of chosen) {
    for (let a = 0; a < 360; a += 2) {
      const px = Math.round(x + d * Math.cos(a * Math.PI / 180));
      const py = Math.round(y + d * Math.sin(a * Math.PI / 180));
      if (px >= 0 && py >= 0 && px < w && py < h) {
        out.setPixelColor(Jimp.rgbaToInt(0, 80, 255, 255), px, py);
      }
    }
  }
  await out.writeAsync('build/print-thickness.png');
  console.log('\nWrote build/print-thickness.png');
})();
