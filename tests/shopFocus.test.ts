import { afterEach, describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { previewSideCave } from '../src/dev/sideCavePreview';
import { shopFocusSlot, shopFocusTarget, shopPanelHtml } from '../src/ui/shopPanel';
import { installMenuKeys, MENU_REPEAT_MS } from '../src/ui/menuKeys';
import mainSource from '../src/main.ts?raw';

/**
 * SHOP KEYBOARD FOCUS -- where the keyboard is after the shelf is drawn.
 *
 * Two bugs from the SHOP audit (ac4bd7c, still in 5c740b3): the overlay focused its first button
 * whether or not it could be bought, and a disabled one cannot take focus, so a shelf whose first
 * good was sold or too dear left the focus on BODY; and a purchase redraws the whole panel, so the
 * keyboard went back to the top (or to BODY) instead of staying where the player was.
 *
 * The rule now, by slot index only: open on the first good that can be bought; after buying slot N
 * go to the next buyable slot after N, wrapping to the front; with nothing buyable, `shop-close`.
 *
 * The DOM tests run main.ts's real showShop / closeShop / ESC wiring -- its source, unchanged --
 * against a real GameModel, with the overlay replaced by a list of fake buttons parsed from the
 * very markup shopPanelHtml produced. `flush()` stands in for the 60ms focus timer.
 */

const STEP = 1 / 120;

describe('shopFocusSlot: which slot the keyboard lands on', () => {
  it('opens on the first good that can be bought', () => {
    expect(shopFocusSlot([true, true, true])).toBe(0);    // 1. first item enabled
    expect(shopFocusSlot([false, true, true])).toBe(1);   // 2. first item disabled
    expect(shopFocusSlot([false, false, true])).toBe(2);  // 3. first two disabled
    expect(shopFocusSlot([false, false, false])).toBe(-1); // 4. all disabled -> shop-close
  });

  it('after a purchase, goes on to the next buyable slot, then wraps to the front', () => {
    expect(shopFocusSlot([false, true, true], 0)).toBe(1);   // 5. buy slot0
    expect(shopFocusSlot([true, false, true], 1)).toBe(2);   // 6. buy slot1
    expect(shopFocusSlot([true, true, false], 2)).toBe(0);   // 7. buy the last slot -> wrap
    expect(shopFocusSlot([true, false, false], 1)).toBe(0);  // 8. only an earlier good remains
    expect(shopFocusSlot([false, true, false], 2)).toBe(1);  //    ...and it is the one just before
    expect(shopFocusSlot([false, false, false], 1)).toBe(-1); // 9. nothing left -> shop-close
  });

  it('skips past a disabled slot after the purchase rather than stopping at it', () => {
    expect(shopFocusSlot([false, false, true], 0)).toBe(2);
    expect(shopFocusSlot([true, false, false], 0)).toBe(0); // the bought slot is disabled now, but say it were not
  });

  it('copes with an empty shelf', () => {
    expect(shopFocusSlot([])).toBe(-1);
    expect(shopFocusSlot([], 0)).toBe(-1);
  });
});

describe('shopFocusTarget reads the drawn buttons by id', () => {
  const root = (buttons: Record<string, boolean>) => ({
    querySelector: (selector: string) => {
      const id = selector.replace(/^#/, '');
      return id in buttons ? { id, disabled: buttons[id] } : null;
    },
  }) as unknown as ParentNode;

  it('returns shop-buy-N or shop-close, never a missing slot', () => {
    const r = root({ 'shop-buy-0': true, 'shop-buy-1': false, 'shop-buy-2': false, 'shop-close': false });
    expect((shopFocusTarget(r, 3) as unknown as { id: string }).id).toBe('shop-buy-1');
    expect((shopFocusTarget(r, 3, 1) as unknown as { id: string }).id).toBe('shop-buy-2');
    // A slot whose button is not there counts as not buyable.
    expect((shopFocusTarget(root({ 'shop-close': false }), 3) as unknown as { id: string }).id).toBe('shop-close');
  });
});

// ---------------------------------------------------------------------------------------------
// main.ts, executed.

interface FakeButton { id: string; disabled: boolean; hidden: boolean; offsetParent: object; onclick: null | (() => void); focus: () => void }

const slice = (from: string, to: string) => {
  const start = mainSource.indexOf(from), end = mainSource.indexOf(to, start);
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
  return mainSource.slice(start, end);
};
// showShop + closeShop, the menu-open test and the ESC wiring: main.ts's own lines.
const SHOP_JS = slice('function showShop(model: GameModel) {', '/** A short, non-blocking card.').replace(/\(model: GameModel\)/g, '(model)');
const MENU_OPEN_JS = slice('const menuOpen = () =>', '\n');
const MENU_KEYS_JS = slice('installMenuKeys({', '\n});') + '\n});';
// The overlay's focus timer, as main.ts schedules it. The fake below runs this same expression.
const FOCUS_TIMER = "if (content) window.setTimeout(() => (focus ? focus() : $('overlay').querySelector<HTMLButtonElement>('button'))?.focus({ preventScroll: true }), 60);";

let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });

