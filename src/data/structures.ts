import { WORLD } from './balance';

/**
 * Fixed structures the generator places into the shaft: the way out of a SECTION and SUNKEN RUINS' (AREA 3) air
 * containers. Both are world objects the player walks into or breaks, never things that happen to
 * them automatically.
 */

/** The way out. Reaching 200m no longer ends a SECTION; walking into this does. */
export interface StageExit { x: number; y: number; width: number; height: number }

export const EXIT_RULES = {
  /** Metres past the SECTION goal before the exit floor is laid, so it is visible but not instant. */
  depthMargin: 6,
  /** The gate itself, standing on the floor. */
  width: 86,
  height: 74,
  /** Thickness of the floor the gate stands on. It spans the shaft, so nothing falls past it. */
  floorHeight: 18,
} as const;

/**
 * A shop doorway. The shaft no longer lays one: a SHOP is SAFE ZONE content, so the only thing that
 * opens a door onto the shelf is a chamber that rolled one, and this is the size it opens it at.
 */
export const SHOP_DOOR = { width: 66, height: 66 } as const;

/**
 * SUNKEN RUINS' (AREA 3) air supply. The container holds nothing by itself: breaking it releases bubbles, and
 * only touching a bubble restores air. Bubbles rise, so they have to be chased.
 */
export interface AirContainer {
  id: number; x: number; y: number; width: number; height: number;
  broken: boolean;
  /** Counts down the shatter animation once broken, purely cosmetic. */
  debris: number;
  /**
   * THE ABYSS's containers only. Swimming into one does NOT break it: air in the boss arena always
   * costs a round, which is what stops the aquifer stretch being answered by simply falling through
   * it. AREA 3's own containers leave this unset and still break on contact.
   */
  shotOnly?: boolean;
}

export const AIR_CONTAINER_RULES = {
  size: 34,
  /** Bubbles released when it breaks. */
  bubblesMin: 3,
  bubblesMax: 5,
  /** Seconds of air one released bubble restores. Matches the old bubble so the gauge is unchanged. */
  recovery: 5,
  /** How fast released bubbles climb, and how far they drift sideways. */
  riseSpeed: 96,
  riseSpread: 54,
  /** How quickly a bubble reaches full climb speed, so the burst reads as a burst. */
  riseAccel: 260,
  /** Seconds a released bubble survives before it pops on its own. */
  bubbleLife: 4.2,
  /**
   * Seconds a released bubble has to exist before it can be caught.
   *
   * Without it, breaking a container by swimming into one was worth a whole tank on the frame of
   * the break: every bubble is released at the container's centre, and a player who broke it by
   * contact IS at that centre, so all three to five sat inside the catch box on the same step and
   * the AREA's one real decision -- chase the air, or carry on down -- never happened. Shooting one
   * open from above ended the same way, because the fall arrives through the burst.
   *
   * A time, not a frame count, so it means the same thing at any refresh rate. Deliberately short:
   * long enough for the burst to clear the box the player is standing in, nowhere near long enough
   * to put the air out of reach. A contact break is still worth air -- it just has to be followed.
   *
   * 0.08 is measured, not guessed. Swept over 0 to 0.30 on 60 isolated contact breaks per value and
   * on 100-seed playthroughs:
   *
   *   0.00  the whole burst on the frame of the break -- the bug this exists to remove
   *   0.05  no same-step catch, but a player who does NOTHING still keeps 3.85 of 4 bubbles
   *   0.08  a player who reacts keeps 4.83 of 4.08 up to 300px/s; one who ignores it keeps 0.00
   *   0.10+ a player who reacts recovers nothing in ~50 of 60 runs once they are moving at all
   *
   * So this is the largest value that leaves a contact break recoverable and the smallest that makes
   * recovering it an action. Above it the air stops being reachable; below it, following the burst
   * stops being necessary.
   */
  collectArm: 0.08,
  /** Seconds the shatter effect lingers. */
  debrisTime: 0.35,
} as const;

/** A released bubble. It climbs away, so reaching it is the actual gameplay. */
export interface AirBubble {
  id: number; x: number; y: number; vx: number; vy: number; life: number; taken: boolean;
  /** Seconds left before it can be caught. Counts down on simulation time, never on frames. */
  arm: number;
}

