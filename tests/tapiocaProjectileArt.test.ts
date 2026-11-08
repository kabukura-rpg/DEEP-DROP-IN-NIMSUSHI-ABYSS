import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';
import { TAPIOCA_PROJECTILE_ART, drawTapiocaProjectile } from '../src/render/tapiocaProjectileArt';
import { TRIPLE_SHOT, TAPIOCA_SHOWER, FULL_SCREEN_TAPIOCA } from '../src/data/nimushi';
import { ABYSS_PHASES } from '../src/data/abyss';
import type { Tapioca } from '../src/systems/NimushiBossSystem';
import { fighting, round } from './nimushi';
import { tapiocaTrace } from './tapiocaTrace';
import { TAPIOCA_ART_HUNKS, isTapiocaProjectileArtFile, withoutTapiocaProjectileArt } from './tapiocaProjectileArtRestore';
import { isTimeoutArtFile } from './timeoutArtRestore';
import { isAirBubbleArtFile } from './airBubbleArtRestore';
import sceneSource from '../src/scenes/GameScene.ts?raw';
import artSource from '../src/render/tapiocaProjectileArt.ts?raw';

/**
 * BOSS TAPIOCA PROJECTILE PIXEL ART V1 -- runtime integration of candidate A (output/next-visual-design-v1,
 * claude-integration-spec.md). NIMUSHI's TRIPLE SHOT pearl, three circles at 959a5f4, becomes seventeen
 * hard-edged rectangles inside the old rim's 22x22, on the same Graphics, in the same loop, behind the same cull,
 * before bossBody as before. Drawing only: where pearls come from, how they fly, what they hit and when they go
 * are exactly 959a5f4's, and so is every other line of the scene.
 */

const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: Uint8Array | string) => { digest: (e: string) => string } } };
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const between = (text: string, from: string, to: string) => {
  const a = text.indexOf(from), b = text.indexOf(to, a);
  expect(a, from).toBeGreaterThanOrEqual(0); expect(b, to).toBeGreaterThan(a);
  return text.slice(a, b);
};
const bossMethod = () => between(sceneSource, '  private boss(cam: number) {', '  private bossBody(');
const pearlBlock = () => between(bossMethod(), '    // Pearls.\n', '    this.bossBody(cam);');
/** 959a5f4's pearl loop, byte for byte. */
const BASELINE_BLOCK = `    // Pearls.
    for (const pearl of fight.tapiocas) {
      const py = pearl.y - cam;
      if (py < -30 || py > 840) continue;
      // A pale rim first: a dark pearl on a dark shaft has to read as a THING coming at the player.
      this.graphics.fillStyle(0xffe9c4, 0.85).fillCircle(pearl.x, py, pearl.size + 2);
      this.graphics.fillStyle(0x1b1016, 0.95).fillCircle(pearl.x, py, pearl.size);
      this.graphics.fillStyle(0x6b4a58, 0.8).fillCircle(pearl.x - pearl.size * 0.3, py - pearl.size * 0.3, pearl.size * 0.4);
    }

`;

/** candidates/candidate-A.mjs (RIM / CORE / LIGHT and drawCandidateA's colours and alphas), in its order. */
const SPEC = {
  rim: [0xffe9c4, 0.85, [[6, 0, 10, 2], [3, 2, 16, 2], [1, 4, 20, 3], [0, 7, 22, 8], [1, 15, 20, 3], [3, 18, 16, 2], [6, 20, 10, 2]]],
  core: [0x1b1016, 0.95, [[7, 2, 8, 2], [4, 4, 14, 2], [3, 6, 16, 2], [2, 8, 18, 6], [3, 14, 16, 2], [4, 16, 14, 2], [7, 18, 8, 2]]],
  light: [0x6b4a58, 0.8, [[7, 5, 6, 2], [5, 7, 6, 3], [5, 10, 3, 2]]],
} as const;

