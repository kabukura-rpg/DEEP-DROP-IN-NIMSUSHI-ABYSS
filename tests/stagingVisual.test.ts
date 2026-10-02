import { describe, expect, it } from 'vitest';
import sceneSource from '../src/scenes/GameScene.ts?raw';
import { ENVIRONMENT_ART, chamberDrawn, environmentLoads, environmentParts, usesPlatformArt } from '../src/render/environmentArt';
import { GameModel } from '../src/systems/GameModel';
// Read as files (no Node types here).
const fs = await import(/* @vite-ignore */ 'node:' + 'fs') as { readFileSync: (path: URL) => Uint8Array; readdirSync: (path: URL) => string[] };
const dir = new URL('../src/assets/environment/staging/', import.meta.url);
const pngSize = (file: string) => {
  const b = fs.readFileSync(new URL(file, dir));
  const u32 = (at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
  return [u32(16), u32(20)];
};
const STEP = 1 / 120;

/**
 * PRE-BOSS STAGING VISUAL CLEANUP: THE ABYSS's staging room drawn from images, and its TOMATO room
 * without a visible chamber -- while every rule of the room stays exactly where it was.
 */
describe('the staging room set', () => {
  it('draws the walls from the BOSS set and the ledges from AREA 4 -- five images from src/assets', () => {
    expect(fs.readdirSync(dir).sort()).toEqual([
      'area4-platform-center.png', 'area4-platform-left-cap.png', 'area4-platform-right-cap.png', 'boss-wall-fill.png', 'boss-wall-inner-edge.png',
    ]);
    expect(pngSize('area4-platform-left-cap.png')).toEqual([8, 24]);
    expect(pngSize('area4-platform-center.png')).toEqual([16, 24]);
    expect(pngSize('area4-platform-right-cap.png')).toEqual([8, 24]);
    expect(pngSize('boss-wall-fill.png')).toEqual([32, 96]);
    expect(pngSize('boss-wall-inner-edge.png')).toEqual([4, 96]);
    const set = ENVIRONMENT_ART.staging!;
    expect(set.wall.fill).toMatch(/staging\/boss-wall-fill\.png/);
    expect(set.wall.edge).toMatch(/staging\/boss-wall-inner-edge\.png/);
    expect(set.platform.left).toMatch(/staging\/area4-platform-left-cap\.png/);
    expect(set.platform.center).toMatch(/staging\/area4-platform-center\.png/);
    expect(set.platform.right).toMatch(/staging\/area4-platform-right-cap\.png/);
    for (const url of [...Object.values(set.wall), ...Object.values(set.platform)]) expect(url).not.toMatch(/(^|\/)(output|dist)\//);
    expect(environmentLoads('staging', set).map(([key]) => key)).toEqual([
      'env-staging-platform-left', 'env-staging-platform-center', 'env-staging-platform-right', 'env-staging-wall-fill', 'env-staging-wall-edge',
    ]);
  });

  it('carries ledges and walls only: the seal and the arena keep their procedural drawing', () => {
    const { keys: _k, ...parts } = environmentParts('staging', () => true);
    expect(parts).toEqual({ wall: true, platform: true, breakBlock: false, spike: false, conveyor: false });
    // The seal is a BREAK BLOCK row, never a 3-slice ledge.
    const game = new GameModel();
    game.jumpToBoss();
    const seal = game.platforms.filter(r => r.breakBlock);
    expect(seal.length).toBeGreaterThan(0);
    for (const row of seal) expect(usesPlatformArt(row, parts)).toBe(false);
    // Every other ledge in the room, the chamber floor included, takes the image 3-slice.
    for (const row of game.platforms.filter(r => !r.breakBlock)) expect(usesPlatformArt(row, parts)).toBe(true);
  });

  it('is used from the room opening until the arena does, and never in the descent', () => {
    expect(sceneSource).toContain("const artArea = m.state !== 'boss' ? m.stage.config.id : m.inBossArena ? 0 : 'staging';");
    expect(ENVIRONMENT_ART[0]).toBeUndefined();
  });
});

describe('the TOMATO room without a visible chamber', () => {
  it('draws no chamber at all in THE ABYSS, and every chamber in the descent as before', () => {
    expect(chamberDrawn('boss')).toBe(false);
    for (const state of ['playing', 'upgrade', 'shop', 'clear', 'over']) expect(chamberDrawn(state)).toBe(true);
    // Skipped before the recess, the frame (lintel 0x3c7a84) and the light are drawn.
    const loop = sceneSource.slice(sceneSource.indexOf('for (const zone of m.safeZones) {'));
    const skip = loop.indexOf('if (!chamberDrawn(m.state)) continue;');
    expect(skip).toBeGreaterThan(-1);
    for (const drawn of ['0x070d11', '0x15303a', '0x3c7a84', '0x9fe8f5']) expect(loop.indexOf(drawn), drawn).toBeGreaterThan(skip);
  });

  it('keeps the room exactly where it was: chamber, floor, ledges, TOMATO and seal', () => {
    const game = new GameModel();
    game.jumpToBoss();
    expect(game.abyssStage).toBe('staging');
    expect(game.safeZones.map(z => ({ x: z.x, y: z.y, width: z.width, height: z.height, stopsTime: z.stopsTime })))
      .toEqual([{ x: 272, y: 940, width: 150, height: 116, stopsTime: false }]);
    expect(game.platforms.filter(r => !r.breakBlock).map(r => [r.x, r.y, r.width]))
      .toEqual([[155, 250, 140], [50, 486, 148], [252, 722, 148], [272, 1056, 150], [48, 1086, 120]]);
    expect(game.platforms.filter(r => r.breakBlock).map(r => [r.x, r.y, r.width]))
      .toEqual([[28, 1560, 79], [107, 1560, 79], [186, 1560, 78], [264, 1560, 79], [343, 1560, 79]]);
    expect(game.pickups.filter(p => p.kind === 'tomato').map(p => [p.x, p.y])).toEqual([[347, 1030]]);
  });

  it('still holds the player under the invisible ceiling, however hard they are thrown upward', () => {
    const game = new GameModel();
    game.jumpToBoss();
    const zone = game.safeZones[0], p = game.player;
    p.x = zone.x + zone.width / 2 - 30; p.y = zone.y + zone.height - 20; p.vy = 0;
    for (let i = 0; i < 30; i++) game.step(STEP, 0, false);
    expect(p.y).toBeGreaterThan(zone.y);
    let top = Infinity;
    for (let shot = 0; shot < 6; shot++) {
      p.vy = -1400; p.grounded = -1;
      for (let i = 0; i < 40; i++) { game.step(STEP, 0, false); top = Math.min(top, p.y); }
    }
    expect(top).toBeGreaterThanOrEqual(zone.y);
    expect(p.x).toBeGreaterThanOrEqual(zone.x);
  });
});
