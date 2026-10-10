import { describe, expect, it } from 'vitest';
import {
  CAVE_CEILING_ART, CAVE_CEILING_GEOMETRY, CAVE_CEILING_KEYS, CAVE_SHELL_AREAS, CAVE_SHELL_KEYS,
  caveCeilingArt, caveCeilingLoads, caveCeilingPlacement, caveShellArt,
} from '../src/render/caveShellArt';
import { CAVE_RULES, CAVE_SHAPES, caveShape, placeCave, type CaveArchetype } from '../src/data/sideCave';
import { WORLD } from '../src/data/balance';
import { GameModel } from '../src/systems/GameModel';
import { previewSideCave, SIDE_CAVE_FIXTURES } from '../src/dev/sideCavePreview';
import { entered, generationSignature, replaySignature } from './regressionSignature';
import sceneSource from '../src/scenes/GameScene.ts?raw';
import modelSource from '../src/systems/GameModel.ts?raw';
import generatorSource from '../src/systems/StageGenerator.ts?raw';

/**
 * SIDE CAVE CEILING STRIP. Four images from output/side-cave-ceiling-v1 (runtime/, byte for byte), one
 * per AREA, drawn on the cave's roof slabs in place of the procedural brick. Drawing only: the slabs are
 * sideCave.ts's, they stop nothing, and nothing about them -- or the entrance, backwall or contents -- moves.
 */

const { readFileSync, readdirSync } = await import(/* @vite-ignore */ 'node:' + 'fs') as { readFileSync: (path: URL) => Uint8Array; readdirSync: (path: URL) => string[] };
const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: Uint8Array | string) => { digest: (e: string) => string } } };
const { inflateSync } = await import(/* @vite-ignore */ 'node:' + 'zlib') as { inflateSync: (b: Uint8Array) => Uint8Array };
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };

const dir = new URL('../src/assets/cave-ceiling/', import.meta.url);
const bytes = (name: string) => readFileSync(new URL(name, dir));
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
/** Width, height and RGBA texels of one shipped image (8-bit RGBA, non-interlaced: what the files are). */
const decode = (name: string) => {
  const b = bytes(name), w = u32(b, 16), h = u32(b, 20), parts: Uint8Array[] = [];
  expect({ depth: b[24], colour: b[25], interlace: b[28] }, name).toEqual({ depth: 8, colour: 6, interlace: 0 });
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
  return { w, h, at: (x: number, y: number) => Array.from(px.slice((y * w + x) * 4, (y * w + x) * 4 + 4)) };
};

// SHA-256 of each runtime PNG as delivered, from output/side-cave-ceiling-v1/validation.json.
const DELIVERED: Record<string, string> = {
  'area1-cave-ceiling-strip.png': '7b8366a42a5d966827c165d364590886256a664a08083216ab296cbb06345f39',
  'area2-cave-ceiling-strip.png': '49bd5cac719725f987049fff564cbbd92c52b477520546458b58defc7f2aeb21',
  'area3-cave-ceiling-strip.png': '283d93d47cf5d145cb0939ed925bc03f5ffdc7400483fa6ae17e07777b0d48be',
  'area4-cave-ceiling-strip.png': '78c2a5e912a2a4be0df8d87fd898240834f6755e373da5baa11fd867c0a2005c',
};
const fileOf = (url: string) => url.split('/').pop()!.split('?')[0];
const ARCHETYPES: CaveArchetype[] = ['gunModule', 'shop', 'coinVein'];
const SIDES = [-1, 1] as const;
const fixtures = () => ARCHETYPES.flatMap(kind => SIDES.map(side =>
  placeCave(7, side, side === -1 ? WORLD.wall : WORLD.width - WORLD.wall, 1234, caveShape(kind, side), null)));
const caveCode = () => sceneSource.slice(sceneSource.indexOf('private sideCaves('), sceneSource.indexOf('private caveBackwall('));

describe('the four strips', () => {
  it('registers exactly the four, from src/assets/cave-ceiling, under keys of their own', () => {
    expect(readdirSync(dir).sort()).toEqual(Object.keys(DELIVERED).sort());
    const loads = caveCeilingLoads();
    expect(loads).toHaveLength(4);
    expect(new Set(loads.map(([key]) => key)).size).toBe(4);
    expect(loads.map(([, url]) => fileOf(url)).sort()).toEqual(Object.keys(DELIVERED).sort());
    expect(sceneSource).toContain('for (const [key, url] of caveCeilingLoads()) this.load.image(key, url);');
  });

  it('ships each byte for byte as delivered: SHA-256, 96x14, 8-bit RGBA, seamless left to right', () => {
    expect(CAVE_CEILING_GEOMETRY).toEqual({ width: 96, height: 14 });
    for (const [name, want] of Object.entries(DELIVERED)) {
      expect(sha256(bytes(name)), name).toBe(want);
      const img = decode(name);
      expect([img.w, img.h], name).toEqual([96, 14]);
      for (let y = 0; y < 14; y++) expect(img.at(0, y), `${name} row ${y}`).toEqual(img.at(95, y));
    }
  });
});

