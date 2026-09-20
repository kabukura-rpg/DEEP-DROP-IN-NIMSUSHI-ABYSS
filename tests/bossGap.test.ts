import { describe, expect, it } from 'vitest';
import { atNimushi, fighting, pin, shootEye, STEP, tick, defeatNimushi } from './nimushi';
import { NIMUSHI, ATTACK_STATES } from '../src/data/nimushi';
import { BOSS_PHYSICS } from '../src/data/bossPhysics';
import { GUN_MODULES, type GunModuleId } from '../src/data/gunModules';

/**
 * PLAYER / NIMUSHI GAP CONTROLLER.
 *
 * NIMUSHI keeps a fighting distance by matching the player's pace along the pull, rather than
 * fleeing at a speed of its own. The old flat `ascentSpeed` of 150 against a player pulled in at up
 * to 520 shut the gap at 370px/s: an untouched fight reached `minGap` in 0.87s and put the player
 * inside the body at 2.28s. These tests hold the geometry that replaced it.
 */
const face = (g: ReturnType<typeof fighting>) => g.boss.reach(g.player.y);

describe('A. gravity alone does not feed the player to the body', () => {
  it('holds the gap through a fight nobody is playing', () => {
    const g = fighting(30);
    const start = face(g);
    let closest = start;
    for (let i = 0; i < 6 / STEP && g.state === 'boss'; i++) {
      g.step(STEP, 0, false);
      closest = Math.min(closest, face(g));
    }
    // The player reaches the arena's terminal speed within a second and stays there; the gap must
    // not follow them down.
    expect(Math.abs(g.player.vy)).toBeCloseTo(BOSS_PHYSICS.maxFallSpeed, 0);
    expect(closest).toBeGreaterThan(0);
    expect(closest).toBeGreaterThan(NIMUSHI.minGap * 0.5);
  });

  it('gives at least ten seconds before the body is even approached', () => {
    const g = fighting(31);
    let touched = -1;
    for (let i = 0; i < 12 / STEP && g.state === 'boss'; i++) {
      g.step(STEP, 0, false);
      if (touched < 0 && face(g) <= 0) touched = i * STEP;
    }
    expect(touched).toBe(-1);
  });
});

describe('B/C. the gap is stable under ordinary movement', () => {
  it('leaves the distance exactly where the player put it while both are falling', () => {
    const g = fighting(32);
    tick(g, 1.5);                                   // settle at the arena's terminal speed
    const before = face(g);
    tick(g, 2);
    // Inside the band NIMUSHI keeps pace and nothing else, so an unchanged input means an unchanged
    // gap -- drift here would mean the controller is chasing a setpoint it should not have.
    if (!(Object.values(ATTACK_STATES) as string[]).includes(g.boss.state)) {
      expect(Math.abs(face(g) - before)).toBeLessThan(40);
    }
    expect(face(g)).toBeGreaterThan(0);
  });

  it('recovers when the player is forced inside minGap', () => {
    const g = fighting(33);
    pin(g, 60);                                     // shoved far too close
    const start = face(g);
    for (let i = 0; i < 1.2 / STEP; i++) { g.player.vy = 0; g.step(STEP, 0, false); }
    expect(face(g)).toBeGreaterThan(start);
  });

  it('slows down when the player has fallen too far behind', () => {
    const g = fighting(34);
    pin(g, NIMUSHI.maxGap + 320);
    const start = face(g);
    for (let i = 0; i < 1.2 / STEP; i++) { g.player.vy = 0; g.step(STEP, 0, false); }
    expect(face(g)).toBeLessThan(start);
  });
});

describe('D. a weak-point hit buys room, and the loan is temporary', () => {
  it('opens the gap on a hit', () => {
    const g = fighting(35);
    tick(g, 1);
    pin(g, 300);
    g.player.vy = 0;
    const before = face(g);
    shootEye(g, 3);
    for (let i = 0; i < 12; i++) { g.player.vy = 0; g.step(STEP, 0, false); }
    expect(face(g)).toBeGreaterThan(before);
  });

  it('does not correct the extra room straight back away', () => {
    const g = fighting(43);
    tick(g, 1);
    pin(g, 300);
    g.player.vy = 0;
    const before = face(g);
    shootEye(g, 3);
    const opened = face(g);
    expect(opened).toBeGreaterThan(before);
    // The controller must not treat its own pushback as an error to fix. Inside the band it keeps
    // pace and nothing more, and `pushback` widens the far edge so the shove survives the decay.
    for (let i = 0; i < (NIMUSHI.pushbackDecay + 0.5) / STEP; i++) { g.player.vy = 0; g.step(STEP, 0, false); }
    expect(face(g)).toBeGreaterThan(before);
  });
});

