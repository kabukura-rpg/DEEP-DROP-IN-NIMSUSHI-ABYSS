// pubperf.mjs [mode...]: performance of the PUBLIC build (b5becdd) against prod-base (local 5969f37 production build,
// byte-identical to the previous public baseline), same Chrome, renderer, viewport, harness and order-alternated rounds.
// Both are unmodified production builds with the LIVE game loop (unlike the review-build perf.mjs, so numbers are not
// comparable with ../../AIR_BUBBLES_PERFORMANCE_V1.md). The real GameModel is found with Runtime.queryObjects; the
// player is pinned and invincible in AREA 3-1, enemies cleared; AIR bubbles are pushed into model.bubbles and held in
// place (life/arm/position reset each prestep) so the count stays fixed. Per scenario, 240 rAF frames:
//   interval : rAF frame interval (ms)            alloc : V8 sampling heap profiler, GC'd samples included -> B / frame
//   gc       : MinorGC / MajorGC count + pause    heap  : JSHeapUsedSize after forced GC, before / after
// Scenarios: air0, air4, air12, timeoutAir (TIMEOUT region + 12 AIR around/inside it).
// SUSTAINED=<s>: additionally air12 for <s> seconds per build, JSHeapUsedSize every 5 s (no forced GC) + forced GC ends.
import fs from 'node:fs/promises';
import path from 'node:path';
import { browser, emulate, origins, GAME, ENV, root, stats } from './boot.mjs';

const MODES = process.argv.length > 2 ? process.argv.slice(2) : ['webgl', 'canvas-accel'];
const ROUNDS = Number(process.env.ROUNDS ?? 2);
const SUSTAINED = Number(process.env.SUSTAINED ?? 0);
const BUILDS = ['pub', 'prod-base'];
const VIEWS = [[1440, 1000], [360, 640]];
const SCEN = [['air0', 0, false], ['air4', 4, false], ['air12', 12, false], ['timeoutAir', 12, true]];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = path.join(root, 'evidence');

