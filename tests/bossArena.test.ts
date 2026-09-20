import { describe, expect, it } from 'vitest';
import { atNimushi, fighting, round, shootEye, STEP, tick, defeatNimushi } from './nimushi';
import { ABYSS_PHASES } from '../src/data/abyss';
import { BOSS_PHYSICS } from '../src/data/bossPhysics';
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
    let stalled = 0;
    for (let i = 0; i < 12 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.step(STEP, 0, false);
      if (g.player.vy === 0) stalled++;
    }
    expect(stalled).toBe(0);
  });
});

describe('CHARGE comes out of the air', () => {
  it('is offered in every stretch, and never as a landing', () => {
    for (const phase of ABYSS_PHASES) {
      expect({ id: phase.id, orbs: phase.chargeOrbChance > 0 }).toEqual({ id: phase.id, orbs: true });
      expect({ id: phase.id, doodads: phase.doodadChance }).toEqual({ id: phase.id, doodads: 0 });
    }
  });

  it('fills the magazine when shot, without grounding or settling the player', () => {
    const g = fighting(67);
    tick(g, 3);
    const orb = g.containers.find(c => c.charge && !c.broken);
    expect(orb).toBeDefined();
    g.ammo = 0;
    g.combo = 6;
    g.events.length = 0;
    g.bullets.push(round(orb!.x + orb!.width / 2, orb!.y + orb!.height / 2, 1));
    g.step(STEP, 0, false);
    expect(orb!.broken).toBe(true);
    expect(g.ammo).toBe(g.stats.maxAmmo);
    expect(g.player.grounded).toBe(-1);
    expect(g.combo).toBe(6);
    expect(g.events.some(e => e.type === 'comboSettle')).toBe(false);
  });

  it('is not a pickup: flying through one does nothing', () => {
    const g = fighting(68);
    tick(g, 3);
    const orb = g.containers.find(c => c.charge && !c.broken);
    expect(orb).toBeDefined();
    g.ammo = 0;
    g.player.x = orb!.x + orb!.width / 2;
    g.player.y = orb!.y + orb!.height / 2;
    g.step(STEP, 0, false);
    expect(orb!.broken).toBe(false);
    expect(g.ammo).toBe(0);
  });

  it('does not hand the magazine back by accident', () => {
    const g = fighting(69);
    tick(g, 1);
    g.ammo = 2;
    for (let i = 0; i < 4 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.step(STEP, 0, false);
      // Nothing in the arena may refill CHARGE without a round being spent on an orb.
      expect(g.ammo).toBeLessThanOrEqual(2);
    }
  });
});

/**
 * A hit shoves the player toward the MIDDLE of the combat band.
 *
 * It used to push "away from NIMUSHI", described as never shoving the player into the deep. Both
 * cannot hold: NIMUSHI is ahead along the pull and the deep is behind it. Measured, that version
 * cost 31px of slack per hit and stacked -- 460px down to 366px over four hits -- which was the
 * hit-into-pressure combo it was meant to prevent. The direction now comes from the geometry.
 */
describe('being hit pushes the player toward the middle of the band', () => {
  const middleOf = (g: ReturnType<typeof fighting>) => (g.boss.face + g.boss.deepY) / 2;

  it('pushes a player who is crowding NIMUSHI back out into the fight', () => {
    const g = fighting(70);
    tick(g, 1);
    g.player.y = g.boss.face + 120 * -g.gravitySign;   // hard up against the face
    const before = g.boss.reach(g.player.y);
    g.player.invincible = 0;
    g.damage(1, 'bossContact');
    expect(Math.abs(g.player.vy)).toBeCloseTo(BOSS_PHYSICS.hazardKnockback, 0);
    g.step(STEP, 0, false);
    expect(g.boss.reach(g.player.y)).toBeGreaterThan(before);
  });

  it('lifts a player who is hit down near the deep, instead of burying them in it', () => {
    const g = fighting(71);
    tick(g, 1);
    const along = (g as unknown as { along(v: number): number }).along.bind(g);
    g.player.y = g.boss.deepY - 120 * g.gravitySign;   // low in the band
    expect(g.player.y).toBeGreaterThan(middleOf(g));
    const before = along(g.player.y - g.boss.deepY);
    g.player.invincible = 0;
    g.damage(1, 'bossContact');
    // Toward the middle from below means AGAINST the pull -- up the screen, off the boundary.
    expect(along(g.player.vy)).toBeGreaterThan(0);
    g.step(STEP, 0, false);
    expect(along(g.player.y - g.boss.deepY)).toBeGreaterThanOrEqual(before);
  });

  it('does not let repeated hits march the player into the deep', () => {
    const g = fighting(72);
    tick(g, 2);
    const along = (g as unknown as { along(v: number): number }).along.bind(g);
    const lead = () => along(g.player.y - g.boss.deepY);
    const start = lead();
    let worst = start;
    for (let n = 0; n < 4 && g.state === 'boss'; n++) {
      g.player.invincible = 0;
      g.damage(1, 'bossContact');
      for (let i = 0; i < 0.4 / STEP && g.state === 'boss'; i++) { g.player.invincible = 9; g.step(STEP, 0, false); }
      worst = Math.min(worst, lead());
    }
    // The old version lost 31px of slack on every hit and never got it back. The shove is bounded
    // by the midpoint now, so it cannot accumulate.
    expect(worst).toBeGreaterThan(start - BOSS_PHYSICS.hazardKnockback);
    expect(g.health.deathCause?.cause).not.toBe('crush');
  });

  it('never stacks into something violent', () => {
    const g = fighting(73);
    tick(g, 1);
    for (let i = 0; i < 5 && g.state === 'boss'; i++) {
      g.player.invincible = 0;
      g.damage(1, 'bossContact');
      expect(Math.abs(g.player.vy)).toBeLessThanOrEqual(BOSS_PHYSICS.hazardKnockback + 0.001);
    }
  });

  it('does not knock the player back in the ordinary run', () => {
    const normal = new GameModel(false);
    normal.player.grounded = -1; normal.player.vy = 300;
    normal.player.invincible = 0;
    normal.damage(1, 'enemy');
    // The knockback is boss-only. A hit in the shaft costs a heart and leaves the fall alone.
    expect(normal.player.vy).toBe(300);
  });
});

describe('the fight still works end to end', () => {
  it('survives the arena long enough to fight in it', () => {
    const g = fighting(73);
    tick(g, 12);
    expect(g.state).toBe('boss');
    expect(g.boss.reach(g.player.y)).toBeGreaterThan(0);
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
