import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';
import { BALLOON_ART, drawBalloonBody } from '../src/render/balloonArt';
import { UPGRADES, UPGRADE_TUNING } from '../src/data/upgrades';
import { GameModel } from '../src/systems/GameModel';
import { BALLOON_TRACE_SCENARIOS, balloonTrace } from './balloonTrace';
import sceneSource from '../src/scenes/GameScene.ts?raw';
import balloonSource from '../src/render/balloonArt.ts?raw';
import { isTitleAudioGateFile, withoutTitleAudioGate } from './titleAudioGateRestore';
import { isJetpackArtFile, withoutJetpackArt } from './jetpackArtRestore';

/**
 * HEART BALLOON PIXEL ART RUNTIME INTEGRATION V1. Candidate A of output/balloon-visual-selection-v1
 * (claude-integration-spec.md, assets/balloon-A.json): the balloon's two fillCircles become 51 hard-edged
 * rectangles inside the same radius-13 circle, on the same Graphics, in the same place in the draw order,
 * at alpha 1. Drawing only: whether it exists, where it rides, what touches it, the blast, the slower fall,
 * the SECTION return and the tether are exactly 6d83590's, and so is every other line of the scene.
 */

const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: Uint8Array | string) => { digest: (e: string) => string } } };
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const between = (text: string, from: string, to: string) => {
  const a = text.indexOf(from), b = text.indexOf(to, a);
  expect(a, from).toBeGreaterThanOrEqual(0); expect(b, to).toBeGreaterThan(a);
  return text.slice(a, b);
};
const drawMethod = () => between(sceneSource, '  private draw() {', '  private surface(');
const IMPORT_LINE = "import { BALLOON_ART, drawBalloonBody } from '../render/balloonArt';\n";
const TETHER = '      this.graphics.lineStyle(1, 0xfba4b9, 0.5).lineBetween(m.balloon.x, by + 12, p0.x, p0.y - cam - 18);\n';

/** 6d83590's balloon block, byte for byte. */
const BASELINE_BLOCK = `    // HEART BALLOON, above the player's head, holding the fall back until something pops it.
    if (m.balloon?.alive) {
      const by = m.balloon.y - cam;
${TETHER}      this.graphics.fillStyle(0xf497ab, 0.92).fillCircle(m.balloon.x, by, 13);
      this.graphics.fillStyle(0xffd2dd, 0.9).fillCircle(m.balloon.x - 4, by - 4, 4);
    }
`;
const balloonBlock = () => between(drawMethod(), '    // HEART BALLOON, above', '    // DRONE: a companion');

