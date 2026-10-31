import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';
import { JETPACK_ART, drawJetpackExhaust } from '../src/render/jetpackArt';
import { GameModel } from '../src/systems/GameModel';
import { JETPACK_BEHAVIOR_FILES, withoutJetpackBehaviorFix } from './jetpackBehaviorRestore';
import sceneSource from '../src/scenes/GameScene.ts?raw';

/**
 * JETPACK BEHAVIOR FIX V1 (output/jetpack-behavior-audit-v1, claude-integration-spec.md).
 *
 * ISSUE 1: under the ABYSS's reversed pull the jetpack caps a climb, so its exhaust belongs above the player. The
 * same 12 rectangles a frame are mirrored about the player's centre line (y+o -> y-o-h); the ordinary pull draws
 * exactly what 19adbd4 drew. Presentation only: nothing in the model changes for it.
 */

const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: Uint8Array | string) => { digest: (e: string) => string } } };
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

interface Fill { x: number; y: number; w: number; h: number; color: number; alpha: number }
function recorder() {
  const ops: string[] = [], fills: Fill[] = [];
  let color = -1, alpha = -1;
  const g = {
    fillStyle(c: number, a = 1) { color = c; alpha = a; ops.push(`fillStyle ${c} ${a}`); return g; },
    fillRect(x: number, y: number, w: number, h: number) { fills.push({ x, y, w, h, color, alpha }); ops.push(`fillRect ${x} ${y} ${w} ${h}`); return g; },
  };
  return { g: g as unknown as Phaser.GameObjects.Graphics, ops, fills };
}
const draw = (x: number, y: number, t: number, sign?: 1 | -1) => {
  const r = recorder();
  if (sign === undefined) drawJetpackExhaust(r.g, x, y, t); else drawJetpackExhaust(r.g, x, y, t, sign);
  return r;
};
const raster = (fills: Fill[]) => {
  const px = new Set<string>();
  for (const f of fills) for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) px.add(`${x},${y}`);
  return px;
};
const between = (text: string, from: string, to: string) => {
  const a = text.indexOf(from), b = text.indexOf(to, a);
  expect(a, from).toBeGreaterThanOrEqual(0); expect(b, to).toBeGreaterThan(a);
  return text.slice(a, b);
};
/** GameScene's own jetpack block, run on a recording Graphics against the model it is given. */
function sceneBlock() {
  const block = between(between(sceneSource, '  private draw() {', '  private surface('), '    if (m.jetpackActive', '    const art = this.playerArt?.render(');
  const fn = new Function('m', 'x', 'y', 'drawJetpackExhaust', block);
  return (m: GameModel) => {
    const r = recorder();
    fn.call({ model: m, graphics: r.g }, m, Math.round(m.player.x), Math.round(m.player.y - m.cameraY), drawJetpackExhaust);
    return r;
  };
}
const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
const internals = (g: GameModel) => g as unknown as { fireGun: (dt: number, d: number, f: boolean) => void; syncUpgrades: () => void };

