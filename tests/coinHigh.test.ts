import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { CoinHighSystem } from '../src/systems/CoinHighSystem';
import { COIN_HIGH_RULES, activeDecayPerSecond } from '../src/data/coinHigh';
import { COIN_VALUES } from '../src/data/coins';
import { COMBO_TIERS, comboTierFor } from '../src/data/combo';
import { GUN_MODULES, effectiveDamage, effectiveRange, volley, type GunModuleId } from '../src/data/gunModules';
import { SAFE_ZONE_RULES, type SafeZone } from '../src/data/safeZone';
import { WORLD } from '../src/data/balance';
import type { Platform } from '../src/systems/StageGenerator';

/**
 * COIN HIGH -- the original's Gem High. Collect enough value quickly and the gunboots hit harder and
 * reach further; keep collecting and it keeps going. The numbers are provisional (see
 * data/coinHigh), so these tests hold the MECHANISM rather than any particular figure: they read
 * thresholds and multipliers from the rules and assert the shape of the loop around them.
 */
const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const tick = (game: GameModel, seconds: number, direction = 0, fire = false) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) { game.player.invincible = 99; game.step(1 / 120, direction, fire); }
};
/** A run with the shaft emptied, so a test sees only what it placed. */
function bare(seed = 5) {
  const game = new GameModel(false, seeded(seed));
  game.platforms = []; game.enemies = []; game.pickups = []; game.hazards = []; game.containers = [];
  game.doodads = []; game.safeZones = [];
  game.player.invincible = 99;
  return game;
}
/** Drop `value` worth of coins on the player and let them sweep it up. */
function collect(game: GameModel, value: number) {
  const large = Math.floor(value / COIN_VALUES.large);
  const small = Math.round((value - large * COIN_VALUES.large) / COIN_VALUES.small);
  if (large) game.coins.burst(game.player.x, game.player.y, large, seeded(3), 'large');
  if (small) game.coins.burst(game.player.x, game.player.y, small, seeded(4), 'small');
  for (let i = 0; i < 120 && game.coins.coins.length; i++) {
    game.player.invincible = 99;
    const next = game.coins.coins[0];
    game.player.x = next.x; game.player.y = next.y;
    game.step(1 / 120, 0, false);
  }
}

