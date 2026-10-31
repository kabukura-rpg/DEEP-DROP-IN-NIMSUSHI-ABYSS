import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';
import { JETPACK_ART, drawJetpackExhaust, jetpackFrame } from '../src/render/jetpackArt';
import { UPGRADES, UPGRADE_TUNING } from '../src/data/upgrades';
import { GameModel } from '../src/systems/GameModel';
import { JETPACK_TRACE_SCENARIOS, jetpackTrace } from './jetpackTrace';
import { JETPACK_BASELINE_BLOCK, JETPACK_BLOCK, JETPACK_IMPORT_LINE, isJetpackArtFile, withoutJetpackArt } from './jetpackArtRestore';
import sceneSource from '../src/scenes/GameScene.ts?raw';
import jetpackSource from '../src/render/jetpackArt.ts?raw';

/**
 * JETPACK PIXEL VFX V1 RUNTIME INTEGRATION. Candidate A of output/jetpack-visual-design-v1 (claude-integration-spec.md,
 * assets/candidate-A-reference.ts): dc51d0b's three flat translucent strips under the player become, per strip, a dark
 * side, a warm flame, a bright core and a 2px tip, the length stepping through three 80ms frames -- on the same
 * Graphics, in the same place in the draw order, behind the same `m.jetpackActive` gate, with the same flicker alpha.
 * Every pixel stays inside the old strips. Drawing only: when the jetpack holds the player, for how long, how hard,
 * and when its flag clears are exactly dc51d0b's, and so is every other line of the scene.
 */

const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: Uint8Array | string) => { digest: (e: string) => string } } };
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const between = (text: string, from: string, to: string) => {
  const a = text.indexOf(from), b = text.indexOf(to, a);
  expect(a, from).toBeGreaterThanOrEqual(0); expect(b, to).toBeGreaterThan(a);
  return text.slice(a, b);
};
const drawMethod = () => between(sceneSource, '  private draw() {', '  private surface(');
const jetpackBlock = () => between(drawMethod(), '    if (m.jetpackActive) {', '    const art = this.playerArt?.render(');

const SIDE = 0x693e38, WARM = 0xe99757, CORE = 0xffe6ae;
/** output/jetpack-visual-design-v1/assets/candidate-A-reference.ts FRAMES, in its order. */
const SPEC = [
  [[0, 0, 4, 4, SIDE], [1, 4, 2, 2, SIDE], [1, 0, 2, 4, WARM], [1, 0, 2, 3, CORE], [5, 1, 4, 7, SIDE], [6, 8, 2, 2, SIDE], [6, 1, 2, 7, WARM], [6, 1, 2, 3, CORE], [10, 2, 4, 10, SIDE], [11, 12, 2, 2, SIDE], [11, 2, 2, 10, WARM], [11, 2, 2, 3, CORE]],
  [[0, 0, 4, 6, SIDE], [1, 6, 2, 2, SIDE], [1, 0, 2, 6, WARM], [1, 0, 2, 3, CORE], [5, 1, 4, 9, SIDE], [6, 10, 2, 2, SIDE], [6, 1, 2, 9, WARM], [6, 1, 2, 3, CORE], [10, 2, 4, 12, SIDE], [11, 14, 2, 2, SIDE], [11, 2, 2, 12, WARM], [11, 2, 2, 3, CORE]],
  [[0, 0, 4, 5, SIDE], [1, 5, 2, 2, SIDE], [1, 0, 2, 5, WARM], [1, 0, 2, 3, CORE], [5, 1, 4, 8, SIDE], [6, 9, 2, 2, SIDE], [6, 1, 2, 8, WARM], [6, 1, 2, 3, CORE], [10, 2, 4, 11, SIDE], [11, 13, 2, 2, SIDE], [11, 2, 2, 11, WARM], [11, 2, 2, 3, CORE]],
];
/** dc51d0b's strips from the rounded player position: (-6,18,4,8) / (-1,19,4,11) / (4,20,4,14). */
const STRIPS = [[-6, 18, 4, 8], [-1, 19, 4, 11], [4, 20, 4, 14]];
/** The reference flicker and frame formulas, verbatim. */
const flare = (elapsed: number) => 0.5 + Math.abs(Math.sin(elapsed * 22)) * 0.5;
const refFrame = (elapsed: number) => Math.floor((elapsed + 1e-8) / 0.08) % 3;

