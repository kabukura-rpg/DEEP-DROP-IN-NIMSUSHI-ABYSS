import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { reachExit } from './exitHelper';
import { NIMUSHI } from '../src/data/nimushi';
import { GunModuleSystem } from '../src/systems/GunModuleSystem';
import {
  CHARGE_AMMO_BONUS, GUN_MODULES, GUN_MODULE_IDS, STARTING_GUN_MODULE, gunModule, volley, volleyRecoil,
  type GunModuleId,
} from '../src/data/gunModules';
import { spawnGunModule, pickupType } from '../src/data/pickups';
import { spawnEnemy } from '../src/data/enemies';
import { initialStats } from '../src/data/balance';

const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

/** A run with the shaft emptied, holding one specific module. */
function armed(id: GunModuleId = 'machine') {
  const game = new GameModel(false, seeded(9));
  game.platforms = []; game.enemies = []; game.pickups = []; game.hazards = [];
  game.player.invincible = 99;
  game.gun.equip(id);
  return game;
}
/**
 * Step while keeping the shaft empty, so a test measures the gun and nothing else.
 * `endless` refills the magazine every frame: the worst case for a hovering exploit.
 */
function hold(game: GameModel, seconds: number, direction = 0, firing = false, endless = false) {
  for (let i = 0; i < Math.round(seconds * 120); i++) {
    game.platforms = []; game.enemies = []; game.pickups = []; game.hazards = [];
    game.player.invincible = 99;
    if (endless) game.ammo = game.stats.maxAmmo;
    game.step(1 / 120, direction, firing);
  }
}
const shots = (game: GameModel) => game.events.filter(e => e.type === 'shot').length;
const foe = (id: number, y: number) => spawnEnemy('slime', id, 225, y);

describe('gun module catalogue', () => {
  it('describes all seven weapons as pure data', () => {
    expect(GUN_MODULE_IDS).toHaveLength(7);
    expect(new Set(GUN_MODULE_IDS)).toEqual(new Set(['machine', 'burst', 'laser', 'noppy', 'puncher', 'shotgun', 'triple']));
    for (const id of GUN_MODULE_IDS) {
      const def = gunModule(id);
      expect(def.ammoCost).toBeGreaterThan(0);
      expect(def.fireInterval).toBeGreaterThan(0);
      expect(def.recoil).toBeGreaterThan(0);
      expect(def.range).toBeGreaterThan(0);
      expect(def.short.length).toBeGreaterThan(0);
      expect(def.short.length).toBeLessThanOrEqual(6);
    }
  });
  it('starts every run on MACHINE GUN', () => {
    expect(STARTING_GUN_MODULE).toBe('machine');
    expect(new GameModel().gun.id).toBe('machine');
    expect(new GunModuleSystem().id).toBe('machine');
  });
  it('costs exactly what the specification asks', () => {
    const costs = Object.fromEntries(GUN_MODULE_IDS.map(id => [id, gunModule(id).ammoCost]));
    expect(costs).toEqual({ machine: 1, burst: 3, laser: 4, noppy: 1, puncher: 2, shotgun: 5, triple: 2 });
  });
  it('puts LASER and SHOTGUN at the heavy end of recoil, well above MACHINE', () => {
    const r = (id: GunModuleId) => gunModule(id).recoil;
    // LASER is the original's recoil weapon; it used to sit at the bottom of this list.
    expect(r('laser')).toBeGreaterThan(r('shotgun'));
    expect(r('shotgun')).toBeGreaterThan(r('machine'));
    expect(r('laser')).toBeGreaterThan(r('machine') * 1.5);
    expect(r('machine')).toBeGreaterThan(r('puncher'));
    expect(r('puncher')).toBeGreaterThan(r('burst'));
    expect(r('burst')).toBeGreaterThanOrEqual(r('triple'));
    expect(r('laser')).toBeGreaterThan(r('noppy'));
  });
});

