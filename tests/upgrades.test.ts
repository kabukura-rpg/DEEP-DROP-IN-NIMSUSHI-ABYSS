import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { UPGRADE_TUNING } from '../src/data/upgrades';
import { COIN_VALUES } from '../src/data/coins';
import { COIN_HIGH_RULES } from '../src/data/coinHigh';
import { ENEMY_TYPES, spawnEnemy, type EnemyKind } from '../src/data/enemies';
import { spawnGunModule } from '../src/data/pickups';
import { spawnCorpse } from '../src/data/corpses';
import { GUN_MODULES } from '../src/data/gunModules';
import { SAFE_ZONE_RULES, type SafeZone } from '../src/data/safeZone';
import { BREAK_BLOCK_RULES } from '../src/data/structures';
import { WORLD } from '../src/data/balance';
import type { Platform } from '../src/systems/StageGenerator';
import type { UpgradeId } from '../src/data/upgrades';

/**
 * What each of the twenty actually does.
 *
 * Every one of these drives the real model rather than a system in isolation, because the point of
 * an upgrade is the rule it adds to play -- that a stomp now also explodes, that a coin now also
 * pays charge -- and a rule that only holds in a fixture is not a rule. The numbers come from
 * UPGRADE_TUNING so re-measuring changes the table and not these.
 */
const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
/** A run with the shaft emptied, holding the named upgrades. */
function run(held: UpgradeId[] = [], seed = 31) {
  const game = new GameModel(false, seeded(seed));
  for (const id of held) game.upgrades.grant(id);
  game.jumpToStage(1, 1);
  game.platforms = []; game.enemies = []; game.pickups = []; game.hazards = [];
  game.doodads = []; game.safeZones = []; game.corpses = []; game.containers = [];
  game.player.invincible = 99;
  game.player.x = 225; game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
  return game;
}
const tick = (game: GameModel, seconds: number, direction = 0, fire = false) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) { game.player.invincible = 99; game.step(1 / 120, direction, fire); }
};
/** Fire once, the way a player taps. */
function fireOnce(game: GameModel) {
  const before = game.bullets.length;
  for (let i = 0; i < 40 && game.bullets.length === before; i++) {
    game.player.invincible = 99;
    game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
    game.step(1 / 120, 0, i % 12 < 6);
  }
  return game.bullets.slice(before);
}
/** A floor under the player, to jump from. */
function ground(game: GameModel, y = 320) {
  const floor: Platform = { id: 700, x: WORLD.wall, y, width: WORLD.width - WORLD.wall * 2, breakable: false, state: 'stable' };
  game.platforms = [floor];
  game.player.x = 225; game.player.y = y - 15; game.player.vy = 0; game.player.grounded = floor.id;
  return floor;
}

describe('BLAST MODULE', () => {
  it('goes off on a stomp and takes the neighbours with it', () => {
    const game = run(['blastModule']);
    game.combo = 0;
    const stomped = spawnEnemy('slime', 1, 225, 250);
    const bystander = spawnEnemy('slime', 2, 225 + 40, 250);
    game.enemies = [stomped, bystander];
    game.player.vy = 320;
    tick(game, 0.5);
    expect(stomped.alive).toBe(false);
    expect(bystander.alive).toBe(false);
    // Two kills, counted once each: the stomped enemy is excluded from its own blast.
    expect(game.combo).toBe(2);
    expect(game.kills).toBe(2);
  });

  it('does not go off on a doodad bounce or a chamber floor', () => {
    const bounce = run(['blastModule']);
    bounce.doodads = [{ id: 1, x: 225 - 22, y: 320, width: 44, height: 12, variant: 'lamp', active: true }];
    const near = spawnEnemy('slime', 9, 225 + 30, 330);
    bounce.enemies = [near];
    bounce.player.vy = 320;
    tick(bounce, 0.6);
    expect(bounce.events.some(e => e.type === 'doodad')).toBe(true);
    expect(near.alive).toBe(true);
    expect(bounce.events.some(e => e.type === 'explosion')).toBe(false);

    const chamber = run(['blastModule']);
    const zone: SafeZone = { id: 5, side: -1, x: WORLD.wall, y: 320 - SAFE_ZONE_RULES.height, width: SAFE_ZONE_RULES.width, height: SAFE_ZONE_RULES.height, content: null, taken: false };
    chamber.safeZones = [zone];
    chamber.platforms = [{ id: 6, x: zone.x, y: 320, width: zone.width, breakable: false, state: 'stable', safeZone: zone.id }];
    chamber.player.x = zone.x + 70; chamber.player.y = 260; chamber.player.vy = 300;
    tick(chamber, 0.6);
    expect(chamber.player.grounded).toBe(6);
    expect(chamber.events.some(e => e.type === 'explosion')).toBe(false);
  });
});

