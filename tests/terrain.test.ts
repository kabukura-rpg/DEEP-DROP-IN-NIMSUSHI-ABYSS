import { describe, expect, it } from 'vitest';
import { COIN_VALUES } from '../src/data/coins';
import { GameModel } from '../src/systems/GameModel';
import { StageGenerator, type Platform, type RoutePlatform } from '../src/systems/StageGenerator';
import { areaConfig, AREAS, type AreaId, type SectionId } from '../src/data/areas';
import { BREAK_BLOCK_RULES, breakBlockWidth } from '../src/data/structures';
import { HAZARD_TYPES, SPIKE_KINDS, isSpike, type Hazard } from '../src/data/hazards';
import { GUN_MODULES, type GunModuleId } from '../src/data/gunModules';
import { spawnEnemy } from '../src/data/enemies';
import { WORLD } from '../src/data/balance';
import { reachExit } from './exitHelper';

const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const plan = (area: AreaId, section: SectionId) => areaConfig(area).plans![section - 1];

/** One whole SECTION's worth of generated shaft, exactly as the model would build it. */
function build(area: AreaId, section: SectionId, seed: number) {
  const config = areaConfig(area);
  const pixels = config.sectionLength * WORLD.pixelsPerMeter;
  const chunks = Math.ceil((WORLD.startY + pixels) / WORLD.chunkHeight) + 1;
  const generator = new StageGenerator(seeded(seed), {
    plan: plan(area, section), enemyPool: config.enemyPool, water: config.water,
    oxygen: config.gimmicks?.oxygen === true, heat: config.gimmicks?.heat === true,
    breakable: config.gimmicks?.breakablePlatforms === true, sectionLength: config.sectionLength,
  });
  const platforms: RoutePlatform[] = [], hazards: Hazard[] = [], containers = [] as { x: number; y: number; width: number; height: number }[];
  for (let chunk = 0; chunk < chunks; chunk++) {
    const result = generator.chunk(chunk);
    platforms.push(...result.platforms); hazards.push(...result.hazards);
    containers.push(...result.containers);
  }
  const limit = WORLD.startY + pixels;
  return {
    limit, platforms: platforms.filter(p => p.y <= limit), hazards: hazards.filter(h => h.y <= limit),
    containers: containers.filter(c => c.y <= limit),
    spikes: hazards.filter(h => h.y <= limit && isSpike(h.kind)),
    gates: platforms.filter(p => p.y <= limit && p.breakBlock),
  };
}
const spikeDensity = (area: AreaId, section: SectionId, seeds = 40) => {
  let count = 0;
  for (let seed = 1; seed <= seeds; seed++) count += build(area, section, seed * 733).spikes.length;
  return count / seeds;
};
/** A run parked in a SECTION with the shaft emptied, so a test owns exactly what exists. */
function bare(area: AreaId, section: SectionId) {
  const game = new GameModel(false, seeded(4402));
  game.jumpToStage(area, section);
  game.platforms = []; game.enemies = []; game.pickups = []; game.hazards = [];
  game.containers = []; game.bubbles = [];
  game.player.invincible = 0;
  return game;
}
const tick = (game: GameModel, seconds: number, direction = 0, action = false) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) game.step(1 / 120, direction, action);
};
/**
 * Open one named block the way the game is actually played: ACTION on the ground is a JUMP, so the
 * loop is hop off the block and shoot down at it from just above. Running dry is handled the way it
 * always was -- step onto the neighbour and back for an ordinary landing reload, which is still the
 * only resupply a gate row needs. Ends the moment that block is gone.
 */
