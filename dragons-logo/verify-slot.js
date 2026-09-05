// Verify the internalised mount on the built STL, the same way the Issaquah
// original was measured - by probing the finished mesh, not by trusting the
// code that generated it.
//
// A point is inside a closed mesh if a ray from it crosses an odd number of
// faces, so the solid and void bands can be read straight off the geometry.

const fs = require('fs');
const path = require('path');

function readSTL(file) {
  const buf = fs.readFileSync(file);
  const n = buf.readUInt32LE(80);
  const tris = [];
  let o = 84;
  for (let i = 0; i < n; i++) {
    o += 12;
    const v = [];
    for (let k = 0; k < 3; k++) {
      v.push([buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)]);
      o += 12;
    }
    o += 2;
    tris.push(v);
  }
  return tris;
}

/** Moller-Trumbore, ray along +x. With d = (1,0,0), d x e2 = (0, -e2z, e2y). */
function inside(tris, p) {
  let hits = 0;
  for (const t of tris) {
    const [a, b, c] = t;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const h = [0, -e2[2], e2[1]];
    const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const s = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) * inv;
    if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = q[0] * inv;
    if (v < 0 || u + v > 1) continue;
    const tt = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
    if (tt > 1e-9) hits++;
  }
  return hits % 2 === 1;
}

/** Solid bands along a line, sampled finely. */
function bands(tris, at, from, to, step = 0.05) {
  const out = [];
  let start = null;
  for (let v = from; v <= to; v += step) {
    const on = inside(tris, at(v));
    if (on && start === null) start = v;
    else if (!on && start !== null) { out.push([start, v - step]); start = null; }
  }
  if (start !== null) out.push([start, to]);
  return out;
}

const fmt = (bs) => bs.length
  ? bs.map(([a, b]) => `${a.toFixed(2)}-${b.toFixed(2)}`).join(', ')
  : '(none)';

const dir = process.argv[2] || path.join('stl', 'keychain-56mm', 'emboss');
const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const body = fs.existsSync(path.join(dir, 'plate.stl')) ? 'plate.stl' : 'gray.stl';
const tris = readSTL(path.join(dir, body));
const [mx, my] = man.mountXY;
const S = man.slot;

// The mouth opens along the edge, not along x. SVG counts y downward and the
// model counts it up, so the slope flips sign on the way out.
const th = -man.slot.slopeDeg * Math.PI / 180;
const T = [Math.cos(th), Math.sin(th)];     // along the edge, across the mouth
const N = [Math.sin(th), -Math.cos(th)];    // into the material, along the post
const at = (a, b, z) => [mx + T[0] * a + N[0] * b, my + T[1] * a + N[1] * b, z];

console.log(`${dir}/${body}: ${tris.length} triangles`);
console.log(`plate ${man.plateH}mm, pocket r${S.r}mm at (${mx.toFixed(2)}, ${my.toFixed(2)}), ` +
  `post ${S.barW} x ${S.barD}mm, ${S.wall}mm walls, edge slope ${S.slopeDeg}deg\n`);

console.log('Solid through the thickness (z, mm):');
for (const [label, a, b] of [
  ['post centre        ', 0, S.barD / 2],
  ['opening, one side  ', -(S.barW / 2 + 1.2), S.barD / 2],
  ['opening, other side', +(S.barW / 2 + 1.2), S.barD / 2],
  ['behind the pocket  ', 0, S.r + 1.5],
]) {
  const bands_ = bands(tris, (z) => at(a, b, z), -0.2, man.plateH + 0.2, 0.02);
  console.log(`  ${label}  ${fmt(bands_)}`);
}

console.log('\nSolid across the mouth at mid-thickness (mm along the edge, 0 = post centre):');
const mid = man.plateH / 2;
console.log(`  z=${mid.toFixed(2)}, at the post face:  ` +
  fmt(bands(tris, (a) => at(a, S.barD / 2, mid), -(S.r + 3), S.r + 3, 0.02)));
console.log(`  z=${(S.wall / 2).toFixed(2)} (solid floor):    ` +
  fmt(bands(tris, (a) => at(a, S.barD / 2, S.wall / 2), -(S.r + 3), S.r + 3, 0.02)));

console.log('\nDoes the mouth reach open air? Solid inward from outside the edge:');
console.log(`  through the post:     ` +
  fmt(bands(tris, (b) => at(0, b, mid), -3, S.r + 3, 0.02)));
console.log(`  through the opening:  ` +
  fmt(bands(tris, (b) => at(S.barW / 2 + 1.2, b, mid), -3, S.r + 3, 0.02)));
