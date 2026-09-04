// Phase 1: figure out the real palette in the logo before tracing anything.
const Jimp = require('jimp');

(async () => {
  const img = await Jimp.read('source-logo-600.jpg');
  const counts = new Map();

  img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, idx) {
    const r = this.bitmap.data[idx];
    const g = this.bitmap.data[idx + 1];
    const b = this.bitmap.data[idx + 2];
    // Bucket to 16-level steps so JPEG noise collapses together.
    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    const e = counts.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    counts.set(key, e);
  });

  const total = img.bitmap.width * img.bitmap.height;
  const top = [...counts.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 12)
    .map((e) => ({
      hex:
        '#' +
        [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)]
          .map((v) => v.toString(16).padStart(2, '0'))
          .join(''),
      rgb: [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)],
      pct: ((e.n / total) * 100).toFixed(2),
    }));

  console.log(`Image ${img.bitmap.width}x${img.bitmap.height}, ${total} px`);
  console.table(top);
})();
