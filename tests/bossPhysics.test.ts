import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { BALANCE } from '../src/data/balance';
import { BOSS_PHYSICS, GRAVITY_DIRECTION } from '../src/data/bossPhysics';
import { atNimushi, fighting, intoTheAbyss, STEP, tick, shootEye, defeatNimushi } from './nimushi';
import { GUN_MODULES, type GunModuleId } from '../src/data/gunModules';

/**
 * NORMAL / BOSS PHYSICS ISOLATION.
 *
 * The contract is symmetric: normal physics moving must not move the fight, and boss physics moving
 * must not move the run. Before the split they were one set of numbers, and adopting the measured
 * speeds killed the player in the arena in 3.94 seconds -- a coupling bug, not a difficulty one.
 */
describe('separation', () => {
  it('the normal run uses the measured, playtest-approved values', () => {
    expect(BALANCE.gravity).toBe(1680);
    expect(BALANCE.maxFallSpeed).toBe(930);
    expect(BALANCE.moveSpeed).toBe(350);
    const g = new GameModel(false);
    expect(g.inBossMode).toBe(false);
    expect(g.physics.gravity).toBe(BALANCE.gravity);
    expect(g.physics.maxFallSpeed).toBe(BALANCE.maxFallSpeed);
    expect(g.physics.moveSpeed).toBe(BALANCE.moveSpeed);
  });

  it('the fight uses its own baseline, which is not the run\'s', () => {
    const g = atNimushi(2);
    expect(g.inBossMode).toBe(true);
    expect(g.physics).toBe(BOSS_PHYSICS);
    expect(g.physics.gravity).not.toBe(BALANCE.gravity);
    expect(g.physics.maxFallSpeed).not.toBe(BALANCE.maxFallSpeed);
    expect(g.physics.moveSpeed).not.toBe(BALANCE.moveSpeed);
  });

  it('entering THE ABYSS switches the context, before the inversion', () => {
    const g = new GameModel(false);
    expect(g.inBossMode).toBe(false);
    g.jumpToStage(4, 3);
    expect(g.inBossMode).toBe(false);
    (g as unknown as { startAbyss(): boolean }).startAbyss();
    // The staging room is already NIMUSHI's ground, and gravity has not turned over yet -- so the
    // switch is the ABYSS, not the flip.
    expect(g.abyssStage).toBe('staging');
    expect(g.inBossMode).toBe(true);
    expect(g.physics).toBe(BOSS_PHYSICS);
    expect(g.gravitySign).toBe(GRAVITY_DIRECTION.normal);
  });

  it('a new run is on normal physics with nothing to reset', () => {
    const fought = fighting(3);
    expect(fought.inBossMode).toBe(true);
    const fresh = new GameModel(false);
    expect(fresh.inBossMode).toBe(false);
    expect(fresh.physics.maxFallSpeed).toBe(BALANCE.maxFallSpeed);
    expect(fresh.gravitySign).toBe(GRAVITY_DIRECTION.normal);
    expect(fresh.abyssStage).toBe('none');
    expect(fresh.boss.enabled).toBe(false);
  });

  it('dying in the arena leaks nothing into the next run', () => {
    const g = fighting(4);
    for (let i = 0; i < 4; i++) { g.player.invincible = 0; g.hurt(); }
    expect(g.state).toBe('over');
    const next = new GameModel(false);
    expect(next.inBossMode).toBe(false);
    expect(next.physics.gravity).toBe(BALANCE.gravity);
    expect(next.gravitySign).toBe(GRAVITY_DIRECTION.normal);
    expect(next.stage.label).toBe('1-1');
    expect(next.enemies.filter(e => e.kind === 'nimushiClone' || e.kind === 'nimushiShade')).toHaveLength(0);
  });

  it('lab tuning moves the run and never the fight', () => {
    const g = new GameModel(true);            // practice, where tuning is allowed
    g.setPhysicsTuning({ gravity: 400, moveSpeed: 90, maxFallSpeed: 250, shotRecoil: 190, maxAmmo: 8 });
    expect(g.physics.gravity).toBe(400);
    expect(BOSS_PHYSICS.gravity).toBe(900);
    expect(BOSS_PHYSICS.maxFallSpeed).toBe(520);
    expect(BOSS_PHYSICS.moveSpeed).toBe(180);
  });

  it('the fight\'s numbers are not a rescaling of the run\'s', () => {
    // Rescaling by terminal ratio was considered and rejected: it would re-couple the two through a
    // constant and put the next fidelity change straight back into the arena.
    const ratio = BALANCE.maxFallSpeed / BOSS_PHYSICS.maxFallSpeed;
    expect(BOSS_PHYSICS.gravity * ratio).not.toBeCloseTo(BALANCE.gravity, 0);
  });
});

