import { describe, expect, it } from 'vitest';
import { GameModel , plainBullet } from '../src/systems/GameModel';
import { HealthSystem, HEALTH_RULES } from '../src/systems/HealthSystem';
import { UpgradeSystem } from '../src/systems/UpgradeSystem';
import { UPGRADES, UPGRADE_TUNING, upgrade, type UpgradeId } from '../src/data/upgrades';
import { COIN_HIGH_RULES } from '../src/data/coinHigh';
import { shopItem, shopPrice } from '../src/data/shop';
import { initialStats } from '../src/data/balance';
import { spawnEnemy } from '../src/data/enemies';
const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
function killOne(game: GameModel) {
  game.platforms = []; game.player.x = 225; game.player.y = 180; game.player.vy = 0;
  const target = spawnEnemy('slime', game.kills + 100, 225, 250);
  game.enemies = [target]; game.bullets = [plainBullet(225, 240)];
  game.step(1 / 120, 0, false);
}

describe('central health and LIFE UP', () => {
  it('a heal of four reaches HP through the health system', () => { const h = new HealthSystem(8); h.damage(5); h.heal(UPGRADE_TUNING.apple.heal); expect(h.currentHp).toBe(7); expect(h.overflowHealing).toBe(0); });
  it('a heal of four at full health creates one filled heart', () => { const h = new HealthSystem(); h.heal(UPGRADE_TUNING.apple.heal); expect([h.currentHp, h.maxHp, h.overflowHealing]).toEqual([5, 5, 0]); });
  it('partial healing puts only the excess into LIFE UP, then consumes exactly four', () => {
    const h = new HealthSystem(); h.damage(1); h.heal(4);
    expect([h.currentHp, h.maxHp, h.overflowHealing]).toEqual([4, 4, 3]);
    h.heal(1); expect([h.currentHp, h.maxHp, h.overflowHealing]).toEqual([5, 5, 0]);
  });
  it('preserves overflow remainder across multiple life ups', () => { const h = new HealthSystem(); h.heal(11); expect([h.currentHp, h.maxHp, h.overflowHealing]).toEqual([6, 6, 3]); });
  it('can configure whether new hearts are filled', () => { const h = new HealthSystem(4, () => true, () => {}, { ...HEALTH_RULES, fillNewHeart: false }); h.heal(4); expect([h.currentHp, h.maxHp]).toEqual([4, 5]); });
  it('normal damage respects the existing one-second invulnerability', () => {
    const h = new HealthSystem(); expect(h.damage(1, 'oxygen')).toBe(true); expect(h.damage(1, 'heat')).toBe(false);
    h.tick(0.99); expect(h.damage(1)).toBe(false); h.tick(0.02); expect(h.damage(1, 'heat')).toBe(true); expect(h.currentHp).toBe(2);
  });
  it('instant death bypasses invulnerability and records a distinct cause once', () => {
    let deaths = 0; const h = new HealthSystem(4, () => true, () => deaths++); h.damage(1); h.killInstantly('lava');
    expect(h.deathCause).toEqual({ cause: 'lava', instant: true, amount: 3 }); expect(h.currentHp).toBe(0);
    h.killInstantly('fall'); h.heal(4); expect(deaths).toBe(1); expect(h.currentHp).toBe(0); expect(h.deathCause?.cause).toBe('lava');
  });
  it('lethal normal damage records a non-instant death', () => { const h = new HealthSystem(); h.damage(5, 'heat'); expect(h.deathCause).toEqual({ cause: 'heat', instant: false, amount: 4 }); });
  it('ignores invalid damage and healing', () => { const h = new HealthSystem(); for (const n of [-1, 0, NaN, Infinity]) { h.damage(n); h.heal(n); } expect(h.currentHp).toBe(4); expect(h.maxHp).toBe(4); });
});

