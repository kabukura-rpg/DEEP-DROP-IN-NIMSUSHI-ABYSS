import { describe, expect, it } from 'vitest';
import {
  CAVE_ENTRANCE_FRAMES, CAVE_SHELL_ART, CAVE_SHELL_AREAS, CAVE_SHELL_GEOMETRY, CAVE_SHELL_KEYS, CAVE_SHELL_LIGHT,
  caveBackwallPlacement, caveEntrancePlacement, caveShellArt, caveShellLoads,
} from '../src/render/caveShellArt';
import { CAVE_RULES, CAVE_SHAPES, caveShape, placeCave, type CaveArchetype } from '../src/data/sideCave';
import { environmentArtArea } from '../src/render/environmentArt';
import { WORLD } from '../src/data/balance';
import { GameModel } from '../src/systems/GameModel';
import { entered, generationSignature, replaySignature } from './regressionSignature';
import sceneSource from '../src/scenes/GameScene.ts?raw';
import modelSource from '../src/systems/GameModel.ts?raw';
import generatorSource from '../src/systems/StageGenerator.ts?raw';

/**
 * SIDE CAVE SHELL ART. Eight images from output/side-cave-shell-v1 (runtime/, byte for byte): an
 * entrance and a backwall for each of AREA 1-4. Drawing only -- the cave's opening, throat, chamber,
 * floors, roof, bounds and contents are sideCave.ts's and do not move, and the roof keeps its
 * procedural drawing.
 */

const { readFileSync, readdirSync } = await import(/* @vite-ignore */ 'node:' + 'fs') as { readFileSync: (path: URL) => Uint8Array; readdirSync: (path: URL) => string[] };
const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: Uint8Array | string) => { digest: (e: string) => string } } };
const { inflateSync } = await import(/* @vite-ignore */ 'node:' + 'zlib') as { inflateSync: (b: Uint8Array) => Uint8Array };
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };

const dir = new URL('../src/assets/cave-shell/', import.meta.url);
const bytes = (name: string) => readFileSync(new URL(name, dir));
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
/** Width, height and RGBA bytes of one shipped image (8-bit RGBA, non-interlaced: what the files are). */
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

// SHA-256 and canvas of each runtime PNG as delivered, from output/side-cave-shell-v1/validation.json.
const DELIVERED: Record<string, { sha256: string; size: [number, number] }> = {
  'area1-cave-entrance.png': { sha256: 'b712ec0431e55dc16a3a4e39dbb3747e18e7fb88b086aeab0ef818979b5c5d89', size: [52, 128] },
  'area1-cave-backwall.png': { sha256: '507bb9d17cc4a8adb6758c19c0e5c5ca7f20b670d371fd05c8621e1b211e7453', size: [96, 96] },
  'area2-cave-entrance.png': { sha256: 'c5426dd08e042871ef996835da384df7b2daab21f3071395b5bafca1429bc683', size: [52, 128] },
  'area2-cave-backwall.png': { sha256: 'e38879e2909f57e5fd1144acea4ce443e47e4e2f609fb138e6e29f97e1e80038', size: [96, 96] },
  'area3-cave-entrance.png': { sha256: '52dbf1829fe9dd4942a403ed23c20b8c06c4e7aa525415a0b6eaf259625c4489', size: [52, 128] },
  'area3-cave-backwall.png': { sha256: 'a1702621015ff6b995c7b6ad0dd7e17283acc350760d37d476f7b76e3a1a5027', size: [96, 96] },
  'area4-cave-entrance.png': { sha256: '7fc2cdcd3f44eeaa421ae8defc2b3f7f0e444d3c9fd3831c219d7f08a14901aa', size: [52, 128] },
  'area4-cave-backwall.png': { sha256: '0409f140bc9873e7d849ec9faba16f1a03132472f81e565305edb1c49d41b886', size: [96, 96] },
};
const fileOf = (url: string) => url.split('/').pop()!.split('?')[0];
const ARCHETYPES: CaveArchetype[] = ['gunModule', 'shop', 'coinVein'];
const SIDES = [-1, 1] as const;
/** Every fixture on its own wall, in world coordinates, at an arbitrary depth. */
const fixtures = () => ARCHETYPES.flatMap(kind => SIDES.map(side =>
  placeCave(7, side, side === -1 ? WORLD.wall : WORLD.width - WORLD.wall, 1234, caveShape(kind, side), null)));

