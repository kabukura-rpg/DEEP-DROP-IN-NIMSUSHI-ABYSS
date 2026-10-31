import { expect, vi } from 'vitest';
import { transformSync } from 'esbuild';
// @ts-expect-error -- Phaser's own keyboard internals ship without declarations; these are the 3.90 files the game runs.
import KeyboardPlugin from 'phaser/src/input/keyboard/KeyboardPlugin.js';
// @ts-expect-error -- as above.
import Key from 'phaser/src/input/keyboard/keys/Key.js';
import { GameModel } from '../src/systems/GameModel';
import { InputBuffer } from '../src/systems/InputBuffer';
import { shopFocusTarget, shopPanelHtml } from '../src/ui/shopPanel';
import sceneSource from '../src/scenes/GameScene.ts?raw';
import mainSource from '../src/main.ts?raw';
import { withoutInputCancelFix } from './inputCancelRestore';

/**
 * THE INPUT PIPELINE, executed: the browser's key / pointer events -> Phaser 3.90's real KeyboardPlugin and Key ->
 * GameScene's own SPACE listener, requestShot, resetKeys, update loop and dispatchEvents -> main.ts's own
 * clearInput / resumeInput / pause / resume / REST / SHOP / ABYSS / BOSS / CLEAR / GAME OVER / start / title lines and
 * its FIRE-button pointer handlers -> GameModel.step. Every one of those is the source text, sliced and run, not a
 * paraphrase; only the DOM, the renderer, audio and the clock are fakes.
 *
 * `variant: 'baseline'` runs the same slices with the input-cancellation fix reversed (tests/inputCancelRestore.ts),
 * which is dae7a93 byte for byte -- so a baseline/candidate pair differs in exactly the fix and nothing else.
 *
 * Three kinds of thing happen in a trace and are kept apart:
 *   - `input`:   what a user did (keydown / keyup / OS auto-repeat / pointerdown / up / cancel / clicks on overlay
 *                buttons, window blur);
 *   - `fixture`: state the test put in place (seeded model, completeSection, a SHOP doorway, finish) -- labelled;
 *   - `step`:    GameModel.step calls made by the scene's own loop, with what each one was given and saw.
 */

const between = (text: string, from: string, to: string) => {
  const a = text.indexOf(from), b = text.indexOf(to, a + from.length);
  expect(a, from).toBeGreaterThanOrEqual(0); expect(b, to).toBeGreaterThan(a);
  return text.slice(a, b);
};
const compile = (ts: string) => transformSync(ts.replace(/import\.meta\.env\.DEV/g, 'false'), { loader: 'ts' }).code;

export type Variant = 'baseline' | 'candidate';
const KEY_CODES = { SPACE: 32, LEFT: 37, RIGHT: 39, A: 65, D: 68 } as const;
type KeyName = keyof typeof KEY_CODES;

/** GameScene's input methods, from the source as it is (candidate) or with the fix reversed (baseline). */
function sceneMethods(variant: Variant) {
  const src = variant === 'candidate' ? sceneSource : withoutInputCancelFix('scenes/GameScene.ts', sceneSource);
  const listeners = between(src, "    this.input.keyboard!.on('keydown-SPACE'", '    this.draw();\n  }\n  startRun(');
  const methods = [
    between(src, '  private get acceptsKeys()', '  requestShot()'),
    between(src, '  requestShot()', '  resetKeys()'),
    between(src, '  resetKeys()', '  update(_time'),
    between(src, '  update(_time: number, delta: number) {', '  private dispatchEvents() {'),
    between(src, '  private dispatchEvents() {', '  private effect('),
  ].map(m => m.replace(/^ {2}private /, '  ')).join('');
  return new Function(`${compile(`const __scene = class {\n  installKeys() {\n${listeners}  }\n${methods}};`)}\nreturn __scene.prototype;`)() as object;
}

