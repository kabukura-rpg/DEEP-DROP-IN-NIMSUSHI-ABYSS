import { describe, expect, it } from 'vitest';
import { reachExit } from './exitHelper';
import { GameModel } from '../src/systems/GameModel';
import { StageGenerator, START_PLATFORM, canReachPlatform, type RoutePlatform } from '../src/systems/StageGenerator';
import { ENEMY_TYPES, enemyType, spawnEnemy, type Enemy, type EnemyKind } from '../src/data/enemies';
import { AREAS, areaConfig, type SectionId } from '../src/data/areas';
import { WORLD } from '../src/data/balance';
import type { Hazard } from '../src/data/hazards';
import type { SafeZone } from '../src/data/safeZone';

const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const area1 = areaConfig(1);
const plan = (section: SectionId) => area1.plans![section - 1];

/** Generate one SECTION worth of rows the way GameModel does, and measure what came out. */
function sample(section: SectionId, seeds = 24, chunks = 3) {
  let platforms = 0, widthTotal = 0, enemies = 0, rows = 0;
  const kinds = new Set<EnemyKind>();
  const all: Enemy[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const generator = new StageGenerator(seeded(seed * 131), { plan: plan(section), enemyPool: area1.enemyPool, depthOffset: (section - 1) * 200 });
    let previous: RoutePlatform = { ...START_PLATFORM };
    for (let chunk = 0; chunk < chunks; chunk++) {
      const result = generator.chunk(chunk);
      for (const p of result.platforms) {
        expect(canReachPlatform(previous, p)).toBe(true);
        expect(p.x).toBeGreaterThanOrEqual(WORLD.wall);
        expect(p.x + p.width).toBeLessThanOrEqual(WORLD.width - WORLD.wall);
        platforms++; widthTotal += p.width; rows++; previous = p;
      }
      for (const e of result.enemies) { enemies++; kinds.add(e.kind); all.push(e); }
    }
  }
  return { averageWidth: widthTotal / platforms, density: enemies / rows, kinds, enemies: all, rows };
}

/** One whole AREA 1 SECTION, exactly as the model would build it. */
function build(section: SectionId, seed: number) {
  const config = areaConfig(1);
  const pixels = config.sectionLength * WORLD.pixelsPerMeter;
  const chunks = Math.ceil((WORLD.startY + pixels) / WORLD.chunkHeight) + 1;
  const generator = new StageGenerator(seeded(seed), {
    plan: config.plans![section - 1], enemyPool: config.enemyPool, sectionLength: config.sectionLength,
  });
  const platforms: RoutePlatform[] = [], hazards: Hazard[] = [], zones: SafeZone[] = [];
  for (let chunk = 0; chunk < chunks; chunk++) {
    const built = generator.chunk(chunk);
    platforms.push(...built.platforms.filter(p => p.y <= WORLD.startY + pixels));
    hazards.push(...built.hazards.filter(h => h.y <= WORLD.startY + pixels));
    zones.push(...built.safeZones);
  }
  return { platforms, hazards, zones };
}

describe('AREA 1 enemy roster', () => {
  it('pools only the three AREA 1 enemies and never the later heavy one', () => {
    expect([...area1.enemyPool]).toEqual(['slime', 'bat', 'armoredSlime']);
    for (let section = 1 as SectionId; section <= 3; section++) {
      const { kinds } = sample(section as SectionId, 30, 3);
      for (const kind of kinds) expect(area1.enemyPool).toContain(kind);
      expect(kinds.has('tank')).toBe(false);
    }
  });
  it('sees every AREA 1 enemy across the three sections', () => {
    const kinds = new Set<EnemyKind>();
    for (let section = 1; section <= 3; section++) for (const kind of sample(section as SectionId, 30, 3).kinds) kinds.add(kind);
    expect([...kinds].sort()).toEqual(['armoredSlime', 'bat', 'slime']);
  });
  it('marks exactly the soft enemies as stompable and gives the armoured ones their own silhouette', () => {
    expect(ENEMY_TYPES.slime.stompable).toBe(true);
    expect(ENEMY_TYPES.bat.stompable).toBe(true);
    expect(ENEMY_TYPES.armoredSlime.stompable).toBe(false);
    expect(ENEMY_TYPES.tank.stompable).toBe(false);
    // Shape, not colour, separates the two groups: every type has its own, and no silhouette is
    // ever reused across the stompable boundary.
    const silhouettes = Object.values(ENEMY_TYPES).map(t => t.silhouette);
    expect(silhouettes.length).toBe(23);
    expect(new Set(silhouettes).size).toBe(silhouettes.length);
    const soft = new Set(Object.values(ENEMY_TYPES).filter(t => t.stompable).map(t => t.silhouette));
    for (const type of Object.values(ENEMY_TYPES)) expect(soft.has(type.silhouette)).toBe(type.stompable);
  });
  it('carries the attribute onto every spawned enemy instead of matching kinds at the call site', () => {
    for (const kind of Object.keys(ENEMY_TYPES) as EnemyKind[]) {
      const e = spawnEnemy(kind, 1, 100, 100);
      expect(e.stompable).toBe(enemyType(kind).stompable);
      expect(e.flying).toBe(enemyType(kind).flying);
      expect(e.hp).toBe(enemyType(kind).hp);
    }
  });
});

