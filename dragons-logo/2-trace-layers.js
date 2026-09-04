// Phase 2: split the raster into colour layers and convert each to smooth
// bezier paths.
//
// Key detail: the baseball interior is the same white as the page background,
// so "white" alone cannot mean background. We flood fill inward from the border
// to find the true background, and everything else becomes the silhouette.
//
// Curve fitting lives in lib-curve.js, which extracts a sub-pixel level set from
// a blurred field rather than tracing a hard mask. See the notes there for why.

const Jimp = require('jimp');
const fs = require('fs');
const path = require('path');
const { maskToPath } = require('./lib-curve');
const { buildMasks } = require('./lib-layers');

const SCALE = 6; // paths are emitted in 3600x3600 space

// Per-layer curve-fitting settings, in native 600px units.
//
// Two knobs, both set from measurement rather than taste:
//
// sigma sets the wavelength below which edge variation is treated as noise. The
// source's edge ramp measures 4px median / 6px p90 (see measureEdgeWidth), so a
// sigma of 2.0 covers the ramp without eating real features. Past ~2.6 the match
// score starts dropping, which is the signal that it is eroding actual shape.
//
// tolerance is the bezier fit budget, and it is the important one. Because the
// edge ramp is 4px wide, edge position is only known to about +/-2px. Fitting
// tighter than that spends control points encoding JPEG artifacts as if they
// were design: at 0.35px the dragon needed 381 bezier segments, at 2.5px it
// needs 103, and the difference in match against the source is 0.24 percent.
// That 0.24 percent is agreement with noise, so the loose fit is both smaller
// and more honest - the equivalent of tracing with a marker whose tip is wider
// than the wobble, instead of chasing every irregularity with a fine pen.
//
// The red layer here is only the dragon's eye (seams are constructed in phase
// 4). It is small, so it keeps a finer setting.
const FIT = {
  default: { sigma: 2.0, smoothIters: 6, cornerAngle: 55, tolerance: 2.5, minLoopArea: 12 },
  red: { sigma: 1.0, smoothIters: 3, cornerAngle: 60, tolerance: 0.8, minLoopArea: 6 },
};

// Minimum component areas, in native 600px pixels.
const CLEAN = { island: 10, hole: 10 };
const OUT = 'build';

/** Save a mask as a PNG for visual inspection. */
function maskPng(m, w, h) {
  const img = new Jimp(w, h, 0xffffffff);
  const d = img.bitmap.data;
  for (let i = 0; i < w * h; i++) {
    if (m[i]) { d[i * 4] = 0; d[i * 4 + 1] = 0; d[i * 4 + 2] = 0; }
  }
  return img;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const { masks, cleaned, w, h, edge } = await buildMasks('source-logo-600.jpg', CLEAN);
  console.log(
    `Source edge ramp: ${edge.median}px median, ${edge.p90}px p90 ` +
    `-> edge known to about +/-${(edge.median / 2).toFixed(1)}px\n`
  );

  const results = {};
  for (const [name, m] of Object.entries(masks)) {
    await maskPng(m, w, h).writeAsync(path.join(OUT, `mask-${name}.png`));

    const fit = { ...(FIT[name] || FIT.default), scale: SCALE };
    const { d, kept, dropped } = maskToPath(m, w, h, fit);
    results[name] = d;

    const segs = (d.match(/C/g) || []).length;
    console.log(
      `${name.padEnd(11)} ${String(segs).padStart(4)} segments  ` +
      `${String(d.length).padStart(6)} chars  ${kept} loops (${dropped} dropped)  ` +
      `cleaned ${cleaned[name].islands} islands / ${cleaned[name].holes} holes`
    );
  }

  fs.writeFileSync(
    path.join(OUT, 'paths.json'),
    JSON.stringify({ scale: SCALE, paths: results }, null, 2)
  );
  console.log(`\nDone. Emitted in ${w * SCALE}x${h * SCALE} space, scale ${SCALE}.`);
})();
