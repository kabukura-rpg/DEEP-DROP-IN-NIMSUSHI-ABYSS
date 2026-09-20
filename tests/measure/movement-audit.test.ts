import { describe, it } from 'vitest';
import { GameModel } from '../../src/systems/GameModel';
import { WORLD, BALANCE, JUMP, WALL_JUMP } from '../../src/data/balance';
import { GUN_MODULES } from '../../src/data/gunModules';

const STEP = 1 / 120;
const seeded = (s: number) => () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
const PH = 30, PW = 22, SPAN = WORLD.width - WORLD.wall * 2;
const r2 = (v: number) => Math.round(v * 100) / 100;

function lab() {
  const g = new GameModel(false, seeded(9));
  for (let i = 0; i < 240 && g.player.grounded === -1; i++) g.step(STEP, 0, false);
  g.enemies = []; g.pickups = []; g.hazards = []; g.doodads = []; g.containers = [];
  return g;
}
function shaft() {
  const g = new GameModel(false, seeded(9));
  g.enemies = []; g.pickups = []; g.hazards = []; g.doodads = []; g.containers = []; g.safeZones = [];
  g.player.x = 225; g.player.y = 400; g.player.vy = 0;
  return g;
}
const fall = (g: GameModel, dir = 0, firing = false) => {
  g.platforms = []; g.enemies = []; g.pickups = []; g.hazards = []; g.doodads = [];
  g.step(STEP, dir, firing);
};

