// smoke.mjs [build]: runtime smoke test of an UNMODIFIED production build (default prod-cand), 4 configurations:
// WebGL (SwiftShader) / Canvas x Desktop 1440x1000 / Mobile (390x844 WebGL, 360x640 Canvas, touch emulation).
// NATURAL = trusted CDP input only (ENTRY GATE, title BGM, START, AREA 1 controls). FIXTURE = the live GameModel found
// with Runtime.queryObjects(Phaser.Scene.prototype), driven through its own APIs (jumpToStage, a sealed container
// pushed onto the player so the model's own contact break releases the burst, oxygen, completeSection/selectUpgrade/
// confirmUpgrade, upgrades.grant + damage for TIMEOUT) plus a per-step player pin. Adapted from
// output/timeout-area-pixel-art-runtime-v1/harness/pubsmoke.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { browser, emulate, origins, GAME, ENV, root } from './boot.mjs';
import { decode } from './png.mjs';

const BUILD = process.argv[2] ?? 'prod-cand';
const out = path.join(root, 'smoke', BUILD);
await fs.mkdir(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOOK = `(() => {
  window.__plays = [];
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { window.__plays.push((this.currentSrc || this.src || '').split('/').pop()); window.__media = window.__media || new Set(); window.__media.add(this); return play.apply(this, arguments); };
})()`;
const center = async (page, sel) => page.ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
async function tap(page, [x, y], mobile) {
  if (mobile) {
    await page.cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(60);
    await page.cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else for (const type of ['mousePressed', 'mouseReleased']) await page.cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
}
async function hold(page, sel, ms, mobile, key) {
  if (mobile) {
    const [x, y] = await center(page, sel);
    await page.cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(ms);
    await page.cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await sleep(ms);
    await page.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  }
}
const KEYS = {
  right: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 },
};
const playing = `[...(window.__media || [])].filter(m => !m.paused && m.currentTime > 0).map(m => (m.currentSrc || m.src).split('/').pop())`;

async function enter(page, mobile) {
  const r = { gateBefore: await page.ev(`!!document.getElementById('title-gate')`), playsBeforeGate: await page.ev('__plays.length') };
  if (mobile) await tap(page, await center(page, '#title-gate'), true);
  else for (const type of ['rawKeyDown', 'keyUp']) await page.cdp('Input.dispatchKeyEvent', { type, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
  await page.until(`!document.getElementById('title-gate')`, 10000);
  await sleep(1200);
  r.titleAudio = await page.ev(`({ plays: __plays.slice(), playing: ${playing} })`);
  await page.until(`!!document.getElementById('start')`, 10000);
  await tap(page, await center(page, '#start'), mobile);
  await page.until(`document.getElementById('game-frame')?.classList.contains('in-play') && document.getElementById('overlay').hidden`, 15000);
  await sleep(800);
  const { result: proto } = await page.cdp('Runtime.evaluate', { expression: 'Phaser.Scene.prototype' });
  const { objects } = await page.cdp('Runtime.queryObjects', { prototypeObjectId: proto.objectId });
  await page.cdp('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function () { window.__scene = this.find(s => s.model && s.worldFrontAir); }' });
  r.afterStart = await page.ev(`(() => { const m = __scene.model; return { state: m.state, stage: m.stage.label, hp: m.hp, playing: ${playing} }; })()`);
  return r;
}
const shot = async (page, name) => { const b = Buffer.from((await page.cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'); await fs.writeFile(path.join(out, name), b); return decode(b); };
/** Bubbles as the model has them, plus the AIR layer's command count (16 per drawn bubble + nothing else on it). */
const AIR = `(() => { const s = __scene, m = s.model; return { n: m.bubbles.length, elapsed: m.elapsed, oxygen: m.oxygen.remaining, enabled: m.oxygen.enabled, frozen: m.timeFrozen,
  b: m.bubbles.map(b => ({ id: b.id, x: +b.x.toFixed(2), y: +b.y.toFixed(2), life: +b.life.toFixed(3), arm: +b.arm.toFixed(3) })), cam: m.cameraY, slots: s.worldFrontAir.commandBuffer.length, stage: m.stage.label, state: m.state }; })()`;
/** Push one sealed container centred on (x, y): the model's own contact test breaks it on its next step. */
/** `away`: the pin moves to that x on the first step after the break, before the burst arms (.08 s), so nothing is caught by accident. */
const container = (dx, dy, away = null) => `(() => { const m = __scene.model, p = m.player; window.__away = ${away === null ? 'null' : `{ x: ${away}, dy: 330 }`}; const c = { id: 90000 + Math.floor(Math.random() * 9999), x: p.x + ${dx} - 17, y: p.y + ${dy} - 17, width: 34, height: 34, broken: false, debris: 0 };
  m.containers.push(c); window.__box = c; return c; })()`;
const pin = (x, dy) => `(() => { const m = __scene.model; __pin = { x: ${x}, y: m.cameraY + ${dy} }; return true; })()`;

const results = [];
for (const [mode, vps] of [['webgl', [[1440, 1000], [390, 844]]], ['canvas-accel', [[1440, 1000], [360, 640]]]]) await browser(mode, async page => {
  await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
  for (const [width, height] of vps) {
    page.errors.length = 0; page.consoleErrors.length = 0;
    const tag = `${mode}-${width}x${height}`;
    const mobile = await emulate(page, width, height, 1);
    await page.cdp('Storage.clearDataForOrigin', { origin: origins[BUILD], storageTypes: 'all' }).catch(() => {});
    await page.cdp('Page.navigate', { url: origins[BUILD] + GAME + '?smoke=' + Date.now() });
    await page.until(`!!document.getElementById('title-gate') && !!window.Phaser`, 30000);
    const row = { build: BUILD, mode, width, height, mobile, chrome: page.version.product };
    // ---- NATURAL: gate, BGM, START, AREA 1 controls ----
    row.natural = await enter(page, mobile);
    row.env = await page.ev(ENV);
    await page.ev(`window.__ev = { shot: 0, jump: 0, land: 0, hurt: 0, containerBreak: 0, oxygen: 0, timeVoid: 0, section: 0 }; (() => { const m = __scene.model, step = m.step; m.step = function (...a) { const v = step.apply(this, a); for (const e of this.events) if (e.type in __ev) __ev[e.type]++; return v; }; })(); true`);
    const x0 = await page.ev('__scene.model.player.x');
    await hold(page, '#right-control', 700, mobile, KEYS.right);
    const x1 = await page.ev('__scene.model.player.x');
    await hold(page, '#left-control', 900, mobile, KEYS.left);
    const x2 = await page.ev('__scene.model.player.x');
    for (let i = 0; i < 4; i++) { await hold(page, '#fire-control', 120, mobile, KEYS.space); await sleep(250); }
    await sleep(1200);
    row.natural.controls = { x0, x1, x2, after: await page.ev(`(() => { const m = __scene.model; return { y: m.player.y, ammo: m.ammo, depth: m.totalDepth, state: m.state, hp: m.hp, stage: m.stage.label }; })()`), events: await page.ev('__ev') };
    row.natural.ok = row.natural.gateBefore && row.natural.playsBeforeGate === 0 && row.natural.titleAudio.playing.length > 0 && row.natural.afterStart.state === 'playing' && x1 > x0 && x2 < x1 && row.natural.controls.events.shot > 0;
    await shot(page, `${tag}-natural-area1.png`);
    // ---- FIXTURE: AREA 3, the player pinned, invincible ----
    row.air = await page.ev(`(() => { const s = __scene, m = s.model, p = m.player; window.__pin = null;
      s.game.events.on('prestep', () => { if (window.__box?.broken && window.__away) { __pin = { x: __away.x, y: m.cameraY + __away.dy }; __away = null; } if (__pin && __scene.model === m) { p.x = __pin.x; p.y = __pin.y; p.vy = 0; p.invincible = 9; } });
      m.jumpToStage(3, 1); m.enemies = []; return { stage: m.stage.label, state: m.state, oxygen: m.oxygen.enabled, bubbles: m.bubbles.length }; })()`);
    await sleep(500);
    await page.ev(pin(225, 330)); await sleep(400);
    await page.ev(`(() => { const m = __scene.model; m.enemies = []; m.platforms = m.platforms.filter(f => Math.abs(f.y - __pin.y) > 140); m.hazards = []; return true; })()`);
    // Release: the burst at the container's centre, 3-5, one event.
    const ev0 = await page.ev('__ev.containerBreak');
    await page.ev(`(() => { __scene.model.oxygen.fill(); return true; })()`);
    await page.ev(container(0, 0, 60));
    await page.until('__scene.model.bubbles.length > 0', 3000);
    const released = await page.ev(AIR);
    row.air.release = { count: released.n, sameStep: new Set(released.b.map(b => b.life)).size === 1, ids: released.b.map(b => b.id), events: (await page.ev('__ev.containerBreak')) - ev0, slots: released.slots, life: released.b.map(b => b.life), arm: released.b.map(b => b.arm) };
    await shot(page, `${tag}-air-release.png`);
    // Climb: sampled 4 times over ~1.2 s, the player away from the burst.
    const climb = [];
    for (let k = 0; k < 4; k++) { await sleep(300); climb.push(await page.ev(AIR)); if (k === 1) await shot(page, `${tag}-air-rise.png`); }
    row.air.rise = { ys: climb.map(c => c.b.map(b => b.y)), rising: climb.every((c, k) => !k || c.b.every(b => { const prev = climb[k - 1].b.find(q => q.id === b.id); return !prev || b.y < prev.y; })),
      slotsPerBubble: climb.map(c => c.slots / Math.max(1, c.b.length)) };
    // Leaving the screen: the burst released at the player crosses the camera's trailing edge (cameraY - 90) first.
    await page.until(`__scene.model.bubbles.length === 0`, 8000);
    const left = await page.ev(AIR);
    row.air.trailingEdge = { simSecondsToEmpty: +(left.elapsed - released.elapsed).toFixed(3), cam: [released.cam, left.cam] };
    // Expiry by life: a burst opened low on the screen by the model's own breakContainer, so it cannot reach the
    // trailing edge first. The last second blinks, then all go at 4.2 s of simulation time.
    const low = await page.ev(`(() => { const m = __scene.model; m.oxygen.fill(); m.breakContainer({ id: 97000, x: 300 - 17, y: m.cameraY + 720 - 17, width: 34, height: 34, broken: false, debris: 0 }); return { elapsed: m.elapsed, n: m.bubbles.length }; })()`);
    await page.until(`__scene.model.bubbles.length && __scene.model.bubbles[0].life < 1`, 8000);
    const blink = await page.ev(AIR); await shot(page, `${tag}-air-blink.png`);
    await page.until(`__scene.model.bubbles.length === 0`, 6000);
    const gone = await page.ev(AIR);
    row.air.expiry = { released: low.n, blinkLife: blink.b.map(b => b.life), blinkMinScreenY: Math.min(...blink.b.map(b => b.y - blink.cam)), simSecondsToEmpty: +(gone.elapsed - low.elapsed).toFixed(3), slotsAfter: gone.slots };
    // Catch: tank low, a new burst, then the player is held on the first bubble once it has armed.
    await page.ev(`(() => { __scene.model.oxygen.remaining = 4; return true; })()`);
    await page.ev(pin(225, 330)); await sleep(200);
    const ox0 = await page.ev('__ev.oxygen');
    await page.ev(container(0, 0, 60));
    await page.until('__scene.model.bubbles.length > 0', 3000);
    await sleep(250);
    const beforeCatch = await page.ev(AIR);
    await page.ev(`(() => { const m = __scene.model, b = m.bubbles[0]; window.__target = b.id; __pin = { x: b.x, y: b.y }; return true; })()`);
    await page.ev(`(() => { const m = __scene.model; __scene.game.events.on('prestep', () => { const b = m.bubbles.find(q => q.id === __target); if (b && __pin) { __pin.x = b.x; __pin.y = b.y; } }); return true; })()`);
    await sleep(400);
    const afterCatch = await page.ev(AIR);
    await page.ev(pin(60, 330));
    row.air.catch = { before: { n: beforeCatch.n, oxygen: beforeCatch.oxygen }, after: { n: afterCatch.n, oxygen: afterCatch.oxygen }, oxygenEvents: (await page.ev('__ev.oxygen')) - ox0, targetGone: !afterCatch.b.some(b => b.id === beforeCatch.b[0].id) };
    await shot(page, `${tag}-air-catch.png`);
    // ---- TIMEOUT: grant, one hit -> r96 bubble, time stops inside, resumes outside, pulses ----
    await page.ev(pin(225, 330)); await sleep(400);
    await page.ev(`(() => { const m = __scene.model; m.enemies = []; m.hazards = []; m.platforms = m.platforms.filter(f => Math.abs(f.y - __pin.y) > 160); m.upgrades.grant('timeout'); m.syncUpgrades(); while (m.hp < 4 && m.heal(1).restored) {} return true; })()`);
    row.timeout = await page.ev(`(() => { const m = __scene.model, p = m.player; p.invincible = 0; const was = __pin; __pin = null; const ok = m.damage(1, 'enemy'); __pin = was; return { ok, hp: m.hp, bubbles: m.timeoutBubbles.map(b => ({ ...b })) }; })()`);
    await sleep(300);
    const probe = ms => page.ev(`new Promise(r => { const m = __scene.model; const a = { w: m.worldElapsed, e: m.elapsed, f: m.timeFrozen };
      setTimeout(() => r({ frozenStart: a.f, frozenEnd: m.timeFrozen, worldDelta: +(m.worldElapsed - a.w).toFixed(3), elapsedDelta: +(m.elapsed - a.e).toFixed(3) }), ${ms}); })`);
    row.timeout.inside = await probe(800);
    // AIR inside stopped time: a burst released by the model's own breakContainer inside the region stays put while frozen.
    await page.ev(`(() => { const m = __scene.model, t = m.timeoutBubbles[0]; m.oxygen.fill(); m.breakContainer({ id: 97001, x: t.x - 17, y: t.y + 30 - 17, width: 34, height: 34, broken: false, debris: 0 }); return m.bubbles.length; })()`);
    await sleep(150);
    const frozenA = await page.ev(AIR); await sleep(500); const frozenB = await page.ev(AIR);
    row.timeout.airFrozen = { n: frozenA.n, still: JSON.stringify(frozenA.b) === JSON.stringify(frozenB.b), frozen: frozenB.frozen };
    const field = await page.ev(`(() => { const c = __scene.game.canvas.getBoundingClientRect(), m = __scene.model, b = m.timeoutBubbles[0]; return [c.x + (b.x - 60) * c.width / 450, c.y + (b.y - m.cameraY - 50) * c.height / 800]; })()`);
    const px = (img, [x, y]) => { const i = (Math.round(y) * img.width + Math.round(x)) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]].join(); };
    const pulse = [];
    for (let k = 0; k < 4; k++) { pulse.push(px(await shot(page, `${tag}-timeout-t${k}.png`), field)); await sleep(370); }
    row.timeout.pulse = { at: field, samples: pulse, distinct: new Set(pulse).size };
    // Outside: time runs again, the frozen burst climbs; AIR across the TIMEOUT rim.
    await page.ev(pin(225 + 150, 330)); await sleep(250);
    row.timeout.outside = await probe(500);
    await shot(page, `${tag}-air-timeout-overlap.png`);
    const overlap = await page.ev(`(() => { const m = __scene.model, t = m.timeoutBubbles[0]; return { air: m.bubbles.map(b => +Math.hypot(b.x - t.x, b.y - t.y).toFixed(1)), r: t.radius, slots: __scene.worldFrontAir.commandBuffer.length, n: m.bubbles.length }; })()`);
    row.timeout.overlap = overlap;
    await page.ev(pin(225, 330)); await sleep(300);
    row.timeout.reentered = await probe(500);
    // SECTION: bubbles in the air, then the model's own REST path.
    await page.ev(pin(225, 330)); await sleep(200);
    await page.ev(`(() => { __scene.model.oxygen.fill(); return true; })()`);
    await page.ev(container(0, 0, 390));
    await page.until('__scene.model.bubbles.length > 0', 3000);
    // The model's own completeSection opens the production REST panel; the pick and NEXT are trusted taps / clicks.
    const before = await page.ev(`(() => { const m = __scene.model; __pin = null; const before = { stage: m.stage.label, bubbles: m.bubbles.length }; const ok = m.completeSection(); return { before, ok, state: m.state }; })()`);
    await page.until(`!!document.getElementById('upgrade-confirm') && !!document.getElementById('upgrade-0')`, 8000);
    await sleep(400);
    await tap(page, await center(page, '#upgrade-0'), mobile); await sleep(300);
    await tap(page, await center(page, '#upgrade-confirm'), mobile);
    await page.until(`__scene.model.state === 'playing' && document.getElementById('overlay').hidden`, 10000);
    await sleep(700);
    row.air.section = { ...before, after: await page.ev(`(() => { const m = __scene.model; return { stage: m.stage.label, state: m.state, bubbles: m.bubbles.length, containers: m.containers.filter(c => c.id >= 90000).length, slots: __scene.worldFrontAir.commandBuffer.length }; })()`) };
    await shot(page, `${tag}-after-section.png`);
    row.air.section.afterProbe = await probe(600);
    row.errors = { exceptions: page.errors.slice(), console: page.consoleErrors.slice() };
    row.env.after = await page.ev(ENV);
    results.push(row);
    console.log(JSON.stringify({ tag, natural: row.natural.ok, air: row.air, timeout: row.timeout, errors: row.errors }));
    await fs.writeFile(path.join(root, 'evidence', `smoke-${BUILD}.json`), JSON.stringify(results, null, 1));
    await page.cdp('Page.navigate', { url: 'about:blank' });
  }
});
