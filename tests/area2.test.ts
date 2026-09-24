import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { StageGenerator, START_PLATFORM, type Platform, type RoutePlatform } from '../src/systems/StageGenerator';
import { ENEMY_TYPES, type EnemyKind } from '../src/data/enemies';
import { areaConfig, type SectionId } from '../src/data/areas';
import { horizontalReach } from '../src/data/difficulty';
import { SPIKE_PLATFORM_RULES, spikePlatform } from '../src/data/structures';
import { DOODAD_RULES } from '../src/data/doodads';
import { BALANCE, JUMP, WORLD } from '../src/data/balance';
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

  it('lets a player who reacts at once get away, and hits one who stands still', () => {
    // The fairness of the whole mechanic, restated.
    //
    // The old requirement was that the warning outlast a WALK to the far side of the widest ledge.
    // That has been withdrawn: walking the full width is the slowest escape there is, and sizing
    // the window around it left the trap with no pressure. What has to hold is that the escapes a
    // player actually reaches for all work -- and that doing nothing does not.
    for (const [area, sectionId] of [[2, 1], [2, 2], [2, 3], [4, 1], [4, 2], [4, 3]] as const) {
      const sectionPlan = areaConfig(area).plans![sectionId - 1];
      const width = Math.round((sectionPlan.platformWidth[0] + sectionPlan.platformWidth[1]) / 2);

      /** Land on the trap at its far end -- the worst spot the route can hand a player. */
      const armed = () => {
        const game = new GameModel(false, seeded(5));
        game.jumpToStage(area, sectionId);
        game.platforms = []; game.enemies = []; game.hazards = []; game.doodads = []; game.safeZones = [];
        const ledge: Platform = { id: 9, x: WORLD.wall + 60, y: 500, width, breakable: false, state: 'stable', spikePlatform: spikePlatform() };
        game.platforms = [ledge];
        game.player.invincible = 0;
        game.player.x = ledge.x + 26; game.player.y = 400; game.player.vy = 240; game.player.grounded = -1;
        for (let i = 0; i < 400 && game.player.grounded !== ledge.id; i++) game.step(1 / 120, 0, false);
        expect({ area, sectionId, landed: game.player.grounded }).toEqual({ area, sectionId, landed: ledge.id });
        expect({ area, sectionId, state: ledge.spikePlatform!.state }).toEqual({ area, sectionId, state: 'warning' });
        return { game, ledge, hp: game.hp };
      };
      const past = (game: GameModel) => {
        const until = SPIKE_PLATFORM_RULES.warning + SPIKE_PLATFORM_RULES.active + 0.1;
        for (let i = 0; i < Math.round(until * 120); i++) game.step(1 / 120, 0, false);
      };

      // Standing still is what the trap is FOR.
      const still = armed();
      past(still.game);
      expect({ area, sectionId, hurt: still.game.hp < still.hp }).toEqual({ area, sectionId, hurt: true });

      // Jumping AND steering off. Worth being precise about why the steering is not optional: a
      // jump peaks at 61px and is back down in about 0.73s, while the danger lasts warning +
      // active = 1.55s. No vertical hop can outlast that, so leaving the FLOOR is never enough on
      // its own -- the escape is leaving the PLATFORM, and the jump is what buys the time to do it.
      const jumped = armed();
      expect(jumped.game.jump()).toBe(true);
      for (let i = 0; i < Math.round((SPIKE_PLATFORM_RULES.warning + SPIKE_PLATFORM_RULES.active + 0.1) * 120); i++) {
        jumped.game.step(1 / 120, -1, false);
      }
      expect({ area, sectionId, escaped: jumped.game.hp === jumped.hp }).toEqual({ area, sectionId, escaped: true });

      // So is stepping off the near edge, which is what the far-end landing is closest to.
      const stepped = armed();
      for (let i = 0; i < Math.round((SPIKE_PLATFORM_RULES.warning + SPIKE_PLATFORM_RULES.active + 0.1) * 120); i++) {
        stepped.game.step(1 / 120, -1, false);
      }
      expect({ area, sectionId, escaped: stepped.game.hp === stepped.hp }).toEqual({ area, sectionId, escaped: true });
    }
  });

  it('never hurts on the frame of the landing, and never before the warning is over', () => {
    const game = bare();
    game.player.invincible = 0;
    const ledge = onSpikeGround(game);
    const hp = game.hp;
    // Armed on contact, and nothing taken for the whole visible window -- to the last frame of it.
    expect(ledge.spikePlatform!.state).toBe('warning');
    expect(game.hp).toBe(hp);
    for (let i = 0; i < Math.round(SPIKE_PLATFORM_RULES.warning * 120) - 2; i++) {
      game.step(1 / 120, 0, false);
      expect(ledge.spikePlatform!.state).toBe('warning');
      expect(game.hp).toBe(hp);
    }
  });

  it('is escaped by LEAVING the platform, not merely by leaving the floor', () => {
    // A consequence of the numbers rather than a choice: a jump is airborne for about 0.73s and the
    // danger runs for warning + active. While active outlasts a hop, a player who jumps straight up
    // and holds no direction comes back down into the spikes. Recorded here so the property is
    // visible if either number is ever retuned.
    const airborne = 2 * (JUMP.impulse / BALANCE.gravity);
    expect(airborne).toBeLessThan(SPIKE_PLATFORM_RULES.warning + SPIKE_PLATFORM_RULES.active);

    const game = bare();
    game.player.invincible = 0;
    const ledge = onSpikeGround(game);
    const hp = game.hp;
    expect(game.jump()).toBe(true);
    tick(game, SPIKE_PLATFORM_RULES.warning + SPIKE_PLATFORM_RULES.active + 0.1);
    expect(game.hp).toBe(hp - SPIKE_PLATFORM_RULES.damage);
  });

  it('keeps the reaction window long enough to see and act on', () => {
    // DESIGN TUNING, not a reproduction: the original's timing is not published. What is asserted
    // here is the property the number has to satisfy, not the number itself.
    expect(SPIKE_PLATFORM_RULES.warning).toBeGreaterThanOrEqual(0.4);
    // There used to be a second bound here: the warning had to be SHORTER than a walk across the
    // widest ledge, so that the trap could not be strolled out of. That was a proxy for pressure,
    // and it was already a withdrawn requirement before the measured speeds landed; moveSpeed 350
    // then made the walk fast enough that the proxy came back to life and contradicted itself.
    //
    // It is gone rather than re-tuned. The trap's acceptance is the list in this block's siblings --
    // the warning is visible, nothing hurts during it, standing still is hit, leaving at once is
    // safe -- plus side-by-side human playtest at the measured speeds, which rated it GOOD.
    expect(SPIKE_PLATFORM_RULES.active).toBeGreaterThan(0);
    expect(SPIKE_PLATFORM_RULES.cooldown).toBeGreaterThan(0);
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
  /**
   * Since Human Review v2, EVERY ordinary CATACOMB ledge is a spike platform -- in every SECTION, so
   * the old "more of them as the AREA goes on" is simply all of them. What still separates CATACOMBS
   * from LIMBO is what a spike platform IS: a floor that is safe to land on and turns later, never a
   * barb that is not a floor at all. Gate blocks and chamber floors stay as they are.
   */
  // WAS: every ordinary ledge a spike platform (Human Review v2). The clone follows the original: its
  // catacomb traps are differently coloured ledges among plain ones, so a SECTION spikes its own share
  // -- 30 / 35 / 40% -- and still nothing that is not an ordinary ledge.
  it('makes a share of the ordinary ledges spike platforms, and nothing else', () => {
    for (const sectionId of SECTIONS) {
      let ordinaryCount = 0, spikedCount = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const shaft = section(sectionId, seed * 613);
        // The one exception is the SECTION's quiet opening (`graceDepth`), which holds back every hazard
        // in its first metres -- 2-1's first row -- so a player arrives before the floor turns on them.
        const grace = WORLD.startY + (area2.plans![sectionId - 1].graceDepth ?? 0) * WORLD.pixelsPerMeter;
        for (const p of shaft.platforms) {
          if (p.y < grace) continue;   // the quiet opening decides these for itself
          const ordinary = !p.breakBlock && p.safeZone === undefined;
          if (!ordinary) expect({ sectionId, seed, spiked: !!p.spikePlatform }).toEqual({ sectionId, seed, spiked: false });
          else { ordinaryCount++; if (p.spikePlatform) spikedCount++; }
          expect(p.limboHazard ?? false).toBe(false);
        }
      }
      const want = area2.plans![sectionId - 1].spikePlatformChance!;
      expect(Math.abs(spikedCount / ordinaryCount - want), `2-${sectionId}`).toBeLessThan(0.08);
    }
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
        //
        // The route is a chain of BANDS, not a list of platforms: a CATACOMB SLOT lays two shelves at
        // one height, and measuring the "fall" between them asks what zero pixels of drop can steer.
        // The generator's own guarantee is per band and is what is checked: each band's route ledge
        // (the first laid at that height) is reachable from EVERY ledge of the band above, and no
        // ledge above is a dead end. A gate row is edge-to-edge stone and is opened, not steered to.
        const rows = shaft.platforms.filter(f => f.safeZone === undefined);
        const heights = [...new Set(rows.map(f => Math.round(f.y)))].sort((a, b) => a - b);
        let above: RoutePlatform[] = [{ ...START_PLATFORM }];
        for (const y of heights) {
          const here = rows.filter(f => Math.round(f.y) === y);
          if (here.length > 1 && here.every(f => f.breakBlock)) { above = [here[0]]; continue; }
          const route = here[0];
          for (const from of above) {
            expect({ sectionId, seed, y, reach: Math.abs(route.safeX - from.exitX) <= horizontalReach(route.y - from.y) }).toEqual({ sectionId, seed, y, reach: true });
            expect({ sectionId, seed, y, deadEnd: !here.some(p => p.y > from.y && Math.abs(p.safeX - from.exitX) <= horizontalReach(p.y - from.y)) }).toEqual({ sectionId, seed, y, deadEnd: false });
          }
          above = here;
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
