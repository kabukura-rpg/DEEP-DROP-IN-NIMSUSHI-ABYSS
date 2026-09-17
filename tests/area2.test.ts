import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { OxygenSystem, OXYGEN_RULES } from '../src/systems/OxygenSystem';
import { StageGenerator, START_PLATFORM, type AirPocket, type RoutePlatform } from '../src/systems/StageGenerator';
import { ENEMY_TYPES, enemyType, spawnEnemy, type Enemy, type EnemyKind } from '../src/data/enemies';
import { PICKUP_TYPES, type Pickup } from '../src/data/pickups';
import { areaConfig, type SectionId } from '../src/data/areas';
import { horizontalReach } from '../src/data/difficulty';
import { WORLD, BALANCE } from '../src/data/balance';

const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const area2 = areaConfig(2);
const plan = (section: SectionId) => area2.plans![section - 1];
const SECTION_PIXELS = 200 * WORLD.pixelsPerMeter;

/** A run parked in an AREA 2 section, with the world cleared so a test can place its own fixtures. */
function inWater(section: SectionId = 1, random = Math.random) {
  const game = new GameModel(false, random);
  game.jumpToStage(2, section);
  return game;
}
function bare(section: SectionId = 1) {
  const game = inWater(section);
  game.platforms = []; game.enemies = []; game.pickups = []; game.airPockets = [];
  game.player.invincible = 0;
  return game;
}
const tick = (game: GameModel, seconds: number, direction = 0, fire = false) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) game.step(1 / 120, direction, fire);
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
  const generator = new StageGenerator(seeded(seed), { plan: plan(sectionId), enemyPool: area2.enemyPool, water: area2.water, oxygen: true });
  const platforms: RoutePlatform[] = [], enemies: Enemy[] = [], pickups: Pickup[] = [], airPockets: AirPocket[] = [];
  for (let chunk = 0; chunk < 6; chunk++) {
    const result = generator.chunk(chunk);
    platforms.push(...result.platforms); enemies.push(...result.enemies);
    pickups.push(...result.pickups); airPockets.push(...result.airPockets);
  }
  const limit = WORLD.startY + SECTION_PIXELS;
  return {
    platforms: platforms.filter(p => p.y <= limit), enemies: enemies.filter(e => e.y <= limit),
    pickups: pickups.filter(p => p.y <= limit), airPockets: airPockets.filter(a => a.y <= limit), limit,
  };
}

describe('AREA 2 oxygen supply', () => {
  it('starts every AREA 2 section with a full tank and drains on simulation time only', () => {
    const game = bare(1);
    expect([game.oxygen.enabled, game.oxygen.remaining]).toEqual([true, OXYGEN_RULES.max]);
    hold(game, 2);
    expect(game.oxygen.remaining).toBeCloseTo(OXYGEN_RULES.max - 2, 4);
  });
  it('never drains outside AREA 2', () => {
    const area1 = new GameModel();
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
    expect(oxygen.tick(OXYGEN_RULES.damageInterval, false)).toBe(true);
    // The hit was refused: the debt survives and lands on the next step instead of being lost.
    expect(oxygen.tick(1 / 120, false)).toBe(true);
    oxygen.consumeDamage();
    expect(oxygen.tick(1 / 120, false)).toBe(false);
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
    game.selectUpgrade(game.upgrades.choices.find(u => u.category !== 'health')!.id);
    game.confirmUpgrade();
    expect([game.stage.label, game.oxygen.remaining, game.hp]).toEqual(['2-2', OXYGEN_RULES.max, 2]);
  });
  it('turns the supply off again when AREA 3 starts', () => {
    const game = inWater(3);
    expect(game.oxygen.enabled).toBe(true);
    game.completeSection();
    game.selectUpgrade(game.upgrades.choices[0].id); game.confirmUpgrade();
    expect(game.stage.label).toBe('3-1');
    expect(game.oxygen.enabled).toBe(false);
    game.player.invincible = 99; tick(game, 4);
    expect(game.oxygen.remaining).toBe(OXYGEN_RULES.max);
    // AREA 3 brings its own pickups; what must be gone is every air source.
    expect(game.pickups.filter(p => PICKUP_TYPES[p.kind].effect === 'oxygen')).toHaveLength(0);
    expect(game.airPockets).toHaveLength(0);
    expect(game.water).toBeUndefined();
  });
});

