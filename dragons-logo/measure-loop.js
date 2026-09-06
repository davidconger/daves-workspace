// Measure the chain loop on the Issaquah pendant, so the Dragons one can copy it.
//
// The earlier measure-pendants.js guessed at holes from raw vertices and gave a
// nonsense 45.94 x 22.03mm "hole". This slices the mesh instead: a plane section
// of a closed mesh is a set of closed loops, so a scanline fill across those
// loops gives the solid region exactly, and any pocket of background that never
// reaches the border of the slice is a genuine hole.

const fs = require('fs');

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

/** Each <object> with a <mesh> inside a 3mf part, as its own triangle soup. */
function readModel(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const out = [];
  const objRe = /<object[^>]*id="(\d+)"[\s\S]*?<\/object>/g;
  let om;
  while ((om = objRe.exec(xml))) {
    const body = om[0];
    const verts = [];
    const vRe = /<vertex x="([-\d.eE+]+)" y="([-\d.eE+]+)" z="([-\d.eE+]+)"/g;
    let vm;
    while ((vm = vRe.exec(body))) verts.push([+vm[1], +vm[2], +vm[3]]);
    const tris = [];
    const tRe = /<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g;
    let tm;
    while ((tm = tRe.exec(body))) tris.push([verts[+tm[1]], verts[+tm[2]], verts[+tm[3]]]);
    if (tris.length) out.push({ id: om[1], tris });
  }
  return out;
}

function load(file) {
  const objs = file.toLowerCase().endsWith('.model')
    ? readModel(file)
    : [{ id: '-', tris: readSTL(file) }];
  // Sectioning always cuts along the third axis. Permuting the coordinates is
  // what lets the same code look at a slot edge-on instead of face-on, which is
  // the only way to see a profile that varies through the thickness.
  const ax = (process.env.AXIS || 'z').toLowerCase();
  if (ax === 'z') return objs;
  const pick = ax === 'x' ? [1, 2, 0] : [0, 2, 1];
  for (const o of objs) {
    o.tris = o.tris.map((t) => t.map((p) => [p[pick[0]], p[pick[1]], p[pick[2]]]));
  }
  return objs;
}

function bbox(tris) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of t) for (let k = 0; k < 3; k++) {
    if (p[k] < lo[k]) lo[k] = p[k];
    if (p[k] > hi[k]) hi[k] = p[k];
  }
  return { lo, hi, size: hi.map((v, k) => v - lo[k]) };
}

/** Segments where the mesh crosses z, as [[x,y],[x,y]]. */
function sectionZ(tris, z) {
  const segs = [];
  for (const t of tris) {
    const hits = [];
    for (let i = 0; i < 3; i++) {
      const a = t[i], b = t[(i + 1) % 3];
      const da = a[2] - z, db = b[2] - z;
      if ((da > 0 && db > 0) || (da < 0 && db < 0) || da === db) continue;
      const f = da / (da - db);
      hits.push([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])]);
    }
    if (hits.length < 2) continue;
    // Orient the segment from the triangle's outward normal, so that every
    // segment in the slice runs the same way round its own solid. Without this
    // the slice is just an unordered pile of sticks, which is all even-odd
    // parity needs but nowhere near enough to tell a union from a cavity.
    const [p, q, r] = t;
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const nx = u[1] * v[2] - u[2] * v[1];
    const ny = u[2] * v[0] - u[0] * v[2];
    let [a, b] = hits;
    if ((b[0] - a[0]) * -ny + (b[1] - a[1]) * nx < 0) [a, b] = [b, a];
    segs.push([a, b]);
  }
  return segs;
}

/**
 * Scanline fill of a set of closed section loops, by nonzero winding.
 *
 * Even-odd is wrong here and was actively misleading. These parts are unions of
 * separate closed shells that deliberately overlap - the funnel wedges are sunk
 * into the ring so the slicer has a solid intersection to weld rather than two
 * coincident faces - and under even-odd parity every overlap reads as a void,
 * because the scanline crosses two boundaries going in. That produced a
 * convincing picture of slots and slivers that are not in the mesh at all.
 * Nonzero counts direction instead, so overlapping solids stay solid.
 */