describe('ROCKET JUMP', () => {
  it('jumps higher and blasts, from the ground only', () => {
    const plain = run();
    ground(plain);
    plain.jump();
    const ordinary = Math.abs(plain.player.vy);

    const rocket = run(['rocketJump']);
    ground(rocket);
    const below = spawnEnemy('slime', 3, 225 + 20, 330);
    rocket.enemies = [below];
    rocket.jump();
    expect(Math.abs(rocket.player.vy)).toBeCloseTo(ordinary * UPGRADE_TUNING.rocketJump.impulseMultiplier, 4);
    expect(rocket.events.some(e => e.type === 'explosion')).toBe(true);
    expect(below.alive).toBe(false);
  });

  it('never fires on a stomp, a doodad or a wall kick', () => {
    const stomp = run(['rocketJump']);
    stomp.enemies = [spawnEnemy('slime', 4, 225, 250)];
    stomp.player.vy = 320;
    tick(stomp, 0.4);
    expect(stomp.events.some(e => e.type === 'explosion')).toBe(false);

    const bounce = run(['rocketJump']);
    bounce.doodads = [{ id: 1, x: 225 - 22, y: 300, width: 44, height: 12, variant: 'lamp', active: true }];
    bounce.player.vy = 320;
    tick(bounce, 0.6);
    expect(bounce.events.some(e => e.type === 'doodad')).toBe(true);
    expect(bounce.events.some(e => e.type === 'explosion')).toBe(false);

    const wall = run(['rocketJump']);
    wall.player.x = WORLD.wall + 2; wall.player.y = 300; wall.player.vy = 60;
    tick(wall, 0.1, -1);
    wall.events.length = 0;
    for (let i = 0; i < 20; i++) { wall.player.x = WORLD.wall + 2; wall.step(1 / 120, -1, i === 10); }
    expect(wall.events.some(e => e.type === 'explosion')).toBe(false);
  });
});

describe('DRONE and HOT CASING ride the fire event, not the volley', () => {
  it('DRONE adds a round and spends no CHARGE', () => {
    for (const id of ['machine', 'shotgun', 'triple'] as const) {
      const plain = run([], 41); plain.gun.equip(id);
      const solo = fireOnce(plain).length;
      const droned = run(['drone'], 41); droned.gun.equip(id);
      const ammoBefore = droned.ammo;
      const withDrone = fireOnce(droned);
      // Exactly one extra round however many pellets the weapon throws.
      expect({ id, extra: withDrone.length - solo }).toEqual({ id, extra: 1 });
      expect({ id, drone: withDrone.filter(b => b.source === 'drone').length }).toEqual({ id, drone: 1 });
      // And it costs the magazine nothing beyond the shot the player paid for.
      expect({ id, cost: ammoBefore - droned.ammo }).toEqual({ id, cost: GUN_MODULES[id].ammoCost });
    }
  });

  it('DRONE fires a machine round whatever the player carries, and never takes a COIN HIGH', () => {
    const game = run(['drone']);
    game.gun.equip('laser');
    game.coinHigh.earn(COIN_HIGH_RULES.threshold);
    const drone = fireOnce(game).find(b => b.source === 'drone')!;
    expect(drone.damage).toBe(GUN_MODULES.machine.projectileDamage);
    expect(drone.range).toBe(GUN_MODULES.machine.range);
  });

  it('DRONE kills count on the chain like any other', () => {
    const game = run(['drone']);
    // Below the companion: the gunboots and the drone both fire downward.
    const target = spawnEnemy('slime', 5, game.dronePosition.x, game.dronePosition.y + 80);
    game.enemies = [target];
    for (let i = 0; i < 200 && target.alive; i++) {
      game.player.invincible = 99;
      game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
      target.x = game.dronePosition.x; target.y = game.dronePosition.y + 80;
      game.ammo = game.stats.maxAmmo;
      game.step(1 / 120, 0, i % 12 < 6);
    }
    expect(target.alive).toBe(false);
    expect(game.combo).toBe(1);
  });

  it('HOT CASING throws one case a shot, worth half a machine round', () => {
    const game = run(['hotCasing']);
    game.gun.equip('shotgun');
    const casings = fireOnce(game).filter(b => b.source === 'casing');
    expect(casings).toHaveLength(1);
    expect(casings[0].damage).toBeCloseTo(GUN_MODULES.machine.projectileDamage * UPGRADE_TUNING.hotCasing.damageShare, 6);
    // Half a round means an HP 1 enemy takes two of them, which the damage path must carry as a
    // fraction rather than rounding away.
    const target = spawnEnemy('slime', 6, 0, 0);
    expect(ENEMY_TYPES.slime.hp).toBe(1);
    target.hp -= casings[0].damage;
    expect(target.hp).toBeGreaterThan(0);
    target.hp -= casings[0].damage;
    expect(target.hp).toBeLessThanOrEqual(0);
  });
});

