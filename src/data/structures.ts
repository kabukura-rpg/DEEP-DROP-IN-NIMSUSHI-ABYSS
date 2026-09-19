import { WORLD } from './balance';

/**
 * Fixed structures the generator places into the shaft: the way out of a SECTION, a shop doorway,
 * and AREA 2's air containers. All three are world objects the player walks into or breaks, never
 * things that happen to them automatically.
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

/** A shop doorway standing on an ordinary ledge. */
export interface ShopDoor { x: number; y: number; width: number; height: number }
export const SHOP_DOOR = { width: 66, height: 66 } as const;

/**
 * AREA 2's air supply. The container holds nothing by itself: breaking it releases bubbles, and
 * only touching a bubble restores air. Bubbles rise, so they have to be chased.
 */
export interface AirContainer {
  id: number; x: number; y: number; width: number; height: number;
  broken: boolean;
  /** Counts down the shatter animation once broken, purely cosmetic. */
  debris: number;
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
  /** Seconds the shatter effect lingers. */
  debrisTime: 0.35,
} as const;

/** A released bubble. It climbs away, so reaching it is the actual gameplay. */
export interface AirBubble {
  id: number; x: number; y: number; vx: number; vy: number; life: number; taken: boolean;
}

export const shaftCentre = WORLD.width / 2;
