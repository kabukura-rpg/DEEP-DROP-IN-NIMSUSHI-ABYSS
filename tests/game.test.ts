import { describe, expect, it } from 'vitest';
import { reachExit } from './exitHelper';
import { GameModel } from '../src/systems/GameModel';
import { GUN_MODULES } from '../src/data/gunModules';
import { StageGenerator } from '../src/systems/StageGenerator';
import { spawnEnemy, type Enemy, type EnemyKind } from '../src/data/enemies';
import { initialStats } from '../src/data/balance';

function emptyGame() { const game = new GameModel(true); game.platforms = []; return game; }
function enemy(kind: EnemyKind, x = 225, y = 300, id = 1): Enemy { return spawnEnemy(kind, id, x, y); }
function tick(game: GameModel, seconds: number, direction = 0, fire = false) { for (let i = 0; i < Math.ceil(seconds * 120); i++) game.step(1 / 120, direction, fire); }

describe('falling and ammunition', () => {
  it('falls under gravity and caps vertical speed', () => { const game = emptyGame(); tick(game, 0.7); expect(game.player.y).toBeGreaterThan(300); expect(game.player.vy).toBe(520); });
  // Recoil brakes a fall and stops at a standstill: a shot worth more than the remaining descent
  // spends the surplus and leaves the player hanging, rather than reversing into a climb.
  it('uses a round and kills the fall, without reversing it', () => { const game = emptyGame(); game.player.vy = 100; game.shoot(); expect(game.player.vy).toBe(0); expect(game.ammo).toBe(game.stats.maxAmmo - 1); expect(game.bullets).toHaveLength(1); });
  it('subtracts exactly the weapon recoil when the fall is faster than the kick', () => { const game = emptyGame(); game.player.vy = 400; game.shoot(); expect(game.player.vy).toBe(400 - GUN_MODULES.machine.recoil); });
  it('limits shots by ammunition with no regeneration in the air', () => { const game = emptyGame(); const rounds = game.stats.maxAmmo; for (let i = 0; i < rounds + 2; i++) { game.cooldown = 0; game.shoot(); } expect(game.ammo).toBe(0); expect(game.bullets).toHaveLength(rounds); tick(game, 0.2); expect(game.ammo).toBe(0); });
  it('refills and ends combo only on a landing from above', () => { const game = emptyGame(); game.platforms = [{ id: 4, x: 150, width: 150, y: 260 }]; game.ammo = 1; game.combo = 5; tick(game, 0.5); expect(game.player.y).toBe(245); expect(game.player.grounded).toBe(4); expect(game.ammo).toBe(game.stats.maxAmmo); expect(game.combo).toBe(0); const count = game.events.filter(e => e.type === 'land').length; tick(game, 0.2); expect(game.events.filter(e => e.type === 'land')).toHaveLength(count); });
  it('does not land while crossing a platform from below', () => { const game = emptyGame(); game.platforms = [{ id: 4, x: 150, width: 150, y: 260 }]; game.player.y = 285; game.player.vy = -250; game.ammo = 2; tick(game, 0.12); expect(game.player.grounded).toBe(-1); expect(game.ammo).toBe(2); });
  it('can walk off a platform and stays inside the shaft', () => { const game = new GameModel(true); tick(game, 1.2); expect(game.player.grounded).toBe(-2); tick(game, 0.8, 1); expect(game.player.grounded).toBe(-1); tick(game, 0.2, 1); expect(game.player.x).toBeLessThanOrEqual(410); });
});

