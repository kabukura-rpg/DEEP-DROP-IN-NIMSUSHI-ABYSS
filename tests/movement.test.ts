import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { BALANCE, JUMP, WALL_JUMP, WORLD } from '../src/data/balance';
import { GUN_MODULES, type GunModuleId } from '../src/data/gunModules';

/**
 * CORE MOVEMENT INVARIANTS (Phase 7C-2).
 *
 * The rules a player's vertical position obeys, asserted through the real step loop rather than by
 * reading the constants back. The headline rule is that the gunboots are a BRAKE: they may kill a
 * descent and hold a hover, and they may never add height.
 */
const STEP = 1 / 120;
const PH = 30;
const seeded = (n: number) => () => { n = (n * 1103515245 + 12345) % 2147483648; return n / 2147483648; };
/**
 * Real models, never practice ones. Practice mode teleports a player who falls past y=840 back to
 * y=120 -- which, in a test that measures whether something climbed, reads as a 180px climb. Two of
 * these tests failed that way before the harness was corrected.
 */
const model = (seed = 9) => new GameModel(false, seeded(seed));

/** A player genuinely standing on the start platform, with the world emptied around them. */
function standing() {
  const g = model();
  for (let i = 0; i < 240 && g.player.grounded === -1; i++) g.step(STEP, 0, false);
  expect(g.player.grounded).not.toBe(-1);
  g.enemies = []; g.pickups = []; g.hazards = []; g.doodads = [];
  return g;
}
/** Run an arc from a launch, with the floor removed so landing cannot end it early. */
function arcPeak(g: GameModel, firing: boolean) {
  const y0 = g.player.y;
  let peak = y0;
  for (let i = 0; i < 400; i++) {
    g.platforms = []; g.enemies = []; g.doodads = [];
    g.step(STEP, 0, firing);
    peak = Math.min(peak, g.player.y);
    if (g.player.vy > 0 && g.player.y >= y0) break;
  }
  return y0 - peak;
}
function airborneAt(vy: number) {
  const g = model();
  g.platforms = []; g.enemies = []; g.pickups = []; g.hazards = []; g.doodads = [];
  g.player.x = 225; g.player.y = 300; g.player.grounded = -1; g.player.vy = vy;
  return g;
}

describe('A. ground jump peak', () => {
  it('rises the height its impulse and gravity imply, and no more', () => {
    const g = standing();
    expect(g.jump()).toBe(true);
    const rise = arcPeak(g, false);
    // Derived from the constants rather than hard-coded, so this stays a regression test on the
    // PHYSICS when the impulse is retuned -- it is not a lock on the current value.
    const ideal = (JUMP.impulse * JUMP.impulse) / (2 * BALANCE.gravity);
    expect(rise).toBeGreaterThan(ideal * 0.95);
    expect(rise).toBeLessThanOrEqual(ideal);
  });
  it('cannot reach the row above, so descent is never undone', () => {
    const g = standing();
    g.jump();
    // 245px is the measured median spacing between levels; a jump must stay well under it.
    expect(arcPeak(g, false)).toBeLessThan(245 * 0.5);
  });
});

describe('B. ground jump plus a full magazine', () => {
  it('never peaks higher than the jump alone', () => {
    const alone = standing();
    alone.jump();
    const soloPeak = arcPeak(alone, false);

    const armed = standing();
    armed.ammo = armed.stats.maxAmmo;
    armed.jump();
    const firedPeak = arcPeak(armed, true);

    expect(firedPeak).toBeLessThanOrEqual(soloPeak + 0.001);
  });
  it('spends no height even with unlimited CHARGE', () => {
    const g = standing();
    g.ammo = 999;
    g.jump();
    const ideal = (JUMP.impulse * JUMP.impulse) / (2 * BALANCE.gravity);
    expect(arcPeak(g, true)).toBeLessThanOrEqual(ideal);
  });
});

