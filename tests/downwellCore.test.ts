import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { BALANCE, JUMP, WORLD, initialStats } from '../src/data/balance';
import { COMBO_TIERS, comboTierFor } from '../src/data/combo';
import { GUN_MODULES, type GunModuleId } from '../src/data/gunModules';
import { spawnEnemy, type Enemy } from '../src/data/enemies';
import { clearViaExit } from './exitHelper';
import type { Platform } from '../src/systems/StageGenerator';

/**
 * Fixtures are SEEDED, never `Math.random`.
 *
 * A procedural fixture built from the global RNG is a different world on every run, so a test over
 * one is really a sample of many -- it passes almost always and fails for reasons nobody can
 * reproduce. Three separate intermittent failures in this suite were traced to exactly that.
 * Seeding changes no assertion: it fixes WHICH world each one is asked about.
 */
const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

/**
 * The Downwell CORE loop, as this project now implements it.
 *
 *   ACTION      -- one input. Grounded it jumps; airborne it fires the gunboots.
 *   CHARGE      -- 8 to start, refilled by landing AND by stomping, spendable down to the last
 *                  round even when a volley costs more than is left.
 *   COMBO       -- counts kills between touchdowns and is SETTLED by landing, not by reaching a
 *                  number. Damage, stomps and SECTION boundaries all leave it alone.
 */

/** A model with nothing in the shaft, so a test owns exactly what the player can touch. */
function bare(practice = true) {
  const game = new GameModel(practice);
  game.platforms = []; game.enemies = []; game.pickups = []; game.hazards = [];
  game.player.x = 225; game.player.y = 180; game.player.vy = 0; game.player.grounded = -1;
  return game;
}
/** One ordinary ledge directly under the player. */
function ledge(game: GameModel, extra: Partial<Platform> = {}) {
  const platform: Platform = { id: 41, x: 120, y: game.player.y + 40, width: 210, breakable: false, state: 'stable', ...extra };
  game.platforms = [platform];
  game.player.vy = 240;
  return platform;
}
const tick = (game: GameModel, seconds: number, direction = 0, action = false) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) game.step(1 / 120, direction, action);
};
/** Land the player, then leave them standing with the events drained. */
function stand(game: GameModel, extra: Partial<Platform> = {}) {
  const platform = ledge(game, extra);
  tick(game, 0.6);
  expect(game.player.grounded).toBe(platform.id);
  game.events.length = 0;
  return platform;
}
/** One ACTION press and release, as an input buffer delivers it. */
function press(game: GameModel, held = 0.1) {
  tick(game, held, 0, true);
  tick(game, 0.05, 0, false);
}

describe('Downwell core: ACTION is jump on the ground and fire in the air', () => {
  it('jumps on the grounded frame and fires nothing on it', () => {
    const game = bare();
    const platform = stand(game);
    game.step(1 / 120, 0, true);                  // the one frame the player is still standing
    expect(game.events.filter(e => e.type === 'shot')).toEqual([]);
    expect(game.bullets).toEqual([]);
    expect(game.events.some(e => e.type === 'jump')).toBe(true);
    expect(game.player.grounded).toBe(-1);
    game.events.length = 0;
    tick(game, 0.2, 0, false);                    // released: a tap is a jump and nothing else
    expect(game.events.filter(e => e.type === 'shot')).toEqual([]);
    expect(game.player.y).toBeLessThan(platform.y - 15);
  });
  it('rises about as far as the configured impulse says, and never as far as the row above', () => {
    const game = bare();
    const platform = stand(game);
    const floor = game.player.y;
    let highest = floor;
    game.step(1 / 120, 0, true);
    for (let i = 0; i < 120 && game.player.grounded === -1; i++) { game.step(1 / 120, 0, false); highest = Math.min(highest, game.player.y); }
    const apex = floor - highest;
    expect(apex).toBeGreaterThan(JUMP.impulse ** 2 / (2 * BALANCE.gravity) * 0.7);
    expect(apex).toBeLessThan(JUMP.impulse ** 2 / (2 * BALANCE.gravity) * 1.3);
    // A jump repositions; it can never undo a row of descent.
    expect(apex).toBeLessThan(200);
    expect(platform.y).toBeGreaterThan(0);
  });
  it('fires while airborne, exactly as it always did', () => {
    const game = bare();
    game.platforms = [];
    game.player.vy = 0;
    game.events.length = 0;
    press(game, 1 / 60);
    expect(game.events.some(e => e.type === 'shot')).toBe(true);
    expect(game.events.some(e => e.type === 'jump')).toBe(false);
  });
  it('refuses to shoot from every kind of ground, not just ordinary ledges', () => {
    const grounds: [string, Partial<Platform>][] = [
      ['normal', {}],
      ['BREAK BLOCK', { breakBlock: { hits: 0, durability: 3, slot: 0, reward: false } }],
      ['AREA 4 collapse', { breakable: true }],
    ];
    for (const [name, extra] of grounds) {
      const game = bare();
      stand(game, extra);
      // Hold ACTION for a while WITHOUT letting the player leave: pin them back down each frame,
      // so every frame measured is a grounded one.
      const platform = game.platforms[0];
      game.collapse.reset(); platform.state = 'stable';
      for (let i = 0; i < 48; i++) {
        game.player.y = platform.y - 15; game.player.vy = 0; game.player.grounded = platform.id;
        game.step(1 / 120, 0, true);
      }
      expect({ name, shots: game.events.filter(e => e.type === 'shot').length }).toEqual({ name, shots: 0 });
      expect({ name, bullets: game.bullets.length }).toEqual({ name, bullets: 0 });
      expect({ name, jumps: game.events.filter(e => e.type === 'jump').length > 0 }).toEqual({ name, jumps: true });
    }
  });
  it('lets a held ACTION jump and then fire, once the player is actually airborne', () => {
    const game = bare();
    stand(game);
    tick(game, 0.5, 0, true);              // held the whole way
    expect(game.events.some(e => e.type === 'jump')).toBe(true);
    expect(game.events.some(e => e.type === 'shot')).toBe(true);
  });
});

