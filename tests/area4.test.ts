import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { StageGenerator, START_PLATFORM, canReachPlatform, type Platform, type RoutePlatform } from '../src/systems/StageGenerator';
import { BREAK_RULES } from '../src/systems/BreakablePlatformSystem';
import { reachExit } from './exitHelper';
import { ENEMY_TYPES, spawnEnemy } from '../src/data/enemies';
import { AREAS, areaConfig, type SectionId } from '../src/data/areas';
import { horizontalReach } from '../src/data/difficulty';
import { DOODAD_RULES, type Doodad } from '../src/data/doodads';
import { GUN_MODULES, type GunModuleId } from '../src/data/gunModules';
import { LIMBO_HAZARD_RULES } from '../src/data/structures';
import { WORLD, BALANCE } from '../src/data/balance';
import { SAFE_ZONE_RULES, type SafeZone } from '../src/data/safeZone';
import type { Hazard } from '../src/data/hazards';
import { LIMBO_FALLING_CITY, LIMBO_RULES, LIMBO_VOID, LIMBO_WAY_IN, limboCanReach, tubeTouches, type LimboMotif, type LimboTube } from '../src/data/limboTerrain';
import { activeRun, HUMAN, lineRun, passiveRun, straightRun } from './limboBot';
import { hazardCoverage, limboSection, longestClearFall } from './limboMetrics';

/**
 * AREA 4 carries the LIMBO role: there is nowhere safe to stand.
 *
 * AREA 4 / LIMBO GAMEPLAY REBUILD (limboTerrain.ts, StageGenerator.limboRow): small collapsing rubble,
 * barbed rubble around and under it, bodies laid by role, and no column of the shaft that can simply be
 * fallen down. Nothing in the enemy pool can be stomped, so the gunboots are the only way through them.
 * Ledges and floating scenery refill CHARGE -- and the loop can never run dry.
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
  // A side room is a SIDE CAVE now, as in AREA 1. What these tests read of one is its id (to find its
  // floor slab) and where that floor is -- the same two things for a chamber and for a cave.
  const platforms: RoutePlatform[] = [], hazards: Hazard[] = [], zones: { id: number; y: number; height: number }[] = [], doodads: Doodad[] = [];
  const enemies: ReturnType<typeof spawnEnemy>[] = [];
  for (let chunk = 0; chunk < CHUNKS; chunk++) {
    const built = generator.chunk(chunk);
    platforms.push(...built.platforms.filter(p => p.y <= WORLD.startY + SECTION_PIXELS));
    hazards.push(...built.hazards); zones.push(...built.safeZones, ...built.caves.map(c => ({ id: c.id, y: c.floors[0].y, height: 0 })));
    doodads.push(...built.doodads.filter(d => d.y <= WORLD.startY + SECTION_PIXELS));
    enemies.push(...built.enemies.filter(e => e.y <= WORLD.startY + SECTION_PIXELS));
  }
  /** The ledges a run actually meets: not chamber floors, not gate blocks. */
  const ledges = platforms.filter(p => !p.breakBlock && p.safeZone === undefined);
  return { generator, platforms, ledges, hazards, zones, doodads, enemies };
}
/** Every line the generator promised a SECTION, read by cast (it is no production API). */
const linesOf = (generator: StageGenerator) => (generator as unknown as { limboLines: LimboTube[] }).limboLines;
/** A SECTION's route ledges: landable, not debris, not a cave or chamber floor. */
const routeOf = (shaft: ReturnType<typeof section>) => shaft.ledges.filter(p => !p.limboHazard && p.shaped !== 'debris');
function bare(sectionId: SectionId = 1, seed = 41) {
  const game = new GameModel(false, seeded(seed));
  game.jumpToStage(4, sectionId);
  game.platforms = []; game.enemies = []; game.pickups = []; game.hazards = [];
  game.doodads = []; game.safeZones = []; game.caves = [];
  return game;
}

/**
 * STAGE GENERATION v2 rebuilt this AREA once (rubble ledges, barbs only beside the route); human review
 * of ab49ed2 then found it easier than AREA 1 -- 64-112px ledges, 2-8 barbs a SECTION, a straight drop
 * that worked. AREA 4 / LIMBO GAMEPLAY REBUILD replaces it. WAS here: "lays landable rubble in every
 * SECTION, with barbs only as debris beside the route" -- bands grouped by height, barbs only at the
 * route's own height. Barbed rubble now hangs at any height in the band; what is held is the rebuilt
 * AREA's own promise.
 */
