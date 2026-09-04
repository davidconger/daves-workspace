// Shared layer masks, so the trace phase and the parameter sweep classify the
// image identically.

const Jimp = require('jimp');
const { classify, WHITE, GREEN, GRAY, RED } = require('./lib-color');

// The ball is rebuilt from exact geometry in phase 4, so only the dragon is
// fitted from the raster. Green starts at r~138 from the ball centre, so
// anything inside that radius is ball (rings, white gap, seams) and gets cut.
const BALL = { cx: 298.9, cy: 312.2, r: 139 };

/**
 * Strip foreground islands and interior holes below a pixel area, in place.
 * Returns what was removed so the thresholds can be sanity checked against the
 * artwork rather than trusted blindly.
 */
function cleanMask(m, w, h, minIsland, minHole) {
  const removed = { islands: 0, holes: 0, biggest: 0 };
  for (const target of [1, 0]) {
    const minA = target ? minIsland : minHole;
    const seen = new Uint8Array(w * h);
    for (let start = 0; start < w * h; start++) {
      if (seen[start] || m[start] !== target) continue;
      const comp = [start];
      const st = [start];
      seen[start] = 1;
      let onBorder = false;
      while (st.length) {
        const p = st.pop();
        const x = p % w, y = (p / w) | 0;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) onBorder = true;
        const nb = [];
        if (x > 0) nb.push(p - 1);
        if (x < w - 1) nb.push(p + 1);
        if (y > 0) nb.push(p - w);
        if (y < h - 1) nb.push(p + w);
        for (const q of nb) {
          if (!seen[q] && m[q] === target) { seen[q] = 1; comp.push(q); st.push(q); }
        }
      }
      // The outer background is a hole component touching the border; keep it.
      if (onBorder && target === 0) continue;
      if (comp.length < minA) {
        for (const p of comp) m[p] = target ? 0 : 1;
        if (target) removed.islands++; else removed.holes++;
        removed.biggest = Math.max(removed.biggest, comp.length);
      }
    }
  }
  return removed;
}

/**
 * Measure how sharp the artwork's edges actually are, by scanning rows for
 * transitions between the logo body and the white background and recording how
 * many pixels the ramp takes.
 *
 * This is the real positional uncertainty of every edge, and therefore the
 * largest curve-fitting tolerance that is still honest: deviations smaller than
 * this are not information about the shape, they are the blur of the source.
 */
function measureEdgeWidth(img, w, h) {
  const d = img.bitmap.data;
  const luma = (i) => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const LO = 175, HI = 240; // solidly inside vs solidly background
  const widths = [];
  for (let y = 0; y < h; y++) {
    let run = -1;
    for (let x = 0; x < w; x++) {
      const v = luma(y * w + x);
      if (v <= LO) { run = x; continue; }
      if (v >= HI) {
        if (run >= 0 && x - run <= 12) widths.push(x - run);
        run = -1;
      }
    }
  }
  widths.sort((a, b) => a - b);
  return {
    samples: widths.length,
    median: widths[(widths.length / 2) | 0],
    p90: widths[((widths.length * 0.9) | 0)],
  };
}

async function buildMasks(file, clean = { island: 10, hole: 10 }) {
  const src = await Jimp.read(file);
  const w = src.bitmap.width, h = src.bitmap.height;

  const cls = new Uint8Array(w * h);
  src.scan(0, 0, w, h, function (x, y, idx) {
    cls[y * w + x] = classify(
      this.bitmap.data[idx], this.bitmap.data[idx + 1], this.bitmap.data[idx + 2]
    );
  });

  // The baseball interior is the same white as the page, so "white" alone
  // cannot mean background. Flood fill inward from the border instead.
  const bg = new Uint8Array(w * h);
  const st = [];
  for (let x = 0; x < w; x++) st.push([x, 0], [x, h - 1]);
  for (let y = 0; y < h; y++) st.push([0, y], [w - 1, y]);
  while (st.length) {
    const [x, y] = st.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = y * w + x;
    if (bg[i] || cls[i] !== WHITE) continue;
    bg[i] = 1;
    st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  const inBall = (i) =>
    Math.hypot((i % w) - BALL.cx, ((i / w) | 0) - BALL.cy) < BALL.r;

  const tests = {
    silhouette: (i) => !bg[i],
    gray: (i) => !bg[i] && cls[i] === GRAY && !inBall(i),
    green: (i) => cls[i] === GREEN,
    white: (i) => !bg[i] && cls[i] === WHITE && !inBall(i),
    red: (i) => cls[i] === RED && !inBall(i),
  };

  const masks = {}, cleaned = {};
  for (const [name, test] of Object.entries(tests)) {
    const m = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (test(i)) m[i] = 1;
    cleaned[name] = cleanMask(m, w, h, clean.island, clean.hole);
    masks[name] = m;
  }

  return { masks, cleaned, w, h, src, edge: measureEdgeWidth(src, w, h) };
}

module.exports = { buildMasks, cleanMask, measureEdgeWidth, BALL };