interface Call { op: string; args: number[]; color?: number; alpha?: number }
interface Fill { x: number; y: number; w: number; h: number; color: number; alpha: number }
/** A Graphics stand-in that records every call, fills with their style. */
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
/** Paint the fills in order onto a pixel map: "x,y" -> colour of the topmost fill. */
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
const inStrips = (x: number, y: number, px: number, py: number) => STRIPS.some(([sx, sy, w, h]) => px >= x + sx && px < x + sx + w && py >= y + sy && py < y + sy + h);

/**
 * The scene's own jetpack drawing, run against a stand-in scene: the block out of draw() exactly as GameScene.ts
 * has it, on a recording Graphics. And dc51d0b's block on the same frame, through the scene's own rect().
 */
function sceneJetpack() {
  const candidate = new Function('m', 'x', 'y', 'drawJetpackExhaust', jetpackBlock());
  const baseline = new Function('m', 'x', 'y', JETPACK_BASELINE_BLOCK);
  const run = (block: (this: unknown, ...a: unknown[]) => void, m: GameModel, ...extra: unknown[]) => {
    const r = recorder();
    const self = {
      model: m, graphics: r.g,
      // GameScene.rect, verbatim.
      rect(x: number, y: number, w: number, h: number, color: number, alpha = 1) { self.graphics.fillStyle(color, alpha).fillRect(Math.round(x), Math.round(y), w, h); },
    };
    const p = m.player;
    block.call(self, m, Math.round(p.x), Math.round(p.y - m.cameraY), ...extra);
    return r;
  };
  return {
    frame: (m: GameModel) => run(candidate as never, m, drawJetpackExhaust),
    baseline: (m: GameModel) => run(baseline as never, m),
  };
}

const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
function model(held: boolean, area: 1 | 2 | 3 | 4 | 'boss' = 1) {
  const g = new GameModel(false, seeded(31));
  if (held) g.upgrades.grant('safetyJetpack');
  if (area === 'boss') g.jumpToNimushi(); else g.jumpToStage(area, 1);
  return g;
}
/** Through the model's own branch: in the air, CHARGE spent, trigger held -- fireGun sets the flag. */
function lit(g: GameModel) {
  g.ammo = 0; g.player.grounded = -1;
  (g as unknown as { fireGun: (dt: number, direction: number, firing: boolean) => void }).fireGun(1 / 120, 0, true);
  return g;
}