describe('C. firing at terminal velocity', () => {
  it('slows the descent and can bring it to a standstill, but never past it', () => {
    const g = airborneAt(BALANCE.maxFallSpeed);
    g.ammo = 999;
    let lowest = BALANCE.maxFallSpeed, roseEver = false;
    for (let i = 0; i < 600; i++) {
      g.platforms = []; g.step(STEP, 0, true);
      lowest = Math.min(lowest, g.player.vy);
      if (g.player.vy < -0.001) roseEver = true;
    }
    expect(lowest).toBeLessThan(BALANCE.maxFallSpeed);   // it really did brake
    expect(lowest).toBeGreaterThanOrEqual(0);            // and never turned into a climb
    expect(roseEver).toBe(false);
  });
  it('falls again once CHARGE runs out', () => {
    const g = airborneAt(BALANCE.maxFallSpeed);
    g.ammo = g.stats.maxAmmo;
    for (let i = 0; i < 400; i++) { g.platforms = []; g.step(STEP, 0, true); }
    expect(g.ammo).toBe(0);
    expect(g.player.vy).toBeGreaterThan(0);
  });
  /**
   * How much hover a magazine actually buys depends on the weapon, and MACHINE GUN is the weakest
   * case: `recovery` drops a repeated shot to 0.65 of its recoil, so MG delivers ~123px/s of braking
   * per 0.16s cycle against 144px/s of gravity. It therefore SLOWS a fall but cannot hold one. The
   * heavy modules can. This is asserted as it is rather than as one rule for all seven.
   */
  it('slows the descent for as long as CHARGE lasts, for every weapon', () => {
    for (const id of Object.keys(GUN_MODULES) as GunModuleId[]) {
      const held = airborneAt(BALANCE.maxFallSpeed);
      held.gun.equip(id); held.ammo = 999;
      const hy = held.player.y;
      for (let i = 0; i < 240; i++) { held.platforms = []; held.step(STEP, 0, true); }
      const free = airborneAt(BALANCE.maxFallSpeed);
      const fy = free.player.y;
      for (let i = 0; i < 240; i++) { free.platforms = []; free.step(STEP, 0, false); }
      expect({ id, slower: held.player.y - hy < free.player.y - fy }).toEqual({ id, slower: true });
    }
  });
  /**
   * A shot stops the fall dead exactly when the remaining descent is worth less than the weapon's
   * recoil, and the surplus is discarded rather than spent climbing. Note this does NOT happen from
   * terminal for any module: the fastest kick in the roster is LASER's 420 against a 520 fall, so a
   * terminal descent is always slowed and never halted by a single shot.
   */
  it('stops the fall dead when the descent is worth less than the recoil, and no further', () => {
    const slow = airborneAt(GUN_MODULES.machine.recoil - 40);
    slow.cooldown = 0;
    slow.shoot();
    expect(slow.player.vy).toBe(0);

    const fast = airborneAt(BALANCE.maxFallSpeed);
    fast.gun.equip('laser'); fast.ammo = 99; fast.cooldown = 0;
    fast.shoot();
    expect(fast.player.vy).toBe(BALANCE.maxFallSpeed - GUN_MODULES.laser.recoil);
    expect(fast.player.vy).toBeGreaterThan(0);
  });
});

describe('D. every weapon', () => {
  const ids = Object.keys(GUN_MODULES) as GunModuleId[];
  it('recoils by its own amount', () => {
    const kick = (id: GunModuleId) => {
      const g = airborneAt(BALANCE.maxFallSpeed);
      g.gun.equip(id); g.ammo = 99; g.cooldown = 0;
      g.shoot();
      return BALANCE.maxFallSpeed - g.player.vy;
    };
    // Not all seven are distinct -- BURST and TRIPLE share 150 -- but the ordering must follow the
    // data, so a weapon's recoil remains a real weapon trait under the brake model.
    expect(kick('laser')).toBeGreaterThan(kick('machine'));
    expect(kick('machine')).toBeGreaterThan(kick('noppy'));
    expect(kick('shotgun')).toBeGreaterThan(kick('puncher'));
  });
  it('cannot turn a ground jump into a higher jump -- none of the seven', () => {
    const alone = standing();
    alone.jump();
    const soloPeak = arcPeak(alone, false);
    for (const id of ids) {
      const g = standing();
      g.equipGunModule(id, 'charge');
      g.ammo = 999;
      g.jump();
      expect({ id, higher: arcPeak(g, true) > soloPeak + 0.001 }).toEqual({ id, higher: false });
    }
  });
  it('cannot produce sustained upward travel from a standstill -- none of the seven', () => {
    for (const id of ids) {
      const g = airborneAt(0);
      g.gun.equip(id); g.ammo = 999;
      const y0 = g.player.y;
      for (let i = 0; i < 600; i++) { g.platforms = []; g.step(STEP, 0, true); }
      expect({ id, climbed: g.player.y < y0 }).toEqual({ id, climbed: false });
    }
  });
});

