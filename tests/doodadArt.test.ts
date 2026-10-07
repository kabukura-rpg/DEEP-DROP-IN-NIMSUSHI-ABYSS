import { describe, expect, it } from 'vitest';
import {
  COLLAPSE_FRAMES, DOODAD_FRAMES, DOODAD_VARIANTS, ENVIRONMENT_ART, ENVIRONMENT_GEOMETRY, collapseArt, doodadArt, doodadFrame, doodadPlacement,
  environmentArtArea, environmentKeys, environmentLoads,
} from '../src/render/environmentArt';
import { DOODAD_RULES, spawnDoodad } from '../src/data/doodads';
import { BALANCE, WORLD } from '../src/data/balance';
import { UPGRADE_TUNING } from '../src/data/upgrades';
import { GameModel } from '../src/systems/GameModel';
import { entered, generationSignature, replaySignature } from './regressionSignature';
import { intoTheAbyss, tick } from './nimushi';
import { ABYSS } from '../src/data/abyss';
import sceneSource from '../src/scenes/GameScene.ts?raw';

/**
 * DOODAD ART FINAL INTEGRATION. Every DOODAD of AREA 1-4 is drawn from its AREA's own 44x21 image, per
 * variant (lamp, bracket) and per the state the model already has (`active` true / false), with row 9
 * on the doodad's top face. AREA 1-2 are output/doodad-art-area1-4-v1; AREA 3-4 are the readability
 * revision output/doodad-art-area3-4-readability-v2. Drawing only: no geometry, collision, bounce,
 * reload, generation or state is touched, and THE ABYSS (staging room, arena) carries none.
 */

const { readFileSync } = await import(/* @vite-ignore */ 'node:' + 'fs') as { readFileSync: (path: URL) => Uint8Array };
const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: Uint8Array) => { digest: (e: string) => string } } };
const { inflateSync } = await import(/* @vite-ignore */ 'node:' + 'zlib') as { inflateSync: (b: Uint8Array) => Uint8Array };
const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };

const file = (area: number, variant: string, frame: string) => `area${area}-doodad-${variant}-${frame}.png`;
const bytes = (area: number, name: string) => readFileSync(new URL(`../src/assets/environment/area${area}/${name}`, import.meta.url));
/** Width, height, bit depth, colour type (6 = RGBA) and SHA-256 of one shipped image. */
const png = (area: number, name: string) => {
  const b = bytes(area, name);
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  return { size: [u32(16), u32(20)], depth: b[24], colour: b[25], sha256: createHash('sha256').update(b).digest('hex') };
};
/** The alpha of one image, row by row (8-bit RGBA, non-interlaced: what the files are). */
const alpha = (area: number, name: string) => {
  const b = bytes(area, name);
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const w = u32(16), h = u32(20), parts: Uint8Array[] = [];
  for (let o = 8; o < b.length;) { const len = u32(o), type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]); if (type === 'IDAT') parts.push(b.slice(o + 8, o + 8 + len)); o += 12 + len; }
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