function openBlock(game: GameModel, block: Platform, limitSeconds = 40) {
  let seek = 1;
  for (let i = 0; i < 120 * limitSeconds; i++) {
    if (!game.platforms.includes(block)) return true;
    const standing = game.platforms.find(f => f.id === game.player.grounded);
    if (standing) {
      if (game.ammo <= 0) {
        const before = game.player.grounded;
        game.step(1 / 120, seek, false);
        if (game.player.grounded !== before && game.player.grounded !== -1) seek = -seek;
        continue;
      }
      game.step(1 / 120, 0, i % 8 < 4);                   // ACTION on the ground: jump, then release
      continue;
    }
    // Airborne: ACTION is the gunboots. Stay over the block so the rounds land on it.
    const centre = block.x + block.width / 2;
    const steer = Math.abs(centre - game.player.x) < 5 ? 0 : Math.sign(centre - game.player.x);
    game.step(1 / 120, steer, i % 4 < 2);
  }
  return false;
}
/** Drop through the gap a broken block left, steering into it as a player would. */
function fallThrough(game: GameModel, hole: Platform, seconds = 1.5) {
  const centre = hole.x + hole.width / 2;
  for (let i = 0; i < 120 * seconds && game.player.y < hole.y + 60; i++) {
    const steer = Math.abs(centre - game.player.x) < 4 ? 0 : Math.sign(centre - game.player.x);
    game.step(1 / 120, steer, false);
  }
  return game.player.y > hole.y + 60;
}

describe('SPIKE is instant death, not a large hit', () => {
  it('ends a run at full health the moment it is touched, and names SPIKES', () => {
    const game = bare(1, 2);
    game.health.heal(9);                                    // as much health as a run ever carries
    const hp = game.hp;
    expect(hp).toBeGreaterThan(1);
    game.hazards = [{ ...HAZARD_TYPES.stoneSpike, id: 1, kind: 'stoneSpike', x: game.player.x - 20, y: game.player.y, width: 40, height: 12, lethal: true, phase: 0, state: 'idle', plume: 0 }];
    tick(game, 1 / 60);
    expect(game.state).toBe('over');
    expect(game.hp).toBe(0);
    expect(game.health.deathCause).toEqual({ cause: 'spike', instant: true, amount: hp });
  });
  it('is not survivable through invulnerability', () => {
    const game = bare(2, 3);
    game.player.invincible = 99;
    game.hazards = [{ ...HAZARD_TYPES.urchinSpike, id: 1, kind: 'urchinSpike', x: game.player.x - 20, y: game.player.y, width: 40, height: 18, lethal: true, phase: 0, state: 'idle', plume: 0 }];
    tick(game, 1 / 60);
    expect(game.state).toBe('over');
  });
  it('is checked in AREAs that run no gauge at all', () => {
    // The lethal-terrain pass used to live inside the heat tick, which AREA 1 never runs.
    const game = bare(1, 1);
    expect(game.heat.enabled).toBe(false);
    expect(game.oxygen.enabled).toBe(false);
    game.hazards = [{ ...HAZARD_TYPES.stoneSpike, id: 1, kind: 'stoneSpike', x: game.player.x - 20, y: game.player.y, width: 40, height: 12, lethal: true, phase: 0, state: 'idle', plume: 0 }];
    tick(game, 1 / 60);
    expect(game.state).toBe('over');
  });
  it('still lets lava report lava, so one pass serves both', () => {
    const game = bare(3, 1);
    game.hazards = [{ ...HAZARD_TYPES.lavaPool, id: 1, kind: 'lavaPool', x: game.player.x - 20, y: game.player.y, width: 40, height: 12, lethal: true, phase: 0, state: 'idle', plume: 0 }];
    tick(game, 1 / 60);
    expect(game.health.deathCause?.cause).toBe('lava');
  });
  it('declares every SPIKE variant lethal and free of heat', () => {
    for (const kind of SPIKE_KINDS) {
      const type = HAZARD_TYPES[kind];
      expect(type.lethal).toBe(true);
      expect(type.damageCause).toBe('spike');
      expect([type.heat, type.heatRadius]).toEqual([0, 0]);
      expect(type.palette).toBeDefined();
    }
  });
});

