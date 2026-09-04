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

function render(parts, size = SIZE) {
  // parts: [{ tris, color:[r,g,b] }]
  const all = parts.flatMap((p) => p.tris);
  const view = (p) => [
    p[0],
    p[1] * Math.cos(PITCH) - p[2] * Math.sin(PITCH),
    p[1] * Math.sin(PITCH) + p[2] * Math.cos(PITCH),
  ];

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of all) for (const p of t) {
    const q = view(p);
    minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]);
    minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]);
  }
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
  mono: [176, 178, 182],
};

const OPTIONS = ['none', 'winghole', 'tab', 'toptab-half', 'toptab-short'];

(async () => {
  const font = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK);
  const LB = 26, cols = 3;

  for (const style of ['emboss', 'ams']) {
    const panels = [];
    for (const keyring of OPTIONS) {
      const dir = path.join('stl', `${style}-${keyring}`);
      if (!fs.existsSync(dir)) continue;
      let img;
      if (style === 'emboss') {
        img = render([{ tris: readSTL(path.join(dir, 'dragons-keychain.stl')), color: C.mono }]);
      } else {
        img = render(['gray', 'green', 'white', 'red'].map((n) => ({
          tris: readSTL(path.join(dir, `${n}.stl`)),
          color: C[n],
        })));
      }
      panels.push({ label: `${style}-${keyring}`, img });
    }

    const rows = Math.ceil(panels.length / cols);
    const sheet = new Jimp(cols * SIZE + 12, rows * (SIZE + LB) + 12, 0xffffffff);
    panels.forEach((p, i) => {
      const cx = (i % cols) * SIZE + 6;
      const cy = ((i / cols) | 0) * (SIZE + LB) + 6;
      sheet.composite(p.img, cx, cy);
      sheet.print(font, cx + 8, cy + SIZE + 2, p.label);
    });
    await sheet.writeAsync(`build/stl-preview-${style}.png`);
    console.log(`Wrote build/stl-preview-${style}.png  (${panels.length} variants)`);

    for (const p of panels) await p.img.writeAsync(`build/stl-${p.label}.png`);
  }
})();

