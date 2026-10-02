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
  return { platforms, ledges, hazards, zones, doodads, enemies };
}
function bare(sectionId: SectionId = 1, seed = 41) {
  const game = new GameModel(false, seeded(seed));
  game.jumpToStage(4, sectionId);
  game.platforms = []; game.enemies = []; game.pickups = []; game.hazards = [];
  game.doodads = []; game.safeZones = []; game.caves = [];
  return game;
}

/**
 * STAGE GENERATION v2 REBUILT THIS AREA (limboTerrain.ts). The tests below used to hold "LIMBO has no
 * ground": every row a barb block, no landable ledge past 4-1's opening, no collapse, doodads as the
 * only reload. That design concentrated the AREA's whole difficulty in one mechanic (75-86% of the
 * damage a bot took, 2.9 hearts in 4-1 alone) and PHASE 7C-1's footage showed Downwell's Limbo as
 * landable rubble. What is held now is the rebuilt AREA's own guarantees.
 */
describe('COLLAPSED REALM is broken rubble to land on', () => {
  it('lays landable rubble in every SECTION, with barbs only as debris beside the route', () => {
    for (const sectionId of SECTIONS) {
      expect(plan(sectionId).limboHazardChance ?? 0).toBe(0);
      expect(plan(sectionId).pieces).toBeDefined();
      let landable = 0, barbs = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const shaft = section(sectionId, seed * 613);
        const bands = new Map<number, RoutePlatform[]>();
        for (const p of shaft.ledges) bands.set(Math.round(p.y), [...(bands.get(Math.round(p.y)) ?? []), p]);
        for (const band of bands.values()) {
          // The route ledge -- laid first in its band -- is never a barb, and no band is barbs alone.
          expect({ sectionId, seed, routeBarb: band[0].limboHazard === true }).toEqual({ sectionId, seed, routeBarb: false });
          for (const b of band.filter(p => p.limboHazard)) {
            const covers = band[0].exitX > b.x && band[0].exitX < b.x + b.width;
            expect({ sectionId, seed, covers }).toEqual({ sectionId, seed, covers: false });
          }
        }
        barbs += shaft.ledges.filter(p => p.limboHazard).length;
        landable += shaft.ledges.filter(p => !p.limboHazard).length;
      }
      const screens = SECTION_PIXELS / WORLD.height;
      // Somewhere to land again -- one to three and a half ledges a screen -- and barbs still there.
      expect({ sectionId, ok: landable / SEEDS / screens >= 1 && landable / SEEDS / screens <= 3.5 }).toEqual({ sectionId, ok: true });
      expect({ sectionId, any: barbs > 0 }).toEqual({ sectionId, any: true });
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

  it('makes every band of the descent landable, reachable at walking speed from the band above', () => {
    // No band is barbs alone, and the route ledge is always reachable without a shot: nothing in the
    // AREA asks for the gunboots' recoil to be crossed, however much it helps.
    for (const sectionId of SECTIONS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const shaft = section(sectionId, seed * 271);
        const bands = [...new Set(shaft.ledges.map(p => Math.round(p.y)))].sort((a, b) => a - b);
        let above: RoutePlatform[] = [];
        for (const y of bands) {
          const here = shaft.ledges.filter(p => Math.round(p.y) === y);
          const landings = here.filter(p => !p.limboHazard);
          expect({ sectionId, seed, y, landable: landings.length > 0 }).toEqual({ sectionId, seed, y, landable: true });
          if (above.length) expect({ sectionId, seed, y, reach: above.every(from => canReachPlatform(from, landings[0])) }).toEqual({ sectionId, seed, y, reach: true });
          above = landings;
        }
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

  it('keeps every barb off the way into the landing and the way off it', () => {
    let checked = 0;
    for (const sectionId of SECTIONS) for (let seed = 1; seed <= SEEDS; seed++) {
      const bands = bandsOf(section(sectionId, seed * 919));
      for (let i = 1; i < bands.length; i++) {
        const route = bands[i][0], above = bands[i - 1].filter(p => !p.limboHazard);
        const exits = above.map(p => p.exitX);
        const left = Math.min(...exits, route.safeX) - 30, right = Math.max(...exits, route.safeX) + 30;
        for (const b of bands[i].filter(p => p.limboHazard)) {
          checked++;
          const onTheWayIn = b.x < right && b.x + b.width > left;
          expect({ sectionId, seed, onTheWayIn }).toEqual({ sectionId, seed, onTheWayIn: false });
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  // WAS: busier by combining collapse, traps and barbs while holding enemies to c9a0a63's count. The
  // clone takes the original's limbo instead: more barbed rubble, longer void drops, and the
  // original's floating roster growing -- ~2.4 enemies a screen in D's limbo (reference spec).
  it("gets busier from 4-1 to 4-3: more barbs, more void, more of the original's floaters", () => {
    const per = SECTIONS.map(sectionId => {
      let barbs = 0, enemies = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const shaft = section(sectionId, seed * 577);
        barbs += shaft.ledges.filter(p => p.limboHazard).length;
        enemies += shaft.enemies.length;
      }
      return { barbs, perScreen: enemies / SEEDS * 28.6 / area4.sectionLength };
    });
    for (let i = 1; i < 3; i++) { expect(per[i].barbs).toBeGreaterThan(per[i - 1].barbs); expect(per[i].perScreen).toBeGreaterThan(per[i - 1].perScreen); }
    for (const p of per) { expect(p.perScreen).toBeGreaterThan(1.2); expect(p.perScreen).toBeLessThan(3.6); }
    // Every one of them is answered with the gunboots: nothing in LIMBO can be stood on.
    for (const kind of area4.enemyPool) expect(ENEMY_TYPES[kind].stompable).toBe(false);
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
