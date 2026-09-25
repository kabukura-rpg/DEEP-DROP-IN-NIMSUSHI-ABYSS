import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { ABYSS, ABYSS_PHASES } from '../src/data/abyss';
import { BOSS_APPROACH, BOSS_SUMMON, NIMUSHI, NIMUSHI_ATTACKS, TRIPLE_SHOT, approachExtra } from '../src/data/nimushi';
import { GRAVITY_DIRECTION } from '../src/data/bossPhysics';
import { WORLD } from '../src/data/balance';
import { ENEMY_TYPES } from '../src/data/enemies';
import { defeatNimushi, feedWindow, fighting, intoTheAbyss, pin, round, seeded, shootBody, shootEye, STEP } from './nimushi';
import { entered, replaySignature } from './regressionSignature';

/**
 * BOSS PARITY PASS -- NIMUSHI VERSION.
 *
 * The fight keeps NIMUSHI, its look and the reversed gravity, and takes the original's structure:
 * an approach to a sleeping boss the player starts, then a weak point open until it has taken
 * enough, a TAPIOCA BARRIER, a three-way shot, a summon from the stretch's own AREA, and the barrier
 * dropping again. Every fixture here is seeded.
 */

/** A run taken the way LEVEL SELECT's BOSS takes it: the staging room, the seal, the reversal. */
function throughTheFront(seed: number) {
  const g = new GameModel(false, seeded(seed));
  expect(g.warpTo('boss')).toBe(true);
  intoTheAbyss(g);
  const flips: number[] = [];
  for (let i = 0; i < 6 / STEP && g.abyssStage !== 'fight'; i++) {
    g.step(STEP, 0, false);
    for (const e of g.events) if (e.type === 'gravityFlip') flips.push(e.value ?? -1);
  }
  return { g, flips };
}

describe('the approach', () => {
  it('opens the arena through the ordinary reversal, with gravity turned exactly as before', () => {
    const { g, flips } = throughTheFront(3);
    expect(g.abyssStage).toBe('fight');
    expect(g.gravitySign).toBe(GRAVITY_DIRECTION.boss);
    expect(flips).toContain(1);
    // The reversal's own beats are the ones it always had.
    expect([ABYSS.hold, ABYSS.reverse]).toEqual([0.5, 1.0]);
  });

  it('finds NIMUSHI asleep, a viewport further off than the fight, and off the top of the view', () => {
    for (const seed of [3, 4, 5]) {
      const { g } = throughTheFront(seed);
      expect(g.boss.state).toBe('dormant');
      expect(g.boss.started).toBe(false);
      expect(g.boss.reach(g.player.y)).toBeGreaterThan(BOSS_APPROACH.triggerGap + WORLD.height * 0.9);
      const b = g.boss.framedBody;
      expect(b.y + b.height).toBeLessThanOrEqual(g.cameraY);
    }
  });

  it('cannot hurt anyone before the fight begins, and shows it before it begins', () => {
    for (const seed of [11, 12, 13, 14, 15, 16]) for (const firing of [false, true]) {
      const { g } = throughTheFront(seed);
      const hp = g.hp;
      let seen = -1, woke = -1;
      for (let i = 0; i < 12 / STEP && g.state === 'boss' && !g.boss.started; i++) {
        g.player.invincible = 0;
        g.step(STEP, 0, firing && i % 10 < 5);
        const b = g.boss.framedBody;
        if (seen < 0 && b.y + b.height > g.cameraY) seen = i;
        if (g.boss.started) woke = i;
        // Nothing of NIMUSHI's is in the air while it sleeps.
        if (!g.boss.started) expect(g.boss.tapiocas.length + g.boss.beams.length).toBe(0);
      }
      expect({ seed, firing, hurt: hp - g.hp }).toEqual({ seed, firing, hurt: 0 });
      expect(woke).toBeGreaterThan(0);
      expect(seen).toBeGreaterThanOrEqual(0);
      // Seen for at least half a second before it wakes: found, then started.
      expect((woke - seen) * STEP).toBeGreaterThan(0.5);
    }
  });

  it('ignores a body contact while asleep', () => {
    const { g } = throughTheFront(7);
    const hp = g.hp;
    // Put the player in the body, and hold the boss asleep for the frame by keeping it out of reach
    // of its own trigger: the contact rule itself is what is under test.
    const box = g.boss.contactBox;
    g.player.x = box.x + box.width / 2; g.player.y = box.y + box.height / 2; g.player.invincible = 0;
    g.cameraY = g.player.y - WORLD.height * BOSS_APPROACH.playerShare;
    (g.boss as unknown as { update(): unknown[] }).update = () => [];
    g.step(STEP, 0, false);
    expect(g.hp).toBe(hp);
  });

  it('starts on the first round that lands, once NIMUSHI is in sight', () => {
    const { g } = throughTheFront(8);
    // Climb until it is on screen, holding back so the trigger distance is not what wakes it.
    for (let i = 0; i < 10 / STEP; i++) {
      const b = g.boss.framedBody;
      if (b.y + b.height > g.cameraY + 60) break;
      g.player.invincible = 9; g.step(STEP, 0, false);
    }
    expect(g.boss.started).toBe(false);
    expect(g.boss.reach(g.player.y)).toBeGreaterThan(BOSS_APPROACH.triggerGap);
    shootBody(g, 1);
    expect(g.boss.started).toBe(true);
    expect(g.boss.hp).toBe(NIMUSHI.maxHp - 1);
    // ...and it comes to the fight's distance rather than leaving the player out of it.
    for (let i = 0; i < 4 / STEP && !g.boss.engaged; i++) { g.player.invincible = 9; g.step(STEP, 0, false); }
    expect(g.boss.engaged).toBe(true);
    expect(g.boss.reach(g.player.y)).toBeLessThanOrEqual(BOSS_APPROACH.triggerGap + 1);
  });

  it('does not wake to a round fired at it before it is in sight', () => {
    const { g } = throughTheFront(9);
    const b = g.boss.framedBody;
    expect(b.y + b.height).toBeLessThanOrEqual(g.cameraY);
    g.bullets.push(round(g.boss.x, g.boss.eye.y + g.boss.eye.height / 2, 1));
    g.step(STEP, 0, false);
    expect(g.boss.started).toBe(false);
  });

  it('starts when the player comes within the fight\'s distance', () => {
    const { g } = throughTheFront(10);
    let woke = false;
    for (let i = 0; i < 15 / STEP && !woke; i++) { g.player.invincible = 9; g.step(STEP, 0, false); woke = g.boss.started; }
    expect(woke).toBe(true);
    expect(g.boss.reach(g.player.y)).toBeLessThanOrEqual(BOSS_APPROACH.triggerGap + 1);
  });

  it('offers the three distances for review, and opens at the chosen one', () => {
    expect(BOSS_APPROACH.options).toEqual({ now: 0, half: 0.5, one: 1 });
    for (const [name, views] of Object.entries(BOSS_APPROACH.options)) {
      const saved = approachExtra.views;
      approachExtra.views = views;
      try {
        const g = new GameModel(false, seeded(21));
        g.jumpToNimushi();
        const gap = g.boss.reach(g.player.y) + NIMUSHI.bodyHeight / 2;
        expect({ name, gap: Math.round(gap) }).toEqual({ name, gap: Math.round(NIMUSHI.restGap + views * WORLD.height) });
      } finally { approachExtra.views = saved; }
    }
  });
});