/**
 * BREAK BLOCK: a row of separately destructible blocks laid across the shaft as a gate between
 * fall zones. It is NOT an AREA 4 collapsing ledge and shares none of its code:
 *
 *   - each block is landed on like any other floor -- AMMO FULL RELOAD, COMBO RESET -- and none of
 *     them starts a timer, so standing on the row is safe indefinitely;
 *   - the way on is to shoot a hole. ONE block is enough: the player fits through a single gap, so
 *     the row rewards aiming rather than grinding the whole thing down;
 *   - breaking one is terrain work, not a kill: no COMBO, no enemy defeat, no kill event. A REWARD
 *     BLOCK leaves a LARGE COIN, and that goes through the ordinary CoinSystem drop the same way a
 *     corpse's does -- it is dropped into the shaft and still has to be caught.
 *
 * Which blocks pay is decided when the row is BUILT, not when a block breaks, and a reward block
 * looks different from the moment it appears. Shooting the right stone is then a read the player can
 * make before spending a round, rather than a coin flip settled after they already spent it.
 *
 * Durability is counted in rounds that connect rather than in damage, so every one of the seven gun
 * modules can open a block and a damage upgrade never trivialises a gate. Running dry needs no
 * special case: the blocks sit edge to edge, so stepping from one to its neighbour is an ordinary
 * landing and reloads in full, exactly as stepping between ledges does everywhere else.
 */
export const BREAK_BLOCK_RULES = {
  /** Blocks across the shaft. Their width is the shaft divided by this. */
  count: 5,
  /** Collision thickness for rounds. Deep enough that a shot fired while standing on one registers. */
  thickness: 16,
  /** Hits one block takes before it gives way, when a SECTION plan does not say otherwise. */
  durability: 2,
  /**
   * Chance that a block is built as a REWARD BLOCK. PROVISIONAL: the original's rate is not
   * measured. This is the same 0.25 the old post-break coin roll used, carried over so the amount of
   * money in a row is roughly unchanged -- but it now decides the block's KIND at generation, and is
   * visible from the moment the row appears. MEASUREMENT REQUIRED.
   */
  rewardChance: 0.25,
  /** What one pays when it breaks. Certain, not rolled: the block already told the player. */
  rewardCoins: 1,
  rewardDenomination: 'large',
} as const;

/** The width of one block, so generation, collision and drawing never disagree about it. */
export const breakBlockWidth = (rules: { count: number } = BREAK_BLOCK_RULES) =>
  (WORLD.width - WORLD.wall * 2) / rules.count;
export const shaftCentre = WORLD.width / 2;

/**
 * A SPIKE PLATFORM: ground that is safe to land on and then stops being safe.
 *
 * This is deliberately NOT the instant-death SPIKE terrain. Landing on one is an ordinary landing --
 * CHARGE fills, a chain settles -- and only after a visible warning do the spikes come up. Touching
 * them then costs ordinary damage through HealthSystem, with the ordinary invulnerability window, so
 * a mistake is a mistake rather than the end of the run.
 *
 * The cycle is: safe -> (a landing arms it) -> warning -> active -> cooldown -> safe. The warning
 * is what makes it fair; nothing can ever hurt the player on the frame they touch down.
 */
export type SpikePlatformState = 'safe' | 'warning' | 'active' | 'cooldown';

export interface SpikePlatform {
  state: SpikePlatformState;
  /** Seconds left in the current state. */
  timer: number;
  /**
   * This platform's own warning, in seconds, when it has one. Absent means SPIKE_PLATFORM_RULES.warning,
   * which is every spike platform outside the CATACOMBS -- the ABYSS arena's included. See the
   * CATACOMB plan's `spikeReaction` for how a platform's own is worked out.
   */
  warning?: number;
}