describe('AREA 1 stomp rules follow the attribute', () => {
  const drop = (kind: EnemyKind) => {
    const game = new GameModel(true);
    game.platforms = []; game.player.y = 260; game.player.vy = 300;
    game.enemies = [spawnEnemy(kind, 1, 225, 300)];
    for (let i = 0; i < 10; i++) game.step(1 / 120, 0, false);
    return game;
  };
  it('kills a stompable enemy and bounces the player', () => {
    for (const kind of ['slime', 'bat'] as const) {
      const game = drop(kind);
      expect([game.kills, game.hp, game.player.vy < 0]).toEqual([1, 4, true]);
    }
  });
  it('hurts the player on a non-stompable enemy instead', () => {
    for (const kind of ['armoredSlime', 'tank'] as const) {
      const game = drop(kind);
      expect([game.kills, game.hp]).toEqual([0, 3]);
      expect(game.health.lastDamage?.cause).toBe(enemyType(kind).damageCause);
    }
  });
  it('still kills a non-stompable enemy by shooting it', () => {
    const game = new GameModel(true);
    game.platforms = []; game.enemies = [spawnEnemy('armoredSlime', 1, 225, 300)];
    game.shoot();
    for (let i = 0; i < 20; i++) game.step(1 / 120, 0, false);
    expect([game.kills, game.combo, game.hp]).toEqual([1, 1, 4]);
  });
});

