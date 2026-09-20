import { describe, expect, it } from 'vitest';
import { BALANCE, initialStats } from '../src/data/balance';
import { difficultyAt, horizontalReach } from '../src/data/difficulty';
import { GameModel } from '../src/systems/GameModel';
import { GUN_MODULES } from '../src/data/gunModules';
import { StageGenerator, START_PLATFORM, type RoutePlatform, type Enemy } from '../src/systems/StageGenerator';
import { spawnEnemy } from '../src/data/enemies';
import { defaultTuning, loadTuning, saveTuning, sanitizeTuning, tuningVisible, TUNING_STORAGE_KEY } from '../src/systems/PhysicsTuning';
import { comboFeedback } from '../src/systems/ComboFeedback';
import { InputBuffer } from '../src/systems/InputBuffer';

const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const tick = (game: GameModel, seconds: number, direction = 0, fire = false) => { for (let i = 0; i < seconds * 120; i++) game.step(1 / 120, direction, fire); };

describe('practice tuning isolation', () => {
  it('applies all five parameters immediately to simulation and magazine', () => {
    const game = new GameModel(true); game.platforms = []; game.player.y = 50;
    const tuning = { gravity: 400, shotRecoil: 80, moveSpeed: 250, maxFallSpeed: 300, maxAmmo: 8 };
    game.setPhysicsTuning(tuning); tick(game, 0.2, 1);
    expect(game.player.x).toBeCloseTo(275); expect(game.player.vy).toBeCloseTo(80); expect(game.ammo).toBe(8);
    game.shoot(); expect(game.player.vy).toBeCloseTo(0); expect(game.ammo).toBe(7);
    tick(game, 0.8); expect(game.player.vy).toBe(300);
  });
  it('resets to current defaults without mutating defaults or refilling spent rounds', () => {
    const game = new GameModel(true); game.setPhysicsTuning({ gravity: 1200, shotRecoil: 250, moveSpeed: 220, maxFallSpeed: 700, maxAmmo: 10 });
    game.shoot(); game.resetPhysicsTuning();
    for (const [key, value] of Object.entries(defaultTuning())) expect(game.stats[key as keyof typeof BALANCE]).toBe(value);
    // Back on the default magazine, one round short: resetting the tuning does not hand it back.
    expect(game.ammo).toBe(game.stats.maxAmmo - GUN_MODULES.machine.ammoCost);
    expect(initialStats()).toEqual(new GameModel().stats);
  });
  it('rejects tuning in normal runs and cannot leak between modes', () => {
    const practice = new GameModel(true), normal = new GameModel();
    const custom = { ...defaultTuning(), gravity: 1400, maxAmmo: 12 };
    practice.setPhysicsTuning(custom); normal.setPhysicsTuning(custom);
    expect(normal.stats).toEqual(initialStats()); expect(normal.ammo).toBe(initialStats().maxAmmo);
    expect(new GameModel().stats).toEqual(initialStats());
  });
  it('keeps ammo and current fall speed valid when limits decrease', () => {
    const game = new GameModel(true); game.player.vy = 520; game.setPhysicsTuning({ ...defaultTuning(), maxAmmo: 2, maxFallSpeed: 300 });
    expect(game.ammo).toBe(2); expect(game.player.vy).toBe(300);
  });
  it('stores only practice values in a separate key and handles unavailable/corrupt storage', () => {
    const entries = new Map<string, string>(); const storage = { getItem: (key: string) => entries.get(key) || null, setItem: (key: string, value: string) => { entries.set(key, value); } };
    saveTuning({ ...defaultTuning(), gravity: 1050 }, storage); expect(loadTuning(storage).gravity).toBe(1050); expect([...entries.keys()]).toEqual([TUNING_STORAGE_KEY]);
    entries.set(TUNING_STORAGE_KEY, 'broken'); expect(loadTuning(storage)).toEqual(defaultTuning());
    expect(loadTuning({ getItem: () => { throw new Error('blocked'); } })).toEqual(defaultTuning());
    expect(() => saveTuning(defaultTuning(), { setItem: () => { throw new Error('quota'); } })).not.toThrow();
  });
  it('sanitizes invalid values instead of injecting them into physics', () => {
    expect(sanitizeTuning({ gravity: NaN, shotRecoil: Infinity, moveSpeed: -10, maxAmmo: 999 })).toEqual({ ...defaultTuning(), moveSpeed: 90, maxAmmo: 12 });
  });
  it.each(['title', 'paused', 'upgrade', 'over', 'playing'])('never shows tuning in normal mode: %s', mode => {
    expect(tuningVisible(false, mode)).toBe(false); expect(tuningVisible(true, mode)).toBe(mode === 'playing');
  });
});

