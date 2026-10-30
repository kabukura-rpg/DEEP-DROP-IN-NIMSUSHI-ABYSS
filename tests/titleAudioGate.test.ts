import { afterEach, describe, expect, it, vi } from 'vitest';
import mainSource from '../src/main.ts?raw';
import { installEntryGate, isEntryKey } from '../src/ui/entryGate';
import { DOUBLE_TAP } from '../src/ui/touchGuards';
import { TITLE_MUSIC, TitleMusic, type TitleElement } from '../src/systems/TitleMusic';
import { AREA_MUSIC, MUSIC, musicTrack } from '../src/systems/Music';
import { ENTRY_GATE, entryGateMarkup, entryPrompt, titleMarkup } from '../src/ui/titleScreen';
import { TITLE_AUDIO_GATE_NEW_FILES, withoutTitleAudioGate } from './titleAudioGateRestore';

const fs = await import(/* @vite-ignore */ 'node:' + 'fs') as {
  readFileSync: { (path: URL, encoding: 'utf8'): string; (path: URL): Uint8Array };
  readdirSync: (path: URL) => string[];
  existsSync: (path: URL) => boolean;
};
const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: Uint8Array | string) => { digest: (e: string) => string } } };
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const css = fs.readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
/** One function's source out of main.ts, from its declaration to the next top-level one. */
const fn = (name: string) => {
  const at = mainSource.indexOf(`function ${name}(`);
  expect(at, name).toBeGreaterThan(-1);
  const end = mainSource.indexOf('\nfunction ', at + 1);
  return mainSource.slice(at, end < 0 ? undefined : end);
};

/**
 * TITLE AUDIO ENTRY GATE V1. The input rules are driven with plain events on a plain EventTarget, the
 * way the browser delivers them, with the page's own listeners standing behind the gate -- so what is
 * proved is what reaches START, not what the gate thinks it did.
 */
const GATE = { nodeType: 1, name: 'gate' };
const START = { nodeType: 1, name: 'start' };
const HEADER_SOUND = { nodeType: 1, name: 'sound' };
const event = (type: string, extra: Record<string, unknown> = {}) => {
  const e = new Event(type, { cancelable: true });
  for (const [k, v] of Object.entries({ isTrusted: true, ...extra })) Object.defineProperty(e, k, { value: v });
  return e;
};
const key = (type: 'keydown' | 'keyup', code: string, extra: Record<string, unknown> = {}) =>
  event(type, { code, key: code === 'Space' ? ' ' : code.replace(/^Key/, '').toLowerCase(), repeat: false, isComposing: false, metaKey: false, ctrlKey: false, altKey: false, ...extra });
const pointer = (type: string, pointerId = 1, extra: Record<string, unknown> = {}) =>
  event(type, { pointerId, isPrimary: true, button: 0, pointerType: 'mouse', target: GATE, ...extra });

function setup() {
  const win = new EventTarget();
  let clock = 1000;
  const s = { open: true, entered: 0, activations: 0, released: 0, titleGestures: 0 };
  const gate = installEntryGate(win, {
    isOpen: () => s.open,
    gate: () => s.open ? { contains: (n: unknown) => n === GATE } as unknown as Element : null,
    covers: () => ({ contains: (n: unknown) => n === GATE || n === START } as unknown as Element),
    isTitle: () => !s.open,
    onEnter: () => { s.entered++; s.open = false; },
    onActivation: () => { s.activations++; },
    onReleased: () => { s.released++; },
    onTitleGesture: () => { s.titleGestures++; },
  }, () => clock);
  // What stands behind the gate: the menu keys, the title buttons, Phaser. Everything they receive.
  const page: Record<string, number> = {};
  for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'pointercancel', 'click', 'touchend']) {
    win.addEventListener(type, () => { page[type] = (page[type] ?? 0) + 1; });
  }
  const send = (e: Event) => { win.dispatchEvent(e); return e; };
  return { win, s, gate, page, send, reached: (type: string) => page[type] ?? 0, advance: (ms: number) => { clock += ms; } };
}