// SHA-256 of each runtime PNG as delivered, from each folder's review/validation.json.
const V1: Record<string, string> = {
  'area1-doodad-lamp-active.png': '578bbe5cacb7355bf84edca54447aeefcfefeada3a2416e39be6ca7413987031',
  'area1-doodad-lamp-spent.png': '73bccba4c8c03986e183c27d1946b3acf6728041777575ae12d3182bad54a9ce',
  'area1-doodad-bracket-active.png': 'b0d418411672c0bea736bf2921b7349190ba4302f405034c58ebc5249b501647',
  'area1-doodad-bracket-spent.png': '7a0c1b8bd2640fcf9438f86da3b2a1099b8fec9d77157697937d0f18c97736f8',
  'area2-doodad-lamp-active.png': '03695da3ef43c756b11874122620208bd24ff18d3f20b610459037acd47b3e92',
  'area2-doodad-lamp-spent.png': '2134f50a868743bc28931b8a0e2324be29a6e23c90d3fca400002e3f334b91bc',
  'area2-doodad-bracket-active.png': 'fff35cdaeacb891e49256cb1c82852bce0969693fca2959090e149ed34330a55',
  'area2-doodad-bracket-spent.png': '217a3452cac8c85014aed9659af2e6e0b1e005de3ad6e8ff238094b4be579498',
  // V1's AREA 3/4, superseded by V2: kept here only to prove they are NOT what ships.
  'area3-doodad-lamp-active.png': '34abdf580bfcae6ddee289fbb5cd1643e248087abd41abb78efac047a3f19f6a',
  'area3-doodad-lamp-spent.png': '281dc657d35c9157ab43bdab2b1308503deb0956b3dfaeb2f8842019f9bbe141',
  'area3-doodad-bracket-active.png': 'a3af01bbae332e693a3e3cac172cc877a28be7a0fe873a736ebed422c723f4e0',
  'area3-doodad-bracket-spent.png': 'c2a0286c3bbcd8e947e7cc4be084106a762fe2698bbf19dcf495908b5020faea',
  'area4-doodad-lamp-active.png': '3f500fa6af38bbea83df1525c25804d47b9472fca6fa3024a969ddf8dd63fa7f',
  'area4-doodad-lamp-spent.png': '80e415d7f84769c0fbb1cdfb282d3e885db7d6505df4e89c438c16c775e24723',
  'area4-doodad-bracket-active.png': '2fe3382bdf230e92fe59ddef14c0c3984a5c6d6a66ab7e039ee566d427e0c7d8',
  'area4-doodad-bracket-spent.png': '503f9246b3fc7aaf0338193f90e23d97b1f2d5b479fe06be15dd53d5929f14da',
};
const V2: Record<string, string> = {
  'area3-doodad-lamp-active.png': 'b1a0d3b8bd154812db5d8f29aeaea52396284f96094b20c02c3dfed13958ecb1',
  'area3-doodad-lamp-spent.png': 'bfeab098c7cb1d3f6990589767150bcec8aae7e24249200f7f776184f7469b82',
  'area3-doodad-bracket-active.png': '5f750d1e0af8d079e0c6fd7119dffcbd093ecef5dcd118d76155eed3de5d056b',
  'area3-doodad-bracket-spent.png': '7a4703746be2d1fe0351979f20f8827d42ee75d6cef63dc9dca8e1b65463dce1',
  'area4-doodad-lamp-active.png': 'a2c94f896d0a8915e68aa637515c2c17e4857837ac856066e73695571e4e2422',
  'area4-doodad-lamp-spent.png': 'adbe4c386963cac321740f234f6b02006fb94564230611e8c4495dcb0a10fde5',
  'area4-doodad-bracket-active.png': 'fc082361058f062789f8e3a2b23dba3e70e3d907fdeb6c58a1d654506d1054a5',
  'area4-doodad-bracket-spent.png': '3a8c1644b12ba272c65aeef0bcd22d4a378675c4110c91f7f540c07f9b8555a0',
};
const AREAS = [1, 2, 3, 4] as const;

