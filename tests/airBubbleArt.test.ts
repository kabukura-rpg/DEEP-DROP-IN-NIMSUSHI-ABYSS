import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';
import { AIR_BUBBLE_ART, AIR_BUBBLE_GEOMETRY, drawAirBubbleArt } from '../src/render/airBubbleArt';
import { AIR_CONTAINER_RULES } from '../src/data/structures';
import { AIR_BUBBLE_ART_HUNKS, isAirBubbleArtFile, withoutAirBubbleArt } from './airBubbleArtRestore';
import { AIR_BUBBLE_TRACE_SCENARIOS, airBubbleTrace } from './airBubbleTrace';
import sceneSource from '../src/scenes/GameScene.ts?raw';
import artSource from '../src/render/airBubbleArt.ts?raw';

/**
 * AIR BUBBLES VISUAL DESIGN V1 -- runtime integration of candidate A, "Refined Original" (output/air-bubbles-visual-
 * design-v1, approved at Human Review). The released container bubble, a 2px strokeCircle r9 + a 3x3 white glint at
 * 5969f37, becomes 12 ring and 2 glint rectangles on 2px steps, on the same Graphics (`worldFrontAir`), in the same
 * loop, behind the same cull, at the same fade, oldest bubble first as before. Drawing only: how many bubbles a
 * container releases, how they climb, when they can be caught, what they restore and when they go are exactly
 * 5969f37's, and so is every other line of the scene.
 */

const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: Uint8Array | string) => { digest: (e: string) => string } } };
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const between = (text: string, from: string, to: string) => {
  const a = text.indexOf(from), b = text.indexOf(to, a);
  expect(a, from).toBeGreaterThanOrEqual(0); expect(b, to).toBeGreaterThan(a);
  return text.slice(a, b);
};
const bubbleBlock = () => between(sceneSource, '    this.graphics = this.worldFrontAir;\n', '    // Loose coins.');
/** 5969f37's bubble loop, byte for byte. */
const BASELINE_BLOCK = `    this.graphics = this.worldFrontAir;
    for (const bubble of m.bubbles) {
      const by = bubble.y - cam;
      if (by < -40 || by > 850) continue;
      const fade = bubble.life < 1 ? 0.35 + Math.abs(Math.sin(this.model.elapsed * 18)) * 0.5 : 0.92;
      this.graphics.lineStyle(2, 0x9fe8f5, fade).strokeCircle(bubble.x, by, 9);
      this.rect(bubble.x - 4, by - 5, 3, 3, 0xffffff, fade * 0.8);
    }
`;
/**
 * What candidate A (output/air-bubbles-visual-design-v1/harness/air-art.js, sha256 2d78111b...6ee3a) draws for one
 * bubble at (0, 0), fade 1, on an untranslated Graphics: ['s', colour, alpha] then [x, y, w, h] per rect.
 */
const SPEC_OPS: (['s', number, number] | [number, number, number, number])[] = [
  ['s', 0x9fe8f5, 1], [-4, -10, 8, 2], [-6, -8, 2, 2], [4, -8, 2, 2], [-8, -6, 2, 2], [6, -6, 2, 2], [-10, -4, 2, 8], [8, -4, 2, 8],
  [-8, 4, 2, 2], [6, 4, 2, 2], [-6, 6, 2, 2], [4, 6, 2, 2], [-4, 8, 8, 2],
  ['s', 0xf0ffff, 0.9], [-4, -6, 2, 2], [-6, -4, 2, 2],
];
/** sha256 of JSON.stringify(SPEC_OPS) as the candidate's own module printed it. */
const SPEC_OPS_SHA = 'dad3fb0d6611d8c68ca271a3357633dac063fe82e787b6088e48ce82772697e4';
/** The approved pattern, one character per 2x2 cell. */
const PATTERN = [
  '...rrrr...',
  '..r....r..',
  '.r.h....r.',
  'r.h......r',
  'r........r',
  'r........r',
  'r........r',
  '.r......r.',
  '..r....r..',
  '...rrrr...',
];

