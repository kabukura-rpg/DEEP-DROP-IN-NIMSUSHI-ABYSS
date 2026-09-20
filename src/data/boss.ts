import type { EnemyKind } from './enemies';
import type { AreaGimmicks, SectionPlan, WaterPhysics } from './areas';

/**
 * THE DEMON KING -- preserved, no longer wired to anything.
 *
 * This was the FINAL BOSS before THE ABYSS replaced it: a king that held station BELOW the falling
 * player, took damage anywhere on its body, and ran four phases whose recipes were the areas'
 * own systems replayed. NIMUSHI is a different fight in every respect -- armoured body, one weak
 * point, its own five attacks, and gravity pulling the other way -- so none of this is reachable
 * in play any more.
 *
 * It is kept rather than deleted for one reason that is not sentiment: PHASE 3, MAGMA WRATH, is the
 * last place the magma mechanics (the heat gauge, lava, vents, ice, the fire roster) are described
 * as a working recipe. AREA 3 became the AQUIFER in Phase 4 and THE ABYSS's four stretches are
 * CAVERN / CATACOMB / AQUIFER / LIMBO, so magma now has no home in normal play OR in the fight.
 * HeatSystem, the hazards and the fire enemies all still exist and still work; this file is the
 * recipe that says how they went together, so reviving them is a matter of pointing something at
 * it rather than reconstructing it.
 */

/** Every attack telegraphs before it can hurt anything. No pattern may skip the wind-up. */
export interface BossAttack {
  id: 'magicShot' | 'sweep';
  /** Seconds of visible wind-up before the attack becomes dangerous. */
  telegraph: number;
  /** Seconds the attack is dangerous. */
  active: number;
  /** Seconds from the end of one use to the start of the next. */
  cooldown: number;
  phases: readonly number[];
}
export const BOSS_ATTACKS: readonly BossAttack[] = [
  { id: 'magicShot', telegraph: 0.7, active: 0.12, cooldown: 3.0, phases: [1, 2, 3, 4] },
  { id: 'sweep', telegraph: 1.1, active: 0.45, cooldown: 4.8, phases: [1, 2, 3, 4] },
];

export interface BossPhase {
  id: 1 | 2 | 3 | 4;
  name: string;
  /** Entered once the HP ratio has fallen to this value. */
  from: number;
  gimmicks?: AreaGimmicks;
  water?: WaterPhysics;
  enemyPool: readonly EnemyKind[];
  plan: SectionPlan;
}

/**
 * The descent keeps going through the whole fight, so each phase is just another generation recipe
 * plus the systems that area taught. Nothing here is boss-specific except the names.
 */
export const BOSS_PHASES: readonly BossPhase[] = [
  {
    id: 1, name: 'DESCENT OF THE KING', from: 1,
    enemyPool: ['slime', 'bat', 'armoredSlime'],
    plan: { platformWidth: [150, 176], gap: 240, enemyChance: 0.26, flyChance: 0.20, toughChance: 0.18, heavyChance: 0, comboBias: 0.20 },
  },
  {
    id: 2, name: 'SUNKEN CURSE', from: 0.75,
    gimmicks: { oxygen: true }, water: { gravity: 0.90, responsiveness: 11 },
    enemyPool: ['fish', 'bubbleFish', 'jellyfish'],
    plan: {
      platformWidth: [142, 166], gap: 242, enemyChance: 0.22, flyChance: 0.20, toughChance: 0.20, heavyChance: 0, comboBias: 0.18,
      // The alcove's share of the air roll folded into the container roll: PHASE 2 lays exactly as
      // many air sources as it always did, and every one of them is now something to break.
      containerChance: 0.79, maxOxygenGap: 21, bubbleOffside: 0.18,
    },
  },
  {
    id: 3, name: 'MAGMA WRATH', from: 0.5,
    gimmicks: { heat: true },
    enemyPool: ['fireLizard', 'magmaSlime'],
    plan: {
      platformWidth: [138, 160], gap: 244, enemyChance: 0.26, flyChance: 0.12, toughChance: 0.28, heavyChance: 0, comboBias: 0.14,
      lavaPoolChance: 0.22, lavaWallChance: 0.06, ventChance: 0.12, iceChance: 0.44, iceOffside: 0.25,
    },
  },
  {
    id: 4, name: 'COLLAPSING END', from: 0.25,
    gimmicks: { breakablePlatforms: true },
    enemyPool: ['demon', 'wraith', 'armorGuard', 'spikeDemon'],
    plan: {
      platformWidth: [124, 146], gap: 246, enemyChance: 0.30, flyChance: 0.26, toughChance: 0.26, heavyChance: 0.08, comboBias: 0.28,
      breakableChance: 0.94, breakDelay: 0.58, maxBreakableRun: 12,
    },
  },
];

export const BOSS = {
  name: 'DEMON KING',
  maxHp: 450,
  /**
   * How the king keeps its distance. It rests near the bottom of the view, which is what gives
   * the fight a real vertical field and lets the long-range weapons matter.
   *
   * minGap is deliberately much smaller than the resting distance: the king never closes in on
   * the player, but the player may dive at it. That is the only way SHOTGUN (260px reach) and
   * PUNCHER (330px) can land a hit, so short range stays a real choice with a real risk rather
   * than a dead weapon.
   */
  minGap: 150,
  restGap: 520,
  maxGap: 620,
  /** How fast it settles back down to its resting distance after the player closes in. */
  settleSpeed: 210,
  bodyWidth: 86,
  bodyHeight: 64,
  /** How fast it closes on the player's column. */
  drift: 95,
  /**
   * Width of the band a sweep scours. Deliberately narrower than half the shaft: leaving it takes
   * about 0.8s at walking speed, comfortably inside the telegraph even with submerged inertia.
   */
  sweepWidth: 150,
  /** Upward speed of a magic shot. */
  shotSpeed: 330,
  /** Below this share of HP the attacks tighten, without any new pattern appearing. */
  climaxRatio: 0.14,
  climaxSpeed: 0.7,
  /** Seconds of collapse before GAME CLEAR. Short on purpose. */
  defeatDelay: 0.9,
} as const;

export const bossPhaseAt = (ratio: number): BossPhase =>
  [...BOSS_PHASES].reverse().find(phase => ratio <= phase.from) ?? BOSS_PHASES[0];
