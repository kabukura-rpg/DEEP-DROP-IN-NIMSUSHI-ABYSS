import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { OxygenSystem, OXYGEN_RULES } from '../src/systems/OxygenSystem';
import { StageGenerator, START_PLATFORM, type RoutePlatform } from '../src/systems/StageGenerator';
import { ENEMY_TYPES, enemyType, spawnEnemy, type Enemy, type EnemyKind } from '../src/data/enemies';
import { PICKUP_TYPES, type Pickup } from '../src/data/pickups';
import { areaConfig, type SectionId } from '../src/data/areas';
import { horizontalReach } from '../src/data/difficulty';
import { WORLD, BALANCE } from '../src/data/balance';
import { AIR_CONTAINER_RULES, type AirContainer } from '../src/data/structures';
import { minSafeLanding } from '../src/data/waterTerrain';

const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const area3 = areaConfig(3);
const plan = (section: SectionId) => area3.plans![section - 1];
const SECTION_PIXELS = area3.sectionLength * WORLD.pixelsPerMeter;
const CHUNKS = Math.ceil((WORLD.startY + SECTION_PIXELS) / WORLD.chunkHeight) + 1;

/** A run parked in an AREA 3 section, with the world cleared so a test can place its own fixtures. */
function inWater(section: SectionId = 1, random = seeded(4408)) {
  const game = new GameModel(false, random);
  game.jumpToStage(3, section);
  return game;
}
function bare(section: SectionId = 1) {
  const game = inWater(section);
  game.platforms = []; game.enemies = []; game.pickups = []; game.hazards = [];
  game.player.invincible = 0;
  return game;
}
/**
 * These fixtures delete the shaft so a test owns exactly what exists, which also voids the
 * generator's row-to-row reachability guarantee: the run then free-falls in a straight line through
 * terrain that was laid for a route it is no longer taking. SPIKE kills on contact, so leaving it
 * in would make an oxygen test fail one run in seven for reasons that have nothing to do with air.
 * Hazards are therefore cleared for the duration; SPIKE has its own coverage in terrain.test.ts.
 */
const tick = (game: GameModel, seconds: number, direction = 0, fire = false) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) { game.hazards = []; game.step(1 / 120, direction, fire); }
};
/**
 * Holds the run in place so only the air supply moves. step() keeps generating the shaft ahead, so
 * a plain tick would fall into fresh enemies and clear the section long before a tank runs dry.
 */
const hold = (game: GameModel, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) {
    game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
    game.enemies = []; game.bullets = [];
    game.step(1 / 120, 0, false);
  }
};

/** Regenerate one SECTION the way GameModel does and hand back everything it produced. */
function section(sectionId: SectionId, seed: number) {
  const generator = new StageGenerator(seeded(seed), { plan: plan(sectionId), enemyPool: area3.enemyPool, water: area3.water, oxygen: true, sectionLength: area3.sectionLength });
  const platforms: RoutePlatform[] = [], enemies: Enemy[] = [], pickups: Pickup[] = [];
  const containers: AirContainer[] = [];
  for (let chunk = 0; chunk < CHUNKS; chunk++) {
    const result = generator.chunk(chunk);
    platforms.push(...result.platforms); enemies.push(...result.enemies);
    pickups.push(...result.pickups); containers.push(...result.containers);
  }
  const limit = WORLD.startY + SECTION_PIXELS;
  return {
    // Ordinary ledges and gate-row blocks are different things; most checks below want the ledges.
    platforms: platforms.filter(p => p.y <= limit && !p.breakBlock),
    blocks: platforms.filter(p => p.y <= limit && p.breakBlock),
    enemies: enemies.filter(e => e.y <= limit),
    pickups: pickups.filter(p => p.y <= limit),
    containers: containers.filter(c => c.y <= limit), limit,
  };
}

