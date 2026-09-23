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
  /**
   * Spent by the bounce that used it. THE ABYSS's doodads are, and the shaft's are not.
   *
   * Out in the shaft an everlasting doodad is harmless: a player who wants to bounce on the same
   * lamp forever is only wasting their own time. In the arena it is a trap -- the bounce throws
   * them AGAINST the pull, gravity brings them straight back onto it, and a player who never
   * steers sideways is held in place while NIMUSHI hauls the fight away and the deep closes in
   * behind them. One bounce each removes the trap without removing the reload.
   */
  consumable?: boolean;
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

export const spawnDoodad = (id: number, x: number, y: number, variant: DoodadVariant, consumable = false): Doodad => ({
  id, x, y, width: DOODAD_RULES.width, height: DOODAD_RULES.height, variant, active: true, consumable,
});

/**
 * THE SPACE A BOUNCE OFF THIS DOODAD USES, as a box.
 *
 * Built from the rules that decide a bounce rather than from the sprite. GameModel counts a touch
 * while the player's box -- 9px either side of centre, 15px above and below -- overlaps the doodad,
 * with 2px of grace above its top face; the rebound then lifts the body `bounce^2 / 2g`. So the
 * player's body occupies, at some point in one bounce, everything from the rebound's apex down to
 * the doodad's underside, across the doodad plus a body-half each side.
 *
 * Anything that must never be in the way of a bounce -- an enemy that cannot be stomped, above all --
 * is checked against this, and against its whole movement envelope, not where it happens to be.
 * `gravityScale` is the water's, where there is water: a submerged bounce climbs a little higher.
 */
export function doodadBounceZone(d: { x: number; y: number; width: number; height: number }, gravityScale = 1) {
  const apex = DOODAD_RULES.bounce ** 2 / (2 * BALANCE.gravity * gravityScale);
  return {
    minX: d.x - 9, maxX: d.x + d.width + 9,
    minY: d.y - 2 - 30 - apex, maxY: d.y + d.height + 15,
  };
}
