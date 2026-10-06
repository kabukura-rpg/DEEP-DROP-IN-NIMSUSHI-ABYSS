import { describe, it } from 'vitest';
import type { SectionId } from '../../src/data/areas';
import { WORLD } from '../../src/data/balance';
import { activeRun, passiveRun, straightRun, EXPERT, HUMAN, HUMAN_MOBILE, type RunResult } from '../limboBot';
import { hazardCoverage, limboSection, longestClearFall, quantiles, SECTION_PIXELS } from '../limboMetrics';

declare const process: { env: Record<string, string | undefined> };

/**
 * AREA 4 / LIMBO before-after measurement. Not part of the suite (tests/measure is excluded); run with
 *   LIMBO_SEEDS=60 LIMBO_PLAY=60 npx vitest run --config vitest.measure.mts
 * Prints one JSON report per SECTION: structure (widths, counts, coverage, enemy x, longest straight
 * drop) and five players -- PASSIVE, STRAIGHT (shoots, never steers), HUMAN, EXPERT, HUMAN on a phone.
 */
const SEEDS = Number(process.env.LIMBO_SEEDS ?? 30);
const PLAY = Number(process.env.LIMBO_PLAY ?? SEEDS);
const SECTIONS: SectionId[] = [1, 2, 3];
const screens = SECTION_PIXELS / WORLD.height;

function summarise(runs: RunResult[]) {
  const n = runs.length, count = (o: RunResult['outcome']) => runs.filter(r => r.outcome === o).length;
  const deaths = runs.filter(r => r.outcome === 'dead');
  const hits = runs.reduce((a, r) => ({ barb: a.barb + r.hits.barb, enemy: a.enemy + r.hits.enemy, other: a.other + r.hits.other }), { barb: 0, enemy: 0, other: 0 });
  const kinds: Record<string, number> = {};
  for (const r of deaths) kinds[`${r.deathBy}:${r.deathKind}`] = (kinds[`${r.deathBy}:${r.deathKind}`] ?? 0) + 1;
  return {
    n, clear: +(count('clear') / n * 100).toFixed(1), dead: +(count('dead') / n * 100).toFixed(1), stuck: count('stuck'), timeout: count('timeout'),
    hitsPerRun: { barb: +(hits.barb / n).toFixed(2), enemy: +(hits.enemy / n).toFixed(2), other: +(hits.other / n).toFixed(2) },
    deathBy: kinds,
    deathDepthMed: deaths.length ? quantiles(deaths.map(r => Math.round(r.depth))).med : null,
    secondsMed: quantiles(runs.map(r => +r.seconds.toFixed(1))).med,
    shotsPerMin: +(runs.reduce((a, r) => a + r.shots, 0) / Math.max(1, runs.reduce((a, r) => a + r.seconds, 0)) * 60).toFixed(0),
    landingsPerScreen: +(runs.reduce((a, r) => a + r.landings, 0) / n / screens).toFixed(2),
    killsPerRun: +(runs.reduce((a, r) => a + r.kills, 0) / n).toFixed(1),
  };
}

describe('AREA 4 LIMBO measurement', () => {
  for (const sectionId of SECTIONS) {
    it(`4-${sectionId}`, () => {
      const widths: number[] = [], routeCount: number[] = [], barbCount: number[] = [], coverage: number[] = [], enemies: number[] = [], clear: number[] = [], clearHaz: number[] = [];
      const xBins = [0, 0, 0, 0, 0];
      for (let seed = 1; seed <= SEEDS; seed++) {
        const shaft = limboSection(sectionId, seed * 977);
        const route = shaft.route.filter(p => p.width < WORLD.width - WORLD.wall * 2 - 2);
        widths.push(...route.map(p => p.width));
        routeCount.push(route.length);
        barbCount.push(shaft.barbs.length + shaft.hazards.length);
        coverage.push(hazardCoverage(shaft));
        enemies.push(shaft.enemies.length);
        for (const e of shaft.enemies) xBins[Math.max(0, Math.min(4, Math.floor((e.x - WORLD.wall) / ((WORLD.width - WORLD.wall * 2) / 5))))]++;
        clear.push(longestClearFall(shaft, true));
        clearHaz.push(longestClearFall(shaft, false));
      }
      const total = xBins.reduce((a, b) => a + b, 0);
      const structure = {
        platformWidth: quantiles(widths),
        platformsPerSection: quantiles(routeCount),
        platformsPerScreen: +(routeCount.reduce((a, b) => a + b, 0) / SEEDS / screens).toFixed(2),
        hazardsPerSection: quantiles(barbCount),
        hazardCoverage: +(coverage.reduce((a, b) => a + b, 0) / SEEDS).toFixed(3),
        enemiesPerSection: quantiles(enemies),
        enemiesPerOriginalScreen: +(enemies.reduce((a, b) => a + b, 0) / SEEDS * 28.6 / 570).toFixed(2),
        enemyX5: xBins.map(b => +(b / total).toFixed(2)),
        longestClearFall_px: quantiles(clear.map(Math.round)),
        longestClearFallHazardOnly_px: quantiles(clearHaz.map(Math.round)),
      };
      const columns = [50, 95, 140, 185, 225, 265, 310, 355, 400];
      const passive: RunResult[] = [];
      for (let seed = 1; seed <= Math.min(PLAY, 20); seed++) for (const x of columns) passive.push(passiveRun(4, sectionId, seed * 131, x));
      const straight: RunResult[] = [];
      for (let seed = 1; seed <= Math.min(PLAY, 20); seed++) for (const x of columns) straight.push(straightRun(4, sectionId, seed * 131, x));
      const active: RunResult[] = [], expert: RunResult[] = [];
      for (let seed = 1; seed <= PLAY; seed++) active.push(activeRun(4, sectionId, seed * 263, 200, HUMAN));
      for (let seed = 1; seed <= PLAY; seed++) expert.push(activeRun(4, sectionId, seed * 263, 200, EXPERT));
      const mobile: RunResult[] = [];
      for (let seed = 1; seed <= PLAY; seed++) mobile.push(activeRun(4, sectionId, seed * 263, 200, HUMAN_MOBILE));
      console.log(JSON.stringify({ section: `4-${sectionId}`, structure, passive: { ...summarise(passive), exitFloorOrClear: +(passive.filter(r => r.outcome === 'clear' || r.outcome === 'exitFloor').length / passive.length * 100).toFixed(1) }, straight: summarise(straight), active: summarise(active), expert: summarise(expert), mobile: summarise(mobile) }));
    }, 1_800_000);
  }
});