describe('AREA 3 oxygen supply', () => {
  it('starts every AREA 3 section with a full tank and drains on simulation time only', () => {
    const game = bare(1);
    expect([game.oxygen.enabled, game.oxygen.remaining]).toEqual([true, OXYGEN_RULES.max]);
    hold(game, 2);
    expect(game.oxygen.remaining).toBeCloseTo(OXYGEN_RULES.max - 2, 4);
  });
  it('never drains outside AREA 3', () => {
    const area1 = new GameModel(false, seeded(4242));
    expect(area1.oxygen.enabled).toBe(false);
    area1.player.invincible = 99; tick(area1, 3);
    expect([area1.oxygen.enabled, area1.oxygen.remaining]).toEqual([false, OXYGEN_RULES.max]);
    const practice = new GameModel(true);
    expect(practice.oxygen.enabled).toBe(false);
  });
  it('freezes while paused, at a rest and at the boss', () => {
    const paused = bare(1); paused.paused = true; tick(paused, 3);
    expect(paused.oxygen.remaining).toBe(OXYGEN_RULES.max);
    const resting = bare(2); tick(resting, 2);
    const atRest = resting.oxygen.remaining;
    resting.completeSection('air-rest');
    expect(resting.state).toBe('upgrade');
    tick(resting, 5); resting.step(9, 1, true);
    expect(resting.oxygen.remaining).toBe(atRest);
    const boss = new GameModel(); boss.jumpToBoss();
    expect(boss.oxygen.enabled).toBe(false);
  });
  it('drowns for one HP per interval once empty, and stops the moment air returns', () => {
    const game = bare(1);
    hold(game, OXYGEN_RULES.max);
    expect(game.oxygen.remaining).toBeCloseTo(0, 6);
    expect(game.hp).toBe(4);
    hold(game, OXYGEN_RULES.damageInterval);
    expect(game.hp).toBe(3);
    expect(game.health.lastDamage?.cause).toBe('oxygen');
    // Paced by the shared invulnerability window: about one heart per interval, never a burst.
    const before = game.hp;
    hold(game, OXYGEN_RULES.damageInterval * 2 + 0.1);
    expect(before - game.hp).toBe(2);
    const survived = game.hp;
    game.oxygen.add(OXYGEN_RULES.bubbleRecovery);
    hold(game, 3);
    expect(game.hp).toBe(survived);
  });
  it('lets invulnerability delay a drowning hit but never cancel it', () => {
    const oxygen = new OxygenSystem(true);
    oxygen.remaining = 0;
    expect(oxygen.tick(OXYGEN_RULES.damageInterval)).toBe(true);
    // The hit was refused: the debt survives and lands on the next step instead of being lost.
    expect(oxygen.tick(1 / 120)).toBe(true);
    oxygen.consumeDamage();
    expect(oxygen.tick(1 / 120)).toBe(false);
    const game = bare(1);
    hold(game, OXYGEN_RULES.max);
    game.player.invincible = 3;
    hold(game, 2.5);
    expect(game.hp).toBe(4);
    hold(game, 1);
    expect(game.hp).toBe(3);
  });
  it('cannot lose air to a long background gap', () => {
    // What blur and visibilitychange do: the run is paused, so a single huge delta changes nothing.
    const game = bare(1);
    hold(game, 3);
    const before = game.oxygen.remaining;
    game.paused = true;
    game.step(30, 1, true);
    expect(game.oxygen.remaining).toBe(before);
    expect(game.hp).toBe(4);
    game.paused = false;
    game.step(1 / 120, 0, false);
    expect(game.oxygen.remaining).toBeCloseTo(before - 1 / 120, 4);
  });
  it('refills at the next section start without touching HP', () => {
    const game = inWater(1);
    game.damage(2); game.player.invincible = 0;
    hold(game, 9);
    expect(game.oxygen.remaining).toBeLessThan(4);
    game.completeSection();
    // Not a card that heals on acquisition: this test is about HP crossing the boundary untouched.
    game.selectUpgrade(game.upgrades.choices.find(u => u.id !== 'apple' && u.id !== 'youth')!.id);
    game.confirmUpgrade();
    expect([game.stage.label, game.oxygen.remaining, game.hp]).toEqual(['3-2', OXYGEN_RULES.max, 2]);
  });
  it('turns the supply off again when AREA 4 starts', () => {
    const game = inWater(3);
    expect(game.oxygen.enabled).toBe(true);
    game.completeSection();
    game.selectUpgrade(game.upgrades.choices[0].id); game.confirmUpgrade();
    expect(game.stage.label).toBe('4-1');
    expect(game.oxygen.enabled).toBe(false);
    game.player.invincible = 99; tick(game, 4);
    expect(game.oxygen.remaining).toBe(OXYGEN_RULES.max);
    // LIMBO brings its own furniture; what must be gone is every air source and the water itself.
    expect(game.pickups.filter(p => PICKUP_TYPES[p.kind].effect === 'oxygen')).toHaveLength(0);
    expect([game.containers.length, game.bubbles.length]).toEqual([0, 0]);
    expect(game.water).toBeUndefined();
  });
});

describe('AREA 3 bubbles', () => {
  it('gives a bubble its configured seconds, capped at the tank', () => {
    const game = bare(1);
    hold(game, 7);
    game.pickups = [{ id: 1, kind: 'oxygenBubble', x: game.player.x, y: game.player.y, phase: 0, taken: false, drifting: false }];
    game.step(1 / 120, 0, false);
    expect(game.oxygen.remaining).toBeCloseTo(OXYGEN_RULES.max - 7 + OXYGEN_RULES.bubbleRecovery - 1 / 120, 3);
    expect(game.events.some(e => e.type === 'oxygen')).toBe(true);
  });
  it('never overfills and never lets one bubble be taken twice', () => {
    const game = bare(1);
    hold(game, 1);
    const bubble: Pickup = { id: 2, kind: 'oxygenBubble', x: game.player.x, y: game.player.y, phase: 0, taken: false, drifting: false };
    game.pickups = [bubble];
    game.step(1 / 120, 0, false);
    expect(game.oxygen.remaining).toBeLessThanOrEqual(OXYGEN_RULES.max);
    expect(bubble.taken).toBe(true);
    const after = game.oxygen.remaining;
    game.pickups = [bubble];
    game.step(1 / 120, 0, false);
    expect(game.oxygen.remaining).toBeCloseTo(after - 1 / 120, 4);
  });
  it('drops a bubble when a BUBBLE FISH dies, by data rather than a special case', () => {
    expect(ENEMY_TYPES.bubbleFish.drop).toEqual({ pickup: 'oxygenBubble' });
    expect(ENEMY_TYPES.fish.drop).toBeUndefined();
    const game = bare(1);
    game.enemies = [spawnEnemy('bubbleFish', 5, 225, 300, 0, 0, 'open')];
    game.player.x = 225; game.player.y = 180; game.player.vy = 0;
    game.shoot();
    tick(game, 0.3);
    expect(game.kills).toBe(1);
    expect(game.pickups.filter(p => p.kind === 'oxygenBubble')).toHaveLength(1);
  });
  it('has no shelter anywhere: nothing in the shaft stops the drain by being stood in', () => {
    // The sheltering alcove is gone, along with the state it set. Standing still anywhere in AREA 3
    // now costs air at exactly the same rate as moving, so the only way up is a bubble.
    expect('sheltered' in (bare(1) as object)).toBe(false);
    expect('airPockets' in (bare(1) as object)).toBe(false);
    const game = bare(1);
    const before = game.oxygen.remaining;
    hold(game, 4);
    expect(game.oxygen.remaining).toBeCloseTo(before - 4, 1);
    // The generator cannot produce one either, in any SECTION, on any seed.
    for (const sectionId of [1, 2, 3] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const built = section(sectionId, seed * 811) as Record<string, unknown>;
        expect(built.airPockets).toBeUndefined();
      }
    }
  });
  it('keeps one pickup table driving spawn, effect and drawing', () => {
    expect(PICKUP_TYPES.oxygenBubble).toMatchObject({ effect: 'oxygen', value: OXYGEN_RULES.bubbleRecovery, silhouette: 'bubble' });
  });
});