describe('COIN HIGH meter', () => {
  it('reads its numbers from data and marks them as unmeasured', () => {
    expect(COIN_HIGH_RULES.threshold).toBe(100);
    for (const key of ['idleGrace', 'decayPerSecond', 'activeSeconds'] as const) {
      expect(COIN_HIGH_RULES[key]).toBeGreaterThan(0);
    }
    expect(COIN_HIGH_RULES.damageMultiplier).toBeGreaterThan(1);
    expect(COIN_HIGH_RULES.rangeMultiplier).toBeGreaterThan(1);
    // A full meter drains over exactly `activeSeconds`, which is what lets coins extend a HIGH.
    expect(activeDecayPerSecond() * COIN_HIGH_RULES.activeSeconds).toBeCloseTo(COIN_HIGH_RULES.threshold, 6);
  });

  it('stays inactive below the threshold', () => {
    const high = new CoinHighSystem();
    expect(high.active).toBe(false);
    high.earn(COIN_HIGH_RULES.threshold - 1);
    expect(high.meter).toBe(COIN_HIGH_RULES.threshold - 1);
    expect(high.active).toBe(false);
    expect([high.damageMultiplier, high.rangeMultiplier]).toEqual([1, 1]);
  });

  it('switches on exactly when the meter reaches the threshold', () => {
    const high = new CoinHighSystem();
    expect(high.earn(COIN_HIGH_RULES.threshold - 2)).toBe(false);
    expect(high.earn(2)).toBe(true);
    expect(high.active).toBe(true);
    expect(high.meter).toBe(COIN_HIGH_RULES.threshold);
    // It reports the switch once, not on every further coin.
    expect(high.earn(10)).toBe(false);
  });

  it('never banks more than a full meter', () => {
    const high = new CoinHighSystem();
    high.earn(COIN_HIGH_RULES.threshold * 3);
    expect(high.meter).toBe(COIN_HIGH_RULES.threshold);
  });

  it('decays once the coins stop, after the grace period', () => {
    const high = new CoinHighSystem();
    high.earn(60);
    // Nothing moves during the grace: a brief gap between kills must not punish the player.
    for (let i = 0; i < Math.round(COIN_HIGH_RULES.idleGrace * 120 * 0.8); i++) high.tick(1 / 120);
    expect(high.meter).toBe(60);
    for (let i = 0; i < 120; i++) high.tick(1 / 120);
    expect(high.meter).toBeLessThan(60);
    expect(high.meter).toBeGreaterThan(0);
    // And it bottoms out rather than going negative.
    for (let i = 0; i < 120 * 30; i++) high.tick(1 / 120);
    expect(high.meter).toBe(0);
  });

  it('runs for its configured duration and then ends', () => {
    const high = new CoinHighSystem();
    high.earn(COIN_HIGH_RULES.threshold);
    const steps = Math.round(COIN_HIGH_RULES.activeSeconds * 120);
    let ended = false;
    for (let i = 0; i < steps - 4; i++) ended = high.tick(1 / 120) || ended;
    expect(ended).toBe(false);
    expect(high.active).toBe(true);
    for (let i = 0; i < 12 && !ended; i++) ended = high.tick(1 / 120);
    expect(ended).toBe(true);
    expect(high.active).toBe(false);
    expect(high.meter).toBe(0);
  });

  it('is extended by collecting while it runs', () => {
    const high = new CoinHighSystem();
    high.earn(COIN_HIGH_RULES.threshold);
    for (let i = 0; i < Math.round(COIN_HIGH_RULES.activeSeconds * 120 * 0.7); i++) high.tick(1 / 120);
    const drained = high.meter;
    expect(drained).toBeLessThan(COIN_HIGH_RULES.threshold);
    high.earn(COIN_VALUES.large * 4);
    expect(high.meter).toBeGreaterThan(drained);
    expect(high.active).toBe(true);
    // The HIGH now lasts longer than the remainder of the original duration would have.
    let left = 0;
    while (high.active && left < 120 * 60) { high.tick(1 / 120); left++; }
    expect(left / 120).toBeGreaterThan((drained / COIN_HIGH_RULES.threshold) * COIN_HIGH_RULES.activeSeconds);
  });

  it('starts a fresh run empty, so RETRY resets it', () => {
    const played = bare();
    collect(played, COIN_HIGH_RULES.threshold);
    expect(played.coinHigh.active).toBe(true);
    // RETRY builds a new GameModel, exactly as the scene does.
    const fresh = new GameModel(false, seeded(9));
    expect([fresh.coinHigh.meter, fresh.coinHigh.active]).toEqual([0, false]);
    expect([fresh.coins.walletCoins, fresh.coins.scoreCoins]).toEqual([0, 0]);
  });
});

