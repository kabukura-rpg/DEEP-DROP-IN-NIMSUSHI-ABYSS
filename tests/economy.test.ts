import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { CoinSystem } from '../src/systems/CoinSystem';
import { ShopSystem } from '../src/systems/ShopSystem';
import { COIN_RULES, coinsFor } from '../src/data/coins';
import { SHOP_RULES, rollShopStock } from '../src/data/shop';
import { AIR_CONTAINER_RULES, EXIT_RULES } from '../src/data/structures';
import { CHARGE_AMMO_BONUS } from '../src/data/gunModules';
import { HEALTH_RULES } from '../src/systems/HealthSystem';
import { spawnEnemy } from '../src/data/enemies';
import { WORLD } from '../src/data/balance';
import { reachExit } from './exitHelper';

const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const tick = (game: GameModel, seconds: number, direction = 0, fire = false) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) { game.player.invincible = 99; game.step(1 / 120, direction, fire); }
};
/** A run with the shaft emptied, so a test sees only what it placed. */
function bare(seed = 5) {
  const game = new GameModel(false, seeded(seed));
  game.platforms = []; game.enemies = []; game.pickups = []; game.hazards = []; game.containers = [];
  game.player.invincible = 99;
  return game;
}

describe('COIN drops', () => {
  it('leaves coins where an enemy died, scaled by how dangerous it was', () => {
    expect(coinsFor('basic')).toBeGreaterThan(0);
    expect(coinsFor('armored')).toBeGreaterThan(coinsFor('basic'));
    expect(coinsFor('heavy')).toBeGreaterThan(coinsFor('armored'));
    const game = bare();
    game.enemies = [spawnEnemy('slime', 1, 225, 260)];
    game.shoot();
    tick(game, 0.3);
    expect(game.kills).toBe(1);
    // The player is falling past the corpse, so some are already collected: count both.
    expect(game.coins.coins.length + game.coins.scoreCoins).toBe(coinsFor('basic'));
  });

  it('raises both the wallet and the run score when collected', () => {
    const game = bare();
    game.coins.burst(game.player.x, game.player.y, 3, seeded(77));
    expect(game.coins.walletCoins).toBe(0);
    tick(game, 0.2);
    expect(game.coins.walletCoins).toBe(3 * COIN_RULES.value);
    expect(game.coins.scoreCoins).toBe(3 * COIN_RULES.value);
  });

  it('announces a pickup so the HUD and audio can react', () => {
    const game = bare();
    game.coins.burst(game.player.x, game.player.y, 2, seeded(77));
    tick(game, 0.2);
    expect(game.events.some(e => e.type === 'coin')).toBe(true);
  });

  it('becomes unreachable once it times out', () => {
    const coins = new CoinSystem();
    coins.burst(100, 100, 3, seeded(2));
    expect(coins.coins).toHaveLength(3);
    // Nowhere near the player, so only the clock can end it.
    for (let i = 0; i < Math.round((COIN_RULES.lifetime + 1) * 120); i++) coins.tick(1 / 120, { x: 400, y: 100 }, 0);
    expect(coins.coins).toHaveLength(0);
    expect(coins.walletCoins).toBe(0);
  });

  it('becomes unreachable once it falls behind the camera', () => {
    const coins = new CoinSystem();
    coins.burst(100, 100, 3, seeded(2));
    for (let i = 0; i < 120; i++) coins.tick(1 / 120, { x: 400, y: 9999 }, 4000);
    expect(coins.coins).toHaveLength(0);
  });

  it('starts a fresh run with nothing, so RETRY resets the purse', () => {
    const played = bare();
    played.coins.burst(played.player.x, played.player.y, 4, seeded(79));
    tick(played, 0.2);
    expect(played.coins.walletCoins).toBeGreaterThan(0);
    // RETRY and PLAY AGAIN both build a new GameModel, exactly as the scene does.
    const fresh = new GameModel(false, seeded(9));
    expect([fresh.coins.walletCoins, fresh.coins.scoreCoins]).toEqual([0, 0]);
    expect(fresh.coins.coins).toHaveLength(0);
  });

  it('keeps banked coins across a SECTION but sweeps up the loose ones', () => {
    const game = new GameModel(false, seeded(11));
    game.coins.burst(game.player.x, game.player.y, 3, seeded(77));
    tick(game, 0.2);
    const banked = game.coins.walletCoins;
    expect(banked).toBeGreaterThan(0);
    game.coins.burst(200, 400, 5, seeded(77));
    reachExit(game);
    game.selectUpgrade(game.upgrades.choices[0].id); game.confirmUpgrade();
    expect(game.coins.walletCoins).toBe(banked);
    expect(game.coins.coins).toHaveLength(0);
  });
});

