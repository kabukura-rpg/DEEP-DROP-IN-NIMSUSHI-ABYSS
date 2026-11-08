// perf.mjs [mode...]: Current (review-base = 5969f37 + hooks) vs Integrated A (review-cand), same Chrome, renderer,
// viewport, DPR, fixture, bubble count, frame count and instruments. The two builds differ ONLY in the AIR draw lines.
// The game loop is asleep (review-game.js); each rAF runs the scene's own draw() + renderer, so frame intervals are
// rAF-paced. Rounds alternate the build order. Per scenario:
//   paced   : 240 rAF frames -> CPU submit (draw / draw+render) and rAF interval
//   gpu     : 120 frames of draw+render+flush (WebGL gl.finish(); Canvas getImageData of 1px = forced raster/readback)
//   alloc   : V8 sampling heap profiler (1 KiB) over 151 frames, collected-by-GC samples included -> bytes / frame
//   gc      : devtools.timeline trace over 240 paced frames -> MinorGC / MajorGC count and pause
//   heap    : JSHeapUsedSize after a forced GC, before / after the scenario
// Scenarios: AIR 0 (expired), AIR 4 (burst at 0.40 s), AIR 12 (stress), TIMEOUT + AIR, CYCLE (release -> rise ->
// expiry -> reset, 2 model ticks per frame through the real tickContainers / tickBubbles).
import fs from 'node:fs/promises';
import path from 'node:path';
import { browser, emulate, origins, GAME, ENV, root, stats } from './boot.mjs';

const MODES = process.argv.length > 2 ? process.argv.slice(2) : ['webgl', 'canvas-accel', 'canvas-soft'];
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const SCENARIOS = [['air0', 'area3', 520], ['air4', 'area3', 48], ['air12', 'stress', 48], ['timeoutAir', 'timeout', 48], ['cycle', 'area3', 0]];
const VIEWS = [[360, 640], [1440, 1000]];
const only1440 = new Set(['air12', 'timeoutAir']);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function traceGC(page, job) {
  const events = [];
  const onData = e => { const d = JSON.parse(e.data); if (d.method === 'Tracing.dataCollected') events.push(...d.params.value); };
  page.ws.addEventListener('message', onData);
  await page.cdp('Tracing.start', { categories: 'devtools.timeline,v8', transferMode: 'ReportEvents' });
  const value = await job();
  const done = new Promise(resolve => { const f = e => { if (JSON.parse(e.data).method === 'Tracing.tracingComplete') { page.ws.removeEventListener('message', f); resolve(); } }; page.ws.addEventListener('message', f); });
  await page.cdp('Tracing.end');
  await done;
  page.ws.removeEventListener('message', onData);
  const gc = events.filter(e => e.ph === 'X' && (e.name === 'MinorGC' || e.name === 'MajorGC'));
  const sum = name => gc.filter(e => e.name === name).reduce((t, e) => t + e.dur / 1000, 0);
  return { value, gc: { minor: gc.filter(e => e.name === 'MinorGC').length, major: gc.filter(e => e.name === 'MajorGC').length, minorMs: +sum('MinorGC').toFixed(3), majorMs: +sum('MajorGC').toFixed(3) } };
}
const heapUsed = async page => (await page.cdp('Performance.getMetrics')).metrics.find(m => m.name === 'JSHeapUsedSize').value;

async function setup(page, fixture, tick) {
  return page.ev(`(() => { airReview.reset('${fixture}'); airReview.seek(${tick}); const d = airReview.describe();
    return { bubbles: d.bubbles.length, drawn: d.bubbles.filter(b => b.y - d.cameraY >= -40 && b.y - d.cameraY <= 850).length, timeout: d.timeout.length, slots: d.layer.commandSlots }; })()`);
}
/** One frame: static scenarios redraw the held state; the cycle advances 2 ticks (1/60 s) and wraps at 540 (reset). */
const FRAME = cycle => cycle
  ? `(() => { window.__t = (window.__t ?? 0) + 2; let reset = false; if (__t > 540) { __t = 0; reset = true; } const a = performance.now(); airReview.seek(__t); return [0, performance.now() - a, reset]; })()`
  : `(() => { const [d, t] = airReview.render(); return [d, t, false]; })()`;
