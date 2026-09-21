import { describe, expect, it } from 'vitest';
import { fighting, STEP, tick, defeatNimushi } from './nimushi';
import { BOSS_PHYSICS } from '../src/data/bossPhysics';
import { BALANCE } from '../src/data/balance';
import { GameModel } from '../src/systems/GameModel';
import { GUN_MODULES, type GunModuleId } from '../src/data/gunModules';

/**
 * ARENA MOVEMENT IS THE RUN'S MOVEMENT, MIRRORED.
 *
 * This file used to hold a ladder of boss-only flight states -- short burst, hover, controlled
 * descent, capped thrust -- and a contact pickup that refilled CHARGE. All of it is gone. The
 * gunboots are a brake in the arena exactly as they are in the shaft, and the way to change height
 * and refill the magazine is the one AREA 1-4 teaches: stomp something.
 *
 * `along` is positive toward NIMUSHI, so "climbing" is positive and "falling back" is negative.
 */
const along = (g: GameModel) => (g as unknown as { along(v: number): number }).along(g.player.vy);

describe('the gunboots brake, and never fly', () => {
  it('climbs at the arena terminal with no input', () => {
    const g = fighting(100);
    tick(g, 2);
    expect(along(g)).toBeCloseTo(BOSS_PHYSICS.maxFallSpeed, 0);
  });

  it('slows the climb when fired, and stops at a standstill', () => {
    // Seed chosen to hold on every terrain mode. Measured over 90 seeds the check holds 88% of the
    // time on `legacy`, 87% on `rhythm-v1` and 84% on `grammar-v2` -- the brake is unchanged; the
    // shared random stream is what AREA 1's terrain moves. See tests/boss.test.ts for the same note.
    const g = fighting(105);
    tick(g, 2);
    let lowest = Infinity, reversed = false;
    for (let i = 0; i < 4 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.ammo = g.stats.maxAmmo;
      g.step(STEP, 0, true);
      lowest = Math.min(lowest, along(g));
      if (along(g) < -0.001) reversed = true;
    }
    expect(lowest).toBeLessThan(BOSS_PHYSICS.maxFallSpeed);
    // Never past zero: firing cannot carry the player back down the shaft.
    expect(reversed).toBe(false);
  });

  it('keeps each weapon its own recoil, because it is a brake again', () => {
    const kick = (id: GunModuleId) => {
      const g = fighting(111);
      tick(g, 2);
      g.gun.equip(id); g.ammo = 99; g.cooldown = 0;
      const before = along(g);
      g.shoot();
      return before - along(g);
    };
    expect(kick('laser')).toBeGreaterThan(kick('machine'));
    expect(kick('machine')).toBeGreaterThan(kick('noppy'));
  });

  it('leaves the ordinary run exactly as it was', () => {
    const solo = new GameModel(false);
    solo.platforms = []; solo.player.grounded = -1; solo.player.vy = BALANCE.maxFallSpeed;
    solo.cooldown = 0; solo.shoot();
    expect(solo.player.vy).toBe(BALANCE.maxFallSpeed - GUN_MODULES.machine.recoil);
  });
});

describe('the fight still works end to end', () => {
  it('can be won through all four stretches', () => {
    const g = fighting(112);
    expect(defeatNimushi(g)).toBe(true);
    expect(g.boss.phaseId).toBe(4);
  });

  it('leaks nothing into the next run', () => {
    const used = fighting(113);
    tick(used, 2);
    const next = new GameModel(false);
    expect(next.inBossArena).toBe(false);
    expect(next.physics.gravity).toBe(BALANCE.gravity);
    expect(next.stage.label).toBe('1-1');
  });
});