describe('Downwell core: CHARGE', () => {
  it('starts a run at 8 of 8, and a retry does too', () => {
    expect(BALANCE.maxAmmo).toBe(8);
    expect(initialStats().maxAmmo).toBe(8);
    const game = new GameModel();
    expect([game.ammo, game.stats.maxAmmo]).toEqual([8, 8]);
    const retry = new GameModel();
    expect([retry.ammo, retry.stats.maxAmmo]).toEqual([8, 8]);
  });
  it('keeps the original cost of all seven modules', () => {
    const costs: Record<GunModuleId, number> = { machine: 1, noppy: 1, puncher: 2, triple: 2, burst: 3, laser: 4, shotgun: 5 };
    for (const [id, cost] of Object.entries(costs)) expect({ id, cost: GUN_MODULES[id as GunModuleId].ammoCost }).toEqual({ id, cost });
    expect(Object.keys(GUN_MODULES).length).toBe(7);
  });
  it('spends the last round even when the volley costs more than is left', () => {
    for (const [id, cost] of Object.entries(GUN_MODULES).filter(([, def]) => def.ammoCost > 1)) {
      const game = bare();
      game.gun.equip(id as GunModuleId);
      game.platforms = []; game.player.vy = 0;
      game.ammo = 1;
      game.events.length = 0;
      press(game, 1 / 60);
      expect({ id, fired: game.events.some(e => e.type === 'shot') }).toEqual({ id, fired: true });
      expect({ id, ammo: game.ammo }).toEqual({ id, ammo: 0 });
      expect(cost.ammoCost).toBeGreaterThan(1);
    }
  });
  it('refuses to fire at zero, for every module', () => {
    for (const id of Object.keys(GUN_MODULES) as GunModuleId[]) {
      const game = bare();
      game.gun.equip(id);
      game.platforms = []; game.player.vy = 0;
      game.ammo = 0;
      game.events.length = 0;
      press(game, 0.2);
      expect({ id, fired: game.events.some(e => e.type === 'shot') }).toEqual({ id, fired: false });
      expect({ id, empty: game.events.some(e => e.type === 'empty') }).toEqual({ id, empty: true });
    }
  });
  it('lets a BURST bought with the last round finish every reserved shot', () => {
    const game = bare();
    game.gun.equip('burst');
    game.platforms = []; game.player.vy = 0;
    game.ammo = 1;
    game.events.length = 0;
    game.step(1 / 120, 0, true);
    expect(game.ammo).toBe(0);
    expect(game.gun.bursting).toBe(true);
    tick(game, 0.6, 0, false);             // trigger released: the tail is already paid for
    expect(game.events.filter(e => e.type === 'shot').length).toBe(GUN_MODULES.burst.burst!.count);
    expect(game.ammo).toBe(0);
  });
});

