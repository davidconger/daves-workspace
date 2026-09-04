// Phase 6: find the honest curve-fitting tolerance.
//
// Think of tracing the logo with a marker rather than a fine pen. A thick tip
// covers the edge in one confident stroke; it does not need to wobble to follow
// every irregularity, because the stroke is wider than the irregularity.
//
// The equivalent question here is: how large can the fitting tolerance be before
// it stops absorbing noise and starts distorting the shape? Fitting to 0.35px on
// a source whose edges are several pixels wide is overfitting - the curve spends
// its control points encoding JPEG artifacts as if they were design.
//
// This sweeps sigma (the noise cutoff) and tolerance (the marker width), and
// reports match against the source plus the number of bezier segments used.
// Segment count is the refinement measure: the baseball reads as clean because
// it is two circles and two quadratics. The closer the dragon gets to that kind
// of economy without losing match, the better it will look and extrude.

const { buildMasks } = require('./lib-layers');
const { maskToPath } = require('./lib-curve');
const { buildSVG, score, SEAM_VARIANTS } = require('./4-build-svg');

const SCALE = 6;
const LAYERS = ['silhouette', 'green', 'red'];
const segments = (d) => (d.match(/C/g) || []).length;

(async () => {
  const { masks, w, h, edge } = await buildMasks('source-logo-600.jpg');

  console.log(
    `Measured edge ramp: median ${edge.median}px, p90 ${edge.p90}px ` +
    `(${edge.samples} samples)\n` +
    `So edge position is only known to about +/-${(edge.median / 2).toFixed(1)}px. ` +
    `Fitting tighter than that is fitting noise.\n`
  );

  const sigmas = [1.0, 1.4, 2.0, 2.6];
  const tolerances = [0.35, 0.8, 1.5, 2.5, 4.0];
  const rows = [];

  for (const sigma of sigmas) {
    for (const tolerance of tolerances) {
      const paths = {};
      let segs = 0;
      for (const name of LAYERS) {
        const fit = {
          sigma: name === 'red' ? Math.min(sigma, 1.0) : sigma,
          tolerance: name === 'red' ? Math.min(tolerance, 0.8) : tolerance,
          smoothIters: 6,
          cornerAngle: 55,
          minLoopArea: 12,
          scale: SCALE,
        };
        const { d } = maskToPath(masks[name], w, h, fit);
        paths[name] = d;
        if (name !== 'red') segs += segments(d);
      }
      const svg = buildSVG(paths, SEAM_VARIANTS['dragons-elite-logo.svg'], SCALE);
      const s = await score(svg, null);
      rows.push({
        sigma,
        tolerance,
        'match %': +s.overall.toFixed(2),
        'dragon segments': segs,
        'chars': paths.silhouette.length + paths.green.length,
      });
    }
  }

  console.table(rows);

  const best = rows.reduce((a, b) => (b['match %'] > a['match %'] ? b : a));
  console.log(`\nHighest match: sigma ${best.sigma}, tolerance ${best.tolerance} ` +
    `-> ${best['match %']}% with ${best['dragon segments']} segments`);
})();