describe('instant-death SPIKE is legacy: no normal AREA lays any', () => {
  it('declares it nowhere in the twelve SECTION plans', () => {
    for (const area of AREAS) {
      for (const [index, sectionPlan] of (area.plans ?? []).entries()) {
        const where = `${area.id}-${index + 1}`;
        expect({ where, chance: sectionPlan.spikeChance ?? 0 }).toEqual({ where, chance: 0 });
        expect({ where, kinds: (sectionPlan.spikeKinds ?? []).length }).toEqual({ where, kinds: 0 });
      }
    }
  });
  it('generates none of it, on any seed, in any SECTION', () => {
    for (const area of [1, 2, 3, 4] as AreaId[]) {
      for (const s of [1, 2, 3] as SectionId[]) {
        for (let seed = 1; seed <= 60; seed++) {
          const shaft = build(area, s, seed * 421);
          expect({ area, s, seed, spikes: shaft.spikes.length }).toEqual({ area, s, seed, spikes: 0 });
          expect({ area, s, seed, lethal: shaft.hazards.filter(h => h.lethal).length }).toEqual({ area, s, seed, lethal: 0 });
        }
      }
    }
  });
  it('leaves the CATACOMBS and LIMBO ground non-lethal instead', () => {
    // What replaced it deals ordinary damage: the SPIKE PLATFORM arms on landing, warns, and costs
    // a heart. Its damage cause is still 'spike', so the result screen still reads SPIKES -- what
    // changed is that the hit is survivable, and that is asserted in the AREA 2 and AREA 4 suites.
    let turning = 0;
    for (const area of [2, 4] as AreaId[]) {
      for (const s of [1, 2, 3] as SectionId[]) {
        for (let seed = 1; seed <= 20; seed++) turning += build(area, s, seed * 421).platforms.filter(p => p.spikePlatform).length;
      }
    }
    expect(turning).toBeGreaterThan(0);
  });
  it('keeps the hazard table itself intact for the BOSS and for later content', () => {
    // Nothing was deleted. MAGMA WRATH still lays lava, and a later bonus world can lay SPIKE again
    // simply by naming it in a plan.
    for (const kind of SPIKE_KINDS) expect(HAZARD_TYPES[kind].lethal).toBe(true);
  });
  it('never reaches THE ABYSS, in the staging room or in the arena', () => {
    for (const enter of [(g: GameModel) => g.jumpToBoss(), (g: GameModel) => g.jumpToNimushi()]) {
      const game = new GameModel(false, seeded(9091));
      enter(game);
      for (let i = 0; i < 120 * 40 && game.state === 'boss'; i++) {
        game.player.invincible = 99;
        game.step(1 / 120, 0, false);
        // Instant-death SPIKE is legacy terrain and no part of THE ABYSS lays any. BREAK BLOCK is
        // a different thing entirely and IS laid here -- the seal is one, by design.
        expect(game.hazards.filter(h => isSpike(h.kind))).toEqual([]);
      }
    }
  });
});

