import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { previewSideCave } from '../src/dev/sideCavePreview';
import { ABYSS } from '../src/data/abyss';
import { INPUT_CANCEL_FILES, withoutInputCancelFix } from './inputCancelRestore';
import { isTapiocaProjectileArtFile } from './tapiocaProjectileArtRestore';
import { pipeline, type Pipeline, type Snapshot, type Variant } from './inputPipeline';

/**
 * JETPACK REMAINING BEHAVIOR FIX V1 -- ISSUE A, input cancellation (output/jetpack-remaining-behavior-audit-v1, fix A2).
 *
 * The bug: `GameModel.actionHeld` is the press history behind ONE ACTION (jump / wall kick / skip a line). The page
 * cancels input at every PAUSE, menu and screen change (main.ts `clearInput`), but the model only learns of a release
 * by stepping, and it is not stepped while the page holds it still. So a SPACE let go during PAUSE and pressed again
 * before the first step after RESUME read as "still held": the jump was swallowed.
 *
 * The fix is the two halves of one rule -- an input the page cancelled is over:
 *   1. `clearInput` -> `GameScene.resetKeys` -> `GameModel.cancelAction()`: the history forgets the hold, so the next
 *      press is fresh even before a step;
 *   2. GameScene's keydown-SPACE listener: a SPACE still physically held across the cancel keeps sending the
 *      browser's auto-repeat, which Phaser would re-arm as a brand-new press. A repeat only reaches that listener
 *      after a reset, so it is put back down until the key is really let go. Touch already worked this way: the
 *      held pointer ids are dropped and only a new pointerdown counts.
 *
 * Nothing calls `cancelAction` but the page's own cancel; a hold the model is stepped through (a SECTION start
 * with no screen between, the reversal) is untouched. Fuel, the cap and every other rule are untouched (ISSUE B).
 */

afterEach(() => vi.restoreAllMocks());
// Loaded the way tests/jetpackBehavior.test.ts loads it: the project's typings are the browser's, not node's.
const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: string) => { digest: (e: string) => string } } };
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const DT = 1 / 120;
const internals = (m: GameModel) => m as unknown as {
  actionHeld: boolean; finish(): void; sealY: number; syncUpgrades(): void; fireGun(dt: number, d: number, f: boolean): void;
};

describe('the fix touches two sources, and only the lines listed', () => {
  it('reversing its hunks gives dae7a93 byte for byte; every other source is dae7a93 as it was', () => {
    const SOURCES = import.meta.glob(['../src/**/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const AT_DAE7A93: Record<string, string> = {
      'scenes/GameScene.ts': '97007dc835149d8d19e331cabf54e8665d4067ab5ab5ec6aaf8e911054c1a38b',
      'systems/GameModel.ts': '19211f42cb5c6880eaeb3d6be6a2e46d6268fc180dd626e5f8a6c7c2384ecb2e',
    };
    expect(INPUT_CANCEL_FILES.sort()).toEqual(Object.keys(AT_DAE7A93).sort());
    for (const [path, digest] of Object.entries(AT_DAE7A93)) {
      expect(sha256(SOURCES[`../src/${path}`]), `${path} is changed`).not.toBe(digest);
      expect(sha256(withoutInputCancelFix(path, SOURCES[`../src/${path}`])), path).toBe(digest);
    }
    // main.ts, InputBuffer, the art, the gate, upgrades, data: computed with `git show dae7a93:<path>`.
    // render/tapiocaProjectileArt.ts is the BOSS pearl's art, added after 959a5f4 (tests/tapiocaProjectileArt.test.ts).
    const keys = Object.keys(SOURCES).filter(k => !(k.replace('../src/', '') in AT_DAE7A93) && !isTapiocaProjectileArtFile(k)).sort();
    expect(keys).toHaveLength(89);
    expect(sha256(keys.map(k => `${k}\n${sha256(SOURCES[k])}`).join('\n'))).toBe('963262454bb6aee20bc09c15467824024f1efdaca20880e3c58f35dffda8b184');
  });
});

/** Every primitive reachable from the model, by path; functions skipped, cycles cut. */
function deepState(root: object) {
  const out = new Map<string, unknown>(), seen = new WeakSet<object>();
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'function') return;
    if (v === null || typeof v !== 'object') { out.set(path, v); return; }
    if (seen.has(v)) return; seen.add(v);
    for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k], `${path}.${k}`);
  };
  walk(root, '');
  return out;
}

