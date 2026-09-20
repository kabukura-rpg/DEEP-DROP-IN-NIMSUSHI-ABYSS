import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { StageGenerator, START_PLATFORM, type Platform, type RoutePlatform } from '../src/systems/StageGenerator';
import { ENEMY_TYPES, type EnemyKind } from '../src/data/enemies';
import { areaConfig, type SectionId } from '../src/data/areas';
import { horizontalReach } from '../src/data/difficulty';
import { SPIKE_PLATFORM_RULES, spikePlatform } from '../src/data/structures';
import { DOODAD_RULES } from '../src/data/doodads';
import { WORLD } from '../src/data/balance';
import type { SafeZone } from '../src/data/safeZone';
import type { Hazard } from '../src/data/hazards';

/**
 * AREA 2 carries the CATACOMBS role: the ground is the threat.
 *
 * A ledge is safe to arrive on and stops being safe a moment later. That is the whole AREA, and the
 * thing that makes it fair rather than cruel is that every part of it is ordinary: landing is an
 * ordinary landing, the warning always runs first, and what the spikes cost is a heart through
 * HealthSystem rather than the run. Water belongs to AREA 3 now and none of it may be left here.
 */
const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const area2 = areaConfig(2);
const plan = (section: SectionId) => area2.plans![section - 1];
const SECTION_PIXELS = area2.sectionLength * WORLD.pixelsPerMeter;
const CHUNKS = Math.ceil((WORLD.startY + SECTION_PIXELS) / WORLD.chunkHeight) + 1;
const SEEDS = 60;
const SECTIONS: SectionId[] = [1, 2, 3];

/** One whole SECTION, exactly as the model would build it. */
function section(sectionId: SectionId, seed: number) {
  const generator = new StageGenerator(seeded(seed), {
    plan: plan(sectionId), enemyPool: area2.enemyPool, sectionLength: area2.sectionLength,
  });
  const platforms: RoutePlatform[] = [], hazards: Hazard[] = [], zones: SafeZone[] = [];
  const doodads: { x: number; y: number; width: number; height: number }[] = [];
  const containers: { x: number; y: number }[] = [];
  const enemies: { kind: EnemyKind; y: number }[] = [];
  let exit: { x: number; y: number; width: number; height: number } | undefined;
  for (let chunk = 0; chunk < CHUNKS; chunk++) {
    const built = generator.chunk(chunk);
    platforms.push(...built.platforms.filter(p => p.y <= WORLD.startY + SECTION_PIXELS));
    hazards.push(...built.hazards); zones.push(...built.safeZones);
    doodads.push(...built.doodads); containers.push(...built.containers);
    enemies.push(...built.enemies);
    if (built.exit) exit = built.exit;
  }
  return { platforms, hazards, zones, doodads, containers, enemies, exit };
}
/** A run parked in an AREA 2 section with the shaft cleared, so a test owns what exists. */
function bare(sectionId: SectionId = 1, seed = 21) {
  const game = new GameModel(false, seeded(seed));
  game.jumpToStage(2, sectionId);
  game.platforms = []; game.enemies = []; game.pickups = []; game.hazards = [];
  game.doodads = []; game.safeZones = []; game.containers = [];
  game.player.invincible = 0;
  return game;
}
const tick = (game: GameModel, seconds: number, direction = 0, fire = false) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) game.step(1 / 120, direction, fire);
};
/** One spike platform under the player, and the fall that lands on it. */
function onSpikeGround(game: GameModel, floorY = game.player.y + 90) {
  const ledge: Platform = { id: 900, x: WORLD.wall, y: floorY, width: 220, breakable: false, state: 'stable', spikePlatform: spikePlatform() };
  game.platforms = [ledge];
  game.player.x = ledge.x + 110; game.player.vy = 260; game.player.grounded = -1;
  for (let i = 0; i < 400 && game.player.grounded !== ledge.id; i++) game.step(1 / 120, 0, false);
  return ledge;
}