async function measure(page, mode, fixture, tick, cycle) {
  const state = await setup(page, fixture, tick);
  await page.ev('window.__t = 0; true');
  // Warm-up.
  await page.ev(`new Promise(r => { let k = 0; const f = () => { ${FRAME(cycle)}; if (++k < 30) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); })`);
  await page.cdp('HeapProfiler.enable');
  await page.cdp('HeapProfiler.collectGarbage');
  const heap0 = await heapUsed(page);
  const paced = await traceGC(page, () => page.ev(`new Promise(resolve => { const draw = [], total = [], interval = []; let prev = 0, k = 0;
    function next(now) { const [d, t, reset] = ${FRAME(cycle)}; if (prev && !reset) { draw.push(d); total.push(t); interval.push(now - prev); } prev = now;
      if (++k === 241) resolve({ draw, total, interval }); else requestAnimationFrame(next); }
    requestAnimationFrame(next); })`));
  const flush = mode === 'webgl' ? 'airReviewScene.game.renderer.gl.finish()' : 'airReviewScene.game.canvas.getContext("2d").getImageData(0, 0, 1, 1)';
  const gpu = await page.ev(`new Promise(resolve => { const t = []; let k = 0;
    function next() { const a = performance.now(); ${FRAME(cycle)}; ${flush}; if (k++ >= 10) t.push(performance.now() - a); if (t.length === 120) resolve(t); else requestAnimationFrame(next); }
    requestAnimationFrame(next); })`);
  await page.cdp('HeapProfiler.collectGarbage');
  await page.cdp('HeapProfiler.startSampling', { samplingInterval: 1024, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  await page.ev(`new Promise(r => { let k = 0; const f = () => { ${FRAME(cycle)}; if (++k < 151) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); })`);
  const { profile } = await page.cdp('HeapProfiler.stopSampling');
  await page.cdp('HeapProfiler.collectGarbage');
  const heap1 = await heapUsed(page);
  return { state, cpuDraw: stats(paced.value.draw), cpuTotal: stats(paced.value.total), interval: stats(paced.value.interval), over25: paced.value.interval.filter(x => x > 25).length,
    gpuFlush: stats(gpu), gc: paced.gc, allocKiBPerFrame: +(profile.samples.reduce((a, x) => a + x.size, 0) / 151 / 1024).toFixed(1), heapAfterGC: { before: heap0, after: heap1, delta: heap1 - heap0 } };
}

const rows = [];
const file = path.join(root, 'evidence', `perf-${MODES.join('+')}.json`);
for (const mode of MODES) await browser(mode, async page => {
  await page.cdp('Performance.enable');
  for (const [width, height] of VIEWS) for (let round = 0; round < ROUNDS; round++) {
    const order = round % 2 ? ['review-cand', 'review-base'] : ['review-base', 'review-cand'];
    for (const build of order) {
      page.errors.length = 0; page.consoleErrors.length = 0;
      await emulate(page, width, height, 1);
      await page.cdp('Page.navigate', { url: origins[build] + GAME + (width <= 390 ? '?touch=1' : '?qa=1') });
      await page.until('window.airReview?.describe()?.tick === 48', 30000);
      const env = await page.ev(ENV);
      await sleep(300);
      for (const [name, fixture, tick] of SCENARIOS) {
        if (width > 390 && !only1440.has(name)) continue;
        const r = await measure(page, mode, fixture, tick, name === 'cycle');
        rows.push({ mode, width, height, round, build: build === 'review-base' ? 'Current' : 'A', scenario: name, env: { renderer: env.renderer, gl: env.gl, dpr: env.dpr, canvasPx: env.canvasPx }, ...r });
        console.log(mode, `${width}x${height}`, round, build, name, 'n', r.state.drawn, 'slots', r.state.slots, 'cpu p50/p95', r.cpuTotal.p50.toFixed(2), r.cpuTotal.p95.toFixed(2),
          'int p99', r.interval.p99.toFixed(1), '>25', r.over25, 'flush p50', r.gpuFlush.p50.toFixed(2), 'alloc', r.allocKiBPerFrame, 'gc', JSON.stringify(r.gc));
      }
      if (page.errors.length || page.consoleErrors.length) rows.push({ mode, width, build, errors: [page.errors.slice(), page.consoleErrors.slice()] });
      await page.cdp('Page.navigate', { url: 'about:blank' });
      await fs.writeFile(file, JSON.stringify({ chrome: page.version.product, rows }, null, 1));
    }
  }
});
