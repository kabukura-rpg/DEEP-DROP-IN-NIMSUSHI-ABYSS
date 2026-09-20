import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { WORLD } from '../src/data/balance';
import { DOODAD_RULES, spawnDoodad, type Doodad } from '../src/data/doodads';
import { SAFE_ZONE_RULES, coinVeinTotal, insideSafeZone, rollSafeZoneContent, type SafeZone, type SafeZoneContentKind } from '../src/data/safeZone';
import { COMBO_TIERS } from '../src/data/combo';
import { StageGenerator, type Platform, type RoutePlatform } from '../src/systems/StageGenerator';
import { areaConfig, type AreaId, type SectionId } from '../src/data/areas';
import { spawnEnemy } from '../src/data/enemies';
import { spawnGunModule } from '../src/data/pickups';
import { OXYGEN_RULES } from '../src/systems/OxygenSystem';

/**
 * Phase 2B: scenery you can reload from, chambers cut into the shaft, and the stopped time inside
 * one. The line this file exists to hold is that filling CHARGE and banking a chain are two
 * different events -- a doodad and a chamber floor do the first without the second.
 */

const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const tick = (game: GameModel, seconds: number, direction = 0, action = false) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) game.step(1 / 120, direction, action);
};
/** A model with an empty shaft, the player in open air. */
function bare(practice = true) {
  const game = new GameModel(practice);
  game.platforms = []; game.enemies = []; game.pickups = []; game.hazards = [];
  game.doodads = []; game.safeZones = [];
  game.player.x = 225; game.player.y = 180; game.player.vy = 0; game.player.grounded = -1;
  game.events.length = 0;
  return game;
}
/** One doodad directly under the player. */
function withDoodad(game: GameModel, dy = 60) {
  const doodad = spawnDoodad(900, game.player.x - DOODAD_RULES.width / 2, game.player.y + dy, 'lamp');
  game.doodads = [doodad];
  return doodad;
}
/** A chamber with its floor, cut into the left wall under the player. */
function withChamber(game: GameModel, content: SafeZoneContentKind | null = null, floorY = 320): { zone: SafeZone; floor: Platform } {
  const width = SAFE_ZONE_RULES.width, height = SAFE_ZONE_RULES.height;
  const zone: SafeZone = {
    id: 500, side: -1, x: WORLD.wall, y: floorY - height, width, height,
    content: content ? { kind: content, module: 'laser', bonus: 'charge' } : null, taken: false,
  };
  const floor: Platform = {
    id: 501, x: zone.x, y: floorY, width, breakable: false, state: 'stable', safeZone: zone.id,
  };
  game.safeZones = [zone];
  game.platforms = [floor];
  game.player.x = zone.x + width / 2;
  return { zone, floor };
}

describe('DOODAD: scenery that reloads without banking a chain', () => {
  it('fills CHARGE, bounces, and leaves the chain exactly where it was', () => {
    const game = bare();
    game.ammo = 1; game.combo = 7;
    const doodad = withDoodad(game);
    game.player.vy = 300;
    // Stop on the frame it fires, so the bounce is measured rather than what gravity did next.
    let bounced = false;
    for (let i = 0; i < 60 && !bounced; i++) { game.step(1 / 120, 0, false); bounced = game.events.some(e => e.type === 'doodad'); }
    expect(bounced).toBe(true);
    expect(game.ammo).toBe(game.stats.maxAmmo);
    expect(game.combo).toBe(7);
    expect(game.player.vy).toBeLessThan(0);
    expect(game.player.grounded).toBe(-1);
    expect(game.events.some(e => e.type === 'doodad')).toBe(true);
    // Scenery, not a kill: nothing about it is an enemy defeat.
    expect(game.kills).toBe(0);
    expect(game.coins.walletCoins + game.coins.coins.length).toBe(0);
    expect(game.events.some(e => e.type === 'kill')).toBe(false);
    expect(game.events.some(e => e.type === 'comboSettle')).toBe(false);
    expect(game.hp).toBe(4);
    expect(doodad.active).toBe(true);
  });
  it('bounces at its own configured impulse, marked as unmeasured', () => {
    const game = bare();
    withDoodad(game);
    game.player.vy = 300;
    for (let i = 0; i < 60 && game.player.vy > 0; i++) game.step(1 / 120, 0, false);
    expect(game.player.vy).toBeCloseTo(-DOODAD_RULES.bounce, 6);
  });
  it('ignores a sideways brush and a hit from underneath', () => {
    // Beside it: same height, no vertical crossing.
    const sideways = bare();
    const doodad = spawnDoodad(1, 260, sideways.player.y, 'bracket');
    sideways.doodads = [doodad];
    sideways.ammo = 2;
    tick(sideways, 0.3, 1);
    expect(sideways.events.some(e => e.type === 'doodad')).toBe(false);
    expect(sideways.ammo).toBe(2);
    // From below: rising into it.
    const below = bare();
    below.doodads = [spawnDoodad(2, below.player.x - DOODAD_RULES.width / 2, below.player.y - 40, 'bracket')];
    below.ammo = 2;
    below.player.vy = -300;
    tick(below, 0.2);
    expect(below.events.some(e => e.type === 'doodad')).toBe(false);
    expect(below.ammo).toBe(2);
  });
  it('fires once per contact, not once per frame', () => {
    const game = bare();
    const doodad = withDoodad(game, 40);
    // Held exactly where a bounce leaves the player, still nudged downward: without the guard this
    // is a crossing every single frame, and the doodad would reload for free forever.
    let bounces = 0;
    for (let i = 0; i < 240; i++) {
      game.player.y = doodad.y - 15; game.player.vy = 1;
      game.step(1 / 120, 0, false);
      bounces += game.events.filter(e => e.type === 'doodad').length;
      game.events.length = 0;
    }
    expect(bounces).toBe(1);
  });
  it('can be used again after leaving it and coming back', () => {
    const game = bare();
    const doodad = withDoodad(game);
    game.player.vy = 300;
    tick(game, 0.4);
    expect(game.events.filter(e => e.type === 'doodad')).toHaveLength(1);
    // Away, then back onto the same one: it is scenery, so it is still there.
    game.events.length = 0;
    game.player.y = doodad.y - 90; game.player.vy = 0;
    tick(game, 0.1);
    game.ammo = 1;
    game.player.vy = 300;
    tick(game, 0.4);
    expect(game.events.filter(e => e.type === 'doodad')).toHaveLength(1);
    expect(game.ammo).toBe(game.stats.maxAmmo);
  });
});

