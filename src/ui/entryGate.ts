/**
 * TITLE AUDIO ENTRY GATE -- Codex design A "Minimal Overlay" (HUMAN APPROVED).
 *
 * A fresh page opens on the title under a dark veil that says PRESS ANY KEY / TAP TO ENTER. The first
 * press lifts it and, inside that same press, asks the browser for sound -- which is the only reason
 * the gate exists: a browser will not start the title music without a gesture. It is never a way into
 * the game. The press that opens the gate is used up entirely, so START needs a press of its own:
 *
 *   KEY     the opening key's own repeats and its keyup (SPACE activates a button on keyup) are
 *           consumed, and the title only takes the keyboard back once that key is released
 *   POINTER the opening pointer's pointerup / pointercancel and its click are consumed (the click
 *           whenever it comes, up to a fresh primary press) -- a mouse released over START, or a
 *           touch's late synthesised click, cannot start a run
 *   REPEAT  on the title, a held ENTER / SPACE is never read again: only a fresh press can choose
 *
 * The listeners sit on the window in the capture phase and are installed before anything else, so a
 * consumed event never reaches the menu keys, the title buttons, the LEVEL SELECT gesture or Phaser.
 *
 * A touch's pointerdown is not a user activation in every browser (WebKit and Chrome count the release),
 * so the same gesture's pointerup / touchend / click call `onActivation` again. Those are still part of
 * the opening press and are still consumed.
 *
 * DOUBLE TAP. The prompt sits over START (72.5% of the frame, inside START's band), so the second tap of
 * a quick double tap on it -- measured: it starts a run on a 390x844 phone, touch adjustment carrying it
 * onto START -- is taken as part of the opening gesture: a press within touchGuards' own DOUBLE_TAP
 * (the iOS zoom definition, 350ms / 40px) of the opening press is consumed like it. Any other press,
 * however soon, is a press of its own.
 *
 * Written against EventTarget alone, like touchGuards, so the rules can be exercised without a browser.
 */
import { DOUBLE_TAP } from './touchGuards';

/** Keys that never open the gate: modifiers held for a shortcut, Tab (it moves focus), function keys. */
const NOT_ENTRY = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Fn', 'FnLock', 'OS', 'Hyper', 'Super', 'NumLock', 'ScrollLock']);

