import { afterEach, describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { HEALTH_RULES } from '../src/systems/HealthSystem';
import { TOTAL_SECTIONS } from '../src/data/areas';
import { UPGRADES, UPGRADE_IDS, upgrade, type UpgradeId } from '../src/data/upgrades';
import { UPGRADE_ICON_ASSETS } from '../src/data/upgradeIcons';
import { REST_KIND, upgradeCardHtml } from '../src/ui/upgradeCard';
import { heldChipHtml, restPanelHtml, type RestPanelView } from '../src/ui/restPanel';
import { installMenuKeys, MENU_REPEAT_MS } from '../src/ui/menuKeys';
import mainSource from '../src/main.ts?raw';

/**
 * REST / UPGRADE UI V1 -- the REST POINT's choice, rebuilt in the SHOP's pixel family.
 *
 * Look only. These tests hold what the rebuild must not move: the cards are the model's offer, in
 * its order, one button each and then NEXT; a card is the whole click/tap target and runs the same
 * select, NEXT the same confirm; the keyboard starts on the first card and walks the same list;
 * the catalogue, the draw and the model are byte-identical; the SHOP's markup, CSS and wiring are
 * untouched. And what it must change: no emoji anywhere (each upgrade by its own icon), held
 * upgrades as small icon chips, no text under 10px, no lime web-app buttons, no motion of its own.
 */

const { readFileSync } = await import(/* @vite-ignore */ 'node:' + 'fs') as { readFileSync: (path: URL) => Uint8Array };
const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: Uint8Array | string) => { digest: (e: string) => string } } };
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
// Read from disk: Vitest hands a stylesheet import back empty.
const styleSource = new TextDecoder().decode(readFileSync(new URL('../src/style.css', import.meta.url)));
const REST_START = styleSource.lastIndexOf('/*', styleSource.indexOf('THE REST PANEL --'));
// Its own block, which ends where the DESKTOP OUTER SHELL's begins.
const REST_END = styleSource.indexOf('/* DESKTOP OUTER SHELL');
const restCss = styleSource.slice(REST_START, REST_END);

