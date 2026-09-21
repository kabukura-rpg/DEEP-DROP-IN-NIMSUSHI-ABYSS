import type { AreaGimmicks, WaterPhysics } from './areas';
import type { EnemyKind } from './enemies';

/**
 * THE ABYSS: everything between 4-3 CLEAR and the first shot into NIMUSHI's eye.
 *
 * It is deliberately NOT a thirteenth SECTION. There is no depth goal, nothing is banked, and the
 * shaft is not generated from the area curve -- it is a short, fixed staging room with three jobs:
 * sell the run its last supplies, make the player break a seal to go on, and then turn the world
 * over. Keeping it hand-laid rather than rolled is what lets the shop and the seal be guaranteed
 * without threading a special case through the whole generator.
 */

/** The staging room, in pixels below the opening platform. */
export const ABYSS = {
  /** Plain ledges on the way down, so the drop in is ordinary play rather than a cutscene. */
  ledgeGap: 236,
  ledgeWidth: 148,
  /** Where the chamber holding the final shop -- or the TOMATO -- is cut. */
  shopDepth: 690,
  /** Where the seal is laid across the shaft. Far enough past the shop to be a separate beat. */
  sealDepth: 1310,
  /**
   * How far past the broken seal the player falls before the world turns over. Long enough that
   * the hole was clearly gone through, short enough that nothing else happens down there.
   * MEASUREMENT REQUIRED.
   */
  inversionDrop: 200,
  /** The transition. A held beat, then the reversal itself. MEASUREMENT REQUIRED. */
  hold: 0.5,
  reverse: 1.0,
  /**
   * THE RISING DEEP.
   *
   * It closes on how far the PLAYER has got, never on where NIMUSHI happens to be. That is the
   * whole difference between a pressure mechanic and a trap: a boundary measured from the boss
   * punishes a player for the boss drifting away from them, which is not something they did.
   * Measured from their own best progress, the rule is simply "keep going" -- and the answer when
   * you cannot is to put a round in the eye.
   *
   * `maxSlack` is how far behind that mark it is ever allowed to fall -- which is what makes
   * CLIMBING the answer: outrun it and it is dragged along at exactly that distance, stall and it
   * closes at `pressureSpeed`. `minArena` is a safety floor that keeps it from ever reaching
   * NIMUSHI itself, so the arena can never invert. MEASUREMENT REQUIRED.
   */
  maxSlack: 460,
  minArena: 120,
  /** How fast it eats into the slack, per second, and what each stretch adds. */
  pressureSpeed: 22,
  pressureRamp: 4,
  /**
   * Pixels of slack one point of weak-point damage buys back. Per DAMAGE rather than per hit, so a
   * LASER round and three MACHINE rounds are worth the same relief for the same HP taken off --
   * the reward for attacking must not depend on which weapon the run happens to be holding.
   *
   * Sized against `pressureSpeed` so a window landed in full is worth slightly more than the cycle
   * it took: keeping up with NIMUSHI is what keeps the deep down. MEASUREMENT REQUIRED.
   */
  pushRelief: 22,
  /** Metres of ascent per pixel, mirroring the shaft's own scale. */
  pixelsPerMeter: 24,
} as const;

/** TOMATO: what a run that never once stepped into a SAFE ZONE gets instead of the final shop. */
export const TOMATO = {
  name: 'トマト',
  /** Through HealthSystem's own LIFE UP and the shared magazine growth -- no new effect path. */
  maxHp: 10,
  maxCharge: 10,
} as const;

export type AbyssRole = 'cavern' | 'catacomb' | 'aquifer' | 'limbo';

/**
 * One of the four stretches of the fight.
 *
 * These are NOT the normal AREAs reassembled. They are a simplified recipe that names the one
 * mechanic each stretch is about -- nothing to trip over, delayed spikes, drowning, no ground --
 * because the fight's real content is NIMUSHI's own attacks and the terrain is the stage they are
 * fought on.
 */
