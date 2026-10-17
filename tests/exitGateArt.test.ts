import { describe, expect, it } from 'vitest';
import { EXIT_GATE_ART, EXIT_GATE_GEOMETRY, EXIT_GATE_KEY, exitGateArt, exitGateLoads, exitGatePlacement } from '../src/render/exitGateArt';
import { EXIT_RULES } from '../src/data/structures';
import { WORLD } from '../src/data/balance';
import { GameModel } from '../src/systems/GameModel';
import type { AreaId, SectionId } from '../src/data/areas';
import { reachExit, clearViaExit } from './exitHelper';
import { entered, generationSignature, replaySignature } from './regressionSignature';
import sceneSource from '../src/scenes/GameScene.ts?raw';
import mainSource from '../src/main.ts?raw';
import modelSource from '../src/systems/GameModel.ts?raw';
import generatorSource from '../src/systems/StageGenerator.ts?raw';
import structuresSource from '../src/data/structures.ts?raw';
import balanceSource from '../src/data/balance.ts?raw';
import progressionSource from '../src/systems/StageProgressionSystem.ts?raw';
import areasSource from '../src/data/areas.ts?raw';

/**
 * SECTION EXIT GATE ART. One image, output/exit-gate-occlusion-v3/exit-gate-common-v3.png byte for
 * byte (A / ANCIENT LIFT GATE with the V3 upper cues), shared by AREA 1-4, laid 1:1 on the StageExit
 * rectangle in place of the procedural mint gate. Drawing only: where the gate stands, its floor, the trigger, SECTION CLEAR,
 * the REST point and the next SECTION are exactly cc578bf's.
 */

const { readFileSync, readdirSync } = await import(/* @vite-ignore */ 'node:' + 'fs') as { readFileSync: (path: URL) => Uint8Array; readdirSync: (path: URL) => string[] };
const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: Uint8Array | string) => { digest: (e: string) => string } } };
const { inflateSync } = await import(/* @vite-ignore */ 'node:' + 'zlib') as { inflateSync: (b: Uint8Array) => Uint8Array };
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };

const dir = new URL('../src/assets/exit/', import.meta.url);
const NAME = 'exit-gate-common.png';
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
const AREAS = [1, 2, 3, 4] as const;
const SECTIONS = [1, 2, 3] as const;
const exitDraw = () => sceneSource.slice(sceneSource.indexOf('// The way out: a gate standing on the floor'), sceneSource.indexOf('// Every doorway this SECTION has'));

describe('the image', () => {
  it('registers exactly one, from src/assets/exit, under its own key', () => {
    expect(readdirSync(dir)).toEqual([NAME]);
    expect(exitGateLoads()).toEqual([[EXIT_GATE_KEY, EXIT_GATE_ART]]);
    expect(fileOf(EXIT_GATE_ART)).toBe(NAME);
    expect(sceneSource).toContain('for (const [key, url] of exitGateLoads()) this.load.image(key, url);');
  });

  it('ships byte for byte as delivered: SHA-256, 86x74, 8-bit RGBA, alpha 0/255, 21 colours', () => {
    // From output/exit-gate-occlusion-v3/validation.json (sha256).
    expect(sha256(bytes())).toBe('625be5af94667c005de54ccd41643f7ab16cc93849d0fb36f287ce124176ac52');
    const { w, h, px } = decode();
    expect([w, h]).toEqual([86, 74]);
    const alphas = new Set<number>(), colours = new Set<string>();
    let transparent = 0;
    for (let i = 0; i < px.length; i += 4) {
      alphas.add(px[i + 3]); colours.add(`${px[i]},${px[i + 1]},${px[i + 2]},${px[i + 3]}`);
      if (px[i + 3] === 0) transparent++;
    }
    expect([...alphas].sort((a, b) => a - b)).toEqual([0, 255]);
    // 20 opaque colours plus transparent black (validation.json format / edit.opaquePaletteCount).
    expect(colours.size).toBe(21);
    expect(transparent).toBe(655);
  });

  it('is the gate\'s own footprint: the StageExit the model tests against, 86x74', () => {
    expect(EXIT_GATE_GEOMETRY).toEqual({ width: 86, height: 74 });
    expect(EXIT_RULES.width).toBe(EXIT_GATE_GEOMETRY.width);
    expect(EXIT_RULES.height).toBe(EXIT_GATE_GEOMETRY.height);
  });
});