describe('JETPACK A: the exhaust pixel art', () => {
  it('is the spec table exactly: 3 frames of 12 rectangles, order, offsets, sizes, colours', () => {
    expect(JETPACK_ART.frames.map(f => f.map(r => [...r]))).toEqual(SPEC);
    expect([JETPACK_ART.originX, JETPACK_ART.originY, JETPACK_ART.width, JETPACK_ART.height, JETPACK_ART.frameSeconds]).toEqual([-6, 18, 14, 16, 0.08]);
    for (let f = 0; f < 3; f++) {
      const r = recorder(), t = f * 0.08 + 0.01;
      drawJetpackExhaust(r.g, 100, 200, t);
      expect(r.fills).toEqual(SPEC[f].map(([dx, dy, w, h, color]) => ({ x: 94 + dx, y: 218 + dy, w, h, color, alpha: flare(t) })));
      expect(r.calls.filter(c => c.op !== 'fillStyle' && c.op !== 'fillRect')).toEqual([]);
    }
  });

  it('uses three colours, drawn side, then warm, then core in every strip', () => {
    expect(new Set(SPEC.flat().map(r => r[4]))).toEqual(new Set([SIDE, WARM, CORE]));
    for (const frame of JETPACK_ART.frames) for (let s = 0; s < 3; s++) {
      expect(frame.slice(s * 4, s * 4 + 4).map(r => r[4])).toEqual([SIDE, SIDE, WARM, CORE]);
    }
    // dc51d0b's pale core colour stays the brightest; the two orange strips' 0xffa85c is gone.
    expect(jetpackSource).not.toContain('0xffa85c');
  });

  it('paints each strip as dark sides, a 3px bright core, warm flame and a 2px dark tip, 6/9/12 -> 8/11/14 -> 7/10/13 long', () => {
    const lengths: number[][] = [];
    for (let f = 0; f < 3; f++) {
      const r = recorder();
      drawJetpackExhaust(r.g, 0, 0, f * 0.08 + 0.001);
      const px = raster(r.fills);
      const row: number[] = [];
      for (const [sx, sy, w] of STRIPS) {
        let h = 0;
        while (px.has(`${sx + 1},${sy + h}`)) h++;
        row.push(h);
        for (let y = 0; y < h; y++) {
          const at = (dx: number) => px.get(`${sx + dx},${sy + y}`);
          const tip = y >= h - 2;
          // Outer columns: dark down to the tip, empty beside it.
          expect([at(0), at(w - 1)]).toEqual(tip ? [undefined, undefined] : [SIDE, SIDE]);
          // Inner two columns: core at the nozzle, warm below, dark at the tip.
          const inner = tip ? SIDE : y < 3 ? CORE : WARM;
          expect([at(1), at(2)], `${f} ${sx} ${y}`).toEqual([inner, inner]);
        }
      }
      lengths.push(row);
    }
    expect(lengths).toEqual([[6, 9, 12], [8, 11, 14], [7, 10, 13]]);
  });

  it('never paints outside dc51d0b strips, and frame 1 fills each strip to its old length', () => {
    for (let f = 0; f < 3; f++) {
      const r = recorder();
      drawJetpackExhaust(r.g, 0, 0, f * 0.08 + 0.001);
      const px = raster(r.fills);
      for (const k of px.keys()) {
        const [x, y] = k.split(',').map(Number);
        expect(inStrips(0, 0, x, y), k).toBe(true);
      }
      const box = bounds(px);
      expect(box.x).toBe(-6); expect(box.y).toBe(18);
      expect(box.x + box.w).toBeLessThanOrEqual(8); expect(box.y + box.h).toBeLessThanOrEqual(34);
      if (f === 1) expect(box).toEqual({ x: -6, y: 18, w: 14, h: 16 });
    }
  });

  it('steps a frame every 80ms of model time, three to a 240ms loop, the reference formula at every tick', () => {
    expect([0, 0.0799, 0.08, 0.1599, 0.16, 0.2399, 0.24, 0.32, 0.48].map(jetpackFrame)).toEqual([0, 0, 1, 1, 2, 2, 0, 1, 0]);
    // Every 1/120 s tick over a minute, plus float ties on frame boundaries the way the model clock accumulates them.
    let t = 0;
    for (let i = 0; i < 7200; i++) { expect(jetpackFrame(t), `${i}`).toBe(refFrame(t)); t += 1 / 120; }
    for (let k = 0; k < 300; k++) expect(jetpackFrame(k * 0.08)).toBe(k % 3);
  });

  it('keeps dc51d0b flicker on every rectangle: 0.5 + |sin(22t)| x 0.5', () => {
    for (const t of [0, 0.01, 0.0714, 0.1, 0.5, 3.33, 61.7]) {
      const r = recorder();
      drawJetpackExhaust(r.g, 0, 0, t);
      expect(new Set(r.fills.map(f => f.alpha))).toEqual(new Set([flare(t)]));
    }
  });

  it('draws with integer rectangles only, nothing allocated, nothing but Graphics fills, no state read but the clock', () => {
    for (const frame of JETPACK_ART.frames) for (const row of frame) for (const v of row) expect(Number.isInteger(v)).toBe(true);
    const code = jetpackSource.slice(jetpackSource.indexOf('export function drawJetpackExhaust'));
    for (const banned of ['.add.', 'new ', 'generateTexture', '.textures', '.load.', 'postFX', 'preFX', 'setBlendMode', 'lineStyle', 'Circle', 'Math.random', 'Date', 'performance', 'particle', 'const [', '...', '.map(', '.forEach(']) expect(code, banned).not.toContain(banned);
    for (const banned of ['.png', 'fillGradientStyle', 'setAlpha', 'setTint', 'Glow', 'blur(', 'gravity', 'jetpackFuel', 'grounded']) expect(jetpackSource, banned).not.toContain(banned);
  });
});

