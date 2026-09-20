import { describe, expect, it } from 'vitest';
import { atNimushi, fighting, round, shootEye, STEP, tick } from './nimushi';
import { NIMUSHI, ATTACK_STATES, TAPIOCA_SHOWER } from '../src/data/nimushi';
import { WORLD } from '../src/data/balance';
import { GUN_MODULES, type GunModuleId } from '../src/data/gunModules';
import { GameModel } from '../src/systems/GameModel';

/**
 * FAR TO DODGE, CLOSE TO COUNTERATTACK -- and a safety valve when the dodge fails.
 *
 * One fixed distance could not serve both halves of the fight: close enough for SHOTGUN's 260px
 * reach is close enough that a pattern arrives before it can be read, and far enough to read the
 * pattern is far enough that the shortest modules cannot touch the eye. So NIMUSHI moves between
 * two bands, and a pearl can be shot out of the air when the corridor is missed.
 */
const attacking = (state: string) => (Object.values(ATTACK_STATES) as string[]).includes(state);
/** Run until the fight is in one of the given states, then hand the model back. */
function until(seed: number, want: (s: string) => boolean, limit = 60) {
  const g = fighting(seed);
  for (let i = 0; i < limit / STEP && g.state === 'boss'; i++) {
    g.player.invincible = 9;
    g.step(STEP, 0, false);
    if (want(g.boss.state)) return g;
  }
  throw new Error('never reached the wanted state');
}

describe('the boss keeps its distance while attacking', () => {
  it('sits further away during an attack than during the damage window', () => {
    /** Let the boss actually arrive at the band -- the first frame of a state is mid-move. */
    const settled = (seed: number, want: (s: string) => boolean) => {
      const g = until(seed, want);
      for (let i = 0; i < 0.8 / STEP && want(g.boss.state); i++) { g.player.invincible = 9; g.step(STEP, 0, false); }
      return g.boss.reach(g.player.y);
    };
    const farReach = settled(300, attacking);
    const nearReach = settled(300, s => s === 'eyeOpen');
    expect(farReach).toBeGreaterThan(nearReach + 80);
  });

  it('puts the whole body on screen while attacking, well clear of the player', () => {
    const g = until(301, attacking);
    // Settle onto the attack band.
    for (let i = 0; i < 0.6 / STEP && attacking(g.boss.state); i++) { g.player.invincible = 9; g.step(STEP, 0, false); }
    const top = g.boss.y - NIMUSHI.bodyHeight / 2 - g.cameraY;
    expect(top).toBeGreaterThan(0);
    expect(g.boss.reach(g.player.y)).toBeGreaterThan(280);
  });

  it('comes back in for the damage window, in reach of every module', () => {
    for (const id of Object.keys(GUN_MODULES) as GunModuleId[]) {
      const g = until(302, s => s === 'eyeOpen');
      for (let i = 0; i < 0.6 / STEP && g.boss.state === 'eyeOpen'; i++) { g.player.invincible = 9; g.step(STEP, 0, false); }
      g.gun.equip(id);
      // The muzzle sits 21px nearer than the player's centre.
      const effective = g.boss.reach(g.player.y) - 21;
      expect({ id, reaches: effective <= GUN_MODULES[id].range }).toEqual({ id, reaches: true });
    }
  });

  it('really is the two authored bands, not an accident of the seed', () => {
    expect(NIMUSHI.attackBand).toBeLessThan(NIMUSHI.damageBand);
    const anchor = WORLD.height * 0.63;
    const reach = (b: number) => anchor - b * WORLD.height - NIMUSHI.bodyHeight / 2;
    expect(reach(NIMUSHI.damageBand) - 21).toBeLessThanOrEqual(GUN_MODULES.shotgun.range);
    expect(reach(NIMUSHI.attackBand)).toBeGreaterThan(reach(NIMUSHI.damageBand) + 100);
  });
});