export interface AbyssPhase {
  id: 1 | 2 | 3 | 4;
  name: string;
  role: AbyssRole;
  /** Entered once NIMUSHI's HP ratio has fallen to this. MEASUREMENT REQUIRED. */
  from: number;
  gimmicks?: AreaGimmicks;
  water?: WaterPhysics;
  /** Distance between arena rows, laid against the pull. */
  rowGap: number;
  ledgeWidth: readonly [number, number];
  /** Per-row chances. A row rolls at most one of these. */
  breakBlockChance: number;
  spikeChance: number;
  containerChance: number;
  doodadChance: number;
  /** LIMBO lays no ledge at all: a doodad is the only thing in the arena worth touching. */
  groundless: boolean;
  /** What NIMUSHI splits into while this stretch is running. */
  clonePool: readonly EnemyKind[];
  /** A guaranteed heart somewhere in the stretch. LIMBO deliberately has none. */
  heart: boolean;
  /** Which of the five attacks this stretch may use, in rotation order. */
  attacks: readonly AbyssAttackId[];
}

export type AbyssAttackId = 'tapiocaShower' | 'cupSummon' | 'strawBeam' | 'nimushiClones';

/**
 * The four stretches of the fight.
 *
 * ALL of them are `groundless`. NIMUSHI's arena is a non-stop aerial fight: a landable ledge stops
 * the player's climb dead, and every stop breaks the fight's tempo and hands the pressure boundary
 * free ground. Ledges, break-block clusters and trampolining doodads are all gone from here --
 * `ledgeWidth`, `breakBlockChance` and `spikeChance` stay zero, and the fields survive only because
 * the staging room above still uses the same row builder.
 *
 * CHARGE therefore cannot come from landing, so every stretch supplies it from the air instead:
 * `chargeOrbChance` floats shootable orbs through the arena. That is the one supply line in the
 * fight and it is deliberately generous, because running dry with no floor to land on is not a
 * challenge, it is a stall.
 */
/**
 * CUP is disabled in every stretch while the core cycle is judged.
 *
 * Its code is untouched and it is one entry away from returning -- the order for re-evaluating the
 * roster is STRAW BEAM, then CLONES, then CUP, one at a time. Tuning four attacks at once is how
 * the fight became unreadable in the first place.
 */
export const ABYSS_PHASES: readonly AbyssPhase[] = [
  {
    id: 1, name: 'CAVERN OF THE PEARL', role: 'cavern', from: 1,
    rowGap: 360, ledgeWidth: [0, 0],
    breakBlockChance: 0, spikeChance: 0, containerChance: 0, doodadChance: 0,
    groundless: true, clonePool: ['nimushiClone'], heart: true,
    // One attack, low density: this stretch is where the player learns that down is up.
    attacks: ['tapiocaShower'],
  },
  {
    id: 2, name: 'CATACOMB OF CUPS', role: 'catacomb', from: 0.75,
    rowGap: 355, ledgeWidth: [0, 0],
    breakBlockChance: 0, spikeChance: 0, containerChance: 0, doodadChance: 0,
    groundless: true, clonePool: ['nimushiClone'], heart: true,
    attacks: ['tapiocaShower'],
  },
  {
    id: 3, name: 'AQUIFER OF SYRUP', role: 'aquifer', from: 0.5,
    gimmicks: { oxygen: true }, water: { gravity: 0.9, responsiveness: 11 },
    rowGap: 350, ledgeWidth: [0, 0],
    breakBlockChance: 0, spikeChance: 0, containerChance: 0.8, doodadChance: 0,
    groundless: true, clonePool: ['nimushiClone'], heart: true,
    attacks: ['strawBeam'],
  },
  {
    id: 4, name: 'LIMBO OF THE DEEP', role: 'limbo', from: 0.25,
    rowGap: 330, ledgeWidth: [0, 0],
    breakBlockChance: 0, spikeChance: 0, containerChance: 0, doodadChance: 0,
    groundless: true, clonePool: ['nimushiShade'], heart: false,
    attacks: ['nimushiClones', 'tapiocaShower', 'strawBeam'],
  },
];

export const abyssPhaseAt = (ratio: number): AbyssPhase =>
  [...ABYSS_PHASES].reverse().find(phase => ratio <= phase.from) ?? ABYSS_PHASES[0];
export const abyssPhase = (id: 1 | 2 | 3 | 4) => ABYSS_PHASES.find(p => p.id === id) ?? ABYSS_PHASES[0];