describe('AREA mapping and fallback', () => {
  it('gives AREA 1-4 each its own strip, and THE ABYSS none', () => {
    for (const area of CAVE_SHELL_AREAS) {
      expect(fileOf(CAVE_CEILING_ART[area])).toBe(`area${area}-cave-ceiling-strip.png`);
      expect(caveCeilingArt(area, () => true)).toBe(`cave-ceiling-area${area}`);
    }
    for (const other of ['staging', 'boss', 0, 5] as const) expect(caveCeilingArt(other, () => true)).toBeNull();
    // Only with the shell, and from the same art area the shell reads.
    expect(sceneSource).toContain('const ceiling = shell ? caveCeilingArt(artArea, exists) : null;');
  });

  it('falls back to the procedural roof alone: the AREA keeps its entrance and backwall, others keep their strips', () => {
    for (const area of CAVE_SHELL_AREAS) {
      const exists = (key: string) => key !== CAVE_CEILING_KEYS[area];
      expect(caveCeilingArt(area, exists)).toBeNull();
      expect(caveShellArt(area, exists)).toEqual(CAVE_SHELL_KEYS[area]);
      for (const other of CAVE_SHELL_AREAS.filter(a => a !== area)) expect(caveCeilingArt(other, exists)).toBe(CAVE_CEILING_KEYS[other]);
    }
    const caves = caveCode();
    for (const line of [
      'if (ceiling) { this.caveCeiling(roofs++, ceiling, cave, slab, cam, offsetX); continue; }',
      'this.rect(slab.x, slab.y - cam, slab.width, slab.height, theme.brick);',
      'this.rect(slab.x, slab.y - cam + slab.height - 2, slab.width, 2, theme.wallEdge, 0.8);',
    ]) expect(caves).toContain(line);
  });
});

