// Reverse-engineers the Issaquah keychain so the Dragons one can match it.
//
// Two things need measuring: the plate thickness (and whether it is stepped),
// and the keyring mount, which the analyzer says is made of separate shells -
// almost certainly voids cut into the body rather than a protruding ring.
//
// usage: node measure-issaquah.js <file.stl>

const fs = require('fs');

const file = process.argv[2];
if (!file) { console.error('usage: node measure-issaquah.js <file.stl>'); process.exit(1); }

const buf = fs.readFileSync(file);
const n = buf.readUInt32LE(80);
const tris = new Float64Array(n * 9);
for (let i = 0, o = 84; i < n; i++, o += 50)
  for (let k = 0; k < 9; k++) tris[i * 9 + k] = buf.readFloatLE(o + 12 + k * 4);

// Weld vertices so shells can be found by shared edges.
const key = (x, y, z) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
const vmap = new Map();
const verts = [];
const idx = new Int32Array(n * 3);
for (let t = 0; t < n; t++)
  for (let c = 0; c < 3; c++) {
    const o = t * 9 + c * 3;
    const k = key(tris[o], tris[o + 1], tris[o + 2]);
    let v = vmap.get(k);
    if (v === undefined) { v = verts.length / 3; vmap.set(k, v); verts.push(tris[o], tris[o + 1], tris[o + 2]); }
    idx[t * 3 + c] = v;
  }

// Union-find over triangles sharing a vertex.
const parent = new Int32Array(verts.length / 3).map((_, i) => i);
const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
for (let t = 0; t < n; t++) { uni(idx[t * 3], idx[t * 3 + 1]); uni(idx[t * 3 + 1], idx[t * 3 + 2]); }

const shells = new Map();
for (let t = 0; t < n; t++) {
  const r = find(idx[t * 3]);
  if (!shells.has(r)) shells.set(r, []);
  shells.get(r).push(t);
}

function shellInfo(list) {
  const m = [Infinity, Infinity, Infinity], M = [-Infinity, -Infinity, -Infinity];
  let vol = 0;
  for (const t of list) {
    const o = t * 9;
    // signed volume via the divergence theorem; sign reveals void vs solid
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = tris.slice(o, o + 9);
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    for (let c = 0; c < 3; c++)
      for (let a = 0; a < 3; a++) {
        const v = tris[o + c * 3 + a];
        if (v < m[a]) m[a] = v;
        if (v > M[a]) M[a] = v;
      }
  }
  return { m, M, vol, tris: list.length };
}

const infos = [...shells.values()].map(shellInfo).sort((a, b) => Math.abs(b.vol) - Math.abs(a.vol));

console.log(`${file}\n${n} triangles, ${infos.length} shells\n`);
for (const s of infos) {
  const size = [0, 1, 2].map(a => (s.M[a] - s.m[a]).toFixed(2));
  const kind = s.vol > 0 ? 'SOLID' : 'VOID ';
  console.log(`  ${kind} ${String(s.tris).padStart(4)} tris  ` +
    `size ${size[0].padStart(6)} x ${size[1].padStart(6)} x ${size[2].padStart(6)}  ` +
    `|vol| ${Math.abs(s.vol).toFixed(1).padStart(8)}`);
  console.log(`         x ${s.m[0].toFixed(2)}..${s.M[0].toFixed(2)}   ` +
    `y ${s.m[1].toFixed(2)}..${s.M[1].toFixed(2)}   z ${s.m[2].toFixed(2)}..${s.M[2].toFixed(2)}`);
}

// Where does material actually sit in z? A stepped plate shows up as a jump in
// cross-section area between levels.
console.log('\ncross-section area by height (outer shell only):');
const outer = infos[0];
let zmin = Infinity, zmax = -Infinity;
for (let i = 2; i < n * 9; i += 3) { if (tris[i] < zmin) zmin = tris[i]; if (tris[i] > zmax) zmax = tris[i]; }
const zs = new Set();
for (let i = 2; i < n * 9; i += 3) zs.add(Math.round(tris[i] * 100) / 100);
console.log('  distinct z values present: ' + [...zs].sort((a, b) => a - b).join(', '));
