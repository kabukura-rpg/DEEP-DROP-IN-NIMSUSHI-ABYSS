import { describe, expect, it } from 'vitest';
import { nextChoiceIndex, mayMoveAgain, stepFor, MENU_REPEAT_MS } from '../src/ui/menuKeys';

/**
 * KEYBOARD NAVIGATION for the overlay menus, in the part that can be reasoned about without a
 * browser: which choice a step lands on, and whether a held key is allowed to move again.
 *
 * The rest of it is DOM -- focus, real key events, and a real `<button>` answering to ENTER on its
 * own -- and this project has no DOM test environment, so that half is verified in the browser
 * harness against the actual game instead of against a simulation of one. See the report.
 */
describe('which choice a step lands on', () => {
  it('enters the list from either end when nothing is focused', () => {
    expect(nextChoiceIndex(3, -1, 1)).toBe(0);
    expect(nextChoiceIndex(3, -1, -1)).toBe(2);
  });

  it('walks forward and wraps', () => {
    expect(nextChoiceIndex(3, 0, 1)).toBe(1);
    expect(nextChoiceIndex(3, 1, 1)).toBe(2);
    expect(nextChoiceIndex(3, 2, 1)).toBe(0);
  });

  it('walks backward and wraps', () => {
    expect(nextChoiceIndex(3, 2, -1)).toBe(1);
    expect(nextChoiceIndex(3, 1, -1)).toBe(0);
    expect(nextChoiceIndex(3, 0, -1)).toBe(2);
  });

  it('cycles a three-choice REST POINT exactly 1 -> 2 -> 3 -> 1', () => {
    let at = -1;
    const visited: number[] = [];
    for (let i = 0; i < 4; i++) { at = nextChoiceIndex(3, at, 1); visited.push(at); }
    expect(visited).toEqual([0, 1, 2, 0]);
  });

  it('has nothing to land on when a menu has no choices', () => {
    expect(nextChoiceIndex(0, -1, 1)).toBe(-1);
  });

  it('handles a menu of one without moving anywhere', () => {
    expect(nextChoiceIndex(1, 0, 1)).toBe(0);
    expect(nextChoiceIndex(1, 0, -1)).toBe(0);
  });
});

describe('which keys move, and which way', () => {
  it('moves forward on right and down, on arrows and on WASD alike', () => {
    for (const code of ['ArrowRight', 'ArrowDown', 'KeyD', 'KeyS']) expect(stepFor(code), code).toBe(1);
  });
  it('moves back on left and up', () => {
    for (const code of ['ArrowLeft', 'ArrowUp', 'KeyA', 'KeyW']) expect(stepFor(code), code).toBe(-1);
  });
  it('leaves ENTER, SPACE and ESCAPE to whoever else wants them', () => {
    // A focused button answers to ENTER and SPACE itself, which is what keeps keyboard, mouse and
    // touch on one path; ESCAPE is handled separately and only where a screen has a way out.
    for (const code of ['Enter', 'Space', 'Escape', 'Tab', 'KeyQ']) expect(stepFor(code), code).toBeUndefined();
  });
});

describe('a held key', () => {
  it('moves once and then waits', () => {
    expect(mayMoveAgain(1000, 1000 - MENU_REPEAT_MS + 1)).toBe(false);
    expect(mayMoveAgain(1000, 1000 - MENU_REPEAT_MS)).toBe(true);
  });

  it('is slow enough that one press cannot cross a three-choice list', () => {
    // A key repeats at roughly 30ms once it gets going. Three choices must take longer than a
    // person can hold a key without meaning to.
    const osRepeat = 30;
    let moves = 0, last = -Infinity;
    for (let t = 0; t < MENU_REPEAT_MS; t += osRepeat) if (mayMoveAgain(t, last)) { moves++; last = t; }
    expect(moves).toBe(1);
  });
});
