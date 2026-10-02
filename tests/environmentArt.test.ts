import { describe, expect, it } from 'vitest';
import {
  BLOCK_DROP_FROM, ENVIRONMENT_ART, ENVIRONMENT_GEOMETRY, beltLayout, breakBlockFrame, breakBlockSlices, environmentArtArea, environmentArtId, environmentKeys, environmentLoads,
  environmentParts, limboArt, limboLayout, platformSlices, reefArt, reefLayout, spikeFrame, spikeLayout, usesPlatformArt, wallTileX, wallTileY,
} from '../src/render/environmentArt';
import { HAZARD_TYPES, spawnHazard } from '../src/data/hazards';
import { AIR_CONTAINER_RULES } from '../src/data/structures';
import { REEF_RULES } from '../src/systems/StageGenerator';
import sceneSource from '../src/scenes/GameScene.ts?raw';
import { BREAK_BLOCK_RULES, CONVEYOR_RULES, LIMBO_HAZARD_RULES, PLATFORM_THICKNESS, SPIKE_PLATFORM_RULES, breakBlockWidth, conveyorDirFor } from '../src/data/structures';
import { StageGenerator } from '../src/systems/StageGenerator';
import { entered, generationSignature, replaySignature } from './regressionSignature';
import { WORLD } from '../src/data/balance';
import { AREAS } from '../src/data/areas';
import { GameModel } from '../src/systems/GameModel';
import { intoTheAbyss, tick } from './nimushi';
import { ABYSS } from '../src/data/abyss';

// PNG headers read straight off disk: Vitest serves image imports as URLs, not bytes. (No Node types here.)
const { readFileSync } = await import(/* @vite-ignore */ 'node:' + 'fs') as { readFileSync: (path: URL) => Uint8Array };
const { createHash } = await import(/* @vite-ignore */ 'node:' + 'crypto') as { createHash: (a: string) => { update: (b: Uint8Array) => { digest: (e: string) => string } } };
const pngSize = (file: string, area = 1) => {
  const b = readFileSync(new URL(`../src/assets/environment/area${area}/${file}`, import.meta.url));
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  return [u32(16), u32(20)];
};
/** Width, height, bit depth and colour type (6 = RGBA) of an AREA 2 image, and its SHA-256. */
const area2Png = (file: string) => {
  const b = readFileSync(new URL(`../src/assets/environment/area2/${file}`, import.meta.url));
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  return { size: [u32(16), u32(20)], depth: b[24], colour: b[25], sha256: createHash('sha256').update(b).digest('hex') };
};
const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };

/** ENVIRONMENT ART: AREA 1's ledges and walls from images, on the geometry the model already has. */
describe('the image sets', () => {
  it('lists AREA 1, AREA 2, AREA 3, AREA 4, THE ABYSS staging room and the BOSS arena -- nothing else', () => {
    expect(Object.keys(ENVIRONMENT_ART)).toEqual(['1', '2', '3', '4', 'staging', 'boss']);
    expect(Object.keys(ENVIRONMENT_ART).map(environmentArtId)).toEqual([1, 2, 3, 4, 'staging', 'boss']);
    expect(ENVIRONMENT_ART[0]).toBeUndefined();
  });

  it('keeps AREA 1 exactly as it was: five images, no special surfaces', () => {
    const set = ENVIRONMENT_ART[1]!;
    expect(set.platform!.left).toMatch(/area1\/platform-left-cap\.png/);
    expect(set.platform!.center).toMatch(/area1\/platform-center\.png/);
    expect(set.platform!.right).toMatch(/area1\/platform-right-cap\.png/);
    expect(set.wall.fill).toMatch(/area1\/wall-fill\.png/);
    expect(set.wall.edge).toMatch(/area1\/wall-inner-edge\.png/);
    expect(set.breakBlock).toBeUndefined();
    expect(set.spike).toBeUndefined();
    expect(set.conveyor).toBeUndefined();
    expect(environmentLoads(1, set).map(([key]) => key)).toEqual(['env-1-platform-left', 'env-1-platform-center', 'env-1-platform-right', 'env-1-wall-fill', 'env-1-wall-edge']);
  });

  it('ships the five AREA 1 images at the audited sizes, from src/assets', () => {
    expect(pngSize('platform-left-cap.png')).toEqual([8, 24]);
    expect(pngSize('platform-center.png')).toEqual([16, 24]);
    expect(pngSize('platform-right-cap.png')).toEqual([8, 24]);
    expect(pngSize('wall-fill.png')).toEqual([32, 96]);
    expect(pngSize('wall-inner-edge.png')).toEqual([4, 96]);
    for (const url of Object.values(ENVIRONMENT_ART[1]!.platform!).concat(Object.values(ENVIRONMENT_ART[1]!.wall))) {
      expect(url).not.toMatch(/(^|\/)(output|dist)\//);
    }
  });

  it('ships the eighteen AREA 2 images, byte for byte the reviewed ones, from src/assets', () => {
    // Sizes and hashes of output/environment-art-area2-v1 as delivered (review/validation.json: 18 RGBA).
    const expected: Record<string, [number, number, string]> = {
      'area2-platform-left-cap.png': [8, 24, '004c2e2dd54978e4c4839f16a9a68f07598df6a98d4ac97a5fda155ebc31975a'],
      'area2-platform-center.png': [16, 24, 'f190f7d7618ea7c8206e89d0ab5dbc53a13a66e34a4e41ede24accec44da8eff'],
      'area2-platform-right-cap.png': [8, 24, '4cb2a91797c44eca299627980d6d19d046621ed5f6de701e014c7dcf0e0393b4'],
      'area2-wall-fill.png': [32, 96, '6ee69fa0a7ef2ef5e9ed1f32ae247c02b5ba29143d6b53bd20077a56960f8592'],
      'area2-wall-inner-edge.png': [4, 96, 'b2af3dc85f2099bef02ea35fff49dd60b6812e8db00cf6a5e4ab3ca5a8af3e0f'],
      'area2-break-block-normal.png': [80, 16, '4aa80eca79f18fb01839949978a74bda911d363cbf25134368724cc0c28db6eb'],
      'area2-break-block-reward.png': [80, 16, '22c5043843b54b48c3d197dec8251bc7e0459011fc39a9e85abd4b8d70d29ad0'],
      'area2-break-block-crack-1.png': [80, 16, '5bef9eb4b5f6551758454641314a2ba87854317b4228f4ffb92d77423ff9f45f'],
      'area2-break-block-crack-2.png': [80, 16, 'eb061aab0f4999ce9743e443eb1265d1acc2f2cd6d21c520b53a408153520134'],
      'area2-conveyor-tile.png': [14, 8, '33f60ca302c143116b14fcf2745bf883c91fab415a7afe506eeaf09d1cdf72f7'],
      'area2-conveyor-arrow.png': [10, 12, 'd8627de29fd882baa4df75f39a45a2ef71fa5fe073e6fe54e80b74019481e1fd'],
      'area2-spike-socket.png': [17, 8, '622415812d99cf7ce4cda376aac600c4019974e6f48ce8478c4e83006ac9f94b'],
      'area2-spike-warning-1.png': [9, 18, 'aef66c5a1393ca45ef0b4d0884e526005eacbdfe98bc5daaadd5c6fa1a6bf5a1'],
      'area2-spike-warning-2.png': [9, 18, '069091db9133e347c0ef2d554ca6bd5552f0462a32b21163d09be5d63ea94f8f'],
      'area2-spike-warning-3.png': [9, 18, '912c3f42b9260a4946232ed75df7fe168f68759fb4b0adb5dd63c5927b4ede7c'],
      'area2-spike-warning-4.png': [9, 18, '0fc12e71a89f1dafed28b260107578c92a148280dfec197f136657ca5740124a'],
      'area2-spike-active.png': [9, 18, '16b68d10941c182d0fad678f15ace223816e1ea1484bc3265c5708e11a53b902'],
      'area2-spike-edge-mark.png': [6, 8, '5e16f9cf54835b4b8e6838b31076cd5f580a094a3ebd837f35248ed737528187'],
    };
    for (const [file, [w, h, sha256]] of Object.entries(expected)) {
      expect({ file, ...area2Png(file) }).toEqual({ file, size: [w, h], depth: 8, colour: 6, sha256 });
    }
    // Every one is loaded, under its own key, and none is read from output/ or dist/.
    const loads = environmentLoads(2, ENVIRONMENT_ART[2]!);
    expect(loads).toHaveLength(18);
    expect(new Set(loads.map(([key]) => key)).size).toBe(18);
    for (const [key, url] of loads) {
      expect(key).toMatch(/^env-2-/);
      expect(url).toMatch(/area2\/area2-[a-z0-9-]+\.png/);
      expect(url).not.toMatch(/(^|\/)(output|dist)\//);
    }
    const files = loads.map(([, url]) => url.match(/area2-[a-z0-9-]+\.png/)![0]).sort();
    expect(files).toEqual(Object.keys(expected).sort());
  });

  it('maps each AREA 2 image to its part', () => {
    const set = ENVIRONMENT_ART[2]!;
    expect(set.platform!.left).toMatch(/area2-platform-left-cap\.png/);
    expect(set.platform!.center).toMatch(/area2-platform-center\.png/);
    expect(set.platform!.right).toMatch(/area2-platform-right-cap\.png/);
    expect(set.wall.fill).toMatch(/area2-wall-fill\.png/);
    expect(set.wall.edge).toMatch(/area2-wall-inner-edge\.png/);
    expect(set.breakBlock!.normal).toMatch(/area2-break-block-normal\.png/);
    expect(set.breakBlock!.reward).toMatch(/area2-break-block-reward\.png/);
    expect(set.breakBlock!.crack1).toMatch(/area2-break-block-crack-1\.png/);
    expect(set.breakBlock!.crack2).toMatch(/area2-break-block-crack-2\.png/);
    expect(set.conveyor!.tile).toMatch(/area2-conveyor-tile\.png/);
    expect(set.conveyor!.arrow).toMatch(/area2-conveyor-arrow\.png/);
    expect(set.spike!.socket).toMatch(/area2-spike-socket\.png/);
    for (const n of [1, 2, 3, 4] as const) expect(set.spike![`warning${n}`]).toMatch(new RegExp(`area2-spike-warning-${n}\\.png`));
    expect(set.spike!.active).toMatch(/area2-spike-active\.png/);
    expect(set.spike!.edge).toMatch(/area2-spike-edge-mark\.png/);
  });
});

describe('which parts draw from images', () => {
  const all = () => true;
  it('AREA 1, AREA 3 and AREA 4: ledges and walls only; AREA 2: every part; the boss (0): nothing', () => {
    const pick = (area: number) => { const { keys: _k, ...rest } = environmentParts(area, all); return rest; };
    expect(pick(1)).toEqual({ wall: true, platform: true, breakBlock: false, spike: false, conveyor: false });
    expect(pick(2)).toEqual({ wall: true, platform: true, breakBlock: true, spike: true, conveyor: true });
    expect(pick(3)).toEqual({ wall: true, platform: true, breakBlock: false, spike: false, conveyor: false });
    expect(pick(4)).toEqual({ wall: true, platform: true, breakBlock: false, spike: false, conveyor: false });
    expect(pick(0)).toEqual({ wall: false, platform: false, breakBlock: false, spike: false, conveyor: false });
  });

  it('falls back to procedural, part by part, when an image is missing or failed to load', () => {
    const keys = environmentKeys(2);
    const without = (...missing: string[]) => { const { keys: _k, ...rest } = environmentParts(2, key => !missing.includes(key)); return rest; };
    expect(without(keys.fill)).toMatchObject({ wall: false, platform: true });
    expect(without(keys.edge)).toMatchObject({ wall: false, platform: true });
    expect(without(keys.block.crack2)).toMatchObject({ breakBlock: false, platform: true, spike: true });
    expect(without(keys.spike.warning3)).toMatchObject({ spike: false, platform: true, conveyor: true });
    expect(without(keys.belt.arrow)).toMatchObject({ conveyor: false, spike: true });
    // A spike floor or a belt sits on the 3-slice: no ledge images, no spike or belt images either.
    expect(without(keys.center)).toEqual({ wall: true, platform: false, breakBlock: true, spike: false, conveyor: false });
    expect(without()).toEqual({ wall: true, platform: true, breakBlock: true, spike: true, conveyor: true });
    // Nothing loaded at all: everything procedural.
    const { keys: _k, ...none } = environmentParts(2, () => false);
    expect(none).toEqual({ wall: false, platform: false, breakBlock: false, spike: false, conveyor: false });
  });

  it('a spike floor or belt whose images are missing is not drawn as a plain image ledge', () => {
    const spiked = { width: 180, spikePlatform: { state: 'safe' as const, timer: 0, warning: 0.5 } };
    const belted = { ...spiked, conveyor: { dir: 1 as const, speed: 70 } };
    expect(usesPlatformArt(spiked, { spike: true, conveyor: true })).toBe(true);
    expect(usesPlatformArt(spiked, { spike: false, conveyor: true })).toBe(false);
    expect(usesPlatformArt(belted, { spike: true, conveyor: true })).toBe(true);
    expect(usesPlatformArt(belted, { spike: true, conveyor: false })).toBe(false);
    // The ABYSS arena's spike floors (no warning of their own) are never drawn from AREA 2's images.
    expect(usesPlatformArt({ width: 180, spikePlatform: { state: 'safe', timer: 0 } }, { spike: true, conveyor: true })).toBe(false);
    // Without parts (AREA 1, which has none) every special surface stays procedural, exactly as before.
    expect(usesPlatformArt(spiked)).toBe(false);
    expect(usesPlatformArt(belted)).toBe(false);
  });
});

describe('a ledge', () => {
  const { cap, center, height, surfaceRow } = ENVIRONMENT_GEOMETRY.platform;

  it('puts the image\'s row 3 exactly on the collision landing line y', () => {
    expect(surfaceRow).toBe(3);
    for (const y of [250, 1001, 4329]) {
      const at = platformSlices(155, y, 140);
      expect(at.top + surfaceRow).toBe(y);
    }
    // The visual is drawn over the collision slab, never instead of it: the thickness is the model's.
    expect(PLATFORM_THICKNESS).toBe(16);
    expect(height).toBe(24);
  });

  it('covers exactly the collision width at every AREA 1 width: caps unchanged, the center repeated and cropped', () => {
    const widths = new Set<number>([140, 148, 150]);
    const area1 = AREAS.find(a => a.id === 1)!;
    for (const plan of area1.plans ?? []) { const [lo, hi] = plan.platformWidth ?? [0, -1]; for (let w = lo; w <= hi; w++) widths.add(w); }
    for (let w = cap * 2; w <= WORLD.width - WORLD.wall * 2; w++) widths.add(w); // shelves, sills and floors of any width
    for (const w of widths) {
      const at = platformSlices(100, 300, w);
      expect(at.left).toEqual({ x: 100, width: cap });
      expect(at.right).toEqual({ x: 100 + w - cap, width: cap });
      expect(at.center.x).toBe(100 + cap);
      expect(at.center.x + at.center.width).toBe(at.right.x);
      expect(at.center.width).toBeGreaterThanOrEqual(0);
    }
    expect(center).toBe(16);
  });

  it('is used for ordinary ledges only; every special surface keeps its own drawing', () => {
    const plain = { state: 'stable' as const, breakable: false, width: 140 };
    expect(usesPlatformArt(plain)).toBe(true);
    // Most ledges the generator lays carry no state at all: that is an ordinary, stable ledge.
    expect(usesPlatformArt({ width: 185 })).toBe(true);
    expect(usesPlatformArt({ ...plain, breakBlock: { hits: 0, durability: 2, slot: 0, reward: false } })).toBe(false);
    expect(usesPlatformArt({ ...plain, limboHazard: true })).toBe(false);
    expect(usesPlatformArt({ ...plain, spikePlatform: { state: 'safe', timer: 0 } } as never)).toBe(false);
    expect(usesPlatformArt({ ...plain, conveyor: { dir: 1, speed: 70 } } as never)).toBe(false);
    expect(usesPlatformArt({ ...plain, breakable: true })).toBe(false);
    expect(usesPlatformArt({ ...plain, state: 'cracking' } as never)).toBe(false);
    expect(usesPlatformArt({ ...plain, width: cap * 2 - 1 })).toBe(false);
  });
});

describe('the wall', () => {
  const { fillWidth, fillHeight, shaftLeft, shaftRight } = ENVIRONMENT_GEOMETRY.wall;

  it('keeps the collision boundaries where they are', () => {
    expect(shaftLeft).toBe(WORLD.wall);
    expect(shaftRight).toBe(WORLD.width - WORLD.wall);
  });

  it('shows the fill\'s inner column against the shaft however far the wall reaches out', () => {
    for (let reach = 0; reach <= 460; reach++) {
      const width = shaftLeft + reach;
      // Left wall: screen x = -reach .. 27. The column at x = 27 (next to the shaft) is the fill's last.
      const column = (x: number) => ((x + reach + wallTileX(width)) % fillWidth + fillWidth) % fillWidth;
      expect(column(27)).toBe(fillWidth - 1);
      // The 28 columns on screen at the start of the run (reach aside) are the inner 28 of the 32.
      expect(column(0)).toBe(fillWidth - shaftLeft);
    }
  });

  it('scrolls with the world, whole pixels only', () => {
    expect(wallTileY(0)).toBe(0);
    expect(wallTileY(96)).toBe(0);
    expect(wallTileY(100.4)).toBe(4);
    expect(wallTileY(-5)).toBe(fillHeight - 5);
  });
});

describe('gameplay', () => {
  it('is untouched: an AREA 1 run lands on the start ledge exactly where it always has', () => {
    const game = new GameModel();
    game.jumpToStage(1, 1);
    const start = game.platforms.find(p => p.id === -2)!;
    expect({ x: start.x, y: start.y, width: start.width }).toEqual({ x: 155, y: 250, width: 140 });
    for (let i = 0; i < 240 && game.player.grounded === -1; i++) game.step(1 / 120, 0, false);
    expect(game.player.grounded).toBe(-2);
    expect(game.player.y + 15).toBe(start.y);
  });
});

describe('AREA 2 ledges', () => {
  const { cap, surfaceRow } = ENVIRONMENT_GEOMETRY.platform;

  it('uses the same 3-slice at every AREA 2 width: row 3 on the landing line, caps fixed, the center repeated', () => {
    const widths = new Set<number>();
    for (const plan of AREAS.find(a => a.id === 2)!.plans ?? []) { const [lo, hi] = plan.platformWidth; for (let w = lo; w <= hi; w++) widths.add(w); }
    expect(Math.min(...widths)).toBe(148);
    expect(Math.max(...widths)).toBe(198);
    for (const w of widths) for (const y of [465, 821, 4667]) {
      const at = platformSlices(28, y, w);
      expect(at.top + surfaceRow).toBe(y);
      expect(at.left).toEqual({ x: 28, width: cap });
      expect(at.right).toEqual({ x: 28 + w - cap, width: cap });
      expect(at.center).toEqual({ x: 28 + cap, width: w - cap * 2 });
    }
  });

  it('takes the image look on ordinary ledges, CATACOMB spike floors and belts; never on a BREAK BLOCK', () => {
    const parts = environmentParts(2, () => true);
    expect(usesPlatformArt({ width: 180 }, parts)).toBe(true);
    expect(usesPlatformArt({ width: 180, spikePlatform: { state: 'warning', timer: 0.2, warning: 0.5 } }, parts)).toBe(true);
    expect(usesPlatformArt({ width: 180, spikePlatform: { state: 'safe', timer: 0, warning: 0.5 }, conveyor: { dir: -1, speed: 90 } }, parts)).toBe(true);
    expect(usesPlatformArt({ width: 79, breakBlock: { hits: 0, durability: 2, slot: 0, reward: false } }, parts)).toBe(false);
    expect(usesPlatformArt({ width: 180, limboHazard: true }, parts)).toBe(false);
  });
});

describe('AREA 2 walls', () => {
  it('reuse AREA 1\'s wall geometry: 28px walls, the inner edge on the wall side of x 28 and x 422', () => {
    const { fillWidth, fillHeight, edgeWidth, shaftLeft, shaftRight } = ENVIRONMENT_GEOMETRY.wall;
    expect([fillWidth, fillHeight, edgeWidth]).toEqual([32, 96, 4]);
    expect(pngSize('area2-wall-fill.png', 2)).toEqual([fillWidth, fillHeight]);
    expect(pngSize('area2-wall-inner-edge.png', 2)).toEqual([edgeWidth, fillHeight]);
    expect([shaftLeft, shaftRight]).toEqual([WORLD.wall, WORLD.width - WORLD.wall]);
    expect(WORLD.wall).toBe(28);
    expect(WORLD.width - WORLD.wall * 2).toBe(394);
  });
});

describe('AREA 2 BREAK BLOCK', () => {
  it('shows the stone it was built as, and one crack overlay per round taken', () => {
    expect(breakBlockFrame(0, false)).toEqual({ base: 'normal', crack: null });
    expect(breakBlockFrame(0, true)).toEqual({ base: 'reward', crack: null });
    expect(breakBlockFrame(1, false)).toEqual({ base: 'normal', crack: 'crack1' });
    expect(breakBlockFrame(1, true)).toEqual({ base: 'reward', crack: 'crack1' });
    expect(breakBlockFrame(2, false)).toEqual({ base: 'normal', crack: 'crack2' });
    expect(breakBlockFrame(3, true)).toEqual({ base: 'reward', crack: 'crack2' });
  });

  it('fits the 80px image to the block\'s own span, top row on the block\'s top, without moving the block', () => {
    expect(ENVIRONMENT_GEOMETRY.block).toEqual({ width: 80, height: BREAK_BLOCK_RULES.thickness });
    const slot = breakBlockWidth();
    expect(slot).toBeCloseTo(78.8, 6);
    // Both the fractional rows (x = 28 + i * 78.8) and the whole-pixel rows AREA 2 generates (79/78).
    const rows = [[0, 1, 2, 3, 4].map(i => [28 + i * slot, slot]), [[28, 79], [107, 79], [186, 78], [264, 79], [343, 79]]];
    for (const row of rows) {
      let previousEnd = WORLD.wall;
      for (const [x, w] of row) {
        const at = breakBlockSlices(x, w)!;
        expect(at.x).toBe(Math.round(x));
        expect(at.x + at.width).toBe(Math.round(x + w));
        expect(at.x).toBe(previousEnd); // neighbours meet, no gap and no overlap
        previousEnd = at.x + at.width;
        expect([78, 79]).toContain(at.width);
        expect(at.left).toEqual({ x: at.x, srcX: 0, width: BLOCK_DROP_FROM });
        expect(at.right.x).toBe(at.x + BLOCK_DROP_FROM);
        expect(at.right.srcX + at.right.width).toBe(80);
        expect(at.left.width + at.right.width).toBe(at.width);
        // Only columns 71 and/or 72 are left out -- the inside of a flat run, never an end.
        expect(at.right.srcX).toBeGreaterThanOrEqual(72);
        expect(at.right.srcX).toBeLessThanOrEqual(73);
      }
      expect(previousEnd).toBe(WORLD.width - WORLD.wall);
    }
    // A span the crop cannot fit is drawn procedurally instead.
    expect(breakBlockSlices(28, 81)).toBeNull();
    expect(breakBlockSlices(28, 70)).toBeNull();
  });

  it('leaves the BREAK BLOCK rules as they were', () => {
    expect(BREAK_BLOCK_RULES).toEqual({ count: 5, thickness: 16, durability: 2, rewardChance: 0.25, rewardCoins: 1, rewardDenomination: 'large' });
    for (const plan of AREAS.find(a => a.id === 2)!.plans ?? []) expect([plan.breakBlockRows, plan.breakBlockDurability]).toEqual([2, 2]);
  });

  it('breaks on the same rounds and pays the same REWARD', () => {
    const game = new GameModel(false, seeded(11));
    game.jumpToStage(2, 1);
    const block = { id: 99001, x: 28, y: game.player.y + 400, width: 79, breakBlock: { hits: 0, durability: 2, slot: 0, reward: true } };
    game.platforms.push(block as never);
    const hit = (game as unknown as { hitBreakBlock: (b: unknown) => void }).hitBreakBlock.bind(game);
    hit(block);
    expect([block.breakBlock.hits, (block as { state?: string }).state]).toEqual([1, undefined]);
    expect(breakBlockFrame(block.breakBlock.hits, block.breakBlock.reward)).toEqual({ base: 'reward', crack: 'crack1' });
    const coins = game.coins.coins.length;
    hit(block);
    expect((block as { state?: string }).state).toBe('broken');
    expect(game.coins.coins.length).toBe(coins + BREAK_BLOCK_RULES.rewardCoins);
  });
});

describe('AREA 2 spike floor', () => {
  const W = 0.5;
  it('shows the socket alone while safe or cooling down, warning 1-4 across the one warning, and the active tooth', () => {
    expect(spikeFrame({ state: 'safe', timer: 0, warning: W }, SPIKE_PLATFORM_RULES.warning)).toBeNull();
    expect(spikeFrame({ state: 'cooldown', timer: 1, warning: W }, SPIKE_PLATFORM_RULES.warning)).toBeNull();
    expect(spikeFrame({ state: 'active', timer: 0.5, warning: W }, SPIKE_PLATFORM_RULES.warning)).toBe('active');
    const at = (left: number) => spikeFrame({ state: 'warning', timer: W * left, warning: W }, SPIKE_PLATFORM_RULES.warning);
    expect([1, 0.9, 0.76].map(at)).toEqual(['warning1', 'warning1', 'warning1']);
    expect([0.75, 0.6, 0.51].map(at)).toEqual(['warning2', 'warning2', 'warning2']);
    expect([0.5, 0.3, 0.26].map(at)).toEqual(['warning3', 'warning3', 'warning3']);
    expect([0.25, 0.1, 0, -0.01].map(at)).toEqual(['warning4', 'warning4', 'warning4', 'warning4']);
    // A ledge's own (longer) warning is split the same way; the global one only where it has none.
    expect(spikeFrame({ state: 'warning', timer: 0.45, warning: 0.9 }, SPIKE_PLATFORM_RULES.warning)).toBe('warning3');
    expect(spikeFrame({ state: 'warning', timer: SPIKE_PLATFORM_RULES.warning * 0.8 }, SPIKE_PLATFORM_RULES.warning)).toBe('warning1');
  });

  it('puts a socket and tooth at every procedural tooth position, the tooth standing exactly the collision reach', () => {
    const { toothHeight, socketWidth } = ENVIRONMENT_GEOMETRY.spike;
    for (const width of [148, 160, 178, 190, 198, 231, 254]) {
      const x = 28, y = 500, at = spikeLayout(x, y, width);
      const procedural: number[] = [];
      for (let i = x + 9; i < x + width - 8; i += 17) procedural.push(i);
      expect(at.teeth.map(t => t.tooth.x + 1)).toEqual(procedural);
      for (const t of at.teeth) {
        // The tooth's centre column (4) is the procedural tooth's centre, i + 3.5, to the pixel.
        expect(t.tooth.x + 4).toBe(t.tooth.x + 1 + 3);
        // The socket's recess (columns 4-12) is under the tooth (columns 0-8).
        expect(t.socket.x + 4).toBe(t.tooth.x);
        expect(t.socket.x + t.socket.cropX).toBeGreaterThanOrEqual(x);
        expect(t.socket.x + t.socket.cropX + t.socket.width).toBeLessThanOrEqual(x + width);
        expect(t.socket.width).toBeLessThanOrEqual(socketWidth);
      }
      // Bottom row (17) at y + 1: the visible 16px (rows 2-17) reach y - 14 = y + 2 - reach.
      expect(at.toothTop + toothHeight - 1).toBe(y + 1);
      expect(at.toothTop + 2).toBe(y + 2 - SPIKE_PLATFORM_RULES.reach);
      expect(at.socketTop).toBe(y);
      expect(at.edges).toEqual([{ x, flip: false }, { x: x + width - 6, flip: true }]);
    }
  });

  it('leaves the spike rules and AREA 2\'s warnings as they were', () => {
    expect(SPIKE_PLATFORM_RULES).toEqual({ warning: 0.65, active: 0.9, cooldown: 1.2, damage: 1, reach: 16 });
    for (const plan of AREAS.find(a => a.id === 2)!.plans ?? []) expect([plan.spikePlatformChance, plan.spikeWarning]).toEqual([1, 0.5]);
  });

  it('arms on landing, warns for the ledge\'s own warning, bites for 0.9s and costs exactly one heart', () => {
    const game = new GameModel(false, seeded(7));
    game.jumpToStage(2, 1);
    const ledge = game.platforms.filter(f => f.spikePlatform && f.id >= 0).sort((a, b) => a.y - b.y)[0];
    const start = game.platforms.find(f => f.id === -2)!;
    game.player.x = ledge.x + 20 > start.x - 10 && ledge.x + 20 < start.x + start.width + 10 ? ledge.x + ledge.width - 20 : ledge.x + 20;
    const s = ledge.spikePlatform!;
    const seen: [string, number][] = [];
    let t = 0, prev = s.state as string;
    const hp = game.hp;
    for (let i = 0; i < 120 * 6 && seen.length < 3; i++) {
      game.step(1 / 120, 0, false); t += 1 / 120;
      if (s.state !== prev) { seen.push([s.state, t]); prev = s.state; }
      if (s.state === 'warning' && seen.length === 1) expect(game.player.y + 15).toBe(ledge.y);
    }
    expect(seen.map(([state]) => state)).toEqual(['warning', 'active', 'cooldown']);
    expect(seen[1][1] - seen[0][1]).toBeCloseTo(s.warning!, 1);
    expect(s.warning!).toBeGreaterThanOrEqual(0.5);
    expect(seen[2][1] - seen[1][1]).toBeCloseTo(SPIKE_PLATFORM_RULES.active, 1);
    expect(hp - game.hp).toBe(SPIKE_PLATFORM_RULES.damage);
  });
});

describe('AREA 2 belt', () => {
  it('runs the tile along the center under the sockets, the arrow at the end it carries toward', () => {
    const { cap } = ENVIRONMENT_GEOMETRY.platform;
    const right = beltLayout(100, 500, 180, 1, 0, 70, false), left = beltLayout(100, 500, 180, -1, 0, 70, false);
    expect(right.belt).toEqual({ x: 100 + cap, y: 508, width: 180 - cap * 2, tileX: 0 });
    expect(right.arrow).toEqual({ x: 100 + 180 - cap - 10, y: 506 });
    expect(right.flip).toBe(false);
    expect(left.arrow).toEqual({ x: 100 + cap, y: 506 });
    expect(left.flip).toBe(true);
    // Below the sockets (y .. y+7), inside the ledge's 16px body.
    expect(right.belt.y).toBe(500 + ENVIRONMENT_GEOMETRY.spike.socketHeight);
    expect(right.belt.y + ENVIRONMENT_GEOMETRY.belt.tileHeight - 1).toBeLessThan(500 + PLATFORM_THICKNESS);
  });

  it('scrolls at the belt\'s own speed, in whole pixels, and holds still under reduced motion', () => {
    const at = (elapsed: number, speed = 70, still = false) => beltLayout(0, 0, 180, 1, elapsed, speed, still).belt.tileX;
    expect(at(0)).toBe(0);
    expect(at(1 / 70)).toBe(-1);
    expect(at(5 / 70)).toBe(-5);
    expect(at(14 / 70)).toBe(0);
    expect(at(3 / 110 + 1e-9, 110)).toBe(-3);
    expect(at(10, 70, true)).toBe(0);
    for (const e of [0.13, 1.7, 9.99]) expect(Number.isInteger(at(e))).toBe(true);
  });

  it('carries the player the same way, at the same speed, as before', () => {
    expect(CONVEYOR_RULES).toEqual({ edgeStop: 10, halfBody: 9, dropGap: 26, react: 0.15 });
    expect(AREAS.find(a => a.id === 2)!.plans!.map(p => [p.conveyorChance, p.conveyorSpeed])).toEqual([[0.45, 70], [0.7, 90], [0.95, 110]]);
    expect(conveyorDirFor(40, 150, 28, 422)).toBe(-1);
    expect(conveyorDirFor(260, 150, 28, 422)).toBe(1);
    for (const dir of [1, -1] as const) {
      const game = new GameModel(false, seeded(3));
      game.jumpToStage(2, 3);
      const f = game.platforms.find(q => q.id === -2)!;
      Object.assign(f, { conveyor: { dir, speed: 110 } });
      game.player.x = f.x + f.width / 2;
      for (let i = 0; i < 240 && game.player.grounded !== f.id; i++) game.step(1 / 120, 0, false);
      expect(game.player.grounded).toBe(f.id);
      const x0 = game.player.x;
      for (let i = 0; i < 24; i++) game.step(1 / 120, 0, false);
      expect(game.player.x - x0).toBeCloseTo(dir * 110 * 0.2, 6);
      // ...and the arrow and the scroll point the same way.
      const look = beltLayout(f.x, f.y, f.width, dir, 0, 110, false);
      expect(look.flip).toBe(dir === -1);
      expect(look.arrow.x > f.x + f.width / 2).toBe(dir === 1);
    }
  });
});

describe('AREA 2 gameplay', () => {
  it('generates exactly what it did before the images: every ledge, width, BREAK BLOCK, spike warning and belt', () => {
    const area = AREAS.find(a => a.id === 2)!;
    const rows: string[] = [];
    for (let n = 1; n <= 3; n++) for (let s = 1; s <= 8; s++) {
      const g = new StageGenerator(seeded(s * 31 + n), { plan: area.plans?.[n - 1], enemyPool: area.enemyPool, sectionLength: area.sectionLength });
      for (let c = 0; c < 12; c++) for (const p of g.chunk(c).platforms) {
        rows.push(`${p.x}|${p.y}|${p.width}|${p.breakBlock ? p.breakBlock.durability + ':' + p.breakBlock.reward : ''}|${p.spikePlatform ? p.spikePlatform.warning : ''}|${p.conveyor ? p.conveyor.dir + ':' + p.conveyor.speed : ''}`);
      }
    }
    let h = 0x811c9dc5;
    for (const ch of rows.join(';')) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    // Golden values from e344c3c (src/systems and src/data are untouched by this change).
    expect({ rows: rows.length, hash: h.toString(16) }).toEqual({ rows: 1256, hash: 'b9c19da6' });
    expect(rows.filter(r => r.split('|')[5]).length).toBe(125);
    expect(rows.filter(r => r.split('|')[3]).length).toBe(240);
    expect(rows.filter(r => r.split('|')[4]).length).toBe(893);
    expect(generationSignature(2)).toBe('55c8866f29f3d7527c3b513d');
  });

  it('plays exactly as it did before the images', () => {
    expect(replaySignature(entered(g => g.jumpToStage(2, 1)))).toBe('95ebcdc29407d78501ec1a47');
    expect(replaySignature(entered(g => g.jumpToStage(2, 3)))).toBe('e5f4c74110599c23f5ad5b62');
  });
});

/** Width, height, bit depth, colour type and SHA-256 of an image under src/assets/environment/<dir>. */
const envPng = (dir: string, file: string) => {
  const b = readFileSync(new URL(`../src/assets/environment/${dir}/${file}`, import.meta.url));
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  return { size: [u32(16), u32(20)], depth: b[24], colour: b[25], sha256: createHash('sha256').update(b).digest('hex') };
};

describe('AREA 3 images', () => {
  it('ships the eight reviewed images byte for byte, from src/assets, and nothing from output/', () => {
    // Sizes and hashes of output/environment-art-area3-v1 as delivered (review/validation.json: 8 RGBA).
    const expected: Record<string, [number, number, string]> = {
      'area3-platform-left-cap.png': [8, 24, 'd7b0908be2b3836730519e5f53400575481087acd93eaf446058d11076f447a7'],
      'area3-platform-center.png': [16, 24, 'a407121f9ee1c3002628bcf0b3921df3ece94334f8484815d338f9a2dc88e519'],
      'area3-platform-right-cap.png': [8, 24, '666134634b91161c9f3f083099189d3fdb810ec7dfd37f280df4a1f7b09b8704'],
      'area3-wall-fill.png': [32, 96, '8c6a0ea5f540740a089b0990a3fe1cc550a076f7c845bdc7c8da927dc16e5bf6'],
      'area3-wall-inner-edge.png': [4, 96, '12031c930a5583c9ba550a899fd46db142ead018f204dd4fca8f2e23ad0653a2'],
      'area3-reef-up.png': [9, 12, '28517acce47da965a29e7641241fe648c1fb4690a533b48fcbea9d6bf34095f7'],
      'area3-reef-side.png': [18, 9, '0514e4b45e5a2ba808a63361b74a99d105261595dd24df03ec921fc7f1fa3332'],
      'area3-reef-base.png': [4, 9, 'ee874ef45f3e46e3648915fd99c284f94533a0bba2ba5c07363199b177ec6899'],
    };
    for (const [file, [w, h, sha256]] of Object.entries(expected)) {
      expect({ file, ...envPng('area3', file) }).toEqual({ file, size: [w, h], depth: 8, colour: 6, sha256 });
    }
    const loads = environmentLoads(3, ENVIRONMENT_ART[3]!);
    expect(loads.map(([key]) => key)).toEqual([
      'env-3-platform-left', 'env-3-platform-center', 'env-3-platform-right', 'env-3-wall-fill', 'env-3-wall-edge',
      'env-3-reef-up', 'env-3-reef-side', 'env-3-reef-base',
    ]);
    for (const [, url] of loads) expect(url).not.toMatch(/(^|\/)(output|dist)\//);
    const files = loads.map(([, url]) => url.match(/area3-[a-z0-9-]+\.png/)![0]).sort();
    expect(files).toEqual(Object.keys(expected).sort());
  });

  it('maps each image to its part: a 3-slice, a wall, a reef -- no BREAK BLOCK, spike floor or belt', () => {
    const set = ENVIRONMENT_ART[3]!;
    expect(set.platform!.left).toMatch(/area3\/area3-platform-left-cap\.png/);
    expect(set.platform!.center).toMatch(/area3\/area3-platform-center\.png/);
    expect(set.platform!.right).toMatch(/area3\/area3-platform-right-cap\.png/);
    expect(set.wall.fill).toMatch(/area3\/area3-wall-fill\.png/);
    expect(set.wall.edge).toMatch(/area3\/area3-wall-inner-edge\.png/);
    expect(set.reef!.up).toMatch(/area3\/area3-reef-up\.png/);
    expect(set.reef!.side).toMatch(/area3\/area3-reef-side\.png/);
    expect(set.reef!.base).toMatch(/area3\/area3-reef-base\.png/);
    expect([set.breakBlock, set.spike, set.conveyor]).toEqual([undefined, undefined, undefined]);
    // Only AREA 3 carries a reef.
    for (const area of [1, 2, 4, 0, 'staging'] as const) expect(reefArt(area, () => true)).toBeNull();
    expect(reefArt(3, () => true)).toEqual({ up: 'env-3-reef-up', side: 'env-3-reef-side', base: 'env-3-reef-base' });
  });
});

describe('AREA 3 ledges and walls', () => {
  const { cap, surfaceRow } = ENVIRONMENT_GEOMETRY.platform;

  it('uses the same 3-slice at every AREA 3 width: row 3 on the landing line, caps fixed, the center repeated', () => {
    const widths = new Set<number>();
    for (const plan of AREAS.find(a => a.id === 3)!.plans ?? []) { const [lo, hi] = plan.platformWidth; for (let w = lo; w <= hi; w++) widths.add(w); }
    for (let w = 124; w <= 158; w++) widths.add(w); // the paired shelves' own ledgeWidth
    expect(Math.min(...widths)).toBe(124);
    expect(Math.max(...widths)).toBe(214);
    for (const w of widths) for (const x of [28, 155, WORLD.width - WORLD.wall - w]) for (const y of [465, 821, 4667]) {
      const at = platformSlices(x, y, w);
      expect(at.top + surfaceRow).toBe(y);
      expect(at.left).toEqual({ x, width: cap });
      expect(at.right).toEqual({ x: x + w - cap, width: cap });
      expect(at.center).toEqual({ x: x + cap, width: w - cap * 2 });
    }
    expect(envPng('area3', 'area3-platform-center.png').size).toEqual([ENVIRONMENT_GEOMETRY.platform.center, ENVIRONMENT_GEOMETRY.platform.height]);
  });

  it('draws every ledge an AREA 3 SECTION generates from the 3-slice, except its BREAK BLOCKs', () => {
    const parts = environmentParts(3, () => true);
    for (const n of [1, 2, 3] as const) {
      const game = new GameModel(false, seeded(5 + n));
      game.jumpToStage(3, n);
      const rows = game.platforms.filter(f => f.id >= 0);
      expect(rows.length).toBeGreaterThan(0);
      for (const f of rows) expect(usesPlatformArt(f, parts)).toBe(!f.breakBlock);
    }
  });

  it('keeps the wall boundaries at x 28 and x 422 with AREA 1\'s wall geometry', () => {
    const { fillWidth, fillHeight, edgeWidth, shaftLeft, shaftRight } = ENVIRONMENT_GEOMETRY.wall;
    expect(envPng('area3', 'area3-wall-fill.png').size).toEqual([fillWidth, fillHeight]);
    expect(envPng('area3', 'area3-wall-inner-edge.png').size).toEqual([edgeWidth, fillHeight]);
    expect([shaftLeft, shaftRight]).toEqual([28, 422]);
    expect([WORLD.wall, WORLD.width - WORLD.wall]).toEqual([28, 422]);
  });

  it('falls back to procedural, part by part, when an AREA 3 image is missing', () => {
    const keys = environmentKeys(3);
    const without = (...missing: string[]) => { const { keys: _k, ...rest } = environmentParts(3, key => !missing.includes(key)); return rest; };
    expect(without(keys.fill)).toMatchObject({ wall: false, platform: true });
    expect(without(keys.center)).toMatchObject({ wall: true, platform: false });
    for (const key of Object.values(keys.reef)) {
      expect(reefArt(3, k => k !== key)).toBeNull();
      expect(without(key)).toMatchObject({ wall: true, platform: true });
    }
    expect(reefArt(3, () => false)).toBeNull();
    const { keys: _k, ...none } = environmentParts(3, () => false);
    expect(none).toEqual({ wall: false, platform: false, breakBlock: false, spike: false, conveyor: false });
  });
});

describe('AREA 3 reef', () => {
  const { upWidth, upHeight, sideWidth, sideHeight, baseWidth } = ENVIRONMENT_GEOMETRY.reef;
  type Box = Parameters<typeof reefLayout>[0];
  const floor = (box: Box) => { const at = reefLayout(box)!; if (at.kind !== 'floor') throw new Error('not a floor patch'); return at; };
  const wall = (box: Box) => { const at = reefLayout(box)!; if (at.kind !== 'wall') throw new Error('not a wall patch'); return at; };
  const inside = (box: { x: number; y: number; width: number; height: number }, x: number, y: number, w: number, h: number) =>
    x >= box.x && y >= box.y && x + w <= box.x + box.width && y + h <= box.y + box.height;

  it('ships images at the sizes the layout is drawn to', () => {
    expect(envPng('area3', 'area3-reef-up.png').size).toEqual([upWidth, upHeight]);
    expect(envPng('area3', 'area3-reef-side.png').size).toEqual([sideWidth, sideHeight]);
    expect(envPng('area3', 'area3-reef-base.png').size).toEqual([baseWidth, sideHeight]);
  });

  it('puts one shelf-end barb at every procedural tooth, 9px apart, the last cropped into the box', () => {
    for (let width = REEF_RULES.ledgeMin; width <= REEF_RULES.ledgeMax; width++) {
      const box = { x: 131, y: 600 - REEF_RULES.ledgeHeight, width, height: REEF_RULES.ledgeHeight, face: 'up' as const };
      const at = floor(box);
      const procedural: number[] = [];
      for (let i = 0; i + 5 <= width; i += 9) procedural.push(box.x + i);
      expect(at.barbs.map(b => b.x)).toEqual(procedural);
      for (const b of at.barbs) {
        // Bottom row on the box's bottom row (the shelf's landing line is the row under it).
        expect(b.y + upHeight).toBe(600);
        expect(b.width).toBeLessThanOrEqual(upWidth);
        expect(inside(box, b.x, b.y, b.width, upHeight)).toBe(true);
      }
      // The images cover the box from its left edge to its right edge.
      const last = at.barbs[at.barbs.length - 1];
      expect(last.x + last.width).toBe(Math.min(box.x + width, last.x + upWidth));
    }
    // The two ends of the range: 26px is three barbs (the last 8px), 44px is five (the last 8px).
    expect(floor({ x: 0, y: 0, width: 26, height: 12, face: 'up' }).barbs.map(b => b.width)).toEqual([9, 9, 8]);
    expect(floor({ x: 0, y: 0, width: 44, height: 12, face: 'up' }).barbs.map(b => b.width)).toEqual([9, 9, 9, 9, 8]);
  });

  it('runs a wall patch\'s base down its whole height against the wall and a barb every other 9px, never past the box', () => {
    for (let height = REEF_RULES.wallMin; height <= REEF_RULES.wallMax; height++) {
      for (const [x, face] of [[WORLD.wall, 'right'], [WORLD.width - WORLD.wall - REEF_RULES.wallReach, 'left']] as const) {
        const box = { x, y: 1000, width: REEF_RULES.wallReach, height, face };
        const at = wall(box);
        expect(at.flip).toBe(face === 'left');
        // The base against the wall: x 28-32 on the left, x 418-422 on the right.
        expect(at.base).toEqual({ x: face === 'right' ? 28 : 418, y: 1000, height });
        expect(at.barbs.map(b => b.y - 1000)).toEqual(Array.from({ length: Math.floor((height - 5) / 18) + 1 }, (_, k) => k * 18));
        for (const b of at.barbs) {
          expect(b.x).toBe(face === 'right' ? 28 : 404);
          expect(b.height).toBeLessThanOrEqual(sideHeight);
          expect(inside(box, b.x, b.y, sideWidth, b.height)).toBe(true);
        }
        expect(inside(box, at.base.x, at.base.y, baseWidth, at.base.height)).toBe(true);
      }
    }
    // A height that is not a multiple of 9 crops the last barb: 61px -> barbs at 0, 18, 36 and 54, the last 7px tall.
    expect(wall({ x: 28, y: 0, width: 18, height: 61, face: 'right' }).barbs.map(b => b.height)).toEqual([9, 9, 9, 7]);
  });

  it('draws a reef from images only for reefBarb with AREA 3\'s reef loaded; anything else keeps its procedural drawing', () => {
    const body = sceneSource.slice(sceneSource.indexOf('private hazard(h: Hazard'));
    expect(body.indexOf("if (h.kind === 'reefBarb' && reef && this.reefArt(reef, h, y, offsetX)) return;"))
      .toBeLessThan(body.indexOf('if (type.palette) { this.spikes('));
    expect(sceneSource).toContain('const reef = reefArt(artArea, key => this.textures.exists(key));');
    // A box the images cannot fit is left to the procedural reef.
    expect(reefLayout({ x: 28, y: 0, width: 17, height: 80, face: 'right' })).toBeNull();
    expect(reefLayout({ x: 28, y: 0, width: 30, height: 11, face: 'up' })).toBeNull();
  });

  it('leaves the reef\'s placement, collision and damage as they were', () => {
    expect(REEF_RULES).toEqual({ corridor: 34, wallReach: 18, wallMin: 60, wallMax: 130, ledgeMin: 26, ledgeMax: 44, ledgeHeight: 12, ledgeClear: 62, airGap: 30, airSpan: 36 });
    expect(HAZARD_TYPES.reefBarb).toEqual({ id: 'reefBarb', lethal: false, damageCause: 'spike', heat: 0, heatRadius: 0, silhouette: 'teeth', palette: { body: 0xf08a5d, tip: 0xffd2b8, base: 0x5a2a1c }, damage: 1 });
    expect(AREAS.find(a => a.id === 3)!.plans!.map(p => p.reef)).toEqual([
      { wall: 0.2, ledgeEnd: 0.25, air: 0.3 }, { wall: 0.35, ledgeEnd: 0.4, air: 0.5 }, { wall: 0.5, ledgeEnd: 0.55, air: 0.7 },
    ]);
    // One touch is one heart, through the ordinary damage path.
    const game = new GameModel(false, seeded(21));
    game.jumpToStage(3, 1);
    const p = game.player;
    game.hazards.push(spawnHazard('reefBarb', 99002, Math.round(p.x - 20), Math.round(p.y - 6), 40, 12, 0, 'up'));
    p.invincible = 0;
    const hp = game.hp;
    game.step(1 / 120, 0, false);
    expect(hp - game.hp).toBe(1);
    expect(game.state).not.toBe('over');
  });
});

describe('AREA 3 gameplay', () => {
  it('keeps the water, the oxygen and the air exactly as they were', () => {
    const area = AREAS.find(a => a.id === 3)!;
    expect(area.water).toEqual({ gravity: 0.9, responsiveness: 11 });
    expect(area.gimmicks).toEqual({ oxygen: true });
    expect(area.plans!.map(p => [p.containerChance, p.maxOxygenGap, p.bubbleOffside])).toEqual([[0.44, 30, 0.35], [0.29, 40, 0.62], [0.21, 50, 0.85]]);
    expect([AIR_CONTAINER_RULES.size, AIR_CONTAINER_RULES.bubblesMin, AIR_CONTAINER_RULES.bubblesMax, AIR_CONTAINER_RULES.recovery, AIR_CONTAINER_RULES.bubbleLife]).toEqual([34, 3, 5, 5, 4.2]);
    const game = new GameModel();
    game.jumpToStage(3, 1);
    expect([game.oxygen.enabled, game.oxygen.max]).toEqual([true, 12]);
  });

  it('generates and plays exactly as it did before the images (golden values from d5883a6)', () => {
    expect(generationSignature(3)).toBe('d748a265cf1731ae185f93cb');
    expect(replaySignature(entered(g => g.jumpToStage(3, 1)))).toBe('d813e6aa01f3d20ed9e034a4');
    expect(replaySignature(entered(g => g.jumpToStage(3, 2)))).toBe('27a110a2880f9aaaafae8a08');
    expect(replaySignature(entered(g => g.jumpToStage(3, 3)))).toBe('b1c14c441b457f2baa84336f');
  });
});

describe('outside AREA 3', () => {
  it('AREA 4 carries no reef, the BOSS arena draws its walls only, and both play as they did', () => {
    expect(reefArt(4, () => true)).toBeNull();
    const { keys: _b, ...arena } = environmentParts('boss', () => true);
    expect(arena).toEqual({ wall: true, platform: false, breakBlock: false, spike: false, conveyor: false });
    expect(reefArt('boss', () => true)).toBeNull();
    expect(limboArt('boss', () => true)).toBeNull();
    // No set at all for 0 any more than before: the arena is 'boss', never a fallback id.
    const { keys: _k, ...parts } = environmentParts(0, () => true);
    expect(parts).toEqual({ wall: false, platform: false, breakBlock: false, spike: false, conveyor: false });
    expect(reefArt(0, () => true)).toBeNull();
    expect(limboArt(0, () => true)).toBeNull();
    expect(generationSignature(4)).toBe('f65a6d908865b5097e3fd899');
    expect(replaySignature(entered(g => g.jumpToBoss()))).toBe('8e287a848cb425a8029c5f2c');
  });

  it('leaves the staging room\'s set exactly as it was at d5883a6: same five images, same keys, no reef', () => {
    const expected: Record<string, string> = {
      'area4-platform-center.png': '3988b35d328cf465927b3d4068bb98fc42926301cdf03d9ad478d031c3c3ff06',
      'area4-platform-left-cap.png': '5886a4066858d1fa673795373a081d28ca75610a0c8056c6476ef4f0e01dacac',
      'area4-platform-right-cap.png': 'd3098a669ba87df7427343179e20eb016f83f327f8e2edd54dc1ddbd791381b7',
      'boss-wall-fill.png': '99ec3a2da6d2d34d8b59d9f87698a9a9280699fcaf6aec9add65ebc808a043b9',
      'boss-wall-inner-edge.png': 'f02366e53fabdc98393c91b33ebae0318d29f3eef8db406828860b5151ff375f',
    };
    for (const [file, sha256] of Object.entries(expected)) expect(envPng('staging', file).sha256).toBe(sha256);
    const set = ENVIRONMENT_ART.staging!;
    expect(Object.keys(set).sort()).toEqual(['platform', 'wall']);
    expect(environmentLoads('staging', set).map(([key]) => key)).toEqual([
      'env-staging-platform-left', 'env-staging-platform-center', 'env-staging-platform-right', 'env-staging-wall-fill', 'env-staging-wall-edge',
    ]);
    const { keys: _k, ...parts } = environmentParts('staging', () => true);
    expect(parts).toEqual({ wall: true, platform: true, breakBlock: false, spike: false, conveyor: false });
    expect(reefArt('staging', () => true)).toBeNull();
    expect(sceneSource).toContain('const artArea = environmentArtArea(m);');
  });
});

describe('AREA 4 images', () => {
  it('ships the six reviewed images byte for byte, from src/assets/environment/area4, and nothing from output/', () => {
    // Sizes and hashes of output/environment-art-area4-v1 as delivered (review/validation.json: 6 RGBA).
    const expected: Record<string, [number, number, string]> = {
      'area4-platform-left-cap.png': [8, 24, '5886a4066858d1fa673795373a081d28ca75610a0c8056c6476ef4f0e01dacac'],
      'area4-platform-center.png': [16, 24, '3988b35d328cf465927b3d4068bb98fc42926301cdf03d9ad478d031c3c3ff06'],
      'area4-platform-right-cap.png': [8, 24, 'd3098a669ba87df7427343179e20eb016f83f327f8e2edd54dc1ddbd791381b7'],
      'area4-wall-fill.png': [32, 96, '24ce2eeeee2580e830d348b8edf1f1de9dbaf029284700b2dc87e1da5bf0c49f'],
      'area4-wall-inner-edge.png': [4, 96, 'fe118732d403974fdda4d183116a02dbcc62a8db152be70a5eb55d89a6ed53c6'],
      'area4-limbo-hazard.png': [13, 24, '64483a3d5eaa9ccc26f47475e579a40a318c0a050e48d0be565e996b80d46e01'],
    };
    for (const [file, [w, h, sha256]] of Object.entries(expected)) {
      expect({ file, ...envPng('area4', file) }).toEqual({ file, size: [w, h], depth: 8, colour: 6, sha256 });
    }
    const loads = environmentLoads(4, ENVIRONMENT_ART[4]!);
    expect(loads.map(([key]) => key)).toEqual([
      'env-4-platform-left', 'env-4-platform-center', 'env-4-platform-right', 'env-4-wall-fill', 'env-4-wall-edge', 'env-4-limbo-barb',
    ]);
    for (const [, url] of loads) expect(url).not.toMatch(/(^|\/)(output|dist)\//);
  });

  it('maps each image to its part, and carries no BREAK BLOCK, spike, belt, reef or crumble', () => {
    const set = ENVIRONMENT_ART[4]!;
    expect(Object.keys(set).sort()).toEqual(['limbo', 'platform', 'wall']);
    expect(set.platform!.left).toMatch(/area4-platform-left-cap\.png/);
    expect(set.platform!.center).toMatch(/area4-platform-center\.png/);
    expect(set.platform!.right).toMatch(/area4-platform-right-cap\.png/);
    expect(set.wall.fill).toMatch(/area4-wall-fill\.png/);
    expect(set.wall.edge).toMatch(/area4-wall-inner-edge\.png/);
    expect(set.limbo!.barb).toMatch(/area4-limbo-hazard\.png/);
    // AREA 4's own copies: the staging room's files are separate, so the room cannot follow AREA 4.
    for (const url of [set.platform!.left, set.platform!.center, set.platform!.right]) expect(url).toMatch(/environment\/area4\//);
    expect(environmentKeys(4).left).not.toBe(environmentKeys('staging').left);
  });
});

describe('AREA 4 ledges and walls', () => {
  // WAS: "lays the 3-slice on every AREA 4 ledge", counting more than 50 of them. AREA 4 COLLAPSING
  // PLATFORMS RESTORED makes every route ledge a collapsing one, and a collapsing ledge keeps the
  // procedural drawing whose look carries its state (usesPlatformArt). So the image now goes only on
  // the AREA's stable surfaces -- the opening slab, cave and chamber floors -- with the same geometry,
  // and never on a ledge that is going to give way.
  it('lays the 3-slice on AREA 4\'s stable surfaces with row 3 on the landing line, and never on a collapsing ledge', () => {
    const { cap, surfaceRow } = ENVIRONMENT_GEOMETRY.platform;
    let ledges = 0, collapsing = 0;
    for (const section of [1, 2, 3] as const) for (let seed = 1; seed <= 6; seed++) {
      const g = new GameModel(false, seeded(seed * 53)); g.jumpToStage(4, section);
      for (const p of g.platforms.filter(f => f.breakable)) {
        for (const state of ['stable', 'cracking', 'critical'] as const) expect(usesPlatformArt({ ...p, state })).toBe(false);
        collapsing++;
      }
      for (const p of g.platforms.filter(f => usesPlatformArt(f))) {
        expect(p.breakable).not.toBe(true);
        const before = { x: p.x, y: p.y, width: p.width };
        const at = platformSlices(p.x, p.y, p.width);
        expect(at.top + surfaceRow).toBe(p.y);
        expect(at.left.x).toBe(p.x);
        expect(at.right.x + cap).toBe(p.x + p.width);
        expect(at.center.width).toBe(p.width - cap * 2);
        expect({ x: p.x, y: p.y, width: p.width }).toEqual(before);
        ledges++;
      }
      // A LIMBO row is never a 3-slice ledge: it keeps its own drawing.
      for (const p of g.platforms.filter(f => f.limboHazard)) expect(usesPlatformArt(p)).toBe(false);
    }
    expect(ledges).toBeGreaterThan(0);
    expect(collapsing).toBeGreaterThan(50);
  });

  it('keeps the shaft boundaries at x 28 and x 422, with the same tile offsets as every other AREA', () => {
    expect(ENVIRONMENT_GEOMETRY.wall).toEqual({ fillWidth: 32, fillHeight: 96, edgeWidth: 4, shaftLeft: 28, shaftRight: 422 });
    expect(WORLD.wall).toBe(28);
    expect(WORLD.width - WORLD.wall).toBe(422);
    const { keys: _k, ...parts } = environmentParts(4, () => true);
    expect(parts).toEqual({ wall: true, platform: true, breakBlock: false, spike: false, conveyor: false });
  });
});

describe('AREA 4 LIMBO barbs', () => {
  it('reuses the procedural 13px pitch: whole barbs centred, the leftover split between both ends, the seam on y+1', () => {
    expect(ENVIRONMENT_GEOMETRY.limbo).toEqual({ width: 13, height: 24, pitch: 13, seamRow: 14 });
    // 64 = 4 x 13 + 12: six px of a barb at each end.
    expect(limboLayout(100, 500, 64)).toEqual({ top: 487, pieces: [
      { x: 100, srcX: 7, width: 6 },
      { x: 106, srcX: 0, width: 13 }, { x: 119, srcX: 0, width: 13 }, { x: 132, srcX: 0, width: 13 }, { x: 145, srcX: 0, width: 13 },
      { x: 158, srcX: 0, width: 6 },
    ] });
    // 77 = 5 x 13 + 12; 79 = 6 x 13 + 1 (the odd px goes to the right end); 78 = 6 x 13 exactly.
    expect(limboLayout(100, 500, 77)!.pieces.filter(q => q.width < 13)).toEqual([{ x: 100, srcX: 7, width: 6 }, { x: 171, srcX: 0, width: 6 }]);
    expect(limboLayout(100, 500, 79)!.pieces.filter(q => q.width < 13)).toEqual([{ x: 178, srcX: 0, width: 1 }]);
    expect(limboLayout(100, 500, 78)!.pieces.every(q => q.width === 13)).toBe(true);
    // The whole barbs sit exactly where the centred layout put them: only the ends are new.
    expect(limboLayout(100, 500, 90)!.pieces.filter(q => q.width === 13).map(q => q.x)).toEqual([106, 119, 132, 145, 158, 171]);
    expect(limboLayout(100, 500, 13)).toEqual({ top: 487, pieces: [{ x: 100, srcX: 0, width: 13 }] });
    expect(limboLayout(100, 500, 12)).toBeNull();
  });

  /** The image's opaque columns, read off the PNG on disk (8-bit RGBA, no interlace). */
  const limboOpaqueColumns = async () => {
    const { inflateSync } = await import(/* @vite-ignore */ 'node:' + 'zlib') as { inflateSync: (b: Uint8Array) => Uint8Array };
    const b = readFileSync(new URL('../src/assets/environment/area4/area4-limbo-hazard.png', import.meta.url));
    const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
    const w = u32(16), h = u32(20), parts: Uint8Array[] = [];
    for (let o = 8; o < b.length;) { const len = u32(o), type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]); if (type === 'IDAT') parts.push(b.slice(o + 8, o + 8 + len)); o += 12 + len; }
    const joined = new Uint8Array(parts.reduce((n, q) => n + q.length, 0)); let at = 0; for (const q of parts) { joined.set(q, at); at += q.length; }
    const raw = inflateSync(joined), stride = w * 4, px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)];
      for (let i = 0; i < stride; i++) {
        const v = raw[y * (stride + 1) + 1 + i], a = i >= 4 ? px[y * stride + i - 4] : 0, u = y ? px[(y - 1) * stride + i] : 0, c = i >= 4 && y ? px[(y - 1) * stride + i - 4] : 0;
        const pa = Math.abs(u - c), pb = Math.abs(a - c), pc = Math.abs(a + u - 2 * c);
        px[y * stride + i] = (v + [0, a, u, (a + u) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? u : c][f]) & 255;
      }
    }
    return Array.from({ length: w }, (_, x) => Array.from({ length: h }, (_, y) => px[(y * w + x) * 4 + 3]).some(v => v > 0));
  };

  it('covers every generated AREA 4 LIMBO row edge to edge, inside its collision rectangle and never past it', async () => {
    const { width: w, height } = ENVIRONMENT_GEOMETRY.limbo;
    const opaque = await limboOpaqueColumns();
    // Column 0 of the barb is empty in the image itself; every other column has opaque pixels.
    expect(opaque.map(Boolean)).toEqual([false, true, true, true, true, true, true, true, true, true, true, true, true]);
    const widths = new Set<number>();
    let rows = 0;
    for (const section of [1, 2, 3] as const) for (let seed = 1; seed <= 40; seed++) {
      const gen = new StageGenerator(seeded(seed * 211), { plan: AREAS[3].plans![section - 1], enemyPool: AREAS[3].enemyPool, sectionLength: AREAS[3].sectionLength, breakable: false });
      for (let chunk = 0; chunk < 4; chunk++) for (const p of gen.chunk(chunk).platforms.filter(f => f.limboHazard)) {
        widths.add(p.width);
        const at = limboLayout(p.x, p.y, p.width)!;
        expect(at).not.toBeNull();
        // GameModel.tickLimboHazards: x..x+width across, y - reach .. y + 12 down (normal gravity).
        expect(at.top).toBeGreaterThanOrEqual(p.y - LIMBO_HAZARD_RULES.reach);
        expect(at.top + height).toBeLessThanOrEqual(p.y + 12);
        // The pieces tile x..x+width exactly: no gap between them, nothing outside the row.
        let cursor = p.x;
        for (const q of at.pieces) {
          expect(q.x).toBe(cursor);
          expect(q.srcX).toBeGreaterThanOrEqual(0);
          expect(q.srcX + q.width).toBeLessThanOrEqual(w);
          cursor += q.width;
        }
        expect(cursor).toBe(p.x + p.width);
        // The two ends are cut evenly (an odd leftover px goes right), and the whole barbs keep the pitch.
        const ends = at.pieces.filter(q => q.width < w);
        if (ends.length === 2) expect(ends[1].width - ends[0].width).toBeGreaterThanOrEqual(0);
        if (ends.length === 2) expect(ends[1].width - ends[0].width).toBeLessThanOrEqual(1);
        expect(at.pieces.filter(q => q.width === w).length).toBe(Math.floor(p.width / w));
        // What is actually painted: the first and last opaque columns sit at the row's ends, within the
        // image's own empty column 0 (at most 1px), and never past them.
        const painted: number[] = [];
        for (const q of at.pieces) for (let i = 0; i < q.width; i++) if (opaque[q.srcX + i]) painted.push(q.x + i);
        expect(Math.min(...painted)).toBeGreaterThanOrEqual(p.x);
        expect(Math.max(...painted)).toBeLessThanOrEqual(p.x + p.width - 1);
        expect(Math.min(...painted) - p.x).toBeLessThanOrEqual(1);
        expect(p.x + p.width - 1 - Math.max(...painted)).toBeLessThanOrEqual(1);
        rows++;
      }
    }
    expect(rows).toBeGreaterThan(100);
    // Every width AREA 4 lays for a barb row (64-90) came through the check above.
    expect(Math.min(...widths)).toBe(64);
    expect(Math.max(...widths)).toBe(90);
  });

  it('covers every width 13-120 the same way, so no unseen width can leave a blank end', async () => {
    const opaque = await limboOpaqueColumns();
    for (let width = 13; width <= 120; width++) {
      const at = limboLayout(0, 0, width)!;
      const painted: number[] = [];
      for (const q of at.pieces) for (let i = 0; i < q.width; i++) if (opaque[q.srcX + i]) painted.push(q.x + i);
      expect({ width, left: Math.min(...painted) <= 1, right: width - 1 - Math.max(...painted) <= 1, inside: Math.min(...painted) >= 0 && Math.max(...painted) <= width - 1 })
        .toEqual({ width, left: true, right: true, inside: true });
    }
  });

  it('leaves LIMBO\'s rules as they were: one heart, 14px reach', () => {
    expect(LIMBO_HAZARD_RULES).toEqual({ damage: 1, reach: 14 });
    const g = new GameModel(false, seeded(41)); g.jumpToStage(4, 1);
    g.platforms = [{ id: 900, x: WORLD.wall, y: g.player.y + 90, width: WORLD.width - WORLD.wall * 2, limboHazard: true }];
    g.enemies = []; g.hazards = []; g.doodads = []; g.pickups = [];
    g.player.x = 225; g.player.vy = 260; g.player.grounded = -1; g.player.invincible = 0;
    const hp = g.hp;
    for (let i = 0; i < 400 && g.hp === hp; i++) g.step(1 / 120, 0, false);
    expect(g.hp).toBe(hp - 1);
  });

  it('falls back to the procedural barbs, part by part, when an image is missing', () => {
    expect(limboArt(4, () => true)).toBe('env-4-limbo-barb');
    expect(limboArt(4, key => key !== 'env-4-limbo-barb')).toBeNull();
    // Ledges and walls do not depend on the barb, nor the barb on them.
    const { keys: _k, ...parts } = environmentParts(4, key => key !== 'env-4-limbo-barb');
    expect(parts).toEqual({ wall: true, platform: true, breakBlock: false, spike: false, conveyor: false });
    expect(limboArt(4, key => !key.includes('platform'))).toBe('env-4-limbo-barb');
    // No other set carries the barb: AREA 1-3, the staging room and the arena stay as they were.
    for (const area of [1, 2, 3, 'staging', 0] as const) expect(limboArt(area, () => true)).toBeNull();
    expect(sceneSource).toContain('if (f.limboHazard) { if (!(limbo && this.limboArt(limbo, f.x, y, f.width, g.x))) this.limboHazard(f.x, y, f.width); continue; }');
  });
});

