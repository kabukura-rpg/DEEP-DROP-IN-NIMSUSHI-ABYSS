import { afterEach, describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { StageGenerator } from '../src/systems/StageGenerator';
import { areaConfig, AREAS } from '../src/data/areas';
import { setTerrainMode } from '../src/data/rhythm';
import { setSideRoomMode } from '../src/data/safeZone';
import {
  CAVE_RULES, MODULE_CAVE_LEFT, MODULE_CAVE_RIGHT, caveRewardSpot, inCaveInterior, insideCave,
  moduleCaveShape, placeCave, type SideCave,
} from '../src/data/sideCave';
import { JUMP, WORLD, BALANCE } from '../src/data/balance';
import { pickupType } from '../src/data/pickups';

/**
 * SIDE CAVES. Every run is seeded, and both global switches are restored afterwards.
 *
 * The rules these protect are the two that make a cave safe to build: a cave hangs OUTSIDE the
 * shaft, so its floor may not have holes; and a platform here is one-way, so height may only come
 * from ledges that are jumped onto and stepped off, never from steps cut into the ground.
 */
const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
afterEach(() => { setSideRoomMode('v1'); setTerrainMode('grammar-v2'); });
const SEEDS = Array.from({ length: 24 }, (_, i) => 41 + i * 97);
const STEP = 1 / 120;
const gunOf = (g: GameModel) => g.gun.module.id;

/** Every cave an AREA 1 SECTION generates. */
function cavesOf(section: number, seed: number) {
  const area = areaConfig(1);
  const g = new StageGenerator(seeded(seed), {
    plan: area.plans?.[section - 1], enemyPool: area.enemyPool, sectionLength: area.sectionLength,
  });
  const limit = WORLD.startY + area.sectionLength * WORLD.pixelsPerMeter;
  const chunks = Math.ceil((limit - WORLD.startY) / WORLD.chunkHeight) + 2;
  const caves: SideCave[] = [];
  for (let c = 0; c < chunks; c++) caves.push(...g.chunk(c).caves.filter(v => v.bounds.y <= limit));
  return caves;
}

describe('SIDE CAVE shell', () => {
  it('has one continuous floor, because outside the shaft a gap is a hole in the world', () => {
    for (const side of [-1, 1] as const) {
      const cave = placeCave(1, side, side === -1 ? WORLD.wall : WORLD.width - WORLD.wall, 1000, moduleCaveShape(side), null);
      // The ground slab is the first floor and spans the whole cave; the rest are ledges on it.
      const ground = cave.floors[0];
      expect(ground.x).toBeLessThanOrEqual(cave.bounds.x + 1);
      expect(ground.x + ground.width).toBeGreaterThanOrEqual(cave.bounds.x + cave.bounds.width - 1);
      // Nothing may sit below the ground: there is nothing under a cave to land on.
      for (const slab of cave.floors) expect(slab.y).toBeLessThanOrEqual(ground.y);
    }
  });

  it('never asks for a climb the ground jump cannot make', () => {
    // The jump's apex, from the physics rather than from the comment beside it.
    const apex = JUMP.impulse ** 2 / (2 * BALANCE.gravity);
    expect(apex).toBeGreaterThan(30);
    for (const shape of [MODULE_CAVE_LEFT, MODULE_CAVE_RIGHT]) {
      for (const ledge of shape.ledges) {
        expect(ledge.rise).toBeGreaterThan(0);
        expect(ledge.rise).toBeLessThan(apex);
      }
    }
  });

  it('keeps the reward deep inside, out of reach of anyone standing in the mouth', () => {
    const reach = pickupType('gunModule').radius + 12;
    for (const side of [-1, 1] as const) {
      const mouthX = side === -1 ? WORLD.wall : WORLD.width - WORLD.wall;
      const shape = moduleCaveShape(side);
      const cave = placeCave(1, side, mouthX, 1000, shape, { kind: 'gunModule' });
      const spot = caveRewardSpot(cave, shape);
      expect(Math.abs(spot.x - mouthX)).toBeGreaterThan(shape.throat.depth + reach);
      // ...and on a ledge, not on the cave floor.
      expect(spot.y).toBeLessThan(cave.opening.y + cave.opening.height);
    }
  });

  it('is a small play space, not another level', () => {
    for (const side of [-1, 1] as const) {
      const cave = placeCave(1, side, side === -1 ? WORLD.wall : WORLD.width - WORLD.wall, 1000, moduleCaveShape(side), null);
      expect(cave.bounds.width).toBeLessThan(WORLD.width);
      expect(cave.bounds.height).toBeLessThan(WORLD.height / 2);
      // Big enough to walk about in: several player widths of chamber past the throat.
      expect(cave.interior.width).toBeGreaterThan(200);
    }
  });

  it('separates the mouth from the cave, so looking in is not going in', () => {
    for (const side of [-1, 1] as const) {
      const mouthX = side === -1 ? WORLD.wall : WORLD.width - WORLD.wall;
      const cave = placeCave(1, side, mouthX, 1000, moduleCaveShape(side), null);
      const sill = 1000 - 8;
      // Standing on the sill, in the shaft: inside the cave's span, but not in the cave.
      const atMouth = side === -1 ? mouthX + 30 : mouthX - 30;
      expect(insideCave(cave, atMouth, sill)).toBe(true);
      expect(inCaveInterior(cave, atMouth, sill)).toBe(false);
      // A player width past the mouth: in.
      const past = side === -1 ? mouthX - 40 : mouthX + 40;
      expect(inCaveInterior(cave, past, sill)).toBe(true);
    }
  });
});

describe('SIDE CAVE in a run', () => {
  it('is where AREA 1 puts a gun module, and only AREA 1', () => {
    let caves = 0, withModule = 0;
    for (const seed of SEEDS) for (const section of [1, 2, 3]) {
      for (const cave of cavesOf(section, seed)) { caves++; if (cave.content?.kind === 'gunModule') withModule++; }
    }
    expect(caves).toBeGreaterThan(20);
    expect(withModule).toBe(caves);
    // Nowhere else. The other AREAs have no side-room pilot, so they have no caves.
    for (const area of AREAS.filter(a => a.id !== 1)) {
      const g = new StageGenerator(seeded(7), {
        plan: area.plans?.[0], enemyPool: area.enemyPool, water: area.water,
        oxygen: area.gimmicks?.oxygen, sectionLength: area.sectionLength,
      });
      for (let c = 0; c < 8; c++) expect(g.chunk(c).caves).toEqual([]);
    }
  });

  it('is cut into a wall, reaching outside the shaft', () => {
    for (const seed of SEEDS) for (const section of [1, 2, 3]) {
      for (const cave of cavesOf(section, seed)) {
        if (cave.side === -1) expect(cave.bounds.x).toBeLessThan(0);
        else expect(cave.bounds.x + cave.bounds.width).toBeGreaterThan(WORLD.width);
      }
    }
  });

  it('lets the player walk in, take the module deep inside, and walk back out', () => {
    for (const side of [-1, 1] as const) {
      let played = false;
      for (let seed = 1; seed <= 400 && !played; seed++) {
        const g = new GameModel(false, seeded(seed * 29));
        let cave: SideCave | undefined;
        for (let i = 0; i < 80 && !cave; i++) {
          g.player.y = WORLD.startY + (8 + i * 5) * WORLD.pixelsPerMeter;
          g.player.invincible = 999;
          g.step(STEP, 0, false);
          cave = g.caves.find(c => c.side === side && c.bounds.y > g.player.y - 400);
        }
        if (!cave) continue;
        played = true;
        const shape = moduleCaveShape(side);
        const ledge = shape.ledges[shape.rewardLedge];
        const mouthX = side === -1 ? cave.opening.x + cave.opening.width : cave.opening.x;
        const dir = (side === -1 ? -1 : 1) as -1 | 1;
        const before = gunOf(g);

        // Stand on the sill, where the fall would put them, and walk in.
        g.player.x = side === -1 ? WORLD.wall + 26 : WORLD.width - WORLD.wall - 26;
        g.player.y = cave.opening.y + cave.opening.height - 16;
        g.player.vy = 0; g.player.grounded = -1;
        g.step(STEP, 0, false);
        expect(g.timeFrozen, `${side}: the mouth must not stop the world`).toBe(false);

        const nearEdge = mouthX + dir * ledge.from;
        let frozeInside = false;
        for (let i = 0; i < 1200 && gunOf(g) === before; i++) {
          g.player.invincible = 999;
          const onFloor = g.player.grounded !== -1 && g.player.y > cave.opening.y + cave.opening.height - 30;
          const past = dir === -1 ? g.player.x <= nearEdge + 16 : g.player.x >= nearEdge - 16;
          g.step(STEP, dir, onFloor && past);
          if (inCaveInterior(cave, g.player.x, g.player.y)) frozeInside ||= g.timeFrozen;
        }
        expect(frozeInside, `${side}: TIMEVOID must run inside`).toBe(true);
        expect(gunOf(g), `${side}: the module must be reachable`).not.toBe(before);

        // ...and back out to the shaft, walking, with no jump needed.
        let left = false;
        for (let i = 0; i < 900 && !left; i++) {
          g.player.invincible = 999;
          g.step(STEP, -dir as -1 | 1, false);
          left = !insideCave(cave, g.player.x, g.player.y);
        }
        expect(left, `${side}: the way out must be a walk`).toBe(true);
        expect(g.timeFrozen).toBe(false);
      }
      expect(played, `${side}: no cave was found to play`).toBe(true);
    }
  });

  it('slides the camera rather than snapping it, and brings it home', () => {
    const g = new GameModel(false, seeded(29));
    let cave: SideCave | undefined;
    for (let i = 0; i < 80 && !cave; i++) {
      g.player.y = WORLD.startY + (8 + i * 5) * WORLD.pixelsPerMeter;
      g.player.invincible = 999; g.step(STEP, 0, false);
      cave = g.caves[0];
    }
    expect(cave).toBeDefined();
    // Drop the player straight into the cave: the worst case for a camera, all at once.
    g.player.x = cave!.bounds.x + 40;
    g.player.y = cave!.opening.y + cave!.opening.height - 16;
    g.player.vy = 0;
    let worst = 0, last = g.cameraX;
    for (let i = 0; i < 300; i++) { g.player.invincible = 999; g.step(STEP, 0, false); worst = Math.max(worst, Math.abs(g.cameraX - last)); last = g.cameraX; }
    expect(worst).toBeLessThanOrEqual(CAVE_RULES.cameraMaxSpeed * STEP + 0.01);
    expect(Math.abs(g.cameraX)).toBeGreaterThan(100);
    // Back in the shaft, the view returns to where it always sits.
    g.player.x = 225; g.player.y = cave!.opening.y - 400;
    for (let i = 0; i < 600; i++) { g.player.invincible = 999; g.step(STEP, 0, false); }
    expect(g.cameraX).toBe(0);
  });
});
