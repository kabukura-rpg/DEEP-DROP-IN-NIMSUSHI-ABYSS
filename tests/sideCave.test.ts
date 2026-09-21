import { afterEach, describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { StageGenerator } from '../src/systems/StageGenerator';
import { areaConfig, AREAS } from '../src/data/areas';
import { setTerrainMode } from '../src/data/rhythm';
import { setSideRoomMode } from '../src/data/safeZone';
import {
  CAVE_RULES, MODULE_CAVE_LEFT, MODULE_CAVE_RIGHT, caveRewardSpot, inCaveInterior, insideCave,
  moduleCaveShape, caveShape, placeCave, type SideCave,
} from '../src/data/sideCave';
import { JUMP, WORLD, BALANCE } from '../src/data/balance';
import { pickupType } from '../src/data/pickups';
import { coinVeinTotal } from '../src/data/safeZone';

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
  it('is where AREA 1 puts all three of its side contents, and only AREA 1', () => {
    const kinds = new Map<string, number>();
    let caves = 0;
    for (const seed of SEEDS) for (const section of [1, 2, 3]) {
      for (const cave of cavesOf(section, seed)) {
        caves++;
        const kind = cave.content?.kind ?? 'none';
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      }
    }
    expect(caves).toBeGreaterThan(20);
    // Every kind arrives in a cave: the rectangular chamber is gone from this AREA entirely.
    expect([...kinds.keys()].sort()).toEqual(['coinVein', 'gunModule', 'shop']);
    // Nowhere else. The other AREAs have no side-room pilot, so they have no caves.
    for (const area of AREAS.filter(a => a.id !== 1)) {
      const g = new StageGenerator(seeded(7), {
        plan: area.plans?.[0], enemyPool: area.enemyPool, water: area.water,
        oxygen: area.gimmicks?.oxygen, sectionLength: area.sectionLength,
      });
      for (let c = 0; c < 8; c++) expect(g.chunk(c).caves).toEqual([]);
    }
  });

  it('gives the three archetypes different shapes, not one cave three times', () => {
    const shapes = (['gunModule', 'shop', 'coinVein'] as const).map(k => caveShape(k, -1));
    const depth = (c: typeof shapes[number]) => c.throat.depth + c.chamber.depth;
    const [module_, shop, coin] = shapes;
    // A coin cave is the quick one; a module cave is the deep one; a shop is the tall flat one.
    expect(depth(coin)).toBeLessThan(depth(module_) * 0.75);
    expect(depth(coin)).toBeLessThan(depth(shop) * 0.75);
    expect(shop.chamber.height).toBeGreaterThan(module_.chamber.height);
    expect(shop.ledges.length).toBe(0);
    expect(module_.ledges.length).toBeGreaterThan(coin.ledges.length);
    // ...and no two fixtures share an id, on either wall.
    const ids = (['gunModule', 'shop', 'coinVein'] as const).flatMap(k => [caveShape(k, -1).id, caveShape(k, 1).id]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every archetype content well clear of the way in', () => {
    for (const kind of ['gunModule', 'shop', 'coinVein'] as const) {
      for (const side of [-1, 1] as const) {
        const mouthX = side === -1 ? WORLD.wall : WORLD.width - WORLD.wall;
        const shape = caveShape(kind, side);
        const cave = placeCave(1, side, mouthX, 1000, shape, { kind });
        const spot = caveRewardSpot(cave, shape);
        // Past the throat, and past a player's own width beyond it: entering a cave and reaching
        // its content are two separate things for all three.
        expect(Math.abs(spot.x - mouthX), `${kind} ${side}`).toBeGreaterThan(shape.throat.depth + 40);
      }
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
          cave = g.caves.find(c => c.side === side && c.content?.kind === 'gunModule' && c.bounds.y > g.player.y - 400);
        }
        if (!cave) continue;
        played = true;
        const shape = moduleCaveShape(side);
        const ledge = shape.ledges[shape.rewardLedge!];
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

  /** A run parked with a COIN cave loaded, on the wanted wall. */
  const findCoinCave = (side: -1 | 1) => findCave('coinVein', side);
  /** A run parked with a cave of the wanted archetype loaded, plus that cave. */
  function findCave(kind: 'gunModule' | 'shop' | 'coinVein', side: -1 | 1) {
    for (let seed = 1; seed <= 600; seed++) {
      const g = new GameModel(false, seeded(seed * 29));
      for (let i = 0; i < 80; i++) {
        g.player.y = WORLD.startY + (8 + i * 5) * WORLD.pixelsPerMeter;
        g.player.invincible = 999;
        g.step(STEP, 0, false);
        const cave = g.caves.find(c => c.side === side && c.content?.kind === kind && c.bounds.y > g.player.y - 400);
        if (cave) return { g, cave };
      }
    }
    return null;
  }
  /** Stand on the sill, then walk inward, jumping whenever the floor is underfoot. */
  function walkIn(g: GameModel, cave: SideCave, frames: number, stop: () => boolean) {
    const dir = (cave.side === -1 ? -1 : 1) as -1 | 1;
    const floorTop = cave.opening.y + cave.opening.height;
    g.player.x = cave.side === -1 ? WORLD.wall + 26 : WORLD.width - WORLD.wall - 26;
    g.player.y = floorTop - 16; g.player.vy = 0; g.player.grounded = -1;
    g.step(STEP, 0, false);
    const atMouth = g.timeFrozen;
    let frozeInside = false, worstCam = 0, last = g.cameraX;
    for (let i = 0; i < frames && !stop(); i++) {
      g.player.invincible = 999;
      const onFloor = g.player.grounded !== -1 && g.player.y > floorTop - 30;
      g.step(STEP, dir, onFloor && i > 40);
      worstCam = Math.max(worstCam, Math.abs(g.cameraX - last)); last = g.cameraX;
      if (inCaveInterior(cave, g.player.x, g.player.y)) frozeInside ||= g.timeFrozen;
    }
    return { atMouth, frozeInside, worstCam };
  }
  /** Walk back to the shaft the way we came. */
  function walkOut(g: GameModel, cave: SideCave) {
    const dir = (cave.side === -1 ? 1 : -1) as -1 | 1;
    for (let i = 0; i < 1200; i++) {
      g.player.invincible = 999;
      g.step(STEP, dir, false);
      if (!insideCave(cave, g.player.x, g.player.y)) return true;
    }
    return false;
  }

  it('opens a SHOP only once the player is well inside, and lets them leave without buying', () => {
    for (const side of [-1, 1] as const) {
      const found = findCave('shop', side);
      expect(found, `${side}: no shop cave`).not.toBeNull();
      const { g, cave } = found!;
      const walked = walkIn(g, cave, 1400, () => g.state === 'shop');
      expect(walked.atMouth, `${side}: the mouth must not open the shelf`).toBe(false);
      expect(walked.frozeInside).toBe(true);
      expect(g.state, `${side}: the shelf must open deep inside`).toBe('shop');
      // Far from the mouth: walking in was a decision already made by the time it opened.
      const mouthX = side === -1 ? cave.opening.x + cave.opening.width : cave.opening.x;
      expect(Math.abs(g.player.x - mouthX)).toBeGreaterThan(caveShape('shop', side).throat.depth);
      // Closed without buying, and the wallet is untouched.
      const wallet = g.coins.walletCoins;
      expect(g.closeShop()).toBe(true);
      expect(g.state).toBe('playing');
      expect(g.coins.walletCoins).toBe(wallet);
      expect(walkOut(g, cave), `${side}: the way out must be a walk`).toBe(true);
      expect(g.timeFrozen).toBe(false);
    }
  });

  it('lets a REWARD cave be mined and left, in a single short visit', () => {
    for (const side of [-1, 1] as const) {
      const found = findCave('coinVein', side);
      expect(found, `${side}: no coin cave`).not.toBeNull();
      const { g, cave } = found!;
      const walked = walkIn(g, cave, 900, () => false);
      expect(walked.atMouth).toBe(false);
      expect(walked.frozeInside).toBe(true);
      // The vein stands deep inside, on the pocket. Shoot it where it is.
      const vein = g.veinBounds(cave);
      expect(cave.taken).toBe(false);
      // The gunboots point DOWN, so a vein is mined from above it, airborne, with the trigger held.
      g.player.x = vein.x + vein.width / 2;
      g.ammo = g.stats.maxAmmo;
      g.events.length = 0;
      for (let i = 0; i < 300 && !cave.taken; i++) {
        g.player.y = vein.y - 40; g.player.vy = 0; g.player.grounded = -1; g.player.invincible = 999;
        g.step(STEP, 0, true);
      }
      expect(cave.taken, `${side}: the vein must be minable`).toBe(true);
      // It pays out where it stands. Sweeping the spill up is the coin system's job and is covered
      // there; what a cave owes is that mining it inside one drops the haul at all.
      const paid = g.events.find(e => e.type === 'coinVein');
      expect(paid, `${side}: the vein must pay out`).toBeDefined();
      expect(paid!.value).toBeGreaterThan(0);
      expect(g.coins.coins.length).toBeGreaterThan(0);
      expect(walkOut(g, cave), `${side}: the way out must be a walk`).toBe(true);
      expect(g.timeFrozen).toBe(false);
    }
  });

  it('spills a mined vein INSIDE the cave, at the vein, on either wall', () => {
    for (const side of [-1, 1] as const) {
      const found = findCoinCave(side);
      expect(found, `${side}: no coin cave`).not.toBeNull();
      const { g, cave } = found!;
      const vein = g.veinBounds(cave);
      const origin = { x: vein.x + vein.width / 2, y: vein.y + vein.height / 2 };
      // The view where a player who walked in would have it, so nothing is culled for being off
      // screen before it can be looked at.
      g.cameraY = vein.y - WORLD.height * 0.37;
      g.player.x = origin.x;
      g.ammo = g.stats.maxAmmo;
      g.events.length = 0;
      for (let i = 0; i < 300 && !cave.taken; i++) {
        g.player.y = vein.y - 40; g.player.vy = 0; g.player.grounded = -1; g.player.invincible = 999;
        g.step(STEP, 0, true);
      }
      expect(cave.taken).toBe(true);
      // The payout is announced at the vein's own WORLD position -- not a room-local one, not one
      // derived from which wall the cave is in, and not one adjusted for the camera.
      const paid = g.events.find(e => e.type === 'coinVein');
      expect(paid).toBeDefined();
      expect(Math.abs(paid!.x - origin.x), `${side}: payout announced away from the vein`).toBeLessThan(2);

      // And every coin of it is IN THE CAVE, beside the vein. This is the bug that was reported:
      // the shaft clamp used to snap the whole spill onto the main shaft's wall.
      const coins = g.coins.coins;
      expect(coins.length).toBeGreaterThan(0);
      for (let frame = 0; frame < 6; frame++) {
        for (const coin of coins) {
          expect(coin.x, `${side}: a coin left the cave`).toBeGreaterThan(cave.bounds.x);
          expect(coin.x).toBeLessThan(cave.bounds.x + cave.bounds.width);
          // ...and near where it came from, rather than pinned to anything.
          expect(Math.abs(coin.x - origin.x), `${side}: a coin is nowhere near the vein`).toBeLessThan(90);
        }
        // Never resting exactly on a shaft wall, which is what the clamp used to do to all of them.
        expect(coins.filter(c => c.x === WORLD.wall || c.x === WORLD.width - WORLD.wall).length).toBe(0);
        g.player.y = vein.y - 40; g.player.vy = 0; g.player.invincible = 999;
        g.step(STEP, 0, false);
      }
    }
  });

  it('pays the same haul in a cave as a chamber, and it is still swept up by hand', () => {
    const found = findCoinCave(-1);
    const { g, cave } = found!;
    const vein = g.veinBounds(cave);
    g.cameraY = vein.y - WORLD.height * 0.37;
    g.player.x = vein.x + vein.width / 2;
    g.ammo = g.stats.maxAmmo;
    g.events.length = 0;
    for (let i = 0; i < 300 && !cave.taken; i++) {
      g.player.y = vein.y - 40; g.player.vy = 0; g.player.grounded = -1; g.player.invincible = 999;
      g.step(STEP, 0, true);
    }
    // The amount is the rules' own, untouched by any of this.
    expect(g.events.find(e => e.type === 'coinVein')!.value).toBe(coinVeinTotal());
    // Still a spill to be collected rather than a credit: the wallet is empty until one is touched.
    expect(g.coins.walletCoins).toBe(0);
    const before = g.coins.walletCoins;
    for (let i = 0; i < 600 && g.coins.coins.length; i++) {
      // Stand in the spill; the magnet and the ordinary collection path do the rest.
      const coin = g.coins.coins[0];
      g.player.x = coin.x; g.player.y = coin.y; g.player.vy = 0; g.player.invincible = 999;
      g.step(STEP, 0, false);
    }
    expect(g.coins.walletCoins).toBeGreaterThan(before);
  });

  it('holds the player inside whichever cave they are in, and never outside one', () => {
    for (const kind of ['gunModule', 'shop', 'coinVein'] as const) {
      for (const side of [-1, 1] as const) {
        const found = findCave(kind, side);
        expect(found).not.toBeNull();
        const { g, cave } = found!;
        // Hold the stick at the far wall for a long time: the player must stop AT the cave's edge,
        // never past it, and never back out through the rock into the shaft's brickwork.
        const dir = (side === -1 ? -1 : 1) as -1 | 1;
        g.player.x = cave.side === -1 ? WORLD.wall + 26 : WORLD.width - WORLD.wall - 26;
        g.player.y = cave.opening.y + cave.opening.height - 16;
        for (let i = 0; i < 900; i++) { g.player.invincible = 999; g.step(STEP, dir, false); }
        expect(g.player.x, `${kind} ${side}`).toBeGreaterThanOrEqual(cave.bounds.x + 11);
        expect(g.player.x).toBeLessThanOrEqual(cave.bounds.x + cave.bounds.width - 11);
        // ...and the floor is under them the whole way: a cave hangs outside the shaft.
        expect(g.player.y).toBeLessThan(cave.opening.y + cave.opening.height + 40);
      }
    }
  });

  it('clears its caves when the SECTION ends and when a run restarts', () => {
    const g = new GameModel(false, seeded(29));
    for (let i = 0; i < 80 && !g.caves.length; i++) {
      g.player.y = WORLD.startY + (8 + i * 5) * WORLD.pixelsPerMeter;
      g.player.invincible = 999; g.step(STEP, 0, false);
    }
    expect(g.caves.length).toBeGreaterThan(0);
    g.player.x = g.caves[0].bounds.x + 40;
    g.player.y = g.caves[0].opening.y + 20;
    g.step(STEP, 0, false);
    expect(Math.abs(g.cameraX)).toBeGreaterThan(0);
    g.jumpToStage(1, 2);
    expect(g.caves).toEqual([]);
    expect(g.cameraX).toBe(0);
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
