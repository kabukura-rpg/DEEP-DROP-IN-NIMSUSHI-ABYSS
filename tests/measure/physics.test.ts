import { describe, it } from 'vitest';
import { GameModel } from '../../src/systems/GameModel';
import { WORLD, BALANCE, JUMP, WALL_JUMP } from '../../src/data/balance';

/**
 * CORE PHYSICS MEASUREMENT HARNESS.
 *
 * Every number printed here is OBSERVED from a running GameModel, never computed from the
 * constants. That distinction is the whole point: arithmetic on `impulse` and `gravity` tells you
 * what the designer intended, while this tells you what the player actually gets once clamps,
 * grounded-frames, coyote grace and the fixed 1/120 step have had their say. When a measured value
 * and the arithmetic disagree, the measured one is the game.
 *
 * Units are DEEP DROP pixels and seconds. The player is 22x30px, the shaft 394px of open span
 * between 28px walls. Ratios are printed alongside so the ORIGINAL footage protocol (deliverable D)
 * can be compared against them without either side needing the other's pixel scale.
 */
const STEP = 1 / 120;
const seeded = (s: number) => () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
const PH = 30, PW = 22, SPAN = WORLD.width - WORLD.wall * 2;
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * A player genuinely standing on a real floor.
 *
 * The first attempt at this built a synthetic Platform object and measured an 8.85px jump, because
 * `jump()` refuses unless `player.grounded` names a platform the collision pass itself settled the
 * player onto -- a hand-made entry never earns that. So this uses the START_PLATFORM the model
 * already spawns on and asserts the landing rather than assuming it. A harness that measures the
 * fallback path and reports it as the jump is worse than no harness.
 */
function lab() {
  const g = new GameModel(false, seeded(9));
  for (let i = 0; i < 240 && g.player.grounded === -1; i++) g.step(STEP, 0, false);
  if (g.player.grounded === -1) throw new Error('harness: player never landed, measurement invalid');
  g.enemies = []; g.pickups = []; g.hazards = []; g.doodads = []; g.containers = [];
  return g;
}
/**
 * An endless empty shaft. Generation keeps laying floors under a descending camera, so the platform
 * list is cleared every frame -- otherwise a "free fall" measurement quietly becomes a fall onto
 * the first generated ledge, which is what the first run of this file actually measured.
 */
function shaft() {
  const g = new GameModel(false, seeded(9));
  g.enemies = []; g.pickups = []; g.hazards = []; g.doodads = []; g.containers = []; g.safeZones = [];
  g.player.x = 225; g.player.y = WORLD.startY; g.player.vy = 0;
  return g;
}
/** One step of an empty shaft: nothing to land on, nothing to touch. */
const fall = (g: GameModel, dir = 0, firing = false) => {
  g.platforms = []; g.enemies = []; g.pickups = []; g.hazards = []; g.doodads = [];
  g.step(STEP, dir, firing);
};