describe('Downwell core: stomping reloads and never settles', () => {
  const stompable = (game: GameModel, id = 77) => {
    const enemy: Enemy = spawnEnemy('slime', id, game.player.x, game.player.y + 40);
    game.enemies = [enemy];
    game.player.vy = 300;
    return enemy;
  };
  it('fills CHARGE, adds one to COMBO and bounces', () => {
    const game = bare();
    game.platforms = [];
    game.ammo = 1; game.combo = 7;
    const enemy = stompable(game);
    tick(game, 0.1);
    expect(enemy.alive).toBe(false);
    expect(game.combo).toBe(8);
    expect(game.ammo).toBe(game.stats.maxAmmo);
    expect(game.player.vy).toBeLessThan(0);
    expect(game.player.grounded).toBe(-1);
  });
  it('does not settle the chain, however far past a tier it goes', () => {
    const game = bare();
    game.platforms = [];
    const maxAmmo = game.stats.maxAmmo, hp = game.hp;
    for (let i = 0; i < 9; i++) {
      game.player.y = 180; game.player.vy = 300;
      stompable(game, 200 + i);
      tick(game, 0.1);
    }
    expect(game.combo).toBe(9);
    // Corpses still drop their own COIN; what must not happen is a settlement.
    expect(game.events.some(e => e.type === 'comboSettle')).toBe(false);
    expect([game.stats.maxAmmo, game.hp, game.health.overflowHealing]).toEqual([maxAmmo, hp, 0]);
  });
});

describe('Downwell core: COMBO is settled by landing', () => {
  /** Land at `combo` and report what the landing paid. */
  function settle(combo: number, extra: Partial<Platform> = {}) {
    const game = bare();
    game.combo = combo;
    game.ammo = 0;
    const before = { coins: game.coins.walletCoins + game.coins.coins.length, maxAmmo: game.stats.maxAmmo, hp: game.hp, maxHp: game.health.maxHp, overflow: game.health.overflowHealing };
    const platform = ledge(game, extra);
    game.events.length = 0;
    tick(game, 0.6);
    expect(game.player.grounded).toBe(platform.id);
    const settled = game.events.find(e => e.type === 'comboSettle');
    return {
      game, settled,
      combo: game.combo,
      reloaded: game.ammo === game.stats.maxAmmo,
      // Value, not pickups: a settled chain is paid straight in, and anything lying loose in the
      // shaft is counted at what it is actually worth.
      coins: game.coins.walletCoins + game.coins.coins.reduce((sum, c) => sum + c.value, 0) - before.coins,
      maxCharge: game.stats.maxAmmo - before.maxAmmo,
      hearts: game.hp - before.hp + (game.health.maxHp - before.maxHp) + (game.health.overflowHealing - before.overflow),
    };
  }
  it('pays nothing below the first tier, but still reloads and zeroes the chain', () => {
    for (const combo of [0, 1, 7]) {
      const r = settle(combo);
      expect({ combo, coins: r.coins, maxCharge: r.maxCharge, hearts: r.hearts }).toEqual({ combo, coins: 0, maxCharge: 0, hearts: 0 });
      expect({ combo, settled: !!r.settled }).toEqual({ combo, settled: false });
      expect({ combo, chain: r.combo, reloaded: r.reloaded }).toEqual({ combo, chain: 0, reloaded: true });
    }
  });
  it('pays a flat 100 at every tier, as the original does', () => {
    // What deepens with the chain is what comes WITH the money, never the money itself.
    for (const tier of COMBO_TIERS) expect(tier.coins).toBe(100);
  });
  it('pays 100 from 8, 100 + CHARGE from 15, and 100 + CHARGE + LIFE from 25', () => {
    const expected: [number, number, number, number][] = [
      // combo, coins, maxCharge, hearts
      [8, 100, 0, 0],
      [14, 100, 0, 0],
      [15, 100, 1, 0],
      [24, 100, 1, 0],
      [25, 100, 1, 1],
      [40, 100, 1, 1],
      // Far past the top tier: still the top tier, still once.
      [100, 100, 1, 1],
    ];
    for (const [combo, coins, maxCharge, hearts] of expected) {
      const r = settle(combo);
      expect({ combo, coins: r.coins, maxCharge: r.maxCharge, hearts: r.hearts }).toEqual({ combo, coins, maxCharge, hearts });
      expect({ combo, chain: r.combo }).toEqual({ combo, chain: 0 });
      expect({ combo, settled: r.settled?.value }).toEqual({ combo, settled: combo });
    }
  });
  it('pays the settled 100 into BOTH totals, not onto the floor', () => {
    const r = settle(8);
    // Awarded rather than scattered: nothing to catch, nothing to lose.
    expect(r.game.coins.coins).toHaveLength(0);
    expect(r.game.coins.walletCoins).toBe(100);
    expect(r.game.coins.scoreCoins).toBe(100);
    // And the label the HUD reads says what was paid.
    expect(r.settled?.stage).toBe(COMBO_TIERS[0].label);
    expect(COMBO_TIERS.map(t => t.label)).toEqual(['+100', '+100 + CHARGE', '+100 + CHARGE + LIFE']);
  });
  it('pays the deepest tier once, never the tiers below it as well', () => {
    expect(comboTierFor(7)).toBeUndefined();
    expect(comboTierFor(8)).toBe(COMBO_TIERS[0]);
    expect(comboTierFor(14)).toBe(COMBO_TIERS[0]);
    expect(comboTierFor(15)).toBe(COMBO_TIERS[1]);
    expect(comboTierFor(24)).toBe(COMBO_TIERS[1]);
    expect(comboTierFor(25)).toBe(COMBO_TIERS[2]);
    expect(comboTierFor(999)).toBe(COMBO_TIERS[2]);
  });
  it('tops the magazine up to the new maximum when a tier grew it', () => {
    const r = settle(15);
    expect(r.maxCharge).toBe(1);
    expect(r.game.ammo).toBe(r.game.stats.maxAmmo);
  });
  it('sends the 25 heart through HealthSystem, into overflow when HP is full', () => {
    const full = settle(25);
    expect(full.game.hp).toBe(4);
    expect(full.game.health.overflowHealing).toBe(1);
    const hurt = bare();
    hurt.damage(1, 'enemy');
    hurt.combo = 25;
    ledge(hurt);
    tick(hurt, 0.6);
    expect(hurt.hp).toBe(4);
    expect(hurt.health.overflowHealing).toBe(0);
  });
  it('settles the same way on a BREAK BLOCK and on an AREA 4 collapsing ledge', () => {
    for (const [name, extra] of [
      ['BREAK BLOCK', { breakBlock: { hits: 0, durability: 3, slot: 0, reward: false } }],
      ['collapse', { breakable: true }],
    ] as [string, Partial<Platform>][]) {
      const r = settle(15, extra);
      expect({ name, coins: r.coins, maxCharge: r.maxCharge, chain: r.combo, reloaded: r.reloaded })
        .toEqual({ name, coins: COMBO_TIERS[1].coins, maxCharge: 1, chain: 0, reloaded: true });
    }
  });
  it('never opens a screen or stops the run to pay out', () => {
    const r = settle(25);
    expect(r.game.state).toBe('playing');
    expect(r.game.paused).toBe(false);
  });
});

