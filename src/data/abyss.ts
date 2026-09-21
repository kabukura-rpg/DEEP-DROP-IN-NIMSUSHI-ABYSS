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
/**
 * The arena's lower edge.
 *
 * A FIXED rule, not a rising boundary. The player bounces downward to buy room from NIMUSHI, and
 * this is what stops that being free: fall far enough behind the view and the abyss takes you.
 * Measured from the bottom of the screen, so it means the same thing on any viewport.
 *
 * It replaces the pressure system, which chased the player and could not be answered. Top is
 * NIMUSHI, bottom is the drop, and the height between them is the player's to manage.
 */
export const ARENA_FLOOR = {
  /** How far past the bottom of the view the player may fall before the run ends. */
  margin: 140,
} as const;

/**
 * Where NIMUSHI sits in the FRAME.
 *
 * PRESENTATION ONLY, and the distinction is the whole point. This moves the CAMERA and nothing
 * else: NIMUSHI's world path, the player's world path and the distance between them are exactly
 * what their own physics made them. Falling into the body still costs a heart, and no rule here
 * holds the player at a comfortable range -- that was the gap controller, and it is not coming back.
 *
 * What it fixes is that the boss had no stable place in the frame at all. Measured over three
 * 60-second fights, its body wandered from 88% of a screen ABOVE the top -- invisible -- down to
 * 63%, the dead centre, where it sat for 81% of the frames of a no-input run. "Falling upward
 * toward the thing above you" cannot read when the thing above you is in the middle of the screen.
 */
export const ARENA_VIEW = {
  /**
   * How far down the frame NIMUSHI's leading edge may sink, as a share of the viewport height.
   *
   * A SHARE, never a pixel count: the canvas is 450x800 and `#game-frame` is locked to 9:16, so
   * this is the same fraction of the screen on a 331px phone frame and a 430px one.
   *
   * 0.2 is MEASURED rather than chosen. The HUD's lowest row (hearts / AMMO) ends at canvas y
   * 198-244 depending on frame width -- worst case 244, on the narrowest desktop cabinet. NIMUSHI's
   * body is `bodyHeight` tall and the EYE, the only thing on it worth aiming at, sits in the
   * `eyeHeight` below that. Holding the body's leading edge at 0.2 puts the body at 160-272 and the
   * eye at 272-308: clear of the worst-case HUD by 28px. An anchor at 0.1, the other end of the
   * band that was asked for, would put the eye at 192-228 and bury it under the AMMO row.
   */
  bossAnchor: 0.2,
  /**
   * The lowest the HUD reaches, in canvas pixels, across every viewport the game ships at.
   *
   * Measured in the browser at 1280x900, 1280x800, 1440x1080, 390x844, 375x667 and 430x932; the
   * binding case is the 350px-wide desktop frame, where the CSS-pixel HUD scales up the most.
   * Recorded here so the choice of `bossAnchor` is checkable rather than a remembered number.
   */
  hudSafeBottom: 244,
} as const;

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
 * THREE ATTACKS ARE BACK. CUP is still disabled, and it is not deleted.
 *
 * The core loop was judged good by hand: gravity, the standing supply of things to stomp, the drop
 * below and the weak point above. Attacks go back on one at a time, and each one has to earn its
 * place against that loop rather than beside it. Each asks a different question:
 *
 *   SHOWER   where across the shaft to be, wave by wave
 *   BEAM     which side of one large announced commitment the next stomp is on
 *   CLONES   WHAT to stomp -- because some of what arrives cannot be stood on
 *
 * CLONES is the only one that adds to the thing the loop is made of rather than to what is in the
 * way of it. A clone is an ordinary stomp target that also hurts on contact; a shade wears the same
 * hood with a crown of barbs and cannot be stood on at all. So the attack is read rather than
 * dodged, and answering it correctly pays a bounce and a full magazine like any other stomp.
 *
 * They are never in the air together: the machine runs one attack at a time.
 *
 * CUP is intact and still out: turning it back on is one entry in the arrays below.
 */
export const ABYSS_PHASES: readonly AbyssPhase[] = [
  {
    id: 1, name: 'CAVERN OF THE PEARL', role: 'cavern', from: 1,
    rowGap: 360, ledgeWidth: [0, 0],
    breakBlockChance: 0, spikeChance: 0, containerChance: 0, doodadChance: 0,
    groundless: true, clonePool: ['nimushiClone'], heart: true,
    // One attack, low density: this stretch is where the player learns that down is up.
    // The stretch where the player learns that down is up. Its clones can all be stood on.
    attacks: ['tapiocaShower', 'strawBeam', 'nimushiClones'],
  },
  {
    id: 2, name: 'CATACOMB OF CUPS', role: 'catacomb', from: 0.75,
    rowGap: 355, ledgeWidth: [0, 0],
    breakBlockChance: 0, spikeChance: 0, containerChance: 0, doodadChance: 0,
    groundless: true, clonePool: ['nimushiClone'], heart: true,
    // CUP is still out of the rotation, whatever this stretch is called.
    attacks: ['tapiocaShower', 'strawBeam', 'nimushiClones'],
  },
  {
    id: 3, name: 'AQUIFER OF SYRUP', role: 'aquifer', from: 0.5,
    gimmicks: { oxygen: true }, water: { gravity: 0.9, responsiveness: 11 },
    rowGap: 350, ledgeWidth: [0, 0],
    breakBlockChance: 0, spikeChance: 0, containerChance: 0.8, doodadChance: 0,
    groundless: true, clonePool: ['nimushiClone'], heart: true,
    // The stretch the BEAM was named for, and it is finally in it.
    attacks: ['tapiocaShower', 'strawBeam', 'nimushiClones'],
  },
  {
    id: 4, name: 'LIMBO OF THE DEEP', role: 'limbo', from: 0.25,
    rowGap: 330, ledgeWidth: [0, 0],
    breakBlockChance: 0, spikeChance: 0, containerChance: 0, doodadChance: 0,
    groundless: true, clonePool: ['nimushiShade'], heart: false,
    // LIMBO's `clonePool` is SHADES: down here none of what NIMUSHI splits off can be stood on.
    attacks: ['tapiocaShower', 'strawBeam', 'nimushiClones'],
  },
];

export const abyssPhaseAt = (ratio: number): AbyssPhase =>
  [...ABYSS_PHASES].reverse().find(phase => ratio <= phase.from) ?? ABYSS_PHASES[0];
export const abyssPhase = (id: 1 | 2 | 3 | 4) => ABYSS_PHASES.find(p => p.id === id) ?? ABYSS_PHASES[0];