describe('the barrier cycle', () => {
  it('takes damage with the barrier down, anywhere on NIMUSHI', () => {
    const g = fighting(30);
    expect(g.boss.barrier).toBe(false);
    const hp = g.boss.hp;
    shootEye(g, 1); shootBody(g, 1);
    expect(g.boss.hp).toBe(hp - 2);
  });

  it('raises the barrier once the window has taken its damage, and not before', () => {
    const g = fighting(31);
    let taken = NIMUSHI.maxHp - g.boss.hp;
    while (g.boss.state === 'eyeOpen') {
      expect(g.boss.barrier).toBe(false);
      shootEye(g, 1); taken++;
    }
    expect(g.boss.barrier).toBe(true);
    expect(taken).toBeGreaterThanOrEqual(NIMUSHI.eyeWindow.damage);
    expect(taken).toBeLessThanOrEqual(NIMUSHI.eyeWindow.damage + 1);
  });

  it('blocks every round behind the barrier, and says so where it was blocked', () => {
    const g = fighting(32);
    while (g.boss.state === 'eyeOpen') shootEye(g, 4);
    const hp = g.boss.hp;
    for (let i = 0; i < 6; i++) {
      g.events.length = 0;
      if (i % 2) shootEye(g, 3); else shootBody(g, 3);
      expect(g.boss.hp).toBe(hp);
      expect(g.events.some(e => e.type === 'bossHit' && (e.value ?? 0) < 0)).toBe(true);
    }
  });

  it('runs the original\'s order: barrier, three-way shot, summon, barrier down -- and repeats', () => {
    const g = fighting(33);
    const order: string[] = [];
    let was = '';
    for (let i = 0; i < 40 / STEP && g.state === 'boss' && !g.boss.defeated; i++) {
      g.player.invincible = 9; feedWindow(g, i); pin(g, 360);
      g.step(STEP, 0, false);
      const st = g.boss.state === 'attackPrep' ? `prep:${(g.boss as unknown as { pendingAttack: string }).pendingAttack}` : g.boss.state;
      if (st !== was) order.push(st);
      was = st;
    }
    const cycle = ['eyeClosing', 'prep:tripleShot', 'tripleShot', 'prep:enemySummon', 'enemySummon', 'recovery', 'eyeOpen'];
    const text = order.join('>');
    // At least three whole cycles, each in the original's order, stretch changes aside.
    const cycles = text.split(cycle.join('>')).length - 1;
    expect(cycles).toBeGreaterThanOrEqual(3);
    // The barrier is up for every state between the window closing and it opening again.
    expect(ABYSS_PHASES.every(p => p.attacks.join() === 'tripleShot,enemySummon')).toBe(true);
  });

  it('keeps the barrier up for the whole sequence and drops it in the end, every time', () => {
    const g = fighting(34);
    let windows = 0, barrierFrames = 0, attackFramesOpen = 0;
    for (let i = 0; i < 40 / STEP && g.state === 'boss' && !g.boss.defeated; i++) {
      g.player.invincible = 9; feedWindow(g, i); pin(g, 360);
      const before = g.boss.state;
      g.step(STEP, 0, false);
      if (g.boss.barrier) barrierFrames++;
      if (['tripleShot', 'enemySummon', 'attackPrep', 'recovery', 'eyeClosing'].includes(g.boss.state) && g.boss.eyeOpen) attackFramesOpen++;
      if (g.boss.state === 'eyeOpen' && before !== 'eyeOpen') windows++;
    }
    expect(barrierFrames).toBeGreaterThan(0);
    expect(attackFramesOpen).toBe(0);
    expect(windows).toBeGreaterThanOrEqual(3);
  });

  it('can still be defeated, through the cycle, on every seed tried', () => {
    for (const seed of [40, 41, 42]) expect(defeatNimushi(fighting(seed))).toBe(true);
  });
});

