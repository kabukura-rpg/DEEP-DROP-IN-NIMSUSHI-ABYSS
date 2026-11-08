import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { connect } from './cdp.mjs';

export const root = path.dirname(import.meta.dirname);
/** serve.mjs ports (harness/serve.sh). */
export const origins = {
  'prod-base': 'http://127.0.0.1:5641', 'prod-cand': 'http://127.0.0.1:5642',
  'review-codex': 'http://127.0.0.1:5643', 'review-base': 'http://127.0.0.1:5644', 'review-cand': 'http://127.0.0.1:5645',
};
export const GAME = '/DEEP-DROP-IN-NIMSUSHI-ABYSS/';
export const modes = ['webgl', 'canvas-accel', 'canvas-soft'];
/** One harness-owned headless Chrome per renderer (ports 9640-9642); its profile is deleted afterwards. */
export async function browser(mode, job) {
  const port = 9640 + modes.indexOf(mode);
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'air-rt-chrome-'));
  const chrome = spawn('sh', [path.join(import.meta.dirname, 'chrome.sh'), mode, port, profile], { stdio: 'ignore' });
  try {
    let page;
    for (let tries = 0; tries < 80 && !page; tries++) {
      page = await connect(port).catch(() => null);
      if (!page) await new Promise(resolve => setTimeout(resolve, 150));
    }
    if (!page) throw Error('Could not connect to owned Chrome');
    page.consoleErrors = [];
    page.ws.addEventListener('message', e => {
      const d = JSON.parse(e.data);
      if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'assert')) page.consoleErrors.push(d.params.args.map(a => a.value ?? a.description).join(' '));
      if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') page.consoleErrors.push(`[${d.params.entry.source}] ${d.params.entry.text} ${d.params.entry.url ?? ''}`);
    });
    await page.cdp('Log.enable');
    page.version = await page.cdp('Browser.getVersion');
    try { return await job(page, port); } finally { page.ws.close(); }
  } finally {
    const exited = new Promise(resolve => chrome.once('exit', resolve));
    if (chrome.exitCode === null && chrome.signalCode === null) { chrome.kill(); await exited; }
    await fs.rm(profile, { recursive: true, force: true });
  }
}
export async function emulate(page, width, height, dpr = 1) {
  const mobile = width <= 390;
  await page.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile });
  await page.cdp('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  await page.cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  return mobile;
}
/** Renderer facts, from inside the page: Phaser type, WebGL unmasked renderer, DPR, canvas box, pointer. */
export const ENV = `(() => { const s = window.__scene || window.airReviewScene; const r = s.game.renderer, gl = r.gl;
  const ext = gl?.getExtension('WEBGL_debug_renderer_info'); const c = s.game.canvas.getBoundingClientRect();
  return { renderer: r.type === 2 ? 'WebGL' : 'Canvas', gl: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
    dpr: devicePixelRatio, viewport: [innerWidth, innerHeight], canvasCss: [c.x, c.y, c.width, c.height], canvasPx: [s.game.canvas.width, s.game.canvas.height],
    coarse: matchMedia('(any-pointer:coarse)').matches, touch: getComputedStyle(document.getElementById('touch-controls')).display, ua: navigator.userAgent }; })()`;
export const stats = xs => { const a = [...xs].sort((x, y) => x - y); if (!a.length) return null; const q = p => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  return { n: a.length, mean: a.reduce((t, x) => t + x, 0) / a.length, p50: q(.5), p95: q(.95), p99: q(.99), max: a.at(-1) }; };