describe('BREAK BLOCK: a row of separate blocks, not one slab', () => {
  /** A real generated gate row, with the model parked on top of it. */
  const withRow = (area: AreaId, section: SectionId) => {
    const game = bare(area, section);
    const durability = plan(area, section).breakBlockDurability ?? BREAK_BLOCK_RULES.durability;
    const y = game.player.y + 40;
    const width = breakBlockWidth();
    const row: Platform[] = Array.from({ length: BREAK_BLOCK_RULES.count }, (_, slot) => {
      const left = Math.floor(WORLD.wall + slot * width), right = Math.ceil(WORLD.wall + (slot + 1) * width);
      return { id: 700 + slot, x: left, y, width: right - left, breakable: false, state: 'stable', breakBlock: { hits: 0, durability, slot, reward: false } };
    });
    game.platforms = row;
    game.player.vy = 240;
    return { game, row, durability, y, width };
  };
  it('lays several blocks side by side, edge to edge, spanning the shaft', () => {
    for (const area of [1, 2, 3] as const) for (const s of [2, 3] as const) {
      for (let seed = 1; seed <= 10; seed++) {
        const shaft = build(area, s, seed * 613);
        const rows = new Map<number, typeof shaft.gates>();
        for (const block of shaft.gates) rows.set(block.y, [...(rows.get(block.y) ?? []), block]);
        expect(rows.size).toBe(plan(area, s).breakBlockRows ?? 0);
        for (const blocks of rows.values()) {
          expect(blocks.length).toBe(BREAK_BLOCK_RULES.count);
          const sorted = [...blocks].sort((a, b) => a.x - b.x);
          expect(sorted[0].x).toBe(WORLD.wall);
          expect(sorted[sorted.length - 1].x + sorted[sorted.length - 1].width).toBe(WORLD.width - WORLD.wall);
          // Edge to edge: no seam a player could fall through before opening one.
          for (let i = 1; i < sorted.length; i++) expect(sorted[i].x).toBe(sorted[i - 1].x + sorted[i - 1].width);
          // Each block owns its own durability counter, not the row's.
          expect(new Set(blocks.map(b => b.breakBlock)).size).toBe(blocks.length);
          expect(blocks.every(b => b.breakBlock!.hits === 0)).toBe(true);
        }
      }
    }
  });
  it('is landed on like any ledge: full reload and COMBO reset, on every block in the row', () => {
    const { game, row, y } = withRow(1, 2);
    for (const block of row) {
      game.player.x = block.x + block.width / 2;
      game.player.y = y - 60; game.player.vy = 240; game.player.grounded = -1;
      game.ammo = 0; game.combo = 7;
      tick(game, 0.6);
      expect({ slot: block.breakBlock!.slot, grounded: game.player.grounded }).toEqual({ slot: block.breakBlock!.slot, grounded: block.id });
      expect(game.ammo).toBe(game.stats.maxAmmo);
      expect(game.combo).toBe(0);
      expect(game.collapse.counting).toBe(0);
    }
  });
  it('does not give way under the player, however long they stand on one', () => {
    const { game, row } = withRow(1, 2);
    tick(game, 12);
    expect(game.platforms.length).toBe(row.length);
    expect(row.every(b => b.breakBlock!.hits === 0 && b.state === 'stable')).toBe(true);
  });
  it('breaks one block at a time, leaving its neighbours untouched', () => {
    const { game, row, durability } = withRow(2, 1);
    tick(game, 0.6);
    const standing = game.platforms.find(f => f.id === game.player.grounded) as Platform;
    expect(standing.breakBlock).toBeDefined();
    expect(openBlock(game, standing)).toBe(true);
    expect(game.platforms).not.toContain(standing);
    expect(standing.breakBlock!.hits).toBe(durability);
    // Every other block is exactly as it was: no shared counter, no chain reaction.
    for (const block of row) {
      if (block === standing) continue;
      expect({ slot: block.breakBlock!.slot, hits: block.breakBlock!.hits }).toEqual({ slot: block.breakBlock!.slot, hits: 0 });
      expect(game.platforms).toContain(block);
    }
  });
  it('one hole is enough: the player falls through a single opened block', () => {
    const { game, row, y } = withRow(1, 3);
    tick(game, 0.6);
    const standing = game.platforms.find(f => f.id === game.player.grounded) as Platform;
    expect(openBlock(game, standing)).toBe(true);
    expect(game.platforms.filter(b => b.breakBlock).length).toBe(row.length - 1);
    // The gap is wider than the player, so nothing is scraping through on a pixel.
    expect(standing.width).toBeGreaterThan(22);
    expect(fallThrough(game, standing)).toBe(true);
    expect(game.player.y).toBeGreaterThan(y + 60);
  });
  it('can be opened by every one of the seven gun modules, with no special resupply', () => {
    const modules = Object.keys(GUN_MODULES) as GunModuleId[];
    expect(modules.length).toBe(7);
    for (const id of modules) {
      // The toughest row a normal run lays, in dry air: AREA 1's late gates and AREA 2's are both
      // two rounds a block, and AQUIFER's submerged physics are a separate question from whether a
      // weapon can open a block at all.
      const { game, y } = withRow(2, 3);
      tick(game, 0.6);
      expect(game.player.grounded).not.toBe(-1);
      game.gun.equip(id);
      game.ammo = 0;                                     // arrive spent, the way a fight leaves you
      const standing = game.platforms.find(f => f.id === game.player.grounded) as Platform;
      const through = openBlock(game, standing);
      const below = through && fallThrough(game, standing);
      expect({ id, through, below }).toEqual({ id, through: true, below: true });
      expect({ id, y: game.player.y > y + 40 }).toEqual({ id, y: true });
    }
  });
  it('is terrain work: no COMBO, no kill, no kill event, and no weapon rearm', () => {
    const { game } = withRow(1, 3);
    tick(game, 0.6);
    const kills = game.kills;
    game.events.length = 0;
    let combo = 0, killEvents = 0, breaks = 0;
    const watch = () => {
      combo = Math.max(combo, game.combo);
      killEvents += game.events.filter(e => e.type === 'kill').length;
      breaks += game.events.filter(e => e.type === 'blockBreak').length;
      game.events.length = 0;
    };
    for (let i = 0; i < 120 * 30 && breaks === 0; i++) { game.step(1 / 120, 0, i % 20 < 10); watch(); }
    expect(breaks).toBe(1);
    expect([combo, killEvents, game.kills]).toEqual([0, 0, kills]);
  });
  it('never calls rearm(): a BURST already paid for finishes its rounds through the break', () => {
    const game = bare(1, 3);
    const block: Platform = { id: 88, x: WORLD.wall, y: game.player.y + 40, width: 120, breakable: false, state: 'stable', breakBlock: { hits: 0, durability: 1, slot: 0, reward: false } };
    game.platforms = [block]; game.player.x = block.x + 40; game.player.y = block.y - 90; game.player.vy = 0;
    game.gun.equip('burst');
    game.stats.maxAmmo = 20; game.ammo = 20;
    // Airborne above the block, so ACTION is the gunboots and the burst is bought in the air.
    expect(game.player.grounded).toBe(-1);
    game.step(1 / 120, 0, true);
    expect(game.gun.bursting).toBe(true);
    for (let i = 0; i < 30 && game.platforms.includes(block); i++) game.step(1 / 120, 0, false);
    expect(game.platforms).not.toContain(block);
    // The rounds the press already paid for are still owed: a break is not a boundary.
    expect(game.gun.bursting).toBe(true);
  });
  it('shares nothing with the AREA 4 collapse system', () => {
    const { game, row } = withRow(1, 2);
    tick(game, 0.6);
    expect(row.every(b => b.breakable === false)).toBe(true);
    expect(game.collapse.land(row[0])).toBe(false);
    expect(game.collapse.shatter(row, row[0].x + 10, row[0].y)).toEqual([]);
  });
});