describe('rest and section progression', () => {
  it('does not automatically heal, reload, consume immunity or advance simulation at rest', () => {
    const g = new GameModel(false, () => 0, 'stage'); g.damage(2); g.ammo = 2; g.heal(0);
    const snapshot = { hp: g.hp, elapsed: g.elapsed, y: g.player.y, invincible: g.player.invincible, ammo: g.ammo, enemies: JSON.stringify(g.enemies), platforms: JSON.stringify(g.platforms) };
    expect(g.completeSection('area-1/section-1')).toBe(true); g.step(10, 1, true); g.shoot();
    expect({ hp: g.hp, elapsed: g.elapsed, y: g.player.y, invincible: g.player.invincible, ammo: g.ammo, enemies: JSON.stringify(g.enemies), platforms: JSON.stringify(g.platforms) }).toEqual(snapshot);
  });
  it.each(['enemy', 'oxygen', 'heat', 'lava'] as const)('blocks %s damage and death at rest', cause => {
    const g = new GameModel(); g.completeSection('safe'); expect(g.damage(1, cause)).toBe(false); expect(g.killInstantly(cause)).toBe(false); expect(g.hp).toBe(4);
  });
  it('cannot proceed without choosing; selection can change but only confirmation applies one effect', () => {
    const g = new GameModel(false, () => 0, 'stage'); g.completeSection('a'); const [a, b] = g.upgrades.choices;
    expect(g.confirmUpgrade()).toBe(false); expect(g.selectUpgrade('unknown')).toBe(false);
    g.selectUpgrade(a.id); g.selectUpgrade(b.id); expect(g.upgrades.acquired).toEqual([]); expect(g.state).toBe('upgrade');
    expect(g.confirmUpgrade()).toBe(true); expect(g.upgrades.acquired).toEqual([b.id]); expect(g.state).toBe('playing');
    expect(g.confirmUpgrade()).toBe(false); expect(g.selectUpgrade(a.id)).toBe(false);
    expect(g.completeSection('a')).toBe(false); expect(g.completeSection('b')).toBe(true);
  });
  it('applies the chosen card once and starts the next section fully loaded', () => {
    const g = new GameModel(false, () => 0); g.ammo = 2; g.completeSection('a');
    const chosen = g.upgrades.choices[0];
    g.selectUpgrade(chosen.id); expect(g.confirmUpgrade()).toBe(true);
    // A second NEXT does nothing: the card is applied by the one confirmation that took it.
    expect(g.confirmUpgrade()).toBe(false);
    expect(g.upgrades.acquired).toEqual([chosen.id]);
    expect([g.stats.maxAmmo, g.ammo]).toEqual([initialStats().maxAmmo, initialStats().maxAmmo]);
  });
  it('does not reroll cards when a clear signal is duplicated', () => {
    const g = new GameModel(); g.completeSection('a'); const choices = g.upgrades.choices; expect(g.completeSection('b')).toBe(false); expect(g.upgrades.choices).toEqual(choices);
  });
  it('endless mode never raises a section clear of its own', () => { const g = new GameModel(false, () => 0, 'endless'); g.player.y = 180 + 205 * 24; g.player.invincible = 99; g.step(1 / 120, 0, false); expect(g.state).toBe('playing'); expect(g.completeSection('area-1')).toBe(true); });
  it('practice cannot enter a rest or change real-run upgrades', () => { const g = new GameModel(true); expect(g.completeSection('a')).toBe(false); expect(g.upgrades.choices).toHaveLength(0); });
  it('pause freezes HP hazards, physics and immunity', () => { const g = new GameModel(); g.damage(1); g.paused = true; const immunity = g.player.invincible; g.step(2, 1, true); g.damage(1, 'heat'); g.killInstantly('lava'); expect(g.hp).toBe(3); expect(g.player.invincible).toBe(immunity); expect(g.elapsed).toBe(0); });
  it('routes environmental and instant deaths to the result state', () => { const g = new GameModel(); g.damage(1, 'oxygen'); g.killInstantly('lava'); expect(g.state).toBe('over'); expect(g.health.deathCause?.cause).toBe('lava'); expect(g.events.filter(e => e.type === 'over')).toHaveLength(1); });
});

