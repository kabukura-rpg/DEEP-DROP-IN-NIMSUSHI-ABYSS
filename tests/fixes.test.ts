import { describe, expect, it, beforeEach } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { GameAudio, EVENT_SOUNDS, eventSound, type SoundId } from '../src/systems/Audio';
import { DAMAGE_LABELS, damageLabel } from '../src/data/damage';
import { BOSS } from '../src/data/boss';
import { spawnEnemy } from '../src/data/enemies';
import type { GameEvent } from '../src/systems/GameModel';

const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const tick = (game: GameModel, seconds: number, direction = 0, fire = false) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) game.step(1 / 120, direction, fire);
};
const EVENT_TYPES = Object.keys(EVENT_SOUNDS) as GameEvent['type'][];

/** A WebAudio stand-in: enough surface for the engine, so the test exercises the real code path. */
class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  resume() { /* already running */ }
  createOscillator() {
    return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} };
  }
  createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
}

describe('C1: audio never crashes the run', () => {
  let audio: GameAudio;
  beforeEach(() => {
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
    audio = new GameAudio();
    audio.unlock();
  });

  it('gives every GameEvent an explicit sound or explicit silence', () => {
    for (const type of EVENT_TYPES) {
      const sound = eventSound(type);
      expect(sound === null || typeof sound === 'string').toBe(true);
    }
    // The events that used to be forced through as sound names must be silent, not unplayable.
    for (const silent of ['section', 'ice', 'vent', 'crack', 'collapse', 'bossHit', 'bossTelegraph', 'bossFire', 'bossPhase', 'bossDown'] as const) {
      expect(eventSound(silent)).toBeNull();
    }
  });

  it('plays every GameEvent through the audio path without throwing, sound on', () => {
    for (const type of EVENT_TYPES) {
      expect(() => { const s = eventSound(type); if (s) audio.play(s, 9, true); }).not.toThrow();
    }
  });

  it('stays silent rather than throwing if an unknown id ever reaches the engine', () => {
    expect(() => audio.play('section' as unknown as SoundId)).not.toThrow();
    expect(() => audio.play(undefined as unknown as SoundId)).not.toThrow();
  });

  it('is equally safe with sound off', () => {
    audio.muted = true;
    for (const type of EVENT_TYPES) {
      expect(() => { const s = eventSound(type); if (s) audio.play(s); }).not.toThrow();
    }
  });

  it('survives a real 1-1 start, which is where the crash used to happen', () => {
    const game = new GameModel(false, seeded(3));
    expect(() => {
      for (let i = 0; i < 600; i++) {
        game.step(1 / 120, i % 60 < 30 ? 1 : -1, true);
        for (const event of game.events.splice(0)) { const s = eventSound(event.type); if (s) audio.play(s, event.combo, event.stomp); }
      }
    }).not.toThrow();
  });

  it('survives every AREA and the FINAL BOSS', () => {
    for (const jump of [[1, 1], [2, 1], [3, 1], [4, 1], [0, 0]] as const) {
      const game = new GameModel(false, seeded(11));
      if (jump[0] === 0) game.jumpToBoss(); else game.jumpToStage(jump[0] as 1 | 2 | 3 | 4, jump[1] as 1);
      expect(() => {
        for (let i = 0; i < 900; i++) {
          game.player.invincible = 99; game.health.heal(9);
          game.step(1 / 120, i % 80 < 40 ? 1 : -1, true);
          for (const event of game.events.splice(0)) { const s = eventSound(event.type); if (s) audio.play(s, event.combo, event.stomp); }
        }
      }).not.toThrow();
    }
  });
});

describe('H2: a won fight can never become a loss', () => {
  /** A boss fight already decided, with the player one hit from death. */
  function onePointFromVictory() {
    const game = new GameModel(false, seeded(21));
    game.jumpToBoss();
    tick(game, 1);
    while (game.hp > 1) { game.player.invincible = 0; game.damage(1, 'enemy'); }
    expect(game.hp).toBe(1);
    game.boss.damage(BOSS.maxHp);
    expect(game.boss.defeated).toBe(true);
    return game;
  }

  it('seals the victory the moment the king falls', () => {
    const game = onePointFromVictory();
    expect(game.victorySealed).toBe(true);
  });

  it.each(['enemy', 'spike', 'tank', 'oxygen', 'heat', 'bossShot', 'bossSweep', 'bossContact'] as const)(
    'ignores %s damage during the defeat sequence', cause => {
      const game = onePointFromVictory();
      for (let i = 0; i < 40; i++) { game.player.invincible = 0; game.damage(99, cause); }
      expect(game.hp).toBe(1);
      expect(game.state).not.toBe('over');
    });

  it.each(['lava', 'fall'] as const)('ignores instant death by %s during the defeat sequence', cause => {
    const game = onePointFromVictory();
    for (let i = 0; i < 10; i++) { game.player.invincible = 0; game.killInstantly(cause); }
    expect(game.hp).toBe(1);
    expect(game.state).not.toBe('over');
  });

  it('reaches GAME CLEAR even while a spike demon keeps touching the player', () => {
    const game = onePointFromVictory();
    game.enemies = [spawnEnemy('spikeDemon', 900, game.player.x, game.player.y)];
    for (let i = 0; i < Math.round((BOSS.defeatDelay + 0.4) * 120); i++) {
      game.player.invincible = 0;
      if (game.enemies[0]) { game.enemies[0].x = game.player.x; game.enemies[0].y = game.player.y; }
      game.step(1 / 120, 0, false);
    }
    expect(game.state).toBe('clear');
    expect(game.hp).toBeGreaterThan(0);
  });

  it('still allows ordinary death before the king falls', () => {
    const game = new GameModel(false, seeded(21));
    game.jumpToBoss();
    expect(game.victorySealed).toBe(false);
    for (let i = 0; i < 40 && game.state === 'boss'; i++) { game.player.invincible = 0; game.damage(1, 'enemy'); }
    expect(game.state).toBe('over');
  });
});

