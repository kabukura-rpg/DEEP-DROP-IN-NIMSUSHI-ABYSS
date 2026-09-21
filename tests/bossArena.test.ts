import { describe, expect, it } from 'vitest';
import { atNimushi, fighting, shootEye, STEP, tick, defeatNimushi } from './nimushi';
import { ABYSS_PHASES } from '../src/data/abyss';
import { NIMUSHI } from '../src/data/nimushi';
import { GameModel } from '../src/systems/GameModel';

/**
 * THE ARENA IS A NON-STOP AERIAL FIGHT.
 *
 * Human playtest: catching a ledge stopped the climb and broke the fight's tempo outright. NIMUSHI's
 * arena is its own system, so it simply has no floor -- and because CHARGE used to come from
 * landing, it now comes out of the air instead.
 */
const driveToPhase = (id: 1 | 2 | 3 | 4, seed: number) => {
  const g = fighting(seed);
  if (id > 1) {
    g.boss.hp = Math.round(NIMUSHI.maxHp * ABYSS_PHASES[id - 1].from);
    g.boss.phaseId = id;
    (g as unknown as { enterAbyssPhase(p: typeof ABYSS_PHASES[number]): void }).enterAbyssPhase(ABYSS_PHASES[id - 1]);
  }
  return g;
};

describe('no floor, in any stretch', () => {
  it('leaves the player airborne for a whole fight', () => {
    const g = fighting(60);
    let grounded = 0, settled = 0;
    for (let i = 0; i < 25 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.step(STEP, Math.sin(i / 90) > 0 ? 1 : -1, i % 50 === 0);
      if (g.player.grounded !== -1) grounded++;
      if (g.events.some(e => e.type === 'comboSettle')) settled++;
      g.events.length = 0;
    }
    expect(grounded).toBe(0);
    expect(settled).toBe(0);
  });

  it('lays nothing ahead of the player in any stretch', () => {
    for (const id of [1, 2, 3, 4] as const) {
      const g = driveToPhase(id, 61 + id);
      tick(g, 4);
      const ahead = g.platforms.filter(row => (row.y - g.player.y) * g.gravitySign > 0);
      expect({ id, ahead: ahead.length, doodads: g.doodads.length }).toEqual({ id, ahead: 0, doodads: 0 });
    }
  });

  it('keeps the vertical fall going -- nothing in the arena zeroes it', () => {
    const g = fighting(66);
    tick(g, 2);
    let stalled = 0, frames = 0, zeroes = 0, run = 0, longestZero = 0;
    for (let i = 0; i < 12 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      // Stomp what is there. NIMUSHI no longer holds the player at a safe distance, so surviving
      // long enough to measure anything means playing the loop rather than standing in it.
      const target = g.enemies.filter(e => e.alive && e.stompable)
        .sort((a, b) => Math.abs(a.y - g.player.y) - Math.abs(b.y - g.player.y))[0];
      g.step(STEP, target ? Math.sign(target.x - g.player.x) : 0, false);
      // A bounce apex passes through zero, which is ordinary physics rather than a stall. What must
      // never happen is being GROUNDED -- the arena has no floor -- or sitting at zero.
      if (g.player.grounded !== -1) stalled++;
      if (g.player.vy === 0) zeroes++;
      run = g.player.vy === 0 ? run + 1 : 0;
      longestZero = Math.max(longestZero, run);
      frames++;
    }
    expect(frames).toBeGreaterThan(100);
    expect(stalled).toBe(0);
    // Passing through zero is fine; resting at it is not.
    expect(longestZero).toBeLessThan(3);
    expect(zeroes).toBeLessThan(frames * 0.05);
  });
});

describe('the fight still works end to end', () => {
  it('survives the arena as long as the player keeps stomping', () => {
    // The fight is survivable by PLAYING it, not by standing in it: doing nothing is a fall into
    // the body, which is the point of the reset.
    const g = fighting(73);
    tick(g, 1);
    for (let i = 0; i < 12 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      const target = g.enemies.filter(e => e.alive && e.stompable)
        .sort((a, b) => Math.abs(a.y - g.player.y) - Math.abs(b.y - g.player.y))[0];
      g.step(STEP, target ? Math.sign(target.x - g.player.x) : 0, false);
    }
    expect(g.state).toBe('boss');
  });

  it('can still be won through all four stretches, with no floor to rest on', () => {
    const g = fighting(74);
    expect(defeatNimushi(g)).toBe(true);
    expect(g.boss.phaseId).toBe(4);
  });

  it('keeps the weak point live', () => {
    const g = atNimushi(75);
    const before = g.boss.hp;
    shootEye(g, 1);
    expect(g.boss.hp).toBeLessThan(before);
  });
});
