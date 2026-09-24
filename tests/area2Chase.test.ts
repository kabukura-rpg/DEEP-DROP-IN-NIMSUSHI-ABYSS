import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { StageGenerator, canReachPlatform, START_PLATFORM, type RoutePlatform, type Enemy } from '../src/systems/StageGenerator';
import { areaConfig, type SectionId } from '../src/data/areas';
import { WORLD } from '../src/data/balance';
import { ENEMY_TYPES, motionEnvelope, spawnEnemy } from '../src/data/enemies';
import { CHASE_STEP, GHOST_RULES, SKULL_RULES, dormantGhost, idleSkull, inSight } from '../src/data/chasers';
import { SPIKE_PLATFORM_RULES, spikePlatform } from '../src/data/structures';
import { CATACOMB_MAX_STEP } from '../src/data/catacombTerrain';

const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
const area2 = areaConfig(2);
const LIMIT = WORLD.startY + area2.sectionLength * WORLD.pixelsPerMeter;

/** One CATACOMB SECTION as the game builds it, grouped into bands. */
function shaft(sectionId: SectionId, seed: number) {
  const g = new StageGenerator(seeded(seed), { plan: area2.plans![sectionId - 1], enemyPool: area2.enemyPool, sectionLength: area2.sectionLength });
  const platforms: RoutePlatform[] = [], enemies: Enemy[] = [], zones: { x: number; y: number; width: number; height: number }[] = [];
  for (let c = 0; c < 30; c++) { const k = g.chunk(c); platforms.push(...k.platforms); enemies.push(...k.enemies); zones.push(...k.safeZones); }
  const rows = platforms.filter(p => p.y <= LIMIT && p.safeZone === undefined);
  const heights = [...new Set(rows.map(p => Math.round(p.y)))].sort((a, b) => a - b);
  return { rows, heights, band: (y: number) => rows.filter(p => Math.round(p.y) === y), enemies: enemies.filter(e => e.y <= LIMIT), zones };
}
type Box = { minX: number; maxX: number; minY: number; maxY: number };
const meets = (a: Box, b: Box) => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;

/** A bare CATACOMB run with the world cleared, for chaser fixtures. */
function bare(sectionId: SectionId = 2) {
  const g = new GameModel(false, seeded(4401));
  g.jumpToStage(2, sectionId);
  g.platforms = []; g.enemies = []; g.pickups = []; g.hazards = []; g.doodads = []; g.safeZones = [];
  g.player.invincible = 0;
  return g;
}
/** Holds the player still in mid-shaft, so only the chaser moves. */
const holdStill = (g: GameModel, x = 225, y = 2000) => { g.player.x = x; g.player.y = y; g.player.vy = 0; g.player.grounded = -1; g.bullets = []; };
/** Stands the player still ON a floor, so a step moves nothing about them at any frame size. */
const standStill = (g: GameModel, x: number, y: number) => {
  const floor = { id: 777, x: 28, y: y + 15, width: 394 };
  if (!g.platforms.some(p => p.id === 777)) g.platforms.push(floor);
  g.player.x = x; g.player.y = y; g.player.vy = 0; g.player.grounded = 777; g.bullets = [];
};

