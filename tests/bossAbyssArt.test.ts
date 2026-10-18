import { describe, expect, it } from 'vitest';
import { BOSS_ABYSS_ART, BOSS_ABYSS_GEOMETRY, BOSS_ABYSS_KEY, bossAbyssArt, bossAbyssLoads, bossAbyssPlacement } from '../src/render/bossAbyssArt';
import { GameModel } from '../src/systems/GameModel';
import { ARENA_FLOOR } from '../src/data/abyss';
import { WORLD } from '../src/data/balance';
import { entered, replaySignature } from './regressionSignature';
import { STEP, fighting, tick } from './nimushi';
import sceneSource from '../src/scenes/GameScene.ts?raw';

/**
 * BOSS ABYSS ART. One image, output/boss-abyss-floor-art-v1/assets/candidate-b-abyss-466x1082.png byte
 * for byte (B / COLLAPSED SEAL), shown in the NIMUSHI arena in place of the procedural rising deep: its
 * row 22 on the band's top, at native scale, moving only because the band's edge moves. Drawing only:
 * the deep's position and climb, the engagement, the phases and the instant death -- the player's
 * centre more than 140px below the view, NOT the visible edge -- are exactly defb7c5's.
 */

const { readFileSync, readdirSync } = await import(/* @vite-ignore */ 'node:' + 'fs') as { readFileSync: (path: URL) => Uint8Array; readdirSync: (path: URL) => string[] };
const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: Uint8Array | string) => { digest: (e: string) => string } } };
const { inflateSync } = await import(/* @vite-ignore */ 'node:' + 'zlib') as { inflateSync: (b: Uint8Array) => Uint8Array };
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

const dir = new URL('../src/assets/boss-abyss/', import.meta.url);
const NAME = 'boss-abyss-collapsed-seal.png';
const bytes = () => readFileSync(new URL(NAME, dir));
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
/** Width, height and RGBA texels of the shipped image (8-bit RGBA, non-interlaced: what the file is). */
const decode = () => {
  const b = bytes(), w = u32(b, 16), h = u32(b, 20), parts: Uint8Array[] = [];
  expect({ depth: b[24], colour: b[25], interlace: b[28] }).toEqual({ depth: 8, colour: 6, interlace: 0 });
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
  return { w, h, px };
};
const fileOf = (url: string) => url.split('/').pop()!.split('?')[0];
const bossMethod = () => sceneSource.slice(sceneSource.indexOf('  private boss(cam: number) {'), sceneSource.indexOf('    // Cups: the half of the pincer'));
const drawMethod = () => sceneSource.slice(sceneSource.indexOf('  private draw() {'), sceneSource.indexOf('  private surface('));
/** The screen edge the scene draws the deep at, by its own expression. */
const edgeOf = (g: GameModel) => g.boss.boundaryY - g.cameraY;
/** The guard the scene draws the deep inside, by its own expression. */
const drawn = (edge: number) => edge < 830 && edge > -200;
const ENGAGED_AT = 0;
function staging() {
  const g = new GameModel(false);
  g.safeZoneVisitCount = 1;
  g.jumpToBoss();
  expect(g.abyssStage).toBe('staging');
  return g;
}

/** defb7c5's procedural deep, byte for byte: the fallback. */
const PROCEDURAL = `      const depth = Math.max(0, 820 - edge);
      this.rect(-8, edge, 466, depth + 40, 0x2a0d18, 0.92);
      this.rect(-8, edge, 466, 5, 0xff4d7a, 0.8);
      for (let i = 0; i < 18; i++) {
        const x = 18 + i * 24;
        const bob = Math.sin(this.model.elapsed * 3 + i) * 4;
        this.graphics.fillStyle(0xff4d7a, 0.55).fillTriangle(x, edge + 2, x + 10, edge - 18 - bob, x + 20, edge + 2);
      }
    }`;

