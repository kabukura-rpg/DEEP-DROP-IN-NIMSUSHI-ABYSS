// visual.mjs [mode...]: Visual Regression. The same review fixture (Codex's review-game.js, seed 71103, real
// breakContainer + tickBubbles) at the same tick on four renders:
//   codex-A   = the Human Review environment, variant A   (review-codex)
//   codex-Cur = the Human Review environment, Current     (review-codex)
//   base      = 5969f37 + hooks                           (review-base)
//   cand      = Integrated A + hooks                      (review-cand)
// Pass: cand == codex-A and base == codex-Cur on the WHOLE native 450x800 framebuffer and the whole page screenshot
// (0 px); cand vs base: 0 px outside the AIR mask (each drawn bubble's rounded centre +-12 native px); every model
// field equal on all four; the same build shot twice is 0 px (renderer noise).
import fs from 'node:fs/promises';
import path from 'node:path';
import { browser, emulate, origins, GAME, ENV, root } from './boot.mjs';
import { decode, diff, encode } from './png.mjs';

const MODES = process.argv.length > 2 ? process.argv.slice(2) : ['webgl', 'canvas-accel', 'canvas-soft'];
const VIEWS = [[1440, 1000, 1], [1280, 680, 1], [390, 844, 1], [360, 640, 1], [390, 844, 2]];
const COVERAGE = [
  ['area3', 0], ['area3', 24], ['area3', 48], ['area3', 120], ['area3', 240], ['area3', 390], ['area3', 420], ['area3', 456], ['area3', 500], ['area3', 520],
  ['timeout', 0], ['timeout', 48], ['timeout', 120], ['boss', 0], ['boss', 48], ['catch', 60], ['catch', 64], ['catch', 66], ['stress', 48], ['stress', 400],
];
const KEEP = new Set(['area3|48', 'area3|420', 'timeout|48', 'boss|48', 'stress|48', 'catch|66']);
const out = path.join(root, 'visual');
const strip = ({ variant, layer, ...rest }) => rest;

