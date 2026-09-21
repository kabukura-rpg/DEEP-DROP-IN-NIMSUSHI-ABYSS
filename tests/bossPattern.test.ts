import { describe, expect, it } from 'vitest';
import { atNimushi, fighting, laneOf, STEP, tick } from './nimushi';
import { NIMUSHI, TAPIOCA_SHOWER, FULL_SCREEN_TAPIOCA, STRAW_BEAM, TAPIOCA_CUP, ATTACK_STATES } from '../src/data/nimushi';
import { BOSS_PHYSICS } from '../src/data/bossPhysics';
import { WORLD } from '../src/data/balance';

/**
 * EVERY ATTACK MUST HAVE A READABLE SAFE ROUTE.
 *
 * The attacks are DISABLED in the prototype, so what survives here is the data-level guarantee: the
 * corridor's shape, its walk, and the telegraphs. The live-attack cases went with the rotation and
 * come back when the attacks do -- in the order SHOWER, BEAM, CLONES, CUP, one at a time.
 *
 * Human playtest called the tapioca barrage unavoidable. It was never bullet soup -- the corridor
 * was always guaranteed -- but it was two lanes wide and moved every 0.4s, so answering it meant
 * walking correctly from the first wave with no time to look at it. These tests hold the difference
 * between "a gap exists" and "a gap a person can find and reach".
 */
const SPAN = WORLD.width - WORLD.wall * 2;
const laneWidth = (lanes: number) => SPAN / lanes;

describe('the shower is a pattern, not a barrage', () => {
  it('leaves a corridor wide enough to see and to stand in', () => {
    expect(TAPIOCA_SHOWER.safeLanes).toBeGreaterThanOrEqual(3);
    const corridor = laneWidth(TAPIOCA_SHOWER.lanes) * TAPIOCA_SHOWER.safeLanes;
    // Comfortably wider than the player, and a real fraction of the shaft.
    expect(corridor).toBeGreaterThan(120);
    expect(corridor / SPAN).toBeGreaterThan(0.3);
  });

  it('gives more than enough time to walk to the next gap', () => {
    // The corridor moves at most one lane per wave, so following it costs one lane of travel.
    const crossing = laneWidth(TAPIOCA_SHOWER.lanes) / BOSS_PHYSICS.moveSpeed;
    expect(TAPIOCA_SHOWER.waveInterval).toBeGreaterThan(crossing * 2);
  });

  it('runs a handful of waves, not a stream', () => {
    const waves = NIMUSHI.recovery && Math.round(2.4 / TAPIOCA_SHOWER.waveInterval);
    expect(waves).toBeGreaterThanOrEqual(2);
    expect(waves).toBeLessThanOrEqual(4);
  });

  it('never builds a wave without a gap, and moves it one lane at a time', () => {
    const g = atNimushi(200);
    const seen: number[][] = [];
    for (let i = 0; i < 24; i++) seen.push(g.boss.spawnShowerWave(() => (i * 0.137) % 1));
    for (const safe of seen) {
      expect(safe.length).toBe(TAPIOCA_SHOWER.safeLanes);
      // Adjacent, so the corridor is one opening rather than scattered slots.
      for (let i = 1; i < safe.length; i++) expect(safe[i] - safe[i - 1]).toBe(1);
      for (const lane of safe) expect(lane).toBeGreaterThanOrEqual(0);
      for (const lane of safe) expect(lane).toBeLessThan(TAPIOCA_SHOWER.lanes);
    }
    for (let i = 1; i < seen.length; i++) {
      expect(Math.abs(seen[i][0] - seen[i - 1][0])).toBeLessThanOrEqual(1);
    }
  });

});

describe('FINAL RAGE keeps its corridor', () => {
  it('never seals the screen, however fast it goes', () => {
    expect(FULL_SCREEN_TAPIOCA.corridor).toBeGreaterThanOrEqual(2);
    const corridor = laneWidth(FULL_SCREEN_TAPIOCA.lanes) * FULL_SCREEN_TAPIOCA.corridor;
    expect(corridor).toBeGreaterThan(60);
  });

  it('moves its corridor one lane at a time, like the ordinary shower', () => {
    const g = atNimushi(202);
    const seen: number[][] = [];
    for (let i = 0; i < 20; i++) seen.push(g.boss.spawnRageWave());
    for (const safe of seen) {
      expect(safe.length).toBe(FULL_SCREEN_TAPIOCA.corridor);
      for (let i = 1; i < safe.length; i++) expect(safe[i] - safe[i - 1]).toBe(1);
    }
    for (let i = 1; i < seen.length; i++) expect(Math.abs(seen[i][0] - seen[i - 1][0])).toBeLessThanOrEqual(1);
  });
});

describe('the four attacks ask for different answers', () => {
  it('telegraphs the beam before it can hurt, and leaves the rest of the shaft open', () => {
    expect(STRAW_BEAM.warning).toBeGreaterThan(0.6);
    // A column, not a curtain: the shaft is far wider than the beam, so stepping out is the answer.
    expect(STRAW_BEAM.width).toBeLessThan(SPAN * 0.25);
  });

  it('warns before a cup fires, and lets the cup be shot down', () => {
    expect(TAPIOCA_CUP.warning).toBeGreaterThan(0.5);
    expect(TAPIOCA_CUP.hp).toBeGreaterThan(0);
  });

});

/**
 * The SHOWER is the one attack the player fights THROUGH rather than waits out.
 *
 * This replaces "never has the eye open while an attack is running", which was true of a fight that
 * alternated between attacking and being attacked. That alternation turned the attack's own 2.4s
 * into a stretch with nothing in it but dodging -- a different game wearing the same costume. The
 * wind-up is still a pure warning; what changed is the answer to it.
 */
describe('the shower is fought through, not waited out', () => {
  it('keeps the eye SHUT through the wind-up and OPEN through the shower', () => {
    const g = fighting(204);
    let prepOpen = 0, prepFrames = 0, showerShut = 0, showerFrames = 0;
    for (let i = 0; i < 60 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.step(STEP, 0, false);
      if (g.boss.state === 'attackPrep') { prepFrames++; if (g.boss.eyeOpen) prepOpen++; }
      if (g.boss.state === 'tapiocaShower') { showerFrames++; if (!g.boss.eyeOpen) showerShut++; }
    }
    expect(prepFrames).toBeGreaterThan(0);
    expect(showerFrames).toBeGreaterThan(0);
    // Closed for the tell...
    expect(prepOpen).toBe(0);
    // ...open for the answer.
    expect(showerShut).toBe(0);
  });

  it('leaves the other three shut, whenever they come back', () => {
    // BEAM, CUP and CLONES are out of every rotation, and opening the eye is not something they
    // inherit: only `tapiocaShower` is named in `eyeOpen`.
    const g = fighting(205);
    const machine = g.boss as unknown as { state: string };
    for (const id of ['strawBeam', 'cupSummon', 'nimushiClones'] as const) {
      machine.state = ATTACK_STATES[id];
      expect({ id, open: g.boss.eyeOpen }).toEqual({ id, open: false });
    }
    machine.state = ATTACK_STATES.tapiocaShower;
    expect(g.boss.eyeOpen).toBe(true);
  });
});