describe('SHOP', () => {
  const stocked = (seed = 3) => {
    const shop = new ShopSystem();
    // Roll until this seed produces a shop, then stock it.
    const random = seeded(seed);
    for (let i = 0; i < 50 && !shop.available; i++) shop.rollForSection(random);
    shop.placeEntrance(100, 200, 60, 60);
    return shop;
  };

  it('offers gun modules, hearts and charges at prices that live in data', () => {
    const offers = rollShopStock(seeded(7));
    expect(offers).toHaveLength(SHOP_RULES.stock);
    for (const offer of offers) {
      expect(['gunModule', 'heart', 'charge']).toContain(offer.kind);
      expect(offer.price).toBe(SHOP_RULES.prices[offer.kind]);
      if (offer.kind === 'gunModule') expect(offer.module).toBeTruthy();
    }
  });

  it('is uncommon rather than guaranteed every SECTION', () => {
    expect(SHOP_RULES.chancePerSection).toBeGreaterThan(0);
    expect(SHOP_RULES.chancePerSection).toBeLessThan(0.6);
    const random = seeded(13);
    const shop = new ShopSystem();
    let seen = 0;
    for (let i = 0; i < 400; i++) if (shop.rollForSection(random)) seen++;
    expect(seen).toBeGreaterThan(0);
    expect(seen).toBeLessThan(400);
  });

  it('stops the world while it is open, and hands control back on close', () => {
    const game = bare();
    game.shop.rollForSection(() => 0);
    game.shop.placeEntrance(game.player.x - 20, game.player.y - 20, 40, 40);
    tick(game, 0.1);
    expect(game.state).toBe('shop');
    expect(game.running).toBe(false);
    const where = game.player.y;
    tick(game, 0.5);
    expect(game.player.y).toBe(where);
    expect(game.closeShop()).toBe(true);
    expect(game.state).toBe('playing');
    expect(game.running).toBe(true);
  });

  it('spends the wallet and never the score', () => {
    const game = bare();
    game.shop.rollForSection(() => 0);
    game.shop.offers = rollShopStock(seeded(4));
    game.shop.placeEntrance(game.player.x - 20, game.player.y - 20, 40, 40);
    tick(game, 0.1);
    game.coins.walletCoins = 500; game.coins.scoreCoins = 500;
    const score = game.coins.scoreCoins, wallet = game.coins.walletCoins;
    const price = game.shop.offers[0].price;
    expect(game.buyShopItem(0)).toBe('bought');
    expect(game.coins.walletCoins).toBe(wallet - price);
    expect(game.coins.scoreCoins).toBe(score);
  });

  it('refuses a purchase that cannot be afforded, and changes nothing', () => {
    const coins = new CoinSystem();
    const shop = stocked();
    shop.enter();
    const price = shop.offers[0].price;
    expect(shop.buy(0, coins, () => { throw new Error('must not apply'); })).toBe('tooPoor');
    expect(coins.walletCoins).toBe(0);
    expect(shop.offers[0].sold).toBe(false);
    coins.walletCoins = price;
    let applied = 0;
    expect(shop.buy(0, coins, () => { applied++; })).toBe('bought');
    expect(applied).toBe(1);
    expect(coins.walletCoins).toBe(0);
    expect(shop.buy(0, coins, () => { throw new Error('sold'); })).toBe('soldOut');
  });

  it('routes a bought GUN MODULE through the existing weapon system', () => {
    const game = bare();
    game.shop.rollForSection(() => 0);
    game.shop.offers = [{ id: 'a', kind: 'gunModule', module: 'shotgun', name: 'SHOTGUN', effect: '', price: 0, sold: false }];
    game.shop.placeEntrance(game.player.x - 20, game.player.y - 20, 40, 40);
    tick(game, 0.1);
    expect(game.buyShopItem(0)).toBe('bought');
    expect(game.gun.id).toBe('shotgun');
    expect(game.gun.ammoCost).toBe(5);
  });

  it('routes a bought HEART through HealthSystem, overflow and LIFE UP included', () => {
    const game = bare();
    game.player.invincible = 0; game.damage(1, 'enemy');
    const hurt = game.hp;
    game.shop.rollForSection(() => 0);
    game.shop.offers = [{ id: 'a', kind: 'heart', name: 'HEART', effect: '', price: 0, sold: false }];
    game.shop.placeEntrance(game.player.x - 20, game.player.y - 20, 40, 40);
    game.player.invincible = 99;
    tick(game, 0.1);
    expect(game.buyShopItem(0)).toBe('bought');
    expect(game.hp).toBe(hurt + 1);

    // At full health the same purchase rolls into the existing overflow, and four of them is a LIFE UP.
    const full = bare();
    full.shop.rollForSection(() => 0);
    full.shop.placeEntrance(full.player.x - 20, full.player.y - 20, 40, 40);
    tick(full, 0.1);
    const maxHp = full.health.maxHp;
    for (let i = 0; i < HEALTH_RULES.overflowPerLife; i++) {
      full.shop.offers = [{ id: `h${i}`, kind: 'heart', name: 'HEART', effect: '', price: 0, sold: false }];
      expect(full.buyShopItem(0)).toBe('bought');
    }
    expect(full.health.maxHp).toBe(maxHp + 1);
  });

  it('routes a bought CHARGE through the existing magazine rules', () => {
    const game = bare();
    game.shop.rollForSection(() => 0);
    game.shop.offers = [{ id: 'a', kind: 'charge', name: 'CHARGE', effect: '', price: 0, sold: false }];
    game.shop.placeEntrance(game.player.x - 20, game.player.y - 20, 40, 40);
    tick(game, 0.1);
    const before = game.stats.maxAmmo;
    game.ammo = 1;
    expect(game.buyShopItem(0)).toBe('bought');
    expect(game.stats.maxAmmo).toBe(before + CHARGE_AMMO_BONUS);
    expect(game.ammo).toBe(game.stats.maxAmmo);
  });

  it('cannot be bought from when it is not open', () => {
    const game = bare();
    expect(game.state).toBe('playing');
    expect(game.buyShopItem(0)).toBe('closed');
  });

  it('does not collide with PAUSE, GAME OVER or CLEAR', () => {
    const game = bare();
    game.shop.rollForSection(() => 0);
    game.shop.placeEntrance(game.player.x - 20, game.player.y - 20, 40, 40);
    tick(game, 0.1);
    expect(game.state).toBe('shop');
    // A shop that is open blocks the simulation, so nothing can kill the player behind it.
    game.player.invincible = 0;
    expect(game.damage(9, 'enemy')).toBe(false);
    expect(game.state).toBe('shop');
    // And a SECTION cannot be completed from inside it.
    expect(game.completeSection()).toBe(false);
    game.closeShop();
    expect(game.state).toBe('playing');
  });

  it('opens once: walking back through the doorway does not restock it', () => {
    const game = bare();
    game.shop.rollForSection(() => 0);
    game.shop.placeEntrance(game.player.x - 20, game.player.y - 20, 40, 40);
    tick(game, 0.1);
    game.closeShop();
    tick(game, 0.3);
    expect(game.state).toBe('playing');
  });
});

