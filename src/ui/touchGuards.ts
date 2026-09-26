/**
 * iOS SAFARI TOUCH GUARDS -- the parts of the page that belong to the game, kept from Safari's own
 * gestures. Written against EventTarget alone so they can be exercised without a browser.
 *
 * Why this exists beside the CSS. `touch-action:none` on the game frame is what every other browser
 * needs, and it was not enough on an iPhone: two quick taps on something that is not a button (the
 * title arrow, the playfield, an overlay's background) were still read as a double-tap zoom, the
 * zoom swallowed the second tap, and once zoomed the page could not be pinched back from inside the
 * frame -- which on a phone is nearly the whole screen.
 */

/** A second tap this soon after the last one, this close to it, is what Safari reads as a zoom. */
export const DOUBLE_TAP = { ms: 350, slop: 40 } as const;

const cancel = (e: Event) => { if (e.cancelable) e.preventDefault(); };
const pointerId = (e: Event) => (e as PointerEvent).pointerId;

/**
 * The hidden LEVEL SELECT unlock: `taps` taps on `target` inside `windowMs`.
 *
 * A tap is a pointerdown and the pointerup of the SAME pointer, counted on the pointerup -- never on
 * a click, which iOS synthesises late or not at all and which would count a touch twice where it
 * does arrive. The touch itself is cancelled (non-passive), which is what stops Safari treating the
 * second of two quick taps as a zoom; pointer events are dispatched ahead of touch events and are
 * not affected by it.
 */
export function installLevelSelectGesture(
  target: EventTarget, onReveal: () => void,
  rule: { readonly taps: number; readonly windowMs: number }, now: () => number = () => performance.now(),
) {
  const down = new Set<number>();
  let taps: number[] = [];
  target.addEventListener('pointerdown', e => { down.add(pointerId(e)); });
  target.addEventListener('pointercancel', e => { down.delete(pointerId(e)); });
  target.addEventListener('pointerup', e => {
    if (!down.delete(pointerId(e))) return;
    const at = now();
    taps = [...taps.filter(t => at - t < rule.windowMs), at];
    if (taps.length >= rule.taps) { taps = []; onReveal(); }
  });
  target.addEventListener('touchstart', cancel, { passive: false });
  target.addEventListener('touchend', cancel, { passive: false });
  return { taps: () => taps.length };
}

/**
 * Safari's zoom gestures inside the game area only; the page outside keeps them.
 *
 *   gesturestart / gesturechange / gestureend  Safari's own pinch events
 *   touchmove with two or more fingers          a pinch as touches (one finger still scrolls REST)
 *   a quick second touchend on a non-control    the double-tap smart zoom
 *
 * Controls (`isControl`) are left alone: their click is how they work, and cancelling a touchend
 * would cancel it. The move and FIRE pads guard themselves, pointer events are never touched, so
 * multitouch, slide switching and pointercancel are exactly as they were.
 */
export function installGameAreaZoomGuard(
  area: EventTarget, isControl: (target: EventTarget | null) => boolean, now: () => number = () => performance.now(),
) {
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) area.addEventListener(type, cancel, { passive: false });
  area.addEventListener('touchmove', e => { if ((e as TouchEvent).touches.length > 1) cancel(e); }, { passive: false });
  let last = { at: -Infinity, x: 0, y: 0 };
  area.addEventListener('touchend', e => {
    const touch = (e as TouchEvent).changedTouches?.[0];
    if (!touch || (e as TouchEvent).touches.length > 0) return;
    const at = now();
    const quick = at - last.at < DOUBLE_TAP.ms && Math.hypot(touch.clientX - last.x, touch.clientY - last.y) < DOUBLE_TAP.slop;
    last = { at, x: touch.clientX, y: touch.clientY };
    if (quick && !isControl(e.target)) cancel(e);
  }, { passive: false });
}
