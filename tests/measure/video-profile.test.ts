import { describe, it } from 'vitest';
import { GameModel } from '../../src/systems/GameModel';
import { WORLD, BALANCE, JUMP, WALL_JUMP } from '../../src/data/balance';
import { SPEED_PROFILES, SHAFT_WIDTH, inShaftWidths } from '../../src/data/speedProfiles';
import { GUN_MODULES, type GunModuleId } from '../../src/data/gunModules';
import { DOODAD_RULES } from '../../src/data/doodads';

const STEP = 1 / 120;
const seeded = (n: number) => () => { n = (n * 1103515245 + 12345) % 2147483648; return n / 2147483648; };
const PH = 30, ROW = 245;
const r2 = (v: number) => Math.round(v * 100) / 100;
const P = [SPEED_PROFILES.current, SPEED_PROFILES.video];

function rig(p: typeof P[number], seed = 9) {
  const g = new GameModel(false, seeded(seed));
  g.enemies = []; g.pickups = []; g.hazards = []; g.doodads = []; g.containers = []; g.safeZones = [];
  g.stats.gravity = p.gravity; g.stats.maxFallSpeed = p.maxFallSpeed; g.stats.moveSpeed = p.moveSpeed;
  g.player.x = 225; g.player.y = 400; g.player.vy = 0;
  return g;
}
const drop = (g: GameModel, dir = 0, firing = false) => {
  g.platforms = []; g.enemies = []; g.pickups = []; g.hazards = []; g.doodads = [];
  g.step(STEP, dir, firing);
};
function fallTime(p: typeof P[number], dist: number, fromTerminal = false) {
  const g = rig(p);
  if (fromTerminal) for (let i = 0; i < 600; i++) drop(g);
  const y0 = g.player.y; let t = 0;
  for (let i = 0; i < 8000 && g.player.y - y0 < dist; i++) { drop(g); t += STEP; }
  return t;
}
function traverse(p: typeof P[number], fraction: number) {
  const g = rig(p);
  g.player.x = 0; drop(g, -1);
  const e = g as unknown as { leftEdge: number; rightEdge: number };
  const x0 = g.player.x, dist = (e.rightEdge - e.leftEdge) * fraction;
  let t = 0;
  for (let i = 0; i < 8000 && g.player.x - x0 < dist - 0.01; i++) { drop(g, 1); t += STEP; }
  return t;
}
function timeToTerminal(p: typeof P[number]) {
  const g = rig(p); let t = 0;
  for (let i = 0; i < 8000; i++) { drop(g); t += STEP; if (g.player.vy >= p.maxFallSpeed - 0.01) return t; }
  return -1;
}