describe('the original twenty', () => {
  it('is exactly twenty definitions, each naming what it corresponds to', () => {
    expect(UPGRADES).toHaveLength(20);
    expect(new Set(UPGRADES.map(u => u.id)).size).toBe(20);
    expect(new Set(UPGRADES.map(u => u.origin)).size).toBe(20);
    for (const u of UPGRADES) {
      expect({ id: u.id, named: u.name.length > 0 && u.description.length > 0 }).toEqual({ id: u.id, named: true });
    }
  });

  it('pools none of DEEP DROP’s own upgrades any more', () => {
    // The old catalogue -- MAG+, POWER+, RECOIL+, HEART+, SPEED+, BIG BULLET, PIERCING, BOUNCE,
    // COMBO+, FOOD -- is gone from a normal run. FOOD's heal-of-four survives as APPLE.
    const retired = ['mag', 'power', 'recoil', 'heart', 'speed', 'big', 'piercing', 'bounce', 'combo', 'food'];
    for (const id of retired) expect({ id, present: UPGRADES.some(u => u.id === (id as never)) }).toEqual({ id, present: false });
  });

  it('offers three distinct cards, drawn from what the run does not hold', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const game = new GameModel(false, seeded(seed * 131));
      expect(game.completeSection('a')).toBe(true);
      const choices = game.upgrades.choices;
      expect({ seed, count: choices.length }).toEqual({ seed, count: 3 });
      expect({ seed, unique: new Set(choices.map(c => c.id)).size }).toEqual({ seed, unique: 3 });
      for (const c of choices) expect(UPGRADES.some(u => u.id === c.id)).toBe(true);
    }
  });

  it('widens to four from the REST after YOUTH, not the one it was taken at', () => {
    const game = new GameModel(false, seeded(7));
    game.completeSection('a');
    // The screen YOUTH is taken on stays a three-card screen.
    expect(game.upgrades.choices).toHaveLength(3);
    game.upgrades.grant('youth');
    expect(game.upgrades.choices).toHaveLength(3);
    game.selectUpgrade(game.upgrades.choices[0].id);
    game.confirmUpgrade();
    game.completeSection('b');
    expect(game.upgrades.choices).toHaveLength(4);
    expect(new Set(game.upgrades.choices.map(c => c.id)).size).toBe(4);
  });

  it('never offers an upgrade the run already holds', () => {
    // PROVISIONAL / MEASUREMENT REQUIRED: the original's own rule for re-offering is unknown, so
    // one of each per run is the assumption. A card that was passed over stays available.
    const game = new GameModel(false, seeded(21));
    const taken: string[] = [];
    for (let section = 0; section < 12; section++) {
      if (!game.completeSection(`s${section}`)) break;
      for (const choice of game.upgrades.choices) {
        expect({ section, id: choice.id, held: taken.includes(choice.id) }).toEqual({ section, id: choice.id, held: false });
      }
      const pick = game.upgrades.choices[0];
      taken.push(pick.id);
      game.selectUpgrade(pick.id);
      game.confirmUpgrade();
    }
    expect(taken.length).toBeGreaterThan(3);
    expect(new Set(taken).size).toBe(taken.length);
  });

  it('can hand out every one of the twenty', () => {
    const game = new GameModel(false, seeded(3));
    for (const u of UPGRADES) expect({ id: u.id, granted: game.upgrades.grant(u.id) }).toEqual({ id: u.id, granted: true });
    expect(game.upgrades.acquired).toHaveLength(20);
    expect(game.upgrades.pool).toHaveLength(0);
    // A REST with nothing left simply offers nothing; it never repeats a held card.
    game.completeSection('late');
    expect(game.upgrades.choices).toHaveLength(0);
  });

  it('starts a fresh run with none of them', () => {
    const played = new GameModel(false, seeded(5));
    played.upgrades.grant('apple'); played.upgrades.grant('drone');
    expect(played.upgrades.acquired).toHaveLength(2);
    const fresh = new GameModel(false, seeded(5));
    expect(fresh.upgrades.acquired).toHaveLength(0);
    expect(fresh.upgrades.pool).toHaveLength(20);
  });

  it('keeps what it holds across SECTION, AREA and the BOSS hand-off', () => {
    const game = new GameModel(false, seeded(9));
    game.upgrades.grant('candle');
    for (const [area, section] of [[1, 2], [2, 1], [4, 3]] as const) {
      game.jumpToStage(area, section);
      expect({ area, section, held: game.upgrades.has('candle') }).toEqual({ area, section, held: true });
    }
    game.jumpToBoss();
    expect(game.upgrades.has('candle')).toBe(true);
  });
});