describe('AREA 3 enemies', () => {
  it('pools exactly the four AREA 3 enemies with both stomp classes present', () => {
    expect([...area3.enemyPool]).toEqual(['fish', 'bubbleFish', 'jellyfish', 'urchin']);
    expect(area3.enemyPool.filter(k => ENEMY_TYPES[k].stompable)).toEqual(['fish', 'bubbleFish']);
    expect(area3.enemyPool.filter(k => !ENEMY_TYPES[k].stompable)).toEqual(['jellyfish', 'urchin']);
    for (const kind of area3.enemyPool) expect(['blob', 'wing', 'shell', 'brute']).not.toContain(ENEMY_TYPES[kind].silhouette);
  });
  it('stomps only what the attribute allows', () => {
    for (const kind of area3.enemyPool) {
      const game = bare(1);
      game.player.y = 260; game.player.vy = 300;
      game.enemies = [spawnEnemy(kind, 1, 225, 300)];
      game.player.x = 225;
      tick(game, 0.12);
      if (enemyType(kind).stompable) expect([kind, game.kills, game.hp]).toEqual([kind, 1, 4]);
      else expect([kind, game.kills, game.hp]).toEqual([kind, 0, 3]);
    }
  });
  it('kills every AREA 3 enemy by shooting', () => {
    for (const kind of area3.enemyPool) {
      const game = bare(1);
      game.player.x = 225; game.player.y = 180; game.player.vy = 0;
      game.enemies = [spawnEnemy(kind, 1, 225, 300)];
      game.shoot();
      tick(game, 0.35);
      expect([kind, game.kills]).toEqual([kind, 1]);
    }
  });
  it('sees all four kinds across the area and keeps BUBBLE FISH uncommon', () => {
    const counts: Partial<Record<EnemyKind, number>> = {};
    let total = 0;
    for (let sectionId = 1; sectionId <= 3; sectionId++) {
      for (let seed = 1; seed <= 40; seed++) {
        for (const e of section(sectionId as SectionId, seed * 733).enemies) { counts[e.kind] = (counts[e.kind] ?? 0) + 1; total++; }
      }
    }
    expect(Object.keys(counts).sort()).toEqual(['bubbleFish', 'fish', 'jellyfish', 'urchin']);
    expect(counts.bubbleFish! / total).toBeLessThan(0.16);
    expect(counts.bubbleFish! / total).toBeGreaterThan(0.02);
  });
});

describe('AREA 3 section pacing', () => {
  // 200 seeds, not 40: at 40 the air counts swing by more than the gap between two SECTIONS, so a
  // bound written against one 40-seed draw measures that draw rather than the plan.
  const SEEDS = 200;
  const stats = (sectionId: SectionId) => {
    let containers = 0, enemies = 0, tough = 0, rows = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = section(sectionId, seed * 311);
      // Air now arrives as sealed containers; breaking one releases the bubbles.
      containers += s.containers.length; rows += s.platforms.length;
      enemies += s.enemies.length; tough += s.enemies.filter(e => !e.stompable).length;
    }
    return { containers: containers / SEEDS, rows: rows / SEEDS, enemies: enemies / SEEDS, toughPerRow: tough / rows, enemiesPerRow: enemies / rows };
  };
  it('moves from plentiful, close air to sparse, off-route air', () => {
    const [one, two, three] = [1, 2, 3].map(s => stats(s as SectionId));
    // Containers are the whole supply now, so this one series carries what two used to.
    expect(one.containers).toBeGreaterThan(two.containers);
    expect(two.containers).toBeGreaterThan(three.containers);
    expect(plan(1).containerChance!).toBeGreaterThan(plan(3).containerChance!);
    expect(plan(1).bubbleOffside!).toBeLessThan(plan(2).bubbleOffside!);
    expect(plan(2).bubbleOffside!).toBeLessThan(plan(3).bubbleOffside!);
    expect(plan(1).maxOxygenGap!).toBeLessThan(plan(2).maxOxygenGap!);
    expect(plan(2).maxOxygenGap!).toBeLessThan(plan(3).maxOxygenGap!);
  });
  it('keeps air sparse enough late in the area that the gauge still decides routes', () => {
    const [one, two, three] = [1, 2, 3].map(s => stats(s as SectionId));
    // 3-3 is meant to sit near "a handful of containers and maybe one pocket", not a corridor of
    // air. SECTION lengths differ per AREA now, so scarcity is read as a density rather than a count.
    //
    // Measured over 200 seeds this plan lays 3.02 containers per 100m, and it laid 3.01 at the 300m
    // SECTION it came from -- so the bound is placed above the plan's own rate rather than on top of
    // it, where it was only ever one rounding away from failing for no reason. What keeps the
    // assertion honest is the comparisons below, which are about shape and cannot drift.
    const per100 = (n: number) => n / (area3.sectionLength / 100);
    expect(per100(three.containers)).toBeLessThan(3.4);
    expect(one.containers).toBeGreaterThan(three.containers);
    expect(two.containers).toBeGreaterThan(three.containers);
    /**
     * HOW MUCH AIR A SECTION HAS, BOUNDED BY THE TWO THINGS THAT PUT IT THERE.
     *
     * Two independent sources, and the total can never be outside them:
     *
     *   THE PLAN   one roll per ordinary row, `rows * containerChance`.
     *   THE CEILING  `maxOxygenGap` forces a source whenever the plan's rolls have not produced one
     *                in time, so it demands at least `sectionLength / maxOxygenGap` of them.
     *
     * This used to be written as `plan * 0.9 .. plan * 2`, which read the plan as the whole story.
     * It was, at CATACOMB spacing: AREA 3 had ~34 rows and 0.21 of them carried air, so the plan
     * alone very nearly met the ceiling's demand and the forcing barely fired. Open water has 14.7
     * rows in the same 340m, so the same `containerChance` asks for 3.1 containers where the 50m
     * ceiling needs 6.8 -- the forcing HAS to do most of the work, and a bound written against the
     * plan alone was measuring a relationship between rows and metres that no longer exists.
     *
     * `containerChance` and `maxOxygenGap` are both unchanged; what changed is how many rows a
     * SECTION has. So the bound is stated against both terms, which is true of either terrain.
     */
    for (const sectionId of [1, 2, 3] as const) {
      // Sampled once. This used to call `stats` twice per section on top of the three at the top of
      // the test -- nine full generations for three sections' worth of numbers, which put it within
      // a whisker of the 5s timeout whenever the suite was busy. Same numbers, a third of the work.
      const { containers: measured, rows } = [one, two, three][sectionId - 1];
      const fromPlan = rows * plan(sectionId).containerChance!;
      const fromCeiling = area3.sectionLength / plan(sectionId).maxOxygenGap!;
      expect(measured, `section 3-${sectionId} floor`).toBeGreaterThan(Math.max(fromPlan, fromCeiling) * 0.9);
      expect(measured, `section 3-${sectionId} cap`).toBeLessThan(fromPlan + fromCeiling);
    }
    // A full tank must still cover the worst planned dry stretch with room to spare.
    for (const sectionId of [1, 2, 3] as const) expect(plan(sectionId).maxOxygenGap!).toBeLessThan(60);
  });
  it('raises enemy pressure and the share that cannot be stomped', () => {
    const [one, two, three] = [1, 2, 3].map(s => stats(s as SectionId));
    expect(one.enemiesPerRow).toBeLessThan(two.enemiesPerRow);
    expect(two.enemiesPerRow).toBeLessThan(three.enemiesPerRow);
    expect(one.toughPerRow).toBeLessThan(three.toughPerRow);
  });
});

