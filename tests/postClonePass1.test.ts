import { afterEach, describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { REEF_RULES, StageGenerator, type RoutePlatform } from '../src/systems/StageGenerator';
import { areaConfig, AREAS, type AreaId, type SectionId } from '../src/data/areas';
import { setSideRoomMode, SAFE_ZONE_RULES } from '../src/data/safeZone';
import { CAVE_RULES, caveRewardSpot, inCaveInterior, insideCave, shapeOf, type SideCave } from '../src/data/sideCave';
import { CONVEYOR_RULES, SPIKE_PLATFORM_RULES, conveyorDirFor, conveyorEscapeTime, spikePlatform } from '../src/data/structures';
import { hazardType, type Hazard } from '../src/data/hazards';
import { BALANCE, WORLD } from '../src/data/balance';
import { fallTime, horizontalReach } from '../src/data/difficulty';
import { LEVEL_SELECT_DESTINATIONS, parseDestination } from '../src/data/levelSelect';

/**
 * POST-CLONE CUSTOM PASS 1: TEST LEVEL SELECT, AREA 2's all-spike floors and wallward conveyors,
 * AREA 3's barbed reef, and AREA 2-4 side rooms moved into the wall. Everything is seeded.
 */
const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const STEP = 1 / 120;
const SHAFT_LEFT = WORLD.wall, SHAFT_RIGHT = WORLD.width - WORLD.wall;
afterEach(() => { setSideRoomMode('v1'); });

/** One SECTION as the game builds it, cut at its own depth. */
function section(area: AreaId, n: SectionId, seed: number) {
  const config = areaConfig(area);
  const g = new StageGenerator(seeded(seed), {
    plan: config.plans![n - 1], enemyPool: config.enemyPool, water: config.water,
    oxygen: config.gimmicks?.oxygen === true, breakable: config.gimmicks?.breakablePlatforms === true,
    sectionLength: config.sectionLength,
  });
  const limit = WORLD.startY + config.sectionLength * WORLD.pixelsPerMeter;
  const platforms: RoutePlatform[] = [], hazards: Hazard[] = [], caves: SideCave[] = [], containers: { x: number; y: number; width: number; height: number }[] = [];
  const enemies: { x: number; y: number; originX: number; range: number }[] = [], doodads: { x: number; y: number; width: number; height: number }[] = [];
  let zones = 0;
  for (let c = 0; c <= Math.ceil(limit / WORLD.chunkHeight) + 1; c++) {
    const k = g.chunk(c);
    platforms.push(...k.platforms.filter(p => p.y <= limit)); hazards.push(...k.hazards.filter(h => h.y <= limit));
    caves.push(...k.caves.filter(v => v.bounds.y <= limit)); containers.push(...k.containers.filter(v => v.y <= limit));
    enemies.push(...k.enemies.filter(e => e.y <= limit)); doodads.push(...k.doodads.filter(d => d.y <= limit));
    zones += k.safeZones.length;
  }
  return { config, limit, platforms, hazards, caves, containers, enemies, doodads, zones };
}
const SEEDS_500 = Array.from({ length: 500 }, (_, i) => 7919 * (i + 1) + 13);

describe('TEST LEVEL SELECT', () => {
  it('offers all twelve SECTIONs and the boss, and nothing else', () => {
    expect(LEVEL_SELECT_DESTINATIONS).toHaveLength(13);
    for (const area of [1, 2, 3, 4]) for (const n of [1, 2, 3]) expect(LEVEL_SELECT_DESTINATIONS).toContain(`${area}-${n}`);
    expect(LEVEL_SELECT_DESTINATIONS).toContain('boss');
  });

  it('starts every SECTION directly, as an ordinary playing run', () => {
    for (const destination of LEVEL_SELECT_DESTINATIONS.filter(d => d !== 'boss')) {
      const g = new GameModel(false, seeded(5));
      expect(g.warpTo(destination), destination).toBe(true);
      expect(g.stage.label).toBe(destination);
      expect(g.state).toBe('playing');
      // A few seconds of an idle run: the SECTION's world streams in and nothing throws.
      for (let i = 0; i < 240; i++) { g.player.invincible = 99; g.step(STEP, 0, false); }
      expect(g.platforms.length).toBeGreaterThan(1);
    }
  });

  it('reaches the boss, through the same ABYSS entrance the run uses', () => {
    const g = new GameModel(false, seeded(5));
    expect(g.warpTo('boss')).toBe(true);
    expect(g.stage.progress.boss).toBe(true);
    for (let i = 0; i < 120; i++) { g.player.invincible = 99; g.step(STEP, 0, false); }
    expect(['playing', 'boss']).toContain(g.state);
  });

  it('refuses anything that is not on the list, and leaves the run where it was', () => {
    for (const bad of ['0-1', '1-4', '5-1', '2-0', 'BOSS', '', ' 1-1', '1-1 ', 'boss2', null, undefined, 12, {}, ['1-1']]) {
      expect(parseDestination(bad)).toBeNull();
      const g = new GameModel(false, seeded(5));
      const before = g.stage.label;
      expect(g.warpTo(bad), String(bad)).toBe(false);
      expect(g.stage.label).toBe(before);
    }
    // ...and a practice run is not a run at all.
    const practice = new GameModel(true, seeded(5));
    expect(practice.warpTo('2-1')).toBe(false);
  });

  it('clears the transient state a jump could otherwise carry across', () => {
    const g = new GameModel(false, seeded(5));
    g.warpTo('3-2');
    for (let i = 0; i < 600; i++) { g.player.invincible = 99; g.step(STEP, 0, false); }
    g.combo = 9; g.player.invincible = 1.5; g.player.vx = 120; g.player.vy = 600; g.cameraX = -80;
    g.timeoutBubbles = [{ id: 1, x: 200, y: 900, radius: 60 }];
    g.oxygen.remaining = 5;
    expect(g.warpTo('3-1')).toBe(true);
    expect(g.combo).toBe(0);
    expect(g.player.invincible).toBe(0);
    expect([g.player.vx, g.player.vy]).toEqual([0, 0]);
    expect(g.cameraX).toBe(0);
    expect(g.cameraY).toBe(0);
    expect(g.timeoutBubbles).toEqual([]);
    expect(g.timeFrozen).toBe(false);
    expect(g.oxygen.remaining).toBe(g.oxygen.rules.max);
    expect([g.player.x, g.player.y]).toEqual([225, WORLD.startY]);
    // A new run's HP and ammo: nothing about the SECTION it came from.
    expect(g.hp).toBe(BALANCE.maxHp);
    expect(g.ammo).toBe(g.stats.maxAmmo);
  });

  it('leaves the ordinary START exactly as it was: 1-1, from the top, on the same shaft', () => {
    const a = new GameModel(false, seeded(77)), b = new GameModel(false, seeded(77));
    expect(a.stage.label).toBe('1-1');
    for (let i = 0; i < 600; i++) { a.step(STEP, 0, false); b.step(STEP, 0, false); }
    expect(JSON.stringify(a.platforms)).toBe(JSON.stringify(b.platforms));
  });
});

describe('AREA 2: every floor bites, and some carry you to the wall', () => {
  const area2 = areaConfig(2);
  it('makes every ordinary floor past the opening grace a spike floor, on the 0.5s warning', () => {
    for (const plan of area2.plans!) { expect(plan.spikePlatformChance).toBe(1); expect(plan.spikeWarning).toBe(0.5); }
    for (const n of [1, 2, 3] as SectionId[]) for (const seed of SEEDS_500.slice(0, 120)) {
      const s = section(2, n, seed);
      const grace = area2.plans![n - 1].graceDepth ?? 0;
      for (const p of s.platforms) {
        if (p.safeZone !== undefined || p.breakBlock || p.id === -2) continue;
        if ((p.y - WORLD.startY) / WORLD.pixelsPerMeter < grace) continue;
        expect({ n, seed, id: p.id, spiked: !!p.spikePlatform }).toEqual({ n, seed, id: p.id, spiked: true });
        // The fixed warning, or longer only where the ledge needs longer to walk off -- never shorter.
        expect(p.spikePlatform!.warning!).toBeGreaterThanOrEqual(0.5);
      }
    }
  });

  it('runs every belt toward the nearer wall, and only where the floor can still be left in time', () => {
    const seen = { 1: 0, 2: 0, 3: 0 } as Record<number, number>;
    for (const n of [1, 2, 3] as SectionId[]) for (const seed of SEEDS_500) {
      for (const p of section(2, n, seed).platforms) {
        if (!p.conveyor) continue;
        seen[n]++;
        expect(p.spikePlatform).toBeDefined();
        const middle = p.x + p.width / 2;
        expect(p.conveyor.dir).toBe(middle < WORLD.width / 2 ? -1 : 1);
        expect(p.conveyor.dir).toBe(conveyorDirFor(p.x, p.width, SHAFT_LEFT, SHAFT_RIGHT));
        expect(p.conveyor.speed).toBeLessThan(BALANCE.moveSpeed / 2);
        const escape = conveyorEscapeTime(p.x, p.width, p.conveyor, SHAFT_LEFT, SHAFT_RIGHT, BALANCE.moveSpeed);
        expect({ n, seed, id: p.id, inTime: escape <= p.spikePlatform!.warning! }).toEqual({ n, seed, id: p.id, inTime: true });
      }
    }
    // Belts rise through the AREA: more of them, and faster.
    expect(seen[1]).toBeLessThan(seen[2]);
    expect(seen[2]).toBeLessThan(seen[3]);
    expect(area2.plans![0].conveyorSpeed!).toBeLessThan(area2.plans![2].conveyorSpeed!);
  });

  /** A bare CATACOMB run with one floor under the player, and nothing else. */
  function onFloor(floor: RoutePlatform, x: number) {
    const g = new GameModel(false, seeded(3));
    g.jumpToStage(2, 3);
    g.enemies = []; g.hazards = []; g.doodads = []; g.caves = []; g.safeZones = []; g.pickups = [];
    (g as unknown as { nextChunk: number }).nextChunk = Infinity;
    g.platforms = [floor];
    g.player.x = x; g.player.y = floor.y - 16; g.player.vy = 0; g.player.grounded = -1; g.player.invincible = 0;
    g.cameraY = floor.y - WORLD.height * 0.5;
    return g;
  }
  const belted = (x: number, width: number, dir: -1 | 1, speed: number, warning = 0.5): RoutePlatform => ({
    id: 900, x, y: 1200, width, safeX: x + width / 2, exitX: x + width + 12, safeSide: 1, breakable: false, state: 'stable',
    spikePlatform: spikePlatform(warning), conveyor: { dir, speed },
  });

  it('carries an idle player to the end of the belt and no further: never off, never into the teeth by itself', () => {
    for (const dir of [-1, 1] as const) {
      const floor = belted(dir === -1 ? 80 : 190, 180, dir, 110);
      const g = onFloor(floor, floor.x + floor.width / 2);
      for (let i = 0; i < 30; i++) g.step(STEP, 0, false);
      expect(g.player.grounded).toBe(900);
      for (let i = 0; i < 240; i++) { g.player.invincible = 99; g.step(STEP, 0, false); }
      // Still standing on it, at the stop short of the wall-side end.
      expect(g.player.grounded).toBe(900);
      const stop = dir === -1 ? floor.x + CONVEYOR_RULES.edgeStop : floor.x + floor.width - CONVEYOR_RULES.edgeStop;
      expect(Math.abs(g.player.x - stop)).toBeLessThan(1);
    }
  });

  it('never outruns the player: walking against the belt still makes ground', () => {
    const floor = belted(80, 280, -1, 110, 5);
    const g = onFloor(floor, floor.x + 40);
    for (let i = 0; i < 20; i++) g.step(STEP, 0, false);
    const from = g.player.x;
    for (let i = 0; i < 60; i++) g.step(STEP, 1, false);
    const rate = (g.player.x - from) / (60 * STEP);
    expect(rate).toBeCloseTo(BALANCE.moveSpeed - 110, 0);
  });

  it('lets a player who moves at once get off every generated belt without a scratch, from anywhere on it', () => {
    let runs = 0;
    for (const seed of SEEDS_500.slice(0, 60)) for (const n of [1, 2, 3] as SectionId[]) {
      for (const p of section(2, n, seed).platforms) {
        if (!p.conveyor) continue;
        for (const at of [0.02, 0.35, 0.5, 0.65, 0.98]) {
          const floor = { ...p, id: 900, spikePlatform: spikePlatform(p.spikePlatform!.warning) };
          const x = Math.max(floor.x + 10, Math.min(floor.x + floor.width - 10, floor.x + floor.width * at));
          const g = onFloor(floor, x);
          while (g.player.grounded !== 900) g.step(STEP, 0, false);
          // The faster open way off, as the escape rule reckons it.
          const leftOpen = floor.x - SHAFT_LEFT >= CONVEYOR_RULES.dropGap, rightOpen = SHAFT_RIGHT - (floor.x + floor.width) >= CONVEYOR_RULES.dropGap;
          const speedTo = (d: -1 | 1) => BALANCE.moveSpeed + (floor.conveyor!.dir === d ? floor.conveyor!.speed : -floor.conveyor!.speed);
          const tLeft = leftOpen ? (g.player.x - floor.x + 9) / speedTo(-1) : Infinity;
          const tRight = rightOpen ? (floor.x + floor.width - g.player.x + 9) / speedTo(1) : Infinity;
          const way: -1 | 1 = tLeft <= tRight ? -1 : 1;
          const hp = g.hp;
          for (let i = 0; i < 240; i++) g.step(STEP, way, false);
          expect({ seed, n, at, hurt: g.hp < hp }).toEqual({ seed, n, at, hurt: false });
          runs++;
        }
      }
    }
    expect(runs).toBeGreaterThan(200);
  });

  it('still catches a player who stands still on a spike floor', () => {
    const floor = belted(150, 150, 1, 70);
    const g = onFloor(floor, 225);
    const hp = g.hp;
    for (let i = 0; i < 240; i++) g.step(STEP, 0, false);
    expect(g.hp).toBe(hp - SPIKE_PLATFORM_RULES.damage);
  });

  it('never lays a belt outside the CATACOMBS', () => {
    for (const area of AREAS.filter(a => a.id !== 2)) for (const plan of area.plans ?? []) expect(plan.conveyorChance ?? 0).toBe(0);
  });
});

describe('AREA 3: the route itself is dangerous', () => {
  const area3 = areaConfig(3);
  it('is ordinary damage, never lethal, and never a whole floor', () => {
    const type = hazardType('reefBarb');
    expect(type.lethal).toBe(false);
    expect(type.damage).toBe(1);
    for (const plan of area3.plans!) expect(plan.spikePlatformChance ?? 0).toBe(0);
  });

  it('never touches the guaranteed fall line, a landing, a way off, the way to air, or a room', () => {
    for (const n of [1, 2, 3] as SectionId[]) for (const seed of SEEDS_500) {
      const s = section(3, n, seed);
      const reef = s.hazards.filter(h => h.kind === 'reefBarb');
      const bands = [...new Set(s.platforms.filter(p => p.safeZone === undefined).map(p => Math.round(p.y)))].sort((a, b) => a - b);
      const rows = (y: number) => s.platforms.filter(p => p.safeZone === undefined && Math.round(p.y) === y);
      for (const h of reef) {
        // Its band: the row below it (the one it sits on, for a shelf patch) and the row above.
        const below = bands.find(y => y >= h.y + h.height - 1), above = [...bands].reverse().find(y => y < h.y);
        const landing = h.face === 'up' ? rows(Math.round(h.y + h.height)) : below === undefined ? [] : rows(below);
        for (const p of landing) {
          // Nothing on a landing spot or a way off.
          for (const x of [p.safeX, p.exitX]) expect({ n, seed, onLanding: x + 9 > h.x && x - 9 < h.x + h.width && h.face === 'up' }).toEqual({ n, seed, onLanding: false });
        }
        if (h.face !== 'up' && below !== undefined && above !== undefined) {
          const exits = [...rows(above).map(p => p.exitX), rows(below)[0].safeX];
          const lo = Math.min(...exits) - REEF_RULES.corridor, hi = Math.max(...exits) + REEF_RULES.corridor;
          expect({ n, seed, inCorridor: h.x + h.width > lo && h.x < hi }).toEqual({ n, seed, inCorridor: false });
        }
        // Air: never within the gap of a container, never between one and the middle of the shaft.
        for (const c of s.containers) {
          const overlapsY = h.y < c.y + c.height + REEF_RULES.airGap && h.y + h.height > c.y - REEF_RULES.airGap;
          if (!overlapsY) continue;
          const gap = Math.max(c.x - (h.x + h.width), h.x - (c.x + c.width));
          expect({ n, seed, airGap: gap >= REEF_RULES.airGap - 1e-6 }).toEqual({ n, seed, airGap: true });
        }
        // Never in a room's mouth or body.
        for (const cave of s.caves) {
          const b = cave.bounds;
          expect({ n, seed, inRoom: h.x < b.x + b.width && h.x + h.width > b.x && h.y < b.y + b.height && h.y + h.height > b.y }).toEqual({ n, seed, inRoom: false });
        }
      }
    }
  });

  it('keeps shelf-end barbs out from under any patrol, so enemy and barb never share a footing', () => {
    for (const n of [1, 2, 3] as SectionId[]) for (const seed of SEEDS_500.slice(0, 200)) {
      const s = section(3, n, seed);
      for (const h of s.hazards.filter(v => v.kind === 'reefBarb' && v.face === 'up')) {
        const floorY = h.y + h.height;
        for (const e of s.enemies) {
          if (!(e.y > floorY - 40 && e.y <= floorY + 4)) continue;
          expect({ n, seed, underPatrol: e.originX + e.range > h.x - 14 && e.originX - e.range < h.x + h.width + 14 }).toEqual({ n, seed, underPatrol: false });
        }
      }
    }
  });

  it('raises the pressure through the AREA by structure: more barbs, and more of the air behind them', () => {
    const stats = ([1, 2, 3] as SectionId[]).map(n => {
      let reef = 0, air = 0, barbed = 0, withEnemy = 0;
      for (const seed of SEEDS_500.slice(0, 200)) {
        const s = section(3, n, seed);
        const barbs = s.hazards.filter(h => h.kind === 'reefBarb');
        reef += barbs.length;
        for (const c of s.containers) {
          air++;
          if (barbs.some(h => h.face !== 'up' && h.y < c.y + c.height + 40 && h.y + h.height > c.y - 40)) barbed++;
        }
        withEnemy += barbs.filter(h => s.enemies.some(e => Math.abs(e.x - (h.x + h.width / 2)) < 90 && Math.abs(e.y - (h.y + h.height / 2)) < 90)).length;
      }
      return { reef, barbedShare: barbed / air, withEnemy };
    });
    expect(stats[0].reef).toBeLessThan(stats[1].reef);
    expect(stats[1].reef).toBeLessThan(stats[2].reef);
    expect(stats[0].barbedShare).toBeLessThan(stats[1].barbedShare);
    expect(stats[1].barbedShare).toBeLessThan(stats[2].barbedShare);
    // Enemy and barb together -- the combined situation -- grows with them.
    expect(stats[0].withEnemy).toBeLessThan(stats[2].withEnemy);
  });

  it('costs one heart a touch, with the ordinary invulnerability after it', () => {
    const g = new GameModel(false, seeded(3));
    g.jumpToStage(3, 2);
    g.enemies = []; g.platforms = []; g.doodads = []; g.caves = []; g.containers = [];
    (g as unknown as { nextChunk: number }).nextChunk = Infinity;
    g.hazards = [{ id: 1, kind: 'reefBarb', x: SHAFT_LEFT, y: 1180, width: REEF_RULES.wallReach, height: 80, lethal: false, phase: 0, state: 'idle', plume: 0, face: 'right' }];
    g.player.invincible = 0; g.oxygen.fill();
    const hp = g.hp;
    for (let i = 0; i < 60; i++) { g.player.x = SHAFT_LEFT + 12; g.player.y = 1220; g.player.vy = 0; g.step(STEP, 0, false); }
    expect(g.state).toBe('playing');
    expect(g.hp).toBe(hp - 1);
  });
});

describe('SIDE ROOMS in AREA 2-4: in the wall, like AREA 1', () => {
  it('cuts two rooms a SECTION, every one of them a cave in the rock with only its entrance on the shaft', () => {
    for (const area of [2, 3, 4] as AreaId[]) for (const n of [1, 2, 3] as SectionId[]) for (const seed of SEEDS_500.slice(0, 80)) {
      const s = section(area, n, seed);
      expect({ area, n, seed, zones: s.zones, rooms: s.caves.length }).toEqual({ area, n, seed, zones: 0, rooms: 2 });
      for (const cave of s.caves) {
        const inRock = (r: { x: number; width: number }) => cave.side === -1 ? r.x + r.width <= SHAFT_LEFT : r.x >= SHAFT_RIGHT;
        expect(inRock(cave.interior)).toBe(true);
        for (const r of cave.roof) expect(inRock(r)).toBe(true);
        for (const r of cave.floors.slice(1)) expect(inRock(r)).toBe(true);
        // The content is in the room, not the shaft.
        const spot = caveRewardSpot(cave, shapeOf(cave));
        expect(cave.side === -1 ? spot.x < SHAFT_LEFT : spot.x > SHAFT_RIGHT).toBe(true);
        // Nothing of the shaft's is inside the room: no enemy, hazard, doodad or air.
        const inside = (x: number, y: number) => insideCave(cave, x, y) && (cave.side === -1 ? x < SHAFT_LEFT : x > SHAFT_RIGHT);
        for (const e of s.enemies) expect(inside(e.x, e.y)).toBe(false);
        for (const h of s.hazards) expect(inside(h.x + h.width / 2, h.y + h.height / 2)).toBe(false);
        for (const d of s.doodads) expect(inside(d.x + d.width / 2, d.y + d.height / 2)).toBe(false);
        for (const c of s.containers) expect(inside(c.x + c.width / 2, c.y + c.height / 2)).toBe(false);
      }
    }
  });

  it('puts every entrance where the fall already being made can reach it, with time left to decide', () => {
    const CAMERA_LEAD = Math.round(WORLD.height * 0.63);
    for (const area of [2, 3, 4] as AreaId[]) {
      const water = areaConfig(area).water;
      let checked = 0;
      for (const n of [1, 2, 3] as SectionId[]) for (const seed of SEEDS_500.slice(0, 80)) {
        const s = section(area, n, seed);
        const bands = new Map<number, RoutePlatform>();
        for (const p of s.platforms) if (p.safeZone === undefined && !bands.has(Math.round(p.y))) bands.set(Math.round(p.y), p);
        const ys = [...bands.keys()].sort((a, b) => a - b);
        for (const cave of s.caves) {
          const sillY = cave.opening.y + cave.opening.height;
          const above = ys.filter(y => y < sillY - 20).pop();
          expect(above).toBeDefined();
          const from = bands.get(above!)!;
          const drop = sillY - from.y;
          const sill = cave.side === -1 ? SHAFT_LEFT + CAVE_RULES.sillOverhang : SHAFT_RIGHT - CAVE_RULES.sillOverhang;
          const need = Math.abs(sill - from.exitX);
          expect({ area, n, seed, reachable: need <= horizontalReach(drop, water) }).toEqual({ area, n, seed, reachable: true });
          const visible = Math.min(drop, CAMERA_LEAD);
          const onScreen = fallTime(drop, water?.gravity) - fallTime(drop - visible, water?.gravity);
          expect(onScreen - need / BALANCE.moveSpeed).toBeGreaterThanOrEqual(SAFE_ZONE_RULES.reactionReserve - 1e-9);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(400);
    }
  });

  /** A run in `area` with a room of `kind` loaded on the wanted wall. */
  function findRoom(area: AreaId, kind: 'gunModule' | 'shop' | 'coinVein', side: -1 | 1) {
    for (let seed = 1; seed <= 300; seed++) for (const n of [1, 2, 3] as SectionId[]) {
      const g = new GameModel(false, seeded(seed * 31));
      g.jumpToStage(area, n);
      for (let i = 0; i < 90; i++) {
        g.player.y = WORLD.startY + (8 + i * 5) * WORLD.pixelsPerMeter;
        g.player.invincible = 999; g.oxygen.fill(); g.enemies = []; g.hazards = [];
        g.step(STEP, 0, false);
        const cave = g.caves.find(c => c.side === side && c.content?.kind === kind && c.bounds.y > g.player.y - 400);
        if (cave) return { g, cave };
      }
    }
    return null;
  }

  it('walks in, stops the world inside, walks out the same entrance, and puts the view and the player back', () => {
    for (const area of [2, 3, 4] as AreaId[]) for (const kind of ['gunModule', 'shop', 'coinVein'] as const) for (const side of [-1, 1] as const) {
      const found = findRoom(area, kind, side);
      expect(found, `${area} ${kind} ${side}`).not.toBeNull();
      const { g, cave } = found!;
      const dir = (side === -1 ? -1 : 1) as -1 | 1;
      const floorTop = cave.opening.y + cave.opening.height;
      // Land on the sill, where the fall puts you.
      g.player.x = side === -1 ? SHAFT_LEFT + 26 : SHAFT_RIGHT - 26;
      g.player.y = floorTop - 16; g.player.vy = 0; g.player.grounded = -1;
      g.step(STEP, 0, false);
      expect(g.timeFrozen, `${area} ${kind} ${side}: the mouth is still the shaft`).toBe(false);
      let frozeInside = false, deepest = 0;
      for (let i = 0; i < 700; i++) {
        g.player.invincible = 999; g.oxygen.fill();
        const onFloor = g.player.grounded !== -1 && g.player.y > floorTop - 30;
        g.step(STEP, dir, onFloor && i > 40 && i % 50 === 0);
        if (inCaveInterior(cave, g.player.x, g.player.y)) frozeInside ||= g.timeFrozen;
        deepest = Math.max(deepest, Math.abs(g.cameraX));
        if (g.state === 'shop') g.closeShop();
      }
      expect(frozeInside, `${area} ${kind} ${side}: TIMEVOID inside`).toBe(true);
      expect(deepest, `${area} ${kind} ${side}: the view goes in with the player`).toBeGreaterThan(60);
      // ...and back out, walking.
      let out = false;
      for (let i = 0; i < 1400 && !out; i++) {
        g.player.invincible = 999; g.oxygen.fill();
        if (g.state === 'shop') g.closeShop();
        g.step(STEP, -dir as -1 | 1, false);
        out = !insideCave(cave, g.player.x, g.player.y);
      }
      expect(out, `${area} ${kind} ${side}: the way out is a walk`).toBe(true);
      expect(g.timeFrozen).toBe(false);
      // In the shaft, not in the brickwork.
      expect(g.player.x).toBeGreaterThanOrEqual(SHAFT_LEFT + 9);
      expect(g.player.x).toBeLessThanOrEqual(SHAFT_RIGHT - 9);
      // The view comes home once the player is back in the shaft proper.
      for (let i = 0; i < 400; i++) { g.player.invincible = 999; g.oxygen.fill(); g.player.x = 225; g.step(STEP, 0, false); }
      expect(g.cameraX, `${area} ${kind} ${side}: camera X restored`).toBe(0);
    }
  });
});

describe('isolation', () => {
  /** Two FNV-style 32-bit lanes: a digest with no dependency beyond the language. */
  const digest = () => {
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    return {
      update(t: string) { for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x5bd1e995) >>> 0; } },
      digest() { return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0'); },
    };
  };
  /** A digest of every chunk of 60 seeds x 3 SECTIONs, exactly as generated. */
  const signature = (area: AreaId) => {
    const A = areaConfig(area); const h = digest();
    for (let n = 1; n <= 3; n++) for (let s = 1; s <= 60; s++) {
      const g = new StageGenerator(seeded(s * 131 + n), { plan: A.plans![n - 1], enemyPool: A.enemyPool, water: A.water, oxygen: A.gimmicks?.oxygen === true, breakable: A.gimmicks?.breakablePlatforms === true, sectionLength: A.sectionLength });
      for (let c = 0; c < 40; c++) h.update(JSON.stringify(g.chunk(c)));
    }
    return h.digest();
  };

  it('generates AREA 1 bit for bit as 518af88 did', () => {
    // Digest taken from 518af88 with this same function.
    expect(signature(1)).toBe('bbf4e03d836bd95c');
  });

  it('changes nothing in AREA 4 but where its side rooms are: on the old chambers it is 518af88 bit for bit', () => {
    // The only AREA 4 change is `sideRooms`, which moves its rooms into the wall. Put back on the
    // rectangular chambers, AREA 4 must be exactly the shaft 518af88 generated.
    setSideRoomMode('legacy');
    expect(signature(4)).toBe('d85d9afdc4e58e2c');
    const now = areaConfig(4).plans!.map(p => { const { sideRooms, ...rest } = p; void sideRooms; return rest; });
    expect(now.every(p => p.reef === undefined && p.conveyorChance === undefined)).toBe(true);
  });
});