export const SPIKE_PLATFORM_RULES = {
  /**
   * Seconds between the landing that arms it and the spikes emerging.
   *
   * DESIGN TUNING — TOO SLOW VS ORIGINAL.
   * ORIGINAL VALUE / TOTAL REACTION TIME MEASUREMENT REQUIRED.
   *
   * The SHAPE is confirmed: the original's catacomb traps are differently coloured platforms that
   * release spikes shortly after being stood on, and the description of them is that they make the
   * player move quickly. The TIMING is not published and this is not a reproduction of it.
   *
   * It was 0.95, derived so that a player landing on the guaranteed landing spot of the WIDEST
   * ledge could WALK to the far side and off it. That requirement has been withdrawn: walking the
   * full width of a ledge is the slowest escape there is, and sizing the window around it left the
   * trap with no pressure at all. Jumping leaves the floor on the same frame, stepping off an edge
   * is immediate, and a round of recoil is another way out -- none of them need 0.95s.
   *
   * 0.65 IS NOT A FIDELITY TARGET EITHER. Playing the original and DEEP DROP side by side, this
   * trap still fires later than the original's. The direction is confirmed and the amount is not:
   * the next value comes from measurement, never from another estimate. Moving the right way once
   * does not make a number correct, and 0.65 is exactly as unverified as 0.95 was.
   *
   * What must be measured is NOT this constant on its own but the whole staircase -- trigger,
   * warning tint, extension animation, hitbox activation -- and the acceptance figure is the TOTAL
   * REACTION TIME from the arming landing to the first frame the spikes can hurt. A trap whose
   * warning is the right length but whose trigger and activation are staged differently still reads
   * as slow, which is what the side-by-side comparison actually describes. See protocol D items
   * 19-20 in docs/PHASE7C-1-SPEC.md for the seven frame indices to capture.
   *
   * What the window must still guarantee, at whatever length it ends up: nothing hurts on the frame
   * of the landing, the warning is visible for its whole length, and a player who reacts at once
   * gets away. A player who stands still is meant to be hit.
   */
  warning: 0.65,
  /**
   * Seconds the spikes stay up. Deliberately shorter than HealthSystem's invulnerability window, so
   * one pass through a live platform costs exactly one heart: a player who mistimes it is punished
   * once, not twice by an accident of two unmeasured numbers lining up badly. MEASUREMENT REQUIRED.
   */
  active: 0.9,
  /** Seconds after they retract before a landing can arm it again. MEASUREMENT REQUIRED. */
  cooldown: 1.2,
  /**
   * Hearts one touch costs. Ordinary damage through HealthSystem -- never instant death -- so it is
   * the same 1 every other ordinary hazard deals. MEASUREMENT REQUIRED.
   */
  damage: 1,
  /** How far the spikes stand above the platform surface, for drawing and for the hitbox. */
  reach: 16,
} as const;

/** A fresh, unarmed spike platform. */
export const spikePlatform = (warning?: number): SpikePlatform =>
  warning === undefined ? { state: 'safe', timer: 0 } : { state: 'safe', timer: 0, warning };

/**
 * LIMBO's dangerous ground.
 *
 * Deliberately NOT a SPIKE PLATFORM. A spike platform is CATACOMBS' idea: ordinary ground that is
 * safe to arrive on, fills CHARGE, settles a chain, and only then turns. Reusing it here would hand
 * LIMBO exactly the thing LIMBO is not allowed to have -- somewhere to drop onto when the gunboots
 * run dry.
 *
 * This is the opposite object. It is not a floor at all: nothing lands on it, nothing stands on it,
 * and touching it costs a heart and nothing else -- CHARGE is untouched, the chain is untouched, and
 * the fall carries on through it. The only things that refill the gunboots outside a SAFE ZONE are
 * the floating doodads, which is what makes the AREA a loop of shoot, bounce, shoot.
 */
export const LIMBO_HAZARD_RULES = {
  /**
   * Hearts one touch costs, through HealthSystem like any other ordinary damage -- so the usual
   * invulnerability window applies and a chain survives it. MEASUREMENT REQUIRED.
   */
  damage: 1,
  /** How far the barbs stand above the row, for drawing and for the hitbox. MEASUREMENT REQUIRED. */
  reach: 14,
} as const;

/**
 * How thick a plain ledge is.
 *
 * It has never mattered before: gravity pulled one way, so a floor was a line at `y` and the only
 * face anything could arrive on was its top. The ABYSS inverts the pull, and a player falling
 * upward lands on the UNDERSIDE of a ledge -- which needs the slab to have a thickness that
 * collision agrees with. This is the figure the view already draws them at, named once so the two
 * cannot drift apart.
 */
export const PLATFORM_THICKNESS = 16;
