import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { BALANCE, JUMP, WALL_JUMP, WORLD } from '../src/data/balance';
import { BREAK_BLOCK_RULES, breakBlockWidth } from '../src/data/structures';
import { GUN_MODULES, type GunModuleId } from '../src/data/gunModules';
import { ENEMY_TYPES, spawnEnemy, type EnemyKind } from '../src/data/enemies';
import type { Platform } from '../src/systems/StageGenerator';

/**
 * Phase 2A: WALL JUMP, the gunboots as boots, and shootable/stompable as two separate questions.
 */

const LEFT = WORLD.wall + 12, RIGHT = WORLD.width - WORLD.wall - 12;

function airborne(x = 225) {
  const game = new GameModel(true);
  game.platforms = []; game.enemies = []; game.pickups = []; game.hazards = [];
  game.player.x = x; game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
  game.events.length = 0;
  return game;
}
/** Park the player hard against one wall, in the air. */
function atWall(side: -1 | 1) {
  const game = airborne(side === -1 ? LEFT : RIGHT);
  expect(game.wallSide).toBe(side);
  return game;
}
const tick = (game: GameModel, seconds: number, direction = 0, action = false) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) game.step(1 / 120, direction, action);
};
/** One ACTION press and release, held against a wall with the given steering. */
function press(game: GameModel, direction: number, frames = 2) {
  for (let i = 0; i < frames; i++) game.step(1 / 120, direction, true);
  game.step(1 / 120, direction, false);
}