const KEY = 0x3d1426, SHADE = 0xc85a7c, BODY = 0xf497ab, LIGHT = 0xffd2dd, SPECULAR = 0xfff4f6;
/** output/balloon-visual-selection-v1/assets/balloon-A-rects.json, in its order (the layered encoding of the map). */
const SPEC = [
  [9, 0, 8, 1, KEY], [7, 1, 12, 1, KEY], [5, 2, 16, 1, KEY], [4, 3, 18, 1, KEY], [3, 4, 20, 1, KEY],
  [2, 5, 22, 2, KEY], [1, 7, 24, 2, KEY], [0, 9, 26, 8, KEY], [1, 17, 24, 2, KEY], [2, 19, 22, 2, KEY],
  [3, 21, 20, 1, KEY], [4, 22, 18, 1, KEY], [5, 23, 16, 1, KEY], [7, 24, 12, 1, KEY], [9, 25, 8, 1, KEY],
  [9, 1, 8, 1, SHADE], [7, 2, 12, 1, SHADE], [5, 3, 16, 1, SHADE], [4, 4, 18, 1, SHADE], [3, 5, 20, 2, SHADE],
  [2, 7, 22, 2, SHADE], [1, 9, 24, 8, SHADE], [2, 17, 22, 2, SHADE], [3, 19, 20, 2, SHADE], [4, 21, 18, 1, SHADE],
  [5, 22, 16, 1, SHADE], [7, 23, 12, 1, SHADE], [9, 24, 8, 1, SHADE],
  [9, 1, 8, 1, BODY], [7, 2, 12, 1, BODY], [5, 3, 15, 1, BODY], [4, 4, 17, 1, BODY], [3, 5, 19, 2, BODY],
  [2, 7, 20, 1, BODY], [2, 8, 21, 1, BODY], [1, 9, 22, 4, BODY], [1, 13, 21, 3, BODY], [1, 16, 20, 1, BODY],
  [2, 17, 18, 2, BODY], [3, 19, 16, 1, BODY], [4, 20, 13, 1, BODY], [5, 21, 11, 1, BODY], [8, 22, 5, 1, BODY],
  [7, 5, 3, 1, LIGHT], [6, 6, 5, 1, LIGHT], [5, 7, 6, 1, LIGHT], [5, 8, 5, 1, LIGHT], [5, 9, 4, 1, LIGHT],
  [6, 10, 2, 1, LIGHT],
  [7, 6, 2, 1, SPECULAR], [6, 7, 2, 1, SPECULAR],
];
/** output/balloon-visual-selection-v1/assets/balloon-A.json `map`: the normative 26x26 pixel art. */
const MAP = [
  '.........OOOOOOOO.........',
  '.......OOPPPPPPPPOO.......',
  '.....OOPPPPPPPPPPPPOO.....',
  '....OPPPPPPPPPPPPPPPSO....',
  '...OPPPPPPPPPPPPPPPPPSO...',
  '..OPPPPLLLPPPPPPPPPPPPSO..',
  '..OPPPLWWLLPPPPPPPPPPPSO..',
  '.OPPPLWWLLLPPPPPPPPPPPSSO.',
  '.OPPPLLLLLPPPPPPPPPPPPPSO.',
  'OPPPPLLLLPPPPPPPPPPPPPPSSO',
  'OPPPPPLLPPPPPPPPPPPPPPPSSO',
  'OPPPPPPPPPPPPPPPPPPPPPPSSO',
  'OPPPPPPPPPPPPPPPPPPPPPPSSO',
  'OPPPPPPPPPPPPPPPPPPPPPSSSO',
  'OPPPPPPPPPPPPPPPPPPPPPSSSO',
  'OPPPPPPPPPPPPPPPPPPPPPSSSO',
  'OPPPPPPPPPPPPPPPPPPPPSSSSO',
  '.OPPPPPPPPPPPPPPPPPPSSSSO.',
  '.OPPPPPPPPPPPPPPPPPPSSSSO.',
  '..OPPPPPPPPPPPPPPPPSSSSO..',
  '..OSPPPPPPPPPPPPPSSSSSSO..',
  '...OSPPPPPPPPPPPSSSSSSO...',
  '....OSSSPPPPPSSSSSSSSO....',
  '.....OOSSSSSSSSSSSSOO.....',
  '.......OOSSSSSSSSOO.......',
  '.........OOOOOOOO.........',
];
const LETTER: Record<number, string> = { [KEY]: 'O', [SHADE]: 'S', [BODY]: 'P', [LIGHT]: 'L', [SPECULAR]: 'W' };

interface Call { op: string; args: number[]; color?: number; alpha?: number }
interface Fill { x: number; y: number; w: number; h: number; color: number; alpha: number }
/** A Graphics stand-in that records every call the balloon block can make, fills with their style. */
function recorder() {
  const calls: Call[] = [], fills: Fill[] = [];
  let color = -1, alpha = -1;
  const g = {
    fillStyle(c: number, a = 1) { color = c; alpha = a; calls.push({ op: 'fillStyle', args: [c, a] }); return g; },
    fillRect(x: number, y: number, w: number, h: number) { fills.push({ x, y, w, h, color, alpha }); calls.push({ op: 'fillRect', args: [x, y, w, h], color, alpha }); return g; },
    fillCircle(x: number, y: number, r: number) { calls.push({ op: 'fillCircle', args: [x, y, r], color, alpha }); return g; },
    lineStyle(w: number, c: number, a: number) { calls.push({ op: 'lineStyle', args: [w, c, a] }); return g; },
    lineBetween(x1: number, y1: number, x2: number, y2: number) { calls.push({ op: 'lineBetween', args: [x1, y1, x2, y2] }); return g; },
  };
  return { g: g as unknown as Phaser.GameObjects.Graphics, calls, fills };
}
/** Paint the fills in order onto a pixel map: "x,y" -> colour. */
const raster = (fills: Fill[]) => {
  const px = new Map<string, number>();
  for (const f of fills) for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) px.set(`${x},${y}`, f.color);
  return px;
};
const bounds = (px: Map<string, number>) => {
  const pts = [...px.keys()].map(k => k.split(',').map(Number));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1 };
};
const rows = (px: Map<string, number>, x0: number, y0: number) => Array.from({ length: 26 }, (_, y) => Array.from({ length: 26 }, (_, x) => {
  const c = px.get(`${x0 + x},${y0 + y}`); return c === undefined ? '.' : LETTER[c] ?? '?';
}).join(''));