const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>/g)].map(m => m[0]);
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
const words = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
/** Emoji and other pictographs whose look depends on the OS font. */
const PICTOGRAPH = /\p{Extended_Pictographic}|️/u;
/** Every [selector, declarations] pair, comments and @media/@container wrappers stripped. */
const rules = (css: string) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@(media|container)[^{]*\{/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .flatMap(m => m[1].split(',').map(sel => [sel.trim(), m[2]] as const));

const view = (choices: UpgradeId[], held: UpgradeId[] = [], extra: Partial<RestPanelView> = {}): RestPanelView => ({
  choices: choices.map(upgrade), held, cleared: 'SECTION 1-2', hp: 3, maxHp: 4, lifeUp: 1, lifeUpPer: 4, maxAmmo: 8,
  destination: '1-3', section: 2, sections: 12, ...extra,
});

describe('REST cards', () => {
  it('draws exactly the offered cards, in offer order, then NEXT -- and nothing else is focusable', () => {
    for (const ids of [['apple', 'timeout', 'candle'], ['reverseEngineering', 'gunpowderBlocks', 'safetyJetpack', 'youth']] as UpgradeId[][]) {
      const html = restPanelHtml(view(ids));
      expect(buttons(html).map(tag => attr(tag, 'id'))).toEqual([...ids.map((_, i) => `upgrade-${i}`), 'upgrade-confirm']);
      expect(buttons(html).slice(0, -1).map(tag => /<button[^>]*>/.exec(tag)![0]).every(tag => attr(tag, 'aria-pressed') === 'false')).toBe(true);
      // NEXT starts disabled: there is no skipping a REST.
      expect(buttons(html).at(-1)).toMatch(/\sdisabled>/);
      expect(html).not.toMatch(/<a\b|<input|<select|<textarea|tabindex/);
      for (const id of ids) expect(words(html)).toContain(`${upgrade(id).name} ${upgrade(id).short}`);
      expect(attr(html.match(/<div class="upgrade-list"[^>]*>/)![0], 'data-count')).toBe(String(ids.length));
    }
  });

  it('shows every upgrade by its own icon, as decoration, and the whole card is the button', () => {
    for (const [i, u] of UPGRADES.entries()) {
      const card = upgradeCardHtml(u, i);
      const imgs = card.match(/<img\b[^>]*>/g)!;
      expect(imgs).toHaveLength(1);
      expect([attr(imgs[0], 'src'), attr(imgs[0], 'alt'), attr(imgs[0], 'width'), attr(imgs[0], 'height'), attr(imgs[0], 'onerror')])
        .toEqual([UPGRADE_ICON_ASSETS[u.id], '', '64', '64', 'this.remove()']);
      // One button, and the icon, name, effect and mark are all inside it.
      expect(card.match(/<button\b/g)).toHaveLength(1);
      expect(card.startsWith('<button') && card.endsWith('</button>')).toBe(true);
      expect(card).toContain(`<strong>${u.name}</strong><small>${u.short}</small>`);
      expect(attr(card, 'data-kind')).toBe(REST_KIND[u.id]);
    }
    // Twenty different images for twenty upgrades.
    expect(new Set(UPGRADES.map((u, i) => attr(upgradeCardHtml(u, i).match(/<img\b[^>]*>/)![0], 'src'))).size).toBe(20);
  });

  it('never falls back to a glyph: a missing icon is an empty frame, and the name and effect stay', () => {
    for (const u of UPGRADES) {
      const bare = upgradeCardHtml(u, 0, {});
      expect(bare).toContain('<span class="upgrade-icon"></span>');
      expect(bare).not.toContain(u.icon);
      expect(words(bare)).toBe(words(upgradeCardHtml(u, 0)));
    }
    expect(restCss).toContain(".upgrade-icon:empty::before{content:'';");
  });

  it('has no emoji or other OS-font glyph anywhere: cards, held chips, heading, NEXT', () => {
    const all = restPanelHtml(view(['apple', 'drone', 'timeout', 'youth'], UPGRADE_IDS.filter(id => !['apple', 'drone', 'timeout', 'youth'].includes(id))));
    expect(all).not.toMatch(PICTOGRAPH);
    for (const u of UPGRADES) expect(all.includes(u.icon), u.id).toBe(false);
    // The old selection mark was a ○ / ✓ in the text; now CSS draws it from aria-pressed.
    expect(all).not.toMatch(/[○✓]/);
    expect(mainSource).not.toMatch(/'✓'|'○'/);
  });

  it('gives every upgrade one of four display kinds, each with its accent', () => {
    expect(Object.keys(REST_KIND).sort()).toEqual([...UPGRADE_IDS].sort());
    expect(new Set(Object.values(REST_KIND))).toEqual(new Set(['life', 'coin', 'fire', 'move']));
    for (const kind of ['life', 'coin', 'fire', 'move']) expect(restCss).toMatch(new RegExp(`\\.rest-panel \\[data-kind=${kind}\\]\\{--kind:#[0-9a-f]{6}\\}`));
  });
});

describe('REST held upgrades', () => {
  it('shows none in words, and a held upgrade as its icon only, named for assistive tech', () => {
    expect(words(restPanelHtml(view(['apple', 'candle', 'drone'])))).toContain('取得済み強化：なし');
    const chip = heldChipHtml(upgrade('drone'));
    expect(chip).toContain(`<img src="${UPGRADE_ICON_ASSETS.drone}" alt="" width="64" height="64" draggable="false" onerror="this.remove()">`);
    expect([attr(chip, 'role'), attr(chip, 'aria-label'), attr(chip, 'data-kind')]).toEqual(['img', 'DRONE', 'fire']);
    expect(words(chip)).toBe('');
  });

  it('lists what the run holds in catalogue order, one chip each, never a count', () => {
    const held: UpgradeId[] = ['timeout', 'apple', 'drone'];
    const html = restPanelHtml(view(['candle', 'youth', 'gemSick'], held));
    const chips = [...html.matchAll(/<span class="rest-held"[^>]*aria-label="([^"]+)"/g)].map(m => m[1]);
    expect(chips).toEqual(['APPLE', 'DRONE', 'TIMEOUT']);
    const strip = html.slice(html.indexOf('owned-upgrades'), html.indexOf('<div class="upgrade-list"'));
    expect(words(strip.slice(strip.indexOf('>') + 1))).toBe('取得済み');
  });

  it('fits eleven held upgrades -- the most a REST can show -- without a scroller', () => {
    const held = UPGRADE_IDS.slice(0, 11);
    const html = restPanelHtml(view(UPGRADE_IDS.slice(11, 14), held));
    expect(html.match(/class="rest-held"/g)).toHaveLength(11);
    const strip = rules(restCss).filter(([sel]) => /owned-upgrades|rest-held/.test(sel)).map(([, decl]) => decl).join(';');
    expect(strip).toMatch(/flex-wrap:wrap/);
    expect(strip).not.toMatch(/overflow|max-height/);
  });
});

describe('REST heading and numbers', () => {
  it('keeps every number the panel showed before, and the section line', () => {
    const text = words(restPanelHtml(view(['apple', 'candle', 'drone'], [], { cleared: 'SECTION 4-3', destination: 'FINAL BOSS', section: 12 })));
    for (const s of ['SECTION 4-3 CLEAR / REST POINT', 'REST / CHOOSE ONE', '安全地帯 · HPの自動回復はありません', 'HP 3 / 4', 'MAX HP 4', 'LIFE UP 1 / 4', '弾数上限 8', 'NEXT FINAL BOSS', 'SECTION 12 / 12', '1つ選んでNEXTで確定。選択中は時間が停止します。', 'NEXT · 選択してください']) expect(text).toContain(s);
    expect(restPanelHtml(view(['apple'])).match(/<h2\b/g)).toHaveLength(1);
    expect(restPanelHtml(view(['apple']))).toContain('aria-labelledby="rest-title"');
  });
});

// ---------------------------------------------------------------------------------------------
// main.ts, executed: showUpgrade's own lines against a real GameModel and a fake page.

interface FakeElement { id: string; disabled: boolean; hidden: boolean; offsetParent: object; textContent: string; attrs: Record<string, string>; onclick: null | (() => void); focus: () => void; setAttribute: (n: string, v: string) => void; getAttribute: (n: string) => string | null; removeAttribute: (n: string) => void }

const slice = (from: string, to: string) => {
  const start = mainSource.indexOf(from), end = mainSource.indexOf(to, start);
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
  return mainSource.slice(start, end);
};
const UPGRADE_JS = slice('function showUpgrade(model: GameModel) {', '/** Short, non-blocking phase card.').replace(/\(model: GameModel\)/g, '(model)');
const MENU_OPEN_JS = slice('const menuOpen = () =>', '\n');
const MENU_KEYS_JS = slice('installMenuKeys({', '\n});') + '\n});';

let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });

function page() {
  let elements: FakeElement[] = [];
  let active: FakeElement | null = null;
  let timers: (() => void)[] = [];
  const make = (id: string, disabled = false): FakeElement => {
    const e: FakeElement = {
      id, disabled, hidden: false, offsetParent: {}, textContent: '', attrs: {}, onclick: null,
      focus: () => { if (!e.disabled && elements.includes(e)) active = e; },
      setAttribute: (n, v) => { e.attrs[n] = v; },
      getAttribute: n => e.attrs[n] ?? null,
      removeAttribute: n => { delete e.attrs[n]; if (n === 'disabled') e.disabled = false; },
    };
    return e;
  };
  const statics = ['run-status', 'selection-summary'].map(id => make(id));
  const overlay = {
    hidden: true, html: '',
    querySelector: (selector: string) => selector === 'button' ? elements.find(e => /^upgrade-/.test(e.id)) ?? null : null,
    querySelectorAll: () => elements.filter(e => /^upgrade-/.test(e.id)),
  };
  const byId = (id: string) => elements.find(e => e.id === id) ?? statics.find(e => e.id === id) ?? null;
  const setOverlay = (content: string, focus?: () => FakeElement | null) => {
    overlay.html = content;
    elements = buttons(content).map(tag => {
      const b = make(attr(tag, 'id')!, /\sdisabled\b/.test(tag));
      b.attrs['aria-pressed'] = attr(tag, 'aria-pressed') ?? '';
      return b;
    });
    if (active && !elements.includes(active)) active = null;
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
  const main = new Function('setOverlay', 'overlay', 'document', 'restPanelHtml', 'installMenuKeys', 'HEALTH_RULES', 'TOTAL_SECTIONS', 'calls', `
    let mode = 'playing', lastHud = '';
    const bridge = { active: true };
    const audio = { unlock: () => calls.push('unlock'), play: s => calls.push('play:' + s) };
    const clearInput = () => calls.push('clearInput');
    const updateHud = () => calls.push('updateHud');
    const resumeInput = () => calls.push('resumeInput');
    const closeShop = () => calls.push('closeShop');
    const $ = id => id === 'overlay' ? overlay : document.getElementById(id);
    let scene;
    ${UPGRADE_JS}
    ${MENU_OPEN_JS}
    ${MENU_KEYS_JS}
    return {
      open: model => { scene = { model }; showUpgrade(model); },
      get mode() { return mode; },
      get bridgeActive() { return bridge.active; },
    };
  `)(setOverlay, overlay, { getElementById: byId }, restPanelHtml, installMenuKeys, HEALTH_RULES, TOTAL_SECTIONS, calls) as { open: (g: GameModel) => void; readonly mode: string; readonly bridgeActive: boolean };
  const flush = () => { const run = timers; timers = []; run.forEach(t => t()); return active?.id ?? 'BODY'; };
  const key = (code: string) => {
    now += MENU_REPEAT_MS;
    const event = new Event('keydown', { cancelable: true });
    Object.defineProperty(event, 'code', { value: code });
    win.dispatchEvent(event);
    return active?.id ?? 'BODY';
  };
  /** ENTER / SPACE on a focused button, a mouse click and a tap all reach the same onclick. */
  const press = (id: string) => { const b = byId(id)!; if (!b.disabled) b.onclick?.(); };
  const focused = () => active?.id ?? 'BODY';
  return { main, flush, key, press, byId, overlay, calls, focused };
}

/** A run standing at a REST POINT after 1-2, with what it holds and what it is offered fixed. */
function atRest(held: UpgradeId[] = [], seed = 7) {
  const g = new GameModel(false, seeded(seed));
  g.jumpToStage(1, 2);
  for (const id of held) g.upgrades.grant(id);
  expect(g.completeSection()).toBe(true);
  expect(g.state).toBe('upgrade');
  return g;
}
/** Everything about the run the panel could conceivably touch. */
const snapshot = (g: GameModel) => JSON.stringify({
  state: g.state, choices: g.upgrades.choices.map(u => u.id), held: g.upgrades.acquired, selected: g.upgrades.selectedId, section: g.upgrades.sectionId,
  hp: g.hp, maxHp: g.health.maxHp, overflow: g.health.overflowHealing, stats: g.stats, ammo: g.ammo, label: g.stage.label, depth: g.completedDepth,
});

describe('REST in main.ts: the same choice, the same keys', () => {
  it('draws the model\'s own offer and holdings, and drawing it changes nothing in the run', () => {
    const g = atRest(['apple', 'drone']);
    const before = snapshot(g);
    const p = page();
    p.main.open(g);
    expect(snapshot(g)).toBe(before);
    expect(p.main.mode).toBe('upgrade');
    expect(p.main.bridgeActive).toBe(false);
    expect(p.overlay.html).toBe(restPanelHtml({
      choices: g.upgrades.choices, held: g.upgrades.acquired, cleared: 'SECTION 1-2', destination: '1-3',
      hp: g.hp, maxHp: g.health.maxHp, lifeUp: g.health.overflowHealing, lifeUpPer: HEALTH_RULES.overflowPerLife,
      maxAmmo: g.stats.maxAmmo, section: 2, sections: TOTAL_SECTIONS,
    }));
    expect(g.upgrades.choices).toHaveLength(3);
    expect(p.byId('run-status')!.textContent).toBe('REST / SAFE ZONE');
  });

  it('opens on the first card; arrows and WASD walk the cards and wrap; ESC does nothing', () => {
    const p = page();
    p.main.open(atRest());
    expect(p.flush()).toBe('upgrade-0');
    expect(['ArrowDown', 'ArrowDown', 'ArrowDown', 'KeyW', 'ArrowUp', 'KeyS'].map(p.key))
      .toEqual(['upgrade-1', 'upgrade-2', 'upgrade-0', 'upgrade-2', 'upgrade-1', 'upgrade-2']);
    p.key('Escape');
    expect(p.focused()).toBe('upgrade-2');
    expect(p.calls).not.toContain('closeShop');
  });

  it('a card (click, tap, ENTER or SPACE) selects through the model, marks itself and hands focus to NEXT', () => {
    const g = atRest();
    const p = page();
    p.main.open(g);
    p.flush();
    const offer = g.upgrades.choices.map(u => u.id);
    p.press('upgrade-1');
    expect(g.upgrades.selectedId).toBe(offer[1]);
    expect(g.state).toBe('upgrade');
    expect(['upgrade-0', 'upgrade-1', 'upgrade-2'].map(id => p.byId(id)!.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(p.byId('upgrade-confirm')!.disabled).toBe(false);
    expect(p.byId('upgrade-confirm')!.textContent).toBe('NEXT · 確定して進む');
    expect(p.byId('selection-summary')!.textContent).toBe(`${upgrade(offer[1]).name}を選択中 · NEXTで確定`);
    expect(p.focused()).toBe('upgrade-confirm');
    // Changing one's mind is a second card, not a cancel.
    p.press('upgrade-2');
    expect(g.upgrades.selectedId).toBe(offer[2]);
    expect(['upgrade-0', 'upgrade-1', 'upgrade-2'].map(id => p.byId(id)!.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
    // NEXT is now part of the walk.
    expect(p.key('ArrowDown')).toBe('upgrade-0');
    expect(p.key('ArrowUp')).toBe('upgrade-confirm');
  });

  it('NEXT confirms exactly the chosen card and resumes the run, as before', () => {
    const g = atRest(['candle']);
    const p = page();
    p.main.open(g);
    p.flush();
    p.press('upgrade-confirm');
    expect(g.state).toBe('upgrade');
    const pick = g.upgrades.choices[0].id;
    p.press('upgrade-0');
    p.press('upgrade-confirm');
    expect(g.upgrades.acquired).toEqual(['candle', pick]);
    expect(g.state).toBe('playing');
    expect(g.stage.label).toBe('1-3');
    expect(p.main.mode).toBe('playing');
    expect(p.overlay.hidden).toBe(true);
    expect(p.calls).toEqual(expect.arrayContaining(['unlock', 'play:upgrade', 'resumeInput']));
  });

  it('four cards after YOUTH, the same way', () => {
    const g = atRest(['youth']);
    const p = page();
    p.main.open(g);
    expect(buttons(p.overlay.html).map(tag => attr(tag, 'id'))).toEqual(['upgrade-0', 'upgrade-1', 'upgrade-2', 'upgrade-3', 'upgrade-confirm']);
    expect(p.flush()).toBe('upgrade-0');
    expect(['ArrowUp', 'ArrowUp'].map(p.key)).toEqual(['upgrade-3', 'upgrade-2']);
  });

  it('keeps the confirm path and the focus hand-off word for word', () => {
    expect(UPGRADE_JS).toContain("mode = 'upgrade'; bridge.active = false; clearInput();");
    expect(UPGRADE_JS).toContain('if (!model.selectUpgrade(u.id)) return;');
    expect(UPGRADE_JS).toContain("$('upgrade-confirm').focus({ preventScroll: true });");
    expect(UPGRADE_JS).toContain(`  $('upgrade-confirm').onclick = () => {
    if (!model.confirmUpgrade()) return;
    audio.unlock(); audio.play('upgrade');
    // A boss hand-off keeps the panel up for one frame; the 'boss' event opens the FINAL BOSS screen.
    if (model.state !== 'playing') return;
    mode = 'playing'; clearInput(); setOverlay(''); lastHud = ''; updateHud(model);
    $('run-status').textContent = 'DESCENT IN PROGRESS'; resumeInput();
  };`);
    // No focus target of its own: the overlay's first button, which is the first card.
    expect(UPGRADE_JS).toMatch(/setOverlay\(restPanelHtml\(\{[\s\S]*?\}\)\);/);
  });
});

describe('REST rebuild leaves the game and the SHOP alone', () => {
  it('keeps the catalogue, the draw, the icon mapping and the SHOP sources byte-identical to 1914f6a', () => {
    const SOURCES = import.meta.glob(['../src/data/upgrades.ts', '../src/systems/UpgradeSystem.ts', '../src/data/upgradeIcons.ts', '../src/ui/shopPanel.ts', '../src/data/shopIcons.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.fromEntries(Object.entries(SOURCES).map(([path, text]) => [path.replace('../src/', ''), sha256(text)]))).toEqual({
      'data/upgrades.ts': '60cb529a5fbb0de2455d5d49898cd221d8860bf9dce8f4173e88f198c79f373e',
      'systems/UpgradeSystem.ts': '1bd63f6652e12af2c232864d8c45026a500104d7bd01fe740f0e3ec617d843c3',
      'data/upgradeIcons.ts': 'ebf29f03dbd724d8b63ee29857c1c71cbe62c09387988d8e78d294e2c171ddaf',
      'ui/shopPanel.ts': '34be9d695b4fe6eae2b219d2a41eb7b6f1e501dabb9cfa1babba13c1f08337da',
      'data/shopIcons.ts': 'f9f773dc8014ba791c1e2903ecab2480ffaf6097b7e9a87a948225ffcd588894',
    });
  });

  it('keeps main.ts\'s SHOP, overlay, SECTION CLEAR and menu-key code byte-identical to 1914f6a', () => {
    expect({
      shop: sha256(slice('function showShop(', '/** A short, non-blocking card.')),
      setOverlay: sha256(slice('function setOverlay(', '/** Announces the SECTION')),
      sectionClear: sha256(slice('function showSectionClear(', 'function showUpgrade(')),
      menuKeys: sha256(slice('installMenuKeys({', '\n});')),
    }).toEqual({
      shop: '317e57946ccf85b94d58bbc98677bf19279b5403349842c5a587225641a0c038',
      setOverlay: '3523cabd643ca2e25c3a9376c341cf28d5b04f161ebb39d52650275795bb2c0d',
      sectionClear: 'b54cf654f75153649229c9e63a7a3059ff09f276e55aa56f216d47bc39d66d25',
      menuKeys: '14b4bbd6eb67cfa1d0b738502621ff804bdfcfcb021bc5159e565c8fc876638e',
    });
  });

  it('keeps the SHOP CSS block byte-identical to 1914f6a', () => {
    expect(sha256(styleSource.slice(styleSource.indexOf('THE SHOP PANEL'), styleSource.indexOf('NIMUSHI\'s voice')))).toBe('ac4c9bcb3b0232d61e74a016639c246006dbde8385601fab0ccf273913ae47fa');
  });
});

describe('REST panel CSS', () => {
  const restRules = rules(restCss);

  it('owns every upgrade-card rule: the old lime cards are gone from the rest of the sheet', () => {
    const outside = rules(styleSource.slice(0, REST_START) + styleSource.slice(REST_END));
    expect(outside.filter(([sel]) => /upgrade-|rest-stats|owned-upgrades|rest-panel|rest-held/.test(sel))).toEqual([]);
    expect(restRules.filter(([sel]) => sel.includes('.upgrade-card')).length).toBeGreaterThanOrEqual(10);
  });

  it('is the SHOP family: Silkscreen names, no lime, no Barlow Condensed, no image but the icons', () => {
    expect(restCss).not.toMatch(/--lime|#b9ef70|Barlow/);
    expect(restCss).not.toMatch(/url\(/);
    expect(restCss).toMatch(/\.upgrade-card strong\{font-family:'Silkscreen'/);
    expect(restCss).toMatch(/\.rest-panel \.rest-title\{font-family:'Silkscreen'/);
  });

  it('has no text under 10px', () => {
    const sizes = [...restCss.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(8);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(10);
  });

  it('moves nothing on its own, and a press keeps the card\'s box where it is', () => {
    expect(restCss.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/animation|@keyframes|transition|transform|scale\(|filter:/);
    const pressed = restRules.filter(([sel]) => sel.includes(':active'));
    expect(pressed.length).toBeGreaterThanOrEqual(4);
    for (const [sel, decl] of pressed) if (decl.includes('padding-top')) expect({ sel, decl }).toMatchObject({ decl: expect.stringMatching(/padding-bottom/) });
    // The card's sink is 1px: padding-top one more and padding-bottom one less than its resting rule.
    const px = (decl: string, prop: string) => Number(new RegExp(`${prop}:(\\d+)px`).exec(decl)?.[1]);
    expect(restRules.filter(([sel]) => sel === '.upgrade-card:active').map(([, d]) => px(d, 'padding-top') - px(d, 'padding-bottom'))).toEqual([2, 2, 2]);
  });

  it('shows a focus frame for the keyboard only, and hover only on a pointer that can hover', () => {
    expect(restCss).toContain('.rest-panel button:focus-visible{outline:none}');
    for (const sel of ['.upgrade-card:focus-visible', '.rest-next:focus-visible']) expect(restRules.some(([s, d]) => s === sel && /box-shadow:0 0 0 2px #04080a,0 0 0 4px var\(--rest-brass-hi\)/.test(d))).toBe(true);
    expect(restRules.some(([sel]) => /:focus(?!-visible)/.test(sel))).toBe(false);
    const hoverBlock = restCss.slice(restCss.indexOf('@media(hover:hover){'), restCss.indexOf('}\n}', restCss.indexOf('@media(hover:hover){')));
    expect(hoverBlock).toContain('.upgrade-card:hover');
    expect(restCss.replace(hoverBlock, '')).not.toMatch(/:hover/);
  });

  it('dims the HUD only while the REST panel is in the overlay, and leaves the SECTION CLEAR card alone', () => {
    expect(restCss).toContain('#game-frame:has(>.overlay>.rest-panel)>.hud{opacity:.35}');
    expect(restRules.filter(([sel, decl]) => /\.hud\b/.test(sel) && /opacity/.test(decl)).map(([sel]) => sel)).toEqual(['#game-frame:has(>.overlay>.rest-panel)>.hud']);
    // Every overlay rule here is keyed on the panel being present.
    for (const [sel] of restRules.filter(([s]) => s.includes('.overlay'))) expect(sel).toContain(':has(>');
    expect(styleSource).toContain('.overlay.rest-overlay{background:#101b1af7;overflow-y:auto;align-items:safe center;touch-action:pan-y;padding:20px 24px}');
  });

  it('lays out for phones and short windows by the frame, not the window', () => {
    expect(restCss).toContain('.overlay.rest-overlay:has(>.rest-panel){container:rest/size;');
    expect(restCss).toContain('@container rest (max-width:419px) or (max-height:719px){');
    expect(restCss).toContain('@container rest (max-height:619px){');
    // Four cards on a short frame get smaller wells rather than a fourth card below the fold.
    expect(restCss).toMatch(/\.upgrade-list\[data-count="4"\] \.upgrade-icon\{width:44px;height:44px\}/);
    // NEXT and the heading never shrink away; only the card list may scroll, inside the panel.
    for (const sel of ['.rest-next', '.rest-head', '.rest-panel .upgrade-note']) expect(restRules.some(([s, d]) => s === sel && d.includes('flex:none'))).toBe(true);
    expect(restRules.find(([s]) => s === '.rest-panel .upgrade-list')![1]).toMatch(/min-height:0;overflow-y:auto/);
    // Touch: the controls are hidden by the overlay (setOverlay, unchanged), and a card is at least 44px tall.
    expect(mainSource).toContain("$('touch-controls').hidden = !!content;");
    expect(restCss).toContain('.upgrade-card>*,.upgrade-card img{pointer-events:none;');
  });
});