describe('H3: the run reports what actually killed it', () => {
  it('separates the king body, its shots and its sweep', () => {
    const causes = new Set<string>();
    for (const cause of ['bossContact', 'bossShot', 'bossSweep'] as const) {
      const game = new GameModel(false, seeded(5));
      game.jumpToBoss();
      for (let i = 0; i < 40 && game.state === 'boss'; i++) { game.player.invincible = 0; game.damage(1, cause); }
      expect(game.health.deathCause?.cause).toBe(cause);
      causes.add(cause);
    }
    expect(causes.size).toBe(3);
  });

  it('labels every cause without leaking the internal id', () => {
    for (const [cause, label] of Object.entries(DAMAGE_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(cause);
      expect(damageLabel(cause as keyof typeof DAMAGE_LABELS)).toBe(label);
    }
    expect(damageLabel(null)).toBe('THE DEPTHS');
    expect(damageLabel(undefined)).toBe('THE DEPTHS');
  });

  it('names the boss attacks the way the result screen shows them', () => {
    expect(damageLabel('bossShot')).toBe('MAGIC SHOT');
    expect(damageLabel('bossSweep')).toBe('DEMON SWEEP');
  });

  it('keeps every existing cause flowing through the same HealthSystem path', () => {
    for (const cause of ['oxygen', 'heat', 'lava', 'enemy'] as const) {
      const game = new GameModel(false, seeded(8));
      game.player.invincible = 0;
      if (cause === 'lava') game.killInstantly(cause);
      else for (let i = 0; i < 40 && game.state === 'playing'; i++) { game.player.invincible = 0; game.damage(1, cause); }
      expect(game.health.deathCause?.cause).toBe(cause);
      expect(game.state).toBe('over');
    }
  });
});

describe('M1: CLEAR TIME covers the whole run', () => {
  it('counts play time, not just the fight', () => {
    const game = new GameModel(false, seeded(13));
    tick(game, 5);
    const beforeBoss = game.elapsed;
    expect(beforeBoss).toBeGreaterThan(4.9);
    game.jumpToBoss();
    tick(game, 3);
    expect(game.elapsed).toBeGreaterThan(beforeBoss);
    // The fight is a strict subset of the run.
    expect(game.bossTime).toBeGreaterThan(0);
    expect(game.elapsed).toBeGreaterThan(game.bossTime);
  });

  it('does not run while paused', () => {
    const game = new GameModel(false, seeded(13));
    tick(game, 1);
    const held = game.elapsed;
    game.paused = true;
    tick(game, 3);
    expect(game.elapsed).toBe(held);
    game.paused = false;
    tick(game, 1);
    expect(game.elapsed).toBeGreaterThan(held);
  });

  it('does not run during rest and upgrade selection', () => {
    const game = new GameModel(false, seeded(17));
    game.jumpToStage(1, 1);
    tick(game, 1);
    game.completeSection();
    expect(game.state).toBe('upgrade');
    const held = game.elapsed;
    tick(game, 3);
    expect(game.elapsed).toBe(held);
  });
});

describe('M2: the FINAL BOSS shows the banked total, not 000m', () => {
  it('reports the planned total during the fight and never adds to it', () => {
    const game = new GameModel(false, seeded(23));
    game.jumpToBoss();
    expect(game.state).toBe('boss');
    expect(game.sectionDepth).toBe(0);
    expect(Math.round(game.totalDepth)).toBe(2400);
    for (let i = 0; i < 120 * 20; i++) { game.player.invincible = 99; game.health.heal(9); game.step(1 / 120, 0, false); }
    expect(Math.round(game.totalDepth)).toBe(2400);
  });

  it('keeps 2400m on GAME CLEAR', () => {
    const game = new GameModel(false, seeded(23));
    game.jumpToBoss();
    tick(game, 2);
    game.boss.damage(BOSS.maxHp);
    tick(game, BOSS.defeatDelay + 0.3);
    expect(game.state).toBe('clear');
    expect(Math.round(game.totalDepth)).toBe(2400);
  });
});
