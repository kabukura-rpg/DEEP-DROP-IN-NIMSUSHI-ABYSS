import { describe, expect, it } from 'vitest';
import { pickupType } from '../src/data/pickups';
import { GameModel } from '../src/systems/GameModel';
import { HeatSystem, HEAT_RULES } from '../src/systems/HeatSystem';
import { StageGenerator, START_PLATFORM, type RoutePlatform } from '../src/systems/StageGenerator';
import { HAZARD_TYPES, VENT_CYCLE, VENT_PERIOD, spawnHazard, ventStateAt, type Hazard } from '../src/data/hazards';
import { ENEMY_TYPES, enemyType, spawnEnemy, type EnemyKind } from '../src/data/enemies';
import { PICKUP_TYPES } from '../src/data/pickups';
import { areaConfig, type SectionId } from '../src/data/areas';
import { horizontalReach } from '../src/data/difficulty';
import { WORLD } from '../src/data/balance';

const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const area3 = areaConfig(3);
const plan = (section: SectionId) => area3.plans![section - 1];
const SECTION_PIXELS = area3.sectionLength * WORLD.pixelsPerMeter;
const CHUNKS = Math.ceil((WORLD.startY + SECTION_PIXELS) / WORLD.chunkHeight) + 1;

function inMagma(section: SectionId = 1) {
  const game = new GameModel(false, Math.random);
  game.jumpToStage(3, section);
  return game;
}
/** A run parked in AREA 3 with the shaft cleared, so a test controls exactly what is hot. */
function bare(section: SectionId = 1) {
  const game = inMagma(section);
  game.platforms = []; game.enemies = []; game.pickups = []; game.hazards = [];
  game.player.invincible = 0;
  return game;
}
/** Holds position so only the gauge moves; hazards are left alone because they are the subject. */
const hold = (game: GameModel, seconds: number, x = 225, y = 400) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) {
    game.player.x = x; game.player.y = y; game.player.vy = 0; game.player.grounded = -1;
    game.enemies = []; game.bullets = []; game.platforms = [];
    game.step(1 / 120, 0, false);
  }
};
const tick = (game: GameModel, seconds: number, direction = 0, fire = false) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) game.step(1 / 120, direction, fire);
};

function section(sectionId: SectionId, seed: number) {
  const generator = new StageGenerator(seeded(seed), { plan: plan(sectionId), enemyPool: area3.enemyPool, heat: true });
  const platforms: RoutePlatform[] = [], hazards: Hazard[] = [];
  const enemies: ReturnType<typeof spawnEnemy>[] = [];
  const pickups: { x: number; y: number; kind: string }[] = [];
  for (let chunk = 0; chunk < CHUNKS; chunk++) {
    const result = generator.chunk(chunk);
    platforms.push(...result.platforms); hazards.push(...result.hazards);
    enemies.push(...result.enemies); pickups.push(...result.pickups);
  }
  const limit = WORLD.startY + SECTION_PIXELS;
  return {
    platforms: platforms.filter(p => p.y <= limit), hazards: hazards.filter(h => h.y <= limit),
    enemies: enemies.filter(e => e.y <= limit), pickups: pickups.filter(p => p.y <= limit), limit,
  };
}

