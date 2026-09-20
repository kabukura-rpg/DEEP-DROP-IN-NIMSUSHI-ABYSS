import { describe, it } from 'vitest';
import { GameModel } from '../../src/systems/GameModel';
import { WORLD, BALANCE } from '../../src/data/balance';
import { GUN_MODULES, type GunModuleId } from '../../src/data/gunModules';

/**
 * SPEED MEASUREMENT + PLAYTEST CANDIDATES.
 *
 * Candidates change ONLY maxFallSpeed and moveSpeed. gravity stays 900 and air control stays 100%,
 * as instructed. No value here is claimed to be the original's -- these exist to be compared against
 * it by hand.
 */
const STEP = 1 / 120;
const seeded = (n: number) => () => { n = (n * 1103515245 + 12345) % 2147483648; return n / 2147483648; };
const PH = 30, PW = 22, SPAN = WORLD.width - WORLD.wall * 2;
const ROW = 245;                       // measured median gap between levels
const r2 = (v: number) => Math.round(v * 100) / 100;

const PROFILES = [
  { name: 'CURRENT', fall: 520, move: 180 },
  { name: 'FAST-A', fall: 640, move: 220 },
  { name: 'FAST-B', fall: 760, move: 260 },
  { name: 'FAST-C', fall: 900, move: 300 },
] as const;

function rig(fall: number, move: number) {
  const g = new GameModel(false, seeded(9));
  g.enemies = []; g.pickups = []; g.hazards = []; g.doodads = []; g.containers = []; g.safeZones = [];
  g.stats.maxFallSpeed = fall; g.stats.moveSpeed = move;
  g.player.x = 225; g.player.y = 400; g.player.vy = 0;
  return g;
}
const drop = (g: GameModel, dir = 0, firing = false) => {
  g.platforms = []; g.enemies = []; g.pickups = []; g.hazards = []; g.doodads = [];
  g.step(STEP, dir, firing);
};
/** Seconds to fall `dist` from rest, measured through the real loop. */
function fallTime(fall: number, dist: number) {
  const g = rig(fall, 180); const y0 = g.player.y; let t = 0;
  for (let i = 0; i < 4000 && g.player.y - y0 < dist; i++) { drop(g); t += STEP; }
  return t;
}
/** Seconds to fall `dist` having ALREADY reached terminal. */
function cruiseTime(fall: number, dist: number) {
  const g = rig(fall, 180);
  for (let i = 0; i < 400; i++) drop(g);        // settle at terminal
  const y0 = g.player.y; let t = 0;
  for (let i = 0; i < 4000 && g.player.y - y0 < dist; i++) { drop(g); t += STEP; }
  return t;
}
/**
 * Seconds to cross a given fraction of the shaft, wall to wall.
 *
 * The first version of this started the player at x=225 and asked for 394px of travel, which the
 * shaft walls make impossible -- every profile returned the 33.33s loop cap. Start at the left edge
 * and measure against the real playable span.
 */
function traverse(move: number, fraction: number) {
  const g = rig(520, move);
  g.player.x = 0;
  drop(g, -1);                                   // clamp to the left edge, whatever it is
  const x0 = g.player.x;
  const edges = g as unknown as { leftEdge: number; rightEdge: number };
  const dist = (edges.rightEdge - edges.leftEdge) * fraction;
  let t = 0;
  for (let i = 0; i < 4000 && g.player.x - x0 < dist - 0.01; i++) { drop(g, 1); t += STEP; }
  return t;
}

