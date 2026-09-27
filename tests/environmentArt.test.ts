import { describe, expect, it } from 'vitest';
import { ENVIRONMENT_ART, ENVIRONMENT_GEOMETRY, platformSlices, usesPlatformArt, wallTileX, wallTileY } from '../src/render/environmentArt';
import { PLATFORM_THICKNESS } from '../src/data/structures';
import { WORLD } from '../src/data/balance';
import { AREAS } from '../src/data/areas';
import { GameModel } from '../src/systems/GameModel';

// PNG headers read straight off disk: Vitest serves image imports as URLs, not bytes. (No Node types here.)
const { readFileSync } = await import(/* @vite-ignore */ 'node:' + 'fs') as { readFileSync: (path: URL) => Uint8Array };
const pngSize = (file: string) => {
  const b = readFileSync(new URL(`../src/assets/environment/area1/${file}`, import.meta.url));
  const u32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  return [u32(16), u32(20)];
};

/** ENVIRONMENT ART: AREA 1's ledges and walls from images, on the geometry the model already has. */
describe('the image sets', () => {
  it('lists AREA 1 only -- AREA 2-4 and the boss keep the procedural look', () => {
    expect(Object.keys(ENVIRONMENT_ART)).toEqual(['1']);
  });

  it('ships the five AREA 1 images at the audited sizes, from src/assets', () => {
    expect(pngSize('platform-left-cap.png')).toEqual([8, 24]);
    expect(pngSize('platform-center.png')).toEqual([16, 24]);
    expect(pngSize('platform-right-cap.png')).toEqual([8, 24]);
    expect(pngSize('wall-fill.png')).toEqual([32, 96]);
    expect(pngSize('wall-inner-edge.png')).toEqual([4, 96]);
    for (const url of Object.values(ENVIRONMENT_ART[1]!.platform).concat(Object.values(ENVIRONMENT_ART[1]!.wall))) {
      expect(url).not.toMatch(/(^|\/)(output|dist)\//);
    }
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