describe('CATACOMB terrain is walked, not fallen through', () => {
  /** Longest straight drop, for a body dropped at the best column of the SECTION, never steering. */
  const bestStraightDrop = (s: ReturnType<typeof shaft>) => {
    const ledges = s.rows.filter(p => !p.breakBlock);
    let best = 0;
    for (let x = WORLD.wall + 9; x <= WORLD.width - WORLD.wall - 9; x += 4) {
      const stops = [WORLD.startY, ...ledges.filter(p => x + 9 > p.x && x - 9 < p.x + p.width).map(p => p.y).sort((a, b) => a - b), LIMIT];
      for (let i = 1; i < stops.length; i++) best = Math.max(best, stops[i] - stops[i - 1]);
    }
    return best;
  };

  /**
   * Measured on these 200 seeds at c8a9262, before the rework, the best straight column of a CATACOMB
   * SECTION fell (median / 90th percentile / the SHORTEST of all 200):
   *     2-1  2,507 / 2,768 / 2,001px      2-2  2,570 / 2,852 / 2,028px      2-3  2,648 / 3,093 / 2,317px
   * So: the median is now under half of what it was, and nine SECTIONs in ten now drop less than the
   * old SECTION with the LEAST free fall did.
   */
  /**
   * STAGE GENERATION v2 took the shelves ~40% further apart (3.8 rows a screen -> 2.3): the rework's
   * "halve the best straight column" was a statement about that old density, and v2 retires it on
   * purpose -- a shaft of shelves every 200px is the ladder PHASE 7C-1 measured the game out of.
   * What the AREA keeps is that it is still WALKED rather than fallen through: its best straight
   * column falls less than the ladder the rework replaced, at the median and at the 90th percentile
   * (measured before the rework, 200 seeds: 2,507 / 2,570 / 2,648 and 2,768 / 2,852 / 3,093px).
   */
  it('still falls less than the old ladder did, even with its shelves further apart', () => {
    const ladder = { 1: { median: 2507, p90: 2768 }, 2: { median: 2570, p90: 2852 }, 3: { median: 2648, p90: 3093 } };
    for (const sectionId of [1, 2, 3] as SectionId[]) {
      const drops = Array.from({ length: 200 }, (_, i) => bestStraightDrop(shaft(sectionId, (i + 1) * 811))).sort((a, b) => a - b);
      expect(drops[100], `2-${sectionId} median`).toBeLessThan(ladder[sectionId].median);
      expect(drops[180], `2-${sectionId} p90`).toBeLessThan(ladder[sectionId].p90);
    }
  });

  it('never asks for a single step longer than a gate drop', () => {
    for (const sectionId of [1, 2, 3] as SectionId[]) {
      for (let seed = 1; seed <= 40; seed++) {
        const s = shaft(sectionId, seed * 317);
        for (let i = 1; i < s.heights.length; i++) expect(s.heights[i] - s.heights[i - 1]).toBeLessThanOrEqual(CATACOMB_MAX_STEP + 1);
      }
    }
  });

  it('lays a shelf under every exit of a baffle run, and walks the player to its far end', () => {
    let baffles = 0;
    for (const sectionId of [1, 2, 3] as SectionId[]) {
      // 80 seeds: v2 lays two or three baffles a run instead of three to five, so it takes twice the
      // seeds to check the same number of them.
      for (let seed = 1; seed <= 80; seed++) {
        const s = shaft(sectionId, seed * 131);
        let above: RoutePlatform[] = [{ ...START_PLATFORM }];
        for (const y of s.heights) {
          const here = s.band(y);
          if (here.length > 1 && here.every(p => p.breakBlock)) { above = [here[0]]; continue; }
          const route = here[0];
          const exits = above.map(p => p.exitX), lo = Math.min(...exits), hi = Math.max(...exits);
          const wallHeld = route.x <= WORLD.wall + 1 || route.x + route.width >= WORLD.width - WORLD.wall - 1;
          if (here.length === 1 && wallHeld && route.safeX === Math.round((lo + hi) / 2) && route.width >= 228) {
            baffles++;
            // Covers every exit above with a body and a margin to spare: the fall lands, always.
            expect(route.x + 21).toBeLessThanOrEqual(lo);
            expect(hi).toBeLessThanOrEqual(route.x + route.width - 21);
            // And the way on is the far end, so the shelf is crossed, never simply fallen off: at the
            // least the 21px the landing sits inside the shelf's end plus the 12px step off it.
            expect(Math.abs(route.exitX - route.safeX)).toBeGreaterThanOrEqual(33);
            // Spiked since v2 -- with a warning that always outlasts the walk off it.
            expect(route.spikePlatform?.warning).toBeGreaterThanOrEqual(Math.abs(route.exitX - route.safeX) / 350 + 0.35 - 1e-9);
          }
          above = here;
        }
      }
    }
    expect(baffles).toBeGreaterThan(40 * 3 * 10);
  });

  it('gets harder by SECTION through its shape and its chasers, not its roster', () => {
    const plans = area2.plans!;
    expect(plans.map(p => p.ghosts!.count)).toEqual([4, 6, 8]);
    expect(plans[0].ghosts!.speed).toBeLessThan(plans[1].ghosts!.speed);
    expect(plans[1].ghosts!.speed).toBeLessThan(plans[2].ghosts!.speed);
    // Skulls are held back for 2-1 and arrive in 2-2.
    expect(plans[0].enemyExclude).toContain('flyingSkull');
    expect(plans[1].enemyExclude ?? []).not.toContain('flyingSkull');
    // Gaps narrow. (Every ledge is spiked in every SECTION since v2, so spikes no longer grade them.)
    const slot = (i: number) => plans[i].pieces!.pieces.find(p => p.id === 'slot')!.rows(seeded(1), 1)[0];
    expect(slot(0).slot![0]).toBeGreaterThan(slot(1).slot![0]);
    expect(slot(1).slot![0]).toBeGreaterThan(slot(2).slot![0]);
    for (const i of [0, 1, 2]) expect(slot(i).spikeChance).toBe(1);
    // And the rolled roster is no denser than the catacombs had before the rework (16.7/23.0/27.6).
    // Ghosts are left out of this count: they are laid on a schedule of their own, raised on purpose
    // by Human Review v2, and checked against that schedule above and in the safety pass.
    // Per 100m: STAGE GENERATION v2 made the SECTION longer (300 -> 450m), and a longer SECTION is
    // not a denser roster. The caps are the old per-SECTION ones over the old 300m.
    const per100 = [1, 2, 3].map(n => { let e = 0; for (let seed = 1; seed <= 40; seed++) e += shaft(n as SectionId, seed * 53).enemies.filter(x => x.ai?.kind !== 'ghost').length; return e / 40 * 100 / area2.sectionLength; });
    [17.5, 24, 29].forEach((cap, i) => expect(per100[i], `2-${i + 1}`).toBeLessThan(cap / 3));
  });
});