describe('SAFE ZONE: a floor that shelters rather than banks', () => {
  it('fills CHARGE and keeps the chain, where ordinary ground would settle it', () => {
    const chamber = bare();
    chamber.combo = 17; chamber.ammo = 2;
    const { floor } = withChamber(chamber);
    chamber.player.y = floor.y - 90; chamber.player.vy = 240;
    const coins = chamber.coins.walletCoins;
    tick(chamber, 0.8);
    expect(chamber.player.grounded).toBe(floor.id);
    expect(chamber.ammo).toBe(chamber.stats.maxAmmo);
    expect(chamber.combo).toBe(17);
    expect(chamber.events.some(e => e.type === 'comboSettle')).toBe(false);
    expect(chamber.coins.walletCoins).toBe(coins);

    // The same chain, the same fall, onto ordinary ground: settled, and paid.
    const ordinary = bare();
    ordinary.combo = 17; ordinary.ammo = 2;
    ordinary.platforms = [{ id: 601, x: 120, y: 320, width: 200, breakable: false, state: 'stable' }];
    ordinary.player.x = 220; ordinary.player.y = 230; ordinary.player.vy = 240;
    tick(ordinary, 0.8);
    expect(ordinary.player.grounded).toBe(601);
    expect(ordinary.ammo).toBe(ordinary.stats.maxAmmo);
    expect(ordinary.combo).toBe(0);
    const settled = ordinary.events.find(e => e.type === 'comboSettle');
    expect(settled?.value).toBe(17);
    expect(ordinary.coins.walletCoins + ordinary.coins.coins.length).toBe(COMBO_TIERS[1].coins);
  });
  it('keeps the chain on the way out as well as on the way in', () => {
    const game = bare();
    game.combo = 12;
    const { zone, floor } = withChamber(game);
    game.player.y = floor.y - 90; game.player.vy = 240;
    tick(game, 0.8);
    expect(game.timeFrozen).toBe(true);
    // Walk out of the chamber entirely.
    for (let i = 0; i < 400 && game.timeFrozen; i++) game.step(1 / 120, 1, false);
    expect(game.timeFrozen).toBe(false);
    expect(insideSafeZone(zone, game.player.x, game.player.y)).toBe(false);
    expect(game.combo).toBe(12);
  });
  it('has a roof: the gunboots cannot fire the player out through the top', () => {
    const game = bare();
    const { zone, floor } = withChamber(game);
    game.gun.equip('laser');                       // the strongest kick in the game
    game.stats.maxAmmo = 40; game.ammo = 40;
    game.player.y = floor.y - 15; game.player.vy = 0; game.player.grounded = floor.id;
    expect(game.timeFrozen).toBe(true);
    let highest = game.player.y;
    for (let i = 0; i < 240; i++) {
      game.ammo = 40;
      game.step(1 / 120, 0, i % 8 < 4);
      highest = Math.min(highest, game.player.y);
    }
    expect(highest).toBeGreaterThanOrEqual(zone.y);
    expect(game.timeFrozen).toBe(true);
  });
  it('still lets the player fall in through the opening from above', () => {
    const game = bare();
    const { zone, floor } = withChamber(game);
    game.player.x = zone.x + zone.width / 2;
    game.player.y = zone.y - 80; game.player.vy = 240; game.player.grounded = -1;
    expect(game.timeFrozen).toBe(false);
    tick(game, 1);
    expect(game.player.grounded).toBe(floor.id);
    expect(game.timeFrozen).toBe(true);
  });
  it('grants nothing by itself: no charge growth, no healing', () => {
    const game = bare();
    game.damage(1, 'enemy');
    const before = { maxAmmo: game.stats.maxAmmo, hp: game.hp, maxHp: game.health.maxHp };
    const { floor } = withChamber(game);
    game.player.y = floor.y - 90; game.player.vy = 240;
    tick(game, 1.5);
    expect({ maxAmmo: game.stats.maxAmmo, hp: game.hp, maxHp: game.health.maxHp }).toEqual(before);
  });
});