/** main.ts's own lines for the input boundary and every screen that calls it. */
function mainProgram() {
  const POINTER_CLEAR = '  if (content) { movementPointers.clear(); firePointers.clear(); syncPointers(); }';
  expect(mainSource).toContain(POINTER_CLEAR);
  const router = mainSource.split('\n').filter(l => /^ {4}if \(event\.type === '(shopOpen|upgrade|abyss|boss|clear|over)'\)/.test(l));
  expect(router).toHaveLength(6);
  const parts = [
    between(mainSource, 'const isPlayMode = ', 'const inPlay = () => isPlayMode(mode);') + 'const inPlay = () => isPlayMode(mode);\n',
    between(mainSource, 'function clearInput()', '/** True while an overlay menu is up'),
    between(mainSource, 'function start(practice = false) {', '/**\n * DEVELOPMENT ONLY: start a run'),
    between(mainSource, 'function showTitle() {', "  $('side-best')") + '}\n',
    between(mainSource, "let pausedFrom: 'playing' | 'boss' = 'playing';", '/** A short, skippable SECTION CLEAR'),
    between(mainSource, 'let bannerTimer: number | undefined;', '/** Short, non-blocking phase card.'),
    between(mainSource, 'function showShop(model: GameModel) {', '/** A short, non-blocking card.'),
    between(mainSource, 'function showAbyss(model: GameModel) {', 'function updateHud('),
    between(mainSource, "window.addEventListener('blur'", '// AREA BGM:'),
    between(mainSource, 'const movementPointers = new Map<number, number>();', "/**\n * iOS SAFARI'S DOUBLE-TAP ZOOM."),
    between(mainSource, "const frame = $('game-frame');", '/**\n * The ENTRY GATE'),
  ];
  const ts = `function __main() {
    let mode = 'title', lastHud = '', warpedRun = false, best = 0, comboAnimation, physicsPanel, overlayContent = '';
    const ready = true;
    function setOverlay(content, focus) {
      overlayContent = content; $('overlay').hidden = !content;
    ${POINTER_CLEAR}
      scene.captureKeys(!content);
    }
    ${parts.join('\n')}
    bridge.onEvent = (event, model) => {
    ${router.join('\n')}
    };
    return {
      start, pause, resume, showTitle, clearInput,
      get mode() { return mode; }, get overlay() { return overlayContent; },
      firePointers,
    };
  }`;
  return `${compile(ts)}\nreturn __main();`;
}

interface FakeEl {
  id: string; hidden: boolean; textContent: string; innerHTML: string; onclick: null | (() => void);
  listeners: Record<string, ((e: unknown) => void)[]>;
  dispatch(type: string, e: unknown): void;
  [k: string]: unknown;
}
function element(id: string): FakeEl {
  const listeners: FakeEl['listeners'] = {};
  return {
    id, hidden: false, textContent: '', innerHTML: '', onclick: null, listeners, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, toggleAttribute() {}, focus() {},
    querySelectorAll: () => [], querySelector: () => null,
    getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
    animate: () => ({ cancel() {}, onfinish: null }),
    setPointerCapture() {},
    addEventListener(type: string, fn: (e: unknown) => void) { (listeners[type] ??= []).push(fn); },
    removeEventListener(type: string, fn: (e: unknown) => void) { listeners[type] = (listeners[type] ?? []).filter(f => f !== fn); },
    dispatch(type: string, e: unknown) { for (const fn of [...(listeners[type] ?? [])]) fn(e); },
  };
}

export interface TraceRow { t: number; kind: 'input' | 'fixture' | 'step' | 'event'; what: string; [k: string]: unknown }
export interface Snapshot {
  x: number; y: number; vx: number; vy: number; grounded: number; hp: number; ammo: number; fuel: number; jetpack: boolean;
  score: number; combo: number; bullets: string; state: string; stage: string; abyss: string; gravity: number; upgrades: string;
  boss: string; elapsed: number;
}

export interface PipelineOptions { variant: Variant; seed?: number; held?: string[]; autoRepeat?: { delay: number; rate: number } }

