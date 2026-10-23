import { describe, expect, it } from 'vitest';
import { CORPSE_ART, CORPSE_ART_GEOMETRY, CORPSE_ART_KEY, corpseArt, corpseArtLoads, corpsePlacement } from '../src/render/corpseArt';
import { CORPSE_RULES, spawnCorpse } from '../src/data/corpses';
import { ENEMY_TYPES } from '../src/data/enemies';
import { ABYSS_PHASES } from '../src/data/abyss';
import { areaConfig } from '../src/data/areas';
import { UPGRADE_TUNING } from '../src/data/upgrades';
import { GameModel } from '../src/systems/GameModel';
import { StageGenerator, type Enemy } from '../src/systems/StageGenerator';
import { CORPSE_TRACE_SCENARIOS, corpseTrace } from './corpseTrace';
import { feedWindow, fighting, pin } from './nimushi';
import sceneSource from '../src/scenes/GameScene.ts?raw';

/**
 * CORPSE PIXEL ART RUNTIME INTEGRATION V1. One image, output/corpse-art-audit-v1/candidates/
 * corpse-common-B.png byte for byte (B / COMMON CORPSE), shown for every body in place of the three
 * procedural rectangles: 20x12 at native scale, pivot (10, 8) on the body's x/y, the same visibility
 * guard and alpha, pooled on its own layer directly above `underAbyss`. Drawing only: how bodies are
 * laid, fall, last, are eaten (KNIFE AND FORK, OMNOM, the heart every ten) or detonated (REST IN
 * PIECES) is exactly e948ece's, and so is everything else in the source tree.
 */

const { readFileSync, readdirSync } = await import(/* @vite-ignore */ 'node:' + 'fs') as { readFileSync: (path: URL) => Uint8Array; readdirSync: (path: URL) => string[] };
const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: Uint8Array | string) => { digest: (e: string) => string } } };
const { inflateSync } = await import(/* @vite-ignore */ 'node:' + 'zlib') as { inflateSync: (b: Uint8Array) => Uint8Array };
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

const dir = new URL('../src/assets/world/', import.meta.url);
const NAME = 'corpse-common-v1.png';
/** corpse-common-B.png as Codex delivered it (output/corpse-art-audit-v1/validation.json). */
const DELIVERED_SHA = 'ac905c892fa2d1ec1c4792cbdc526d3588d799d6e6f03612e39dd9e0edb808c4';
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
const between = (text: string, from: string, to: string) => {
  const a = text.indexOf(from), b = text.indexOf(to, a);
  expect(a, from).toBeGreaterThanOrEqual(0); expect(b, to).toBeGreaterThan(a);
  return text.slice(a, b);
};
const drawMethod = () => between(sceneSource, '  private draw() {', '  private surface(');
const createMethod = () => between(sceneSource, '  create() {', '  startRun(');

/** e948ece's body loop, byte for byte: what the fallback has to draw. */
const BASELINE_LOOP = `    // Bodies. Inert scenery -- what they are worth is KNIFE AND FORK's and REST IN PIECES' business.
    for (const corpse of m.corpses) {
      const cy = corpse.y - cam;
      if (cy < -20 || cy > 820) continue;
      const fade = corpse.life < 2 ? 0.3 + Math.abs(Math.sin(this.model.elapsed * 14)) * 0.5 : 0.9;
      this.rect(corpse.x - 10, cy - 4, 20, 8, 0x6b5f6a, fade);
      this.rect(corpse.x - 7, cy - 7, 14, 4, 0x9b8a99, fade);
      this.rect(corpse.x - 3, cy - 9, 6, 3, 0xd8c8d4, fade * 0.8);
    }
`;

/**
 * The scene's own body drawing, run against a stand-in scene: the loop out of draw() and the pooled
 * corpseImage() exactly as GameScene.ts has them, with `rect()` and the image objects recorded rather
 * than rendered. Whatever these tests see is what that source does.
 */
