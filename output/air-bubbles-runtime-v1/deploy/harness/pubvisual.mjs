// pubvisual.mjs [build]: Candidate A as the PUBLIC build actually draws it. Unmodified production build, real GameModel
// via Runtime.queryObjects. Per renderer x viewport x background (AREA 1 / 3 / 4, + TIMEOUT overlap in AREA 3):
//   the game loop is put to sleep, AIR bubbles are placed at integer native positions, and two frames are rendered with
//   game.step(t, 0) (dt 0: the model does not move) -- with the bubbles and with m.bubbles = [] -- each read back with
//   renderer.snapshot at native resolution. The difference is exactly what AIR adds. Pass:
//     mask == expected Candidate A cells (12 ring + 2 glint rects of src/render/airBubbleArt.ts around the rounded
//     centre), 0 px outside, 0 px missing; each pixel == the background blended with #9fe8f5 x .92 (ring) or
//     #f0ffff x .828 (glint) within +-3 per channel; nothing outside any footprint changes.
//   Also a page screenshot per case (visibility at 360 px, dark backgrounds, TIMEOUT overlap) and an x4 native crop.
import fs from 'node:fs/promises';
import path from 'node:path';
import { browser, emulate, origins, GAME, ENV, root } from './boot.mjs';
import { decode, encode } from './png.mjs';
import crypto from 'node:crypto';

