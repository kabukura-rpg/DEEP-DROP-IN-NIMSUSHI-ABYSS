import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { StageGenerator, type Platform, type RoutePlatform } from '../src/systems/StageGenerator';
import { areaConfig, AREAS, type AreaId, type SectionId } from '../src/data/areas';
import { BREAK_FLOOR_RULES } from '../src/data/structures';
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
  const airPockets = [] as { x: number; y: number; width: number; height: number }[];
  for (let chunk = 0; chunk < chunks; chunk++) {
    const result = generator.chunk(chunk);
    platforms.push(...result.platforms); hazards.push(...result.hazards);
    containers.push(...result.containers); airPockets.push(...result.airPockets);
  }
  const limit = WORLD.startY + pixels;
  return {
    limit, platforms: platforms.filter(p => p.y <= limit), hazards: hazards.filter(h => h.y <= limit),
    containers: containers.filter(c => c.y <= limit), airPockets: airPockets.filter(a => a.y <= limit),
    spikes: hazards.filter(h => h.y <= limit && isSpike(h.kind)),
    gates: platforms.filter(p => p.y <= limit && p.breakFloor),
  };
}
const spikeDensity = (area: AreaId, section: SectionId, seeds = 40) => {
  let count = 0;
  for (let seed = 1; seed <= seeds; seed++) count += build(area, section, seed * 733).spikes.length;
  return count / seeds;
};
/** A run parked in a SECTION with the shaft emptied, so a test owns exactly what exists. */
function bare(area: AreaId, section: SectionId) {
  const game = new GameModel(false, Math.random);
  game.jumpToStage(area, section);
  game.platforms = []; game.enemies = []; game.pickups = []; game.hazards = [];
  game.containers = []; game.bubbles = []; game.airPockets = [];
  game.player.invincible = 0;
  return game;
}
const tick = (game: GameModel, seconds: number, direction = 0, fire = false) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) game.step(1 / 120, direction, fire);
};

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

describe('SPIKE density and variants per AREA', () => {
  it('ramps up through AREA 1, starting with only a few', () => {
    const [one, two, three] = [1, 2, 3].map(s => spikeDensity(1, s as SectionId));
    expect(one).toBeGreaterThan(0);
    expect(two).toBeGreaterThan(one);
    expect(three).toBeGreaterThan(two);
    // 1-1 teaches: a run meets a handful, not a field of them.
    expect(one).toBeLessThan(4);
    expect(plan(1, 1).spikeChance!).toBeLessThan(plan(1, 2).spikeChance!);
    expect(plan(1, 2).spikeChance!).toBeLessThan(plan(1, 3).spikeChance!);
  });
  it('ramps up through AREA 2 as well', () => {
    const [one, two, three] = [1, 2, 3].map(s => spikeDensity(2, s as SectionId));
    expect(two).toBeGreaterThan(one);
    expect(three).toBeGreaterThan(two);
  });
  it('keeps 1-1 free of SPIKE for the whole opening grace', () => {
    const grace = plan(1, 1).graceDepth! * WORLD.pixelsPerMeter + WORLD.startY;
    for (let seed = 1; seed <= 60; seed++) for (const spike of build(1, 1, seed * 421).spikes) expect(spike.y).toBeGreaterThan(grace);
  });
  it('uses the stone variants in AREA 1 and the reef variants in AREA 2', () => {
    const seen = (area: AreaId) => {
      const kinds = new Set<string>();
      for (let seed = 1; seed <= 60; seed++) for (const s of [1, 2, 3] as const) for (const spike of build(area, s, seed * 97).spikes) kinds.add(spike.kind);
      return kinds;
    };
    expect([...seen(1)].sort()).toEqual(['ancientStake', 'stoneSpike']);
    expect([...seen(2)].sort()).toEqual(['poisonCoral', 'urchinSpike']);
  });
  it('leaves AREA 3 and AREA 4 to their own hazards', () => {
    for (const area of [3, 4] as const) for (const s of [1, 2, 3] as const) {
      for (let seed = 1; seed <= 12; seed++) expect(build(area, s, seed * 53).spikes).toEqual([]);
    }
  });
});