describe('COIN POWERED and POPPING COINS ride a physical pickup', () => {
  /** Drop coins on the player and let them be swept up. */
  function sweep(game: GameModel, count: number, denomination: 'small' | 'large') {
    game.coins.burst(game.player.x, game.player.y, count, seeded(3), denomination);
    for (let i = 0; i < 200 && game.coins.coins.length; i++) {
      game.player.invincible = 99;
      const coin = game.coins.coins[0];
      game.player.x = coin.x; game.player.y = coin.y;
      game.step(1 / 120, 0, false);
    }
  }

  it('COIN POWERED pays 1 for a small gem and 5 for a large one', () => {
    const small = run(['gemPowered']);
    small.ammo = 0;
    sweep(small, 1, 'small');
    expect(small.ammo).toBe(COIN_VALUES.small * UPGRADE_TUNING.gemPowered.chargePerValue);
    expect(small.ammo).toBe(1);

    const large = run(['gemPowered']);
    large.ammo = 0;
    sweep(large, 1, 'large');
    expect(large.ammo).toBe(5);
  });

  it('COIN POWERED never overfills, and never raises the maximum', () => {
    const game = run(['gemPowered']);
    const max = game.stats.maxAmmo;
    game.ammo = max - 1;
    sweep(game, 4, 'large');
    expect(game.ammo).toBe(max);
    expect(game.stats.maxAmmo).toBe(max);
  });

  it('COIN POWERED ignores a settled chain, which is awarded rather than dropped', () => {
    const game = run(['gemPowered']);
    game.ammo = 1; game.combo = 25;
    game.settleCombo();
    expect(game.coins.walletCoins).toBe(100);
    expect(game.ammo).toBe(game.stats.maxAmmo);          // the tier's own CHARGE, not the coin's
    const dry = run(['gemPowered'], 77);
    dry.ammo = 1; dry.combo = 8;
    dry.settleCombo();
    // The 8 tier grants no CHARGE, so nothing but a real gem could have refilled it.
    expect(dry.ammo).toBe(1);
  });

  it('POPPING COINS fires one round upward per gem, costing nothing', () => {
    const game = run(['poppingGems']);
    const ammo = game.ammo;
    sweep(game, 3, 'small');
    const popped = game.bullets.filter(b => b.source === 'poppingGem');
    expect(popped).toHaveLength(3);
    for (const round of popped) expect(Math.sign(round.vy)).toBe(-1);
    expect(game.ammo).toBe(ammo);
  });

  it('POPPING COINS does not fire for a settled chain', () => {
    const game = run(['poppingGems']);
    game.combo = 8;
    game.settleCombo();
    expect(game.bullets.filter(b => b.source === 'poppingGem')).toHaveLength(0);
  });
});