interface FakeImage { texture: string; x: number; y: number; alpha: number; visible: boolean; origin: number; calls: string[] }
function sceneBodies(present: boolean) {
  const loop = new Function('m', 'cam', 'g', 'exists', 'corpseArt', 'corpsePlacement',
    between(drawMethod(), '    // Bodies.', "    // NIMUSHI's line"));
  const imageBody = between(sceneSource, '    let img = this.corpseImages[index];', "  /**\n   * One ordinary ledge from an AREA's 3-slice");
  const corpseImage = new Function('index', 'texture', 'at', 'fade', 'offsetX', imageBody.slice(0, imageBody.lastIndexOf('}')));
  const baseline = new Function('m', 'cam', BASELINE_LOOP);
  const created: FakeImage[] = [], layer: FakeImage[] = [];
  const image = (texture: string): FakeImage => {
    const img: FakeImage = { texture, x: 0, y: 0, alpha: 1, visible: true, origin: 0.5, calls: [] };
    const self = img as FakeImage & Record<string, (...a: unknown[]) => unknown>;
    self.setTexture = (t: unknown) => { img.calls.push('setTexture'); img.texture = t as string; return self; };
    self.setPosition = (x: unknown, y: unknown) => { img.calls.push('setPosition'); img.x = x as number; img.y = y as number; return self; };
    self.setAlpha = (a: unknown) => { img.calls.push('setAlpha'); img.alpha = a as number; return self; };
    self.setVisible = (v: unknown) => { img.calls.push('setVisible'); img.visible = v as boolean; return self; };
    self.setOrigin = (o: unknown) => { img.calls.push('setOrigin'); img.origin = o as number; return self; };
    created.push(img);
    return img;
  };
  const rects: number[][] = [];
  const scene = {
    model: undefined as unknown as GameModel,
    corpseImages: [] as FakeImage[],
    corpseLayer: { add: (img: FakeImage) => layer.push(img) },
    add: { image: (_x: number, _y: number, texture: string) => image(texture) },
    rect: (...a: number[]) => rects.push(a),
    corpseImage(...a: unknown[]) { return corpseImage.apply(scene, a); },
  };
  const exists = (key: string) => present && key === CORPSE_ART_KEY;
  return {
    scene, created, layer, rects,
    /** One frame of the bodies, at the shake offset `gx`. Returns the images shown, in draw order. */
    frame(m: GameModel, gx = 0) {
      scene.model = m; rects.length = 0;
      for (const img of scene.corpseImages) img.calls.length = 0;
      loop.call(scene, m, m.cameraY, { x: gx, y: 0 }, exists, corpseArt, corpsePlacement);
      return scene.corpseImages.filter(img => img.visible);
    },
    /** e948ece's loop on the same frame: the rectangles it drew. */
    baselineRects(m: GameModel) {
      const out: number[][] = [];
      baseline.call({ model: m, rect: (...a: number[]) => out.push(a) }, m, m.cameraY);
      return out;
    },
  };
}

/** The bodies the scene's guard draws, in array order, with the image top-left each must get. */
const expected = (m: GameModel, gx = 0) => m.corpses
  .filter(c => { const cy = c.y - m.cameraY; return !(cy < -20 || cy > 820); })
  .map(c => ({ x: gx + Math.round(c.x - 10), y: Math.round(c.y - m.cameraY - 8), alpha: c.life < 2 ? 0.3 + Math.abs(Math.sin(m.elapsed * 14)) * 0.5 : 0.9 }));
const shown = (images: FakeImage[]) => images.map(img => ({ x: img.x, y: img.y, alpha: img.alpha }));

const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
const kill = (g: GameModel, e: Enemy, stomp = false) => (g as unknown as { kill: (e: Enemy, stomp: boolean) => void }).kill(e, stomp);
/** A run in an AREA with the shaft emptied, holding the named upgrades. */
function emptied(area: 1 | 2 | 3 | 4, held: ('knifeAndFork' | 'restInPieces')[] = [], seed = 31) {
  const g = new GameModel(false, seeded(seed));
  for (const id of held) g.upgrades.grant(id);
  g.jumpToStage(area, 1);
  g.platforms = []; g.pickups = []; g.hazards = []; g.doodads = []; g.safeZones = []; g.corpses = []; g.containers = [];
  g.player.invincible = 99; g.player.x = 225; g.player.vy = 0; g.player.grounded = -1;
  return g;
}

