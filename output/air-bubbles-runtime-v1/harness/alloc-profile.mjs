// alloc-profile.mjs [mode] [scenario fixture tick]: which functions allocate per frame, Current vs A (sampling heap
// profiler, self size by function, 300 frames). Used to find where the builds' allocation differs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { browser, emulate, origins, GAME, root } from './boot.mjs';
const mode = process.argv[2] ?? 'canvas-soft', fixture = process.argv[3] ?? 'area3', tick = Number(process.argv[4] ?? 520);
const out = {};
await browser(mode, async page => {
  for (const build of ['review-base', 'review-cand', 'review-base', 'review-cand']) {
    await emulate(page, 360, 640, 1);
    await page.cdp('Page.navigate', { url: origins[build] + GAME + '?touch=1' });
    await page.until('window.airReview?.describe()?.tick === 48', 30000);
    await page.ev(`airReview.reset('${fixture}'); airReview.seek(${tick}); true`);
    await page.ev(`new Promise(r => { let k = 0; const f = () => { airReview.render(); if (++k < 120) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); })`);
    await page.cdp('HeapProfiler.enable'); await page.cdp('HeapProfiler.collectGarbage');
    await page.cdp('HeapProfiler.startSampling', { samplingInterval: 512, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    await page.ev(`new Promise(r => { let k = 0; const f = () => { airReview.render(); if (++k < 300) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); })`);
    const { profile } = await page.cdp('HeapProfiler.stopSampling');
    const self = new Map();
    const walk = (n, stack) => { const name = `${n.callFrame.functionName || '(anon)'}@${n.callFrame.lineNumber}:${n.callFrame.columnNumber}`; const s = n.selfSize; const parent = stack.at(-1) ?? '';
      if (s) { const k = name + ' <- ' + parent; self.set(k, (self.get(k) ?? 0) + s); } for (const c of n.children) walk(c, [...stack, name]); };
    walk(profile.head, []);
    const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => [k, +(v / 300 / 1024).toFixed(1)]);
    const total = +(profile.samples.reduce((t, x) => t + x.size, 0) / 300 / 1024).toFixed(1);
    (out[build] ??= []).push({ total, top });
    console.log(build, 'KiB/frame', total); for (const [k, v] of top) console.log('  ', v, k);
  }
});
await fs.writeFile(path.join(root, 'evidence', `alloc-profile-${mode}-${fixture}-${tick}.json`), JSON.stringify(out, null, 1));
