import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { GUN_MODULES, volley, type GunModuleId } from '../src/data/gunModules';
import { BALANCE, initialStats } from '../src/data/balance';

/**
 * A ROUND IS THROWN FROM THE GUN, and the gun is moving.
 *
 * A weapon's `projectileSpeed` is its speed measured from the barrel, so it has to be added to what
 * the barrel is already doing. Treated as a world velocity instead, a falling player closed on
 * their own shot -- and once the terrain grammar made long falls real, they caught it: at terminal
 * speed five of the seven modules were overtaken by the player who fired them, PUNCHER within
 * 0.07s because its 520px/s muzzle is slower than the fall it leaves.
 *
 * What these protect is the invariant, not a number: whatever the shooter is doing, a round moves
 * AWAY from them along the fire direction for as long as it is in the air.
 */
const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const STEP = 1 / 120;
const IDS = Object.keys(GUN_MODULES) as GunModuleId[];

/** A run in free fall at terminal speed with nothing to land on, holding `id`. */
function falling(id: GunModuleId, seed = 7) {
  const g = new GameModel(false, seeded(seed));
  g.gun.equip(id);
  g.player.x = 225; g.player.y = 300; g.player.grounded = -1;
  g.ammo = g.stats.maxAmmo;
  for (let i = 0; i < 400; i++) { g.platforms = []; g.enemies = []; g.player.invincible = 999; g.step(STEP, 0, false); }
  return g;
}
/** Fire once and follow the slowest round until it leaves play. Returns the closest it ever came. */
function chase(g: GameModel, frames = 200) {
  g.bullets = [];
  g.shoot();
  g.platforms = []; g.enemies = []; g.player.invincible = 999;
  g.step(STEP, 0, false);
  const mine = g.bullets.filter(b => b.source === 'player');
  const away = (b: { y: number }) => (b.y - g.player.y) * g.gravitySign;
  const round = mine.sort((a, b) => away(a) - away(b))[0];
  if (!round) return null;
  let closest = Infinity, alive = 0;
  for (let i = 0; i < frames; i++) {
    g.platforms = []; g.enemies = []; g.player.invincible = 999;
    g.step(STEP, 0, false);
    if (!round.alive || !g.bullets.includes(round)) break;
    alive++;
    closest = Math.min(closest, (round.y - g.player.y) * g.gravitySign);
  }
  return { round, closest, seconds: alive / 120, playerVy: g.player.vy };
}

describe('a falling player cannot outrun their own shot', () => {
  it('holds for every module at terminal speed', () => {
    for (const id of IDS) {
      const result = chase(falling(id));
      expect(result, id).not.toBeNull();
      // Positive the whole way: the round never ends up behind the player along the fire direction.
      expect(result!.closest, `${id} closed to ${result!.closest.toFixed(0)}px`).toBeGreaterThan(0);
      expect(result!.seconds, `${id} never flew`).toBeGreaterThan(0);
    }
  });

  it('holds from a standstill and from an ordinary fall too', () => {
    for (const id of IDS) {
      for (const drop of [0, 200, 600]) {
        const g = new GameModel(false, seeded(11));
        g.gun.equip(id);
        g.player.y = 300; g.player.grounded = -1; g.player.vy = drop;
        g.ammo = g.stats.maxAmmo;
        const result = chase(g, 160);
        expect(result!.closest, `${id} at vy ${drop}`).toBeGreaterThan(0);
      }
    }
  });

  it('holds in the arena, where the pull is the other way up', () => {
    for (const id of IDS) {
      const g = new GameModel(false, seeded(29));
      g.jumpToNimushi();
      g.gun.equip(id);
      g.player.grounded = -1; g.ammo = g.stats.maxAmmo;
      for (let i = 0; i < 200; i++) { g.platforms = []; g.enemies = []; g.player.invincible = 999; g.step(STEP, 0, false); }
      const result = chase(g, 160);
      expect(result, id).not.toBeNull();
      expect(result!.closest, `${id} in the arena closed to ${result!.closest.toFixed(0)}px`).toBeGreaterThan(0);
    }
  });

  it('is the muzzle speed that separates them, not luck', () => {
    for (const id of IDS) {
      const g = falling(id);
      const carriedBefore = g.player.vy;
      g.bullets = [];
      g.shoot();
      const round = g.bullets.find(b => b.source === 'player')!;
      // The round carries the descent it was fired out of, read BEFORE the recoil answers it.
      expect(round.carried, id).toBeCloseTo(carriedBefore, 3);
      // ...so what is left over its shooter is exactly the module's own pattern. Compared as a set,
      // because a spread weapon's pellets each have their own share of the speed.
      const spec = volley(GUN_MODULES[id], initialStats(), 0);
      const relative = g.bullets.filter(b => b.source === 'player')
        .map(b => Math.round(Math.abs(b.vy - (b.carried ?? 0)))).sort((a, b) => a - b);
      expect(relative, id).toEqual(spec.map(x => Math.round(x.vy)).sort((a, b) => a - b));
    }
  });
});