describe('MOVEMENT AUDIT', () => {
  it('2. WALL JUMP -- what actually gates it today', () => {
    // Can it be performed at all, from a plain fall against a wall?
    const a = shaft(); a.player.x = WORLD.wall + PW / 2; a.player.vy = 200;
    for (let i = 0; i < 12; i++) fall(a, -1);
    console.log(`WJ can-perform: plain wall contact + away input -> ${a.wallJump(a.wallJumpSide(1)) ? 'SUCCEEDS' : 'REFUSED'}`);

    // Is any airborne "rolling" state required?
    const b = shaft(); b.player.x = WORLD.wall + PW / 2; b.player.vy = 0;   // not rolling, barely moving
    for (let i = 0; i < 12; i++) fall(b, -1);
    console.log(`WJ rolling-state required: ${b.wallJump(b.wallJumpSide(1)) ? 'NO -- fires with no roll state at all' : 'yes'}`);

    // Same wall twice without a reset?
    const c = shaft(); c.player.x = WORLD.wall + PW / 2; c.player.vy = 200;
    for (let i = 0; i < 12; i++) fall(c, -1);
    c.wallJump(c.wallJumpSide(1));
    for (let i = 0; i < 12; i++) fall(c, -1);
    console.log(`WJ same wall twice, no reset: ${c.wallJump(c.wallJumpSide(1)) ? 'ALLOWED' : 'refused'}`);

    // Alternating walls: can the shaft be CLIMBED without ever landing?
    const d = shaft(); d.player.x = WORLD.wall + PW / 2; d.player.y = 600; d.player.vy = 0;
    const y0 = d.player.y; let jumps = 0, best = y0;
    for (let i = 0; i < 2400; i++) {
      const toward = d.player.x < WORLD.width / 2 ? -1 : 1;
      fall(d, toward);
      const side = d.wallJumpSide(-toward);
      if (side !== 0 && d.wallJump(side)) jumps++;
      best = Math.min(best, d.player.y);
    }
    console.log(`WJ alternating-wall chain: ${jumps} jumps in 20s, net ${r2(y0 - d.player.y)}px, best ${r2(y0 - best)}px above start -> ${y0 - best > PH * 2 ? 'CLIMBS THE SHAFT' : 'no climb'}`);

    // CHARGE cost?
    const e = shaft(); e.player.x = WORLD.wall + PW / 2; e.player.vy = 200;
    for (let i = 0; i < 12; i++) fall(e, -1);
    const ammo0 = e.ammo; e.wallJump(e.wallJumpSide(1));
    console.log(`WJ charge cost: ${ammo0} -> ${e.ammo} (${ammo0 === e.ammo ? 'free, correct' : 'COSTS CHARGE'})`);
  });

  it('3. RECOIL -- the extra-height bug, measured', () => {
    // Jump alone.
    const a = lab(); const y0 = a.player.y; a.jump();
    let peakAlone = y0;
    for (let i = 0; i < 300; i++) { a.platforms = []; a.step(STEP, 0, false); peakAlone = Math.min(peakAlone, a.player.y); if (a.player.vy > 0 && a.player.y >= y0) break; }

    // Jump then hold fire.
    const b = lab(); b.jump();
    let peakFiring = y0;
    for (let i = 0; i < 300; i++) { b.platforms = []; b.step(STEP, 0, true); peakFiring = Math.min(peakFiring, b.player.y); if (b.player.vy > 0 && b.player.y >= y0) break; }

    console.log(`RECOIL jump-only peak ${r2(y0 - peakAlone)}px | jump+MG peak ${r2(y0 - peakFiring)}px | EXTRA ${r2(peakAlone - peakFiring)}px (${r2((peakAlone - peakFiring) / PH)} player-heights)`);

    // Every module: does firing after a jump beat the jump?
    console.log('RECOIL per module -- jump-only vs jump+fire peak:');
    for (const id of Object.keys(GUN_MODULES) as (keyof typeof GUN_MODULES)[]) {
      const g = lab(); g.equipGunModule(id as never, 'charge'); g.ammo = 99;
      const gy = g.player.y; g.jump(); let pk = gy;
      for (let i = 0; i < 300; i++) { g.platforms = []; g.step(STEP, 0, true); pk = Math.min(pk, g.player.y); if (g.player.vy > 0 && g.player.y >= gy) break; }
      const def = GUN_MODULES[id];
      console.log(`  ${String(id).padEnd(8)} recoil ${String(def.recoil).padStart(3)} | peak ${String(r2(gy - pk)).padStart(7)}px | extra over jump-only ${r2((gy - pk) - (y0 - peakAlone))}px`);
    }

    // Is it SUSTAINED climbing, or a one-off?
    const c = shaft(); c.ammo = 999; const cy = c.player.y;
    for (let i = 0; i < 600; i++) fall(c, 0, true);
    const net = c.player.y - cy;
    console.log(`RECOIL unlimited ammo, 5s of fire from rest: net ${r2(Math.abs(net))}px ${net < 0 ? 'UP' : 'DOWN'} -> ${net < 0 ? 'SUSTAINED UPWARD TRAVEL' : 'no sustained climb'}`);
  });

  it('5. SPEED FEEL -- where the time actually goes', () => {
    console.log(`SPEED gravity ${BALANCE.gravity}px/s2 | terminal ${BALANCE.maxFallSpeed}px/s (${r2(BALANCE.maxFallSpeed / 60)}px/frame, ${r2(BALANCE.maxFallSpeed / 60 / PH)}H/frame)`);
    const g = shaft(); let t = 0; const y0 = g.player.y;
    let tTerm = 0; for (let i = 0; i < 400; i++) { fall(g); t += STEP; if (!tTerm && g.player.vy >= BALANCE.maxFallSpeed - 0.01) tTerm = t; }
    console.log(`SPEED time to terminal ${r2(tTerm)}s | distance ${r2(BALANCE.maxFallSpeed * BALANCE.maxFallSpeed / (2 * BALANCE.gravity))}px`);
    console.log(`SPEED move ${BALANCE.moveSpeed}px/s, air control 100% | shaft crossing ${r2(SPAN / BALANCE.moveSpeed)}s`);
    console.log(`SPEED jump arc 0.72s -- during which descent is SUSPENDED`);
    // How long does a magazine hold the player up?
    const h = shaft(); h.player.vy = BALANCE.maxFallSpeed; for (let i = 0; i < 20; i++) fall(h);
    let brake = 0; for (let i = 0; i < 1200 && h.ammo > 0; i++) { fall(h, 0, true); brake += STEP; }
    console.log(`SPEED one magazine brakes for ${r2(brake)}s`);
    // Section descent time at terminal vs measured row spacing.
    console.log(`SPEED a 240m SECTION at terminal = ${r2(240 * WORLD.pixelsPerMeter / BALANCE.maxFallSpeed)}s of pure falling; median row gap 245px = ${r2(245 / BALANCE.maxFallSpeed)}s between rows`);
  });

  it('4. GROUND JUMP -- candidate table', () => {
    // Each candidate is MEASURED, not derived: the jump is performed through the real model and the
    // launch velocity overridden, so the arc goes through the same 1/120 step and the same clamps
    // the shipped jump does. Arithmetic and measurement differ by ~1.4px at this impulse.
    const run = (impulse: number, dir: 0 | 1) => {
      const g = lab();
      g.jump();
      g.player.vy = -impulse;
      const y0 = g.player.y, x0 = g.player.x;
      let peak = y0, t = 0;
      for (let k = 0; k < 600; k++) {
        g.platforms = []; g.enemies = []; g.doodads = [];
        g.step(STEP, dir, false); t += STEP;
        peak = Math.min(peak, g.player.y);
        if (g.player.vy > 0 && g.player.y >= y0) break;
      }
      return { rise: y0 - peak, air: t, dx: Math.abs(g.player.x - x0) };
    };
    console.log('cand     | impulse | peak px | peak /H | airtime | h-reach px | /shaft | vs CURRENT');
    const base = run(JUMP.impulse, 0).rise;
    for (const [name, imp] of [['CURRENT', JUMP.impulse], ['HIGH', 280], ['MID', 240], ['LOW', 200]] as const) {
      const v = run(imp, 0), h = run(imp, 1);
      console.log(`${name.padEnd(8)} | ${String(imp).padStart(7)} | ${String(r2(v.rise)).padStart(7)} | ${String(r2(v.rise / PH)).padStart(7)} | ${String(r2(v.air)).padStart(6)}s | ${String(r2(h.dx)).padStart(10)} | ${String(r2(h.dx / SPAN * 100)).padStart(5)}% | ${name === 'CURRENT' ? '--' : r2((v.rise / base - 1) * 100) + '%'}`);
    }
    console.log(`(player ${PW}x${PH}px, shaft ${SPAN}px, median row gap 245px, stomp bounce ${r2(BALANCE.bounce ** 2 / (2 * BALANCE.gravity))}px, wall jump ${r2(WALL_JUMP.impulse ** 2 / (2 * BALANCE.gravity))}px)`);
  });
});
