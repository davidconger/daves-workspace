// Phase 4: assemble the final SVG (traced dragon + mathematically rebuilt ball)
// and score it against the source bitmap so accuracy is measured, not guessed.

const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const { Resvg } = require('@resvg/resvg-js');

const SRC = 'source-logo-600.jpg';
const S = 600; // final SVG user units

const C = { green: '#4cc128', gray: '#959597', red: '#ed1c24', white: '#ffffff' };

// Measured by least-squares circle fit in 3b-fit-rings.js.
const BALL = {
  cx: 297.51,
  cy: 313.23,
  rFace: 112.50,    // white face of the ball
  rWhite: 130.50,   // white disc incl. the gap between the two rings
  rInner: 117.50,   // centreline of inner gray ring
  wInner: 10.0,
  rOuter: 134.00,   // centreline of outer gray ring
  wOuter: 7.0,
};

// Seam spines run from the top of the ball face to the bottom, bowing toward
// the centre. Endpoints sit exactly on rFace, as in the original. waistDX is the
// measured horizontal offset of the seam's midpoint from the ball centre.
// halfH measured off the source at 84, giving a 168px vertical span.
const SEAM = { halfH: 84, waistDX: -38.5 };

/**
 * One seam, drawn as a fishbone: a continuous spine with short angled barbs on
 * both sides. The original uses tight hooked stitches; these are simplified and
 * thickened so they survive at keychain scale, but the read is the same.
 */