describe('weapon identity survives it', () => {
  it('spends a module its reach at the same rate whatever the shooter is doing', () => {
    // Measured on the range the round actually consumes, not on how long it stays on screen: a
    // round that leaves the view is culled, which would make a fall look like a shorter weapon.
    for (const id of IDS) {
      const spent: number[] = [];
      for (const drop of [0, BALANCE.maxFallSpeed]) {
        const g = new GameModel(false, seeded(5));
        g.gun.equip(id);
        g.player.y = 300; g.player.grounded = -1; g.player.vy = drop;
        g.ammo = g.stats.maxAmmo;
        g.bullets = [];
        g.shoot();
        const round = g.bullets.filter(b => b.source === 'player').sort((a, b) => b.vy - a.vy)[0];
        for (let i = 0; i < 12; i++) {
          g.platforms = []; g.enemies = []; g.player.invincible = 999;
          g.player.vy = drop;                        // hold the fall steady so this measures the round
          g.step(STEP, 0, false);
          if (!round.alive || !g.bullets.includes(round)) break;
        }
        spent.push(round.travelled);
      }
      // `range` is the weapon's reach FROM THE GUN, so a terminal-speed fall must not spend it any
      // faster than standing still does. Before this change it spent it nearly twice as fast.
      expect(spent[1], id).toBeCloseTo(spent[0], 0);
      expect(spent[0], id).toBeGreaterThan(0);
    }
  });

  it('leaves the fan, the damage and the cost exactly where they were', () => {
    for (const id of IDS) {
      const def = GUN_MODULES[id];
      const spec = volley(def, initialStats(), 0);
      const g = new GameModel(false, seeded(13));
      g.gun.equip(id);
      g.player.y = 300; g.player.grounded = -1; g.player.vy = BALANCE.maxFallSpeed;
      g.ammo = g.stats.maxAmmo;
      g.bullets = [];
      g.shoot();
      const mine = g.bullets.filter(b => b.source === 'player');
      expect(mine.length, id).toBe(spec.length);
      // The horizontal fan is the module's and is untouched by how fast the shooter is moving.
      expect(mine.map(b => Math.round(b.vx)).sort(), id).toEqual(spec.map(s => Math.round(s.vx)).sort());
      expect(mine.map(b => b.damage), id).toEqual(spec.map(s => s.damage));
      expect(mine.map(b => b.range), id).toEqual(spec.map(s => s.range));
      expect(g.stats.maxAmmo - g.ammo, id).toBe(def.ammoCost);
    }
  });

  it('still brakes rather than thrusts, and the round still leaves along the pull', () => {
    for (const id of IDS) {
      const g = falling(id);
      const before = g.player.vy;
      g.bullets = [];
      g.shoot();
      // The recoil is a brake: it never carries the player back up the shaft.
      expect(g.player.vy, id).toBeLessThanOrEqual(before);
      expect(g.player.vy, id).toBeGreaterThanOrEqual(0);
      // ...and the round leaves downward, which is where the boots point.
      for (const b of g.bullets.filter(b => b.source === 'player')) expect(b.vy, id).toBeGreaterThan(0);
    }
  });
});
