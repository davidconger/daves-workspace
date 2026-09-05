// Where should the mount sit so the piece hangs the way the logo is drawn?
//
// A hanging part rotates until its area centroid is directly below the pivot,
// so the answer is not "the middle of the ball" - it is the centroid's own x.
// This checks that x is somewhere a pocket can actually go, by measuring the
// unbroken solid below the top edge right across the width of the mount.
const b = require('./8-build-stl');

(async () => {
  const m = await b.renderMasks();
  const [cx, cy] = b.centroid(m.plate);
  const fp = b.footprintUnits(m.plate);
  console.log(`centroid: x=${cx.toFixed(1)}  y=${cy.toFixed(1)} SVG units`);

  for (const [name, sizeMm, axis, span] of [
    ['keychain-56mm', 56, 'h', 8.0],
    ['pendant-223mm', 223, 'w', 22.0],
  ]) {
    const K = sizeMm / (axis === 'w' ? fp.w : fp.h);
    const MM = 1 / K;
    console.log(`\n${name}   1 unit = ${K.toFixed(4)}mm,  mount spans ${span}mm = ${(span * MM).toFixed(0)} units`);

    const half = (span / 2) * MM;
    for (const x of [cx - half, cx - half / 2, cx, cx + half / 2, cx + half]) {
      const runs = b.columnRuns(m.plate, Math.round(x), -50, 600);
      if (!runs.length) { console.log(`  x=${x.toFixed(0).padStart(4)}: no solid`); continue; }
      // Skip the thin flare and horns; the first run deeper than 2mm is the body.
      const body = runs.find(r => (r[1] - r[0]) * K > 2) || runs[0];
      console.log(`  x=${x.toFixed(0).padStart(4)}: top y=${body[0].toFixed(0).padStart(4)}, ` +
        `${((body[1] - body[0]) * K).toFixed(1).padStart(5)}mm of solid below it` +
        `   (${runs.length} run(s) in this column)`);
    }
  }
})();