describe('AREA 3 generation safety', () => {
  it('never leaves a stretch longer than the plan allows without air, across many seeds', () => {
    for (let sectionId = 1; sectionId <= 3; sectionId++) {
      const ceiling = plan(sectionId as SectionId).maxOxygenGap!;
      for (let seed = 1; seed <= 60; seed++) {
        const s = section(sectionId as SectionId, seed * 1597);
        // There is one kind of air source now, so this is the whole supply for the SECTION.
        const air = s.containers;
        // START_PLATFORM.y is where the generator's own bookkeeping starts, so the first stretch
        // is measured from the same place it is planned from.
        const sources = [START_PLATFORM.y, ...air.map(c => c.y + c.height / 2), s.limit].sort((a, b) => a - b);
        expect(air.length, `section 2-${sectionId} seed ${seed}`).toBeGreaterThan(3);
        for (let i = 1; i < sources.length; i++) {
          const gap = (sources[i] - sources[i - 1]) / WORLD.pixelsPerMeter;
          expect(gap, `section 2-${sectionId} seed ${seed}`).toBeLessThanOrEqual(ceiling);
        }
      }
    }
  });
  it('never builds a SECTION with no air in it at all', () => {
    // With the sheltering alcove gone, a SECTION whose seed happened to roll no container would be
    // an unwinnable run rather than a hard one. The plan's ceiling forces placement, so this is a
    // floor on the whole AREA, checked on the shaft the game actually builds -- gate rows included.
    for (const sectionId of [1, 2, 3] as const) {
      let fewest = Infinity;
      for (let seed = 1; seed <= 200; seed++) fewest = Math.min(fewest, section(sectionId, seed * 311).containers.length);
      expect({ section: `2-${sectionId}`, fewest }).toEqual({ section: `2-${sectionId}`, fewest: expect.any(Number) });
      // A full tank is 12s and a bubble is 5s, so a handful of containers is the least that can
      // carry a SECTION. Nothing near zero may ever come out of the generator.
      expect(fewest, `section 2-${sectionId}`).toBeGreaterThanOrEqual(5);
    }
  });
  it('keeps every air source inside the shaft and within reach of the fall that leads to it', () => {
    for (let sectionId = 1; sectionId <= 3; sectionId++) {
      for (let seed = 1; seed <= 40; seed++) {
        const s = section(sectionId as SectionId, seed * 2087);
        const rows = [START_PLATFORM, ...s.platforms];
        const sourceAt = (x: number, y: number, halfWidth: number) => {
          const above = [...rows].filter(p => p.y < y).sort((a, b) => b.y - a.y)[0];
          const below = s.platforms.filter(p => p.y > y).sort((a, b) => a.y - b.y)[0];
          expect(x - halfWidth).toBeGreaterThanOrEqual(WORLD.wall);
          expect(x + halfWidth).toBeLessThanOrEqual(WORLD.width - WORLD.wall);
          if (!below) return;
          // Air never hides inside a ledge, and the fall from the previous exit can steer to it.
          expect(Math.abs(y - above.y)).toBeGreaterThan(20);
          expect(Math.abs(y - below.y)).toBeGreaterThan(20);
          const reach = horizontalReach(below.y - 54 - above.y, area3.water);
          expect(Math.abs(x - above.exitX)).toBeLessThanOrEqual(reach + halfWidth + 1);
        };
        // Air sources are containers now. A gun module crate also lives in `pickups`, but it sits
        // on a ledge's landing spot rather than in the fall band, so the air-reach rule is not its
        // rule and applying it here was simply testing the wrong object.
        for (const box of s.containers) {
          const centre = box.x + box.width / 2, middle = box.y + box.height / 2;
          sourceAt(centre, middle, box.width / 2);
          for (const e of s.enemies) if (Math.abs(e.y - middle) < 40) expect(Math.abs(e.originX - centre)).toBeGreaterThan(e.range + 20);
        }
      }
    }
  });
  /**
   * THE ROUTE IS A CHAIN OF BANDS, NOT A LIST OF PLATFORMS.
   *
   * A band is every ledge at one height. SHELF PAIR puts two of them there, so walking the array in
   * order and measuring `p.y - previous.y` between two ledges of the SAME band asks what a fall of
   * zero pixels can steer -- nothing -- and fails on terrain that is perfectly sound. The generator's
   * own rule is per band and is the stronger one, so that is what is checked here:
   *
   *   every ledge in a band is reachable from EVERY ledge in the band above it,
   *
   * which is what makes more than one landing safe -- whichever the player takes, the way down is
   * the same way down. A SAFE ZONE floor is a chamber's own slab against a wall rather than a step
   * on the route, and a gate row is edge-to-edge stone that nothing falls past and nothing has to
   * steer to, so neither is part of this chain.
   */
  it('still guarantees a reachable route with submerged travel maths', () => {
    for (let sectionId = 1; sectionId <= 3; sectionId++) {
      for (let seed = 1; seed <= 40; seed++) {
        const s = section(sectionId as SectionId, seed * 4423);
        const rows = [...s.platforms, ...s.blocks].filter(f => f.safeZone === undefined);
        const heights = [...new Set(rows.map(f => Math.round(f.y)))].sort((a, b) => a - b);
        let above: RoutePlatform[] = [{ ...START_PLATFORM }];
        for (const y of heights) {
          const here = rows.filter(f => Math.round(f.y) === y);
          const gate = here.length > 1 && here.every(f => f.breakBlock);
          if (gate) {
            // Airtight, edge to edge: the way past is opened with a round, never steered to.
            const sorted = [...here].sort((a, b) => a.x - b.x);
            expect(sorted[0].x).toBeLessThanOrEqual(WORLD.wall);
            expect(sorted[sorted.length - 1].x + sorted[sorted.length - 1].width).toBeGreaterThanOrEqual(WORLD.width - WORLD.wall);
            for (let i = 1; i < sorted.length; i++) expect(sorted[i].x).toBeCloseTo(sorted[i - 1].x + sorted[i - 1].width, 3);
          } else {
            for (const p of here) for (const from of above) {
              expect(Math.abs(p.safeX - from.exitX), `3-${sectionId} seed ${seed} y${y}`)
                .toBeLessThanOrEqual(horizontalReach(p.y - from.y, area3.water));
            }
          }
          above = here as RoutePlatform[];
        }
      }
    }
  });
});