describe('MACHINE GUN', () => {
  it('spends one round per shot and fires while held', () => {
    const game = armed('machine');
    hold(game, 1 / 120, 0, true);
    expect(game.ammo).toBe(initialStats().maxAmmo - GUN_MODULES.machine.ammoCost);
    expect(game.bullets).toHaveLength(1);
    hold(game, 1.6, 0, true);
    expect(game.ammo).toBe(0);
    expect(shots(game)).toBeGreaterThanOrEqual(initialStats().maxAmmo);
  });
  it('brakes a fall by the standard recoil without ever lifting', () => {
    const game = armed('machine');
    game.player.vy = 300;
    const falling = 300 + game.stats.gravity / 120;   // this frame's gravity arrives before the shot
    hold(game, 1 / 120, 0, true);
    expect(game.player.vy).toBeCloseTo(falling - volleyRecoil(GUN_MODULES.machine, game.stats), 3);
    expect(game.player.vy).toBeGreaterThanOrEqual(0);
  });
  it('fires straight down', () => {
    const game = armed('machine');
    hold(game, 1 / 120, 1, true);
    expect(game.bullets[0].vx).toBe(0);
  });
});

describe('BURST', () => {
  it('sends three rounds from one press and charges three', () => {
    const game = armed('burst');
    hold(game, 0.30, 0, true);
    expect(shots(game)).toBe(3);
    expect(game.ammo).toBe(initialStats().maxAmmo - GUN_MODULES.burst.ammoCost);
  });
  it('is point fire, not a single triple-wide volley', () => {
    const game = armed('burst');
    hold(game, 1 / 120, 0, true);
    expect(shots(game)).toBe(1);
    hold(game, 0.30, 0, true);
    expect(shots(game)).toBe(3);
  });
  it('does not repeat while the trigger stays held', () => {
    const game = armed('burst');
    game.stats.maxAmmo = 30; game.ammo = 30;
    hold(game, 3, 0, true);
    expect(shots(game)).toBe(3);
  });
  it('fires again on a fresh press', () => {
    const game = armed('burst');
    game.stats.maxAmmo = 30; game.ammo = 30;
    hold(game, 0.30, 0, true);
    hold(game, 0.30, 0, false);
    hold(game, 0.30, 0, true);
    expect(shots(game)).toBe(6);
  });
  it('never double-fires when a landing reloads mid-burst', () => {
    const game = armed('burst');
    hold(game, 1 / 120, 0, true);
    game.ammo = game.stats.maxAmmo;      // as a landing would
    hold(game, 0.30, 0, true);
    expect(shots(game)).toBe(3);
  });
});

describe('LASER', () => {
  it('costs four and carries high damage a long way', () => {
    const game = armed('laser');
    game.shoot();
    expect(game.ammo).toBe(initialStats().maxAmmo - GUN_MODULES.laser.ammoCost);
    const shot = game.bullets[0];
    expect(shot.damage).toBe(3);
    expect(shot.range).toBeGreaterThan(GUN_MODULES.machine.range);
    expect(shot.beam).toBe(true);
  });
  it('pierces a whole column of enemies with one round', () => {
    const game = armed('laser');
    game.enemies = [foe(1, 260), foe(2, 330), foe(3, 400)];
    game.shoot();
    for (let i = 0; i < 40; i++) { game.platforms = []; game.pickups = []; game.player.y = 180; game.player.vy = 0; game.step(1 / 120, 0, false); }
    expect(game.kills).toBe(3);
  });
  it('only ever lands one hit on NIMUSHI, however far it pierces', () => {
    const game = new GameModel(false, seeded(4));
    game.jumpToNimushi();
    game.platforms = []; game.doodads = [];
    game.gun.equip('laser');
    const before = game.boss.hp;
    // Straight up the shaft at the eye, from a column the beam actually passes through.
    game.player.x = game.boss.x;
    game.player.y = game.boss.face + 300;
    game.player.grounded = -1;
    game.shoot();
    for (let i = 0; i < 90; i++) { game.player.invincible = 99; game.step(1 / 120, 0, false); }
    expect(before - game.boss.hp).toBe(GUN_MODULES.laser.projectileDamage);
  });
  it('has a narrower profile than the heavy weapons', () => {
    expect(GUN_MODULES.laser.projectileSize).toBeLessThan(GUN_MODULES.puncher.projectileSize);
  });
});