describe('AREA 3 heat gauge', () => {
  it('starts cold in AREA 3 and nowhere else', () => {
    const game = bare(1);
    expect([game.heat.enabled, game.heat.value]).toEqual([true, 0]);
    expect(new GameModel().heat.enabled).toBe(false);
    const water = new GameModel(); water.jumpToStage(2, 1);
    expect(water.heat.enabled).toBe(false);
    expect(new GameModel(true).heat.enabled).toBe(false);
  });
  it('climbs on ambient plus the nearest source, and much faster the closer it is', () => {
    // A shaft with nothing hot in it sheds rather than creeps: ambient is what a source adds on top
    // of itself, so an empty stretch is the cool-down the design asks for.
    const empty = bare(1);
    hold(empty, 4);
    expect(empty.heat.value).toBe(0);
    expect(empty.heat.rate).toBe(-HEAT_RULES.cooling);
    const far = bare(1);
    far.hazards = [spawnHazard('lavaPool', 1, 300, 400, 80, 12)];
    hold(far, 4, 60, 400);
    expect(far.heat.rate).toBeGreaterThan(HEAT_RULES.ambient);
    const close = bare(1);
    close.hazards = [spawnHazard('lavaPool', 1, 300, 400, 80, 12)];
    hold(close, 4, 280, 400);
    expect(close.heat.value).toBeGreaterThan(far.heat.value * 3);
    expect(close.heat.rate).toBeGreaterThan(far.heat.rate);
  });
  it('keeps a steep gradient: hugging lava costs several times what the clear lane does', () => {
    const pool = spawnHazard('lavaPool', 1, 200, 400, 80, 12);
    const rate = (distance: number) => HEAT_RULES.ambient + HeatSystem.contribution(pool, 200 - distance, 406);
    // The guaranteed-clear lane sits 85px or more from anything hot; the risky line hugs the edge.
    const lane = rate(170), edge = rate(25);
    expect(lane).toBeGreaterThan(HEAT_RULES.ambient);
    expect(lane).toBeLessThan(8);
    expect(edge).toBeGreaterThan(lane * 3);
    expect(rate(0)).toBeGreaterThan(edge);
    expect(rate(400)).toBe(HEAT_RULES.ambient);
    // A shard placed beside a hazard must sit inside that hot band, not outside it.
    expect(rate(40)).toBeGreaterThan(lane * 2);
  });
  it('cools once nothing hot is in range, but not fast enough to make ice pointless', () => {
    const game = bare(1);
    game.hazards = [spawnHazard('lavaPool', 1, 300, 400, 80, 12)];
    hold(game, 5, 260, 400);
    const hot = game.heat.value;
    expect(hot).toBeGreaterThan(10);
    game.hazards = [];
    hold(game, 4);
    expect(game.heat.value).toBeCloseTo(Math.max(0, hot - HEAT_RULES.cooling * 4), 1);
    expect(game.heat.rate).toBe(-HEAT_RULES.cooling);
    // Four seconds of cooling must be worth far less than one shard.
    expect(HEAT_RULES.cooling * 4).toBeLessThan(PICKUP_TYPES.ice.value / 2);
  });
  it('freezes while paused, at a rest and at the boss', () => {
    const paused = bare(1);
    paused.hazards = [spawnHazard('lavaPool', 1, 230, 400, 60, 12)];
    hold(paused, 2, 225, 400);
    const before = paused.heat.value;
    paused.paused = true;
    paused.step(30, 1, true);
    expect(paused.heat.value).toBe(before);
    const resting = bare(2);
    hold(resting, 2);
    const atRest = resting.heat.value;
    resting.completeSection('heat-rest');
    expect(resting.state).toBe('upgrade');
    tick(resting, 6); resting.step(9, 1, true);
    expect(resting.heat.value).toBe(atRest);
    const boss = new GameModel(); boss.jumpToBoss();
    expect(boss.heat.enabled).toBe(false);
  });
  it('burns one HP per interval at the top of the gauge and stops as soon as it drops', () => {
    const game = bare(1);
    game.heat.value = HEAT_RULES.max;
    game.hazards = [spawnHazard('lavaPool', 1, 240, 400, 60, 12)];
    hold(game, HEAT_RULES.damageInterval, 225, 380);
    expect(game.hp).toBe(3);
    expect(game.health.lastDamage?.cause).toBe('heat');
    const before = game.hp;
    hold(game, HEAT_RULES.damageInterval * 2 + 0.1, 225, 380);
    expect(before - game.hp).toBe(2);
    const survived = game.hp;
    game.heat.relieve(PICKUP_TYPES.ice.value);
    game.hazards = [];
    hold(game, 3);
    expect(game.hp).toBe(survived);
  });
  it('lets invulnerability delay an overheat hit but never cancel it', () => {
    const heat = new HeatSystem(true);
    heat.value = HEAT_RULES.max;
    expect(heat.tick(HEAT_RULES.damageInterval, 0, 0, [])).toBe(false);
    heat.value = HEAT_RULES.max;
    const pool = spawnHazard('lavaPool', 1, 0, 0, 10, 10);
    expect(heat.tick(HEAT_RULES.damageInterval, 5, 5, [pool])).toBe(true);
    expect(heat.tick(1 / 120, 5, 5, [pool])).toBe(true);
    heat.consumeDamage();
    expect(heat.tick(1 / 120, 5, 5, [pool])).toBe(false);
  });
  it('resets to zero at the next section without touching HP', () => {
    const game = inMagma(1);
    game.damage(2); game.player.invincible = 0;
    game.heat.value = 70;
    game.completeSection();
    game.selectUpgrade(game.upgrades.choices.find(u => u.category !== 'health')!.id);
    game.confirmUpgrade();
    expect([game.stage.label, game.heat.value, game.hp]).toEqual(['3-2', 0, 2]);
  });
});