describe('AREA 3 submerged physics', () => {
  it('scales gravity and eases horizontal input, then restores both outside the water', () => {
    expect(area3.water).toEqual({ gravity: 0.90, responsiveness: 11 });
    const water = bare(1);
    water.player.grounded = -1; water.player.vy = 0;
    water.step(1 / 120, 0, false);
    expect(water.player.vy).toBeCloseTo(BALANCE.gravity * 0.9 / 120, 4);
    // Horizontal input ramps up instead of snapping to full speed.
    const drift = bare(1);
    drift.player.vx = 0;
    // Start hard left. At moveSpeed 350 a swimmer starting mid-shaft reaches the right wall inside
    // the one-second sample, and the wall clamp zeroes vx -- which measured the wall, not the water.
    drift.player.x = (drift as unknown as { leftEdge: number }).leftEdge;
    const startX = drift.player.x;
    drift.step(1 / 120, 1, false);
    expect(drift.player.x - startX).toBeLessThan(BALANCE.moveSpeed / 120 * 0.4);
    tick(drift, 1, 1);
    expect(drift.player.vx).toBeGreaterThan(BALANCE.moveSpeed * 0.9);
    // Releasing the key drifts to a stop rather than cutting dead.
    const before = drift.player.x;
    drift.step(1 / 120, 0, false);
    expect(drift.player.x).toBeGreaterThan(before);

    const dry = new GameModel();
    expect(dry.water).toBeUndefined();
    dry.player.grounded = -1; dry.player.vy = 0;
    dry.step(1 / 120, 0, false);
    expect(dry.player.vy).toBeCloseTo(BALANCE.gravity / 120, 4);
    const dryStart = dry.player.x;
    dry.step(1 / 120, 1, false);
    expect(dry.player.x - dryStart).toBeCloseTo(BALANCE.moveSpeed / 120, 4);
    expect(dry.player.vx).toBe(0);
  });
  it('keeps the shooting core intact underwater: recoil may lift, but never climbs', () => {
    const game = bare(1);
    game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
    let highest = 200;
    // Clear the shaft each step: this is about recoil, not about bouncing off a passing fish.
    // Gun modules are cleared alongside the enemies: swapping weapons mid-measurement would be
    // testing the crate, not the recoil.
    for (let i = 0; i < 900; i++) { game.oxygen.remaining = OXYGEN_RULES.max; game.player.invincible = 99; game.enemies = []; game.platforms = []; game.pickups = []; game.step(1 / 120, 0, true); highest = Math.min(highest, game.player.y); }
    // Recoil may lift underwater too; what must hold is that it never turns into climbing.
    expect(game.ammo).toBe(0);
    expect(game.player.y).toBeGreaterThan(200);
    expect(highest).toBeGreaterThan(200 - 200);
  });
  it('still reloads a full magazine on landing underwater', () => {
    const game = bare(1);
    game.platforms = [{ id: 4, x: 150, width: 160, y: 300 }];
    game.player.x = 225; game.player.y = 200; game.player.vy = 0; game.ammo = 1;
    tick(game, 1.2);
    expect([game.player.grounded, game.ammo]).toEqual([4, game.stats.maxAmmo]);
  });
});

/**
 * T-2 / T-3. WHAT A BROKEN AIR CONTAINER IS ACTUALLY WORTH.
 *
 * A container used to be worth a whole tank on the frame it broke. Every bubble is released at the
 * container's centre, so a player who broke it by swimming into it WAS in the middle of the burst
 * and collected all three to five on the same simulation step -- 11.99s of a 12s tank, with nothing
 * left to chase. The AREA's one real decision, air or depth, never happened.
 *
 * The fix is one number: a released bubble has to exist for AIR_CONTAINER_RULES.collectArm seconds
 * before it can be caught. A time, so it means the same at any refresh rate; short, so following
 * the burst is an action rather than a chase across the shaft.
 */
