import { describe, expect, it } from 'vitest';
import { AIR_CONTAINER_ART, AIR_CONTAINER_GEOMETRY, AIR_CONTAINER_KEY, airContainerArt, airContainerLoads, airContainerPlacement } from '../src/render/airContainerArt';
import { environmentArtArea } from '../src/render/environmentArt';
import { AIR_CONTAINER_RULES } from '../src/data/structures';
import { OXYGEN_RULES } from '../src/systems/OxygenSystem';
import { GameModel } from '../src/systems/GameModel';
import { AREAS as AREA_CONFIGS, type AreaId, type SectionId } from '../src/data/areas';
import { clearViaExit } from './exitHelper';
import { fighting, inWindow, pin, shootEye, STEP } from './nimushi';
import { entered, generationSignature, replaySignature } from './regressionSignature';
import sceneSource from '../src/scenes/GameScene.ts?raw';
import mainSource from '../src/main.ts?raw';
import modelSource from '../src/systems/GameModel.ts?raw';
import generatorSource from '../src/systems/StageGenerator.ts?raw';
import structuresSource from '../src/data/structures.ts?raw';
import balanceSource from '../src/data/balance.ts?raw';
import areasSource from '../src/data/areas.ts?raw';
import oxygenSource from '../src/systems/OxygenSystem.ts?raw';

/**
 * AREA 3 AIR CONTAINER ART. One image, output/area3-air-container-art-v1/runtime/area3-air-a-intact.png
 * byte for byte (A / ANCIENT AIR RESERVOIR), laid 1:1 on a sealed AREA 3 AirContainer's rectangle in
 * place of the procedural box. Drawing only: where containers are laid, their bounds, what touching or
 * shooting them does, the bubbles and the tank are exactly 842d4c6's.
 */

const { readFileSync, readdirSync } = await import(/* @vite-ignore */ 'node:' + 'fs') as { readFileSync: (path: URL) => Uint8Array; readdirSync: (path: URL) => string[] };
const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: Uint8Array | string) => { digest: (e: string) => string } } };
const { inflateSync } = await import(/* @vite-ignore */ 'node:' + 'zlib') as { inflateSync: (b: Uint8Array) => Uint8Array };
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
const r3 = (v: number) => Math.round(v * 1000) / 1000;

const dir = new URL('../src/assets/air/', import.meta.url);
const NAME = 'area3-air-a-intact.png';
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
const containerDraw = () => sceneSource.slice(sceneSource.indexOf('// AREA 2 air containers.'), sceneSource.indexOf('// Loose coins.'));
/** A run whose containers are whatever the generator laid by `seconds` in, falling straight down. */
const descend = (start: (g: GameModel) => void, seed: number, seconds = 20) => {
  const g = new GameModel(false, seeded(seed));
  start(g);
  const seen = new Map<number, { x: number; y: number; width: number; height: number; shotOnly?: boolean; area: ReturnType<typeof environmentArtArea> }>();
  for (let i = 0; i < 120 * seconds && (g.state === 'playing' || g.state === 'boss'); i++) {
    g.player.invincible = 99;
    g.step(1 / 120, 0, false);
    for (const b of g.containers) if (!seen.has(b.id)) seen.set(b.id, { x: b.x, y: b.y, width: b.width, height: b.height, shotOnly: b.shotOnly, area: environmentArtArea(g) });
  }
  return [...seen.values()];
};

