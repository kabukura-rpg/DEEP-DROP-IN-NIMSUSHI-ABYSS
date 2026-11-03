import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';
import { JETPACK_ART, drawJetpackExhaust } from '../src/render/jetpackArt';
import { GameModel } from '../src/systems/GameModel';
import { JETPACK_BEHAVIOR_FILES, withoutJetpackBehaviorFix } from './jetpackBehaviorRestore';
import { isTapiocaProjectileArtFile } from './tapiocaProjectileArtRestore';
import { spawnEnemy } from '../src/data/enemies';
import { JETPACK_TRACE_SCENARIOS, jetpackTrace } from './jetpackTrace';
import sceneSource from '../src/scenes/GameScene.ts?raw';
import mainSource from '../src/main.ts?raw';

/**
 * JETPACK BEHAVIOR FIX V1 (output/jetpack-behavior-audit-v1, claude-integration-spec.md).
 *
 * ISSUE 1: under the ABYSS's reversed pull the jetpack caps a climb, so its exhaust belongs above the player. The
 * same 12 rectangles a frame are mirrored about the player's centre line (y+o -> y-o-h); the ordinary pull draws
 * exactly what 19adbd4 drew. Presentation only: nothing in the model changes for it.
 */

const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: Uint8Array | string) => { digest: (e: string) => string } } };
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

interface Fill { x: number; y: number; w: number; h: number; color: number; alpha: number }
function recorder() {
  const ops: string[] = [], fills: Fill[] = [];
  let color = -1, alpha = -1;
  const g = {
    fillStyle(c: number, a = 1) { color = c; alpha = a; ops.push(`fillStyle ${c} ${a}`); return g; },
    fillRect(x: number, y: number, w: number, h: number) { fills.push({ x, y, w, h, color, alpha }); ops.push(`fillRect ${x} ${y} ${w} ${h}`); return g; },
  };
  return { g: g as unknown as Phaser.GameObjects.Graphics, ops, fills };
}
const draw = (x: number, y: number, t: number, sign?: 1 | -1) => {
  const r = recorder();
  if (sign === undefined) drawJetpackExhaust(r.g, x, y, t); else drawJetpackExhaust(r.g, x, y, t, sign);
  return r;
};
const raster = (fills: Fill[]) => {
  const px = new Set<string>();
  for (const f of fills) for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) px.add(`${x},${y}`);
  return px;
};
const between = (text: string, from: string, to: string) => {
  const a = text.indexOf(from), b = text.indexOf(to, a);
  expect(a, from).toBeGreaterThanOrEqual(0); expect(b, to).toBeGreaterThan(a);
  return text.slice(a, b);
};
/** GameScene's own jetpack block, run on a recording Graphics against the model it is given. */
function sceneBlock() {
  const block = between(between(sceneSource, '  private draw() {', '  private surface('), '    if (m.jetpackActive', '    const art = this.playerArt?.render(');
  const fn = new Function('m', 'x', 'y', 'drawJetpackExhaust', block);
  return (m: GameModel) => {
    const r = recorder();
    fn.call({ model: m, graphics: r.g }, m, Math.round(m.player.x), Math.round(m.player.y - m.cameraY), drawJetpackExhaust);
    return r;
  };
}
const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
const internals = (g: GameModel) => g as unknown as { fireGun: (dt: number, d: number, f: boolean) => void; syncUpgrades: () => void };

