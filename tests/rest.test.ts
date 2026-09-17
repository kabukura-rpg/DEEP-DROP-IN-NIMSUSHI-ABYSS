import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { HealthSystem, HEALTH_RULES } from '../src/systems/HealthSystem';
import { UpgradeSystem } from '../src/systems/UpgradeSystem';
import { UPGRADES, chooseUpgrades } from '../src/data/upgrades';
import { initialStats } from '../src/data/balance';
import { spawnEnemy } from '../src/data/enemies';
const upgrade = (id: string) => UPGRADES.find(u => u.id === id)!;
function killOne(game: GameModel) {
  game.platforms = []; game.player.x = 225; game.player.y = 180; game.player.vy = 0;
  const target = spawnEnemy('slime', game.kills + 100, 225, 250);
  game.enemies = [target]; game.bullets = [{ x: 225, y: 240, previousY: 240, hits: new Set(), alive: true }];
  game.step(1 / 120, 0, false);
}

describe('central health and LIFE UP', () => {
  it('FOOD heals four through the health system', () => { const h = new HealthSystem(8); h.damage(5); upgrade('food').apply(initialStats(), h); expect(h.currentHp).toBe(7); expect(h.overflowHealing).toBe(0); });
  it('FOOD at full health creates one filled heart', () => { const h = new HealthSystem(); upgrade('food').apply(initialStats(), h); expect([h.currentHp, h.maxHp, h.overflowHealing]).toEqual([5, 5, 0]); });
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
    g.selectUpgrade(a.id); g.selectUpgrade(b.id); expect(g.upgrades.stacks).toEqual({}); expect(g.state).toBe('upgrade');
    expect(g.confirmUpgrade()).toBe(true); expect(g.upgrades.stacks).toEqual({ [b.id]: 1 }); expect(g.state).toBe('playing');
    expect(g.confirmUpgrade()).toBe(false); expect(g.selectUpgrade(a.id)).toBe(false);
    expect(g.completeSection('a')).toBe(false); expect(g.completeSection('b')).toBe(true);
  });
  it('applies chosen ammunition only once and starts the next section fully loaded', () => {
    const g = new GameModel(false, () => 0); g.ammo = 2; g.completeSection('a'); g.selectUpgrade('mag'); g.confirmUpgrade(); g.confirmUpgrade();
    expect([g.stats.maxAmmo, g.ammo, g.hp]).toEqual([8, 8, 4]);
  });
  it('does not reroll cards when a clear signal is duplicated', () => {
    const g = new GameModel(); g.completeSection('a'); const choices = g.upgrades.choices; expect(g.completeSection('b')).toBe(false); expect(g.upgrades.choices).toEqual(choices);
  });
  it('endless mode never raises a section clear of its own', () => { const g = new GameModel(false, () => 0, 'endless'); g.player.y = 180 + 205 * 24; g.player.invincible = 99; g.step(1 / 120, 0, false); expect(g.state).toBe('playing'); expect(g.completeSection('area-1')).toBe(true); });
  it('practice cannot enter a rest or change real-run upgrades', () => { const g = new GameModel(true); expect(g.completeSection('a')).toBe(false); expect(g.upgrades.choices).toHaveLength(0); });
  it('pause freezes HP hazards, physics and immunity', () => { const g = new GameModel(); g.damage(1); g.paused = true; const immunity = g.player.invincible; g.step(2, 1, true); g.damage(1, 'heat'); g.killInstantly('lava'); expect(g.hp).toBe(3); expect(g.player.invincible).toBe(immunity); expect(g.elapsed).toBe(0); });
  it('routes environmental and instant deaths to the result state', () => { const g = new GameModel(); g.damage(1, 'oxygen'); g.killInstantly('lava'); expect(g.state).toBe('over'); expect(g.health.deathCause?.cause).toBe('lava'); expect(g.events.filter(e => e.type === 'over')).toHaveLength(1); });
});

