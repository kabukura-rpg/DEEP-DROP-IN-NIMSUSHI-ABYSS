import { BALANCE } from './balance';

/**
 * A DOODAD is scenery you can land on to reload: a lamp, a hanging sign, a bracket driven into the
 * shaft wall. It is NOT an enemy and NOT a platform.
 *
 *   - bouncing off one fills CHARGE and keeps the chain running, exactly as stomping an enemy does;
 *   - it is not a kill, so nothing about it touches COMBO, the kill count, COIN or the kill event;
 *   - it survives, so the same one can be used again on a later pass.
 *
 * That makes it the piece of scenery that turns a long fall into a chain: somewhere to reload when
 * there is nothing alive within reach.
 */
export type DoodadVariant = 'lamp' | 'bracket';

export interface Doodad {
  id: number;
  x: number; y: number; width: number; height: number;
  variant: DoodadVariant;
  /** False once something has consumed it. Ordinary doodads never set this; breakable ones will. */
  active: boolean;
}

export const DOODAD_RULES = {
  /**
   * Upward launch from bouncing off one.
   *
   * MEASUREMENT REQUIRED, like JUMP and WALL_JUMP. It starts equal to the enemy stomp bounce
   * because that is the motion it stands in for, but it is its own number so the two can be
   * measured -- and can diverge -- without one dragging the other with it.
   */
  bounce: BALANCE.bounce,
  /** The footprint the generator gives one. */
  width: 44,
  height: 12,
} as const;

export const spawnDoodad = (id: number, x: number, y: number, variant: DoodadVariant): Doodad => ({
  id, x, y, width: DOODAD_RULES.width, height: DOODAD_RULES.height, variant, active: true,
});