describe('core physics measurement', () => {
  it('ground jump', () => {
    for (const dir of [0, 1] as const) {
      const g = lab(); const y0 = g.player.y; const x0 = g.player.x;
      if (!g.jump()) throw new Error('harness: jump refused');
      // AIRTIME is the ballistic arc -- launch to back down at launch height -- NOT time to landing.
      // Where the player lands depends on what the generator put underneath, so "time to landing" is
      // a terrain figure dressed up as a physics one. The first run of this file reported 5s that
      // way, which was the loop cap on a player who had simply fallen off the start platform.
      let peak = y0, t = 0, apexT = 0;
      for (let i = 0; i < 600; i++) {
        g.platforms = []; g.step(STEP, dir, false); t += STEP;
        if (g.player.y < peak) { peak = g.player.y; apexT = t; }
        if (g.player.vy > 0 && g.player.y >= y0) break;
      }
      const rise = y0 - peak, dx = Math.abs(g.player.x - x0);
      console.log(`GROUND JUMP dir=${dir} | rise ${r2(rise)}px (${r2(rise / PH)} player-heights) | apex ${r2(apexT)}s | arc airtime ${r2(t)}s | horizontal reach ${r2(dx)}px (${r2(dx / SPAN * 100)}% of shaft, ${r2(dx / PW)} player-widths)`);
    }
  });

  it('free fall to terminal', () => {
    const g = shaft(); let t = 0, term = -1, termY = 0; const y0 = g.player.y;
    const trace: string[] = [];
    for (let i = 0; i < 2000; i++) {
      fall(g); t += STEP;
      if (i < 6 || i === 11 || i === 23 || i === 59) trace.push(`f${i + 1}=${r2(g.player.vy)}`);
      if (term < 0 && g.player.vy >= BALANCE.maxFallSpeed - 0.01) { term = t; termY = g.player.y - y0; }
    }
    console.log(`FREE FALL | vy by frame: ${trace.join(' ')} | terminal ${r2(g.player.vy)}px/s reached at ${r2(term)}s after ${r2(termY)}px (${r2(termY / PH)} player-heights)`);
    console.log(`FREE FALL | held ${r2(t)}s unobstructed, ends at vy ${r2(g.player.vy)} -- flat, so nothing interrupted it`);
    console.log(`FREE FALL | terminal per frame @60fps = ${r2(BALANCE.maxFallSpeed / 60)}px (${r2(BALANCE.maxFallSpeed / 60 / PH)} player-heights/frame)`);
  });

  it('wall jump', () => {
    for (const side of ['left', 'right'] as const) {
      const g = shaft();
      const into = side === 'left' ? -1 : 1;
      g.player.x = side === 'left' ? WORLD.wall + PW / 2 : WORLD.width - WORLD.wall - PW / 2;
      g.player.y = 300; g.player.vy = 120;
      for (let i = 0; i < 12; i++) fall(g, into);   // press into the wall
      const y0 = g.player.y, x0 = g.player.x;
      // wallJump()'s default argument calls wallJumpSide(0), and that always returns 0 because a
      // wall jump requires the player to be steering AWAY from the wall. Ask with the real input.
      if (!g.wallJump(g.wallJumpSide(-into))) throw new Error('harness: wall jump refused on ' + side);
      let peak = y0, t = 0, apexT = 0, hitWall = 0;
      for (let i = 0; i < 400; i++) {
        fall(g, -into); t += STEP;
        if (Math.abs(g.player.x - x0) > 0 && hitWall === 0 &&
            (g.player.x <= WORLD.wall + PW / 2 + 0.5 || g.player.x >= WORLD.width - WORLD.wall - PW / 2 - 0.5)) hitWall = t;
        if (g.player.y < peak) { peak = g.player.y; apexT = t; }
        if (g.player.vy > 0 && g.player.y > y0) break;
      }
      const rise = y0 - peak;
      const dx = Math.abs(g.player.x - x0);
      console.log(`WALL JUMP ${side} | rise ${r2(rise)}px (${r2(rise / PH)} heights) | apex ${r2(apexT)}s | back to start ${r2(t)}s | dx ${r2(dx)}px (${r2(dx / PW)} widths, ${r2(dx / SPAN * 100)}% of shaft)${hitWall ? ` | reached the far wall at ${r2(hitWall)}s -- dx is CLAMPED by the shaft, not the kick` : ''}`);
    }
  });

  it('gunboot recoil', () => {
    const g = shaft(); g.player.vy = BALANCE.maxFallSpeed;
    for (let i = 0; i < 20; i++) fall(g);
    const before = g.player.vy;
    fall(g, 0, true);
    console.log(`RECOIL | single shot at terminal: vy ${r2(before)} -> ${r2(g.player.vy)} (delta ${r2(g.player.vy - before)}px/s, ${r2(Math.abs(g.player.vy - before) / BALANCE.maxFallSpeed * 100)}% of terminal)`);
    // Fired FROM TERMINAL rather than from a standing start: the realistic case, since a player who
    // is shooting has usually been falling first.
    const term = shaft(); term.player.vy = BALANCE.maxFallSpeed;
    for (let i = 0; i < 20; i++) fall(term);
    const ty = term.player.y; let tt = 0;
    for (let i = 0; i < 1200 && term.ammo > 0; i++) { fall(term, 0, true); tt += STEP; }
    const tfree = (() => { const f = shaft(); f.player.vy = BALANCE.maxFallSpeed; for (let i = 0; i < 20; i++) fall(f); const y = f.player.y; for (let i = 0; i < Math.round(tt / STEP); i++) fall(f); return f.player.y - y; })();
    console.log(`RECOIL | from TERMINAL, magazine held: ${r2(tt)}s, fell ${r2(term.player.y - ty)}px vs ${r2(tfree)}px unfired (${r2((1 - (term.player.y - ty) / tfree) * 100)}% slower)`);

    // Held fire from a standing fall: how much of the drop does a full CHARGE actually buy?
    const h = shaft(); const hy = h.player.y; let ht = 0; const startAmmo = h.ammo;
    for (let i = 0; i < 1200 && h.ammo > 0; i++) { fall(h, 0, true); ht += STEP; }
    const free = (() => { const f = shaft(); const y = f.player.y; for (let i = 0; i < Math.round(ht / STEP); i++) fall(f); return f.player.y - y; })();
    const spent = h.player.y - hy;
    console.log(`RECOIL | ${startAmmo} CHARGE held down: ${r2(ht)}s of fire, fell ${r2(spent)}px vs ${r2(free)}px unfired -- a full magazine buys ${r2(free - spent)}px of held altitude (${r2((1 - spent / free) * 100)}% slower descent)`);
  });

  it('stomp bounce', () => {
    const g = shaft();
    const victim = { id: 1, kind: 'slime', x: 225, y: 420, width: 26, height: 22, hp: 1, vx: 0, vy: 0, alive: true, stompable: true } as never;
    g.platforms = []; g.enemies = [victim];
    g.player.y = 330; g.player.vy = 300;
    const y0 = g.player.y; let peak = 1e9, t = 0, apexT = 0, bounced = false;
    for (let i = 0; i < 400; i++) {
      g.platforms = []; g.step(STEP, 0, false); t += STEP;
      if (!bounced && g.player.vy < 0) { bounced = true; peak = g.player.y; }
      if (bounced) { if (g.player.y < peak) { peak = g.player.y; apexT = t; } if (g.player.vy > 0 && g.player.y > 420) break; }
    }
    console.log(`STOMP | bounce vy ${r2(BALANCE.bounce)} | rise after contact ${r2(420 - peak - PH)}px (${r2((420 - peak - PH) / PH)} heights) | apex ${r2(apexT)}s | connected=${bounced}`);
  });

  it('walk speed and air control', () => {
    const g = lab(); const x0 = g.player.x; let t = 0;
    for (let i = 0; i < 60; i++) { g.step(STEP, 1, false); t += STEP; }
    console.log(`WALK | ${r2((g.player.x - x0) / t)}px/s sustained | crosses the ${SPAN}px shaft in ${r2(SPAN / ((g.player.x - x0) / t))}s`);
    const a = shaft(); const ax = a.player.x; let at = 0;
    for (let i = 0; i < 60; i++) { fall(a, 1); at += STEP; }
    console.log(`AIR  | ${r2((a.player.x - ax) / at)}px/s while falling (air control = ${r2(((a.player.x - ax) / at) / BALANCE.moveSpeed * 100)}% of ground)`);
  });

  it('prints the constants these were produced from', () => {
    console.log(`CONSTANTS | gravity ${BALANCE.gravity} move ${BALANCE.moveSpeed} terminal ${BALANCE.maxFallSpeed} recoil ${BALANCE.shotRecoil} bounce ${BALANCE.bounce} jump ${JUMP.impulse} wall ${JSON.stringify(WALL_JUMP)} | player ${PW}x${PH} shaft ${SPAN} step ${STEP}`);
  });
});
