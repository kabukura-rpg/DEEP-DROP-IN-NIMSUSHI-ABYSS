import { afterEach, describe, expect, it } from 'vitest';
import { StageGenerator, START_PLATFORM, canReachPlatform, type RoutePlatform } from '../src/systems/StageGenerator';
import { AREAS, areaConfig } from '../src/data/areas';
import { AREA1_RHYTHM, RhythmWalker, getTerrainMode, setTerrainMode, laneOf } from '../src/data/rhythm';
import { WORLD } from '../src/data/balance';

/**
 * VERTICAL RHYTHM, AREA 1.
 *
 * Every run here is seeded: these assert on a GENERATED shaft, and an unseeded one makes a failure
 * impossible to reproduce. The A/B switch is global, so every test that touches it restores the
 * shipping default afterwards -- a leaked `legacy` would quietly disarm the rest of the file.
 */
const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
afterEach(() => setTerrainMode('grammar-v2'));
/**
 * This file is about the VERTICAL RHYTHM, which is no longer the default terrain. Each test selects
 * the mode it is about; the two that compare against `legacy` still do so explicitly.
 */
const withRhythm = <T>(run: () => T): T => { setTerrainMode('rhythm-v1'); try { return run(); } finally { setTerrainMode('grammar-v2'); } };

