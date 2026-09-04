// Contour extraction and smoothing.
//
// The problem: we want a curve that follows the *general* edge of a region
// without chasing pixel-level inconsistency (JPEG ringing, antialiasing noise,
// the staircase of a hard-thresholded mask).
//
// Tracing a binary mask cannot do this. A binary mask has already thrown away
// the sub-pixel information, so any tracer is forced to either follow the pixel
// staircase exactly or guess at removing it afterwards.
//
// So instead of mask -> trace, this does:
//
//   binary mask -> blur into a continuous scalar field -> extract the 0.5 level
//   set with linear interpolation -> smooth the polyline -> fit beziers
//
// Blurring turns the mask into a smooth field whose 0.5 isocontour already sits
// where the "average" edge is: a Gaussian of sigma s attenuates detail with a
// wavelength below roughly 2*s, so sigma is a direct, physical control over what
// counts as noise. Extracting that level set with interpolation gives sub-pixel
// positions, so there is no staircase to remove in the first place.
//
// A Gaussian is symmetric, so on a straight edge the 0.5 crossing does not move.
// Curved edges pull inward by about s^2/r, which at the sigmas used here is well
// under a pixel.

const fitCurve = require('fit-curve');

/** Separable Gaussian blur over a Float32 field. */
function blurField(f, w, h, sigma) {
  if (sigma <= 0) return f;
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
    sum += k[i + r];
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;

  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += k[i + r] * f[y * w + clamp(x + i, 0, w - 1)];
      tmp[y * w + x] = a;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += k[i + r] * tmp[clamp(y + i, 0, h - 1) * w + x];
      out[y * w + x] = a;
    }
  }
  return out;
}

/**
 * Marching squares at a given level, with linear interpolation along each cell
 * edge for sub-pixel accuracy.
 *
 * Crossings are keyed by which grid edge they lie on rather than by coordinate,
 * so linking segments into loops is exact integer bookkeeping and never depends
 * on floating point equality.
 */
function isoContours(f, w, h, level) {
  // Which cell edges each case connects. Edges: 0 top, 1 right, 2 bottom, 3 left.
  const TABLE = [
    [], [[0, 3]], [[0, 1]], [[3, 1]],
    [[1, 2]], null, [[0, 2]], [[3, 2]],
    [[2, 3]], [[0, 2]], null, [[1, 2]],
    [[1, 3]], [[0, 1]], [[0, 3]], [],
  ];

  const pos = new Map();
  const adj = new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  };

  const at = (x, y) => f[y * w + x];
  const interp = (va, vb) => (level - va) / (vb - va);

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const v00 = at(x, y), v10 = at(x + 1, y), v11 = at(x + 1, y + 1), v01 = at(x, y + 1);
      const idx = (v00 >= level ? 1 : 0) | (v10 >= level ? 2 : 0) |
                  (v11 >= level ? 4 : 0) | (v01 >= level ? 8 : 0);
      if (idx === 0 || idx === 15) continue;

      const edge = (e) => {
        switch (e) {
          case 0: return { key: `h${x},${y}`, p: [x + interp(v00, v10), y] };
          case 1: return { key: `v${x + 1},${y}`, p: [x + 1, y + interp(v10, v11)] };
          case 2: return { key: `h${x},${y + 1}`, p: [x + interp(v01, v11), y + 1] };
          default: return { key: `v${x},${y}`, p: [x, y + interp(v00, v01)] };
        }
      };

      let segs = TABLE[idx];
      if (segs === null) {
        // Saddle. Resolve with the cell average so the two branches stay consistent.
        const centre = (v00 + v10 + v11 + v01) / 4 >= level;
        segs = idx === 5
          ? (centre ? [[0, 1], [2, 3]] : [[0, 3], [1, 2]])
          : (centre ? [[0, 3], [1, 2]] : [[0, 1], [2, 3]]);
      }
      for (const [ea, eb] of segs) {
        const a = edge(ea), b = edge(eb);
        pos.set(a.key, a.p);
        pos.set(b.key, b.p);
        link(a.key, b.key);
      }
    }
  }

  // Walk the adjacency graph into closed loops.
  const loops = [];
  const used = new Set();
  for (const start of adj.keys()) {
    if (used.has(start)) continue;
    const loop = [];
    let cur = start, prev = null;
    while (cur && !used.has(cur)) {
      used.add(cur);
      loop.push(pos.get(cur));
      const next = (adj.get(cur) || []).find((n) => n !== prev && !used.has(n));
      prev = cur;
      cur = next;
    }
    if (loop.length >= 8) loops.push(loop);
  }
  return loops;
}

/** Resample a closed polyline to roughly uniform arc-length spacing. */
function resample(pts, spacing) {
  const n = pts.length;
  const out = [];
  let carry = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (seg === 0) continue;
    let t = carry;
    while (t < seg) {
      out.push([a[0] + ((b[0] - a[0]) * t) / seg, a[1] + ((b[1] - a[1]) * t) / seg]);
      t += spacing;
    }
    carry = t - seg;
  }
  return out.length >= 8 ? out : pts;
}