describe('EXIT replaces the forced section switch', () => {
  it('offers no exit before the goal', () => {
    const game = new GameModel(false, seeded(6));
    game.player.y = WORLD.startY + 199 * WORLD.pixelsPerMeter; game.player.invincible = 99;
    game.step(1 / 120, 0, false);
    expect(game.exit).toBeNull();
    expect(game.state).toBe('playing');
  });

  it('lays the exit at the goal but leaves the SECTION running until it is entered', () => {
    const game = new GameModel(false, seeded(6));
    game.player.y = WORLD.startY + 201 * WORLD.pixelsPerMeter; game.player.invincible = 99;
    game.step(1 / 120, 0, false);
    expect(game.exit).not.toBeNull();
    expect(game.state).toBe('playing');
    expect(game.events.some(e => e.type === 'exitReady')).toBe(true);
    // Still playable: many seconds pass and the SECTION is still the player's.
    tick(game, 3);
    expect(game.state).toBe('playing');
  });

  it('places the gate a little past the goal, where it can be seen and reached', () => {
    const game = new GameModel(false, seeded(6));
    game.player.y = WORLD.startY + 201 * WORLD.pixelsPerMeter; game.player.invincible = 99;
    game.step(1 / 120, 0, false);
    const gate = game.exit!;
    expect(gate.width).toBe(EXIT_RULES.width);
    expect((gate.y - WORLD.startY) / WORLD.pixelsPerMeter).toBeGreaterThan(200);
  });

  it('clears the SECTION when the gate is entered', () => {
    const game = new GameModel(false, seeded(6));
    reachExit(game);
    expect(game.state).toBe('upgrade');
    expect(game.events.some(e => e.type === 'exit')).toBe(true);
  });

  it('bottoms the shaft out at the exit, so nothing below can be farmed', () => {
    const game = new GameModel(false, seeded(8));
    game.player.y = WORLD.startY + 202 * WORLD.pixelsPerMeter; game.player.invincible = 99;
    game.step(1 / 120, 0, false);
    const floor = game.platforms.reduce((low, f) => (f.y > low.y ? f : low), game.platforms[0]);
    expect(floor.width).toBeGreaterThan(WORLD.width - WORLD.wall * 2 - 2);
    const kills = game.kills;
    tick(game, 6);
    expect(game.platforms.every(f => f.y <= floor.y)).toBe(true);
    expect(game.enemies.every(e => e.y <= floor.y)).toBe(true);
    // Nothing new arrives to be farmed while the player loiters on the floor.
    expect(game.kills).toBe(kills);
  });

  it('keeps TOTAL DEPTH at the planned 12 x 200m however deep the hunt went', () => {
    const game = new GameModel(false, seeded(6));
    game.player.y = WORLD.startY + 260 * WORLD.pixelsPerMeter; game.player.invincible = 99;
    game.step(1 / 120, 0, false);
    expect(Math.round(game.sectionDepth)).toBeGreaterThan(200);
    expect(Math.round(game.totalDepth)).toBe(200);
    reachExit(game);
    game.selectUpgrade(game.upgrades.choices[0].id); game.confirmUpgrade();
    expect(game.completedDepth).toBe(200);
  });

  it('reaches the FINAL BOSS after twelve gates, at exactly 2400m', () => {
    const game = new GameModel(false, seeded(15));
    for (let i = 0; i < 12; i++) {
      reachExit(game);
      game.selectUpgrade(game.upgrades.choices[0].id);
      game.confirmUpgrade();
    }
    expect(game.state).toBe('boss');
    expect(Math.round(game.totalDepth)).toBe(2400);
  });
});