describe('REWARD BLOCK pays on sight, not on a coin flip', () => {
  /** Practice mode so no shaft is generated and a block can be built exactly as wanted. */
  const oneBlock = (reward: boolean, random: () => number = seeded(4403)) => {
    const game = new GameModel(true, random);
    const block: Platform = { id: 51, x: WORLD.wall, y: game.player.y + 40, width: 160, breakable: false, state: 'stable', breakBlock: { hits: 0, durability: 1, slot: 0, reward } };
    game.platforms = [block]; game.player.x = block.x + 80; game.player.vy = 240;
    for (let i = 0; i < 120 && game.player.grounded !== block.id; i++) game.step(1 / 120, 0, false);
    return { game, block };
  };
  /** Money that came out of the block, whether it is still on the floor or already swept up. */
  const droppedValue = (game: GameModel) =>
    game.coins.coins.reduce((sum, c) => sum + c.value, 0) + game.coins.scoreCoins;

  it('reads what a reward block is and pays from data, not from a branch in the model', () => {
    expect(BREAK_BLOCK_RULES.rewardChance).toBeGreaterThan(0);
    expect(BREAK_BLOCK_RULES.rewardChance).toBeLessThan(1);
    expect(BREAK_BLOCK_RULES.rewardCoins).toBeGreaterThan(0);
    expect(COIN_VALUES[BREAK_BLOCK_RULES.rewardDenomination]).toBe(10);
  });
  it('has no post-break roll left anywhere: the same block pays the same under any RNG', () => {
    // The old rule drew a number when a block broke. If any of that survived, a rigged RNG would
    // change the payout -- so drive the two extremes and require an identical result.
    for (const rigged of [() => 0, () => 0.999]) {
      const rewarded = oneBlock(true, rigged);
      openBlock(rewarded.game, rewarded.block, 20);
      expect(droppedValue(rewarded.game)).toBe(COIN_VALUES.large * BREAK_BLOCK_RULES.rewardCoins);
      const plain = oneBlock(false, rigged);
      openBlock(plain.game, plain.block, 20);
      expect(droppedValue(plain.game)).toBe(0);
    }
  });
  it('pays a LARGE COIN, every time, from a reward block', () => {
    const { game, block } = oneBlock(true);
    openBlock(game, block, 20);
    expect(game.platforms).not.toContain(block);
    // It pops out at the player's feet, so it may already have been swept up by the time we look.
    // Either way the run is exactly one LARGE COIN better off and nothing else was created.
    expect(droppedValue(game)).toBe(COIN_VALUES.large * BREAK_BLOCK_RULES.rewardCoins);
    for (const coin of game.coins.coins) {
      expect([coin.denomination, coin.value]).toEqual(['large', COIN_VALUES.large]);
    }
  });
  it('pays nothing at all from an ordinary block', () => {
    const { game, block } = oneBlock(false);
    openBlock(game, block, 20);
    expect(game.platforms).not.toContain(block);
    expect(game.coins.coins.length).toBe(0);
    expect(droppedValue(game)).toBe(0);
  });
  it('is decided when the row is built, so it can be seen before a round is spent', () => {
    // Generation, not the model, decides which stones pay -- and it is on the block from the moment
    // the row exists, untouched, which is what makes it something a player can read and aim at.
    const blocks = [];
    for (let seed = 1; seed <= 90; seed++) {
      for (const gate of build(1, 1, seed * 977).gates) blocks.push(gate.breakBlock!);
    }
    expect(blocks.length).toBeGreaterThan(40);
    expect(blocks.every(b => typeof b.reward === 'boolean' && b.hits === 0)).toBe(true);
    const share = blocks.filter(b => b.reward).length / blocks.length;
    expect(Math.abs(share - BREAK_BLOCK_RULES.rewardChance)).toBeLessThan(0.08);
    // Both kinds really do occur, so "visible before breaking" is a choice and not a formality.
    expect(blocks.some(b => b.reward)).toBe(true);
    expect(blocks.some(b => !b.reward)).toBe(true);
  });
  it('pays into walletCoins and scoreCoins through the existing pickup path', () => {
    const { game, block } = oneBlock(true);
    expect([game.coins.walletCoins, game.coins.scoreCoins]).toEqual([0, 0]);
    game.events.length = 0;
    openBlock(game, block, 20);
    // The coin pops out where the player is standing, so CoinSystem sweeps it up on its own; keep
    // stepping in case it scattered first.
    for (let i = 0; i < 240 && game.coins.walletCoins === 0; i++) game.step(1 / 120, 0, false);
    expect(game.coins.walletCoins).toBe(COIN_VALUES.large);
    expect(game.coins.scoreCoins).toBe(game.coins.walletCoins);
    expect(game.events.some(e => e.type === 'coin')).toBe(true);
    // Still not a kill, however the money arrived.
    expect([game.kills, game.combo]).toEqual([0, 0]);
  });
});