/**
 * The scene's own balloon drawing, run against a stand-in scene: the block out of draw() exactly as GameScene.ts
 * has it, on a recording Graphics. And 6d83590's block on the same frame.
 */
function sceneBalloon() {
  const candidate = new Function('m', 'cam', 'p0', 'drawBalloonBody', 'BALLOON_ART', balloonBlock());
  const baseline = new Function('m', 'cam', 'p0', BASELINE_BLOCK);
  const run = (block: (this: unknown, ...a: unknown[]) => void, m: GameModel, ...extra: unknown[]) => {
    const r = recorder();
    block.call({ model: m, graphics: r.g }, m, m.cameraY, m.player, ...extra);
    return r;
  };
  return {
    frame: (m: GameModel) => run(candidate as never, m, drawBalloonBody, BALLOON_ART),
    baseline: (m: GameModel) => run(baseline as never, m),
  };
}

const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
function model(held: boolean, area: 1 | 2 | 3 | 4 | 'boss' = 1) {
  const g = new GameModel(false, seeded(23));
  // Granted before the SECTION opens: the balloon is made at the opening, as in a run.
  if (held) g.upgrades.grant('heartBalloon');
  if (area === 'boss') g.jumpToNimushi(); else g.jumpToStage(area, 1);
  return g;
}

describe('HEART BALLOON A: the 26x26 pixel art', () => {
  it('is the spec table exactly: 51 rectangles, order, offsets, sizes, colours, alpha 1', () => {
    expect(BALLOON_ART.body).toHaveLength(51);
    expect(BALLOON_ART.body.map(r => [...r])).toEqual(SPEC);
    expect([BALLOON_ART.originX, BALLOON_ART.originY, BALLOON_ART.width, BALLOON_ART.height]).toEqual([-13, -13, 26, 26]);
    const r = recorder();
    drawBalloonBody(r.g, 100, 200);
    expect(r.fills).toEqual(SPEC.map(([dx, dy, w, h, color]) => ({ x: 100 + dx, y: 200 + dy, w, h, color, alpha: 1 })));
    expect(r.calls.filter(c => c.op !== 'fillStyle' && c.op !== 'fillRect')).toEqual([]);
  });

  it('paints the normative map of balloon-A.json, pixel for pixel', () => {
    const r = recorder();
    drawBalloonBody(r.g, 0, 0);
    expect(rows(raster(r.fills), 0, 0)).toEqual(MAP);
  });

  it('uses five colours: a dark key, a shade, the old body pink, the old highlight pink and a specular', () => {
    const r = recorder();
    drawBalloonBody(r.g, 0, 0);
    expect(new Set(r.fills.map(f => f.color))).toEqual(new Set([KEY, SHADE, BODY, LIGHT, SPECULAR]));
    // The two pinks 6d83590 drew with stay: the body is 0xf497ab, the highlight 0xffd2dd.
    expect(BODY).toBe(0xf497ab); expect(LIGHT).toBe(0xffd2dd);
    expect(new Set(r.fills.map(f => f.alpha))).toEqual(new Set([1]));
    const count: Record<string, number> = {};
    for (const c of MAP.join('')) count[c] = (count[c] ?? 0) + 1;
    expect(count).toEqual({ '.': 136, O: 72, P: 358, S: 85, L: 21, W: 4 });
  });

  it('stays inside the old radius-13 circle and fills its 26x26 box', () => {
    const r = recorder();
    drawBalloonBody(r.g, 0, 0);
    const px = raster(r.fills);
    expect(bounds(px)).toEqual({ x: 0, y: 0, w: 26, h: 26 });
    for (const k of px.keys()) {
      const [x, y] = k.split(',').map(Number);
      expect((x + 0.5 - 13) ** 2 + (y + 0.5 - 13) ** 2, k).toBeLessThanOrEqual(13 * 13);
    }
    // Every pixel whose centre the circle covers is painted: the silhouette is the whole disc, not a smaller one.
    for (let y = 0; y < 26; y++) for (let x = 0; x < 26; x++) {
      if ((x + 0.5 - 13) ** 2 + (y + 0.5 - 13) ** 2 <= 169) expect(px.has(`${x},${y}`), `${x},${y}`).toBe(true);
    }
  });

  it('is outlined all round: every edge pixel of the disc is the dark key, nothing inside it is', () => {
    for (let y = 0; y < 26; y++) for (let x = 0; x < 26; x++) {
      const c = MAP[y][x]; if (c === '.') continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (MAP[y + dy]?.[x + dx] ?? '.') === '.');
      expect(c === 'O', `${x},${y}`).toBe(edge);
    }
  });

  it('draws with integer rectangles only, nothing allocated, nothing but Graphics fills', () => {
    for (const row of BALLOON_ART.body) for (const v of row) expect(Number.isInteger(v)).toBe(true);
    const code = balloonSource.slice(balloonSource.indexOf('export function drawBalloonBody'));
    for (const banned of ['.add.', 'new ', 'generateTexture', '.textures', '.load.', 'postFX', 'preFX', 'setBlendMode', 'lineStyle', 'Circle', 'Math.random', 'elapsed', 'const [', '...', '.map(', '.forEach(']) expect(code, banned).not.toContain(banned);
    for (const banned of ['.png', 'fillGradientStyle', 'setAlpha', 'setTint', 'Glow', 'blur(', 'gravity']) expect(balloonSource, banned).not.toContain(banned);
  });
});