describe('COIN HIGH turns the gunboots up without rewriting them', () => {
  const ids = Object.keys(GUN_MODULES) as GunModuleId[];

  it('raises damage and range on every one of the seven modules', () => {
    const game = bare();
    const baseline = ids.map(id => ({
      id,
      damage: effectiveDamage(GUN_MODULES[id], game.stats),
      range: effectiveRange(GUN_MODULES[id]),
    }));
    game.coinHigh.earn(COIN_HIGH_RULES.threshold);
    expect(game.coinHigh.active).toBe(true);
    for (const base of baseline) {
      const boosted = volley(GUN_MODULES[base.id], game.stats, 0, game.shotBoost);
      expect(boosted[0].damage).toBeGreaterThan(base.damage);
      expect(boosted[0].range).toBeGreaterThan(base.range);
      expect(boosted[0].damage).toBe(Math.round(base.damage * COIN_HIGH_RULES.damageMultiplier));
      expect(boosted[0].range).toBeCloseTo(base.range * COIN_HIGH_RULES.rangeMultiplier, 6);
    }
  });

  it('leaves every weapon its own shape: count, spread, speed, piercing and recoil', () => {
    const game = bare();
    for (const id of ids) {
      const def = GUN_MODULES[id];
      const plain = volley(def, game.stats, 0);
      game.coinHigh.reset();
      game.coinHigh.earn(COIN_HIGH_RULES.threshold);
      const boosted = volley(def, game.stats, 0, game.shotBoost);
      expect(boosted.length).toBe(plain.length);
      for (let i = 0; i < plain.length; i++) {
        expect({ id, vx: boosted[i].vx, vy: boosted[i].vy, offsetX: boosted[i].offsetX, pierce: boosted[i].pierce, beam: boosted[i].beam })
          .toEqual({ id, vx: plain[i].vx, vy: plain[i].vy, offsetX: plain[i].offsetX, pierce: plain[i].pierce, beam: plain[i].beam });
      }
    }
  });

  it('never writes to the weapon table, so the baseline survives a HIGH', () => {
    const game = bare();
    const before = ids.map(id => JSON.stringify(GUN_MODULES[id]));
    game.coinHigh.earn(COIN_HIGH_RULES.threshold);
    volley(GUN_MODULES.laser, game.stats, 0, game.shotBoost);
    expect(ids.map(id => JSON.stringify(GUN_MODULES[id]))).toEqual(before);
  });

  it('returns to exactly the baseline when the HIGH ends', () => {
    const game = bare();
    const before = volley(GUN_MODULES.machine, game.stats, 0, game.shotBoost);
    game.coinHigh.earn(COIN_HIGH_RULES.threshold);
    expect(game.shotBoost).toEqual({ damage: COIN_HIGH_RULES.damageMultiplier, range: COIN_HIGH_RULES.rangeMultiplier });
    for (let i = 0; i < Math.round((COIN_HIGH_RULES.activeSeconds + 1) * 120); i++) game.coinHigh.tick(1 / 120);
    expect(game.coinHigh.active).toBe(false);
    expect(game.shotBoost).toEqual({ damage: 1, range: 1 });
    expect(volley(GUN_MODULES.machine, game.stats, 0, game.shotBoost)).toEqual(before);
  });

  it('reaches real rounds in flight, not only the numbers', () => {
    const game = bare();
    game.player.x = 225; game.player.y = 200; game.player.grounded = -1;
    game.ammo = game.stats.maxAmmo;
    game.step(1 / 120, 0, true);
    const plain = game.bullets[0];
    expect(plain).toBeTruthy();

    const boosted = bare();
    boosted.player.x = 225; boosted.player.y = 200; boosted.player.grounded = -1;
    boosted.ammo = boosted.stats.maxAmmo;
    boosted.coinHigh.earn(COIN_HIGH_RULES.threshold);
    boosted.step(1 / 120, 0, true);
    const strong = boosted.bullets[0];
    expect(strong.damage).toBeGreaterThan(plain.damage);
    expect(strong.range).toBeGreaterThan(plain.range);
  });

  it('does not make a BREAK BLOCK easier: a block counts hits, never damage', () => {
    const open = (high: boolean) => {
      const game = new GameModel(true, seeded(21));
      const block: Platform = { id: 51, x: WORLD.wall, y: game.player.y + 60, width: 200, breakable: false, state: 'stable', breakBlock: { hits: 0, durability: 3, slot: 0, reward: false } };
      game.platforms = [block];
      game.player.x = block.x + 100; game.player.y = block.y - 120; game.player.grounded = -1;
      game.stats.maxAmmo = 40; game.ammo = 40;
      if (high) game.coinHigh.earn(COIN_HIGH_RULES.threshold);
      let shots = 0;
      for (let i = 0; i < 900 && block.state !== 'broken'; i++) {
        game.player.y = block.y - 120; game.player.vy = 0; game.player.grounded = -1; game.ammo = 40;
        const before = game.bullets.length;
        game.step(1 / 120, 0, true);
        if (game.bullets.length > before) shots++;
      }
      return { shots, hits: block.breakBlock!.hits, broken: block.state === 'broken' };
    };
    const plain = open(false), boosted = open(true);
    expect(plain.broken && boosted.broken).toBe(true);
    // The same number of rounds either way: a doubled damage figure buys nothing against masonry.
    expect(boosted.shots).toBe(plain.shots);
  });
});

describe('COIN HIGH is fed by every path that earns money', () => {
  it('rises with collected coins, by value and not by count', () => {
    const game = bare();
    game.coins.burst(game.player.x, game.player.y, 1, seeded(3), 'small');
    for (let i = 0; i < 60 && game.coins.coins.length; i++) tick(game, 1 / 120);
    expect(game.coinHigh.meter).toBe(COIN_VALUES.small);

    const big = bare();
    big.coins.burst(big.player.x, big.player.y, 1, seeded(3), 'large');
    for (let i = 0; i < 60 && big.coins.coins.length; i++) tick(big, 1 / 120);
    expect(big.coinHigh.meter).toBe(COIN_VALUES.large);
  });

  it('is filled outright by a settled chain, so 8 COMBO can light it', () => {
    const game = bare();
    game.combo = 8;
    game.player.y = 200;
    const tier = game.settleCombo();
    expect(tier).toBe(comboTierFor(8));
    expect(game.coins.walletCoins).toBe(COMBO_TIERS[0].coins);
    expect(game.coinHigh.meter).toBe(COIN_HIGH_RULES.threshold);
    expect(game.coinHigh.active).toBe(true);
    expect(game.events.some(e => e.type === 'coinHigh' && e.value === 1)).toBe(true);
  });

  it('is not touched by spending', () => {
    const game = bare();
    collect(game, 40);
    const meter = game.coinHigh.meter;
    game.coins.walletCoins = 5000;
    game.coins.spend(1200);
    expect(game.coinHigh.meter).toBe(meter);
  });
});

