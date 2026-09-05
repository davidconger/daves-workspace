// Dumps the exact planes that form the Issaquah mount, so it can be rebuilt
// to the same dimensions rather than approximated from a picture.
//
// usage: node mount-dims.js <file.stl>

const fs = require('fs');
const file = process.argv[2] || 'C:\\Users\\david\\Downloads\\Copy of Issaquah.stl';
const buf = fs.readFileSync(file);
const n = buf.readUInt32LE(80);
const T = [];
for (let i = 0, o = 84; i < n; i++, o += 50) {
  const v = [];
  for (let k = 0; k < 9; k++) v.push(buf.readFloatLE(o + 12 + k * 4));
  T.push(v);
}

const R = (v) => Math.round(v * 1000) / 1000;

// Everything interesting is at the high-y end of the plate.
const zone = T.filter(t => Math.max(t[1], t[4], t[7]) > 136);
console.log(`${zone.length} of ${n} triangles sit in the mount zone (y > 136)\n`);

const vs = new Set();
for (const t of zone) for (let c = 0; c < 3; c++) vs.add(`${R(t[c * 3])} ${R(t[c * 3 + 1])} ${R(t[c * 3 + 2])}`);
const pts = [...vs].map(s => s.split(' ').map(Number));
console.log('distinct coordinate values in the mount zone:');
for (const [i, name] of [[0, 'x'], [1, 'y'], [2, 'z']]) {
  const u = [...new Set(pts.map(p => p[i]))].sort((a, b) => a - b);
  console.log(`  ${name}: ${u.join(', ')}`);
}

// Axis-aligned faces tell the whole story for a box-and-wedge mount: group the
// triangles by which plane they lie in and report the extent of each.
const planes = new Map();
for (const t of zone) {
  for (const [i, name] of [[0, 'x'], [1, 'y'], [2, 'z']]) {
    const a = R(t[i]), b = R(t[3 + i]), c = R(t[6 + i]);
    if (a === b && b === c) {
      const k = `${name}=${a}`;
      if (!planes.has(k)) planes.set(k, []);
      planes.get(k).push(t);
    }
  }
}
console.log('\nflat faces (plane -> extent of the other two axes):');
for (const [k, list] of [...planes.entries()].sort()) {
  const ax = k[0];
  const others = ['x', 'y', 'z'].filter(a => a !== ax);
  const oi = others.map(a => ({ x: 0, y: 1, z: 2 }[a]));
  const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const t of list)
    for (let c = 0; c < 3; c++)
      for (let j = 0; j < 2; j++) {
        const v = t[c * 3 + oi[j]];
        if (v < lo[j]) lo[j] = v;
        if (v > hi[j]) hi[j] = v;
      }
  console.log(`  ${k.padEnd(10)} ${String(list.length).padStart(3)} tris   ` +
    `${others[0]} ${R(lo[0])}..${R(hi[0])}   ${others[1]} ${R(lo[1])}..${R(hi[1])}`);
}