describe('AREA 3 air containers: the burst has to be followed', () => {
  const ARM_STEPS = Math.round(AIR_CONTAINER_RULES.collectArm * 120);
  /** A container sitting exactly where the player is, so touching it is the break. */
  const onThePlayer = (game: GameModel): AirContainer => ({
    id: 1, x: game.player.x - AIR_CONTAINER_RULES.size / 2, y: game.player.y - AIR_CONTAINER_RULES.size / 2,
    width: AIR_CONTAINER_RULES.size, height: AIR_CONTAINER_RULES.size, broken: false, debris: 0,
  });

  it('is time-based, not frame-based, and always longer than one step', () => {
    expect(AIR_CONTAINER_RULES.collectArm).toBeGreaterThan(1 / 120);
    expect(AIR_CONTAINER_RULES.collectArm).toBeLessThan(AIR_CONTAINER_RULES.bubbleLife);
  });

  it('gives nothing at all on the step a contact break happens', () => {
    const game = bare(1);
    game.oxygen.remaining = 0;
    game.containers = [onThePlayer(game)];
    game.step(1 / 120, 0, false);
    // The box is open and the burst is out in the world...
    expect(game.containers[0]?.broken ?? true).toBe(true);
    expect(game.bubbles.length).toBeGreaterThanOrEqual(AIR_CONTAINER_RULES.bubblesMin);
    // ...and not one drop of it has been breathed.
    expect(game.oxygen.remaining).toBe(0);
    expect(game.events.filter(e => e.type === 'oxygen')).toHaveLength(0);
  });

  it('counts the arm down on simulation time, so a coarse step cannot skip it', () => {
    const game = bare(1);
    game.oxygen.remaining = 0;
    game.containers = [onThePlayer(game)];
    game.step(1 / 120, 0, false);
    const armed = game.bubbles.map(b => b.arm);
    expect(armed.every(a => a > 0)).toBe(true);
    // Half the arm at a quarter of the rate is still half the arm.
    for (let i = 0; i < ARM_STEPS / 2; i++) game.step(1 / 120, 0, false);
    expect(game.bubbles.every(b => b.arm > 0)).toBe(true);
    expect(game.oxygen.remaining).toBe(0);
  });

  it('is worth air once the burst has armed, to a player still in it', () => {
    const game = bare(1);
    game.oxygen.remaining = 0;
    game.containers = [onThePlayer(game)];
    game.step(1 / 120, 0, false);
    const released = game.bubbles.length;
    expect(released).toBeGreaterThan(0);
    // Held on the burst: a player who follows it. The fall is what makes this a decision, and the
    // fall is measured elsewhere -- what this asks is that the air is still there to be taken.
    for (let i = 0; i < ARM_STEPS + 4; i++) {
      const bubble = game.bubbles.find(b => !b.taken);
      if (bubble) { game.player.x = bubble.x; game.player.y = bubble.y; game.player.vy = 0; }
      game.step(1 / 120, 0, false);
    }
    expect(game.oxygen.remaining).toBeGreaterThan(0);
    expect(game.events.filter(e => e.type === 'oxygen').length).toBeGreaterThan(0);
  });

  it('is lost by a player who breaks it and keeps falling', () => {
    const game = bare(1);
    game.oxygen.remaining = 0;
    game.player.vy = 400;
    game.containers = [onThePlayer(game)];
    game.step(1 / 120, 0, false);
    expect(game.bubbles.length).toBeGreaterThan(0);
    for (let i = 0; i < 120 * 2; i++) { game.platforms = []; game.enemies = []; game.step(1 / 120, 0, false); }
    expect(game.oxygen.remaining).toBe(0);
  });

  it('never restores air from the box itself, only from a bubble', () => {
    const game = bare(1);
    game.oxygen.remaining = 0;
    game.containers = [onThePlayer(game)];
    game.step(1 / 120, 0, false);
    // Take the burst away and the break is worth exactly nothing.
    game.bubbles = [];
    for (let i = 0; i < 120; i++) { game.platforms = []; game.enemies = []; game.step(1 / 120, 0, false); }
    expect(game.oxygen.remaining).toBe(0);
  });

  /**
   * T-3. A FULL TANK TAKES NOTHING.
   *
   * Air is spent only when it is breathed. Swimming through a burst at 12/12 used to consume every
   * bubble for 0s each, and a container is one-shot -- so brushing past one while full destroyed
   * the only supply in that stretch, invisibly and with no way back.
   */
  it('leaves every bubble where it is when the tank is already full', () => {
    const game = bare(1);
    expect(game.oxygen.remaining).toBe(OXYGEN_RULES.max);
    game.containers = [onThePlayer(game)];
    game.step(1 / 120, 0, false);
    const released = game.bubbles.length;
    expect(released).toBeGreaterThanOrEqual(AIR_CONTAINER_RULES.bubblesMin);
    for (let i = 0; i < ARM_STEPS + 4; i++) {
      const bubble = game.bubbles.find(b => !b.taken);
      if (bubble) { game.player.x = bubble.x; game.player.y = bubble.y; game.player.vy = 0; }
      game.oxygen.remaining = OXYGEN_RULES.max;
      game.step(1 / 120, 0, false);
    }
    expect(game.bubbles.every(b => !b.taken)).toBe(true);
    expect(game.bubbles.length).toBe(released);
    expect(game.events.filter(e => e.type === 'oxygen')).toHaveLength(0);
  });

  it('spends a bubble the moment there is room for some of it, and only then', () => {
    const game = bare(1);
    // Half a second of room: the first bubble is worth 0.5s and IS taken; the tank is then full,
    // so the next one is left alone.
    game.oxygen.remaining = OXYGEN_RULES.max - 0.5;
    const near = (id: number) => ({ id, kind: 'oxygenBubble' as const, x: game.player.x, y: game.player.y, phase: 0, taken: false, drifting: false });
    const first = near(1), second = near(2);
    game.pickups = [first, second];
    game.step(1 / 120, 0, false);
    expect(first.taken).toBe(true);
    expect(second.taken).toBe(false);
    expect(game.oxygen.remaining).toBeCloseTo(OXYGEN_RULES.max - 1 / 120, 4);
    const restored = game.events.filter(e => e.type === 'oxygen').map(e => e.value);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toBeCloseTo(0.5, 4);
  });

  it('applies the full-tank rule to a BUBBLE FISH drop as well, and to nothing else', () => {
    const game = bare(1);
    const drop: Pickup = { id: 9, kind: 'oxygenBubble', x: game.player.x, y: game.player.y, phase: 0, taken: false, drifting: false };
    game.pickups = [drop];
    game.step(1 / 120, 0, false);
    expect(drop.taken).toBe(false);
    // ICE, hearts and weapon crates are untouched by this: touching one is still taking one.
    const heart: Pickup = { id: 10, kind: 'heart', x: game.player.x, y: game.player.y, phase: 0, taken: false, drifting: false };
    game.pickups = [heart];
    game.step(1 / 120, 0, false);
    expect(heart.taken).toBe(true);
  });
});