describe('A. CURRENT SPEED', () => {
  it('fall', () => {
    const f = BALANCE.maxFallSpeed;
    console.log(`FALL terminal ${f}px/s | ${r2(f / 60)}px/frame @60fps | ${r2(f / 60 / PH)} player-heights/frame`);
    console.log(`FALL time to terminal ${r2(f / BALANCE.gravity)}s over ${r2(f * f / (2 * BALANCE.gravity))}px`);
    console.log(`FALL 100m (${100 * WORLD.pixelsPerMeter}px) from rest: ${r2(fallTime(f, 100 * WORLD.pixelsPerMeter))}s`);
    console.log(`FALL one ${ROW}px row gap from rest: ${r2(fallTime(f, ROW))}s | already at terminal: ${r2(cruiseTime(f, ROW))}s`);
  });
  it('horizontal', () => {
    const m = BALANCE.moveSpeed;
    const e0 = rig(520, m) as unknown as { leftEdge: number; rightEdge: number };
    const playable = e0.rightEdge - e0.leftEdge;
    console.log(`MOVE ${m}px/s | playable span ${r2(playable)}px (shaft ${SPAN}px less the player's own width) | wall to wall ${r2(traverse(m, 1))}s | half ${r2(traverse(m, 0.5))}s`);
    console.log(`MOVE ${r2(m / PW)} player-widths/sec | 0.5s carries ${r2(m * 0.5)}px (${r2(m * 0.5 / SPAN * 100)}% of the shaft)`);
  });
});

describe('B. CANDIDATES', () => {
  it('table', () => {
    console.log('profile | fall | move | px/frame | H/frame | shaft trav | half | row from rest | row at term | 100m fall | W/sec');
    for (const p of PROFILES) {
      console.log(`${p.name.padEnd(7)} | ${String(p.fall).padStart(4)} | ${String(p.move).padStart(4)} | ${String(r2(p.fall / 60)).padStart(8)} | ${String(r2(p.fall / 60 / PH)).padStart(7)} | ${String(r2(traverse(p.move, 1))).padStart(10)}s | ${String(r2(traverse(p.move, 0.5))).padStart(4)}s | ${String(r2(fallTime(p.fall, ROW))).padStart(13)}s | ${String(r2(cruiseTime(p.fall, ROW))).padStart(11)}s | ${String(r2(fallTime(p.fall, 2400))).padStart(9)}s | ${r2(p.move / PW)}`);
    }
    console.log('deltas vs CURRENT:');
    const base = { row: fallTime(520, ROW), cruise: cruiseTime(520, ROW), trav: traverse(180, 1), m100: fallTime(520, 2400) };
    for (const p of PROFILES.slice(1)) {
      console.log(`  ${p.name}: row-from-rest ${r2((1 - fallTime(p.fall, ROW) / base.row) * 100)}% faster | row-at-terminal ${r2((1 - cruiseTime(p.fall, ROW) / base.cruise) * 100)}% | shaft ${r2((1 - traverse(p.move, 1) / base.trav) * 100)}% | 100m ${r2((1 - fallTime(p.fall, 2400) / base.m100) * 100)}%`);
    }
  });
});

describe('C. RECOIL INTERACTION', () => {
  it('what is left of a terminal fall after firing', () => {
    const shot = (fall: number, id: GunModuleId) => {
      const g = rig(fall, 180);
      g.gun.equip(id); g.ammo = 99; g.cooldown = 0;
      g.player.vy = fall;
      g.shoot();
      return g.player.vy;
    };
    const magazine = (fall: number) => {
      const g = rig(fall, 180);
      g.player.vy = fall;
      for (let i = 0; i < 20; i++) drop(g);
      const y0 = g.player.y; let t = 0;
      for (let i = 0; i < 1200 && g.ammo > 0; i++) { drop(g, 0, true); t += STEP; }
      const free = (() => { const f = rig(fall, 180); f.player.vy = fall; for (let i = 0; i < 20; i++) drop(f); const y = f.player.y; for (let i = 0; i < Math.round(t / STEP); i++) drop(f); return f.player.y - y; })();
      return (1 - (g.player.y - y0) / free) * 100;
    };
    console.log('profile | terminal | MACHINE 1 | LASER 1 | SHOTGUN 1 | brake as % of terminal (MG) | MG magazine');
    for (const p of PROFILES) {
      const mg = shot(p.fall, 'machine');
      console.log(`${p.name.padEnd(7)} | ${String(p.fall).padStart(8)} | ${String(r2(mg)).padStart(9)} | ${String(r2(shot(p.fall, 'laser'))).padStart(7)} | ${String(r2(shot(p.fall, 'shotgun'))).padStart(9)} | ${String(r2((p.fall - mg) / p.fall * 100)).padStart(26)}% | ${r2(magazine(p.fall))}% slower`);
    }
  });
});