/** True when a keydown should open the gate: a fresh press of an ordinary key, not a shortcut. */
export function isEntryKey(e: Pick<KeyboardEvent, 'key' | 'repeat' | 'isComposing' | 'metaKey' | 'ctrlKey' | 'altKey'>) {
  if (e.repeat || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return false;
  return !NOT_ENTRY.has(e.key) && !/^F\d{1,2}$/.test(e.key);
}

export interface EntryGate {
  /** True while the veil is up (a fresh document, before the first press). */
  isOpen: () => boolean;
  /** The veil's own element: only a press that lands on it opens the gate. */
  gate: () => Element | null;
  /**
   * What the veil covers (the whole title). While it is up, no click reaches anything in it -- trusted
   * or not, since `inert` keeps a pointer and the focus out but not a scripted `click()`.
   */
  covers: () => Element | null;
  /** True while the title menu is the screen, i.e. after the gate, before a run. */
  isTitle: () => boolean;
  /** Open the gate. Called synchronously inside the opening event, before anything is awaited. */
  onEnter: (event: Event) => void;
  /** The opening gesture is still going (its release, its touchend, its click): ask for sound again. */
  onActivation: (event: Event) => void;
  /** The opening key or pointer has been let go: the title may take focus and input now. */
  onReleased: () => void;
  /** Any later trusted press on the title, before it reaches the page -- the title music's retry. */
  onTitleGesture?: (event: Event) => void;
}

const consume = (e: Event) => { if (e.cancelable) e.preventDefault(); e.stopImmediatePropagation(); };
const inside = (target: EventTarget | null, element: Element | null) =>
  !!element && !!target && typeof (target as Node).nodeType === 'number' && element.contains(target as Node);

/** Install the gate on `target` (the window). Returns its live bookkeeping, for tests. */
export function installEntryGate(target: EventTarget, gate: EntryGate, now: () => number = () => performance.now()) {
  /** The key that opened the gate, until its keyup. */
  let heldKey: string | null = null;
  /** The pointer that opened the gate, until its pointerup / pointercancel. */
  let heldPointer: number | null = null;
  /** The opening pointer's click is still to come: it arrives late, if at all, and is consumed. */
  let swallowClick = false;
  /** The opening touch is still in progress, so its release may carry the activation it lacked. */
  let opening = false;
  /** Where and when a pointer opened the gate, until the next press: the first half of a double tap. */
  let openedAt: { at: number; x: number; y: number } | null = null;

  const release = () => { if (heldKey === null && heldPointer === null) gate.onReleased(); };

  target.addEventListener('keydown', event => {
    const e = event as KeyboardEvent;
    if (gate.isOpen()) {
      if (!e.isTrusted) return;
      // A key still held from before the page (or from a menu) repeats into it: never a press.
      if (e.repeat) { consume(e); return; }
      if (!isEntryKey(e)) return;
      consume(e);
      // Its own activation is already stopped: ENTER acts on keydown, SPACE on keyup, both consumed.
      heldKey = e.code; swallowClick = false; opening = false;
      gate.onEnter(e);
      return;
    }
    if (heldKey !== null && e.code === heldKey) { consume(e); return; }
    if (gate.isTitle() && e.repeat && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space')) { consume(e); return; }
    if (!e.repeat) { swallowClick = false; opening = false; }
    if (gate.isTitle() && e.isTrusted && !e.repeat) gate.onTitleGesture?.(e);
  }, { capture: true });

  target.addEventListener('keyup', event => {
    const e = event as KeyboardEvent;
    if (heldKey === null || e.code !== heldKey) return;
    consume(e);
    heldKey = null;
    release();
  }, { capture: true });

  target.addEventListener('pointerdown', event => {
    const e = event as PointerEvent;
    if (gate.isOpen()) {
      if (!e.isTrusted || !inside(e.target, gate.gate())) return;
      consume(e);
      if (!e.isPrimary || e.button !== 0) return;
      heldPointer = e.pointerId; swallowClick = true; opening = true;
      openedAt = { at: now(), x: e.clientX, y: e.clientY };
      gate.onEnter(e);
      return;
    }
    // A second finger while the opening one is still down belongs to the same gesture.
    if (heldPointer !== null) { consume(e); return; }
    if (!e.isPrimary) return;
    const first = openedAt; openedAt = null;
    if (first && now() - first.at < DOUBLE_TAP.ms && Math.hypot(e.clientX - first.x, e.clientY - first.y) < DOUBLE_TAP.slop) {
      consume(e);
      heldPointer = e.pointerId; swallowClick = true; opening = false;
      return;
    }
    swallowClick = false; opening = false;
    if (gate.isTitle() && e.isTrusted) gate.onTitleGesture?.(e);
  }, { capture: true, passive: false });

  const up = (event: Event) => {
    const e = event as PointerEvent;
    if (heldPointer === null || e.pointerId !== heldPointer) {
      if (event.type === 'pointerup' && gate.isTitle() && e.isTrusted && e.isPrimary) gate.onTitleGesture?.(e);
      return;
    }
    consume(e);
    heldPointer = null;
    if (event.type === 'pointerup' && opening && e.isTrusted) gate.onActivation(e);
    release();
  };
  target.addEventListener('pointerup', up, { capture: true, passive: false });
  target.addEventListener('pointercancel', up, { capture: true, passive: false });

  target.addEventListener('touchend', event => {
    // Not consumed: the click it would make is consumed instead, and the zoom guard keeps its say.
    if (opening && event.isTrusted) gate.onActivation(event);
    else if (!opening && gate.isTitle() && event.isTrusted) gate.onTitleGesture?.(event);
  }, { capture: true, passive: true });

  target.addEventListener('click', event => {
    if (gate.isOpen()) {
      const onVeil = inside(event.target, gate.gate());
      if (!onVeil) { if (inside(event.target, gate.covers())) consume(event); return; }
      consume(event);
      if (!event.isTrusted) return;
      // Activation without a press first: assistive technology "clicking" the veil.
      swallowClick = true; opening = false;
      gate.onEnter(event);
      release();
      return;
    }
    if (!swallowClick) return;
    // The opening press's one click. The next is someone's own -- a screen reader activating START
    // sends a click with no press before it, and must not be eaten.
    consume(event);
    swallowClick = false;
    if (opening && event.isTrusted) gate.onActivation(event);
    opening = false;
  }, { capture: true });

  // A key or pointer whose release will never arrive here: let go of it, but keep any late click out.
  target.addEventListener('blur', () => {
    const held = heldKey !== null || heldPointer !== null;
    heldKey = null; heldPointer = null; opening = false;
    if (held) release();
  });

  return {
    state: () => ({ heldKey, heldPointer, swallowClick, opening }),
  };
}
