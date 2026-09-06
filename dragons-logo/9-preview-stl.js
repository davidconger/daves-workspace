// Phase 9: render the STLs so they can be judged without opening a slicer.
//
// A tilted orthographic view with a z-buffer and Lambertian shading is enough
// to show what matters here: whether the relief reads, whether the keyring
// attachment looks right, and whether the colour parts line up.

const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

const SIZE = 480;
const PITCH = -28 * Math.PI / 180;
const LIGHT = (() => {
  const v = [-0.35, 0.45, 0.82];
  const L = Math.hypot(...v);
  return v.map((k) => k / L);
})();

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

function render(parts, opts = {}) {
  // parts: [{ tris, color:[r,g,b] }]
  const size = opts.size || SIZE;
  const pitch = opts.pitch === undefined ? PITCH : opts.pitch;
  const all = parts.flatMap((p) => p.tris);
  const view = (p) => [
    p[0],
    p[1] * Math.cos(pitch) - p[2] * Math.sin(pitch),
    p[1] * Math.sin(pitch) + p[2] * Math.cos(pitch),
  ];

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of all) for (const p of t) {
    const q = view(p);
    minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]);
    minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]);
  }
  if (opts.fit) [minX, maxX, minY, maxY] = opts.fit;
  const pad = 0.06 * Math.max(maxX - minX, maxY - minY);
  const sc = (size - 2) / (Math.max(maxX - minX, maxY - minY) + 2 * pad);
  const ox = (size - (maxX - minX) * sc) / 2 - minX * sc;
  const oy = (size - (maxY - minY) * sc) / 2 - minY * sc;

  const depth = new Float64Array(size * size).fill(-Infinity);
  const col = new Uint8Array(size * size * 3).fill(255);

  for (const part of parts) {
    for (const t of part.tris) {
      const q = t.map(view);
      const u = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]];
      const v = [q[2][0] - q[0][0], q[2][1] - q[0][1], q[2][2] - q[0][2]];
      let nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const L = Math.hypot(...nrm) || 1;
      nrm = nrm.map((k) => k / L);
      if (nrm[2] < 0) continue; // back face

      const lam = Math.max(0, nrm[0] * LIGHT[0] + nrm[1] * LIGHT[1] + nrm[2] * LIGHT[2]);
      const shade = 0.32 + 0.68 * lam;

      const sx = q.map((p) => p[0] * sc + ox);
      const sy = q.map((p) => size - (p[1] * sc + oy));
      const x0 = Math.max(0, Math.floor(Math.min(...sx)));
      const x1 = Math.min(size - 1, Math.ceil(Math.max(...sx)));
      const y0 = Math.max(0, Math.floor(Math.min(...sy)));
      const y1 = Math.min(size - 1, Math.ceil(Math.max(...sy)));

      const d = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]);
      if (Math.abs(d) < 1e-12) continue;

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          const w0 = ((sx[1] - px) * (sy[2] - py) - (sx[2] - px) * (sy[1] - py)) / d;
          const w1 = ((sx[2] - px) * (sy[0] - py) - (sx[0] - px) * (sy[2] - py)) / d;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
          const z = w0 * q[0][2] + w1 * q[1][2] + w2 * q[2][2];
          const i = y * size + x;
          if (z <= depth[i]) continue;
          depth[i] = z;
          for (let k = 0; k < 3; k++) {
            col[i * 3 + k] = Math.min(255, Math.round(part.color[k] * shade));
          }
        }
      }
    }
  }

  const img = new Jimp(size, size, 0xffffffff);
  for (let i = 0; i < size * size; i++) {
    img.setPixelColor(
      Jimp.rgbaToInt(col[i * 3], col[i * 3 + 1], col[i * 3 + 2], 255),
      i % size, (i / size) | 0);
  }
  return img;
}

const C = {
  gray: [149, 149, 151],
  green: [76, 193, 40],
  red: [237, 28, 36],
  white: [246, 246, 246],
  plate: [176, 178, 182],
  mono: [176, 178, 182],
};

const ORDER = ['plate', 'gray', 'white', 'red', 'green'];

/**
 * True cross-section: where each triangle crosses a plane, keep the segment.
 *
 * Clipping whole triangles cannot show a buried void - the walls around the
 * void span the cut and get thrown away with it, leaving the solid floor below
 * looking untouched. Intersecting the plane instead draws the outline of the
 * material actually present at that height, which is the only honest way to
 * see a pocket that by design is invisible from outside.
 *
 * `axis` is the index cut across; the returned points are the other two.
 */
function section(tris, axis, value) {
  const other = [0, 1, 2].filter((i) => i !== axis);
  const segs = [];
  for (const t of tris) {
    const hits = [];
    for (let i = 0; i < 3; i++) {
      const a = t[i], b = t[(i + 1) % 3];
      const da = a[axis] - value, db = b[axis] - value;
      if ((da > 0 && db > 0) || (da < 0 && db < 0)) continue;
      if (da === db) continue;
      const f = da / (da - db);
      hits.push(other.map((k) => a[k] + f * (b[k] - a[k])));
    }
    if (hits.length >= 2) segs.push([hits[0], hits[1]]);
  }
  return segs;
}

