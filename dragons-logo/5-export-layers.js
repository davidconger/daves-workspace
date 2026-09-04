// Phase 5: emit per-colour layer SVGs for 3D printing.
//
// The main logo uses strokes (ring circles, seam lines). Most SVG-to-STL tools
// either ignore stroke width or handle it badly, so every layer is re-rendered
// to a bitmap and re-fitted into closed filled paths. Slower than manipulating
// the geometry directly, but it guarantees each layer extrudes cleanly.
//
// Curve fitting uses the same level-set approach as phase 2 (see lib-curve.js).
// The input here is our own clean render rather than a JPEG, so only a small
// sigma is needed - just enough to recover sub-pixel edges from the antialiasing.

const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const { Resvg } = require('@resvg/resvg-js');
const { classify } = require('./lib-color');
const { maskToPath } = require('./lib-curve');

const R = 1200; // render resolution; 2x the 600 unit output space
const OUTDIR = 'layers';
const C = { green: '#4cc128', gray: '#959597', red: '#ed1c24', white: '#ffffff' };
const FIT = { sigma: 0.8, spacing: 0.6, smoothIters: 3, cornerAngle: 55, tolerance: 0.3, minLoopArea: 8, scale: 600 / R };

const wrap = (d, fill, note) => `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${note} -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600">
  <path fill="${fill}" fill-rule="evenodd" d="${d}"/>
</svg>
`;

(async () => {
  const srcSvg = fs.readFileSync('dragons-elite-logo-bold.svg', 'utf8');
  fs.mkdirSync(OUTDIR, { recursive: true });

  const png = new Resvg(srcSvg, { fitTo: { mode: 'width', value: R }, background: '#ffffff' })
    .render().asPng();
  const img = await Jimp.read(png);

  const cls = new Uint8Array(R * R);
  img.scan(0, 0, R, R, function (x, y, i) {
    cls[y * R + x] = classify(this.bitmap.data[i], this.bitmap.data[i + 1], this.bitmap.data[i + 2]);
  });

  // Background flood fill so the ball's white face is not mistaken for backdrop.
  const bg = new Uint8Array(R * R);
  const st = [];
  for (let x = 0; x < R; x++) st.push([x, 0], [x, R - 1]);
  for (let y = 0; y < R; y++) st.push([0, y], [R - 1, y]);
  while (st.length) {
    const [x, y] = st.pop();
    if (x < 0 || y < 0 || x >= R || y >= R) continue;
    const i = y * R + x;
    if (bg[i] || cls[i] !== 0) continue;
    bg[i] = 1;
    st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  const defs = [
    ['base',  (i) => !bg[i],               '#333333', 'Full silhouette. Extrude this first as the backing plate that holds every other layer together.'],
    ['gray',  (i) => !bg[i] && cls[i] === 2, C.gray,  'Gray outline and both baseball rings.'],
    ['green', (i) => cls[i] === 1,           C.green, 'Green dragon body.'],
    ['white', (i) => !bg[i] && cls[i] === 0, C.white, 'White face of the baseball.'],
    ['red',   (i) => cls[i] === 3,           C.red,   'Red seams and the dragon eye. Thinnest layer, check it survives at your print scale.'],
  ];

  const report = [];
  for (const [name, test, fill, note] of defs) {
    const m = new Uint8Array(R * R);
    let count = 0;
    for (let i = 0; i < R * R; i++) if (test(i)) { m[i] = 1; count++; }

    const { d, kept, dropped } = maskToPath(m, R, R, FIT);
    fs.writeFileSync(path.join(OUTDIR, `${name}.svg`), wrap(d, fill, note));
    report.push({
      layer: name,
      'area %': ((count / (R * R)) * 100).toFixed(2),
      loops: kept,
      dropped,
      'path chars': d.length,
    });
  }

  console.table(report);
})();
