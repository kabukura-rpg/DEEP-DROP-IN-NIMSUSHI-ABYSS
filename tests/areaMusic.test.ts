import { afterEach, describe, expect, it } from 'vitest';
import { AREA_MUSIC, MUSIC, TRACK_GAIN, musicTrack } from '../src/systems/Music';
import { GameAudio, SFX, chimePeak, sfxPeak, type SoundId } from '../src/systems/Audio';
import { GameModel } from '../src/systems/GameModel';
import { GUN_MODULES, GUN_MODULE_IDS } from '../src/data/gunModules';

/** AREA BGM: which track each AREA plays, when it changes, and that ♪ off always wins. */
describe('the AREA tracks', () => {
  it('maps each AREA to its own file, shipped from src/assets/audio', () => {
    const files = { 1: 'The_Mossy_Monolith.mp3', 2: 'Beneath_the_Stone_Vault.mp3', 3: 'Sunken_Meridian.mp3', 4: 'Cavernous_Drift.mp3' } as const;
    for (const [area, file] of Object.entries(files)) {
      const url = AREA_MUSIC[Number(area) as 1 | 2 | 3 | 4];
      expect(url, file).toContain(file.replace('.mp3', ''));
      expect(url, file).not.toContain('dist/');
    }
    expect(new Set([1, 2, 3, 4].map(a => AREA_MUSIC[a as 1 | 2 | 3 | 4])).size).toBe(4);
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

describe('the FINAL BOSS track', () => {
  const at = (screen: { mode: string; abyss?: boolean; bossStarted?: boolean; muted?: boolean }) =>
    musicTrack({ area: 4, muted: false, ...screen });

  it('is pressure_in_the_deep, shipped from src/assets/audio like the AREA tracks', () => {
    expect(AREA_MUSIC.boss).toContain('pressure_in_the_deep');
    expect(AREA_MUSIC.boss).not.toContain('dist/');
    expect(new Set(Object.values(AREA_MUSIC)).size).toBe(5);
  });

  it('keeps THE ABYSS silent until the fight starts, then plays only the boss track', () => {
    // Staging room and the approach: in THE ABYSS, NIMUSHI not yet awake.
    expect(at({ mode: 'boss', abyss: true, bossStarted: false })).toBeNull();
    // The encounter has begun.
    expect(at({ mode: 'boss', abyss: true, bossStarted: true })).toBe('boss');
  });

  it('holds the boss track (or the silence) through PAUSE in THE ABYSS -- never AREA 4\'s', () => {
    expect(at({ mode: 'paused', abyss: true, bossStarted: true })).toBe('boss');
    expect(at({ mode: 'paused', abyss: true, bossStarted: false })).toBeNull();
  });

  it('stops for GAME CLEAR, GAME OVER and the title, and stays silent with ♪ off', () => {
    for (const mode of ['clear', 'over', 'title']) expect(at({ mode, abyss: true, bossStarted: true }), mode).toBeNull();
    expect(at({ mode: 'boss', abyss: true, bossStarted: true, muted: true })).toBeNull();
  });

  it('starts with the model\'s own encounter flag, not with NIMUSHI coming into view', () => {
    const game = new GameModel();
    game.jumpToBoss();
    expect(game.state).toBe('boss');
    expect(game.boss.started).toBe(false);
    expect(musicTrack({ mode: 'boss', area: game.stage.config.id, muted: false, abyss: true, bossStarted: game.boss.started })).toBeNull();
  });
});

describe('per-track gain', () => {
  it('AUDIO SECOND PASS: AREA 1 at 1.2 and the fight untrimmed, AREA 2-4 and the shared volume as they were', () => {
    expect(MUSIC.volume).toBe(0.099);
    expect(TRACK_GAIN).toEqual({ 1: 1.2, 2: 1, 3: 1, 4: 1, boss: 1 });
    const db = (after: number, before: number) => 20 * Math.log10(after / before);
    // AREA 1: 0.099 -> 0.1188, +1.6 dB. The fight: 0.0792 -> 0.099, +1.9 dB.
    expect(MUSIC.volume * TRACK_GAIN[1]).toBeCloseTo(0.1188, 6);
    expect(db(MUSIC.volume * TRACK_GAIN[1], 0.099)).toBeGreaterThanOrEqual(1.5);
    expect(db(MUSIC.volume * TRACK_GAIN[1], 0.099)).toBeLessThanOrEqual(2);
    expect(MUSIC.volume * TRACK_GAIN.boss).toBeCloseTo(0.099, 6);
    expect(db(MUSIC.volume * TRACK_GAIN.boss, 0.0792)).toBeCloseTo(1.94, 2);
    for (const area of [2, 3, 4] as const) expect(MUSIC.volume * TRACK_GAIN[area], String(area)).toBeCloseTo(0.099, 6);
  });

  it('BGM VOLUME UP: every track +3 dB from 0.07 by one shared multiplier, the fades and the effects untouched', () => {
    const before = 0.07;
    const ratio = MUSIC.volume / before;
    expect(ratio).toBeCloseTo(Math.SQRT2, 2);
    expect(20 * Math.log10(ratio)).toBeCloseTo(3, 1);
    // The same ratio for every track: the boss trim against the AREA tracks is what it was.
    for (const track of [1, 2, 3, 4, 'boss'] as const) {
      expect(MUSIC.volume * TRACK_GAIN[track] / (before * TRACK_GAIN[track]), String(track)).toBeCloseTo(ratio, 10);
      expect(MUSIC.volume * TRACK_GAIN[track]).toBeLessThanOrEqual(1);
    }
    expect({ fadeOut: MUSIC.fadeOut, fadeIn: MUSIC.fadeIn }).toEqual({ fadeOut: 0.35, fadeIn: 0.5 });
  });
});

/** Records every scheduled value, so the envelopes the engine actually builds can be read back. */
class RecordingAudioContext {
  state = 'running'; currentTime = 0; destination = {};
  static log: { node: string; kind: 'set' | 'exp'; value: number; at: number }[] = [];
  resume() { /* running */ }
  private param(node: string) {
    const log = RecordingAudioContext.log;
    return {
      setValueAtTime: (value: number, at: number) => log.push({ node, kind: 'set', value, at }),
      exponentialRampToValueAtTime: (value: number, at: number) => log.push({ node, kind: 'exp', value, at }),
    };
  }
  createOscillator() { return { type: '', frequency: this.param('freq'), connect() {}, start() {}, stop() {} }; }
  createGain() { return { gain: this.param('gain'), connect() {} }; }
}

describe('AUDIO SECOND PASS: the effects', () => {
  const OLD = { voice: 0.035, chime: 0.018 };
  const db = (after: number, before: number) => 20 * Math.log10(after / before);
  const record = (kind: SoundId, combo = 0) => {
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = RecordingAudioContext;
    const audio = new GameAudio(); audio.unlock();
    RecordingAudioContext.log = [];
    audio.play(kind, combo);
    return RecordingAudioContext.log;
  };
  afterEach(() => { delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext; });

  it('raises every voice and the chime by the same master, x1.25 (+1.9 dB), keeping their balance', () => {
    expect(SFX.voice).toBe(OLD.voice);
    expect(SFX.chime).toBe(OLD.chime);
    expect(SFX.master).toBe(1.25);
    expect(db(SFX.master, 1)).toBeCloseTo(1.94, 2);
    for (const kind of ['land', 'kill', 'hurt', 'upgrade', 'empty', 'over'] as const) {
      expect(sfxPeak(kind), kind).toBeCloseTo(0.04375, 8);
      const gains = record(kind).filter(e => e.node === 'gain');
      expect(gains[0], kind).toEqual({ node: 'gain', kind: 'set', value: sfxPeak(kind), at: 0 });
      // One straight decay, exactly as before: no new stage on anything but the shot.
      expect(gains.slice(1).map(e => e.value), kind).toEqual([0.0001]);
    }
    expect(chimePeak()).toBeCloseTo(0.0225, 8);
    expect(chimePeak() / sfxPeak('kill')).toBeCloseTo(OLD.chime / OLD.voice, 10);
    // The chime rides a high combo kill at its own (unchanged) share of the master.
    const chime = record('kill', 99).filter(e => e.node === 'gain' && e.kind === 'set');
    expect(chime.map(e => e.value)).toEqual([sfxPeak('kill'), chimePeak()]);
  });

  it('gives the shot a further x1.25 and a short click on top, never a longer tail', () => {
    expect(SFX.shot).toEqual({ boost: 1.25, attack: 0.012, body: 0.6, startPitch: 1.25 });
    const peak = sfxPeak('shot');
    expect(peak).toBeCloseTo(0.0546875, 8);
    expect(db(peak, OLD.voice)).toBeCloseTo(3.88, 2);
    const log = record('shot');
    const gains = log.filter(e => e.node === 'gain');
    expect(gains).toEqual([
      { node: 'gain', kind: 'set', value: peak, at: 0 },
      { node: 'gain', kind: 'exp', value: peak * 0.6, at: 0.012 },
      { node: 'gain', kind: 'exp', value: 0.0001, at: 0.07 },
    ]);
    // Pitch: a quarter higher at the front (212.5 Hz), down to the same 65 Hz over the same 0.07s.
    const freq = log.filter(e => e.node === 'freq');
    expect(freq).toEqual([{ node: 'freq', kind: 'set', value: 212.5, at: 0 }, { node: 'freq', kind: 'exp', value: 65, at: 0.07 }]);
  });

  it('never stacks shots into a clip: even the fastest module fires after the last shot has died away', () => {
    expect(Math.min(...GUN_MODULE_IDS.map(id => GUN_MODULES[id].fireInterval))).toBeGreaterThan(0.07);
    // Everything that can sound at once -- the loudest BGM, a shot, a kill and its chime -- stays far under 1.
    const loudestMusic = Math.max(...([1, 2, 3, 4, 'boss'] as const).map(t => MUSIC.volume * TRACK_GAIN[t]));
    expect(loudestMusic + sfxPeak('shot') + sfxPeak('kill') + chimePeak()).toBeLessThan(0.3);
  });
});