describe('GUNPOWDER BLOCKS', () => {
  /** A real row of blocks, edge to edge. */
  function row(game: GameModel, durability = 1) {
    const width = 70;
    const blocks: Platform[] = Array.from({ length: 5 }, (_, i) => ({
      id: 800 + i, x: WORLD.wall + i * width, y: 420, width,
      breakable: false, state: 'stable' as const,
      breakBlock: { hits: 0, durability, slot: i, reward: i === 2 },
    }));
    game.platforms = blocks;
    return blocks;
  }

  it('takes the whole row and fires one round per block', () => {
    const game = run(['gunpowderBlocks']);
    const blocks = row(game);
    game.bullets = [];
    // Open the first one the ordinary way.
    blocks[0].breakBlock!.hits = blocks[0].breakBlock!.durability - 1;
    game.bullets = [{ source: 'player', x: blocks[0].x + 10, y: 410, previousX: blocks[0].x + 10, previousY: 400, vx: 0, vy: 600, damage: 1, size: 4, pierce: 0, pierceBlocks: false, blocks: new Set(), range: 900, travelled: 0, beam: false, hits: new Set(), alive: true }];
    tick(game, 0.2);
    for (const block of blocks) expect({ id: block.id, state: block.state }).toEqual({ id: block.id, state: 'broken' });
    const fired = game.bullets.filter(b => b.source === 'gunpowderBlock');
    expect(fired).toHaveLength(blocks.length);
    for (const round of fired) expect(Math.sign(round.vy)).toBe(-1);
  });

  it('pays a REWARD BLOCK caught in the chain, and counts none of it as a kill', () => {
    const game = run(['gunpowderBlocks']);
    const blocks = row(game);
    blocks[0].breakBlock!.hits = blocks[0].breakBlock!.durability - 1;
    game.bullets = [{ source: 'player', x: blocks[0].x + 10, y: 410, previousX: blocks[0].x + 10, previousY: 400, vx: 0, vy: 600, damage: 1, size: 4, pierce: 0, pierceBlocks: false, blocks: new Set(), range: 900, travelled: 0, beam: false, hits: new Set(), alive: true }];
    tick(game, 0.2);
    const value = game.coins.coins.reduce((sum, c) => sum + c.value, 0) + game.coins.scoreCoins;
    expect(value).toBe(COIN_VALUES.large * BREAK_BLOCK_RULES.rewardCoins);
    expect([game.kills, game.combo]).toEqual([0, 0]);
  });

  it('terminates: a row cannot chain back into itself', () => {
    const game = run(['gunpowderBlocks']);
    const blocks = row(game, 2);
    blocks[2].breakBlock!.hits = blocks[2].breakBlock!.durability - 1;
    game.bullets = [{ source: 'player', x: blocks[2].x + 10, y: 410, previousX: blocks[2].x + 10, previousY: 400, vx: 0, vy: 600, damage: 1, size: 4, pierce: 0, pierceBlocks: false, blocks: new Set(), range: 900, travelled: 0, beam: false, hits: new Set(), alive: true }];
    tick(game, 0.2);
    expect(game.bullets.filter(b => b.source === 'gunpowderBlock')).toHaveLength(blocks.length);
  });
});