describe('AREA 3 ice', () => {
  it('sheds its documented heat and never goes below zero', () => {
    expect(PICKUP_TYPES.ice).toMatchObject({ effect: 'heat', value: 60, silhouette: 'shard' });
    const game = bare(1);
    game.heat.value = 82;
    game.pickups = [{ id: 1, kind: 'ice', x: game.player.x, y: game.player.y, phase: 0, taken: false, drifting: false }];
    game.step(1 / 120, 0, false);
    expect(game.heat.value).toBeCloseTo(22, 1);
    const cold = bare(1);
    cold.heat.value = 12;
    cold.pickups = [{ id: 2, kind: 'ice', x: cold.player.x, y: cold.player.y, phase: 0, taken: false, drifting: false }];
    cold.step(1 / 120, 0, false);
    expect(cold.heat.value).toBeGreaterThanOrEqual(0);
    expect(cold.heat.value).toBeLessThan(1);
  });
  it('can only be taken once', () => {
    const game = bare(1);
    game.heat.value = 90;
    const shard = { id: 3, kind: 'ice' as const, x: game.player.x, y: game.player.y, phase: 0, taken: false, drifting: false };
    game.pickups = [shard];
    game.step(1 / 120, 0, false);
    expect(shard.taken).toBe(true);
    const after = game.heat.value;
    game.pickups = [shard];
    game.step(1 / 120, 0, false);
    expect(game.heat.value).toBeCloseTo(after, 1);
  });
  it('drops from FROST BEETLE by data, like the bubble fish before it', () => {
    expect(ENEMY_TYPES.frostBeetle.drop).toEqual({ pickup: 'ice' });
    const game = bare(1);
    game.enemies = [spawnEnemy('frostBeetle', 5, 225, 300, 0, 0, 'open')];
    game.player.x = 225; game.player.y = 180; game.player.vy = 0;
    game.shoot();
    tick(game, 0.3);
    expect(game.kills).toBe(1);
    expect(game.pickups.filter(p => p.kind === 'ice')).toHaveLength(1);
  });
});