describe('TIMEVOID: the world outside a chamber stops', () => {
  /** A shaft with something moving in it, plus a chamber to step into. */
  function shaft() {
    const game = new GameModel(false, seeded(7));
    game.jumpToStage(2, 1);
    game.platforms = []; game.pickups = []; game.hazards = []; game.containers = []; game.bubbles = [];
    game.enemies = [spawnEnemy('fish', 77, 300, 400, 40, 0, 'open')];
    game.bullets = [];
    game.doodads = []; game.safeZones = [];
    const { zone, floor } = withChamber(game, null, 320);
    game.player.x = zone.x + zone.width / 2;
    game.player.y = floor.y - 15; game.player.vy = 0; game.player.grounded = floor.id;
    game.player.invincible = 99;
    return { game, zone, floor };
  }
  it('runs outside while the player is out in the shaft', () => {
    const { game, floor } = shaft();
    game.player.x = 300; game.player.y = 200; game.player.grounded = -1;
    expect(game.timeFrozen).toBe(false);
    const enemy = game.enemies[0];
    const before = { x: enemy.x, oxygen: game.oxygen.remaining };
    game.bullets.push({ x: 300, y: 250, previousX: 300, previousY: 250, vx: 0, vy: 400, damage: 1, size: 4, pierce: 0, pierceBlocks: false, blocks: new Set(), range: 900, travelled: 0, beam: false, hits: new Set(), alive: true });
    const bullet = game.bullets[0];
    const bulletY = bullet.y;
    tick(game, 0.5);
    expect(enemy.x).not.toBeCloseTo(before.x, 3);
    expect(bullet.y).toBeGreaterThan(bulletY);
    expect(game.oxygen.remaining).toBeLessThan(before.oxygen);
    expect(floor.id).toBeGreaterThan(0);
  });
  it('stops enemies, rounds, the tank and the descent while the player is inside', () => {
    const { game } = shaft();
    expect(game.timeFrozen).toBe(true);
    const enemy = game.enemies[0];
    game.bullets.push({ x: 300, y: 250, previousX: 300, previousY: 250, vx: 0, vy: 400, damage: 1, size: 4, pierce: 0, pierceBlocks: false, blocks: new Set(), range: 900, travelled: 0, beam: false, hits: new Set(), alive: true });
    const bullet = game.bullets[0];
    const before = { ex: enemy.x, by: bullet.y, oxygen: game.oxygen.remaining, depth: game.sectionDepth, camera: game.cameraY };
    tick(game, 2);
    expect(enemy.x).toBe(before.ex);
    expect(bullet.y).toBe(before.by);
    expect(game.oxygen.remaining).toBe(before.oxygen);
    expect(game.sectionDepth).toBe(before.depth);
    expect(game.cameraY).toBe(before.camera);
    // And it is a freeze, not a pause: the run is still live.
    expect(game.running).toBe(true);
    expect(game.paused).toBe(false);
  });
  it('lets the player move, jump and shoot inside', () => {
    const { game, zone, floor } = shaft();
    const startX = game.player.x;
    tick(game, 0.3, 1);
    expect(game.player.x).toBeGreaterThan(startX);
    expect(game.timeFrozen).toBe(true);
    // ACTION on the chamber floor is still a jump, and never a shot.
    game.player.x = zone.x + zone.width / 2;
    game.player.y = floor.y - 15; game.player.vy = 0; game.player.grounded = floor.id;
    game.events.length = 0;
    game.step(1 / 120, 0, true);
    expect(game.events.some(e => e.type === 'jump')).toBe(true);
    expect(game.events.some(e => e.type === 'shot')).toBe(false);
    // Airborne inside, ACTION fires and CHARGE is spent.
    game.player.grounded = -1; game.player.vy = 0;
    game.ammo = game.stats.maxAmmo;
    game.events.length = 0;
    game.step(1 / 120, 0, false);
    game.step(1 / 120, 0, true);
    expect(game.events.some(e => e.type === 'shot')).toBe(true);
    expect(game.ammo).toBeLessThan(game.stats.maxAmmo);
  });
  it('restarts the world the moment the player steps out', () => {
    const { game } = shaft();
    const enemy = game.enemies[0];
    tick(game, 1);
    const held = enemy.x;
    for (let i = 0; i < 600 && game.timeFrozen; i++) game.step(1 / 120, 1, false);
    expect(game.timeFrozen).toBe(false);
    const oxygen = game.oxygen.remaining;
    tick(game, 0.5, 0);
    expect(enemy.x).not.toBeCloseTo(held, 3);
    expect(game.oxygen.remaining).toBeLessThan(oxygen);
  });
  it('resumes the world where it left off rather than jumping it forward', () => {
    const { game } = shaft();
    const enemy = game.enemies[0];
    game.player.x = 300; game.player.y = 200; game.player.grounded = -1;
    tick(game, 0.25);
    const control = enemy.x;
    // Back inside for a long stay, then out again and the same quarter second.
    const { game: other } = shaft();
    const twin = other.enemies[0];
    tick(other, 4);                                    // frozen the whole time
    for (let i = 0; i < 600 && other.timeFrozen; i++) other.step(1 / 120, 1, false);
    other.player.x = 300; other.player.y = 200; other.player.grounded = -1;
    other.enemies = [twin];
    tick(other, 0.25);
    expect(twin.x).toBeCloseTo(control, 0);
  });
  it('holds an AREA 4 collapse timer, and a heat gauge, still', () => {
    const collapse = new GameModel(false, seeded(11));
    collapse.jumpToStage(4, 2);
    collapse.platforms = []; collapse.enemies = []; collapse.hazards = []; collapse.doodads = []; collapse.safeZones = [];
    const { floor } = withChamber(collapse, null, 320);
    const ledge: Platform = { id: 700, x: 250, y: 320, width: 120, breakable: true, state: 'stable' };
    collapse.platforms.push(ledge);
    // Land on the collapsing ledge first so its timer is running, then step into the chamber.
    collapse.player.x = 310; collapse.player.y = 230; collapse.player.vy = 240; collapse.player.invincible = 99;
    tick(collapse, 0.8);
    expect(collapse.collapse.counting).toBe(1);
    collapse.player.x = collapse.safeZones[0].x + 40;
    collapse.player.y = floor.y - 15; collapse.player.vy = 0; collapse.player.grounded = floor.id;
    expect(collapse.timeFrozen).toBe(true);
    tick(collapse, 4);
    expect(collapse.collapse.counting).toBe(1);
    expect(ledge.state).not.toBe('broken');

    const heat = new GameModel(false, seeded(13));
    heat.jumpToStage(3, 2);
    heat.platforms = []; heat.enemies = []; heat.doodads = []; heat.safeZones = [];
    heat.hazards = [];
    const inZone = withChamber(heat, null, 320);
    heat.player.x = heat.safeZones[0].x + 40;
    heat.player.y = inZone.floor.y - 15; heat.player.vy = 0; heat.player.grounded = inZone.floor.id;
    heat.heat.value = 40;
    expect(heat.timeFrozen).toBe(true);
    tick(heat, 3);
    expect(heat.heat.value).toBe(40);
  });
  it('does not turn a chamber into an air pocket: the tank neither drains nor refills', () => {
    const { game } = shaft();
    game.oxygen.remaining = OXYGEN_RULES.max - 5;
    const held = game.oxygen.remaining;
    tick(game, 3);
    expect(game.oxygen.remaining).toBe(held);
    for (let i = 0; i < 600 && game.timeFrozen; i++) game.step(1 / 120, 1, false);
    tick(game, 0.5);
    expect(game.oxygen.remaining).toBeLessThan(held);
  });
});

