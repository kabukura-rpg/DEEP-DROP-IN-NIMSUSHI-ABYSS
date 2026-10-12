import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { previewSideCave } from '../src/dev/sideCavePreview';
import mainSource from '../src/main.ts?raw';

/**
 * STAGING SHOP CLOSE -- the run's mode after the SHOP closes.
 *
 * The model has always known where a shelf was opened from (GameModel.shopReturn: 'boss' from THE
 * ABYSS staging doorway, 'playing' from a SIDE CAVE) and restores it in closeShop(). main.ts's own
 * closeShop() predated the staging shop and always set its mode to 'playing', so after the staging
 * shelf the model said 'boss' and the UI said 'playing' until the 'boss' event re-synced them.
 *
 * The fix reads the model's state after it has closed the shelf. These tests run main.ts's real
 * closeShop() -- its source, unchanged -- against a real GameModel, with the DOM calls stubbed.
 */

const STEP = 1 / 120;

/** main.ts's closeShop(), executed: what `mode` becomes and which UI calls it makes. */
function mainCloseShop() {
  const start = mainSource.indexOf('function closeShop(model: GameModel) {');
  const end = mainSource.indexOf('/** A short, non-blocking card.', start);
  expect(start).toBeGreaterThan(0);
  const js = mainSource.slice(start, end).replace('(model: GameModel)', '(model)');
  return new Function(`
    let mode = 'shop', lastHud = 'stale';
    const calls = [];
    const clearInput = () => calls.push('clearInput');
    const setOverlay = content => calls.push('setOverlay:' + content);
    const updateHud = () => calls.push('updateHud');
    const resumeInput = () => calls.push('resumeInput');
    ${js}
    return model => { mode = 'shop'; lastHud = 'stale'; calls.length = 0; closeShop(model); return { mode, calls: [...calls], lastHud }; };
  `)() as (model: GameModel) => { mode: string; calls: string[]; lastHud: string };
}

/** Step until the shelf opens, collecting every event the model raised on the way. */
function walkInto(g: GameModel, x: number, y: number) {
  const events: string[] = [];
  g.player.x = x; g.player.y = y; g.player.vx = 0; g.player.vy = 0; g.player.invincible = 99;
  for (let i = 0; i < 240 && g.state !== 'shop'; i++) { g.step(STEP, 0, false); events.push(...g.events.splice(0).map(e => e.type)); }
  return events;
}

/** A run standing in THE ABYSS staging room, the way main.ts sees it: mode 'boss'. */
function staging() {
  const g = new GameModel(false);
  g.safeZoneVisitCount = 1;
  g.jumpToBoss();
  g.events.length = 0;
  expect(g.state).toBe('boss');
  expect(g.abyssStage).toBe('staging');
  return g;
}
const openStagingShop = (g: GameModel) => {
  const e = g.shop.entrance!;
  const events = walkInto(g, e.x + e.width / 2, e.y + e.height - 16);
  expect(g.state).toBe('shop');
  return events;
};

/** A SIDE CAVE SHOP in an ordinary SECTION: mode 'playing'. */
function sideCave() {
  const g = new GameModel(false);
  g.jumpToStage(1, 2);
  previewSideCave(g, 'shop-right');
  g.events.length = 0;
  expect(g.state).toBe('playing');
  return g;
}
const openCaveShop = (g: GameModel) => {
  const d = g.shopDoor(g.caves[0]);
  walkInto(g, d.x + d.width / 2, d.y + d.height - 16);
  expect(g.state).toBe('shop');
};

/** Gameplay events that must never come from closing a shelf. */
const BOSS_EVENTS = ['boss', 'bossStart', 'bossPhase', 'abyss', 'seal', 'gravityFlip', 'tomato', 'section', 'upgrade'];