describe('AREA 3 lava', () => {
  it('kills on contact regardless of hearts or invulnerability', () => {
    const game = bare(1);
    game.heal(4); game.heal(4);
    game.player.invincible = 99;
    expect(game.health.maxHp).toBeGreaterThan(4);
    game.hazards = [spawnHazard('lavaPool', 1, 200, 420, 60, 12)];
    game.player.x = 225; game.player.y = 415; game.player.vy = 0;
    game.step(1 / 120, 0, false);
    expect([game.state, game.hp]).toEqual(['over', 0]);
    expect(game.health.deathCause).toMatchObject({ cause: 'lava', instant: true });
  });
  it('is the only lethal hazard: a vent never kills', () => {
    expect(HAZARD_TYPES.lavaPool.lethal).toBe(true);
    expect(HAZARD_TYPES.lavaWall.lethal).toBe(true);
    expect(HAZARD_TYPES.vent.lethal).toBe(false);
    // Phase chosen so the vent is mid-eruption from the very first step; the model owns the state.
    const game = bare(1);
    game.hazards = [spawnHazard('vent', 1, 210, 420, 26, 16, VENT_CYCLE.idle + VENT_CYCLE.warning + 0.2)];
    hold(game, 0.2, 223, 400);
    expect(game.state).toBe('playing');
    expect(game.hazards[0].state).toBe('erupting');
    expect(game.heat.rate).toBeGreaterThan(HEAT_RULES.ambient * 4);
    expect(game.hp).toBe(4);
  });
});

describe('AREA 3 vents', () => {
  it('always shows a warning before it fires, and always stops again', () => {
    const vent = spawnHazard('vent', 1, 100, 100, 26, 16, 0);
    const seen: string[] = [];
    let previous = '';
    for (let t = 0; t < VENT_PERIOD * 2; t += 1 / 120) {
      const state = ventStateAt(vent, t);
      if (state !== previous) { seen.push(state); previous = state; }
    }
    expect(seen.slice(0, 4)).toEqual(['idle', 'warning', 'erupting', 'idle']);
    // Fire is never entered from idle: a warning always sits between them.
    for (let i = 1; i < seen.length; i++) if (seen[i] === 'erupting') expect(seen[i - 1]).toBe('warning');
    expect(VENT_CYCLE.warning).toBeGreaterThanOrEqual(0.6);
    expect(VENT_CYCLE.idle).toBeGreaterThan(VENT_CYCLE.erupting);
  });
  it('is far cooler while idle than while erupting, so waiting it out is a real option', () => {
    const vent = spawnHazard('vent', 1, 200, 400, 26, 16);
    const at = (state: 'idle' | 'warning' | 'erupting') => { vent.state = state; return HeatSystem.contribution(vent, 220, 380); };
    expect(at('idle')).toBeLessThan(at('warning'));
    expect(at('warning')).toBeLessThan(at('erupting'));
    expect(at('idle') * 5).toBeLessThan(at('erupting'));
  });
  it('announces each phase change once so the UI can telegraph it', () => {
    const game = bare(1);
    game.hazards = [spawnHazard('vent', 1, 100, 500, 26, 16, 0)];
    hold(game, VENT_PERIOD + 0.2, 225, 300);
    const vents = game.events.filter(e => e.type === 'vent');
    expect(vents.length).toBeGreaterThanOrEqual(2);
    expect(vents.map(e => e.value)).toContain(0);
    expect(vents.map(e => e.value)).toContain(1);
  });
});