describe('gravity: direction and magnitude are independent', () => {
  it('runs down the shaft and up in the arena', () => {
    expect(new GameModel(false).gravitySign).toBe(GRAVITY_DIRECTION.normal);
    expect(atNimushi(5).gravitySign).toBe(GRAVITY_DIRECTION.boss);
    expect(GRAVITY_DIRECTION.normal).toBe(1);
    expect(GRAVITY_DIRECTION.boss).toBe(-1);
  });

  it('pulls at the mode\'s OWN magnitude, not the run\'s with a sign flipped', () => {
    const shaft = new GameModel(false);
    shaft.platforms = []; shaft.player.grounded = -1; shaft.player.vy = 0;
    shaft.step(STEP, 0, false);
    expect(shaft.player.vy).toBeCloseTo(BALANCE.gravity * STEP, 4);

    const arena = atNimushi(6);
    arena.player.grounded = -1; arena.player.vy = 0;
    arena.step(STEP, 0, false);
    // Upward (negative y) at the BOSS magnitude -- 900, not 1680.
    expect(arena.player.vy).toBeCloseTo(-BOSS_PHYSICS.gravity * STEP, 4);
    expect(Math.abs(arena.player.vy)).not.toBeCloseTo(BALANCE.gravity * STEP, 1);
  });

  it('caps the fall at the mode\'s own terminal', () => {
    const arena = atNimushi(7);
    arena.player.grounded = -1;
    tick(arena, 4);
    expect(Math.abs(arena.player.vy)).toBeLessThanOrEqual(BOSS_PHYSICS.maxFallSpeed + 0.001);
  });
});

describe('the fight works again', () => {
  it('a player who does nothing survives the opening of the fight', () => {
    // The coupling bug took all four hearts in 3.94s from an idle player. Doing nothing should still
    // eventually cost the run -- this is a boss -- but not before there is time to read the arena.
    const g = fighting(8);
    const hp0 = g.hp;
    tick(g, 3);
    expect(g.state).toBe('boss');
    expect(g.hp).toBeGreaterThan(0);
    expect(g.hp).toBeGreaterThanOrEqual(hp0 - 2);
  });

  it('the weak point is reachable and every one of the seven can damage it', () => {
    for (const id of Object.keys(GUN_MODULES) as GunModuleId[]) {
      const g = atNimushi(9);
      g.gun.equip(id);
      const before = g.boss.hp;
      shootEye(g, 1);
      expect({ id, damaged: g.boss.hp < before }).toEqual({ id, damaged: true });
    }
  });

  it('can still be won outright', () => {
    const g = fighting(10);
    expect(defeatNimushi(g)).toBe(true);
  });

  it('carries the run\'s upgrades and weapon into the arena unchanged', () => {
    const g = atNimushi(11);
    g.equipGunModule('laser', 'charge');
    expect(g.gun.module.id).toBe('laser');
    // Weapon identity is the run's; only the movement response is the mode's.
    expect(g.gun.module.recoil).toBe(GUN_MODULES.laser.recoil);
    expect(g.gun.module.projectileCount).toBe(GUN_MODULES.laser.projectileCount);
  });
});

describe('the staging room runs on boss physics too', () => {
  it('reaches the broken seal without normal-run speeds leaking in', () => {
    const g = new GameModel(false);
    g.jumpToStage(4, 3);
    (g as unknown as { startAbyss(): boolean }).startAbyss();
    expect(g.physics).toBe(BOSS_PHYSICS);
    intoTheAbyss(g);
    expect(g.abyssStage).not.toBe('staging');
    expect(g.physics).toBe(BOSS_PHYSICS);
  });
});