describe('HEART BALLOON', () => {
  it('slows the fall while it is alive', () => {
    const fall = (held: UpgradeId[]) => {
      const game = run(held);
      game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
      // Nothing to land on or bounce off for the whole fall: this is about the fall itself, and the
      // terrain the SECTION happens to generate below is not.
      for (let i = 0; i < 240; i++) { game.platforms = []; game.enemies = []; game.doodads = []; game.step(1 / 120, 0, false); }
      return game.player.vy;
    };
    expect(fall(['heartBalloon'])).toBeLessThan(fall([]));
    expect(fall(['heartBalloon'])).toBeCloseTo(fall([]) * UPGRADE_TUNING.heartBalloon.fallMultiplier, 0);
  });

  it('pops when an enemy touches it, blasts them, and leaves the player unhurt', () => {
    const game = run(['heartBalloon']);
    game.jumpToStage(1, 1);
    game.platforms = []; game.doodads = []; game.safeZones = [];
    game.player.x = 225; game.player.y = 300; game.player.vy = 0;
    game.player.invincible = 0;
    const hp = game.hp;
    const balloon = game.balloon!;
    balloon.x = 225; balloon.y = 300 + UPGRADE_TUNING.heartBalloon.offsetY;
    const attacker = spawnEnemy('bat', 7, balloon.x, balloon.y);
    game.enemies = [attacker];
    for (let i = 0; i < 60 && balloon.alive; i++) {
      game.player.x = 225; game.player.y = 300; game.player.vy = 0;
      attacker.x = balloon.x; attacker.y = balloon.y;
      game.step(1 / 120, 0, false);
    }
    expect(balloon.alive).toBe(false);
    expect(attacker.alive).toBe(false);
    expect(game.hp).toBe(hp);
    expect(game.events.some(e => e.type === 'balloon')).toBe(true);
  });

  it('holds the terminal speed at the tuned share, and hands it straight back when it pops', () => {
    // DESIGN TUNING — ORIGINAL VALUE NOT VERIFIED. The original reduces the fall rate while the
    // balloon is held; the share is not published. This pins what DEEP DROP actually does so a
    // later measured value replaces a number somebody can see rather than a feel nobody recorded.
    expect(UPGRADE_TUNING.heartBalloon.fallMultiplier).toBe(0.82);

    const game = run(['heartBalloon']);
    // Kept in open air: the shaft keeps generating floors underneath, and a landing would reset
    // the very velocity being measured.
    const freefall = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 120); i++) {
        game.platforms = []; game.player.grounded = -1;
        game.step(1 / 120, 0, false);
      }
    };
    game.player.y = 200; game.player.vy = 0;
    freefall(3);
    const slowed = game.player.vy;
    expect(slowed).toBeCloseTo(game.stats.maxFallSpeed * UPGRADE_TUNING.heartBalloon.fallMultiplier, 0);

    // Popped mid-fall: the cap is gone on the very next steps, not at the next SECTION.
    game.balloon!.alive = false;
    freefall(2);
    expect(game.player.vy).toBeGreaterThan(slowed);
    expect(game.player.vy).toBeCloseTo(game.stats.maxFallSpeed, 0);
  });

  it('is forgotten entirely by a new run', () => {
    const game = run(['heartBalloon']);
    expect(game.balloon?.alive).toBe(true);
    const fresh = new GameModel(false, seeded(3));
    expect(fresh.upgrades.has('heartBalloon')).toBe(false);
    expect(fresh.balloon).toBeNull();
    fresh.player.y = 200; fresh.player.vy = 0;
    for (let i = 0; i < 360; i++) { fresh.platforms = []; fresh.player.grounded = -1; fresh.step(1 / 120, 0, false); }
    expect(fresh.player.vy).toBeCloseTo(fresh.stats.maxFallSpeed, 0);
  });

  it('comes back at the next SECTION and not before', () => {
    const game = run(['heartBalloon']);
    game.balloon!.alive = false;
    tick(game, 1);
    expect(game.balloon!.alive).toBe(false);
    game.jumpToStage(1, 2);
    expect(game.balloon?.alive).toBe(true);
  });
});

