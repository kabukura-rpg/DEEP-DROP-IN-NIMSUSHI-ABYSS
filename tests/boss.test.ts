import { describe, expect, it } from 'vitest';
import { PLANNED_TOTAL_DEPTH } from '../src/data/areas';
import { GameModel } from '../src/systems/GameModel';
import { BossFightSystem } from '../src/systems/BossFightSystem';
import { BOSS, BOSS_ATTACKS, BOSS_PHASES, bossPhaseAt } from '../src/data/boss';
import { WORLD } from '../src/data/balance';
import { ENEMY_TYPES, spawnEnemy } from '../src/data/enemies';

const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const tick = (game: GameModel, seconds: number, direction = 0, fire = false) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) game.step(1 / 120, direction, fire);
};
/** A run parked at the FINAL BOSS with a deterministic shaft. */
function atBoss(seed = 7) {
  const game = new GameModel(false, seeded(seed));
  game.jumpToBoss();
  return game;
}
/** Drive the fight until the predicate holds, or give up. The player is kept alive throughout. */
function until(game: GameModel, predicate: () => boolean, seconds = 240, fight = false) {
  for (let i = 0; i < Math.round(seconds * 120); i++) {
    if (predicate()) return true;
    game.player.invincible = 0;
    game.health.heal(9);
    const aim = fight ? Math.sign(game.boss.x - game.player.x) : 0;
    game.step(1 / 120, Math.abs(game.boss.x - game.player.x) < 4 ? 0 : aim, fight);
  }
  return predicate();
}

describe('FINAL BOSS fight state', () => {
  it('starts the fight instead of showing a placeholder panel', () => {
    const game = atBoss();
    expect(game.state).toBe('boss');
    expect(game.boss.enabled).toBe(true);
    expect(game.boss.hp).toBe(BOSS.maxHp);
    expect(game.boss.phaseId).toBe(1);
  });

  it('keeps the world simulating during the fight: the player still falls and may shoot', () => {
    const game = atBoss();
    const y = game.player.y;
    tick(game, 1);
    expect(game.player.y).toBeGreaterThan(y);
    expect(game.running).toBe(true);
  });

  it('holds station below the player so the king is always reachable and never unavoidable', () => {
    const game = atBoss();
    for (let i = 0; i < 120 * 30; i++) {
      game.player.invincible = 0; game.health.heal(9);
      game.step(1 / 120, 0, false);
      const gap = game.boss.y - game.player.y;
      expect(gap).toBeGreaterThanOrEqual(BOSS.minGap - 1);
      expect(gap).toBeLessThanOrEqual(BOSS.maxGap + 1);
    }
  });

  it('pauses the fight with the rest of the simulation', () => {
    const game = atBoss();
    game.paused = true;
    const before = { y: game.player.y, hp: game.boss.hp, elapsed: game.boss.elapsed };
    tick(game, 1);
    expect(game.player.y).toBe(before.y);
    expect(game.boss.elapsed).toBe(before.elapsed);
  });
});