describe('JETPACK A in the scene: same gate, same place, same layer', () => {
  it('replaces only the inside of dc51d0b block: the same `m.jetpackActive` gate, the rounded player x/y, the model clock', () => {
    expect(jetpackBlock()).toBe(JETPACK_BLOCK);
    expect(JETPACK_BLOCK).toContain('drawJetpackExhaust(this.graphics, x, y, this.model.elapsed);');
    // `jetpackActive` is the only gate, as before: no fuel, ground, AREA, BOSS or gravity check added.
    expect(jetpackBlock().split('if (').length - 1).toBe(1);
    expect(jetpackBlock()).not.toMatch(/grounded|jetpackFuel|gravity|boss|ammo/);
    expect(between(drawMethod(), '    const p = m.player, x = Math.round(p.x)', '\n')).toBe('    const p = m.player, x = Math.round(p.x), y = Math.round(p.y - cam);');
  });

  it('draws nothing without the upgrade, or with it while the flag is down, in any AREA or the fight', () => {
    const s = sceneJetpack();
    for (const area of [1, 2, 3, 4, 'boss'] as const) {
      for (const held of [false, true]) {
        const m = model(held, area);
        expect(m.jetpackActive).toBe(false);
        expect(s.frame(m).calls).toEqual([]); expect(s.baseline(m).calls).toEqual([]);
      }
      // Without the upgrade the model's own branch never raises the flag.
      expect(lit(model(false, area)).jetpackActive).toBe(false);
    }
  });

  it('when lit through the model, draws 12 rectangles inside the old three strips at the old flicker, in every AREA and the fight', () => {
    const s = sceneJetpack();
    for (const area of [1, 2, 3, 4, 'boss'] as const) {
      const m = lit(model(true, area));
      expect(m.jetpackActive).toBe(true);
      for (const t of [0.01, 0.09, 0.17, 1.234]) {
        m.elapsed = t;
        const cand = s.frame(m), base = s.baseline(m);
        expect(cand.fills).toHaveLength(12); expect(base.fills).toHaveLength(3);
        expect(new Set(cand.fills.map(f => f.alpha))).toEqual(new Set(base.fills.map(f => f.alpha)));
        const old = raster(base.fills), now = raster(cand.fills);
        for (const k of now.keys()) expect(old.has(k), k).toBe(true);
        expect(cand.calls.some(c => c.op !== 'fillStyle' && c.op !== 'fillRect')).toBe(false);
      }
    }
  });

  it('sits on the rounded player at every position, the same offset as dc51d0b, and the BOSS reversal does not move or flip it', () => {
    const s = sceneJetpack();
    const random = seeded(77);
    for (const area of [2, 'boss'] as const) {
      const m = lit(model(true, area));
      expect(m.gravitySign).toBe(area === 'boss' ? -1 : 1);
      for (let i = 0; i < 300; i++) {
        m.player.x = 20 + random() * 410 + (i % 4 === 0 ? 0.5 : 0);
        m.player.y = m.cameraY + 20 + random() * 740 + (i % 6 === 0 ? 0.5 : 0);
        m.elapsed = random() * 90;
        const x = Math.round(m.player.x), y = Math.round(m.player.y - m.cameraY);
        const old = raster(s.baseline(m).fills), now = raster(s.frame(m).fills);
        expect(bounds(old)).toEqual({ x: x - 6, y: y + 18, w: 14, h: 16 });
        const box = bounds(now);
        expect([box.x, box.y]).toEqual([x - 6, y + 18]);
        for (const k of now.keys()) { const [px, py] = k.split(',').map(Number); expect(inStrips(x, y, px, py), k).toBe(true); }
        // Below the player under either pull: dc51d0b's direction, kept as found (BOSS mismatch: FOUND -- NOT FIXED).
        expect(box.y).toBeGreaterThan(y);
      }
    }
  });

  it('keeps the after-enemies draw order: bullets, balloon, DRONE, INVUL, HIGH, sight, jetpack, player, HURT', () => {
    const draw = drawMethod();
    const i = (s: string) => { const k = draw.indexOf(s); expect(k, s).toBeGreaterThan(-1); return k; };
    const order = [
      'this.graphics = this.afterEnemies;', '// BONES', 'for (const b of m.bullets) {', '// HEART BALLOON', 'drawBalloonBody(this.graphics,',
      '// DRONE: a companion', 'drawDroneHull(this.graphics,', 'drawInvulShimmer(this.graphics, x, y, m.hp, p.invincible);',
      'if (high) drawCoinHighChips(', "if (m.upgrades.has('laserSight')) {", 'if (m.jetpackActive) {', 'drawJetpackExhaust(this.graphics, x, y,',
      'const art = this.playerArt?.render(', 'const foreground = this.artForeground ?? g;', 'drawHurtImpact(foreground, x, y, this.hurtAge);',
    ];
    for (let k = 1; k < order.length; k++) expect(i(order[k - 1]), order[k]).toBeLessThan(i(order[k]));
    // Same layer set as dc51d0b: no Graphics, image, container or texture added for it.
    expect(sceneSource.split('this.add.graphics()').length - 1).toBe(13);
    expect(sceneSource.split('drawJetpackExhaust(').length - 1).toBe(1);
    expect(sceneSource.split('jetpackActive').length - 1).toBe(1);
    expect(sceneSource).not.toMatch(/setDepth\([^)]*jetpack/i);
  });
});