/**
 * A page running one variant. `frame()` advances the clock one display frame (Phaser processes the queued key events,
 * then GameScene.update runs), timers fire, and OS auto-repeat is generated for any key physically down.
 */
export function pipeline(opts: PipelineOptions) {
  const { variant } = opts;
  const autoRepeat = opts.autoRepeat ?? { delay: 300, rate: 33 };
  let now = 10_000, seq = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const trace: TraceRow[] = [];
  const log = (kind: TraceRow['kind'], what: string, extra: Record<string, unknown> = {}) => trace.push({ t: Math.round(now * 1000) / 1000, kind, what, ...extra });

  // --- the page ---------------------------------------------------------------------------------
  const els = new Map<string, FakeEl>();
  const $ = (id: string) => { let e = els.get(id); if (!e) els.set(id, e = element(id)); return e; };
  let timers: { at: number; id: number; fn: () => void }[] = [];
  let timerId = 0;
  const win = Object.assign(element('window'), {
    setTimeout: (fn: () => void, ms = 0) => { timers.push({ at: now + ms, id: ++timerId, fn }); return timerId; },
    clearTimeout: (id: number) => { timers = timers.filter(t => t.id !== id); },
    matchMedia: () => ({ matches: true }),
  });
  const doc = Object.assign(element('document'), { hidden: false, getElementById: (id: string) => $(id) });

  // --- Phaser's keyboard, the real plugin code on a minimal host ---------------------------------
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const kb = {
    manager: { queue: [] as Record<string, unknown>[] },
    keys: [] as unknown[],
    prevCode: null as number | null, prevTime: 0, prevType: null as string | null,
    isActive: () => true,
    on(name: string, fn: (e: unknown) => void) { (listeners.get(name) ?? listeners.set(name, []).get(name)!).push(fn); return kb; },
    emit(name: string, e: unknown) { for (const fn of listeners.get(name) ?? []) fn(e); return true; },
    resetKeys() { return KeyboardPlugin.prototype.resetKeys.call(kb); },
    process() { KeyboardPlugin.prototype.update.call(kb); kb.manager.queue.length = 0; },
  };
  for (const code of Object.values(KEY_CODES)) kb.keys[code] = new Key(kb, code);
  const keys = { left: kb.keys[37], right: kb.keys[39], a: kb.keys[65], d: kb.keys[68], space: kb.keys[32] } as Record<string, { isDown: boolean }>;

  // --- GameScene ----------------------------------------------------------------------------------
  const bridge = { direction: 0, firing: false, active: false, suppressUntil: 0, onFrame() {}, onEvent: (_e: unknown, _m: GameModel) => {} };
  const makeModel = (practice = false) => {
    let s = opts.seed ?? 7;
    const m = new GameModel(practice, () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; });
    for (const id of opts.held ?? []) m.upgrades.grant(id as never);
    if (opts.held?.length) (m as unknown as { syncUpgrades: () => void }).syncUpgrades();
    // dae7a93 has no cancelAction: the baseline model is the same class with the one added method doing nothing.
    if (variant === 'baseline') (m as unknown as { cancelAction: () => void }).cancelAction = () => {};
    return m;
  };
  const stepsSeen: { firing: boolean; pressed: boolean; heldBefore: boolean }[] = [];
  const scene = Object.assign(Object.create(sceneMethods(variant)), {
    graphics: {}, hurtAge: 0, freeze: 0, accumulator: 0, particles: [], labels: [], flash: 0, shake: 0,
    draw() {}, effect() {}, captureKeys() {},
    bridge, keys, inputBuffer: new InputBuffer(), input: { keyboard: kb },
    model: makeModel(),
    startRun(practice = false) { this.model = makeModel(practice); this.accumulator = 0; this.particles = []; this.freeze = 0; this.labels = []; this.inputBuffer.clear(); instrument(this.model); },
  }) as {
    model: GameModel; inputBuffer: InputBuffer; installKeys(): void; update(t: number, d: number): void; resetKeys(): void;
    startRun(p?: boolean): void;
  };
  scene.installKeys();
  const held = (m: GameModel) => (m as unknown as { actionHeld: boolean }).actionHeld;
  function instrument(m: GameModel) {
    const step = m.step.bind(m);
    m.step = (dt: number, direction: number, firing: boolean) => {
      const before = held(m), grounded = m.player.grounded, bossLine = !!m.bossLine;
      step(dt, direction, firing);
      // The model's own edge: this step sampled ACTION (a stopped or reversing world does not) and found it new.
      const pressed = !before && held(m);
      stepsSeen.push({ firing, pressed, heldBefore: before });
      if (pressed) log('step', 'pressed', { grounded, bossLine });
    };
  }
  instrument(scene.model);

  // --- main.ts ------------------------------------------------------------------------------------
  const stubHtml = (name: string) => () => `<div>${name}</div>`;
  const main = new Function(
    '$', 'window', 'document', 'performance', 'scene', 'bridge', 'audio', 'updateHud', 'titleMusic', 'fadeOutTitle',
    'restPanelHtml', 'pausePanelHtml', 'clearPanelHtml', 'gameOverPanelHtml', 'shopPanelHtml', 'shopFocusTarget',
    'HEALTH_RULES', 'TOTAL_SECTIONS', 'recordBest', 'damageLabel', 'showToast', 'showBossPhase', 'music', 'location', 'navigator',
    mainProgram(),
  )(
    $, win, doc, performance, scene, bridge, { unlock() {}, play() {} }, () => {}, { stop() {} }, () => {},
    stubHtml('rest'), stubHtml('pause'), stubHtml('clear'), stubHtml('over'), shopPanelHtml, shopFocusTarget,
    { overflowPerLife: 1 }, 12, () => {}, () => '', () => {}, () => {}, { cue() {} }, { href: 'x' }, {},
  ) as { start(p?: boolean): void; pause(): void; resume(): void; showTitle(): void; clearInput(): void; readonly mode: string; readonly overlay: string; firePointers: Set<number> };

  const route = bridge.onEvent;
  bridge.onEvent = (e, m) => { log('event', (e as { type: string }).type); route(e, m); };

  // --- the user -----------------------------------------------------------------------------------
  const physical = new Map<KeyName, { since: number; repeats: number }>();
  const keyEvent = (type: 'keydown' | 'keyup', name: KeyName, repeat: boolean) => {
    const e = { type, keyCode: KEY_CODES[name], code: name === 'SPACE' ? 'Space' : name, key: name === 'SPACE' ? ' ' : name, timeStamp: now + (++seq) * 1e-4, repeat, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false, location: 0, preventDefault() {} };
    kb.manager.queue.push(e);
    win.dispatch(type, e);
  };
  const down = (name: KeyName = 'SPACE') => { expect(physical.has(name), `${name} already down`).toBe(false); physical.set(name, { since: now, repeats: 0 }); log('input', `keydown ${name}`); keyEvent('keydown', name, false); };
  const up = (name: KeyName = 'SPACE') => { expect(physical.has(name), `${name} not down`).toBe(true); physical.delete(name); log('input', `keyup ${name}`); keyEvent('keyup', name, false); };
  /** The key is let go while the page has no focus: the browser delivers no keyup at all. */
  const loseKeyup = (name: KeyName = 'SPACE') => { physical.delete(name); log('input', `${name} released unfocused (no keyup delivered)`); };
  const pointerEvent = (pointerId: number) => ({ pointerId, pointerType: 'touch', clientX: 0, clientY: 0, target: $('fire-control'), preventDefault() {} });
  const touch = {
    down(id: number) { log('input', `pointerdown FIRE #${id}`); $('fire-control').dispatch('pointerdown', pointerEvent(id)); },
    up(id: number) { log('input', `pointerup FIRE #${id}`); $('fire-control').dispatch('pointerup', pointerEvent(id)); },
    cancel(id: number) { log('input', `pointercancel FIRE #${id}`); $('fire-control').dispatch('pointercancel', pointerEvent(id)); },
    lost(id: number) { log('input', `lostpointercapture FIRE #${id}`); $('fire-control').dispatch('lostpointercapture', pointerEvent(id)); },
    /** A captured finger dragged anywhere, off the viewport included: the FIRE button has no move handler at all. */
    move(id: number) { log('input', `pointermove FIRE #${id} (off-screen)`); $('fire-control').dispatch('pointermove', { ...pointerEvent(id), clientX: -500, clientY: 4000 }); },
  };
  const click = (id: string) => { const b = $(id); log('input', `click #${id}`); expect(b.onclick, `#${id} has a handler`).toBeTypeOf('function'); b.onclick!(); };

  const FRAME_MS = 1000 / 60;
  /** One display frame: OS repeats and timers due in it, then Phaser's input update, then the scene. */
  function frame(ms = FRAME_MS) {
    now += ms;
    for (const [name, k] of physical) {
      while (now >= k.since + autoRepeat.delay + k.repeats * autoRepeat.rate) { k.repeats++; keyEvent('keydown', name, true); }
    }
    for (const t of timers.filter(t => t.at <= now)) { timers = timers.filter(x => x !== t); t.fn(); }
    kb.process();
    const before = stepsSeen.length;
    scene.update(now, ms);
    return stepsSeen.slice(before);
  }
  const frames = (n: number, ms?: number) => { const out: ReturnType<typeof frame> = []; for (let i = 0; i < n; i++) out.push(...frame(ms)); return out; };
  /** Advance without the scene running a frame (a renderer that has not woken yet). OS repeats still queue. */
  const idle = (ms: number) => { now += ms; };
  const fixture = (what: string, fn: (m: GameModel) => void) => { log('fixture', what); fn(scene.model); };

  const snapshot = (): Snapshot => {
    const m = scene.model, p = m.player;
    return {
      x: p.x, y: p.y, vx: p.vx, vy: p.vy, grounded: p.grounded, hp: m.hp, ammo: m.ammo, fuel: m.jetpackFuel, jetpack: m.jetpackActive,
      score: m.score, combo: m.combo, bullets: m.bullets.map(b => `${b.x.toFixed(3)},${b.y.toFixed(3)},${b.vy.toFixed(3)}`).join(';'),
      state: m.state, stage: m.stage.label, abyss: m.abyssStage, gravity: m.gravitySign, upgrades: m.upgrades.acquired.join(','),
      boss: m.boss.enabled ? `${m.boss.hp}|${m.boss.phaseId}` : '-', elapsed: m.elapsed,
    };
  };
  /** What each layer believes about ACTION right now. */
  const layers = () => ({
    physical: physical.has('SPACE'), phaserSpace: keys.space.isDown, buffer: scene.inputBuffer.firing,
    bridgeFiring: bridge.firing, touches: main.firePointers.size, actionHeld: held(scene.model), active: bridge.active, mode: main.mode,
  });

  return {
    main, scene, bridge, trace, log, down, up, loseKeyup, touch, click, frame, frames, idle, fixture, snapshot, layers, $, win,
    get model() { return scene.model; },
    get now() { return now; },
    held: () => held(scene.model),
    /** Jumps off the floor the model announced (its 'jump' event), counted from trace row `from`. */
    jumps: (from = 0) => trace.slice(from).filter(r => r.kind === 'event' && r.what === 'jump').length,
    /** Fresh presses the model saw (any consumer: jump, wall kick, a skipped line, a gun press in the air). */
    presses: (from = 0) => trace.slice(from).filter(r => r.kind === 'step' && r.what === 'pressed').length,
    /** Steps run since `mark`, and how many of them saw a fresh press. */
    stepsSince: (mark: number) => stepsSeen.slice(mark),
    get stepCount() { return stepsSeen.length; },
    FRAME_MS,
  };
}
export type Pipeline = ReturnType<typeof pipeline>;