describe('BREAK BLOCK placement', () => {
  it('lays the number of rows the SECTION plan asks for, at the configured durability', () => {
    for (const area of AREAS) for (let n = 1; n <= area.sections; n++) {
      const section = n as SectionId, want = plan(area.id, section).breakBlockRows ?? 0;
      for (let seed = 1; seed <= 8; seed++) {
        const shaft = build(area.id, section, seed * 311);
        const rows = new Set(shaft.gates.map(b => b.y));
        expect({ area: area.id, section, rows: rows.size }).toEqual({ area: area.id, section, rows: want });
        for (const block of shaft.gates) {
          expect(block.breakable).toBe(false);
          expect(block.breakBlock!.durability).toBe(plan(area.id, section).breakBlockDurability ?? BREAK_BLOCK_RULES.durability);
        }
      }
    }
  });
  it('spaces the rows through the SECTION instead of clustering them', () => {
    for (const area of [1, 2, 3] as const) for (const s of [2, 3] as const) {
      const length = areaConfig(area).sectionLength;
      for (let seed = 1; seed <= 20; seed++) {
        const depths = [...new Set(build(area, s, seed * 907).gates.map(g => g.y))].sort((a, b) => a - b)
          .map(y => (y - WORLD.startY) / WORLD.pixelsPerMeter);
        expect(depths.length).toBeGreaterThan(1);
        for (const depth of depths) { expect(depth).toBeGreaterThan(length * 0.1); expect(depth).toBeLessThan(length * 0.9); }
        for (let i = 1; i < depths.length; i++) expect(depths[i] - depths[i - 1]).toBeGreaterThan(length * 0.15);
      }
    }
  });
  it('AREA 4 keeps its own identity: collapsing ledges, no gate rows and no SPIKE', () => {
    for (const s of [1, 2, 3] as const) {
      expect(plan(4, s).breakBlockRows ?? 0).toBe(0);
      expect(plan(4, s).spikeChance ?? 0).toBe(0);
    }
  });
  it('still lets every SECTION reach its EXIT with gate rows in the shaft', () => {
    for (const area of [1, 2, 3] as const) for (const s of [1, 2, 3] as const) {
      const game = new GameModel(false, seeded(4404));
      game.jumpToStage(area, s as SectionId);
      const gate = reachExit(game);
      expect(game.state).toBe('upgrade');
      expect(game.platforms.filter(p => p.breakBlock && p.y > gate.y)).toEqual([]);
    }
  });
});

