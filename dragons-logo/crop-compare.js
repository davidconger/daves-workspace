// Diagnostic: crop the same region from the source and from a rendered SVG,
// stack them, and blow it up so edge quality is directly comparable.

const fs = require('fs');
const Jimp = require('jimp');
const { Resvg } = require('@resvg/resvg-js');

const [, , svgFile, xs, ys, ws, hs, zs, outName] = process.argv;
const x = +xs, y = +ys, w = +ws, h = +hs, z = +(zs || 6);

(async () => {
  const src = (await Jimp.read('source-logo-600.jpg')).crop(x, y, w, h).resize(w * z, h * z, Jimp.RESIZE_NEAREST_NEIGHBOR);
  const png = new Resvg(fs.readFileSync(svgFile, 'utf8'), { fitTo: { mode: 'width', value: 600 }, background: '#ffffff' }).render().asPng();
  const mine = (await Jimp.read(png)).crop(x, y, w, h).resize(w * z, h * z, Jimp.RESIZE_NEAREST_NEIGHBOR);

  const pad = 8;
  const sheet = new Jimp(w * z, h * z * 2 + pad, 0xff00ffff);
  sheet.composite(src, 0, 0).composite(mine, 0, h * z + pad);
  await sheet.writeAsync(`build/${outName || 'crop'}.png`);
  console.log(`build/${outName || 'crop'}.png  (top = source, bottom = ${svgFile})`);
})();