describe('NOPPY', () => {
  it('costs one and fires very fast with a weak brake', () => {
    const game = armed('noppy');
    expect(game.gun.ammoCost).toBe(1);
    expect(GUN_MODULES.noppy.fireInterval).toBeLessThan(GUN_MODULES.machine.fireInterval);
    expect(volleyRecoil(GUN_MODULES.noppy, game.stats)).toBeLessThan(volleyRecoil(GUN_MODULES.machine, game.stats));
  });
  it('leans the shot toward the direction of travel and straightens when still', () => {
    const right = armed('noppy'); hold(right, 1 / 120, 1, true);
    const left = armed('noppy'); hold(left, 1 / 120, -1, true);
    const still = armed('noppy'); hold(still, 1 / 120, 0, true);
    expect(right.bullets[0].vx).toBeGreaterThan(0);
    expect(left.bullets[0].vx).toBeLessThan(0);
    expect(still.bullets[0].vx).toBe(0);
    // Leaning must not stop it falling: the shot still travels mostly downward.
    expect(right.bullets[0].vy).toBeGreaterThan(Math.abs(right.bullets[0].vx));
  });
  it('carries a smaller round than the standard gun', () => {
    expect(GUN_MODULES.noppy.projectileSize).toBeLessThan(GUN_MODULES.machine.projectileSize);
  });
});

describe('PUNCHER', () => {
  it('costs two and throws three slow rounds side by side', () => {
    const game = armed('puncher');
    game.shoot();
    expect(game.ammo).toBe(initialStats().maxAmmo - GUN_MODULES.puncher.ammoCost);
    expect(game.bullets).toHaveLength(3);
    expect(GUN_MODULES.puncher.projectileSpeed).toBeLessThan(GUN_MODULES.machine.projectileSpeed);
  });
  it('expires well short of the standard gun', () => {
    expect(GUN_MODULES.puncher.range).toBeLessThan(GUN_MODULES.machine.range / 2);
    const game = armed('puncher');
    game.shoot();
    hold(game, 0.9, 0, false);
    expect(game.bullets).toHaveLength(0);
  });
  it('hits with each of its three rounds independently, rather than piercing with one', () => {
    const game = armed('puncher');
    // One enemy under each lane: three separate rounds, three separate kills.
    const lanes = GUN_MODULES.puncher.spawnSpread! / 2;
    game.enemies = [spawnEnemy('slime', 1, 225 - lanes, 260), spawnEnemy('slime', 2, 225, 260), spawnEnemy('slime', 3, 225 + lanes, 260)];
    game.shoot();
    for (let i = 0; i < 90; i++) { game.platforms = []; game.pickups = []; game.player.y = 180; game.player.vy = 0; game.step(1 / 120, 0, false); }
    expect(game.kills).toBe(3);
    expect(GUN_MODULES.puncher.piercing).toBe(0);
  });
});

describe('SHOTGUN', () => {
  it('costs five and throws a fan of pellets', () => {
    const game = armed('shotgun');
    hold(game, 1 / 120, 0, true);
    expect(game.ammo).toBe(initialStats().maxAmmo - GUN_MODULES.shotgun.ammoCost);
    expect(game.bullets).toHaveLength(5);
    const lateral = game.bullets.map(b => b.vx);
    expect(Math.min(...lateral)).toBeLessThan(0);
    expect(Math.max(...lateral)).toBeGreaterThan(0);
    expect(game.bullets.every(b => b.vy > 0)).toBe(true);
  });
  it('kicks harder than anything else and still cannot lift the player', () => {
    const game = armed('shotgun');
    game.player.vy = 400;
    const falling = 400 + game.stats.gravity / 120;
    hold(game, 1 / 120, 0, true);
    expect(game.player.vy).toBeCloseTo(falling - volleyRecoil(GUN_MODULES.shotgun, game.stats), 3);
    expect(game.player.vy).toBeGreaterThanOrEqual(0);
  });
  it('is semi-automatic: holding the trigger fires once', () => {
    const game = armed('shotgun');
    game.stats.maxAmmo = 40; game.ammo = 40;
    hold(game, 2, 0, true);
    expect(shots(game)).toBe(1);
  });
  it('reaches only a short distance', () => {
    expect(GUN_MODULES.shotgun.range).toBeLessThan(GUN_MODULES.machine.range / 2);
  });
});