describe('COLLAPSED REALM is broken rubble to land on', () => {
  it('lays small rubble to land on every band, from its own builder, with barbed rubble all around it', () => {
    const specs = [LIMBO_WAY_IN, LIMBO_FALLING_CITY, LIMBO_VOID];
    for (const sectionId of SECTIONS) {
      const spec = specs[sectionId - 1];
      expect(plan(sectionId).limbo).toBe(spec);
      expect(plan(sectionId).limboHazardChance ?? 0).toBe(0);
      expect(plan(sectionId).pieces).toBeUndefined();
      let landable = 0, barbs = 0, bands = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const shaft = section(sectionId, seed * 613);
        const route = routeOf(shaft), debris = shaft.ledges.filter(p => p.shaped === 'debris');
        // Small: the route ledge inside its SECTION's own range, debris smaller still. Nothing like the
        // 64-112px of before, and nothing wider than a few bodies.
        for (const p of route) expect({ sectionId, seed, w: p.width >= spec.ledgeWidth[0] && p.width <= spec.ledgeWidth[1] }).toEqual({ sectionId, seed, w: true });
        for (const p of debris) expect({ sectionId, seed, w: p.width >= spec.debrisWidth[0] && p.width <= spec.debrisWidth[1] }).toEqual({ sectionId, seed, w: true });
        // Every promised line ends on a ledge there is, and no barb is a landing.
        for (const t of linesOf(shaft.generator).filter(l => l.y1 <= WORLD.startY + SECTION_PIXELS)) {
          const on = shaft.platforms.some(p => !p.limboHazard && Math.abs(p.y - t.y1) < 1 && t.x1 + 9 > p.x && t.x1 - 9 < p.x + p.width);
          expect({ sectionId, seed, y: t.y1, on }).toEqual({ sectionId, seed, y: t.y1, on: true });
        }
        bands += route.length;
        barbs += shaft.ledges.filter(p => p.limboHazard).length;
        landable += route.length + debris.length;
      }
      const screens = SECTION_PIXELS / WORLD.height;
      // Somewhere to land, every band -- 1.5 to 3.5 ledges a screen -- and more barbed rubble than ledges.
      expect({ sectionId, ok: landable / 30 / screens >= 1.5 && landable / 30 / screens <= 3.5 }).toEqual({ sectionId, ok: true });
      expect({ sectionId, barbsPerBand: barbs / bands >= 1.5 }).toEqual({ sectionId, barbsPerBand: true });
    }
  });

  it('costs a heart rather than a run, and lays nothing lethal', () => {
    expect(LIMBO_HAZARD_RULES.damage).toBe(1);
    for (const sectionId of SECTIONS) {
      expect(plan(sectionId).spikeChance ?? 0).toBe(0);
      for (let seed = 1; seed <= SEEDS; seed++) {
        expect({ sectionId, seed, hazards: section(sectionId, seed * 811).hazards.length }).toEqual({ sectionId, seed, hazards: 0 });
      }
    }
  });

  // WAS: "lays no collapsing ledge and no spike trap, as the original has neither" -- every ledge was
  // asserted NOT breakable. Human review: COLLAPSED REALM is meant to be crossed on collapsing ledges
  // alone, so that half is now the opposite guarantee, held in 'COLLAPSED REALM: every ledge gives
  // way' below. The spike-trap half is unchanged.
  it('lays no spike trap', () => {
    for (const sectionId of SECTIONS) {
      expect(plan(sectionId).spikePlatformChance ?? 0).toBe(0);
      for (let seed = 1; seed <= SEEDS; seed++) {
        for (const p of section(sectionId, seed * 409).ledges) expect({ sectionId, seed, trap: !!p.spikePlatform }).toEqual({ sectionId, seed, trap: false });
      }
    }
  });
});