describe('SAFE ZONE mouth: entry is crossing the opening, not landing on the floor', () => {
  /** A chamber low enough that the approach is a real fall, and the player out in the shaft beside it. */
  function approach(gap = 40, fallSpeed = 0) {
    const game = bare();
    const { zone, floor } = withChamber(game, null, 520);
    // Right of the mouth plane, above the chamber, falling: the ordinary way a player arrives.
    game.player.x = zone.x + zone.width + gap;
    game.player.y = 200; game.player.vy = fallSpeed; game.player.grounded = -1;
    game.events.length = 0;
    return { game, zone, floor };
  }
  /** Steer toward the mouth until time stops, reporting what the player was doing at that moment. */
  function crossInward(game: GameModel, seconds = 4) {
    for (let i = 0; i < Math.round(seconds * 120); i++) {
      game.step(1 / 120, -1, false);
      // The announced state, not the raw getter: this is the frame the rest of the game is told
      // time has stopped, so measuring it proves the cue lands before the floor does.
      if (game.events.some(e => e.type === 'timeVoid' && e.value === 1)) {
        return { crossed: true, grounded: game.player.grounded, y: game.player.y, landed: game.events.some(e => e.type === 'land') };
      }
      if (game.events.some(e => e.type === 'land')) {
        return { crossed: false, grounded: game.player.grounded, y: game.player.y, landed: true };
      }
    }
    return { crossed: false, grounded: game.player.grounded, y: game.player.y, landed: false };
  }

  it('turns TIMEVOID on the moment the mouth is crossed, in mid-air, before any landing', () => {
    const { game, floor } = approach();
    const entry = crossInward(game);
    expect(entry.crossed).toBe(true);
    expect(game.timeFrozen).toBe(true);
    // The whole point: still falling, nothing underfoot, and the floor never touched.
    expect(entry.grounded).toBe(-1);
    expect(entry.landed).toBe(false);
    expect(entry.y).toBeLessThan(floor.y);
    expect(game.events.some(e => e.type === 'timeVoid' && e.value === 1)).toBe(true);
  });
  it('crosses before landing however far out and however fast the player is falling', () => {
    // Every approach a player can actually make, from a standing step to terminal velocity.
    for (const gap of [10, 20, 40, 80]) {
      for (const fall of [0, 260, 520]) {
        const { game } = approach(gap, fall);
        const entry = crossInward(game);
        expect([gap, fall, entry.crossed, entry.landed]).toEqual([gap, fall, true, false]);
        expect(entry.grounded).toBe(-1);
      }
    }
  });
  it('banks nothing on the way in: the chain and CHARGE are untouched until the floor', () => {
    const { game, floor } = approach();
    game.ammo = 3; game.combo = 13;
    const entry = crossInward(game);
    expect(entry.crossed).toBe(true);
    // Crossing the mouth is not a landing, so neither of the two landing effects has fired.
    expect(game.ammo).toBe(3);
    expect(game.combo).toBe(13);
    expect(game.events.some(e => e.type === 'comboSettle')).toBe(false);
    // Then the floor itself reloads without banking, exactly as before.
    tick(game, 2, -1);
    expect(game.player.grounded).toBe(floor.id);
    expect(game.ammo).toBe(game.stats.maxAmmo);
    expect(game.combo).toBe(13);
    expect(game.events.some(e => e.type === 'comboSettle')).toBe(false);
  });
  it('lets the player walk back out sideways, which starts the world again', () => {
    const { game, zone, floor } = approach();
    tick(game, 3, -1);
    expect(game.timeFrozen).toBe(true);
    expect(game.player.grounded).toBe(floor.id);
    // Left and right alone are enough to leave -- no jump, which is what makes it work on a phone.
    let left = false;
    for (let i = 0; i < 480 && !left; i++) { game.step(1 / 120, 1, false); left = !game.timeFrozen; }
    expect(left).toBe(true);
    // The mouth plane itself is already outside, so leaving registers on the very pixel.
    expect(game.player.x).toBeGreaterThanOrEqual(zone.x + zone.width);
    expect(game.events.some(e => e.type === 'timeVoid' && e.value === 0)).toBe(true);
  });
  it('is a plain rectangle test, so it never asks how the player got there', () => {
    const { zone } = approach();
    const mouth = zone.x + zone.width;
    // A point level with the middle of the chamber, a hair either side of the opening.
    const midY = zone.y + zone.height / 2;
    expect(insideSafeZone(zone, mouth - 1, midY)).toBe(true);
    expect(insideSafeZone(zone, mouth + 1, midY)).toBe(false);
    // Well above the floor, and moving upward through it: still inside.
    expect(insideSafeZone(zone, mouth - 20, zone.y + 10)).toBe(true);
  });
});