describe('TRIPLE', () => {
  it('costs two and covers three lanes at once', () => {
    const game = armed('triple');
    hold(game, 1 / 120, 0, true);
    expect(game.ammo).toBe(initialStats().maxAmmo - GUN_MODULES.triple.ammoCost);
    expect(game.bullets).toHaveLength(3);
    const lateral = game.bullets.map(b => b.vx).sort((a, b) => a - b);
    expect(lateral[0]).toBeLessThan(0);
    expect(lateral[1]).toBe(0);
    expect(lateral[2]).toBeGreaterThan(0);
  });
  it('fans narrower than the shotgun', () => {
    expect(GUN_MODULES.triple.spread).toBeLessThan(GUN_MODULES.shotgun.spread);
  });
  it('keeps firing while the trigger is held', () => {
    const game = armed('triple');
    game.stats.maxAmmo = 40; game.ammo = 40;
    hold(game, 1, 0, true);
    expect(shots(game)).toBeGreaterThan(3);
  });
});

describe('every module keeps the shooting core intact', () => {
  it.each(GUN_MODULE_IDS)('%s cannot climb on its own trigger, even with an endless magazine', id => {
    const game = armed(id);
    game.player.y = 220; game.player.vy = 0; game.player.grounded = -1;
    const start = 220;
    let highest = start;
    for (let i = 0; i < 1080; i++) {
      game.platforms = []; game.enemies = []; game.pickups = []; game.hazards = [];
      game.player.invincible = 99; game.ammo = game.stats.maxAmmo;
      game.step(1 / 120, 0, true);
      highest = Math.min(highest, game.player.y);
    }
    // Recoil may now genuinely lift: the gunboots are boots. What must still hold is that no
    // weapon CLIMBS on its own trigger -- over a long hold, gravity beats the recoil the fire rate
    // can buy, so the run always ends up lower than it started and never far above it.
    expect(game.player.y).toBeGreaterThan(start);
    expect(highest).toBeGreaterThan(start - 200);
  });
  it.each(GUN_MODULE_IDS)('%s spends its last round even when a volley costs more', id => {
    const game = armed(id);
    game.ammo = 1;
    hold(game, 1 / 60, 0, true);
    expect(game.bullets.length).toBeGreaterThan(0);
    expect(game.ammo).toBe(0);
  });
  it.each(GUN_MODULE_IDS)('%s refuses to fire only once the magazine is empty', id => {
    const game = armed(id);
    game.ammo = 0;
    hold(game, 0.9, 0, true);
    expect(game.bullets).toHaveLength(0);
    expect(game.events.some(e => e.type === 'empty')).toBe(true);
  });
  it.each(GUN_MODULE_IDS)('%s refills the whole magazine on landing', id => {
    const game = armed(id);
    game.gun.equip(id);
    game.ammo = 0;
    game.platforms = [{ id: 77, x: 150, width: 170, y: 320 }];
    game.player.y = 250; game.player.vy = 300; game.player.grounded = -1;
    for (let i = 0; i < 60 && game.player.grounded === -1; i++) game.step(1 / 120, 0, false);
    expect(game.player.grounded).toBe(77);
    expect(game.ammo).toBe(game.stats.maxAmmo);
  });
});

