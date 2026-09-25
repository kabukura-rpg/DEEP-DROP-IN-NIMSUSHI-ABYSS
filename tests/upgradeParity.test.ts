import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { UPGRADES, UPGRADE_TUNING, type UpgradeId } from '../src/data/upgrades';

/**
 * EXTERNAL TEST BUILD -- UPGRADE PARITY AUDIT.
 *
 * Downwell Normal has exactly twenty upgrades (Downwell Wiki, "List of Upgrades"). DEEP DROP has all
 * twenty: fifteen under the original's own name, and five renamed only because DEEP DROP's gems
 * are COINS (the Gem three and Popping Gems) or because the drone's trigger is DEEP DROP's fire
 * event. Nothing was missing, so this pass implements none; these pin the table and the four
 * behaviours the pass asked to see proven.
 */
const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

/** Downwell's twenty, by the name the original gives each one. */
const DOWNWELL_NORMAL = [
  'Apple', 'Blast Module', 'Candle', 'Drone', 'Gem Attractor', 'Gem Powered', 'Gem Sick', 'Gunpowder Blocks',
  'Heart Balloon', 'Hot Casing', 'Knife and Fork', 'Laser Sight', "Member's Card", 'Popping Gems',
  'Rest in Pieces', 'Reverse Engineering', 'Rocket Jump', 'Safety Jetpack', 'Timeout', 'Youth',
];

/** The audit, as data: MATCH under the same name, EQUIVALENT under another. */
const AUDIT: Record<string, 'MATCH' | 'EQUIVALENT'> = {
  Apple: 'MATCH', 'Blast Module': 'MATCH', Candle: 'MATCH', Drone: 'EQUIVALENT', 'Gem Attractor': 'EQUIVALENT',
  'Gem Powered': 'EQUIVALENT', 'Gem Sick': 'EQUIVALENT', 'Gunpowder Blocks': 'MATCH', 'Heart Balloon': 'MATCH',
  'Hot Casing': 'MATCH', 'Knife and Fork': 'MATCH', 'Laser Sight': 'MATCH', "Member's Card": 'MATCH',
  'Popping Gems': 'EQUIVALENT', 'Rest in Pieces': 'MATCH', 'Reverse Engineering': 'MATCH', 'Rocket Jump': 'MATCH',
  'Safety Jetpack': 'MATCH', Timeout: 'MATCH', Youth: 'MATCH',
};

function run(held: UpgradeId[], seed = 31) {
  const game = new GameModel(false, seeded(seed));
  for (const id of held) game.upgrades.grant(id);
  game.jumpToStage(1, 1);
  game.platforms = []; game.enemies = []; game.pickups = []; game.hazards = [];
  game.doodads = []; game.safeZones = []; game.caves = []; game.corpses = []; game.containers = [];
  game.player.invincible = 99;
  game.player.x = 225; game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
  return game;
}
/** Step with the shaft kept empty, so nothing is landed on unless the test puts it there. */
const empty = (game: GameModel, seconds: number, fire: boolean) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) {
    game.platforms = []; game.enemies = []; game.doodads = []; game.pickups = [];
    game.player.invincible = 99;
    game.step(1 / 120, 0, fire);
  }
};

describe('the audit', () => {
  it('has every one of Downwell Normal\'s twenty, once, and nothing it lacks', () => {
    expect(UPGRADES).toHaveLength(20);
    expect(UPGRADES.map(u => u.origin).sort()).toEqual([...DOWNWELL_NORMAL].sort());
    expect(new Set(UPGRADES.map(u => u.id)).size).toBe(20);
    for (const name of DOWNWELL_NORMAL) expect(AUDIT[name], name).toBeDefined();
    // Nothing is MISSING and nothing is a DEEP DROP original.
    expect(Object.values(AUDIT).filter(v => v === 'MATCH')).toHaveLength(15);
    expect(Object.values(AUDIT).filter(v => v === 'EQUIVALENT')).toHaveLength(5);
  });
});

describe('SAFETY JETPACK', () => {
  it('only works with the magazine EMPTY: with CHARGE left, ACTION fires instead', () => {
    const game = run(['safetyJetpack']);
    game.ammo = game.stats.maxAmmo;
    const fuel = game.jetpackFuel;
    empty(game, 0.3, true);
    expect(game.jetpackActive).toBe(false);
    expect(game.jetpackFuel).toBe(fuel);
    expect(game.ammo).toBeLessThan(game.stats.maxAmmo);
  });

  it('is a limited resource: it burns out, and cannot hover forever', () => {
    const game = run(['safetyJetpack']);
    game.ammo = 0;
    empty(game, UPGRADE_TUNING.safetyJetpack.fuelSeconds + 0.5, true);
    expect(game.jetpackFuel).toBe(0);
    expect(game.jetpackActive).toBe(false);
    // Out of fuel, the fall is the ordinary fall again.
    empty(game, 1, true);
    expect(game.player.vy).toBeCloseTo(game.stats.maxFallSpeed, 0);
  });

  it('hands back to the ordinary loop on a landing: fuel and CHARGE both refill', () => {
    const game = run(['safetyJetpack']);
    game.ammo = 0;
    empty(game, 0.5, true);
    expect(game.jetpackFuel).toBeLessThan(UPGRADE_TUNING.safetyJetpack.fuelSeconds);
    game.platforms = [{ id: 901, x: 150, y: game.player.y + 60, width: 150, breakable: false, state: 'stable' }];
    for (let i = 0; i < 240 && game.player.grounded !== 901; i++) { game.player.invincible = 99; game.step(1 / 120, 0, false); }
    expect(game.player.grounded).toBe(901);
    expect(game.jetpackFuel).toBe(UPGRADE_TUNING.safetyJetpack.fuelSeconds);
    expect(game.ammo).toBe(game.stats.maxAmmo);
  });
});

describe('DRONE', () => {
  it('fires with the player and takes nothing from the player\'s magazine', () => {
    const plain = run([]);
    const drone = run(['drone']);
    for (const g of [plain, drone]) { g.ammo = g.stats.maxAmmo; empty(g, 0.2, true); }
    expect(drone.ammo).toBe(plain.ammo);
    expect(drone.bullets.some(b => b.source === 'drone')).toBe(true);
  });
});

describe('the run carries its upgrades', () => {
  it('keeps every upgrade it holds through a SECTION change', () => {
    const game = new GameModel(false, seeded(7));
    const held: UpgradeId[] = ['safetyJetpack', 'drone', 'heartBalloon', 'rocketJump'];
    for (const id of held) game.upgrades.grant(id);
    expect(game.completeSection()).toBe(true);
    expect(game.selectUpgrade(game.upgrades.choices[0].id)).toBe(true);
    expect(game.confirmUpgrade()).toBe(true);
    expect(game.stage.label).toBe('1-2');
    for (const id of held) expect({ id, held: game.upgrades.has(id) }).toEqual({ id, held: true });
  });
});