describe('CATACOMB generation safety across 1,500 SECTIONs', () => {
  for (const sectionId of [1, 2, 3] as SectionId[]) {
    it(`2-${sectionId}: 500 seeds with no dead end, no forced spike hit, no blocked landing and no chaser misplaced`, () => {
      for (let seed = 1; seed <= 500; seed++) {
        const s = shaft(sectionId, seed * 4099 + sectionId * 13);
        const tag = `2-${sectionId} seed ${seed}`;
        let above: RoutePlatform[] = [{ ...START_PLATFORM }];
        for (const y of s.heights) {
          const here = s.band(y);
          if (here.length > 1 && here.every(p => p.breakBlock)) { above = [here[0]]; continue; }
          const route = here[0];
          // The route: reachable from every ledge of the band above, and no ledge above is a dead end.
          for (const from of above) {
            if (!canReachPlatform(from, route)) expect.fail(`${tag}: route unreachable at y${y}`);
            if (!here.some(p => canReachPlatform(from, p))) expect.fail(`${tag}: dead end above y${y}`);
          }
          // A SLOT: never under three bodies wide, and never spikes where the fall has to land.
          if (here.length === 2 && here.every(p => p.x <= WORLD.wall + 1 || p.x + p.width >= WORLD.width - WORLD.wall - 1)) {
            const [a, b] = [...here].sort((p, q) => p.x - q.x);
            if (b.x - (a.x + a.width) < 54) expect.fail(`${tag}: slot narrower than three bodies`);
          }
          // NO FORCED SPIKE HIT. Every ledge here is spiked (v2), so the promise is about time: from ANY
          // landing point on it, walking to its exit end clears the body before the teeth come up, with
          // the reaction reserve still to spare.
          const grace = WORLD.startY + (area2.plans![sectionId - 1].graceDepth ?? 0) * WORLD.pixelsPerMeter;
          for (const p of here) {
            if (p.y < grace) continue;   // the quiet opening holds every hazard back, spikes included
            if (!p.spikePlatform) expect.fail(`${tag}: an ordinary ledge without spikes at y${y}`);
            const farthest = p.width + 18;   // the far end of the ledge to the body clear of the near one
            if ((p.spikePlatform!.warning ?? 0) < farthest / 350 + 0.35 - 1e-9) expect.fail(`${tag}: spikes faster than the walk off at y${y}`);
          }
          // No enemy can ever stand on or pass through the route's landing spot.
          const landing: Box = { minX: route.safeX - 9, maxX: route.safeX + 9, minY: route.y - 30, maxY: route.y };
          for (const e of s.enemies) if (!e.ai && meets(motionEnvelope(e), landing)) expect.fail(`${tag}: ${e.kind} blocks a landing at y${y}`);
          above = here;
        }
        for (const e of s.enemies) {
          if (e.ai?.kind === 'ghost') {
            // Waiting inside the wall, never in the shaft.
            if (!(e.x < WORLD.wall || e.x > WORLD.width - WORLD.wall)) expect.fail(`${tag}: ghost placed in the shaft`);
            continue;
          }
          const env = motionEnvelope(e);
          if (env.minX < WORLD.wall - 0.5 || env.maxX > WORLD.width - WORLD.wall + 0.5) expect.fail(`${tag}: ${e.kind} outside the walls`);
          for (const z of s.zones) if (meets(env, { minX: z.x, maxX: z.x + z.width, minY: z.y, maxY: z.y + z.height })) expect.fail(`${tag}: ${e.kind} in a chamber`);
        }
        const ghosts = s.enemies.filter(e => e.ai?.kind === 'ghost').length;
        if (ghosts !== area2.plans![sectionId - 1].ghosts!.count) expect.fail(`${tag}: ${ghosts} ghosts`);
      }
    });
  }
});