describe('TIMEVOID: rounds stop on the shaft side of the mouth only', () => {
  /** The player airborne inside a chamber, able to fire, with a round already hanging out in the shaft. */
  function inChamber() {
    const game = bare();
    const { zone, floor } = withChamber(game, null, 320);
    game.player.x = zone.x + zone.width / 2;
    // High under the chamber roof: the gunboots fire downward, so this is the headroom a round
    // needs to travel a measurable distance before it reaches the floor and the shaft beyond it.
    game.player.y = floor.y - 92; game.player.vy = 0; game.player.grounded = -1;
    game.ammo = game.stats.maxAmmo;
    game.enemies = []; game.containers = [];
    game.events.length = 0;
    expect(game.timeFrozen).toBe(true);
    return { game, zone, floor };
  }
  const round = (x: number, y: number, vy: number) => ({
    x, y, previousX: x, previousY: y, vx: 0, vy, damage: 1, size: 4, pierce: 0,
    pierceBlocks: false, blocks: new Set<number>(), range: 900, travelled: 0, beam: false,
    hits: new Set<number>(), alive: true,
  });

  it('holds a player round left out in the shaft', () => {
    const { game } = inChamber();
    game.bullets = [round(300, 200, 400)];
    const shot = game.bullets[0];
    tick(game, 1.5);
    expect(shot.y).toBe(200);
    expect(shot.travelled).toBe(0);
  });
  it('holds a round travelling upward through the shaft, whoever fired it', () => {
    // Enemies deal contact damage today, so nothing of theirs is in flight yet. The rule is decided
    // by where a round is rather than who fired it, so it already covers one when it arrives.
    const { game } = inChamber();
    game.bullets = [round(300, 500, -520)];
    const incoming = game.bullets[0];
    tick(game, 1.5);
    expect(incoming.y).toBe(500);
  });
  it('flies a round fired inside the chamber', () => {
    const { game, zone } = inChamber();
    game.step(1 / 120, 0, true);
    expect(game.bullets.length).toBeGreaterThan(0);
    const fired = game.bullets[0];
    expect(insideSafeZone(zone, fired.x, fired.y)).toBe(true);
    const start = fired.y;
    tick(game, 0.05);
    // The gunboots point down, so "moving" here means further down the chamber.
    expect(fired.y).toBeGreaterThan(start);
    expect(fired.travelled).toBeGreaterThan(0);
  });
  it('lets a round fired inside still hit something', () => {
    const { game, zone, floor } = inChamber();
    game.enemies = [spawnEnemy('slime', 91, game.player.x, floor.y - 30, 40, 0, 'open')];
    const target = game.enemies[0];
    expect(insideSafeZone(zone, target.x, target.y)).toBe(true);
    game.step(1 / 120, 0, true);
    tick(game, 0.4);
    expect(target.alive).toBe(false);
  });
  it('stops a round fired inside once it leaves the chamber', () => {
    const { game, zone } = inChamber();
    game.step(1 / 120, 0, true);
    const fired = game.bullets[0];
    tick(game, 1.5);
    // It ran out past the chamber and met the stopped world waiting on the other side.
    expect(insideSafeZone(zone, fired.x, fired.y)).toBe(false);
    const parked = fired.y;
    tick(game, 1);
    expect(fired.y).toBe(parked);
  });
  it('starts the shaft rounds again the moment the player steps out', () => {
    const { game } = inChamber();
    game.bullets = [round(300, 200, 400)];
    const shot = game.bullets[0];
    tick(game, 1);
    expect(shot.y).toBe(200);
    for (let i = 0; i < 600 && game.timeFrozen; i++) game.step(1 / 120, 1, false);
    expect(game.timeFrozen).toBe(false);
    tick(game, 0.2);
    expect(shot.y).toBeGreaterThan(200);
  });
});

