import { describe, expect, it } from 'vitest';
import { fighting, STEP, tick, defeatNimushi } from './nimushi';
import { BOSS_PHYSICS } from '../src/data/bossPhysics';
import { BALANCE } from '../src/data/balance';
import { GameModel } from '../src/systems/GameModel';
import { GUN_MODULES, type GunModuleId } from '../src/data/gunModules';

/**
 * TWO-AXIS AERIAL MOVEMENT IN THE ARENA.
 *
 * Human playtest: with no floor, the player had LEFT and RIGHT and nothing else, so a curtain of
 * tapioca could only be answered sideways. In the arena the gunboots become the vertical axis --
 * hold fire to slow the climb, hold longer to drive back down the shaft.
 *
 * `along` is positive toward NIMUSHI, so "ascending" is positive and "driving down" is negative.
 */
const along = (g: GameModel) => (g as unknown as { along(v: number): number }).along(g.player.vy);

/** Settle in the arena, then fire (or not) for a while and report the resulting pace. */
function drive(seed: number, seconds: number, firing: boolean) {
  const g = fighting(seed);
  tick(g, 2);
  g.player.invincible = 9;
  for (let i = 0; i < seconds / STEP && g.state === 'boss'; i++) {
    g.player.invincible = 9;
    g.ammo = g.stats.maxAmmo;                 // CHARGE economy is tested separately
    g.step(STEP, 0, firing);
  }
  return { g, pace: along(g) };
}

describe('D-H. the gunboots are the vertical axis', () => {
  it('D. no fire means climbing, at the arena terminal', () => {
    const { pace } = drive(100, 2, false);
    expect(pace).toBeCloseTo(BOSS_PHYSICS.maxFallSpeed, 0);
  });

  it('E. a short burst slows the climb', () => {
    const g = fighting(101);
    tick(g, 2);
    const before = along(g);
    g.ammo = g.stats.maxAmmo;
    g.step(STEP, 0, true);
    const after = along(g);
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);          // one shot slows, it does not reverse
  });

  it('F/G. holding fire passes through a hover and into controlled descent', () => {
    const g = fighting(102);
    tick(g, 2);
    let sawHover = false, sawDescent = false;
    for (let i = 0; i < 3 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.ammo = g.stats.maxAmmo;
      g.step(STEP, 0, true);
      const v = along(g);
      if (Math.abs(v) < 90) sawHover = true;
      if (v < -60) sawDescent = true;
    }
    expect(sawHover).toBe(true);
    expect(sawDescent).toBe(true);
  });

  it('G. the descent is capped, so it is a dodge and not an escape', () => {
    const { pace } = drive(103, 6, true);
    expect(pace).toBeGreaterThanOrEqual(-BOSS_PHYSICS.maxThrust - 0.001);
  });

  it('H. releasing returns the player to climbing', () => {
    const g = fighting(104);
    tick(g, 2);
    for (let i = 0; i < 2 / STEP; i++) { g.player.invincible = 9; g.ammo = g.stats.maxAmmo; g.step(STEP, 0, true); }
    expect(along(g)).toBeLessThan(0);
    for (let i = 0; i < 2 / STEP; i++) { g.player.invincible = 9; g.step(STEP, 0, false); }
    expect(along(g)).toBeGreaterThan(0);
  });

  it('I. steering and thrusting work at the same time', () => {
    const g = fighting(105);
    tick(g, 2);
    const x0 = g.player.x;
    for (let i = 0; i < 1 / STEP; i++) { g.player.invincible = 9; g.ammo = g.stats.maxAmmo; g.step(STEP, 1, true); }
    expect(g.player.x).toBeGreaterThan(x0);
    expect(along(g)).toBeLessThan(BOSS_PHYSICS.maxFallSpeed);
  });

  it('J. the vertical axis really moves the player through the arena', () => {
    const climbed = drive(106, 2.5, false);
    const thrust = drive(106, 2.5, true);
    // Two different places in the shaft after the same time: that is what a dodge route is.
    const gap = (m: GameModel) => m.boss.reach(m.player.y);
    expect(gap(thrust.g)).toBeGreaterThan(gap(climbed.g) + 100);
  });
});

describe('K. the boundary cannot be outrun', () => {
  it('catches a player who thrusts down forever', () => {
    const g = fighting(107);
    tick(g, 2);
    const first = g.boss.slack;
    for (let i = 0; i < 20 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.ammo = g.stats.maxAmmo;                // even with infinite CHARGE
      g.step(STEP, 0, true);
    }
    expect(g.boss.slack).toBeLessThan(first);
  });

  it('runs out of CHARGE on its own without an orb', () => {
    const g = fighting(108);
    tick(g, 2);
    for (let i = 0; i < 4 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.containers = [];                       // no orbs to collect
      g.step(STEP, 0, true);
    }
    expect(g.ammo).toBe(0);
    expect(along(g)).toBeGreaterThan(0);       // and the climb resumes
  });
});

describe('A-C. the CHARGE loop closes', () => {
  it('A. an empty magazine can be refilled by flying into an orb', () => {
    const g = fighting(109);
    tick(g, 3);
    const orb = g.containers.find(c => c.charge && !c.broken);
    expect(orb).toBeDefined();
    g.ammo = 0;
    g.player.x = orb!.x + orb!.width / 2;
    g.player.y = orb!.y + orb!.height / 2;
    g.step(STEP, 0, false);
    expect(g.ammo).toBe(g.stats.maxAmmo);
  });

  it('B/C. collecting one neither grounds the player nor stops the fall', () => {
    const g = fighting(110);
    tick(g, 3);
    const orb = g.containers.find(c => c.charge && !c.broken);
    g.ammo = 0;
    g.player.x = orb!.x + orb!.width / 2;
    g.player.y = orb!.y + orb!.height / 2;
    g.step(STEP, 0, false);
    expect(g.player.grounded).toBe(-1);
    expect(g.player.vy).not.toBe(0);
  });
});

describe('L-N. nothing else moved', () => {
  it('L. every weapon keeps its own recoil identity in the arena', () => {
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
    expect(kick('shotgun')).toBeGreaterThan(kick('puncher'));
  });

  it('L. the ordinary run still has a brake and not a thruster', () => {
    const g = new GameModel(false);
    g.platforms = []; g.player.grounded = -1; g.player.vy = 0; g.ammo = 99;
    for (let i = 0; i < 200; i++) { g.platforms = []; g.step(STEP, 0, true); }
    // Never climbs, and the kick is the module's own -- unmultiplied.
    expect(g.player.vy).toBeGreaterThanOrEqual(0);
    const solo = new GameModel(false);
    solo.platforms = []; solo.player.grounded = -1; solo.player.vy = BALANCE.maxFallSpeed;
    solo.cooldown = 0; solo.shoot();
    expect(solo.player.vy).toBe(BALANCE.maxFallSpeed - GUN_MODULES.machine.recoil);
  });

  it('M. the fight can still be won through all four stretches', () => {
    const g = fighting(112);
    expect(defeatNimushi(g)).toBe(true);
    expect(g.boss.phaseId).toBe(4);
  });

  it('N. nothing leaks into the next run', () => {
    const used = fighting(113);
    tick(used, 2);
    const next = new GameModel(false);
    expect(next.inBossArena).toBe(false);
    expect(next.inBossMode).toBe(false);
    expect(next.physics.gravity).toBe(BALANCE.gravity);
    expect(next.stage.label).toBe('1-1');
  });
});