type Op = { op: 'style'; color: number; alpha: number } | { op: 'rect'; x: number; y: number; w: number; h: number } | { op: 'circle'; x: number; y: number; r: number };
/** A recording Graphics; `tx`/`ty` are its own translation (the scene's shake / cameraX offset, as g.x / g.y). */
function recorder(tx = 0, ty = 0) {
  const ops: Op[] = [];
  const g = {
    x: tx, y: ty,
    fillStyle(color: number, alpha = 1) { ops.push({ op: 'style', color, alpha }); return g; },
    fillRect(x: number, y: number, w: number, h: number) { ops.push({ op: 'rect', x, y, w, h }); return g; },
    fillCircle(x: number, y: number, r: number) { ops.push({ op: 'circle', x, y, r }); return g; },
  };
  return { g: g as unknown as Phaser.GameObjects.Graphics, ops };
}
interface Fill { x: number; y: number; w: number; h: number; color: number; alpha: number }
const fills = (ops: Op[]) => {
  const out: Fill[] = [];
  let color = -1, alpha = -1;
  for (const o of ops) {
    if (o.op === 'style') { color = o.color; alpha = o.alpha; } else if (o.op === 'rect') out.push({ x: o.x, y: o.y, w: o.w, h: o.h, color, alpha });
  }
  return out;
};
/** Paint the fills in order onto a pixel map: "x,y" -> colour. */
const raster = (list: Fill[]) => {
  const px = new Map<string, number>();
  for (const f of list) for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) px.set(`${x},${y}`, f.color);
  return px;
};
const bounds = (px: Map<string, number>) => {
  const pts = [...px.keys()].map(k => k.split(',').map(Number));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1 };
};

/**
 * The scene's own pearl loop, run against a stand-in scene: the block out of boss() exactly as GameScene.ts has it,
 * on a recording Graphics. And 959a5f4's block on the same frame.
 */
function scenePearls() {
  const candidate = new Function('fight', 'cam', 'TAPIOCA_PROJECTILE_ART', 'drawTapiocaProjectile', pearlBlock());
  const baseline = new Function('fight', 'cam', BASELINE_BLOCK);
  const run = (block: (this: unknown, ...a: unknown[]) => void, pearls: Tapioca[], cam: number, ...extra: unknown[]) => {
    const r = recorder();
    block.call({ graphics: r.g }, { tapiocas: pearls }, cam, ...extra);
    return r.ops;
  };
  return {
    frame: (pearls: Tapioca[], cam = 0) => run(candidate as never, pearls, cam, TAPIOCA_PROJECTILE_ART, drawTapiocaProjectile),
    baseline: (pearls: Tapioca[], cam = 0) => run(baseline as never, pearls, cam),
  };
}
const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
const pearl = (x: number, y: number, extra: Partial<Tapioca> = {}): Tapioca =>
  ({ id: 1, x, y, vx: 0, vy: 250, size: TRIPLE_SHOT.size, life: TRIPLE_SHOT.life, damage: TRIPLE_SHOT.damage, ...extra });