describe('FINAL BOSS damage', () => {
  it('takes damage from player bullets and reports the killing blow', () => {
    const boss = new BossFightSystem();
    boss.start(0);
    expect(boss.damage(10)).toBe(false);
    expect(boss.hp).toBe(BOSS.maxHp - 10);
    expect(boss.damage(BOSS.maxHp)).toBe(true);
    expect(boss.hp).toBe(0);
    expect(boss.defeated).toBe(true);
  });

  it('ignores nonsense damage and further hits once it is down', () => {
    const boss = new BossFightSystem();
    boss.start(0);
    expect(boss.damage(0)).toBe(false);
    expect(boss.damage(-5)).toBe(false);
    expect(boss.damage(NaN)).toBe(false);
    expect(boss.hp).toBe(BOSS.maxHp);
    boss.damage(BOSS.maxHp);
    expect(boss.damage(10)).toBe(false);
    expect(boss.hp).toBe(0);
  });

  it('loses HP when the player actually shoots it in the run', () => {
    const game = atBoss();
    const before = game.boss.hp;
    until(game, () => game.boss.hp < before, 30, true);
    expect(game.boss.hp).toBeLessThan(before);
  });

  it('is never stompable: shooting is the only way to hurt the king', () => {
    const game = atBoss();
    // No enemy entity stands in for the king, so the stomp path can never reach it.
    expect(game.enemies.some(e => e.kind.includes('boss') || e.kind.includes('demonKing'))).toBe(false);
    expect(Object.keys(ENEMY_TYPES)).not.toContain('demonKing');
    // Dropping onto the body does not damage it the way a stomp damages an enemy.
    const hp = game.boss.hp;
    game.player.x = game.boss.x; game.player.y = game.boss.y - BOSS.bodyHeight / 2;
    game.player.vy = 900;
    tick(game, 0.2);
    expect(game.boss.hp).toBe(hp);
  });

  it('keeps enough distance that its body can never overlap the player', () => {
    // The station-keeping band is the guarantee: the smallest gap it will hold is larger than the
    // body and the player put together, so the king is a shooting target, never a wall to bump.
    expect(BOSS.minGap).toBeGreaterThan(BOSS.bodyHeight / 2 + 15);
    const game = atBoss();
    for (let i = 0; i < 120 * 20; i++) {
      game.player.invincible = 0; game.health.heal(9);
      game.step(1 / 120, i % 240 < 120 ? -1 : 1, false);
      const body = game.boss.body;
      const overlap = game.player.x + 9 > body.x && game.player.x - 9 < body.x + body.width
        && game.player.y + 15 > body.y && game.player.y - 15 < body.y + body.height;
      expect(overlap).toBe(false);
    }
  });
});

describe('FINAL BOSS hit detection matches the rest of the game', () => {
  it('is hit by the round its width covers, not only by its centre', () => {
    const game = atBoss(41);
    game.gun.equip('puncher');
    game.stats.bulletSize *= 1.5;            // BIG BULLET
    game.stats.maxAmmo = 40; game.ammo = 40;
    const size = 11 * (game.stats.bulletSize / 4);
    const before = game.boss.hp;
    for (let i = 0; i < 600 && game.boss.hp === before; i++) {
      game.player.invincible = 99;
      // Close in, because PUNCHER's reach is far shorter than the king's resting distance, and
      // sit with the round's CENTRE outside the body so only its width can connect.
      game.player.y = game.boss.y - 150;
      game.player.x = game.boss.body.x - size * 0.5;
      game.step(1 / 120, 0, true);
    }
    expect(game.boss.hp).toBeLessThan(before);
  });

  it('uses the same widened test an ordinary enemy gets', () => {
    // A round whose centre is outside an enemy but whose width overlaps it also connects, so the
    // king and a slime agree about what a hit is.
    const game = atBoss(43);
    game.gun.equip('puncher');
    game.boss.reset();
    game.enemies = [spawnEnemy('slime', 1, 225, game.player.y + 200)];
    const size = 11;
    game.player.x = 225 - (15 + size) + 2;
    game.shoot();
    for (let i = 0; i < 90 && game.kills === 0; i++) { game.player.invincible = 99; game.step(1 / 120, 0, false); }
    expect(game.kills).toBe(1);
  });

  it('keeps the run at the FINAL BOSS after GAME CLEAR, so the HUD can still show the total', () => {
    const game = atBoss(45);
    expect(game.stage.boss).toBe(true);
    game.boss.damage(BOSS.maxHp);
    tick(game, BOSS.defeatDelay + 0.3);
    expect(game.state).toBe('clear');
    // The HUD keys its TOTAL DEPTH read-out off this, not off the state, which is why 000m
    // appeared behind the result screen before.
    expect(game.stage.boss).toBe(true);
    expect(Math.round(game.totalDepth)).toBe(PLANNED_TOTAL_DEPTH);
  });
});