describe('AREA mapping', () => {
  it('draws the same image on every AREA\'s gate, chosen by nothing but whether it loaded', () => {
    for (const area of AREAS) for (const section of SECTIONS) {
      const g = new GameModel(false, seeded(area * 31 + section));
      g.jumpToStage(area as AreaId, section as SectionId);
      const gate = reachExit(g);
      expect(g.stage.config.id, `${area}-${section}`).toBe(area);
      expect([gate.width, gate.height]).toEqual([86, 74]);
      expect(exitGateArt(() => true)).toBe(EXIT_GATE_KEY);
    }
    // No AREA, theme or tint goes into the choice or the drawing.
    expect(sceneSource).toContain('const exitKey = exitGateArt(exists);');
    expect(exitDraw()).not.toMatch(/setTint|artArea|config\.id|theme/);
  });

  it('lays the image 1:1 on the rectangle the procedural gate filled: top-left at the gate, bottom on its floor', () => {
    for (const area of AREAS) {
      const g = new GameModel(false, seeded(area * 7));
      g.jumpToStage(area as AreaId, 1);
      const gate = reachExit(g);
      const floor = g.platforms.find(p => p.y === gate.y + gate.height && p.x === WORLD.wall);
      expect(floor, `AREA ${area} exit floor`).toBeDefined();
      for (const cam of [gate.y - 480, gate.y - 480.5, gate.y - 700.25, gate.y - 12.75]) {
        const at = exitGatePlacement(gate, cam);
        expect(at).toEqual({ x: Math.round(gate.x), y: Math.round(gate.y - cam) });
        expect(Number.isInteger(at.x) && Number.isInteger(at.y)).toBe(true);
      }
    }
    const draw = exitDraw();
    expect(draw).toContain('this.exitArt.setTexture(exitKey).setPosition(g.x + at.x, at.y).setVisible(true);');
    // Native size, never stretched to fit.
    expect(draw).not.toMatch(/setScale|setDisplaySize|setSize|setCrop/);
    expect(sceneSource).toContain("this.exitArt = this.add.image(0, 0, '__MISSING').setOrigin(0).setVisible(false);");
    // Nearest-neighbour, as every image in the game: the canvas is created pixelArt, without antialias.
    expect(mainSource).toContain('pixelArt: true, antialias: false');
  });
});

describe('THE ABYSS has no SECTION EXIT', () => {
  it('lays no gate in the staging room, the inversion or the fight, so the image never shows there', () => {
    const staging = new GameModel(false, seeded(5));
    staging.jumpToBoss();
    expect(staging.abyssStage).toBe('staging');
    for (let i = 0; i < 120 * 6; i++) { staging.player.invincible = 99; staging.step(1 / 120, 0, false); expect(staging.exit).toBeNull(); }
    const fight = new GameModel(false, seeded(6));
    fight.jumpToNimushi();
    for (let i = 0; i < 120 * 6; i++) { fight.player.invincible = 99; fight.step(1 / 120, 0, false); expect(fight.exit).toBeNull(); }
    // Through 4-3's gate itself: NEXT opens the staging room, and the gate goes with the SECTION.
    const run = new GameModel(false, seeded(7));
    run.jumpToStage(4, 3);
    clearViaExit(run);
    expect(run.abyssStage).toBe('staging');
    expect(run.exit).toBeNull();
    // The image is drawn only for the model's gate; with none it is hidden.
    expect(exitDraw()).toContain('if (!exitShown) this.exitArt.setVisible(false);');
  });
});

