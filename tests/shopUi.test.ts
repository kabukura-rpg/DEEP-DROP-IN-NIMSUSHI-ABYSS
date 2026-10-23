import { describe, expect, it } from 'vitest';
import { SHOP_ITEMS, SHOP_RULES, rollShopStock, shopItem, type ShopItemId, type ShopOffer } from '../src/data/shop';
import { SHOP_COIN_ASSET, SHOP_COIN_FILE, SHOP_ICON_ASSETS, SHOP_ICON_FILES, shopIcon } from '../src/data/shopIcons';
import { shopCardHtml, shopKind, shopPanelHtml } from '../src/ui/shopPanel';
import { GameModel } from '../src/systems/GameModel';
import mainSource from '../src/main.ts?raw';

/**
 * SHOP UI v1 -- MINIMAL PIXEL SHOP. The six goods' icons and the SHOP coin from
 * output/shop-ui-icons-v1 (runtime/, byte for byte), drawn into the one SHOP overlay that every SHOP
 * shares: a SIDE CAVE's in AREA 1-4 and THE ABYSS staging doorway's.
 *
 * Look only. The shelf, its prices, the wallet, what a purchase does and how the panel is driven --
 * mouse, touch, ENTER/SPACE, the arrow keys, ESCAPE, where focus starts and where it goes after a
 * purchase -- are pinned below to what they were at ac4bd7c. The three focus faults found by the
 * SHOP UI audit stay as they are here, on purpose: they belong to a separate change.
 */

const { readFileSync, readdirSync } = await import(/* @vite-ignore */ 'node:' + 'fs') as { readFileSync: (path: URL) => Uint8Array; readdirSync: (path: URL) => string[] };
const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: Uint8Array | string) => { digest: (e: string) => string } } };
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
// Read from disk: Vitest hands a stylesheet import back empty.
const styleSource = new TextDecoder().decode(readFileSync(new URL('../src/style.css', import.meta.url)));
const STEP = 1 / 120;

const dir = new URL('../src/assets/shop/', import.meta.url);
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const png = (name: string) => {
  const b = readFileSync(new URL(name, dir));
  return { size: [u32(b, 16), u32(b, 20)], depth: b[24], colour: b[25], sha256: sha256(b) };
};

// From output/shop-ui-icons-v1/validation.json (assets[].sha256 / dimensions), checked against both zips.
const DELIVERED: Record<string, { sha256: string; size: [number, number] }> = {
  'shop-rice-ball.png': { sha256: 'cb619b4bbd15c9d09c553a8b7c9fa7b767ce14715039279fb35d398c57a74127', size: [24, 24] },
  'shop-sushi.png': { sha256: '67388304dd9d32b8fc8753c75d1cce8fad9e9840d032b720b3d3b3c82bb89b2c', size: [24, 24] },
  'shop-battery.png': { sha256: '297265999c27b2b1fa1125b27e0081a5fcb64bca41862d94b89d1384aeb45005', size: [24, 24] },
  'shop-car-battery.png': { sha256: '503fb1efd044ba72187d82058ce867df32c7c296bbbbd572acfba86fd951f376', size: [24, 24] },
  'shop-energy-drink.png': { sha256: 'a073f1ae9cf7db02e4c75e759305c9adc2e635a600e69c5e9dc6444b5e12bb82', size: [24, 24] },
  'shop-curry.png': { sha256: 'c362e136b5307a3414c6809311929e6ef06af61a4f275e0e9aef4c884f135f92', size: [24, 24] },
  'shop-coin.png': { sha256: 'a3ba220acc4856e37ec406739cf59401b61ea1e6ce78e9b965bc5fe78a2bae0c', size: [12, 12] },
};

const IDS = SHOP_ITEMS.map(item => item.id);
const offer = (item: ShopItemId, price: number, sold = false, index = 0): ShopOffer =>
  ({ id: `shop-${index}`, item, name: shopItem(item).name, effect: shopItem(item).effect, price, sold });