describe('continuous difficulty', () => {
  it.each([[0, 'tutorial'], [99.99, 'tutorial'], [100, 'normal'], [299.99, 'normal'], [300, 'middle'], [599.99, 'middle'], [600, 'deep'], [3000, 'deep']])('uses the intended phase at %sm', (depth, phase) => {
    expect(difficultyAt(Number(depth)).phase).toBe(phase);
  });
  it('never introduces dangerous enemies in the first 100m', () => {
    for (let d = 0; d < 100; d++) { const v = difficultyAt(d); expect(v.spikeChance + v.tankChance + v.flyChance).toBe(0); expect(v.minWidth).toBeGreaterThan(150); }
  });
  it('transitions smoothly at the three phase boundaries', () => {
    for (const boundary of [100, 300, 600]) {
      const before = difficultyAt(boundary - 0.001), after = difficultyAt(boundary);
      for (const key of ['minWidth', 'maxWidth', 'gap', 'enemyChance', 'spikeChance', 'flyChance', 'tankChance'] as const) expect(Math.abs(before[key] - after[key])).toBeLessThan(0.01);
    }
  });
  it('caps endless difficulty while leaving room for the player', () => {
    const v = difficultyAt(100000); expect(v).toEqual(difficultyAt(10000)); expect(v.minWidth).toBeGreaterThanOrEqual(96); expect(v.enemyChance).toBeLessThan(1);
  });
});

