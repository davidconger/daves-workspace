// Measure the ball so the reconstructed version lands exactly where the traced
// dragon expects it. Eyeballing coordinates would leave a visible seam.
const Jimp = require('jimp');

const WHITE_I = 0, GREEN_I = 1, GRAY_I = 2, RED_I = 3;
function classify(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn < 40) return mx > 202 ? WHITE_I : GRAY_I;
  if (g >= r && g >= b) return GREEN_I;
  if (r > g && r > b) return RED_I;
  return GRAY_I;
}

Jimp.read('source-logo-600.jpg').then((img) => {
  const W = img.bitmap.width, H = img.bitmap.height;
  const cls = new Uint8Array(W * H);
  img.scan(0, 0, W, H, function (x, y, i) {
    cls[y * W + x] = classify(this.bitmap.data[i], this.bitmap.data[i + 1], this.bitmap.data[i + 2]);
  });

  // Flood fill background from the border.
  const bg = new Uint8Array(W * H);
  const st = [];
  for (let x = 0; x < W; x++) st.push([x, 0], [x, H - 1]);
  for (let y = 0; y < H; y++) st.push([0, y], [W - 1, y]);
  while (st.length) {
    const [x, y] = st.pop();
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const i = y * W + x;
    if (bg[i] || cls[i] !== WHITE_I) continue;
    bg[i] = 1;
    st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  // Ball interior = enclosed white + the red stitches sitting on it.
  let n = 0, sx = 0, sy = 0;
  const inside = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!bg[i] && (cls[i] === WHITE_I || cls[i] === RED_I)) {
      inside[i] = 1; n++; sx += i % W; sy += Math.floor(i / W);
    }
  }
  const cx = sx / n, cy = sy / n;

  // Scan the row and column through the centroid for true extents.
  const row = [], col = [];
  for (let x = 0; x < W; x++) if (inside[Math.round(cy) * W + x]) row.push(x);
  for (let y = 0; y < H; y++) if (inside[y * W + Math.round(cx)]) col.push(y);

  console.log(`ball centroid      : ${cx.toFixed(1)}, ${cy.toFixed(1)}`);
  console.log(`horizontal extent  : ${row[0]} .. ${row[row.length - 1]}  (w=${row[row.length - 1] - row[0]})`);
  console.log(`vertical extent    : ${col[0]} .. ${col[col.length - 1]}  (h=${col[col.length - 1] - col[0]})`);
  console.log(`radius from area   : ${Math.sqrt(n / Math.PI).toFixed(1)}`);

  // Red stitch extents, per seam (split at the ball centre).
  let lx0 = 1e9, lx1 = -1, ly0 = 1e9, ly1 = -1, rx0 = 1e9, rx1 = -1, ry0 = 1e9, ry1 = -1, nr = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (cls[y * W + x] !== RED_I || bg[y * W + x]) continue;
    if (Math.hypot(x - cx, y - cy) > 140) continue; // ignore the dragon's eye
    nr++;
    if (x < cx) { lx0 = Math.min(lx0, x); lx1 = Math.max(lx1, x); ly0 = Math.min(ly0, y); ly1 = Math.max(ly1, y); }
    else { rx0 = Math.min(rx0, x); rx1 = Math.max(rx1, x); ry0 = Math.min(ry0, y); ry1 = Math.max(ry1, y); }
  }
  console.log(`\nred px on ball     : ${nr}`);
  console.log(`left seam  bbox    : x ${lx0}..${lx1}  y ${ly0}..${ly1}`);
  console.log(`right seam bbox    : x ${rx0}..${rx1}  y ${ry0}..${ry1}`);

  // Trace each seam's horizontal centre at several heights to get its curve.
  console.log('\nseam centre x by row:');
  for (let y = ly0; y <= ly1; y += Math.max(1, Math.round((ly1 - ly0) / 10))) {
    let L = [], R = [];
    for (let x = 0; x < W; x++) {
      if (cls[y * W + x] === RED_I && Math.hypot(x - cx, y - cy) <= 140) (x < cx ? L : R).push(x);
    }
    const mid = (a) => (a.length ? ((a[0] + a[a.length - 1]) / 2).toFixed(0) : '--');
    console.log(`  y=${String(y).padStart(3)}  left=${String(mid(L)).padStart(4)}  right=${String(mid(R)).padStart(4)}`);
  }
});
