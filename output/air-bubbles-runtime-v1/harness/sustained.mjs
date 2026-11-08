// sustained.mjs [seconds] [mode...]: long run of the CYCLE scenario (release -> rise -> expiry -> reset, real model
// ticks, 2 per rAF frame) on Current vs Integrated A, alternating, 360x640 DPR 1. JSHeapUsedSize every 5 s WITHOUT a
// forced GC (the sawtooth), a forced GC at start and end (what is retained), every GC from the trace, every frame time.
// A leak would show as the post-GC heap and the sawtooth's floor climbing over the run; GC churn as the minor count.
import fs from 'node:fs/promises';
import path from 'node:path';
import { browser, emulate, origins, GAME, ENV, root, stats } from './boot.mjs';

const SECONDS = Number(process.argv[2] ?? 120);
const MODES = process.argv.length > 3 ? process.argv.slice(3) : ['webgl', 'canvas-accel'];
const heapUsed = async page => (await page.cdp('Performance.getMetrics')).metrics.find(m => m.name === 'JSHeapUsedSize').value;
const rows = [];
for (const mode of MODES) await browser(mode, async page => {
  await page.cdp('Performance.enable');
  await page.cdp('HeapProfiler.enable');
  for (const build of ['review-base', 'review-cand', 'review-cand', 'review-base']) {
    page.errors.length = 0; page.consoleErrors.length = 0;
    await emulate(page, 360, 640, 1);
    await page.cdp('Page.navigate', { url: origins[build] + GAME + '?touch=1' });
    await page.until('window.airReview?.describe()?.tick === 48', 30000);
    const env = await page.ev(ENV);
    await page.ev(`airReview.reset('area3'); window.__t = 0; window.__f = []; window.__run = true;
      (function next(now) { if (!__run) return; __t += 2; let reset = false; if (__t > 540) { __t = 0; reset = true; }
        const a = performance.now(); airReview.seek(__t); __f.push([now, performance.now() - a, reset ? 1 : 0, airReviewScene.model.bubbles.length]); requestAnimationFrame(next); })(performance.now()); true`);
    await new Promise(r => setTimeout(r, 2000));
    await page.cdp('HeapProfiler.collectGarbage');
    const gcStart = await heapUsed(page);
    const events = [];
    const onData = e => { const d = JSON.parse(e.data); if (d.method === 'Tracing.dataCollected') for (const v of d.params.value) if (v.ph === 'X' && (v.name === 'MinorGC' || v.name === 'MajorGC')) events.push({ name: v.name, ms: v.dur / 1000 }); };
    page.ws.addEventListener('message', onData);
    await page.cdp('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' });
    await page.ev('__f.length = 0; true');
    const heap = [];
    for (let s = 0; s < SECONDS; s += 5) { await new Promise(r => setTimeout(r, 5000)); heap.push(await heapUsed(page)); }
    const frames = await page.ev('__run = false; __f');
    const done = new Promise(resolve => { const f = e => { if (JSON.parse(e.data).method === 'Tracing.tracingComplete') { page.ws.removeEventListener('message', f); resolve(); } }; page.ws.addEventListener('message', f); });
    await page.cdp('Tracing.end'); await done;
    page.ws.removeEventListener('message', onData);
    await page.cdp('HeapProfiler.collectGarbage');
    const gcEnd = await heapUsed(page);
    const intervals = frames.slice(1).map((f, i) => f[0] - frames[i][0]);
    const steady = frames.filter(f => !f[2]);
    const half = Math.floor(heap.length / 2);
    const row = { mode, build: build === 'review-base' ? 'Current' : 'A', seconds: SECONDS, env: { renderer: env.renderer, gl: env.gl, dpr: env.dpr, canvasPx: env.canvasPx },
      frames: frames.length, maxBubbles: Math.max(...frames.map(f => f[3])), interval: stats(intervals), over25: intervals.filter(x => x > 25).length, over50: intervals.filter(x => x > 50).length,
      cpu: stats(steady.map(f => f[1])),
      gc: { minor: events.filter(e => e.name === 'MinorGC').length, major: events.filter(e => e.name === 'MajorGC').length,
        minorMs: +events.filter(e => e.name === 'MinorGC').reduce((t, e) => t + e.ms, 0).toFixed(2), majorMs: +events.filter(e => e.name === 'MajorGC').reduce((t, e) => t + e.ms, 0).toFixed(2),
        maxPauseMs: +Math.max(0, ...events.map(e => e.ms)).toFixed(3) },
      heap: { afterGCStart: gcStart, afterGCEnd: gcEnd, retainedDelta: gcEnd - gcStart, samples: heap,
        floorFirstHalf: Math.min(...heap.slice(0, half)), floorSecondHalf: Math.min(...heap.slice(half)) },
      errors: [page.errors.slice(), page.consoleErrors.slice()] };
    rows.push(row);
    console.log(mode, row.build, 'frames', row.frames, 'int p50/p99', row.interval.p50.toFixed(1), row.interval.p99.toFixed(1), '>25', row.over25, 'cpu p95', row.cpu.p95.toFixed(2),
      'gc', JSON.stringify(row.gc), 'heap MB', (gcStart / 1048576).toFixed(2), '->', (gcEnd / 1048576).toFixed(2), 'floor', (row.heap.floorFirstHalf / 1048576).toFixed(2), (row.heap.floorSecondHalf / 1048576).toFixed(2));
    await page.cdp('Page.navigate', { url: 'about:blank' });
    await fs.writeFile(path.join(root, 'evidence', `sustained-${MODES.join('+')}.json`), JSON.stringify({ chrome: page.version.product, rows }, null, 1));
  }
});