describe('SPIKE PLATFORM: ground that turns, and never kills', () => {
  it('reads its whole cycle from data, marked unmeasured', () => {
    for (const key of ['warning', 'active', 'cooldown'] as const) expect(SPIKE_PLATFORM_RULES[key]).toBeGreaterThan(0);
    expect(SPIKE_PLATFORM_RULES.damage).toBe(1);
    expect(SPIKE_PLATFORM_RULES.reach).toBeGreaterThan(0);
  });

  it('starts safe, and landing is the only thing that arms it', () => {
    const game = bare();
    const ledge: Platform = { id: 900, x: WORLD.wall, y: 600, width: 200, breakable: false, state: 'stable', spikePlatform: spikePlatform() };
    game.platforms = [ledge];
    game.player.invincible = 99;
    // Hanging in the air above it, for far longer than the whole cycle, changes nothing.
    for (let i = 0; i < 600; i++) { game.player.y = 300; game.player.vy = 0; game.player.grounded = -1; game.step(1 / 120, 0, false); }
    expect(ledge.spikePlatform!.state).toBe('safe');
    expect(game.hp).toBe(game.stats.maxHp);
  });

  it('gives a warning before the spikes, so landing itself never costs a heart', () => {
    const game = bare();
    game.player.invincible = 0;
    const ledge = onSpikeGround(game);
    expect(game.player.grounded).toBe(ledge.id);
    const hp = game.hp;
    // The frame it lands on: armed, warning, and nothing taken.
    expect(ledge.spikePlatform!.state).toBe('warning');
    expect(game.hp).toBe(hp);
    // Still nothing taken for the whole warning window.
    for (let i = 0; i < Math.round(SPIKE_PLATFORM_RULES.warning * 120) - 2; i++) game.step(1 / 120, 0, false);
    expect(ledge.spikePlatform!.state).toBe('warning');
    expect(game.hp).toBe(hp);
  });

  it('warns for long enough to walk off the widest ledge it is laid on', () => {
    // The fairness of the whole mechanic. If the warning is shorter than the time it takes to cross
    // the ledge, a player who lands on the guaranteed landing spot cannot leave, and the hit stops
    // being a mistake. Measured against the real plan widths, in both AREAs that use these.
    for (const [area, sectionId] of [[2, 1], [2, 2], [2, 3], [4, 1], [4, 2], [4, 3]] as const) {
      const sectionPlan = areaConfig(area).plans![sectionId - 1];
      const width = Math.round((sectionPlan.platformWidth[0] + sectionPlan.platformWidth[1]) / 2);
      const game = new GameModel(false, seeded(5));
      game.jumpToStage(area, sectionId);
      game.platforms = []; game.enemies = []; game.hazards = []; game.doodads = []; game.safeZones = [];
      const ledge: Platform = { id: 9, x: WORLD.wall + 60, y: 500, width, breakable: false, state: 'stable', spikePlatform: spikePlatform() };
      game.platforms = [ledge];
      game.player.invincible = 99;
      // Land at the far end from the way out -- the worst case the route can hand a player.
      game.player.x = ledge.x + 26; game.player.y = 400; game.player.vy = 240; game.player.grounded = -1;
      for (let i = 0; i < 400 && game.player.grounded !== ledge.id; i++) game.step(1 / 120, 0, false);
      expect({ area, sectionId, landed: game.player.grounded }).toEqual({ area, sectionId, landed: ledge.id });
      let seconds = 0;
      for (let i = 0; i < 1200 && game.player.grounded === ledge.id; i++) { game.step(1 / 120, 1, false); seconds += 1 / 120; }
      expect({ area, sectionId, escapable: seconds < SPIKE_PLATFORM_RULES.warning }).toEqual({ area, sectionId, escapable: true });
    }
  });
  it('costs exactly one heart through HealthSystem, with the ordinary invulnerability', () => {
    const game = bare();
    game.player.invincible = 0;
    const ledge = onSpikeGround(game);
    const hp = game.hp;
    tick(game, SPIKE_PLATFORM_RULES.warning + 0.1);
    expect(ledge.spikePlatform!.state).toBe('active');
    expect(game.hp).toBe(hp - SPIKE_PLATFORM_RULES.damage);
    expect(game.health.lastDamage?.cause).toBe('spike');
    // Ordinary damage means ordinary invulnerability, and the live window is shorter than it, so
    // one pass through a platform costs exactly one heart however long the player stands in it.
    expect(game.player.invincible).toBeGreaterThan(0);
    tick(game, SPIKE_PLATFORM_RULES.active);
    expect(game.hp).toBe(hp - SPIKE_PLATFORM_RULES.damage);
  });

  it('is never instant death, even at one heart', () => {
    const game = bare();
    game.player.invincible = 0;
    game.hp = 1;
    const ledge = onSpikeGround(game);
    tick(game, SPIKE_PLATFORM_RULES.warning + 0.1);
    expect(ledge.spikePlatform!.state).toBe('active');
    // It took the last heart the ordinary way -- through damage(), not killInstantly().
    expect(game.health.deathCause?.instant).toBe(false);
    expect(game.health.deathCause?.cause).toBe('spike');
  });

  it('keeps the chain through the hit, exactly as any other damage does', () => {
    const game = bare();
    game.player.invincible = 0;
    const ledge = onSpikeGround(game);
    // Landing settled whatever chain arrived; start a new one and take the spikes on it.
    game.combo = 9;
    tick(game, SPIKE_PLATFORM_RULES.warning + 0.1);
    expect(ledge.spikePlatform!.state).toBe('active');
    expect(game.hp).toBeLessThan(game.stats.maxHp);
    expect(game.combo).toBe(9);
  });

  it('is ordinary ground: landing fills CHARGE and settles the chain', () => {
    const game = bare();
    game.player.invincible = 99;
    game.ammo = 1; game.combo = 8;
    onSpikeGround(game);
    expect(game.ammo).toBe(game.stats.maxAmmo);
    expect(game.combo).toBe(0);
    expect(game.events.some(e => e.type === 'comboSettle')).toBe(true);
  });

  it('retracts, cools down and can be armed again', () => {
    const game = bare();
    game.player.invincible = 99;
    const ledge = onSpikeGround(game);
    const spikes = ledge.spikePlatform!;
    tick(game, SPIKE_PLATFORM_RULES.warning + 0.05);
    expect(spikes.state).toBe('active');
    tick(game, SPIKE_PLATFORM_RULES.active);
    expect(spikes.state).toBe('cooldown');
    // Step off while it cools, or it simply re-arms under the player's feet the moment it is safe.
    game.player.grounded = -1;
    for (let i = 0; i < Math.round((SPIKE_PLATFORM_RULES.cooldown + 0.05) * 120); i++) {
      game.player.y = ledge.y - 200; game.player.vy = 0; game.player.grounded = -1;
      game.step(1 / 120, 0, false);
    }
    expect(spikes.state).toBe('safe');
    expect(spikes.timer).toBe(0);
    // Land on it again and it arms again, from the top of the cycle.
    game.player.grounded = ledge.id;
    game.step(1 / 120, 0, false);
    expect(spikes.state).toBe('warning');
  });

  it('announces each phase change once, so the view can telegraph it', () => {
    const game = bare();
    game.player.invincible = 99;
    onSpikeGround(game);
    game.events.length = 0;
    tick(game, SPIKE_PLATFORM_RULES.warning + SPIKE_PLATFORM_RULES.active + 0.1);
    const phases = game.events.filter(e => e.type === 'spikePlatform').map(e => e.value);
    expect(phases).toContain(1);
    expect(phases).toContain(2);
  });

  it('holds its whole cycle while the player is in a SAFE ZONE', () => {
    const game = bare();
    game.player.invincible = 99;
    const ledge = onSpikeGround(game);
    const spikes = ledge.spikePlatform!;
    expect(spikes.state).toBe('warning');
    const held = spikes.timer;
    // Step into a chamber. TIMEVOID stops the shaft, and a warning is part of the shaft.
    const zone: SafeZone = { id: 500, side: -1, x: WORLD.wall, y: ledge.y - 130, width: 150, height: 116, content: null, taken: false };
    game.safeZones = [zone];
    game.platforms.push({ id: 501, x: zone.x, y: zone.y + zone.height, width: zone.width, breakable: false, state: 'stable', safeZone: zone.id });
    game.player.x = zone.x + 70; game.player.y = zone.y + zone.height - 15; game.player.vy = 0; game.player.grounded = 501;
    game.step(1 / 120, 0, false);
    expect(game.timeFrozen).toBe(true);
    tick(game, SPIKE_PLATFORM_RULES.warning * 4);
    expect(spikes.state).toBe('warning');
    expect(spikes.timer).toBeCloseTo(held, 5);
    // Out again, and it carries on from exactly where it stopped.
    for (let i = 0; i < 900 && game.timeFrozen; i++) { game.player.invincible = 99; game.step(1 / 120, 1, false); }
    expect(game.timeFrozen).toBe(false);
    tick(game, SPIKE_PLATFORM_RULES.warning + 0.1);
    expect(spikes.state).toBe('active');
  });
});