/**
 * Flag points that sit on a genuine corner, measured as the turn angle across a
 * window wide enough to ignore single-sample wobble. These get pinned so
 * smoothing cannot round off the dragon's wingtips and horns.
 */
function findCorners(pts, window, angleDeg) {
  const n = pts.length;
  const lim = Math.cos((angleDeg * Math.PI) / 180);
  const score = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[(i - window + n) % n], b = pts[i], c = pts[(i + window) % n];
    const ux = b[0] - a[0], uy = b[1] - a[1];
    const vx = c[0] - b[0], vy = c[1] - b[1];
    const lu = Math.hypot(ux, uy) || 1, lv = Math.hypot(vx, vy) || 1;
    score[i] = (ux * vx + uy * vy) / (lu * lv);
  }
  const corner = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (score[i] >= lim) continue;
    // Keep only the sharpest point in the neighbourhood.
    let best = true;
    for (let d = -window; d <= window; d++) {
      if (score[(i + d + n) % n] < score[i]) { best = false; break; }
    }
    if (best) corner[i] = 1;
  }
  return corner;
}

/**
 * Taubin smoothing: a shrink-free low-pass filter for polylines. A plain
 * Laplacian pass smooths but collapses the shape inward; following it with a
 * slightly larger negative pass pushes back out, so detail is removed without
 * the whole contour deflating.
 */
function taubin(pts, iterations, pinned, lambda = 0.5, mu = -0.53) {
  const n = pts.length;
  let cur = pts.map((p) => [p[0], p[1]]);
  const pass = (factor) => {
    const next = cur.map((p) => [p[0], p[1]]);
    for (let i = 0; i < n; i++) {
      if (pinned && pinned[i]) continue;
      const a = cur[(i - 1 + n) % n], b = cur[i], c = cur[(i + 1) % n];
      next[i][0] = b[0] + factor * ((a[0] + c[0]) / 2 - b[0]);
      next[i][1] = b[1] + factor * ((a[1] + c[1]) / 2 - b[1]);
    }
    cur = next;
  };
  for (let k = 0; k < iterations; k++) { pass(lambda); pass(mu); }
  return cur;
}

/** Fit cubic beziers to a closed polyline, breaking at pinned corners. */
function toPath(pts, corner, tolerance, scale) {
  const n = pts.length;
  const s = (v) => +(v * scale).toFixed(2);
  const breaks = [];
  for (let i = 0; i < n; i++) if (corner[i]) breaks.push(i);

  const runs = [];
  if (breaks.length < 2) {
    runs.push(pts.concat([pts[0]]));
  } else {
    for (let b = 0; b < breaks.length; b++) {
      const from = breaks[b], to = breaks[(b + 1) % breaks.length];
      const run = [];
      for (let i = from; ; i = (i + 1) % n) {
        run.push(pts[i]);
        if (i === to) break;
      }
      if (run.length >= 2) runs.push(run);
    }
  }

  let d = '';
  for (const run of runs) {
    // Collinear or duplicate points make the fitter produce nothing useful;
    // skipping those is fine, but anything else is a real bug and should surface.
    if (run.length < 2) continue;
    const curves = fitCurve(run, tolerance);
    if (!curves || !curves.length) continue;
    if (!d) d += `M ${s(curves[0][0][0])},${s(curves[0][0][1])}`;
    for (const c of curves) {
      d += ` C ${s(c[1][0])},${s(c[1][1])} ${s(c[2][0])},${s(c[2][1])} ${s(c[3][0])},${s(c[3][1])}`;
    }
  }
  return d ? d + ' Z' : '';
}

/**
 * Full pipeline: binary mask -> smooth bezier path data.
 * `scale` maps mask pixels to output user units.
 */
function maskToPath(mask, w, h, opts) {
  const {
    sigma = 1.4,        // blur radius; the noise-vs-detail cutoff
    spacing = 0.6,      // contour resample step, in mask pixels
    smoothIters = 6,    // Taubin passes
    cornerWindow = 4,
    cornerAngle = 55,   // turn angle that counts as a real corner
    tolerance = 0.35,   // bezier fit tolerance, in mask pixels
    minLoopArea = 12,   // drop loops smaller than this, in mask pixels squared
    scale = 1,
  } = opts || {};

  const field = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) field[i] = mask[i] ? 1 : 0;
  const blurred = blurField(field, w, h, sigma);

  const area = (p) => {
    let a = 0;
    for (let i = 0; i < p.length; i++) {
      const q = p[(i + 1) % p.length];
      a += p[i][0] * q[1] - q[0] * p[i][1];
    }
    return Math.abs(a) / 2;
  };

  let d = '';
  let kept = 0, dropped = 0;
  for (const loop of isoContours(blurred, w, h, 0.5)) {
    if (area(loop) < minLoopArea) { dropped++; continue; }
    const rs = resample(loop, spacing);
    const corner = findCorners(rs, cornerWindow, cornerAngle);
    const sm = taubin(rs, smoothIters, corner);
    const seg = toPath(sm, corner, tolerance, scale);
    if (seg) { d += (d ? ' ' : '') + seg; kept++; }
  }
  return { d, kept, dropped };
}

module.exports = { maskToPath, blurField, isoContours, resample, findCorners, taubin, toPath };