describe('SPIKE never sits where the route has to go', () => {
  it('leaves the guaranteed landing spot on every ledge clear, across every AREA 1 and AREA 2 section', () => {
    for (const area of [1, 2] as const) for (const s of [1, 2, 3] as const) {
      for (let seed = 1; seed <= 40; seed++) {
        const shaft = build(area, s, seed * 131);
        for (const row of shaft.platforms) {
          for (const spike of shaft.spikes) {
            if (Math.abs(spike.y + spike.height - row.y) > 2) continue;
            // The player's body standing on the guaranteed landing spot, plus room to arrive fast.
            // The patch may take either end of the ledge; what matters is that it takes neither
            // the landing spot nor the space the player occupies once they are standing on it.
            const clear = spike.x > row.safeX + 20 || spike.x + spike.width < row.safeX - 20;
            expect({ seed, safeX: row.safeX, spike: [spike.x, spike.x + spike.width], clear }).toMatchObject({ clear: true });
          }
        }
      }
    }
  });
  it('never puts SPIKE in front of an AREA 2 air source', () => {
    for (const s of [1, 2, 3] as const) for (let seed = 1; seed <= 60; seed++) {
      const shaft = build(2, s, seed * 271);
      const sources = [...shaft.containers, ...shaft.airPockets];
      for (const spike of shaft.spikes) for (const air of sources) {
        // A spike within reach of the column an air source is collected from is not laid at all,
        // so no seed can make touching SPIKE the price of a breath.
        const sameColumn = air.x < spike.x + spike.width + 26 && air.x + air.width > spike.x - 26;
        const above = air.y < spike.y + spike.height + 24 && air.y + air.height > spike.y - 300;
        expect(sameColumn && above).toBe(false);
      }
    }
  });
  it('never reaches the FINAL BOSS arena', () => {
    const game = new GameModel(false, Math.random);
    game.jumpToBoss();
    for (let i = 0; i < 120 * 40 && game.state === 'boss'; i++) {
      game.player.invincible = 99;
      game.step(1 / 120, 0, false);
      expect(game.hazards.filter(h => isSpike(h.kind))).toEqual([]);
      expect(game.platforms.filter(p => p.breakFloor)).toEqual([]);
    }
  });
});