describe('TIMEVOID stops the meter draining but not the collecting', () => {
  /** A chamber with its floor, and the player standing inside it. */
  function inChamber(game: GameModel, floorY = 320) {
    const { width, height } = SAFE_ZONE_RULES;
    const zone: SafeZone = { id: 500, side: -1, x: WORLD.wall, y: floorY - height, width, height, content: null, taken: false };
    const floor: Platform = { id: 501, x: zone.x, y: floorY, width, breakable: false, state: 'stable', safeZone: zone.id };
    game.safeZones = [zone]; game.platforms = [floor];
    game.player.x = zone.x + width / 2; game.player.y = floorY - 15; game.player.vy = 0; game.player.grounded = floor.id;
    return { zone, floor };
  }

  it('holds a running HIGH while the player stands in a chamber', () => {
    const game = bare();
    inChamber(game);
    game.coinHigh.earn(COIN_HIGH_RULES.threshold);
    expect(game.timeFrozen).toBe(true);
    const held = game.coinHigh.meter;
    // Far longer than a HIGH would otherwise last.
    tick(game, COIN_HIGH_RULES.activeSeconds * 3);
    expect(game.coinHigh.meter).toBe(held);
    expect(game.coinHigh.active).toBe(true);
    // Stepping out into the shaft starts the drain again.
    for (let i = 0; i < 600 && game.timeFrozen; i++) { game.player.invincible = 99; game.step(1 / 120, 1, false); }
    expect(game.timeFrozen).toBe(false);
    tick(game, 0.5);
    expect(game.coinHigh.meter).toBeLessThan(held);
  });

  it('holds an idle meter too', () => {
    const game = bare();
    inChamber(game);
    game.coinHigh.earn(30);
    tick(game, COIN_HIGH_RULES.idleGrace + 4);
    expect(game.coinHigh.meter).toBe(30);
  });

  it('freezes coins out in the shaft and keeps the ones in the chamber moving', () => {
    const game = bare();
    const { zone, floor } = inChamber(game);
    expect(game.timeFrozen).toBe(true);
    // One coin out in the shaft, one on the chamber floor beside the player.
    game.coins.burst(300, 200, 1, seeded(3), 'large');
    const outside = game.coins.coins[0];
    game.coins.burst(zone.x + 20, zone.y + zone.height - 30, 1, seeded(4), 'large');
    const inside = game.coins.coins[1];
    const parked = { x: outside.x, y: outside.y, life: outside.life };
    for (let i = 0; i < 90; i++) { game.player.invincible = 99; game.player.grounded = floor.id; game.step(1 / 120, 0, false); }
    expect([outside.x, outside.y, outside.life]).toEqual([parked.x, parked.y, parked.life]);
    expect(inside.y).not.toBe(zone.y + zone.height - 30);
    // And the frozen one is not quietly culled while it waits.
    expect(game.coins.coins).toContain(outside);
  });
  it('still credits coins collected inside one', () => {
    const game = bare();
    const { floor } = inChamber(game);
    expect(game.timeFrozen).toBe(true);
    game.coinHigh.earn(COIN_HIGH_RULES.threshold - COIN_VALUES.large);
    expect(game.coinHigh.active).toBe(false);
    game.coins.burst(game.player.x, game.player.y, 1, seeded(3), 'large');
    for (let i = 0; i < 120 && game.coins.coins.length; i++) {
      game.player.invincible = 99; game.player.grounded = floor.id; game.step(1 / 120, 0, false);
    }
    // Decay frozen, pickup live: the coin taken in stopped time is what lit the HIGH.
    expect(game.coins.walletCoins).toBe(COIN_VALUES.large);
    expect(game.coinHigh.meter).toBe(COIN_HIGH_RULES.threshold);
    expect(game.coinHigh.active).toBe(true);
  });
});