describe('GHOST', () => {
  const ghostAt = (g: GameModel, x: number, y: number, state: 'dormant' | 'hunt' = 'hunt', speed = 80) => {
    const e = spawnEnemy('ghost', 900, x, y, 0, 0, 'open');
    e.ai = dormantGhost(speed);
    if (state === 'hunt') (e.ai as { state: string }).state = 'hunt';
    g.enemies = [e];
    return e;
  };

  it('stays in the wall, untouchable and unshootable, until the player is well past it', () => {
    const g = bare();
    const e = ghostAt(g, GHOST_RULES.wallDepth, 1900, 'dormant');
    holdStill(g, 30, 1900 + GHOST_RULES.wakeLead - 20);
    for (let i = 0; i < 240; i++) { holdStill(g, 30, 1900 + GHOST_RULES.wakeLead - 20); g.step(1 / 120, 0, false); }
    expect(e.ai!.state).toBe('dormant');
    expect(e.x).toBe(GHOST_RULES.wallDepth);
    expect(g.hp).toBe(4);
    holdStill(g, 225, 1900 + GHOST_RULES.wakeLead + 1);
    g.step(1 / 120, 0, false);
    expect(e.ai!.state).toBe('hunt');
    expect(g.events.some(ev => ev.type === 'ghostWake')).toBe(true);
  });

  it('can never touch anyone sooner than its head start allows', () => {
    // Waking 200px behind the player at the fastest ghost is 2.27s before any possible contact.
    for (const speed of area2.plans!.map(p => p.ghosts!.speed)) {
      const g = bare();
      const e = ghostAt(g, 225, 1800, 'dormant', speed);
      let t = 0, woke = -1;
      for (let i = 0; i < 120 * 10; i++) {
        holdStill(g, 225, 1800 + GHOST_RULES.wakeLead); g.step(1 / 120, 0, false); t += 1 / 120;
        if (woke < 0 && e.ai!.state === 'hunt') woke = t;
        if (g.hp < 4) break;
      }
      expect(woke).toBeGreaterThanOrEqual(0);
      expect(t - woke).toBeGreaterThanOrEqual((GHOST_RULES.wakeLead - 25) / speed - 0.02);
    }
  });

  it('drifts toward the player through ledges, and is outrun by someone who keeps moving', () => {
    const g = bare();
    const e = ghostAt(g, 225, 1500);
    g.platforms = [{ id: 1, x: 28, y: 1700, width: 394 }];   // a floor right across its path
    const before = Math.hypot(225 - e.x, 2000 - e.y);
    // 3.5s at 80px/s is 280px of its 500px approach: well past the floor 200px below it.
    for (let i = 0; i < Math.round(120 * 3.5); i++) { holdStill(g); g.platforms = [{ id: 1, x: 28, y: 1700, width: 394 }]; g.step(1 / 120, 0, false); }
    expect(Math.hypot(225 - e.x, 2000 - e.y)).toBeLessThan(before - 250);
    expect(e.y).toBeGreaterThan(1700);   // it went straight through the floor
    // Someone moving at walking pace pulls away from even the fastest ghost.
    expect(Math.max(...area2.plans!.map(p => p.ghosts!.speed))).toBeLessThan(350 / 3);
  });

  it('swoops down to just under the HUD, then comes on at its own pace and arrives within seconds', () => {
    for (const speed of area2.plans!.map(p => p.ghosts!.speed)) {
      const g = bare();
      const e = ghostAt(g, 225, 900, 'hunt', speed);             // 1,100px behind: far off the view
      g.cameraY = 2000 - WORLD.height * 0.37;
      let t = 0, inSightMax = 0, prev = Math.hypot(225 - e.x, 2000 - e.y), line = -1;
      while (g.hp === 4 && t < 20) {
        standStill(g, 225, 2000); g.step(1 / 120, 0, false); t += 1 / 120;
        const d = Math.hypot(225 - e.x, 2000 - e.y);
        // Where it can be seen, it never closes faster than its own speed -- and never walks-speed.
        if (inSight(e.y, { top: g.cameraY, height: WORLD.height }) && line < 0) line = t;
        if (line >= 0 && t > line + 1 / 120) inSightMax = Math.max(inSightMax, (prev - d) * 120);
        prev = d;
      }
      expect(g.hp).toBe(3);
      expect(inSightMax).toBeLessThanOrEqual(speed + 1e-6);
      expect(speed).toBeLessThan(350 / 3);
      // The swoop: 1,010px at the catch-up speed to the sight line, 90px above the player.
      const swoop = (1100 - 90) / GHOST_RULES.catchUp;
      expect(line).toBeCloseTo(swoop, 1);
      // Then it must be SEEN for a full second before it may touch, however close it already is.
      const rest = Math.max(GHOST_RULES.seenBeforeHit, (90 - 25) / speed);
      expect(t).toBeGreaterThan(swoop + rest - 0.05);
      expect(t).toBeLessThan(swoop + rest + 0.1);
    }
  });

  it('lands one hit at most, then is gone', () => {
    const g = bare();
    const e = ghostAt(g, 225, 1990);
    (e.ai as { seen: number }).seen = GHOST_RULES.seenBeforeHit;   // it has been in view long enough
    g.cameraY = 2000 - WORLD.height * 0.37;
    holdStill(g); g.step(1 / 120, 0, false);
    expect(g.hp).toBe(3);
    expect(e.alive).toBe(false);
    expect(g.events.some(ev => ev.type === 'ghostFade')).toBe(true);
    for (let i = 0; i < 240; i++) { holdStill(g); g.player.invincible = 0; g.step(1 / 120, 0, false); }
    expect(g.hp).toBe(3);
  });

  it('follows the same path at 30, 60 and 120 frames per second, and on every replay', () => {
    // The player STANDS on a floor, so the target is the same whatever size the frames are -- a
    // hovering player falls a different distance per frame, which would be testing gravity.
    const run = (dt: number) => { const g = bare(); const e = ghostAt(g, 60, 1400); g.cameraY = 2400 - WORLD.height * 0.37; for (let i = 0; i < Math.round(3 / dt); i++) { standStill(g, 380, 2400); g.step(dt, 0, false); } return [e.x, e.y]; };
    const [a, b, c, again] = [run(1 / 30), run(1 / 60), run(1 / 120), run(1 / 120)];
    for (const p of [a, b]) { expect(p[0]).toBeCloseTo(c[0], 6); expect(p[1]).toBeCloseTo(c[1], 6); }
    expect(again).toEqual(c);
  });
});