describe('BREAK FLOOR is a gate, not an AREA 4 collapsing ledge', () => {
  /** One gate laid directly under the player, at the SECTION's own durability. */
  const withGate = (area: AreaId, section: SectionId) => {
    const game = bare(area, section);
    const durability = plan(area, section).breakFloorDurability ?? BREAK_FLOOR_RULES.durability;
    const gate: Platform = { id: 77, x: WORLD.wall, y: game.player.y + 40, width: WORLD.width - WORLD.wall * 2, breakable: false, state: 'stable', breakFloor: { hits: 0, durability } };
    game.platforms = [gate];
    game.player.vy = 240;
    return { game, gate, durability };
  };
  it('is landed on like any other floor: full reload, COMBO reset, and no timer started', () => {
    const { game, gate } = withGate(1, 2);
    game.ammo = 0; game.combo = 7;
    tick(game, 0.6);
    expect(game.player.grounded).toBe(gate.id);
    expect(game.ammo).toBe(game.stats.maxAmmo);
    expect(game.combo).toBe(0);
    expect(game.collapse.counting).toBe(0);
  });
  it('does not give way under the player, however long they stand on it', () => {
    const { game, gate } = withGate(1, 2);
    tick(game, 12);
    expect(game.platforms).toContain(gate);
    expect(gate.state).toBe('stable');
    expect(gate.breakFloor!.hits).toBe(0);
    expect(game.player.grounded).toBe(gate.id);
  });
  it('cracks on the way to breaking, taking exactly the SECTION plan durability in rounds', () => {
    const { game, gate, durability } = withGate(2, 1);
    expect(durability).toBeGreaterThan(1);
    tick(game, 0.6);
    let shots = 0;
    for (let i = 0; i < durability * 6 && game.platforms.includes(gate); i++) {
      game.events.length = 0;
      game.cooldown = 0; game.shoot(); shots++;
      tick(game, 0.25);
    }
    expect(shots).toBe(durability);
    expect(gate.breakFloor!.hits).toBe(durability);
    expect(game.platforms).not.toContain(gate);
  });
  it('lets the player fall through the moment it goes', () => {
    const { game, gate, durability } = withGate(1, 1);
    tick(game, 0.6);
    const standing = game.player.y;
    for (let i = 0; i < durability; i++) { game.cooldown = 0; game.shoot(); tick(game, 0.25); }
    expect(game.platforms).not.toContain(gate);
    expect(game.player.grounded).toBe(-1);
    tick(game, 0.5);
    expect(game.player.y).toBeGreaterThan(standing + 40);
  });
  it('can be opened by every one of the seven gun modules', () => {
    const modules = Object.keys(GUN_MODULES) as GunModuleId[];
    expect(modules.length).toBe(7);
    for (const id of modules) {
      const { game, gate } = withGate(3, 3);              // the toughest gate the game lays
      game.gun.equip(id);
      tick(game, 0.6);
      expect(game.player.grounded).toBe(gate.id);
      // BURST and LASER are one volley per press, so the trigger is released between shots the
      // way a player does -- holding it down would test nothing but `automatic`.
      for (let i = 0; i < 40 && game.platforms.includes(gate); i++) {
        game.ammo = game.stats.maxAmmo;
        tick(game, 0.12, 0, true); tick(game, 0.12, 0, false);
      }
      expect({ id, broken: !game.platforms.includes(gate) }).toEqual({ id, broken: true });
    }
  });
  it('can never strand a run: a gate always supplies the rounds it takes to open it', () => {
    // The worst case in the game: the toughest gate, the most expensive module, and the smallest
    // magazine a run ever carries. A full-width gate has no edge to step off, so without a
    // guarantee here the run would stand on a floor it could not open and never fall again.
    for (const id of Object.keys(GUN_MODULES) as GunModuleId[]) {
      const { game, gate } = withGate(3, 3);
      game.gun.equip(id);
      tick(game, 0.6);
      expect(game.player.grounded).toBe(gate.id);
      game.ammo = 0;                                   // arrive spent, the way a fight leaves you
      let frames = 0;
      for (; frames < 120 * 20 && game.platforms.includes(gate); frames++) {
        game.step(1 / 120, 0, frames % 24 < 12);       // press and release, as a player does
      }
      expect({ id, opened: !game.platforms.includes(gate) }).toEqual({ id, opened: true });
    }
  });
  it('is terrain work: no COMBO, no COIN, no kill, and no weapon rearm', () => {
    const { game, gate, durability } = withGate(1, 3);
    tick(game, 0.6);
    game.gun.equip('burst');
    const coins = game.coins.walletCoins, kills = game.kills;
    game.events.length = 0;
    let combo = 0, coinEvents = 0, killEvents = 0;
    for (let i = 0; i < 40 && game.platforms.includes(gate); i++) {
      game.ammo = game.stats.maxAmmo;
      tick(game, 0.1, 0, true); tick(game, 0.1, 0, false);
      combo = Math.max(combo, game.combo);
      coinEvents += game.events.filter(e => e.type === 'coin').length;
      killEvents += game.events.filter(e => e.type === 'kill').length;
      game.events.length = 0;
    }
    expect(game.platforms).not.toContain(gate);
    expect([combo, killEvents, coinEvents]).toEqual([0, 0, 0]);
    expect(game.kills).toBe(kills);
    expect(game.coins.walletCoins).toBe(coins);
    expect(durability).toBeGreaterThan(0);
  });
  it('never calls rearm(): a BURST already paid for finishes its rounds through the break', () => {
    const game = bare(1, 3);
    const gate: Platform = { id: 88, x: WORLD.wall, y: game.player.y + 40, width: WORLD.width - WORLD.wall * 2, breakable: false, state: 'stable', breakFloor: { hits: 0, durability: 1 } };
    game.platforms = [gate]; game.player.vy = 240;
    tick(game, 0.6);
    game.gun.equip('burst');
    game.stats.maxAmmo = 20; game.ammo = 20;
    // One press starts the burst; the first round opens the gate.
    game.step(1 / 120, 0, true);
    expect(game.gun.bursting).toBe(true);
    game.step(1 / 120, 0, false);
    expect(game.platforms).not.toContain(gate);
    // The rounds the press already paid for are still owed, because a break is not a boundary.
    expect(game.gun.bursting).toBe(true);
  });
  it('lands exactly once, like any ledge: standing on it is not a landing every frame', () => {
    // The landing path reloads, resets COMBO and plays a sound. A grounded player sits exactly on
    // the crossing line the landing test uses, so anything that clears `grounded` while they are
    // standing still turns holding position into a reload every frame.
    const { game, gate } = withGate(1, 2);
    tick(game, 0.6);
    expect(game.player.grounded).toBe(gate.id);
    game.events.length = 0;
    tick(game, 3);
    expect(game.events.filter(e => e.type === 'land').length).toBe(0);
    expect(game.player.grounded).toBe(gate.id);
  });
  it('shares nothing with the AREA 4 collapse system', () => {
    const { game, gate } = withGate(1, 2);
    tick(game, 0.6);
    expect(gate.breakable).toBe(false);
    expect(game.collapse.land(gate)).toBe(false);
    expect(game.collapse.shatter([gate], gate.x + 10, gate.y)).toEqual([]);
  });
});