describe('the image', () => {
  it('registers exactly one, from src/assets/world, under its own key, loaded with the scene', () => {
    expect(readdirSync(dir)).toEqual([NAME]);
    expect(corpseArtLoads()).toEqual([[CORPSE_ART_KEY, CORPSE_ART]]);
    expect(fileOf(CORPSE_ART)).toBe(NAME);
    expect(between(sceneSource, '  preload() {', '  create() {')).toContain('for (const [key, url] of corpseArtLoads()) this.load.image(key, url);');
    // Candidate A, the current-shape reference and the comparison sheets stay in the Codex output.
    const assets = readdirSync(new URL('../src/assets/', import.meta.url));
    const corpseFiles = assets.flatMap(d => { try { return readdirSync(new URL(`../src/assets/${d}/`, import.meta.url)).map(f => `${d}/${f}`); } catch { return []; } })
      .filter(f => /corpse|candidate/i.test(f));
    expect(corpseFiles).toEqual([`world/${NAME}`]);
  });

  it('ships byte for byte as delivered: SHA-256, 20x12, 8-bit RGBA, hard alpha, five colours', () => {
    expect(sha256(bytes())).toBe(DELIVERED_SHA);
    const { w, h, px } = decode();
    expect([w, h]).toEqual([CORPSE_ART_GEOMETRY.width, CORPSE_ART_GEOMETRY.height]);
    const alphas = new Set<number>(), colours = new Set<string>();
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4; alphas.add(px[i + 3]);
      if (!px[i + 3]) continue;
      colours.add([px[i], px[i + 1], px[i + 2]].map(v => v.toString(16).padStart(2, '0')).join(''));
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
    }
    expect([...alphas].sort((a, b) => a - b)).toEqual([0, 255]);
    expect([...colours].sort()).toEqual(['2d2933', '5e4b58', '927b88', 'baa1ad', 'd6c6be']);
    // Opaque bounds [0,1,19,11): padding top 1, bottom 1, right 1, left 0.
    expect([x0, y0, x1, y1]).toEqual([0, 1, 19, 11]);
  });

  it('is filtered NEAREST and drawn at native size: no scale, flip, rotation or tint, ever', () => {
    expect(createMethod()).toContain('if (this.textures.exists(CORPSE_ART_KEY)) this.textures.get(CORPSE_ART_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST);');
    const method = between(sceneSource, '  private corpseImage(', "  /**\n   * One ordinary ledge from an AREA's 3-slice");
    expect(method).not.toMatch(/setScale|setDisplaySize|setFlip|setRotation|setAngle|setTint|setCrop/);
    expect(method).toContain('.setOrigin(0)');
  });
});

describe('geometry and anchor', () => {
  it('is the body\'s nominal 20x12, pivoted at (10, 8); the gameplay geometry is e948ece\'s', () => {
    expect(CORPSE_ART_GEOMETRY).toEqual({ width: CORPSE_RULES.width, height: CORPSE_RULES.height, pivotX: 10, pivotY: 8 });
    expect(CORPSE_RULES).toEqual({ lifetime: 12, radius: 18, gravity: 520, maxFallSpeed: 340, width: 20, height: 12 });
    expect(spawnCorpse(4, 101.5, 202.25, 1)).toEqual({ id: 4, x: 101.5, y: 202.25, vy: -60, life: 12, claimed: false });
    expect(spawnCorpse(4, 101.5, 202.25, -1).vy).toBe(60);
  });

  it('lands on whole pixels from fractional positions, and never moves the body to get there', () => {
    for (const [x, cy] of [[225, 400], [225.4, 400.6], [37.5, -19.5], [412.49, 819.5], [100.51, 0.49]]) {
      const at = corpsePlacement(x, cy);
      expect(at).toEqual({ x: Math.round(x - 10), y: Math.round(cy - 8) });
      expect(Number.isInteger(at.x) && Number.isInteger(at.y)).toBe(true);
    }
    // The model's coordinates are never rounded: a frame with the image leaves the bodies as they were.
    const g = emptied(1); g.corpses = [spawnCorpse(1, 120.37, g.cameraY + 300.61)];
    const before = JSON.stringify(g.corpses);
    sceneBodies(true).frame(g, 0.37);
    expect(JSON.stringify(g.corpses)).toBe(before);
  });

  it('keeps its opaque texels inside the procedural drawing\'s footprint at every sub-pixel offset', () => {
    for (let fx = 0; fx < 1; fx += 0.125) for (let fy = 0; fy < 1; fy += 0.125) {
      const x = 200 + fx, cy = 300 + fy, at = corpsePlacement(x, cy);
      // The three rectangles, rounded as rect() rounds them.
      const rects = [[x - 10, cy - 4, 20, 8], [x - 7, cy - 7, 14, 4], [x - 3, cy - 9, 6, 3]].map(([rx, ry, w, h]) => [Math.round(rx), Math.round(ry), w, h]);
      const left = Math.min(...rects.map(r => r[0])), top = Math.min(...rects.map(r => r[1]));
      const right = Math.max(...rects.map(r => r[0] + r[2])), bottom = Math.max(...rects.map(r => r[1] + r[3]));
      expect(at.x + 0).toBeGreaterThanOrEqual(left); expect(at.x + 19).toBeLessThanOrEqual(right);
      expect(at.y + 1).toBeGreaterThanOrEqual(top); expect(at.y + 11).toBeLessThanOrEqual(bottom);
    }
  });
});

