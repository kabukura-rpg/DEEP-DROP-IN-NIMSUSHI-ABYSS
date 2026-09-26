import { afterEach, describe, expect, it } from 'vitest';
import { AREA_MUSIC, MUSIC, musicTrack } from '../src/systems/Music';
import { GameAudio } from '../src/systems/Audio';
import { GameModel } from '../src/systems/GameModel';

/** AREA BGM: which track each AREA plays, when it changes, and that ♪ off always wins. */
describe('the AREA tracks', () => {
  it('maps each AREA to its own file, shipped from src/assets/audio', () => {
    const files = { 1: 'The_Mossy_Monolith.mp3', 2: 'Beneath_the_Stone_Vault.mp3', 3: 'Sunken_Meridian.mp3', 4: 'Cavernous_Drift.mp3' } as const;
    for (const [area, file] of Object.entries(files)) {
      const url = AREA_MUSIC[Number(area) as 1 | 2 | 3 | 4];
      expect(url, file).toContain(file.replace('.mp3', ''));
      expect(url, file).not.toContain('dist/');
    }
    expect(new Set(Object.values(AREA_MUSIC)).size).toBe(4);
  });

  it('fades each way in well under a second', () => {
    expect(MUSIC.fadeOut + MUSIC.fadeIn).toBeGreaterThanOrEqual(0.4);
    expect(MUSIC.fadeOut + MUSIC.fadeIn).toBeLessThanOrEqual(1);
  });
});

describe('which track the screen asks for', () => {
  const at = (mode: string, area: number, muted = false) => musicTrack({ mode, area, muted });

  it('plays the AREA\'s track through play, PAUSE, the rest point and the shop', () => {
    for (const mode of ['playing', 'paused', 'upgrade', 'shop']) {
      for (const area of [1, 2, 3, 4]) expect(at(mode, area), `${mode} ${area}`).toBe(area);
    }
  });

  it('is silent on the title, the result screens, and in THE ABYSS / FINAL BOSS (no track specified)', () => {
    for (const mode of ['title', 'over', 'clear', 'boss']) expect(at(mode, 1), mode).toBeNull();
  });

  it('is silent whenever ♪ is off, in every AREA and every screen', () => {
    for (const mode of ['playing', 'paused', 'upgrade', 'shop']) for (const area of [1, 2, 3, 4]) expect(at(mode, area, true)).toBeNull();
  });

  it('asks for the same track across the SECTIONs of an AREA, and a new one only when the AREA changes', () => {
    const trackAt = (area: 1 | 2 | 3 | 4, section: 1 | 2 | 3) => {
      const game = new GameModel();
      game.jumpToStage(area, section);
      return at('playing', game.stage.config.id);
    };
    for (const area of [1, 2, 3, 4] as const) {
      expect([1, 2, 3].map(s => trackAt(area, s as 1 | 2 | 3))).toEqual([area, area, area]);
    }
  });
});

describe('the unlock that starts it', () => {
  const real = (globalThis as { AudioContext?: unknown }).AudioContext;
  afterEach(() => { (globalThis as { AudioContext?: unknown }).AudioContext = real; });

  it('hands the context to the music once, on the first user gesture only', () => {
    (globalThis as { AudioContext?: unknown }).AudioContext = class { state = 'running'; resume() { return Promise.resolve(); } };
    const audio = new GameAudio();
    const seen: unknown[] = [];
    audio.onUnlock = context => seen.push(context);
    expect(seen).toHaveLength(0); // nothing plays on load
    audio.unlock(); audio.unlock(); audio.unlock();
    expect(seen).toHaveLength(1);
  });
});