describe('HEART BALLOON A in the scene: same place, same tether, same layer', () => {
  it('replaces only the two circles: the block keeps 6d83590 gate, centre and tether', () => {
    expect(balloonBlock()).toBe(`    // HEART BALLOON, above the player's head, holding the fall back until something pops it.
    if (m.balloon?.alive) {
      const by = m.balloon.y - cam;
${TETHER}      // HEART BALLOON PIXEL ART V1 (render/balloonArt): 51 rectangles inside the old radius-13 circle, alpha 1.
      drawBalloonBody(this.graphics, Math.round(m.balloon.x + BALLOON_ART.originX), Math.round(by + BALLOON_ART.originY));
    }
`);
    // `alive` is the only gate, as before: no AREA, BOSS, gravity, state or screen check added.
    expect(balloonBlock().split('if (').length - 1).toBe(1);
    expect(balloonBlock()).not.toContain('fillCircle');
  });

  it('draws nothing without the upgrade, or once the balloon has popped, in any AREA or the fight', () => {
    const s = sceneBalloon();
    for (const area of [1, 2, 3, 4, 'boss'] as const) {
      const m = model(false, area);
      expect(m.balloon).toBeNull();
      expect(s.frame(m).calls).toEqual([]); expect(s.baseline(m).calls).toEqual([]);
      const popped = model(true, area);
      popped.balloon!.alive = false;
      expect(s.frame(popped).calls).toEqual([]); expect(s.baseline(popped).calls).toEqual([]);
    }
  });

  it('draws the tether first, with exactly 6d83590 style and ends, then 51 opaque rectangles and no circle', () => {
    const s = sceneBalloon();
    for (const area of [1, 2, 3, 4, 'boss'] as const) {
      const m = model(true, area);
      const cand = s.frame(m).calls, base = s.baseline(m).calls;
      expect(cand.slice(0, 2)).toEqual(base.slice(0, 2));
      expect(cand.slice(0, 2)).toEqual([
        { op: 'lineStyle', args: [1, 0xfba4b9, 0.5] },
        { op: 'lineBetween', args: [m.balloon!.x, m.balloon!.y - m.cameraY + 12, m.player.x, m.player.y - m.cameraY - 18] },
      ]);
      const rest = cand.slice(2);
      expect(rest.filter(c => c.op === 'fillRect')).toHaveLength(51);
      expect(rest.some(c => c.op === 'fillCircle' || c.op.startsWith('line'))).toBe(false);
      for (const c of rest.filter(c => c.op === 'fillRect')) expect(c.alpha).toBe(1);
      // 6d83590 drew two translucent circles here: the body at .92 and the highlight at .9.
      expect(base.slice(2).filter(c => c.op === 'fillCircle').map(c => [c.args[2], c.alpha])).toEqual([[13, 0.92], [4, 0.9]]);
    }
  });

  it('sits on the model centre at every position: inside the old circle, the box rounded from the centre', () => {
    const s = sceneBalloon();
    const m = model(true, 2);
    const random = seeded(91);
    for (let i = 0; i < 400; i++) {
      // Fractional positions and half-pixel ties, as the eased follow produces them.
      m.balloon!.x = 30 + random() * 390 + (i % 4 === 0 ? 0.5 : 0);
      m.balloon!.y = m.cameraY + 30 + random() * 740 + (i % 6 === 0 ? 0.5 : 0);
      const cx = m.balloon!.x, cy = m.balloon!.y - m.cameraY;
      const px = raster(s.frame(m).fills), box = bounds(px);
      expect(box).toEqual({ x: Math.round(cx - 13), y: Math.round(cy - 13), w: 26, h: 26 });
      // The box's centre is the model centre to the nearest pixel...
      expect(Math.abs(box.x + 13 - cx)).toBeLessThanOrEqual(0.5); expect(Math.abs(box.y + 13 - cy)).toBeLessThanOrEqual(0.5);
      // ...and the art is the same map wherever it is.
      expect(rows(px, box.x, box.y)).toEqual(MAP);
    }
  });

  it('rides the model unchanged: player + (0, -46 x gravity), below the player under the BOSS reversal', () => {
    expect([UPGRADE_TUNING.heartBalloon.offsetY, UPGRADE_TUNING.heartBalloon.follow]).toEqual([-46, 6]);
    const s = sceneBalloon();
    for (const area of [1, 'boss'] as const) {
      const m = model(true, area);
      m.balloon!.x = m.player.x; m.balloon!.y = m.player.y - 46 * m.gravitySign;
      const box = bounds(raster(s.frame(m).fills));
      expect(box).toEqual({ x: Math.round(m.player.x - 13), y: Math.round(m.player.y - m.cameraY - 46 * m.gravitySign - 13), w: 26, h: 26 });
      expect(m.gravitySign).toBe(area === 'boss' ? -1 : 1);
      // No flip under the reversal: the same map, highlight still upper-left.
      expect(rows(raster(s.frame(m).fills), box.x, box.y)).toEqual(MAP);
    }
  });

  it('keeps the after-enemies draw order: bullets, tether, balloon, DRONE, INVUL, HIGH, sight, jetpack, player, HURT', () => {
    const draw = drawMethod();
    const i = (s: string) => { const k = draw.indexOf(s); expect(k, s).toBeGreaterThan(-1); return k; };
    const order = [
      'this.graphics = this.afterEnemies;', '// BONES', 'for (const b of m.bullets) {', '// HEART BALLOON', '.lineBetween(m.balloon.x, by + 12,',
      'drawBalloonBody(this.graphics,', '// DRONE: a companion', 'drawDroneHull(this.graphics,', 'drawInvulShimmer(this.graphics, x, y, m.hp, p.invincible);',
      'if (high) drawCoinHighChips(', "if (m.upgrades.has('laserSight')) {", 'if (m.jetpackActive) {', 'const art = this.playerArt?.render(',
      'const foreground = this.artForeground ?? g;', 'drawHurtImpact(foreground, x, y, this.hurtAge);', 'for (const particle of this.particles)',
    ];
    for (let k = 1; k < order.length; k++) expect(i(order[k - 1]), order[k]).toBeLessThan(i(order[k]));
    // Same layer set as 6d83590: no Graphics, image, container or texture added for it.
    expect(sceneSource.split('this.add.graphics()').length - 1).toBe(13);
    expect(sceneSource.split('drawBalloonBody(').length - 1).toBe(1);
    expect(sceneSource.split('fillCircle(m.balloon').length - 1).toBe(0);
  });
});