function fill(segs, lo, hi, step) {
  const w = Math.ceil((hi[0] - lo[0]) / step) + 2;
  const h = Math.ceil((hi[1] - lo[1]) / step) + 2;
  const m = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    const y = lo[1] + (j + 0.5) * step;
    const xs = [];
    for (const [a, b] of segs) {
      if (a[1] <= y && b[1] > y) xs.push([a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]), 1]);
      else if (b[1] <= y && a[1] > y) xs.push([a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]), -1]);
    }
    xs.sort((p, q) => p[0] - q[0]);
    let wind = 0;
    for (let k = 0; k + 1 < xs.length; k++) {
      wind += xs[k][1];
      if (wind === 0) continue;
      const i0 = Math.max(0, Math.ceil((xs[k][0] - lo[0]) / step - 0.5));
      const i1 = Math.min(w - 1, Math.floor((xs[k + 1][0] - lo[0]) / step - 0.5));
      for (let i = i0; i <= i1; i++) m[j * w + i] = 1;
    }
  }
  return { m, w, h };
}

/**
 * Cut a window out of a filled grid.
 *
 * The fill itself always runs over the whole bounding box, because scanline
 * winding is only right if the scanline starts outside the solid. Crop after
 * filling, never before.
 */
function crop(grid, gridLo, lo, hi, step) {
  const i0 = Math.max(0, Math.floor((lo[0] - gridLo[0]) / step));
  const j0 = Math.max(0, Math.floor((lo[1] - gridLo[1]) / step));
  const w = Math.min(grid.w - i0, Math.ceil((hi[0] - lo[0]) / step));
  const h = Math.min(grid.h - j0, Math.ceil((hi[1] - lo[1]) / step));
  const m = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) m[j * w + i] = grid.m[(j0 + j) * grid.w + (i0 + i)];
  }
  // A window asking for ground the mesh does not cover gets clamped to the
  // bbox. Hand back where the crop actually starts, not where it was asked to:
  // reporting the requested origin shifts every measurement that follows by the
  // clamped amount, and does it silently, which is worse than refusing.
  return { m, w, h, lo: [gridLo[0] + i0 * step, gridLo[1] + j0 * step] };
}