describe('AREA 4 gameplay', () => {
  // WAS: the replays were 9e7c6b738ad3bd3514afd646 / 516e68ff1ffddfa04e93b75f / 2ebcb752cd22d061e39e6733.
  // AREA 4 COLLAPSING PLATFORMS RESTORED moves the replays (every ledge now gives way) and nothing the
  // generator lays: the generation signature is the one the images were drawn over.
  it('generates exactly as it did before the images, and plays with its ledges collapsing', () => {
    expect(generationSignature(4)).toBe('f65a6d908865b5097e3fd899');
    expect(replaySignature(entered(g => g.jumpToStage(4, 1)))).toBe('12ae06596103a9f573adafac');
    expect(replaySignature(entered(g => g.jumpToStage(4, 2)))).toBe('bd849065d64cde6f6bc84e0a');
    expect(replaySignature(entered(g => g.jumpToStage(4, 3)))).toBe('c96993f02a496755e320f4a5');
  });

  it('leaves AREA 3 generating and playing as it did', () => {
    expect(generationSignature(3)).toBe('d748a265cf1731ae185f93cb');
    expect(replaySignature(entered(g => g.jumpToStage(3, 1)))).toBe('d813e6aa01f3d20ed9e034a4');
    expect(replaySignature(entered(g => g.jumpToStage(3, 2)))).toBe('27a110a2880f9aaaafae8a08');
    expect(replaySignature(entered(g => g.jumpToStage(3, 3)))).toBe('b1c14c441b457f2baa84336f');
  });

  it('never hands THE ABYSS AREA 4\'s set: the staging room keeps its own, the arena its own', () => {
    // During the staging room the run's AREA is still 4 -- which is exactly why the scene asks for
    // 'staging' whenever the state is 'boss', before it ever reads the AREA.
    const g = new GameModel(); g.jumpToBoss();
    expect(g.state).toBe('boss');
    expect(g.stage.config.id).toBe(4);
    expect(sceneSource).toContain('const artArea = environmentArtArea(m);');
    expect(Object.keys(ENVIRONMENT_ART.staging!).sort()).toEqual(['platform', 'wall']);
    expect(limboArt('staging', () => true)).toBeNull();
    expect(replaySignature(entered(game => game.jumpToBoss()))).toBe('8e287a848cb425a8029c5f2c');
  });
});