/** The `<button ...>` opening tags of a panel, in document order. */
const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>/g)].map(m => m[0]);
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
/** The visible words of a fragment: tags gone, whitespace collapsed. */
const words = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('SHOP UI assets', () => {
  it('ships exactly the seven delivered PNGs, byte for byte', () => {
    expect(readdirSync(dir).sort()).toEqual(Object.keys(DELIVERED).sort());
    for (const [name, want] of Object.entries(DELIVERED)) {
      const got = png(name);
      expect({ name, sha256: got.sha256 }).toEqual({ name, sha256: want.sha256 });
      expect({ name, size: got.size, depth: got.depth, colour: got.colour }).toEqual({ name, size: want.size, depth: 8, colour: 6 });
    }
  });

  it('maps every ShopItemId to its own icon, one to one, with none left over', () => {
    expect(Object.keys(SHOP_ICON_FILES).sort()).toEqual([...IDS].sort());
    expect(IDS).toHaveLength(6);
    const files = Object.values(SHOP_ICON_FILES);
    expect(new Set(files).size).toBe(6);
    // Every delivered good icon is used, and the only other file is the coin.
    expect([...files, SHOP_COIN_FILE].sort()).toEqual(Object.keys(DELIVERED).sort());
    expect(SHOP_ICON_FILES).toEqual({
      riceBall: 'shop-rice-ball.png', sushi: 'shop-sushi.png', battery: 'shop-battery.png',
      carBattery: 'shop-car-battery.png', energyDrink: 'shop-energy-drink.png', curry: 'shop-curry.png',
    });
  });

  it('resolves every icon and the coin to a shipped URL, and never to another good\'s', () => {
    const urls = IDS.map(id => SHOP_ICON_ASSETS[id]);
    for (const [i, id] of IDS.entries()) {
      expect(urls[i], id).toBeTruthy();
      expect(shopIcon(id)).toBe(urls[i]);
    }
    expect(new Set(urls).size).toBe(6);
    expect(SHOP_COIN_ASSET).toBeTruthy();
    expect(urls).not.toContain(SHOP_COIN_ASSET);
    // A missing file is a missing icon -- no substitute from the rest of the shelf.
    for (const id of IDS) {
      expect(shopIcon(id, {})).toBeNull();
      expect(shopIcon(id, { ...SHOP_ICON_ASSETS, [id]: null })).toBeNull();
    }
  });
});