/** Background pockets that never touch the border are holes in the solid. */
function holes({ m, w, h }, lo, step) {
  const seen = new Uint8Array(w * h);
  const out = [];
  for (let s = 0; s < w * h; s++) {
    if (m[s] || seen[s]) continue;
    const stack = [s], cells = [];
    seen[s] = 1;
    let border = false;
    while (stack.length) {
      const c = stack.pop();
      cells.push(c);
      const x = c % w, y = (c / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (m[n] || seen[n]) continue;
        seen[n] = 1; stack.push(n);
      }
    }
    if (border || cells.length < 9) continue;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, sx = 0, sy = 0;
    for (const c of cells) {
      const x = c % w, y = (c / w) | 0;
      sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const area = cells.length * step * step;
    out.push({
      cx: lo[0] + (sx / cells.length + 0.5) * step,
      cy: lo[1] + (sy / cells.length + 0.5) * step,
      w: (x1 - x0 + 1) * step,
      h: (y1 - y0 + 1) * step,
      area,
      rEquiv: Math.sqrt(area / Math.PI),
    });
  }
  return out;
}

for (const file of process.argv.slice(2)) {
  for (const obj of load(file)) {
    const tris = obj.tris;
    const b = bbox(tris);
    console.log(`\n${'='.repeat(70)}\n${file}${obj.id === '-' ? '' : `  object ${obj.id}`}`);
    console.log(`  ${tris.length} triangles, ${b.size.map((v) => v.toFixed(2)).join(' x ')} mm`);
    console.log(`  x ${b.lo[0].toFixed(2)}..${b.hi[0].toFixed(2)}   ` +
      `y ${b.lo[1].toFixed(2)}..${b.hi[1].toFixed(2)}   ` +
      `z ${b.lo[2].toFixed(2)}..${b.hi[2].toFixed(2)}`);

    const step = +process.env.STEP || 0.2;
    const zs = +process.env.ZS || 3;
    // A window keeps the fill and the picture on the feature being measured, so
    // the loop is not four pixels in the corner of a 400mm letter.
    const win = process.env.WIN ? process.env.WIN.split(',').map(Number) : null;
    const lo = win ? [win[0], win[2], b.lo[2]] : b.lo;
    const hi = win ? [win[1], win[3], b.hi[2]] : b.hi;
    const px = +process.env.PX || 1;
    const fracs = [];
    if (process.env.ZAT) {
      for (const v of process.env.ZAT.split(',')) {
        fracs.push((+v - b.lo[2]) / (b.hi[2] - b.lo[2]));
      }
    } else {
      for (let i = 1; i <= zs; i++) fracs.push(i / (zs + 1));
    }

    for (const f of fracs) {
      const z = b.lo[2] + (b.hi[2] - b.lo[2]) * f;
      const segs = sectionZ(tris, z);
      if (!segs.length) continue;
      // Always fill over the full bbox: even-odd parity is only correct if the
      // scanline starts outside the part. Crop afterwards.
      const full = fill(segs, b.lo, b.hi, step);
      const grid = win ? crop(full, b.lo, lo, hi, step) : full;
      // Everything below must be read against where the crop really starts.
      const gLo = grid.lo || lo;
      if (win && (Math.abs(gLo[0] - lo[0]) > step || Math.abs(gLo[1] - lo[1]) > step)) {
        console.log(`    (window clamped to the mesh: origin ${gLo[0].toFixed(2)}, ${gLo[1].toFixed(2)})`);
      }
      const hs = holes(grid, gLo, step).sort((p, q) => q.area - p.area);
      console.log(`  z=${z.toFixed(2)}: ${hs.length} hole(s)` + (hs.length ? '' : '  (solid)'));
      for (const hle of hs.slice(0, 4)) {
        const round = Math.abs(hle.w - hle.h) < 0.15 * Math.max(hle.w, hle.h);
        console.log(`      ${hle.w.toFixed(2)} x ${hle.h.toFixed(2)}mm at ` +
          `(${hle.cx.toFixed(1)}, ${hle.cy.toFixed(1)})` +
          `  area ${hle.area.toFixed(1)}mm2, equiv d=${(hle.rEquiv * 2).toFixed(2)}mm` +
          (round ? '   <- round' : ''));

        // Widths straight across the hole, which is what a chain has to pass.
        for (const [lbl, horiz] of [['across', true], ['up', false]]) {
          const runs = [];
          const n = horiz ? grid.w : grid.h;
          const fixed = horiz
            ? Math.round((hle.cy - gLo[1]) / step - 0.5)
            : Math.round((hle.cx - gLo[0]) / step - 0.5);
          let start = null;
          for (let i = 0; i < n; i++) {
            const on = grid.m[horiz ? fixed * grid.w + i : i * grid.w + fixed];
            if (!on && start === null) start = i;
            else if (on && start !== null) { runs.push((i - start) * step); start = null; }
          }
          const inner = runs.filter((r) => r > 1 && r < Math.max(hle.w, hle.h) * 1.3);
          if (inner.length) console.log(`        clear ${lbl} the centre: ` +
            inner.map((r) => r.toFixed(2)).join(', ') + ' mm');
        }
      }

      if (process.env.ROWS) {
        // Material runs row by row at this z, so a slot cut through a ring can
        // be dimensioned - and, run at every z, so can any angle on its faces.
        const from = +process.env.ROWS_FROM || hi[1];
        const to = +process.env.ROWS_TO || (hi[1] - 60);
        const steps = +process.env.ROWS_N || 12;
        console.log(`    rows y=${from.toFixed(1)}..${to.toFixed(1)}:`);
        for (let y = from; y >= to; y -= (from - to) / steps) {
          const j = Math.round((y - gLo[1]) / step - 0.5);
          if (j < 0 || j >= grid.h) continue;
          const runs = [];
          let start = null;
          for (let i = 0; i < grid.w; i++) {
            const on = grid.m[j * grid.w + i];
            if (on && start === null) start = i;
            else if (!on && start !== null) {
              runs.push([gLo[0] + start * step, gLo[0] + i * step]);
              start = null;
            }
          }
          if (start !== null) runs.push([gLo[0] + start * step, gLo[0] + grid.w * step]);
          // The interesting number is the clear span between the first two runs:
          // that is the slot the chain link has to feed through.
          const gap = runs.length >= 2
            ? `   gap ${runs[0][1].toFixed(2)}..${runs[1][0].toFixed(2)} = ${(runs[1][0] - runs[0][1]).toFixed(2)}mm`
            : '';
          console.log(`      y=${y.toFixed(1).padStart(7)}: ` +
            (runs.length
              ? runs.map(([a, c]) => `${a.toFixed(1)}..${c.toFixed(1)}`).join('  ')
              : '-') + gap);
        }
      }

      if (process.env.PNG) {
        const Jimp = require('jimp');
        const img = new Jimp(grid.w * px, grid.h * px, 0xffffffff);
        for (let i = 0; i < grid.w * grid.h; i++) {
          if (!grid.m[i]) continue;
          const x = (i % grid.w) * px, y = (grid.h - 1 - ((i / grid.w) | 0)) * px;
          for (let dy = 0; dy < px; dy++) for (let dx = 0; dx < px; dx++) {
            img.setPixelColor(0x303030ff, x + dx, y + dy);
          }
        }
        const name = `build/sec-${file.replace(/.*[\\/]/, '').replace(/\W/g, '_')}` +
          `-o${obj.id}-z${z.toFixed(1).replace(/[.-]/g, '_')}.png`;
        img.write(name);
        console.log(`        wrote ${name}`);
      }
    }
  }
}
