import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { BALANCE } from '../src/data/balance';
import { BOSS_GUNBOOTS, BOSS_PHYSICS, GRAVITY_DIRECTION } from '../src/data/bossPhysics';
import { atNimushi, fighting, intoTheAbyss, STEP, tick, shootEye, defeatNimushi } from './nimushi';
import { GUN_MODULES, GUN_MODULE_IDS, STARTING_GUN_MODULE, type GunModuleId } from '../src/data/gunModules';
import { enterBossTest } from '../src/dev/bossTest';
import { NIMUSHI, FINAL_RAGE_RATIO } from '../src/data/nimushi';

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

  it('entering THE ABYSS switches the context, but the physics only at the inversion', () => {
    const g = new GameModel(false);
    expect(g.inBossMode).toBe(false);
    g.jumpToStage(4, 3);
    expect(g.inBossMode).toBe(false);
    (g as unknown as { startAbyss(): boolean }).startAbyss();
    // The staging room is THE ABYSS, but it is an ordinary descent: the run's own physics, gravity
    // still pointing down. NIMUSHI's numbers arrive with the reversal.
    expect(g.abyssStage).toBe('staging');
    expect(g.inBossMode).toBe(true);
    expect(g.bossPhysicsActive).toBe(false);
    expect(g.physics).toBe(g.stats);
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

describe('the staging room runs on the run\'s physics; the reversal hands over to the fight\'s', () => {
  const staging = () => {
    const g = new GameModel(false);
    g.jumpToStage(4, 3);
    (g as unknown as { startAbyss(): boolean }).startAbyss();
    return g;
  };
  const section = () => {
    const g = new GameModel(false);
    g.jumpToStage(4, 3);
    return g;
  };
  const intervalOf = (g: GameModel) =>
    (g as unknown as { fireIntervalOf(def: { id: string; fireInterval: number }): number }).fireIntervalOf(g.gun.module);
  /** Open air: nothing to land on, stomp or be hurt by, so only the physics under test acts. */
  const openAir = (g: GameModel) => {
    g.platforms = []; g.enemies = []; g.hazards = []; g.doodads = []; g.containers = [];
    g.safeZones = []; g.caves = []; g.pickups = []; g.exit = null; g.player.invincible = 5;
  };
  /** Falls to terminal speed, then fires one MACHINE round from a full magazine: velocity it took off. */
  const oneShotKick = (g: GameModel) => {
    openAir(g);
    const p = g.player;
    p.x = 225; p.y = g.cameraY + 200; p.vy = 0; p.grounded = -1;
    for (let i = 0; i < 1 / STEP; i++) { g.step(STEP, 0, false); openAir(g); }
    expect(Math.abs(p.vy)).toBe(g.physics.maxFallSpeed);
    g.ammo = g.stats.maxAmmo; (g as unknown as { lastAirShot: number }).lastAirShot = -Infinity;
    const before = p.vy * g.gravitySign;
    g.step(STEP, 0, true);
    return before - p.vy * g.gravitySign;
  };
  /** Holds RIGHT for one second in the air from the left edge of the shaft: pixels covered. */
  const oneSecondRight = (g: GameModel) => {
    openAir(g);
    const p = g.player;
    p.x = 40; p.y = g.cameraY + 300; p.grounded = -1;
    for (let i = 0; i < 1 / STEP; i++) { p.vy = 0; g.step(STEP, 1, false); openAir(g); }
    return p.x - 40;
  };

  it('uses the normal values in the staging room', () => {
    const g = staging();
    expect(g.abyssStage).toBe('staging');
    expect(g.physics).toBe(g.stats);
    expect(g.physics.moveSpeed).toBe(350);
    expect(g.physics.gravity).toBe(1680);
    expect(g.physics.maxFallSpeed).toBe(930);
    expect(intervalOf(g)).toBe(GUN_MODULES.machine.fireInterval);
    expect(intervalOf(g)).toBe(0.10);
  });

  it('moves, falls and kicks exactly as a 4-3 SECTION does', () => {
    expect(oneSecondRight(staging())).toBeCloseTo(oneSecondRight(section()), 5);
    expect(oneSecondRight(staging())).toBeCloseTo(350, 5);
    const kick = oneShotKick(staging());
    expect(kick).toBeCloseTo(oneShotKick(section()), 5);
    expect(kick).toBeCloseTo(BALANCE.shotRecoil * (GUN_MODULES.machine.recoil / BALANCE.shotRecoil), 5);
  });

  it('switches to BOSS physics the moment the world starts to turn over', () => {
    const g = staging();
    intoTheAbyss(g);
    expect(g.abyssStage).toBe('inverting');
    expect(g.bossPhysicsActive).toBe(true);
    expect(g.physics).toBe(BOSS_PHYSICS);
    expect(intervalOf(g)).toBe(BOSS_GUNBOOTS.machineInterval);
  });

  it('keeps the fight\'s own numbers in the arena: BOSS_PHYSICS, the old interval and the old recoil', () => {
    expect(BOSS_PHYSICS).toEqual({ gravity: 900, maxFallSpeed: 520, moveSpeed: 180 });
    expect(BOSS_GUNBOOTS).toEqual({ machineInterval: 0.16, recoilScale: 190 / 510 });
    const g = fighting(12);
    expect(g.abyssStage).toBe('fight');
    expect(g.physics).toBe(BOSS_PHYSICS);
    expect(intervalOf(g)).toBe(0.16);
    expect(oneShotKick(g)).toBeCloseTo(GUN_MODULES.machine.recoil * BOSS_GUNBOOTS.recoilScale, 5);
  });

  it('keeps the TOMATO room free of TIMEVOID on normal physics, and the SHOP room stopped', () => {
    const g = staging();
    const zone = g.safeZones[0];
    expect(zone.stopsTime).toBe(false);
    g.player.x = zone.x + 30; g.player.y = zone.y + zone.height - 20; g.player.vy = 0;
    g.step(STEP, 0, false);
    expect(g.safeZone).toBe(zone);
    expect(g.timeFrozen).toBe(false);
    const shop = new GameModel(false);
    shop.safeZoneVisitCount = 1;
    shop.jumpToBoss();
    const room = shop.safeZones[0];
    shop.player.x = room.x + 30; shop.player.y = room.y + room.height - 20; shop.player.vy = 0;
    shop.step(STEP, 0, false);
    expect(shop.timeFrozen).toBe(true);
  });
});

/**
 * The BOSS TEST shortcut. A development-only playtest utility, pinned here so its guarantees hold --
 * it is NOT an acceptance test for the fight, and it does not stand in for the browser check that
 * still walks 4-3 -> FINAL REST -> NEXT -> THE ABYSS -> seal -> reversal end to end.
 */
describe('BOSS TEST shortcut', () => {
  const fresh = () => new GameModel(false);

  it('starts the fight in a realistic clean run state', () => {
    const g = fresh();
    const report = enterBossTest(g, 'phase1');
    expect(g.state).toBe('boss');
    expect(g.abyssStage).toBe('fight');
    expect(g.gravitySign).toBe(GRAVITY_DIRECTION.boss);
    expect(g.physics).toBe(BOSS_PHYSICS);
    expect(g.hp).toBe(g.stats.maxHp);
    expect(g.ammo).toBe(g.stats.maxAmmo);
    expect(g.gun.module.id).toBe('machine');
    expect(g.upgrades.acquired).toEqual([]);
    expect(g.boss.hp).toBe(NIMUSHI.maxHp);
    expect(g.boss.defeated).toBe(false);
    expect(g.bossTime).toBeLessThan(0.001);
    expect(report).toContain('BOSS TEST -> phase1');
  });

  it('puts each stretch shortcut in that stretch, at that HP', () => {
    for (const [target, phase, ratio] of [['phase2', 2, 0.75], ['phase3', 3, 0.5], ['phase4', 4, 0.25]] as const) {
      const g = fresh();
      enterBossTest(g, target);
      expect({ target, phase: g.boss.phaseId }).toEqual({ target, phase });
      expect(g.boss.hp).toBe(Math.round(NIMUSHI.maxHp * ratio));
    }
  });

  it('puts RAGE inside its trigger rather than one hit away from it', () => {
    const g = fresh();
    enterBossTest(g, 'rage');
    expect(g.boss.hp / NIMUSHI.maxHp).toBeLessThan(FINAL_RAGE_RATIO);
    expect(g.boss.phaseId).toBe(4);
  });

  it('rejects an unknown target instead of starting something', () => {
    const g = fresh();
    const before = g.state;
    expect(enterBossTest(g, 'phase9' as never)).toContain('unknown target');
    expect(g.state).toBe(before);
  });

  /**
   * The starting weapon. A LOADOUT fixture, so a tester can ask "is SHOTGUN usable against NIMUSHI"
   * without playing twelve SECTIONs hoping the right crate turns up.
   *
   * It swaps through the game's own `equip` -- the same call a GUN MODULE crate makes -- so what
   * the fight shows is the weapon as it ships. Nothing about its stats is touched here, and that
   * is the point: the question being asked is whether those stats work at this range.
   */
  it('starts the fight holding any of the seven weapons, at full CHARGE', () => {
    for (const id of GUN_MODULE_IDS) {
      const g = fresh();
      const report = enterBossTest(g, { weapon: id });
      expect(g.gun.module.id).toBe(id);
      expect(g.ammo).toBe(g.stats.maxAmmo);
      expect(g.state).toBe('boss');
      expect(report).toContain(GUN_MODULES[id].name);
      // A loadout and nothing else: the fight itself is the ordinary one.
      expect(g.boss.hp).toBe(NIMUSHI.maxHp);
      expect(g.hp).toBe(g.stats.maxHp);
      expect(g.upgrades.acquired).toEqual([]);
    }
  });

  it('takes the id, the name or the HUD short, in any case', () => {
    for (const [asked, id] of [['SHOTGUN', 'shotgun'], ['shotgun', 'shotgun'], ['SHOT', 'shotgun'],
      ['PUNCHER', 'puncher'], ['PUNCH', 'puncher'], ['MACHINE', 'machine'],
      ['machine gun', 'machine'], ['MG', 'machine'], ['Triple', 'triple']] as const) {
      const g = fresh();
      enterBossTest(g, { weapon: asked });
      expect({ asked, got: g.gun.module.id }).toEqual({ asked, got: id });
    }
  });

  it('keeps the stretch shortcut and the weapon independent', () => {
    const g = fresh();
    enterBossTest(g, { target: 'phase4', weapon: 'PUNCHER' });
    expect(g.boss.phaseId).toBe(4);
    expect(g.gun.module.id).toBe('puncher');
  });

  it('defaults to what a real run reaches NIMUSHI holding', () => {
    const g = fresh();
    enterBossTest(g, 'phase1');
    expect(g.gun.module.id).toBe(STARTING_GUN_MODULE);
    // ...and the report only mentions a weapon when one was asked for.
    expect(enterBossTest(fresh(), 'phase1')).not.toContain('MACHINE GUN');
  });

  it('rejects an unknown weapon without starting anything', () => {
    const g = fresh();
    const before = g.state;
    const report = enterBossTest(g, { weapon: 'RAILGUN' });
    expect(report).toContain('unknown weapon');
    expect(g.state).toBe(before);
    expect(g.abyssStage).toBe('none');
  });

  it('leaks nothing into the next run', () => {
    const used = fresh();
    enterBossTest(used, 'rage');
    const next = fresh();
    expect(next.inBossMode).toBe(false);
    expect(next.gravitySign).toBe(GRAVITY_DIRECTION.normal);
    expect(next.abyssStage).toBe('none');
    expect(next.stage.label).toBe('1-1');
    expect(next.physics.gravity).toBe(BALANCE.gravity);
    expect(next.boss.enabled).toBe(false);
  });
});