describe('VIDEO PROFILE', () => {
  it('speed comparison', () => {
    console.log(`REF shaft ${SHAFT_WIDTH}px | original measured: terminal 2.36 sw/s, accel 4.2 sw/s2, move 0.88-0.91 sw/s`);
    for (const p of P) {
      console.log(`${p.label.padEnd(7)} | gravity ${String(p.gravity).padStart(4)} (${r2(inShaftWidths(p.gravity))} sw/s2) | terminal ${String(p.maxFallSpeed).padStart(3)} (${r2(inShaftWidths(p.maxFallSpeed))} sw/s) | move ${String(p.moveSpeed).padStart(3)} (${r2(inShaftWidths(p.moveSpeed))} sw/s)`);
      console.log(`        | ${r2(p.maxFallSpeed / 60)}px/frame, ${r2(p.maxFallSpeed / 60 / PH)}H/frame | time to terminal ${r2(timeToTerminal(p))}s over ${r2(p.maxFallSpeed ** 2 / (2 * p.gravity))}px`);
      console.log(`        | shaft wall-to-wall ${r2(traverse(p, 1))}s, half ${r2(traverse(p, 0.5))}s | row ${ROW}px from rest ${r2(fallTime(p, ROW))}s, at terminal ${r2(fallTime(p, ROW, true))}s | 100m ${r2(fallTime(p, 2400))}s`);
    }
    const c = P[0], v = P[1];
    console.log(`DELTA terminal ${r2((v.maxFallSpeed / c.maxFallSpeed - 1) * 100)}% | move ${r2((v.moveSpeed / c.moveSpeed - 1) * 100)}% | shaft ${r2((1 - traverse(v, 1) / traverse(c, 1)) * 100)}% faster | row-from-rest ${r2((1 - fallTime(v, ROW) / fallTime(c, ROW)) * 100)}% | 100m ${r2((1 - fallTime(v, 2400) / fallTime(c, 2400)) * 100)}%`);
  });

  it('WHAT GRAVITY DRAGS WITH IT -- the locked-as-GOOD moves', () => {
    for (const p of P) {
      const jump = JUMP.impulse ** 2 / (2 * p.gravity);
      const air = 2 * JUMP.impulse / p.gravity;
      const wall = WALL_JUMP.impulse ** 2 / (2 * p.gravity);
      const stomp = BALANCE.bounce ** 2 / (2 * p.gravity);
      const doodad = (DOODAD_RULES as unknown as { bounce: number }).bounce ** 2 / (2 * p.gravity);
      console.log(`${p.label.padEnd(7)} | ground jump ${r2(jump)}px (${r2(jump / PH)}H) airtime ${r2(air)}s | wall jump ${r2(wall)}px | stomp ${r2(stomp)}px | doodad ${r2(doodad)}px | reach ${r2(p.moveSpeed * air)}px`);
    }
    console.log(`NOTE ground jump falls to ${r2((JUMP.impulse ** 2 / (2 * P[1].gravity)) / (JUMP.impulse ** 2 / (2 * P[0].gravity)) * 100)}% of its locked height with JUMP.impulse unchanged.`);
    console.log(`NOTE holding the SAME ARC at gravity ${P[1].gravity} needs JUMP.impulse ${P[1].jumpImpulseForSameArc} (from ${JUMP.impulse}). NOT applied -- JUMP.impulse is locked.`);
  });

  it('recoil effectiveness', () => {
    const one = (p: typeof P[number], id: GunModuleId) => {
      const g = rig(p); g.gun.equip(id); g.ammo = 99; g.cooldown = 0;
      g.player.vy = p.maxFallSpeed; g.shoot();
      return g.player.vy;
    };
    const mag = (p: typeof P[number]) => {
      const g = rig(p); g.player.vy = p.maxFallSpeed;
      for (let i = 0; i < 20; i++) drop(g);
      const y0 = g.player.y; let t = 0;
      for (let i = 0; i < 2000 && g.ammo > 0; i++) { drop(g, 0, true); t += STEP; }
      const free = (() => { const f = rig(p); f.player.vy = p.maxFallSpeed; for (let i = 0; i < 20; i++) drop(f); const y = f.player.y; for (let i = 0; i < Math.round(t / STEP); i++) drop(f); return f.player.y - y; })();
      return { pct: (1 - (g.player.y - y0) / free) * 100, t };
    };
    for (const p of P) {
      const m = one(p, 'machine'), l = one(p, 'laser'), s = one(p, 'shotgun');
      const mg = mag(p);
      console.log(`${p.label.padEnd(7)} | terminal ${p.maxFallSpeed} | MACHINE ->${r2(m)} (${r2((p.maxFallSpeed - m) / p.maxFallSpeed * 100)}% off) | LASER ->${r2(l)} (${r2((p.maxFallSpeed - l) / p.maxFallSpeed * 100)}%) | SHOTGUN ->${r2(s)} (${r2((p.maxFallSpeed - s) / p.maxFallSpeed * 100)}%) | MG magazine ${r2(mg.pct)}% slower over ${r2(mg.t)}s`);
    }
  });
});
