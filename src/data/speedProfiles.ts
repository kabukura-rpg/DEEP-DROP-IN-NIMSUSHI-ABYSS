import { BALANCE, JUMP } from './balance';
import { WORLD } from './balance';

/**
 * SPEED PROFILES — for comparison only. The shipped physics live in BALANCE.
 *
 * VIDEO is now the production baseline and this module reads it from BALANCE rather than restating
 * it, so the two can never drift apart. LEGACY is the pre-fidelity 900/520/180: kept so the change
 * can still be felt back to back, and used for nothing else.
 *
 * VIDEO's provenance is recorded on BALANCE itself. In short: frame measurement of a ~58.9fps
 * recording of the original, normalised against shaft width, then scaled into DEEP DROP's 394px
 * shaft, and confirmed by side-by-side play.
 */
export interface SpeedProfile {
  id: 'legacy' | 'video';
  label: string;
  gravity: number;
  maxFallSpeed: number;
  moveSpeed: number;
  /**
   * The ground-jump impulse this profile needs to keep the CURRENT jump ARC.
   *
   * This is not a free choice. Jump height is `impulse^2 / 2g`, so raising gravity shrinks the jump
   * even though `JUMP.impulse` never changes -- at 1680 the locked-as-GOOD 59px jump collapses to
   * 32px on its own. Holding the arc constant requires scaling the impulse by sqrt(g1/g0). It is
   * recorded per profile rather than applied, because JUMP.impulse is LOCKED and changing it is not
   * this pass's decision.
   */
  jumpImpulseForSameArc: number;
}

const LEGACY = { gravity: 900, maxFallSpeed: 520, moveSpeed: 180 } as const;

/** The impulse that would give the CURRENT jump arc at some other gravity. See the field doc. */
const sameArc = (gravity: number) => Math.round(JUMP.impulse * Math.sqrt(gravity / BALANCE.gravity));

export const SPEED_PROFILES: Record<SpeedProfile['id'], SpeedProfile> = {
  video: {
    id: 'video', label: 'VIDEO',
    gravity: BALANCE.gravity, maxFallSpeed: BALANCE.maxFallSpeed, moveSpeed: BALANCE.moveSpeed,
    jumpImpulseForSameArc: JUMP.impulse,
  },
  legacy: {
    id: 'legacy', label: 'LEGACY',
    ...LEGACY,
    // 330 * sqrt(900/1680) = 243. What the impulse WOULD have to be for the jump to keep its
    // current arc under the old gravity -- recorded for symmetry only. Switching to LEGACY does not
    // apply it, so the old profile also restores the old 60px jump, which is what it is for.
    jumpImpulseForSameArc: sameArc(LEGACY.gravity),
  },
};

/** What one shaft-width per second is, in px/s, so a measurement can be checked against the source. */
export const SHAFT_WIDTH = WORLD.width - WORLD.wall * 2;
export const inShaftWidths = (pxPerSecond: number) => pxPerSecond / SHAFT_WIDTH;