describe('TAPIOCA A: the seventeen rectangles', () => {
  it('is candidate A exactly: 7 rim, 7 core, 3 highlight rects, in that order, with the 959a5f4 colours and alphas', () => {
    expect(TAPIOCA_PROJECTILE_ART.layers.map(([c, a, rects]) => [c, a, rects.map(r => [...r])])).toEqual([SPEC.rim, SPEC.core, SPEC.light].map(([c, a, rects]) => [c, a, rects.map(r => [...r])]));
    expect([TAPIOCA_PROJECTILE_ART.size, TAPIOCA_PROJECTILE_ART.originX, TAPIOCA_PROJECTILE_ART.originY, TAPIOCA_PROJECTILE_ART.width, TAPIOCA_PROJECTILE_ART.height]).toEqual([9, -11, -11, 22, 22]);
    const r = recorder();
    drawTapiocaProjectile(r.g, 100, 200);
    // Three style calls, 17 rects: the candidate's call sequence, anchored on round(x) - 11, round(y) - 11.
    const want: Op[] = [];
    for (const [color, alpha, rects] of [SPEC.rim, SPEC.core, SPEC.light]) {
      want.push({ op: 'style', color, alpha });
      for (const [dx, dy, w, h] of rects) want.push({ op: 'rect', x: 89 + dx, y: 189 + dy, w, h });
    }
    expect(r.ops).toEqual(want);
    expect(r.ops.filter(o => o.op === 'rect')).toHaveLength(17);
  });

  it('paints this 22x22 pixel map: stepped cream rim, dark core, plum highlight up and left', () => {
    const r = recorder();
    drawTapiocaProjectile(r.g, 11, 11);
    const px = raster(fills(r.ops));
    const KEY: Record<number, string> = { 0xffe9c4: 'R', 0x1b1016: 'C', 0x6b4a58: 'L' };
    const rows = Array.from({ length: 22 }, (_, y) => Array.from({ length: 22 }, (_, x) => px.has(`${x},${y}`) ? KEY[px.get(`${x},${y}`)!] : '.').join(''));
    expect(rows).toEqual([
      '......RRRRRRRRRR......',
      '......RRRRRRRRRR......',
      '...RRRRCCCCCCCCRRRR...',
      '...RRRRCCCCCCCCRRRR...',
      '.RRRCCCCCCCCCCCCCCRRR.',
      '.RRRCCCLLLLLLCCCCCRRR.',
      '.RRCCCCLLLLLLCCCCCCRR.',
      'RRRCCLLLLLLCCCCCCCCRRR',
      'RRCCCLLLLLLCCCCCCCCCRR',
      'RRCCCLLLLLLCCCCCCCCCRR',
      'RRCCCLLLCCCCCCCCCCCCRR',
      'RRCCCLLLCCCCCCCCCCCCRR',
      'RRCCCCCCCCCCCCCCCCCCRR',
      'RRCCCCCCCCCCCCCCCCCCRR',
      'RRRCCCCCCCCCCCCCCCCRRR',
      '.RRCCCCCCCCCCCCCCCCRR.',
      '.RRRCCCCCCCCCCCCCCRRR.',
      '.RRRCCCCCCCCCCCCCCRRR.',
      '...RRRRCCCCCCCCRRRR...',
      '...RRRRCCCCCCCCRRRR...',
      '......RRRRRRRRRR......',
      '......RRRRRRRRRR......',
    ]);
    // Exactly the three colours of the old circles; the core sits inside the rim and the highlight inside the core.
    expect(new Set(fills(r.ops).map(f => f.color))).toEqual(new Set([0xffe9c4, 0x1b1016, 0x6b4a58]));
    const layer = (k: number) => {
      const p = recorder(); const [c, a, rects] = TAPIOCA_PROJECTILE_ART.layers[k];
      for (const [x, y, w, h] of rects) p.g.fillStyle(c, a).fillRect(x, y, w, h);
      return new Set(raster(fills(p.ops)).keys());
    };
    const [rim, core, light] = [layer(0), layer(1), layer(2)];
    for (const k of core) expect(rim.has(k), k).toBe(true);
    for (const k of light) expect(core.has(k), k).toBe(true);
  });

  it('draws integer rectangles only, through Graphics fills, with nothing allocated', () => {
    for (const [, , rects] of TAPIOCA_PROJECTILE_ART.layers) for (const r of rects) for (const v of r) expect(Number.isInteger(v)).toBe(true);
    const code = artSource.slice(artSource.indexOf('export function drawTapiocaProjectile'));
    for (const banned of ['.add.', 'new ', 'generateTexture', '.textures', '.load.', 'postFX', 'preFX', 'setBlendMode', 'lineStyle', 'Circle', 'Math.random', 'const [', '...', '.map(', '.forEach(', '`', 'elapsed', 'rotation', 'sin(']) expect(code, banned).not.toContain(banned);
    for (const banned of ['.png', 'fillGradientStyle', 'setAlpha', 'setTint', 'Glow', 'blur(']) expect(artSource, banned).not.toContain(banned);
    // WebGL and Canvas: the only calls made are fillStyle(colour, alpha) and fillRect with integers, which both
    // Phaser renderers draw as solid axis-aligned quads -- no path, arc, texture or blend state is involved.
    const r = recorder();
    for (let i = 0; i < 50; i++) drawTapiocaProjectile(r.g, 30 + i * 7.37, 60 + i * 11.5);
    for (const o of r.ops) {
      expect(o.op === 'style' || o.op === 'rect').toBe(true);
      if (o.op === 'rect') for (const v of [o.x, o.y, o.w, o.h]) expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe('TAPIOCA A in the scene: same pearls, same cull, same place in the draw', () => {
  it('replaces only the three circles of a size-9 pearl: loop, cull and screen y are 959a5f4\'s', () => {
    const block = pearlBlock();
    expect(block).toBe(`    // Pearls.
    for (const pearl of fight.tapiocas) {
      const py = pearl.y - cam;
      if (py < -30 || py > 840) continue;
      // A pale rim first: a dark pearl on a dark shaft has to read as a THING coming at the player.
      // BOSS TAPIOCA PROJECTILE PIXEL ART V1 (render/tapiocaProjectileArt): the TRIPLE SHOT pearl as 17 rectangles
      // inside the old rim's 22x22, same three colours. Any other size keeps the three circles.
      if (pearl.size === TAPIOCA_PROJECTILE_ART.size) { drawTapiocaProjectile(this.graphics, pearl.x, py); continue; }
      this.graphics.fillStyle(0xffe9c4, 0.85).fillCircle(pearl.x, py, pearl.size + 2);
      this.graphics.fillStyle(0x1b1016, 0.95).fillCircle(pearl.x, py, pearl.size);
      this.graphics.fillStyle(0x6b4a58, 0.8).fillCircle(pearl.x - pearl.size * 0.3, py - pearl.size * 0.3, pearl.size * 0.4);
    }

`);
    // The size the art is for is TRIPLE SHOT's, the one attack in every phase's rotation.
    expect(TAPIOCA_PROJECTILE_ART.size).toBe(TRIPLE_SHOT.size);
    for (const phase of ABYSS_PHASES) expect(phase.attacks).toContain('tripleShot');
  });

  it('draws 17 rects and 3 styles per visible pearl, nothing for a culled one, and the old circles for any other size', () => {
    const s = scenePearls();
    expect(s.frame([])).toEqual([]);
    // One, three, nine pearls (a full TRIPLE SHOT attack).
    for (const n of [1, 3, 9]) {
      const list = Array.from({ length: n }, (_, i) => pearl(40 + i * 40, 100 + i * 60, { id: i }));
      const ops = s.frame(list, 0);
      expect(ops.filter(o => o.op === 'rect')).toHaveLength(17 * n);
      expect(ops.filter(o => o.op === 'style')).toHaveLength(3 * n);
      expect(ops.filter(o => o.op === 'circle')).toHaveLength(0);
    }
    // The cull: py in [-30, 840] is drawn, outside is not, at the same edges as 959a5f4.
    for (const [y, drawn] of [[-30.01, false], [-30, true], [840, true], [840.01, false]] as const) {
      expect(s.frame([pearl(200, 1000 + y)], 1000).length > 0, String(y)).toBe(drawn);
      expect(s.baseline([pearl(200, 1000 + y)], 1000).length > 0, String(y)).toBe(drawn);
    }
    // A size the art was not drawn for keeps 959a5f4's three circles, call for call.
    for (const size of [6, 8, 10, 14]) {
      const list = [pearl(150.3, 420.7, { size })];
      expect(s.frame(list, 20)).toEqual(s.baseline(list, 20));
    }
  });

  it('draws a pearl in every model state the loop sees: in flight, at its last frame of life, shot down this frame', () => {
    const s = scenePearls();
    for (const life of [TRIPLE_SHOT.life, 2.5, 0.001, 0, -0.004]) {
      // The loop never read life: a pearl zeroed by a hit this step is drawn until the boss system drops it, as before.
      const ops = s.frame([pearl(225, 400, { life })]);
      expect(ops.filter(o => o.op === 'rect')).toHaveLength(17);
      expect(s.baseline([pearl(225, 400, { life })]).filter(o => o.op === 'circle')).toHaveLength(3);
    }
    // Velocity, damage and id never reach the drawing.
    const a = s.frame([pearl(225.4, 400.6, { vx: -90, vy: 230, damage: 1, id: 3 })]);
    const b = s.frame([pearl(225.4, 400.6, { vx: 120, vy: -250, damage: 7, id: 99 })]);
    expect(a).toEqual(b);
  });

  it('stays inside the old rim\'s raster square on every frame: floor(c - 11) .. ceil(c + 11), both axes', () => {
    const s = scenePearls();
    const random = seeded(91);
    for (let i = 0; i < 600; i++) {
      // Fractional positions and exact half-pixel ties, as flight produces them.
      const x = i % 5 === 0 ? Math.floor(20 + random() * 410) + 0.5 : 20 + random() * 410;
      const y = i % 7 === 0 ? Math.floor(random() * 900 - 20) + 0.5 : random() * 900 - 20;
      const cam = Math.round(random() * 3000) + (i % 3 === 0 ? 0.25 : 0);
      const ops = s.frame([pearl(x, y + cam)], cam);
      const py = (y + cam) - cam;
      if (py < -30 || py > 840) { expect(ops).toEqual([]); continue; }
      const box = bounds(raster(fills(ops)));
      expect(box.w).toBe(22); expect(box.h).toBe(22);
      expect(box.x).toBe(Math.round(x) - 11); expect(box.y).toBe(Math.round(py) - 11);
      expect(box.x).toBeGreaterThanOrEqual(Math.floor(x - 11)); expect(box.x + box.w).toBeLessThanOrEqual(Math.ceil(x + 11));
      expect(box.y).toBeGreaterThanOrEqual(Math.floor(py - 11)); expect(box.y + box.h).toBeLessThanOrEqual(Math.ceil(py + 11));
    }
  });

  it('keeps boss()\'s draw order: deep, ... beams, PEARLS, bossBody, barrier, tells, body art', () => {
    const boss = bossMethod();
    const i = (s: string) => { const k = boss.indexOf(s); expect(k, s).toBeGreaterThan(-1); return k; };
    const order = ['const edge = fight.boundaryY - cam;', 'for (const beam of fight.beams)', '// Pearls.', 'for (const pearl of fight.tapiocas)',
      'drawTapiocaProjectile(this.graphics, pearl.x, py)', 'this.bossBody(cam);', 'this.bossBarrier(cam);', 'this.bossTells(cam);'];
    for (let k = 1; k < order.length; k++) expect(i(order[k - 1]), order[k]).toBeLessThan(i(order[k]));
    // Same Graphics as before (the scene's `graphics`, set back to `g` just before boss()), and no new layer.
    expect(between(sceneSource, '    this.bossSpeech();', '    this.boss(cam);')).toContain('this.graphics = g;');
    expect(sceneSource.split('this.add.graphics()').length - 1).toBe(13);
    expect(sceneSource.split('this.add.').length - 1).toBe(withoutTapiocaProjectileArt('scenes/GameScene.ts', sceneSource).split('this.add.').length - 1);
    expect(sceneSource.split('drawTapiocaProjectile(').length - 1).toBe(1);
  });

  it('touches no other projectile: player rounds, barrier pearls, cups, beams and enemies draw as at 959a5f4', () => {
    // Every line of the scene outside the two listed hunks is 959a5f4's (below); here, that none of the other
    // things that are round and dangerous calls into the art.
    expect(sceneSource.split('TAPIOCA_PROJECTILE_ART').length - 1).toBe(2);
    for (const other of ['private bossBarrier(', 'for (const cup of fight.cups)', 'for (const b of m.bullets) {', 'private enemy(']) {
      const k = sceneSource.indexOf(other);
      expect(k, other).toBeGreaterThan(-1);
    }
    const pearlsAt = sceneSource.indexOf('drawTapiocaProjectile(this.graphics');
    expect(sceneSource.lastIndexOf('for (const pearl of fight.tapiocas)', pearlsAt)).toBeGreaterThan(sceneSource.lastIndexOf('private boss(cam: number)', pearlsAt));
    // The disabled pours (SHOWER, CUP shots, FULL SCREEN) share size 9; they are not in any phase's rotation, and
    // nothing here turns them on.
    expect([TAPIOCA_SHOWER.size, FULL_SCREEN_TAPIOCA.size, FULL_SCREEN_TAPIOCA.enabled]).toEqual([9, 9, false]);
    for (const phase of ABYSS_PHASES) expect([...phase.attacks].sort()).toEqual(['enemySummon', 'tripleShot']);
  });
});

/**
 * CANVAS SUBPIXEL FIX. The scene translates its Graphics by the shake (and, in SIDE CAVEs, cameraX), often by a
 * fraction of a pixel. 2ffc1b0 drew the rects at integer LOCAL coordinates, so on screen they sat at integer + fraction:
 * WebGL fills by pixel centre and showed hard edges, Canvas 2D antialiased the fractional edge one pixel outside the
 * old rim's raster square. The rects now start on the screen pixel WebGL already filled.
 */
describe('TAPIOCA A under a fractional Graphics translation (Canvas subpixel fix)', () => {
  /** 2ffc1b0's local left/top, and the first pixel WebGL's centre rule fills for an edge at e + t. */
  const before = (c: number) => Math.round(c) - 11;
  const webglFirst = (edge: number, t: number) => Math.ceil(edge + t - 0.5);
  const translations = [0, -0.52, 0.52, 0.5, -0.5, 0.25, -13.25, 13.25, 1.999, -2.0001, 3, -3.75];
  type Rect = Extract<Op, { op: 'rect' }>;
  const screenBox = (ops: Op[], tx: number, ty: number) => bounds(raster(fills(ops).map(f => ({ ...f, x: Math.round(f.x + tx), y: Math.round(f.y + ty) }))));

  it('is 2ffc1b0 call for call with no translation, and with any whole-pixel one', () => {
    const random = seeded(5);
    for (let i = 0; i < 300; i++) {
      const x = 20 + random() * 410 + (i % 5 === 0 ? 0.5 : 0), y = random() * 800, [tx, ty] = [[0, 0], [3, -2], [-7, 0]][i % 3];
      const r = recorder(tx, ty), old = recorder();
      drawTapiocaProjectile(r.g, x, y);
      // 2ffc1b0's helper ignored the translation: its call list is this one with no translation.
      drawTapiocaProjectile(old.g, x, y);
      expect(old.ops.filter(o => o.op === 'rect')[0]).toMatchObject({ x: before(x) + 6, y: before(y) });
      expect(r.ops).toEqual(old.ops);
    }
  });

  it('puts every rect edge on a whole screen pixel: no fractional edge for Canvas 2D to antialias', () => {
    const random = seeded(17);
    for (let i = 0; i < 600; i++) {
      const x = 20 + random() * 410 + (i % 5 === 0 ? 0.5 : 0), y = random() * 800;
      const tx = translations[i % translations.length], ty = i % 4 === 0 ? -0.75 : 0;
      const r = recorder(tx, ty);
      drawTapiocaProjectile(r.g, x, y);
      for (const o of r.ops) if (o.op === 'rect') {
        // The renderer adds the translation back; the screen edge is a whole pixel (to float precision).
        for (const v of [o.x + tx, o.y + ty]) expect(Math.abs(v - Math.round(v)), `${x} ${tx}`).toBeLessThan(1e-9);
        expect(Number.isInteger(o.w) && Number.isInteger(o.h)).toBe(true);
      }
    }
  });

  it("keeps WebGL's pixels: the screen square is exactly the one 2ffc1b0's rects filled by pixel centre", () => {
    const random = seeded(29);
    for (let i = 0; i < 600; i++) {
      const x = 20 + random() * 410 + (i % 7 === 0 ? 0.5 : 0), y = random() * 800 + (i % 9 === 0 ? 0.5 : 0);
      const tx = translations[i % translations.length], ty = i % 4 === 0 ? 0.5 : 0;
      const r = recorder(tx, ty);
      drawTapiocaProjectile(r.g, x, y);
      expect(screenBox(r.ops, tx, ty)).toEqual({ x: webglFirst(before(x), tx), y: webglFirst(before(y), ty), w: 22, h: 22 });
    }
  });

  it("stays inside the old rim circle's raster square floor(c - 11 + t)..ceil(c + 11 + t) at every translation", () => {
    const random = seeded(41);
    for (let i = 0; i < 2000; i++) {
      const x = 20 + random() * 410 + (i % 5 === 0 ? 0.5 : 0), y = random() * 800 + (i % 3 === 0 ? 0.5 : 0);
      const tx = i < 600 ? translations[i % translations.length] : (random() - 0.5) * 8, ty = i % 4 === 0 ? (random() - 0.5) * 2 : 0;
      const r = recorder(tx, ty);
      drawTapiocaProjectile(r.g, x, y);
      const box = screenBox(r.ops, tx, ty);
      expect(box.x).toBeGreaterThanOrEqual(Math.floor(x - 11 + tx)); expect(box.x + box.w).toBeLessThanOrEqual(Math.ceil(x + 11 + tx));
      expect(box.y).toBeGreaterThanOrEqual(Math.floor(y - 11 + ty)); expect(box.y + box.h).toBeLessThanOrEqual(Math.ceil(y + 11 + ty));
    }
  });

  it('keeps the 17 rects, 3 colours, order and pixel map at any translation: only the whole square moves', () => {
    const at = (tx: number) => { const r = recorder(tx, 0); drawTapiocaProjectile(r.g, 200.3, 400.7); return r.ops; };
    const zero = at(0);
    for (const tx of translations) {
      const ops = at(tx);
      expect(ops.map(o => o.op)).toEqual(zero.map(o => o.op));
      expect(ops.filter(o => o.op === 'style')).toEqual(zero.filter(o => o.op === 'style'));
      const shift = (ops[1] as Rect).x - (zero[1] as Rect).x;
      ops.forEach((o, k) => { if (o.op === 'rect') { const z = zero[k] as Rect; expect(o.x - z.x).toBeCloseTo(shift, 9); expect([o.y - z.y, o.w, o.h]).toEqual([0, z.w, z.h]); } });
    }
  });

  it('reads the translation only: the Graphics is not moved, no camera or global setting is touched', () => {
    const r = recorder(-0.52, 0.25);
    drawTapiocaProjectile(r.g, 100.4, 300.6);
    expect([(r.g as unknown as { x: number }).x, (r.g as unknown as { y: number }).y]).toEqual([-0.52, 0.25]);
    const code = artSource.slice(artSource.indexOf('const snap'));
    for (const banned of ['setPosition', '.x =', '.y =', 'new ', 'roundPixels', 'cameras', 'setScroll', 'Math.random']) expect(code, banned).not.toContain(banned);
  });
});

describe('TAPIOCA A changes nothing else', () => {
  it('is 959a5f4 GameScene.ts byte for byte once its two hunks are put back', () => {
    expect(Object.keys(TAPIOCA_ART_HUNKS)).toEqual(['scenes/GameScene.ts']);
    expect(sha256(sceneSource)).not.toBe('d61e22b3460d3a47af281442757820551db64e5f203becdd04883a242b069d26');
    expect(sha256(withoutTapiocaProjectileArt('scenes/GameScene.ts', sceneSource))).toBe('d61e22b3460d3a47af281442757820551db64e5f203becdd04883a242b069d26');
    expect(withoutTapiocaProjectileArt('scenes/GameScene.ts', sceneSource).split(BASELINE_BLOCK).length - 1).toBe(1);
  });

  it('leaves every other source byte-identical to 959a5f4: model, boss system, attacks, physics, art, UI, audio', () => {
    const SOURCES = import.meta.glob(['../src/**/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(SOURCES).filter(isTapiocaProjectileArtFile)).toEqual(['../src/render/tapiocaProjectileArt.ts']);
    const keys = Object.keys(SOURCES).filter(k => k !== '../src/scenes/GameScene.ts' && !isTapiocaProjectileArtFile(k) && !isTimeoutArtFile(k) && !isAirBubbleArtFile(k)).sort();
    expect(keys).toHaveLength(90);
    // The same digest over the same 90 files, computed on a git archive of 959a5f4.
    expect(sha256(keys.map(k => `${k}\n${sha256(SOURCES[k])}`).join('\n'))).toBe('1cecbc7b32c13d3916729660256b162c2ec888d9590e08017812bc2606b1c370');
  });

  it('adds no PNG and no texture: the shipped image set is 959a5f4\'s', () => {
    const pngs = Object.keys(import.meta.glob(['../src/**/*.png', '../public/**/*.png']));
    expect(pngs).toHaveLength(165);
    // The one image with "tapioca" in its name is the bounce-tapioca ENEMY's, a 959a5f4 file, untouched here.
    expect(pngs.filter(p => /tapioca|pearl/i.test(p))).toEqual(['../src/assets/enemies/boss/bounce-tapioca-idle.png']);
    expect(artSource).not.toMatch(/import (?!type)/);
  });

  it('plays exactly as 959a5f4: the same pearls, flights, shoot-downs, hits and phases, seed for seed', () => {
    // Golden values produced by tests/tapiocaTrace.ts on a git archive of 959a5f4.
    const GOLDEN = [
      { digest: '5043530ffc74a334', removedEarly: 106, playerHits: 11, ticks: 9454 },
      { digest: 'b63f8d5a090e0237', removedEarly: 109, playerHits: 8, ticks: 9451 },
      { digest: '70c62d50cfdea439', removedEarly: 106, playerHits: 11, ticks: 9481 },
      { digest: '88a365611ea26ba7', removedEarly: 105, playerHits: 12, ticks: 9485 },
      { digest: 'e7b8d409c408c70c', removedEarly: 106, playerHits: 11, ticks: 9403 },
    ];
    GOLDEN.forEach((want, i) => {
      const got = tapiocaTrace(i + 1);
      expect(got, `seed ${i + 1}`).toEqual({ ...want, pearls: 117, byPhase: [27, 36, 36, 18], maxLive: 9, phases: [1, 2, 3, 4], defeated: true });
    });
  }, 120000);

  it('draws without touching the model: a full fight frame-by-frame leaves every pearl as it found it', () => {
    const s = scenePearls();
    const g = fighting(3);
    let drawn = 0;
    for (let i = 0; i < 120 * 20; i++) {
      // A real round into the open eye every tenth of a second, so TRIPLE SHOT comes round (as in tests/tapiocaTrace.ts).
      if (g.boss.eyeOpen && i % 12 === 6) g.bullets.push(round(g.boss.x, g.boss.eye.y + g.boss.eye.height / 2, 1));
      g.step(1 / 120, 0, false);
      const before = JSON.stringify(g.boss.tapiocas);
      drawn += s.frame(g.boss.tapiocas, g.cameraY).filter(o => o.op === 'rect').length;
      expect(JSON.stringify(g.boss.tapiocas)).toBe(before);
    }
    expect(drawn).toBeGreaterThan(0);
  }, 60000);
});