describe('AREA 3 enemies', () => {
  it('pools the five AREA 3 enemies with both stomp classes present', () => {
    expect([...area3.enemyPool]).toEqual(['fireLizard', 'fireBat', 'magmaSlime', 'fireArmor', 'frostBeetle']);
    expect(area3.enemyPool.filter(k => ENEMY_TYPES[k].stompable)).toEqual(['fireLizard', 'fireBat', 'frostBeetle']);
    expect(area3.enemyPool.filter(k => !ENEMY_TYPES[k].stompable)).toEqual(['magmaSlime', 'fireArmor']);
    expect(ENEMY_TYPES.fireArmor.hp).toBeGreaterThanOrEqual(2);
    expect(ENEMY_TYPES.fireBat.swaySpeed).toBeGreaterThan(ENEMY_TYPES.bat.swaySpeed);
  });
  it('stomps only what the attribute allows', () => {
    for (const kind of area3.enemyPool) {
      const game = bare(1);
      game.player.y = 260; game.player.vy = 300; game.player.x = 225;
      game.enemies = [spawnEnemy(kind, 1, 225, 300)];
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
      for (let shot = 0; shot < ENEMY_TYPES[kind].hp; shot++) { game.cooldown = 0; game.shoot(); tick(game, 0.25); game.player.y = 180; game.player.vy = 0; }
      expect([kind, game.kills]).toEqual([kind, 1]);
    }
  });
  it('sees all five kinds across the area and keeps FROST BEETLE uncommon', () => {
    const counts: Partial<Record<EnemyKind, number>> = {};
    let total = 0;
    for (let sectionId = 1; sectionId <= 3; sectionId++) {
      for (let seed = 1; seed <= 40; seed++) for (const e of section(sectionId as SectionId, seed * 733).enemies) { counts[e.kind] = (counts[e.kind] ?? 0) + 1; total++; }
    }
    expect(Object.keys(counts).sort()).toEqual(['fireArmor', 'fireBat', 'fireLizard', 'frostBeetle', 'magmaSlime']);
    expect(counts.frostBeetle! / total).toBeLessThan(0.16);
    expect(counts.frostBeetle! / total).toBeGreaterThan(0.015);
  });
});

describe('AREA 3 section pacing', () => {
  const stats = (sectionId: SectionId) => {
    let pools = 0, walls = 0, vents = 0, ice = 0, enemies = 0, tough = 0, rows = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = section(sectionId, seed * 311);
      rows += s.platforms.length; ice += s.pickups.length;
      pools += s.hazards.filter(h => h.kind === 'lavaPool').length;
      walls += s.hazards.filter(h => h.kind === 'lavaWall').length;
      vents += s.hazards.filter(h => h.kind === 'vent').length;
      enemies += s.enemies.length; tough += s.enemies.filter(e => !e.stompable).length;
    }
    return { pools: pools / 40, walls: walls / 40, vents: vents / 40, ice: ice / 40, rows: rows / 40, toughPerRow: tough / rows, enemiesPerRow: enemies / rows };
  };
  it('adds lava and vents while taking ice away', () => {
    const [one, two, three] = [1, 2, 3].map(s => stats(s as SectionId));
    expect(one.pools).toBeLessThan(two.pools);
    expect(two.pools).toBeLessThan(three.pools);
    expect(one.walls).toBe(0);
    expect(two.walls).toBeLessThan(three.walls);
    expect(one.vents).toBeLessThan(two.vents);
    expect(two.vents).toBeLessThan(three.vents);
    expect(one.ice).toBeGreaterThan(two.ice);
    expect(two.ice).toBeGreaterThan(three.ice);
    // Never an ice-free corridor: even 3-3 keeps a real supply.
    expect(three.ice).toBeGreaterThan(3);
  });
  it('raises enemy pressure and leans ice towards the hot side', () => {
    const [one, , three] = [1, 2, 3].map(s => stats(s as SectionId));
    expect(one.enemiesPerRow).toBeLessThan(three.enemiesPerRow);
    expect(one.toughPerRow).toBeLessThan(three.toughPerRow);
    expect(plan(1).iceOffside!).toBeLessThan(plan(2).iceOffside!);
    expect(plan(2).iceOffside!).toBeLessThan(plan(3).iceOffside!);
  });
});

