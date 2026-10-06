import { StageGenerator, type RoutePlatform } from '../src/systems/StageGenerator';
import { areaConfig, type SectionId } from '../src/data/areas';
import { WORLD } from '../src/data/balance';
import { motionEnvelope, type Enemy } from '../src/data/enemies';
import { LIMBO_HAZARD_RULES } from '../src/data/structures';
import type { Hazard } from '../src/data/hazards';
import type { Doodad } from '../src/data/doodads';
import { seeded } from './limboBot';

/**
 * AREA 4 STRUCTURE METRICS, read off the generator alone (no play). Shared by the AREA 4 tests and by
 * the before/after measurement in tests/measure.
 */
const area4 = areaConfig(4);
export const SECTION_PIXELS = area4.sectionLength * WORLD.pixelsPerMeter;
const CHUNKS = Math.ceil((WORLD.startY + SECTION_PIXELS) / WORLD.chunkHeight) + 2;
const INNER_LEFT = WORLD.wall + 12, INNER_RIGHT = WORLD.width - WORLD.wall - 12;

export function limboSection(sectionId: SectionId, seed: number) {
  const generator = new StageGenerator(seeded(seed), {
    plan: area4.plans![sectionId - 1], enemyPool: area4.enemyPool, sectionLength: area4.sectionLength,
    breakable: area4.gimmicks?.breakablePlatforms === true,
  });
  const platforms: RoutePlatform[] = [], hazards: Hazard[] = [], doodads: Doodad[] = [], enemies: Enemy[] = [];
  let caves = 0;
  const bottom = WORLD.startY + SECTION_PIXELS;
  for (let chunk = 0; chunk < CHUNKS; chunk++) {
    const built = generator.chunk(chunk);
    platforms.push(...built.platforms.filter(p => p.y <= bottom));
    hazards.push(...built.hazards.filter(h => h.y <= bottom));
    doodads.push(...built.doodads.filter(d => d.y <= bottom));
    enemies.push(...built.enemies.filter(e => e.y <= bottom));
    caves += built.caves.length + built.safeZones.length;
  }
  const ledges = platforms.filter(p => !p.breakBlock && p.safeZone === undefined);
  const route = ledges.filter(p => !p.limboHazard);
  const barbs = ledges.filter(p => p.limboHazard);
  return { generator, platforms, ledges, route, barbs, hazards, doodads, enemies, caves };
}

/** Every harmful box, in player-centre coordinates: the centre is hurt anywhere inside it. */
export function harmBoxes(shaft: ReturnType<typeof limboSection>, withEnemies: boolean) {
  const boxes = shaft.barbs.map(f => ({ minX: f.x - 9, maxX: f.x + f.width + 9, minY: f.y - LIMBO_HAZARD_RULES.reach - 15, maxY: f.y + 12 + 15 }));
  for (const h of shaft.hazards) boxes.push({ minX: h.x - 9, maxX: h.x + h.width + 9, minY: h.y - 15, maxY: h.y + h.height + 15 });
  if (withEnemies) for (const e of shaft.enemies) {
    const env = motionEnvelope(e);
    boxes.push({ minX: env.minX - 9, maxX: env.maxX + 9, minY: env.minY - 10, maxY: env.maxY + 10 });
  }
  return boxes;
}

/**
 * The longest stretch a straight fall can make at one x without meeting anything harmful, the best
 * column of the shaft. The SECTION's quiet opening and its last 400px (the exit) are left out.
 */
export function longestClearFall(shaft: ReturnType<typeof limboSection>, withEnemies: boolean) {
  const boxes = harmBoxes(shaft, withEnemies);
  const top = WORLD.startY + 300, bottom = WORLD.startY + SECTION_PIXELS - 400;
  let best = 0;
  for (let x = INNER_LEFT; x <= INNER_RIGHT; x += 2) {
    const ys = boxes.filter(b => x >= b.minX && x <= b.maxX && b.maxY > top && b.minY < bottom).map(b => [b.minY, b.maxY] as const).sort((a, b) => a[0] - b[0]);
    let from = top;
    for (const [lo, hi] of ys) { best = Math.max(best, lo - from); from = Math.max(from, hi); }
    best = Math.max(best, bottom - from);
  }
  return best;
}

/** Share of fall columns that a straight fall through each 800px window would meet a hazard in. */
export function hazardCoverage(shaft: ReturnType<typeof limboSection>) {
  const boxes = harmBoxes(shaft, false);
  const top = WORLD.startY + 300, bottom = WORLD.startY + SECTION_PIXELS - 400;
  const shares: number[] = [];
  for (let y = top; y + WORLD.height <= bottom; y += WORLD.height) {
    let hit = 0, total = 0;
    for (let x = INNER_LEFT; x <= INNER_RIGHT; x += 2) {
      total++;
      if (boxes.some(b => x >= b.minX && x <= b.maxX && b.maxY > y && b.minY < y + WORLD.height)) hit++;
    }
    shares.push(hit / total);
  }
  return shares.reduce((a, b) => a + b, 0) / Math.max(1, shares.length);
}

export const quantiles = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
  return { n: s.length, min: s[0], p25: q(0.25), med: q(0.5), p75: q(0.75), max: s[s.length - 1], mean: +(s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)).toFixed(1) };
};
