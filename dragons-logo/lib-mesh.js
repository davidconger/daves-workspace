// Turning the vector logo into printable solids.
//
// The STL is built straight from a high-resolution render of the finished SVG
// rather than from the path data. That sounds indirect, but it is the only way
// to get this right: the logo contains stroked seams and overlapping painted
// layers, and what a slicer needs is the *resulting* filled region, not the
// individual drawing operations. Rendering first collapses all of that into
// exactly the shape you see, and then one contour pass recovers it as polygons.
//
// Contours come out of the same level-set extractor used for the tracing work,
// so they carry sub-pixel accuracy rather than pixel staircases.

const earcutMod = require('earcut');
// earcut v3 is published as ESM, so CommonJS sees the function on `.default`.
// fit-curve, used elsewhere in this project, does the exact opposite. Resolve
// it explicitly and assert, because getting this wrong throws deep inside the
// extrude loop where it reads like a geometry bug.
const earcut = typeof earcutMod === 'function' ? earcutMod : earcutMod.default;
if (typeof earcut !== 'function') throw new Error('earcut import resolved to a non-function');

const fs = require('fs');
const { blurField, isoContours, resample } = require('./lib-curve');

/** Signed area; positive means counter-clockwise in a y-up frame. */
function signedArea(loop) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function pointInLoop(pt, loop) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) &&
        pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Extract closed polygons from a binary mask, in mask pixel coordinates.
 * A small blur is applied purely to suppress the render's antialiasing edge;
 * the source here is a clean vector render, so it needs far less than the
 * original JPEG did.
 */
function maskToLoops(mask, w, h, { sigma = 1.0, spacing = 2.0 } = {}) {
  const f = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) f[i] = mask[i] ? 1 : 0;
  const blurred = blurField(f, w, h, sigma);
  return isoContours(blurred, w, h, 0.5)
    .map((l) => resample(l, spacing))
    .filter((l) => l.length >= 8 && Math.abs(signedArea(l)) > 12);
}

/**
 * Group loops into polygons with holes. A loop nested inside an odd number of
 * others is a hole; even means it is a new solid island (an island inside a
 * hole, e.g. the ball face sitting in its ring gap).
 */
function buildPolygons(loops) {
  const depth = loops.map((l, i) =>
    loops.reduce((d, o, j) => (i !== j && pointInLoop(l[0], o) ? d + 1 : d), 0));

  const polys = [];
  loops.forEach((loop, i) => {
    if (depth[i] % 2 !== 0) return;
    const holes = loops.filter((o, j) =>
      j !== i && depth[j] === depth[i] + 1 && pointInLoop(o[0], loop));
    polys.push({ outer: loop, holes });
  });
  return polys;
}

/**
 * Triangulate a polygon so that the result uses *every* vertex it was given.
 *
 * earcut discards vertices that are collinear with their neighbours before it
 * starts clipping. That is correct for a flat cap, but the side walls are built
 * from the contour points, so any vertex the cap skipped becomes an edge the
 * wall has and the cap doesn't - a hole in the solid exactly there. Resampled
 * contours contain long straight runs, so this happened in the hundreds.
 *
 * Rather than guess a collinearity epsilon, feed earcut the ring, see which
 * vertices it actually referenced, drop the rest, and repeat. This converges in
 * a couple of passes and leaves the caps and walls sharing one vertex set by
 * construction.
 */
function triangulateStable(outer, holes) {
  let rings = [outer, ...holes];

  for (let pass = 0; pass < 12; pass++) {
    const verts = [];
    const holeIdx = [];
    rings.forEach((r, i) => {
      if (i > 0) holeIdx.push(verts.length / 2);
      for (const p of r) verts.push(p[0], p[1]);
    });

    const idx = earcut(verts, holeIdx, 2);
    const used = new Set(idx);
    if (used.size === verts.length / 2) return { rings, idx, verts };

    let base = 0;
    const next = rings.map((r) => {
      const kept = r.filter((_, k) => used.has(base + k));
      base += r.length;
      return kept;
    });
    if (next.some((r) => r.length < 3)) return { rings, idx, verts };
    rings = next;
  }

  const verts = [];
  const holeIdx = [];
  rings.forEach((r, i) => {
    if (i > 0) holeIdx.push(verts.length / 2);
    for (const p of r) verts.push(p[0], p[1]);
  });
  return { rings, idx: earcut(verts, holeIdx, 2), verts };
}

/**
 * Extrude polygons between two heights into a closed triangle mesh.
 *
 * `xform` maps a contour point to millimetres. Winding is normalised first
 * (outer counter-clockwise, holes clockwise) so that every generated normal
 * points out of the solid without any per-face guesswork.
 */
function extrude(polys, z0, z1, xform) {
  const tris = [];

  for (const poly of polys) {
    const outer = poly.outer.map(xform);
    const holes = poly.holes.map((h) => h.map(xform));
    if (signedArea(outer) < 0) outer.reverse();
    for (const h of holes) if (signedArea(h) > 0) h.reverse();

    const { rings, idx, verts } = triangulateStable(outer, holes);
    const at = (k) => [verts[k * 2], verts[k * 2 + 1]];

    for (let i = 0; i < idx.length; i += 3) {
      const a = at(idx[i]), b = at(idx[i + 1]), c = at(idx[i + 2]);
      tris.push([[a[0], a[1], z1], [b[0], b[1], z1], [c[0], c[1], z1]]);
      tris.push([[c[0], c[1], z0], [b[0], b[1], z0], [a[0], a[1], z0]]);
    }

    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        tris.push([[p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1]]);
        tris.push([[p[0], p[1], z0], [q[0], q[1], z1], [p[0], p[1], z1]]);
      }
    }
  }
  return tris;
}

function writeBinarySTL(tris, file) {
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.write('dragons-elite keychain'.padEnd(79), 0, 'ascii');
  buf.writeUInt32LE(tris.length, 80);

  let o = 84;
  for (const t of tris) {
    const [a, b, c] = t;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const L = Math.hypot(n[0], n[1], n[2]) || 1;
    n = n.map((k) => k / L);
    for (const k of n) { buf.writeFloatLE(k, o); o += 4; }
    for (const p of [a, b, c]) for (const k of p) { buf.writeFloatLE(k, o); o += 4; }
    buf.writeUInt16LE(0, o); o += 2;
  }
  fs.writeFileSync(file, buf);
  return tris.length;
}

/**
 * Every edge must be shared by exactly two triangles for the mesh to be a
 * closed solid. Slicers will often repair a mesh that isn't, but silently and
 * unpredictably, so it is worth failing loudly here instead.
 */
function checkManifold(tris) {
  const key = (p) => p.map((k) => Math.round(k * 1000)).join(',');
  const edges = new Map();
  for (const t of tris) {
    for (let i = 0; i < 3; i++) {
      const a = key(t[i]), b = key(t[(i + 1) % 3]);
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(e, (edges.get(e) || 0) + 1);
    }
  }
  let bad = 0;
  for (const n of edges.values()) if (n !== 2) bad++;
  return { edges: edges.size, bad };
}

module.exports = {
  maskToLoops, buildPolygons, extrude, writeBinarySTL, checkManifold,
  signedArea, pointInLoop,
};
