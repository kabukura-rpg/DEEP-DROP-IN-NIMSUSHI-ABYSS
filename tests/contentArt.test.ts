import { describe, expect, it } from 'vitest';
import {
  CONTENT_ART, CONTENT_GEOMETRY, CONTENT_KEYS, coinArt, coinFace, contentLoads, moduleArt, modulePlacement, shopDoorArt, veinArt,
} from '../src/render/contentArt';
import { COIN_RULES, COIN_VALUES, type CoinDenomination } from '../src/data/coins';
import { GUN_MODULES, GUN_MODULE_IDS, type GunModuleId } from '../src/data/gunModules';
import { PICKUP_TYPES } from '../src/data/pickups';
import { SAFE_ZONE_RULES } from '../src/data/safeZone';
import { SHOP_DOOR } from '../src/data/structures';
import { caveShape, placeCave } from '../src/data/sideCave';
import { WORLD } from '../src/data/balance';
import { GameModel } from '../src/systems/GameModel';
import { previewSideCave } from '../src/dev/sideCavePreview';
import { entered, generationSignature, replaySignature } from './regressionSignature';
import sceneSource from '../src/scenes/GameScene.ts?raw';

/**
 * COIN + SIDE CAVE CONTENT ART. Eleven images from output/coin-side-cave-content-v1 (runtime/, byte for
 * byte): the two coin faces everywhere a loose coin is drawn, a crate per GUN MODULE, a SIDE CAVE's COIN
 * VEIN and a SIDE CAVE's SHOP door. Drawing only -- no value, radius, bound, payout, door or module
 * effect moves, and THE ABYSS staging room keeps its procedural SHOP doorway.
 */

const { readFileSync, readdirSync } = await import(/* @vite-ignore */ 'node:' + 'fs') as { readFileSync: (path: URL) => Uint8Array; readdirSync: (path: URL) => string[] };
const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: Uint8Array | string) => { digest: (e: string) => string } } };
const { inflateSync } = await import(/* @vite-ignore */ 'node:' + 'zlib') as { inflateSync: (b: Uint8Array) => Uint8Array };
const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
const STEP = 1 / 120;

const dir = new URL('../src/assets/content/', import.meta.url);
const bytes = (name: string) => readFileSync(new URL(name, dir));
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
/** Width, height, bit depth, colour type (6 = RGBA) and SHA-256 of one shipped image. */
const png = (name: string) => {
  const b = bytes(name);
  return { size: [u32(b, 16), u32(b, 20)], depth: b[24], colour: b[25], sha256: createHash('sha256').update(b).digest('hex') };
};
/** The alpha of one image, row by row (8-bit RGBA, non-interlaced: what the files are). */
const alpha = (name: string) => {
  const b = bytes(name), w = u32(b, 16), h = u32(b, 20), parts: Uint8Array[] = [];
  for (let o = 8; o < b.length;) { const len = u32(b, o), type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]); if (type === 'IDAT') parts.push(b.slice(o + 8, o + 8 + len)); o += 12 + len; }
  const joined = new Uint8Array(parts.reduce((n, q) => n + q.length, 0)); let at = 0; for (const q of parts) { joined.set(q, at); at += q.length; }
  const raw = inflateSync(joined), stride = w * 4, px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const v = raw[y * (stride + 1) + 1 + i], a = i >= 4 ? px[y * stride + i - 4] : 0, u = y ? px[(y - 1) * stride + i] : 0, c = i >= 4 && y ? px[(y - 1) * stride + i - 4] : 0;
      const pa = Math.abs(u - c), pb = Math.abs(a - c), pc = Math.abs(a + u - 2 * c);
      px[y * stride + i] = (v + [0, a, u, (a + u) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? u : c][ft]) & 255;
    }
  }
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => px[(y * w + x) * 4 + 3]));
};

