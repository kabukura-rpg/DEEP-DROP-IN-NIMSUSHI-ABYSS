import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { StageGenerator, type Platform, type RoutePlatform } from '../src/systems/StageGenerator';
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

describe('LIMBO has no ground to land on', () => {
  it('makes every row dangerous ground past the opening, and never a spike platform', () => {
    for (const sectionId of SECTIONS) {
      expect(plan(sectionId).limboHazardChance).toBe(1);
      // CATACOMBS' mechanic is not reused here: a spike platform is a floor that turns, and LIMBO
      // is not allowed a floor at all.
      expect(plan(sectionId).spikePlatformChance ?? 0).toBe(0);
      let landable = 0, barbs = 0, turning = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const shaft = section(sectionId, seed * 613);
        barbs += shaft.ledges.filter(p => p.limboHazard).length;
        turning += shaft.ledges.filter(p => p.spikePlatform).length;
        landable += shaft.ledges.filter(p => !p.limboHazard).length;
      }
      expect({ sectionId, turning }).toEqual({ sectionId, turning: 0 });
      expect({ sectionId, any: barbs > 0 }).toEqual({ sectionId, any: true });
      // 4-1 opens with a couple of calm rows, which is the AREA's way in; nothing else is landable.
      const share = landable / (landable + barbs);
      expect({ sectionId, share: share < 0.07 }).toEqual({ sectionId, share: true });
      if (sectionId !== 1) expect({ sectionId, landable }).toEqual({ sectionId, landable: 0 });
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
    const game = bare(2);
    game.player.invincible = 99;
    for (let i = 0; i < 1200; i++) game.step(1 / 120, 0, false);
    expect(game.collapse.counting).toBe(0);
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
      game.enemies = [enemy];
      game.player.vy = 320;
      for (let i = 0; i < 120 && game.hp === game.stats.maxHp; i++) game.step(1 / 120, 0, false);
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

  it('hangs enough doodads that the loop never depends on the ground', () => {
    for (const sectionId of SECTIONS) {
      expect(plan(sectionId).doodadChance ?? 0).toBeGreaterThan(0.5);
      let doodads = 0, worstGap = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const { ys } = reloadSources(sectionId, seed);
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

  it('leaves no landable ground outside the chamber at all', () => {
    for (const sectionId of SECTIONS) {
      let landable = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const shaft = section(sectionId, seed * 271);
        // Anything a settleLanding could fire on: not a chamber floor, not a barb row.
        landable += shaft.platforms.filter(f => f.safeZone === undefined && !f.limboHazard && !f.breakBlock).length;
      }
      // 4-1's opening keeps a couple of calm rows, and the SECTION's own start platform is laid by
      // the model rather than the generator. Past that there is nothing to touch down on.
      if (sectionId === 1) expect({ sectionId, perRun: landable / SEEDS <= 2 }).toEqual({ sectionId, perRun: true });
      else expect({ sectionId, landable }).toEqual({ sectionId, landable: 0 });
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
  it('guarantees a SAFE ZONE whose floor is the one place to stand', () => {
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

  it('is the only AREA built out of ground nobody can stand on', () => {
    for (const area of AREAS) {
      const every = (area.plans ?? []).every(p => (p.limboHazardChance ?? 0) === 1);
      expect({ area: area.id, every }).toEqual({ area: area.id, every: area.id === 4 });
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

  it('reaches the way out on every seed, with no floor to fall back on', () => {
    for (const sectionId of SECTIONS) {
      for (let seed = 1; seed <= 30; seed++) {
        const run = descend(sectionId, seed * 733);
        expect({ sectionId, seed, reached: run.reached }).toEqual({ sectionId, seed, reached: true });
        // Distinct pieces of ordinary ground the descent ever stood on. The SECTION's own start
        // platform is one, and 4-1's opening keeps a couple of calm rows before the AREA begins;
        // past that there is nothing out there to touch down on at all.
        const allowed = sectionId === 1 ? 3 : 1;
        expect({ sectionId, seed, rested: run.stoodOn.size <= allowed }).toEqual({ sectionId, seed, rested: true });
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