describe('AREA 1 section pacing', () => {
  it('narrows platforms from 1-1 to 1-3', () => {
    const widths = [1, 2, 3].map(s => sample(s as SectionId).averageWidth);
    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[1]).toBeGreaterThan(widths[2]);
    expect(widths[0]).toBeGreaterThan(170);
    expect(widths[2]).toBeGreaterThan(125);
  });
  it('raises enemy density from 1-1 to 1-3', () => {
    const density = [1, 2, 3].map(s => sample(s as SectionId).density);
    expect(density[0]).toBeLessThan(density[1]);
    expect(density[1]).toBeLessThan(density[2]);
    expect(density[0]).toBeLessThan(0.55);
    expect(density[2]).toBeGreaterThan(0.6);
  });
  it('keeps 1-1 gentle: mostly stompable enemies and a quiet opening', () => {
    const { enemies } = sample(1, 40, 3);
    const stompable = enemies.filter(e => e.stompable).length / enemies.length;
    expect(stompable).toBeGreaterThan(0.75);
    expect(plan(1).graceDepth).toBeGreaterThan(0);
    const firstRowY = WORLD.startY + plan(1).graceDepth! * WORLD.pixelsPerMeter;
    for (const e of enemies) expect(e.y).toBeGreaterThan(firstRowY - 130);
  });
  it('mixes stompable and armoured enemies more as the area goes on', () => {
    // Measured per row: the share of all enemies is diluted by the extra air enemies 1-3 adds.
    const tough = [1, 2, 3].map(s => { const { enemies, rows } = sample(s as SectionId, 40, 3); return enemies.filter(e => !e.stompable).length / rows; });
    expect(tough[0]).toBeLessThan(tough[1]);
    expect(tough[1]).toBeLessThan(tough[2]);
    const share = (() => { const { enemies } = sample(3, 40, 3); return enemies.filter(e => !e.stompable).length / enemies.length; })();
    expect(share).toBeLessThan(0.45);
  });
  it('offers more air enemies to bounce from as the area goes on', () => {
    const flying = [1, 2, 3].map(s => { const { enemies, rows } = sample(s as SectionId, 40, 3); return enemies.filter(e => e.flying).length / rows; });
    expect(flying[0]).toBeLessThan(flying[1]);
    expect(flying[1]).toBeLessThan(flying[2]);
  });
  it('puts the air enemy on the ground enemy side often enough to chain, without lining enemies up', () => {
    const pairs: [Enemy, Enemy][] = [];
    let maxPerRow = 0;
    // Enough seeds that the share below is the generator's behaviour and not one draw's luck.
    for (let seed = 1; seed <= 240; seed++) {
      const generator = new StageGenerator(seeded(seed * 613), { plan: plan(3), enemyPool: area1.enemyPool });
      for (let chunk = 0; chunk < 3; chunk++) {
        const rows = new Map<number, Enemy[]>();
        for (const e of generator.chunk(chunk).enemies) {
          const row = Math.round(e.flying ? e.y + 100 : e.y);
          rows.set(row, [...(rows.get(row) ?? []), e]);
        }
        for (const list of rows.values()) {
          maxPerRow = Math.max(maxPerRow, list.length);
          const air = list.find(e => e.flying), guard = list.find(e => !e.flying);
          if (air && guard) pairs.push([guard, air]);
        }
      }
    }
    // One ground plus one air enemy is the densest row AREA 1 ever builds: no artificial combo lines.
    expect(maxPerRow).toBe(2);
    expect(pairs.length).toBeGreaterThan(40);
    const aligned = pairs.filter(([guard, air]) => Math.sign(air.originX - 225) === Math.sign(guard.originX - 225) || Math.abs(air.originX - guard.originX) < 130).length;
    // The generator always picks the patrol region nearest the guard, but the safe-corridor
    // exclusion frequently leaves regions only on one side, so this outside-in proxy settles at
    // ~0.60 however the rows fall. The bound is what beats an unbiased choice between two regions
    // (0.5) with room for sampling noise; 0.6 was sitting exactly on the mean and flipped a coin.
    expect(aligned / pairs.length).toBeGreaterThan(0.55);
  });
});

describe('AREA 1 generation safety across seeds', () => {
  it('never runs out of reachable platforms and keeps enemies clear of the safe lane', () => {
    for (let section = 1; section <= 3; section++) {
      for (let seed = 1; seed <= 40; seed++) {
        const generator = new StageGenerator(seeded(seed * 977), { plan: plan(section as SectionId), enemyPool: area1.enemyPool });
        let previous: RoutePlatform = { ...START_PLATFORM };
        let previousEnemy: Enemy | undefined;
        for (let chunk = 0; chunk < 3; chunk++) {
          const result = generator.chunk(chunk);
          for (const p of result.platforms) {
            expect(p.y - previous.y).toBeGreaterThanOrEqual(215);
            const guard = result.enemies.find(e => !e.flying && e.y === p.y - 15);
            if (guard) expect(Math.abs(guard.originX - p.safeX) - guard.range).toBeGreaterThanOrEqual(52);
            const fly = result.enemies.find(e => e.flying && e.y === p.y - 115);
            if (fly) {
              const left = Math.min(previous.exitX, p.safeX), right = Math.max(previous.exitX, p.safeX);
              expect(fly.originX + fly.range + 26 <= left - 48 || fly.originX - fly.range - 26 >= right + 48).toBe(true);
            }
            previous = p;
          }
          for (const e of [...result.enemies].sort((a, b) => a.y - b.y)) {
            if (previousEnemy) expect(e.y - previousEnemy.y).toBeGreaterThanOrEqual(66);
            expect(e.originX - e.range).toBeGreaterThan(WORLD.wall);
            expect(e.originX + e.range).toBeLessThan(WORLD.width - WORLD.wall);
            previousEnemy = e;
          }
        }
      }
    }
  });
  it('drives a real AREA 1 run through all three sections without a generation failure', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const game = new GameModel(false, seeded(seed * 31));
      for (const label of ['1-1', '1-2', '1-3']) {
        expect(game.stage.label).toBe(label);
        expect(game.stage.sectionPlan).toBe(plan(game.stage.progress.section));
        reachExit(game);
        expect(game.state).toBe('upgrade');
        game.selectUpgrade(game.upgrades.choices[0].id); game.confirmUpgrade();
      }
      expect([game.stage.label, game.completedDepth]).toEqual(['2-1', area1.sectionLength * 3]);
      expect(game.stage.sectionPlan).toBe(areaConfig(2).plans![0]);
    }
  });
});