describe('fallback', () => {
  it('keeps the procedural gate for a missing image, and only then; never another image', () => {
    expect(exitGateArt(() => false)).toBeNull();
    expect(exitGateArt(key => key !== EXIT_GATE_KEY)).toBeNull();
    const draw = exitDraw();
    const image = draw.indexOf('if (ey > -120 && ey < 860 && exitKey) {');
    const procedural = draw.indexOf('} else if (ey > -120 && ey < 860) {');
    expect(image).toBeGreaterThan(0);
    expect(procedural).toBeGreaterThan(image);
    // The procedural gate, exactly as cc578bf drew it, in the else branch.
    for (const line of [
      'const pulse = 0.5 + Math.abs(Math.sin(this.model.elapsed * 2.4)) * 0.3;',
      'this.rect(e.x - 6, ey - 6, e.width + 12, e.height + 12, 0x7de8b0, 0.12 * pulse);',
      'this.rect(e.x, ey, e.width, e.height, 0x0e1a16, 0.96);',
      'this.graphics.lineStyle(3, 0x7de8b0, 0.95).strokeRect(e.x, ey, e.width, e.height);',
      'for (let i = 0; i < 5; i++) this.rect(e.x + 10, ey + 12 + i * 12, e.width - 20, 3, 0x7de8b0, 0.16 + i * 0.07);',
      "this.label2(e.x + e.width / 2, ey + e.height / 2, 'EXIT');",
    ]) expect(draw.indexOf(line), line).toBeGreaterThan(procedural);
    // No other image key in the gate's drawing.
    expect(draw.match(/setTexture\(([^)]*)\)/g)).toEqual(['setTexture(exitKey)']);
  });
});

