/**
 * KEYBOARD NAVIGATION FOR THE OVERLAY MENUS.
 *
 * DEEP DROP is played on a keyboard on a PC -- move with the arrows or A/D, fire with SPACE -- and
 * then every choice it asks for wanted a mouse. Reaching for one mid-run to pick an upgrade or buy
 * a heart is the whole complaint, and it is a real one.
 *
 * WHAT THIS IS NOT. It is not a selection framework and it owns no state. Every choice in this game
 * is already a real `<button>`, so the browser will activate a focused one on ENTER or SPACE and
 * run the very same `onclick` a mouse would -- keyboard, mouse and touch therefore enter the game
 * through one path and there is no second copy of any decision. All that was missing was a way to
 * MOVE the focus without a pointer, and a way to say "never mind".
 *
 *   ARROWS / WASD   move between the choices, wrapping at either end
 *   ENTER / SPACE   activate the focused one (the browser's own behaviour, untouched)
 *   ESCAPE          whatever "back" means on this screen, when it means anything
 *
 * Mouse and touch are not changed, and cannot be: nothing here runs unless a key is pressed.
 */

/** Which way each key moves through the choices. Physical codes, so a layout cannot break WASD. */
const STEP: Record<string, number> = {
  ArrowRight: 1, ArrowDown: 1, KeyD: 1, KeyS: 1,
  ArrowLeft: -1, ArrowUp: -1, KeyA: -1, KeyW: -1,
};

/**
 * The shortest gap between two moves, in ms.
 *
 * A held key repeats at the operating system's rate, which is fast enough to cross a three-item
 * list before a finger lifts. This is slow enough that one press is one move and a held key scrolls
 * at a readable pace rather than teleporting to the end.
 */
export const MENU_REPEAT_MS = 150;

export interface MenuKeys {
  /** The element holding the choices. */
  root: () => HTMLElement;
  /** True while a menu is up and the keyboard belongs to it rather than to the run. */
  isOpen: () => boolean;
  /** What ESCAPE does here, if anything. Return false when this screen has no "back". */
  cancel?: () => boolean;
}

/**
 * Which choice a step lands on, given where the focus is now and how many there are.
 *
 * Split out from the DOM so the wrapping can be tested without a browser: from nothing, a forward
 * step lands on the first and a backward one on the last, so either key gets a keyboard player into
 * the list; from anywhere else it walks and wraps.
 */
export function nextChoiceIndex(count: number, current: number, step: number) {
  if (count <= 0) return -1;
  return current < 0 ? (step > 0 ? 0 : count - 1) : (current + step + count) % count;
}

/** True when enough time has passed since the last move that a held key may move again. */
export const mayMoveAgain = (now: number, last: number) => now - last >= MENU_REPEAT_MS;

/** Which way a key moves the focus, or undefined when the key is not the menu's business. */
export const stepFor = (code: string): number | undefined => STEP[code];

/** Every button in the menu that can actually be chosen: laid out, not hidden, not disabled. */
export function menuChoices(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
    .filter(b => !b.disabled && !b.hidden && b.offsetParent !== null);
}

/**
 * Move the focus by `step`, wrapping. Starting from nothing, a forward step lands on the first
 * choice and a backward one on the last, so either key gets a keyboard player into the list.
 */
export function moveMenuFocus(root: HTMLElement, step: number) {
  const choices = menuChoices(root);
  if (!choices.length) return null;
  const at = choices.indexOf(document.activeElement as HTMLButtonElement);
  const next = choices[nextChoiceIndex(choices.length, at, step)];
  next.focus({ preventScroll: true });
  return next;
}

/** Wire the keys up. Returns a function that removes them again, for tests and teardown. */
export function installMenuKeys(menu: MenuKeys) {
  let lastMove = 0;
  const onKey = (event: KeyboardEvent) => {
    if (!menu.isOpen()) return;
    const step = STEP[event.code];
    if (step !== undefined) {
      // Taken by the menu so the page does not scroll and the run does not read it as movement.
      event.preventDefault();
      const now = performance.now();
      if (!mayMoveAgain(now, lastMove)) return;
      lastMove = now;
      moveMenuFocus(menu.root(), step);
      return;
    }
    if (event.code === 'Escape' && menu.cancel?.()) event.preventDefault();
    // ENTER and SPACE are deliberately not handled: a focused button already answers to both, and
    // routing them here would be a second way to make the same choice.
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