describe('FLYING SKULL', () => {
  const skullAt = (g: GameModel, x: number, y: number) => {
    const e = spawnEnemy('flyingSkull', 901, x, y, 0, 0, 'open');
    g.enemies = [e];
    return e;
  };
  /** Camera on the skull, so it is on screen; the player placed relative to it. */
  const frame = (g: GameModel, e: Enemy, px: number, py: number) => { g.cameraY = e.originY! - 300; holdStill(g, px, py); };

  it('hovers until the player is in range, then warns before it moves', () => {
    const g = bare();
    const e = skullAt(g, 225, 2000);
    expect(e.ai).toEqual(idleSkull());
    for (let i = 0; i < 120; i++) { frame(g, e, 225, 2000 + SKULL_RULES.range + 40); g.step(1 / 120, 0, false); }
    expect(e.ai!.state).toBe('idle');
    frame(g, e, 225, 2000 + SKULL_RULES.range - 20); g.step(1 / 120, 0, false);
    expect(e.ai!.state).toBe('warn');
    expect(g.events.some(ev => ev.type === 'skullWarn')).toBe(true);
    // Through the whole warning it does not move toward anyone.
    const x = e.x, y = e.y;
    for (let i = 0; i < Math.round((SKULL_RULES.warn - 0.05) * 120); i++) { frame(g, e, 225, 2200); g.step(1 / 120, 0, false); }
    expect([e.x, e.y]).toEqual([x, y]);
  });

  it('charges where the player WAS when it began to warn, so moving during the warning dodges it', () => {
    const g = bare();
    const e = skullAt(g, 225, 2000);
    frame(g, e, 225, 2150); g.step(1 / 120, 0, false);        // warns, aimed straight down at 225
    let hp = g.hp;
    // The player steps well aside during the warning and stays there.
    for (let i = 0; i < 120 * 1.5; i++) { frame(g, e, 360, 2150); g.step(1 / 120, 0, false); }
    expect(g.hp).toBe(hp);
    expect(Math.abs(e.x - 225)).toBeLessThan(3);             // it flew down its locked line, not after them
    // Standing still on the line is where it goes.
    const g2 = bare(); const e2 = skullAt(g2, 225, 2000);
    hp = g2.hp;
    for (let i = 0; i < 120 * 1.5; i++) { frame(g2, e2, 225, 2150); g2.step(1 / 120, 0, false); }
    expect(g2.hp).toBe(hp - 1);
  });

  it('cools off after a charge, then drifts home and can notice the player again', () => {
    const g = bare();
    const e = skullAt(g, 225, 2000);
    frame(g, e, 380, 2000); g.step(1 / 120, 0, false);        // warn, aimed sideways
    const states = new Set<string>();
    // The player stays close enough that the camera keeps the skull on screen (off screen it would be
    // retired like any enemy), but far outside its reach, so it has nothing to notice again.
    for (let i = 0; i < 120 * 8; i++) { standStill(g, 60, 2000 + SKULL_RULES.range + 60); g.step(1 / 120, 0, false); states.add(e.ai!.state); }
    expect([...states]).toEqual(expect.arrayContaining(['warn', 'charge', 'cool', 'return', 'idle']));
    expect(e.ai!.state).toBe('idle');
    expect(e.x).toBeCloseTo(225, 6);
  });

  it('lunges the same way at 30, 60 and 120 frames per second, and on every replay', () => {
    // The camera is pinned as well: a skull only notices a player it is on screen with, and the camera
    // EASES into place frame by frame -- its own behaviour, and not what this test is measuring.
    const run = (dt: number) => { const g = bare(); const e = skullAt(g, 200, 2000); for (let i = 0; i < Math.round(2 / dt); i++) { standStill(g, 330, 2120); g.cameraY = 2120 - WORLD.height * 0.37; g.step(dt, 0, false); } return [e.x, e.y, e.ai!.state]; };
    const [a, b, c, again] = [run(1 / 30), run(1 / 60), run(1 / 120), run(1 / 120)];
    for (const p of [a, b]) { expect(p[0] as number).toBeCloseTo(c[0] as number, 6); expect(p[1] as number).toBeCloseTo(c[1] as number, 6); expect(p[2]).toBe(c[2]); }
    expect(again).toEqual(c);
    expect(CHASE_STEP).toBe(1 / 120);
  });

  it('is an ordinary soft enemy apart from how it moves', () => {
    expect(ENEMY_TYPES.flyingSkull).toMatchObject({ hp: 1, shootable: true, stompable: true, damageCause: 'enemy' });
    expect(ENEMY_TYPES.ghost).toMatchObject({ shootable: true, stompable: true, damageCause: 'enemy', spawnWeight: 0 });
  });
});