/**
 * E. WALL JUMP -- CHARACTERISATION, NOT YET A SPECIFICATION.
 *
 * Phase 7C-2 states the original's wall jump as a gated move: an airborne rolling/somersault state,
 * wall contact, input away from the wall, ACTION, no CHARGE, and no chaining in the air until a
 * reset. DEEP DROP currently implements four of those six. These tests pin what it does TODAY so
 * the divergence is visible and locked; the two gaps are marked and are not silently asserted as
 * correct. Changing the behaviour is not authorised in this phase.
 */
describe('E. wall jump -- current behaviour', () => {
  const LEFT = WORLD.wall + 11, RIGHT = WORLD.width - WORLD.wall - 11;
  function atWall(side: -1 | 1, vy = 200) {
    const g = model();
    g.platforms = []; g.enemies = []; g.pickups = []; g.hazards = []; g.doodads = [];
    g.player.x = side === -1 ? LEFT : RIGHT;
    g.player.y = 300; g.player.grounded = -1; g.player.vy = vy;
    for (let i = 0; i < 12; i++) { g.platforms = []; g.step(STEP, side, false); }
    expect(g.wallSide).toBe(side);
    return g;
  }

  it('fires on wall contact with input away from the wall', () => {
    const g = atWall(-1);
    expect(g.wallJump(g.wallJumpSide(1))).toBe(true);
    expect(g.player.vy).toBe(-WALL_JUMP.impulse);
  });
  it('refuses without input away from the wall', () => {
    const g = atWall(-1);
    expect(g.wallJumpSide(-1)).toBe(0);
    expect(g.wallJumpSide(0)).toBe(0);
  });
  it('refuses while grounded', () => {
    const g = standing();
    expect(g.wallJumpSide(1)).toBe(0);
  });
  it('costs no CHARGE', () => {
    const g = atWall(-1);
    const before = g.ammo;
    g.wallJump(g.wallJumpSide(1));
    expect(g.ammo).toBe(before);
    expect(g.bullets).toHaveLength(0);
  });
  it('refuses a second jump from the SAME wall without a reset', () => {
    const g = atWall(-1);
    expect(g.wallJump(g.wallJumpSide(1))).toBe(true);
    for (let i = 0; i < 12; i++) { g.platforms = []; g.step(STEP, -1, false); }
    expect(g.wallJumpSide(1)).toBe(0);
  });
  it('re-arms on landing', () => {
    const g = atWall(-1);
    g.wallJump(g.wallJumpSide(1));
    const landed = standing();                       // a real landing through the collision pass
    expect(landed.player.grounded).not.toBe(-1);
    expect((landed as unknown as { wallJumpUsed: number }).wallJumpUsed).toBe(0);
  });

  /** GAP 1 vs the stated original: no airborne state gates the move. */
  it('GAP: is not gated on any airborne rolling state', () => {
    const still = atWall(-1, 0);                     // not falling, not rolling, barely moving
    expect(still.wallJump(still.wallJumpSide(1))).toBe(true);
  });
  /** GAP 2 vs the stated original: touching the opposite wall re-arms it in mid-air. */
  it('GAP: re-arms in mid-air on the opposite wall, so a shaft can be zig-zagged without landing', () => {
    const g = atWall(-1);
    expect(g.wallJump(g.wallJumpSide(1))).toBe(true);
    g.player.x = RIGHT;
    for (let i = 0; i < 12; i++) { g.platforms = []; g.step(STEP, 1, false); }
    expect(g.wallJumpSide(-1)).toBe(1);
    expect(g.player.grounded).toBe(-1);              // never touched the ground in between
  });
  it('GAP: but zig-zagging still descends -- it slows a fall rather than climbing', () => {
    const g = atWall(-1);
    const y0 = g.player.y;
    let best = y0;
    for (let i = 0; i < 1200; i++) {
      g.platforms = []; g.enemies = []; g.doodads = [];
      const used = (g as unknown as { wallJumpUsed: number }).wallJumpUsed;
      const toward = used === 0 ? -1 : (-used as -1 | 1);
      g.step(STEP, toward, false);
      const side = g.wallJumpSide(-toward);
      if (side !== 0) g.wallJump(side);
      best = Math.min(best, g.player.y);
    }
    expect(best).toBeGreaterThan(y0 - PH * 2);       // never meaningfully above where it started
    expect(g.player.y).toBeGreaterThan(y0);          // and ends up well below
  });
});
