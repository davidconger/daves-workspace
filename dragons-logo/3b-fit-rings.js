// Phase 3b: least-squares circle fit on the ball's four ring edges, so the
// rebuilt ball lands exactly on the original instead of near it.
const Jimp = require('jimp');

function cl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn < 40) return mx > 202 ? 0 : 2; // white | gray
  if (g >= r && g >= b) return 1;            // green
  if (r > g && r > b) return 3;              // red
  return 2;
}

/** Kasa least-squares circle fit. */
function fitCircle(pts) {
  let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0;
  const n = pts.length;
  for (const [x, y] of pts) {
    const z = x * x + y * y;
    Sx += x; Sy += y; Sxx += x * x; Syy += y * y; Sxy += x * y;
    Sxz += x * z; Syz += y * z; Sz += z;
  }
  const A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]];
  const b = [Sxz, Syz, Sz];
  // Gaussian elimination on a 3x3.
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let j = i + 1; j < 3; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let j = i + 1; j < 3; j++) {
      const f = A[j][i] / A[i][i];
      for (let k = i; k < 3; k++) A[j][k] -= f * A[i][k];
      b[j] -= f * b[i];
    }
  }
  const s = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let t = b[i];
    for (let k = i + 1; k < 3; k++) t -= A[i][k] * s[k];
    s[i] = t / A[i][i];
  }
  const cx = s[0] / 2, cy = s[1] / 2;
  return { cx, cy, r: Math.sqrt(s[2] + cx * cx + cy * cy) };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

Jimp.read('source-logo-600.jpg').then((img) => {
  const W = img.bitmap.width, d = img.bitmap.data;
  const at = (x, y) => { const i = (Math.round(y) * W + Math.round(x)) * 4; return cl(d[i], d[i + 1], d[i + 2]); };

  let cx = 298.9, cy = 312.2;

  // Edge 1: the ball's white face meeting the inner gray ring. Fully enclosed by
  // the ball, so every angle is usable and the fit is trustworthy.
  for (let pass = 0; pass < 3; pass++) {
    const pts = [];
    for (let a = 0; a < 360; a += 1) {
      const th = (a * Math.PI) / 180;
      for (let r = 95; r < 125; r += 0.25) {
        const x = cx + Math.cos(th) * r, y = cy + Math.sin(th) * r;
        if (at(x, y) === 2) { pts.push([x, y]); break; }
      }
    }
    const f = fitCircle(pts);
    cx = f.cx; cy = f.cy;
    if (pass === 2) console.log(`edge1 white->gray : c=(${f.cx.toFixed(2)}, ${f.cy.toFixed(2)}) r=${f.r.toFixed(2)}  n=${pts.length}`);
  }

  // Remaining edges: sample radially from the refined centre and take medians,
  // which shrugs off the angles where the dragon overlaps the ring.
  const e = [[], [], [], []];
  for (let a = 0; a < 360; a += 1) {
    const th = (a * Math.PI) / 180;
    const seq = [];
    let prev = -1;
    for (let r = 95; r < 150; r += 0.25) {
      const c = at(cx + Math.cos(th) * r, cy + Math.sin(th) * r);
      if (c !== prev) { seq.push([c, r]); prev = c; }
    }
    // Expect white, gray, white, gray, then green.
    if (seq.length >= 5 && seq[1][0] === 2 && seq[2][0] === 0 && seq[3][0] === 2) {
      e[0].push(seq[1][1]); e[1].push(seq[2][1]); e[2].push(seq[3][1]); e[3].push(seq[4][1]);
    }
  }
  const m = e.map(median);
  console.log(`clean angles      : ${e[0].length}/360`);
  console.log(`inner ring        : ${m[0].toFixed(2)} .. ${m[1].toFixed(2)}   (width ${(m[1] - m[0]).toFixed(2)})`);
  console.log(`white gap         : ${m[1].toFixed(2)} .. ${m[2].toFixed(2)}`);
  console.log(`outer ring        : ${m[2].toFixed(2)} .. ${m[3].toFixed(2)}   (width ${(m[3] - m[2]).toFixed(2)})`);
  console.log(`\nBALL = { cx: ${cx.toFixed(2)}, cy: ${cy.toFixed(2)}, rWhite: ${m[2].toFixed(2)},`);
  console.log(`  rInner: ${((m[0] + m[1]) / 2).toFixed(2)}, wInner: ${(m[1] - m[0]).toFixed(2)},`);
  console.log(`  rOuter: ${((m[2] + m[3]) / 2).toFixed(2)}, wOuter: ${(m[3] - m[2]).toFixed(2)} }`);
});