/**
 * THE REST OF THE GAME IS UNTOUCHED. Golden values produced by tests/regressionSignature.ts at
 * c8a9262, the commit this rework is built on: AREA 1, 3 and 4 generate the same shaft, and scripted
 * runs through them and through the FINAL BOSS play the same, hit for hit.
 */
describe('Human Review v2: every ledge turns, and none of them is a trap', () => {
  /** The widest spike ledge each SECTION lays over 40 seeds, with the warning the generator gave it. */
  const widest = (sectionId: SectionId) => {
    let best: RoutePlatform | undefined;
    for (let seed = 1; seed <= 40; seed++) for (const p of shaft(sectionId, seed * 97).rows) if (p.spikePlatform && (!best || p.width > best.width)) best = p;
    return best!;
  };
  /** Drops the player onto a copy of `ledge` at its very left edge -- the worst place to land. */
  const landOn = (ledge: RoutePlatform) => {
    const g = bare();
    const copy = { id: 950, x: WORLD.wall, y: 2015, width: ledge.width, breakable: false, state: 'stable' as const, spikePlatform: spikePlatform(ledge.spikePlatform!.warning) };
    g.platforms = [copy];
    g.player.x = copy.x - 8; g.player.y = copy.y - 16; g.player.vy = 60; g.player.grounded = -1;
    for (let i = 0; i < 60 && g.player.grounded !== copy.id; i++) { g.platforms = [copy]; g.step(1 / 120, 0, false); }
    expect(g.player.grounded).toBe(copy.id);
    return { g, copy };
  };

  it('never puts spikes on a BREAK BLOCK: a gate is broken, not stood on', () => {
    let blocks = 0;
    for (const sectionId of [1, 2, 3] as SectionId[]) for (let seed = 1; seed <= 60; seed++) {
      for (const p of shaft(sectionId, seed * 131).rows.filter(p => p.breakBlock)) { blocks++; expect(p.spikePlatform).toBeUndefined(); }
    }
    expect(blocks).toBeGreaterThan(300);
  });

  it('lets a player who lands on the worst spot of the widest ledge walk off it untouched', () => {
    for (const sectionId of [1, 2, 3] as SectionId[]) {
      const { g, copy } = landOn(widest(sectionId));
      expect(copy.spikePlatform.state).toBe('warning');
      expect(copy.x + copy.width, `2-${sectionId} leaves room to walk off`).toBeLessThan(WORLD.width - WORLD.wall - 20);
      // Walking the whole ledge, and on down past it.
      for (let i = 0; i < 240; i++) { g.platforms = [copy]; g.enemies = []; g.step(1 / 120, 1, false); }
      expect(g.player.y, `2-${sectionId}`).toBeGreaterThan(copy.y + 40);
      expect(g.hp, `2-${sectionId}`).toBe(4);
    }
  });

  it('always catches a player who stays on it', () => {
    for (const sectionId of [1, 2, 3] as SectionId[]) {
      const { g, copy } = landOn(widest(sectionId));
      const warning = copy.spikePlatform.warning!;
      let t = 0;
      while (g.hp === 4 && t < 5) { g.platforms = [copy]; g.enemies = []; g.step(1 / 120, 0, false); t += 1 / 120; }
      expect(g.hp, `2-${sectionId}`).toBe(3);
      // Not before the spikes are up, and as soon as they are.
      expect(t).toBeGreaterThan(warning - 0.02);
      expect(t).toBeLessThan(warning + 0.05);
      expect(warning).toBeLessThan(SPIKE_PLATFORM_RULES.warning + 1);
    }
  });
});