describe('KNIFE AND FORK and REST IN PIECES', () => {
  it('leaves a body only for the kinds that carry one', () => {
    const flesh = Object.values(ENEMY_TYPES).filter(t => t.leavesCorpse).map(t => t.id);
    expect(flesh.length).toBeGreaterThan(0);
    expect(flesh.length).toBeLessThan(Object.keys(ENEMY_TYPES).length);
    for (const kind of ['armoredSlime', 'spikeDemon', 'voidWisp'] as EnemyKind[]) {
      expect({ kind, corpse: ENEMY_TYPES[kind].leavesCorpse === true }).toEqual({ kind, corpse: false });
    }
  });

  it('eats ten bodies for a heart', () => {
    const game = run(['knifeAndFork']);
    game.player.invincible = 0; game.damage(2); game.player.invincible = 99;
    const low = game.hp;
    const per = UPGRADE_TUNING.knifeAndFork.corpsesPerHeart;
    for (let i = 0; i < per; i++) {
      game.corpses = [spawnCorpse(i + 1, game.player.x, game.player.y)];
      tick(game, 0.05);
    }
    expect(game.corpsesEaten).toBe(per);
    expect(game.hp).toBe(low + UPGRADE_TUNING.knifeAndFork.heal);
  });

  it('blows a body up when it is shot, and only once', () => {
    const game = run(['restInPieces']);
    const corpse = spawnCorpse(1, 225, 260);
    corpse.vy = 0;
    game.corpses = [corpse];
    const bystander = spawnEnemy('slime', 8, 225 + 30, 260);
    game.enemies = [bystander];
    game.ammo = game.stats.maxAmmo;
    for (let i = 0; i < 200 && !corpse.claimed; i++) {
      game.player.invincible = 99;
      game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
      corpse.y = 260; corpse.x = 225;
      game.ammo = game.stats.maxAmmo;
      game.step(1 / 120, 0, i % 12 < 6);
    }
    expect(corpse.claimed).toBe(true);
    expect(bystander.alive).toBe(false);
    expect(game.events.filter(e => e.type === 'explosion').length).toBeGreaterThan(0);
  });

  it('cannot both eat and detonate the same body', () => {
    const eaten = run(['knifeAndFork', 'restInPieces']);
    const corpse = spawnCorpse(1, eaten.player.x, eaten.player.y);
    eaten.corpses = [corpse];
    tick(eaten, 0.05);
    expect(corpse.claimed).toBe(true);
    expect(eaten.corpsesEaten).toBe(1);
    // Claimed, so no round can find it any more.
    eaten.events.length = 0;
    eaten.ammo = eaten.stats.maxAmmo;
    tick(eaten, 0.6, 0, true);
    expect(eaten.events.some(e => e.type === 'explosion')).toBe(false);

    const blown = run(['knifeAndFork', 'restInPieces'], 44);
    const body = spawnCorpse(1, 225, 260);
    body.vy = 0;
    blown.corpses = [body];
    blown.player.y = 200;
    for (let i = 0; i < 200 && !body.claimed; i++) {
      blown.player.invincible = 99;
      blown.player.y = 200; blown.player.vy = 0; blown.player.grounded = -1;
      body.y = 260; body.x = 225;
      blown.ammo = blown.stats.maxAmmo;
      blown.step(1 / 120, 0, i % 12 < 6);
    }
    expect(body.claimed).toBe(true);
    // Detonated, so it can never be eaten: walking over it counts nothing.
    blown.player.x = body.x; blown.player.y = body.y;
    tick(blown, 0.2);
    expect(blown.corpsesEaten).toBe(0);
  });
});

describe('REVERSE ENGINEERING', () => {
  it('redraws a module once, and never again', () => {
    const game = run(['reverseEngineering']);
    const crate = spawnGunModule(900, 225, 300, 'machine', 'heart');
    game.pickups = [crate];
    const before = { module: crate.module, bonus: crate.bonus };
    for (let i = 0; i < 400 && !crate.rerolled; i++) {
      game.player.invincible = 99;
      game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
      crate.x = 225; crate.y = 300;
      game.ammo = game.stats.maxAmmo;
      game.step(1 / 120, 0, i % 12 < 6);
    }
    expect(crate.rerolled).toBe(true);
    // The crate survives being shot: it is redrawn, never destroyed.
    expect(game.pickups).toContain(crate);
    expect(crate.taken).toBe(false);
    const after = { module: crate.module, bonus: crate.bonus };
    // A second volley changes nothing more, whatever it drew the first time.
    for (let i = 0; i < 200; i++) {
      game.player.invincible = 99;
      game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
      crate.x = 225; crate.y = 300;
      game.ammo = game.stats.maxAmmo;
      game.step(1 / 120, 0, i % 12 < 6);
    }
    expect({ module: crate.module, bonus: crate.bonus }).toEqual(after);
    void before;
  });

  it('can change the bonus as well as the weapon', () => {
    // Across many seeds the redraw must be capable of both bonuses, or it is only rerolling a gun.
    const bonuses = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const game = run(['reverseEngineering'], seed * 17);
      const crate = spawnGunModule(900, 225, 300, 'machine', 'heart');
      game.pickups = [crate];
      for (let i = 0; i < 400 && !crate.rerolled; i++) {
        game.player.invincible = 99;
        game.player.y = 200; game.player.vy = 0; game.player.grounded = -1;
        crate.x = 225; crate.y = 300;
        game.ammo = game.stats.maxAmmo;
        game.step(1 / 120, 0, i % 12 < 6);
      }
      if (crate.rerolled) bonuses.add(crate.bonus!);
    }
    expect([...bonuses].sort()).toEqual(['charge', 'heart']);
  });
});