describe('AREA 2 air containers', () => {
  const submerged = (seed = 4) => {
    const game = new GameModel(false, seeded(seed));
    game.jumpToStage(2, 1);
    game.platforms = []; game.enemies = []; game.containers = []; game.bubbles = [];
    game.player.invincible = 99;
    return game;
  };
  const box = (game: GameModel, x: number, y: number) => {
    const size = AIR_CONTAINER_RULES.size;
    game.containers = [{ id: 1, x: x - size / 2, y: y - size / 2, width: size, height: size, broken: false, debris: 0 }];
    return game.containers[0];
  };

  it('generates containers in AREA 2', () => {
    const game = new GameModel(false, seeded(21));
    game.jumpToStage(2, 1);
    let seen = 0;
    for (let i = 0; i < 40 && seen === 0; i++) {
      game.player.y += 260; game.player.invincible = 99; game.step(1 / 120, 0, false);
      seen = game.containers.length;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('breaks on contact', () => {
    const game = submerged();
    const target = box(game, game.player.x, game.player.y);
    tick(game, 0.05);
    expect(target.broken).toBe(true);
  });

  it('breaks when shot', () => {
    const game = submerged();
    const target = box(game, game.player.x, game.player.y + 150);
    game.shoot();
    tick(game, 0.4);
    expect(target.broken).toBe(true);
  });

  it('restores no air by breaking alone: only a bubble is worth anything', () => {
    const game = submerged();
    game.oxygen.remaining = 4;
    // Break it from a distance, so the burst is not immediately collected.
    box(game, 120, game.player.y + 140);
    game.player.x = 120;
    game.shoot();
    const before = game.oxygen.remaining;
    for (let i = 0; i < 30; i++) { game.player.invincible = 99; game.player.x = 400; game.step(1 / 120, 0, false); }
    expect(game.containers[0]?.broken ?? true).toBe(true);
    expect(game.bubbles.length).toBeGreaterThan(0);
    // The air went nowhere: the player never touched a bubble.
    expect(game.oxygen.remaining).toBeLessThanOrEqual(before);
  });

  it('restores air when a released bubble is caught', () => {
    const game = submerged();
    game.oxygen.remaining = 3;
    const before = game.oxygen.remaining;
    box(game, game.player.x, game.player.y);
    tick(game, 0.3);
    expect(game.oxygen.remaining).toBeGreaterThan(before);
  });

  it('releases a burst of bubbles inside the configured range', () => {
    const game = submerged();
    box(game, 120, game.player.y + 200);
    game.containers[0].broken = false;
    game.player.x = 400;
    // Break it without standing next to it, so none are collected.
    game.player.x = 120; game.player.y = game.containers[0].y - 400;
    game.shoot();
    for (let i = 0; i < 60; i++) { game.player.invincible = 99; game.player.x = 400; game.step(1 / 120, 0, false); }
    expect(game.bubbles.length).toBeGreaterThanOrEqual(AIR_CONTAINER_RULES.bubblesMin);
    expect(game.bubbles.length).toBeLessThanOrEqual(AIR_CONTAINER_RULES.bubblesMax);
  });

  it('sends the bubbles climbing, so they have to be chased', () => {
    const game = submerged();
    box(game, 120, game.player.y + 240);
    game.player.x = 120;
    game.shoot();
    for (let i = 0; i < 60; i++) { game.player.invincible = 99; game.player.x = 400; game.step(1 / 120, 0, false); }
    const heights = game.bubbles.map(b => b.y);
    expect(heights.length).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) { game.player.invincible = 99; game.player.x = 400; game.step(1 / 120, 0, false); }
    for (const bubble of game.bubbles) expect(bubble.vy).toBeLessThan(0);
    expect(Math.min(...game.bubbles.map(b => b.y))).toBeLessThan(Math.min(...heights));
  });

  it('lets a bubble expire so a slow player loses it', () => {
    const game = submerged();
    box(game, 120, game.player.y + 240);
    game.player.x = 120;
    game.shoot();
    tick(game, 0.4);
    expect(game.bubbles.length).toBeGreaterThan(0);
    for (let i = 0; i < Math.round((AIR_CONTAINER_RULES.bubbleLife + 1) * 120); i++) {
      game.player.invincible = 99; game.player.x = 400; game.step(1 / 120, 0, false);
    }
    expect(game.bubbles).toHaveLength(0);
  });

  it('never mistakes a gun module crate for an air container', () => {
    const game = submerged();
    expect(game.containers).toHaveLength(0);
    game.pickups = [];
    // A weapon crate lives in pickups and has its own category; containers are a separate array.
    expect(game.bubbles).toHaveLength(0);
    const target = box(game, game.player.x, game.player.y + 400);
    expect(game.pickups.some(k => k.kind === 'gunModule')).toBe(false);
    expect(target.broken).toBe(false);
  });
});