type Op = { op: 'style'; color: number; alpha: number } | { op: 'rect'; x: number; y: number; w: number; h: number } | { op: string; args: number[] };
/** A recording Graphics; `tx`/`ty` are its own translation (the scene's shake / cameraX offset, as g.x / g.y). */
function recorder(tx = 0, ty = 0) {
  const ops: Op[] = [];
  const g = {
    x: tx, y: ty,
    fillStyle(color: number, alpha = 1) { ops.push({ op: 'style', color, alpha }); return g; },
    fillRect(x: number, y: number, w: number, h: number) { ops.push({ op: 'rect', x, y, w, h }); return g; },
    lineStyle(...args: number[]) { ops.push({ op: 'lineStyle', args }); return g; },
    strokeCircle(...args: number[]) { ops.push({ op: 'strokeCircle', args }); return g; },
  };
  return { g: g as unknown as Phaser.GameObjects.Graphics, ops };
}
const rects = (ops: Op[]) => ops.filter((o): o is Extract<Op, { op: 'rect' }> => o.op === 'rect');
const styles = (ops: Op[]) => ops.filter((o): o is Extract<Op, { op: 'style' }> => o.op === 'style');
const asSpec = (ops: Op[]) => ops.map(o => o.op === 'style' ? ['s', (o as { color: number }).color, (o as { alpha: number }).alpha] : o.op === 'rect' ? [(o as { x: number }).x, (o as { y: number }).y, (o as { w: number }).w, (o as { h: number }).h] : [o.op]);
/** Paint the rects onto a pixel map ("x,y" -> how many rects cover it). */
const coverage = (list: readonly (readonly number[])[]) => {
  const px = new Map<string, number>();
  for (const [x0, y0, w, h] of list) for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px.set(`${x},${y}`, (px.get(`${x},${y}`) ?? 0) + 1);
  return px;
};
const cellsOf = (symbol: string) => {
  const out = new Set<string>();
  PATTERN.forEach((row, cy) => [...row].forEach((c, cx) => {
    if (c === symbol) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) out.add(`${cx * 2 - 10 + dx},${cy * 2 - 10 + dy}`);
  }));
  return out;
};
const fadeOf = (life: number, elapsed: number) => life < 1 ? 0.35 + Math.abs(Math.sin(elapsed * 18)) * 0.5 : 0.92;

/** The scene's own bubble loop, run against a stand-in scene: the block out of draw() exactly as GameScene.ts has it. */
function sceneBubbles(tx = 0) {
  const candidate = new Function('m', 'cam', 'drawAirBubbleArt', bubbleBlock());
  const baseline = new Function('m', 'cam', BASELINE_BLOCK);
  const run = (block: (this: unknown, ...a: unknown[]) => void, bubbles: unknown[], cam: number, elapsed: number, ...extra: unknown[]) => {
    const r = recorder(tx);
    const scene = {
      worldFrontAir: r.g, graphics: null as unknown, model: { elapsed },
      // GameScene.rect, for the baseline's glint.
      rect(this: { graphics: Phaser.GameObjects.Graphics }, x: number, y: number, w: number, h: number, color: number, alpha = 1) { this.graphics.fillStyle(color, alpha).fillRect(Math.round(x), Math.round(y), w, h); },
    };
    block.call(scene, { bubbles }, cam, ...extra);
    expect(scene.graphics).toBe(r.g);
    return r.ops;
  };
  return {
    frame: (bubbles: unknown[], cam = 0, elapsed = 0) => run(candidate as never, bubbles, cam, elapsed, drawAirBubbleArt),
    baseline: (bubbles: unknown[], cam = 0, elapsed = 0) => run(baseline as never, bubbles, cam, elapsed),
  };
}
const bubble = (id: number, x: number, y: number, life = 3) => ({ id, x, y, vx: 0, vy: -40, life, taken: false, arm: 0 });