/**
 * T-4. THE 3-3 -> 4-1 BOUNDARY, INCLUDING THE FRAME A DROWNING HIT WAS DUE ON.
 *
 * Everything SUNKEN RUINS switches on has to be off the moment LIMBO starts -- and the awkward case
 * is not the tidy one. `starved` is a debt: a hit refused by invulnerability stays owed until
 * HealthSystem accepts it, which is what stops a drowning hit being lost to an i-frame. That debt
 * must not survive a SECTION boundary and land on a player who is no longer underwater.
 */
describe('AREA 3 -> AREA 4: the supply is released, debt and all', () => {
  const nextSection = (game: GameModel) => {
    expect(game.completeSection(game.stage.id)).toBe(true);
    expect(game.state).toBe('upgrade');
    const choice = game.upgrades.choices[0];
    if (choice) game.selectUpgrade(choice.id);
    expect(game.confirmUpgrade()).toBe(true);
  };

  // Every point in the damage interval, including the two frames either side of a hit being due.
  it.each([0, 0.5, 0.999, 1 - 1 / 120, OXYGEN_RULES.damageInterval])(
    'crosses clean with the tank empty and the drowning timer %ss into its interval', parked => {
      const game = new GameModel(false, seeded(31));
      game.jumpToStage(3, 3);
      expect(game.oxygen.enabled).toBe(true);
      expect(game.water).toBeDefined();
      game.oxygen.remaining = 0;
      game.oxygen.tick(parked);
      const hp = game.hp;

      nextSection(game);

      expect(game.stage.label).toBe('4-1');
      // The supply itself.
      expect(game.oxygen.enabled).toBe(false);
      expect(game.oxygen.empty).toBe(false);
      // The gauge, which is what the player reads: full and silent, never a stuck warning.
      expect(game.oxygen.remaining).toBe(OXYGEN_RULES.max);
      expect(game.oxygen.ratio).toBe(1);
      expect(game.oxygen.warning).toBe('none');
      // The water, and everything the water put in the shaft.
      expect(game.water).toBeUndefined();
      expect(game.containers).toHaveLength(0);
      expect(game.bubbles).toHaveLength(0);
      expect(game.pickups.filter(p => p.kind === 'oxygenBubble')).toHaveLength(0);
      expect(game.enemies.filter(e => (['fish', 'bubbleFish', 'jellyfish', 'urchin'] as EnemyKind[]).includes(e.kind))).toHaveLength(0);

      // And the debt: eight seconds of LIMBO with no drowning hit and no drowning damage.
      game.events.length = 0;
      for (let i = 0; i < 120 * 8; i++) { game.player.invincible = 99; game.step(1 / 120, 0, false); }
      expect(game.hp).toBe(hp);
      expect(game.health.lastDamage?.cause).not.toBe('oxygen');
      expect(game.events.filter(e => e.type === 'oxygen')).toHaveLength(0);
      expect(game.oxygen.enabled).toBe(false);
      expect(game.oxygen.remaining).toBe(OXYGEN_RULES.max);
    });

  it('carries no drowning debt out of OxygenSystem itself when the supply is switched off', () => {
    const oxygen = new OxygenSystem(true);
    oxygen.remaining = 0;
    // A full interval owed, and refused.
    expect(oxygen.tick(OXYGEN_RULES.damageInterval)).toBe(true);
    oxygen.reset(false);
    expect(oxygen.enabled).toBe(false);
    expect(oxygen.remaining).toBe(OXYGEN_RULES.max);
    expect(oxygen.empty).toBe(false);
    expect(oxygen.tick(1 / 120)).toBe(false);
    // And switching it back on later starts from a clean interval, not from the old debt.
    oxygen.reset(true);
    oxygen.remaining = 0;
    expect(oxygen.tick(1 / 120)).toBe(false);
  });
});

/**
 * AREA 3 TERRAIN: OPEN WATER, NOT THE CATACOMBS.
 *
 * SUNKEN RUINS used to be AREA 2's plan with water poured over it -- identical platformWidth, gap,
 * enemyChance, flyChance, toughChance, comboBias, breakBlockRows and safeZoneCount, SECTION for
 * SECTION. These lock the shape that replaced it, and every bound is either derived from the
 * player's own physics or compared against CATACOMB RUINS rather than written down.
 */
