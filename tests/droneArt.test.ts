import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';
import { DRONE_ART, drawDroneHull } from '../src/render/droneArt';
import { UPGRADES, UPGRADE_TUNING } from '../src/data/upgrades';
import { GameModel } from '../src/systems/GameModel';
import { DRONE_TRACE_SCENARIOS, droneTrace } from './droneTrace';
import sceneSource from '../src/scenes/GameScene.ts?raw';
import droneSource from '../src/render/droneArt.ts?raw';

/**
 * DRONE PIXEL VFX RUNTIME INTEGRATION V1. Candidate A of output/upgrade-attachments-audit-v1
 * (claude-integration-spec.md): the companion's three flat rectangles become eight hard-edged ones in
 * the same 18x12 envelope, on the same Graphics, at the same spot, bob and rounding. Drawing only:
 * whether it is owned, where it rides, when and what it fires are exactly 7e4c59d's, and so is every
 * other line of the scene.
 */

const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: Uint8Array | string) => { digest: (e: string) => string } } };
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const between = (text: string, from: string, to: string) => {
  const a = text.indexOf(from), b = text.indexOf(to, a);
  expect(a, from).toBeGreaterThanOrEqual(0); expect(b, to).toBeGreaterThan(a);
  return text.slice(a, b);
};
const drawMethod = () => between(sceneSource, '  private draw() {', '  private surface(');
const IMPORT_LINE = "import { DRONE_ART, drawDroneHull } from '../render/droneArt';\n";

/** 7e4c59d's drone block, byte for byte. */
const BASELINE_BLOCK = `    // DRONE: a companion, never a target, that fires when the player does.
    if (m.upgrades.has('drone')) {
      const spot = m.dronePosition, dy = spot.y - cam;
      const bob = Math.sin(this.model.elapsed * 5) * 2;
      this.rect(spot.x - 9, dy + bob, 18, 6, 0x8fb8d8);
      this.rect(spot.x - 5, dy + bob + 6, 10, 3, 0x4a6b85);
      this.rect(spot.x - 2, dy + bob - 3, 4, 3, 0xdff0ff);
    }
`;
const droneBlock = () => between(drawMethod(), '    // DRONE: a companion', '    const p = m.player, x = Math.round(p.x)');

/** The table in claude-integration-spec.md (and harness/design.js candidate A), in its order. */
const SPEC = [
  [7, 0, 4, 3, 0xc3d5d5],
  [2, 3, 14, 1, 0x172b35],
  [0, 4, 18, 5, 0x172b35],
  [1, 4, 16, 2, 0x789fae],
  [3, 4, 12, 1, 0xc3d5d5],
  [4, 9, 10, 3, 0x172b35],
  [5, 9, 8, 2, 0x426779],
  [8, 6, 2, 2, 0x6dbccd],
];

