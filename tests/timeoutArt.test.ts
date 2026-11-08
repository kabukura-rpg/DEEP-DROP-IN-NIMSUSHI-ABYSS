import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';
import { TIMEOUT_ART, TIMEOUT_GEOMETRY, drawTimeoutArt } from '../src/render/timeoutArt';
import { UPGRADE_TUNING } from '../src/data/upgrades';
import { GameModel } from '../src/systems/GameModel';
import { TIMEOUT_ART_HUNKS, isTimeoutArtFile, withoutTimeoutArt } from './timeoutArtRestore';
import { isAirBubbleArtFile } from './airBubbleArtRestore';
import { TIMEOUT_TRACE_SCENARIOS, naturalTimeoutRun, timeoutTrace } from './timeoutTrace';
import sceneSource from '../src/scenes/GameScene.ts?raw';
import artSource from '../src/render/timeoutArt.ts?raw';

/**
 * TIMEOUT AREA PIXEL ART V1 -- runtime integration of candidate A (output/timeout-area-visual-design-v1,
 * claude-integration-spec.md). The TIMEOUT bubble, a smooth fillCircle + strokeCircle at e9b0e2a, becomes 53 field
 * and 120 rim rectangles on 2px steps, one colour, on the same Graphics (`underAbyss`), in the same loop, behind the
 * same cull, with the same pulse, oldest bubble first as before. Drawing only: where bubbles come from, how big they
 * are, what they stop and when they go are exactly e9b0e2a's, and so is every other line of the scene.
 */

const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: Uint8Array | string) => { digest: (e: string) => string } } };
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const between = (text: string, from: string, to: string) => {
  const a = text.indexOf(from), b = text.indexOf(to, a);
  expect(a, from).toBeGreaterThanOrEqual(0); expect(b, to).toBeGreaterThan(a);
  return text.slice(a, b);
};
const bubbleBlock = () => between(sceneSource, '    this.graphics = this.underAbyss;\n', '    // Bodies.');
/** e9b0e2a's bubble loop, byte for byte. */
const BASELINE_BLOCK = `    this.graphics = this.underAbyss;
    for (const bubble of m.timeoutBubbles) {
      const by = bubble.y - cam;
      if (by < -bubble.radius || by > 820 + bubble.radius) continue;
      const pulse = 0.1 + Math.abs(Math.sin(this.model.elapsed * 1.4 + bubble.id)) * 0.06;
      this.graphics.fillStyle(0x9fe8f5, pulse).fillCircle(bubble.x, by, bubble.radius);
      this.graphics.lineStyle(2, 0x9fe8f5, 0.5).strokeCircle(bubble.x, by, bubble.radius);
    }
`;
/** sha256 of JSON.stringify(geometry) for candidate A in output/timeout-area-visual-design-v1/timeout-art.mjs. */
const SPEC_GEOMETRY_SHA = 'bbe84efbabc8fb2873073a7f2be4fa27e430f5a31c65f86920f316b22dc80062';

type Op = { op: 'style'; color: number; alpha: number } | { op: 'rect'; x: number; y: number; w: number; h: number } | { op: string; args: number[] };
/** A recording Graphics; `tx`/`ty` are its own translation (the scene's shake / cameraX offset, as g.x / g.y). */
function recorder(tx = 0, ty = 0) {
  const ops: Op[] = [];
  const g = {
    x: tx, y: ty,
    fillStyle(color: number, alpha = 1) { ops.push({ op: 'style', color, alpha }); return g; },
    fillRect(x: number, y: number, w: number, h: number) { ops.push({ op: 'rect', x, y, w, h }); return g; },
    fillCircle(...args: number[]) { ops.push({ op: 'fillCircle', args }); return g; },
    lineStyle(...args: number[]) { ops.push({ op: 'lineStyle', args }); return g; },
    strokeCircle(...args: number[]) { ops.push({ op: 'strokeCircle', args }); return g; },
  };
  return { g: g as unknown as Phaser.GameObjects.Graphics, ops };
}
const rects = (ops: Op[]) => ops.filter((o): o is Extract<Op, { op: 'rect' }> => o.op === 'rect');
const styles = (ops: Op[]) => ops.filter((o): o is Extract<Op, { op: 'style' }> => o.op === 'style');
/** Paint the rects onto a pixel map ("x,y" -> how many rects cover it). */
const coverage = (list: { x: number; y: number; w: number; h: number }[]) => {
  const px = new Map<string, number>();
  for (const f of list) for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) px.set(`${x},${y}`, (px.get(`${x},${y}`) ?? 0) + 1);
  return px;
};
const asRects = (list: readonly (readonly number[])[]) => list.map(([x, y, w, h]) => ({ x, y, w, h }));
/** The 2x2 cells (top-left on even offsets) whose farthest corner from the centre is within `r`. */
const cellsWithin = (r: number) => {
  const out = new Set<string>();
  for (let y = -100; y < 100; y += 2) for (let x = -100; x < 100; x += 2) {
    const fx = Math.max(Math.abs(x), Math.abs(x + 2)), fy = Math.max(Math.abs(y), Math.abs(y + 2));
    if (fx * fx + fy * fy <= r * r) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) out.add(`${x + dx},${y + dy}`);
  }
  return out;
};
const pulseOf = (elapsed: number, id: number) => 0.1 + Math.abs(Math.sin(elapsed * 1.4 + id)) * 0.06;