describe('ISSUE 1: the exhaust points along the pull it brakes against', () => {
  it('under the ordinary pull draws 19adbd4 call for call, with or without the sign', () => {
    for (let t = 0; t < 0.48; t += 0.013) for (const [x, y] of [[100, 200], [0, 0], [-3, 799]]) {
      const plain = draw(x, y, t), normal = draw(x, y, t, 1);
      expect(normal.ops).toEqual(plain.ops);
      // 19adbd4's formula, verbatim: y + originY + dy.
      const frame = JETPACK_ART.frames[Math.floor((t + 1e-8) / 0.08) % 3];
      expect(plain.fills.map(f => [f.x, f.y, f.w, f.h, f.color])).toEqual(frame.map(r => [x - 6 + r[0], y + 18 + r[1], r[2], r[3], r[4]]));
    }
  });

  it('under the reversed pull mirrors every rectangle about the centre line: same x, size, colour, alpha, order', () => {
    for (let t = 0; t < 0.48; t += 0.011) {
      const down = draw(120, 300, t, 1), up = draw(120, 300, t, -1);
      expect(up.fills).toHaveLength(12);
      expect(up.fills).toEqual(down.fills.map(f => ({ ...f, y: 2 * 300 - f.y - f.h })));
      // Pixel for pixel: each painted row y lands on 2*300-1-y.
      const a = raster(down.fills), b = raster(up.fills);
      expect([...b].sort()).toEqual([...a].map(k => { const [x, y] = k.split(',').map(Number); return `${x},${599 - y}`; }).sort());
    }
  });

  it('keeps 3 frames of 12 rectangles at 80ms and the flicker alpha under either pull', () => {
    for (const sign of [1, -1] as const) {
      const seen = new Set<string>();
      for (let f = 0; f < 6; f++) {
        const t = f * 0.08 + 0.02, r = draw(0, 0, t, sign);
        expect(r.fills).toHaveLength(12);
        expect(new Set(r.fills.map(x => x.alpha))).toEqual(new Set([0.5 + Math.abs(Math.sin(t * 22)) * 0.5]));
        seen.add(JSON.stringify(r.fills.map(x => [x.y, x.h])));
      }
      expect(seen.size).toBe(3);
    }
  });

  it('stays inside the mirrored 14x16 envelope x=[-6,8) y=[-34,-18), and only the mirrored strips', () => {
    const MIRRORED = [[-6, -26, 4, 8], [-1, -30, 4, 11], [4, -34, 4, 14]];
    for (let f = 0; f < 3; f++) {
      const px = raster(draw(0, 0, f * 0.08 + 0.001, -1).fills);
      for (const k of px) {
        const [x, y] = k.split(',').map(Number);
        expect(x >= -6 && x < 8 && y >= -34 && y < -18, k).toBe(true);
        expect(MIRRORED.some(([sx, sy, w, h]) => x >= sx && x < sx + w && y >= sy && y < sy + h), k).toBe(true);
      }
    }
  });

  it('the scene passes the model\'s own gravity sign and nothing else new', () => {
    expect(sceneSource.split('drawJetpackExhaust(').length - 1).toBe(1);
    expect(sceneSource).toContain('drawJetpackExhaust(this.graphics, x, y, this.model.elapsed, m.gravitySign);');
    expect(sceneSource).not.toMatch(/jetpack[^\n]*\.vy|vy[^\n]*jetpack/i);
  });

  it('in the fight, lit by the model\'s own step: the cap brakes the climb to -130 and the exhaust sits above the player', () => {
    const g = new GameModel(false, seeded(5));
    g.upgrades.grant('safetyJetpack'); internals(g).syncUpgrades();
    g.jumpToNimushi();
    expect(g.gravitySign).toBe(-1);
    g.ammo = 0; g.player.grounded = -1; g.player.vy = -600; (g as unknown as { actionHeld: boolean }).actionHeld = true;
    g.step(1 / 120, 0, true);
    expect(g.jetpackActive).toBe(true);
    expect(g.player.vy).toBe(-130);
    const r = sceneBlock()(g), y = Math.round(g.player.y - g.cameraY);
    expect(r.fills).toHaveLength(12);
    for (const f of r.fills) expect(f.y + f.h).toBeLessThanOrEqual(y - 18);
  });

  it('in STAGING (ordinary pull) the exhaust stays below, as 19adbd4', () => {
    const g = new GameModel(false, seeded(6));
    g.upgrades.grant('safetyJetpack'); internals(g).syncUpgrades();
    g.jumpToBoss();
    expect([g.abyssStage, g.gravitySign]).toEqual(['staging', 1]);
    g.ammo = 0; g.player.grounded = -1; internals(g).fireGun(1 / 120, 0, true);
    expect(g.jetpackActive).toBe(true);
    const r = sceneBlock()(g), y = Math.round(g.player.y - g.cameraY);
    expect(r.fills.map(f => f.y)).toEqual(draw(0, y, g.elapsed, 1).fills.map(f => f.y));
    for (const f of r.fills) expect(f.y).toBeGreaterThanOrEqual(y + 18);
  });
});

describe('JETPACK BEHAVIOR FIX V1 changes nothing else', () => {
  it('every touched source is 19adbd4 byte for byte once its hunks are reversed', () => {
    const SOURCES = import.meta.glob(['../src/**/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const AT_19ADBD4: Record<string, string> = {
      'scenes/GameScene.ts': 'd6639bc1b20143a5aad010bac1df995e8745a0be51bb0abb64ebc8fbb5cc3f1a',
      'systems/GameModel.ts': 'd44534da247bb31183e8dca9e1760c8cc498ad0671f5d0d6da030da021554ab6',
      'main.ts': 'b9e7ada5bd49a44b70a00baa80c93613d0a25b7df53aa29a57376e81a40f0897',
      'render/jetpackArt.ts': '4ded114f90b9eaac7abc5efbf176a588d894a92f6726c1f85092b2472feaa3b3',
    };
    for (const path of JETPACK_BEHAVIOR_FILES) expect(Object.keys(AT_19ADBD4), path).toContain(path);
    for (const [path, digest] of Object.entries(AT_19ADBD4)) expect(sha256(withoutJetpackBehaviorFix(path, SOURCES[`../src/${path}`])), path).toBe(digest);
    // The other 87 sources, computed with `git show 19adbd4:<path>`.
    const keys = Object.keys(SOURCES).filter(k => !(k.replace('../src/', '') in AT_19ADBD4)).sort();
    expect(keys).toHaveLength(87);
    expect(sha256(keys.map(k => `${k}\n${sha256(SOURCES[k])}`).join('\n'))).toBe('53791ad480e20030ff11cb128cc40b1a27381e2fe8c488ffeb18fabb45994026');
  });
});