describe('STAGING SHOP close restores the run\'s mode from the model', () => {
  const closeShop = mainCloseShop();

  it('A. SIDE CAVE: playing -> SHOP -> playing, exactly as before', () => {
    const g = sideCave();
    openCaveShop(g);
    const after = closeShop(g);
    expect(after.mode).toBe('playing');
    expect(g.state).toBe('playing');
    expect(g.shop.open).toBe(false);
    expect(after.calls).toEqual(['clearInput', 'setOverlay:', 'updateHud', 'resumeInput']);
  });

  it('B. STAGING: boss -> SHOP -> boss, still in the staging room', () => {
    const g = staging();
    openStagingShop(g);
    const after = closeShop(g);
    expect({ mode: after.mode, state: g.state, stage: g.abyssStage }).toEqual({ mode: 'boss', state: 'boss', stage: 'staging' });
    expect(g.shop.open).toBe(false);
  });

  it('C. STAGING: a purchase then close keeps the purchase and returns to boss', () => {
    const g = staging();
    g.coins.award(9000);
    openStagingShop(g);
    const offer = g.shop.offers.find(o => o.item === 'battery') ?? g.shop.offers[0];
    const index = g.shop.offers.indexOf(offer);
    const wallet = g.coins.walletCoins, score = g.coins.scoreCoins;
    const before = { hp: g.hp, overflow: g.health.overflowHealing, maxHp: g.health.maxHp, maxAmmo: g.stats.maxAmmo };
    expect(g.buyShopItem(index)).toBe('bought');
    expect(g.coins.walletCoins).toBe(wallet - offer.price);
    expect(g.coins.scoreCoins).toBe(score);
    expect(g.shop.offers[index].sold).toBe(true);
    const after = { hp: g.hp, overflow: g.health.overflowHealing, maxHp: g.health.maxHp, maxAmmo: g.stats.maxAmmo };
    expect(after).not.toEqual(before);
    const closed = closeShop(g);
    expect({ mode: closed.mode, state: g.state }).toEqual({ mode: 'boss', state: 'boss' });
    expect(g.coins.walletCoins).toBe(wallet - offer.price);
    expect(g.shop.offers[index].sold).toBe(true);
  });

  it('D/E. ESCAPE and the 立ち去る button both close through this one closeShop', () => {
    // ESCAPE: the menu keys' cancel, only while the SHOP is up.
    expect(mainSource).toContain("cancel: () => {\n    if (mode !== 'shop') return false;\n    closeShop(scene.model);\n    return true;\n  },");
    // The button: the very same function, with the model the panel was drawn from.
    expect(mainSource).toContain("$('shop-close').onclick = () => closeShop(model);");
    expect(mainSource.match(/closeShop\(/g)).toHaveLength(4); // the definition, model.closeShop(), ESC, button
    for (const via of ['escape', 'button']) {
      const g = staging();
      openStagingShop(g);
      expect({ via, mode: closeShop(g).mode, state: g.state }).toEqual({ via, mode: 'boss', state: 'boss' });
    }
  });

  it('changes nothing when the model has no shelf to close', () => {
    const g = staging();
    const after = closeShop(g);
    expect(after).toEqual({ mode: 'shop', calls: [], lastHud: 'stale' });
    expect(g.state).toBe('boss');
  });

  it('is a mode sync only: no boss, phase, seal or abyss event, no screen of its own', () => {
    const g = staging();
    const opening = openStagingShop(g);
    expect(opening.filter(t => BOSS_EVENTS.includes(t))).toEqual([]);
    const closed = closeShop(g);
    // Only the four calls it always made: no showBoss, showBossPhase, toast or music cue.
    expect(closed.calls).toEqual(['clearInput', 'setOverlay:', 'updateHud', 'resumeInput']);
    const body = mainSource.slice(mainSource.indexOf('function closeShop('), mainSource.indexOf('/** A short, non-blocking card.'));
    expect(body).not.toMatch(/showBoss|showAbyss|showToast|music\.|audio\.|events\.push|boss\.start/);
    // Standing still in the staging room afterwards raises nothing either.
    const later: string[] = [];
    for (let i = 0; i < 240; i++) { g.step(STEP, 0, false); later.push(...g.events.splice(0).map(e => e.type)); }
    expect(later.filter(t => BOSS_EVENTS.includes(t))).toEqual([]);
    expect({ state: g.state, stage: g.abyssStage, started: g.boss.started }).toEqual({ state: 'boss', stage: 'staging', started: false });
  });
});