describe('BREAK FLOOR placement', () => {
  it('lays the number of gates the SECTION plan asks for, spanning the shaft', () => {
    for (const area of AREAS) for (let n = 1; n <= area.sections; n++) {
      const section = n as SectionId, want = plan(area.id, section).breakFloorCount ?? 0;
      for (let seed = 1; seed <= 8; seed++) {
        const shaft = build(area.id, section, seed * 311);
        expect({ area: area.id, section, gates: shaft.gates.length }).toEqual({ area: area.id, section, gates: want });
        for (const gate of shaft.gates) {
          expect(gate.x).toBe(WORLD.wall);
          expect(gate.width).toBe(WORLD.width - WORLD.wall * 2);
          expect(gate.breakable).toBe(false);
          expect(gate.breakFloor!.durability).toBe(plan(area.id, section).breakFloorDurability ?? BREAK_FLOOR_RULES.durability);
        }
      }
    }
  });
  it('spaces the gates through the SECTION instead of clustering them', () => {
    for (const area of [1, 2, 3] as const) for (const s of [2, 3] as const) {
      const length = areaConfig(area).sectionLength;
      for (let seed = 1; seed <= 20; seed++) {
        const depths = build(area, s, seed * 907).gates.map(g => (g.y - WORLD.startY) / WORLD.pixelsPerMeter);
        expect(depths.length).toBeGreaterThan(1);
        // Nowhere near the opening, nowhere near the exit, and never two in a row.
        for (const depth of depths) { expect(depth).toBeGreaterThan(length * 0.1); expect(depth).toBeLessThan(length * 0.9); }
        for (let i = 1; i < depths.length; i++) expect(depths[i] - depths[i - 1]).toBeGreaterThan(length * 0.15);
      }
    }
  });
  it('AREA 4 keeps its own identity: collapsing ledges, no gates and no SPIKE', () => {
    for (const s of [1, 2, 3] as const) {
      expect(plan(4, s).breakFloorCount ?? 0).toBe(0);
      expect(plan(4, s).spikeChance ?? 0).toBe(0);
    }
  });
  it('still lets every SECTION reach its EXIT with gates in the shaft', () => {
    for (const area of [1, 2, 3] as const) for (const s of [1, 2, 3] as const) {
      const game = new GameModel(false, Math.random);
      game.jumpToStage(area, s as SectionId);
      const gate = reachExit(game);
      expect(game.state).toBe('upgrade');
      // Nothing is generated past the exit floor, so no gate can ever stand below the way out.
      expect(game.platforms.filter(p => p.breakFloor && p.y > gate.y)).toEqual([]);
    }
  });
});

describe('COMBO counts kills between touchdowns', () => {
  it('is reset by a BREAK FLOOR landing exactly as by any other', () => {
    const game = bare(1, 2);
    game.platforms = [{ id: 91, x: WORLD.wall, y: game.player.y + 40, width: WORLD.width - WORLD.wall * 2, breakable: false, state: 'stable', breakFloor: { hits: 0, durability: 2 } }];
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