/** The page, faked: an overlay of buttons, the focused one, window keydown, and the 60ms timer. */
function page() {
  expect(mainSource).toContain(FOCUS_TIMER);
  let buttons: FakeButton[] = [];
  let active: FakeButton | null = null;
  let timers: (() => void)[] = [];
  const byId = (id: string) => buttons.find(b => b.id === id) ?? null;
  const overlay = {
    hidden: true,
    querySelector: (selector: string) => selector === 'button' ? buttons[0] ?? null : byId(selector.replace(/^#/, '')),
    querySelectorAll: () => buttons,
  };
  const setOverlay = (content: string, focus?: () => FakeButton | null) => {
    // innerHTML: the old buttons, the focused one included, are gone.
    buttons = [...content.matchAll(/<button([^>]*)>/g)].map(([, attrs]) => {
      const b: FakeButton = { id: /id="([^"]+)"/.exec(attrs)![1], disabled: /\sdisabled\b/.test(attrs), hidden: false, offsetParent: {}, onclick: null, focus: () => { if (!b.disabled && buttons.includes(b)) active = b; } };
      return b;
    });
    if (active && !buttons.includes(active)) active = null;
    overlay.hidden = !content;
    if (content) timers.push(() => (focus ? focus() : overlay.querySelector('button'))?.focus());
  };
  const win = new EventTarget();
  const g = globalThis as unknown as { window?: unknown; document?: unknown };
  const saved = { window: g.window, document: g.document };
  g.window = win;
  g.document = { get activeElement() { return active; } };
  let now = 1000;
  const realNow = performance.now.bind(performance);
  performance.now = () => now;
  restore = () => { g.window = saved.window; g.document = saved.document; performance.now = realNow; };

  const calls: string[] = [];
  const main = new Function('setOverlay', 'overlay', 'document', 'shopPanelHtml', 'shopFocusTarget', 'installMenuKeys', 'calls', `
    let mode = 'playing', lastHud = '';
    const bridge = { active: true };
    const audio = { unlock: () => calls.push('unlock') };
    const clearInput = () => calls.push('clearInput');
    const updateHud = () => calls.push('updateHud');
    const resumeInput = () => calls.push('resumeInput');
    const $ = id => id === 'overlay' ? overlay : document.getElementById(id);
    let scene;
    ${SHOP_JS}
    ${MENU_OPEN_JS}
    ${MENU_KEYS_JS}
    return {
      open: (model, from) => { scene = { model }; mode = from; showShop(model); },
      get mode() { return mode; },
    };
  `)(setOverlay, overlay, { getElementById: byId }, shopPanelHtml, shopFocusTarget, installMenuKeys, calls) as { open: (g: GameModel, from: string) => void; readonly mode: string };

  /** Let the 60ms focus timer(s) run, and say where the focus ended up. */
  const flush = () => { const run = timers; timers = []; run.forEach(t => t()); return active?.id ?? 'BODY'; };
  const key = (code: string) => {
    now += MENU_REPEAT_MS;
    const event = new Event('keydown', { cancelable: true });
    Object.defineProperty(event, 'code', { value: code });
    win.dispatchEvent(event);
  };
  /** ENTER / SPACE on a focused button, and a mouse click or a tap, all reach the same onclick. */
  const press = (id: string) => { const b = byId(id)!; if (!b.disabled) b.onclick?.(); };
  return { main, flush, key, press, byId, overlay, calls, get buttons() { return buttons; } };
}

/** Step until the shelf opens. */
function walkInto(g: GameModel, x: number, y: number) {
  g.player.x = x; g.player.y = y; g.player.vx = 0; g.player.vy = 0; g.player.invincible = 99;
  for (let i = 0; i < 240 && g.state !== 'shop'; i++) { g.step(STEP, 0, false); g.events.length = 0; }
  expect(g.state).toBe('shop');
}
function caveShop() {
  const g = new GameModel(false);
  g.jumpToStage(1, 2);
  previewSideCave(g, 'shop-right');
  const d = g.shopDoor(g.caves[0]);
  walkInto(g, d.x + d.width / 2, d.y + d.height - 16);
  return g;
}
function stagingShop() {
  const g = new GameModel(false);
  g.safeZoneVisitCount = 1;
  g.jumpToBoss();
  expect(g.abyssStage).toBe('staging');
  const e = g.shop.entrance!;
  walkInto(g, e.x + e.width / 2, e.y + e.height - 16);
  return g;
}
/** Price the three goods and fill the wallet, so which ones can be bought is exactly what a case needs. */
function stock(g: GameModel, wallet: number, prices: number[], sold: boolean[] = [false, false, false]) {
  expect(g.shop.offers).toHaveLength(3);
  g.shop.offers.forEach((o, i) => { o.price = prices[i]; o.sold = sold[i]; });
  g.coins.walletCoins = wallet;
}
const states = (p: ReturnType<typeof page>) => p.buttons.filter(b => b.id.startsWith('shop-buy-')).map(b => b.disabled);

describe('SHOP open: the keyboard starts on something it can use', () => {
  it.each([
    ['1. all three buyable', [100, 100, 100], [false, false, false], 'shop-buy-0'],
    ['2. slot0 too dear', [5000, 100, 100], [false, false, false], 'shop-buy-1'],
    ['2. slot0 SOLD OUT', [100, 100, 100], [true, false, false], 'shop-buy-1'],
    ['3. first two disabled', [5000, 100, 100], [false, true, false], 'shop-buy-2'],
    ['4. all disabled', [5000, 5000, 100], [false, false, true], 'shop-close'],
  ] as const)('%s', (_, prices, sold, want) => {
    const p = page();
    const g = caveShop();
    stock(g, 1000, [...prices], [...sold]);
    p.main.open(g, 'playing');
    expect(p.flush()).toBe(want);
  });

  it('every other screen still starts on its first button', () => {
    expect(mainSource.match(/setOverlay\([^)]/g)!.length).toBeGreaterThan(5);
    // Only the SHOP passes a focus target.
    expect(mainSource.match(/shopFocusTarget\(/g)).toHaveLength(1);
  });
});

describe('SHOP purchase: the redraw keeps the keyboard where it was', () => {
  it('5-7. buy slot0 -> slot1, buy slot1 -> slot2, buy slot2 -> wraps to slot0', () => {
    const p = page();
    const g = caveShop();
    stock(g, 1000, [100, 100, 100]);
    p.main.open(g, 'playing');
    expect(p.flush()).toBe('shop-buy-0');
    p.press('shop-buy-0');
    expect(p.flush()).toBe('shop-buy-1');
    p.press('shop-buy-1');
    expect(p.flush()).toBe('shop-buy-2');
    // Make slot0 buyable again (a fresh offer in the same slot), so the wrap has somewhere to go.
    g.shop.offers[0].sold = false;
    p.press('shop-buy-2');
    expect(states(p)).toEqual([false, true, true]);
    expect(p.flush()).toBe('shop-buy-0');
  });

  it('6. buy slot1 with slot2 buyable -> slot2', () => {
    const p = page();
    const g = caveShop();
    stock(g, 1000, [100, 100, 100]);
    p.main.open(g, 'playing'); p.flush();
    p.press('shop-buy-1');
    expect(p.flush()).toBe('shop-buy-2');
  });

  it('8. only an earlier good remains -> it', () => {
    const p = page();
    const g = caveShop();
    stock(g, 1000, [100, 100, 5000]);
    p.main.open(g, 'playing'); p.flush();
    p.press('shop-buy-1');
    expect(states(p)).toEqual([false, true, true]);
    expect(p.flush()).toBe('shop-buy-0');
  });

  it('9. the purchase leaves nothing buyable -> shop-close', () => {
    const p = page();
    const g = caveShop();
    stock(g, 300, [300, 300, 300]);
    p.main.open(g, 'playing'); p.flush();
    p.press('shop-buy-0');
    expect(g.coins.walletCoins).toBe(0);
    expect(states(p)).toEqual([true, true, true]);
    expect(p.flush()).toBe('shop-close');
  });

  it('a press that buys nothing does not redraw or move the focus', () => {
    const p = page();
    const g = caveShop();
    stock(g, 1000, [100, 100, 100]);
    p.main.open(g, 'playing'); p.flush();
    g.coins.walletCoins = 0; // the model refuses; the panel still shows it as buyable
    const before = p.buttons;
    p.byId('shop-buy-0')!.onclick!();
    expect(p.buttons).toBe(before);
    expect(p.flush()).toBe('shop-buy-0');
  });
});

describe('menu keys are unchanged around the new focus', () => {
  it('from shop-close the arrows/WASD wrap into the buyable goods, skipping disabled ones', () => {
    const p = page();
    const g = caveShop();
    stock(g, 1000, [5000, 100, 5000]);
    p.main.open(g, 'playing');
    expect(p.flush()).toBe('shop-buy-1');
    p.key('ArrowDown'); expect(p.flush()).toBe('shop-close');
    p.key('ArrowDown'); expect(p.flush()).toBe('shop-buy-1');
    p.key('KeyW'); expect(p.flush()).toBe('shop-close');
    p.key('KeyA'); expect(p.flush()).toBe('shop-buy-1');
    p.key('ArrowRight'); p.key('KeyD'); expect(p.flush()).toBe('shop-buy-1');
  });

  it('with everything disabled the focus stays on shop-close', () => {
    const p = page();
    const g = caveShop();
    stock(g, 0, [100, 100, 100]);
    p.main.open(g, 'playing');
    expect(p.flush()).toBe('shop-close');
    p.key('ArrowDown'); p.key('ArrowUp'); p.key('KeyS');
    expect(p.flush()).toBe('shop-close');
  });
});

describe('closing after the new focus', () => {
  it.each(['shop-buy-0', 'shop-buy-1', 'shop-buy-2', 'shop-close'])('12. ESC closes with the focus on %s', target => {
    const p = page();
    const g = caveShop();
    stock(g, 1000, [100, 100, 100]);
    p.main.open(g, 'playing'); p.flush();
    while (p.flush() !== target) p.key('ArrowDown');
    p.key('Escape');
    expect({ state: g.state, mode: p.main.mode, overlayHidden: p.overlay.hidden }).toEqual({ state: 'playing', mode: 'playing', overlayHidden: true });
  });

  it('10. SIDE CAVE: buy with the keyboard, close -> model playing, main playing', () => {
    const p = page();
    const g = caveShop();
    stock(g, 300, [300, 100, 5000]);
    p.main.open(g, 'playing');
    expect(p.flush()).toBe('shop-buy-0');
    p.press('shop-buy-0');
    expect(p.flush()).toBe('shop-close');
    p.press('shop-close');
    expect({ state: g.state, mode: p.main.mode, open: g.shop.open }).toEqual({ state: 'playing', mode: 'playing', open: false });
  });

  it.each(['button', 'escape'])('11. STAGING: buy with the keyboard, close by %s -> model boss, main boss', how => {
    const p = page();
    const g = stagingShop();
    stock(g, 1000, [5000, 100, 100]);
    p.main.open(g, 'boss');
    expect(p.flush()).toBe('shop-buy-1');
    p.press('shop-buy-1');
    expect(p.flush()).toBe('shop-buy-2');
    if (how === 'button') p.press('shop-close'); else p.key('Escape');
    expect({ state: g.state, stage: g.abyssStage, mode: p.main.mode }).toEqual({ state: 'boss', stage: 'staging', mode: 'boss' });
  });
});