/** The scene's own bubble loop, run against a stand-in scene: the block out of draw() exactly as GameScene.ts has it. */
function sceneBubbles(tx = 0) {
  const candidate = new Function('m', 'cam', 'drawTimeoutArt', bubbleBlock());
  const baseline = new Function('m', 'cam', BASELINE_BLOCK);
  const run = (block: (this: unknown, ...a: unknown[]) => void, bubbles: GameModel['timeoutBubbles'], cam: number, elapsed: number, ...extra: unknown[]) => {
    const r = recorder(tx);
    const scene = { underAbyss: r.g, graphics: null as unknown, model: { elapsed } };
    block.call(scene, { timeoutBubbles: bubbles }, cam, ...extra);
    expect(scene.graphics).toBe(r.g);
    return r.ops;
  };
  return {
    frame: (bubbles: GameModel['timeoutBubbles'], cam = 0, elapsed = 0) => run(candidate as never, bubbles, cam, elapsed, drawTimeoutArt),
    baseline: (bubbles: GameModel['timeoutBubbles'], cam = 0, elapsed = 0) => run(baseline as never, bubbles, cam, elapsed),
  };
}
const bubble = (id: number, x: number, y: number) => ({ id, x, y, radius: UPGRADE_TUNING.timeout.radius });

describe('TIMEOUT A: the stepped disc', () => {
  it('is candidate A exactly: 53 field and 120 rim rects, the reference geometry byte for byte', () => {
    expect(TIMEOUT_GEOMETRY.field).toHaveLength(53);
    expect(TIMEOUT_GEOMETRY.rim).toHaveLength(120);
    expect(sha256(JSON.stringify({ field: TIMEOUT_GEOMETRY.field, rim: TIMEOUT_GEOMETRY.rim }))).toBe(SPEC_GEOMETRY_SHA);
    expect(TIMEOUT_GEOMETRY.field.slice(0, 2)).toEqual([[-18, -92, 36, 2], [-26, -90, 52, 2]]);
    expect(TIMEOUT_GEOMETRY.rim.slice(0, 3)).toEqual([[-18, -94, 36, 2], [-26, -92, 8, 2], [18, -92, 8, 2]]);
  });

  it('is cut from the model\'s own circle: radius 96, 2px grid, one colour #9fe8f5', () => {
    expect(TIMEOUT_ART).toEqual({ radius: 96, grid: 2, color: 0x9fe8f5 });
    expect(TIMEOUT_ART.radius).toBe(UPGRADE_TUNING.timeout.radius);
  });

  it('puts every edge on the 2px grid from the centre, every size a whole even number', () => {
    for (const r of [...TIMEOUT_GEOMETRY.field, ...TIMEOUT_GEOMETRY.rim]) {
      for (const v of r) { expect(Number.isInteger(v)).toBe(true); expect(Math.abs(v % 2)).toBe(0); }
      expect(r[2]).toBeGreaterThan(0); expect(r[3]).toBeGreaterThan(0);
    }
  });

  it('covers exactly the cells whose farthest corner is within 96 (field: within 94), each pixel once, no overlap', () => {
    const field = coverage(asRects(TIMEOUT_GEOMETRY.field)), rim = coverage(asRects(TIMEOUT_GEOMETRY.rim));
    const both = coverage(asRects([...TIMEOUT_GEOMETRY.field, ...TIMEOUT_GEOMETRY.rim]));
    expect([...both.values()].every(n => n === 1)).toBe(true);
    expect(new Set(field.keys())).toEqual(cellsWithin(94));
    const disc = cellsWithin(96);
    expect(new Set(both.keys())).toEqual(disc);
    for (const k of rim.keys()) expect(field.has(k)).toBe(false);
    // Every rect vertex within r96 of the rounded centre; the bbox is [-94, 94) on both axes.
    for (const [x, y, w, h] of [...TIMEOUT_GEOMETRY.field, ...TIMEOUT_GEOMETRY.rim])
      for (const [vx, vy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) expect(Math.hypot(vx, vy)).toBeLessThanOrEqual(96);
    const pts = [...both.keys()].map(k => k.split(',').map(Number));
    expect([Math.min(...pts.map(p => p[0])), Math.max(...pts.map(p => p[0])) + 1, Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[1])) + 1]).toEqual([-94, 94, -94, 94]);
    // A 2px rim all round: every rim cell is outside r94's cells, every field cell has a rim or field neighbour.
    expect(rim.size + field.size).toBe(disc.size);
  });

  it('draws 2 styles and 173 rects per bubble: field at pulse, then rim at .5 + .5 * pulse, same colour', () => {
    const { g, ops } = recorder();
    drawTimeoutArt(g, 225, 350, 0.13);
    expect(ops).toHaveLength(175);
    expect(ops[0]).toEqual({ op: 'style', color: 0x9fe8f5, alpha: 0.13 });
    expect(ops[54]).toEqual({ op: 'style', color: 0x9fe8f5, alpha: 0.5 + 0.5 * 0.13 });
    expect(rects(ops.slice(1, 54))).toHaveLength(53);
    expect(rects(ops.slice(55))).toHaveLength(120);
    expect(rects(ops)[0]).toEqual({ op: 'rect', x: 225 - 18, y: 350 - 92, w: 36, h: 2 });
    expect(ops.some(o => ['fillCircle', 'strokeCircle', 'lineStyle'].includes(o.op))).toBe(false);
  });

  it('allocates nothing per frame: indexed loops over module-built arrays, no Phaser value imports', () => {
    const draw = between(artSource, 'function paint(', '\n}\n');
    expect(draw).not.toMatch(/for \(const \[|\.map\(|\.forEach\(|\[\.\.\.|new |\{ *\w+ *[,:}]/);
    expect(artSource).not.toMatch(/import (?!type)/);
    const { g } = recorder();
    // The geometry is the module's: drawing does not rebuild or mutate it.
    const before = JSON.stringify(TIMEOUT_GEOMETRY);
    for (let i = 0; i < 50; i++) drawTimeoutArt(g, 100 + i * 0.37, 300 - i * 1.21, pulseOf(i / 60, 3));
    expect(JSON.stringify(TIMEOUT_GEOMETRY)).toBe(before);
  });
});

describe('TIMEOUT A on the screen pixel grid', () => {
  it('snaps only the centre: every final screen edge is a whole pixel at any translation, within .5px of the model', () => {
    for (const tx of [0, 0.37, -0.5, 0.5, 1.62, -3.25, 12.999]) for (const ty of [0, 0.2]) for (const [cx, cy] of [[225, 350], [200.5, 99.5], [61.3, 781.77], [389.49, -40.01]]) {
      const { g, ops } = recorder(tx, ty);
      drawTimeoutArt(g, cx, cy, 0.1);
      const rs = rects(ops);
      for (const r of rs) { expect(Number.isInteger(Math.round((r.x + tx) * 1e9) / 1e9)).toBe(true); expect(Number.isInteger(Math.round((r.y + ty) * 1e9) / 1e9)).toBe(true); }
      // The first field rect is at centre - (18, 92): the centre moved by at most half a pixel.
      expect(Math.abs(rs[0].x + 18 - cx)).toBeLessThanOrEqual(0.5 + 1e-9);
      expect(Math.abs(rs[0].y + 92 - cy)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it('keeps the shape at any translation: only the whole disc moves, by whole pixels', () => {
    const shape = (tx: number, cx: number) => {
      const { g, ops } = recorder(tx);
      drawTimeoutArt(g, cx, 350, 0.1);
      const rs = rects(ops), x0 = rs[0].x, y0 = rs[0].y;
      return rs.map(r => [Math.round((r.x - x0) * 1e9) / 1e9, r.y - y0, r.w, r.h]);
    };
    const ref = shape(0, 225);
    for (const [tx, cx] of [[0.3, 225], [-2.7, 225.6], [5.5, 10.25]]) expect(shape(tx, cx)).toEqual(ref);
  });

  it('stays inside the old ring\'s envelope: within r97 of the unrounded centre', () => {
    for (const [tx, cx, cy] of [[0, 225, 350], [0.5, 225.5, 350.5], [-0.49, 100.49, 200.5]]) {
      const { g, ops } = recorder(tx);
      drawTimeoutArt(g, cx, cy, 0.1);
      for (const r of rects(ops)) for (const [vx, vy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]])
        expect(Math.hypot(vx - cx, vy - cy)).toBeLessThanOrEqual(96 + Math.SQRT1_2 + 1e-9);
    }
  });

  it('reads the translation only: the Graphics is not moved', () => {
    const { g } = recorder(3.3, 0);
    drawTimeoutArt(g, 225, 350, 0.1);
    expect([g.x, g.y]).toEqual([3.3, 0]);
  });
});

describe('TIMEOUT A in the scene: same bubbles, same cull, same pulse, same layer', () => {
  it('replaces only the fill and stroke lines: loop, cull, screen y and pulse are e9b0e2a\'s', () => {
    expect(bubbleBlock()).toBe(`    this.graphics = this.underAbyss;
    for (const bubble of m.timeoutBubbles) {
      const by = bubble.y - cam;
      if (by < -bubble.radius || by > 820 + bubble.radius) continue;
      const pulse = 0.1 + Math.abs(Math.sin(this.model.elapsed * 1.4 + bubble.id)) * 0.06;
      // TIMEOUT AREA PIXEL ART V1 (render/timeoutArt): the same cyan disc and rim as 2px steps, rim at .5 + .5 * pulse.
      drawTimeoutArt(this.graphics, bubble.x, by, pulse);
    }
`);
  });

  it('draws nothing with no bubble, and 175 commands per visible bubble, oldest first (1 / 3 / 6 / 12)', () => {
    const s = sceneBubbles();
    expect(s.frame([])).toEqual([]);
    for (const n of [1, 3, 6, 12]) {
      const list = Array.from({ length: n }, (_, k) => bubble(k + 1, 120 + (k % 4) * 60, 200 + Math.floor(k / 4) * 80));
      const ops = s.frame(list, 0, 1.75);
      expect(ops).toHaveLength(175 * n);
      expect(styles(ops).map(o => o.alpha)).toEqual(list.flatMap(b => [pulseOf(1.75, b.id), 0.5 + 0.5 * pulseOf(1.75, b.id)]));
      list.forEach((b, k) => expect(rects(ops)[k * 173]).toMatchObject({ x: b.x - 18, y: b.y - 92 }));
    }
  });

  it('culls exactly the bubbles e9b0e2a culled, by their centre against [-r, 820 + r]', () => {
    const s = sceneBubbles();
    for (const cam of [0, 1234.5]) for (const y of [-97, -96, -95, 0, 400, 915, 916, 917]) {
      const list = [bubble(4, 225, y + cam)];
      const drawn = s.frame(list, cam).length > 0, before = s.baseline(list, cam).length > 0;
      expect(drawn, `y ${y}`).toBe(before);
    }
  });

  it('pulses as before: |sin(elapsed * 1.4 + id)|, period pi / 1.4 (~2.244 s); field .10-.16, rim .55-.58', () => {
    const s = sceneBubbles();
    const period = Math.PI / 1.4;
    expect(period).toBeCloseTo(2.244, 3);
    for (const t of [0, 0.4, 1.1, 2.0, 7.77]) {
      const a = styles(s.frame([bubble(2, 225, 300)], 0, t)), b = styles(s.frame([bubble(2, 225, 300)], 0, t + period));
      expect(a[0].alpha).toBeCloseTo(b[0].alpha, 12);
      // The baseline fill alpha, unchanged.
      const base = s.baseline([bubble(2, 225, 300)], 0, t).find(o => o.op === 'style') as Extract<Op, { op: 'style' }>;
      expect(a[0].alpha).toBe(base.alpha);
      expect(a[0].alpha).toBeGreaterThanOrEqual(0.1); expect(a[0].alpha).toBeLessThanOrEqual(0.16 + 1e-12);
      expect(a[1].alpha).toBeGreaterThanOrEqual(0.55); expect(a[1].alpha).toBeLessThanOrEqual(0.58 + 1e-12);
    }
  });

  it('keeps the old overlap: each bubble painted on its own, so two overlapping fields stack as before', () => {
    const s = sceneBubbles(0.25);
    const ops = s.frame([bubble(1, 200, 300), bubble(2, 240, 320)], 0, 0.5);
    const first = rects(ops.slice(0, 175)), second = rects(ops.slice(175));
    expect(first).toHaveLength(173); expect(second).toHaveLength(173);
    // The second disc is the first moved by the bubbles' offset: no merging, clipping or dimming.
    expect(second.map(r => [r.x - 40, r.y - 20, r.w, r.h])).toEqual(first.map(r => [r.x, r.y, r.w, r.h]));
  });

  it('keeps draw()\'s order: coins, underAbyss, BUBBLES, bodies, deep, speech, boss -- and no new layer or texture', () => {
    const i = (s: string) => { const k = sceneSource.indexOf(s); expect(k, s).toBeGreaterThan(-1); return k; };
    const order = ['// Loose coins.', 'this.graphics = this.underAbyss;', 'for (const bubble of m.timeoutBubbles) {', 'drawTimeoutArt(this.graphics, bubble.x, by, pulse);', '// Bodies.', 'this.bossSpeech();', 'this.graphics = g;\n    this.boss(cam);'];
    for (let k = 1; k < order.length; k++) expect(i(order[k - 1]), order[k]).toBeLessThan(i(order[k]));
    expect(sceneSource.split('this.add.graphics()').length - 1).toBe(13);
    expect(sceneSource.split('this.add.').length - 1).toBe(withoutTimeoutArt('scenes/GameScene.ts', sceneSource).split('this.add.').length - 1);
    expect(sceneSource.split('this.textures.').length - 1).toBe(withoutTimeoutArt('scenes/GameScene.ts', sceneSource).split('this.textures.').length - 1);
    expect(sceneSource.split('drawTimeoutArt(').length - 1).toBe(1);
  });

  it('draws without touching the model: bubbles, ids and radii are left as found', () => {
    const s = sceneBubbles(0.7);
    const list = [bubble(1, 225, 400), bubble(2, 100.25, 512.5), bubble(3, 380, 900)];
    const before = JSON.stringify(list);
    for (let f = 0; f < 120; f++) s.frame(list, f * 3.3, f / 60);
    expect(JSON.stringify(list)).toBe(before);
  });
});

describe('TIMEOUT A changes nothing else', () => {
  it('is e9b0e2a GameScene.ts byte for byte once its two hunks are put back', () => {
    expect(Object.keys(TIMEOUT_ART_HUNKS)).toEqual(['scenes/GameScene.ts']);
    expect(sha256(sceneSource)).not.toBe('8929a36b85d0519e9f7be48ff58f0d6e542408fcd63c4ac891414e4db46ddc31');
    expect(sha256(withoutTimeoutArt('scenes/GameScene.ts', sceneSource))).toBe('8929a36b85d0519e9f7be48ff58f0d6e542408fcd63c4ac891414e4db46ddc31');
    expect(withoutTimeoutArt('scenes/GameScene.ts', sceneSource).split(BASELINE_BLOCK).length - 1).toBe(1);
  });

  it('leaves every other source byte-identical to e9b0e2a: model, upgrades, systems, other art, UI, audio', () => {
    const SOURCES = import.meta.glob(['../src/**/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(SOURCES).filter(isTimeoutArtFile)).toEqual(['../src/render/timeoutArt.ts']);
    const keys = Object.keys(SOURCES).filter(k => k !== '../src/scenes/GameScene.ts' && !isTimeoutArtFile(k) && !isAirBubbleArtFile(k)).sort();
    expect(keys).toHaveLength(91);
    // The same digest over the same 91 files, computed on a git archive of e9b0e2a.
    expect(sha256(keys.map(k => `${k}\n${sha256(SOURCES[k])}`).join('\n'))).toBe('73de93aaffc772b5bff359aa9cf6456cedb3803fb3e129d316b644db8d71d539');
  });

  it('adds no PNG and no texture: the shipped image set is e9b0e2a\'s', () => {
    expect(Object.keys(import.meta.glob(['../src/**/*.png', '../public/**/*.png']))).toHaveLength(165);
  });

  it('keeps TIMEOUT itself: radius 96, one bubble per surviving hit, the closed-circle hit test, cleared at a SECTION', () => {
    expect(UPGRADE_TUNING.timeout.radius).toBe(96);
    const g = new GameModel(false, () => 0.5);
    g.upgrades.grant('timeout');
    g.jumpToStage(1, 1);
    g.platforms = []; g.enemies = []; g.hazards = []; g.safeZones = []; g.caves = [];
    g.player.x = 225; g.player.y = 400;
    expect(g.damage(1)).toBe(true);
    expect(g.timeoutBubbles).toEqual([{ id: expect.any(Number), x: 225, y: 400, radius: 96 }]);
    expect(g.timeFrozen).toBe(true);
    g.player.x = 225 + 96; expect(g.timeFrozen).toBe(true);
    g.player.x = 225 + 96.01; expect(g.timeFrozen).toBe(false);
    g.jumpToStage(1, 2);
    expect(g.timeoutBubbles).toEqual([]);
  });

  it('plays exactly as e9b0e2a: natural REST pick -> 1-2 caveBat hit (seed 813), and every fixture run', () => {
    // Golden values produced by tests/timeoutTrace.ts on a git archive of e9b0e2a.
    expect(naturalTimeoutRun()).toEqual({ digest: '7a76c082e810cd57', bubbles: 1, maxLive: 1, frozenSteps: 25, entries: 1, exits: 1, hits: 3, sections: 2, ticks: 6469, final: 'playing@1-2', reached: true, bubbleTick: 2869 });
    const GOLDEN: Record<string, [string, number, number, number, number, number, number, string]> = {
      // digest, bubbles, maxLive, frozenSteps, entries, exits, hits, final
      'area1 no timeout': ['7136e6db327c758d', 0, 0, 0, 0, 0, 5, 'playing@1-1'],
      'area1 timeout': ['bdecfd38d29e1ad3', 2, 2, 1246, 4, 2, 3, 'playing@1-1'],
      'area1 timeout x2': ['25b102a8386a4490', 2, 2, 114, 2, 2, 0, 'playing@1-2'],
      'area1 timeout x6': ['354dbe8ac5e0a7f3', 6, 6, 135, 4, 4, 0, 'playing@1-2'],
      'area1 timeout x12': ['dd168072aed415fc', 13, 13, 324, 8, 8, 2, 'playing@1-3'],
      'area1 sections x3': ['a1ad261b30673c15', 6, 5, 1044, 8, 7, 6, 'playing@1-3'],
      'area2 timeout': ['26b03ba1c913c14d', 4, 4, 933, 5, 4, 3, 'playing@2-1'],
      'area3 timeout': ['1cdd56844673f5bc', 4, 4, 159, 3, 3, 1, 'playing@3-1'],
      'area4 timeout': ['5e5c09b1f97ec4f7', 14, 14, 358, 15, 15, 12, 'playing@4-1'],
      'area4 stacked': ['50bfeef32dc2847d', 8, 8, 433, 12, 12, 10, 'playing@4-2'],
      'boss timeout': ['74af82bec686c8fd', 12, 12, 1673, 17, 17, 16, 'boss@FINAL BOSS'],
      'boss timeout x12': ['514ccc80480c2fab', 24, 24, 2090, 23, 22, 20, 'boss@FINAL BOSS'],
    };
    expect(Object.keys(TIMEOUT_TRACE_SCENARIOS)).toEqual(Object.keys(GOLDEN));
    for (const [name, run] of Object.entries(TIMEOUT_TRACE_SCENARIOS)) {
      const got = timeoutTrace(run);
      const [digest, bubbles, maxLive, frozenSteps, entries, exits, hits, final] = GOLDEN[name];
      expect({ digest: got.digest, bubbles: got.bubbles, maxLive: got.maxLive, frozenSteps: got.frozenSteps, entries: got.entries, exits: got.exits, hits: got.hits, final: got.final }, name)
        .toEqual({ digest, bubbles, maxLive, frozenSteps, entries, exits, hits, final });
    }
  }, 120000);
});