describe('a pearl can be shot out of the air', () => {
  it('destroys one pearl and spends the round doing it', () => {
    const g = until(303, s => s === 'tapiocaShower');
    for (let i = 0; i < 0.1 / STEP; i++) { g.player.invincible = 9; g.step(STEP, 0, false); }
    const pearl = g.boss.tapiocas.find(t => t.life > 0)!;
    expect(pearl).toBeDefined();
    const others = g.boss.tapiocas.filter(t => t !== pearl && t.life > 0).length;
    g.bullets = [round(pearl.x, pearl.y, 1)];
    g.step(STEP, 0, false);
    // `life` is zeroed by the hit and then decremented by the same step's tick.
    expect(pearl.life).toBeLessThanOrEqual(0);
    expect(g.bullets.filter(b => b.alive)).toHaveLength(0);
    // One round, one pearl: nothing else in the wave went with it.
    expect(g.boss.tapiocas.filter(t => t !== pearl && t.life > 0).length).toBe(others);
  });

  it('does not let a piercing weapon clear a row', () => {
    const g = until(304, s => s === 'tapiocaShower');
    for (let i = 0; i < 0.1 / STEP; i++) { g.player.invincible = 9; g.step(STEP, 0, false); }
    const live = g.boss.tapiocas.filter(t => t.life > 0);
    expect(live.length).toBeGreaterThan(2);
    const target = live[0];
    // A LASER-grade round: piercing, and aimed straight through the wave.
    g.bullets = [round(target.x, target.y, 3, 'player', { pierce: 99, size: 3 })];
    g.step(STEP, 0, false);
    expect(g.boss.tapiocas.filter(t => t.life > 0).length).toBeGreaterThanOrEqual(live.length - 1);
  });

  it('cannot be done with an empty magazine', () => {
    const g = until(305, s => s === 'tapiocaShower');
    g.ammo = 0;
    g.bullets = [];
    g.cooldown = 0;
    g.step(STEP, 0, true);
    expect(g.bullets).toHaveLength(0);
  });

  it('leaves the corridor as the answer that costs nothing', () => {
    // Shooting is the valve, not the solution: the guarantee the dodge depends on is untouched.
    expect(TAPIOCA_SHOWER.safeLanes).toBeGreaterThanOrEqual(3);
    expect(TAPIOCA_SHOWER.waveInterval).toBeGreaterThanOrEqual(0.75);
  });
});

describe('the damage window is for damage', () => {
  it('opens with the air already cleared of the last attack', () => {
    const g = until(306, s => s === 'eyeOpen');
    expect(g.boss.tapiocas.filter(t => t.life > 0)).toHaveLength(0);
  });

  it('pours no new shower while the eye is open', () => {
    const g = until(307, s => s === 'eyeOpen');
    let seen = 0;
    for (let i = 0; i < 2 / STEP && g.boss.state === 'eyeOpen'; i++) {
      g.player.invincible = 9;
      g.step(STEP, 0, false);
      seen = Math.max(seen, g.boss.tapiocas.filter(t => t.life > 0).length);
    }
    expect(seen).toBe(0);
  });
});

describe('nothing else moved', () => {
  it('leaves the ordinary run without any of this', () => {
    const g = new GameModel(false);
    expect(g.inBossArena).toBe(false);
    // No boss entities, and piercing still pierces in the shaft.
    const solo = new GameModel(false);
    solo.stats.piercing = true;
    solo.platforms = [];
    solo.enemies = [
      { id: 1, kind: 'slime', x: 225, y: 300, originX: 225, range: 0, phase: 0, hp: 1, alive: true, flash: 0, hurtFlash: 0, shootable: true, stompable: true, flying: false, slot: 'guard' } as never,
      { id: 2, kind: 'slime', x: 225, y: 340, originX: 225, range: 0, phase: 0, hp: 1, alive: true, flash: 0, hurtFlash: 0, shootable: true, stompable: true, flying: false, slot: 'guard' } as never,
    ];
    solo.player.x = 225; solo.player.y = 200; solo.player.grounded = -1;
    solo.shoot();
    tick(solo, 0.3);
    expect(solo.kills).toBe(2);
  });

  it('still lets the weak point be hit and the fight be started', () => {
    const g = atNimushi(308);
    const before = g.boss.hp;
    shootEye(g, 1);
    expect(g.boss.hp).toBeLessThan(before);
  });
});