describe('SAFETY JETPACK', () => {
  it('hovers on an empty magazine, fires nothing, and burns fuel', () => {
    const game = run(['safetyJetpack']);
    game.ammo = 0;
    game.platforms = [];
    game.player.y = 200; game.player.vy = game.stats.maxFallSpeed; game.player.grounded = -1;
    const fuel = game.jetpackFuel;
    tick(game, 0.5, 0, true);
    expect(game.jetpackActive).toBe(true);
    expect(game.jetpackFuel).toBeLessThan(fuel);
    expect(game.bullets).toHaveLength(0);
    expect(game.ammo).toBe(0);
    expect(game.player.vy).toBeLessThanOrEqual(game.stats.maxFallSpeed * UPGRADE_TUNING.safetyJetpack.fallMultiplier + 1);
  });

  it('stops burning the moment ACTION is released, and runs out', () => {
    const game = run(['safetyJetpack']);
    game.ammo = 0; game.platforms = [];
    /**
     * Keep the shaft empty for the whole test.
     *
     * Clearing `platforms` once is no longer enough: generation lays fresh rows under a descending
     * camera, and at the run's measured speeds the player reaches one inside this window. Landing
     * refills the jetpack exactly as it refills CHARGE, so the fuel read back full and the test was
     * measuring a landing rather than the burn.
     */
    const burn = (seconds: number, firing: boolean) => {
      for (let i = 0; i < Math.round(seconds * 120); i++) {
        game.platforms = []; game.enemies = []; game.doodads = []; game.pickups = [];
        game.step(1 / 120, 0, firing);
      }
    };
    burn(0.4, true);
    const held = game.jetpackFuel;
    expect(held).toBeLessThan(UPGRADE_TUNING.safetyJetpack.fuelSeconds);
    burn(0.8, false);
    expect(game.jetpackFuel).toBe(held);
    expect(game.jetpackActive).toBe(false);
    burn(UPGRADE_TUNING.safetyJetpack.fuelSeconds + 0.5, true);
    expect(game.jetpackFuel).toBe(0);
    expect(game.jetpackActive).toBe(false);
  });

  it('refuels wherever CHARGE does, including a doodad in LIMBO', () => {
    const game = run(['safetyJetpack']);
    game.jumpToStage(4, 2);
    game.platforms = []; game.enemies = []; game.safeZones = [];
    game.ammo = 0; game.jetpackFuel = 0;
    game.player.x = 225; game.player.y = 200; game.player.vy = 300; game.player.grounded = -1;
    game.doodads = [{ id: 1, x: 225 - 22, y: 320, width: 44, height: 12, variant: 'lamp', active: true }];
    for (let i = 0; i < 200 && game.jetpackFuel === 0; i++) { game.player.invincible = 99; game.step(1 / 120, 0, false); }
    expect(game.events.some(e => e.type === 'doodad')).toBe(true);
    expect(game.jetpackFuel).toBe(UPGRADE_TUNING.safetyJetpack.fuelSeconds);
    expect(game.ammo).toBe(game.stats.maxAmmo);
  });
});

