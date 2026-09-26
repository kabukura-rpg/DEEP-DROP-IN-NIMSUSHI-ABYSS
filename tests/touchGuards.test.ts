import { describe, expect, it } from 'vitest';
import { DOUBLE_TAP, installGameAreaZoomGuard, installLevelSelectGesture } from '../src/ui/touchGuards';
import { LEVEL_SELECT_GESTURE } from '../src/data/levelSelect';

/**
 * iOS SAFARI TOUCH GUARDS, driven with plain events: a browser cannot reproduce Safari's zoom, but it
 * can prove what is counted, what is cancelled, and that nothing else is.
 */
const event = (type: string, extra: Record<string, unknown> = {}) => {
  const e = new Event(type, { cancelable: true });
  for (const [k, v] of Object.entries(extra)) Object.defineProperty(e, k, { value: v });
  return e;
};
const touch = (x = 10, y = 10) => ({ clientX: x, clientY: y });

describe('the hidden LEVEL SELECT arrow', () => {
  const setup = () => {
    let clock = 0, revealed = 0;
    const arrow = new EventTarget();
    const gesture = installLevelSelectGesture(arrow, () => { revealed++; }, LEVEL_SELECT_GESTURE, () => clock);
    // One finger tap as iOS delivers it: pointer events, then the touch, then (maybe) a click.
    const tap = (id: number, click = true) => {
      arrow.dispatchEvent(event('pointerdown', { pointerId: id }));
      arrow.dispatchEvent(event('touchstart'));
      arrow.dispatchEvent(event('pointerup', { pointerId: id }));
      arrow.dispatchEvent(event('touchend'));
      if (click) arrow.dispatchEvent(event('click'));
      clock += 200;
    };
    return { arrow, gesture, tap, revealed: () => revealed, advance: (ms: number) => { clock += ms; } };
  };

  it('opens on the fifth pointerup, and not on the fourth', () => {
    const g = setup();
    for (let i = 1; i <= 4; i++) g.tap(i);
    expect(g.revealed()).toBe(0);
    g.tap(5);
    expect(g.revealed()).toBe(1);
  });

  it('counts one per tap even when the touch also produces a click', () => {
    const g = setup();
    for (let i = 1; i <= 3; i++) g.tap(i, true);
    expect(g.gesture.taps()).toBe(3);
    // A click on its own -- a synthesised one arriving late -- is not a tap.
    g.arrow.dispatchEvent(event('click'));
    g.arrow.dispatchEvent(event('click'));
    expect(g.gesture.taps()).toBe(3);
  });

  it('counts a pointerup only for a pointer that went down on the arrow', () => {
    const g = setup();
    g.arrow.dispatchEvent(event('pointerup', { pointerId: 9 }));
    expect(g.gesture.taps()).toBe(0);
    g.arrow.dispatchEvent(event('pointerdown', { pointerId: 9 }));
    g.arrow.dispatchEvent(event('pointercancel', { pointerId: 9 }));
    g.arrow.dispatchEvent(event('pointerup', { pointerId: 9 }));
    expect(g.gesture.taps()).toBe(0);
  });

  it('starts over when the taps are too far apart', () => {
    const g = setup();
    for (let i = 1; i <= 4; i++) g.tap(i);
    g.advance(LEVEL_SELECT_GESTURE.windowMs);
    g.tap(5);
    expect(g.revealed()).toBe(0);
  });

  it('cancels its own touchstart and touchend, so Safari never reads the taps as a zoom', () => {
    const g = setup();
    const start = event('touchstart'), end = event('touchend');
    g.arrow.dispatchEvent(start); g.arrow.dispatchEvent(end);
    expect(start.defaultPrevented).toBe(true);
    expect(end.defaultPrevented).toBe(true);
  });
});

describe('the game area zoom guard', () => {
  const setup = () => {
    let clock = 0;
    const area = new EventTarget();
    const control = new EventTarget();
    installGameAreaZoomGuard(area, target => target === control, () => clock);
    const end = (x = 10, y = 10, on: EventTarget = area) => {
      const e = event('touchend', { touches: [], changedTouches: [touch(x, y)] });
      // Dispatch on the area with the given target: bubble-free, so set target by dispatching there.
      on.dispatchEvent(e);
      return e;
    };
    return { area, control, end, advance: (ms: number) => { clock += ms; } };
  };

  it('cancels Safari pinch gestures and two-finger moves, and leaves one finger alone', () => {
    const { area } = setup();
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      const e = event(type); area.dispatchEvent(e); expect(e.defaultPrevented, type).toBe(true);
    }
    const pinch = event('touchmove', { touches: [touch(), touch(40, 40)] });
    const scroll = event('touchmove', { touches: [touch()] });
    area.dispatchEvent(pinch); area.dispatchEvent(scroll);
    expect(pinch.defaultPrevented).toBe(true);
    expect(scroll.defaultPrevented).toBe(false);
  });

  it('cancels only the quick second tap in the same place', () => {
    const g = setup();
    expect(g.end().defaultPrevented).toBe(false);
    g.advance(DOUBLE_TAP.ms - 50);
    expect(g.end().defaultPrevented).toBe(true);
    g.advance(DOUBLE_TAP.ms + 50);
    expect(g.end().defaultPrevented).toBe(false);
    g.advance(100);
    expect(g.end(200, 200).defaultPrevented).toBe(false);
  });

  it('never cancels a control, whose click is how it works', () => {
    const g = setup();
    // A control's events reach the guard through its target; model it by listening on the control.
    installGameAreaZoomGuard(g.control, target => target === g.control, () => 0);
    g.end(10, 10, g.control);
    expect(g.end(10, 10, g.control).defaultPrevented).toBe(false);
  });
});