describe('SAFE ZONE content reaches the existing systems', () => {
  it('hands over a gun module, keeping the chain', () => {
    const game = bare(false);
    game.jumpToStage(1, 1);
    game.platforms = []; game.enemies = []; game.pickups = []; game.hazards = []; game.doodads = []; game.safeZones = [];
    game.combo = 9;
    const { zone, floor } = withChamber(game, 'gunModule');
    const centre = Math.round(zone.x + zone.width / 2);
    // Materialised exactly as GameModel does it when a chunk carrying a chamber arrives.
    game.pickups = [spawnGunModule(zone.id + 1, centre, floor.y - 34, 'laser', 'charge')];
    const maxAmmo = game.stats.maxAmmo;
    game.player.x = centre; game.player.y = floor.y - 34; game.player.vy = 0;
    tick(game, 0.2);
    expect(game.gun.id).toBe('laser');
    expect(game.stats.maxAmmo).toBeGreaterThan(maxAmmo);
    expect(game.combo).toBe(9);
  });
  it('opens the shop from inside, keeping the chain', () => {
    const game = bare(false);
    game.jumpToStage(1, 1);
    game.platforms = []; game.enemies = []; game.pickups = []; game.hazards = []; game.doodads = []; game.safeZones = [];
    game.combo = 14;
    const { zone, floor } = withChamber(game, 'shop');
    // Stocked by the SECTION already; the chamber is what opens a door onto it.
    expect(game.shop.offers.length).toBeGreaterThan(0);
    expect(game.shop.available).toBe(false);
    const centre = Math.round(zone.x + zone.width / 2);
    game.shop.placeEntrance(centre - 33, floor.y - 66, 66, 66);
    expect(game.shop.available).toBe(true);
    game.player.x = centre; game.player.y = floor.y - 33; game.player.vy = 0;
    tick(game, 0.2);
    expect(game.state).toBe('shop');
    expect(game.shop.open).toBe(true);
    expect(game.combo).toBe(14);
    game.closeShop();
    expect(game.combo).toBe(14);
  });
  /** Stand above the vein, airborne, and shoot down into it -- the gunboots point down. */
  function mine(game: GameModel, zone: SafeZone) {
    const vein = game.coinVeinBounds(zone);
    game.player.x = vein.x + vein.width / 2;
    game.player.y = vein.y - 40; game.player.vy = 0; game.player.grounded = -1;
    game.ammo = game.stats.maxAmmo;
    for (let i = 0; i < 240 && !zone.taken; i++) {
      game.player.y = vein.y - 40; game.player.vy = 0; game.player.grounded = -1;
      game.step(1 / 120, 0, true);
    }
    return vein;
  }
  it('is opened by shooting it, not by walking into it', () => {
    const game = bare();
    const { zone } = withChamber(game, 'coinVein');
    const vein = game.coinVeinBounds(zone);
    // Standing right inside the vein's face does nothing at all.
    game.player.x = vein.x + vein.width / 2;
    game.player.y = vein.y + vein.height / 2; game.player.vy = 0;
    tick(game, 1.5);
    expect(zone.taken).toBe(false);
    expect(game.coins.coins).toHaveLength(0);
    // A round does.
    mine(game, zone);
    expect(zone.taken).toBe(true);
  });
  it('spills its whole value as real coins of both sizes, once, and never as a kill', () => {
    const game = bare();
    game.combo = 6;
    const { zone, floor } = withChamber(game, 'coinVein');
    mine(game, zone);
    expect(zone.taken).toBe(true);
    const payout = SAFE_ZONE_RULES.coinVein.payout;
    // Money on the FLOOR, not in the wallet: it has to be swept up like anything else.
    const loose = game.coins.coins;
    expect(loose.length).toBe(payout.large + payout.small);
    expect(loose.filter(c => c.denomination === 'large').length).toBe(payout.large);
    expect(loose.filter(c => c.denomination === 'small').length).toBe(payout.small);
    const onFloor = loose.reduce((sum, c) => sum + c.value, 0);
    expect(onFloor + game.coins.scoreCoins).toBe(SAFE_ZONE_RULES.coinVein.value);
    expect(coinVeinTotal()).toBe(SAFE_ZONE_RULES.coinVein.value);
    expect(game.combo).toBe(6);
    expect(game.kills).toBe(0);
    expect(game.events.some(e => e.type === 'kill')).toBe(false);
    // Mining it again pays nothing more.
    const banked = game.coins.scoreCoins + game.coins.coins.reduce((sum, c) => sum + c.value, 0);
    mine(game, zone);
    expect(game.coins.scoreCoins + game.coins.coins.reduce((sum, c) => sum + c.value, 0)).toBe(banked);
    expect(floor.id).toBeGreaterThan(0);
  });
  it('picks its one content from a weighted table in data', () => {
    const counts: Record<string, number> = { gunModule: 0, shop: 0, coinVein: 0 };
    const random = seeded(99);
    for (let i = 0; i < 3000; i++) counts[rollSafeZoneContent(random)]++;
    for (const kind of Object.keys(SAFE_ZONE_RULES.contentWeights) as SafeZoneContentKind[]) {
      expect({ kind, seen: counts[kind] > 0 }).toEqual({ kind, seen: true });
    }
    // The table's own shape, not a number somebody liked: gunModule and coinVein share a weight.
    expect(counts.gunModule / counts.coinVein).toBeGreaterThan(0.8);
    expect(counts.gunModule / counts.coinVein).toBeLessThan(1.25);
  });
});