describe('the image', () => {
  it('registers exactly one, from src/assets/air, under its own key', () => {
    expect(readdirSync(dir)).toEqual([NAME]);
    expect(airContainerLoads()).toEqual([[AIR_CONTAINER_KEY, AIR_CONTAINER_ART]]);
    expect(fileOf(AIR_CONTAINER_ART)).toBe(NAME);
    expect(sceneSource).toContain('for (const [key, url] of airContainerLoads()) this.load.image(key, url);');
  });

  it('ships byte for byte as delivered: SHA-256, 34x34, 8-bit RGBA, alpha 0/255, 17 colours', () => {
    // From output/area3-air-container-art-v1/validation.json (assets[a].sha256).
    expect(sha256(bytes())).toBe('a714589b33344a8f67c039ed705fa3c2e2f08b25604eb54192f71e7e8cfe3b06');
    const { w, h, px } = decode();
    expect([w, h]).toEqual([34, 34]);
    const alphas = new Set<number>(), colours = new Set<string>();
    let transparent = 0, minX = w, minY = h, maxX = -1, maxY = -1;
    for (let i = 0; i < px.length; i += 4) {
      alphas.add(px[i + 3]);
      if (px[i + 3] === 0) { transparent++; expect([px[i], px[i + 1], px[i + 2]]).toEqual([0, 0, 0]); continue; }
      colours.add(`${px[i]},${px[i + 1]},${px[i + 2]}`);
      const x = (i / 4) % w, y = Math.floor(i / 4 / w);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    expect([...alphas].sort((a, b) => a - b)).toEqual([0, 255]);
    // validation.json: paletteColorCount 17, transparentPixels 503, bounds x2 y1 w29 h32.
    expect(colours.size).toBe(17);
    expect(transparent).toBe(503);
    expect({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }).toEqual({ x: 2, y: 1, width: 29, height: 32 });
  });

  it('is the container\'s own footprint: the 34x34 AirContainer the model tests against', () => {
    expect(AIR_CONTAINER_GEOMETRY).toEqual({ width: 34, height: 34 });
    expect(AIR_CONTAINER_RULES.size).toBe(34);
  });
});

describe('AREA mapping', () => {
  it('is AREA 3\'s alone: no image for AREA 1, 2, 4, THE ABYSS\'s staging room or the arena', () => {
    expect(airContainerArt(3, () => true)).toBe(AIR_CONTAINER_KEY);
    for (const area of [1, 2, 4, 'staging', 'boss'] as const) expect(airContainerArt(area, () => true), String(area)).toBeNull();
    // Chosen by the place the scene already keys every image on, nothing else.
    expect(sceneSource).toContain('const airKey = airContainerArt(artArea, exists);');
    expect(containerDraw()).not.toMatch(/setTint|config\.id|theme|shotOnly/);
  });

  it('every container AREA 3 lays is drawn from the image; AREA 1, 2 and 4 lay none', () => {
    for (const section of [1, 2, 3] as const) {
      const boxes = descend(g => g.jumpToStage(3, section), 300 + section);
      expect(boxes.length, `3-${section}`).toBeGreaterThan(0);
      for (const b of boxes) {
        expect(b.area).toBe(3);
        expect(b.shotOnly).toBeUndefined();
        expect([b.width, b.height]).toEqual([34, 34]);
        expect(airContainerArt(b.area, () => true)).toBe(AIR_CONTAINER_KEY);
      }
    }
    for (const area of [1, 2, 4] as const) for (const section of [1, 2, 3] as const) {
      expect(descend(g => g.jumpToStage(area, section), area * 10 + section), `${area}-${section}`).toEqual([]);
    }
    // Only AREA 3 is submerged with oxygen on: no other AREA config could lay one.
    expect(AREA_CONFIGS.filter(a => a.gimmicks?.oxygen).map(a => a.id)).toEqual([3]);
  });

  it('never leaks into THE ABYSS: its shot-only containers are drawn where `artArea` is staging or boss', () => {
    // The staging room lays none.
    expect(descend(g => g.jumpToBoss(), 41, 40)).toEqual([]);
    // The fight lays them in its AQUIFER (PHASE 3, layAbyssRow): driven there as tests/boss.test.ts does.
    const game = fighting(54);
    for (let i = 0; i < 400 / STEP && game.boss.phaseId < 3; i++) {
      game.player.invincible = 9;
      pin(game, 300);
      if (inWindow(game) && i % 6 === 0) shootEye(game, 4);
      else game.step(STEP, 0, false);
      if (game.state !== 'boss') break;
    }
    expect(game.boss.phaseId).toBe(3);
    expect(game.containers.length).toBeGreaterThan(0);
    for (const b of game.containers) {
      expect(b.shotOnly).toBe(true);
      expect(environmentArtArea(game)).toBe('boss');
      expect(airContainerArt(environmentArtArea(game), () => true)).toBeNull();
    }
    // 4-3's gate opens the staging room: the place leaves AREA 3's art behind with the SECTION.
    const run = new GameModel(false, seeded(43));
    run.jumpToStage(4, 3);
    clearViaExit(run);
    expect(environmentArtArea(run)).toBe('staging');
    expect(airContainerArt(environmentArtArea(run), () => true)).toBeNull();
  });

  it('lays the image 1:1 on the rectangle the procedural box filled, on whole pixels', () => {
    const boxes = descend(g => g.jumpToStage(3, 1), 77);
    for (const b of boxes) for (const cam of [b.y - 400, b.y - 400.5, b.y - 123.25, b.y - 799.75]) {
      const box = { id: 0, ...b, broken: false, debris: 0 };
      const at = airContainerPlacement(box, cam);
      expect(at).toEqual({ x: Math.round(b.x), y: Math.round(b.y - cam) });
      expect(Number.isInteger(at.x) && Number.isInteger(at.y)).toBe(true);
    }
    const draw = containerDraw();
    expect(draw).toContain('const at = airContainerPlacement(box, cam);');
    expect(draw).toContain('this.airImage(airImages++, airKey, g.x + at.x, at.y);');
    // Native size, never stretched or tinted; nearest-neighbour as every image (pixelArt, no antialias).
    const pool = sceneSource.slice(sceneSource.indexOf('private airImage('), sceneSource.indexOf('/** One loose coin\'s face'));
    expect(pool).toContain('img.setTexture(texture).setPosition(x, y).setVisible(true);');
    expect(draw + pool).not.toMatch(/setScale|setDisplaySize|setSize|setCrop|setTint|setAlpha/);
    expect(mainSource).toContain('pixelArt: true, antialias: false');
  });
});

describe('states', () => {
  it('has one image, for `broken: false` only: a broken container keeps its procedural debris', () => {
    const draw = containerDraw();
    const broken = draw.indexOf('if (box.broken) {');
    const image = draw.indexOf('if (airKey) {');
    expect(broken).toBeGreaterThan(0);
    expect(image).toBeGreaterThan(broken);
    // The debris branch is 842d4c6's and ends before the image is considered.
    const debris = draw.slice(broken, image);
    expect(debris).toContain('for (let i = 0; i < 6; i++) this.rect(box.x + (i % 3) * 12 - 6 + (1 - t) * (i - 3) * 6, by + Math.floor(i / 3) * 14 - (1 - t) * 10, 7, 7, 0x9fe8f5, 0.5 * t);');
    expect(debris).toContain('continue;');
    expect(debris).not.toContain('airImage');
    // One texture, never a second state's.
    expect(draw.match(/airImage\(/g)).toHaveLength(1);
    expect(draw.match(/setTexture\(/g)).toBeNull();
  });
});

describe('fallback', () => {
  it('keeps the procedural box for a missing image, and only then; never another image', () => {
    expect(airContainerArt(3, () => false)).toBeNull();
    expect(airContainerArt(3, key => key !== AIR_CONTAINER_KEY)).toBeNull();
    const draw = containerDraw();
    const image = draw.indexOf('if (airKey) {');
    // The procedural box, exactly as 842d4c6 drew it, after the image branch has `continue`d.
    for (const line of [
      'this.rect(box.x, by, box.width, box.height, 0x17323a, 0.95);',
      'this.graphics.lineStyle(2, 0x70d8ef, 0.95).strokeRect(box.x, by, box.width, box.height);',
      'this.rect(box.x + 5, by + 5, box.width - 10, 5, 0x9fe8f5, 0.55);',
      'this.graphics.lineStyle(2, 0x9fe8f5, 0.5).strokeCircle(box.x + box.width / 2, by + box.height / 2 + 3, 7);',
    ]) expect(draw.indexOf(line), line).toBeGreaterThan(image);
    // Unused pooled images are hidden every frame, so a missing image (or no container) shows none.
    expect(draw).toContain('for (let i = airImages; i < this.airImages.length; i++) this.airImages[i].setVisible(false);');
  });
});

describe('draw order', () => {
  it('keeps the containers where they were: after the crates, doorways and pips, under the bubbles and the coins', () => {
    const create = sceneSource.slice(sceneSource.indexOf('this.worldBack = this.add.graphics();'), sceneSource.indexOf('this.afterBoss = this.add.graphics();'));
    const order = ['this.worldFront =', 'this.exitArt =', 'this.worldFrontVoid =', 'this.contentLayer =', 'this.worldFrontLate =', 'this.airLayer =', 'this.worldFrontAir =', 'this.coinLayer =', 'this.graphics = this.add.graphics();'];
    const at = order.map(s => create.indexOf(s));
    expect(at.every(i => i >= 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // In draw(): doorways and containers on worldFrontLate, the bubbles on worldFrontAir, then coins.
    const body = sceneSource.slice(sceneSource.indexOf('this.graphics = this.worldFrontLate;'), sceneSource.indexOf('this.graphics = g;\n    // TIMEOUT'));
    const marks = ['for (const pip of pips)', 'for (const door of doors)', '// AREA 2 air containers.', 'this.airImages[i].setVisible(false);', 'this.graphics = this.worldFrontAir;', 'for (const bubble of m.bubbles)', '// Loose coins.'];
    const pos = marks.map(s => body.indexOf(s));
    expect(pos.every(i => i >= 0), JSON.stringify(pos)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(sceneSource).toContain('this.worldFrontAir.clear().setPosition(g.x, g.y);');
    // Nothing gets an explicit depth: creation order is the order, as everywhere in the world.
    expect(sceneSource).not.toMatch(/(airLayer|worldFrontAir)[^;\n]*setDepth/);
  });
});

/**
 * Everything the run does with air, from the model alone: every container laid (id, x, y, size), every
 * bubble at birth (place, velocity, life, arm), every event, and the tank, HP and player every half
 * second, through scripted play in all three AREA 3 SECTIONs -- once invincible (so the bursts are
 * reached and chased) and once mortal (so the tank runs dry and drowning hits land).
 */
function airTrace() {
  const out: string[] = [];
  for (const mortal of [false, true]) for (const section of [1, 2, 3] as const) for (const seed of [1, 2, 3, 4]) {
    const g = new GameModel(false, seeded(3000 + section * 10 + seed + (mortal ? 500 : 0)));
    g.jumpToStage(3, section);
    const input = seeded(seed * 31 + section); let move = 0, fire = false;
    const boxes = new Set<number>(), bubbles = new Set<number>();
    for (let i = 0; i < 120 * 25 && g.state === 'playing'; i++) {
      if (i % 24 === 0) { const r = input(); move = r < 0.33 ? -1 : r < 0.66 ? 1 : 0; fire = input() < 0.5; }
      if (!mortal) g.player.invincible = 99;
      g.step(1 / 120, move, fire);
      for (const b of g.containers) if (!boxes.has(b.id)) { boxes.add(b.id); out.push(`C${b.id}|${b.x}|${b.y}|${b.width}|${b.height}|${b.shotOnly ?? ''}`); }
      for (const b of g.bubbles) if (!bubbles.has(b.id)) { bubbles.add(b.id); out.push(`B${b.id}|${r3(b.x)}|${r3(b.y)}|${r3(b.vx)}|${r3(b.vy)}|${r3(b.life)}|${r3(b.arm)}`); }
      for (const e of g.events) out.push(`${i}:${e.type}@${r3(e.x)},${r3(e.y)}=${'value' in e ? e.value : ''}`);
      g.events.length = 0;
      if (i % 60 === 0) out.push(`${i}|${r3(g.oxygen.remaining)}|${g.hp}|${r3(g.player.x)}|${r3(g.player.y)}|${g.containers.length}|${g.bubbles.length}|${g.state}`);
    }
  }
  return sha256(out.join('\n')).slice(0, 24);
}

describe('gameplay is 842d4c6\'s', () => {
  it('leaves the model, generator, structures, world, AREA and oxygen sources byte-identical to 842d4c6', () => {
    expect({
      model: sha256(modelSource), generator: sha256(generatorSource), structures: sha256(structuresSource),
      balance: sha256(balanceSource), areas: sha256(areasSource), oxygen: sha256(oxygenSource),
    }).toEqual({
      model: 'd44534da247bb31183e8dca9e1760c8cc498ad0671f5d0d6da030da021554ab6',
      generator: 'e3948ae847117e6ff17f64393fe11885f6e9d12ee6d92ea702950dde96bd1d26',
      structures: '86078a98e06341772adb8b5269a645387fd82137db883d5b85afabaebf18f5a3',
      balance: 'd2eafd8ad7d906d973dcd62c62e920cb2aa9d00be211a999b067a6a5a797cfcd',
      areas: '22121ff02f2ab64dd570bcd924f69fb3cacd844ffa357c96a0440b4e4806e478',
      oxygen: OXYGEN_SHA,
    });
    for (const source of [modelSource, generatorSource, structuresSource, oxygenSource]) expect(source).not.toMatch(/airContainerArt|area3-air/);
  });

  it('keeps every AIR and oxygen number', () => {
    expect(AIR_CONTAINER_RULES).toEqual({
      size: 34, bubblesMin: 3, bubblesMax: 5, recovery: 5, riseSpeed: 96, riseSpread: 54, riseAccel: 260,
      bubbleLife: 4.2, debrisTime: 0.35, collectArm: 0.08,
    });
    expect(OXYGEN_RULES).toEqual({ max: 12, bubbleRecovery: 5, damageInterval: 1, warning: 5, critical: 3 });
    // The interaction bounds, as the model tests them.
    expect(modelSource).toContain('if (p.x + 9 > box.x && p.x - 9 < box.x + box.width && p.y + 15 > box.y && p.y - 15 < box.y + box.height) this.breakContainer(box);');
    expect(modelSource).toContain('if (b.x > box.x - b.size && b.x < box.x + box.width + b.size && sweeps(b.previousY, b.y, box.y, box.y + box.height)) {');
    expect(modelSource).toContain('x: box.x + box.width / 2, y: box.y + box.height / 2,');
  });

  it('lays, breaks and releases air, and drains and refills the tank, exactly as before', () => {
    // Produced by this same trace on an untouched 842d4c6 checkout.
    expect(airTrace()).toBe(AIR_TRACE);
  });

  it('generates and plays AREA 1-4, THE ABYSS staging room and NIMUSHI exactly as before', () => {
    const golden = {
      1: ['b9975efcb9fbe4b2006cba4e', '414b1f52261b82c067509d92', '22ddb6304f988ed56d4538e5', '683c2598a46b4eadcc576b35'],
      2: ['55c8866f29f3d7527c3b513d', '95ebcdc29407d78501ec1a47', 'f5d50c7e36c05e33c315524d', 'e5f4c74110599c23f5ad5b62'],
      3: ['d748a265cf1731ae185f93cb', 'd813e6aa01f3d20ed9e034a4', '27a110a2880f9aaaafae8a08', 'b1c14c441b457f2baa84336f'],
      4: ['8fe90e6d6d4574a2e2ac7acf', '1e76e850a940069cb736eecc', '7c1a7fd3289e1612548469c1', 'b168d91ecea486a17fcc5fbf'],
    } as const;
    for (const area of [1, 2, 3, 4] as AreaId[]) {
      expect(generationSignature(area), `AREA ${area} generation`).toBe(golden[area][0]);
      for (const section of [1, 2, 3] as SectionId[]) expect(replaySignature(entered(g => g.jumpToStage(area, section))), `AREA ${area}-${section}`).toBe(golden[area][section]);
    }
    expect(replaySignature(entered(g => g.jumpToBoss()))).toBe('8e287a848cb425a8029c5f2c');
    expect(replaySignature(entered(g => { g.jumpToNimushi(); }))).toBe('26ccd33dc5a34ba1e36f989c');
  });
});

const OXYGEN_SHA = '18817c5755e4c06c37f6b2f72ea0d9dc26ec94cec214ab54bea5a579af86e29b';
const AIR_TRACE = '3afa262f7555204c43daea6a';