/**
 * E. DISTANCE IS THE PLAYER'S TO MANAGE -- body contact is NOT a movement goal.
 *
 * An earlier acceptance asked that a player who deliberately chases NIMUSHI be able to reach the
 * body. That has been WITHDRAWN, and the reason is worth keeping: the player's speed toward NIMUSHI
 * is capped at the arena's terminal speed, so "charging" and "doing nothing" are the same motion.
 * The only way to make the body reachable by movement is `matchRatio < 1`, and that brings back the
 * bug this controller exists to fix -- passive ascent walking the player into the body, which is
 * what killed them in 2.28s.
 *
 * So the baseline is: full match, a deadband, eye-hit pushback that decays, and a pressure boundary
 * that is its own system. Body contact is a HAZARD that happens when an attack or a special
 * movement breaks the band, not somewhere the player steers.
 */
describe('E. distance is the player\'s to manage', () => {

  const closest = (seed: number, brake: boolean, seconds = 45) => {
    const g = fighting(seed);
    let min = Infinity, touched = false;
    for (let i = 0; i < seconds / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.ammo = g.stats.maxAmmo;
      g.step(STEP, 0, brake);
      const f = g.boss.reach(g.player.y);
      min = Math.min(min, f);
      if (f <= 0) touched = true;
    }
    return { min, touched };
  };

  it('lets a player who holds fire ride in close enough for the short-range modules', () => {
    for (const seed of [36, 40, 41]) {
      // `min` is measured to the FACE, so it is compared against weapon reach rather than against
      // `minGap`, which is a centre-to-centre figure and not the same quantity.
      const drift = closest(seed, false);
      expect({ seed, reachable: drift.min <= GUN_MODULES.shotgun.range }).toEqual({ seed, reachable: true });
      expect({ seed, clear: drift.min > 0 }).toEqual({ seed, clear: true });
    }
  });

  it('keeps a player who brakes measurably further out', () => {
    for (const seed of [36, 40, 41]) {
      // Measured at ~54px against ~16px. The brake is a real lever on distance, but it is not a
      // wall: NIMUSHI's attacks still walk the player in, and the floor is set by the correction.
      expect({ seed, further: closest(seed, true).min > closest(seed, false).min + 20 })
        .toEqual({ seed, further: true });
    }
  });

  it('never lets gravity alone deliver the player into the body', () => {
    for (const seed of [36, 40, 41]) {
      expect({ seed, touched: closest(seed, false).touched }).toEqual({ seed, touched: false });
    }
  });
});

describe('F/G/H. the rest of the fight is unchanged', () => {
  it('still requires climbing away from the pressure', () => {
    const g = fighting(37);
    const first = g.boss.slack;
    for (let i = 0; i < 6 / STEP && g.state === 'boss'; i++) { g.player.vy = 0; g.step(STEP, 0, false); }
    // Standing still spends the slack: the boundary is its own system and the gap controller has
    // not quietly made it harmless.
    expect(g.boss.slack).toBeLessThan(first);
  });

  it('keeps the weak point reachable for all seven modules', () => {
    for (const id of Object.keys(GUN_MODULES) as GunModuleId[]) {
      const g = atNimushi(38);
      g.gun.equip(id);
      const before = g.boss.hp;
      shootEye(g, 1);
      expect({ id, hit: g.boss.hp < before }).toEqual({ id, hit: true });
    }
  });

  it('can still be won, through all four stretches', () => {
    const g = fighting(39);
    expect(defeatNimushi(g)).toBe(true);
    expect(g.boss.phaseId).toBe(4);
  });
});

describe('the locked boss baseline', () => {
  it('matches the player exactly -- anything less re-opens the collapse', () => {
    // `matchRatio < 1` is the change that would make body contact reachable by movement, and it is
    // the change that brings back passive ascent walking the player into the body. Locked at 1.
    expect(NIMUSHI.matchRatio).toBe(1);
  });

  it('keeps the deadband, the decaying pushback and an independent boundary', () => {
    expect(NIMUSHI.minGap).toBeLessThan(NIMUSHI.maxGap);
    expect(NIMUSHI.pushPerHit).toBeGreaterThan(0);
    expect(NIMUSHI.pushbackDecay).toBeGreaterThan(0);
    // Station-keeping lapses while attacking; that is what lets an attack break the band at all.
    expect(NIMUSHI.attackFollow).toBeLessThan(1);
  });

  it('never lets ordinary movement reach the body, on any seed', () => {
    for (const seed of [90, 91, 92]) {
      const g = fighting(seed);
      let touched = false;
      for (let i = 0; i < 30 / STEP && g.state === 'boss'; i++) {
        g.player.invincible = 9;
        g.step(STEP, Math.sin(i / 80) > 0 ? 1 : -1, false);
        if (g.boss.reach(g.player.y) <= 0) touched = true;
      }
      expect({ seed, touched }).toEqual({ seed, touched: false });
    }
  });
});