describe('the image', () => {
  it('registers exactly one, from src/assets/boss-abyss, under its own key', () => {
    expect(readdirSync(dir)).toEqual([NAME]);
    expect(bossAbyssLoads()).toEqual([[BOSS_ABYSS_KEY, BOSS_ABYSS_ART]]);
    expect(fileOf(BOSS_ABYSS_ART)).toBe(NAME);
    expect(sceneSource).toContain('for (const [key, url] of bossAbyssLoads()) this.load.image(key, url);');
    // Candidate A and the generation intermediates stay in the Codex output, not in the bundle.
    expect(readdirSync(new URL('../src/assets/', import.meta.url)).filter(f => /abyss/i.test(f))).toEqual(['boss-abyss']);
  });

  it('ships byte for byte as delivered: SHA-256, 466x1082, 8-bit RGBA, alpha 0/255', () => {
    // From output/boss-abyss-floor-art-v1/validation.json (assets[B].sha256, alphaHistogram).
    expect(sha256(bytes())).toBe('ee8b57685d4ba833b06dd4b083c04d004915aab2fcf0b1122c25f96fdf41c1ed');
    expect(bytes().length).toBe(31253);
    const { w, h, px } = decode();
    expect([w, h]).toEqual([466, 1082]);
    expect([w, h]).toEqual([BOSS_ABYSS_GEOMETRY.width, BOSS_ABYSS_GEOMETRY.height]);
    const histogram: Record<number, number> = {};
    for (let i = 3; i < px.length; i += 4) histogram[px[i]] = (histogram[px[i]] ?? 0) + 1;
    expect(histogram).toEqual({ 0: 5960, 255: 498252 });
  });

  it('is torn only above row 22: rows 0..21 hold every transparent texel, the body from row 22 is solid', () => {
    const { w, h, px } = decode();
    const transparentRows = new Set<number>();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] === 0) transparentRows.add(y);
    expect(Math.max(...transparentRows)).toBeLessThan(BOSS_ABYSS_GEOMETRY.anchorRow);
    expect(BOSS_ABYSS_GEOMETRY.anchorRow).toBe(22);
    // The torn top reaches no higher than the procedural teeth did (edge - 22 at the top of their bob).
    expect(transparentRows.has(0)).toBe(true);
  });
});

