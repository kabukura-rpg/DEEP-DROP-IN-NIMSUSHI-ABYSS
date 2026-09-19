import { describe, expect, it } from 'vitest';
import { GameModel, plainBullet } from '../src/systems/GameModel';
import { watchForAssists } from './assistWatch';
import { spawnEnemy } from '../src/data/enemies';
import { HEALTH_RULES } from '../src/systems/HealthSystem';

/** The watch labels this file as the cheater, so a direct call from here is what counts. */
const watch = (game: GameModel) => watchForAssists(game, 'assistWatch.test');

describe('the assist watchdog leaves the model exactly as it found it', () => {
  it('keeps player.invincible wired to HealthSystem for the whole watch', () => {
    const game = new GameModel(true);
    const observed = watch(game);
    // The link has to hold WHILE watching, not merely afterwards: a watch that shadows the accessor
    // with a local number quietly unhooks invulnerability for the entire check.
    game.health.invincibilityRemaining = 0.5;
    expect(game.player.invincible).toBe(0.5);
    game.health.tick(0.25);
    expect(game.player.invincible).toBeCloseTo(0.25, 6);
    observed.stop();
    expect(game.health.invincibilityRemaining).toBeCloseTo(0.25, 6);
  });
  it('restores the accessor pair itself, not a plain number left in its place', () => {
    const game = new GameModel(true);
    const before = Object.getOwnPropertyDescriptor(game.player, 'invincible');
    const observed = watch(game);
    observed.stop();
    const after = Object.getOwnPropertyDescriptor(game.player, 'invincible');
    expect(typeof after?.get).toBe('function');
    expect(typeof after?.set).toBe('function');
    expect(after?.get).toBe(before?.get);
    expect(after?.set).toBe(before?.set);
    expect(after?.enumerable).toBe(before?.enumerable);
  });
  it('leaves ordinary damage behaving exactly as it did before the watch', () => {
    const control = new GameModel(true);
    const game = new GameModel(true);
    const observed = watch(game);
    game.damage(1, 'enemy');
    observed.stop();
    // Same starting point, one hit each, and the watched one must be indistinguishable.
    control.damage(1, 'enemy');
    expect(game.hp).toBe(control.hp);
    expect(game.player.invincible).toBe(control.player.invincible);
    expect(game.player.invincible).toBe(HEALTH_RULES.invincibilitySeconds);
    // And the link still runs both ways once the watch is gone.
    for (const model of [game, control]) model.health.tick(0.4);
    expect(game.player.invincible).toBeCloseTo(control.player.invincible, 6);
    game.player.invincible = 0;
    expect(game.health.invincibilityRemaining).toBe(0);
    expect(game.damage(1, 'enemy')).toBe(true);
    expect(game.hp).toBe(control.hp - 1);
  });
  it('restores wrapped methods to the prototype rather than pinning them on the instance', () => {
    const game = new GameModel(true);
    expect(Object.prototype.hasOwnProperty.call(game, 'heal')).toBe(false);
    const observed = watch(game);
    expect(Object.prototype.hasOwnProperty.call(game, 'heal')).toBe(true);
    observed.stop();
    expect(Object.prototype.hasOwnProperty.call(game, 'heal')).toBe(false);
  });
});

describe('the assist watchdog still tells cheating from play', () => {
  it('catches every forbidden API when this file calls it directly', () => {
    const game = new GameModel(true);
    const observed = watch(game);
    game.heal(1);
    game.killInstantly('fall');
    game.player.invincible = 99;
    observed.stop();
    expect(observed.used).toContain('model.heal');
    expect(observed.used).toContain('model.killInstantly');
    expect(observed.used).toContain('player.invincible');
  });
  it('does not flag the game damaging an enemy or the player through its own step', () => {
    const game = new GameModel(true);
    game.platforms = [];
    game.player.x = 225; game.player.y = 180; game.player.vy = 0;
    game.enemies = [spawnEnemy('slime', 1, 225, 250)];
    game.bullets = [plainBullet(225, 240)];
    const observed = watch(game);
    // One ordinary step: a round kills an enemy, and the invulnerability HealthSystem grants on the
    // next hit is set from inside the game. Neither is assistance.
    game.step(1 / 120, 0, false);
    game.enemies = [spawnEnemy('slime', 2, game.player.x, game.player.y)];
    for (let i = 0; i < 4; i++) game.step(1 / 120, 0, false);
    observed.stop();
    expect(game.kills).toBe(1);
    expect(game.player.invincible).toBeGreaterThan(0);
    expect(observed.used).toEqual([]);
  });
  it('does not flag an in-game HEART, which reaches HealthSystem through the model', () => {
    const game = new GameModel(true);
    game.damage(1, 'enemy');
    const observed = watch(game);
    game.equipGunModule('machine', 'heart');
    observed.stop();
    expect(game.hp).toBe(4);
    expect(observed.used).toEqual([]);
  });
});