describe('HEART BALLOON A changes nothing else', () => {
  it('is 6d83590 GameScene.ts byte for byte once the two circles and the import are put back', () => {
    const block = balloonBlock();
    expect(sceneSource.split(block).length - 1).toBe(1);
    expect(sceneSource.split(IMPORT_LINE).length - 1).toBe(1);
    // The JETPACK's exhaust changed after dc51d0b (tests/jetpackArt.test.ts): put its three strips back first.
    const restored = withoutJetpackArt('scenes/GameScene.ts', sceneSource).replace(IMPORT_LINE, '').replace(block, BASELINE_BLOCK);
    expect(sha256(restored)).toBe('b8e7c8bd6fb8fb830ad6d12194c5eef890579607f62faded4b15ccb74b3e27ef');
  });

  it('leaves every other source byte-identical to 6d83590: model, upgrades, icons, DRONE, CORPSE, feedback, text, UI', () => {
    const SOURCES = import.meta.glob(['../src/**/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    // TITLE AUDIO ENTRY GATE V1's two new files left out and its hunks taken back out (tests/titleAudioGateRestore.ts).
    // render/jetpackArt.ts is the JETPACK's exhaust, added after dc51d0b (tests/jetpackArt.test.ts) -- not part of this change.
    const keys = Object.keys(SOURCES).filter(k => k !== '../src/scenes/GameScene.ts' && k !== '../src/render/balloonArt.ts' && !isTitleAudioGateFile(k) && !isJetpackArtFile(k)).sort();
    expect(keys).toHaveLength(86);
    // The same digest over the same 86 files, computed on a git archive of 6d83590.
    expect(sha256(keys.map(k => `${k}\n${sha256(withoutTitleAudioGate(k, SOURCES[k]))}`).join('\n'))).toBe('1f195bb995e56a418ebdd568a41864f03ebf8270e3f21f1c4c8fb55d295d2d6c');
    expect(UPGRADES.filter(u => u.id === 'heartBalloon')).toHaveLength(1);
  });

  it('keeps every HEART BALLOON rule: touch radius 16, blast 82 / 3, fall x0.82', () => {
    const t = UPGRADE_TUNING.heartBalloon;
    expect([t.radius, t.blastRadius, t.blastDamage, t.fallMultiplier]).toEqual([16, 82, 3, 0.82]);
  });

  it('adds no PNG: the shipped image set is the 6d83590 one, the balloon only as its upgrade icon', () => {
    const pngs = Object.keys(import.meta.glob(['../src/**/*.png', '../public/**/*.png']));
    expect(pngs).toHaveLength(165);
    expect(pngs.filter(p => /balloon/i.test(p))).toEqual(['../src/assets/upgrades/heart-balloon.png']);
  });

  it('plays exactly as 6d83590: the same balloon, pops, blasts, kills, fall, SECTION returns and reversal', () => {
    // Golden values produced by tests/balloonTrace.ts on a git archive of 6d83590.
    const GOLDEN: Record<string, { digest: string; pops: number; revivals: number; explosions: number; kills: number; hits: number; sections: number; aliveSteps: number }> = {
      'area1 balloon': { digest: '54921d480d260a42', pops: 1, revivals: 0, explosions: 1, kills: 11, hits: 0, sections: 3, aliveSteps: 3003 },
      'area1 balloon mortal': { digest: 'ec91452c32a629a7', pops: 0, revivals: 0, explosions: 0, kills: 11, hits: 0, sections: 3, aliveSteps: 3600 },
      'area1 plain': { digest: '9a5f95dbd7e66d7c', pops: 0, revivals: 0, explosions: 0, kills: 7, hits: 0, sections: 3, aliveSteps: 0 },
      'area1 revival x3': { digest: '8643246649da8774', pops: 5, revivals: 3, explosions: 5, kills: 38, hits: 0, sections: 9, aliveSteps: 6569 },
      'area2 balloon': { digest: '2ed743688d6a8920', pops: 1, revivals: 0, explosions: 1, kills: 9, hits: 0, sections: 3, aliveSteps: 2916 },
      'area2 balloon+drone': { digest: '281d1566e03916c7', pops: 0, revivals: 0, explosions: 0, kills: 18, hits: 0, sections: 3, aliveSteps: 3600 },
      'area3 balloon': { digest: '5d7c4fc3bd81f32e', pops: 0, revivals: 0, explosions: 0, kills: 7, hits: 0, sections: 3, aliveSteps: 3600 },
      'area3 stacked hurt': { digest: '67d7d57d3a08a19a', pops: 1, revivals: 0, explosions: 1, kills: 17, hits: 4, sections: 3, aliveSteps: 2659 },
      'area4 balloon': { digest: '1fd4c40056973fb7', pops: 3, revivals: 0, explosions: 3, kills: 16, hits: 0, sections: 3, aliveSteps: 2063 },
      'area4 revival x2': { digest: '9ae06e368561216c', pops: 5, revivals: 2, explosions: 5, kills: 27, hits: 0, sections: 6, aliveSteps: 3512 },
      'boss reversed balloon': { digest: 'b123b162880ffde1', pops: 2, revivals: 0, explosions: 2, kills: 42, hits: 32, sections: 3, aliveSteps: 5739 },
      'boss reversed stacked': { digest: '49baacd71817af93', pops: 0, revivals: 0, explosions: 0, kills: 34, hits: 0, sections: 3, aliveSteps: 7200 },
    };
    const got = Object.fromEntries(Object.entries(BALLOON_TRACE_SCENARIOS).map(([name, s]) => [name, balloonTrace(s)]));
    expect(got).toEqual(GOLDEN);
  }, 60_000);
});