describe('where it is shown', () => {
  it('in the arena only, and only when it loaded', () => {
    expect(bossAbyssArt('fight', () => true)).toBe(BOSS_ABYSS_KEY);
    for (const stage of ['none', 'staging', 'inverting'] as const) expect(bossAbyssArt(stage, () => true)).toBeNull();
    expect(bossAbyssArt('fight', () => false)).toBeNull();
    expect(bossAbyssArt('fight', key => key !== BOSS_ABYSS_KEY)).toBeNull();
  });

  it('never in STAGING: the deep is off there, and a debug re-entry with it on keeps the procedural band', () => {
    const g = staging();
    expect(g.boss.enabled).toBe(false);
    expect(bossAbyssArt(g.abyssStage, () => true)).toBeNull();
    for (let i = 0; i < 600 && g.abyssStage === 'staging'; i++) { g.player.invincible = 9; g.step(STEP, 0, false); }
    expect(bossAbyssArt(g.abyssStage, () => true)).toBe(g.abyssStage === 'fight' ? BOSS_ABYSS_KEY : null);
    // fight -> warpTo('boss'): the staging room again, with `boss.enabled` left on (geometry-audit.md).
    const warped = new GameModel(false);
    warped.jumpToNimushi();
    expect(warped.abyssStage).toBe('fight');
    warped.warpTo('boss');
    expect(warped.abyssStage).not.toBe('fight');
    expect(bossAbyssArt(warped.abyssStage, () => true)).toBeNull();
  });

  it('is decided inside the band\'s own guard, and the procedural band is defb7c5\'s, byte for byte, as the fallback', () => {
    const body = bossMethod();
    expect(body).toContain('if (!fight.enabled) return;');
    expect(body).toContain('const edge = fight.boundaryY - cam;');
    expect(body).toContain('const sealKey = bossAbyssArt(this.model.abyssStage, key => this.textures.exists(key));');
    expect(body).toContain('if (edge < 830 && edge > -200 && sealKey) {');
    expect(body).toContain('} else if (edge < 830 && edge > -200) {');
    expect(body.indexOf('} else if (edge < 830 && edge > -200) {')).toBeLessThan(body.indexOf(PROCEDURAL));
    expect(body).toContain(PROCEDURAL);
    // One or the other: the image branch draws nothing procedural.
    const image = body.slice(body.indexOf('&& sealKey) {'), body.indexOf('} else if (edge < 830'));
    expect(image).not.toMatch(/this\.rect\(|fillStyle|fillTriangle|fillRect/);
  });

  it('hides itself every frame unless the arena\'s band shows it, so a clear (boss reset) leaves nothing behind', () => {
    const draw = drawMethod();
    expect(draw).toContain('this.abyssArt.setVisible(false);');
    expect(draw.indexOf('this.abyssArt.setVisible(false);')).toBeLessThan(draw.indexOf('this.boss(cam);'));
    // boss() returns before the deep when the fight is off -- clearBoss resets it, so the clear shows no deep.
    const g = new GameModel(false);
    g.jumpToNimushi();
    g.boss.reset();
    expect(g.boss.enabled).toBe(false);
  });
});

describe('anchor and motion', () => {
  it('lays row 22 on the band\'s top, rounded as rect() rounds it, at x -8 like the band', () => {
    for (const edge of [-199.6, -0.5, 0, 0.49, 0.5, 391.7, 430, 540.25, 620, 760, 819.5, 829.9]) {
      const at = bossAbyssPlacement(edge);
      expect(at.x).toBe(-8);
      expect(at.y + BOSS_ABYSS_GEOMETRY.anchorRow === Math.round(edge)).toBe(true);
      expect(Number.isInteger(at.y)).toBe(true);
      // Covers what the band covered: the band always ended at 860 or lower, the image reaches edge + 1060.
      const bandBottom = Math.round(edge) + Math.max(0, 820 - edge) + 40;
      if (drawn(edge)) expect(at.y + BOSS_ABYSS_GEOMETRY.height).toBeGreaterThanOrEqual(Math.min(bandBottom, WORLD.height));
    }
    // The image spans the band's width exactly: -8..458 over the 450 canvas.
    expect(BOSS_ABYSS_GEOMETRY.x + BOSS_ABYSS_GEOMETRY.width).toBe(WORLD.width + 8);
  });

  it('places the image at native size with no stretch, crop, tint or texture swap per frame', () => {
    const body = bossMethod();
    const image = body.slice(body.indexOf('&& sealKey) {'), body.indexOf('} else if (edge < 830'));
    expect(image).toContain('const at = bossAbyssPlacement(edge);');
    expect(image).toContain('this.abyssArt.setPosition(this.graphics.x + at.x, at.y).setVisible(true);');
    expect(sceneSource).not.toMatch(/abyssArt\.(setDisplaySize|setScale|setCrop|setTint|setTexture|setFrame)/);
    // Made once, in create(), from its own key.
    expect(sceneSource.match(/this\.abyssArt = /g)).toHaveLength(1);
    expect(sceneSource).toContain("this.abyssArt = this.add.image(0, 0, this.textures.exists(BOSS_ABYSS_KEY) ? BOSS_ABYSS_KEY : '__MISSING').setOrigin(0).setVisible(false);");
  });

  it('tracks the band frame by frame through a live fight: the image top is the band top minus 22, every frame', () => {
    const g = fighting(45);
    const tops: number[] = [];
    for (let i = 0; i < 12 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.step(STEP, 0, false);
      const edge = edgeOf(g);
      if (!drawn(edge)) continue;
      expect(bossAbyssArt(g.abyssStage, () => true)).toBe(BOSS_ABYSS_KEY);
      expect(bossAbyssPlacement(edge).y).toBe(Math.round(edge) - 22);
      tops.push(bossAbyssPlacement(edge).y);
    }
    // It was on screen and it moved -- the motion is the model's edge, nothing of the image's own.
    expect(tops.length).toBeGreaterThan(100);
    expect(new Set(tops).size).toBeGreaterThan(10);
  });
});

describe('nothing but the drawing changes', () => {
  it('keeps every gameplay source byte-identical to defb7c5', () => {
    const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url));
    expect({
      'systems/GameModel.ts': sha256(src('systems/GameModel.ts')),
      'systems/NimushiBossSystem.ts': sha256(src('systems/NimushiBossSystem.ts')),
      'systems/HealthSystem.ts': sha256(src('systems/HealthSystem.ts')),
      'systems/PhysicsTuning.ts': sha256(src('systems/PhysicsTuning.ts')),
      'data/abyss.ts': sha256(src('data/abyss.ts')),
      'data/nimushi.ts': sha256(src('data/nimushi.ts')),
      'data/boss.ts': sha256(src('data/boss.ts')),
      'data/bossPhysics.ts': sha256(src('data/bossPhysics.ts')),
      'data/balance.ts': sha256(src('data/balance.ts')),
      'main.ts': sha256(src('main.ts')),
    }).toEqual({
      'systems/GameModel.ts': 'd44534da247bb31183e8dca9e1760c8cc498ad0671f5d0d6da030da021554ab6',
      'systems/NimushiBossSystem.ts': 'c184b4d05cc9a063af6e7b486552c267b06752947f972dd2762ef1438d1ec3c6',
      'systems/HealthSystem.ts': '5ec6789c4129bd379a1bd1cba7a3f0d329e44e2388dd1ceb7d7e4fc15fd478fd',
      'systems/PhysicsTuning.ts': '52ccfbedeb85eac204b0d88ca74e4d39cadf5ccc8b91b3176e92e555fc5e71a6',
      'data/abyss.ts': '4b82b111d0ed53d6236879f5beaece3dde801a976e73133733ad01481e2eae91',
      'data/nimushi.ts': '1bcd9502d0c7e1ab33b631b062377ad2c706035984765915e882b8530609837b',
      'data/boss.ts': '3ea3234e72fc995cb11db998f843f2d870c0ee75cc3784b32944bfd0166c5b77',
      'data/bossPhysics.ts': '046a5d1996b8577e8a19e3a4debb130d3631de51b478eea7bac2644eb9456161',
      'data/balance.ts': 'd2eafd8ad7d906d973dcd62c62e920cb2aa9d00be211a999b067a6a5a797cfcd',
      'main.ts': '39636b623e1915d9c0d9956931db725c32b44c80713341f1473c89a30457831f',
    });
  });

  it('plays THE ABYSS and NIMUSHI exactly as before (the replay goldens tests/contentArt.test.ts holds)', () => {
    expect(replaySignature(entered(g => g.jumpToBoss()))).toBe('8e287a848cb425a8029c5f2c');
    expect(replaySignature(entered(g => { g.jumpToNimushi(); }))).toBe('26ccd33dc5a34ba1e36f989c');
  });

  it('keeps the instant death at the player\'s centre 140px below the view, not at the visible edge', () => {
    expect(ARENA_FLOOR.margin).toBe(140);
    // Below the image's top edge but inside the view: alive, and the fight goes on.
    const g = fighting(45);
    for (let i = 0; i < 4 / STEP && !(g.boss.engaged && drawn(edgeOf(g)) && edgeOf(g) < 700); i++) { g.player.invincible = 9; g.step(STEP, 0, false); }
    expect(g.boss.engaged).toBe(true);
    const edge = edgeOf(g);
    expect(edge).toBeLessThan(700);
    g.player.invincible = 9; g.player.vy = 0;
    g.player.y = g.boss.boundaryY + 60;                  // 60px past the drawn edge
    expect(g.player.y - g.cameraY).toBeLessThan(WORLD.height + ARENA_FLOOR.margin);
    g.step(STEP, 0, false);
    expect(g.state).toBe('boss');
    expect(g.health.deathCause).toBeFalsy();
    // The same frame geometry one pixel past the real line: crushed.
    g.player.vy = 0;
    g.player.y = g.cameraY + WORLD.height + ARENA_FLOOR.margin + 40;
    g.step(STEP, 0, false);
    expect(g.state).toBe('over');
    expect(g.health.deathCause?.cause).toBe('crush');
  });

  it('keeps the engagement frame and the climb of defb7c5 (measured on defb7c5 with this same fixture)', () => {
    const g = fighting(43);
    let engagedAt = -1;
    for (let i = 0; i < 6 / STEP && engagedAt < 0; i++) { g.player.invincible = 9; g.step(STEP, 0, false); if (g.boss.engaged) engagedAt = i; }
    expect(engagedAt).toBe(ENGAGED_AT);
    // Phase 1 climb: 22px/s of deepY on every frame the slack is under its clamp (data/abyss.ts
    // pressureSpeed, unchanged above). A new best mark only matters through that clamp.
    let measured = 0;
    for (let i = 0; i < 6 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9; g.player.vy = 0;   // standing still
      const deep = g.boss.deepY;
      g.step(STEP, 0, false);
      if (g.boss.slack >= 460 - 1e-9 || g.boss.phaseId !== 1 || g.boss.state === 'phaseTransition') continue;
      expect(deep - g.boss.deepY).toBeCloseTo(22 * STEP, 9);
      measured++;
    }
    expect(measured).toBeGreaterThan(60);
  });

  it('adds no collision: nothing outside the scene reads the image or its placement', () => {
    for (const path of ['systems/GameModel.ts', 'systems/NimushiBossSystem.ts']) {
      const text = new TextDecoder().decode(readFileSync(new URL(`../src/${path}`, import.meta.url)));
      expect(text).not.toMatch(/bossAbyss|abyssArt/);
    }
  });
});