describe('the eight images', () => {
  it('registers exactly the eight, from src/assets/cave-shell, under keys of their own', () => {
    expect(readdirSync(dir).sort()).toEqual(Object.keys(DELIVERED).sort());
    const loads = caveShellLoads();
    expect(loads).toHaveLength(8);
    expect(new Set(loads.map(([key]) => key)).size).toBe(8);
    expect(new Set(loads.map(([, url]) => url)).size).toBe(8);
    expect(loads.map(([, url]) => fileOf(url)).sort()).toEqual(Object.keys(DELIVERED).sort());
    expect(sceneSource).toContain('for (const [key, url] of caveShellLoads()) this.load.image(key, url);');
  });

  it('ships each byte for byte as delivered: SHA-256, canvas and 8-bit RGBA', () => {
    for (const [name, want] of Object.entries(DELIVERED)) {
      expect(sha256(bytes(name)), name).toBe(want.sha256);
      const img = decode(name);
      expect([img.w, img.h], name).toEqual(want.size);
    }
    expect(CAVE_SHELL_GEOMETRY.entrance).toMatchObject({ width: 52, height: 128 });
    expect(CAVE_SHELL_GEOMETRY.backwall).toEqual({ width: 96, height: 96 });
  });
});

describe('AREA mapping and fallback', () => {
  it('gives AREA 1-4 each its own pair, and THE ABYSS none', () => {
    for (const area of CAVE_SHELL_AREAS) {
      expect(fileOf(CAVE_SHELL_ART[area].entrance)).toBe(`area${area}-cave-entrance.png`);
      expect(fileOf(CAVE_SHELL_ART[area].backwall)).toBe(`area${area}-cave-backwall.png`);
      expect(caveShellArt(area, () => true)).toEqual({ entrance: `cave-shell-area${area}-entrance`, backwall: `cave-shell-area${area}-backwall` });
    }
    for (const other of ['staging', 'boss', 0, 5] as const) expect(caveShellArt(other, () => true)).toBeNull();
    // THE ABYSS's art area is never an AREA's, so a cave there could not take AREA 4's pair.
    const g = new GameModel(false, seeded(3));
    g.safeZoneVisitCount = 1;
    g.jumpToBoss();
    expect(environmentArtArea(g)).toBe('staging');
    expect(caveShellArt(environmentArtArea(g), () => true)).toBeNull();
    expect(g.caves).toHaveLength(0);
    expect(sceneSource).toContain('const shell = caveShellArt(artArea, exists);');
    expect(sceneSource).not.toMatch(/caveShellArt\([^)]*stage\.config\.id/);
  });

  it('keeps an AREA procedural when either of its images is missing, and never borrows another AREA\'s', () => {
    for (const area of CAVE_SHELL_AREAS) for (const part of ['entrance', 'backwall'] as const) {
      const missing = CAVE_SHELL_KEYS[area][part];
      const exists = (key: string) => key !== missing;
      expect(caveShellArt(area, exists)).toBeNull();
      for (const other of CAVE_SHELL_AREAS.filter(a => a !== area)) expect(caveShellArt(other, exists)).toEqual(CAVE_SHELL_KEYS[other]);
    }
    // The procedural shell is all still there, behind `shell`.
    const caves = sceneSource.slice(sceneSource.indexOf('private sideCaves('), sceneSource.indexOf('private caveBackwall('));
    for (const line of [
      'if (shell) this.caveBackwall(shells, shell.backwall, cave, cam, offsetX);',
      'this.rect(hollowX, top, hollowW, b.height, look.hollow, 0.99);',
      'this.rect(left ? hollowX : hollowX + hollowW - 8, top, 8, b.height, look.lining, 0.85);',
      'this.rect(x, top + 6, 2, b.height - 12, look.light, 0.05);',
      'else this.caveDressing(cave, look, hollowX, hollowW, top, b.height, cam);',
      'this.rect(frameX, oy - 8, frameW, 8, look.frame);',
      'this.rect(frameX, oy - 8, frameW, 2, look.light, 0.7);',
      'if (shell) this.caveEntrance(shells++, shell.entrance, cave, cam, offsetX);',
      "else if (look.style === 'rubble') {",
    ]) expect(caves).toContain(line);
  });
});

