/**
 * THE TOMATO'S ENTRANCE -- drawing only.
 *
 * The TOMATO is laid on the staging chamber's floor when the room is built and can be taken from
 * that moment; nothing here moves it, delays it or changes what touching it does. What changes is
 * how it is first SEEN: rather than already standing in the recess like a prop set in front of
 * the wall, it comes out of the chamber's back wall the first time the chamber is on screen.
 *
 *   omen    cracks and a red glow spread over the back wall
 *   open    a dark portal opens where the cracks meet
 *   emerge  the TOMATO slides out of it to where it has always been
 *   close   the portal shuts behind it
 */
export const TOMATO_REVEAL = { omen: 0.35, open: 0.3, emerge: 0.45, close: 0.4 } as const;
export const TOMATO_REVEAL_SECONDS = TOMATO_REVEAL.omen + TOMATO_REVEAL.open + TOMATO_REVEAL.emerge + TOMATO_REVEAL.close;
/**
 * Closer than this and the entrance is skipped: the TOMATO is shown where it is, whole. Well
 * outside the pickup's reach, so it can never be collected while it is still drawn in the wall.
 */
export const TOMATO_REVEAL_SKIP_DISTANCE = 110;

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