describe('render layer', () => {
  it('sits on its own layer directly above underAbyss: over the TIMEOUT bubbles, under the deep and everything after', () => {
    const create = createMethod();
    const order = ['this.coinLayer = this.add.container(0, 0);', 'this.underAbyss = this.add.graphics();', 'this.corpseLayer = this.add.container(0, 0);', 'this.abyssArt =', 'this.speechShell = this.add.graphics();', 'this.graphics = this.add.graphics();', 'this.bossArt = this.add.image(', 'this.enemyLayer =', 'this.afterEnemies =', 'this.playerArt = new PlayerArt(', 'this.artForeground ='];
    const at = order.map(s => create.indexOf(s));
    expect(at.every(i => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // Created once, never re-depthed or moved: images take the shake and cameraX through their own x.
    expect(sceneSource.match(/this\.corpseLayer = /g)).toHaveLength(1);
    expect(sceneSource).not.toMatch(/corpseLayer[^;]*(setDepth|setPosition|setScrollFactor)/);
    expect(sceneSource).not.toMatch(/corpseImages[^;]*setDepth/);
  });

  it('draws in draw() where the bodies always were: after the TIMEOUT bubbles, before the speech and the deep', () => {
    const draw = drawMethod();
    const steps = ['// Loose coins.', 'this.graphics = this.underAbyss;', 'for (const bubble of m.timeoutBubbles) {', '// Bodies.', 'const corpseKey = corpseArt(exists);', 'for (const corpse of m.corpses) {', 'this.bossSpeech();', 'this.graphics = g;\n    this.boss(cam);'];
    const at = steps.map(s => draw.indexOf(s));
    expect(at.every(i => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('builds one pool image per body on screen at most, and reuses them frame after frame', () => {
    const g = emptied(1), bodies = sceneBodies(true);
    g.corpses = [0, 1, 2, 3, 4].map(i => spawnCorpse(i + 1, 60 + i * 70, g.cameraY + 200 + i * 40));
    for (let f = 0; f < 240; f++) { g.step(1 / 120, 0, false); bodies.frame(g); }
    expect(bodies.created.length).toBe(5);
    expect(bodies.layer).toEqual(bodies.created);
    // Each frame only re-points, moves, fades and shows the images: nothing is made or destroyed.
    expect(bodies.created.every(img => img.calls.join() === 'setTexture,setPosition,setAlpha,setVisible' || img.calls.join() === 'setVisible')).toBe(true);
  });
});

describe('fallback and no double drawing', () => {
  it('with the image missing, draws e948ece\'s three rectangles exactly, and makes no image', () => {
    const g = emptied(1), bodies = sceneBodies(false);
    g.corpses = [spawnCorpse(1, 100.4, g.cameraY + 300.6), spawnCorpse(2, 300, g.cameraY + 820), spawnCorpse(3, 220, g.cameraY - 21)];
    g.corpses[1].life = 1.3;
    for (let f = 0; f < 90; f++) {
      g.step(1 / 120, 0, false);
      bodies.frame(g, 0.3);
      expect(bodies.rects).toEqual(bodies.baselineRects(g));
    }
    expect(bodies.created).toHaveLength(0);
    // ...and the procedural lines themselves are e948ece's, verbatim.
    const loop = between(drawMethod(), '    // Bodies.', "    // NIMUSHI's line");
    for (const line of BASELINE_LOOP.split('\n').slice(1, -2)) expect(loop).toContain(line);
  });

  it('with the image, draws only the image: no rectangle under or over it', () => {
    const g = emptied(1), bodies = sceneBodies(true);
    g.corpses = [spawnCorpse(1, 100, g.cameraY + 300), spawnCorpse(2, 200, g.cameraY + 400)];
    const images = bodies.frame(g);
    expect(bodies.rects).toEqual([]);
    expect(images.map(img => img.texture)).toEqual([CORPSE_ART_KEY, CORPSE_ART_KEY]);
    expect(between(drawMethod(), 'const corpseKey = corpseArt(exists);', "    // NIMUSHI's line"))
      .toContain('if (corpseKey) { this.corpseImage(corpseImages++, corpseKey, corpsePlacement(corpse.x, cy), fade, g.x); continue; }');
  });
});

describe('mapping', () => {
  it('one key for every body: no enemy, AREA, BOSS or upgrade variant', () => {
    expect(corpseArt(() => true)).toBe(CORPSE_ART_KEY);
    expect(corpseArt(() => false)).toBeNull();
    expect(corpseArt.length).toBe(1);
    for (const area of [1, 2, 3] as const) {
      const g = emptied(area, ['knifeAndFork']);
      g.player.y = g.cameraY + 100;
      g.corpses = [spawnCorpse(1, 120, g.cameraY + 500)];
      expect(sceneBodies(true).frame(g).map(img => img.texture)).toEqual([CORPSE_ART_KEY]);
    }
  });
});

describe('lifecycle, through the real model', () => {
  it('kill -> laid -> falling -> eaten -> gone, and a SECTION change clears it: image always matches the array', () => {
    const g = emptied(1, ['knifeAndFork']), bodies = sceneBodies(true);
    g.player.y = g.cameraY + 150;
    const victims = (['slime', 'caveBat', 'toad'] as const).map((kind, i) => {
      const e = g.enemies.find(en => en.alive) ?? g.enemies[0];
      return { ...e, id: 9000 + i, kind, alive: true, hp: 1, x: 80 + i * 130, y: g.cameraY + 400, originX: 80 + i * 130 };
    });
    g.enemies = victims as Enemy[];
    // KILL: the shot path and the stomp path lay the same body.
    kill(g, g.enemies[0], false); kill(g, g.enemies[1], true); kill(g, g.enemies[2], false);
    expect(g.corpses.map(c => [c.x, c.y, c.vy, c.life])).toEqual(victims.map(v => [v.x, v.y, -60, 12]));
    let frame = bodies.frame(g);
    expect(shown(frame)).toEqual(expected(g));
    // FALLING: up against the pull, then down with it -- the image follows the model, every frame.
    const y0 = g.corpses[0].y;
    for (let f = 0; f < 120; f++) {
      g.player.invincible = 99; g.player.x = 400; g.player.y = g.corpses[0].y - 200; g.player.vy = 0;
      g.step(1 / 120, 0, false);
      frame = bodies.frame(g);
      expect(shown(frame)).toEqual(expected(g));
    }
    expect(g.corpses[0].y).toBeGreaterThan(y0);
    // EATEN: the player walks into one; the frame the model removes it, its image is not shown.
    const target = g.corpses[1];
    g.player.x = target.x; g.player.y = target.y;
    g.step(1 / 120, 0, false);
    expect(g.corpsesEaten).toBe(1);
    expect(g.corpses).not.toContain(target);
    frame = bodies.frame(g);
    expect(shown(frame)).toEqual(expected(g));
    expect(frame).toHaveLength(2);
    expect(bodies.scene.corpseImages.filter(img => !img.visible)).toHaveLength(1);
    // CLEANUP: a new SECTION empties the array, and every pooled image is hidden with it.
    g.jumpToStage(1, 2);
    expect(g.corpses).toEqual([]);
    expect(bodies.frame(g)).toEqual([]);
    expect(bodies.created).toHaveLength(3);
    // A reused image starts from the new body's position, never the last one's.
    g.corpses = [spawnCorpse(77, 333, g.cameraY + 250)];
    expect(shown(bodies.frame(g))).toEqual(expected(g));
  });

  it('blinks by e948ece\'s alpha in its last two seconds, and leaves when its life does', () => {
    const g = emptied(1), bodies = sceneBodies(true);
    const body = spawnCorpse(1, 200, g.cameraY + 300); body.vy = 0;
    g.corpses = [body];
    const alphas = new Set<number>();
    for (let f = 0; f < 12 * 120 + 10 && g.corpses.length; f++) {
      g.player.invincible = 99; g.player.y = g.cameraY + 100; g.player.vy = 0; body.y = g.cameraY + 300; body.vy = 0;
      g.step(1 / 120, 0, false);
      const frame = bodies.frame(g);
      expect(shown(frame)).toEqual(expected(g));
      for (const img of frame) alphas.add(img.alpha);
    }
    expect(g.corpses).toEqual([]);
    expect(bodies.frame(g)).toEqual([]);
    expect(alphas.has(0.9)).toBe(true);
    expect([...alphas].every(a => a === 0.9 || (a >= 0.3 && a <= 0.8))).toBe(true);
  });

  it('follows the shake and cameraX through the layer offset, as the rectangles did', () => {
    const g = emptied(1), bodies = sceneBodies(true);
    g.corpses = [spawnCorpse(1, 150.5, g.cameraY + 200.5)];
    for (const gx of [0, 0.42, -0.37, -180, 120.25]) expect(shown(bodies.frame(g, gx))).toEqual(expected(g, gx));
  });

  it('draws exactly the bodies inside the -20..820 guard, endpoints included', () => {
    const g = emptied(1), bodies = sceneBodies(true), cam = g.cameraY;
    g.corpses = [-21, -20, 400, 820, 821].map((cy, i) => spawnCorpse(i + 1, 100 + i * 50, cam + cy));
    expect(bodies.frame(g).map(img => img.y)).toEqual([-28, 392, 812]);
  });
});

describe('OMNOM and consumption sync', () => {
  it('ten bodies: OMNOM 1..9 then 0, one heart, each image gone the frame its body is eaten', () => {
    const g = emptied(1, ['knifeAndFork']), bodies = sceneBodies(true);
    g.player.invincible = 0; g.damage(2); g.player.invincible = 99;
    const low = g.hp, values: number[] = [];
    for (let i = 0; i < UPGRADE_TUNING.knifeAndFork.corpsesPerHeart; i++) {
      g.player.y = g.cameraY + 300; g.player.vy = 0;
      g.corpses = [spawnCorpse(i + 1, g.player.x, g.player.y + 40)];
      expect(bodies.frame(g)).toHaveLength(1);
      for (let f = 0; f < 60 && g.corpses.length; f++) {
        g.player.invincible = 99; g.player.y = g.cameraY + 300; g.player.vy = 0;
        g.step(1 / 120, 0, false);
        for (const ev of g.events) if (ev.type === 'corpse') values.push(ev.value!);
        g.events.length = 0;
        // Shown while the model holds it, hidden the very frame it does not.
        expect(shown(bodies.frame(g))).toEqual(expected(g));
      }
      expect(g.corpses).toEqual([]);
    }
    expect(values).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
    expect(g.corpsesEaten).toBe(10);
    expect(g.hp).toBe(low + UPGRADE_TUNING.knifeAndFork.heal);
    // The OMNOM label is e948ece's line, untouched.
    expect(sceneSource).toContain("if (event.type === 'corpse') this.label(event.x, event.y - 20, `OMNOM ${event.value}/10`, 'system');");
  });

  it('touching any opaque texel of the image is inside KNIFE AND FORK\'s reach: the art never promises less than the rule', () => {
    const { w, h, px } = decode();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!px[(y * w + x) * 4 + 3]) continue;
      const dx = x - CORPSE_ART_GEOMETRY.pivotX, dy = y - CORPSE_ART_GEOMETRY.pivotY;
      expect(Math.abs(dx) <= CORPSE_RULES.radius && Math.abs(dy) <= CORPSE_RULES.radius + 12).toBe(true);
      // ...and inside REST IN PIECES' round test (|dx| < width, |dy| < height + 8).
      expect(Math.abs(dx) < CORPSE_RULES.width && Math.abs(dy) < CORPSE_RULES.height + 8).toBe(true);
    }
  });

  it('a body shot by REST IN PIECES is claimed once, explodes once, and its image leaves with it', () => {
    const g = emptied(1, ['restInPieces']), bodies = sceneBodies(true);
    const body = spawnCorpse(1, 225, g.cameraY + 360); body.vy = 0;
    g.corpses = [body];
    let explosions = 0;
    for (let i = 0; i < 300 && !body.claimed; i++) {
      g.player.invincible = 99; g.player.x = 225; g.player.y = g.cameraY + 300; g.player.vy = 0; g.player.grounded = -1;
      body.y = g.cameraY + 360; body.x = 225; g.ammo = g.stats.maxAmmo;
      g.step(1 / 120, 0, i % 12 < 6);
      explosions += g.events.filter(e => e.type === 'explosion').length; g.events.length = 0;
      expect(shown(bodies.frame(g))).toEqual(expected(g));
    }
    expect(body.claimed).toBe(true);
    for (let i = 0; i < 30; i++) { g.step(1 / 120, 0, false); explosions += g.events.filter(e => e.type === 'explosion').length; g.events.length = 0; }
    expect(explosions).toBe(1);
    expect(bodies.frame(g)).toEqual([]);
  });
});

describe('where bodies come from (unchanged)', () => {
  it('AREA 4 lays none: no kind it can field leaves one, in any SECTION or seed', () => {
    const area = areaConfig(4);
    expect(area.enemyPool.filter(k => ENEMY_TYPES[k].leavesCorpse)).toEqual([]);
    const kinds = new Set<string>();
    for (let n = 1; n <= area.sections; n++) for (let s = 1; s <= 12; s++) {
      const gen = new StageGenerator(seeded(s * 7919 + n * 101 + 4), {
        plan: area.plans?.[n - 1], enemyPool: area.enemyPool, water: area.water,
        oxygen: area.gimmicks?.oxygen === true, heat: area.gimmicks?.heat === true,
        breakable: area.gimmicks?.breakablePlatforms === true, sectionLength: area.sectionLength,
      });
      for (let c = 0; c < 24; c++) for (const e of gen.chunk(c).enemies) kinds.add(e.kind);
    }
    expect(kinds.size).toBeGreaterThan(0);
    expect([...kinds].filter(k => ENEMY_TYPES[k as keyof typeof ENEMY_TYPES].leavesCorpse)).toEqual([]);
    // And in play, with both upgrades and every kill the scripted runs make: not one body.
    for (const name of ['area4 knife+rest', 'area4-3 knife+rest']) {
      const s = CORPSE_TRACE_SCENARIOS[name];
      expect(corpseTrace(s.start, s.held, 4, s.seconds).spawned).toBe(0);
    }
  });

  it('AREA 1-3 lay them from their own rosters', () => {
    const flesh = (area: 1 | 2 | 3) => areaConfig(area).enemyPool.filter(k => ENEMY_TYPES[k].leavesCorpse);
    expect(flesh(1)).toEqual(['slime', 'caveBat', 'toad', 'shellback', 'creeper']);
    expect(flesh(2)).toEqual(['boneThrower']);
    expect(flesh(3)).toEqual(['squid', 'shellSwimmer']);
  });

  it('the BOSS: only phase 1\'s summoned CAVE BAT leaves one; clones are not in any rotation', () => {
    expect(ABYSS_PHASES.map(p => p.summonPool.filter(k => ENEMY_TYPES[k].leavesCorpse))).toEqual([['caveBat'], [], [], []]);
    expect(ABYSS_PHASES.every(p => !p.attacks.includes('nimushiClones'))).toBe(true);
    // A real phase-1 summon (the fixture tests/bossParity.test.ts uses), killed in the inverted pull:
    // the body is thrown down the screen, falls up it, and is drawn by the same rule -- no flip, no other image.
    const g = fighting(61), bodies = sceneBodies(true);
    let bat: Enemy | undefined;
    for (let i = 0; i < 12 * 120 && !bat; i++) {
      g.player.invincible = 9; feedWindow(g, i); pin(g, 360);
      g.step(1 / 120, 0, false); g.events.length = 0;
      bat = g.enemies.find(e => e.alive && e.kind === 'caveBat');
    }
    expect(bat, 'phase 1 summons a CAVE BAT').toBeDefined();
    expect(g.boss.phaseId).toBe(1);
    expect(g.gravitySign).toBe(-1);
    g.corpses = [];
    kill(g, bat!, false);
    expect(g.corpses).toHaveLength(1);
    expect(g.corpses[0].vy).toBe(60);
    const y0 = g.corpses[0].y;
    for (let f = 0; f < 60; f++) { g.player.invincible = 9; pin(g, 360); g.step(1 / 120, 0, false); g.events.length = 0; expect(shown(bodies.frame(g))).toEqual(expected(g)); }
    expect(g.corpses).toHaveLength(1);
    expect(g.corpses[0].y).toBeLessThan(y0);
    expect(bodies.frame(g).map(img => img.texture)).toEqual([CORPSE_ART_KEY]);
  });
});

describe('gameplay invariance', () => {
  /** corpseTrace (tests/corpseTrace.ts) at e948ece, for every scenario: bodies, eats, blasts, HP, score. */
  const GOLDEN: Record<string, { digest: string; spawned: number; eaten: number; explosions: number }> = {
    'area1 plain': { digest: 'f3cca67b1af6ee79', spawned: 12, eaten: 0, explosions: 0 },
    'area1 knife': { digest: 'b100a57aa7c44811', spawned: 12, eaten: 4, explosions: 0 },
    'area1 knife+rest': { digest: 'c4ed96a04ca63ebc', spawned: 9, eaten: 3, explosions: 4 },
    'area2 knife': { digest: 'f49dd96254b1af53', spawned: 2, eaten: 2, explosions: 0 },
    'area2 rest': { digest: 'c76f9a872e6f70b9', spawned: 2, eaten: 0, explosions: 1 },
    'area3 knife': { digest: 'c644b2fe20d4ac83', spawned: 14, eaten: 3, explosions: 0 },
    'area3 knife+rest': { digest: '7d3a180cc4c147a8', spawned: 21, eaten: 4, explosions: 13 },
    'area4 knife+rest': { digest: '1e9f4059b0dd2851', spawned: 0, eaten: 0, explosions: 0 },
    'area4-3 knife+rest': { digest: 'e02a5ba495ec5926', spawned: 0, eaten: 0, explosions: 0 },
    'boss knife+rest': { digest: 'bf1676dd5961ba40', spawned: 1, eaten: 1, explosions: 0 },
  };

  it('plays every body exactly as e948ece did: spawn, motion, life, eating, blasts, OMNOM, HP, score, chain, coins', () => {
    const got = Object.fromEntries(Object.entries(CORPSE_TRACE_SCENARIOS).map(([name, s]) => {
      const t = corpseTrace(s.start, s.held, 4, s.seconds);
      return [name, { digest: t.digest, spawned: t.spawned, eaten: t.eaten, explosions: t.explosions }];
    }));
    expect(got).toEqual(GOLDEN);
  }, 60000);

  it('changes no source but GameScene.ts and the new render/corpseArt.ts', () => {
    const SOURCES = import.meta.glob(['../src/**/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const keys = Object.keys(SOURCES).filter(k => k !== '../src/scenes/GameScene.ts' && k !== '../src/render/corpseArt.ts').sort();
    expect(keys).toHaveLength(84);
    // The same digest over the same 84 files, computed at e948ece.
    expect(sha256(keys.map(k => `${k}\n${sha256(SOURCES[k])}`).join('\n'))).toBe('c76a68e5af4272c829f36401cb39b73901ac539ec8f18fb9cb6aa4718c23b74c');
  });

  it('changes GameScene.ts only by the body image: take the additions out and it is e948ece\'s, byte for byte', () => {
    const ADDED = [
      "import { CORPSE_ART_KEY, corpseArt, corpseArtLoads, corpsePlacement } from '../render/corpseArt';\n",
      `  /**
   * CORPSE ART (render/corpseArt): the bodies' image, one pooled image per body on screen, directly
   * above \`underAbyss\` where the procedural bodies were its last drawing -- over the TIMEOUT bubbles,
   * under the deep's image and everything after it. Nothing changes place.
   */
  private corpseLayer!: Phaser.GameObjects.Container;
  private corpseImages: Phaser.GameObjects.Image[] = [];
`,
      '    for (const [key, url] of corpseArtLoads()) this.load.image(key, url);\n',
      `    if (this.textures.exists(CORPSE_ART_KEY)) this.textures.get(CORPSE_ART_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.corpseLayer = this.add.container(0, 0);
    // Phaser destroys the layer and its images with the scene; only the pool's references are ours.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.corpseImages = []; });
`,
      `    // The common body image (render/corpseArt) on \`corpseLayer\`, at the same alpha; null if missing (procedural).
    const corpseKey = corpseArt(exists);
    let corpseImages = 0;
`,
      '      if (corpseKey) { this.corpseImage(corpseImages++, corpseKey, corpsePlacement(corpse.x, cy), fade, g.x); continue; }\n',
      '    for (let i = corpseImages; i < this.corpseImages.length; i++) this.corpseImages[i].setVisible(false);\n',
      `  /** One body's image on \`corpseLayer\`: top-left at (x, y), native size, blinking by \`fade\`; pooled like the coins. */
  private corpseImage(index: number, texture: string, at: { x: number; y: number }, fade: number, offsetX: number) {
    let img = this.corpseImages[index];
    if (!img) { img = this.add.image(0, 0, texture).setOrigin(0); this.corpseLayer.add(img); this.corpseImages[index] = img; }
    img.setTexture(texture).setPosition(offsetX + at.x, at.y).setAlpha(fade).setVisible(true);
  }
`,
    ];
    let source = sceneSource;
    for (const block of ADDED) {
      expect(source.split(block).length - 1, block.slice(0, 60)).toBe(1);
      source = source.replace(block, '');
    }
    expect(sha256(source)).toBe('2d453544e177d48f6bec2c77f5abd8d4a14d7e504710ff13601cf04d085471dd');
  });
});