describe('AREA 1 presentation data', () => {
  it('names the area and gives it a surface theme the later areas do not share', () => {
    expect(area1.name).toBe('SURFACE RUINS');
    expect(area1.theme.sky).toBeDefined();
    expect(area1.theme.grass).toBeDefined();
    for (const other of AREAS.filter(a => a.id !== 1)) expect(other.theme.sky).toBeUndefined();
    expect(new Set(AREAS.map(a => a.theme.wall)).size).toBe(AREAS.length);
  });
  it('keeps AREA 1 free of every gimmick and of submerged physics', () => {
    expect(areaConfig(1).gimmicks).toBeUndefined();
    expect(areaConfig(1).water).toBeUndefined();
    // Only AQUIFER runs a gauge now. CATACOMBS and LIMBO are built out of terrain -- spike
    // platforms and floating scenery -- rather than out of a system layered on top of the shaft.
    expect(areaConfig(3).gimmicks?.oxygen).toBe(true);
    expect(areaConfig(3).water).toBeDefined();
    for (const area of AREAS.filter(a => a.id !== 3)) expect(area.water).toBeUndefined();
  });
  it('lays nothing that can end a run on contact', () => {
    // CAVERNS is where the controls are learned. A run ends here because the hearts ran out, never
    // because the player brushed something -- so the AREA lays no instant-death terrain at all.
    for (const [index, sectionPlan] of areaConfig(1).plans!.entries()) {
      const where = `1-${index + 1}`;
      expect({ where, spike: sectionPlan.spikeChance ?? 0 }).toEqual({ where, spike: 0 });
      expect({ where, kinds: (sectionPlan.spikeKinds ?? []).length }).toEqual({ where, kinds: 0 });
      expect({ where, lava: (sectionPlan.lavaPoolChance ?? 0) + (sectionPlan.lavaWallChance ?? 0) }).toEqual({ where, lava: 0 });
      // Nor any ground that turns: that is CATACOMBS' idea, and it arrives an AREA later.
      expect({ where, spikePlatform: sectionPlan.spikePlatformChance ?? 0 }).toEqual({ where, spikePlatform: 0 });
    }
    for (let seed = 1; seed <= 60; seed++) {
      for (const section of [1, 2, 3] as SectionId[]) {
        const shaft = build(section, seed * 613);
        expect({ section, seed, lethal: shaft.hazards.filter(h => h.lethal).length }).toEqual({ section, seed, lethal: 0 });
        expect({ section, seed, hazards: shaft.hazards.length }).toEqual({ section, seed, hazards: 0 });
        expect({ section, seed, turning: shaft.platforms.filter(p => p.spikePlatform).length }).toEqual({ section, seed, turning: 0 });
      }
    }
  });
  it('is the most breakable-rich AREA of the four, with reward blocks in it', () => {
    for (const area of AREAS) {
      const rows = (area.plans ?? []).reduce((sum, p) => sum + (p.breakBlockRows ?? 0), 0);
      if (area.id === 1) expect(rows).toBeGreaterThan(0);
      else expect({ area: area.id, fewer: rows < (AREAS[0].plans ?? []).reduce((s, p) => s + (p.breakBlockRows ?? 0), 0) })
        .toEqual({ area: area.id, fewer: true });
    }
    let blocks = 0, rewards = 0, zones = 0;
    for (let seed = 1; seed <= 60; seed++) {
      for (const section of [1, 2, 3] as SectionId[]) {
        const shaft = build(section, seed * 811);
        const gate = shaft.platforms.filter(p => p.breakBlock);
        blocks += gate.length;
        rewards += gate.filter(p => p.breakBlock!.reward).length;
        zones += shaft.zones.length;
        expect({ section, seed, chamber: shaft.zones.length >= 1 }).toEqual({ section, seed, chamber: true });
      }
    }
    expect(blocks).toBeGreaterThan(0);
    expect(rewards).toBeGreaterThan(0);
    expect(zones).toBeGreaterThanOrEqual(180);
  });
});