describe('AREA 3 generation safety', () => {
  it('never lets lava block the route, bury ice or sit on a landing', () => {
    for (let sectionId = 1; sectionId <= 3; sectionId++) {
      for (let seed = 1; seed <= 50; seed++) {
        const s = section(sectionId as SectionId, seed * 1597);
        let previous: RoutePlatform = { ...START_PLATFORM };
        for (const p of s.platforms) {
          // The safe transfer stays reachable and nothing lethal sits in the lane it flies through.
          expect(Math.abs(p.safeX - previous.exitX)).toBeLessThanOrEqual(horizontalReach(p.y - previous.y));
          const left = Math.min(previous.exitX, p.safeX) - 54, right = Math.max(previous.exitX, p.safeX) + 54;
          for (const h of s.hazards) {
            // Judge each hazard against the transfer whose band its centre sits in.
            const centre = h.y + h.height / 2;
            if (centre <= previous.y || centre > p.y) continue;
            expect(h.x + h.width <= left || h.x >= right, `3-${sectionId} seed ${seed} hazard ${h.kind}`).toBe(true);
          }
          // No lethal slab ever overlaps a platform surface, so no landing can be fatal.
          for (const h of s.hazards.filter(h => h.lethal)) {
            const onLedge = h.y < p.y + 16 && h.y + h.height > p.y - 16 && h.x < p.x + p.width && h.x + h.width > p.x;
            expect(onLedge, `lethal slab on ledge, seed ${seed}`).toBe(false);
          }
          previous = p;
        }
        for (const h of s.hazards) {
          expect(h.x).toBeGreaterThanOrEqual(WORLD.wall);
          expect(h.x + h.width).toBeLessThanOrEqual(WORLD.width - WORLD.wall);
        }
        for (const shard of s.pickups) {
          expect(shard.x).toBeGreaterThan(WORLD.wall);
          expect(shard.x).toBeLessThan(WORLD.width - WORLD.wall);
          for (const h of s.hazards) {
            const inside = shard.x > h.x - 8 && shard.x < h.x + h.width + 8 && shard.y > h.y - 8 && shard.y < h.y + h.height + 8;
            expect(inside, `ice inside ${h.kind}, seed ${seed}`).toBe(false);
          }
        }
      }
    }
  });
  it('leaves a lane wide enough to fall through on every row', () => {
    for (let sectionId = 1; sectionId <= 3; sectionId++) {
      for (let seed = 1; seed <= 40; seed++) {
        const s = section(sectionId as SectionId, seed * 2087);
        for (const p of s.platforms) {
          const blocking = s.hazards.filter(h => h.lethal && h.y < p.y && h.y + h.height > p.y - 200);
          const covered = blocking.reduce((sum, h) => sum + h.width, 0);
          expect(covered).toBeLessThan(WORLD.width - WORLD.wall * 2 - 90);
        }
      }
    }
  });
});

describe('AREA 3 boundaries', () => {
  it('arrives from AREA 2 with every water system gone', () => {
    const game = new GameModel();
    game.jumpToStage(2, 3);
    game.completeSection();
    game.selectUpgrade(game.upgrades.choices[0].id); game.confirmUpgrade();
    expect(game.stage.label).toBe('3-1');
    expect([game.oxygen.enabled, game.heat.enabled]).toEqual([false, true]);
    expect(game.airPockets).toHaveLength(0);
    // Gun modules are run-wide, so only AREA-owned pickups have to be gone.
    expect(game.pickups.every(p => pickupType(p.kind).category !== 'environment' || p.kind === 'ice')).toBe(true);
    expect(game.water).toBeUndefined();
  });
  it('leaves AREA 3 behind completely when AREA 4 starts', () => {
    const game = inMagma(3);
    game.heat.value = 90;
    game.completeSection();
    game.selectUpgrade(game.upgrades.choices[0].id); game.confirmUpgrade();
    expect(game.stage.label).toBe('4-1');
    expect([game.heat.enabled, game.heat.value]).toEqual([false, 0]);
    expect(game.hazards).toHaveLength(0);
    expect(game.pickups.filter(p => pickupType(p.kind).category === 'environment')).toHaveLength(0);
    expect(game.water).toBeUndefined();
    game.player.invincible = 99;
    tick(game, 4);
    expect(game.heat.value).toBe(0);
    expect(game.hazards).toHaveLength(0);
  });
});