describe('what an upgrade does the moment it is taken', () => {
  /**
   * Park a run at a REST with one named card on the shelf. `hurt` runs BEFORE the rest opens,
   * because a rest blocks damage outright -- that is its whole point.
   */
  function offering(id: UpgradeId, seed = 11, hurt = 0) {
    const game = new GameModel(false, seeded(seed));
    if (hurt) { game.player.invincible = 0; game.damage(hurt); }
    game.completeSection('a');
    // Reach past the draw so a test can name the card it is about: the draw itself is covered above.
    (game.upgrades as unknown as { offered: unknown[] }).offered = [upgrade(id)];
    return game;
  }

  it('APPLE heals four, and overflows into LIFE UP at full health', () => {
    const hurt = offering('apple', 11, 3);
    const low = hurt.hp;
    expect(low).toBe(1);
    hurt.selectUpgrade('apple'); hurt.confirmUpgrade();
    // Four into a tank with three missing fills it and puts the last point into LIFE UP: healing
    // past the top is never wasted, it is banked, which is HealthSystem's rule and not APPLE's.
    expect(hurt.hp).toBe(hurt.health.maxHp);
    expect(hurt.health.overflowHealing).toBe(UPGRADE_TUNING.apple.heal - (hurt.health.maxHp - low));

    const full = offering('apple', 12);
    // HealthSystem owns the live maximum; stats.maxHp is the run's starting constant and never moves.
    const maxHp = full.health.maxHp;
    full.selectUpgrade('apple'); full.confirmUpgrade();
    // Four into a full tank is four overflow, which is exactly one LIFE UP.
    expect(full.health.maxHp).toBe(maxHp + 1);
  });

  it('YOUTH heals one and widens the next REST', () => {
    const game = offering('youth', 11, 2);
    const low = game.hp;
    expect(low).toBe(2);
    game.selectUpgrade('youth'); game.confirmUpgrade();
    expect(game.hp).toBe(low + UPGRADE_TUNING.youth.heal);
    game.completeSection('b');
    expect(game.upgrades.choices).toHaveLength(4);
  });

  it('CANDLE stretches the invulnerability window without rewriting it', () => {
    const game = new GameModel(false, seeded(4));
    game.player.invincible = 0;
    game.damage(1);
    const base = game.player.invincible;
    expect(base).toBeCloseTo(HEALTH_RULES.invincibilitySeconds, 5);

    const candled = new GameModel(false, seeded(4));
    candled.upgrades.grant('candle');
    candled.jumpToStage(1, 1);
    candled.player.invincible = 0;
    candled.damage(1);
    expect(candled.player.invincible).toBeCloseTo(HEALTH_RULES.invincibilitySeconds * UPGRADE_TUNING.candle.invincibilityMultiplier, 5);
    expect(candled.player.invincible).toBeGreaterThan(base);
    // The rule itself is untouched, so a run without the card is unaffected.
    expect(HEALTH_RULES.invincibilitySeconds).toBe(1);
  });

  it('COIN MAGNET widens the pull without rewriting the tuned radius', () => {
    const plain = new GameModel(false, seeded(6));
    const magnet = new GameModel(false, seeded(6));
    magnet.upgrades.grant('gemAttractor');
    magnet.jumpToStage(1, 1);
    expect(magnet.coins.attractMultiplier).toBe(UPGRADE_TUNING.gemAttractor.radiusMultiplier);
    expect(plain.coins.attractMultiplier).toBe(1);
    // A coin far enough out that only the widened pull reaches it.
    const reach = (game: GameModel) => {
      game.platforms = []; game.enemies = []; game.doodads = []; game.safeZones = [];
      game.player.x = 225; game.player.y = 200; game.player.invincible = 99;
      game.coins.coins = [];
      game.coins.burst(225 + 120, 200, 1, seeded(3), 'small');
      const coin = game.coins.coins[0];
      coin.vx = 0; coin.vy = 0;
      const startX = coin.x;
      for (let i = 0; i < 20; i++) { game.player.x = 225; game.player.y = 200; game.step(1 / 120, 0, false); }
      return startX - coin.x;
    };
    expect(reach(magnet)).toBeGreaterThan(reach(plain));
  });

  it('COIN SICK stretches a HIGH without moving the threshold or the boost', () => {
    const lasting = new GameModel(false, seeded(8));
    lasting.upgrades.grant('gemSick');
    lasting.jumpToStage(1, 1);
    expect(lasting.coinHigh.durationMultiplier).toBe(UPGRADE_TUNING.gemSick.durationMultiplier);
    const plain = new GameModel(false, seeded(8));
    const runOut = (game: GameModel) => {
      game.coinHigh.earn(COIN_HIGH_RULES.threshold);
      let seconds = 0;
      while (game.coinHigh.active && seconds < 120) { game.coinHigh.tick(1 / 120); seconds += 1 / 120; }
      return seconds;
    };
    const held = runOut(lasting), ordinary = runOut(plain);
    expect(held).toBeGreaterThan(ordinary * 1.5);
    // Threshold and boost are the ones Phase 3 set, untouched.
    expect(lasting.coinHigh.rules.threshold).toBe(COIN_HIGH_RULES.threshold);
    lasting.coinHigh.earn(COIN_HIGH_RULES.threshold);
    expect(lasting.coinHigh.damageMultiplier).toBe(COIN_HIGH_RULES.damageMultiplier);
  });

  it('LASER SIGHT stretches reach and composes with a COIN HIGH', () => {
    const game = new GameModel(false, seeded(14));
    expect(game.shotBoost.range).toBe(1);
    game.upgrades.grant('laserSight');
    game.jumpToStage(1, 1);
    expect(game.shotBoost.range).toBe(UPGRADE_TUNING.laserSight.rangeMultiplier);
    game.coinHigh.earn(COIN_HIGH_RULES.threshold);
    // A product, not a winner: both stretch the same reach.
    expect(game.shotBoost.range).toBeCloseTo(UPGRADE_TUNING.laserSight.rangeMultiplier * COIN_HIGH_RULES.rangeMultiplier, 6);
  });

  it("MEMBER'S CARD takes ten percent off every quoted price", () => {
    const game = new GameModel(false, seeded(16));
    game.upgrades.grant('membersCard');
    game.jumpToStage(2, 1);
    expect(game.shop.discount).toBe(UPGRADE_TUNING.membersCard.discount);
    for (const offer of game.shop.offers) {
      const full = shopPrice(shopItem(offer.item), 2);
      expect({ item: offer.item, price: offer.price }).toEqual({ item: offer.item, price: Math.round(full * 0.9) });
    }
    // Spending still takes the wallet alone.
    game.shop.placeEntrance(game.player.x - 20, game.player.y - 20, 40, 40);
    game.coins.walletCoins = 9000; game.coins.scoreCoins = 9000;
    for (let i = 0; i < 20 && game.state !== 'shop'; i++) { game.player.invincible = 99; game.step(1 / 120, 0, false); }
    const price = game.shop.offers[0].price;
    expect(game.buyShopItem(0)).toBe('bought');
    expect(game.coins.walletCoins).toBe(9000 - price);
    expect(game.coins.scoreCoins).toBe(9000);
  });
});

/**
 * COMBO used to pay out the instant a threshold was reached, from a rotating table. It does not
 * any more: a chain is banked by LANDING, in tiers, and nothing is paid for merely reaching a
 * number. The whole specification -- settlement, the 8 / 15 / 25 tiers, what survives a chain and
 * what ends it -- is exercised in tests/downwellCore.test.ts, so it is not duplicated here.
 *
 * What stays here is the part that is still this file's subject: that healing from any source
 * goes through HealthSystem and its overflow.
 */
describe('COMBO rewards reach health through HealthSystem', () => {
  it('sends a full-HP heart into overflow, and overflow into LIFE UP', () => {
    const full = new GameModel(true);
    full.heal(1);
    expect(full.hp).toBe(4); expect(full.health.overflowHealing).toBe(1);
    const nearly = new GameModel(true); nearly.heal(3);
    nearly.heal(1);
    expect([nearly.hp, nearly.health.maxHp, nearly.health.overflowHealing]).toEqual([5, 5, 0]);
  });
  it('no longer carries a combo threshold in HEALTH_RULES', () => {
    expect(HEALTH_RULES).not.toHaveProperty('comboRewardAt');
    expect(HEALTH_RULES).not.toHaveProperty('comboHealing');
  });
});