const BUILD = process.argv[2] ?? 'pub';
const out = path.join(root, 'smoke', `${BUILD}-visual`);
await fs.mkdir(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RING = [[-4, -10, 8, 2], [-6, -8, 2, 2], [4, -8, 2, 2], [-8, -6, 2, 2], [6, -6, 2, 2], [-10, -4, 2, 8], [8, -4, 2, 8], [-8, 4, 2, 2], [6, 4, 2, 2], [-6, 6, 2, 2], [4, 6, 2, 2], [-4, 8, 8, 2]];
const GLINT = [[-4, -6, 2, 2], [-6, -4, 2, 2]];
const CASES = [['area1', 1, 1, false], ['area3', 3, 1, false], ['area4', 4, 1, false], ['timeout', 3, 1, true]];
const POS = [[120, 200], [225, 260], [330, 200], [160, 520], [290, 520], [225, 640]];

async function enter(page, origin, mobile) {
  await page.cdp('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }).catch(() => {});
  await page.cdp('Page.navigate', { url: origin + GAME + '?visual=' + Date.now() });
  await page.until(`!!document.getElementById('title-gate') && !!window.Phaser`, 30000);
  const center = async sel => page.ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  const tap = async ([x, y]) => {
    if (mobile) { await page.cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(60); await page.cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    else for (const type of ['mousePressed', 'mouseReleased']) await page.cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  };
  await tap(await center('#title-gate'));
  await page.until(`!!document.getElementById('start')`, 10000); await sleep(600);
  await tap(await center('#start'));
  await page.until(`document.getElementById('game-frame')?.classList.contains('in-play') && document.getElementById('overlay').hidden`, 15000);
  await sleep(600);
  const { result: proto } = await page.cdp('Runtime.evaluate', { expression: 'Phaser.Scene.prototype' });
  const { objects } = await page.cdp('Runtime.queryObjects', { prototypeObjectId: proto.objectId });
  await page.cdp('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function () { window.__scene = this.find(s => s.model && s.worldFrontAir); }' });
}
/** One frame rendered with dt 0 and read back at native size as RGBA. */
const SNAP = `new Promise(r => { const g = __scene.game; g.renderer.snapshot(img => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0); r({ w: c.width, h: c.height, d: Array.from(x.getImageData(0, 0, c.width, c.height).data) }); }); window.__t = (window.__t || 1e6) + 1; g.step(__t, 0); })`;

const results = [];
for (const [mode, vps] of (process.env.DBG ? [['canvas-accel', [[1440, 1000]]]] : [['webgl', [[1440, 1000], [390, 844]]], ['canvas-accel', [[1440, 1000], [360, 640]]]])) await browser(mode, async page => {
  for (const [width, height] of vps) {
    page.errors.length = 0; page.consoleErrors.length = 0;
    const mobile = await emulate(page, width, height, 1);
    await enter(page, origins[BUILD], mobile);
    const env = await page.ev(ENV.replace('window.__scene || window.airReviewScene', '__scene'));
    for (const [name, area, section, timeout] of CASES) {
      const tag = `${mode}-${width}x${height}-${name}`;
      await page.ev(`(() => { const s = __scene, m = s.model; s.game.loop.wake?.(); m.jumpToStage(${area}, ${section}); return true; })()`);
      await sleep(900);
      // Freeze: loop asleep, enemies/hazards off screen, player parked, bubbles placed at integer native positions.
      const placed = await page.ev(`(() => { const s = __scene, m = s.model, p = m.player; s.game.loop.sleep();
        m.enemies = []; p.x = 40; p.y = m.cameraY + 120; p.vy = 0; p.invincible = 9; m.timeoutBubbles = [];
        if (${timeout}) { m.upgrades.grant('timeout'); m.syncUpgrades(); m.timeoutBubbles.push({ id: 9998, x: 225, y: m.cameraY + 300, radius: 96 }); }
        m.bubbles = ${JSON.stringify(POS)}.map(([x, y], i) => ({ id: 81000 + i, x, y: m.cameraY + y, vx: 0, vy: 0, life: 3, taken: false, arm: 99 }));
        return { cam: m.cameraY, gx: s.worldFrontAir.x, gy: s.worldFrontAir.y, stage: m.stage.label, n: m.bubbles.length, timeout: m.timeoutBubbles.length }; })()`);
      const a = await page.ev(SNAP);
      const shot = Buffer.from((await page.cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64');
      await fs.writeFile(path.join(out, `${tag}.png`), shot);
      const kept = await page.ev(`(() => { const m = __scene.model; window.__kept = m.bubbles; m.bubbles = []; return true; })()`);
      const b = await page.ev(SNAP);
      await page.ev(`(() => { __scene.model.bubbles = __kept; return true; })()`);
      const a2 = await page.ev(SNAP); // the same state again: renderer noise
      const W = a.w, H = a.h, sx = W / 450, sy = H / 800;
      // Expected cells in native px, from the rounded centre (Graphics translation g.x/g.y as the game has it).
      const want = new Map();
      for (const [x, y] of POS) {
        const cx = Math.round(x + placed.gx) - placed.gx + placed.gx, cy = Math.round(y + placed.gy) - placed.gy + placed.gy;
        for (const [rects, kind] of [[RING, 'ring'], [GLINT, 'glint']]) for (const [dx, dy, w, h] of rects)
          for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) want.set(`${Math.round((cx + dx + xx) * sx)},${Math.round((cy + dy + yy) * sy)}`, kind + '@' + y);
      }
      const badRows = {}; let extra = 0, missing = 0, colourBad = 0, noise = 0; const maxErr = [0, 0, 0];
      const blend = (bg, c, al) => [(c >> 16) & 255, (c >> 8) & 255, c & 255].map((v, i) => bg[i] * (1 - al) + v * al);
      const crop = { w: 0, h: 0 };
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, pa = a.d.slice(i, i + 3), pb = b.d.slice(i, i + 3), pc = a2.d.slice(i, i + 3);
        if (pa.some((v, k) => v !== pc[k])) noise++;
        const changed = pa.some((v, k) => v !== pb[k]);
        const tagd = want.get(`${x},${y}`), kind = tagd?.split('@')[0], by = tagd?.split('@')[1];
        if (changed && !kind) extra++;
        if (kind) {
          const exp = kind === 'ring' ? blend(pb, 0x9fe8f5, 0.92) : blend(pb, 0xf0ffff, 0.92 * 0.9);
          const err = pa.map((v, k) => Math.abs(v - exp[k]));
          err.forEach((e, k) => { if (e > maxErr[k]) maxErr[k] = e; });
          if (err.some(e => e > 3)) { badRows[by] = (badRows[by] || 0) + 1; colourBad++; if (process.env.DBG && colourBad < 40) console.log(kind, x, y, pa.join(), pb.join(), exp.map(Math.round).join()); }
          if (!changed && pb.some((v, k) => Math.abs(v - exp[k]) > 3)) missing++;
        }
      }
      if (process.env.DBG) for (let y = 248; y < 272; y++) { let line = String(y) + ' '; for (let x = 213; x < 237; x++) { const i = (y * W + x) * 4; const k = want.get(`${x},${y}`)?.[0] ?? '.'; const al = (a.d[i] - b.d[i]) / (159 - b.d[i]); line += a.d.slice(i,i+3).some((v,j)=>v!==b.d[i+j]) ? (k + Math.round(al*100)).padEnd(5) : '.    '; } console.log(line); }
      // x4 native crop around the second bubble, for the record.
      const [ccx, ccy] = POS[1], R = 16, Z = 4, cw = 2 * R * Z, img = { width: cw, height: cw, data: Buffer.alloc(cw * cw * 4) };
      for (let y = 0; y < cw; y++) for (let x = 0; x < cw; x++) { const nx = Math.round(ccx - R + x / Z), ny = Math.round(ccy - R + y / Z), i = (ny * W + nx) * 4, o = (y * cw + x) * 4; img.data[o] = a.d[i]; img.data[o + 1] = a.d[i + 1]; img.data[o + 2] = a.d[i + 2]; img.data[o + 3] = 255; }
      await fs.writeFile(path.join(out, `${tag}-native-x4.png`), encode(img.width, img.height, img.data));
      const row = { build: BUILD, mode, width, height, case: name, native: [W, H], placed, renderer: env.renderer, gl: env.gl, expectedPx: want.size, extra, missing, colourBad, colourBadByBubbleY: badRows, maxErr, noise, nativeSha: crypto.createHash('sha256').update(Buffer.from(a.d)).digest('hex'), clearSha: crypto.createHash('sha256').update(Buffer.from(b.d)).digest('hex'),
        pass: extra === 0 && missing === 0 && noise === 0 };
      results.push(row); console.log(JSON.stringify(row));
      await page.ev(`(() => { __scene.game.loop.wake(); return true; })()`);
    }
    results.at(-1).errors = { exceptions: page.errors.slice(), console: page.consoleErrors.slice() };
    if (page.errors.length || page.consoleErrors.length) console.log('ERRORS', JSON.stringify(results.at(-1).errors));
    await fs.writeFile(path.join(root, 'evidence', `visual-${BUILD}.json`), JSON.stringify(results, null, 1));
    await page.cdp('Page.navigate', { url: 'about:blank' });
  }
});
