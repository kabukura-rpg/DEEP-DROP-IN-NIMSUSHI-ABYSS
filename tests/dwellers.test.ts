import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { StageGenerator } from '../src/systems/StageGenerator';
import { ENEMY_TYPES, motionEnvelope, spawnEnemy, type Enemy } from '../src/data/enemies';
import { DWELLER_RULES, dwellerInSight, type DwellerState } from '../src/data/dwellers';
import { BALANCE, WORLD } from '../src/data/balance';
import { areaConfig } from '../src/data/areas';
import { COIN_VALUES } from '../src/data/coins';

/**
 * DOWNWELL NORMAL GAMEPLAY CLONE -- the enemy BEHAVIOURS of the original's roster (dwellers.ts), held
 * to the three rules the rest of the game relies on: nothing hurts before it has been seen, nothing
 * that chases outruns the player, and every one is deterministic.
 */
const seeded = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
const STEP = 1 / 120;

/** A model in AREA 1 with an empty shaft, the camera parked so y 2000 is mid-view. */
function bare() {
  const g = new GameModel(false, seeded(77));
  g.platforms = []; g.enemies = []; g.pickups = []; g.hazards = []; g.doodads = []; g.safeZones = []; g.caves = [];
  g.player.invincible = 0;
  return g;
}
const hover = (g: GameModel, x = 225, y = 2000) => { g.player.x = x; g.player.y = y; g.player.vy = 0; g.player.grounded = -1; g.cameraY = y - WORLD.height * 0.37; g.bullets = []; };
const step = (g: GameModel, n: number, fire = false, at?: [number, number]) => {
  for (let i = 0; i < n; i++) { if (at) hover(g, at[0], at[1]); g.platforms = []; g.step(STEP, 0, fire); }
};

describe('CAVE BAT (the bat role)', () => {
  it('hangs until the player has gone past it, unfolds, then flies at them slower than walking', () => {
    const g = bare();
    const bat = spawnEnemy('caveBat', 1, 225, 1960, 0, 0, 'open');
    g.enemies = [bat];
    // Above it: nothing happens.
    step(g, 60, false, [225, 1900]);
    expect((bat.ai as DwellerState).state).toBe('hang');
    expect(bat.y).toBe(1960);
    // Past it (below its height) and on screen: it lets go, but spends the unfurl in place.
    step(g, 1, false, [225, 2000]);
    expect((bat.ai as DwellerState).state).toBe('unfurl');
    step(g, Math.floor(DWELLER_RULES.bat.unfurl * 120) - 2, false, [225, 2100]);
    expect(bat.y).toBe(1960);
    step(g, 30, false, [225, 2100]);
    expect((bat.ai as DwellerState).state).toBe('chase');
    expect(bat.y).toBeGreaterThan(1960);
    expect(DWELLER_RULES.bat.speed).toBeLessThan(BALANCE.moveSpeed);
  });
});

describe('NO CHEAP HIT', () => {
  it('lets no dweller touch the player before it has been in sight for seenBeforeHit', () => {
    for (const kind of ['spore', 'watcher', 'caveBat', 'biter'] as const) {
      const g = bare();
      const e = spawnEnemy(kind, 1, 225, 2000, 0, 0, 'open');
      g.enemies = [e];
      hover(g);
      g.step(STEP, 0, false);
      // Overlapping from the first frame, yet unhurt until it has been seen long enough.
      const firstHit = (() => { for (let i = 0; i < 120; i++) { hover(g); e.x = 225; e.y = 2000; const hp = g.hp; g.step(STEP, 0, false); if (g.hp < hp) return i * STEP; } return Infinity; })();
      expect({ kind, early: firstHit < DWELLER_RULES.seenBeforeHit - 2 * STEP }).toEqual({ kind, early: false });
      expect(firstHit).toBeLessThan(1);
    }
  });
  it('counts only time on screen below the HUD as seen', () => {
    const view = { top: 1000, height: WORLD.height };
    expect(dwellerInSight(1000 + 100, view)).toBe(false);
    expect(dwellerInSight(1000 + 300, view)).toBe(true);
    expect(dwellerInSight(1000 + WORLD.height + 20, view)).toBe(false);
  });
});

describe('ALWAYS OUTRUN', () => {
  it('keeps every chaser slower than walking and than the fall', () => {
    const speeds = [DWELLER_RULES.bat.speed, DWELLER_RULES.drift.speed, DWELLER_RULES.eye.speed + DWELLER_RULES.eye.wobble,
      DWELLER_RULES.piranha.speed, DWELLER_RULES.phantomChase.speed, DWELLER_RULES.skull.speed];
    for (const s of speeds) { expect(s).toBeLessThan(BALANCE.moveSpeed); expect(s).toBeLessThan(BALANCE.maxFallSpeed); }
  });
  it('builds a SPORE up to speed rather than starting at it', () => {
    const g = bare();
    const e = spawnEnemy('spore', 1, 225, 2150, 0, 0, 'open');
    g.enemies = [e];
    step(g, 24, false, [225, 2000]);
    const ai = e.ai as { vx: number; vy: number };
    expect(Math.hypot(ai.vx, ai.vy)).toBeLessThan(DWELLER_RULES.drift.speed * 0.5);
  });
});