describe('repeat and crop', () => {
  it('lays each strip on exactly its roof slab: 1:1, cropped at the end, mirrored on the left, fixed to the world', () => {
    for (const cave of fixtures()) for (const slab of cave.roof) {
      expect(slab.height).toBe(CAVE_RULES.slab);
      expect(slab.height).toBe(CAVE_CEILING_GEOMETRY.height);
      for (const cam of [0, 812.4, 1001.5, 1233.49]) {
        const at = caveCeilingPlacement(cave, slab, cam);
        expect(at).toEqual({ x: slab.x, y: Math.round(slab.y - cam), width: slab.width, height: 14, tileX: 0, flipX: cave.side === -1 });
      }
      // The texture column under world x: from the shaft-side end, 1:1, wrapping every 96 -- the same
      // for every camera, so the seams never move against the rock.
      const column = (worldX: number) => cave.side === -1 ? (slab.x + slab.width - 1 - worldX) % 96 : (worldX - slab.x) % 96;
      expect(column(cave.side === -1 ? slab.x + slab.width - 1 : slab.x)).toBe(0);
      expect(Math.ceil(slab.width / 96)).toBeLessThanOrEqual(3);
    }
    const body = sceneSource.slice(sceneSource.indexOf('private caveCeiling('), sceneSource.indexOf('private caveEntrance('));
    expect(body).toContain('.setSize(at.width, at.height).setTilePosition(at.tileX, 0).setFlipX(at.flipX)');
    expect(body).not.toMatch(/setScale|setDisplaySize/);
  });

  it('draws between the backwall and the entrance, where the procedural roof was in effect', () => {
    const create = sceneSource.slice(sceneSource.indexOf('this.worldBack = this.add.graphics();'), sceneSource.indexOf('this.afterBoss = this.add.graphics();'));
    const order = ['this.wallLayer =', 'this.caveBackLayer =', 'this.caveRoofLayer =', 'this.worldMid =', 'this.caveFrontLayer =', 'this.worldMidLate =', 'this.veinLayer =', 'this.platformLayer =', 'this.contentLayer ='];
    const at = order.map(s => create.indexOf(s));
    expect(at.every(i => i >= 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
});

describe('not a platform', () => {
  it('adds no platform, collision or surface: the roof slabs are only ever drawn', () => {
    for (const source of [modelSource, generatorSource]) expect(source).not.toMatch(/caveShellArt|caveCeiling|cave-shell|cave-ceiling/);
    for (const name of SIDE_CAVE_FIXTURES) {
      const g = new GameModel(false, seeded(11));
      previewSideCave(g, name);
      const cave = g.caves[0];
      for (const slab of cave.roof) for (const p of g.platforms) {
        const overlapX = p.x < slab.x + slab.width && p.x + p.width > slab.x;
        expect(overlapX && p.y >= slab.y && p.y < slab.y + slab.height, `${name} platform ${p.id}`).toBe(false);
      }
      // Every cave platform is a floor or a ledge, none at a roof's height.
      const caveFloors = g.platforms.filter(p => p.safeZone === cave.id).map(p => p.y).sort((a, b) => a - b);
      expect(caveFloors).toEqual(cave.floors.map(f => f.y).sort((a, b) => a - b));
    }
  });
});

describe('nothing but the drawing changes', () => {
  it('leaves the fixtures, the shell images and the content images byte for byte', () => {
    const placed = ARCHETYPES.flatMap(k => SIDES.map(side => placeCave(1, side, 0, 0, caveShape(k, side), null)));
    expect(sha256(JSON.stringify({ rules: CAVE_RULES, shapes: CAVE_SHAPES, placed }))).toBe('3addd1db2fef6ed131dd5a4302b60fe82bc2947e5e8e24e1b9c7348bc2ae59c0');
    const shellDir = new URL('../src/assets/cave-shell/', import.meta.url);
    expect(readdirSync(shellDir).sort().map(f => `${f}:${sha256(readFileSync(new URL(f, shellDir))).slice(0, 16)}`)).toEqual([
      'area1-cave-backwall.png:507bb9d17cc4a8ad', 'area1-cave-entrance.png:b712ec0431e55dc1',
      'area2-cave-backwall.png:e38879e2909f57e5', 'area2-cave-entrance.png:c5426dd08e042871',
      'area3-cave-backwall.png:a1702621015ff6b9', 'area3-cave-entrance.png:52dbf1829fe9dd49',
      'area4-cave-backwall.png:0409f140bc9873e7', 'area4-cave-entrance.png:7fc2cdcd3f44eeaa',
    ]);
    const content = new URL('../src/assets/content/', import.meta.url);
    expect(sha256(readdirSync(content).sort().map(f => sha256(readFileSync(new URL(f, content)))).join(''))).toBe(sha256([
      '8a1aff77c5ddc08d77ddc2bd0b56cb036c3cbc9d4118ddadbd121cd6ad1a8383', '66b60d8c0c99a88b3445bd69c767234664a4b6d708a4de5dfb7cc825380240d4',
      'd884967236aadfdd3dadd3bd4975204b8f62231d246bdf1a6e1db6eed4906e79', 'ba7a8771aa28d44e202397b1ac9f393fd2a3064778668acd4c91630b5b8710c8',
      '13ea37a7b471b889954d67ac4ca617679c6e6645abb9465af8017702fb0de6c5', '9bb8b964cbb0e723eac65df60dbeacd58bea727f4fb9fa68208c4cf530f428e1',
      '1127c64e0fd41e9e36b8d3100a4d11b3fade65c322677fa207d20d822916c48f', 'cba9e59b36dc0627a1c9a031c77282df5ba9375a78f140c13245c63fbfef13f8',
      '580766c9a044bbf193263a6e7ec49b064883f0f6631f919f14d3c762b6d4d6ac', 'dc028edcc6b85780117f109b29ff2cc2313e9d444ca880067e23447be2a1ce5c',
      'f0280f62edb9fe6a5e88104ab6df458f321bcc3a1e96bf68a54ebdc8b6090776',
    ].join('')));
  });

  it('keeps the shell itself as 54a5c3b drew it: backwall, entrance, dressing removal, light x0.25', () => {
    const caves = caveCode();
    for (const line of [
      'if (shell) this.caveBackwall(shells, shell.backwall, cave, cam, offsetX);',
      'if (shell) this.caveEntrance(shells++, shell.entrance, cave, cam, offsetX);',
      'const light = shell ? CAVE_SHELL_LIGHT : 1;',
    ]) expect(caves).toContain(line);
  });

  it('generates and plays AREA 1-4, THE ABYSS staging room and NIMUSHI exactly as ea3de3a did', () => {
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