describe('SAFE ZONE generation stays out of everything else', () => {
  const build = (area: AreaId, section: SectionId, seed: number) => {
    const config = areaConfig(area);
    const pixels = config.sectionLength * WORLD.pixelsPerMeter;
    const chunks = Math.ceil((WORLD.startY + pixels) / WORLD.chunkHeight) + 1;
    const generator = new StageGenerator(seeded(seed), {
      plan: config.plans![section - 1], enemyPool: config.enemyPool, water: config.water,
      oxygen: config.gimmicks?.oxygen === true, heat: config.gimmicks?.heat === true,
      breakable: config.gimmicks?.breakablePlatforms === true, sectionLength: config.sectionLength,
    });
    const platforms: RoutePlatform[] = [], hazards = [], zones: SafeZone[] = [], doodads: Doodad[] = [];
    const containers = [] as { x: number; y: number; width: number; height: number }[];
    for (let c = 0; c < chunks; c++) {
      const chunk = generator.chunk(c);
      platforms.push(...chunk.platforms); hazards.push(...chunk.hazards);
      zones.push(...chunk.safeZones); doodads.push(...chunk.doodads);
      containers.push(...chunk.containers);
    }
    const limit = WORLD.startY + pixels;
    return { limit, length: config.sectionLength, platforms, hazards, zones, doodads, containers };
  };

  it('cuts the planned number of chambers, inside the shaft and clear of the ends', () => {
    for (const section of [1, 2, 3] as SectionId[]) {
      const want = areaConfig(1).plans![section - 1].safeZoneCount ?? 0;
      expect(want).toBeGreaterThan(0);
      let seen = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const shaft = build(1, section, seed * 613);
        seen += shaft.zones.length;
        expect(shaft.zones.length).toBeLessThanOrEqual(want);
        for (const zone of shaft.zones) {
          // Cut into a wall, never floating mid-shaft.
          const againstWall = zone.x === WORLD.wall || zone.x + zone.width === WORLD.width - WORLD.wall;
          expect({ seed, againstWall }).toEqual({ seed, againstWall: true });
          expect(zone.x).toBeGreaterThanOrEqual(WORLD.wall);
          expect(zone.x + zone.width).toBeLessThanOrEqual(WORLD.width - WORLD.wall);
          const depth = (zone.y - WORLD.startY) / WORLD.pixelsPerMeter;
          expect(depth).toBeGreaterThan(SAFE_ZONE_RULES.depthMargin * 0.5);
          expect(depth).toBeLessThan(shaft.length - SAFE_ZONE_RULES.depthMargin * 0.5);
        }
      }
      // Skipping when the mouth would be unfair is allowed; never cutting one at all is not.
      expect(seen).toBeGreaterThan(20);
    }
  });
  it('never puts a chamber mouth on SPIKE, a BREAK BLOCK, an air container or a ledge', () => {
    for (const section of [1, 2, 3] as SectionId[]) {
      for (let seed = 1; seed <= 40; seed++) {
        const shaft = build(1, section, seed * 271);
        for (const zone of shaft.zones) {
          const box = { x: zone.x, y: zone.y, w: zone.width, h: zone.height + SAFE_ZONE_RULES.floorHeight };
          const clashes = (ox: number, ow: number, oy: number, oh: number) =>
            ox < box.x + box.w && ox + ow > box.x && oy < box.y + box.h && oy + oh > box.y;
          for (const h of shaft.hazards) expect({ seed, spike: clashes(h.x, h.width, h.y, h.height) }).toEqual({ seed, spike: false });
          for (const c of shaft.containers) expect({ seed, air: clashes(c.x, c.width, c.y, c.height) }).toEqual({ seed, air: false });
          for (const f of shaft.platforms) {
            if (f.safeZone === zone.id) continue;                 // its own floor is meant to be there
            expect({ seed, id: f.id, ledge: clashes(f.x, f.width, f.y - 4, 20) }).toEqual({ seed, id: f.id, ledge: false });
          }
        }
      }
    }
  });
  it('gives every chamber its own floor, and content that fits inside it', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const shaft = build(1, 2, seed * 907);
      for (const zone of shaft.zones) {
        const floor = shaft.platforms.find(f => f.safeZone === zone.id);
        expect(floor).toBeDefined();
        expect(floor!.x).toBe(zone.x);
        expect(floor!.width).toBe(zone.width);
        expect(floor!.y).toBe(zone.y + zone.height);
        expect(zone.content).not.toBeNull();
        if (zone.content!.kind === 'gunModule') expect(zone.content!.module).toBeDefined();
      }
    }
  });
  it('keeps doodads out of the fall corridor and out of anything lethal', () => {
    let total = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const shaft = build(1, 3, seed * 331);
      total += shaft.doodads.length;
      for (const d of shaft.doodads) {
        expect(d.x).toBeGreaterThanOrEqual(WORLD.wall);
        expect(d.x + d.width).toBeLessThanOrEqual(WORLD.width - WORLD.wall);
        for (const h of shaft.hazards) {
          const clash = d.x < h.x + h.width && d.x + d.width > h.x && d.y < h.y + h.height && d.y + d.height > h.y;
          expect({ seed, clash }).toEqual({ seed, clash: false });
        }
      }
    }
    expect(total).toBeGreaterThan(20);
  });
  it('leaves AREA 2, 3 and 4 alone this phase', () => {
    for (const area of [2, 3, 4] as AreaId[]) for (const section of [1, 2, 3] as SectionId[]) {
      const plan = areaConfig(area).plans![section - 1];
      expect({ area, section, zones: plan.safeZoneCount ?? 0 }).toEqual({ area, section, zones: 0 });
      expect({ area, section, doodads: plan.doodadChance ?? 0 }).toEqual({ area, section, doodads: 0 });
    }
  });
});
