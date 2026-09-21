import { describe, expect, it } from 'vitest';
import { fighting, laneOf, STEP, tick } from './nimushi';
import { ABYSS_PHASES, ARENA_FLOOR } from '../src/data/abyss';
import { BOSS_PHYSICS } from '../src/data/bossPhysics';
import { BALANCE, WORLD } from '../src/data/balance';
import { ENEMY_TYPES } from '../src/data/enemies';
import { GameModel } from '../src/systems/GameModel';

/**
 * SAME GAME, REVERSED GRAVITY.
 *
 * The arena had grown its own physics verbs: a gunboot thruster the player could fly with, a
 * contact pickup that refilled CHARGE, a boundary that killed, a knockback that steered them. Each
 * one replaced something AREA 1-4 had already taught with a rule that applied to one fight.
 *
 * They are gone. The only large new rule in NIMUSHI's arena is that gravity points up.
 */
const along = (g: GameModel) => (g as unknown as { along(v: number): number }).along(g.player.vy);

/** Play until the shower's bounce target exists, then hand back the model and the target. */
function withBounceTarget(seed: number) {
  const g = fighting(seed);
  for (let i = 0; i < 60 / STEP; i++) {
    g.player.invincible = 9;
    g.step(STEP, 0, false);
    const t = g.enemies.find(e => e.kind === 'bounceTapioca' && e.alive);
    if (t) return { g, target: t };
  }
  throw new Error('no bounce target appeared');
}

describe('the boss-only verbs are gone', () => {
  it('has no vertical thruster: firing cannot carry the player back down', () => {
    const g = fighting(400);
    tick(g, 2);
    for (let i = 0; i < 4 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.ammo = g.stats.maxAmmo;
      g.step(STEP, 0, true);
      expect(along(g)).toBeGreaterThanOrEqual(-0.001);
    }
  });

  it('has no CHARGE orb', () => {
    const g = fighting(401);
    tick(g, 4);
    expect(g.containers.some(c => (c as unknown as { charge?: boolean }).charge)).toBe(false);
    for (const phase of ABYSS_PHASES) {
      expect((phase as unknown as { chargeOrbChance?: number }).chargeOrbChance).toBeUndefined();
    }
  });

  it('has no boss-only knockback: a hit leaves movement alone, as in the shaft', () => {
    const g = fighting(402);
    tick(g, 2);
    g.player.vy = -300;
    g.player.invincible = 0;
    g.damage(1, 'bossContact');
    expect(g.player.vy).toBe(-300);
    expect((BOSS_PHYSICS as unknown as { hazardKnockback?: number }).hazardKnockback).toBeUndefined();
  });

  /**
   * No boundary chases the player. Standing still still ends the run -- but at the bottom of the
   * FRAME, which is the ordinary "fell off the screen" every SECTION already has, not a pressure
   * system closing in with no counterplay.
   */
  it('has no gameplay pressure: nothing closes on a player who stands still', () => {
    const g = fighting(403);
    const hp = g.hp;
    const floor = (m: typeof g) => m.player.y - m.cameraY > WORLD.height + ARENA_FLOOR.margin;
    let insideHp = hp, endedPastTheFloor = false;
    for (let i = 0; i < 20 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.player.vy = 0;
      const wasInside = !floor(g);
      g.step(STEP, 0, false);
      if (wasInside && g.state === 'boss') insideHp = g.hp;
      if (g.state !== 'boss') endedPastTheFloor = floor(g);
    }
    // Nothing touched them for as long as they were in the frame: no boundary, no attack, no crowd.
    expect(insideHp).toBe(hp);
    // The run did end -- at the bottom of the view, which is where a SECTION ends too.
    expect(g.health.deathCause?.cause).toBe('crush');
    expect(endedPastTheFloor).toBe(true);
  });

  it('keeps the deep as scenery, still rising', () => {
    // Removed from gameplay, not from the world: THE ABYSS closing behind you is worth seeing.
    const g = fighting(404);
    const first = g.boss.deepY;
    tick(g, 3);
    expect(g.boss.deepY).not.toBe(first);
  });
});

describe('CHARGE comes back the way the run teaches: a stomp', () => {
  it('kills the target, bounces against the pull, and fills the magazine', () => {
    const { g, target } = withBounceTarget(405);
    g.ammo = 0;
    g.combo = 3;
    g.player.x = target.x;
    g.player.y = target.y - 26 * g.gravitySign;      // arriving along the pull
    g.player.vy = -520;
    g.player.grounded = -1;
    for (let i = 0; i < 12 && target.alive; i++) g.step(STEP, 0, false);

    expect(target.alive).toBe(false);
    expect(g.ammo).toBe(g.stats.maxAmmo);
    expect(along(g)).toBeLessThan(0);                // thrown back down the screen
    expect(g.player.grounded).toBe(-1);              // a stomp is not a landing
    expect(g.combo).toBe(4);                         // and it is worth a link, like any kill
  });

  it('costs a heart when it is mistimed, exactly as a slime does', () => {
    const { g, target } = withBounceTarget(406);
    const hp = g.hp;
    g.player.invincible = 0;
    g.player.x = target.x;
    g.player.y = target.y;                           // straight into its side
    g.player.vy = 0;
    g.step(STEP, 0, false);
    expect(g.hp).toBe(hp - 1);
  });

  it('can be shot instead -- safe, but no bounce and no reload', () => {
    const { g, target } = withBounceTarget(407);
    g.ammo = 0;
    const vy = g.player.vy;
    target.hp = 0;
    (g as unknown as { kill(e: unknown, stomp: boolean): void }).kill(target, false);
    expect(target.alive).toBe(false);
    expect(g.ammo).toBe(0);
    expect(g.player.vy).toBe(vy);
  });

  it('is an ordinary stompable enemy, with its own silhouette', () => {
    const type = ENEMY_TYPES.bounceTapioca;
    expect(type.stompable).toBe(true);
    expect(type.shootable).toBe(true);
    // Shape, never colour, says what can be stood on -- and in LIMBO it shares the screen with a
    // barbed clone that must not be.
    expect(type.silhouette).not.toBe(ENEMY_TYPES.nimushiClone.silhouette);
    expect(type.silhouette).not.toBe(ENEMY_TYPES.nimushiShade.silhouette);
  });
});

describe('the reload is part of the arena, not part of an attack', () => {

  it('offers them continuously, not once per attack', () => {
    // They are laid per ROW now rather than with an attack, so the loop keeps going with no attacks
    // running at all -- which is the whole prototype.
    const g = fighting(411);
    tick(g, 6);
    expect(g.enemies.filter(e => e.kind === 'bounceTapioca').length).toBeGreaterThan(1);
  });
});

describe('CUP is disabled, not deleted', () => {
  it('is out of every rotation', () => {
    for (const phase of ABYSS_PHASES) expect(phase.attacks).not.toContain('cupSummon');
  });
});

describe('the normal run is untouched', () => {
  it('still brakes with the module\'s own recoil and never climbs', () => {
    const g = new GameModel(false);
    g.platforms = []; g.player.grounded = -1; g.player.vy = BALANCE.maxFallSpeed;
    g.cooldown = 0;
    g.shoot();
    expect(g.player.vy).toBeGreaterThan(0);
    expect(g.inBossArena).toBe(false);
  });
});