describe('AREA 2 generation carries the CATACOMBS role', () => {
  it('lays spike platforms in every SECTION, more of them as the AREA goes on', () => {
    const share = SECTIONS.map(sectionId => {
      let turning = 0, rows = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const shaft = section(sectionId, seed * 613);
        const ledges = shaft.platforms.filter(p => !p.breakBlock && p.safeZone === undefined);
        rows += ledges.length;
        turning += ledges.filter(p => p.spikePlatform).length;
      }
      expect({ sectionId, any: turning > 0 }).toEqual({ sectionId, any: true });
      return turning / rows;
    });
    expect(share[0]).toBeLessThan(share[1]);
    expect(share[1]).toBeLessThan(share[2]);
    // Never the whole SECTION: CATACOMBS still has somewhere to stand, unlike LIMBO.
    for (const s of share) expect(s).toBeLessThan(0.75);
  });

  it('starts every spike platform unarmed and safe', () => {
    for (const sectionId of SECTIONS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        for (const p of section(sectionId, seed * 271).platforms) {
          if (!p.spikePlatform) continue;
          expect({ sectionId, seed, state: p.spikePlatform.state, timer: p.spikePlatform.timer }).toEqual({ sectionId, seed, state: 'safe', timer: 0 });
        }
      }
    }
  });

  it('lays no instant-death terrain anywhere', () => {
    for (const sectionId of SECTIONS) {
      expect(plan(sectionId).spikeChance ?? 0).toBe(0);
      expect((plan(sectionId).spikeKinds ?? []).length).toBe(0);
      for (let seed = 1; seed <= SEEDS; seed++) {
        const shaft = section(sectionId, seed * 811);
        expect({ sectionId, seed, hazards: shaft.hazards.length }).toEqual({ sectionId, seed, hazards: 0 });
      }
    }
  });

  it('has no water left in it at all', () => {
    expect(area2.gimmicks?.oxygen).toBeUndefined();
    expect(area2.water).toBeUndefined();
    for (const sectionId of SECTIONS) {
      expect(plan(sectionId).containerChance ?? 0).toBe(0);
      expect(plan(sectionId).maxOxygenGap).toBeUndefined();
      expect(plan(sectionId).bubbleOffside).toBeUndefined();
      for (let seed = 1; seed <= SEEDS; seed++) {
        const shaft = section(sectionId, seed * 409);
        expect({ sectionId, seed, containers: shaft.containers.length }).toEqual({ sectionId, seed, containers: 0 });
      }
    }
    // And a run parked here runs no gauge and no submerged physics.
    for (const sectionId of SECTIONS) {
      const game = bare(sectionId);
      expect({ sectionId, oxygen: game.oxygen.enabled }).toEqual({ sectionId, oxygen: false });
      expect({ sectionId, water: game.water }).toEqual({ sectionId, water: undefined });
      expect({ sectionId, bubbles: game.bubbles.length, containers: game.containers.length }).toEqual({ sectionId, bubbles: 0, containers: 0 });
    }
  });

  it('hangs candles on the walls to bounce from', () => {
    for (const sectionId of SECTIONS) {
      expect(plan(sectionId).doodadChance ?? 0).toBeGreaterThan(0);
      let doodads = 0;
      for (let seed = 1; seed <= SEEDS; seed++) doodads += section(sectionId, seed * 977).doodads.length;
      expect({ sectionId, perRun: doodads / SEEDS > 1 }).toEqual({ sectionId, perRun: true });
    }
    // The same DOODAD the rest of the game uses -- one mechanic, not a second implementation.
    const game = bare();
    game.player.invincible = 99;
    game.ammo = 1; game.combo = 7;
    const doodad = { id: 1, x: game.player.x - DOODAD_RULES.width / 2, y: game.player.y + 60, width: DOODAD_RULES.width, height: DOODAD_RULES.height, variant: 'lamp' as const, active: true };
    game.doodads = [doodad];
    game.player.vy = 300;
    for (let i = 0; i < 90 && !game.events.some(e => e.type === 'doodad'); i++) game.step(1 / 120, 0, false);
    expect(game.events.some(e => e.type === 'doodad')).toBe(true);
    expect(game.ammo).toBe(game.stats.maxAmmo);
    expect(game.combo).toBe(7);
    expect(game.kills).toBe(0);
    expect(game.coins.coins.length + game.coins.walletCoins).toBe(0);
  });

  it('pools basics and armoured together, and nothing aquatic', () => {
    expect(area2.enemyPool.length).toBeGreaterThan(2);
    expect(area2.enemyPool.some(k => ENEMY_TYPES[k].stompable)).toBe(true);
    expect(area2.enemyPool.some(k => !ENEMY_TYPES[k].stompable)).toBe(true);
    for (const kind of area2.enemyPool) {
      expect({ kind, shootable: ENEMY_TYPES[kind].shootable }).toEqual({ kind, shootable: true });
      expect({ kind, aquatic: (['fish', 'bubbleFish', 'jellyfish', 'urchin'] as EnemyKind[]).includes(kind) }).toEqual({ kind, aquatic: false });
    }
  });

  it('guarantees a SAFE ZONE and leaves the route intact', () => {
    for (const sectionId of SECTIONS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const shaft = section(sectionId, seed * 613);
        expect({ sectionId, seed, zones: shaft.zones.length >= 1 }).toEqual({ sectionId, seed, zones: true });
        // A chamber floor is its own slab against a wall, never a step on the fall route.
        let previous: RoutePlatform = { ...START_PLATFORM };
        for (const p of shaft.platforms.filter(f => f.safeZone === undefined)) {
          expect(Math.abs(p.safeX - previous.exitX)).toBeLessThanOrEqual(horizontalReach(p.y - previous.y));
          previous = p;
        }
        // Nothing sits on the way out.
        if (shaft.exit) {
          for (const zone of shaft.zones) {
            const clash = zone.x < shaft.exit.x + shaft.exit.width && zone.x + zone.width > shaft.exit.x
              && zone.y < shaft.exit.y + shaft.exit.height && zone.y + zone.height > shaft.exit.y;
            expect({ sectionId, seed, clash }).toEqual({ sectionId, seed, clash: false });
          }
        }
      }
    }
  });
});