describe('ISSUE 1: the exhaust points along the pull it brakes against', () => {
  it('under the ordinary pull draws 19adbd4 call for call, with or without the sign', () => {
    for (let t = 0; t < 0.48; t += 0.013) for (const [x, y] of [[100, 200], [0, 0], [-3, 799]]) {
      const plain = draw(x, y, t), normal = draw(x, y, t, 1);
      expect(normal.ops).toEqual(plain.ops);
      // 19adbd4's formula, verbatim: y + originY + dy.
      const frame = JETPACK_ART.frames[Math.floor((t + 1e-8) / 0.08) % 3];
      expect(plain.fills.map(f => [f.x, f.y, f.w, f.h, f.color])).toEqual(frame.map(r => [x - 6 + r[0], y + 18 + r[1], r[2], r[3], r[4]]));
    }
  });

  it('under the reversed pull mirrors every rectangle about the centre line: same x, size, colour, alpha, order', () => {
    for (let t = 0; t < 0.48; t += 0.011) {
      const down = draw(120, 300, t, 1), up = draw(120, 300, t, -1);
      expect(up.fills).toHaveLength(12);
      expect(up.fills).toEqual(down.fills.map(f => ({ ...f, y: 2 * 300 - f.y - f.h })));
      // Pixel for pixel: each painted row y lands on 2*300-1-y.
      const a = raster(down.fills), b = raster(up.fills);
      expect([...b].sort()).toEqual([...a].map(k => { const [x, y] = k.split(',').map(Number); return `${x},${599 - y}`; }).sort());
    }
  });

  it('keeps 3 frames of 12 rectangles at 80ms and the flicker alpha under either pull', () => {
    for (const sign of [1, -1] as const) {
      const seen = new Set<string>();
      for (let f = 0; f < 6; f++) {
        const t = f * 0.08 + 0.02, r = draw(0, 0, t, sign);
        expect(r.fills).toHaveLength(12);
        expect(new Set(r.fills.map(x => x.alpha))).toEqual(new Set([0.5 + Math.abs(Math.sin(t * 22)) * 0.5]));
        seen.add(JSON.stringify(r.fills.map(x => [x.y, x.h])));
      }
      expect(seen.size).toBe(3);
    }
  });

  it('stays inside the mirrored 14x16 envelope x=[-6,8) y=[-34,-18), and only the mirrored strips', () => {
    const MIRRORED = [[-6, -26, 4, 8], [-1, -30, 4, 11], [4, -34, 4, 14]];
    for (let f = 0; f < 3; f++) {
      const px = raster(draw(0, 0, f * 0.08 + 0.001, -1).fills);
      for (const k of px) {
        const [x, y] = k.split(',').map(Number);
        expect(x >= -6 && x < 8 && y >= -34 && y < -18, k).toBe(true);
        expect(MIRRORED.some(([sx, sy, w, h]) => x >= sx && x < sx + w && y >= sy && y < sy + h), k).toBe(true);
      }
    }
  });

  it('the scene passes the model\'s own gravity sign and nothing else new', () => {
    expect(sceneSource.split('drawJetpackExhaust(').length - 1).toBe(1);
    expect(sceneSource).toContain('drawJetpackExhaust(this.graphics, x, y, this.model.elapsed, m.gravitySign);');
    expect(sceneSource).not.toMatch(/jetpack[^\n]*\.vy|vy[^\n]*jetpack/i);
  });

  it('in the fight, lit by the model\'s own step: the cap brakes the climb to -130 and the exhaust sits above the player', () => {
    const g = new GameModel(false, seeded(5));
    g.upgrades.grant('safetyJetpack'); internals(g).syncUpgrades();
    g.jumpToNimushi();
    expect(g.gravitySign).toBe(-1);
    g.ammo = 0; g.player.grounded = -1; g.player.vy = -600; (g as unknown as { actionHeld: boolean }).actionHeld = true;
    g.step(1 / 120, 0, true);
    expect(g.jetpackActive).toBe(true);
    expect(g.player.vy).toBe(-130);
    const r = sceneBlock()(g), y = Math.round(g.player.y - g.cameraY);
    expect(r.fills).toHaveLength(12);
    for (const f of r.fills) expect(f.y + f.h).toBeLessThanOrEqual(y - 18);
  });

  it('in STAGING (ordinary pull) the exhaust stays below, as 19adbd4', () => {
    const g = new GameModel(false, seeded(6));
    g.upgrades.grant('safetyJetpack'); internals(g).syncUpgrades();
    g.jumpToBoss();
    expect([g.abyssStage, g.gravitySign]).toEqual(['staging', 1]);
    g.ammo = 0; g.player.grounded = -1; internals(g).fireGun(1 / 120, 0, true);
    expect(g.jetpackActive).toBe(true);
    const r = sceneBlock()(g), y = Math.round(g.player.y - g.cameraY);
    expect(r.fills.map(f => f.y)).toEqual(draw(0, y, g.elapsed, 1).fills.map(f => f.y));
    for (const f of r.fills) expect(f.y).toBeGreaterThanOrEqual(y + 18);
  });
});