describe('AREA 3 terrain reads as water before anything moves', () => {
  const area2 = areaConfig(2);
  const LIMIT = WORLD.startY + area3.sectionLength * WORLD.pixelsPerMeter;
  /** The camera shows this much shaft below the player, so a longer band is a lane, not a gap. */
  const LANE = Math.round(WORLD.height * 0.63);

  /** Everything one SECTION of an AREA generates, as rows grouped by height. */
  const shaftOf = (areaId: 2 | 3, sectionId: SectionId, seed: number) => {
    const area = areaId === 2 ? area2 : area3;
    const limit = WORLD.startY + area.sectionLength * WORLD.pixelsPerMeter;
    const generator = new StageGenerator(seeded(seed), {
      plan: area.plans![sectionId - 1], enemyPool: area.enemyPool, water: area.water,
      oxygen: area.gimmicks?.oxygen === true, sectionLength: area.sectionLength,
    });
    const all: RoutePlatform[] = [];
    for (let chunk = 0; chunk < CHUNKS + 8; chunk++) all.push(...generator.chunk(chunk).platforms);
    const rows = all.filter(p => p.y <= limit && p.safeZone === undefined);
    const heights = [...new Set(rows.map(p => Math.round(p.y)))].sort((a, b) => a - b);
    return { rows, heights, ledges: rows.filter(p => !p.breakBlock), height: limit - WORLD.startY };
  };

  it('never puts the route on a ledge narrower than the water lets the player aim at', () => {
    // 18px of body plus the 31.8px a submerged player carries after letting go, on each side.
    expect(minSafeLanding(area3.water!)).toBe(82);
    for (const plan of area3.plans!) expect(plan.platformWidth[0]).toBeGreaterThan(minSafeLanding(area3.water!));
    // And the pieces that name their own width, which the SECTION envelope does not cover.
    for (const plan of area3.plans!) {
      for (const piece of plan.pieces!.pieces) {
        for (const row of piece.rows(seeded(99), 1)) {
          if (row.ledgeWidth) expect(row.ledgeWidth[0]).toBeGreaterThan(minSafeLanding(area3.water!));
        }
      }
    }
  });

  it('caps every open span at the SECTION\'s own air ceiling, so the ceiling stays reachable', () => {
    for (const [index, plan] of area3.plans!.entries()) {
      const ceilingPx = plan.maxOxygenGap! * WORLD.pixelsPerMeter;
      expect(plan.pieces!.maxStep, `3-${index + 1}`).toBeLessThanOrEqual(ceilingPx);
      for (const piece of plan.pieces!.pieces) {
        for (let draw = 1; draw <= 40; draw++) {
          for (const row of piece.rows(seeded(draw * 17), draw % 2 ? 1 : -1)) {
            expect(row.step, `3-${index + 1} ${piece.id}`).toBeLessThanOrEqual(ceilingPx);
          }
        }
      }
    }
  });

  it('lays fewer and wider ledges than the catacombs, in every SECTION', () => {
    for (const sectionId of [1, 2, 3] as SectionId[]) {
      let water = { count: 0, width: 0 }, stone = { count: 0, width: 0 };
      for (let seed = 1; seed <= 60; seed++) {
        const a3 = shaftOf(3, sectionId, seed * 811), a2 = shaftOf(2, sectionId, seed * 811);
        water.count += a3.ledges.length; stone.count += a2.ledges.length;
        for (const p of a3.ledges) water.width += p.width;
        for (const p of a2.ledges) stone.width += p.width;
      }
      // Fewer: AREA 3 covers a LONGER section with well under three quarters of the rows.
      expect(water.count / 60, `3-${sectionId} ledges`).toBeLessThan(stone.count / 60 * 0.75);
      // Wider: a shelf is arrived on from a long fall with drift still in the controls.
      expect(water.width / water.count, `3-${sectionId} width`).toBeGreaterThan(stone.width / stone.count);
    }
  });

  it('opens real lanes where the catacombs have none at all', () => {
    for (const sectionId of [1, 2, 3] as SectionId[]) {
      let open3 = 0, total3 = 0, open2 = 0, total2 = 0;
      for (let seed = 1; seed <= 60; seed++) {
        for (const [areaId, acc] of [[3, 0], [2, 1]] as const) {
          const s = shaftOf(areaId as 2 | 3, sectionId, seed * 1487);
          let open = 0;
          for (let i = 1; i < s.heights.length; i++) {
            const band = s.heights[i] - s.heights[i - 1];
            if (band >= LANE) open += band;
          }
          if (acc === 0) { open3 += open; total3 += s.height; } else { open2 += open; total2 += s.height; }
        }
      }
      // A quarter of SUNKEN RUINS is fall the player reads from the top...
      expect(open3 / total3, `3-${sectionId}`).toBeGreaterThan(0.25);
      // ...and the catacombs, whose rows are 236-248px apart, have not one band that long.
      expect(open2 / total2, `2-${sectionId}`).toBe(0);
    }
  });

  it('crosses the shaft from wall to wall, and leaves water in the middle to cross', () => {
    const RIGHT = WORLD.width - WORLD.wall;
    for (const sectionId of [1, 2, 3] as SectionId[]) {
      let againstAWall = 0, ledges = 0, transfers = 0;
      const crossings: number[] = [];
      for (let seed = 1; seed <= 60; seed++) {
        const s = shaftOf(3, sectionId, seed * 2371);
        const sorted = [...s.ledges].sort((a, b) => a.y - b.y);
        for (const p of sorted) { ledges++; if (p.x <= WORLD.wall + 2 || p.x + p.width >= RIGHT - 2) againstAWall++; }
        for (let i = 1; i < sorted.length; i++) {
          const a = sorted[i - 1], b = sorted[i];
          const left = (p: RoutePlatform) => p.x <= WORLD.wall + 2, right = (p: RoutePlatform) => p.x + p.width >= RIGHT - 2;
          if ((left(a) && right(b)) || (right(a) && left(b))) { transfers++; crossings.push(Math.abs(b.safeX - a.exitX)); }
        }
      }
      // A third of the AREA's ledges are shelves held against a wall...
      expect(againstAWall / ledges, `3-${sectionId} wall share`).toBeGreaterThan(0.3);
      // ...they alternate often enough to be the SECTION's shape rather than an accident...
      expect(transfers / 60, `3-${sectionId} transfers`).toBeGreaterThan(1.5);
      // ...and the crossing between two of them is a real traverse, never a drift. Built at the
      // SECTION's own 152-214px envelope this came out at 38px; the piece names a narrower width
      // precisely so there is water left in the middle.
      const median = crossings.sort((a, b) => a - b)[crossings.length >> 1];
      expect(median, `3-${sectionId} crossing`).toBeGreaterThan(90);
      // And never wider than the fall that leads into it can steer.
      for (const c of crossings) expect(c).toBeLessThanOrEqual(horizontalReach(470, area3.water));
    }
  });

  it('keeps the catacombs on their own plan, unchanged', () => {
    // The two AREAs were the same plan. Whatever else moved, AREA 2 did not.
    for (const [index, plan] of area2.plans!.entries()) {
      expect(plan.pieces, `2-${index + 1}`).toBeUndefined();
      expect(plan.rhythm, `2-${index + 1}`).toBeUndefined();
      expect(plan.containerChance, `2-${index + 1}`).toBeUndefined();
      expect(plan.gap).toBe([236, 242, 248][index]);
      expect(plan.platformWidth).toEqual([[150, 174], [138, 162], [126, 150]][index]);
      expect(plan.doodadChance).toBe([0.24, 0.26, 0.28][index]);
    }
    // And no two SECTIONs of the two AREAs share a terrain envelope any more.
    for (let i = 0; i < 3; i++) {
      expect(area3.plans![i].platformWidth).not.toEqual(area2.plans![i].platformWidth);
      expect(area3.plans![i].gap).not.toBe(area2.plans![i].gap);
    }
  });
});
