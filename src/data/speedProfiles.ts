import { BALANCE, JUMP } from './balance';
import { WORLD } from './balance';

/**
 * SPEED PROFILES — for human A/B comparison against the original. Not balance.
 *
 * The shipped game uses CURRENT. VIDEO exists so the two can be felt back to back; nothing here is
 * adopted until a human has played both.
 *
 * VIDEO is a **scale equivalent**, not a set of the original's constants. It comes from frame
 * measurement of a ~58.9fps recording, normalised against the shaft width so it transfers between
 * two games at different resolutions, then multiplied back into DEEP DROP's 394px shaft:
 *
 *   quantity      original (shaft-widths)   DEEP DROP now      video equivalent
 *   terminal      2.36 /s                   1.32 /s  (520)     ~920-950 px/s
 *   acceleration  4.2 /s2                   2.28 /s2 (900)     ~1650-1700 px/s2
 *   horizontal    0.88-0.91 /s              0.457 /s (180)     ~340-360 px/s
 *
 * The original is roughly 1.8x DEEP DROP on every axis, which is what the side-by-side sessions
 * described as "no high-speed feel".
 */
export interface SpeedProfile {
  id: 'current' | 'video';
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

const sameArc = (gravity: number) => Math.round(JUMP.impulse * Math.sqrt(gravity / BALANCE.gravity));

export const SPEED_PROFILES: Record<SpeedProfile['id'], SpeedProfile> = {
  current: {
    id: 'current', label: 'CURRENT',
    gravity: BALANCE.gravity, maxFallSpeed: BALANCE.maxFallSpeed, moveSpeed: BALANCE.moveSpeed,
    jumpImpulseForSameArc: JUMP.impulse,
  },
  video: {
    id: 'video', label: 'VIDEO',
    // Midpoints of the measured ranges. The ranges themselves are in the comment above; these are
    // the single values chosen to be played, not a claim that the original sits exactly here.
    gravity: 1680, maxFallSpeed: 930, moveSpeed: 350,
    jumpImpulseForSameArc: sameArc(1680),
  },
};

/** What one shaft-width per second is, in px/s, so a measurement can be checked against the source. */
export const SHAFT_WIDTH = WORLD.width - WORLD.wall * 2;
export const inShaftWidths = (pxPerSecond: number) => pxPerSecond / SHAFT_WIDTH;