describe('TIMEOUT', () => {
  it('leaves stopped time where a hit landed, and the world runs again outside it', () => {
    const game = run(['timeout']);
    game.jumpToStage(1, 1);
    game.platforms = []; game.doodads = []; game.safeZones = []; game.enemies = [];
    game.player.x = 225; game.player.y = 300; game.player.vy = 0; game.player.grounded = -1;
    game.player.invincible = 0;
    expect(game.damage(1)).toBe(true);
    expect(game.timeoutBubbles).toHaveLength(1);
    const bubble = game.timeoutBubbles[0];
    expect([bubble.x, bubble.y]).toEqual([225, 300]);
    // Inside it, the shaft is stopped: a round out there hangs exactly where it was.
    expect(game.timeFrozen).toBe(true);
    game.bullets = [{ source: 'player', x: bubble.x + bubble.radius + 80, y: 200, previousX: bubble.x + bubble.radius + 80, previousY: 200, vx: 0, vy: 400, damage: 1, size: 4, pierce: 0, pierceBlocks: false, blocks: new Set(), range: 900, travelled: 0, beam: false, hits: new Set(), alive: true }];
    const outside = game.bullets[0];
    for (let i = 0; i < 120; i++) { game.player.invincible = 99; game.player.x = 225; game.player.y = 300; game.step(1 / 120, 0, false); }
    expect(outside.y).toBe(200);
    // Step out and it starts again. The bubble stays where it was: it never follows.
    game.player.x = bubble.x + bubble.radius + 200;
    game.step(1 / 120, 0, false);
    expect(game.timeFrozen).toBe(false);
    expect([bubble.x, bubble.y]).toEqual([225, 300]);
    for (let i = 0; i < 60; i++) { game.player.invincible = 99; game.step(1 / 120, 0, false); }
    expect(outside.y).toBeGreaterThan(200);
  });

  it('leaves one per hit, and none for a killing blow', () => {
    const game = run(['timeout']);
    game.jumpToStage(1, 1);
    game.player.invincible = 0;
    game.damage(1);
    game.player.invincible = 0;
    game.player.x = 300;
    game.damage(1);
    expect(game.timeoutBubbles).toHaveLength(2);
    game.player.invincible = 0;
    game.damage(9);
    expect(game.hp).toBe(0);
    expect(game.timeoutBubbles).toHaveLength(2);
  });

  it('is cleared when the SECTION is, so stopped time never accumulates across a run', () => {
    // PROVISIONAL / MEASUREMENT REQUIRED: whether the original carries a bubble across a level is
    // not documented, and carrying them would leave a run wading through its own history.
    const game = run(['timeout']);
    game.jumpToStage(1, 1);
    game.player.invincible = 0;
    game.damage(1);
    expect(game.timeoutBubbles.length).toBeGreaterThan(0);
    game.jumpToStage(1, 2);
    expect(game.timeoutBubbles).toHaveLength(0);
  });

  it('leaves the SAFE ZONE kind of stopped time exactly as it was', () => {
    const game = run([]);
    const zone: SafeZone = { id: 5, side: -1, x: WORLD.wall, y: 320 - SAFE_ZONE_RULES.height, width: SAFE_ZONE_RULES.width, height: SAFE_ZONE_RULES.height, content: null, taken: false };
    game.safeZones = [zone];
    game.platforms = [{ id: 6, x: zone.x, y: 320, width: zone.width, breakable: false, state: 'stable', safeZone: zone.id }];
    game.player.x = zone.x + 70; game.player.y = 300;
    game.step(1 / 120, 0, false);
    expect(game.timeFrozen).toBe(true);
    game.player.x = 400;
    game.step(1 / 120, 0, false);
    expect(game.timeFrozen).toBe(false);
  });
});

describe('entities do not accumulate over a long run', () => {
  it('prunes corpses, casings, popping rounds and blasts', () => {
    const game = run(['hotCasing', 'poppingGems', 'knifeAndFork', 'restInPieces'], 61);
    for (let i = 0; i < 40; i++) game.corpses.push(spawnCorpse(i + 1, 40 + i, -4000));
    game.ammo = game.stats.maxAmmo;
    tick(game, 20, 0, true);
    // Everything that left the camera band or ran out of life is gone.
    expect(game.corpses.length).toBeLessThan(40);
    expect(game.bullets.length).toBeLessThan(200);
  });
});