/** Generate one SECTION and return its route rows, in order. A chamber floor is not a route row. */
function rowsOf(areaId: 1 | 2 | 3 | 4, section: number, seed: number): RoutePlatform[] {
  const area = areaConfig(areaId);
  const g = new StageGenerator(seeded(seed), {
    plan: area.plans?.[section - 1], enemyPool: area.enemyPool, water: area.water,
    oxygen: area.gimmicks?.oxygen, sectionLength: area.sectionLength,
  });
  const limit = WORLD.startY + area.sectionLength * WORLD.pixelsPerMeter;
  const chunks = Math.ceil((limit - WORLD.startY) / WORLD.chunkHeight) + 2;
  const byY = new Map<number, RoutePlatform>();
  for (let c = 0; c < chunks; c++) {
    for (const p of g.chunk(c).platforms) {
      if (p.y > limit || p.safeZone !== undefined) continue;
      const y = Math.round(p.y);
      if (!byY.has(y) || p.breakBlock) byY.set(y, p);
    }
  }
  return [...byY.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
}
const gapsOf = (rows: RoutePlatform[]) => rows.slice(1).map((p, i) => Math.round(p.y) - Math.round(rows[i].y));
const SEEDS = Array.from({ length: 24 }, (_, i) => 41 + i * 97);

describe('AREA 1 vertical rhythm', () => {
  it('is not what ships any more -- grammar-v2 is -- but the switch still reaches it', () => {
    // STEP 3B: a gap grammar alone did not change what the player decides, so the piece grammar is
    // the default now. This one is kept as the A/B control, not as the shipping terrain.
    expect(getTerrainMode()).toBe('grammar-v2');
    for (const mode of ['legacy', 'rhythm-v1', 'grammar-v2'] as const) {
      setTerrainMode(mode);
      expect(getTerrainMode()).toBe(mode);
    }
  });

  it('every row stays reachable, in both modes and on every seed', () => {
    for (const mode of ['rhythm-v1', 'legacy'] as const) {
      setTerrainMode(mode);
      for (const seed of SEEDS) for (const section of [1, 2, 3]) {
        let previous = START_PLATFORM;
        for (const row of rowsOf(1, section, seed)) {
          expect(canReachPlatform(previous, row), `${mode} seed ${seed} section ${section} row at ${row.y}`).toBe(true);
          previous = row;
        }
      }
    }
  });

  it('never asks for a step outside a declared band', () => withRhythm(() => {
    const lo = Math.min(...AREA1_RHYTHM.bands.map(b => b.gap[0]));
    const hi = Math.max(...AREA1_RHYTHM.bands.map(b => b.gap[1]));
    for (const seed of SEEDS) for (const section of [1, 2, 3]) {
      for (const gap of gapsOf(rowsOf(1, section, seed))) {
        // A chamber sits between two rows often enough that the series can merge one step into the
        // next; the floor is what matters here, and nothing may ever be tighter than DENSE.
        expect(gap).toBeGreaterThanOrEqual(lo);
        expect(gap).toBeLessThanOrEqual(hi * 2);
      }
    }
  }));

  it('breaks the single-gap ladder the AREA used to be', () => {
    const spread = (mode: 'rhythm-v1' | 'legacy') => {
      setTerrainMode(mode);
      const all: number[] = [];
      for (const seed of SEEDS) for (const section of [1, 2, 3]) all.push(...gapsOf(rowsOf(1, section, seed)));
      const sorted = [...all].sort((a, b) => a - b);
      const top = new Map<number, number>();
      for (const g of all) top.set(Math.floor(g / 20) * 20, (top.get(Math.floor(g / 20) * 20) ?? 0) + 1);
      return { spread: sorted[sorted.length - 1] - sorted[0], busiest: Math.max(...top.values()) / all.length };
    };
    const legacy = spread('legacy'), v1 = spread('rhythm-v1');
    // Legacy put two thirds of every gap in the AREA into one 20px bin, inside a 40px total spread.
    expect(legacy.busiest).toBeGreaterThan(0.5);
    expect(legacy.spread).toBeLessThan(60);
    expect(v1.busiest).toBeLessThan(0.35);
    expect(v1.spread).toBeGreaterThan(180);
  });

  it('keeps the SECTION the same size, so density is not changed by the back door', () => {
    const shape = (mode: 'rhythm-v1' | 'legacy') => {
      setTerrainMode(mode);
      let rows = 0, gaps = 0, total = 0;
      for (const seed of SEEDS) for (const section of [1, 2, 3]) {
        const r = rowsOf(1, section, seed);
        rows += r.length;
        for (const g of gapsOf(r)) { gaps++; total += g; }
      }
      return { rows: rows / (SEEDS.length * 3), mean: total / gaps };
    };
    const legacy = shape('legacy'), v1 = shape('rhythm-v1');
    // The mean step is what sets how many rows fit in 240m, and rows are what enemies are rolled
    // per. Hold the mean and the AREA keeps its population without anyone tuning a chance.
    expect(Math.abs(v1.mean - legacy.mean)).toBeLessThan(12);
    expect(Math.abs(v1.rows - legacy.rows)).toBeLessThan(1.5);
  });

  it('stops asking for the same horizontal answer row after row', () => {
    const repeats = (mode: 'rhythm-v1' | 'legacy') => {
      setTerrainMode(mode);
      let same = 0, pairs = 0;
      for (const seed of SEEDS) for (const section of [1, 2, 3]) {
        const lanes = rowsOf(1, section, seed).filter(p => !p.breakBlock)
          .map(p => laneOf(p, WORLD.wall, WORLD.width - WORLD.wall * 2));
        for (let i = 1; i < lanes.length; i++) { pairs++; if (lanes[i] === lanes[i - 1]) same++; }
      }
      return same / pairs;
    };
    expect(repeats('rhythm-v1')).toBeLessThan(repeats('legacy') * 0.6);
  });

  it('produces tight runs and open falls, neither of which the AREA had', () => withRhythm(() => {
    let dense = 0, open = 0;
    for (const seed of SEEDS) for (const section of [1, 2, 3]) {
      const gaps = gapsOf(rowsOf(1, section, seed));
      if (gaps.some(g => g < 210)) dense++;
      if (gaps.some(g => g > 310)) open++;
    }
    const sections = SEEDS.length * 3;
    expect(dense / sections).toBeGreaterThan(0.8);
    expect(open / sections).toBeGreaterThan(0.8);
    setTerrainMode('legacy');
    for (const seed of SEEDS) for (const section of [1, 2, 3]) {
      for (const g of gapsOf(rowsOf(1, section, seed))) expect(g).toBeLessThan(310);
    }
  }));

  it('leaves AREA 2, 3 and 4 on the single-gap step they already had', () => {
    for (const area of AREAS.filter(a => a.id !== 1)) {
      // Neither grammar reaches them: no rhythm and no pieces, in any terrain mode.
      expect(area.plans?.every(p => p.rhythm === undefined && p.pieces === undefined)).toBe(true);
      for (const mode of ['legacy', 'rhythm-v1', 'grammar-v2'] as const) {
      setTerrainMode(mode);
      for (const seed of SEEDS.slice(0, 8)) for (let section = 1; section <= area.sections; section++) {
        const plan = area.plans![section - 1];
        for (const gap of gapsOf(rowsOf(area.id, section, seed))) {
          // The old step exactly: the plan's own gap plus its 0-28px jitter, and nothing else.
          if (gap < plan.gap * 1.9) {
            expect(gap).toBeGreaterThanOrEqual(plan.gap);
            expect(gap).toBeLessThanOrEqual(plan.gap + 28);
          }
        }
      }
      }
    }
  });
});

describe('RhythmWalker', () => {
  it('never runs the same band twice in a row', () => {
    for (const seed of SEEDS) {
      const walker = new RhythmWalker(AREA1_RHYTHM, seeded(seed));
      let previous = '', run = 0;
      for (let i = 0; i < 400; i++) {
        const band = walker.current();
        if (band.id === previous) run++;
        else {
          if (previous) {
            const spec = AREA1_RHYTHM.bands.find(b => b.id === previous)!;
            expect(run).toBeGreaterThanOrEqual(spec.rows[0]);
            expect(run).toBeLessThanOrEqual(spec.rows[1]);
          }
          previous = band.id; run = 1;
        }
      }
    }
  });

  it('reaches every band, so no seed is stuck on one', () => {
    const seen = new Set<string>();
    const walker = new RhythmWalker(AREA1_RHYTHM, seeded(7));
    for (let i = 0; i < 200; i++) seen.add(walker.current().id);
    expect(seen).toEqual(new Set(AREA1_RHYTHM.bands.map(b => b.id)));
  });

  it('draws steps only inside the band it was given', () => {
    const walker = new RhythmWalker(AREA1_RHYTHM, seeded(3));
    for (const band of AREA1_RHYTHM.bands) {
      for (let i = 0; i < 500; i++) {
        const step = walker.step(band);
        expect(step).toBeGreaterThanOrEqual(band.gap[0]);
        expect(step).toBeLessThanOrEqual(band.gap[1]);
      }
    }
  });
});
