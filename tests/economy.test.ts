import { describe, expect, it } from 'vitest';
import { AREAS, PLANNED_TOTAL_DEPTH } from '../src/data/areas';
import { GameModel } from '../src/systems/GameModel';
import { CoinSystem } from '../src/systems/CoinSystem';
import { ShopSystem } from '../src/systems/ShopSystem';
import { COIN_RULES, COIN_VALUES, coinDropValue, coinsFor } from '../src/data/coins';
import { SHOP_ITEMS, SHOP_RULES, rollShopStock, shopItem, shopPrice, type ShopItemId } from '../src/data/shop';
import { AIR_CONTAINER_RULES, EXIT_RULES } from '../src/data/structures';
import { CHARGE_AMMO_BONUS } from '../src/data/gunModules';
import { HEALTH_RULES } from '../src/systems/HealthSystem';
import { spawnEnemy } from '../src/data/enemies';
import { spawnGunModule } from '../src/data/pickups';
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
  it('comes in two sizes worth 2 and 10', () => {
    expect(COIN_VALUES.small).toBe(2);
    expect(COIN_VALUES.large).toBe(10);
  });

  it('leaves SMALL COIN where an ordinary enemy died, and more from a dangerous one', () => {
    // The basic drop is one SMALL COIN. Tougher tiers leave more coins, not different ones.
    expect(coinsFor('basic')).toEqual({ count: 1, denomination: 'small' });
    expect(coinDropValue('basic')).toBe(COIN_VALUES.small);
    expect(coinDropValue('armored')).toBeGreaterThan(coinDropValue('basic'));
    expect(coinDropValue('heavy')).toBeGreaterThan(coinDropValue('armored'));
    const game = bare();
    game.enemies = [spawnEnemy('slime', 1, 225, 260)];
    game.shoot();
    tick(game, 0.3);
    expect(game.kills).toBe(1);
    // The player is falling past the corpse, so some are already collected: count value either way.
    const loose = game.coins.coins.reduce((sum, c) => sum + c.value, 0);
    expect(loose + game.coins.scoreCoins).toBe(coinDropValue('basic'));
  });

  it('raises both the wallet and the run score by what each coin is worth', () => {
    const small = bare();
    small.coins.burst(small.player.x, small.player.y, 1, seeded(77), 'small');
    expect(small.coins.walletCoins).toBe(0);
    tick(small, 0.2);
    expect([small.coins.walletCoins, small.coins.scoreCoins]).toEqual([2, 2]);

    const large = bare();
    large.coins.burst(large.player.x, large.player.y, 1, seeded(77), 'large');
    tick(large, 0.2);
    expect([large.coins.walletCoins, large.coins.scoreCoins]).toEqual([10, 10]);
  });

  it('counts value rather than pickups, so a mixed handful adds up', () => {
    const game = bare();
    game.coins.burst(game.player.x, game.player.y, 3, seeded(77), 'small');
    game.coins.burst(game.player.x, game.player.y, 2, seeded(78), 'large');
    tick(game, 0.3);
    expect(game.coins.walletCoins).toBe(3 * COIN_VALUES.small + 2 * COIN_VALUES.large);
    expect(game.coins.scoreCoins).toBe(game.coins.walletCoins);
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

describe('SHOP sells the original six, priced by AREA', () => {
  /** A stocked shelf with a doorway the player is already standing in. */
  const stocked = (seed = 3, area = 1) => {
    const shop = new ShopSystem();
    shop.stockForSection(seeded(seed), area);
    shop.placeEntrance(100, 200, 60, 60);
    return shop;
  };
  /** Put one named good on an already-open shop's shelf, free, so an effect is measured alone. */
  const withItemOn = (game: GameModel, item: ShopItemId, price = 0) => {
    const def = shopItem(item);
    game.shop.offers = [{ id: 'a', item, name: def.name, effect: def.effect, price, sold: false }];
    game.shop.placeEntrance(game.player.x - 20, game.player.y - 20, 40, 40);
    tick(game, 0.1);
    expect(game.state).toBe('shop');
    return game;
  };
  /** A fresh run parked in that shop. */
  const withItem = (item: ShopItemId, price = 0) => {
    const game = bare();
    const def = shopItem(item);
    game.shop.offers = [{ id: 'a', item, name: def.name, effect: def.effect, price, sold: false }];
    game.shop.placeEntrance(game.player.x - 20, game.player.y - 20, 40, 40);
    tick(game, 0.1);
    expect(game.state).toBe('shop');
    return game;
  };

  it('stocks exactly the six goods the original sells, and no weapon', () => {
    expect(SHOP_ITEMS.map(i => i.id)).toEqual(['riceBall', 'sushi', 'battery', 'carBattery', 'energyDrink', 'curry']);
    // Nothing on the shelf equips anything: a weapon is SAFE ZONE content and nothing else.
    for (const offer of rollShopStock(seeded(7))) expect('module' in offer).toBe(false);
  });

  it('gives each good its documented effect and nothing besides', () => {
    const effects: Record<ShopItemId, { hearts: number; maxCharge: number; maxHp: number }> = {
      riceBall: { hearts: 1, maxCharge: 0, maxHp: 0 },
      sushi: { hearts: 2, maxCharge: 0, maxHp: 0 },
      battery: { hearts: 0, maxCharge: 1, maxHp: 0 },
      carBattery: { hearts: 0, maxCharge: 2, maxHp: 0 },
      energyDrink: { hearts: 1, maxCharge: 1, maxHp: 0 },
      curry: { hearts: 0, maxCharge: 0, maxHp: 1 },
    };
    for (const item of SHOP_ITEMS) {
      expect({ hearts: item.hearts, maxCharge: item.maxCharge, maxHp: item.maxHp }).toEqual(effects[item.id]);
    }
  });

  it('prices every good by AREA index, using the original Normal Mode table', () => {
    const table: Record<ShopItemId, [number, number, number, number]> = {
      riceBall: [300, 500, 700, 900],
      sushi: [500, 700, 900, 1100],
      battery: [150, 350, 550, 750],
      carBattery: [250, 450, 650, 850],
      energyDrink: [400, 600, 800, 1000],
      curry: [1000, 1200, 1400, 1600],
    };
    for (const item of SHOP_ITEMS) {
      for (const area of [1, 2, 3, 4] as const) expect(shopPrice(item, area)).toBe(table[item.id][area - 1]);
      // Every good is dearer the deeper the run goes, without exception.
      for (const area of [2, 3, 4] as const) expect(shopPrice(item, area)).toBeGreaterThan(shopPrice(item, area - 1));
    }
  });

  it('offers three DIFFERENT goods, priced for the AREA the run is in', () => {
    for (const area of [1, 2, 3, 4] as const) {
      for (let seed = 1; seed <= 40; seed++) {
        const offers = rollShopStock(seeded(seed * 31), area);
        expect(offers).toHaveLength(SHOP_RULES.stock);
        expect(new Set(offers.map(o => o.item)).size).toBe(SHOP_RULES.stock);
        for (const offer of offers) expect(offer.price).toBe(shopPrice(shopItem(offer.item), area));
      }
    }
  });

  it('draws its prices from the AREA the run has actually reached', () => {
    const game = new GameModel(false, seeded(5));
    game.jumpToStage(3, 1);
    expect(game.shop.offers.length).toBe(SHOP_RULES.stock);
    for (const offer of game.shop.offers) expect(offer.price).toBe(shopPrice(shopItem(offer.item), 3));
  });

  it('stops the world while it is open, and hands control back on close', () => {
    const game = bare();
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
    game.shop.offers = rollShopStock(seeded(4), 1);
    game.shop.placeEntrance(game.player.x - 20, game.player.y - 20, 40, 40);
    tick(game, 0.1);
    game.coins.walletCoins = 5000; game.coins.scoreCoins = 5000;
    const score = game.coins.scoreCoins, wallet = game.coins.walletCoins;
    const price = game.shop.offers[0].price;
    expect(game.buyShopItem(0)).toBe('bought');
    expect(game.coins.walletCoins).toBe(wallet - price);
    expect(game.coins.scoreCoins).toBe(score);
  });

  it('never lets spending touch the COIN HIGH meter', () => {
    const game = bare();
    game.shop.offers = rollShopStock(seeded(4), 1);
    game.shop.placeEntrance(game.player.x - 20, game.player.y - 20, 40, 40);
    tick(game, 0.1);
    game.coins.walletCoins = 5000;
    game.coinHigh.meter = 40;
    expect(game.buyShopItem(0)).toBe('bought');
    expect(game.coinHigh.meter).toBe(40);
    expect(game.coinHigh.active).toBe(false);
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
    // One slot, one sale: the same shelf cannot be bought from twice.
    expect(shop.buy(0, coins, () => { throw new Error('sold'); })).toBe('soldOut');
    expect(applied).toBe(1);
  });

  it('routes rice ball, sushi and energy drink through HealthSystem', () => {
    for (const [item, healed] of [['riceBall', 1], ['sushi', 2], ['energyDrink', 1]] as const) {
      const game = bare();
      game.player.invincible = 0;
      game.damage(2, 'enemy');
      const hurt = game.hp;
      game.player.invincible = 99;
      const shopping = withItemOn(game, item);
      expect(shopping.buyShopItem(0)).toBe('bought');
      expect(shopping.hp).toBe(hurt + healed);
    }
  });

  it('rolls food bought at full health into the existing overflow and LIFE UP', () => {
    const full = bare();
    full.shop.placeEntrance(full.player.x - 20, full.player.y - 20, 40, 40);
    tick(full, 0.1);
    const maxHp = full.health.maxHp;
    const def = shopItem('riceBall');
    for (let i = 0; i < HEALTH_RULES.overflowPerLife; i++) {
      full.shop.offers = [{ id: `h${i}`, item: 'riceBall', name: def.name, effect: def.effect, price: 0, sold: false }];
      expect(full.buyShopItem(0)).toBe('bought');
    }
    expect(full.health.maxHp).toBe(maxHp + 1);
  });

  it('grows the magazine by 1 for a battery and 2 for a car battery, topping it up', () => {
    for (const [item, growth] of [['battery', 1], ['carBattery', 2], ['energyDrink', 1]] as const) {
      const game = withItem(item);
      const before = game.stats.maxAmmo;
      game.ammo = 1;
      expect(game.buyShopItem(0)).toBe('bought');
      expect(game.stats.maxAmmo).toBe(before + growth);
      // The same top-up a gun module's CHARGE bonus and a settled chain give.
      expect(game.ammo).toBe(game.stats.maxAmmo);
    }
  });

  it('raises the maximum itself for a curry, through the existing LIFE UP', () => {
    const game = withItem('curry');
    const maxHp = game.stats.maxHp, hp = game.hp;
    expect(game.buyShopItem(0)).toBe('bought');
    expect(game.stats.maxHp).toBe(maxHp + 1);
    // HEALTH_RULES.fillNewHeart: a new heart arrives full, exactly as every other LIFE UP does.
    expect(game.hp).toBe(hp + 1);
    expect(game.stats.maxAmmo).toBe(new GameModel(false, seeded(1)).stats.maxAmmo);
  });

  it('cannot be bought from when it is not open', () => {
    const game = bare();
    expect(game.state).toBe('playing');
    expect(game.buyShopItem(0)).toBe('closed');
  });

  it('does not collide with PAUSE, GAME OVER or CLEAR', () => {
    const game = bare();
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
    game.shop.placeEntrance(game.player.x - 20, game.player.y - 20, 40, 40);
    tick(game, 0.1);
    game.closeShop();
    tick(game, 0.3);
    expect(game.state).toBe('playing');
  });
});

describe('an in-game HEART is ordinary play, not assistance', () => {
  it('heals 3/4 back to 4/4 from a crate the shaft generated, with no test API involved', () => {
    const game = bare();
    game.player.invincible = 0;
    game.damage(1, 'enemy');
    expect(game.hp).toBe(game.stats.maxHp - 1);
    game.player.invincible = 99;
    // A crate placed the way the generator places one, collected by walking into it.
    game.pickups = [spawnGunModule(4242, game.player.x, game.player.y, 'machine', 'heart')];
    tick(game, 0.2);
    expect(game.hp).toBe(game.stats.maxHp);
    // The heal came from the pickup path, so it is the game healing the player, not a harness.
    expect(game.events.some(e => e.type === 'gunModule' && e.bonus === 'heart')).toBe(true);
  });

  it('rolls a full-health HEART into the existing overflow rather than wasting it', () => {
    const game = bare();
    expect(game.hp).toBe(game.stats.maxHp);
    const overflow = game.health.overflowHealing;
    game.pickups = [spawnGunModule(4243, game.player.x, game.player.y, 'machine', 'heart')];
    tick(game, 0.2);
    expect(game.hp).toBe(game.stats.maxHp);
    expect(game.health.overflowHealing).toBe(overflow + 1);
  });
});

describe('EXIT replaces the forced section switch', () => {
  it('offers no exit before the goal', () => {
    const game = new GameModel(false, seeded(6));
    game.player.y = WORLD.startY + (game.sectionLength - 1) * WORLD.pixelsPerMeter; game.player.invincible = 99;
    game.step(1 / 120, 0, false);
    expect(game.exit).toBeNull();
    expect(game.state).toBe('playing');
  });

  it('lays the exit at the goal but leaves the SECTION running until it is entered', () => {
    const game = new GameModel(false, seeded(6));
    game.player.y = WORLD.startY + (game.sectionLength + 1) * WORLD.pixelsPerMeter; game.player.invincible = 99;
    game.step(1 / 120, 0, false);
    expect(game.exit).not.toBeNull();
    expect(game.state).toBe('playing');
    expect(game.events.some(e => e.type === 'exitReady')).toBe(true);
    // Still playable: many seconds pass and the SECTION is still the player's. Held off the exit
    // itself, because walking into it is exactly what IS meant to end the SECTION.
    const away = game.player.y;
    const gate = game.exit!;
    for (let i = 0; i < 360; i++) {
      game.player.x = gate.x > WORLD.width / 2 ? WORLD.wall + 20 : WORLD.width - WORLD.wall - 20;
      game.player.y = away; game.player.vy = 0; game.player.invincible = 99;
      game.step(1 / 120, 0, false);
    }
    expect(game.state).toBe('playing');
  });

  it('places the gate a little past the goal, where it can be seen and reached', () => {
    const game = new GameModel(false, seeded(6));
    game.player.y = WORLD.startY + (game.sectionLength + 1) * WORLD.pixelsPerMeter; game.player.invincible = 99;
    game.step(1 / 120, 0, false);
    const gate = game.exit!;
    expect(gate.width).toBe(EXIT_RULES.width);
    expect((gate.y - WORLD.startY) / WORLD.pixelsPerMeter).toBeGreaterThan(game.sectionLength);
  });

  it('clears the SECTION when the gate is entered', () => {
    const game = new GameModel(false, seeded(6));
    reachExit(game);
    expect(game.state).toBe('upgrade');
    expect(game.events.some(e => e.type === 'exit')).toBe(true);
  });

  it('bottoms the shaft out at the exit, so nothing below can be farmed', () => {
    const game = new GameModel(false, seeded(8));
    game.player.y = WORLD.startY + (game.sectionLength + 2) * WORLD.pixelsPerMeter; game.player.invincible = 99;
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
    game.player.y = WORLD.startY + (game.sectionLength + 60) * WORLD.pixelsPerMeter; game.player.invincible = 99;
    game.step(1 / 120, 0, false);
    expect(Math.round(game.sectionDepth)).toBeGreaterThan(game.sectionLength);
    expect(Math.round(game.totalDepth)).toBe(game.sectionLength);
    reachExit(game);
    game.selectUpgrade(game.upgrades.choices[0].id); game.confirmUpgrade();
    expect(game.completedDepth).toBe(AREAS[0].sectionLength);
  });

  it('reaches the FINAL BOSS after twelve gates, at the planned run total', () => {
    const game = new GameModel(false, seeded(15));
    for (let i = 0; i < 12; i++) {
      reachExit(game);
      game.selectUpgrade(game.upgrades.choices[0].id);
      game.confirmUpgrade();
    }
    expect(game.state).toBe('boss');
    expect(Math.round(game.totalDepth)).toBe(PLANNED_TOTAL_DEPTH);
  });
});

describe('AREA 3 air containers', () => {
  const submerged = (seed = 4) => {
    const game = new GameModel(false, seeded(seed));
    game.jumpToStage(3, 1);
    game.platforms = []; game.enemies = []; game.containers = []; game.bubbles = [];
    game.player.invincible = 99;
    return game;
  };
  const box = (game: GameModel, x: number, y: number) => {
    const size = AIR_CONTAINER_RULES.size;
    game.containers = [{ id: 1, x: x - size / 2, y: y - size / 2, width: size, height: size, broken: false, debris: 0 }];
    return game.containers[0];
  };

  it('generates containers in AREA 3', () => {
    const game = new GameModel(false, seeded(21));
    game.jumpToStage(3, 1);
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
