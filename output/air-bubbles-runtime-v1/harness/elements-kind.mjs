import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
// elements-kind.mjs: V8 elements kind of every Graphics command buffer, review-base vs review-cand (serve.sh running).
import { connect } from './cdp.mjs';
const C = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'air-kinds-'));
const chrome = spawn(C, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-webgl', '--disable-gpu', '--disable-accelerated-2d-canvas', '--disable-gpu-rasterization', '--js-flags=--allow-natives-syntax', '--remote-debugging-port=9649', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
let page; for (let i = 0; i < 80 && !page; i++) { page = await connect(9649).catch(() => null); if (!page) await new Promise(r => setTimeout(r, 150)); }
for (const [build, port] of [['base', 5644], ['cand', 5645]]) {
  await page.cdp('Page.navigate', { url: `http://127.0.0.1:${port}/DEEP-DROP-IN-NIMSUSHI-ABYSS/?qa=1` });
  await page.until('window.airReview?.describe()?.tick === 48', 30000);
  for (const [fx, t] of [['area3', 48], ['area3', 520]]) {
    const r = await page.ev(`(() => { airReview.reset('${fx}'); airReview.seek(${t}); for (let i = 0; i < 30; i++) airReview.render();
      const s = airReviewScene; const out = {};
      for (const [k, v] of Object.entries(s)) if (v && v.commandBuffer) { const b = v.commandBuffer; out[k] = [b.length, new Function('b', 'return %HasSmiElements(b) ? "smi" : %HasDoubleElements(b) ? "double" : %HasObjectElements(b) ? "object" : "?"')(b)]; }
      return out; })()`).catch(e => String(e));
    console.log(build, fx, t, JSON.stringify(r));
  }
}
const exited = new Promise(r => chrome.once('exit', r)); chrome.kill(); await exited; await fs.rm(profile, { recursive: true, force: true });