describe('ENTRY GATE: the first key', () => {
  it('opens on a keydown and the press never reaches the page', () => {
    const g = setup();
    const down = g.send(key('keydown', 'Enter'));
    expect(g.s.entered).toBe(1);
    expect(down.defaultPrevented).toBe(true); // ENTER cannot activate whatever has focus
    expect(g.reached('keydown')).toBe(0);
  });

  it('eats the opening key\'s repeats and its keyup, and only then hands the title its focus', () => {
    const g = setup();
    g.send(key('keydown', 'Space'));
    for (let i = 0; i < 20; i++) g.send(key('keydown', 'Space', { repeat: true }));
    expect(g.reached('keydown')).toBe(0);
    expect(g.s.released).toBe(0);
    const up = g.send(key('keyup', 'Space'));
    expect(up.defaultPrevented).toBe(true); // SPACE activates a button on keyup: not this one
    expect(g.reached('keyup')).toBe(0);
    expect(g.s.released).toBe(1);
    // A fresh press is the player's own and goes through.
    g.send(key('keydown', 'Enter'));
    expect(g.reached('keydown')).toBe(1);
    expect(g.s.entered).toBe(1);
  });

  it('never starts from a held ENTER / SPACE: every repeat on the title is consumed', () => {
    const g = setup();
    g.send(key('keydown', 'KeyA')); g.send(key('keyup', 'KeyA'));
    for (const code of ['Enter', 'NumpadEnter', 'Space']) {
      const e = g.send(key('keydown', code, { repeat: true }));
      expect(e.defaultPrevented, code).toBe(true);
    }
    expect(g.reached('keydown')).toBe(0);
    // Arrow repeats are the menu's own scrolling and are left alone.
    g.send(key('keydown', 'ArrowDown', { repeat: true }));
    expect(g.reached('keydown')).toBe(1);
  });

  it('a key already held when the page opened repeats into it without opening it', () => {
    const g = setup();
    g.send(key('keydown', 'Enter', { repeat: true }));
    expect(g.s.entered).toBe(0);
    expect(g.reached('keydown')).toBe(0);
  });

  it('takes any ordinary key, ESCAPE included, but not a modifier, Tab, a function key or a shortcut', () => {
    const base = { repeat: false, isComposing: false, metaKey: false, ctrlKey: false, altKey: false };
    for (const k of ['Enter', ' ', 'a', 'ArrowDown', 'Escape', 'z', '1']) expect(isEntryKey({ ...base, key: k }), k).toBe(true);
    for (const k of ['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'CapsLock', 'F5', 'F12']) expect(isEntryKey({ ...base, key: k }), k).toBe(false);
    expect(isEntryKey({ ...base, key: 'r', metaKey: true })).toBe(false);
    expect(isEntryKey({ ...base, key: 'r', ctrlKey: true })).toBe(false);
    expect(isEntryKey({ ...base, key: 'a', isComposing: true })).toBe(false);
    const g = setup();
    g.send(key('keydown', 'Tab', { key: 'Tab' }));
    expect(g.s.entered).toBe(0);
    expect(g.reached('keydown')).toBe(1); // Tab still moves focus
  });

  it('lets no click reach START behind the veil -- not even a scripted one, which inert does not stop', () => {
    const g = setup();
    g.send(pointer('click', 0, { target: START, isTrusted: false }));
    g.send(pointer('click', 0, { target: START }));
    expect(g.reached('click')).toBe(0);
    expect(g.s.entered).toBe(0);
    // Outside the title (the header ♪) a click is left alone.
    g.send(pointer('click', 0, { target: HEADER_SOUND }));
    expect(g.reached('click')).toBe(1);
  });

  it('after a key opened it, a click with no press before it (a screen reader activating START) is not eaten', () => {
    const g = setup();
    g.send(key('keydown', 'Enter')); g.send(key('keyup', 'Enter'));
    g.send(pointer('click', 0, { target: START }));
    expect(g.reached('click')).toBe(1);
  });

  it('ignores synthetic input', () => {
    const g = setup();
    g.send(key('keydown', 'Enter', { isTrusted: false }));
    g.send(pointer('pointerdown', 1, { isTrusted: false }));
    g.send(pointer('click', 1, { isTrusted: false }));
    expect(g.s.entered).toBe(0);
  });
});

describe('ENTRY GATE: the first tap or click', () => {
  it('opens on pointerdown, and its pointerup and click never reach START', () => {
    const g = setup();
    const down = g.send(pointer('pointerdown'));
    expect(g.s.entered).toBe(1);
    expect(down.defaultPrevented).toBe(true);
    // The veil is gone, so a mouse let go over START would land there.
    g.send(pointer('pointerup', 1, { target: START }));
    g.send(pointer('click', 1, { target: START }));
    expect([g.reached('pointerdown'), g.reached('pointerup'), g.reached('click')]).toEqual([0, 0, 0]);
    expect(g.s.released).toBe(1);
    // The next, separate press is a press of START.
    g.send(pointer('pointerdown', 2, { target: START }));
    g.send(pointer('pointerup', 2, { target: START }));
    g.send(pointer('click', 2, { target: START }));
    expect([g.reached('pointerdown'), g.reached('pointerup'), g.reached('click')]).toEqual([1, 1, 1]);
  });

  it('a touch: pointerdown, pointerup, touchend and the late click are one gesture -- sound is asked for again on each release', () => {
    const g = setup();
    g.send(pointer('pointerdown', 7, { pointerType: 'touch' }));
    g.send(pointer('pointerup', 7, { pointerType: 'touch', target: START }));
    g.send(event('touchend'));
    g.send(pointer('click', 7, { target: START }));
    expect(g.s.entered).toBe(1);
    expect(g.s.activations).toBe(3); // pointerup, touchend, click: wherever the browser grants it
    expect(g.reached('click')).toBe(0);
    expect(g.reached('pointerup')).toBe(0);
    // One gesture, one click: the next click is someone's own (a screen reader activating START).
    g.send(pointer('click', 0, { target: START }));
    expect(g.reached('click')).toBe(1);
  });

  it('a finger that moves off and lifts elsewhere, or is cancelled, is still the same gesture', () => {
    const g = setup();
    g.send(pointer('pointerdown', 3, { pointerType: 'touch' }));
    g.send(pointer('pointercancel', 3, { pointerType: 'touch', target: START }));
    g.send(pointer('click', 3, { target: START }));
    expect(g.reached('pointercancel') + g.reached('click')).toBe(0);
    expect(g.s.released).toBe(1);
  });

  it('a second finger during the opening tap is part of it, never a START', () => {
    const g = setup();
    g.send(pointer('pointerdown', 1, { pointerType: 'touch' }));
    g.send(pointer('pointerdown', 2, { pointerType: 'touch', isPrimary: false, target: START }));
    g.send(pointer('pointerup', 2, { pointerType: 'touch', isPrimary: false, target: START }));
    g.send(pointer('click', 2, { target: START }));
    expect(g.reached('pointerdown') + g.reached('click')).toBe(0);
  });

  it('only a press on the veil opens it: the header ♪ and the page around the game are left alone', () => {
    const g = setup();
    g.send(pointer('pointerdown', 1, { target: HEADER_SOUND }));
    g.send(pointer('click', 1, { target: HEADER_SOUND }));
    expect(g.s.entered).toBe(0);
    expect([g.reached('pointerdown'), g.reached('click')]).toEqual([1, 1]);
    // A right button on the veil is consumed but does not open it.
    g.send(pointer('pointerdown', 2, { button: 2 }));
    expect(g.s.entered).toBe(0);
  });

  it('the second tap of a quick double tap on the prompt is part of the opening, not a START (DOUBLE_TAP 350ms / 40px)', () => {
    expect(DOUBLE_TAP).toEqual({ ms: 350, slop: 40 });
    const tapAt = (g: ReturnType<typeof setup>, id: number, x: number, y: number) => {
      g.send(pointer('pointerdown', id, { pointerType: 'touch', clientX: x, clientY: y, target: id === 1 ? GATE : START }));
      g.send(pointer('pointerup', id, { pointerType: 'touch', clientX: x, clientY: y, target: START }));
      g.send(pointer('click', id, { clientX: x, clientY: y, target: START }));
    };
    const quick = setup();
    tapAt(quick, 1, 195, 600); quick.advance(120); tapAt(quick, 2, 198, 596);
    expect(quick.reached('pointerdown') + quick.reached('click')).toBe(0);
    // The tap after that is the player's own, however soon.
    quick.advance(60); tapAt(quick, 3, 195, 600);
    expect(quick.reached('click')).toBe(1);
    // Slower than a double tap, or somewhere else: a press of its own.
    const slow = setup();
    tapAt(slow, 1, 195, 600); slow.advance(400); tapAt(slow, 2, 195, 600);
    expect(slow.reached('click')).toBe(1);
    const apart = setup();
    tapAt(apart, 1, 195, 600); apart.advance(100); tapAt(apart, 2, 195, 700);
    expect(apart.reached('click')).toBe(1);
    // A key-opened gate has no double tap.
    const keyed = setup();
    keyed.send(key('keydown', 'KeyX')); keyed.send(key('keyup', 'KeyX'));
    tapAt(keyed, 2, 195, 600);
    expect(keyed.reached('click')).toBe(1);
  });

  it('assistive technology clicking the veil opens it too, once', () => {
    const g = setup();
    g.send(pointer('click', 0));
    expect(g.s.entered).toBe(1);
    expect(g.s.released).toBe(1);
    expect(g.reached('click')).toBe(0);
  });

  it('a blur lets go of a held key or pointer without letting its late click through', () => {
    const g = setup();
    g.send(pointer('pointerdown'));
    g.win.dispatchEvent(new Event('blur'));
    expect(g.s.released).toBe(1);
    expect(g.gate.state().heldPointer).toBeNull();
    g.send(pointer('click', 1, { target: START }));
    expect(g.reached('click')).toBe(0);
  });

  it('later presses on the title are reported (the title music retries on them); the opening press is not', () => {
    const g = setup();
    g.send(pointer('pointerdown'));
    g.send(pointer('pointerup', 1));
    expect(g.s.titleGestures).toBe(0);
    g.send(pointer('pointerdown', 2, { target: START }));
    g.send(key('keydown', 'KeyM'));
    expect(g.s.titleGestures).toBe(2);
  });
});

/** A media element and an AudioContext that record what they are asked to do. */
class FakeElement {
  loop = false; preload = ''; src = ''; paused = true; currentTime = 0; error = null;
  plays = 0; loads = 0;
  answer: 'resolve' | 'reject' | 'pending' = 'resolve';
  private listeners: Record<string, (() => void)[]> = {};
  play() {
    this.plays++; this.paused = false;
    if (this.answer === 'reject') { this.paused = true; return Promise.reject(new DOMException('blocked', 'NotAllowedError')); }
    return this.answer === 'pending' ? new Promise<void>(() => {}) : Promise.resolve();
  }
  pause() { this.paused = true; }
  load() { this.loads++; }
  addEventListener(type: string, f: () => void) { (this.listeners[type] ??= []).push(f); }
  fire(type: string) { for (const f of this.listeners[type] ?? []) f(); }
}
class FakeParam {
  value = 0; log: [string, number, number][] = [];
  cancelScheduledValues(t: number) { this.log.push(['cancel', 0, t]); }
  setValueAtTime(v: number, t: number) { this.value = v; this.log.push(['set', v, t]); }
  linearRampToValueAtTime(v: number, t: number) { this.value = v; this.log.push(['ramp', v, t]); }
}
class FakeContext {
  state: 'running' | 'suspended' = 'running'; currentTime = 10; destination = {};
  resumes = 0; sources = 0; gains: FakeParam[] = [];
  resume() { this.resumes++; return Promise.resolve(); }
  createGain() { const gain = new FakeParam(); this.gains.push(gain); return { gain, connect: (n: unknown) => n }; }
  createMediaElementSource() { this.sources++; return { connect: (n: unknown) => n }; }
}
const flush = () => new Promise(r => setTimeout(r, 0));
const make = () => {
  const element = new FakeElement(), context = new FakeContext();
  const music = new TitleMusic(() => element as unknown as TitleElement);
  return { element, context, music, attach: () => music.attach(context as unknown as AudioContext) };
};

describe('TITLE BGM: Beneath_the_Mossy_Stone', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('ships the user\'s file byte for byte from src/assets/audio, apart from every AREA track', () => {
    const file = new URL('../src/assets/audio/Beneath_the_Mossy_Stone.mp3', import.meta.url);
    const bytes = fs.readFileSync(file);
    expect(bytes.length).toBe(3868411);
    expect(sha256(bytes)).toBe('c2e82a5417a36764ed3dbeec9428efbd41d491c0e02efdef55f2ebb18960c3fe');
    // An MPEG audio frame (ID3 tag or frame sync) -- not re-encoded, not a placeholder.
    expect(bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33 || bytes[0] === 0xff).toBe(true);
    expect(TITLE_MUSIC.url).toContain('Beneath_the_Mossy_Stone');
    expect(TITLE_MUSIC.url).not.toContain('dist/');
    expect(Object.values(AREA_MUSIC)).not.toContain(TITLE_MUSIC.url);
  });

  it('loops, preloads once the game\'s own art is in (not ahead of it), and makes no sound until a gesture wires it in', () => {
    const { element, music } = make();
    expect({ loop: element.loop, preload: element.preload }).toEqual({ loop: true, preload: 'none' });
    music.preload(); music.preload();
    expect({ preload: element.preload, loads: element.loads }).toEqual({ preload: 'auto', loads: 1 });
    expect(mainSource).toContain('game.events.once(Phaser.Core.Events.READY, () => scene.events.once(Phaser.Scenes.Events.CREATE, () => titleMusic.preload()));');
    expect(element.src).toBe(TITLE_MUSIC.url);
    expect(element.plays).toBe(0);
    music.request(); // no context yet: remembered, not played
    expect(element.plays).toBe(0);
    expect(music.state).toBe('idle');
  });

  it('a preload arriving after a press has asked for the track leaves it playing (no reload)', async () => {
    const { element, music, attach } = make();
    attach(); music.request(); await flush();
    music.preload();
    expect(element.loads).toBe(0);
    expect(element.paused).toBe(false);
  });

  it('wires one source for its whole life, however often it is attached', () => {
    const { context, attach } = make();
    attach(); attach(); attach();
    expect(context.sources).toBe(1);
  });

  it('asks to play synchronously inside the request, then reports playing only once it really plays', async () => {
    const { element, context, music, attach } = make();
    attach(); music.request();
    expect(element.plays).toBe(1); // before anything was awaited
    expect(music.state).toBe('requesting');
    await flush();
    expect(music.state).toBe('playing');
    const gain = context.gains[0];
    expect(gain.log.at(-1)).toEqual(['ramp', TITLE_MUSIC.volume, 10 + TITLE_MUSIC.fadeIn]);
  });

  it('never plays twice: a request while playing does nothing', async () => {
    const { element, music, attach } = make();
    attach(); music.request(); await flush();
    music.request(); music.request(); music.retry();
    expect(element.plays).toBe(1);
  });

  it('a refusal is "blocked", kept as a wish, and retried by the next gesture -- never on its own', async () => {
    const { element, music, attach } = make();
    element.answer = 'reject';
    attach(); music.request(); await flush();
    expect(music.state).toBe('blocked');
    expect(music.isWanted).toBe(true);
    await new Promise(r => setTimeout(r, 50));
    expect(element.plays).toBe(1); // nothing polls
    element.answer = 'resolve';
    music.retry(); await flush();
    expect(element.plays).toBe(2);
    expect(music.state).toBe('playing');
  });

  it('a context that is not running is not "playing", and is asked to resume inside the request', async () => {
    const { context, music, attach } = make();
    context.state = 'suspended';
    attach(); music.request();
    expect(context.resumes).toBe(1);
    await flush();
    expect(music.state).toBe('blocked');
  });

  it('a file that failed to load leaves the game alone, and is reloaded by the next request', async () => {
    const { element, music, attach } = make();
    element.fire('error');
    expect(music.loadFailed).toBe(true);
    element.answer = 'reject';
    attach(); music.request(); await flush();
    expect(element.loads).toBe(1);
    expect(music.state).toBe('blocked');
  });

  it('START: fades out over 0.5-1s without holding anything up, then pauses and rewinds', async () => {
    vi.useFakeTimers();
    const { element, context, music, attach } = make();
    attach(); music.request(); await vi.advanceTimersByTimeAsync(0);
    element.currentTime = 42;
    music.stop();
    expect(TITLE_MUSIC.fadeOut).toBeGreaterThanOrEqual(0.5);
    expect(TITLE_MUSIC.fadeOut).toBeLessThanOrEqual(1);
    expect(context.gains[0].log.at(-1)).toEqual(['ramp', 0, 10 + TITLE_MUSIC.fadeOut]);
    expect(element.paused).toBe(false); // still fading: stop() returned at once
    expect(music.state).toBe('stopped');
    await vi.advanceTimersByTimeAsync(TITLE_MUSIC.fadeOut * 1000);
    expect(element.paused).toBe(true);
    expect(element.currentTime).toBe(0);
  });

  it('a late answer to an old request never brings the music back after START', async () => {
    vi.useFakeTimers();
    const { element, music, attach } = make();
    let resolve!: () => void;
    element.play = function () { this.plays++; this.paused = false; return new Promise<void>(r => { resolve = r; }); };
    attach(); music.request(); music.stop();
    resolve(); await vi.advanceTimersByTimeAsync(1000);
    expect(music.state).toBe('stopped');
    expect(element.paused).toBe(true);
  });

  it('back on the title during the fade-out picks the music up again rather than letting it stop', async () => {
    vi.useFakeTimers();
    const { element, music, attach } = make();
    attach(); music.request(); await vi.advanceTimersByTimeAsync(0);
    music.stop();
    await vi.advanceTimersByTimeAsync(200);
    music.request(); await vi.advanceTimersByTimeAsync(2000);
    expect(element.paused).toBe(false);
    expect(music.state).toBe('playing');
  });

  it('a hidden tab pauses it and keeps the wish; visible again asks once; never revives a stopped track', async () => {
    const { element, music, attach } = make();
    attach(); music.request(); await flush();
    music.setHidden(true);
    expect(element.paused).toBe(true);
    music.setHidden(false); await flush();
    expect(element.plays).toBe(2);
    expect(music.state).toBe('playing');
    music.stop(0);
    music.setHidden(true); music.setHidden(false); await flush();
    expect(element.plays).toBe(2);
    expect(element.paused).toBe(true);
  });

  it('sits at the shared music volume, under its own gain: the AREA tracks and effects are not touched', () => {
    expect(TITLE_MUSIC.volume).toBe(MUSIC.volume);
    expect(TITLE_MUSIC.fadeIn).toBe(MUSIC.fadeIn);
    // The AREA music still asks for silence on the title: the title track is a separate owner.
    expect(musicTrack({ mode: 'title', area: 1, muted: false })).toBeNull();
  });
});

describe('the gate in the game (main.ts)', () => {
  it('asks for the title music inside the opening press, before the veil is touched', () => {
    const body = fn('passEntryGate');
    expect(body.indexOf('syncTitleMusic()')).toBeGreaterThan(-1);
    expect(body.indexOf('syncTitleMusic()')).toBeLessThan(body.indexOf('.remove()'));
    expect(body).not.toMatch(/await|setTimeout\(\(\) => syncTitleMusic|requestAnimationFrame/);
    expect(fn('syncTitleMusic')).toContain("if (mode === 'title' && entered && !audio.muted) { audio.unlock(); titleMusic.request(); }");
  });

  it('shows the gate on a fresh page only: `entered` is set once and never stored or reset', () => {
    expect(mainSource.match(/\bentered = /g)).toEqual(['entered = ', 'entered = ']);
    expect(mainSource).toContain('let entered = false;');
    expect(fn('passEntryGate')).toContain('entered = true;');
    expect(mainSource).not.toMatch(/localStorage\.setItem\([^)]*entered|sessionStorage/);
    expect(fn('showTitle')).toContain('if (!entered) closeTitleBehindGate();');
  });

  it('keeps START out of reach behind the gate: hidden, inert, and no 60ms auto-focus onto it', () => {
    expect(fn('closeTitleBehindGate')).toContain("part.inert = true;");
    expect(fn('showTitle')).toContain("setOverlay(titleMarkup(audio.muted), entered ? undefined : () => entered ? null : document.getElementById('title-gate'));");
    expect(css).toContain('.title-screen.entry .title-menu,.title-screen.entry .title-footer{visibility:hidden}');
  });

  it('installs the gate on the window before the title is shown', () => {
    const install = mainSource.indexOf('installEntryGate(window, {');
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(mainSource.indexOf('showTitle(); updateHud(scene.model);'));
  });

  it('START fades the title music beside the run: one stop, no await, the run starts as before', () => {
    const body = fn('start');
    expect(body).toContain('titleMusic.stop();');
    expect(body).not.toContain('await');
    expect(body.indexOf('scene.startRun(practice)')).toBeLessThan(body.indexOf('titleMusic.stop()'));
  });

  it('returns to the title menu with its music -- from GAME OVER, CLEAR and PAUSE alike, through showTitle', () => {
    expect(fn('showTitle')).toContain('syncTitleMusic();');
    expect(fn('showResult')).toContain("$('home').onclick = showTitle;");
    expect(fn('showClear')).toContain("$('clear-home').onclick = showTitle;");
    expect(fn('pause')).toContain("$('home').onclick = showTitle;");
  });

  it('♪ is the BGM ON/OFF: one switch, saved alone, and it stops or asks for the title music at once', () => {
    const toggle = fn('toggleSound');
    expect(toggle).toContain("localStorage.setItem(MUTED_KEY, audio.muted ? '1' : '0')");
    expect(toggle).toContain('syncTitleMusic(0.2);');
    expect(mainSource).toContain("const MUTED_KEY = 'deep-drop-muted-v1';");
    expect(mainSource).toContain("try { audio.muted = localStorage.getItem(MUTED_KEY) === '1'; } catch");
    // No second sound switch was added to the title.
    expect(titleMarkup(false).match(/<button/g)).toHaveLength(3);
    expect(mainSource.match(/localStorage\.setItem/g)).toHaveLength(2); // PERSONAL BEST and ♪, nothing else
  });

  it('follows the page into the background and back, and never retries on a press that leaves the title', () => {
    expect(mainSource).toContain('titleMusic.setHidden(document.hidden); });');
    expect(mainSource).toContain("window.addEventListener('pagehide', () => { game.loop.sleep(); titleMusic.setHidden(true); });");
    expect(mainSource).toContain("closest('.title-menu, #level-select, #title-sound, #sound')");
  });

  it('wires the title track into the same AudioContext, inside the first unlock', () => {
    expect(mainSource).toContain('audio.onUnlock = context => { music.unlock(context); titleMusic.attach(context); };');
    expect(mainSource.match(/new TitleMusic\(/g)).toHaveLength(1);
    expect(mainSource.match(/new AudioContext|new Audio\(/g)).toBeNull();
  });
});

describe('Codex A "Minimal Overlay" -- and nothing of B', () => {
  it('says PRESS ANY KEY with a keyboard, TAP TO ENTER on a phone', () => {
    expect(entryPrompt(false)).toBe('PRESS ANY KEY');
    expect(entryPrompt(true)).toBe('TAP TO ENTER');
    expect(entryGateMarkup(true).gate).toContain(`<small>${ENTRY_GATE.note}</small>`);
    expect(entryGateMarkup(false).gate).toContain('id="title-gate"');
    expect(entryGateMarkup(false).gate).toMatch(/aria-label="[^"]+"/);
  });

  it('a flat #03080b at 40%, the prompt at 72.5% breathing 1 <-> .65 over 2.8s, lifting in 180ms', () => {
    expect(css).toContain('.title-shade{position:absolute;inset:0;background:#03080b66;opacity:0;pointer-events:none;transition:opacity 180ms ease-out}');
    expect(css).toContain("top:72.5%;font:400 max(14px,calc(var(--u) * 19))/1.5 'Silkscreen'");
    expect(css).toContain('animation:title-gate-breathe 2.8s ease-in-out infinite');
    expect(css).toContain('@keyframes title-gate-breathe{0%,100%{opacity:1}50%{opacity:.65}}');
    expect(css).toContain('@media(prefers-reduced-motion:reduce){.title-gate-prompt{animation:none}}');
  });

  it('has no B element: no gradient veil, no descent mark, the logo under the veil like everything else', () => {
    const gate = Object.values(entryGateMarkup(false)).join('');
    expect(gate).not.toMatch(/descent|cinematic/);
    expect(css).not.toMatch(/title-shade[^}]*linear-gradient|cinematic|gate-descent/);
  });

  it('leaves the title it covers untouched: the same markup, the same title rules', () => {
    expect(sha256(titleMarkup(false))).toBe(sha256(titleMarkup(false, undefined)));
    const before = '.title-menu{position:absolute;left:calc(var(--u) * 66);top:calc(var(--u) * 551);width:calc(var(--u) * 318);display:flex;flex-direction:column;gap:calc(var(--u) * 12)}';
    expect(css).toContain(before);
    expect(css).toContain('.title-button.title-primary{height:calc(var(--u) * 58);border-color:#c4d3a4;background:#172a20;color:#e9eed4;font-size:calc(var(--u) * 22);font-weight:600;letter-spacing:calc(var(--u) * 3)}');
  });
});

describe('gameplay is unchanged', () => {
  it('main.ts, titleScreen.ts and style.css are 03698bd byte for byte once the gate is taken back out', () => {
    const read = (path: string) => fs.readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
    expect(sha256(withoutTitleAudioGate('main.ts', read('main.ts')))).toBe('ab6f9da4e17a0b26e5d1cac8f1d48508eb7da57f778f7ea831d7c8f034ccc258');
    expect(sha256(withoutTitleAudioGate('ui/titleScreen.ts', read('ui/titleScreen.ts')))).toBe('b663febf6c41bbc71639839a5a67a8a7f704fbad634e881413f48be4909fa7db');
    // The stylesheet only gained one block, right after the title's own reduced-motion rule.
    const start = css.indexOf('/* TITLE AUDIO ENTRY GATE');
    const end = css.indexOf('@media(prefers-reduced-motion:reduce){.title-gate-prompt{animation:none}}\n');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, end + '@media(prefers-reduced-motion:reduce){.title-gate-prompt{animation:none}}\n'.length);
    expect(sha256(css.replace(block, ''))).toBe('17516c7edeaf3f25f4a946d618d2f9d8be5b0bbae7e3f44bb9e8aa22494ddde4');
    expect(TITLE_AUDIO_GATE_NEW_FILES).toEqual(['systems/TitleMusic.ts', 'ui/entryGate.ts']);
  });

  it('every source in systems / scenes / render / data / dev is byte-identical to 03698bd (the new TitleMusic.ts aside)', () => {
    const dirs = ['systems', 'scenes', 'render', 'data', 'dev'];
    const lines: string[] = [];
    for (const dir of dirs) {
      for (const name of fs.readdirSync(new URL(`../src/${dir}/`, import.meta.url))) {
        if (dir === 'systems' && name === 'TitleMusic.ts') continue;
        lines.push(`src/${dir}/${name} ${sha256(fs.readFileSync(new URL(`../src/${dir}/${name}`, import.meta.url)))}`);
      }
    }
    lines.sort();
    expect(lines).toHaveLength(76);
    // `git ls-tree -r 03698bd` over the same five folders, each file's SHA-256, sorted, one per line.
    expect(sha256(lines.join('\n') + '\n')).toBe('7868f7cf14df609633e0b7ee13471977d9935c498860ebd841d612ddd4d43fc9');
  });
});