describe('JETPACK BEHAVIOR FIX V1 changes nothing else', () => {
  it('every touched source is 19adbd4 byte for byte once its hunks are reversed', () => {
    const SOURCES = import.meta.glob(['../src/**/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const AT_19ADBD4: Record<string, string> = {
      'scenes/GameScene.ts': 'd6639bc1b20143a5aad010bac1df995e8745a0be51bb0abb64ebc8fbb5cc3f1a',
      'systems/GameModel.ts': 'd44534da247bb31183e8dca9e1760c8cc498ad0671f5d0d6da030da021554ab6',
      'main.ts': 'b9e7ada5bd49a44b70a00baa80c93613d0a25b7df53aa29a57376e81a40f0897',
      'render/jetpackArt.ts': '4ded114f90b9eaac7abc5efbf176a588d894a92f6726c1f85092b2472feaa3b3',
    };
    for (const path of JETPACK_BEHAVIOR_FILES) expect(Object.keys(AT_19ADBD4), path).toContain(path);
    for (const [path, digest] of Object.entries(AT_19ADBD4)) expect(sha256(withoutJetpackBehaviorFix(path, SOURCES[`../src/${path}`])), path).toBe(digest);
    // The other 87 sources, computed with `git show 19adbd4:<path>` (the BOSS pearl's art, added after 959a5f4, left out).
    const keys = Object.keys(SOURCES).filter(k => !(k.replace('../src/', '') in AT_19ADBD4) && !isTapiocaProjectileArtFile(k)).sort();
    expect(keys).toHaveLength(87);
    expect(sha256(keys.map(k => `${k}\n${sha256(SOURCES[k])}`).join('\n'))).toBe('53791ad480e20030ff11cb128cc40b1a27381e2fe8c488ffeb18fabb45994026');
  });
});

/**
 * ISSUE 2: the flag outlived the hover. `fireGun` was the only place it fell, and a landing (or a stomp, a REST, a
 * pause, the reversal) never passed through it again. Contract now (output/jetpack-behavior-audit-v1,
 * jetpack-state-machine.md "将来の契約案"): true exactly when this step ran the fuel branch and the step ended still
 * airborne, CHARGE dry, running and not mid-reversal. The last fuel tick and a hover below the cap still count.
 * Every fixture below only places the player; the flag itself is never written -- the model's own `step` does it.
 */
const DT = 1 / 120;
function fresh(boss = false, held: string[] = ['safetyJetpack']) {
  const m = new GameModel(false, seeded(31));
  for (const id of held) m.upgrades.grant(id as never);
  internals(m).syncUpgrades();
  if (boss) m.jumpToNimushi(); else m.jumpToStage(1, 1);
  m.platforms = []; m.enemies = []; m.pickups = []; m.hazards = []; m.doodads = []; m.safeZones = []; m.caves = []; m.containers = []; m.bullets = [];
  m.player.x = 225; m.player.y = boss ? 2100 : 200; m.player.vy = 600 * m.gravitySign; m.player.grounded = -1; m.player.invincible = 99;
  m.cameraY = m.player.y - 400; m.ammo = 0; m.events.length = 0;
  return m;
}
const tick = (m: GameModel, firing: boolean, dir = 0) => { m.events.length = 0; m.step(DT, dir, firing); return m.events.map(e => e.type); };
/** A ledge under the player (over it, in the fight), met by the model's own collision a few steps on. */
const ledge = (m: GameModel) => { m.platforms = [{ id: 901, x: 150, y: m.gravitySign < 0 ? m.player.y - 38 : m.player.y + 22, width: 150, state: 'stable' } as never]; };
function landHeld(boss = false) {
  const m = fresh(boss); ledge(m);
  const seen: { active: boolean; events: string[] }[] = [];
  for (let i = 0; i < 80 && m.player.grounded !== 901; i++) { const events = tick(m, true); seen.push({ active: m.jetpackActive, events }); }
  expect(m.player.grounded).toBe(901);
  return { m, seen };
}

describe('ISSUE 2: the hover ends when the hover ends', () => {
  it('held through a landing: on the landing step itself the flag is down; CHARGE, fuel, velocity and events as before', () => {
    for (const boss of [false, true]) {
      const { m, seen } = landHeld(boss);
      // Hovering all the way in, under either pull.
      expect(seen.slice(0, -1).every(s => s.active), `${boss}`).toBe(true);
      const last = seen.at(-1)!;
      expect(last.active).toBe(false);
      // The landing step still burned fuel first: its jetpack event is kept, then the land and the refill.
      expect(last.events).toEqual(expect.arrayContaining(['jetpack', 'land']));
      expect([m.player.vy, m.ammo, m.jetpackFuel]).toEqual([0, m.stats.maxAmmo, 4]);
    }
  });

  it('on the ground, held 1 / 10 / 120 steps or released: down, no fuel burned, no jump from holding', () => {
    const { m } = landHeld();
    for (let i = 1; i <= 120; i++) {
      tick(m, true);
      expect(m.jetpackActive, `${i}`).toBe(false);
      expect([m.player.grounded, m.player.vy, m.jetpackFuel, m.ammo]).toEqual([901, 0, 4, m.stats.maxAmmo]);
    }
    tick(m, false);
    expect(m.jetpackActive).toBe(false);
    expect(m.player.grounded).toBe(901);
  });

  it('a fresh press on the ground jumps (flag down), the air then shoots, and an empty magazine brings the hover back', () => {
    const { m } = landHeld();
    tick(m, false);
    const jump = tick(m, true);
    expect(jump).toContain('jump');
    expect(m.player.grounded).toBe(-1);
    expect(m.jetpackActive).toBe(false);
    // Held on into the air: the gunboots take over (CHARGE spent), the hover stays down while any is left.
    const ammo = m.ammo;
    for (let i = 0; i < 120 && m.ammo === ammo; i++) { tick(m, true); expect(m.jetpackActive).toBe(false); }
    expect(m.ammo).toBeLessThan(ammo);
    let back = -1;
    for (let i = 0; i < 400 && back < 0; i++) { tick(m, true, 1); if (m.jetpackActive) back = i; }
    expect(back).toBeGreaterThan(0);
    expect([m.ammo <= 0, m.player.grounded, m.jetpackFuel < 4]).toEqual([true, -1, true]);
  });

  it('released in the air: down on the next step, fuel kept, and still down on landing', () => {
    const m = fresh(); ledge(m);
    tick(m, true);
    expect(m.jetpackActive).toBe(true);
    const fuel = m.jetpackFuel;
    tick(m, false);
    expect(m.jetpackActive).toBe(false);
    expect(m.jetpackFuel).toBe(fuel);
    for (let i = 0; i < 80 && m.player.grounded === -1; i++) { tick(m, false); expect(m.jetpackActive).toBe(false); }
    expect(m.player.grounded).toBe(901);
  });

  it('never lights without fuel, without the upgrade, or with CHARGE left', () => {
    const dry = fresh(); dry.jetpackFuel = 0;
    const vy = dry.player.vy;
    tick(dry, true);
    expect([dry.jetpackActive, dry.jetpackFuel]).toEqual([false, 0]);
    expect(dry.player.vy).toBeGreaterThan(vy);
    const none = fresh(false, []);
    tick(none, true);
    expect(none.jetpackActive).toBe(false);
    const loaded = fresh(); loaded.ammo = 3;
    const events = tick(loaded, true);
    expect(events).toContain('shot');
    expect([loaded.jetpackActive, loaded.jetpackFuel]).toEqual([false, 4]);
  });

  it('keeps the last fuel tick lit (fuel 0, cap applied), and the hover below the cap', () => {
    const m = fresh(); m.jetpackFuel = DT / 2;
    tick(m, true);
    expect([m.jetpackFuel, m.jetpackActive, m.player.vy]).toEqual([0, true, 232.5]);
    tick(m, true);
    expect(m.jetpackActive).toBe(false);
    const slow = fresh(); slow.player.vy = -300;
    tick(slow, true);
    // Climbing from a bounce: fuel burns, nothing to brake yet (FOUND -- NOT FIXED in the audit, kept as is).
    expect(slow.jetpackActive).toBe(true);
    expect(slow.jetpackFuel).toBeCloseTo(4 - DT, 12);
    expect(slow.player.vy).toBeCloseTo(-300 + slow.physics.gravity * DT, 9);
  });

  it('a stomp ends it on the stomp step: bounce, kill, refill unchanged', () => {
    const m = fresh();
    m.enemies = [spawnEnemy('slime', 990, m.player.x, m.player.y + 26, 0, 0, 'open')];
    tick(m, true);
    const kill = m.events.find(e => e.type === 'kill');
    expect(kill).toBeDefined();
    expect(m.jetpackActive).toBe(false);
    expect([m.ammo, m.jetpackFuel, m.player.vy]).toEqual([m.stats.maxAmmo, 4, -m.stats.bounce]);
  });

  it('REST takes it down as it opens; the next SECTION opens with it down and the tank full', () => {
    const m = fresh();
    tick(m, true);
    expect(m.jetpackActive).toBe(true);
    const fuel = m.jetpackFuel;
    expect(m.completeSection()).toBe(true);
    expect([m.state, m.jetpackActive, m.jetpackFuel]).toEqual(['upgrade', false, fuel]);
    m.selectUpgrade(m.upgrades.choices[0].id); m.confirmUpgrade();
    expect([m.state, m.jetpackActive, m.jetpackFuel, m.ammo]).toEqual(['playing', false, 4, m.stats.maxAmmo]);
  });

  it('GAME OVER and GAME CLEAR take it down; a refused transition leaves a live hover alone', () => {
    const m = fresh();
    tick(m, true);
    m.player.invincible = 0; m.killInstantly('fall');
    expect([m.state, m.jetpackActive]).toEqual(['over', false]);
    const won = fresh(true);
    tick(won, true);
    expect(won.jetpackActive).toBe(true);
    expect(won.completeSection()).toBe(false);
    expect(won.jetpackActive).toBe(true);
    expect(won.clearBoss()).toBe(true);
    expect([won.state, won.jetpackActive]).toEqual(['clear', false]);
  });

  it('PAUSE: main.pause takes it down with `paused`, resume never raises it, a paused step leaves it down', () => {
    const pause = between(mainSource, 'function pause() {', '\n}');
    expect(pause).toContain('scene.model.paused = true; scene.model.jetpackActive = false;');
    expect(between(mainSource, 'function resume() {', '\n')).not.toContain('jetpackActive');
    expect(mainSource.split('jetpackActive').length - 1).toBe(1);
    const m = fresh();
    tick(m, true);
    m.paused = true; m.jetpackActive = false; // what pause() does
    const fuel = m.jetpackFuel;
    tick(m, true);
    expect([m.jetpackActive, m.jetpackFuel]).toEqual([false, fuel]);
    m.paused = false;
    tick(m, false);
    expect(m.jetpackActive).toBe(false);
    tick(m, true);
    expect(m.jetpackActive).toBe(true);
  });

  it('the scene draws nothing while the world is stopped or mid-reversal, even if handed a raised flag', () => {
    const draw = sceneBlock();
    const m = fresh();
    tick(m, true);
    expect(draw(m).fills).toHaveLength(12);
    m.paused = true;
    expect(m.jetpackActive).toBe(true);
    expect(draw(m).fills).toHaveLength(0);
    m.paused = false; m.abyssStage = 'inverting';
    expect(draw(m).fills).toHaveLength(0);
    m.abyssStage = 'none'; m.state = 'upgrade';
    expect(draw(m).fills).toHaveLength(0);
  });

  it('through the seal: down the step the reversal begins, dark through the hold, decided afresh in the fight', () => {
    const m = fresh();
    m.jumpToBoss();
    m.platforms = []; m.enemies = []; m.hazards = []; m.doodads = []; m.safeZones = []; m.caves = []; m.pickups = [];
    m.player.y = (m as unknown as { sealY: number }).sealY + 200 - 0.5; m.player.vy = 400; m.player.grounded = -1; m.ammo = 0; m.cameraY = m.player.y - 400;
    const events = tick(m, true);
    expect(events).toContain('gravityFlip');
    expect([m.abyssStage, m.jetpackActive]).toEqual(['inverting', false]);
    const draw = sceneBlock();
    const fuel = m.jetpackFuel;
    let steps = 0, flipped = -1;
    while (m.abyssStage === 'inverting' && steps < 400) {
      tick(m, true); steps++;
      if (flipped < 0 && m.gravitySign < 0) flipped = steps;
      expect(m.jetpackActive).toBe(false);
      expect(draw(m).fills).toHaveLength(0);
    }
    expect(m.abyssStage).toBe('fight');
    expect(flipped).toBeGreaterThan(0);
    expect(m.jetpackFuel).toBe(fuel);
    tick(m, true);
    expect(m.jetpackActive).toBe(true);
    const y = Math.round(m.player.y - m.cameraY);
    for (const f of draw(m).fills) expect(f.y + f.h).toBeLessThanOrEqual(y - 18);
  });

  it('every step of every trace run obeys the contract: lit exactly when the fuel branch ran and still applies', () => {
    for (const [name, run] of Object.entries(JETPACK_TRACE_SCENARIOS)) {
      let stale = 0, lost = 0, lit = 0;
      jetpackTrace(run, {
        observe(g, events) {
          const burned = events.some(e => e.type === 'jetpack');
          const valid = g.player.grounded === -1 && g.ammo <= 0 && g.running && g.abyssStage !== 'inverting';
          if (g.jetpackActive) lit++;
          if (g.jetpackActive && !(burned && valid)) stale++;
          if (!g.jetpackActive && burned && valid) lost++;
        },
      });
      expect({ name, stale, lost }).toEqual({ name, stale: 0, lost: 0 });
      if (run.held.includes('safetyJetpack')) expect(lit, name).toBeGreaterThan(0);
    }
  }, 120_000);
});