describe('DOODAD images', () => {
  it('registers the final sixteen: AREA 1-4 x lamp/bracket x active/spent, each under its own AREA', () => {
    const urls: string[] = [];
    for (const area of AREAS) {
      const set = ENVIRONMENT_ART[area]!.doodad!;
      expect(Object.keys(set)).toEqual(['lamp', 'bracket']);
      for (const variant of DOODAD_VARIANTS) {
        expect(Object.keys(set[variant])).toEqual(['active', 'spent']);
        for (const frame of DOODAD_FRAMES) {
          const url = set[variant][frame];
          expect(url).toMatch(new RegExp(`environment/area${area}/area${area}-doodad-${variant}-${frame}\\.png`));
          expect(url).not.toMatch(/(^|\/)(output|dist)\//);
          urls.push(url);
        }
      }
      // Loaded after the AREA's terrain, under keys of its own.
      expect(environmentLoads(area, ENVIRONMENT_ART[area]!).slice(-4)).toEqual(
        DOODAD_VARIANTS.flatMap(v => DOODAD_FRAMES.map(f => [`env-${area}-doodad-${v}-${f}`, set[v][f]])),
      );
    }
    expect(new Set(urls).size).toBe(16);
    const keys = AREAS.flatMap(area => DOODAD_VARIANTS.flatMap(v => DOODAD_FRAMES.map(f => environmentKeys(area).doodad[v][f])));
    expect(new Set(keys).size).toBe(16);
  });

  it('ships AREA 1-2 byte for byte from V1, and AREA 3-4 byte for byte from the V2 readability revision', () => {
    for (const area of AREAS) for (const variant of DOODAD_VARIANTS) for (const frame of DOODAD_FRAMES) {
      const name = file(area, variant, frame), { sha256 } = png(area, name);
      if (area <= 2) expect({ name, sha256 }).toEqual({ name, sha256: V1[name] });
      else {
        expect({ name, sha256 }).toEqual({ name, sha256: V2[name] });
        expect(sha256).not.toBe(V1[name]);
      }
    }
  });

  it('is 44x21 RGBA, alpha 0/255 only, row 9 opaque across all 44 columns, a bracket empty above it', () => {
    const { width, height, surfaceRow } = ENVIRONMENT_GEOMETRY.doodad;
    expect({ width, height, surfaceRow }).toEqual({ width: 44, height: 21, surfaceRow: 9 });
    for (const area of AREAS) for (const variant of DOODAD_VARIANTS) for (const frame of DOODAD_FRAMES) {
      const name = file(area, variant, frame);
      const { size, depth, colour } = png(area, name);
      expect({ name, size, depth, colour }).toEqual({ name, size: [44, 21], depth: 8, colour: 6 });
      const a = alpha(area, name);
      expect(a.flat().every(v => v === 0 || v === 255), name).toBe(true);
      expect(a[surfaceRow].every(v => v === 255), name).toBe(true);
      if (variant === 'bracket') for (let row = 0; row < surfaceRow; row++) expect(a[row].every(v => v === 0), `${name} row ${row}`).toBe(true);
    }
  });

  it('puts row 9 on the doodad\'s top face: the body rows 9-20 are exactly its 44x12 collision box', () => {
    const { width, height, surfaceRow } = ENVIRONMENT_GEOMETRY.doodad;
    expect({ width: DOODAD_RULES.width, height: DOODAD_RULES.height }).toEqual({ width, height: height - surfaceRow });
    const d = spawnDoodad(1, 137, 2210, 'lamp', true);
    const at = doodadPlacement(d.x, d.y);
    expect(at).toEqual({ x: d.x, y: d.y - 9 });
    expect(at.y + surfaceRow).toBe(d.y);
    expect(at.y + height).toBe(d.y + d.height);
    expect(at.x + width).toBe(d.x + d.width);
    // The scene draws it there, rounded the way the procedural doodad's rect is.
    expect(sceneSource).toContain('const at = doodadPlacement(Math.round(d.x), Math.round(y));');
    expect(sceneSource).toContain('img.setTexture(texture).setPosition(offsetX + at.x, at.y).setVisible(true);');
  });

  it('maps lamp to lamp and bracket to bracket, `active` true to active and false to spent -- and nothing else', () => {
    expect(doodadFrame({ active: true })).toBe('active');
    expect(doodadFrame({ active: false })).toBe('spent');
    for (const area of AREAS) {
      const keys = doodadArt(area, () => true)!;
      for (const variant of DOODAD_VARIANTS) for (const active of [true, false]) {
        const d = spawnDoodad(1, 100, 100, variant, true); d.active = active;
        expect(keys[d.variant][doodadFrame(d)]).toBe(`env-${area}-doodad-${variant}-${active ? 'active' : 'spent'}`);
      }
    }
    expect(sceneSource).toContain('const texture = art[d.variant][doodadFrame(d)];');
  });

  it('is picked by environmentArtArea: each AREA its own, THE ABYSS none', () => {
    for (const area of AREAS) {
      const g = new GameModel(false, seeded(area * 31)); g.jumpToStage(area, 1);
      expect(environmentArtArea(g)).toBe(area);
      expect(doodadArt(environmentArtArea(g), () => true)!.lamp.active).toBe(`env-${area}-doodad-lamp-active`);
    }
    expect(sceneSource).toContain('const doodadKeys = doodadArt(artArea, key => this.textures.exists(key));');
    expect(sceneSource).not.toMatch(/doodadArt\([^)]*stage\.config\.id/);
  });
});

describe('DOODAD procedural fallback', () => {
  it('keeps the procedural drawing when any one of an AREA\'s four images is missing', () => {
    for (const area of AREAS) {
      expect(doodadArt(area, () => true)).not.toBeNull();
      for (const variant of DOODAD_VARIANTS) for (const frame of DOODAD_FRAMES) {
        const missing = environmentKeys(area).doodad[variant][frame];
        expect(doodadArt(area, key => key !== missing)).toBeNull();
      }
    }
    expect(doodadArt(0, () => true)).toBeNull();
    // The procedural doodad is still there, unchanged, after the image branch.
    expect(sceneSource).toContain('if (doodadKeys) { this.doodadArt(doodadImages++, doodadKeys, d, dy, g.x); continue; }');
    expect(sceneSource).toContain('this.rect(d.x, dy, d.width, d.height, 0x4a4232);');
    expect(sceneSource).toContain('this.rect(d.x, dy, d.width, 3, 0xd8c88a);');
    expect(sceneSource).toContain('for (let i = doodadImages; i < this.doodadImages.length; i++) this.doodadImages[i].setVisible(false);');
  });
});

describe('THE ABYSS: no DOODAD image', () => {
  it('the staging room and the arena carry none, so AREA 4\'s images cannot fall through', () => {
    expect(ENVIRONMENT_ART.staging!.doodad).toBeUndefined();
    expect(ENVIRONMENT_ART.boss!.doodad).toBeUndefined();
    for (const id of ['staging', 'boss'] as const) {
      expect(doodadArt(id, () => true)).toBeNull();
      expect(environmentLoads(id, ENVIRONMENT_ART[id]!).some(([key]) => key.includes('doodad'))).toBe(false);
    }
    // In the staging room the run's AREA is still 4; the set is read off the state first.
    const g = new GameModel(false, seeded(10)); g.jumpToBoss();
    expect(g.stage.config.id).toBe(4);
    expect(environmentArtArea(g)).toBe('staging');
    expect(doodadArt(environmentArtArea(g), () => true)).toBeNull();
    expect(g.doodads).toHaveLength(0);
    intoTheAbyss(g);
    expect(doodadArt(environmentArtArea(g), () => true)).toBeNull();
    tick(g, ABYSS.hold + ABYSS.reverse + 0.1);
    expect(g.abyssStage).toBe('fight');
    expect(environmentArtArea(g)).toBe('boss');
    expect(doodadArt(environmentArtArea(g), () => true)).toBeNull();
  });
});

describe('nothing but the DOODAD drawing changes', () => {
  it('leaves AREA 4\'s collapse art exactly as it was: nine images, same keys, same selection', () => {
    const COLLAPSE_SHA: Record<string, string> = {
      'area4-collapse-stable-left-cap.png': 'ea1dac84f3694e4bfa77ab2c503bc9924cf639de6f0091450542713ac5527e95',
      'area4-collapse-stable-center.png': 'c0c526ea22e06ddd9559293f72425880a5f19dc94b7e7eb739c66cb5fc0412e8',
      'area4-collapse-stable-right-cap.png': 'd37f4393f67bf22b8cbda4b6726a8bd11e7b60a5ba863e84d3ed385b2b03514e',
      'area4-collapse-cracking-left-cap.png': 'a68681fb677e892048fc6f57fc76f29b0797eac541e2c44ca5bc216e2314ecce',
      'area4-collapse-cracking-center.png': 'd35689c527ced8731972226ee39b47da7a5bed1d67b6d94b4ae97b3587ec3aaf',
      'area4-collapse-cracking-right-cap.png': '21fe057b68078c0eabe20d6401903e5abab23763b2aeaef93f051ffd87bbc459',
      'area4-collapse-critical-left-cap.png': 'ffb25fb88a5d3af2474f5fd16eba4f76e44b89f4e8036071866e0bbb6cc121d3',
      'area4-collapse-critical-center.png': '8d6697b86d408fcc7d2169b9b3522399687867df5b2c6f31b7891a7553acf9fb',
      'area4-collapse-critical-right-cap.png': '39d5f4cf7f4b44ebfe63bb5ca2d00394be1ada39059b8aa8a6d55a4630112696',
    };
    for (const [name, sha256] of Object.entries(COLLAPSE_SHA)) expect({ name, sha256: png(4, name).sha256 }).toEqual({ name, sha256 });
    const keys = collapseArt(4, () => true)!;
    for (const frame of COLLAPSE_FRAMES) expect(keys[frame]).toEqual({ left: `env-4-collapse-${frame}-left`, center: `env-4-collapse-${frame}-center`, right: `env-4-collapse-${frame}-right` });
    expect(sceneSource).toContain('if (collapse && frame) { this.ledgeArt(ledges++, collapse[frame], f.x, y, f.width, g.x); continue; }');
  });

  it('generates and plays AREA 1-4 and THE ABYSS exactly as cb5912d did', () => {
    // Golden values measured on cb5912d itself (feature/area4-collapse-art) with tests/regressionSignature.ts.
    const golden = {
      1: ['b9975efcb9fbe4b2006cba4e', '414b1f52261b82c067509d92', '22ddb6304f988ed56d4538e5', '683c2598a46b4eadcc576b35'],
      2: ['55c8866f29f3d7527c3b513d', '95ebcdc29407d78501ec1a47', 'f5d50c7e36c05e33c315524d', 'e5f4c74110599c23f5ad5b62'],
      3: ['d748a265cf1731ae185f93cb', 'd813e6aa01f3d20ed9e034a4', '27a110a2880f9aaaafae8a08', 'b1c14c441b457f2baa84336f'],
      4: ['8fe90e6d6d4574a2e2ac7acf', '1e76e850a940069cb736eecc', '7c1a7fd3289e1612548469c1', 'b168d91ecea486a17fcc5fbf'],
    } as const;
    for (const area of AREAS) {
      expect(generationSignature(area), `AREA ${area} generation`).toBe(golden[area][0]);
      for (const section of [1, 2, 3] as const) expect(replaySignature(entered(g => g.jumpToStage(area, section))), `AREA ${area}-${section}`).toBe(golden[area][section]);
    }
    expect(replaySignature(entered(g => g.jumpToBoss()))).toBe('8e287a848cb425a8029c5f2c');
    expect(replaySignature(entered(g => { g.jumpToNimushi(); }))).toBe('26ccd33dc5a34ba1e36f989c');
  });

  it('keeps the DOODAD rules: 44x12, bounce 210, consumable', () => {
    expect(DOODAD_RULES).toEqual({ bounce: 210, width: 44, height: 12 });
    expect(BALANCE.bounce).toBe(210);
    // Every doodad a real AREA 1-4 SECTION lays is consumable, and starts active.
    for (const area of AREAS) {
      const g = new GameModel(false, seeded(area * 97)); g.jumpToStage(area, 2);
      for (let i = 0; i < 60; i++) { g.player.invincible = 99; g.player.y = WORLD.startY + i * 6 * WORLD.pixelsPerMeter; g.step(1 / 120, 0, false); if (g.doodads.length) break; }
      expect(g.doodads.length, `AREA ${area}`).toBeGreaterThan(0);
      for (const d of g.doodads) expect({ w: d.width, h: d.height, consumable: d.consumable }).toEqual({ w: 44, h: 12, consumable: true });
    }
  });

  it('a real bounce in each AREA: launch 210, full CHARGE, jetpack refilled, chain kept, coin, RELOADED -- then spent, and the second pass does nothing', () => {
    for (const area of AREAS) {
      const g = new GameModel(false, seeded(area * 13)); g.jumpToStage(area, 1);
      g.platforms = []; g.enemies = []; g.pickups = []; g.hazards = []; g.safeZones = []; g.caves = [];
      g.player.x = 225; g.player.y = WORLD.startY + 400; g.player.vy = 0; g.player.grounded = -1;
      const d = spawnDoodad(900, g.player.x - DOODAD_RULES.width / 2, g.player.y + 40, area % 2 ? 'lamp' : 'bracket', true);
      g.doodads = [d];
      g.ammo = 1; g.combo = 5; g.jetpackFuel = 0; g.events.length = 0;
      const coinsBefore = g.coins.coins.length;
      expect(doodadFrame(d)).toBe('active');
      g.player.vy = 300;
      let bounced = false;
      for (let i = 0; i < 60 && !bounced; i++) { g.step(1 / 120, 0, false); bounced = g.events.some(e => e.type === 'doodad'); }
      expect(bounced, `AREA ${area}`).toBe(true);
      expect(g.player.vy).toBeCloseTo(-DOODAD_RULES.bounce, 6);
      expect(g.ammo).toBe(g.stats.maxAmmo);
      expect(g.jetpackFuel).toBe(UPGRADE_TUNING.safetyJetpack.fuelSeconds);
      expect(g.combo).toBe(5);
      expect(g.events.some(e => e.type === 'kill')).toBe(false);
      expect(g.coins.coins.length).toBe(coinsBefore + 1);
      // The model's own state flips, and the drawing reads it: spent from here on.
      expect(d.active).toBe(false);
      expect(doodadFrame(d)).toBe('spent');
      expect(g.doodads).toContain(d);
      // Back onto it: no second bounce, no reload.
      g.events.length = 0; g.ammo = 1;
      g.player.y = d.y - 90; g.player.vy = 300;
      tick(g, 0.3);
      expect(g.events.some(e => e.type === 'doodad')).toBe(false);
      expect(g.ammo).toBe(1);
      expect(doodadFrame(d)).toBe('spent');
    }
    // RELOADED, the burst and the land note are the scene's response to that one event, unchanged.
    expect(sceneSource).toContain("if (event.type === 'doodad') { this.burst(event.x, event.y, 0xb9ef70, 10); this.label(event.x, event.y - 20, 'RELOADED', '#b9ef70', 12); }");
  });
});
