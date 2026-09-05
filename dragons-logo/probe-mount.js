// Maps the Issaquah keychain's mount as ASCII cross-sections.
//
// The shells overlap, so bounding boxes alone cannot say what is material and
// what is air. Ray-parity against every triangle can. Only 368 triangles here,
// so brute force is fine and avoids any indexing bug.
//
// usage: node probe-mount.js <file.stl>

const fs = require('fs');

const file = process.argv[2] || 'C:\\Users\\david\\Downloads\\Copy of Issaquah.stl';
const buf = fs.readFileSync(file);
const n = buf.readUInt32LE(80);
const T = new Float64Array(n * 9);
for (let i = 0, o = 84; i < n; i++, o += 50)
  for (let k = 0; k < 9; k++) T[i * 9 + k] = buf.readFloatLE(o + 12 + k * 4);

const m = [Infinity, Infinity, Infinity], M = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < n * 9; i += 3)
  for (let a = 0; a < 3; a++) { const v = T[i + a]; if (v < m[a]) m[a] = v; if (v > M[a]) M[a] = v; }

// Parity of crossings along +z. Shells that overlap would double-count, so use
// odd/even rather than a winding number - matches how a slicer reads it.
function inside(x, y, z) {
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
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    if (l1 * az + l2 * bz + l3 * cz > z) c++;
  }
  return (c & 1) === 1;
}

function plan(z, x0, x1, y0, y1, cols = 76) {
  const step = (x1 - x0) / cols;
  const rows = Math.max(1, Math.round((y1 - y0) / step / 2));
  console.log(`\n  --- plan view at z = ${z.toFixed(2)} mm  (x ${x0.toFixed(1)}..${x1.toFixed(1)}, y ${y0.toFixed(1)}..${y1.toFixed(1)}) ---`);
  for (let r = rows - 1; r >= 0; r--) {
    const y = y0 + ((r + 0.5) / rows) * (y1 - y0);
    let s = '  ';
    for (let c = 0; c < cols; c++) s += inside(x0 + (c + 0.5) * step, y, z) ? '#' : '.';
    console.log(s);
  }
}

function section(x, y0, y1, z0, z1, cols = 76) {
  const step = (y1 - y0) / cols;
  const rows = Math.max(1, Math.round((z1 - z0) / step / 2));
  console.log(`\n  --- vertical section at x = ${x.toFixed(2)} mm  (y across, z up) ---`);
  for (let r = rows - 1; r >= 0; r--) {
    const z = z0 + ((r + 0.5) / rows) * (z1 - z0);
    let s = '  ';
    for (let c = 0; c < cols; c++) s += inside(x, y0 + (c + 0.5) * step, z) ? '#' : '.';
    console.log(s + `  z=${z.toFixed(1)}`);
  }
}

console.log(`${file}`);
console.log(`bounds ${(M[0] - m[0]).toFixed(2)} x ${(M[1] - m[1]).toFixed(2)} x ${(M[2] - m[2]).toFixed(2)} mm`);

// The mount sits at the high-y end; look there in detail.
const yA = M[1] - 12, yB = M[1] + 0.5;
plan(1.0, m[0] - 0.5, M[0] + 0.5, yA, yB);
plan(4.5, m[0] - 0.5, M[0] + 0.5, yA, yB);
plan(7.5, m[0] - 0.5, M[0] + 0.5, yA, yB);

// Straight down the middle of the mount, and off to one side for reference.
section(-38.8, yA, yB, m[2] - 0.5, M[2] + 0.5);
section(-41.0, yA, yB, m[2] - 0.5, M[2] + 0.5);
section(-33.0, yA, yB, m[2] - 0.5, M[2] + 0.5);