describe('upgrade candidates and stack limits', () => {
  it('offers three unique candidates from three categories when available across many random draws', () => {
    for (let i = 0; i < 100; i++) { const choices = chooseUpgrades(initialStats()); expect(choices).toHaveLength(3); expect(new Set(choices.map(u => u.id)).size).toBe(3); expect(new Set(choices.map(u => u.category)).size).toBe(3); }
  });
  it('excludes capped stacks and state-inapplicable effects', () => {
    const stats = initialStats(); stats.piercing = true; stats.power = 3; stats.maxAmmo = 12;
    for (let i = 0; i < 30; i++) expect(chooseUpgrades(stats, Math.random, { recoil: 2, speed: 3, big: 2, bounce: 2 }).map(u => u.id).sort()).toEqual(['combo', 'food', 'heart']);
  });
  it('keeps three meaningful options after all finite upgrades are capped', () => {
    const stacks = Object.fromEntries(UPGRADES.filter(u => Number.isFinite(u.maxStacks)).map(u => [u.id, u.maxStacks]));
    const choices = chooseUpgrades(initialStats(), () => .7, stacks); expect(choices).toHaveLength(3); expect(new Set(choices.map(u => u.category)).size).toBe(2);
  });
  it('enforces stack and singleton limits at application time too', () => {
    const stats = initialStats(), system = new UpgradeSystem(stats, new HealthSystem());
    for (let i = 0; i < 5; i++) system.applyLegacy(upgrade('mag'));
    expect(stats.maxAmmo).toBe(12); expect(system.stacks.mag).toBe(3);
    expect(system.applyLegacy(upgrade('piercing'))).toBe(true); expect(system.applyLegacy(upgrade('piercing'))).toBe(false);
  });
  it('FOOD is selectable and useful at full HP', () => { const g = new GameModel(false, () => .999); g.completeSection('a'); expect(g.selectUpgrade('food')).toBe(true); g.confirmUpgrade(); expect([g.hp, g.health.maxHp]).toEqual([5, 5]); });
  it('maximum ammo and recoil upgrades never turn shooting into upward flight', () => {
    const g = new GameModel(true); g.platforms = []; for (let i = 0; i < 3; i++) g.upgrades.applyLegacy(upgrade('mag'));
    for (let i = 0; i < 2; i++) g.upgrades.applyLegacy(upgrade('recoil'));
    g.player.y = -10000; for (let i = 0; i < 600; i++) { g.step(1 / 120, 0, true); expect(g.player.vy).toBeGreaterThanOrEqual(0); }
    expect(g.ammo).toBe(0); expect(g.player.y).toBeGreaterThan(-9000);
  });
});

describe('25-combo reward through real collision kills', () => {
  it('heals exactly one at 25 and not at 26–50', () => {
    const g = new GameModel(true); g.hp = 2; g.combo = 24; killOne(g); expect(g.combo).toBe(25); expect(g.hp).toBe(3);
    for (let i = 0; i < 25; i++) killOne(g); expect(g.combo).toBe(50); expect(g.hp).toBe(3); expect(g.health.overflowHealing).toBe(0);
  });
  it('sends a full-HP reward into overflow', () => { const g = new GameModel(true); g.combo = 24; killOne(g); expect(g.hp).toBe(4); expect(g.health.overflowHealing).toBe(1); });
  it('can trigger LIFE UP from a combo reward', () => { const g = new GameModel(true); g.heal(3); g.combo = 24; killOne(g); expect([g.hp, g.health.maxHp, g.health.overflowHealing]).toEqual([5, 5, 0]); });
  it('allows another reward after damage breaks the combo', () => {
    const g = new GameModel(true); g.combo = 24; killOne(g); expect(g.health.overflowHealing).toBe(1); g.damage(1); expect(g.combo).toBe(0);
    for (let i = 0; i < 25; i++) killOne(g); expect(g.hp).toBe(4); expect(g.health.overflowHealing).toBe(1);
  });
  it('allows another reward after landing breaks the combo', () => {
    const g = new GameModel(true); g.combo = 24; killOne(g);
    g.platforms = [{ id: 5, x: 150, y: g.player.y + 16, width: 150 }]; g.player.vy = 300; g.step(1 / 120, 0, false); expect(g.combo).toBe(0);
    for (let i = 0; i < 25; i++) killOne(g); expect(g.health.overflowHealing).toBe(2);
  });
});