describe('entrance', () => {
  it('covers the procedural lintel\'s 52px, mirrored on the left wall, with the face stretched to the opening', () => {
    for (const cave of fixtures()) {
      const left = cave.side === -1, mouthX = left ? cave.opening.x + cave.opening.width : cave.opening.x;
      for (const cam of [0, 813.4, 1001.5, 1233.49]) {
        const at = caveEntrancePlacement(cave, cam);
        // The lintel's own span: frameX = mouthX - 30 (left) / mouthX - 22 (right), 52 wide.
        expect(at.x).toBe(left ? mouthX - 30 : mouthX - 22);
        expect(at.flipX).toBe(left);
        expect(at.faceY).toBe(Math.round(cave.opening.y - cam));
        expect(at.topY).toBe(at.faceY - 24);
        expect(at.faceHeight).toBe(cave.opening.height);
        expect(Number.isInteger(at.x) && Number.isInteger(at.topY) && Number.isInteger(at.faceY)).toBe(true);
      }
    }
    // The mirrored mouth anchor is the delivered one: column 22 of the image flipped is column 30.
    const { width, mouth } = CAVE_SHELL_GEOMETRY.entrance;
    expect(width - mouth.right).toBe(mouth.left);
    expect(CAVE_ENTRANCE_FRAMES).toEqual({ top: 'top', face: 'face' });
    expect(sceneSource).toContain('texture.add(CAVE_ENTRANCE_FRAMES.top, 0, 0, top.y, width, top.height);');
    expect(sceneSource).toContain('texture.add(CAVE_ENTRANCE_FRAMES.face, 0, 0, face.y, width, face.height);');
    expect(sceneSource).toContain('.setDisplaySize(width, at.faceHeight).setFlipX(at.flipX).setVisible(true);');
  });

  it('never paints over the way in: below the lip, only the 8px opening slot, on either wall', () => {
    for (const area of CAVE_SHELL_AREAS) {
      const img = decode(`area${area}-cave-entrance.png`);
      const { mouth, top, face } = CAVE_SHELL_GEOMETRY.entrance;
      for (let y = top.height; y < 128; y++) for (let x = 0; x < 52; x++) {
        const a = img.at(x, y)[3];
        if (y >= face.y + face.height) { expect(a, `area${area} (${x},${y}) under the sill`).toBe(0); continue; }
        // Right cave as authored: opaque only in [mouth, mouth + 8) -- the opening rectangle.
        if (a) expect(x >= mouth.right && x < mouth.right + 8, `area${area} (${x},${y})`).toBe(true);
      }
      // Mirrored, the same pixels land in the left cave's opening rectangle.
      for (const cave of fixtures()) {
        const at = caveEntrancePlacement(cave, 0);
        for (let y = face.y; y < face.y + face.height; y++) for (let x = 0; x < 52; x++) {
          if (!img.at(x, y)[3]) continue;
          const worldX = at.x + (at.flipX ? 51 - x : x);
          expect(worldX >= cave.opening.x && worldX < cave.opening.x + cave.opening.width, `area${area} ${cave.side}`).toBe(true);
        }
      }
    }
  });
});

describe('backwall', () => {
  it('tiles seamlessly: opaque, and each edge matches the opposite one', () => {
    for (const area of CAVE_SHELL_AREAS) {
      const img = decode(`area${area}-cave-backwall.png`);
      for (let i = 0; i < 96; i++) {
        expect(img.at(0, i), `area${area} row ${i}`).toEqual(img.at(95, i));
        expect(img.at(i, 0), `area${area} column ${i}`).toEqual(img.at(i, 95));
        for (let j = 0; j < 96; j++) expect(img.at(i, j)[3]).toBe(255);
      }
    }
  });

  it('fills exactly the procedural hollow, at 1:1, with the tiles pinned to the world', () => {
    for (const cave of fixtures()) {
      const left = cave.side === -1, b = cave.bounds, mouthX = left ? cave.opening.x + cave.opening.width : cave.opening.x;
      const hollowX = left ? b.x : mouthX, hollowW = left ? mouthX - b.x : b.x + b.width - mouthX;
      for (let k = 0; k < 40; k++) {
        const cam = 700 + k * 13.37;
        const at = caveBackwallPlacement(cave, cam);
        expect({ x: at.x, width: at.width, height: at.height, y: at.y }).toEqual({ x: hollowX, width: hollowW, height: b.height, y: Math.round(b.y - cam) });
        // The texel on screen row s is (s + round(cam)) mod 96 whatever the camera: fixed to the world.
        expect(((at.tileY - at.y - Math.round(cam)) % 96 + 96) % 96).toBe(0);
        expect(((at.tileX - at.x) % 96 + 96) % 96).toBe(0);
      }
    }
    // Never stretched: the tile strip is sized, not scaled.
    const body = sceneSource.slice(sceneSource.indexOf('private caveBackwall('), sceneSource.indexOf('private caveEntrance('));
    expect(body).toContain('.setSize(at.width, at.height).setTilePosition(at.tileX, at.tileY)');
    expect(body).not.toMatch(/setScale|setDisplaySize/);
  });
});