describe('TRIPLE SHOT', () => {
  /** A fight with the barrier just raised and the three-way shot about to be wound up. */
  function toTriple(seed: number) {
    const g = fighting(seed);
    for (let i = 0; i < 10 / STEP && g.boss.state !== 'attackPrep'; i++) { g.player.invincible = 9; feedWindow(g, i); pin(g, 360); g.step(STEP, 0, false); }
    expect((g.boss as unknown as { pendingAttack: string }).pendingAttack).toBe('tripleShot');
    return g;
  }

  it('announces itself before it fires, with the barrier already up', () => {
    const g = toTriple(50);
    expect(g.boss.barrier).toBe(true);
    let told = 0;
    for (let i = 0; i < NIMUSHI_ATTACKS.tripleShot.prep / STEP - 2; i++) {
      g.player.invincible = 9; pin(g, 360); g.step(STEP, 0, false);
      if (g.boss.tripleTelegraph) told++;
      expect(g.boss.tapiocas.length).toBe(0);
    }
    expect(told).toBeGreaterThan(0.6 / STEP);
  });

  it('fires three pearls a volley, the middle one at the player, the others either side', () => {
    const g = toTriple(51);
    // The aim is locked as the wind-up starts -- the lines drawn are the lines used -- so it is read
    // against where the player was on that frame.
    const aim = Math.atan2(g.player.y - g.boss.face, g.player.x - g.boss.x);
    expect(Math.abs(g.boss.tripleTelegraph!.angles[1] - aim)).toBeLessThan(0.02);
    for (let i = 0; i < 2 / STEP && g.boss.tapiocas.length === 0; i++) { g.player.invincible = 9; pin(g, 360); g.step(STEP, 0, false); }
    const volley = g.boss.tapiocas;
    expect(volley.length).toBe(3);
    const angles = volley.map(p => Math.atan2(p.vy, p.vx)).sort((a, b) => a - b);
    expect(Math.abs(angles[1] - aim)).toBeLessThan(0.08);
    expect(angles[2] - angles[1]).toBeCloseTo(TRIPLE_SHOT.spread, 3);
    expect(angles[1] - angles[0]).toBeCloseTo(TRIPLE_SHOT.spread, 3);
  });

  it('fires every volley, and each one leaves room between its pearls at the fight\'s shortest range', () => {
    const g = toTriple(52);
    const ids = new Set<number>();
    for (let i = 0; i < 4 / STEP; i++) { g.player.invincible = 9; pin(g, 360); g.step(STEP, 0, false); for (const p of g.boss.tapiocas) ids.add(p.id); }
    expect(ids.size).toBe(TRIPLE_SHOT.volleys * 3);
    // Two neighbouring pearls, 150px out, are further apart than the player plus both pearls.
    const apart = 2 * 150 * Math.sin(TRIPLE_SHOT.spread / 2);
    expect(apart).toBeGreaterThan(18 + TRIPLE_SHOT.size * 2 + 20);
  });

  it('is answered by a step aside: a player who moves once the lines show is not hit', () => {
    let runs = 0;
    for (const seed of [53, 54, 55, 56, 57, 58]) {
      const g = toTriple(seed);
      const hp = g.hp;
      // Read the lines, then step out from between the middle one and its neighbour.
      const tell = g.boss.tripleTelegraph!;
      const mid = tell.angles[1];
      const side = Math.cos(mid) >= 0 ? -1 : 1;
      for (let i = 0; i < 3 / STEP; i++) {
        g.player.invincible = 0;
        pin(g, 360);
        const t = g.boss.tripleTelegraph;
        const dir = t ? side : 0;
        g.step(STEP, dir as -1 | 0 | 1, false);
      }
      expect({ seed, hurt: hp - g.hp }).toEqual({ seed, hurt: 0 });
      runs++;
    }
    expect(runs).toBe(6);
  });
});