function seam(mirror, o) {
  const { cx, cy, rFace } = BALL;
  const mx = (x) => (mirror ? 2 * cx - x : x);

  const halfH = SEAM.halfH;
  const edgeDX = -Math.sqrt(rFace * rFace - halfH * halfH); // keeps ends on the ball
  // A quadratic bezier's midpoint is (P0 + 2C + P2)/4, so solve C for the
  // measured waist offset.
  const ctrlDX = 2 * SEAM.waistDX - edgeDX;
  const p0 = [mx(cx + edgeDX), cy - halfH];
  const pc = [mx(cx + ctrlDX), cy];
  const p2 = [mx(cx + edgeDX), cy + halfH];

  const at = (t) => {
    const u = 1 - t;
    return [u * u * p0[0] + 2 * u * t * pc[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * pc[1] + t * t * p2[1]];
  };
  const tan = (t) => {
    const u = 1 - t;
    const dx = 2 * u * (pc[0] - p0[0]) + 2 * t * (p2[0] - pc[0]);
    const dy = 2 * u * (pc[1] - p0[1]) + 2 * t * (p2[1] - pc[1]);
    const L = Math.hypot(dx, dy) || 1;
    return [dx / L, dy / L];
  };

  const spine = `<path fill="none" stroke-width="${o.spineW}" d="M ${p0[0].toFixed(2)},${p0[1].toFixed(2)} ` +
    `Q ${pc[0].toFixed(2)},${pc[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}"/>`;

  const barbs = [];
  const th = (o.lean * Math.PI) / 180;
  for (let k = 0; k < o.count; k++) {
    const t = (k + 0.5) / o.count;
    const [x, y] = at(t);
    const [tx, ty] = tan(t);
    for (const side of [1, -1]) {
      // Perpendicular, then leaned back toward the top of the seam.
      const nx = -ty * side, ny = tx * side;
      const dx = nx * Math.cos(th) + tx * Math.sin(th);
      const dy = ny * Math.cos(th) + ty * Math.sin(th);
      barbs.push(
        `<line x1="${x.toFixed(2)}" y1="${y.toFixed(2)}" ` +
        `x2="${(x + dx * o.barbLen).toFixed(2)}" y2="${(y + dy * o.barbLen).toFixed(2)}"/>`
      );
    }
  }
  return `<g stroke-width="${o.barbW}">\n      ${spine}\n      ${barbs.join('\n      ')}\n    </g>`;
}

function buildSVG(paths, opts, traceScale) {
  const k = (1 / traceScale).toFixed(6);
  const g = (d, fill) =>
    d ? `<g transform="scale(${k})"><path fill="${fill}" fill-rule="evenodd" d="${d}"/></g>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
  <!-- The gray outline is the solid silhouette with green painted over it, not a
       traced band. A band that thin erodes under smoothing and can open gaps;
       differencing two large shapes keeps it continuous and watertight. -->
  <g id="dragon-outline">${g(paths.silhouette, C.gray)}</g>
  <!-- The ball sits behind the dragon: in the original the body crosses in front
       of the rings at the upper right, so it must be painted before green. -->
  <g id="baseball">
    <circle cx="${BALL.cx}" cy="${BALL.cy}" r="${BALL.rWhite}" fill="${C.white}"/>
    <circle cx="${BALL.cx}" cy="${BALL.cy}" r="${BALL.rOuter}" fill="none"
            stroke="${C.gray}" stroke-width="${BALL.wOuter}"/>
    <circle cx="${BALL.cx}" cy="${BALL.cy}" r="${BALL.rInner}" fill="none"
            stroke="${C.gray}" stroke-width="${BALL.wInner}"/>
  </g>
  <g id="dragon-body">${g(paths.green, C.green)}</g>
  <g id="seams" stroke="${C.red}" fill="none" stroke-linecap="round">
    ${seam(false, opts)}
    ${seam(true, opts)}
  </g>
  <g id="dragon-eye">${g(paths.red, C.red)}</g>
</svg>
`;
}

/** Render SVG and compare to the source, classifying both to the 4-colour palette. */
async function score(svg, tag) {
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: 600 },
    background: '#ffffff',
  }).render().asPng();
  const mine = await Jimp.read(png);
  const src = await Jimp.read(SRC);

  const cl = require('./lib-color').classify;
  const names = require('./lib-color').NAMES;

  let same = 0, total = 0;
  const per = [0, 0, 0, 0], perTot = [0, 0, 0, 0];
  const diff = new Jimp(600, 600, 0xffffffff);
  for (let y = 0; y < 600; y++) {
    for (let x = 0; x < 600; x++) {
      const i = (y * 600 + x) * 4;
      const a = cl(src.bitmap.data[i], src.bitmap.data[i + 1], src.bitmap.data[i + 2]);
      const b = cl(mine.bitmap.data[i], mine.bitmap.data[i + 1], mine.bitmap.data[i + 2]);
      total++; perTot[a]++;
      if (a === b) { same++; per[a]++; }
      else diff.setPixelColor(0xff0000ff, x, y);
    }
  }
  if (tag) {
    await mine.writeAsync(`build/render-${tag}.png`);
    await diff.writeAsync(`build/diff-${tag}.png`);
  }
  return {
    overall: (same / total) * 100,
    byColor: names.map((n, i) => `${n} ${((per[i] / (perTot[i] || 1)) * 100).toFixed(1)}%`).join('  '),
  };
}

// Matched to the original's fine stitching; see README. The bold variant trades
// that fidelity for strokes thick enough to extrude at keychain scale.
const SEAM_VARIANTS = {
  'dragons-elite-logo.svg':
    { count: 25, barbLen: 5.5, barbW: 3.5, spineW: 3, lean: 35 },
  'dragons-elite-logo-bold.svg':
    { count: 14, barbLen: 9, barbW: 6.5, spineW: 5.5, lean: 35 },
};

async function main() {
  const traced = JSON.parse(fs.readFileSync('build/paths.json', 'utf8'));
  const { scale, paths } = traced;
  fs.mkdirSync('build', { recursive: true });

  for (const [file, opts] of Object.entries(SEAM_VARIANTS)) {
    const svg = buildSVG(paths, opts, scale);
    fs.writeFileSync(file, svg);
    const s = await score(svg, file.replace('.svg', ''));
    console.log(`${file.padEnd(30)} match ${s.overall.toFixed(2)}%   ${s.byColor}`);
  }
}

module.exports = { buildSVG, score, SEAM_VARIANTS };

if (require.main === module) main();