describe('COMBO counts kills between touchdowns', () => {
  it('is reset by a BREAK BLOCK landing exactly as by any other', () => {
    const game = bare(1, 2);
    game.platforms = [{ id: 91, x: WORLD.wall, y: game.player.y + 40, width: 120, breakable: false, state: 'stable', breakBlock: { hits: 0, durability: 2, slot: 0, reward: false } }];
    game.player.x = WORLD.wall + 60;
    game.player.vy = 240; game.combo = 6; game.ammo = 0;
    tick(game, 0.6);
    expect(game.player.grounded).toBe(91);
    expect(game.combo).toBe(0);
    expect(game.ammo).toBe(game.stats.maxAmmo);
  });
  it('is reset by an AREA 4 collapsing ledge landing too', () => {
    const game = bare(4, 2);
    game.platforms = [{ id: 92, x: 150, y: game.player.y + 40, width: 150, breakable: true, state: 'stable' }];
    game.player.x = 225; game.player.vy = 240; game.combo = 9;
    tick(game, 0.4);
    expect(game.player.grounded).toBe(92);
    expect(game.combo).toBe(0);
  });
  it('counts one per defeated enemy and survives the fall between ledges', () => {
    const game = bare(1, 1);
    game.player.x = 225; game.player.y = 180; game.player.vy = 0;
    for (let i = 0; i < 3; i++) {
      game.enemies = [spawnEnemy('slime', 300 + i, 225, game.player.y + 70)];
      game.cooldown = 0; game.ammo = game.stats.maxAmmo; game.shoot();
      tick(game, 0.25);
      game.player.y = 180; game.player.vy = 0;
    }
    expect(game.combo).toBe(3);
    expect(game.kills).toBe(3);
  });
});