describe('existing upgrades stay modifiers on top of the module', () => {
  it('POWER+ adds its flat bonus once, on any weapon', () => {
    const stats = initialStats();
    expect(volley(GUN_MODULES.machine, stats, 0)[0].damage).toBe(1);
    expect(volley(GUN_MODULES.laser, stats, 0)[0].damage).toBe(3);
    stats.power = 2;
    expect(volley(GUN_MODULES.machine, stats, 0)[0].damage).toBe(2);
    expect(volley(GUN_MODULES.laser, stats, 0)[0].damage).toBe(4);
  });
  it('BIG BULLET scales the module calibre rather than replacing it', () => {
    const stats = initialStats();
    const plain = volley(GUN_MODULES.puncher, stats, 0)[0].size;
    stats.bulletSize *= 1.5;
    expect(volley(GUN_MODULES.puncher, stats, 0)[0].size).toBeCloseTo(plain * 1.5, 5);
  });
  it('RECOIL+ scales the module recoil rather than the old global value', () => {
    const stats = initialStats();
    const plain = volleyRecoil(GUN_MODULES.shotgun, stats);
    stats.shotRecoil *= 1.15;
    expect(volleyRecoil(GUN_MODULES.shotgun, stats)).toBeCloseTo(plain * 1.15, 5);
  });
  it('PIERCING lifts any module through everything, without stacking twice', () => {
    const stats = initialStats();
    expect(volley(GUN_MODULES.machine, stats, 0)[0].pierce).toBe(0);
    stats.piercing = true;
    expect(volley(GUN_MODULES.machine, stats, 0)[0].pierce).toBe(99);
    expect(volley(GUN_MODULES.laser, stats, 0)[0].pierce).toBe(99);
  });
});

describe('gun module pickups', () => {
  it('is its own category, never an AREA pickup', () => {
    expect(pickupType('gunModule').category).toBe('gunModule');
    expect(pickupType('oxygenBubble').category).toBe('environment');
    expect(pickupType('ice').category).toBe('environment');
  });
  it('swaps the weapon outright, never carrying two at once', () => {
    const game = armed('machine');
    game.pickups = [spawnGunModule(1, game.player.x, game.player.y, 'shotgun', 'heart')];
    game.step(1 / 120, 0, false);
    expect(game.gun.id).toBe('shotgun');
    expect(game.gun.ammoCost).toBe(5);
  });
  it('HEART type heals exactly one heart through HealthSystem', () => {
    const game = armed('machine');
    game.player.invincible = 0; game.damage(1, 'enemy');
    game.player.invincible = 0; game.damage(1, 'enemy');
    expect(game.hp).toBe(game.stats.maxHp - 2);
    const before = game.hp;
    game.player.invincible = 0;
    game.pickups = [spawnGunModule(1, game.player.x, game.player.y, 'triple', 'heart')];
    game.step(1 / 120, 0, false);
    expect(game.hp).toBe(before + 1);
    expect(game.gun.id).toBe('triple');
  });
  it('HEART type at full health rolls into the existing LIFE UP overflow', () => {
    const game = armed('machine');
    expect(game.hp).toBe(game.stats.maxHp);
    const before = game.health.overflowHealing;
    game.pickups = [spawnGunModule(1, game.player.x, game.player.y, 'noppy', 'heart')];
    game.step(1 / 120, 0, false);
    expect(game.hp).toBe(game.stats.maxHp);
    expect(game.health.overflowHealing).toBe(before + 1);
  });
  it('CHARGE type raises MAX AMMO for the rest of the run and tops the magazine up', () => {
    const game = armed('machine');
    const before = game.stats.maxAmmo;
    game.ammo = 1;
    game.pickups = [spawnGunModule(1, game.player.x, game.player.y, 'laser', 'charge')];
    game.step(1 / 120, 0, false);
    expect(game.stats.maxAmmo).toBe(before + CHARGE_AMMO_BONUS);
    expect(game.ammo).toBe(before + CHARGE_AMMO_BONUS);
    hold(game, 2, 0, false);
    expect(game.stats.maxAmmo).toBe(before + CHARGE_AMMO_BONUS);
  });
  it('still pays the bonus when the crate holds the weapon already equipped', () => {
    const game = armed('machine');
    const before = game.stats.maxAmmo;
    game.pickups = [spawnGunModule(1, game.player.x, game.player.y, 'machine', 'charge')];
    game.step(1 / 120, 0, false);
    expect(game.gun.id).toBe('machine');
    expect(game.stats.maxAmmo).toBe(before + CHARGE_AMMO_BONUS);
  });
  it('announces the swap so the HUD can show it', () => {
    const game = armed('machine');
    game.pickups = [spawnGunModule(1, game.player.x, game.player.y, 'shotgun', 'charge')];
    game.step(1 / 120, 0, false);
    const event = game.events.find(e => e.type === 'gunModule');
    expect(event?.stage).toBe('SHOTGUN');
    expect(event?.bonus).toBe('charge');
  });
});

