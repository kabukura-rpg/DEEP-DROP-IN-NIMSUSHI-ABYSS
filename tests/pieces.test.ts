import { afterEach, describe, expect, it } from 'vitest';
import { StageGenerator, START_PLATFORM, canReachPlatform, type RoutePlatform } from '../src/systems/StageGenerator';
import { AREAS, areaConfig, type AreaId } from '../src/data/areas';
import { AREA1_PIECES, PiecePlanner, AREA1_GRAMMAR, type PieceId } from '../src/data/pieces';
import { setTerrainMode, type TerrainMode } from '../src/data/rhythm';
import { safeZoneRowClearance } from '../src/data/safeZone';
import { WORLD } from '../src/data/balance';

/**
 * AREA 1 TERRAIN PIECES.
 *
 * Every run here is seeded. The terrain mode is global, so each test selects the one it is about
 * and the shipping default is restored afterwards -- a leaked mode would quietly disarm the rest.
 */
const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
afterEach(() => setTerrainMode('grammar-v2'));
const SEEDS = Array.from({ length: 24 }, (_, i) => 41 + i * 97);

/** What the planner decided, reached through the generator that owns it. */
const pieceHistory = (g: StageGenerator): readonly { piece: PieceId; y: number }[] =>
  (g as unknown as { planner: PiecePlanner | null }).planner?.history ?? [];

/** A band that tiles the shaft is landable from anywhere above it; a narrow ledge is not. */
function spansShaft(band: readonly RoutePlatform[]) {
  const sorted = [...band].sort((a, b) => a.x - b.x);
  if (!sorted.length || sorted[0].x > WORLD.wall + 1) return false;
  let edge = sorted[0].x + sorted[0].width;
  for (const p of sorted.slice(1)) { if (p.x > edge + 1) return false; edge = Math.max(edge, p.x + p.width); }
  return edge >= WORLD.width - WORLD.wall - 1;
}

/** One SECTION, grouped into bands: every ledge at one height, route ledge first. */
function build(areaId: AreaId, section: number, seed: number) {
  const area = areaConfig(areaId);
  const g = new StageGenerator(seeded(seed), {
    plan: area.plans?.[section - 1], enemyPool: area.enemyPool, water: area.water,
    oxygen: area.gimmicks?.oxygen, sectionLength: area.sectionLength,
  });
  const limit = WORLD.startY + area.sectionLength * WORLD.pixelsPerMeter;
  const chunks = Math.ceil((limit - WORLD.startY) / WORLD.chunkHeight) + 2;
  const bands = new Map<number, RoutePlatform[]>();
  let enemies = 0, zones = 0;
  for (let c = 0; c < chunks; c++) {
    const k = g.chunk(c);
    // A GUN MODULE waits in a CAVE rather than a chamber; both are side rooms.
    zones += k.caves.filter(c2 => c2.bounds.y <= limit).length;
    for (const p of k.platforms) {
      if (p.y > limit || p.safeZone !== undefined) continue;
      const y = Math.round(p.y);
      bands.set(y, [...(bands.get(y) ?? []), p]);
    }
    enemies += k.enemies.filter(e => e.y <= limit).length;
    zones += k.safeZones.filter(z => z.y <= limit).length;
  }
  const ys = [...bands.keys()].sort((a, b) => a - b);
  return {
    ys, bands, enemies, zones, limit,
    pieces: pieceHistory(g).filter(h => h.y <= limit),
    gaps: ys.slice(1).map((y, i) => y - ys[i]),
  };
}