describe('JETPACK A changes nothing else', () => {
  it('is dc51d0b GameScene.ts byte for byte once the three strips and the import are put back', () => {
    expect(sceneSource.split(JETPACK_IMPORT_LINE).length - 1).toBe(1);
    expect(sha256(withoutJetpackArt('scenes/GameScene.ts', sceneSource))).toBe('54980aa5f4ba20ff4c2b1765a7c235d81c27b253478a6f1ebb7b705b7a09a284');
  });

  it('leaves every other source byte-identical to dc51d0b: model, upgrades, TITLE AUDIO, DRONE, BALLOON, CORPSE, feedback, text, UI', () => {
    const SOURCES = import.meta.glob(['../src/**/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const keys = Object.keys(SOURCES).filter(k => k !== '../src/scenes/GameScene.ts' && !isJetpackArtFile(k)).sort();
    expect(keys).toHaveLength(89);
    // The same digest over the same 89 files, computed with `git show dc51d0b:<path>`.
    expect(sha256(keys.map(k => `${k}\n${sha256(SOURCES[k])}`).join('\n'))).toBe('9806b16ae1ea7b74b4bb9df82324e398816a8b50f03ab5d7334f6f4d5be7ff3d');
    expect(UPGRADES.filter(u => u.id === 'safetyJetpack')).toHaveLength(1);
  });

  it('keeps every SAFETY JETPACK rule: 4 s of fuel, fall held to a quarter of terminal speed', () => {
    const t = UPGRADE_TUNING.safetyJetpack;
    expect([t.fuelSeconds, t.fallMultiplier]).toEqual([4, 0.25]);
  });

  it('adds no PNG: the shipped image set is the dc51d0b one', () => {
    const pngs = Object.keys(import.meta.glob(['../src/**/*.png', '../public/**/*.png']));
    expect(pngs).toHaveLength(165);
    expect(pngs.filter(p => /jet|exhaust|flame/i.test(p))).toEqual(['../src/assets/upgrades/safety-jetpack.png']);
  });

  it('plays exactly as dc51d0b: the same hover, fuel, refills, flag, CHARGE, fall, hits, SECTION returns and reversal', () => {
    // Golden values produced by tests/jetpackTrace.ts on a git archive of dc51d0b.
    const GOLDEN: Record<string, ReturnType<typeof jetpackTrace>> = {
      'area1 plain': { digest: '7660a23a8be9457e', activeSteps: 0, starts: 0, stops: 0, refills: 0, emptyActive: 0, groundedActive: 0, kills: 5, hits: 0, sections: 3 },
      'area1 jetpack': { digest: '1473a542b109045d', activeSteps: 2017, starts: 16, stops: 14, refills: 6, emptyActive: 1, groundedActive: 276, kills: 4, hits: 0, sections: 3 },
      'area1 jetpack mortal': { digest: '22fb3742320d7e6a', activeSteps: 1994, starts: 15, stops: 13, refills: 6, emptyActive: 0, groundedActive: 421, kills: 6, hits: 1, sections: 3 },
      'area1 low fuel': { digest: '3d68fd0c8c34712c', activeSteps: 1057, starts: 10, stops: 9, refills: 8, emptyActive: 2, groundedActive: 313, kills: 5, hits: 0, sections: 3 },
      'area1 no fuel': { digest: 'fa38b2f95a1e9df0', activeSteps: 1005, starts: 8, stops: 7, refills: 8, emptyActive: 0, groundedActive: 304, kills: 5, hits: 0, sections: 3 },
      'area1 sections x3': { digest: 'd92de841a5b8feb6', activeSteps: 3795, starts: 29, stops: 27, refills: 16, emptyActive: 2, groundedActive: 516, kills: 6, hits: 0, sections: 9 },
      'area2 jetpack': { digest: 'd4c1df79d8890f23', activeSteps: 743, starts: 6, stops: 6, refills: 4, emptyActive: 0, groundedActive: 65, kills: 3, hits: 0, sections: 3 },
      'area2 jetpack+drone': { digest: '59cd6d51ff9cba4e', activeSteps: 706, starts: 6, stops: 6, refills: 4, emptyActive: 0, groundedActive: 65, kills: 5, hits: 0, sections: 3 },
      'area3 jetpack': { digest: 'e4e71fa6b0080944', activeSteps: 1332, starts: 10, stops: 9, refills: 4, emptyActive: 1, groundedActive: 170, kills: 1, hits: 0, sections: 3 },
      'area3 jetpack+balloon': { digest: '67f36104e27d3942', activeSteps: 1515, starts: 11, stops: 10, refills: 4, emptyActive: 1, groundedActive: 373, kills: 8, hits: 0, sections: 3 },
      'area4 jetpack': { digest: 'b41181344a3c418d', activeSteps: 1927, starts: 16, stops: 14, refills: 2, emptyActive: 2, groundedActive: 77, kills: 0, hits: 0, sections: 3 },
      'area4 stacked hurt': { digest: 'b48769919fbd75b5', activeSteps: 1482, starts: 12, stops: 12, refills: 0, emptyActive: 3, groundedActive: 0, kills: 4, hits: 12, sections: 3 },
      'boss reversed jetpack': { digest: 'f1e7ebd55b71fca3', activeSteps: 1469, starts: 12, stops: 12, refills: 0, emptyActive: 3, groundedActive: 0, kills: 1, hits: 0, sections: 3 },
      'boss reversed stacked': { digest: '1ae237dc05aa6a05', activeSteps: 1771, starts: 15, stops: 13, refills: 2, emptyActive: 3, groundedActive: 0, kills: 5, hits: 29, sections: 3 },
    };
    const got = Object.fromEntries(Object.entries(JETPACK_TRACE_SCENARIOS).map(([name, s]) => [name, jetpackTrace(s)]));
    expect(got).toEqual(GOLDEN);
    // The flag outlives the hover on the ground (groundedActive): dc51d0b behaviour, kept (FOUND -- NOT FIXED).
    expect(got['area1 jetpack'].groundedActive).toBeGreaterThan(0);
  }, 120_000);
});
