import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { StageGenerator, START_PLATFORM, type RoutePlatform } from '../src/systems/StageGenerator';
import { ENEMY_TYPES, spawnEnemy } from '../src/data/enemies';
import { AREAS, areaConfig, type SectionId } from '../src/data/areas';
import { horizontalReach } from '../src/data/difficulty';
import { DOODAD_RULES, type Doodad } from '../src/data/doodads';
import { SPIKE_PLATFORM_RULES } from '../src/data/structures';
import { WORLD } from '../src/data/balance';
import type { SafeZone } from '../src/data/safeZone';
import type { Hazard } from '../src/data/hazards';

/**
 * AREA 4 carries the LIMBO role: there is nowhere safe to stand.
 *
 * Every ledge is a SPIKE PLATFORM, so touching down buys a reload and a settled chain at the price of
 * having to leave straight away. Nothing in the enemy pool can be stomped, so the gunboots are the
 * only way through them. Floating scenery is what refills CHARGE, which makes the AREA a loop of
 * shoot, bounce, shoot -- and the thing these tests exist to hold is that the loop can never run dry.
 */
const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const area4 = areaConfig(4);
const plan = (section: SectionId) => area4.plans![section - 1];
const SECTION_PIXELS = area4.sectionLength * WORLD.pixelsPerMeter;
const CHUNKS = Math.ceil((WORLD.startY + SECTION_PIXELS) / WORLD.chunkHeight) + 1;
const SEEDS = 60;
const SECTIONS: SectionId[] = [1, 2, 3];

function section(sectionId: SectionId, seed: number) {
  const generator = new StageGenerator(seeded(seed), {
    plan: plan(sectionId), enemyPool: area4.enemyPool, sectionLength: area4.sectionLength,
    breakable: area4.gimmicks?.breakablePlatforms === true,
  });
  const platforms: RoutePlatform[] = [], hazards: Hazard[] = [], zones: SafeZone[] = [], doodads: Doodad[] = [];
  const enemies: ReturnType<typeof spawnEnemy>[] = [];
  for (let chunk = 0; chunk < CHUNKS; chunk++) {
    const built = generator.chunk(chunk);
    platforms.push(...built.platforms.filter(p => p.y <= WORLD.startY + SECTION_PIXELS));
    hazards.push(...built.hazards); zones.push(...built.safeZones);
    doodads.push(...built.doodads.filter(d => d.y <= WORLD.startY + SECTION_PIXELS));
    enemies.push(...built.enemies.filter(e => e.y <= WORLD.startY + SECTION_PIXELS));
  }
  /** The ledges a run actually meets: not chamber floors, not gate blocks. */
  const ledges = platforms.filter(p => !p.breakBlock && p.safeZone === undefined);
  return { platforms, ledges, hazards, zones, doodads, enemies };
}
function bare(sectionId: SectionId = 1, seed = 41) {
  const game = new GameModel(false, seeded(seed));
  game.jumpToStage(4, sectionId);
  game.platforms = []; game.enemies = []; game.pickups = []; game.hazards = [];
  game.doodads = []; game.safeZones = [];
  return game;
}