describe('WALL JUMP', () => {
  it('kicks off the wall for free: no CHARGE, no round, no effect on the chain', () => {
    for (const side of [-1, 1] as const) {
      const game = atWall(side);
      game.ammo = 5; game.combo = 9;
      const away = -side;
      game.step(1 / 120, away, true);
      expect({ side, jumped: game.events.some(e => e.type === 'wallJump') }).toEqual({ side, jumped: true });
      expect({ side, ammo: game.ammo }).toEqual({ side, ammo: 5 });
      expect({ side, combo: game.combo }).toEqual({ side, combo: 9 });
      expect({ side, shots: game.events.filter(e => e.type === 'shot').length }).toEqual({ side, shots: 0 });
      expect(game.bullets).toEqual([]);
      expect(game.player.vy).toBeLessThan(0);
    }
  });
  it('throws the player up and away from the wall it left', () => {
    for (const side of [-1, 1] as const) {
      const game = atWall(side);
      const startX = game.player.x;
      game.step(1 / 120, -side, true);
      expect(game.player.vy).toBeCloseTo(-WALL_JUMP.impulse, 6);
      tick(game, 0.3, 0, false);            // no steering at all: the shove alone must carry
      const moved = (game.player.x - startX) * -side;
      expect({ side, awayFromWall: moved > 20 }).toEqual({ side, awayFromWall: true });
      expect(game.player.y).toBeLessThan(200);
    }
  });
  it('needs air, a wall, and steering away from it', () => {
    // On the ground it is a plain jump, never a wall jump.
    const grounded = new GameModel(true);
    grounded.platforms = [{ id: 9, x: LEFT - 30, y: grounded.player.y + 40, width: 200 }];
    grounded.player.x = LEFT; grounded.player.vy = 240;
    tick(grounded, 0.6);
    expect(grounded.player.grounded).toBe(9);
    grounded.events.length = 0;
    grounded.step(1 / 120, 1, true);
    expect(grounded.events.some(e => e.type === 'wallJump')).toBe(false);
    expect(grounded.events.some(e => e.type === 'jump')).toBe(true);
    // Mid-shaft there is no wall to leave.
    const open = airborne(225);
    expect(open.wallJumpSide(1)).toBe(0);
    expect(open.wallJump(open.wallJumpSide(1))).toBe(false);
    // Steering INTO the wall, or not steering at all, is not a wall jump either.
    for (const [side, direction] of [[-1, -1], [-1, 0], [1, 1], [1, 0]] as const) {
      const game = atWall(side);
      expect({ side, direction, allowed: game.wallJumpSide(direction) }).toEqual({ side, direction, allowed: 0 });
      game.step(1 / 120, direction, true);
      expect({ side, direction, jumped: game.events.some(e => e.type === 'wallJump') }).toEqual({ side, direction, jumped: false });
    }
  });
  it('fires the gunboots instead when the wall conditions are not met', () => {
    // Same wall, same press, but steering into it: this is an ordinary airborne shot.
    const game = atWall(-1);
    press(game, -1);
    expect(game.events.some(e => e.type === 'shot')).toBe(true);
    expect(game.events.some(e => e.type === 'wallJump')).toBe(false);
  });
  it('cannot be ridden up the same wall twice in a row', () => {
    const game = atWall(-1);
    game.step(1 / 120, 1, true);
    expect(game.events.filter(e => e.type === 'wallJump')).toHaveLength(1);
    // Put the player straight back on the same wall, still in the air.
    game.player.x = LEFT;
    game.events.length = 0;
    expect(game.wallJumpSide(1)).toBe(0);
    press(game, 1);
    expect(game.events.some(e => e.type === 'wallJump')).toBe(false);
    // The press is not swallowed: with no wall jump available it is a shot.
    expect(game.events.some(e => e.type === 'shot')).toBe(true);
  });
  it('is re-armed by touching the other wall', () => {
    const game = atWall(-1);
    game.step(1 / 120, 1, true);
    expect(game.events.filter(e => e.type === 'wallJump')).toHaveLength(1);
    // Cross to the right wall and leave it, then come back to the left one.
    game.player.x = RIGHT;
    game.step(1 / 120, -1, false);
    game.events.length = 0;
    game.player.x = LEFT;
    expect(game.wallJumpSide(1)).toBe(-1);
    game.step(1 / 120, 1, true);
    expect(game.events.some(e => e.type === 'wallJump')).toBe(true);
  });
  it('is re-armed by an ordinary landing', () => {
    const game = atWall(-1);
    game.step(1 / 120, 1, true);
    expect(game.events.filter(e => e.type === 'wallJump')).toHaveLength(1);
    game.platforms = [{ id: 12, x: LEFT - 30, y: game.player.y + 120, width: 240 }];
    game.player.x = LEFT + 20;
    tick(game, 1.2);
    expect(game.player.grounded).toBe(12);
    game.player.x = LEFT; game.player.y -= 60; game.player.grounded = -1; game.player.vy = 0;
    game.events.length = 0;
    expect(game.wallJumpSide(1)).toBe(-1);
    game.step(1 / 120, 1, true);
    expect(game.events.some(e => e.type === 'wallJump')).toBe(true);
  });
  it('keeps its numbers in data, marked as unmeasured', () => {
    expect(WALL_JUMP.impulse).toBeGreaterThan(0);
    expect(WALL_JUMP.kick).toBeGreaterThan(BALANCE.moveSpeed);
    expect(WALL_JUMP.kickTime).toBeGreaterThan(0);
    // A wall is a worse floor than a floor.
    expect(WALL_JUMP.impulse).toBeLessThanOrEqual(JUMP.impulse);
  });
  it('lets a BURST already paid for finish while the wall conditions hold', () => {
    const game = atWall(-1);
    game.gun.equip('burst');
    game.stats.maxAmmo = 20; game.ammo = 20;
    game.player.x = 225;                       // buy the burst in open air
    game.step(1 / 120, 0, true);
    expect(game.gun.bursting).toBe(true);
    const fired = () => game.events.filter(e => e.type === 'shot').length;
    // Release, so the next press is a fresh one rather than the same hold continuing.
    game.step(1 / 120, 0, false);
    game.events.length = 0;
    // Now slam against the wall and press away from it: a wall jump happens AND the rounds already
    // paid for still come out. Neither half swallows the other.
    game.player.x = LEFT;
    for (let i = 0; i < 40; i++) game.step(1 / 120, 1, true);
    expect(game.events.some(e => e.type === 'wallJump')).toBe(true);
    expect(fired()).toBe(GUN_MODULES.burst.burst!.count - 1);
  });
});