describe('AREA 2 bubbles and air pockets', () => {
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
  it('fills the tank inside an air pocket, holds it there, and drains again outside', () => {
    const game = bare(1);
    hold(game, 6);
    expect(game.oxygen.remaining).toBeLessThan(7);
    game.airPockets = [{ id: 9, x: game.player.x - 50, y: game.player.y - 40, width: 100, height: 120 }];
    game.step(1 / 120, 0, false);
    expect([game.sheltered, game.oxygen.remaining]).toEqual([true, OXYGEN_RULES.max]);
    hold(game, 3);
    expect([game.sheltered, game.oxygen.remaining]).toEqual([true, OXYGEN_RULES.max]);
    game.airPockets = [];
    hold(game, 2);
    expect(game.sheltered).toBe(false);
    expect(game.oxygen.remaining).toBeCloseTo(OXYGEN_RULES.max - 2, 1);
  });
  it('keeps one pickup table driving spawn, effect and drawing', () => {
    expect(PICKUP_TYPES.oxygenBubble).toMatchObject({ effect: 'oxygen', value: OXYGEN_RULES.bubbleRecovery, silhouette: 'bubble' });
  });
});

describe('AREA 2 enemies', () => {
  it('pools exactly the four AREA 2 enemies with both stomp classes present', () => {
    expect([...area2.enemyPool]).toEqual(['fish', 'bubbleFish', 'jellyfish', 'urchin']);
    expect(area2.enemyPool.filter(k => ENEMY_TYPES[k].stompable)).toEqual(['fish', 'bubbleFish']);
    expect(area2.enemyPool.filter(k => !ENEMY_TYPES[k].stompable)).toEqual(['jellyfish', 'urchin']);
    for (const kind of area2.enemyPool) expect(['blob', 'wing', 'shell', 'brute']).not.toContain(ENEMY_TYPES[kind].silhouette);
  });
  it('stomps only what the attribute allows', () => {
    for (const kind of area2.enemyPool) {
      const game = bare(1);
      game.player.y = 260; game.player.vy = 300;
      game.enemies = [spawnEnemy(kind, 1, 225, 300)];
      game.player.x = 225;
      tick(game, 0.12);
      if (enemyType(kind).stompable) expect([kind, game.kills, game.hp]).toEqual([kind, 1, 4]);
      else expect([kind, game.kills, game.hp]).toEqual([kind, 0, 3]);
    }
  });
  it('kills every AREA 2 enemy by shooting', () => {
    for (const kind of area2.enemyPool) {
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

describe('AREA 2 section pacing', () => {
  const stats = (sectionId: SectionId) => {
    let bubbles = 0, pockets = 0, enemies = 0, tough = 0, rows = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = section(sectionId, seed * 311);
      bubbles += s.pickups.length; pockets += s.airPockets.length; rows += s.platforms.length;
      enemies += s.enemies.length; tough += s.enemies.filter(e => !e.stompable).length;
    }
    return { bubbles: bubbles / 40, pockets: pockets / 40, enemies: enemies / 40, toughPerRow: tough / rows, enemiesPerRow: enemies / rows };
  };
  it('moves from plentiful, close air to sparse, off-route air', () => {
    const [one, two, three] = [1, 2, 3].map(s => stats(s as SectionId));
    expect(one.pockets).toBeGreaterThan(two.pockets);
    expect(two.pockets).toBeGreaterThan(three.pockets);
    expect(one.bubbles).toBeGreaterThan(three.bubbles);
    expect(plan(1).bubbleOffside!).toBeLessThan(plan(2).bubbleOffside!);
    expect(plan(2).bubbleOffside!).toBeLessThan(plan(3).bubbleOffside!);
    expect(plan(1).maxOxygenGap!).toBeLessThan(plan(2).maxOxygenGap!);
    expect(plan(2).maxOxygenGap!).toBeLessThan(plan(3).maxOxygenGap!);
  });
  it('keeps air sparse enough late in the area that the gauge still decides routes', () => {
    const [one, two, three] = [1, 2, 3].map(s => stats(s as SectionId));
    // 2-3 is meant to sit near "a handful of bubbles and maybe one pocket", not a corridor of air.
    expect(three.bubbles).toBeLessThan(8);
    expect(three.pockets).toBeLessThan(1.6);
    expect(one.bubbles - three.bubbles).toBeGreaterThan(2);
    expect(two.bubbles).toBeGreaterThan(three.bubbles);
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

describe('AREA 2 generation safety', () => {
  it('never leaves a stretch longer than the plan allows without air, across many seeds', () => {
    for (let sectionId = 1; sectionId <= 3; sectionId++) {
      const ceiling = plan(sectionId as SectionId).maxOxygenGap!;
      for (let seed = 1; seed <= 60; seed++) {
        const s = section(sectionId as SectionId, seed * 1597);
        const sources = [START_PLATFORM.y, ...s.pickups.map(p => p.y), ...s.airPockets.map(a => a.y + a.height / 2), s.limit].sort((a, b) => a - b);
        expect(s.pickups.length + s.airPockets.length).toBeGreaterThan(3);
        for (let i = 1; i < sources.length; i++) {
          const gap = (sources[i] - sources[i - 1]) / WORLD.pixelsPerMeter;
          expect(gap, `section 2-${sectionId} seed ${seed}`).toBeLessThanOrEqual(ceiling);
        }
      }
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
          const reach = horizontalReach(below.y - 54 - above.y, area2.water);
          expect(Math.abs(x - above.exitX)).toBeLessThanOrEqual(reach + halfWidth + 1);
        };
        for (const bubble of s.pickups) {
          sourceAt(bubble.x, bubble.y, PICKUP_TYPES[bubble.kind].radius);
          for (const e of s.enemies) if (Math.abs(e.y - bubble.y) < 40) expect(Math.abs(e.originX - bubble.x)).toBeGreaterThan(e.range + 20);
        }
        for (const pocket of s.airPockets) sourceAt(pocket.x + pocket.width / 2, pocket.y + pocket.height / 2, pocket.width / 2);
      }
    }
  });
  it('still guarantees a reachable route with submerged travel maths', () => {
    for (let sectionId = 1; sectionId <= 3; sectionId++) {
      for (let seed = 1; seed <= 40; seed++) {
        const s = section(sectionId as SectionId, seed * 4423);
        let previous: RoutePlatform = { ...START_PLATFORM };
        for (const p of s.platforms) {
          expect(Math.abs(p.safeX - previous.exitX)).toBeLessThanOrEqual(horizontalReach(p.y - previous.y, area2.water));
          previous = p;
        }
      }
    }
  });
});

describe('AREA 2 submerged physics', () => {
  it('scales gravity and eases horizontal input, then restores both outside the water', () => {
    expect(area2.water).toEqual({ gravity: 0.90, responsiveness: 11 });
    const water = bare(1);
    water.player.grounded = -1; water.player.vy = 0;
    water.step(1 / 120, 0, false);
    expect(water.player.vy).toBeCloseTo(BALANCE.gravity * 0.9 / 120, 4);
    // Horizontal input ramps up instead of snapping to full speed.
    const drift = bare(1);
    drift.player.vx = 0;
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
  it('keeps the shooting core intact underwater: no hovering, no climbing', () => {
    const game = bare(1);
    game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
    let lowest = Infinity;
    // Clear the shaft each step: this is about recoil, not about bouncing off a passing fish.
    for (let i = 0; i < 900; i++) { game.oxygen.remaining = OXYGEN_RULES.max; game.player.invincible = 99; game.enemies = []; game.platforms = []; game.step(1 / 120, 0, true); lowest = Math.min(lowest, game.player.vy); }
    expect(lowest).toBeGreaterThanOrEqual(0);
    expect(game.ammo).toBe(0);
    expect(game.player.y).toBeGreaterThan(200);
  });
  it('still reloads a full magazine on landing underwater', () => {
    const game = bare(1);
    game.platforms = [{ id: 4, x: 150, width: 160, y: 300 }];
    game.player.x = 225; game.player.y = 200; game.player.vy = 0; game.ammo = 1;
    tick(game, 1.2);
    expect([game.player.grounded, game.ammo]).toEqual([4, game.stats.maxAmmo]);
  });
});
