/**
 * THE TOMATO'S ENTRANCE.
 *
 * The TOMATO is laid on the staging chamber's floor when the room is built; nothing here moves it.
 * What changes is how it is first SEEN: rather than already standing in the recess like a prop set
 * in front of the wall, it comes out of the chamber's back wall the first time the chamber is on
 * screen. Once begun, the entrance always plays to the end, and the pickup cannot be taken until it
 * has (GameModel.holdTomatoForReveal): the player is never stopped, they pass through it.
 *
 *   omen    cracks and a red glow spread over the back wall
 *   open    a dark portal opens where the cracks meet
 *   emerge  the TOMATO slides out of it to where it has always been
 *   close   the portal shuts behind it
 */
export const TOMATO_REVEAL = { omen: 0.35, open: 0.3, emerge: 0.45, close: 0.4 } as const;
export const TOMATO_REVEAL_SECONDS = TOMATO_REVEAL.omen + TOMATO_REVEAL.open + TOMATO_REVEAL.emerge + TOMATO_REVEAL.close;
/**
 * Closer than this when the TOMATO is FIRST seen and the entrance is skipped: it is shown where it
 * is, whole, and is takeable at once. Coming this close after the entrance has begun skips nothing.
 */
export const TOMATO_REVEAL_SKIP_DISTANCE = 110;

/**
 * When the entrance starts, decided once: on the first frame the TOMATO is drawn. -Infinity means
 * skipped (shown whole). A start already decided is kept as it is -- closeness only matters then.
 */
export function tomatoRevealStart(decided: number | undefined, first: { inChamber: boolean; reducedMotion: boolean; distance: number; now: number }): number {
  if (decided !== undefined) return decided;
  return !first.inChamber || first.reducedMotion || first.distance < TOMATO_REVEAL_SKIP_DISTANCE ? -Infinity : first.now;
}

export interface TomatoRevealFrame {
  /** 0..1, the cracks and glow on the back wall. */
  omen: number;
  /** 0..1, how far open the portal is. */
  portal: number;
  /** 0..1, how far out of the wall the TOMATO is; 1 is its resting place. Null while unseen. */
  emerge: number | null;
  done: boolean;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (v: number) => 1 - (1 - v) ** 3;

/** What to draw `t` seconds after the chamber first came into view. */
export function tomatoRevealFrame(t: number): TomatoRevealFrame {
  const { omen, open, emerge, close } = TOMATO_REVEAL;
  if (t >= TOMATO_REVEAL_SECONDS) return { omen: 0, portal: 0, emerge: 1, done: true };
  const a = omen, b = a + open, c = b + emerge;
  if (t < a) return { omen: clamp(t / omen), portal: 0, emerge: null, done: false };
  if (t < b) return { omen: 1, portal: easeOut(clamp((t - a) / open)), emerge: null, done: false };
  if (t < c) return { omen: 1, portal: 1, emerge: easeOut(clamp((t - b) / emerge)), done: false };
  const shut = clamp((t - c) / close);
  return { omen: 1 - shut, portal: 1 - easeOut(shut), emerge: 1, done: false };
}