async function open(page, origin, width, height, dpr) {
  const mobile = await emulate(page, width, height, dpr);
  await page.cdp('Page.navigate', { url: origin + GAME + (mobile ? '?touch=1' : '?qa=1') });
  await page.until('window.airReview?.describe()?.tick === 48', 30000);
  return page.ev(ENV);
}
async function frame(page, fixture, tick, variant) {
  const r = await page.ev(`(() => { airReview.setVariant('${variant}'); airReview.reset('${fixture}'); airReview.seek(${tick});
    const meta = airReview.describe(); return { meta, native: airReviewScene.game.canvas.toDataURL('image/png') }; })()`);
  const shot = Buffer.from((await page.cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64');
  // Again, same state: separates renderer noise from a real difference.
  const again = await page.ev(`(() => { airReview.render(); return airReviewScene.game.canvas.toDataURL('image/png'); })()`);
  const shot2 = Buffer.from((await page.cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64');
  const png = s => decode(Buffer.from(s.split(',')[1], 'base64'));
  return { meta: r.meta, native: png(r.native), native2: png(again), shot: decode(shot), shot2: decode(shot2), shotRaw: shot };
}
/** Crop + nearest scale, side by side, for the report. */
function sheet(images, box, scale) {
  const gap = 4, w = box[2] * scale, h = box[3] * scale, W = images.length * w + gap * (images.length - 1);
  const rgba = Buffer.alloc(W * h * 4, 255);
  images.forEach((img, k) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = box[0] + Math.floor(x / scale), sy = box[1] + Math.floor(y / scale);
      const from = (sy * img.width + sx) * 4, to = (y * W + k * (w + gap) + x) * 4;
      img.data.copy(rgba, to, from, from + 4);
    }
  });
  return encode(W, h, rgba);
}

const report = { started: new Date().toISOString(), modes: {}, failures: [] };
const fail = msg => { report.failures.push(msg); console.log('FAIL', msg); };
for (const mode of MODES) await browser(mode, async page => {
  const rows = [], envs = [];
  for (const [width, height, dpr] of VIEWS) {
    const view = `${width}x${height}@${dpr}`;
    const got = { codexA: {}, codexCur: {}, base: {}, cand: {} };
    for (const [build, variants] of [['review-codex', ['A', 'Current']], ['review-base', ['Current']], ['review-cand', ['Current']]]) {
      page.errors.length = 0; page.consoleErrors.length = 0;
      const env = await open(page, origins[build], width, height, dpr);
      envs.push({ view, build, ...env });
      if (env.renderer !== (mode === 'webgl' ? 'WebGL' : 'Canvas')) fail(`${mode} ${view} ${build} renderer ${env.renderer}`);
      for (const [fixture, tick] of COVERAGE) for (const variant of variants) {
        const key = build === 'review-codex' ? (variant === 'A' ? 'codexA' : 'codexCur') : build === 'review-base' ? 'base' : 'cand';
        got[key][`${fixture}|${tick}`] = await frame(page, fixture, tick, variant);
      }
      if (page.errors.length || page.consoleErrors.length) fail(`${mode} ${view} ${build} errors ${JSON.stringify([page.errors, page.consoleErrors])}`);
    }
    const folder = path.join(out, mode, view);
    await fs.mkdir(folder, { recursive: true });
    for (const [fixture, tick] of COVERAGE) {
      const key = `${fixture}|${tick}`;
      const a = got.codexA[key], cur = got.codexCur[key], b = got.base[key], c = got.cand[key];
      const state = JSON.stringify(strip(c.meta));
      for (const [name, f] of [['codexA', a], ['codexCur', cur], ['base', b]]) if (JSON.stringify(strip(f.meta)) !== state) fail(`${mode} ${view} ${key} model differs: ${name}`);
      const drawn = c.meta.bubbles.filter(x => x.y - c.meta.cameraY >= -40 && x.y - c.meta.cameraY <= 850);
      const centres = drawn.map(x => [Math.round(x.x + c.meta.layer.x), Math.round(x.y - c.meta.cameraY + c.meta.layer.y)]);
      const nativeMask = centres.map(([x, y]) => [x - 12, y - 12, x + 12, y + 12]);
      const [cx, cy, cw, ch] = c.meta.canvas ? [c.meta.canvas.x, c.meta.canvas.y, c.meta.canvas.width, c.meta.canvas.height] : [0, 0, 450, 800];
      const k = dpr, sx = cw / 450, sy = ch / 800;
      const shotMask = centres.map(([x, y]) => [Math.floor((cx + (x - 12) * sx) * k) - 1, Math.floor((cy + (y - 12) * sy) * k) - 1, Math.ceil((cx + (x + 12) * sx) * k) + 1, Math.ceil((cy + (y + 12) * sy) * k) + 1]);
      const row = {
        mode, view, fixture, tick, bubbles: c.meta.bubbles.length, drawn: drawn.length, timeout: c.meta.timeout.length,
        oxygen: c.meta.oxygen, recovered: c.meta.recovered, frozen: c.meta.frozen, layer: c.meta.layer,
        slots: { codexA: a.meta.layer.commandSlots, codexCur: cur.meta.layer.commandSlots, base: b.meta.layer.commandSlots, cand: c.meta.layer.commandSlots },
        native: { candVsA: diff(a.native, c.native), baseVsCur: diff(cur.native, b.native), candVsBase: diff(b.native, c.native, nativeMask),
          repeatCand: diff(c.native, c.native2), repeatBase: diff(b.native, b.native2) },
        page: { candVsA: diff(a.shot, c.shot), baseVsCur: diff(cur.shot, b.shot), candVsBase: diff(b.shot, c.shot, shotMask),
          repeatCand: diff(c.shot, c.shot2), repeatBase: diff(b.shot, b.shot2) },
      };
      rows.push(row);
      for (const layer of ['native', 'page']) {
        const r = row[layer];
        if (r.candVsA.changed !== 0) fail(`${mode} ${view} ${key} ${layer} cand != codex A: ${r.candVsA.changed}px ${JSON.stringify(r.candVsA.bounds)}`);
        if (r.baseVsCur.changed !== 0) fail(`${mode} ${view} ${key} ${layer} base != codex Current: ${r.baseVsCur.changed}px`);
        if (r.candVsBase.outside !== 0) fail(`${mode} ${view} ${key} ${layer} outside AIR mask: ${r.candVsBase.outside}px ${JSON.stringify(r.candVsBase.outsideBounds)}`);
        if (r.repeatCand.changed || r.repeatBase.changed) fail(`${mode} ${view} ${key} ${layer} repeat noise ${r.repeatCand.changed}/${r.repeatBase.changed}`);
      }
      if (drawn.length && row.native.candVsBase.changed === 0) fail(`${mode} ${view} ${key} candidate not visible`);
      if (!drawn.length && row.native.candVsBase.changed !== 0) fail(`${mode} ${view} ${key} differs with no bubble drawn`);
      if (KEEP.has(key) && (dpr === 1 && (width === 360 || width === 1440))) {
        await fs.writeFile(path.join(folder, `${fixture}-${tick}-cand.png`), c.shotRaw);
        await fs.writeFile(path.join(folder, `${fixture}-${tick}-base.png`), b.shotRaw);
        if (centres.length) {
          const xs = centres.map(p => p[0]), ys = centres.map(p => p[1]);
          const x0 = Math.max(0, Math.min(...xs) - 24), y0 = Math.max(0, Math.min(...ys) - 24);
          const box = [x0, y0, Math.min(450, Math.max(...xs) + 24) - x0, Math.min(800, Math.max(...ys) + 24) - y0];
          // Native x4: Current (5969f37) | Codex A (Human Review) | Integrated A.
          await fs.writeFile(path.join(folder, `${fixture}-${tick}-native-x4.png`), sheet([b.native, a.native, c.native], box, 4));
        }
      }
    }
    console.log(mode, view, 'rows', rows.length, 'failures', report.failures.length);
  }
  report.modes[mode] = { chrome: page.version.product, envs, rows };
});
report.finished = new Date().toISOString();
const summary = Object.fromEntries(Object.entries(report.modes).map(([m, { rows }]) => [m, {
  frames: rows.length,
  candVsA_native0: rows.filter(r => r.native.candVsA.changed === 0).length, candVsA_page0: rows.filter(r => r.page.candVsA.changed === 0).length,
  baseVsCur0: rows.filter(r => r.native.baseVsCur.changed === 0 && r.page.baseVsCur.changed === 0).length,
  outsideMask0: rows.filter(r => r.native.candVsBase.outside === 0 && r.page.candVsBase.outside === 0).length,
  withBubbles: rows.filter(r => r.drawn).length, noBubbleFull0: rows.filter(r => !r.drawn && r.native.candVsBase.changed === 0 && r.page.candVsBase.changed === 0).length,
}]));
report.summary = summary;
await fs.mkdir(path.join(root, 'evidence'), { recursive: true });
await fs.writeFile(path.join(root, 'evidence', `visual-${MODES.join('+')}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ summary, failures: report.failures.length }, null, 1));