// SHA-256 and canvas of each runtime PNG as delivered, from output/coin-side-cave-content-v1/validation.json.
const DELIVERED: Record<string, { sha256: string; size: [number, number] }> = {
  'coin-small.png': { sha256: '66b60d8c0c99a88b3445bd69c767234664a4b6d708a4de5dfb7cc825380240d4', size: [14, 14] },
  'coin-large.png': { sha256: '8a1aff77c5ddc08d77ddc2bd0b56cb036c3cbc9d4118ddadbd121cd6ad1a8383', size: [26, 25] },
  'coin-vein.png': { sha256: 'd884967236aadfdd3dadd3bd4975204b8f62231d246bdf1a6e1db6eed4906e79', size: [34, 40] },
  'shop-cave-door.png': { sha256: 'f0280f62edb9fe6a5e88104ab6df458f321bcc3a1e96bf68a54ebdc8b6090776', size: [66, 66] },
  'module-machine.png': { sha256: '9bb8b964cbb0e723eac65df60dbeacd58bea727f4fb9fa68208c4cf530f428e1', size: [34, 26] },
  'module-burst.png': { sha256: 'ba7a8771aa28d44e202397b1ac9f393fd2a3064778668acd4c91630b5b8710c8', size: [34, 26] },
  'module-laser.png': { sha256: '13ea37a7b471b889954d67ac4ca617679c6e6645abb9465af8017702fb0de6c5', size: [34, 26] },
  'module-noppy.png': { sha256: '1127c64e0fd41e9e36b8d3100a4d11b3fade65c322677fa207d20d822916c48f', size: [34, 26] },
  'module-puncher.png': { sha256: 'cba9e59b36dc0627a1c9a031c77282df5ba9375a78f140c13245c63fbfef13f8', size: [34, 26] },
  'module-shotgun.png': { sha256: '580766c9a044bbf193263a6e7ec49b064883f0f6631f919f14d3c762b6d4d6ac', size: [34, 26] },
  'module-triple.png': { sha256: 'dc028edcc6b85780117f109b29ff2cc2313e9d444ca880067e23447be2a1ce5c', size: [34, 26] },
};
const DENOMINATIONS: CoinDenomination[] = ['small', 'large'];
const fileOf = (url: string) => url.split('/').pop()!.split('?')[0];