describe('GameModel.cancelAction: the press history and nothing else', () => {
  it('clears actionHeld and changes no other value anywhere in the model -- no step, no timer, no event', () => {
    const m = new GameModel(false, () => 0.37);
    m.upgrades.grant('safetyJetpack'); internals(m).syncUpgrades();
    for (let i = 0; i < 90; i++) m.step(DT, i % 3 - 1, i > 20);
    expect(internals(m).actionHeld).toBe(true);
    const before = deepState(m);
    m.cancelAction();
    const after = deepState(m);
    expect(internals(m).actionHeld).toBe(false);
    const changed = [...before].filter(([k, v]) => !Object.is(after.get(k), v)).map(([k]) => k);
    expect(changed).toEqual(['.actionHeld']);
    expect(after.size).toBe(before.size);
  });

  it('the very next step after a cancel reads a held ACTION as a fresh press (the swallowed jump, at model level)', () => {
    const m = new GameModel(false, () => 0.5);
    for (let i = 0; i < 60; i++) m.step(DT, 0, false);
    expect(m.player.grounded).not.toBe(-1);
    internals(m).actionHeld = true; // fixture: the history a hold left behind, as after a PAUSE
    m.events.length = 0;
    m.step(DT, 0, true);
    expect(m.events.some(e => e.type === 'jump'), 'without a cancel the press is swallowed (dae7a93)').toBe(false);
    m.cancelAction();
    m.step(DT, 0, true);
    expect(m.events.filter(e => e.type === 'jump')).toHaveLength(1);
  });

  it('a hold the model is stepped straight through a SECTION start is still one press: no automatic re-jump', () => {
    // No page here, so no cancel: what a hold across a SECTION means to the model alone is exactly dae7a93's.
    const m = new GameModel(false, () => 0.5);
    for (let i = 0; i < 60; i++) m.step(DT, 0, false);
    m.step(DT, 0, true); // the jump
    for (let i = 0; i < 30; i++) m.step(DT, 0, true);
    expect(m.completeSection()).toBe(true);
    m.step(DT, 0, true); // stopped world: 'upgrade' state
    expect(m.selectUpgrade(m.upgrades.choices[0].id)).toBe(true);
    expect(m.confirmUpgrade()).toBe(true);
    m.events.length = 0;
    for (let i = 0; i < 240; i++) m.step(DT, 0, true);
    expect(m.events.filter(e => e.type === 'jump')).toHaveLength(0);
    expect(internals(m).actionHeld).toBe(true);
    m.step(DT, 0, false); // let go
    for (let i = 0; i < 240 && m.player.grounded === -1; i++) m.step(DT, 0, false);
    expect(m.player.grounded).not.toBe(-1);
    m.step(DT, 0, true);
    expect(m.events.filter(e => e.type === 'jump')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The page, executed (tests/inputPipeline.ts).

/** A started run, standing on the opening ledge, the START guard long gone. */
function standing(p: Pipeline) {
  p.main.start();
  p.frames(36);
  expect(p.snapshot().grounded).not.toBe(-1);
  expect(p.layers().active).toBe(true);
  return p;
}
/** Hold SPACE until the jump it makes has come back down onto a floor (still held). */
function jumpAndLandHeld(p: Pipeline) {
  const mark = p.trace.length;
  p.down();
  p.frame();
  expect(p.jumps(mark)).toBe(1);
  for (let i = 0; i < 600 && p.snapshot().grounded === -1; i++) p.frame();
  expect(p.snapshot().grounded, 'landed').not.toBe(-1);
  expect(p.jumps(mark), 'one jump for one hold').toBe(1);
}
/** Walk RIGHT off the opening ledge until falling, then let go of RIGHT. */
function offTheLedge(p: Pipeline) {
  p.down('RIGHT');
  for (let i = 0; i < 120 && p.snapshot().grounded !== -1; i++) p.frame();
  p.up('RIGHT');
  expect(p.snapshot().grounded).toBe(-1);
}
/**
 * dae7a93's automatic re-press depends on where the browser's auto-repeat lands against the first step after the
 * cancel ends: a repeat before that step leaves the stale history true (no press), one after it re-arms a press. So
 * every "held across a cancel" case runs at several phases: one display frame of `ms` (the page still running, no
 * step) put in while the cancel is still on, at the point the script marks.
 */
const PHASES = [0, 4, 9, 14, 19, 24, 29];
function sweep(script: (p: Pipeline, phase: () => void) => number) {
  const counts = {} as Record<Variant, number[]>;
  for (const variant of ['baseline', 'candidate'] as const) {
    counts[variant] = PHASES.map(ms => { const p = pipeline({ variant }); const n = script(p, () => { p.frame(ms); }); vi.restoreAllMocks(); return n; });
  }
  return counts;
}
/** Run `script` on a baseline page and a candidate page; a snapshot after every frame of both. */
function both(script: (p: Pipeline, frames: (n: number) => void) => void, opts: { seed?: number; held?: string[] } = {}) {
  const out = {} as Record<Variant, { p: Pipeline; snaps: Snapshot[] }>;
  for (const variant of ['baseline', 'candidate'] as const) {
    const p = pipeline({ variant, ...opts }), snaps: Snapshot[] = [];
    script(p, n => { for (let i = 0; i < n; i++) { p.frame(); snaps.push(p.snapshot()); } });
    out[variant] = { p, snaps };
    vi.restoreAllMocks();
  }
  return out;
}
const userAndModelRows = (p: Pipeline) => p.trace.filter(r => r.kind !== 'fixture').map(r => `${r.t} ${r.kind} ${r.what}`);
function expectIdentical(r: ReturnType<typeof both>) {
  expect(r.candidate.snaps.length).toBeGreaterThan(0);
  expect(r.candidate.snaps).toEqual(r.baseline.snaps);
  expect(userAndModelRows(r.candidate.p)).toEqual(userAndModelRows(r.baseline.p));
}

describe('ordinary play, no screen in between: candidate == dae7a93 frame for frame', () => {
  it('tap, release, hold through a landing with OS auto-repeat, mash', () => {
    const r = both((p, f) => {
      standing(p); f(1);
      p.down(); f(2); p.up(); f(90);           // tap: one jump
      p.down(); f(240); p.up(); f(30);         // held 4s with auto-repeat, across the landing
      for (let i = 0; i < 8; i++) { p.down(); f(4); p.up(); f(3); } f(90); // mash
    });
    expectIdentical(r);
    const p = r.candidate.p;
    expect(p.jumps()).toBeGreaterThanOrEqual(2);
    expect(p.trace.some(t => t.kind === 'input' && t.what === 'keydown SPACE')).toBe(true);
  });

  it('SPACE with LEFT/RIGHT/A/D held and swapped at the same time', () => {
    expectIdentical(both((p, f) => {
      standing(p);
      p.down('LEFT'); f(10); p.down(); f(30); p.down('D'); f(20); p.up('LEFT'); f(20); p.up(); f(10); p.down(); f(20);
      p.up('D'); p.down('A'); f(30); p.up(); p.up('A'); f(60);
    }));
  });

  it('touch FIRE: hold, release, two fingers with one cancelled, a captured finger dragged off-screen, a mouse click on the frame', () => {
    expectIdentical(both((p, f) => {
      standing(p);
      p.touch.down(1); f(20); p.touch.move(1); f(20); p.touch.up(1); f(60);
      p.touch.down(2); f(5); p.touch.down(3); f(20); p.touch.cancel(2); f(20); p.touch.lost(3); f(60);
      p.$('game-frame').dispatch('pointerdown', { pointerType: 'mouse', target: { closest: () => null }, preventDefault() {} }); f(60);
    }));
  });

  it('keyboard and touch together: neither source letting go ends the other one\'s hold', () => {
    const r = both((p, f) => {
      standing(p);
      p.down(); f(10); p.touch.down(4); f(10); p.up(); f(30); p.down(); f(10); p.touch.up(4); f(20); p.up(); f(60);
    });
    expectIdentical(r);
  });

  it('JETPACK + DRONE + HEART BALLOON, CHARGE run dry and hovering on the fuel: same fuel, flag and flight', () => {
    const r = both((p, f) => {
      standing(p); offTheLedge(p);
      p.down(); f(240); p.up(); f(10); p.down(); f(60); p.up(); f(60);
    }, { held: ['safetyJetpack', 'drone', 'heartBalloon'] });
    expectIdentical(r);
    const snaps = r.candidate.snaps;
    expect(snaps.some(s => s.jetpack), 'the hover is exercised').toBe(true);
    expect(Math.min(...snaps.map(s => s.fuel))).toBeLessThan(4);
  });

  it('PAUSE and RESUME with nothing held', () => {
    expectIdentical(both((p, f) => { standing(p); f(10); p.main.pause(); f(30); p.main.resume(); f(60); p.down(); f(2); p.up(); f(60); }));
  });
});

describe('PAUSE / RESUME', () => {
  it('ISSUE A: let go during PAUSE, press again before the first step after RESUME -> the jump happens (dae7a93 swallowed it)', () => {
    const r = both(p => {
      standing(p); jumpAndLandHeld(p);
      p.main.pause(); p.frames(10);
      p.up(); p.frames(10);
      p.main.resume();
      p.idle(300); // the renderer wakes only after the 260ms guard
      const mark = p.trace.length, steps = p.stepCount;
      p.down();
      const first = p.frame();
      expect(first.length).toBeGreaterThan(0);
      p.log('fixture', `first frame: ${first.length} steps, first pressed=${first[0].pressed}, jumps=${p.jumps(mark)}`);
      p.frames(30);
      expect(p.stepsSince(steps)[0].firing, 'the fresh SPACE reached the first step').toBe(true);
      (p as unknown as { result: unknown }).result = { firstPressed: first[0].pressed, jumps: p.jumps(mark) };
    });
    const res = (v: Variant) => (r[v].p as unknown as { result: { firstPressed: boolean; jumps: number } }).result;
    expect(res('baseline')).toEqual({ firstPressed: false, jumps: 0 });  // the audit's first-sample-race, reproduced
    expect(res('candidate')).toEqual({ firstPressed: true, jumps: 1 });
  });

  it('SPACE held into PAUSE and still held through RESUME: no new press until it is let go -- then exactly one', () => {
    const again: number[] = [];
    const counts = sweep((p, phase) => {
      standing(p); jumpAndLandHeld(p);
      p.main.pause(); p.frames(40); phase();
      p.main.resume();
      const mark = p.trace.length;
      p.frames(120); // auto-repeat throughout
      const n = p.presses(mark);
      p.up(); p.frames(10);
      const m2 = p.trace.length;
      p.down(); p.frames(60);
      again.push(p.jumps(m2));
      return n;
    });
    expect(counts.candidate, 'candidate: the cancelled hold never comes back as a press').toEqual(PHASES.map(() => 0));
    expect(Math.max(...counts.baseline), 'dae7a93: auto-repeat re-armed the key as a new press at some phase (negative control)').toBeGreaterThan(0);
    expect(again.slice(PHASES.length), 'candidate: let go and pressed again -> one jump').toEqual(PHASES.map(() => 1));
  });

  it('every layer agrees while a cancelled SPACE is still held after RESUME', () => {
    const p = standing(pipeline({ variant: 'candidate' }));
    jumpAndLandHeld(p);
    p.main.pause(); p.frames(40); p.main.resume(); p.frames(60);
    expect(p.layers()).toEqual({ physical: true, phaserSpace: false, buffer: false, bridgeFiring: false, touches: 0, actionHeld: false, active: true, mode: 'playing' });
  });

  it('let go AND pressed again during PAUSE, held through RESUME: a press the menu had is not the run\'s', () => {
    const p = standing(pipeline({ variant: 'candidate' }));
    jumpAndLandHeld(p);
    p.main.pause(); p.frames(5); p.up(); p.frames(5); p.down(); p.frames(40);
    p.main.resume();
    const mark = p.trace.length;
    p.frames(90);
    expect(p.presses(mark)).toBe(0);
    p.up(); p.frames(2); p.down(); p.frames(2);
    expect(p.jumps(mark)).toBe(1);
  });

  it('let go during PAUSE, pressed a few frames after RESUME: one jump either way (dae7a93 recovered here too)', () => {
    const r = both(p => {
      standing(p); jumpAndLandHeld(p);
      p.main.pause(); p.frames(5); p.up(); p.main.resume(); p.frames(20);
      const mark = p.trace.length; p.down(); p.frames(90); p.up(); p.frames(5);
      (p as unknown as { n: number }).n = p.jumps(mark);
    });
    for (const v of ['baseline', 'candidate'] as const) expect((r[v].p as unknown as { n: number }).n, v).toBe(1);
  });

  it('SPACE confirming RESUME on the focused button (down, up, click) starts nothing', () => {
    const p = standing(pipeline({ variant: 'candidate' }));
    p.main.pause(); p.frames(10);
    p.down(); p.frames(3); p.up(); p.click('resume');
    const mark = p.trace.length;
    p.frames(60);
    expect(p.presses(mark)).toBe(0);
    expect(p.main.mode).toBe('playing');
  });

  it('a fresh press during the 260ms guard still counts on the raw key, once -- the guard only stops the tap buffer', () => {
    const p = standing(pipeline({ variant: 'candidate' }));
    p.main.pause(); p.frames(10); p.main.resume();
    const mark = p.trace.length;
    p.frames(2); p.down(); p.frames(2);
    expect(p.layers().buffer, 'requestShot refused inside the guard').toBe(false);
    p.frames(60);
    expect(p.jumps(mark)).toBe(1);
    expect(p.presses(mark)).toBe(1);
  });

  it('window blur pauses; the keyup lost while unfocused leaves nothing behind; focus alone does not resume', () => {
    const p = standing(pipeline({ variant: 'candidate' }));
    jumpAndLandHeld(p);
    p.win.dispatch('blur', {});
    expect(p.main.mode).toBe('paused');
    p.loseKeyup(); p.frames(30);
    p.win.dispatch('focus', {}); p.frames(10);
    expect(p.main.mode).toBe('paused');
    p.click('resume');
    const mark = p.trace.length;
    p.frames(30);
    expect(p.presses(mark)).toBe(0);
    p.down(); p.frames(2);
    expect(p.jumps(mark)).toBe(1);
  });
});

/** SECTION CLEAR -> REST -> pick -> NEXT, through main.ts's own banner, cards and confirm. */
function throughRest(p: Pipeline, during: () => void = () => {}) {
  p.fixture('completeSection (the exit reached)', m => expect(m.completeSection()).toBe(true));
  p.frames(2);
  expect(p.main.mode).toBe('upgrade');
  p.frames(60); // the SECTION CLEAR card's own timer opens the REST point
  during();
  p.click('upgrade-0'); p.click('upgrade-confirm');
  expect(p.main.mode).toBe('playing');
}

describe('SECTION / REST', () => {
  it('held into SECTION CLEAR and still held after NEXT: no automatic jump on the new ledge (dae7a93 re-jumped)', () => {
    const counts = sweep((p, phase) => {
      standing(p); jumpAndLandHeld(p);
      throughRest(p, phase);
      const mark = p.trace.length;
      p.frames(150);
      return p.presses(mark);
    });
    expect(counts.candidate).toEqual(PHASES.map(() => 0));
    expect(Math.max(...counts.baseline)).toBeGreaterThan(0);
  });

  it('let go in the REST point, pressed before the first step of the next SECTION: the press is seen', () => {
    const r = both(p => {
      standing(p); jumpAndLandHeld(p);
      throughRest(p, () => p.up());
      p.idle(300);
      const mark = p.trace.length;
      p.down(); const first = p.frame();
      (p as unknown as { first: boolean }).first = first[0]?.pressed ?? false;
      p.frames(30);
      (p as unknown as { n: number }).n = p.presses(mark);
    });
    expect((r.baseline.p as unknown as { first: boolean }).first).toBe(false);
    expect((r.candidate.p as unknown as { first: boolean }).first).toBe(true);
    expect((r.candidate.p as unknown as { n: number }).n).toBe(1);
  });

  it('released before the SECTION ended: the next SECTION plays exactly as dae7a93', () => {
    expectIdentical(both((p, f) => {
      standing(p); p.down(); f(2); p.up(); f(120);
      throughRest(p);
      f(60); p.down(); f(30); p.up(); f(60);
    }));
  });

  it('three SECTIONs in a row, held across each: never a jump the player did not press', () => {
    const p = standing(pipeline({ variant: 'candidate' }));
    jumpAndLandHeld(p);
    for (let i = 0; i < 3; i++) {
      throughRest(p);
      const mark = p.trace.length;
      p.frames(60);
      expect(p.presses(mark), `SECTION ${i + 2}`).toBe(0);
      expect(p.held()).toBe(false);
    }
    p.up(); p.frames(60);
    const mark = p.trace.length;
    p.down(); p.frames(2);
    expect(p.presses(mark)).toBe(1);
  });
});

function walkIntoShop(p: Pipeline, door: { x: number; y: number; width: number; height: number }) {
  p.fixture('player placed in the SHOP doorway', m => {
    m.player.x = door.x + door.width / 2; m.player.y = door.y + door.height - 16; m.player.vx = 0; m.player.vy = 0; m.player.invincible = 99;
  });
  for (let i = 0; i < 120 && p.main.mode !== 'shop'; i++) p.frame();
  expect(p.main.mode).toBe('shop');
}

describe('SHOP (SIDE CAVE and STAGING)', () => {
  it('SIDE CAVE: held in, let go on the shelf, pressed before the first step out -> seen; held out -> not a press', () => {
    for (const letGo of [true, false]) {
      const p = standing(pipeline({ variant: 'candidate' }));
      p.fixture('jumpToStage 1-2 + previewSideCave shop-right', m => { m.jumpToStage(1, 2); previewSideCave(m, 'shop-right'); });
      p.frames(2);
      p.down(); p.frames(2);
      const m = p.model;
      walkIntoShop(p, m.shopDoor(m.caves[0]));
      if (letGo) p.up();
      p.frames(10);
      p.click('shop-close');
      expect(p.main.mode).toBe('playing');
      p.idle(300);
      const mark = p.trace.length;
      if (letGo) p.down();
      p.frame(); p.frames(60);
      expect(p.presses(mark), letGo ? 'fresh press' : 'cancelled hold').toBe(letGo ? 1 : 0);
    }
  });

  it('STAGING SHOP: shopping cancels input and nothing else -- back to boss mode, staging, ordinary gravity', () => {
    const p = standing(pipeline({ variant: 'candidate' }));
    p.fixture('safeZoneVisitCount=1 + jumpToBoss', m => { m.safeZoneVisitCount = 1; m.jumpToBoss(); });
    p.frames(2);
    expect(p.main.mode).toBe('boss');
    p.down(); p.frames(2);
    walkIntoShop(p, p.model.shop.entrance!);
    p.up(); p.frames(5);
    p.click('shop-close');
    expect([p.main.mode, p.model.state, p.model.abyssStage, p.model.gravitySign]).toEqual(['boss', 'boss', 'staging', 1]);
    expect(p.held()).toBe(false);
  });
});

/** Into STAGING, then fall past the seal: the reversal, then the 'boss' event opens the arena. */
function toTheFight(p: Pipeline, beforeFight: () => void = () => {}) {
  p.fixture('jumpToBoss', m => m.jumpToBoss());
  p.frames(2);
  p.fixture('player dropped past the seal (inversion trigger)', m => {
    m.player.y = internals(m).sealY + ABYSS.inversionDrop + 1; m.player.vy = 0; m.player.grounded = -1; m.player.invincible = 99;
  });
  for (let i = 0; i < 30 && p.model.abyssStage !== 'inverting'; i++) p.frame();
  expect(p.model.abyssStage).toBe('inverting');
  beforeFight();
  for (let i = 0; i < 600 && p.model.abyssStage !== 'fight'; i++) p.frame();
  expect(p.model.abyssStage).toBe('fight');
  expect(p.trace.some(r => r.kind === 'event' && r.what === 'boss')).toBe(true);
}

describe('ABYSS: the reversal and the fight', () => {
  it('held from STAGING through GRAVITY REVERSED into the fight: the arena\'s cancel ends it -- no carried press', () => {
    const counts = sweep((p, phase) => {
      standing(p);
      toTheFight(p, () => { p.down(); phase(); p.frames(10); });
      const mark = p.trace.length;
      p.frames(120);
      return p.presses(mark);
    });
    expect(counts.candidate).toEqual(PHASES.map(() => 0));
    expect(Math.max(...counts.baseline)).toBeGreaterThan(0);
  });

  it('pressed and let go inside the reversal: nothing happens there and nothing is carried; the next press counts', () => {
    const p = standing(pipeline({ variant: 'candidate' }));
    const before = p.trace.length;
    toTheFight(p, () => { p.down(); p.frames(5); p.up(); p.frames(5); });
    expect(p.presses(before)).toBe(0);
    p.frames(40);
    const mark = p.trace.length;
    p.down(); p.frames(2);
    expect(p.presses(mark)).toBe(1);
    expect(p.model.gravitySign).toBe(-1);
  });

  it('the fight itself, nothing cancelled: JETPACK under the reversed pull runs as dae7a93', () => {
    expectIdentical(both((p, f) => {
      standing(p);
      toTheFight(p);
      f(40); p.down(); f(300); p.up(); f(20); p.down(); f(120); p.up(); f(30);
    }, { held: ['safetyJetpack', 'drone', 'heartBalloon'] }));
  });
});

describe('GAME OVER / CLEAR / TITLE', () => {
  it('held through GAME OVER and RETRY: the new run starts clean and the held key is not a press', () => {
    const counts = sweep((p, phase) => {
      standing(p); jumpAndLandHeld(p);
      p.fixture('finish() (death)', m => internals(m).finish());
      p.frames(2);
      expect(p.main.mode).toBe('over');
      p.frames(30);
      phase(); p.click('retry');
      expect(p.held()).toBe(false);
      const mark = p.trace.length;
      p.frames(120);
      return p.presses(mark);
    });
    expect(counts.candidate).toEqual(PHASES.map(() => 0));
    expect(Math.max(...counts.baseline)).toBeGreaterThan(0);
  });

  it('CLEAR -> PLAY AGAIN and PAUSE -> title -> START leave no input behind', () => {
    const p = standing(pipeline({ variant: 'candidate' }));
    p.fixture('jumpToNimushi + clearBoss', m => { m.jumpToNimushi(); });
    p.frames(2);
    p.down(); p.frames(5);
    p.fixture('clearBoss', m => expect(m.clearBoss()).toBe(true));
    p.frames(2);
    expect(p.main.mode).toBe('clear');
    p.click('play-again');
    let mark = p.trace.length;
    p.frames(90);
    expect(p.presses(mark)).toBe(0);
    p.main.pause(); p.click('home');
    expect(p.main.mode).toBe('title');
    p.up(); p.main.start(); p.frames(36);
    mark = p.trace.length;
    p.down(); p.frames(2);
    expect(p.jumps(mark)).toBe(1);
  });
});

describe('touch', () => {
  it('a finger let go during PAUSE and put down before the first step after RESUME: seen (dae7a93 swallowed it)', () => {
    const r = both(p => {
      standing(p);
      p.touch.down(1); p.frames(2); for (let i = 0; i < 600 && p.snapshot().grounded === -1; i++) p.frame();
      p.main.pause(); p.frames(5); p.touch.up(1); p.frames(5); p.main.resume(); p.idle(300);
      const mark = p.trace.length;
      p.touch.down(2); const first = p.frame();
      (p as unknown as { first: boolean }).first = first[0]?.pressed ?? false;
      p.frames(10);
      (p as unknown as { n: number }).n = p.jumps(mark);
    });
    expect((r.baseline.p as unknown as { first: boolean }).first).toBe(false);
    expect((r.candidate.p as unknown as { first: boolean }).first).toBe(true);
    expect((r.candidate.p as unknown as { n: number }).n).toBe(1);
  });

  it('a finger held through PAUSE stays dropped as before; its late pointerup clears nothing new; a new finger presses', () => {
    expectIdentical(both((p, f) => {
      standing(p);
      p.touch.down(1); f(5); p.main.pause(); f(20); p.main.resume(); f(60); p.touch.move(1); f(10); p.touch.up(1); f(10);
      p.touch.down(2); f(30); p.touch.up(2); f(60);
    }));
  });

  it('keyboard and a finger both held into PAUSE: after RESUME neither is ACTION; a new touch is one press', () => {
    const p = standing(pipeline({ variant: 'candidate' }));
    p.down(); p.touch.down(1); p.frames(3);
    for (let i = 0; i < 600 && p.snapshot().grounded === -1; i++) p.frame();
    p.main.pause(); p.frames(20); p.main.resume();
    const mark = p.trace.length;
    p.frames(60);
    expect(p.presses(mark)).toBe(0);
    expect(p.layers()).toMatchObject({ physical: true, phaserSpace: false, bridgeFiring: false, touches: 0, actionHeld: false });
    p.touch.down(2); p.frames(2);
    expect(p.presses(mark)).toBe(1);
    p.up(); p.frames(5); // letting go of the old key ends nothing of the finger's
    expect(p.layers()).toMatchObject({ bridgeFiring: true, actionHeld: true });
    p.touch.up(2); p.frames(3);
    expect(p.held()).toBe(false);
  });
});

describe('JETPACK across a cancel (ISSUE B untouched)', () => {
  it('hovering, PAUSE with SPACE held, RESUME still held: the hover stops until ACTION is pressed again, then burns dt per step', () => {
    const p = standing(pipeline({ variant: 'candidate', held: ['safetyJetpack'] }));
    offTheLedge(p);
    p.down();
    for (let i = 0; i < 900 && !p.model.jetpackActive; i++) p.frame();
    expect(p.model.jetpackActive).toBe(true);
    p.main.pause();
    const paused = p.model.jetpackFuel;
    p.frames(30);
    expect(p.model.jetpackFuel).toBe(paused);
    p.main.resume(); p.frames(30);
    expect(p.model.jetpackFuel, 'a cancelled hold burns nothing').toBe(paused);
    p.up(); p.frames(1);
    if (p.snapshot().grounded !== -1) return; // landed meanwhile: nothing more to show here
    const steps = p.stepCount, fuel = p.model.jetpackFuel;
    p.down(); p.frames(6);
    const ran = p.stepsSince(steps).filter(s => s.firing).length;
    expect(p.model.jetpackActive || p.snapshot().grounded !== -1).toBe(true);
    expect(p.model.jetpackFuel).toBeCloseTo(Math.max(0, fuel - ran * DT), 10);
  });

  it('below the cap the fuel still burns dt with nothing to brake, and not owning it burns nothing (dae7a93 rule)', () => {
    for (const owned of [true, false]) {
      const m = new GameModel(false, () => 0.5);
      if (owned) { m.upgrades.grant('safetyJetpack'); internals(m).syncUpgrades(); }
      m.platforms = []; m.ammo = 0; m.player.grounded = -1; m.player.vy = 20; m.player.invincible = 99;
      const fuel = m.jetpackFuel;
      internals(m).fireGun(DT, 0, true);
      expect(m.jetpackFuel).toBeCloseTo(owned ? fuel - DT : fuel, 12);
      expect(m.jetpackActive).toBe(owned);
      expect(m.player.vy).toBe(20);
    }
  });
});