describe('Downwell core: only a landing ends a chain', () => {
  it('keeps the chain through accepted damage', () => {
    const game = bare();
    game.platforms = [];
    game.combo = 12;
    expect(game.damage(1, 'enemy')).toBe(true);
    expect(game.hp).toBe(3);
    expect(game.combo).toBe(12);
  });
  it('keeps the chain across a SECTION boundary, and pays nothing at the rest point', () => {
    const game = new GameModel(false, seeded(4405));
    game.combo = 12;
    const coins = game.coins.walletCoins;
    clearViaExit(game);
    expect(game.stage.label).toBe('1-2');
    expect(game.combo).toBe(12);
    // No tier was paid on the way through: the chosen upgrade card is the only thing that changed.
    expect(game.coins.walletCoins).toBe(coins);
    expect(game.events.some(e => e.type === 'comboSettle')).toBe(false);
  });
  it('keeps the chain across an AREA boundary', () => {
    const game = new GameModel(false, seeded(4406));
    for (let i = 0; i < 2; i++) clearViaExit(game);
    expect(game.stage.label).toBe('1-3');
    game.combo = 9;
    clearViaExit(game);
    expect(game.stage.label).toBe('2-1');
    expect(game.combo).toBe(9);
  });
  it('keeps the chain into the FINAL BOSS', () => {
    const game = new GameModel(false, seeded(4407));
    game.combo = 17;
    game.jumpToBoss();
    expect(game.state).toBe('boss');
    expect(game.combo).toBe(17);
  });
  it('has no immediate reward left anywhere: reaching a number pays nothing', () => {
    const game = bare();
    game.platforms = [];
    const maxAmmo = game.stats.maxAmmo, hp = game.hp;
    for (let i = 0; i < 30; i++) {
      game.player.y = 180; game.player.vy = 300;
      game.enemies = [spawnEnemy('slime', 900 + i, game.player.x, game.player.y + 40)];
      tick(game, 0.1);
    }
    expect(game.combo).toBe(30);
    // Thirty kills in one chain and not a single tier paid: only landing banks anything.
    expect(game.events.some(e => e.type === 'comboSettle')).toBe(false);
    expect([game.stats.maxAmmo, game.hp, game.health.overflowHealing]).toEqual([maxAmmo, hp, 0]);
  });
});

describe('Downwell core: reloading and settling are separate jobs', () => {
  it('exposes them as two calls, so a future Safe Zone can reload without banking a chain', () => {
    const game = bare();
    game.ammo = 0; game.combo = 11;
    game.reloadCharge();
    expect(game.ammo).toBe(game.stats.maxAmmo);
    expect(game.combo).toBe(11);
    const coins = game.coins.walletCoins + game.coins.coins.length;
    game.settleCombo();
    expect(game.combo).toBe(0);
    expect(game.coins.walletCoins + game.coins.coins.length).toBeGreaterThan(coins);
  });
  it('keeps WORLD untouched by any of this', () => {
    expect(WORLD.startY).toBe(180);
  });
});