/** Draw section segments as a line drawing, with a millimetre grid behind. */
function drawSection(segs, fit, size = SIZE, grid = 1) {
  const [x0, x1, y0, y1] = fit;
  const sc = (size - 2) / Math.max(x1 - x0, y1 - y0);
  const img = new Jimp(size, size, 0xffffffff);
  const px = (p) => [Math.round((p[0] - x0) * sc) + 1, size - 1 - Math.round((p[1] - y0) * sc)];

  for (let g = Math.ceil(x0 / grid) * grid; g <= x1; g += grid) {
    const [gx] = px([g, y0]);
    if (gx >= 0 && gx < size) {
      for (let y = 0; y < size; y++) img.setPixelColor(0xeeeeeeff, gx, y);
    }
  }
  for (let g = Math.ceil(y0 / grid) * grid; g <= y1; g += grid) {
    const [, gy] = px([x0, g]);
    if (gy >= 0 && gy < size) {
      for (let x = 0; x < size; x++) img.setPixelColor(0xeeeeeeff, x, gy);
    }
  }

  for (const [a, b] of segs) {
    const [ax, ay] = px(a), [bx, by] = px(b);
    const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
    for (let i = 0; i <= n; i++) {
      const x = Math.round(ax + (bx - ax) * i / n);
      const y = Math.round(ay + (by - ay) * i / n);
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = 0; dx <= 1; dx++) {
          if (x + dx >= 0 && x + dx < size && y + dy >= 0 && y + dy < size) {
            img.setPixelColor(0x1a1a1aff, x + dx, y + dy);
          }
        }
      }
    }
  }
  return img;
}

function loadStyle(dir) {
  return ORDER
    .filter((n) => fs.existsSync(path.join(dir, `${n}.stl`)))
    .map((n) => ({ name: n, tris: readSTL(path.join(dir, `${n}.stl`)), color: C[n] }));
}

(async () => {
  const font = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK);
  const LB = 26;
  fs.mkdirSync('preview', { recursive: true });

  const products = fs.existsSync('stl')
    ? fs.readdirSync('stl').filter((d) => fs.statSync(path.join('stl', d)).isDirectory())
    : [];

  for (const product of products) {
    const styles = fs.readdirSync(path.join('stl', product))
      .filter((d) => fs.statSync(path.join('stl', product, d)).isDirectory());

    const panels = [];
    for (const style of styles) {
      const dir = path.join('stl', product, style);
      const parts = loadStyle(dir);
      if (!parts.length) continue;

      panels.push({ label: `${product} / ${style}`, img: render(parts) });

      const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      const body = parts.find((p) => p.name === 'plate' || p.name === 'gray');
      if (man.mount === 'slot' && body && man.mountXY) {
        const [mx, my] = man.mountXY;
        const half = man.slot.r * 2.6;

        // Horizontal cut through the middle of the pocket: shows the mouth in
        // the outline and the bar standing free across it.
        panels.push({
          label: `plan section at z=${(man.plateH / 2).toFixed(1)}mm  (${(half * 2).toFixed(0)}mm wide, 1mm grid)`,
          img: drawSection(section(body.tris, 2, man.plateH / 2),
            [mx - half, mx + half, my - half * 0.8, my + half * 1.2]),
        });

        // Vertical cut along the slot: shows the solid floor and roof that keep
        // the pocket from ever breaking the surface.
        panels.push({
          label: `side section at y=${my.toFixed(1)}mm  (x vs z, 1mm grid)`,
          img: drawSection(section(body.tris, 1, my)
            .map(([a, b]) => [[a[0], a[1]], [b[0], b[1]]]),
          [mx - half, mx + half, -half * 0.4, half * 1.6]),
        });
      }
      if (man.mount === 'ring' && body && man.mountXY) {
        const [mx, my] = man.mountXY;
        const half = man.ring.outer * 1.6;
        panels.push({
          label: `chain loop detail  (${(half * 2).toFixed(0)}mm wide)`,
          img: render(parts, { pitch: 0, fit: [mx - half, mx + half, my - half, my + half] }),
        });
        // Wide enough to take in the flare sweeping back off the head, which is
        // the thing the chain would foul if the trim were not far enough back.
        const w = man.ring.outer * 3.4;
        panels.push({
          label: 'loop and flare clearance',
          img: render(parts, { pitch: 0, fit: [mx - w * 0.45, mx + w * 1.55, my - w * 0.7, my + w * 1.3] }),
        });
      }
    }
    if (!panels.length) continue;

    const cols = Math.min(3, panels.length);
    const rows = Math.ceil(panels.length / cols);
    const sheet = new Jimp(cols * SIZE + 12, rows * (SIZE + LB) + 12, 0xffffffff);
    panels.forEach((p, i) => {
      const cx = (i % cols) * SIZE + 6;
      const cy = ((i / cols) | 0) * (SIZE + LB) + 6;
      sheet.composite(p.img, cx, cy);
      sheet.print(font, cx + 8, cy + SIZE + 2, p.label);
    });
    await sheet.writeAsync(`preview/${product}.png`);
    console.log(`Wrote preview/${product}.png  (${panels.length} view(s))`);
  }
})();