describe('TOAD (the frog role)', () => {
  it('winds up visibly before it leaps, and a round calms it and restarts the wait', () => {
    const g = bare();
    const toad = spawnEnemy('toad', 1, 225, 2100, 40, 0, 'guard');
    g.enemies = [toad];
    const ai = toad.ai as Extract<DwellerState, { kind: 'hop' }>;
    let sawWindup = false, sawAir = false;
    for (let i = 0; i < 600 && !sawAir; i++) { step(g, 1, false, [225, 1950]); if (ai.state === 'windup') sawWindup = true; if (ai.state === 'air') sawAir = true; }
    expect(sawWindup).toBe(true);
    expect(sawAir).toBe(true);
    // Its whole leap stays inside the envelope the generator keeps clear of landings.
    const env = motionEnvelope(toad);
    for (let i = 0; i < 240; i++) { step(g, 1, false, [225, 1950]); expect(toad.y).toBeGreaterThanOrEqual(env.minY + 14); expect(toad.x).toBeGreaterThanOrEqual(env.minX); expect(toad.x).toBeLessThanOrEqual(env.maxX); }
    // Shot during the wait: back to a fresh wait.
    for (let i = 0; i < 600 && ai.state !== 'windup'; i++) step(g, 1, false, [225, 1950]);
    expect(ai.state).toBe('windup');
    hover(g, toad.x, toad.y - 90); g.cooldown = 0; g.shoot();
    for (let i = 0; i < 20 && ai.state === 'windup'; i++) { g.platforms = []; g.step(STEP, 0, false); }
    expect(ai.state).toBe('sit');
    expect(toad.hp).toBe(ENEMY_TYPES.toad.hp - 1);
  });
});

describe('the answers each role allows', () => {
  it('SHELLBACK: rounds do nothing, a stomp kills it', () => {
    expect(ENEMY_TYPES.shellback.shootable).toBe(false);
    expect(ENEMY_TYPES.shellback.stompable).toBe(true);
    const g = bare();
    const e = spawnEnemy('shellback', 1, 225, 2100, 0, 0, 'guard');
    g.enemies = [e];
    hover(g, 225, 2000); g.cooldown = 0; g.shoot();
    for (let i = 0; i < 60; i++) { g.platforms = []; g.player.y = 2000; g.player.vy = 0; g.step(STEP, 0, false); }
    expect(e.alive).toBe(true);
  });
  it('WATCHER: cannot be stood on -- landing on it is contact damage', () => {
    expect(ENEMY_TYPES.watcher.stompable).toBe(false);
    const g = bare();
    const e = spawnEnemy('watcher', 1, 225, 2040, 0, 0, 'open');
    (e.ai as DwellerState).seen = 1;
    g.enemies = [e];
    hover(g, 225, 2000); g.player.vy = 600;
    for (let i = 0; i < 12; i++) { g.platforms = []; e.x = 225; e.y = 2040; g.step(STEP, 0, false); }
    expect(g.hp).toBe(3);
    expect(e.alive).toBe(true);
  });
  it('pays the original counterpart\'s gems for a kill', () => {
    for (const kind of ['caveBat', 'toad', 'spore', 'creeper'] as const) {
      const g = bare();
      const e = spawnEnemy(kind, 1, 225, 2100, 0, 0, 'open');
      e.hp = 1; g.enemies = [e];
      // Straight above it: a CREEPER has already moved onto its wall.
      hover(g, e.x, 2000); g.cooldown = 0; g.shoot();
      for (let i = 0; i < 30; i++) { g.platforms = []; g.player.x = e.x; g.player.y = 2000; g.player.vy = 0; g.step(STEP, 0, false); }
      expect(e.alive).toBe(false);
      const paid = g.coins.coins.reduce((sum, c) => sum + c.value, 0);
      const gems = ENEMY_TYPES[kind].gems!;
      expect({ kind, paid }).toEqual({ kind, paid: Math.floor(gems / 10) * COIN_VALUES.large + Math.round((gems % 10) / 2) * COIN_VALUES.small });
    }
  });
});

describe('AREA 1 swarm', () => {
  it('starts every extra enemy clear of the others, and none in a SECTION\'s quiet opening', () => {
    const area = areaConfig(1);
    for (const n of [0, 1, 2]) for (let seed = 1; seed <= 30; seed++) {
      const g = new StageGenerator(seeded(seed * 503), { plan: area.plans![n], enemyPool: area.enemyPool, sectionLength: area.sectionLength });
      const all: Enemy[] = [];
      for (let c = 0; c < 6; c++) all.push(...g.chunk(c).enemies);
      for (const e of all) for (const o of all) if (o !== e) expect(Math.hypot(o.originX - e.originX, (o.originY ?? o.y) - (e.originY ?? e.y))).toBeGreaterThanOrEqual(20);
      const quietEnd = WORLD.startY + (area.plans![n].graceDepth ?? 0) * WORLD.pixelsPerMeter;
      if (area.plans![n].graceDepth) for (const e of all) expect(e.y).toBeGreaterThan(quietEnd - 130);
    }
  });
  it('replays the same chase from the same seed', () => {
    const run = () => {
      const g = new GameModel(false, seeded(4242));
      const trail: number[] = [];
      for (let i = 0; i < 120 * 12; i++) { g.step(STEP, i % 240 < 120 ? 1 : -1, i % 50 < 10); if (i % 60 === 0) trail.push(...g.enemies.filter(e => e.ai).map(e => Math.round(e.x * 10 + e.y))); }
      return trail.join(',');
    };
    expect(run()).toBe(run());
  });
});