describe('a SECTION boundary clears the shot in progress, not the weapon', () => {
  it('does not deliver a BURST across the gate: the next SECTION starts silent', () => {
    const game = new GameModel(false, seeded(31));
    game.gun.equip('burst');
    // Fire once: BURST pays for all three rounds up front and owes two more.
    hold(game, 1 / 120, 0, true);
    expect(shots(game)).toBe(1);
    expect(game.gun.bursting).toBe(true);

    // Clear the SECTION and take the rest card, with the trigger released throughout.
    reachExit(game);
    expect(game.state).toBe('upgrade');
    game.selectUpgrade(game.upgrades.choices[0].id);
    game.confirmUpgrade();
    expect(game.state).toBe('playing');

    const ammo = game.ammo;
    game.events.length = 0;
    // No input at all in the new SECTION.
    for (let i = 0; i < 120; i++) { game.player.invincible = 99; game.step(1 / 120, 0, false); }
    expect(game.bullets).toHaveLength(0);
    expect(game.events.filter(e => e.type === 'shot')).toHaveLength(0);
    expect(game.ammo).toBe(ammo);
    expect(game.gun.bursting).toBe(false);
  });

  it('keeps the weapon and the run-grown magazine across the gate', () => {
    const game = new GameModel(false, seeded(33));
    game.gun.equip('shotgun');
    game.stats.maxAmmo += 4;
    const maxAmmo = game.stats.maxAmmo;
    reachExit(game);
    game.selectUpgrade(game.upgrades.choices[0].id);
    game.confirmUpgrade();
    expect(game.gun.id).toBe('shotgun');
    expect(game.stats.maxAmmo).toBeGreaterThanOrEqual(maxAmmo);
    expect(game.ammo).toBe(game.stats.maxAmmo);
  });

  it('also clears the shot in progress at the FINAL BOSS hand-off', () => {
    const game = new GameModel(false, seeded(35));
    game.gun.equip('burst');
    hold(game, 1 / 120, 0, true);
    expect(game.gun.bursting).toBe(true);
    game.jumpToBoss();
    expect(game.gun.id).toBe('burst');
    expect(game.gun.bursting).toBe(false);
  });
});

describe('gun modules across the run', () => {
  it('carries the equipped weapon into the FINAL BOSS', () => {
    const game = new GameModel(false, seeded(12));
    game.gun.equip('shotgun');
    game.jumpToBoss();
    expect(game.state).toBe('boss');
    expect(game.gun.id).toBe('shotgun');
  });
  it.each(GUN_MODULE_IDS)('%s can reach NIMUSHI\'s eye', id => {
    const game = new GameModel(false, seeded(21));
    game.jumpToNimushi();
    game.platforms = []; game.doodads = [];
    game.gun.equip(id);
    game.stats.maxAmmo = 40; game.ammo = 40;
    const before = game.boss.hp;
    const reach = gunModule(id).range;
    for (let i = 0; i < 480; i++) {
      game.player.invincible = 99; game.ammo = 40;
      game.player.x = game.boss.x;
      // Fire from where the fight actually puts the player. NIMUSHI holds a share of the VIEWPORT
      // now, so the distance to the eye is the same for everyone and cannot be shortened by diving
      // -- which makes "can this module reach" a real question rather than one the fixture answers
      // for itself by teleporting the player into range.
      game.player.vy = 0;
      // Pulsed: BURST and the other single-shot modules fire once per PRESS, not per frame.
      game.step(1 / 120, 0, i % 8 < 4);
    }
    expect(game.boss.hp).toBeLessThan(before);
  });
  it('returns to MACHINE GUN on a fresh run, after RETRY or PLAY AGAIN', () => {
    const finished = armed('laser');
    expect(finished.gun.id).toBe('laser');
    // Both RETRY and PLAY AGAIN build a new GameModel, exactly as the scene does.
    expect(new GameModel(false, seeded(1)).gun.id).toBe('machine');
    const system = new GunModuleSystem();
    system.equip('shotgun');
    system.reset();
    expect(system.id).toBe('machine');
  });
});