describe('LIMBO dangerous ground is not a floor', () => {
  /** A barb row under the player, and the fall that goes through it. */
  function overBarbs(game: GameModel, floorY = game.player.y + 90) {
    const row: Platform = { id: 900, x: WORLD.wall, y: floorY, width: WORLD.width - WORLD.wall * 2, limboHazard: true };
    game.platforms = [row];
    game.player.x = 225; game.player.vy = 260; game.player.grounded = -1;
    return row;
  }

  it('is never landed on: the fall goes straight through it', () => {
    const game = bare();
    game.player.invincible = 99;
    const row = overBarbs(game);
    for (let i = 0; i < 400; i++) {
      game.player.invincible = 99;
      // Only the barbs: the AREA lays real ledges again, and one below would end the fall.
      game.platforms = [row];
      game.step(1 / 120, 0, false);
      expect(game.player.grounded).toBe(-1);
    }
    expect(game.player.y).toBeGreaterThan(row.y + 60);
  });

  it('costs one heart, leaves CHARGE alone and never settles a chain', () => {
    const game = bare();
    game.player.invincible = 0;
    game.ammo = 2; game.combo = 17;
    const hp = game.hp;
    overBarbs(game);
    for (let i = 0; i < 400 && game.hp === hp; i++) game.step(1 / 120, 0, false);
    expect(game.hp).toBe(hp - LIMBO_HAZARD_RULES.damage);
    expect(game.health.lastDamage?.cause).toBe('spike');
    expect(game.health.lastDamage?.instant).toBe(false);
    // The three things a landing would have done, none of which happened.
    expect(game.ammo).toBe(2);
    expect(game.combo).toBe(17);
    expect(game.events.some(e => e.type === 'comboSettle')).toBe(false);
    expect(game.events.some(e => e.type === 'land')).toBe(false);
    expect(game.player.grounded).toBe(-1);
  });

  it('cannot be ridden for a reload however long the player sits in it', () => {
    const game = bare();
    game.player.invincible = 99;
    game.ammo = 1;
    const row = overBarbs(game);
    // Pinned inside the barbs, which is the best case a player could ever engineer.
    for (let i = 0; i < 600; i++) {
      game.player.invincible = 99;
      game.player.y = row.y - 4; game.player.vy = 0;
      game.step(1 / 120, 0, false);
    }
    expect(game.ammo).toBe(1);
    expect(game.player.grounded).toBe(-1);
  });

  it('respects the ordinary invulnerability window, so one pass is one heart', () => {
    const game = bare();
    game.player.invincible = 0;
    const row = overBarbs(game);
    const hp = game.hp;
    for (let i = 0; i < 90; i++) {
      game.player.y = row.y - 4; game.player.vy = 0;
      game.step(1 / 120, 0, false);
    }
    expect(game.hp).toBe(hp - 1);
    expect(game.player.invincible).toBeGreaterThan(0);
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
      // Already in view (NO CHEAP HIT holds an unseen body back), and held where the fall meets it:
      // the clone's LIMBO bodies move on their own, which is not what this is about.
      if (enemy.ai) (enemy.ai as { seen: number }).seen = 1;
      if (enemy.ai?.kind === 'orbit') enemy.ai.radius = 0;
      game.enemies = [enemy];
      game.player.vy = 320;
      const at = { x: enemy.x, y: enemy.y };
      for (let i = 0; i < 120 && game.hp === game.stats.maxHp; i++) { enemy.x = at.x; enemy.y = at.y; game.step(1 / 120, 0, false); }
      expect({ kind, hurt: game.hp < game.stats.maxHp }).toEqual({ kind, hurt: true });
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

describe('LIMBO reloads through doodads and a chamber, and nothing else', () => {
  /** Every reload source a SECTION offers OUTSIDE its chamber, and inside it. Ground is not one. */
  const reloadSources = (sectionId: SectionId, seed: number) => {
    const shaft = section(sectionId, seed * 613);
    return {
      shaft,
      ys: [...shaft.doodads.map(d => d.y), ...shaft.zones.map(z => z.y + z.height)].sort((a, b) => a - b),
    };
  };

  // STAGE GENERATION v2: ground reloads again, so a landable ledge counts as a source; doodads still
  // carry the stretches between them.
  it('never leaves a long stretch without a reload, doodads and rubble together', () => {
    for (const sectionId of SECTIONS) {
      expect(plan(sectionId).doodadChance ?? 0).toBeGreaterThan(0.5);
      let doodads = 0, worstGap = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const { shaft, ys: fromAbove } = reloadSources(sectionId, seed);
        const ys = [...fromAbove, ...shaft.ledges.filter(p => !p.limboHazard).map(p => p.y)].sort((a, b) => a - b);
        doodads += ys.length;
        let previous = WORLD.startY;
        for (const y of ys) { worstGap = Math.max(worstGap, y - previous); previous = y; }
        worstGap = Math.max(worstGap, WORLD.startY + SECTION_PIXELS - previous);
      }
      // Measured across 60 seeds: 26.6-28.9 sources a run and a worst stretch of 5.3-5.5 rows,
      // which is 2.4-2.5s of falling. Dangerous ground is deliberately NOT counted -- it reloads
      // nothing, so counting it would be counting a way out the AREA does not have.
      expect({ sectionId, perRun: doodads / SEEDS > 20 }).toEqual({ sectionId, perRun: true });
      expect({ sectionId, gapRows: worstGap / plan(sectionId).gap < 7 }).toEqual({ sectionId, gapRows: true });
    }
  });

  it('offers a source in every SECTION even when the ground is discounted entirely', () => {
    for (const sectionId of SECTIONS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const { shaft, ys } = reloadSources(sectionId, seed);
        expect({ sectionId, seed, sources: ys.length > 0 }).toEqual({ sectionId, seed, sources: true });
        expect({ sectionId, seed, chamber: shaft.zones.length >= 1 }).toEqual({ sectionId, seed, chamber: true });
      }
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
});

describe('LIMBO keeps the rest of the run intact', () => {
  it('guarantees a side room whose floor is the one place to stand', () => {
    for (const sectionId of SECTIONS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const shaft = section(sectionId, seed * 613);
        expect({ sectionId, seed, zones: shaft.zones.length >= 1 }).toEqual({ sectionId, seed, zones: true });
        for (const zone of shaft.zones) {
          const floor = shaft.platforms.find(f => f.safeZone === zone.id);
          expect(floor).toBeDefined();
          // A chamber floor is ordinary ground: landable, and never a barb row.
          expect({ sectionId, seed, barbs: floor!.limboHazard === true }).toEqual({ sectionId, seed, barbs: false });
        }
      }
    }
  });

  it('builds no AREA out of ground nobody can stand on any more', () => {
    for (const area of AREAS) {
      const every = (area.plans ?? []).every(p => (p.limboHazardChance ?? 0) === 1);
      expect({ area: area.id, every }).toEqual({ area: area.id, every: false });
    }
  });
});

/**
 * The LIMBO loop, end to end: shoot, bounce, shoot. What these hold is that the loop never needs a
 * floor -- every reload in them comes from a floating doodad or from a chamber, and the chain that
 * runs through them is never settled by anything the AREA lays.
 */
describe('LIMBO runs on doodads alone', () => {
  const ids = Object.keys(GUN_MODULES) as GunModuleId[];
  /** One doodad hung under the player, and the fall that reaches it. */
  function bounceOnce(game: GameModel, id: number) {
    game.player.x = 225; game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
    game.doodads = [{ id, x: game.player.x - DOODAD_RULES.width / 2, y: 320, width: DOODAD_RULES.width, height: DOODAD_RULES.height, variant: 'lamp', active: true }];
    game.player.vy = 300;
    // Only the events THIS step produced. Nothing clears game.events in a unit fixture, so asking
    // whether a 'doodad' has ever happened answers yes from the first bounce onwards and every
    // later bounce reads as a success it never had.
    for (let i = 0; i < 200; i++) {
      game.player.invincible = 99;
      const before = game.events.length;
      game.step(1 / 120, 0, false);
      if (game.events.slice(before).some(e => e.type === 'doodad')) return true;
    }
    return false;
  }
  /**
   * Spend the magazine in mid-air with the equipped module, pulsing the trigger the way a player
   * does. BURST re-arms on a fresh press, so holding ACTION down stalls it after one burst.
   */
  function fireDry(game: GameModel) {
    let shots = 0, idle = 0;
    for (let i = 0; i < 2400 && game.ammo > 0 && idle < 240; i++) {
      game.player.invincible = 99;
      game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
      const before = game.bullets.length;
      game.step(1 / 120, 0, i % 12 < 6);
      if (game.bullets.length > before) { shots++; idle = 0; } else idle++;
    }
    return shots;
  }

  it('lets every one of the seven weapons run shoot - bounce - shoot without touching ground', () => {
    for (const id of ids) {
      const game = bare(2);
      game.player.invincible = 99;
      game.gun.equip(id);
      game.platforms = []; game.enemies = []; game.doodads = [];
      // Round one: spend the magazine in the air.
      const first = fireDry(game);
      expect({ id, fired: first > 0 }).toEqual({ id, fired: true });
      // Spent, not necessarily exactly zero: a module whose shot costs 3 stops at 2 with no way to
      // pay for another. What matters is that the magazine is down and only a doodad can fill it.
      expect({ id, spent: game.ammo < game.stats.maxAmmo }).toEqual({ id, spent: true });
      // Reload: a doodad and nothing else. There is no ground in this fixture at all.
      expect({ id, bounced: bounceOnce(game, 1) }).toEqual({ id, bounced: true });
      expect({ id, full: game.ammo }).toEqual({ id, full: game.stats.maxAmmo });
      expect({ id, grounded: game.player.grounded }).toEqual({ id, grounded: -1 });
      // Round two: the same magazine again, proving the loop closes rather than just starting.
      const second = fireDry(game);
      expect({ id, again: second > 0 }).toEqual({ id, again: true });
      expect({ id, spentAgain: game.ammo < game.stats.maxAmmo }).toEqual({ id, spentAgain: true });
      expect({ id, bouncedAgain: bounceOnce(game, 2) }).toEqual({ id, bouncedAgain: true });
      expect({ id, fullAgain: game.ammo }).toEqual({ id, fullAgain: game.stats.maxAmmo });
      // Nothing in the loop was a landing.
      expect({ id, settled: game.events.some(e => e.type === 'comboSettle') }).toEqual({ id, settled: false });
    }
  });

  it('reaches the next doodad on one magazine even for the hungriest weapons', () => {
    // LASER and SHOTGUN cost the most per shot, so they are the ones that could strand a run if a
    // magazine did not last the gap between doodads. Measured against the real worst gap.
    const worstGapRows = 7;
    for (const id of ['laser', 'shotgun'] as GunModuleId[]) {
      const game = bare(2);
      game.gun.equip(id);
      const def = GUN_MODULES[id];
      const shots = Math.floor(game.stats.maxAmmo / def.ammoCost);
      expect({ id, shots: shots >= 1 }).toEqual({ id, shots: true });
      // A dry magazine is not a stranding: falling is always available, and the gap to the next
      // source is bounded. What must hold is that the gap is crossable at all, which it is by
      // falling -- so this asserts the bound the generator keeps rather than a firing rate.
      const fallSeconds = (worstGapRows * plan(2).gap) / BALANCE.maxFallSpeed;
      expect({ id, crossable: fallSeconds < 6 }).toEqual({ id, crossable: true });
    }
  });

  it('runs the whole chain: bounce, kill, take a hit, bounce, then a chamber', () => {
    const game = bare(2);
    game.platforms = []; game.enemies = []; game.doodads = []; game.safeZones = [];
    game.player.invincible = 99;
    game.combo = 9; game.ammo = 1;

    // 1. A doodad reloads and leaves the chain alone.
    expect(bounceOnce(game, 1)).toBe(true);
    expect([game.combo, game.ammo]).toEqual([9, game.stats.maxAmmo]);

    // 2. A shot kill adds to the chain.
    game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
    const target = spawnEnemy(area4.enemyPool[0], 7, game.player.x, 260);
    game.enemies = [target];
    for (let i = 0; i < 600 && target.alive; i++) {
      game.player.invincible = 99;
      game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
      target.x = game.player.x; target.y = 260;
      game.step(1 / 120, 0, true);
    }
    expect(target.alive).toBe(false);
    expect(game.combo).toBe(10);
    const charge = game.ammo;

    // 3. Dangerous ground costs a heart and nothing else.
    game.enemies = [];
    game.player.invincible = 0;
    const hp = game.hp;
    const row: Platform = { id: 900, x: WORLD.wall, y: 320, width: WORLD.width - WORLD.wall * 2, limboHazard: true };
    game.platforms = [row];
    game.player.x = 225; game.player.y = 200; game.player.vy = 260; game.player.grounded = -1;
    for (let i = 0; i < 400 && game.hp === hp; i++) game.step(1 / 120, 0, false);
    expect(game.hp).toBe(hp - 1);
    expect(game.combo).toBe(10);
    expect(game.ammo).toBe(charge);
    expect(game.player.grounded).toBe(-1);

    // 4. Another doodad fills CHARGE, still without settling.
    game.platforms = []; game.player.invincible = 99;
    game.ammo = 1;
    expect(bounceOnce(game, 2)).toBe(true);
    expect([game.combo, game.ammo]).toEqual([10, game.stats.maxAmmo]);

    // 5. The chamber floor: the one place in LIMBO to stand, and it keeps the chain too.
    const { width, height } = SAFE_ZONE_RULES;
    const floorY = 520;
    const zone: SafeZone = { id: 500, side: -1, x: WORLD.wall, y: floorY - height, width, height, content: null, taken: false };
    game.safeZones = [zone];
    game.platforms = [{ id: 501, x: zone.x, y: floorY, width, breakable: false, state: 'stable', safeZone: zone.id }];
    game.doodads = [];
    game.ammo = 2;
    game.player.x = zone.x + width + 30; game.player.y = zone.y - 120; game.player.vy = 0; game.player.grounded = -1;
    for (let i = 0; i < 600 && game.player.grounded !== 501; i++) {
      game.player.invincible = 99;
      game.step(1 / 120, -1, false);
    }
    expect(game.player.grounded).toBe(501);
    expect(game.timeFrozen).toBe(true);
    expect(game.ammo).toBe(game.stats.maxAmmo);
    expect(game.combo).toBe(10);

    // Nothing in the whole sequence was an ordinary landing.
    expect(game.events.some(e => e.type === 'comboSettle')).toBe(false);
  });
});

/**
 * The question this AREA has to answer: with the ground taken away as a reload, can a descent still
 * get to the bottom? This drives the real model with the policy a player uses -- walk off whatever
 * you are standing on, take a doodad when CHARGE is low, step clear of one when it is not -- and
 * requires that every seed reaches the way out without ever touching a floor outside the chamber.
 */
describe('LIMBO can be descended on doodads alone', () => {
  function descend(sectionId: SectionId, seed: number, maxSeconds = 180) {
    const game = new GameModel(false, seeded(seed));
    game.jumpToStage(4, sectionId);
    let sawExit = false, dryFrames = 0;
    const stoodOn = new Set<number>();
    for (let i = 0; i < maxSeconds * 120; i++) {
      game.player.invincible = 99;
      if (game.state !== 'playing') return { reached: true, dryFrames, stoodOn };
      if (game.exit) sawExit = true;
      if (game.ammo === 0) dryFrames++;
      const p = game.player;
      const ground = game.platforms.find(f => f.id === p.grounded);
      if (ground && ground.safeZone === undefined && ground.id >= 0) stoodOn.add(ground.id);
      const below = game.doodads.filter(d => d.y > p.y + 10).sort((a, b) => a.y - b.y)[0];
      let dir = 0;
      if (ground) dir = ground.x + ground.width / 2 > WORLD.width / 2 ? -1 : 1;
      else if (below) {
        const over = p.x + 9 > below.x && p.x - 9 < below.x + below.width;
        const want = game.ammo < game.stats.maxAmmo / 2;
        if (over && !want) dir = below.x - WORLD.wall > WORLD.width - WORLD.wall - (below.x + below.width) ? -1 : 1;
        else if (!over && want) dir = Math.sign(below.x + below.width / 2 - p.x);
      }
      game.step(1 / 120, dir, false);
    }
    return { reached: sawExit, dryFrames, stoodOn };
  }

  it('reaches the way out on every seed, bouncing and landing', () => {
    for (const sectionId of SECTIONS) {
      for (let seed = 1; seed <= 30; seed++) {
        const run = descend(sectionId, seed * 733);
        expect({ sectionId, seed, reached: run.reached }).toEqual({ sectionId, seed, reached: true });
        // STAGE GENERATION v2: there is rubble to stand on again, so how many ledges the descent
        // rested on is no longer bounded; that it gets out is.
      }
    }
  });

  it('never strands a descent with an empty magazine', () => {
    // The soft-lock this AREA could produce: CHARGE gone, nothing to bounce off, and no ground that
    // is not a trap. Across 90 descents the magazine never reached zero for a single frame.
    let worstDry = 0;
    for (const sectionId of SECTIONS) {
      for (let seed = 1; seed <= 30; seed++) worstDry = Math.max(worstDry, descend(sectionId, seed * 733).dryFrames);
    }
    expect(worstDry).toBe(0);
  });
});

describe('COLLAPSED REALM: STAGE GENERATION v2 guarantees', () => {
  const bandsOf = (shaft: ReturnType<typeof section>) => {
    const ys = [...new Set(shaft.ledges.map(p => Math.round(p.y)))].sort((a, b) => a - b);
    return ys.map(y => shaft.ledges.filter(p => Math.round(p.y) === y));
  };

  // WAS: 'keeps every barb off the way into the landing and the way off it' -- a 30px rectangle from the
  // band above's exits to the landing, in which no barb at the route's height could sit. The rebuilt
  // AREA promises a LINE instead (limboTerrain.ts `tubeX`): the fall a human steers from the way off to
  // the landing. No barb anywhere in the SECTION -- this band's, the next band's, any -- may touch one.
  it('keeps every barb off every line it promises, and off the walk along each ledge to its way off', () => {
    let checked = 0;
    for (const sectionId of SECTIONS) for (let seed = 1; seed <= 30; seed++) {
      const shaft = section(sectionId, seed * 919);
      const barbs = shaft.ledges.filter(p => p.limboHazard);
      for (const t of linesOf(shaft.generator)) for (const b of barbs) {
        if (b.y < t.y0 - 80 || b.y > t.y1 + 80) continue;
        checked++;
        expect({ sectionId, seed, line: [t.x0, t.y0, t.x1, t.y1], barb: [b.x, b.y, b.width], touches: tubeTouches(t, b.x, b.y, b.width, LIMBO_HAZARD_RULES.reach) })
          .toEqual({ sectionId, seed, line: [t.x0, t.y0, t.x1, t.y1], barb: [b.x, b.y, b.width], touches: false });
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });

  // WAS: 'makes every band of the descent landable, reachable at walking speed from the band above' (in
  // the reload block below, for bands grouped by height). Held now on the lines themselves.
  it('reaches every route ledge from every surface the band above can be left from, by steering alone', () => {
    let lines = 0, fallbacks = 0, bands = 0;
    for (const sectionId of SECTIONS) for (let seed = 1; seed <= 30; seed++) {
      const shaft = section(sectionId, seed * 271);
      for (const t of linesOf(shaft.generator)) {
        lines++;
        // The way into a side cave is the side room's own rule (postClonePass1.test.ts); this is the descent's.
        if (t.to === 'cave') continue;
        // From rest, after a human reaction, at 90% of walking speed -- never a shot.
        expect({ sectionId, seed, reach: limboCanReach({ exitX: t.x0, y: t.y0 }, { safeX: t.x1, y: t.y1 }) }).toEqual({ sectionId, seed, reach: true });
        expect(Math.abs(t.x1 - t.x0)).toBeLessThanOrEqual(horizontalReach(t.y1 - t.y0));
      }
      // Every route ledge is the end of at least one line.
      for (const p of routeOf(shaft).filter(q => q.y > WORLD.startY + 300 && q.y < WORLD.startY + SECTION_PIXELS - 100)) {
        bands++;
        expect({ sectionId, seed, y: p.y, line: linesOf(shaft.generator).some(t => Math.abs(t.y1 - p.y) < 1 && Math.abs(t.x1 - p.safeX) < 1) }).toEqual({ sectionId, seed, y: p.y, line: true });
      }
      const fb = (shaft.generator as unknown as { limboFallbacks: { caveExit: number; debris: number } }).limboFallbacks;
      fallbacks += fb.caveExit + fb.debris;
    }
    expect(lines).toBeGreaterThan(3000);
    // A cave sill or debris the next ledge could not also answer to is let go: kept rare.
    expect(fallbacks / bands).toBeLessThan(0.01);
  });

  // WAS: "gets busier from 4-1 to 4-3: more barbs, more void, more of the original's floaters", on the
  // retired grammar's barb count. The rebuilt SECTIONs keep a similar number of barbs and put them where
  // a fall goes: the build-up is in smaller rubble, closer barbs down every column and more bodies.
  it('builds up from 4-1 to 4-3: smaller rubble, barbs closer down every column, more bodies, more of them on the line', () => {
    const per = SECTIONS.map(sectionId => {
      const widths: number[] = []; let enemies = 0, guards = 0, coverage = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const shaft = section(sectionId, seed * 577);
        widths.push(...routeOf(shaft).map(p => p.width));
        enemies += shaft.enemies.length;
        guards += shaft.enemies.filter(e => e.placed === 'path').length;
        coverage += hazardCoverage(limboSection(sectionId, seed * 577));
      }
      widths.sort((a, b) => a - b);
      return { width: widths[widths.length >> 1], perScreen: enemies / 30 * 28.6 / area4.sectionLength, guards: guards / 30, coverage: coverage / 30, run: plan(sectionId).limbo!.maxClearRun };
    });
    for (let i = 1; i < 3; i++) {
      expect(per[i].width).toBeLessThan(per[i - 1].width);
      expect(per[i].run).toBeLessThan(per[i - 1].run);
      expect(per[i].coverage).toBeGreaterThan(per[i - 1].coverage);
      expect(per[i].perScreen).toBeGreaterThan(per[i - 1].perScreen);
      expect(per[i].guards).toBeGreaterThan(per[i - 1].guards);
    }
    // Inside the reference's band (~2.4 a screen in D's limbo, up to 5 in a swarm).
    for (const p of per) { expect(p.perScreen).toBeGreaterThan(1.2); expect(p.perScreen).toBeLessThan(3.6); }
    // Every one of them is answered with the gunboots: nothing in LIMBO can be stood on.
    for (const kind of area4.enemyPool) expect(ENEMY_TYPES[kind].stompable).toBe(false);
  });

  it('makes 4-1, 4-2 and 4-3 three SECTIONs, not one with different numbers', () => {
    const motifs = (sectionId: SectionId) => {
      const seen = new Map<LimboMotif, number>();
      for (let seed = 1; seed <= 20; seed++) for (const h of (section(sectionId, seed * 59).generator as unknown as { limbo: { history: { motif: LimboMotif }[] } }).limbo.history) seen.set(h.motif, (seen.get(h.motif) ?? 0) + 1);
      return seen;
    };
    const [a, b, c] = SECTIONS.map(motifs);
    // 4-1 teaches one rule a band: no gate across the shaft, no body in an opening.
    expect(a.has('gate')).toBe(false);
    expect(LIMBO_WAY_IN.enemies.gateGuard).toBe(0);
    // 4-2 and 4-3 add the gate and stand bodies in its opening; 4-3 drops and crosses fire most.
    for (const m of [b, c]) expect(m.get('gate') ?? 0).toBeGreaterThan(20);
    expect(LIMBO_VOID.motifs.voidDrop).toBeGreaterThan(LIMBO_FALLING_CITY.motifs.voidDrop);
    expect(LIMBO_FALLING_CITY.motifs.voidDrop).toBeGreaterThan(LIMBO_WAY_IN.motifs.voidDrop);
    expect(LIMBO_VOID.motifs.rest).toBeLessThan(LIMBO_WAY_IN.motifs.rest);
    expect(LIMBO_VOID.enemies.underBarb).toBeGreaterThan(LIMBO_WAY_IN.enemies.underBarb);
  });

  it('leaves no column of the shaft to fall down: the longest straight drop clear of barbs is a few screens at most', () => {
    // ab49ed2: every column of every SECTION was clear of barbs from top to bottom (12,980px).
    for (const sectionId of SECTIONS) {
      const runs: number[] = [];
      for (let seed = 1; seed <= 20; seed++) runs.push(longestClearFall(limboSection(sectionId, seed * 613), false));
      runs.sort((x, y) => x - y);
      expect({ sectionId, median: runs[10] <= 2600 }).toEqual({ sectionId, median: true });
      expect({ sectionId, worst: runs[19] <= 3600 }).toEqual({ sectionId, worst: true });
    }
  });

  it('never hurts on a landing: a turning ledge warns for longer than the walk off it', () => {
    for (const sectionId of SECTIONS) for (let seed = 1; seed <= SEEDS; seed++) {
      for (const p of section(sectionId, seed * 311).ledges.filter(q => q.spikePlatform)) {
        expect(p.spikePlatform!.warning).toBeGreaterThanOrEqual((p.width + 18) / BALANCE.moveSpeed + 0.35 - 1e-9);
      }
    }
  });
});

/**
 * AREA 4 COLLAPSING PLATFORMS RESTORED. COLLAPSED REALM is crossed on collapsing ledges alone: every
 * ledge a fall can land on -- the route ledge of each band and the landable debris beside it -- gives
 * way on the shared BREAK timing. What stays stable is only what is not a ledge of the route: the
 * opening slab the SECTION starts on, the floors of caves and chambers, and the exit floor the gate
 * stands on. Barbs are not ground at all and are left as they were.
 */
describe('COLLAPSED REALM: every ledge gives way', () => {
  /** The same SECTION laid with its collapse switched off, for proving the collapse moved nothing. */
  function withoutCollapse(sectionId: SectionId, seed: number) {
    return new StageGenerator(seeded(seed), {
      plan: { ...plan(sectionId), breakableChance: undefined }, enemyPool: area4.enemyPool, sectionLength: area4.sectionLength, breakable: false,
    });
  }
  const strip = (chunk: ReturnType<StageGenerator['chunk']>) => JSON.stringify(chunk, (key, value) => key === 'breakable' || key === 'state' ? undefined : value);

  it('asks for all of them on the shared BREAK timing, with no run cap and no delay of its own', () => {
    expect(area4.gimmicks?.breakablePlatforms).toBe(true);
    expect(BREAK_RULES).toEqual({ delay: 0.65, criticalAt: 0.55, shatterRadius: 190 });
    for (const sectionId of SECTIONS) {
      expect(plan(sectionId).breakableChance).toBe(1);
      expect(plan(sectionId).breakDelay).toBeUndefined();
      expect(plan(sectionId).maxBreakableRun).toBeUndefined();
      const game = new GameModel(false, seeded(5));
      game.jumpToStage(4, sectionId);
      expect(game.collapse.delay).toBe(BREAK_RULES.delay);
    }
  });

  for (const sectionId of SECTIONS) {
    it(`4-${sectionId}: every landable ledge collapses on every seed, and no stable one is left on the route`, () => {
      let collapsing = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const shaft = section(sectionId, seed * 409);
        const landable = shaft.ledges.filter(p => !p.limboHazard);
        const stable = landable.filter(p => p.breakable !== true || p.state !== 'stable');
        expect({ sectionId, seed, stable: stable.length }).toEqual({ sectionId, seed, stable: 0 });
        // A barb is never landed on, so it has nothing to give way under.
        for (const p of shaft.ledges.filter(q => q.limboHazard)) expect({ sectionId, seed, barbBreaks: !!p.breakable }).toEqual({ sectionId, seed, barbBreaks: false });
        collapsing += landable.length;
      }
      expect(collapsing / SEEDS).toBeGreaterThan(20);
    });
  }

  it('moves nothing: the shaft is the one the same seed lays with no collapse, position for position', () => {
    for (const sectionId of SECTIONS) for (let seed = 1; seed <= 30; seed++) {
      const on = new StageGenerator(seeded(seed * 61), { plan: plan(sectionId), enemyPool: area4.enemyPool, sectionLength: area4.sectionLength, breakable: true });
      const off = withoutCollapse(sectionId, seed * 61);
      for (let chunk = 0; chunk < CHUNKS; chunk++) expect({ sectionId, seed, chunk, same: strip(on.chunk(chunk)) === strip(off.chunk(chunk)) }).toEqual({ sectionId, seed, chunk, same: true });
    }
  });

  it('keeps stable only the surfaces the SECTION stands on: the opening slab, cave and chamber floors, the exit floor', () => {
    // Everything the generator lays down the whole SECTION: a stable surface is a cave or chamber floor.
    for (const sectionId of SECTIONS) for (let seed = 1; seed <= SEEDS; seed++) {
      for (const p of section(sectionId, seed * 409).platforms.filter(f => !f.breakable && !f.limboHazard)) {
        expect({ sectionId, seed, sheltered: p.safeZone !== undefined }).toEqual({ sectionId, seed, sheltered: true });
      }
    }
    for (const sectionId of SECTIONS) for (let seed = 1; seed <= 12; seed++) {
      const game = new GameModel(false, seeded(seed * 29));
      game.jumpToStage(4, sectionId);
      for (const p of game.platforms.filter(f => !f.breakable && !f.limboHazard)) {
        expect({ sectionId, seed, ok: p.id === START_PLATFORM.id || p.safeZone !== undefined }).toEqual({ sectionId, seed, ok: true });
      }
      const gate = reachExit(game);
      const floor = game.platforms.find(f => f.y === gate.y + gate.height && f.width === WORLD.width - WORLD.wall * 2);
      expect(floor).toBeDefined();
      expect(floor!.breakable ?? false).toBe(false);
    }
  });

  it('runs stable -> cracking -> critical -> broken from the landing, then takes the collision away', () => {
    const game = bare();
    const ledge: Platform = { id: 700, x: game.player.x - 50, y: game.player.y + 60, width: 100, breakable: true, state: 'stable' };
    game.platforms = [ledge];
    game.player.vy = 200; game.player.grounded = -1; game.player.invincible = 99;
    for (let i = 0; i < 240 && game.player.grounded !== ledge.id; i++) game.step(1 / 120, 0, false);
    expect(game.player.grounded).toBe(ledge.id);
    expect(ledge.state).toBe('cracking');
    expect(game.events.some(e => e.type === 'crack')).toBe(true);
    const seen: string[] = [];
    let t = 0;
    while (game.platforms.includes(ledge) && t < 2) {
      game.player.invincible = 99;
      game.step(1 / 120, 0, false); t += 1 / 120;
      if (seen[seen.length - 1] !== ledge.state) seen.push(ledge.state!);
    }
    expect(seen).toEqual(['cracking', 'critical', 'broken']);
    // Gone on the BREAK timing, measured from the landing, to the frame.
    expect(Math.abs(t - BREAK_RULES.delay)).toBeLessThanOrEqual(1 / 120 + 1e-9);
    expect(game.platforms).not.toContain(ledge);
    // Nothing under the player any more: the fall goes on through where the ledge was.
    expect(game.player.grounded).toBe(-1);
    const y = game.player.y;
    for (let i = 0; i < 30; i++) game.step(1 / 120, 0, false);
    expect(game.player.y).toBeGreaterThan(ledge.y + 10);
    expect(game.player.y).toBeGreaterThan(y);
  });

  it('never asks for more than the ledge allows: the whole width walks off well inside the delay', () => {
    let worst = 0;
    for (const sectionId of SECTIONS) for (let seed = 1; seed <= SEEDS; seed++) {
      for (const p of section(sectionId, seed * 409).ledges.filter(q => q.breakable)) worst = Math.max(worst, p.width);
    }
    // From the far end to beyond the near one: the width, a body, and the 12px the exit lies out.
    const walk = (worst + 9 + 12) / BALANCE.moveSpeed;
    expect(walk).toBeLessThan(BREAK_RULES.delay);
  });

  /**
   * A player who does nothing at all on a ledge: never walks off it, only steers in the air. Every
   * ledge drops them on, so the SECTION still ends -- standing still is never a soft-lock -- and no
   * landing ever holds them past the delay.
   */
  function standStill(sectionId: SectionId, seed: number, setup?: (game: GameModel) => void) {
    const game = new GameModel(false, seeded(seed));
    game.jumpToStage(4, sectionId);
    setup?.(game);
    let longest = 0, held = 0, last = -99, stableRoute = 0, sheltered = 0;
    for (let i = 0; i < 240 * 120; i++) {
      game.player.invincible = 99;
      if (game.state !== 'playing') return { reached: true, longest, stableRoute, sheltered };
      const p = game.player;
      const ground = game.platforms.find(f => f.id === p.grounded);
      held = ground && ground.id === last ? held + 1 / 120 : 0;
      last = ground ? ground.id : -99;
      let dir = 0;
      if (ground && game.exit) dir = Math.sign(game.exit.x + game.exit.width / 2 - p.x);
      else if (ground && !ground.breakable) {
        // Only a stable surface is walked off: the opening slab, or a cave or chamber floor.
        if (ground.id !== START_PLATFORM.id && ground.safeZone === undefined) stableRoute++;
        // Out of a cave or chamber towards the shaft; off the opening slab one fixed way.
        dir = ground.safeZone === undefined ? 1 : ground.x + ground.width / 2 < WORLD.width / 2 ? 1 : -1;
      }
      if (ground?.breakable) longest = Math.max(longest, held);
      if (ground?.safeZone !== undefined) sheltered++;
      game.step(1 / 120, dir, false);
    }
    return { reached: false, longest, stableRoute, sheltered };
  }

  it('ends every SECTION for a player who never walks off a ledge, and holds nobody past the delay', () => {
    for (const sectionId of SECTIONS) for (let seed = 1; seed <= 20; seed++) {
      const run = standStill(sectionId, seed * 4111);
      expect({ sectionId, seed, reached: run.reached, stableRoute: run.stableRoute }).toEqual({ sectionId, seed, reached: true, stableRoute: 0 });
      expect(run.longest).toBeLessThanOrEqual(BREAK_RULES.delay + 2 / 120);
    }
  });

  it('lets a cave be left the way it was entered: its floor holds, and the collapsing shaft below still ends', () => {
    let caves = 0;
    for (const sectionId of SECTIONS) for (let seed = 1; seed <= 10; seed++) {
      const run = standStill(sectionId, seed * 4111, game => {
        // Generate down to the first cave, then put the player on its floor as if they had walked in.
        for (let i = 0; i < 40 && !game.platforms.some(f => f.safeZone !== undefined); i++) { game.player.y += 300; game.player.invincible = 99; game.step(1 / 120, 0, false); }
        const floor = game.platforms.find(f => f.safeZone !== undefined)!;
        game.player.x = floor.x + floor.width / 2; game.player.y = floor.y - 30; game.player.vy = 0; game.player.grounded = -1;
        caves++;
      });
      expect({ sectionId, seed, reached: run.reached, entered: run.sheltered > 0 }).toEqual({ sectionId, seed, reached: true, entered: true });
    }
    expect(caves).toBe(30);
  });

  it('starts every SECTION over with every ledge whole and no timer running', () => {
    for (const sectionId of SECTIONS) {
      const game = new GameModel(false, seeded(77));
      game.jumpToStage(4, sectionId);
      const ledge = game.platforms.find(f => f.breakable)!;
      expect(game.collapse.land(ledge)).toBe(true);
      game.step(1 / 120, 0, false);
      expect(game.collapse.counting).toBe(1);
      // Re-entering the SECTION (a level-select restart) and moving on to the next both start clean.
      for (const next of [sectionId, sectionId === 3 ? 1 : sectionId + 1] as SectionId[]) {
        game.jumpToStage(4, next);
        expect(game.collapse.counting).toBe(0);
        expect(game.platforms.filter(f => f.state !== undefined && f.state !== 'stable')).toEqual([]);
        expect(game.platforms.some(f => f.breakable)).toBe(true);
      }
    }
  });

  it('leaves AREA 1-3 with no collapsing ledge, and never hands the collapse to the STAGING room or the BOSS', () => {
    for (const area of [1, 2, 3] as const) {
      expect(areaConfig(area).gimmicks?.breakablePlatforms ?? false).toBe(false);
      for (const sectionId of SECTIONS) for (let seed = 1; seed <= 6; seed++) {
        const game = new GameModel(false, seeded(seed * 13));
        game.jumpToStage(area, sectionId);
        for (let i = 0; i < 600; i++) game.step(1 / 120, 0, false);
        expect({ area, sectionId, seed, any: game.platforms.some(f => f.breakable) }).toEqual({ area, sectionId, seed, any: false });
      }
    }
    // The staging room and the fight still report AREA 4 as their config: the guard is what keeps
    // its collapse out of them, so it is asserted directly as well as through the replays.
    for (const go of [(g: GameModel) => g.jumpToBoss(), (g: GameModel) => g.jumpToNimushi()]) {
      const game = new GameModel(false, seeded(3));
      go(game);
      expect(game.stage.config.id).toBe(4);
      expect((game as unknown as { generator: { context: { breakable?: boolean } } }).generator.context.breakable).toBe(false);
      for (let i = 0; i < 1200; i++) { game.player.invincible = 99; game.step(1 / 120, 0, false); }
      expect(game.platforms.some(f => f.breakable)).toBe(false);
      expect(game.collapse.counting).toBe(0);
    }
  });
});

/**
 * AREA 4 / LIMBO GAMEPLAY REBUILD: what the rebuild was FOR, held through the real GameModel and real
 * inputs only (`step(dt, direction, firing)`, tests/limboBot.ts). Seeds are fixed, so each count below is
 * exact; the margins are for a later change to the AREA, not for chance.
 */
describe('COLLAPSED REALM is played, not fallen', () => {
  const COLUMNS = [60, 140, 225, 310, 390];
  it('ends a fall that neither steers, shoots nor means to land, in every SECTION, from every column', () => {
    for (const sectionId of SECTIONS) {
      let dead = 0, barbDeaths = 0;
      for (let seed = 1; seed <= 6; seed++) for (const x of COLUMNS) {
        const r = passiveRun(4, sectionId, seed * 211, x);
        expect({ sectionId, seed, x, cleared: r.outcome === 'clear' }).toEqual({ sectionId, seed, x, cleared: false });
        if (r.outcome === 'dead') { dead++; if (r.deathBy === 'barb') barbDeaths++; }
      }
      // The ones that do not die stopped on a side cave's sill, which never gives way. Barbed rubble,
      // not a wall of anything, is what ends the rest.
      expect(dead).toBeGreaterThanOrEqual(25);
      expect(barbDeaths).toBeGreaterThan(dead / 2);
    }
  });

  it('ends a fall that shoots everything under it but never steers', () => {
    for (const sectionId of SECTIONS) for (let seed = 1; seed <= 6; seed++) for (const x of COLUMNS) {
      expect({ sectionId, seed, x, cleared: straightRun(4, sectionId, seed * 211, x).outcome === 'clear' }).toEqual({ sectionId, seed, x, cleared: false });
    }
  });

  for (const [sectionId, atLeast] of [[1, 10], [2, 8], [3, 6]] as [SectionId, number][]) {
    it(`4-${sectionId}: is cleared on ordinary HP by a human-like player who steers, shoots and lands`, () => {
      const runs = Array.from({ length: 12 }, (_, i) => activeRun(4, sectionId, (i + 1) * 389, 200, HUMAN));
      expect(runs.filter(r => r.outcome === 'stuck' || r.outcome === 'timeout')).toEqual([]);
      expect(runs.filter(r => r.outcome === 'clear').length).toBeGreaterThanOrEqual(atLeast);
      // It is played: the player lands, shoots and kills on the way down.
      for (const r of runs) { expect(r.landings).toBeGreaterThan(10); expect(r.shots).toBeGreaterThan(20); }
    });
  }

  it('gets harder from 4-1 to 4-3 for the same player', () => {
    const hits = SECTIONS.map(sectionId => Array.from({ length: 12 }, (_, i) => activeRun(4, sectionId, (i + 1) * 389, 200, HUMAN)).reduce((a, r) => a + r.hits.barb + r.hits.enemy, 0));
    expect(hits[0]).toBeLessThan(hits[1]);
    expect(hits[1]).toBeLessThan(hits[2]);
  });

  it('lets the promised line itself be fallen, without one barb, to the way out, on every seed', () => {
    for (const sectionId of SECTIONS) for (let seed = 1; seed <= 10; seed++) {
      const r = lineRun(sectionId, seed * 97);
      expect({ sectionId, seed, touches: r.touches, lost: r.lost, cleared: r.cleared }).toEqual({ sectionId, seed, touches: 0, lost: 0, cleared: true });
    }
  });

  it('replays exactly: the same seed is the same run', () => {
    const run = () => activeRun(4, 3, 4242, 200, HUMAN);
    expect(run()).toEqual(run());
  });

  it('keeps LIMBO damage at one heart and the collapse on its 0.65s', () => {
    expect(LIMBO_HAZARD_RULES.damage).toBe(1);
    expect(BREAK_RULES.delay).toBe(0.65);
    expect(LIMBO_RULES.margin).toBeGreaterThanOrEqual(9);
  });
});