describe('LIMBO has no safe ground', () => {
  it('makes every ledge a spike platform past the opening', () => {
    for (const sectionId of SECTIONS) {
      expect(plan(sectionId).spikePlatformChance).toBe(1);
      let ordinary = 0, turning = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const shaft = section(sectionId, seed * 613);
        turning += shaft.ledges.filter(p => p.spikePlatform).length;
        ordinary += shaft.ledges.filter(p => !p.spikePlatform).length;
      }
      // 4-1 keeps a couple of calm rows at the very top, which is the AREA's way in; nothing else
      // in LIMBO is ordinary ground at all.
      const share = ordinary / (ordinary + turning);
      expect({ sectionId, share: share < 0.07 }).toEqual({ sectionId, share: true });
      if (sectionId !== 1) expect({ sectionId, ordinary }).toEqual({ sectionId, ordinary: 0 });
    }
  });

  it('costs a heart rather than a run, like every other LIMBO danger', () => {
    // The dangerous ground here is the same SPIKE PLATFORM as CATACOMBS: ordinary damage, ordinary
    // invulnerability, never instant death. AREA 4 lays no lethal terrain of its own either.
    expect(SPIKE_PLATFORM_RULES.damage).toBe(1);
    for (const sectionId of SECTIONS) {
      expect(plan(sectionId).spikeChance ?? 0).toBe(0);
      for (let seed = 1; seed <= SEEDS; seed++) {
        expect({ sectionId, seed, hazards: section(sectionId, seed * 811).hazards.length }).toEqual({ sectionId, seed, hazards: 0 });
      }
    }
  });

  it('has left the collapse mechanic behind entirely', () => {
    expect(area4.gimmicks?.breakablePlatforms).toBeUndefined();
    for (const sectionId of SECTIONS) {
      expect(plan(sectionId).breakableChance ?? 0).toBe(0);
      expect(plan(sectionId).breakDelay).toBeUndefined();
      for (let seed = 1; seed <= SEEDS; seed++) {
        const shaft = section(sectionId, seed * 409);
        expect({ sectionId, seed, collapsing: shaft.platforms.filter(p => p.breakable).length }).toEqual({ sectionId, seed, collapsing: 0 });
      }
    }
    // And a run parked here never starts a collapse timer, however much it lands.
    const game = bare(2);
    game.player.invincible = 99;
    for (let i = 0; i < 1200; i++) game.step(1 / 120, 0, false);
    expect(game.collapse.counting).toBe(0);
  });
});

describe('LIMBO enemies cannot be stood on', () => {
  it('pools nothing stompable, and everything shootable', () => {
    expect(area4.enemyPool.length).toBeGreaterThan(1);
    for (const kind of area4.enemyPool) {
      expect({ kind, stompable: ENEMY_TYPES[kind].stompable }).toEqual({ kind, stompable: false });
      expect({ kind, shootable: ENEMY_TYPES[kind].shootable }).toEqual({ kind, shootable: true });
    }
  });

  it('generates nothing stompable, on any seed', () => {
    for (const sectionId of SECTIONS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        for (const enemy of section(sectionId, seed * 613).enemies) {
          expect({ sectionId, seed, kind: enemy.kind, stompable: enemy.stompable }).toEqual({ sectionId, seed, kind: enemy.kind, stompable: false });
        }
      }
    }
  });

  it('turns a landing on one into contact damage, never a stomp', () => {
    for (const kind of area4.enemyPool) {
      const game = bare();
      game.player.invincible = 0;
      game.combo = 5; game.ammo = 2;
      const enemy = spawnEnemy(kind, 1, game.player.x, game.player.y + 40);
      game.enemies = [enemy];
      game.player.vy = 320;
      for (let i = 0; i < 120 && game.hp === game.stats.maxHp; i++) game.step(1 / 120, 0, false);
      expect({ kind, hurt: game.hp < game.stats.maxHp }).toEqual({ kind, hurt: true });
      // None of the three things a stomp gives.
      expect({ kind, alive: enemy.alive }).toEqual({ kind, alive: true });
      expect({ kind, combo: game.combo }).toEqual({ kind, combo: 5 });
      expect({ kind, ammo: game.ammo }).toEqual({ kind, ammo: 2 });
      expect({ kind, kills: game.kills }).toEqual({ kind, kills: 0 });
    }
  });

  it('is killed by the gunboots, which is the way through LIMBO', () => {
    for (const kind of area4.enemyPool) {
      const game = bare();
      game.player.invincible = 99;
      const target = spawnEnemy(kind, 1, game.player.x, game.player.y + 60);
      game.enemies = [target];
      for (let i = 0; i < 900 && target.alive; i++) {
        game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
        target.y = 260; target.x = game.player.x;
        game.stats.maxAmmo = 40; game.ammo = 40;
        game.step(1 / 120, 0, true);
      }
      expect({ kind, alive: target.alive }).toEqual({ kind, alive: false });
      expect({ kind, combo: game.combo > 0 }).toEqual({ kind, combo: true });
    }
  });
});