/**
 * BOSS ARENA WALL ART: the fight's shaft walls from the BOSS wall images, its own copies under their own
 * keys, so the walls run on unbroken from the staging room into the fight. Walls only: the arena lays
 * no ledge, the seal is the staging room's and stays procedural, and nothing of the fight is touched.
 */
describe('the BOSS arena set', () => {
  // output/environment-art-boss-v1/wall/ as delivered; the staging room's copies are the same bytes.
  const BOSS_WALL: Record<string, [number, number, string]> = {
    'boss-wall-fill.png': [32, 96, '99ec3a2da6d2d34d8b59d9f87698a9a9280699fcaf6aec9add65ebc808a043b9'],
    'boss-wall-inner-edge.png': [4, 96, 'f02366e53fabdc98393c91b33ebae0318d29f3eef8db406828860b5151ff375f'],
  };

  it('ships the two BOSS wall images byte for byte, as its own copies, and nothing else', async () => {
    const { readdirSync } = await import(/* @vite-ignore */ 'node:' + 'fs') as { readdirSync: (path: URL) => string[] };
    expect(readdirSync(new URL('../src/assets/environment/boss/', import.meta.url)).sort()).toEqual(Object.keys(BOSS_WALL).sort());
    for (const [file, [w, h, sha256]] of Object.entries(BOSS_WALL)) {
      expect({ file, ...envPng('boss', file) }).toEqual({ file, size: [w, h], depth: 8, colour: 6, sha256 });
      expect(envPng('staging', file).sha256).toBe(sha256);
    }
  });

  it('carries the walls only, from src/assets/environment/boss, under its own keys', () => {
    const set = ENVIRONMENT_ART.boss!;
    expect(Object.keys(set)).toEqual(['wall']);
    expect(set.platform).toBeUndefined();
    expect(set.wall.fill).toMatch(/environment\/boss\/boss-wall-fill\.png/);
    expect(set.wall.edge).toMatch(/environment\/boss\/boss-wall-inner-edge\.png/);
    for (const url of Object.values(set.wall)) expect(url).not.toMatch(/(^|\/)(output|dist)\/|environment\/(staging|area4)\//);
    expect(environmentLoads('boss', set)).toEqual([['env-boss-wall-fill', set.wall.fill], ['env-boss-wall-edge', set.wall.edge]]);
    expect(environmentKeys('boss').fill).not.toBe(environmentKeys('staging').fill);
    expect(environmentKeys('boss').fill).not.toBe(environmentKeys(4).fill);
  });

  it('draws no ledge in the arena: its parts are the walls alone, and they fall back when an image is missing', () => {
    const { keys: _k, ...parts } = environmentParts('boss', () => true);
    expect(parts).toEqual({ wall: true, platform: false, breakBlock: false, spike: false, conveyor: false });
    const { keys: _m, ...missing } = environmentParts('boss', key => key !== 'env-boss-wall-edge');
    expect(missing).toEqual({ wall: false, platform: false, breakBlock: false, spike: false, conveyor: false });
    // Not even the staging room's or AREA 4's ledge images make it in.
    const { keys: _s, ...ledges } = environmentParts('boss', key => key.includes('platform'));
    expect(ledges.platform).toBe(false);
  });

  it('is chosen for the fight only: AREA -> AREA, staging and the reversal -> staging, fight -> boss', () => {
    const area4 = new GameModel(false, seeded(10));
    area4.jumpToStage(4, 2);
    expect(environmentArtArea(area4)).toBe(4);
    const game = new GameModel(false, seeded(10));
    game.jumpToBoss();
    expect(game.abyssStage).toBe('staging');
    expect(environmentArtArea(game)).toBe('staging');
    intoTheAbyss(game);
    expect(game.abyssStage).toBe('inverting');
    expect(environmentArtArea(game)).toBe('staging');
    tick(game, ABYSS.hold + ABYSS.reverse + 0.1);
    expect(game.abyssStage).toBe('fight');
    expect(environmentArtArea(game)).toBe('boss');
    // The arena lays no ledge for the set to draw.
    expect(game.platforms).toEqual([]);
    // A death or the clear is read off the AREA exactly as before this change.
    expect(environmentArtArea({ state: 'over', inBossArena: true, stage: { config: { id: 4 } } })).toBe(4);
    expect(environmentArtArea({ state: 'clear', inBossArena: false, stage: { config: { id: 4 } } })).toBe(4);
    expect(sceneSource).toContain('const artArea = environmentArtArea(m);');
  });

  it('lays the walls on the boundary they always had: x 0-28 and 422-450, the right wall mirrored', () => {
    expect(ENVIRONMENT_GEOMETRY.wall).toEqual({ fillWidth: 32, fillHeight: 96, edgeWidth: 4, shaftLeft: 28, shaftRight: 422 });
    expect(WORLD.wall).toBe(28);
    expect(WORLD.width - WORLD.wall).toBe(422);
    // The fill's inner column against the shaft, for the arena's own reach (no side cave: cameraX 0).
    expect(wallTileX(28 + 40)).toBe(28);
    expect(sceneSource).toContain('rightFill.setTexture(art.fill).setPosition(offsetX + shaftRight, 0).setSize(width, 800).setTilePosition(tx, ty).setFlipX(true);');
    expect(sceneSource).toContain('rightEdge.setTexture(art.edge).setPosition(offsetX + shaftRight, 0).setSize(edgeWidth, 800).setTilePosition(0, ty).setFlipX(true);');
  });

  it('keeps the seal the staging room\'s and procedural, and leaves the fight playing exactly as it did', () => {
    expect(ENVIRONMENT_ART.staging!.breakBlock).toBeUndefined();
    expect(ENVIRONMENT_ART.boss!.breakBlock).toBeUndefined();
    const game = new GameModel();
    game.jumpToBoss();
    expect(game.platforms.filter(r => r.breakBlock).map(r => [r.x, r.y, r.width, r.breakBlock!.durability]))
      .toEqual([[28, 1560, 79, 2], [107, 1560, 79, 2], [186, 1560, 78, 2], [264, 1560, 79, 2], [343, 1560, 79, 2]]);
    expect(replaySignature(entered(g => g.jumpToBoss()))).toBe('8e287a848cb425a8029c5f2c');
    expect(replaySignature(entered(g => { g.jumpToNimushi(); }))).toBe('26ccd33dc5a34ba1e36f989c');
  });
});