describe('AIR A: the stepped ring', () => {
  it('is candidate A exactly: the approved module\'s draw calls, byte for byte', () => {
    expect(sha256(JSON.stringify(SPEC_OPS))).toBe(SPEC_OPS_SHA);
    const { g, ops } = recorder();
    drawAirBubbleArt(g, 0, 0, 1);
    expect(asSpec(ops)).toEqual(SPEC_OPS);
  });

  it('is the approved pattern: 12 ring and 2 glint rects covering exactly its r and h cells, each pixel once', () => {
    expect(AIR_BUBBLE_GEOMETRY.ring).toHaveLength(12);
    expect(AIR_BUBBLE_GEOMETRY.glint).toHaveLength(2);
    const ring = coverage(AIR_BUBBLE_GEOMETRY.ring), glint = coverage(AIR_BUBBLE_GEOMETRY.glint);
    expect(new Set(ring.keys())).toEqual(cellsOf('r'));
    expect(new Set(glint.keys())).toEqual(cellsOf('h'));
    expect([...ring.values(), ...glint.values()].every(n => n === 1)).toBe(true);
    for (const k of glint.keys()) expect(ring.has(k)).toBe(false);
    // 20x20 overall, the centre 8x8 left clear.
    const all = [...ring.keys(), ...glint.keys()].map(k => k.split(',').map(Number));
    expect([Math.min(...all.map(p => p[0])), Math.max(...all.map(p => p[0])) + 1, Math.min(...all.map(p => p[1])), Math.max(...all.map(p => p[1])) + 1]).toEqual([-10, 10, -10, 10]);
    for (let y = -4; y < 4; y++) for (let x = -4; x < 4; x++) expect(ring.has(`${x},${y}`) || glint.has(`${x},${y}`)).toBe(false);
  });

  it('keeps the old colour and size: #9fe8f5 ring, 20px across like the old r9 + 2px stroke; glint #f0ffff at .9', () => {
    expect(AIR_BUBBLE_ART).toEqual({ ring: 0x9fe8f5, glint: 0xf0ffff, glintShare: 0.9 });
    for (const r of [...AIR_BUBBLE_GEOMETRY.ring, ...AIR_BUBBLE_GEOMETRY.glint]) for (const v of r) { expect(Number.isInteger(v)).toBe(true); expect(Math.abs(v % 2)).toBe(0); }
  });

  it('draws 2 styles and 14 rects per bubble, ring at fade then glint at .9 * fade; no stroke or circle', () => {
    for (const fade of [0.92, 0.35, 0.6123]) {
      const { g, ops } = recorder();
      drawAirBubbleArt(g, 225, 350, fade);
      expect(ops).toHaveLength(16);
      expect(styles(ops)).toEqual([{ op: 'style', color: 0x9fe8f5, alpha: fade }, { op: 'style', color: 0xf0ffff, alpha: 0.9 * fade }]);
      expect(ops[13]).toMatchObject({ op: 'style' });
      expect(ops.some(o => ['strokeCircle', 'lineStyle'].includes(o.op))).toBe(false);
    }
  });

  it('allocates nothing per frame: indexed loops over module arrays, no Phaser value imports', () => {
    const draw = between(artSource, 'function paint(', '\n}\n');
    expect(draw).not.toMatch(/for \(const \[|\.map\(|\.forEach\(|\[\.\.\.|new |\{ *\w+ *[,:}]/);
    expect(artSource).not.toMatch(/import (?!type)/);
    const before = JSON.stringify(AIR_BUBBLE_GEOMETRY);
    const { g } = recorder();
    for (let i = 0; i < 50; i++) drawAirBubbleArt(g, 100 + i * 0.37, 300 - i * 1.21, fadeOf(i / 50, i / 60));
    expect(JSON.stringify(AIR_BUBBLE_GEOMETRY)).toBe(before);
  });
});

describe('AIR A on the screen pixel grid', () => {
  it('snaps only the centre: every final screen edge is a whole pixel at any translation, within .5px of the model', () => {
    for (const tx of [0, 0.37, -0.5, 0.5, 1.62, -3.25, 12.999]) for (const ty of [0, 0.2]) for (const [cx, cy] of [[225, 350], [200.5, 99.5], [61.3, 781.77], [389.49, -39.01]]) {
      const { g, ops } = recorder(tx, ty);
      drawAirBubbleArt(g, cx, cy, 0.92);
      const rs = rects(ops);
      for (const r of rs) { expect(Number.isInteger(Math.round((r.x + tx) * 1e9) / 1e9)).toBe(true); expect(Number.isInteger(Math.round((r.y + ty) * 1e9) / 1e9)).toBe(true); }
      // The first ring rect is at centre - (4, 10): the centre moved by at most half a pixel.
      expect(Math.abs(rs[0].x + 4 - cx)).toBeLessThanOrEqual(0.5 + 1e-9);
      expect(Math.abs(rs[0].y + 10 - cy)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it('keeps the shape at any translation: only the whole bubble moves, by whole pixels', () => {
    const shape = (tx: number, cx: number) => {
      const { g, ops } = recorder(tx);
      drawAirBubbleArt(g, cx, 350, 0.92);
      const rs = rects(ops), x0 = rs[0].x, y0 = rs[0].y;
      return rs.map(r => [Math.round((r.x - x0) * 1e9) / 1e9, r.y - y0, r.w, r.h]);
    };
    const ref = shape(0, 225);
    for (const [tx, cx] of [[0.3, 225], [-2.7, 225.6], [5.5, 10.25]]) expect(shape(tx, cx)).toEqual(ref);
  });

  it('stays inside the old ring\'s envelope: within r10 + half a pixel of the unrounded centre', () => {
    for (const [tx, cx, cy] of [[0, 225, 350], [0.5, 225.5, 350.5], [-0.49, 100.49, 200.5]]) {
      const { g, ops } = recorder(tx);
      drawAirBubbleArt(g, cx, cy, 0.92);
      for (const r of rects(ops)) for (const [vx, vy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]])
        expect(Math.hypot(vx - cx, vy - cy)).toBeLessThanOrEqual(Math.hypot(10, 4) + Math.SQRT1_2 + 1e-9);
    }
  });

  it('reads the translation only: the Graphics is not moved', () => {
    const { g } = recorder(3.3, 0);
    drawAirBubbleArt(g, 225, 350, 0.92);
    expect([g.x, g.y]).toEqual([3.3, 0]);
  });
});

describe('AIR A in the scene: same bubbles, same cull, same fade, same layer', () => {
  it('replaces only the stroke and glint lines: loop, cull, screen y and fade are 5969f37\'s', () => {
    expect(bubbleBlock()).toBe(`    this.graphics = this.worldFrontAir;
    for (const bubble of m.bubbles) {
      const by = bubble.y - cam;
      if (by < -40 || by > 850) continue;
      const fade = bubble.life < 1 ? 0.35 + Math.abs(Math.sin(this.model.elapsed * 18)) * 0.5 : 0.92;
      // AIR BUBBLES VISUAL DESIGN V1 (render/airBubbleArt): the same cyan ring and glint as 2px steps, at the same fade.
      drawAirBubbleArt(this.graphics, bubble.x, by, fade);
    }
`);
  });

  it('draws nothing with no bubble, and 16 commands per visible bubble, oldest first (1 / 3 / 4 / 5 / 12)', () => {
    const s = sceneBubbles();
    expect(s.frame([])).toEqual([]);
    for (const n of [1, 3, 4, 5, 12]) {
      const list = Array.from({ length: n }, (_, k) => bubble(k + 1, 120 + (k % 4) * 60, 200 + Math.floor(k / 4) * 80));
      const ops = s.frame(list, 0, 1.75);
      expect(ops).toHaveLength(16 * n);
      list.forEach((b, k) => expect(rects(ops)[k * 14]).toMatchObject({ x: b.x - 4, y: b.y - 10 }));
    }
  });

  it('culls exactly the bubbles 5969f37 culled, by their centre against [-40, 850]', () => {
    const s = sceneBubbles();
    for (const cam of [0, 1234.5]) for (const y of [-41, -40, -39.5, 0, 400, 849.5, 850, 851]) {
      const list = [bubble(4, 225, y + cam)];
      expect(s.frame(list, cam).length > 0, `y ${y}`).toBe(s.baseline(list, cam).length > 0);
    }
  });

  it('fades as before: .92 while alive, .35 + |sin(elapsed * 18)| * .5 in its last second, for ring and old stroke alike', () => {
    const s = sceneBubbles();
    for (const life of [4.2, 1, 0.999, 0.3]) for (const t of [0, 0.05, 0.4, 2.0, 7.77]) {
      const a = styles(s.frame([bubble(2, 225, 300, life)], 0, t));
      const base = s.baseline([bubble(2, 225, 300, life)], 0, t);
      const stroke = base.find(o => o.op === 'lineStyle') as { args: number[] };
      expect(a[0].alpha).toBe(stroke.args[2]);
      expect(a[0].alpha).toBe(fadeOf(life, t));
      expect(a[1].alpha).toBe(0.9 * fadeOf(life, t));
    }
  });

  it('keeps the old overlap: each bubble painted on its own, so a burst at one centre stacks as before', () => {
    const s = sceneBubbles(0.25);
    const burst = [bubble(1, 225, 300), bubble(2, 225, 300), bubble(3, 225, 300), bubble(4, 225, 300)];
    const ops = s.frame(burst, 0, 0.5);
    expect(ops).toHaveLength(64);
    for (let k = 1; k < 4; k++) expect(ops.slice(k * 16, k * 16 + 16)).toEqual(ops.slice(0, 16));
  });

  it('keeps draw()\'s order: containers, worldFrontAir, BUBBLES, coins, TIMEOUT -- and no new layer or texture', () => {
    const i = (s: string) => { const k = sceneSource.indexOf(s); expect(k, s).toBeGreaterThan(-1); return k; };
    const order = ['// AREA 2 air containers.', 'this.graphics = this.worldFrontAir;', 'for (const bubble of m.bubbles) {', 'drawAirBubbleArt(this.graphics, bubble.x, by, fade);', '// Loose coins.', 'this.graphics = this.underAbyss;', 'drawTimeoutArt(this.graphics, bubble.x, by, pulse);'];
    for (let k = 1; k < order.length; k++) expect(i(order[k - 1]), order[k]).toBeLessThan(i(order[k]));
    expect(sceneSource.split('this.add.graphics()').length - 1).toBe(13);
    expect(sceneSource.split('this.add.').length - 1).toBe(withoutAirBubbleArt('scenes/GameScene.ts', sceneSource).split('this.add.').length - 1);
    expect(sceneSource.split('this.textures.').length - 1).toBe(withoutAirBubbleArt('scenes/GameScene.ts', sceneSource).split('this.textures.').length - 1);
    expect(sceneSource.split('drawAirBubbleArt(').length - 1).toBe(1);
  });

  it('draws without touching the model: bubbles are left as found', () => {
    const s = sceneBubbles(0.7);
    const list = [bubble(1, 225, 400), bubble(2, 100.25, 512.5, 0.5), bubble(3, 380, 900)];
    const before = JSON.stringify(list);
    for (let f = 0; f < 120; f++) s.frame(list, f * 3.3, f / 60);
    expect(JSON.stringify(list)).toBe(before);
  });
});

describe('AIR A changes nothing else', () => {
  it('is 5969f37 GameScene.ts byte for byte once its two hunks are put back', () => {
    expect(Object.keys(AIR_BUBBLE_ART_HUNKS)).toEqual(['scenes/GameScene.ts']);
    expect(sha256(sceneSource)).not.toBe('572a407ce813d46d0c16b4ccf44fe1e71c692fd19843ee6a3ed3431478661cdc');
    expect(sha256(withoutAirBubbleArt('scenes/GameScene.ts', sceneSource))).toBe('572a407ce813d46d0c16b4ccf44fe1e71c692fd19843ee6a3ed3431478661cdc');
    expect(withoutAirBubbleArt('scenes/GameScene.ts', sceneSource).split(BASELINE_BLOCK).length - 1).toBe(1);
  });

  it('leaves every other source byte-identical to 5969f37: model, oxygen, containers, TIMEOUT art, UI, audio', () => {
    const SOURCES = import.meta.glob(['../src/**/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(SOURCES).filter(isAirBubbleArtFile)).toEqual(['../src/render/airBubbleArt.ts']);
    const keys = Object.keys(SOURCES).filter(k => k !== '../src/scenes/GameScene.ts' && !isAirBubbleArtFile(k)).sort();
    expect(keys).toHaveLength(92);
    // The same digest over the same 92 files, computed with `git show 5969f37:<path>`.
    expect(sha256(keys.map(k => `${k}\n${sha256(SOURCES[k])}`).join('\n'))).toBe('ffc7e30251cd128a962f9f972c752e48101ed4576bae517be829f2b73a7c671c');
  });

  it('adds no PNG and no texture: the shipped image set is 5969f37\'s', () => {
    expect(Object.keys(import.meta.glob(['../src/**/*.png', '../public/**/*.png']))).toHaveLength(165);
  });

  it('keeps the AIR rules: 3-5 per container, 4.2 s, 5 s of air, armed after .08 s, rising to 96 px/s', () => {
    expect(AIR_CONTAINER_RULES).toMatchObject({ size: 34, bubblesMin: 3, bubblesMax: 5, recovery: 5, riseSpeed: 96, riseSpread: 54, riseAccel: 260, bubbleLife: 4.2, collectArm: 0.08, debrisTime: 0.35 });
  });

  it('plays exactly as 5969f37: release, climb, catch, expiry and SECTIONs in every fixture run', () => {
    // Golden values produced by tests/airBubbleTrace.ts on a git archive of 5969f37.
    const GOLDEN: Record<string, [string, number, number, number, number, number, number, string]> = {
      // digest, bubbles, maxLive, breaks, oxygenEvents, restored, sections, final
      'area3 1': ['f1d8aa4994f3cee0', 33, 10, 19, 50, 64.35, 6, 'playing@3-1'],
      'area3 2': ['fcbf399b385e71c4', 18, 5, 12, 19, 48.557, 6, 'playing@3-2'],
      'area3 3': ['d8cc9277f9902a3f', 13, 5, 8, 7, 28.084, 6, 'playing@3-3'],
      'area3 full tank': ['925012cf589c65dc', 41, 10, 23, 55, 46.708, 6, 'playing@3-1'],
      'area3 sections x3': ['2e1b7068a3a6d4fc', 47, 10, 29, 65, 90.582, 12, 'playing@3-3'],
      'area3 timeout': ['4315797b3e1cea68', 33, 10, 19, 50, 64.35, 6, 'playing@3-1'],
      'area1 no air': ['6a7afaef4cb55078', 0, 0, 0, 0, 0, 6, 'playing@1-1'],
    };
    expect(Object.keys(AIR_BUBBLE_TRACE_SCENARIOS)).toEqual(Object.keys(GOLDEN));
    for (const [name, run] of Object.entries(AIR_BUBBLE_TRACE_SCENARIOS)) {
      const got = airBubbleTrace(run);
      const [digest, bubbles, maxLive, breaks, oxygenEvents, restored, sections, final] = GOLDEN[name];
      expect({ digest: got.digest, bubbles: got.bubbles, maxLive: got.maxLive, breaks: got.breaks, oxygenEvents: got.oxygenEvents, restored: got.restored, sections: got.sections, final: got.final }, name)
        .toEqual({ digest, bubbles, maxLive, breaks, oxygenEvents, restored, sections, final });
    }
  }, 120000);
});