describe('the eleven images', () => {
  it('registers exactly the eleven, from src/assets/content, under keys of their own', () => {
    expect(readdirSync(dir).sort()).toEqual(Object.keys(DELIVERED).sort());
    const loads = contentLoads();
    expect(loads).toHaveLength(11);
    expect(new Set(loads.map(([key]) => key)).size).toBe(11);
    expect(new Set(loads.map(([, url]) => url)).size).toBe(11);
    expect(loads.map(([, url]) => fileOf(url)).sort()).toEqual(Object.keys(DELIVERED).sort());
    for (const [key, url] of loads) {
      expect(key).toMatch(/^content-/);
      expect(url).toMatch(/assets\/content\//);
      expect(url).not.toMatch(/(^|\/)(output|dist)\//);
    }
    // Loaded by the scene alongside the environment sets.
    expect(sceneSource).toContain('for (const [key, url] of contentLoads()) this.load.image(key, url);');
  });

  it('ships every image byte for byte as delivered: SHA-256, canvas, RGBA, alpha 0/255, a 1px clear margin', () => {
    for (const [name, want] of Object.entries(DELIVERED)) {
      const got = png(name);
      expect({ name, ...got }).toEqual({ name, size: want.size, depth: 8, colour: 6, sha256: want.sha256 });
      const a = alpha(name), h = a.length, w = a[0].length;
      expect(a.flat().every(v => v === 0 || v === 255), name).toBe(true);
      expect(a[0].every(v => v === 0) && a[h - 1].every(v => v === 0), `${name} top/bottom margin`).toBe(true);
      expect(a.every(row => row[0] === 0 && row[w - 1] === 0), `${name} left/right margin`).toBe(true);
    }
  });

  it('gives each image the footprint its procedural drawing had', () => {
    for (const d of DENOMINATIONS) expect(png(fileOf(CONTENT_ART.coin[d])).size).toEqual([CONTENT_GEOMETRY.coin[d].width, CONTENT_GEOMETRY.coin[d].height]);
    for (const id of GUN_MODULE_IDS) expect(png(fileOf(CONTENT_ART.module[id])).size).toEqual([CONTENT_GEOMETRY.module.width, CONTENT_GEOMETRY.module.height]);
    expect(png(fileOf(CONTENT_ART.vein)).size).toEqual([CONTENT_GEOMETRY.vein.width, CONTENT_GEOMETRY.vein.height]);
    expect(png(fileOf(CONTENT_ART.shopDoor)).size).toEqual([CONTENT_GEOMETRY.shopDoor.width, CONTENT_GEOMETRY.shopDoor.height]);
  });
});

describe('COIN', () => {
  it('maps small to coin-small and large to coin-large, the face picked by the coin\'s own denomination', () => {
    expect(fileOf(CONTENT_ART.coin.small)).toBe('coin-small.png');
    expect(fileOf(CONTENT_ART.coin.large)).toBe('coin-large.png');
    expect(coinArt(() => true)).toEqual({ small: 'content-coin-small', large: 'content-coin-large' });
    expect(sceneSource).toContain('if (coinKeys) { this.coinImage(coinImages++, coinKeys[coin.denomination], coinFace(coin.denomination, coin.x, cy, spin), fade, g.x); continue; }');
  });

  it('keeps the spin: the same |cos| squeezes the face to exactly the width the procedural coin had', () => {
    expect(sceneSource).toContain('const spin = Math.abs(Math.cos(this.model.elapsed * 5 + coin.id));');
    for (const spin of [0, 0.1, 0.37, 0.5, 0.8, 1]) {
      // The procedural coin: a 2 + 12*spin column (small), a 4 + 22*spin rim (large), centred on x.
      const small = coinFace('small', 100, 300, spin), large = coinFace('large', 100, 300, spin);
      expect(small.scaleX * 14).toBeCloseTo(2 + 12 * spin, 10);
      expect(large.scaleX * 26).toBeCloseTo(4 + 22 * spin, 10);
      expect(small.x).toBe(100); expect(large.x).toBe(100);
    }
    // Full face at spin 1 is the image itself; never scaled vertically, never flipped.
    expect(coinFace('small', 0, 0, 1).scaleX).toBe(1);
    expect(coinFace('large', 0, 0, 1).scaleX).toBe(1);
    // Top edges where the procedural coin's were: cy - 7 (small), cy - 12.5 rounded (the large rim).
    expect(coinFace('small', 0, 300, 1).y).toBe(Math.round(300 - 7));
    expect(coinFace('large', 0, 300, 1).y).toBe(Math.round(300 - 21 / 2 - 2));
    expect(sceneSource).toContain('img.setTexture(texture).setPosition(offsetX + face.x, face.y).setScale(face.scaleX, 1).setAlpha(fade).setVisible(true);');
    expect(sceneSource).toContain("img = this.add.image(0, 0, texture).setOrigin(0.5, 0); this.coinLayer.add(img);");
  });

  it('keeps the expiry blink: the same fade, from the same 2.5s, applied as the image\'s alpha', () => {
    expect(COIN_RULES.blinkAt).toBe(2.5);
    expect(sceneSource).toContain('const fade = m.coins.expiring(coin) ? 0.3 + Math.abs(Math.sin(this.model.elapsed * 16)) * 0.6 : 1;');
  });

  it('leaves every coin rule exactly as it was', () => {
    expect(COIN_VALUES).toEqual({ small: 2, large: 10 });
    expect(COIN_RULES).toEqual({
      drop: { basic: { count: 1, denomination: 'small' }, armored: { count: 2, denomination: 'small' }, heavy: { count: 3, denomination: 'small' } },
      lifetime: 9, blinkAt: 2.5, burstSpeed: 150, burstSpread: 110, gravity: 420, maxFallSpeed: 300, radius: 17, magnetRadius: 86, magnetPull: 900,
    });
  });

  it('is drawn with the image in THE ABYSS too: the coin draw has no AREA or staging branch', () => {
    const loop = sceneSource.slice(sceneSource.indexOf('// Loose coins.'), sceneSource.indexOf('// TIMEOUT: stopped time'));
    expect(loop).not.toMatch(/abyss|staging|stage\.config|artArea/i);
    expect(sceneSource).toContain('const coinKeys = coinArt(exists), veinKey = veinArt(exists), doorKey = shopDoorArt(exists);');
  });
});

describe('GUN MODULE', () => {
  it('has one crate per module id, and no crate without a module', () => {
    expect(Object.keys(CONTENT_ART.module).sort()).toEqual([...GUN_MODULE_IDS].sort());
    expect(GUN_MODULE_IDS).toHaveLength(7);
    for (const id of GUN_MODULE_IDS) {
      expect(fileOf(CONTENT_ART.module[id])).toBe(`module-${id}.png`);
      expect(CONTENT_KEYS.module[id]).toBe(`content-module-${id}`);
      expect(moduleArt(id, () => true)).toBe(`content-module-${id}`);
    }
    const files = readdirSync(dir).filter(f => f.startsWith('module-')).map(f => f.slice('module-'.length, -'.png'.length));
    expect(files.sort()).toEqual([...GUN_MODULE_IDS].sort());
    expect(new Set(GUN_MODULE_IDS.map(id => png(`module-${id}.png`).sha256)).size).toBe(7);
  });

  it('draws the crate on the procedural box\'s footprint, with the bonus pip still over it and no label', () => {
    expect(modulePlacement(200, 300)).toEqual({ x: 183, y: 287 });
    expect(modulePlacement(200, 300.6)).toEqual({ x: 183, y: Math.round(300.6 - 13) });
    expect(sceneSource).toContain('const crate = moduleArt(item.module, exists);');
    expect(sceneSource).toContain("pips.push({ x: x + 10, y: y + bob - 16, color: item.bonus === 'charge' ? 0x9fe8f5 : 0xff8fa8 });");
    // The pip is drawn on `worldFrontLate`, which is above `contentLayer`.
    const lateAt = sceneSource.indexOf('this.graphics = this.worldFrontLate;');
    expect(sceneSource.indexOf('for (const pip of pips) this.rect(pip.x, pip.y, 6, 6, pip.color, 0.95);')).toBeGreaterThan(lateAt);
    // The image branch draws no label2; the fallback still carries the old box and label.
    const branch = sceneSource.slice(sceneSource.indexOf('const crate = moduleArt(item.module, exists);'), sceneSource.indexOf("const label = item.module ? gunModule(item.module).short : '';"));
    expect(branch).not.toContain('label2');
    expect(branch).toContain('continue;');
    expect(sceneSource).toContain('this.label2(x, y + bob, label);');
  });

  it('leaves every module, its pickup and its effect exactly as they were', () => {
    expect(PICKUP_TYPES.gunModule).toEqual({ id: 'gunModule', name: 'GUN MODULE', effect: 'gunModule', category: 'gunModule', value: 0, radius: 17, silhouette: 'module', color: 0xffd479 });
    // Every module definition, field for field, as at 4e5535c.
    expect(createHash('sha256').update(JSON.stringify(GUN_MODULES)).digest('hex')).toBe(GOLDEN_GUN_MODULES);
    // And a crate in a cave still arms the run with what it says.
    for (const id of GUN_MODULE_IDS) {
      const g = new GameModel(false, seeded(41));
      previewSideCave(g, 'module-left');
      const item = g.pickups.find(p => p.kind === 'gunModule')!;
      item.module = id as GunModuleId;
      g.player.x = item.x; g.player.y = item.y; g.player.vy = 0; g.player.invincible = 99;
      g.step(STEP, 0, false);
      expect(item.taken, id).toBe(true);
      expect(g.gun.id, id).toBe(id);
    }
  });
});

describe('COIN VEIN', () => {
  it('maps a SIDE CAVE vein to coin-vein, on exactly veinBounds -- 34x40, as the rules say', () => {
    expect(fileOf(CONTENT_ART.vein)).toBe('coin-vein.png');
    expect(veinArt(() => true)).toBe('content-coin-vein');
    expect(SAFE_ZONE_RULES.coinVein).toEqual({ value: 120, payout: { large: 10, small: 10 }, width: 34, height: 40 });
    expect(CONTENT_GEOMETRY.vein).toEqual({ width: SAFE_ZONE_RULES.coinVein.width, height: SAFE_ZONE_RULES.coinVein.height });
    for (const side of [-1, 1] as const) {
      const g = new GameModel(false, seeded(5));
      const mouthX = side === -1 ? WORLD.wall : WORLD.width - WORLD.wall;
      const cave = placeCave(1, side, mouthX, 900, caveShape('coinVein', side), { kind: 'coinVein' });
      const v = g.veinBounds(cave);
      expect({ w: v.width, h: v.height }).toEqual({ w: 34, h: 40 });
      expect(Number.isInteger(v.x) && Number.isInteger(v.y)).toBe(true);
    }
    expect(sceneSource).toContain('if (veinKey) this.veinImage(veins++, veinKey, offsetX + v.x, Math.round(vy));');
  });

  it('only in a SIDE CAVE: a chamber\'s vein keeps its procedural drawing', () => {
    const chamber = sceneSource.slice(sceneSource.indexOf('for (const zone of m.safeZones) {'), sceneSource.indexOf('// DOODADS: small fixtures on the shaft wall'));
    expect(chamber).toContain('const v = m.coinVeinBounds(zone), vy = v.y - cam;');
    expect(chamber).not.toContain('veinImage');
  });
});

describe('SIDE CAVE SHOP door', () => {
  it('maps a SHOP CAVE\'s door to shop-cave-door, on exactly shopDoor(cave) -- 66x66, as SHOP_DOOR says', () => {
    expect(fileOf(CONTENT_ART.shopDoor)).toBe('shop-cave-door.png');
    expect(shopDoorArt(() => true)).toBe('content-shop-cave-door');
    expect(SHOP_DOOR).toEqual({ width: 66, height: 66 });
    expect(CONTENT_GEOMETRY.shopDoor).toEqual(SHOP_DOOR);
    for (const side of [-1, 1] as const) {
      const g = new GameModel(false, seeded(9));
      previewSideCave(g, side === -1 ? 'shop-left' : 'shop-right');
      const door = g.shopDoor(g.caves[0]);
      expect({ w: door.width, h: door.height }).toEqual({ w: 66, h: 66 });
      // Still opened by walking into it.
      g.player.x = door.x + door.width / 2; g.player.y = door.y + door.height - 16; g.player.vy = 0;
      g.step(STEP, 0, false);
      expect(g.state).toBe('shop');
    }
    expect(sceneSource).toContain("const caveDoors = m.caves.filter(c => c.content?.kind === 'shop' && !c.taken).map(c => m.shopDoor(c));");
    expect(sceneSource).toContain('if (dy > -120 && dy < 860) this.contentImage(contentImages++, doorKey, g.x + door.x, Math.round(dy));');
  });

  it('keeps THE ABYSS staging room\'s doorway procedural: `shop.entrance` never takes the image', () => {
    expect(sceneSource).toContain('...(m.shop.entrance ? [m.shop.entrance] : []),');
    expect(sceneSource).toContain('...(doorKey ? [] : caveDoors),');
    // The procedural doorway itself, unchanged.
    for (const line of [
      'this.rect(door.x, dy, door.width, door.height, 0x1e1830, 0.95);',
      'this.graphics.lineStyle(3, 0xffd479, 0.9).strokeRect(door.x, dy, door.width, door.height);',
      'this.rect(door.x + 8, dy + 10, door.width - 16, 4, 0xffd479, 0.5);',
      "this.label2(door.x + door.width / 2, dy + door.height / 2 + 4, 'SHOP');",
    ]) expect(sceneSource).toContain(line);
    // In the staging room the shelf's doorway is `shop.entrance` and no cave exists to give one.
    const g = new GameModel(false, seeded(3));
    g.safeZoneVisitCount = 1;
    g.jumpToBoss();
    expect(g.abyssStage).toBe('staging');
    expect(g.shop.entrance).toEqual({ x: 314, y: 990, width: 66, height: 66 });
    expect(g.caves).toHaveLength(0);
  });
});

describe('fallback', () => {
  it('draws each group procedurally when its images are missing, and never another module\'s crate', () => {
    expect(coinArt(() => false)).toBeNull();
    expect(coinArt(key => key !== 'content-coin-small')).toBeNull();
    expect(coinArt(key => key !== 'content-coin-large')).toBeNull();
    expect(veinArt(() => false)).toBeNull();
    expect(shopDoorArt(() => false)).toBeNull();
    for (const missing of GUN_MODULE_IDS) {
      const exists = (key: string) => key !== CONTENT_KEYS.module[missing];
      expect(moduleArt(missing, exists)).toBeNull();
      for (const other of GUN_MODULE_IDS.filter(id => id !== missing)) expect(moduleArt(other, exists)).toBe(`content-module-${other}`);
    }
    expect(moduleArt(undefined, () => true)).toBeNull();
    // The procedural drawings are all still there, behind their branches.
    for (const line of [
      "if (large) this.rect(coin.x - 2 - (half + 2) * spin, cy - tall / 2 - 2, 4 + (half + 2) * 2 * spin, tall + 4, 0x8a6520, fade * 0.7);",
      'this.rect(x - 17, y + bob - 13, 34, 26, 0x2a2438, 0.95);',
      'this.rect(v.x, vy, v.width, v.height, 0x3a2f14, 0.95);',
    ]) expect(sceneSource).toContain(line);
  });
});

describe('draw order', () => {
  it('puts each image layer where its procedural drawing was', () => {
    const create = sceneSource.slice(sceneSource.indexOf('this.worldBack = this.add.graphics();'), sceneSource.indexOf('this.afterBoss = this.add.graphics();'));
    const order = ['this.worldMid =', 'this.veinLayer =', 'this.doodadLayer =', 'this.platformLayer =', 'this.worldFront =', 'this.contentLayer =', 'this.worldFrontLate =', 'this.coinLayer =', 'this.graphics = this.add.graphics();'];
    const at = order.map(s => create.indexOf(s));
    expect(at.every(i => i >= 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // In draw(): ledges .. TIMEVOID on worldFront, then crates/doors, then worldFrontLate up to the coins, then graphics.
    const draw = sceneSource.slice(sceneSource.indexOf('private draw() {'));
    const steps = ['this.graphics = this.worldFront;', 'for (const item of m.pickups) {', 'this.timeVoid(m, cam);', 'this.graphics = this.worldFrontLate;', '// AREA 2 air containers.', '// Loose coins.', 'this.graphics = g;\n    // TIMEOUT', '// Bodies.', 'this.boss(cam);'];
    const pos = steps.map(s => draw.indexOf(s));
    expect(pos.every(i => i >= 0), JSON.stringify(pos)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });
});

describe('nothing but the drawing changes', () => {
  it('generates and plays AREA 1-4, THE ABYSS and NIMUSHI exactly as 4e5535c did', () => {
    // The same goldens tests/doodadArt.test.ts holds (measured on cb5912d, unchanged at 4e5535c).
    const golden = {
      1: ['b9975efcb9fbe4b2006cba4e', '414b1f52261b82c067509d92', '22ddb6304f988ed56d4538e5', '683c2598a46b4eadcc576b35'],
      2: ['55c8866f29f3d7527c3b513d', '95ebcdc29407d78501ec1a47', 'f5d50c7e36c05e33c315524d', 'e5f4c74110599c23f5ad5b62'],
      3: ['d748a265cf1731ae185f93cb', 'd813e6aa01f3d20ed9e034a4', '27a110a2880f9aaaafae8a08', 'b1c14c441b457f2baa84336f'],
      4: ['8fe90e6d6d4574a2e2ac7acf', '1e76e850a940069cb736eecc', '7c1a7fd3289e1612548469c1', 'b168d91ecea486a17fcc5fbf'],
    } as const;
    for (const area of [1, 2, 3, 4] as const) {
      expect(generationSignature(area), `AREA ${area} generation`).toBe(golden[area][0]);
      for (const section of [1, 2, 3] as const) expect(replaySignature(entered(g => g.jumpToStage(area, section))), `AREA ${area}-${section}`).toBe(golden[area][section]);
    }
    expect(replaySignature(entered(g => g.jumpToBoss()))).toBe('8e287a848cb425a8029c5f2c');
    expect(replaySignature(entered(g => { g.jumpToNimushi(); }))).toBe('26ccd33dc5a34ba1e36f989c');
  });
});

/** SHA-256 of JSON.stringify(GUN_MODULES) at 4e5535c (src/data/gunModules.ts is not touched). */
const GOLDEN_GUN_MODULES = '616f67b7edd54a8ed95b6a2a092ff97fe8a375d4d54055f73a934199f297a675';