describe('LIMBO reloads from floating scenery', () => {
  it('hangs enough doodads that CHARGE always has somewhere to come from', () => {
    for (const sectionId of SECTIONS) {
      expect(plan(sectionId).doodadChance ?? 0).toBeGreaterThan(0.5);
      let doodads = 0, worstGap = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const shaft = section(sectionId, seed * 613);
        doodads += shaft.doodads.length;
        // The longest stretch of shaft with no reload source in it -- neither scenery nor a chamber.
        const sources = [
          ...shaft.doodads.map(d => d.y),
          ...shaft.zones.map(z => z.y + z.height),
        ].sort((a, b) => a - b);
        let previous = WORLD.startY;
        for (const y of sources) { worstGap = Math.max(worstGap, y - previous); previous = y; }
        worstGap = Math.max(worstGap, WORLD.startY + SECTION_PIXELS - previous);
      }
      expect({ sectionId, perRun: doodads / SEEDS > 10 }).toEqual({ sectionId, perRun: true });
      // Measured across 60 seeds: 18.6-21.9 doodads a run, and the longest stretch with none is
      // 8.5-11.7 rows. That is deliberately not asserted as "a doodad is always within reach" --
      // inside those stretches the ledges are the fallback, at the price of landing on spikes, and
      // the bargain is the AREA. What must hold is that the scenery never thins out beyond this;
      // the soft-lock case itself is held by the test below, which counts every reload source.
      expect({ sectionId, gapRows: worstGap / plan(sectionId).gap < 13 }).toEqual({ sectionId, gapRows: true });
    }
  });

  it('reloads without settling the chain, which is how a LIMBO chain survives', () => {
    const game = bare();
    game.player.invincible = 99;
    game.ammo = 1; game.combo = 13;
    const doodad: Doodad = { id: 1, x: game.player.x - DOODAD_RULES.width / 2, y: game.player.y + 60, width: DOODAD_RULES.width, height: DOODAD_RULES.height, variant: 'lamp', active: true };
    game.doodads = [doodad];
    game.player.vy = 300;
    for (let i = 0; i < 90 && !game.events.some(e => e.type === 'doodad'); i++) game.step(1 / 120, 0, false);
    expect(game.events.some(e => e.type === 'doodad')).toBe(true);
    expect(game.ammo).toBe(game.stats.maxAmmo);
    expect(game.combo).toBe(13);
    expect(game.events.some(e => e.type === 'comboSettle')).toBe(false);
    expect(game.player.grounded).toBe(-1);
  });

  it('never builds a stretch with no reload and no way down', () => {
    // The soft-lock this AREA could produce: CHARGE empty, nothing to bounce off, and no ground that
    // is not a trap. Every SECTION must offer a source inside the reach of an ordinary fall.
    for (const sectionId of SECTIONS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const shaft = section(sectionId, seed * 271);
        const sources = [
          ...shaft.doodads.map(d => d.y),
          ...shaft.zones.map(z => z.y + z.height),
          // A spike platform is still a reload -- a dangerous one, which is the AREA's whole bargain.
          ...shaft.ledges.map(p => p.y),
        ].sort((a, b) => a - b);
        expect({ sectionId, seed, any: sources.length > 0 }).toEqual({ sectionId, seed, any: true });
        let previous = WORLD.startY, worst = 0;
        for (const y of sources) { worst = Math.max(worst, y - previous); previous = y; }
        expect({ sectionId, seed, reachable: worst <= plan(sectionId).gap * 2 }).toEqual({ sectionId, seed, reachable: true });
      }
    }
  });
});

describe('LIMBO keeps the rest of the run intact', () => {
  it('guarantees a SAFE ZONE and leaves the route reachable', () => {
    for (const sectionId of SECTIONS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const shaft = section(sectionId, seed * 613);
        expect({ sectionId, seed, zones: shaft.zones.length >= 1 }).toEqual({ sectionId, seed, zones: true });
        let previous: RoutePlatform = { ...START_PLATFORM };
        for (const p of shaft.platforms.filter(f => f.safeZone === undefined)) {
          expect(Math.abs(p.safeX - previous.exitX)).toBeLessThanOrEqual(horizontalReach(p.y - previous.y));
          previous = p;
        }
      }
    }
  });

  it('is the only AREA with no ordinary ground, and says so in its plans', () => {
    for (const area of AREAS) {
      const every = (area.plans ?? []).every(p => (p.spikePlatformChance ?? 0) === 1);
      expect({ area: area.id, every }).toEqual({ area: area.id, every: area.id === 4 });
    }
  });
});
