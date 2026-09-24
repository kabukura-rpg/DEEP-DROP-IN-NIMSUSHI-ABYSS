import { describe, expect, it } from 'vitest';
import { StageGenerator, canPassEnemy, type RoutePlatform, type Enemy } from '../src/systems/StageGenerator';
import { AREAS, type SectionPlan } from '../src/data/areas';
import { WORLD } from '../src/data/balance';
import { horizontalReach } from '../src/data/difficulty';
import { motionEnvelope } from '../src/data/enemies';
import type { StageFlowProfile } from '../src/data/stageFlow';

/**
 * STAGE GENERATION v2's shared placement rules, held on every AREA's own plan with the profile
 * forced all the way on -- the harshest version of each rule a SECTION could ever ask for.
 */
const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
const FULL: StageFlowProfile = { pathFlyers: 1, landingGuards: 1 };

function build(areaId: number, n: number, seed: number, flow?: StageFlowProfile) {
  const area = AREAS.find(a => a.id === areaId)!;
  // The profile is always the one given: none means the v1 placement, whatever the plan now carries.
  const plan: SectionPlan = { ...area.plans![n], flow };
  const g = new StageGenerator(seeded(seed), { plan, enemyPool: area.enemyPool, water: area.water, oxygen: area.gimmicks?.oxygen === true, breakable: area.gimmicks?.breakablePlatforms === true, sectionLength: area.sectionLength });
  const platforms: RoutePlatform[] = [], enemies: Enemy[] = [];
  const LIMIT = WORLD.startY + area.sectionLength * WORLD.pixelsPerMeter;
  for (let c = 0; c < 40; c++) { const k = g.chunk(c); platforms.push(...k.platforms); enemies.push(...k.enemies); }
  return { area, platforms: platforms.filter(p => p.y <= LIMIT), enemies: enemies.filter(e => e.y <= LIMIT) };
}

describe('STAGE GENERATION v2: enemies placed into the fall', () => {
  it('never stands a guard on, or patrolling over, the spot a fall lands on', () => {
    for (const area of AREAS) for (let n = 0; n < 3; n++) for (let seed = 1; seed <= 40; seed++) {
      const { platforms, enemies } = build(area.id, n, seed * 131, FULL);
      for (const p of platforms.filter(q => !q.limboHazard && q.safeZone === undefined && !q.breakBlock)) {
        for (const e of enemies) {
          if (e.slot !== 'guard' || Math.abs(e.y - (p.y - 15)) > 2) continue;
          const env = motionEnvelope(e);
          const covers = env.minX < p.safeX + 9 + 4 && env.maxX > p.safeX - 9 - 4;
          expect({ area: area.id, n, seed, covers }).toEqual({ area: area.id, n, seed, covers: false });
        }
      }
    }
  });

  it('only lays a flyer across a fall that can still go round all of it and make the landing', () => {
    let checked = 0;
    for (const area of AREAS) for (let n = 0; n < 3; n++) for (let seed = 1; seed <= 25; seed++) {
      const { platforms, enemies } = build(area.id, n, seed * 977, FULL);
      const rows = platforms.filter(p => p.safeZone === undefined).sort((a, b) => a.y - b.y);
      for (const e of enemies.filter(x => x.placed === 'path')) {
        const env = motionEnvelope(e);
        // The band this flyer sits in, and every exit above it / landing below it.
        const above = rows.filter(p => p.y < env.minY && !p.limboHazard), below = rows.filter(p => p.y > env.maxY && !p.limboHazard);
        if (!above.length || !below.length) continue;
        const topY = Math.max(...above.map(p => p.y)), botY = Math.min(...below.map(p => p.y));
        const exits = above.filter(p => p.y === topY), landings = below.filter(p => p.y === botY);
        // From every ledge a fall can start on, some landing below stays reachable by a way round the
        // flyer's whole movement. (Every landing need not: a band of several is a choice of landings.)
        for (const from of exits) {
          const way = landings.some(to => Math.abs(to.safeX - from.exitX) <= horizontalReach(to.y - from.y, area.water) && canPassEnemy(env, from, to, area.water));
          checked++;
          expect({ area: area.id, n, seed, enemy: e.id, way }).toEqual({ area: area.id, n, seed, enemy: e.id, way: true });
        }
      }
    }
    expect(checked).toBeGreaterThan(400);
  });

  // A ground-skull group's other members (`placed: 'group'`, DOWNWELL NORMAL GAMEPLAY CLONE) come with
  // the far-end guard spot, which a landing guard does not have; they are the group's, not the
  // profile's, so the count here is of what the profile decides.
  it('moves enemies without adding any: the rolls for whether a row has one are untouched', () => {
    const rows = (b: ReturnType<typeof build>) => b.enemies.filter(e => e.placed !== 'group').length;
    for (const area of AREAS) for (let n = 0; n < 3; n++) {
      let before = 0, after = 0;
      for (let seed = 1; seed <= 200; seed++) {
        before += rows(build(area.id, n, seed * 53));
        after += rows(build(area.id, n, seed * 53, FULL));
      }
      // The same rolls, a different stream after the first of them: counts agree within noise.
      expect(Math.abs(after - before) / before, `${area.id}-${n + 1}`).toBeLessThan(0.08);
    }
  });

  it('puts enemies across the fall that a plain route-following descent will meet', () => {
    const near = (build: ReturnType<typeof buildFor>) => build.enemies.filter(e => {
      const env = motionEnvelope(e);
      return build.rows.some((to, i) => {
        const from = build.rows[i - 1];
        if (!from || env.minY < from.y || env.maxY > to.y) return false;
        const t = ((env.minY + env.maxY) / 2 - from.y) / (to.y - from.y);
        const x = from.exitX + (to.safeX - from.exitX) * t;
        return x + 9 > env.minX && x - 9 < env.maxX;
      });
    }).length;
    const buildFor = (seed: number, flow?: StageFlowProfile) => {
      const b = build(1, 1, seed, flow);
      const ys = [...new Set(b.platforms.filter(p => p.safeZone === undefined && !p.breakBlock).map(p => p.y))].sort((a, z) => a - z);
      const rows = ys.map(y => b.platforms.find(p => p.y === y && p.safeZone === undefined)!);
      return { ...b, rows };
    };
    let v1 = 0, v2 = 0;
    for (let seed = 1; seed <= 60; seed++) { v1 += near(buildFor(seed * 7)); v2 += near(buildFor(seed * 7, FULL)); }
    expect(v2).toBeGreaterThan(v1 * 3);
  });
});
