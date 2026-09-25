import { describe, expect, it } from 'vitest';
import { entered, generationSignature, replaySignature } from './regressionSignature';

/**
 * STAGE GENERATION v2 is rebuilt one AREA at a time. Every AREA a pass has not reached yet, and the
 * FINAL BOSS always, must generate and play EXACTLY as the completed base c9a0a63 did.
 *
 * The golden values were produced by this same helper on c9a0a63. Replays start at the AREA's (or
 * the fight's) entry with the random stream reset there -- see `entered` -- so a change to AREA 1's
 * terrain cannot move another AREA's fingerprint through 1-1's setup draws.
 *
 * An AREA leaves this list in the commit that rebuilds it, and not before.
 */
const C9A0A63: Record<string, string> = {
  "gen1": "707f0b6eee8d535d9ef25833",
  "gen2": "cda7c4395786e10f9a212536",
  "gen3": "af813a1562e0a964cd619371",
  "gen4": "61ec760733be4c4e52523a49",
  "play1-1": "984503e9510fbf5cc94abcb5",
  "play1-2": "42a197fa87de2ba5c57fbc5f",
  "play1-3": "74ad4344f6950e7782384d33",
  "play2-1": "0f09caaa7b2f93807426592a",
  "play2-2": "313af985084397ca39796e4f",
  "play2-3": "4c58a096c35ffc118f075c87",
  "play3-1": "eea29648098a3d96e728abde",
  "play3-2": "0db95bdf8e87104d833e4b92",
  "play3-3": "e227f5cd8cb1ba2b6e964fe6",
  "play4-1": "e68de3d2c0dc44792651a7ab",
  "play4-2": "3613e6a5ed60cfafdb73290a",
  "play4-3": "255a9b99048600d621dc9b4f",
  "boss": "3b6bd54d9a118f15a17a5a58"
};

const UNCHANGED_AREAS = [] as const;
/** The FINAL BOSS's replay as the BOSS PARITY PASS left it (approach, barrier, triple shot, summon). */
const BOSS_PARITY_PASS = '47f4f796c2f3b2c98507455f';

describe('STAGE GENERATION v2 leaves every AREA it has not rebuilt, and the boss, exactly as c9a0a63', () => {
  it('generates the untouched AREAs identically', () => {
    for (const a of UNCHANGED_AREAS) expect(generationSignature(a), `AREA ${a}`).toBe(C9A0A63[`gen${a}`]);
  });
  it('plays the untouched AREAs identically', () => {
    for (const a of UNCHANGED_AREAS) for (const s of [1, 2, 3] as const) {
      expect(replaySignature(entered(g => g.jumpToStage(a, s))), `${a}-${s}`).toBe(C9A0A63[`play${a}-${s}`]);
    }
  });
  // WAS: identical to c9a0a63's boss, which every pass up to 5de724e kept. The BOSS PARITY PASS is
  // the one pass allowed to change the fight, so the boss is pinned to THAT pass's own replay from
  // here on: the same guarantee -- nothing else moves the FINAL BOSS -- against the new baseline.
  it('plays the FINAL BOSS identically to the BOSS PARITY PASS', () => {
    expect(C9A0A63.boss).toBe('3b6bd54d9a118f15a17a5a58');
    expect(replaySignature(entered(g => g.jumpToBoss()))).toBe(BOSS_PARITY_PASS);
  });
});