describe('draw order', () => {
  it('keeps the gate where it was: after the ledges, hazards and pickups, under TIMEVOID and the content images', () => {
    const create = sceneSource.slice(sceneSource.indexOf('this.worldBack = this.add.graphics();'), sceneSource.indexOf('this.afterBoss = this.add.graphics();'));
    const order = ['this.platformLayer =', 'this.worldFront =', 'this.exitArt =', 'this.worldFrontVoid =', 'this.contentLayer =', 'this.worldFrontLate =', 'this.coinLayer =', 'this.graphics ='];
    const at = order.map(s => create.indexOf(s));
    expect(at.every(i => i >= 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // In draw(): the gate on `worldFront` after the pickups, then TIMEVOID on its own Graphics above.
    const body = sceneSource.slice(sceneSource.indexOf('this.graphics = this.worldFront;'), sceneSource.indexOf('this.graphics = this.worldFrontLate;'));
    const marks = ['for (const hazard of m.hazards)', 'for (const item of m.pickups)', '// The way out:', 'this.graphics = this.worldFrontVoid;', 'this.timeVoid(m, cam);', 'this.contentImage(contentImages++, doorKey'];
    const pos = marks.map(s => body.indexOf(s));
    expect(pos.every(i => i >= 0), JSON.stringify(pos)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(sceneSource).toContain('this.worldFrontVoid.clear().setPosition(g.x, g.y);');
  });
});

describe('gameplay is cc578bf\'s', () => {
  it('leaves the model, generator, structures, world, progression and AREA sources byte-identical to cc578bf', () => {
    expect({
      model: sha256(modelSource), generator: sha256(generatorSource), structures: sha256(structuresSource),
      balance: sha256(balanceSource), progression: sha256(progressionSource), areas: sha256(areasSource),
    }).toEqual({
      model: 'd44534da247bb31183e8dca9e1760c8cc498ad0671f5d0d6da030da021554ab6',
      generator: 'e3948ae847117e6ff17f64393fe11885f6e9d12ee6d92ea702950dde96bd1d26',
      structures: '86078a98e06341772adb8b5269a645387fd82137db883d5b85afabaebf18f5a3',
      balance: 'd2eafd8ad7d906d973dcd62c62e920cb2aa9d00be211a999b067a6a5a797cfcd',
      progression: 'a62744534d10b935b210b51d488ad80f77b2afab5a5f1c094e7fe74e97f13d24',
      areas: '22121ff02f2ab64dd570bcd924f69fb3cacd844ffa357c96a0440b4e4806e478',
    });
    for (const source of [modelSource, generatorSource, structuresSource]) expect(source).not.toMatch(/exitGateArt|exit-gate/);
  });

  it('lays the gate and its floor, triggers SECTION CLEAR, opens the REST point and starts the next SECTION as before', () => {
    const trace: string[] = [];
    for (const area of AREAS) for (const section of SECTIONS) for (const seed of [1, 2, 3]) {
      const g = new GameModel(false, seeded(area * 1000 + section * 10 + seed));
      g.jumpToStage(area as AreaId, section as SectionId);
      const label = g.stage.label, hp = g.hp, ammo = g.ammo;
      const gate = reachExit(g);
      const floor = g.platforms.find(p => p.y === gate.y + gate.height && p.x === WORLD.wall)!;
      expect(g.state, label).toBe('upgrade');
      const choice = g.upgrades.choices[0].id;
      g.selectUpgrade(choice); g.confirmUpgrade();
      trace.push([label, gate.x, gate.y, gate.width, gate.height, floor.y, floor.width, floor.breakable, hp, ammo, choice, g.state, g.abyssStage, g.stage.label, g.exit === null].join('|'));
    }
    // The trigger: strict overlap of the 18x30 body with the 86x74 rectangle, never touching alone.
    const g = new GameModel(false, seeded(99));
    g.jumpToStage(1, 1);
    for (let i = 0; i < 40 && !g.exit; i++) { g.player.y = WORLD.startY + (g.sectionLength + 1 + i * 3) * WORLD.pixelsPerMeter; g.player.invincible = 99; g.step(1 / 120, 0, false); }
    const e = g.exit!;
    const at = (x: number, y: number) => {
      const t = new GameModel(false, seeded(99));
      t.jumpToStage(1, 1);
      for (let i = 0; i < 40 && !t.exit; i++) { t.player.y = WORLD.startY + (t.sectionLength + 1 + i * 3) * WORLD.pixelsPerMeter; t.player.invincible = 99; t.step(1 / 120, 0, false); }
      t.player.x = x; t.player.y = y; t.player.vx = 0; t.player.vy = 0; t.player.invincible = 99;
      t.step(1 / 120, 0, false);
      return t.state;
    };
    expect(at(e.x - 9.5, e.y + 37)).toBe('playing');
    expect(at(e.x - 8.5, e.y + 37)).toBe('upgrade');
    expect(at(e.x + e.width + 9.5, e.y + 37)).toBe('playing');
    expect(at(e.x + e.width + 8.5, e.y + 37)).toBe('upgrade');
    expect(modelSource).toContain('if (p.x + 9 > e.x && p.x - 9 < e.x + e.width && p.y + 15 > e.y && p.y - 15 < e.y + e.height) {');
    // Produced by this same trace on an untouched cc578bf checkout.
    expect(sha256(trace.join('\n')).slice(0, 24)).toBe('6caf4e49c5f44c06625cc1a7');
  });

  it('generates and plays AREA 1-4, THE ABYSS staging room and NIMUSHI exactly as before', () => {
    const golden = {
      1: ['b9975efcb9fbe4b2006cba4e', '414b1f52261b82c067509d92', '22ddb6304f988ed56d4538e5', '683c2598a46b4eadcc576b35'],
      2: ['55c8866f29f3d7527c3b513d', '95ebcdc29407d78501ec1a47', 'f5d50c7e36c05e33c315524d', 'e5f4c74110599c23f5ad5b62'],
      3: ['d748a265cf1731ae185f93cb', 'd813e6aa01f3d20ed9e034a4', '27a110a2880f9aaaafae8a08', 'b1c14c441b457f2baa84336f'],
      4: ['8fe90e6d6d4574a2e2ac7acf', '1e76e850a940069cb736eecc', '7c1a7fd3289e1612548469c1', 'b168d91ecea486a17fcc5fbf'],
    } as const;
    for (const area of AREAS) {
      expect(generationSignature(area), `AREA ${area} generation`).toBe(golden[area][0]);
      for (const section of SECTIONS) expect(replaySignature(entered(g => g.jumpToStage(area, section))), `AREA ${area}-${section}`).toBe(golden[area][section]);
    }
    expect(replaySignature(entered(g => g.jumpToBoss()))).toBe('8e287a848cb425a8029c5f2c');
    expect(replaySignature(entered(g => { g.jumpToNimushi(); }))).toBe('26ccd33dc5a34ba1e36f989c');
  });
});
