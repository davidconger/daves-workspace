// Where can an internalised slot mount actually go?
//
// The Issaquah mount is a pocket buried in the plate that opens at the outer
// edge, with a bar across its mouth. That needs real material: 8mm of width,
// 4mm of depth below the edge, and walls around it. The Dragons silhouette is
// nothing like a fat letter I, so this measures the candidate spots rather than
// assuming the mount will fit.
//
// usage: node probe-slot-fit.js

const { renderMasks, W, SS, PAD, S, K, columnRuns } = require('./8-build-stl.js');

const BALL = { cx: 297.51, cy: 313.23, r: 137.5 };

(async () => {
  const m = await renderMasks();
  const plate = m.plate;
  const at = (x, y) => {
    const mx = Math.round((x + PAD) * SS), my = Math.round((y + PAD) * SS);
    if (mx < 0 || my < 0 || mx >= W || my >= W) return 0;
    return plate[my * W + mx];
  };

  console.log(`1 SVG unit = ${K.toFixed(4)} mm;  ${S} units = ${(S * K).toFixed(1)} mm\n`);

  // Walk across the top of the logo. For each column find the first run of
  // material that is thick enough to be body rather than the thin flare, and
  // report how deep it goes before hitting air (the ball gap).
  console.log('depth of solid material below the top edge, scanning left to right:');
  console.log('    x     x-mm   top-y   solid-depth-mm   (run)');
  const rows = [];
  for (let x = 150; x <= 460; x += 10) {
    const runs = columnRuns(plate, x, 0, 400);
    if (!runs.length) { rows.push(null); continue; }
    // the flare is a thin ribbon above the body; skip runs under 1.5mm deep
    const body = runs.find((r) => (r[1] - r[0]) * K > 1.5);
    if (!body) { rows.push(null); continue; }
    const depth = (body[1] - body[0]) * K;
    rows.push({ x, top: body[0], depth });
    console.log(`  ${String(x).padStart(4)}  ${(x * K).toFixed(1).padStart(6)}  ` +
      `${body[0].toFixed(1).padStart(6)}   ${depth.toFixed(2).padStart(6)}` +
      `          ${body[0].toFixed(0)}..${body[1].toFixed(0)}`);
  }

  // The mount wants a window 8mm wide where every column has enough depth.
  const NEED_W = 8.0, NEED_D = 5.0;   // 4mm pocket + 1mm back wall
  console.log(`\nwindows at least ${NEED_W}mm wide where every column has >= ${NEED_D}mm of depth:`);
  let run = [];
  const good = rows.filter(Boolean).filter((r) => r.depth >= NEED_D);
  let prev = null;
  const spans = [];
  for (const r of rows) {
    if (r && r.depth >= NEED_D) run.push(r);
    else { if (run.length) spans.push(run); run = []; }
  }
  if (run.length) spans.push(run);
  for (const s of spans) {
    const wmm = (s[s.length - 1].x - s[0].x) * K;
    if (wmm < NEED_W) continue;
    const tops = s.map((r) => r.top);
    console.log(`  x ${s[0].x}..${s[s.length - 1].x}  (${wmm.toFixed(1)}mm wide)  ` +
      `top edge varies ${(Math.max(...tops) - Math.min(...tops)).toFixed(1)} units ` +
      `= ${((Math.max(...tops) - Math.min(...tops)) * K).toFixed(2)}mm, ` +
      `min depth ${Math.min(...s.map((r) => r.depth)).toFixed(2)}mm`);
  }

  console.log(`\nball centre x = ${BALL.cx} (${(BALL.cx * K).toFixed(1)}mm), ` +
    `ball top y = ${(BALL.cy - BALL.r).toFixed(1)}`);
})();