describe('FINAL BOSS attacks telegraph before they can hurt', () => {
  it('every attack in the table has a visible wind-up', () => {
    for (const attack of BOSS_ATTACKS) {
      expect(attack.telegraph).toBeGreaterThan(0);
      expect(attack.active).toBeGreaterThan(0);
      expect(attack.cooldown).toBeGreaterThan(attack.active);
    }
  });

  it('a sweep is only dangerous after its telegraph, never during it', () => {
    const boss = new BossFightSystem();
    boss.start(0);
    const player = { x: WORLD.width / 2 - 60, y: 0 };
    let sawTelegraph = false;
    for (let i = 0; i < 120 * 20; i++) {
      for (const signal of boss.update(1 / 120, player)) {
        if (signal.kind === 'telegraph' && signal.attack === 'sweep') sawTelegraph = true;
      }
      if (boss.action?.attack.id === 'sweep' && boss.action.state === 'telegraph') expect(boss.danger).toBeNull();
    }
    expect(sawTelegraph).toBe(true);
  });

  it('leaves an escapable lane: the sweep band is narrower than the shaft', () => {
    const shaft = WORLD.width - WORLD.wall * 2;
    expect(BOSS.sweepWidth).toBeLessThan(shaft / 2);
  });

  it('holds its column once a wind-up starts, so the telegraph does not lie', () => {
    const boss = new BossFightSystem();
    boss.start(0);
    const player = { x: WORLD.wall + 10, y: 0 };
    let locked: number | null = null;
    for (let i = 0; i < 120 * 20; i++) {
      boss.update(1 / 120, player);
      if (boss.action) {
        if (locked === null) locked = boss.x;
        expect(boss.x).toBeCloseTo(locked, 5);
      } else locked = null;
    }
  });

  it('stops attacking the moment it is defeated', () => {
    const boss = new BossFightSystem();
    boss.start(0);
    boss.damage(BOSS.maxHp);
    expect(boss.action).toBeNull();
    expect(boss.danger).toBeNull();
    expect(boss.shots).toHaveLength(0);
    boss.update(1 / 120, { x: 0, y: 0 });
    expect(boss.action).toBeNull();
  });
});

describe('FINAL BOSS phases', () => {
  it('crosses into each phase at its HP threshold', () => {
    expect(bossPhaseAt(1).id).toBe(1);
    expect(bossPhaseAt(0.8).id).toBe(1);
    expect(bossPhaseAt(0.75).id).toBe(2);
    expect(bossPhaseAt(0.5).id).toBe(3);
    expect(bossPhaseAt(0.25).id).toBe(4);
    expect(bossPhaseAt(0).id).toBe(4);
  });

  it('declares four phases in descending order with distinct names', () => {
    expect(BOSS_PHASES).toHaveLength(4);
    expect(BOSS_PHASES.map(p => p.id)).toEqual([1, 2, 3, 4]);
    expect(new Set(BOSS_PHASES.map(p => p.name)).size).toBe(4);
    for (let i = 1; i < BOSS_PHASES.length; i++) expect(BOSS_PHASES[i].from).toBeLessThan(BOSS_PHASES[i - 1].from);
  });

  it('turns each area system on only in its own phase', () => {
    const game = atBoss();
    expect(game.oxygen.enabled).toBe(false);
    expect(game.heat.enabled).toBe(false);

    game.boss.damage(BOSS.maxHp * 0.3);
    until(game, () => game.boss.phaseId === 2, 20);
    expect(game.oxygen.enabled).toBe(true);
    expect(game.heat.enabled).toBe(false);
    expect(game.water).toBeDefined();

    game.boss.damage(BOSS.maxHp * 0.25);
    until(game, () => game.boss.phaseId === 3, 20);
    expect(game.oxygen.enabled).toBe(false);
    expect(game.heat.enabled).toBe(true);
    expect(game.pickups.some(k => k.kind === 'oxygenBubble')).toBe(false);
    expect([game.containers.length, game.bubbles.length]).toEqual([0, 0]);

    game.boss.damage(BOSS.maxHp * 0.25);
    until(game, () => game.boss.phaseId === 4, 20);
    expect(game.heat.enabled).toBe(false);
    expect(game.oxygen.enabled).toBe(false);
    expect(game.pickups.some(k => k.kind === 'ice')).toBe(false);
    expect(game.hazards).toHaveLength(0);
  });

  it('hands the new phase its own terrain instead of the previous phase leftovers', () => {
    // The shaft is built well ahead of the camera. Without a re-cut the player would fall through
    // ~12s of the old recipe while the new gauge already drained -- PHASE 2 could strand them
    // with no air anywhere in reach.
    const game = atBoss(11);
    game.boss.damage(BOSS.maxHp * 0.3);
    until(game, () => game.boss.phaseId === 2, 20);
    // PHASE 2's air is AIR CONTAINERS: the sheltering alcove is gone from the whole game, so a
    // container below the player is the only thing that can save a drowning run.
    const air = [
      ...game.containers.filter(c => !c.broken).map(c => c.y),
      ...game.pickups.filter(k => !k.taken && k.kind === 'oxygenBubble').map(k => k.y),
    ].filter(y => y > game.player.y);
    expect(air.length).toBeGreaterThan(0);
    expect(Math.min(...air) - game.player.y).toBeLessThan(WORLD.height * 2);
  });

  it('never leaves collapsing ledges running outside PHASE 4', () => {
    const game = atBoss();
    game.boss.damage(BOSS.maxHp * 0.3);
    until(game, () => game.boss.phaseId === 2, 20);
    expect(game.platforms.every(f => f.breakable !== true || f.state === 'stable')).toBe(true);
  });

  it('tightens only the pacing at CLIMAX, adding no new pattern', () => {
    const boss = new BossFightSystem();
    boss.start(0);
    expect(boss.climax).toBe(false);
    boss.damage(BOSS.maxHp * (1 - BOSS.climaxRatio));
    expect(boss.climax).toBe(true);
    const ids = new Set(BOSS_ATTACKS.filter(a => a.phases.includes(4)).map(a => a.id));
    expect(ids).toEqual(new Set(BOSS_ATTACKS.map(a => a.id)));
    expect(BOSS.climaxSpeed).toBeLessThan(1);
  });
});