describe('safe generation across chunk seams', () => {
  it('guarantees reachable exits, clear landing lanes and enemy spacing across 10,000m and many seeds', () => {
    for (let seed = 0; seed < 16; seed++) {
      const generator = new StageGenerator(seed < 2 ? () => seed ? 0.999999 : 0 : seeded(seed));
      let previous = START_PLATFORM; let previousEnemy: Enemy | undefined;
      for (let chunk = 0; chunk < 250; chunk++) {
        const result = generator.chunk(chunk);
        for (const platform of result.platforms) {
          expect(platform.y - previous.y).toBeGreaterThanOrEqual(215);
          expect(Math.abs(platform.safeX - previous.exitX)).toBeLessThanOrEqual(horizontalReach(platform.y - previous.y));
          expect(platform.x).toBeGreaterThanOrEqual(28); expect(platform.x + platform.width).toBeLessThanOrEqual(422);
          expect(platform.exitX).toBeGreaterThanOrEqual(40); expect(platform.exitX).toBeLessThanOrEqual(410);
          const guard = result.enemies.find(e => !e.flying && e.y === platform.y - 15);
          if (guard) expect(Math.abs(guard.originX - platform.safeX) - guard.range).toBeGreaterThanOrEqual(52);
          const fly = result.enemies.find(e => e.flying && e.y === platform.y - 115);
          if (fly) {
            const left = Math.min(previous.exitX, platform.safeX), right = Math.max(previous.exitX, platform.safeX);
            expect(fly.originX + fly.range + 26 <= left - 48 || fly.originX - fly.range - 26 >= right + 48).toBe(true);
          }
          previous = platform;
        }
        for (const e of [...result.enemies].sort((a, b) => a.y - b.y)) {
          if (previousEnemy) expect(e.y - previousEnemy.y - 44).toBeGreaterThanOrEqual(22);
          expect(e.originX - e.range).toBeGreaterThan(28); expect(e.originX + e.range).toBeLessThan(422);
          previousEnemy = e;
        }
      }
    }
  });
  it('actually lands without ammo or damage along sampled safe transfers using real collision physics', () => {
    const generator = new StageGenerator(seeded(732)); let previous = START_PLATFORM;
    let lastGuard: Enemy | undefined, checked = 0;
    for (let chunk = 0; chunk < 65; chunk++) {
      const result = generator.chunk(chunk);
      for (const p of result.platforms) {
        const guard = result.enemies.find(e => !e.flying && e.y === p.y - 15);
        if (checked++ % 3 === 0) verifyTransfer(previous, p, [...(lastGuard ? [lastGuard] : []), ...result.enemies.filter(e => e.y > previous.y && e.y < p.y)]);
        previous = p; lastGuard = guard;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });
  it('interrupts both wall lanes repeatedly instead of leaving an endless safe bypass', () => {
    for (let seed = 0; seed < 12; seed++) {
      const generator = new StageGenerator(seeded(seed));
      let leftGap = 0, rightGap = 0, leftCount = 0, rightCount = 0;
      const history: string[] = [];
      for (let i = 0; i < 120; i++) for (const p of generator.chunk(i).platforms) {
        history.push(`${Math.round(p.y)}:${p.x}-${p.x + p.width}/${p.safeSide}`);
        if (p.x <= 40) { leftGap = 0; leftCount++; } else leftGap++;
        if (p.x + p.width >= 410) { rightGap = 0; rightCount++; } else rightGap++;
        expect(leftGap, `seed=${seed}, ${history.slice(-23).join(' ')}`).toBeLessThan(22); expect(rightGap, `seed=${seed}, ${history.slice(-23).join(' ')}`).toBeLessThan(22);
      }
      expect(leftCount).toBeGreaterThan(20); expect(rightCount).toBeGreaterThan(20);
    }
  });
});
function verifyTransfer(from: RoutePlatform, to: RoutePlatform, enemies: Enemy[]) {
  const game = new GameModel(true), shift = from.y - 100;
  game.ammo = 0; game.player.x = from.safeX; game.player.y = 85; game.player.grounded = from.id;
  game.platforms = [{ ...from, y: 100 }, { ...to, y: to.y - shift }];
  game.enemies = enemies.map(e => ({ ...e, y: e.y - shift }));
  let airborne = 0;
  for (let i = 0; i < 360 && game.player.grounded !== to.id; i++) {
    let direction: number = from.safeSide;
    if (game.player.grounded !== from.id) {
      airborne += 1 / 120;
      direction = airborne < 0.12 ? 0 : Math.abs(to.safeX - game.player.x) < 1.5 ? 0 : Math.sign(to.safeX - game.player.x);
    }
    game.step(1 / 120, direction, false);
  }
  expect(game.player.grounded, `transfer ${from.id} to ${to.id}`).toBe(to.id);
  expect(game.hp).toBe(4); expect(game.ammo).toBe(game.stats.maxAmmo);
}

describe('responsive controls and feedback', () => {
  it('keeps single-shot recoil but avoids climbing during sustained fire', () => {
    // NOT practice: that mode teleports a player who falls past y=840 back to the top and refills
    // CHARGE on the way, which the run's measured fall speed now reaches inside this window -- the
    // magazine never emptied because it was being handed back.
    const game = new GameModel(false); game.platforms = []; game.player.y = 50; game.player.vy = 200;
    game.player.grounded = -1;
    // Long enough to empty the starting magazine, whatever size it is.
    for (let i = 0; i < Math.round(0.2 * game.stats.maxAmmo * 120); i++) {
      game.platforms = []; game.enemies = []; game.doodads = []; game.pickups = [];
      game.step(1 / 120, 0, true);
    }
    expect(game.ammo).toBe(0); expect(game.player.y - 50).toBeGreaterThan(100); expect(game.player.vy).toBeGreaterThan(100);
    // A single shot may throw the player upward now; fifty of them in a row must still not climb.
    const ceiling = game.player.y - 200;
    for (let i = 0; i < 50; i++) { game.cooldown = 0; game.ammo = 1; game.shoot(); expect(game.player.y).toBeGreaterThan(ceiling); game.platforms = []; game.step(1 / 120, 0, false); }
  });
  it('buffers short movement taps and shots but clears them on pause/restart', () => {
    const input = new InputBuffer(); input.move(-1); input.shoot();
    expect(input.resolveDirection(0)).toBe(-1); expect(input.resolveDirection(1)).toBe(1);
    input.tick(0.04); expect(input.firing).toBe(true); expect(input.resolveDirection(0)).toBe(-1);
    input.tick(0.02); expect(input.resolveDirection(0)).toBe(0); expect(input.firing).toBe(true);
    input.clear(); expect(input.firing).toBe(false); expect(input.resolveDirection(0)).toBe(0);
  });
  it.each([[2, 0], [3, 3], [4, 3], [5, 5], [7, 5], [8, 8], [9, 8], [10, 10], [16, 10]])('classifies %s combo as tier %s', (combo, tier) => {
    expect(comboFeedback(combo).tier).toBe(tier);
  });
  it('strengthens 10+ feedback gradually but caps visual and audio intensity', () => {
    expect(comboFeedback(12).scale).toBeGreaterThan(comboFeedback(10).scale);
    expect(comboFeedback(1000)).toEqual(comboFeedback(20)); expect(comboFeedback(20).duration).toBeLessThan(250);
  });
  it('identifies the damage source and keeps the one-second invincibility', () => {
    const game = new GameModel(true);
    const spike = spawnEnemy('armoredSlime', 8, 225, 180);
    game.enemies = [spike]; game.step(1 / 120, 0, false);
    expect(game.hp).toBe(3); expect(game.player.invincible).toBe(1); expect(spike.hurtFlash).toBe(0.3);
    expect(game.events.find(e => e.type === 'hurt')?.source?.id).toBe(8);
    game.hurt(spike); expect(game.hp).toBe(3);
  });
});
