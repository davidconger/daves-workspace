// What size are the reference pendants actually printed at?
//
// The Issaquah pendant's STLs are stored oversized and scaled by 0.59 in XY in
// the 3mf, so raw bounds are misleading. The chain loop is the reality check:
// it has to fit a real chain, so its hole diameter tells you the true scale
// regardless of what the file says.
//
// usage: node measure-pendants.js

const fs = require('fs');

function load(path) {
  const buf = fs.readFileSync(path);
  const n = buf.readUInt32LE(80);
  const T = new Float64Array(n * 9);
  for (let i = 0, o = 84; i < n; i++, o += 50)
    for (let k = 0; k < 9; k++) T[i * 9 + k] = buf.readFloatLE(o + 12 + k * 4);
  return { T, n };
}

function bbox(T, n) {
  const m = [Infinity, Infinity, Infinity], M = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n * 9; i += 3)
    for (let a = 0; a < 3; a++) { const v = T[i + a]; if (v < m[a]) m[a] = v; if (v > M[a]) M[a] = v; }
  return { m, M };
}

// Solid test by ray parity along +z, brute force over all triangles.
function makeInside(T, n) {
  return (x, y, z) => {
    let c = 0;
    for (let t = 0; t < n; t++) {
      const o = t * 9;
      const ax = T[o], ay = T[o + 1], az = T[o + 2];
      const bx = T[o + 3], by = T[o + 4], bz = T[o + 5];
      const cx = T[o + 6], cy = T[o + 7], cz = T[o + 8];
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (d === 0) continue;
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
      const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
      if (l1 < 0 || l2 < 0 || 1 - l1 - l2 < 0) continue;
      if (l1 * az + l2 * bz + (1 - l1 - l2) * cz > z) c++;
    }
    return (c & 1) === 1;
  };
}

/**
 * Find the chain loop's hole: scan a plan grid at mid-height for empty cells
 * that are enclosed by material, then report the largest such pocket's extent.
 * The loop sits at one end, so only the outer fifth of the model is searched.
 */
function loopHole(T, n, b, axis, farEnd) {
  const inside = makeInside(T, n);
  const z = (b.m[2] + b.M[2]) / 2;
  const span = [b.M[0] - b.m[0], b.M[1] - b.m[1]];
  const step = Math.max(span[0], span[1]) / 300;
  const lo = [b.m[0], b.m[1]], hi = [b.M[0], b.M[1]];
  // narrow to the end where the loop is
  if (farEnd) lo[axis] = b.m[axis] + (b.M[axis] - b.m[axis]) * 0.80;
  else hi[axis] = b.m[axis] + (b.M[axis] - b.m[axis]) * 0.20;

  const nx = Math.ceil((hi[0] - lo[0]) / step), ny = Math.ceil((hi[1] - lo[1]) / step);
  const grid = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++)
      grid[j * nx + i] = inside(lo[0] + i * step, lo[1] + j * step, z) ? 1 : 0;

  // flood the border-connected air; whatever empty space is left is a hole
  const air = new Uint8Array(nx * ny);
  const st = [];
  for (let i = 0; i < nx; i++) { st.push(i, (ny - 1) * nx + i); }
  for (let j = 0; j < ny; j++) { st.push(j * nx, j * nx + nx - 1); }
  while (st.length) {
    const p = st.pop();
    if (air[p] || grid[p]) continue;
    air[p] = 1;
    const i = p % nx, j = (p / nx) | 0;
    if (i > 0) st.push(p - 1);
    if (i < nx - 1) st.push(p + 1);
    if (j > 0) st.push(p - nx);
    if (j < ny - 1) st.push(p + nx);
  }
  let count = 0, mi = Infinity, Mi = -Infinity, mj = Infinity, Mj = -Infinity;
  for (let p = 0; p < nx * ny; p++) {
    if (grid[p] || air[p]) continue;
    count++;
    const i = p % nx, j = (p / nx) | 0;
    if (i < mi) mi = i; if (i > Mi) Mi = i;
    if (j < mj) mj = j; if (j > Mj) Mj = j;
  }
  if (!count) return null;
  return { w: (Mi - mi) * step, h: (Mj - mj) * step };
}

const refs = [
  { name: 'Issaquah (14) - pendant top layer', file: 'C:\\Users\\david\\Downloads\\Issaquah (14).stl', xy: 0.59, axis: 1, farEnd: true },
  { name: 'Issaquah (13) - pendant body',      file: 'C:\\Users\\david\\Downloads\\Issaquah (13).stl', xy: 0.59, axis: 1, farEnd: true },
  { name: 'Mariners Assembled',                file: 'C:\\Users\\david\\Downloads\\Mariners Assembled.stl', xy: 1.0, axis: 0, farEnd: true },
  { name: 'Copy of Issaquah - keychain',       file: 'C:\\Users\\david\\Downloads\\Copy of Issaquah.stl', xy: 1.0, axis: 1, farEnd: true },
];

for (const r of refs) {
  if (!fs.existsSync(r.file)) { console.log(`MISSING ${r.file}`); continue; }
  const { T, n } = load(r.file);
  const b = bbox(T, n);
  const raw = [0, 1, 2].map(a => b.M[a] - b.m[a]);
  console.log(`\n${r.name}`);
  console.log(`  raw      ${raw.map(v => v.toFixed(2)).join(' x ')} mm`);
  if (r.xy !== 1) {
    console.log(`  x${r.xy} in XY  ${(raw[0] * r.xy).toFixed(2)} x ${(raw[1] * r.xy).toFixed(2)} x ${raw[2].toFixed(2)} mm  <- as placed in the 3mf`);
  }
  const hole = loopHole(T, n, b, r.axis, r.farEnd);
  if (hole) {
    console.log(`  chain hole  ${(hole.w * r.xy).toFixed(2)} x ${(hole.h * r.xy).toFixed(2)} mm` +
      (r.xy !== 1 ? ' (scaled)' : ''));
  } else {
    console.log('  no enclosed hole found at mid-height');
  }
}