describe('combat', () => {
  it('shoots a normal enemy and increments combo and score', () => { const game = emptyGame(); game.enemies = [enemy('slime')]; game.shoot(); tick(game, 0.15); expect(game.kills).toBe(1); expect(game.combo).toBe(1); expect(game.killScore).toBe(100); });
  it('requires three ordinary rounds for a tank', () => { const game = emptyGame(); const tank = enemy('tank'); game.enemies = [tank]; for (let i = 0; i < 3; i++) { game.player.y = 180; game.player.vy = 0; game.cooldown = 0; game.shoot(); tick(game, 0.15); expect(tank.hp).toBe(2 - i); } expect(game.kills).toBe(1); });
  it('stomps a normal enemy, creates a bounce, and fills CHARGE', () => { const game = emptyGame(); game.player.y = 260; game.player.vy = 300; game.ammo = 1; game.enemies = [enemy('slime')]; tick(game, 0.05); expect(game.kills).toBe(1); expect(game.player.vy).toBeLessThan(0); expect(game.ammo).toBe(game.stats.maxAmmo); expect(game.hp).toBe(4); });
  it.each(['armoredSlime', 'tank'] as const)('cannot stomp a %s and grants damage immunity', kind => { const game = emptyGame(); game.player.y = 260; game.player.vy = 300; game.enemies = [enemy(kind)]; tick(game, 0.08); expect(game.hp).toBe(3); expect(game.kills).toBe(0); game.hurt(); expect(game.hp).toBe(3); expect(game.player.invincible).toBeGreaterThan(0); });
  it('ends the run at zero HP', () => { const game = emptyGame(); for (let i = 0; i < 4; i++) { game.player.invincible = 0; game.hurt(); } expect(game.state).toBe('over'); const y = game.player.y; tick(game, 0.2); expect(game.player.y).toBe(y); });
  it('pierces multiple enemies once each with one round', () => { const game = emptyGame(); game.stats.piercing = true; game.enemies = [enemy('slime', 225, 260, 1), enemy('slime', 225, 310, 2)]; game.shoot(); tick(game, 0.2); expect(game.kills).toBe(2); expect(game.ammo).toBe(game.stats.maxAmmo - 1); });
  it('applies combo tiers and records maximum combo', () => { const game = emptyGame(); game.combo = 7; game.enemies = [enemy('slime')]; game.shoot(); tick(game, 0.15); expect(game.combo).toBe(8); expect(game.multiplier).toBe(2); expect(game.maxCombo).toBe(8); expect(game.killScore).toBe(200); });
});

describe('progression', () => {
  it('clears 1-1 only once the exit is entered, and resumes after a single upgrade', () => {
    const game = new GameModel();
    // The goal alone no longer ends the SECTION: the player has to take the exit.
    game.player.y = 180 + 200 * 24; game.player.invincible = 99; game.step(1 / 120, 0, false);
    expect([game.state, game.stage.label]).toEqual(['playing', '1-1']);
    reachExit(game);
    expect([game.state, game.stage.label]).toEqual(['upgrade', '1-1']);
    const y = game.player.y; game.step(0.1, 1, true); expect(game.player.y).toBe(y);
    expect(game.confirmUpgrade()).toBe(false);
    const choice = game.upgrades.choices[0]; game.selectUpgrade(choice.id);
    expect(game.confirmUpgrade()).toBe(true);
    expect([game.state, game.stage.label, Math.floor(game.sectionDepth)]).toEqual(['playing', '1-2', 0]);
    expect(game.upgrades.acquired).toEqual([choice.id]);
    expect(game.confirmUpgrade()).toBe(false);
  });
  it('offers three distinct upgrades and never one the run already holds', () => {
    const game = new GameModel(false, () => 0.4);
    game.upgrades.grant('apple');
    game.completeSection('a');
    const choices = game.upgrades.choices;
    expect(new Set(choices.map(u => u.id)).size).toBe(3);
    expect(choices.some(u => u.id === 'apple')).toBe(false);
  });
  it('generates valid platforms and all four enemies with depth', () => { let seed = 12; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; const generator = new StageGenerator(random); const kinds = new Set<string>(); for (let i = 0; i < 80; i++) { const chunk = generator.chunk(i); for (const p of chunk.platforms) { expect(p.x).toBeGreaterThanOrEqual(28); expect(p.x + p.width).toBeLessThanOrEqual(422); } chunk.enemies.forEach(e => kinds.add(e.kind)); if (i < 5) expect(chunk.enemies.some(e => e.kind === 'tank' || e.flying)).toBe(false); } expect(kinds.size).toBe(4); });
  it('keeps generated objects bounded during a long descent', () => {
    const game = new GameModel(false, Math.random, 'endless');
    for (let i = 0; i < 150; i++) {
      // The bot teleports a screen at a time, so it can appear already standing inside terrain that
      // kills on contact -- something no actual fall can do. Clearing hazards each step keeps this
      // measuring what it is about: how much of the shaft stays alive during a long descent.
      game.player.y += 800; game.player.grounded = -1; game.player.invincible = 99; game.hazards = [];
      game.step(1 / 120, 0, false);
    }
    expect(game.totalDepth).toBeGreaterThan(4500);
    expect(game.platforms.length).toBeLessThan(25);
    expect(game.enemies.length).toBeLessThan(40);
  });
});