interface Fill { x: number; y: number; w: number; h: number; color: number; alpha: number }
function recorder() {
  const fills: Fill[] = [];
  let color = -1, alpha = -1;
  const g = {
    fillStyle(c: number, a = 1) { color = c; alpha = a; return g; },
    fillRect(x: number, y: number, w: number, h: number) { fills.push({ x, y, w, h, color, alpha }); return g; },
  };
  return { g: g as unknown as Phaser.GameObjects.Graphics, fills };
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

/**
 * The scene's own drone drawing, run against a stand-in scene: the block out of draw() and the scene's
 * rect() exactly as GameScene.ts has them, on a recording Graphics. And 7e4c59d's block on the same frame.
 */
function sceneDrone() {
  const rectBody = between(sceneSource, '  private rect(x: number, y: number, w: number, h: number, color: number, alpha = 1) {', '\n');
  const rect = new Function('x', 'y', 'w', 'h', 'color', 'alpha = 1', rectBody.slice(rectBody.indexOf('{') + 1, rectBody.lastIndexOf('}')));
  const candidate = new Function('m', 'cam', 'drawDroneHull', 'DRONE_ART', droneBlock());
  const baseline = new Function('m', 'cam', BASELINE_BLOCK);
  const run = (block: (this: unknown, ...a: unknown[]) => void, m: GameModel, ...extra: unknown[]) => {
    const r = recorder();
    const scene = { model: m, graphics: r.g, rect(...a: unknown[]) { return rect.apply(scene, a); } };
    block.call(scene, m, m.cameraY, ...extra);
    return r.fills;
  };
  return {
    frame: (m: GameModel) => run(candidate as never, m, drawDroneHull, DRONE_ART),
    baseline: (m: GameModel) => run(baseline as never, m),
  };
}

const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
function model(held: boolean, area: 1 | 2 | 3 | 4 | 'boss' = 1) {
  const g = new GameModel(false, seeded(23));
  if (held) g.upgrades.grant('drone');
  if (area === 'boss') g.jumpToNimushi(); else g.jumpToStage(area, 1);
  return g;
}

describe('DRONE A: the eight rectangles', () => {
  it('is the spec table exactly: order, offsets, sizes, colours, alpha 1', () => {
    expect(DRONE_ART.hull.map(r => [...r])).toEqual(SPEC);
    expect([DRONE_ART.originX, DRONE_ART.originY, DRONE_ART.width, DRONE_ART.height]).toEqual([-9, -3, 18, 12]);
    const r = recorder();
    drawDroneHull(r.g, 100, 200);
    expect(r.fills).toEqual(SPEC.map(([dx, dy, w, h, color]) => ({ x: 100 + dx, y: 200 + dy, w, h, color, alpha: 1 })));
  });

  it('paints this 18x12 pixel map: dark key, two light faces, a cyan lens', () => {
    const r = recorder();
    drawDroneHull(r.g, 0, 0);
    const px = raster(r.fills);
    const KEY: Record<number, string> = { 0x172b35: 'K', 0x426779: 'M', 0x789fae: 'S', 0xc3d5d5: 'L', 0x6dbccd: 'C' };
    const rows = Array.from({ length: 12 }, (_, y) => Array.from({ length: 18 }, (_, x) => px.has(`${x},${y}`) ? KEY[px.get(`${x},${y}`)!] : '.').join(''));
    expect(rows).toEqual([
      '.......LLLL.......',
      '.......LLLL.......',
      '.......LLLL.......',
      '..KKKKKKKKKKKKKK..',
      'KSSLLLLLLLLLLLLSSK',
      'KSSSSSSSSSSSSSSSSK',
      'KKKKKKKKCCKKKKKKKK',
      'KKKKKKKKCCKKKKKKKK',
      'KKKKKKKKKKKKKKKKKK',
      '....KMMMMMMMMK....',
      '....KMMMMMMMMK....',
      '....KKKKKKKKKK....',
    ]);
    // Five colours, all from the audit's drone palette; nothing warm (no HURT pink, no HIGH brass).
    expect(new Set(r.fills.map(f => f.color))).toEqual(new Set([0x172b35, 0x426779, 0x789fae, 0xc3d5d5, 0x6dbccd]));
  });

  it('draws with integer rectangles only, nothing allocated, nothing but Graphics fills', () => {
    for (const row of DRONE_ART.hull) for (const v of row) expect(Number.isInteger(v)).toBe(true);
    const code = droneSource.slice(droneSource.indexOf('export function drawDroneHull'));
    for (const banned of ['.add.', 'new ', 'generateTexture', '.textures', '.load.', 'postFX', 'preFX', 'setBlendMode', 'lineStyle', 'Circle', 'Math.random', 'const [', '...', '.map(', '.forEach(']) expect(code, banned).not.toContain(banned);
    for (const banned of ['.png', 'fillGradientStyle', 'setAlpha', 'setTint', 'Glow', 'blur(']) expect(droneSource, banned).not.toContain(banned);
  });
});

describe('DRONE A in the scene: same spot, same bob, same envelope', () => {
  it('replaces only the three rectangles: the block keeps 7e4c59d gate, spot and bob', () => {
    const block = droneBlock();
    expect(block).toBe(`    // DRONE: a companion, never a target, that fires when the player does.
    if (m.upgrades.has('drone')) {
      const spot = m.dronePosition, dy = spot.y - cam;
      const bob = Math.sin(this.model.elapsed * 5) * 2;
      // DRONE PIXEL VFX V1 (render/droneArt): eight rectangles in the same 18x12 envelope, same rounding.
      drawDroneHull(this.graphics, Math.round(spot.x + DRONE_ART.originX), Math.round(dy + bob + DRONE_ART.originY));
    }
`);
    // Ownership is the only gate, as before: no AREA, BOSS, state or screen check added.
    expect(block.split('if (').length - 1).toBe(1);
  });

  it('draws nothing without the upgrade, in any AREA or the fight', () => {
    const s = sceneDrone();
    for (const area of [1, 2, 3, 4, 'boss'] as const) {
      const m = model(false, area);
      expect(s.frame(m)).toEqual([]);
      expect(s.baseline(m)).toEqual([]);
    }
  });

  it('draws exactly eight rectangles per frame when owned, in every AREA and the fight', () => {
    const s = sceneDrone();
    for (const area of [1, 2, 3, 4, 'boss'] as const) {
      const fills = s.frame(model(true, area));
      expect(fills).toHaveLength(8);
      for (const f of fills) { expect(f.alpha).toBe(1); for (const v of [f.x, f.y, f.w, f.h]) expect(Number.isInteger(v)).toBe(true); }
    }
  });

  it('stays inside the old 18x12 footprint on every frame: the same box, minus the top row corners', () => {
    const s = sceneDrone();
    const m = model(true, 2);
    const random = seeded(77);
    for (let i = 0; i < 400; i++) {
      // Fractional positions, half-pixel ties and the whole bob cycle, as play produces them.
      m.player.x = 40 + random() * 370 + (i % 4 === 0 ? 0.5 : 0);
      m.player.y = m.cameraY + 100 + random() * 600 + (i % 6 === 0 ? 0.5 : 0);
      m.elapsed = i * 0.0131 + random() * 3;
      const cand = raster(s.frame(m)), base = raster(s.baseline(m));
      expect(bounds(cand)).toEqual(bounds(base));
      for (const k of cand.keys()) expect(base.has(k), k).toBe(true);
      const { x, y } = bounds(base);
      const dropped = [...base.keys()].filter(k => !cand.has(k)).map(k => k.split(',').map(Number)).map(([px, py]) => [px - x, py - y]);
      expect(dropped).toEqual([[0, 3], [1, 3], [16, 3], [17, 3]]);
    }
  });

  it('rides the model spot unchanged: player + (26, -30), bobbing 2px over 2pi/5 seconds', () => {
    expect([UPGRADE_TUNING.drone.offsetX, UPGRADE_TUNING.drone.offsetY]).toEqual([26, -30]);
    const s = sceneDrone();
    const m = model(true, 1);
    m.player.x = 200; m.player.y = m.cameraY + 400;
    for (const [elapsed, bob] of [[0, 0], [Math.PI / 10, 2], [Math.PI / 5, 0], [3 * Math.PI / 10, -2]]) {
      m.elapsed = elapsed;
      expect(bounds(raster(s.frame(m)))).toEqual({ x: 200 + 26 - 9, y: 400 - 30 - 3 + bob, w: 18, h: 12 });
    }
  });

  it('keeps the after-enemies draw order: bullets, balloon, DRONE, INVUL, HIGH, sight, jetpack, player, HURT', () => {
    const draw = drawMethod();
    const i = (s: string) => { const k = draw.indexOf(s); expect(k, s).toBeGreaterThan(-1); return k; };
    const order = [
      'this.graphics = this.afterEnemies;', '// BONES', 'for (const b of m.bullets) {', '// HEART BALLOON', '// DRONE: a companion',
      'drawDroneHull(this.graphics,', 'drawInvulShimmer(this.graphics, x, y, m.hp, p.invincible);', 'if (high) drawCoinHighChips(',
      "if (m.upgrades.has('laserSight')) {", 'if (m.jetpackActive) {', 'const art = this.playerArt?.render(',
      'drawHurtImpact(foreground, x, y, this.hurtAge);', 'for (const particle of this.particles)',
    ];
    for (let k = 1; k < order.length; k++) expect(i(order[k - 1]), order[k]).toBeLessThan(i(order[k]));
    // Same layer set as 7e4c59d: no Graphics, image, container or texture added for it.
    expect(sceneSource.split('this.add.graphics()').length - 1).toBe(13);
    expect(sceneSource.split('drawDroneHull(').length - 1).toBe(1);
  });
});

describe('DRONE A changes nothing else', () => {
  it('is 7e4c59d GameScene.ts byte for byte once the drone block and its import are put back', () => {
    const block = droneBlock();
    expect(sceneSource.split(block).length - 1).toBe(1);
    expect(sceneSource.split(IMPORT_LINE).length - 1).toBe(1);
    const restored = sceneSource.replace(IMPORT_LINE, '').replace(block, BASELINE_BLOCK);
    expect(sha256(restored)).toBe('cc9415debd78831f0b2370766cf740a214d6f06f9e7820bd0112435d7b173f5e');
  });

  it('leaves the model, the upgrades, their icons, the guns and the player presentation byte-identical to 7e4c59d', () => {
    const SOURCES = import.meta.glob(['../src/systems/GameModel.ts', '../src/data/upgrades.ts', '../src/data/upgradeIcons.ts', '../src/data/gunModules.ts', '../src/render/PlayerArt.ts', '../src/render/playerFeedbackVfx.ts', '../src/render/floatingText.ts', '../src/main.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const got = Object.fromEntries(Object.entries(SOURCES).map(([path, text]) => [path.replace('../src/', ''), sha256(text)]));
    expect(got).toEqual({
      'systems/GameModel.ts': 'd44534da247bb31183e8dca9e1760c8cc498ad0671f5d0d6da030da021554ab6',
      'data/upgrades.ts': '60cb529a5fbb0de2455d5d49898cd221d8860bf9dce8f4173e88f198c79f373e',
      'data/upgradeIcons.ts': 'ebf29f03dbd724d8b63ee29857c1c71cbe62c09387988d8e78d294e2c171ddaf',
      'data/gunModules.ts': '0c554616f2f0f0635b880cbe1da67bbeb25ea5c74e0eac3dfb78a35c0c92c6e0',
      'render/PlayerArt.ts': '3499494947de629a3f91e3cce4cf53ce4597962839a8176d14c6282412f0a19e',
      'render/playerFeedbackVfx.ts': '0d68a0082637063d1fe062aae8b83d0f3a07a10cf9e96777af88265ec7680ba9',
      'render/floatingText.ts': '86cc69beee9dcedce6d7f44029b342ec796e0daacc37c523913b50b3dcc1bdd1',
      'main.ts': 'ab6f9da4e17a0b26e5d1cac8f1d48508eb7da57f778f7ea831d7c8f034ccc258',
    });
    // The catalogue still names DRONE once, with its own icon.
    expect(UPGRADES.filter(u => u.id === 'drone')).toHaveLength(1);
  });

  it('adds no PNG: the shipped image set is the 7e4c59d one', () => {
    const pngs = Object.keys(import.meta.glob(['../src/**/*.png', '../public/**/*.png']));
    expect(pngs).toHaveLength(165);
    expect(pngs.filter(p => /drone/i.test(p))).toEqual(['../src/assets/upgrades/drone.png']);
  });

  it('plays exactly as 7e4c59d: the same rounds, kills, hits, chain and positions, with and without DRONE', () => {
    // Golden values produced by tests/droneTrace.ts on a git archive of 7e4c59d.
    const GOLDEN: Record<string, { digest: string; droneRounds: number; playerRounds: number; kills: number; hits: number }> = {
      'area1 drone': { digest: '1da7056ae700e046', droneRounds: 154, playerRounds: 155, kills: 19, hits: 0 },
      'area1 drone mortal': { digest: '1e37f12835d86547', droneRounds: 166, playerRounds: 176, kills: 11, hits: 0 },
      'area1 plain': { digest: 'a82389ad8d8bfe23', droneRounds: 0, playerRounds: 162, kills: 16, hits: 0 },
      'area2 drone': { digest: 'c51b6a6418c9567a', droneRounds: 178, playerRounds: 179, kills: 9, hits: 0 },
      'area2 stacked': { digest: 'd0f479aeaf7b2870', droneRounds: 169, playerRounds: 170, kills: 15, hits: 0 },
      'area3 drone': { digest: '3b8599e7300594e3', droneRounds: 172, playerRounds: 173, kills: 11, hits: 0 },
      'area3 stacked hurt': { digest: 'a657b7132a0abd5d', droneRounds: 121, playerRounds: 121, kills: 17, hits: 2 },
      'area4 drone': { digest: '64938e7c2020af66', droneRounds: 140, playerRounds: 145, kills: 20, hits: 0 },
      'area4 stacked': { digest: '7131ac0900e8caa9', droneRounds: 87, playerRounds: 90, kills: 21, hits: 0 },
      'area2 others': { digest: 'dce965544a4e68b4', droneRounds: 0, playerRounds: 131, kills: 17, hits: 0 },
      'boss drone': { digest: '62b79c4cef820683', droneRounds: 184, playerRounds: 174, kills: 49, hits: 337 },
      'boss stacked': { digest: '56afca78a185b5ac', droneRounds: 24, playerRounds: 24, kills: 0, hits: 48 },
    };
    const got = Object.fromEntries(Object.entries(DRONE_TRACE_SCENARIOS).map(([name, s]) => [name, droneTrace(s.start, s.held, { seconds: s.seconds, invincible: s.invincible })]));
    expect(got).toEqual(GOLDEN);
  }, 60_000);
});