describe('SHOP panel markup', () => {
  const shelf = [offer('riceBall', 300, false, 0), offer('battery', 150, false, 1), offer('curry', 1000, false, 2)];
  const html = shopPanelHtml({ offers: shelf, walletCoins: 600, scoreCoins: 600 });

  it('keeps the ids, the order and nothing else focusable: shop-buy-0..2, then shop-close', () => {
    expect(buttons(html).map(tag => attr(tag, 'id'))).toEqual(['shop-buy-0', 'shop-buy-1', 'shop-buy-2', 'shop-close']);
    // No link, input or tabindex that the menu keys or the initial focus could land on instead.
    expect(html).not.toMatch(/<a\b|<input|<select|<textarea|tabindex/);
  });

  it('disables a good exactly when it is sold or the wallet is short, as before', () => {
    for (const wallet of [0, 149, 150, 299, 300, 999, 1000, 5000]) for (const sold of [false, true]) {
      for (const [i, o] of shelf.entries()) {
        const tag = buttons(shopCardHtml({ ...o, sold }, i, wallet))[0];
        const disabled = / disabled[ >]/.test(tag) || /\sdisabled$/.test(tag.slice(0, -1));
        expect({ wallet, sold, item: o.item, disabled }).toEqual({ wallet, sold, item: o.item, disabled: sold || wallet < o.price });
        expect(attr(tag, 'data-state')).toBe(sold ? 'sold' : wallet >= o.price ? 'ready' : 'short');
      }
    }
  });

  it('shows each good its own 48px icon and the 12px coin, as decoration', () => {
    for (const [i, id] of IDS.entries()) {
      const card = shopCardHtml(offer(id, 100, false, i), i, 600);
      const imgs = [...card.matchAll(/<img\b[^>]*>/g)].map(m => m[0]);
      expect(imgs).toHaveLength(2);
      expect(attr(imgs[0], 'src')).toBe(SHOP_ICON_ASSETS[id]);
      expect([attr(imgs[0], 'width'), attr(imgs[0], 'height'), attr(imgs[0], 'alt')]).toEqual(['48', '48', '']);
      expect(attr(imgs[1], 'src')).toBe(SHOP_COIN_ASSET);
      expect([attr(imgs[1], 'width'), attr(imgs[1], 'height'), attr(imgs[1], 'alt')]).toEqual(['12', '12', '']);
      for (const img of imgs) expect(attr(img, 'onerror')).toBe('this.remove()');
    }
    const purse = html.slice(html.indexOf('shop-purse'), html.indexOf('shop-list'));
    const coin = purse.match(/<img\b[^>]*>/)![0];
    expect([attr(coin, 'src'), attr(coin, 'width'), attr(coin, 'height'), attr(coin, 'alt')]).toEqual([SHOP_COIN_ASSET, '24', '24', '']);
  });

  it('says the same things: kind, name, effect, price, wallet and SCORE', () => {
    for (const [i, o] of shelf.entries()) {
      const text = words(shopCardHtml(o, i, 600));
      expect(text).toContain(shopKind(o));
      expect(text).toContain(o.name);
      expect(text).toContain(o.effect);
      expect(text).toContain(`${o.price} COIN`);
    }
    expect(words(shopCardHtml(shelf[2], 2, 600))).toContain('不足');
    expect(words(shopCardHtml({ ...shelf[0], sold: true }, 0, 600))).toContain('SOLD OUT');
    expect(words(html)).toContain('所持 600 COIN SCORE 600（購入しても減りません）');
    // One heading, not an eyebrow saying SHOP above an h2 saying SHOP.
    expect(html.match(/<h2\b/g)).toHaveLength(1);
    expect(html).not.toContain('eyebrow');
    expect(words(html).match(/SHOP/g)).toHaveLength(1);
  });

  it('colours the four kinds and keeps their words', () => {
    const kinds = Object.fromEntries(IDS.map(id => [id, shopKind(offer(id, 1))]));
    expect(kinds).toEqual({ riceBall: 'LIFE', sushi: 'LIFE', battery: 'CHARGE', carBattery: 'CHARGE', energyDrink: 'LIFE + CHARGE', curry: 'MAX LIFE' });
    const kindTag = (id: ShopItemId) => shopCardHtml(offer(id, 1), 0, 9).match(/<span class="shop-kind">(.*?)<\/span>/)![1];
    expect(kindTag('riceBall')).toBe('<i class="k-life">LIFE</i>');
    expect(kindTag('battery')).toBe('<i class="k-charge">CHARGE</i>');
    expect(kindTag('energyDrink')).toBe('<i class="k-life">LIFE</i> + <i class="k-charge">CHARGE</i>');
    expect(kindTag('curry')).toBe('<i class="k-max">MAX LIFE</i>');
  });

  it('still works with no images at all: every button, name, effect and price stays, COIN in words', () => {
    const bare = shopPanelHtml({ offers: shelf, walletCoins: 600, scoreCoins: 600 }, { icons: {}, coin: null });
    expect(bare).not.toContain('<img');
    expect(buttons(bare).map(tag => [attr(tag, 'id'), / disabled/.test(tag)])).toEqual(buttons(html).map(tag => [attr(tag, 'id'), / disabled/.test(tag)]));
    expect(words(bare)).toBe(words(html));
    for (const o of shelf) for (const s of [o.name, o.effect, `${o.price} COIN`]) expect(words(bare)).toContain(s);
    // The CSS keeps the slot and brings the word back when an image is absent or removed by onerror.
    expect(styleSource).toContain('.shop-icon:empty::before');
    expect(styleSource).toContain('.shop-coin:empty~.shop-unit{position:static');
  });
});