describe('the gunboots are boots: recoil can lift', () => {
  const lift = (id: GunModuleId) => {
    const game = airborne();
    game.gun.equip(id);
    game.ammo = game.stats.maxAmmo;
    game.cooldown = 0;
    game.shoot();
    return game.player.vy;
  };
  it('throws the player upward with the heavy weapons', () => {
    for (const id of ['laser', 'shotgun'] as GunModuleId[]) {
      expect({ id, vy: lift(id) < 0 }).toEqual({ id, vy: true });
    }
  });
  it('gives LASER decisively more kick than MACHINE', () => {
    expect(GUN_MODULES.laser.recoil).toBeGreaterThan(GUN_MODULES.machine.recoil * 1.5);
    expect(Math.abs(lift('laser'))).toBeGreaterThan(Math.abs(lift('machine')));
  });
  it('caps a rise at the same speed as a fall, needing no number of its own', () => {
    const game = airborne();
    game.gun.equip('laser');
    game.stats.shotRecoil = BALANCE.shotRecoil * 40;      // absurd on purpose
    game.ammo = game.stats.maxAmmo; game.cooldown = 0;
    game.shoot();
    expect(game.player.vy).toBe(-game.stats.maxFallSpeed);
  });
  it('still lets a falling player be slowed rather than only launched', () => {
    const game = airborne();
    game.player.vy = 400;
    game.cooldown = 0;
    game.shoot();
    expect(game.player.vy).toBe(400 - GUN_MODULES.machine.recoil);
    expect(game.player.vy).toBeGreaterThan(0);
  });
});