describe('AREA 1 terrain pieces', () => {
  it('runs in all three AREA 1 SECTIONs, and in no other AREA', () => {
    expect(areaConfig(1).plans?.every(p => p.pieces !== undefined)).toBe(true);
    for (const area of AREAS.filter(a => a.id !== 1)) {
      expect(area.plans?.every(p => p.pieces === undefined)).toBe(true);
    }
  });

  it('never generates a band that cannot be landed on from the one above it', () => {
    for (const mode of ['grammar-v2', 'rhythm-v1', 'legacy'] as const) {
      setTerrainMode(mode);
      for (const seed of SEEDS) for (const section of [1, 2, 3]) {
        const { ys, bands } = build(1, section, seed);
        let previous: RoutePlatform[] = [START_PLATFORM];
        for (const y of ys) {
          const here = bands.get(y)!;
          if (!spansShaft(here)) {
            const landable = here.some(p => previous.every(q => canReachPlatform(q, p)));
            expect(landable, `${mode} seed ${seed} section ${section} band at ${y}`).toBe(true);
          }
          previous = here;
        }
      }
    }
  });

  it('puts every one of the five pieces into an ordinary run', () => {
    const seen = new Set<PieceId>();
    const perSection: number[] = [];
    for (const seed of SEEDS) for (const section of [1, 2, 3]) {
      const kinds = new Set(build(1, section, seed).pieces.map(p => p.piece));
      for (const k of kinds) seen.add(k);
      perSection.push(kinds.size);
    }
    expect(seen).toEqual(new Set(AREA1_PIECES.map(p => p.id)));
    // A SECTION is never one shape repeated: three distinct pieces is the floor, not the average.
    expect(Math.min(...perSection)).toBeGreaterThanOrEqual(3);
  });

  it('lays a platform-free span that no row grammar ever produced', () => {
    const spanOf = (mode: TerrainMode) => {
      setTerrainMode(mode);
      let longest = 0, sections = 0, withSpan = 0;
      for (const seed of SEEDS) for (const section of [1, 2, 3]) {
        const { gaps } = build(1, section, seed);
        longest = Math.max(longest, ...gaps);
        sections++;
        if (gaps.some(g => g > 480)) withSpan++;
      }
      return { longest, share: withSpan / sections };
    };
    const legacy = spanOf('legacy'), rhythm = spanOf('rhythm-v1'), v2 = spanOf('grammar-v2');
    // Neither row grammar can reach half a screen: legacy tops out at its 272px step, the rhythm at
    // its 420px band. Only a piece can decline to lay a ledge at all.
    expect(legacy.share).toBe(0);
    expect(rhythm.share).toBe(0);
    expect(v2.longest).toBeGreaterThan(520);
    expect(v2.share).toBeGreaterThan(0.6);
  });

  it('lays bands holding more than one ledge, which no row grammar could', () => {
    const multiOf = (mode: TerrainMode) => {
      setTerrainMode(mode);
      let multi = 0, sections = 0;
      for (const seed of SEEDS) for (const section of [1, 2, 3]) {
        const { ys, bands } = build(1, section, seed);
        multi += ys.filter(y => bands.get(y)!.length > 1 && !spansShaft(bands.get(y)!)).length;
        sections++;
      }
      return multi / sections;
    };
    // A gate row is several platforms at one height, but it tiles the shaft -- it is a floor, not a
    // choice of landing. Excluded above, both row grammars have exactly none.
    expect(multiOf('legacy')).toBe(0);
    expect(multiOf('rhythm-v1')).toBe(0);
    expect(multiOf('grammar-v2')).toBeGreaterThan(2);
  });

  it('runs a route down one wall for several bands running', () => {
    let channels = 0;
    for (const seed of SEEDS) for (const section of [1, 2, 3]) {
      const { ys, bands, pieces } = build(1, section, seed);
      for (let i = 0; i < pieces.length; i++) {
        if (pieces[i].piece !== 'wallChannel') continue;
        const until = pieces[i + 1]?.y ?? Infinity;
        const rows = ys.filter(y => y >= pieces[i].y && y < until).map(y => bands.get(y)![0]);
        const hugging = rows.filter(p => p.x <= WORLD.wall + 2 || p.x + p.width >= WORLD.width - WORLD.wall - 2);
        // The piece is walked into rather than jumped to, so its first band may still be the
        // approach. What it may never be is a channel that never reaches its wall.
        if (rows.length >= 3) { expect(hugging.length).toBeGreaterThanOrEqual(2); channels++; }
      }
    }
    expect(channels).toBeGreaterThan(20);
  });

  it('gives a BREAK BLOCK row somewhere to fall to, without adding or removing one', () => {
    const gatesOf = (mode: TerrainMode) => {
      setTerrainMode(mode);
      const counts: number[] = [], drops: number[] = [];
      for (const seed of SEEDS) for (const section of [1, 2, 3]) {
        const { ys, bands, gaps } = build(1, section, seed);
        const gateRows = ys.filter(y => bands.get(y)!.some(p => p.breakBlock));
        counts.push(gateRows.length);
        for (const y of gateRows) {
          const i = ys.indexOf(y);
          if (i >= 0 && i < gaps.length) drops.push(gaps[i]);
        }
      }
      return { gates: counts.reduce((a, b) => a + b, 0), drops };
    };
    const legacy = gatesOf('legacy'), v2 = gatesOf('grammar-v2');
    // Exactly the gates the SECTION already owed: the piece wraps them, it does not schedule them.
    expect(v2.gates).toBe(legacy.gates);
    // ...and what is under one is now a fall rather than the next ordinary row.
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(v2.drops)).toBeGreaterThan(mean(legacy.drops) + 100);
  });

  it('keeps the guaranteed SAFE ZONE that a tight piece could have squeezed out', () => {
    for (const mode of ['grammar-v2', 'rhythm-v1', 'legacy'] as const) {
      setTerrainMode(mode);
      for (const seed of SEEDS) for (const section of [1, 2, 3]) {
        expect(build(1, section, seed).zones, `${mode} seed ${seed} section ${section}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('does not prop the terrain up with enemies', () => {
    const per = (mode: TerrainMode) => {
      setTerrainMode(mode);
      let total = 0, n = 0;
      for (const seed of SEEDS) for (const section of [1, 2, 3]) { total += build(1, section, seed).enemies; n++; }
      return total / n;
    };
    const legacy = per('legacy'), v2 = per('grammar-v2');
    expect(Math.abs(v2 - legacy) / legacy).toBeLessThan(0.10);
  });

  it('generates the same SECTION twice from the same seed', () => {
    for (const seed of SEEDS.slice(0, 6)) for (const section of [1, 2, 3]) {
      const a = build(1, section, seed), b = build(1, section, seed);
      expect(a.ys).toEqual(b.ys);
      expect(a.pieces).toEqual(b.pieces);
      expect([...a.bands.values()].flat()).toEqual([...b.bands.values()].flat());
    }
  });
});

describe('PiecePlanner', () => {
  it('never runs the same piece twice in a row', () => {
    for (const seed of SEEDS) {
      const planner = new PiecePlanner(AREA1_GRAMMAR, seeded(seed));
      let previous: PieceId | null = null;
      for (let i = 0; i < 300; i++) {
        const intent = planner.next(i * 250, 0, false);
        if (intent.piece !== previous) {
          const started = planner.history[planner.history.length - 1];
          expect(started.piece).not.toBe(previous);
          previous = intent.piece;
        }
      }
    }
  });

  it('hands a chamber a step it can actually be cut into', () => {
    const clearance = safeZoneRowClearance();
    for (const seed of SEEDS) {
      const planner = new PiecePlanner(AREA1_GRAMMAR, seeded(seed));
      for (let i = 0; i < 300; i++) {
        const due = i % 7 === 0;
        const intent = planner.next(i * 250, due ? clearance : 0, false);
        if (due) {
          expect(intent.step).toBeGreaterThanOrEqual(clearance);
          expect(intent.openSpan).toBe(false);
        }
      }
    }
  });

  it('hands a due gate to the piece that is built around one', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const planner = new PiecePlanner(AREA1_GRAMMAR, seeded(seed));
      for (let i = 0; i < 200; i++) {
        const intent = planner.next(i * 250, 0, i % 11 === 0);
        if (i % 11 === 0) expect(intent.piece).toBe('breakableDrop');
      }
    }
  });

  it('asks only for steps its own pieces declare', () => {
    const planner = new PiecePlanner(AREA1_GRAMMAR, seeded(5));
    const lo = Math.min(...AREA1_PIECES.flatMap(p => p.rows(() => 0, -1).map(r => r.step)));
    const hi = Math.max(...AREA1_PIECES.flatMap(p => p.rows(() => 0.999999, -1).map(r => r.step)));
    for (let i = 0; i < 2000; i++) {
      const intent = planner.next(i * 250, 0, false);
      expect(intent.step).toBeGreaterThanOrEqual(lo);
      expect(intent.step).toBeLessThanOrEqual(hi);
    }
  });
});