async function enter(page, origin, mobile) {
  await page.cdp('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }).catch(() => {});
  await page.cdp('Page.navigate', { url: origin + GAME + '?perf=' + Date.now() });
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
  await page.ev(`(() => { const s = __scene, m = s.model, p = m.player; m.jumpToStage(3, 1); window.__hold = null;
    s.game.events.on('prestep', () => { const m = __scene.model, p = m.player; m.enemies = []; p.x = 60; p.y = m.cameraY + 330; p.vy = 0; p.invincible = 9; m.oxygen.fill();
      if (__hold) for (let i = 0; i < m.bubbles.length; i++) { const b = m.bubbles[i], h = __hold[i]; if (!h) continue; b.x = h.x; b.y = m.cameraY + h.dy; b.life = 3; b.arm = 99; b.taken = false; } });
    return true; })()`);
  await sleep(800);
}
async function setup(page, n, timeout) {
  return page.ev(`(() => { const m = __scene.model; m.bubbles = []; m.timeoutBubbles = []; m.timeFrozen = false;
    m.platforms = m.platforms.filter(f => Math.abs(f.y - (m.cameraY + 330)) > 160); m.hazards = [];
    const cx = ${timeout ? 225 : 240}, cy = 420, hold = [];
    if (${timeout}) { m.upgrades.grant('timeout'); m.syncUpgrades(); m.timeoutBubbles.push({ id: 9999, x: cx, y: m.cameraY + cy, radius: 96 }); }
    for (let i = 0; i < ${n}; i++) { const a = i / Math.max(1, ${n}) * Math.PI * 2, r = ${timeout ? '(i % 2 ? 70 : 110)' : '(60 + (i % 3) * 40)'};
      hold.push({ x: cx + Math.cos(a) * r, dy: cy + Math.sin(a) * r });
      m.bubbles.push({ id: 80000 + i, x: hold[i].x, y: m.cameraY + hold[i].dy, vx: 0, vy: 0, life: 3, taken: false, arm: 99 }); }
    window.__hold = hold; return { n: m.bubbles.length, t: m.timeoutBubbles.length }; })()`);
}
const frames = (page, n) => page.ev(`new Promise(r => { const t = []; let last = performance.now(); const f = now => { t.push(now - last); last = now; if (t.length < ${n}) requestAnimationFrame(f); else r(t.slice(1)); }; requestAnimationFrame(f); })`);
const heap = async page => { await page.cdp('HeapProfiler.collectGarbage'); return (await page.cdp('Performance.getMetrics')).metrics.find(m => m.name === 'JSHeapUsedSize').value; };
async function gcTrace(page, job) {
  const events = [];
  const onData = e => { const d = JSON.parse(e.data); if (d.method === 'Tracing.dataCollected') events.push(...d.params.value); };
  page.ws.addEventListener('message', onData);
  await page.cdp('Tracing.start', { categories: 'devtools.timeline,v8', transferMode: 'ReportEvents' });
  const value = await job();
  const done = new Promise(resolve => { const f = e => { if (JSON.parse(e.data).method === 'Tracing.tracingComplete') { page.ws.removeEventListener('message', f); resolve(); } }; page.ws.addEventListener('message', f); });
  await page.cdp('Tracing.end'); await done; page.ws.removeEventListener('message', onData);
  const gc = events.filter(e => e.ph === 'X' && (e.name === 'MinorGC' || e.name === 'MajorGC' || e.name === 'V8.GC_SCAVENGER' || e.name === 'V8.GC_MARK_COMPACTOR'));
  const by = name => gc.filter(e => e.name === name);
  return { value, minor: by('MinorGC').length, major: by('MajorGC').length, pauseMs: +(gc.filter(e => e.name === 'MinorGC' || e.name === 'MajorGC').reduce((t, e) => t + (e.dur ?? 0), 0) / 1000).toFixed(2) };
}
async function measure(page) {
  const h0 = await heap(page);
  await sleep(300);
  const g = await gcTrace(page, () => frames(page, 241));
  await page.cdp('HeapProfiler.startSampling', { samplingInterval: 1024, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  const af = await frames(page, 151);
  const { profile } = await page.cdp('HeapProfiler.stopSampling');
  const bytes = profile.samples.reduce((t, s) => t + s.size, 0);
  const h1 = await heap(page);
  return { interval: stats(g.value), over25: g.value.filter(x => x > 25).length, minor: g.minor, major: g.major, gcPauseMs: g.pauseMs, allocPerFrame: Math.round(bytes / af.length), heapBefore: h0, heapAfter: h1 };
}

const rows = [];
await fs.mkdir(out, { recursive: true });
for (const mode of MODES) await browser(mode, async page => {
  await page.cdp('Performance.enable'); await page.cdp('HeapProfiler.enable');
  for (const [width, height] of VIEWS) for (let round = 0; round < ROUNDS; round++) {
    for (const build of round % 2 ? [...BUILDS].reverse() : BUILDS) {
      page.errors.length = 0; page.consoleErrors.length = 0;
      const mobile = await emulate(page, width, height, 1);
      await enter(page, origins[build], mobile);
      const env = await page.ev(ENV.replace('window.__scene || window.airReviewScene', '__scene'));
      for (const [name, n, timeout] of SCEN) {
        const s = await setup(page, n, timeout);
        await sleep(500);
        const check = await page.ev(`(() => { const m = __scene.model; return { bubbles: m.bubbles.length, timeout: m.timeoutBubbles.length, frozen: m.timeFrozen, state: m.state, stage: m.stage.label, slots: __scene.worldFrontAir.commandBuffer.length }; })()`);
        const r = await measure(page);
        const row = { mode, width, height, round, build, scenario: name, setup: s, check, ...r, renderer: env.renderer, gl: env.gl };
        rows.push(row);
        console.log(JSON.stringify({ mode, width, round, build, name, bubbles: check.bubbles, slots: check.slots, p50: r.interval.p50.toFixed(2), p99: r.interval.p99.toFixed(2), over25: r.over25, alloc: r.allocPerFrame, minor: r.minor, major: r.major, heap: [r.heapBefore, r.heapAfter] }));
      }
      if (SUSTAINED && width === 360 && round === 0) {
        await setup(page, 12, false);
        const g0 = await heap(page), samples = [];
        const t0 = Date.now();
        const g = await gcTrace(page, async () => { while (Date.now() - t0 < SUSTAINED * 1000) { await sleep(5000); samples.push((await page.cdp('Performance.getMetrics')).metrics.find(m => m.name === 'JSHeapUsedSize').value); } });
        const g1 = await heap(page);
        const srow = { mode, width, build, scenario: 'sustained-air12', seconds: SUSTAINED, heapGcStart: g0, heapGcEnd: g1, sawtooth: samples, minor: g.minor, major: g.major, gcPauseMs: g.gcPauseMs ?? g.pauseMs, bubbles: await page.ev('__scene.model.bubbles.length') };
        rows.push(srow); console.log(JSON.stringify(srow));
      }
      rows.at(-1).errors = { exceptions: page.errors.slice(), console: page.consoleErrors.slice() };
      if (page.errors.length || page.consoleErrors.length) console.log('ERRORS', build, JSON.stringify(rows.at(-1).errors));
      await fs.writeFile(path.join(out, `perf-pub-${MODES.join('+')}.json`), JSON.stringify(rows, null, 1));
      await page.cdp('Page.navigate', { url: 'about:blank' });
    }
  }
});