describe('draw order and light', () => {
  it('puts the backwall where the hollow was and the entrance where the lintel was', () => {
    const create = sceneSource.slice(sceneSource.indexOf('this.worldBack = this.add.graphics();'), sceneSource.indexOf('this.afterBoss = this.add.graphics();'));
    const order = ['this.wallLayer =', 'this.caveBackLayer =', 'this.worldMid =', 'this.caveFrontLayer =', 'this.worldMidLate =', 'this.veinLayer =', 'this.doodadLayer =', 'this.platformLayer =', 'this.worldFront =', 'this.contentLayer ='];
    const at = order.map(s => create.indexOf(s));
    expect(at.every(i => i >= 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // In draw(): the caves on worldMid, then everything that followed them on worldMidLate.
    const draw = sceneSource.slice(sceneSource.indexOf('private draw() {'));
    const steps = ['this.graphics = this.worldMid;', 'const veins = this.sideCaves(', 'this.graphics = this.worldMidLate;', 'for (const zone of m.safeZones) {', '// DOODADS: small fixtures', 'this.graphics = this.worldFront;'];
    const pos = steps.map(s => draw.indexOf(s));
    expect(pos.every(i => i >= 0), JSON.stringify(pos)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(sceneSource).toContain('this.worldMidLate.clear().setPosition(g.x, g.y);');
  });

  it('keeps the light out of the mouth in its colour and shape, only quieter under an entrance image', () => {
    // ea3de3a's values, unchanged: eight steps 0.085 .. 0.015 wide 8 .. 50, and the 0.5 line at the mouth.
    expect(sceneSource).toContain('this.rect(left ? mouthX : mouthX - w, oy + 8 + i * 2, w, o.height - 16 - i * 4, look.light, (0.085 - i * 0.01) * light);');
    expect(sceneSource).toContain('this.rect(left ? mouthX - 3 : mouthX, oy + 3, 3, o.height - 6, look.light, 0.5 * light);');
    expect(sceneSource).toContain('const light = shell ? CAVE_SHELL_LIGHT : 1;');
    expect(CAVE_SHELL_LIGHT).toBe(0.25);
  });
});

describe('nothing but the drawing changes', () => {
  it('leaves every SIDE CAVE fixture exactly as ea3de3a placed it', () => {
    // SHA-256 of { CAVE_RULES, CAVE_SHAPES, the six fixtures placed at mouth 0, sill 0 }, measured on ea3de3a.
    const placed = ARCHETYPES.flatMap(k => SIDES.map(side => placeCave(1, side, 0, 0, caveShape(k, side), null)));
    expect(sha256(JSON.stringify({ rules: CAVE_RULES, shapes: CAVE_SHAPES, placed }))).toBe('3addd1db2fef6ed131dd5a4302b60fe82bc2947e5e8e24e1b9c7348bc2ae59c0');
    // The opening heights the entrance face is stretched to (output/side-cave-shell-v1/geometry.json).
    expect(placed.map(c => c.opening.height)).toEqual([96, 98, 100, 104, 94, 92]);
    // No gameplay code knows the shell exists.
    for (const source of [modelSource, generatorSource]) expect(source).not.toMatch(/caveShell|cave-shell/);
  });

  it('keeps the COIN + SIDE CAVE content images byte for byte', () => {
    const content = new URL('../src/assets/content/', import.meta.url);
    const files = readdirSync(content).sort();
    expect(files).toHaveLength(11);
    const all = files.map(f => sha256(readFileSync(new URL(f, content)))).join('');
    // The eleven SHA-256s of ea3de3a's src/assets/content, in name order, hashed together.
    expect(sha256(all)).toBe(sha256([
      '8a1aff77c5ddc08d77ddc2bd0b56cb036c3cbc9d4118ddadbd121cd6ad1a8383', '66b60d8c0c99a88b3445bd69c767234664a4b6d708a4de5dfb7cc825380240d4',
      'd884967236aadfdd3dadd3bd4975204b8f62231d246bdf1a6e1db6eed4906e79', 'ba7a8771aa28d44e202397b1ac9f393fd2a3064778668acd4c91630b5b8710c8',
      '13ea37a7b471b889954d67ac4ca617679c6e6645abb9465af8017702fb0de6c5', '9bb8b964cbb0e723eac65df60dbeacd58bea727f4fb9fa68208c4cf530f428e1',
      '1127c64e0fd41e9e36b8d3100a4d11b3fade65c322677fa207d20d822916c48f', 'cba9e59b36dc0627a1c9a031c77282df5ba9375a78f140c13245c63fbfef13f8',
      '580766c9a044bbf193263a6e7ec49b064883f0f6631f919f14d3c762b6d4d6ac', 'dc028edcc6b85780117f109b29ff2cc2313e9d444ca880067e23447be2a1ce5c',
      'f0280f62edb9fe6a5e88104ab6df458f321bcc3a1e96bf68a54ebdc8b6090776',
    ].join('')));
  });

  it('generates and plays AREA 1-4, THE ABYSS staging room and NIMUSHI exactly as ea3de3a did', () => {
    // The goldens tests/contentArt.test.ts holds (measured on cb5912d, unchanged at 4e5535c and ea3de3a).
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