describe('FINAL BOSS resolution', () => {
  it('reaches GAME CLEAR after the collapse, with a clear time to show', () => {
    const game = atBoss();
    tick(game, 3);
    game.boss.damage(BOSS.maxHp);
    expect(game.state).toBe('boss');
    const elapsed = game.boss.elapsed;
    expect(elapsed).toBeGreaterThan(0);
    tick(game, BOSS.defeatDelay + 0.2);
    expect(game.state).toBe('clear');
    expect(game.bossTime).toBeGreaterThanOrEqual(elapsed);
    expect(game.boss.enabled).toBe(false);
  });

  it('keeps the clear time after the fight is torn down', () => {
    const game = atBoss();
    tick(game, 5);
    game.boss.damage(BOSS.maxHp);
    tick(game, BOSS.defeatDelay + 0.2);
    expect(game.bossTime).toBeGreaterThan(4);
  });

  it('ends as GAME OVER when the player dies, and a new run restarts at 1-1', () => {
    const game = atBoss();
    game.player.invincible = 0;
    for (let i = 0; i < 40 && game.state === 'boss'; i++) { game.player.invincible = 0; game.damage(1, 'enemy'); }
    expect(game.state).toBe('over');
    const fresh = new GameModel(false, seeded(3));
    expect(fresh.state).toBe('playing');
    expect(fresh.stage.label).toBe('1-1');
    expect(fresh.boss.enabled).toBe(false);
  });

  it('keeps TOTAL DEPTH at the planned 12 x 200m however long the fight runs', () => {
    const game = atBoss();
    expect(Math.round(game.totalDepth)).toBe(PLANNED_TOTAL_DEPTH);
    until(game, () => game.boss.elapsed > 20, 40, true);
    expect(Math.round(game.totalDepth)).toBe(PLANNED_TOTAL_DEPTH);
    game.boss.damage(BOSS.maxHp);
    tick(game, BOSS.defeatDelay + 0.2);
    expect(Math.round(game.totalDepth)).toBe(PLANNED_TOTAL_DEPTH);
  });

  it('cannot be cleared twice', () => {
    const game = atBoss();
    game.boss.damage(BOSS.maxHp);
    tick(game, BOSS.defeatDelay + 0.2);
    expect(game.state).toBe('clear');
    expect(game.clearBoss()).toBe(false);
  });

  it('leaves no king running once a fresh section starts', () => {
    const game = atBoss();
    tick(game, 1);
    const fresh = new GameModel(false, seeded(5));
    fresh.jumpToStage(1, 1);
    expect(fresh.boss.enabled).toBe(false);
    expect(fresh.state).toBe('playing');
  });
});