describe('SHOP panel CSS', () => {
  const shopRules = styleSource.slice(styleSource.indexOf('THE SHOP PANEL'), styleSource.indexOf('NIMUSHI\'s voice'));
  /** Every [selector, declarations] pair, comments and @media wrappers stripped. */
  const rules = (css: string) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .flatMap(m => m[1].split(',').map(sel => [sel.trim(), m[2]] as const));
  /** The element a selector styles: its last compound. */
  const subject = (sel: string) => sel.split(/[\s>~+]+/).filter(Boolean).pop() ?? '';

  it('draws icons nearest-neighbour and uses no image for the panel, cards or SOLD OUT', () => {
    expect(shopRules).toContain('.shop-icon img{display:block;width:48px;height:48px;image-rendering:pixelated}');
    expect(shopRules).toContain('.shop-coin img{display:block;image-rendering:pixelated}');
    expect(shopRules).not.toMatch(/url\(/);
  });

  it('never dims a whole card, and never moves or scales one when it is pressed', () => {
    const cards = rules(shopRules).filter(([sel]) => subject(sel).startsWith('.shop-item'));
    expect(cards.length).toBeGreaterThanOrEqual(10);
    for (const [sel, decl] of cards) expect({ sel, decl }).not.toMatchObject({ decl: expect.stringMatching(/opacity|transform|filter/) });
    const pressed = cards.filter(([sel]) => sel.includes(':active'));
    expect(pressed.length).toBeGreaterThan(0);
    // The press trades padding top for bottom, so the box stays the same size in the same place.
    for (const [, decl] of pressed) if (decl.includes('padding-top')) expect(decl).toMatch(/padding-bottom/);
    expect(shopRules).not.toMatch(/\bscale[XY]?\(/);
  });

  it('holds the HUD back only while the SHOP panel is in the overlay', () => {
    expect(shopRules).toContain('#game-frame:has(>.overlay>.shop-content)>.hud{opacity:.35}');
    // Keyed on the panel being present, so closing the SHOP (an empty overlay) restores the HUD.
    // REST / UPGRADE UI V1 added the REST panel's own HUD hold-back, keyed the same way on its panel
    // (.rest-panel) and kept out of this block; the SHOP's rule and its selector are unchanged.
    // GAME OVER / CLEAR / PAUSE UI V1 added PAUSE's, keyed the same way on its own panel (.run-pause).
    expect(rules(styleSource).filter(([sel, decl]) => /\.hud\b|#hud\b/.test(sel) && /opacity/.test(decl)).map(([sel]) => sel)).toEqual(['#game-frame:has(>.overlay>.shop-content)>.hud', '#game-frame:has(>.overlay>.run-pause)>.hud', '#game-frame:has(>.overlay>.rest-panel)>.hud']);
  });
});

describe('SHOP behaviour is unchanged', () => {
  it('keeps the catalogue, prices, kinds and stock rules', () => {
    expect(SHOP_ITEMS.map(i => [i.id, i.name, i.effect, i.hearts, i.maxCharge, i.maxHp, ...i.prices])).toEqual([
      ['riceBall', 'おにぎり', 'HPを1回復。満タンなら余剰回復（LIFE UP）へ。', 1, 0, 0, 300, 500, 700, 900, 1100],
      ['sushi', 'すし', 'HPを2回復。満タンなら余剰回復（LIFE UP）へ。', 2, 0, 0, 500, 700, 900, 1100, 1300],
      ['battery', 'バッテリー', '最大CHARGE +1。弾倉も満タンになる。', 0, 1, 0, 150, 350, 550, 750, 950],
      ['carBattery', 'カーバッテリー', '最大CHARGE +2。弾倉も満タンになる。', 0, 2, 0, 250, 450, 650, 850, 1050],
      ['energyDrink', 'エナジードリンク', 'HPを1回復し、最大CHARGE +1。', 1, 1, 0, 400, 600, 800, 1000, 1200],
      ['curry', 'カレー', '最大HP +1。新しいハートは満タンで増える。', 0, 0, 1, 1000, 1200, 1400, 1600, 1800],
    ]);
    expect(SHOP_RULES.stock).toBe(3);
    const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    // Three distinct goods, priced by AREA, MEMBER'S CARD applied at the quote -- the ac4bd7c draws.
    expect([[1, 1], [2, 0.9], [5, 1]].map(([area, discount]) => rollShopStock(seeded(7), area, SHOP_RULES, discount).map(o => `${o.item}:${o.price}`))).toEqual([
      ['sushi:500', 'curry:1000', 'carBattery:250'], ['sushi:630', 'curry:1080', 'carBattery:405'], ['sushi:1300', 'curry:1800', 'carBattery:1050'],
    ]);
  });

  it('leaves the shop, economy, model, menu-key and canvas sources byte-identical to ac4bd7c', async () => {
    const SOURCES = import.meta.glob(['../src/data/shop.ts', '../src/systems/ShopSystem.ts', '../src/systems/GameModel.ts', '../src/systems/CoinSystem.ts', '../src/ui/menuKeys.ts', '../src/scenes/GameScene.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const got = Object.fromEntries(Object.entries(SOURCES).map(([path, text]) => [path.replace('../src/', ''), sha256(text)]));
    expect(got).toEqual({
      'data/shop.ts': 'b49df42586702ea68251d2ff2965d8927df2347c4de9c32aebfe89fd8b1bfa42',
      'systems/ShopSystem.ts': '7c494026876a1a3e699b092bb042a3f696aa445a1a0757b3de34cef4a69c15c5',
      'systems/GameModel.ts': 'd44534da247bb31183e8dca9e1760c8cc498ad0671f5d0d6da030da021554ab6',
      'systems/CoinSystem.ts': '6892dda7c0721c34265547192540700374a3d9a38a1f4a42a471dea932135eba',
      'ui/menuKeys.ts': 'e7701ab8bc56ace0638cab2b229b27b724a6046e7b28d81c0b0981c474833ff4',
      // Changed after ac4bd7c only by the place-keyed art selection in draw() (background, chamber,
      // enemy art) -- tests/visualStateMapping.test.ts -- and after cc578bf only by the SECTION EXIT
      // gate's image and the TIMEVOID Graphics split around it -- tests/exitGateArt.test.ts -- and after
      // 842d4c6 only by AREA 3's AIR CONTAINER image and the bubble Graphics split around it --
      // tests/airContainerArt.test.ts -- and after 1784c3e only by the floating labels' glyph styling (label()
      // takes a kind and draws through src/render/floatingText.ts; spawn, life and motion unchanged) --
      // tests/floatingText.test.ts -- and after defb7c5 only by the BOSS deep's image in the arena and the
      // TIMEOUT/bodies Graphics split under it -- tests/bossAbyssArt.test.ts -- and after d712b67 only by the
      // player's HURT / INVUL / COIN HIGH presentation (src/render/playerFeedbackVfx.ts) --
      // tests/playerFeedbackVfx.test.ts -- and after 61bcbd9 only by NIMUSHI's spoken line moving out of
      // the HUD and into the scene, on its own shell and glyphs under every hazard --
      // tests/bossDialogue.test.ts -- and after e948ece only by the bodies' common image on its own pooled
      // layer above the TIMEOUT bubbles (src/render/corpseArt.ts) -- tests/corpseArt.test.ts -- and after
      // 7e4c59d only by the DRONE's eight-rectangle body (src/render/droneArt.ts) -- tests/droneArt.test.ts;
      // nothing the SHOP reads or drives.
      'scenes/GameScene.ts': 'b8e7c8bd6fb8fb830ad6d12194c5eef890579607f62faded4b15ccb74b3e27ef',
    });
  });

  it('drives the panel exactly as before: same handlers, same focus timing, same close', () => {
    const body = mainSource.slice(mainSource.indexOf('function showShop('), mainSource.indexOf('/** A short, non-blocking card.'));
    expect(body).toContain("mode = 'shop'; bridge.active = false; clearInput();");
    // The same purchase on click/tap/ENTER/SPACE; only the redraw now knows which slot was bought.
    expect(body).toContain("if (button) button.onclick = () => { audio.unlock(); if (model.buyShopItem(index) === 'bought') { lastHud = ''; updateHud(model); draw(index); } };");
    expect(body).toContain("$('shop-close').onclick = () => closeShop(model);");
    // Closing returns to the mode the model restored (tests/stagingShopMode.test.ts).
    expect(body).toContain("mode = model.state === 'boss' ? 'boss' : 'playing'; clearInput(); setOverlay(''); lastHud = ''; updateHud(model);");
    // The same 60ms initial focus as ac4bd7c; the SHOP names its own target (tests/shopFocus.test.ts),
    // every other screen still starts on its first button.
    expect(mainSource).toContain("if (content) window.setTimeout(() => (focus ? focus() : $('overlay').querySelector<HTMLButtonElement>('button'))?.focus({ preventScroll: true }), 60);");
    expect(body).toContain("() => shopFocusTarget($('overlay'), model.shop.offers.length, bought));");
    expect(mainSource).toContain("cancel: () => {\n    if (mode !== 'shop') return false;\n    closeShop(scene.model);\n    return true;\n  },");
    // One panel for every SHOP: the only way in is the model's shopOpen event.
    expect(mainSource.match(/showShop\(/g)).toHaveLength(2);
    expect(mainSource).toContain("if (event.type === 'shopOpen') showShop(model);");
  });

  it('opens the same SHOP event from THE ABYSS staging doorway as from a SIDE CAVE', () => {
    const g = new GameModel(false);
    g.safeZoneVisitCount = 1;
    g.jumpToBoss();
    const e = g.shop.entrance!;
    g.player.x = e.x + e.width / 2; g.player.y = e.y + e.height - 16; g.player.vy = 0; g.player.invincible = 99;
    const seen: string[] = [];
    for (let i = 0; i < 240 && g.state !== 'shop'; i++) { g.step(STEP, 0, false); seen.push(...g.events.map(ev => ev.type)); }
    expect(g.state).toBe('shop');
    expect(seen).toContain('shopOpen');
    expect(g.shop.offers).toHaveLength(SHOP_RULES.stock);
    // Every staging good has an icon in the panel, like any other shelf.
    const panel = shopPanelHtml({ offers: g.shop.offers, walletCoins: g.coins.walletCoins, scoreCoins: g.coins.scoreCoins });
    for (const o of g.shop.offers) expect(panel).toContain(`src="${SHOP_ICON_ASSETS[o.item]}"`);
    expect(g.closeShop()).toBe(true);
    expect(g.state).toBe('boss');
  });
});