describe('Human Review v2: ghosts are seen before they are felt', () => {
  const dormantAt = (id: number, x: number, y: number, speed = 80) => { const e = spawnEnemy('ghost', id, x, y, 0, 0, 'open'); e.ai = dormantGhost(speed); return e; };

  it('has at most two ghosts out at once, and wakes the next when one is spent', () => {
    const g = bare();
    g.enemies = [0, 1, 2, 3].map(i => dormantAt(800 + i, GHOST_RULES.wallDepth, 1000 + i * 60));
    let most = 0, woke = 0;
    for (let i = 0; i < 120 * 20; i++) {
      holdStill(g); g.player.invincible = 99; g.step(1 / 120, 0, false);
      woke += g.events.filter(ev => ev.type === 'ghostWake').length; g.events.length = 0;
      most = Math.max(most, g.enemies.filter(e => e.alive && e.ai?.kind === 'ghost' && e.ai.state === 'hunt').length);
    }
    expect(most).toBe(GHOST_RULES.activeCap);
    expect(woke).toBeGreaterThan(GHOST_RULES.activeCap);
  });

  it('comes into view and stays there before it can land a hit', () => {
    for (const speed of area2.plans!.map(p => p.ghosts!.speed)) {
      const g = bare();
      const e = spawnEnemy('ghost', 900, 225, 900, 0, 0, 'open'); e.ai = dormantGhost(speed); (e.ai as { state: string }).state = 'hunt';
      g.enemies = [e];
      let visible = 0, t = 0, last = false;
      while (g.hp === 4 && t < 20) {
        standStill(g, 225, 2000);
        last = inSight(e.y, { top: g.cameraY, height: WORLD.height });
        if (last) visible += 1 / 120;
        g.step(1 / 120, 0, false); t += 1 / 120;
      }
      expect(g.hp).toBe(3);
      // In sight -- below the HUD, not merely inside the canvas -- for the full second, and at the hit.
      expect(visible).toBeGreaterThanOrEqual(GHOST_RULES.seenBeforeHit - 1e-9);
      expect(last).toBe(true);
    }
  });

  it('counts the HUD band as out of sight: the walls there are under the hearts and the ammo', () => {
    const view = { top: 1000, height: WORLD.height };
    expect(inSight(1000 + 100, view)).toBe(false);
    expect(inSight(1000 + GHOST_RULES.hudClear + 15, view)).toBe(false);
    expect(inSight(1000 + GHOST_RULES.hudClear + 16, view)).toBe(true);
    // The measured HUD reaches 183px; the sight line is clear of it, and still above the player (296px).
    expect(GHOST_RULES.hudClear).toBeGreaterThanOrEqual(183);
    expect(GHOST_RULES.hudClear + 16).toBeLessThan(WORLD.height * 0.37 - 24);
    // A waking ghost is already below the line.
    expect(WORLD.height * 0.37 - GHOST_RULES.wakeLead).toBeGreaterThanOrEqual(GHOST_RULES.hudClear + 16);
  });

  it('cannot touch anyone from off the screen, or before it has been seen', () => {
    const overlapping = (seen: number) => {
      const g = bare();
      const e = spawnEnemy('ghost', 900, 225, 2000, 0, 0, 'open'); e.ai = dormantGhost(80); (e.ai as { state: string }).state = 'hunt';
      (e.ai as { seen: number }).seen = seen;
      g.enemies = [e];
      return { g, e };
    };
    // Seen long enough, right on top of the player -- but the view is somewhere else.
    const off = overlapping(10);
    off.g.cameraY = 2000 + 40; holdStill(off.g); off.g.step(1 / 120, 0, false);
    expect(off.g.hp).toBe(4);
    // In view, right on top of the player, but only just come into it.
    const fresh = overlapping(0);
    for (let i = 0; i < Math.floor(GHOST_RULES.seenBeforeHit * 120) - 2; i++) {
      fresh.g.cameraY = 2000 - WORLD.height * 0.37; fresh.e.x = 225; fresh.e.y = 2000;
      holdStill(fresh.g); fresh.g.step(1 / 120, 0, false);
    }
    expect(fresh.g.hp).toBe(4);
  });

  it('gives up after its hunt, so a ghost that never caught anyone frees its place', () => {
    const g = bare();
    const e = spawnEnemy('ghost', 900, 225, 1000, 0, 0, 'open'); e.ai = dormantGhost(70); (e.ai as { state: string }).state = 'hunt';
    g.enemies = [e];
    let t = 0, faded = -1;
    while (t < GHOST_RULES.huntTime + 1) {
      holdStill(g, 225, 2000); g.player.invincible = 99; g.step(1 / 120, 0, false); t += 1 / 120;
      if (faded < 0 && g.events.some(ev => ev.type === 'ghostFade')) faded = t;
      g.events.length = 0;
    }
    expect(e.alive).toBe(false);
    expect(faded).toBeCloseTo(GHOST_RULES.huntTime, 1);
  });

  it('lays the same four, six and eight ghosts on every seed', () => {
    for (const [i, count] of [4, 6, 8].entries()) for (let seed = 1; seed <= 40; seed++) {
      expect(shaft((i + 1) as SectionId, seed * 59).enemies.filter(e => e.ai?.kind === 'ghost').length).toBe(count);
    }
  });

  it('leaves the FLYING SKULL exactly as it was reviewed', () => {
    expect(SKULL_RULES).toEqual({ range: 230, warn: 0.55, chargeSpeed: 360, chargeTime: 0.6, cool: 1.0, returnSpeed: 50, bob: 4 });
    expect(area2.plans![0].enemyExclude).toContain('flyingSkull');
    expect(area2.plans![1].enemyExclude ?? []).not.toContain('flyingSkull');
    expect(area2.plans![2].enemyExclude ?? []).not.toContain('flyingSkull');
  });
});

// The AREA 2 rework's isolation check (AREA 1, 3, 4 and the boss against c8a9262) now lives in
// tests/stageV2Isolation.test.ts, against c9a0a63 -- which carried those same AREAs unchanged -- with
// replays started at each AREA's entry so that re-shaping AREA 1 cannot move the others.