describe('PUNCHER fires a narrow parallel column', () => {
  it('costs two and puts exactly three rounds in the air', () => {
    expect(GUN_MODULES.puncher.ammoCost).toBe(2);
    expect(GUN_MODULES.puncher.projectileCount).toBe(3);
    const game = airborne();
    game.gun.equip('puncher');
    game.cooldown = 0;
    game.shoot();
    expect(game.bullets).toHaveLength(3);
    expect(game.ammo).toBe(game.stats.maxAmmo - 2);
  });
  it('leaves the muzzle side by side and stays that way', () => {
    const game = airborne();
    game.gun.equip('puncher');
    game.cooldown = 0;
    game.shoot();
    const spawnX = game.bullets.map(b => b.x).sort((a, b) => a - b);
    // Three distinct lanes at the muzzle, a narrow column wide.
    expect(new Set(spawnX).size).toBe(3);
    expect(spawnX[2] - spawnX[0]).toBeCloseTo(GUN_MODULES.puncher.spawnSpread!, 6);
    // And they stay parallel: lateral speeds are a rounding error next to the downward speed.
    for (const b of game.bullets) expect(Math.abs(b.vx)).toBeLessThan(b.vy * 0.05);
  });
  it('is unmistakably narrower than TRIPLE, in the data and in the air', () => {
    expect(GUN_MODULES.puncher.spread).toBeLessThan(GUN_MODULES.triple.spread / 5);
    const width = (id: GunModuleId) => {
      const game = airborne();
      game.gun.equip(id);
      game.cooldown = 0;
      game.shoot();
      const reach = 200;
      const xs = game.bullets.map(b => b.x + (b.vx / b.vy) * reach);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(width('puncher')).toBeLessThan(width('triple') / 3);
  });
  it('hits an enemy with each round independently rather than piercing with one', () => {
    const game = airborne();
    game.gun.equip('puncher');
    const lane = GUN_MODULES.puncher.spawnSpread! / 2;
    game.enemies = [spawnEnemy('slime', 1, 225 - lane, 260), spawnEnemy('slime', 2, 225, 260), spawnEnemy('slime', 3, 225 + lane, 260)];
    game.cooldown = 0;
    game.shoot();
    for (let i = 0; i < 90; i++) { game.platforms = []; game.player.y = 200; game.player.vy = 0; game.step(1 / 120, 0, false); }
    expect(game.kills).toBe(3);
  });
  it('hits a BREAK BLOCK with each round independently', () => {
    const game = new GameModel(true);
    const block: Platform = { id: 71, x: WORLD.wall, y: 320, width: WORLD.width - WORLD.wall * 2, breakable: false, state: 'stable', breakBlock: { hits: 0, durability: 9, slot: 0, reward: false } };
    game.platforms = [block];
    game.player.x = 225; game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
    game.gun.equip('puncher');
    game.cooldown = 0;
    game.shoot();
    for (let i = 0; i < 90 && block.breakBlock!.hits < 3; i++) game.step(1 / 120, 0, false);
    expect(block.breakBlock!.hits).toBe(3);
  });
});

describe('LASER goes through what it hits', () => {
  /** A column of BREAK BLOCK rows, all in the player's lane. */
  const stack = (game: GameModel, rows: number, durability = 9) => {
    const width = breakBlockWidth();
    const blocks: Platform[] = Array.from({ length: rows }, (_, i) => ({
      id: 80 + i, x: WORLD.wall, y: 320 + i * 140, width: Math.round(WORLD.wall + width) - WORLD.wall,
      breakable: false, state: 'stable', breakBlock: { hits: 0, durability, slot: 0, reward: false },
    }));
    game.platforms = blocks;
    return blocks;
  };
  it('costs four and reaches far further than the standard gun', () => {
    expect(GUN_MODULES.laser.ammoCost).toBe(4);
    expect(GUN_MODULES.laser.range).toBeGreaterThan(GUN_MODULES.machine.range * 2);
  });
  it('damages a BREAK BLOCK and keeps going to the next one', () => {
    const game = new GameModel(true);
    const blocks = stack(game, 3);
    game.player.x = WORLD.wall + 30; game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
    game.gun.equip('laser');
    game.stats.maxAmmo = 40; game.ammo = 40;
    game.cooldown = 0;
    game.shoot();
    for (let i = 0; i < 120; i++) { game.player.y = 200; game.player.vy = 0; game.step(1 / 120, 0, false); }
    expect(blocks.map(b => b.breakBlock!.hits)).toEqual([1, 1, 1]);
  });
  it('never hits the same block twice, however long it spends inside one', () => {
    const game = new GameModel(true);
    const blocks = stack(game, 1);
    game.player.x = WORLD.wall + 30; game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
    game.gun.equip('laser');
    game.stats.maxAmmo = 40; game.ammo = 40;
    game.cooldown = 0;
    game.shoot();
    // Freeze the round inside the block's band and run many frames over it.
    const round = game.bullets[0];
    for (let i = 0; i < 200; i++) {
      round.y = blocks[0].y + BREAK_BLOCK_RULES.thickness / 2;
      round.previousY = blocks[0].y - 1;
      round.travelled = 0;
      game.player.y = 200; game.player.vy = 0;
      game.step(1 / 120, 0, false);
    }
    expect(blocks[0].breakBlock!.hits).toBe(1);
  });
  it('stops at a block when the weapon does not pierce blocks', () => {
    const game = new GameModel(true);
    const blocks = stack(game, 3);
    game.player.x = WORLD.wall + 30; game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
    game.gun.equip('machine');
    game.cooldown = 0;
    game.shoot();
    for (let i = 0; i < 120; i++) { game.player.y = 200; game.player.vy = 0; game.step(1 / 120, 0, false); }
    expect(blocks.map(b => b.breakBlock!.hits)).toEqual([1, 0, 0]);
  });
  it('still passes through enemies', () => {
    const game = airborne();
    game.gun.equip('laser');
    game.enemies = [spawnEnemy('slime', 1, 225, 260), spawnEnemy('slime', 2, 225, 320), spawnEnemy('slime', 3, 225, 380)];
    game.cooldown = 0;
    game.shoot();
    for (let i = 0; i < 90; i++) { game.platforms = []; game.player.y = 200; game.player.vy = 0; game.step(1 / 120, 0, false); }
    expect(game.kills).toBe(3);
  });
});

describe('SHOTGUN stays the close-range shove', () => {
  it('costs five, fans wide and throws the player up', () => {
    expect(GUN_MODULES.shotgun.ammoCost).toBe(5);
    expect(GUN_MODULES.shotgun.spread).toBeGreaterThan(GUN_MODULES.puncher.spread * 10);
    const game = airborne();
    game.gun.equip('shotgun');
    game.stats.maxAmmo = 10; game.ammo = 10;
    game.cooldown = 0;
    game.shoot();
    expect(game.bullets).toHaveLength(5);
    expect(game.player.vy).toBeLessThan(0);
    expect(GUN_MODULES.shotgun.recoil).toBeGreaterThan(GUN_MODULES.machine.recoil);
  });
});

describe('shootable and stompable are two separate questions', () => {
  it('states both for every enemy in the catalogue', () => {
    const kinds = Object.keys(ENEMY_TYPES) as EnemyKind[];
    expect(kinds.length).toBe(20);
    for (const kind of kinds) {
      expect({ kind, shootable: typeof ENEMY_TYPES[kind].shootable }).toEqual({ kind, shootable: 'boolean' });
      expect({ kind, stompable: typeof ENEMY_TYPES[kind].stompable }).toEqual({ kind, stompable: 'boolean' });
    }
    // This phase deliberately turtles nobody: every existing enemy still answers to a round.
    expect(kinds.every(kind => ENEMY_TYPES[kind].shootable)).toBe(true);
    // And they are genuinely independent: the roster already varies one without the other.
    expect(new Set(kinds.map(kind => ENEMY_TYPES[kind].stompable)).size).toBe(2);
  });
  it('carries both onto the spawned enemy, not just the table', () => {
    const enemy = spawnEnemy('slime', 1, 225, 260);
    expect(enemy.shootable).toBe(true);
    expect(enemy.stompable).toBe(true);
  });
  it('damages a shootable enemy and ignores one that is not', () => {
    for (const shootable of [true, false]) {
      const game = airborne();
      const enemy = spawnEnemy('slime', 1, 225, 280);
      enemy.shootable = shootable;
      game.enemies = [enemy];
      game.cooldown = 0;
      game.shoot();
      for (let i = 0; i < 90; i++) { game.platforms = []; game.player.y = 200; game.player.vy = 0; game.step(1 / 120, 0, false); }
      expect({ shootable, alive: enemy.alive }).toEqual({ shootable, alive: !shootable });
    }
  });
  it('lets a round pass a turtle and kill what is behind it', () => {
    const game = airborne();
    const turtle = spawnEnemy('slime', 1, 225, 260);
    turtle.shootable = false;
    const behind = spawnEnemy('slime', 2, 225, 340);
    game.enemies = [turtle, behind];
    game.cooldown = 0;
    game.shoot();
    for (let i = 0; i < 120; i++) { game.platforms = []; game.player.y = 200; game.player.vy = 0; game.step(1 / 120, 0, false); }
    expect(turtle.alive).toBe(true);
    expect(behind.alive).toBe(false);
    expect(game.kills).toBe(1);
  });
  it('still lets a turtle be stomped, which is the whole point of one', () => {
    const game = new GameModel(true);
    game.platforms = [];
    const turtle = spawnEnemy('slime', 1, 225, 260);
    turtle.shootable = false;
    expect(turtle.stompable).toBe(true);
    game.enemies = [turtle];
    game.player.x = 225; game.player.y = 200; game.player.vy = 300; game.player.grounded = -1;
    game.ammo = 1;
    tick(game, 0.2);
    expect(turtle.alive).toBe(false);
    expect(game.combo).toBe(1);
    expect(game.ammo).toBe(game.stats.maxAmmo);
    expect(game.player.vy).toBeLessThan(0);
  });
});