describe('the SUMMON', () => {
  it('calls up the stretch\'s own AREA, into the ordinary enemy list, clear of the player', () => {
    for (const phaseId of [1, 2, 3, 4] as const) {
      const g = fighting(60 + phaseId);
      (g.boss as unknown as { phaseId: number }).phaseId = phaseId;
      // HP inside that stretch, with a whole window to spare, so closing the window stays in it.
      g.boss.hp = Math.floor(NIMUSHI.maxHp * ABYSS_PHASES[phaseId - 1].from) - NIMUSHI.eyeWindow.damage - 4;
      const pool = ABYSS_PHASES[phaseId - 1].summonPool;
      const before = new Set(g.enemies.map(e => e.id));
      let summoned: typeof g.enemies = [];
      for (let i = 0; i < 12 / STEP && !summoned.length; i++) {
        g.player.invincible = 9; feedWindow(g, i); pin(g, 360);
        g.step(STEP, 0, false);
        if (g.boss.state === 'enemySummon') summoned = g.enemies.filter(e => !before.has(e.id) && pool.includes(e.kind));
      }
      expect({ phaseId, count: summoned.length }).toEqual({ phaseId, count: BOSS_SUMMON.count[phaseId - 1] });
      for (const e of summoned) {
        expect(pool).toContain(e.kind);
        expect(ENEMY_TYPES[e.kind].flying).toBe(true);
        expect(Math.hypot(e.x - g.player.x, e.y - g.player.y)).toBeGreaterThanOrEqual(BOSS_SUMMON.clearOfPlayer);
      }
    }
  });

  it('uses each AREA\'s own roster, stretch by stretch', () => {
    expect(ABYSS_PHASES.map(p => [...p.summonPool])).toEqual([
      ['caveBat', 'spore', 'watcher'], ['flyingSkull', 'shadeOrb'], ['biter', 'riserJelly'], ['voidWisp', 'hollowShade', 'angryOrb'],
    ]);
  });

  it('never lands a hit in the first half second after a summon', () => {
    for (const seed of [70, 71, 72, 73, 74, 75, 76, 77]) {
      const g = fighting(seed);
      for (let i = 0; i < 12 / STEP && g.boss.state !== 'enemySummon'; i++) { g.player.invincible = 9; feedWindow(g, i); pin(g, 360); g.step(STEP, 0, false); }
      expect(g.boss.state).toBe('enemySummon');
      g.boss.tapiocas = [];
      const hp = g.hp;
      for (let i = 0; i < 0.5 / STEP; i++) { g.player.invincible = 0; g.step(STEP, 0, false); }
      expect({ seed, hurt: hp - g.hp }).toEqual({ seed, hurt: 0 });
    }
  });
});

describe('isolation', () => {
  /**
   * Every one of the twelve SECTIONs plays exactly as it did at 5de724e (POST-CLONE CUSTOM PASS 1):
   * replayed from its own entry, digest taken with this same helper on that commit.
   */
  const AT_5DE724E: Record<string, string> = {
    '1-1': '414b1f52261b82c067509d92', '1-2': '22ddb6304f988ed56d4538e5', '1-3': '683c2598a46b4eadcc576b35',
    '2-1': '95ebcdc29407d78501ec1a47', '2-2': 'f5d50c7e36c05e33c315524d', '2-3': 'e5f4c74110599c23f5ad5b62',
    '3-1': 'd813e6aa01f3d20ed9e034a4', '3-2': '27a110a2880f9aaaafae8a08', '3-3': 'b1c14c441b457f2baa84336f',
    '4-1': '9e7c6b738ad3bd3514afd646', '4-2': '516e68ff1ffddfa04e93b75f', '4-3': '2ebcb752cd22d061e39e6733',
  };
  it('plays all twelve SECTIONs exactly as 5de724e did', () => {
    for (const a of [1, 2, 3, 4] as const) for (const s of [1, 2, 3] as const) {
      expect(replaySignature(entered(g => g.jumpToStage(a, s))), `${a}-${s}`).toBe(AT_5DE724E[`${a}-${s}`]);
    }
  });
});