describe('draw order', () => {
  it('sits where the band was: after the coins, TIMEOUT bubbles and bodies, before cups, pearls, NIMUSHI and the player', () => {
    const create = sceneSource.slice(sceneSource.indexOf('this.coinLayer = this.add.container(0, 0);'), sceneSource.indexOf('this.playerArt = new PlayerArt('));
    const order = ['this.coinLayer =', 'this.underAbyss = this.add.graphics();', 'this.abyssArt =', 'this.graphics = this.add.graphics();', 'this.bossArt = this.add.image(', 'this.afterBoss = this.add.graphics();', 'this.enemyLayer =', 'this.afterEnemies ='];
    const at = order.map(s => create.indexOf(s));
    expect(at.every(i => i >= 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(sceneSource.indexOf('this.afterEnemies = this.add.graphics();')).toBeLessThan(sceneSource.indexOf('this.artForeground = this.add.graphics();'));
    // In draw(): bubbles and bodies on underAbyss, then back to graphics for the deep, the cups and on.
    const draw = drawMethod();
    const steps = ['this.graphics = this.underAbyss;', 'for (const bubble of m.timeoutBubbles) {', 'for (const corpse of m.corpses) {', 'this.graphics = g;\n    this.boss(cam);', 'this.graphics = this.afterEnemies;'];
    const pos = steps.map(s => draw.indexOf(s));
    expect(pos.every(i => i >= 0), JSON.stringify(pos)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    // ...and the band is still the first thing boss() draws, before the cups, beams and pearls.
    const boss = sceneSource.slice(sceneSource.indexOf('  private boss(cam: number) {'));
    expect(boss.indexOf('bossAbyssPlacement(edge)')).toBeLessThan(boss.indexOf('for (const cup of fight.cups)'));
    expect(draw).toContain('this.underAbyss.clear().setPosition(g.x, g.y);');
  });

  it('never gives the image a depth, so the creation order is the draw order', () => {
    expect(sceneSource).not.toMatch(/abyssArt[^;]*setDepth/);
    expect(sceneSource).not.toMatch(/underAbyss[^;]*setDepth/);
  });
});
