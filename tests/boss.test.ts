import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { ABYSS, ABYSS_PHASES, abyssPhaseAt, TOMATO } from '../src/data/abyss';
import {
  FINAL_RAGE_RATIO, FULL_SCREEN_TAPIOCA, NIMUSHI, NIMUSHI_ATTACKS, STRAW_BEAM, TAPIOCA_CUP, TAPIOCA_SHOWER,
} from '../src/data/nimushi';
import { PLANNED_TOTAL_DEPTH } from '../src/data/areas';
import { GUN_MODULE_IDS } from '../src/data/gunModules';
import { SHOP_ITEMS, shopPrice, ABYSS_SHOP_AREA } from '../src/data/shop';
import { UPGRADE_TUNING } from '../src/data/upgrades';
import { atNimushi, defeatNimushi, fighting, intoTheAbyss, laneOf, pin, round, seeded, shootBody, shootEye, STEP, tick } from './nimushi';

describe('THE ABYSS opens after 4-3, and is not a thirteenth SECTION', () => {
  it('lands in a staging room rather than straight into a fight', () => {
    const game = new GameModel(false, seeded(1));
    game.jumpToBoss();
    expect(game.abyssStage).toBe('staging');
    expect(game.boss.enabled).toBe(false);
    // Ordinary downward gravity, all the way to the seal.
    expect(game.gravitySign).toBe(1);
    expect(game.inverted).toBe(false);
  });

  it('guarantees a chamber and a sealed floor, every seed', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const game = new GameModel(false, seeded(seed));
      game.jumpToBoss();
      expect(game.safeZones.length).toBeGreaterThan(0);
      const seal = game.platforms.filter(row => row.breakBlock);
      expect(seal.length).toBe(5);
      // A full row: the shaft is closed and the only way on is to shoot a hole.
      const left = Math.min(...seal.map(b => b.x));
      const right = Math.max(...seal.map(b => b.x + b.width));
      expect(left).toBeLessThanOrEqual(28);
      expect(right).toBeGreaterThanOrEqual(422);
      expect(new Set(seal.map(b => b.y)).size).toBe(1);
    }
  });

  it('banks no metres of its own: TOTAL DEPTH is still the planned 12 x 200m', () => {
    const game = new GameModel(false, seeded(2));
    game.jumpToBoss();
    const before = Math.round(game.totalDepth);
    expect(before).toBe(PLANNED_TOTAL_DEPTH);
    intoTheAbyss(game);
    expect(Math.round(game.totalDepth)).toBe(PLANNED_TOTAL_DEPTH);
  });

  it('is opened by breaking the seal and nothing else', () => {
    const game = new GameModel(false, seeded(3));
    game.jumpToBoss();
    // Standing on the seal is not going through it.
    tick(game, 12, 1, false);
    expect(game.abyssStage).toBe('staging');
    expect(game.platforms.filter(row => row.breakBlock).length).toBeGreaterThan(0);
    intoTheAbyss(game);
    expect(game.abyssStage).not.toBe('staging');
  });
});

describe('the final shop', () => {
  it('quotes the ABYSS column, which is dearer than AREA 4 on every good', () => {
    for (const item of SHOP_ITEMS) {
      expect(item.prices.length).toBe(5);
      expect(shopPrice(item, ABYSS_SHOP_AREA)).toBeGreaterThan(shopPrice(item, 4));
    }
    expect(SHOP_ITEMS.map(i => shopPrice(i, ABYSS_SHOP_AREA))).toEqual([1100, 1300, 950, 1050, 1200, 1800]);
  });

  it('stocks three distinct goods for a run that took shelter at least once', () => {
    const game = new GameModel(false, seeded(4));
    game.safeZoneVisitCount = 2;
    game.jumpToBoss();
    expect(game.shop.offers.length).toBe(3);
    expect(new Set(game.shop.offers.map(o => o.item)).size).toBe(3);
    expect(game.shop.available).toBe(true);
    for (const offer of game.shop.offers) {
      expect(offer.price).toBe(shopPrice(SHOP_ITEMS.find(i => i.id === offer.item)!, ABYSS_SHOP_AREA));
    }
  });

  it("takes MEMBER'S CARD off the ABYSS price, not off an AREA one", () => {
    const game = new GameModel(false, seeded(4));
    game.safeZoneVisitCount = 2;
    game.upgrades.grant('membersCard');
    game.jumpToBoss();
    for (const offer of game.shop.offers) {
      const full = shopPrice(SHOP_ITEMS.find(i => i.id === offer.item)!, ABYSS_SHOP_AREA);
      expect(offer.price).toBe(Math.round(full * UPGRADE_TUNING.membersCard.discount));
    }
  });

  it('spends the wallet and never the score', () => {
    const game = new GameModel(false, seeded(6));
    game.safeZoneVisitCount = 1;
    game.jumpToBoss();
    game.coins.award(9000);
    const score = game.coins.scoreCoins, wallet = game.coins.walletCoins, combo = game.combo;
    const entrance = game.shop.entrance!;
    game.player.x = entrance.x + entrance.width / 2;
    game.player.y = entrance.y + entrance.height / 2;
    game.step(STEP, 0, false);
    expect(game.state).toBe('shop');
    const price = game.shop.offers[0].price;
    expect(game.buyShopItem(0)).toBe('bought');
    expect(game.coins.walletCoins).toBe(wallet - price);
    expect(game.coins.scoreCoins).toBe(score);
    expect(game.combo).toBe(combo);
    // Closing the shelf drops back into the ABYSS, never into an ordinary SECTION.
    expect(game.closeShop()).toBe(true);
    expect(game.state).toBe('boss');
    expect(game.abyssStage).toBe('staging');
  });
});

describe('TOMATO: what a run that never took shelter gets instead', () => {
  it('replaces the shelf entirely when no SAFE ZONE was ever entered', () => {
    const game = new GameModel(false, seeded(7));
    expect(game.safeZoneVisitCount).toBe(0);
    game.jumpToBoss();
    expect(game.shop.available).toBe(false);
    expect(game.pickups.filter(p => p.kind === 'tomato').length).toBe(1);
  });

  it('is not offered to a run that did step into a chamber', () => {
    const game = new GameModel(false, seeded(7));
    game.safeZoneVisitCount = 1;
    game.jumpToBoss();
    expect(game.pickups.some(p => p.kind === 'tomato')).toBe(false);
    expect(game.shop.available).toBe(true);
  });

  it('counts a chamber the player actually stood in, during ordinary play only', () => {
    const game = new GameModel(false, seeded(8));
    // Manufacture a chamber under the player and step into it.
    const zone = { id: 900, side: 1 as const, x: game.player.x - 40, y: game.player.y - 20, width: 150, height: 116, content: null, taken: false };
    game.safeZones.push(zone);
    game.step(STEP, 0, false);
    expect(game.safeZoneVisitCount).toBe(1);
    // Standing in the same one does not count twice.
    tick(game, 0.5);
    expect(game.safeZoneVisitCount).toBe(1);
  });

  it('pays +10 MAX HP and +10 MAX CHARGE through the existing systems', () => {
    const game = new GameModel(false, seeded(9));
    game.jumpToBoss();
    const tomato = game.pickups.find(p => p.kind === 'tomato')!;
    const hp = game.health.maxHp, ammo = game.stats.maxAmmo;
    game.player.x = tomato.x; game.player.y = tomato.y;
    game.step(STEP, 0, false);
    expect(game.health.maxHp).toBe(hp + TOMATO.maxHp);
    expect(game.stats.maxAmmo).toBe(ammo + TOMATO.maxCharge);
    // MEASUREMENT REQUIRED: what the existing calls do to the CURRENT values is recorded, not chosen.
    // lifeUp fills the new hearts, and growMaxCharge tops the magazine up.
    expect(game.hp).toBe(hp + TOMATO.maxHp);
    expect(game.ammo).toBe(game.stats.maxAmmo);
  });
});

describe('GRAVITY REVERSED', () => {
  it('turns the world over once, and only past the seal', () => {
    const game = new GameModel(false, seeded(10));
    game.jumpToBoss();
    expect(game.gravitySign).toBe(1);
    intoTheAbyss(game);
    expect(game.abyssStage).toBe('inverting');
    expect(game.gravitySign).toBe(1);
    // It is a held beat: nothing simulates through it.
    const y = game.player.y;
    tick(game, ABYSS.hold * 0.5);
    expect(game.player.y).toBe(y);
    tick(game, ABYSS.hold + ABYSS.reverse);
    expect(game.gravitySign).toBe(-1);
    expect(game.inverted).toBe(true);
    expect(game.abyssStage).toBe('fight');
    expect(game.boss.enabled).toBe(true);
  });

  it('puts NIMUSHI above the player and the deep below them', () => {
    const game = atNimushi(11);
    expect(game.boss.y).toBeLessThan(game.player.y);
    expect(game.boss.boundaryY).toBeGreaterThan(game.player.y);
    // The eye is on the face that looks down at the player.
    expect(game.boss.eye.y).toBeGreaterThan(game.boss.body.y);
  });
});

describe('gravity is a sign, and every direction reads it', () => {
  const normal = () => new GameModel(false, seeded(12));

  it('falls, fires and recoils downward in an ordinary SECTION', () => {
    const game = normal();
    expect(game.gravitySign).toBe(1);
    game.player.grounded = -1; game.player.vy = 0;
    tick(game, 0.2);
    expect(game.player.vy).toBeGreaterThan(0);
    game.shoot();
    expect(game.bullets.every(b => b.vy > 0)).toBe(true);
  });

  it('falls, fires and recoils UPWARD in the ABYSS', () => {
    const game = atNimushi(13);
    game.player.vy = 0; game.player.grounded = -1;
    tick(game, 0.2);
    expect(game.player.vy).toBeLessThan(0);
    game.bullets = [];
    game.shoot();
    expect(game.bullets.length).toBeGreaterThan(0);
    expect(game.bullets.every(b => b.vy < 0)).toBe(true);
  });

  it('kicks the player the other way when the gunboots fire', () => {
    const down = normal();
    down.player.grounded = -1; down.player.vy = 0;
    down.shoot();
    expect(down.player.vy).toBeLessThan(0);
    const up = atNimushi(14);
    up.player.grounded = -1; up.player.vy = 0;
    up.shoot();
    expect(up.player.vy).toBeGreaterThan(0);
  });

  it('jumps away from the floor either way', () => {
    const down = normal();
    down.player.grounded = down.platforms[0].id;
    down.jump();
    expect(down.player.vy).toBeLessThan(0);
    const up = atNimushi(15);
    up.platforms = [{ id: 77, x: up.player.x - 60, y: up.player.y - 40, width: 120 }];
    up.player.grounded = 77;
    up.jump();
    expect(up.player.vy).toBeGreaterThan(0);
  });

  it('leaves LEFT and RIGHT exactly as they were', () => {
    const down = normal(), up = atNimushi(16);
    const dx0 = down.player.x, ux0 = up.player.x;
    down.moveHorizontal(0.1, 1); up.moveHorizontal(0.1, 1);
    expect(down.player.x - dx0).toBeCloseTo(up.player.x - ux0, 6);
    down.moveHorizontal(0.1, -1); up.moveHorizontal(0.1, -1);
    expect(down.player.x).toBeCloseTo(up.player.x - (ux0 - dx0), 6);
  });

  it('stomps from above in the shaft and from below in the ABYSS', () => {
    const down = new GameModel(false, seeded(17));
    down.enemies = [{ id: 1, kind: 'slime', x: 225, y: 400, originX: 225, range: 0, phase: 0, hp: 1, alive: true, flash: 0, hurtFlash: 0, shootable: true, stompable: true, flying: false, slot: 'guard' }];
    down.player.x = 225; down.player.y = 372; down.player.vy = 520; down.player.grounded = -1;
    const prey = down.enemies[0];
    down.step(STEP, 0, false);
    expect(prey.alive).toBe(false);

    const up = atNimushi(18);
    const y = up.player.y - 30;
    up.enemies = [{ id: 2, kind: 'slime', x: up.player.x, y, originX: up.player.x, range: 0, phase: 0, hp: 1, alive: true, flash: 0, hurtFlash: 0, shootable: true, stompable: true, flying: false, slot: 'open' }];
    // Arriving at its UNDERSIDE, travelling with the pull.
    up.player.y = y + 27; up.player.vy = -520; up.player.grounded = -1;
    const quarry = up.enemies[0];
    up.step(STEP, 0, false);
    expect(quarry.alive).toBe(false);
  });

  it('bounces off a doodad from the side gravity brings the player in on', () => {
    const up = atNimushi(19);
    const y = up.player.y - 40;
    up.doodads = [{ id: 5, x: up.player.x - 22, y, width: 44, height: 12, variant: 'lamp', active: true }];
    up.ammo = 0;
    up.player.y = y + 29; up.player.vy = -520; up.player.grounded = -1;
    up.step(STEP, 0, false);
    expect(up.player.vy).toBeGreaterThan(0);
    expect(up.ammo).toBe(up.stats.maxAmmo);
  });

  it('drops coins and corpses with the pull, not down the screen', () => {
    const up = atNimushi(20);
    up.coins.burst(225, up.player.y, 4, seeded(99));
    tick(up, 0.6);
    expect(up.coins.coins.every(c => c.vy <= 0)).toBe(true);
  });

  it('returns to ordinary gravity on a new run', () => {
    const game = atNimushi(21);
    expect(game.gravitySign).toBe(-1);
    const fresh = new GameModel(false, seeded(21));
    expect(fresh.gravitySign).toBe(1);
    expect(fresh.abyssStage).toBe('none');
    expect(fresh.boss.enabled).toBe(false);
    expect(fresh.ammo).toBe(8);
    expect(fresh.upgrades.acquired.length).toBe(0);
    expect(fresh.stage.label).toBe('1-1');
  });
});

describe('the weak point is the whole fight', () => {
  it('sleeps until a round finds the eye', () => {
    const game = atNimushi(22);
    expect(game.boss.state).toBe('dormant');
    tick(game, 3);
    expect(game.boss.state).toBe('dormant');
    expect(game.boss.started).toBe(false);
    // Standing next to it is not an attack.
    pin(game, NIMUSHI.minGap);
    tick(game, 1);
    expect(game.boss.started).toBe(false);
  });

  it('is not woken by shooting the body', () => {
    const game = atNimushi(23);
    const hp = game.boss.hp;
    for (let i = 0; i < 20; i++) shootBody(game, 3);
    expect(game.boss.started).toBe(false);
    expect(game.boss.state).toBe('dormant');
    expect(game.boss.hp).toBe(hp);
  });

  it('starts the fight, and BOSS TIME, on the first round into the eye', () => {
    const game = atNimushi(24);
    tick(game, 2);
    expect(game.boss.elapsed).toBe(0);
    shootEye(game, 1);
    expect(game.boss.started).toBe(true);
    expect(game.boss.state).toBe('eyeOpen');
    expect(game.boss.hp).toBe(NIMUSHI.maxHp - 1);
    tick(game, 1);
    expect(game.boss.elapsed).toBeGreaterThan(0.9);
    expect(game.boss.elapsed).toBeLessThan(1.2);
  });

  it('takes nothing off through the body once the fight has started', () => {
    const game = fighting(25);
    const hp = game.boss.hp;
    for (let i = 0; i < 10; i++) shootBody(game, 3);
    expect(game.boss.hp).toBe(hp);
  });

  it('takes nothing off through a shut eye', () => {
    const game = fighting(26);
    // Spend the window so the eye shuts.
    while (game.boss.state === 'eyeOpen') shootEye(game, 4);
    expect(game.boss.eyeOpen).toBe(false);
    const hp = game.boss.hp;
    for (let i = 0; i < 10; i++) shootEye(game, 4);
    expect(game.boss.hp).toBe(hp);
  });

  it('answers every player-side projectile source the same way', () => {
    for (const source of ['player', 'drone', 'casing', 'poppingGem', 'gunpowderBlock'] as const) {
      const open = fighting(27);
      const before = open.boss.hp;
      shootEye(open, 1, source);
      expect(open.boss.hp).toBe(before - 1);

      const body = fighting(27);
      const held = body.boss.hp;
      shootBody(body, 1, source);
      expect(body.boss.hp).toBe(held);
    }
  });

  it('cannot be reached by an explosion at all', () => {
    const game = fighting(28);
    const hp = game.boss.hp;
    const eye = game.boss.eye;
    // A blast big enough to swallow the whole body, centred on the eye.
    game.spawnExplosion({ x: game.boss.x, y: eye.y, radius: 400, damage: 99 });
    expect(game.boss.hp).toBe(hp);
    // And the four upgrades that make one are the same call, so none of them is a way in.
    for (const radius of [UPGRADE_TUNING.blastModule.radius, UPGRADE_TUNING.rocketJump.blastRadius, UPGRADE_TUNING.restInPieces.blastRadius, UPGRADE_TUNING.heartBalloon.blastRadius]) {
      game.spawnExplosion({ x: game.boss.x, y: eye.y, radius, damage: 9 });
    }
    expect(game.boss.hp).toBe(hp);
  });

  it('is never stompable: arriving on it costs a heart instead', () => {
    const game = fighting(29);
    const hp = game.boss.hp, hearts = game.hp;
    // Dived straight into it. NIMUSHI backs away at a limited speed rather than snapping clear,
    // so this is something a player can actually do -- and it costs them.
    game.player.x = game.boss.x;
    game.player.y = game.boss.y;
    game.player.vy = -520;
    game.player.invincible = 0;
    game.step(STEP, 0, false);
    expect(game.boss.hp).toBe(hp);
    expect(game.hp).toBe(hearts - NIMUSHI.contactDamage);
    expect(game.health.lastDamage?.cause).toBe('bossContact');
  });
});

describe('the eye cycle', () => {
  it('runs OPEN -> CLOSING -> PREP -> attack -> RECOVERY -> OPEN', () => {
    const game = fighting(30);
    const seen: string[] = [];
    for (let i = 0; i < 30 / STEP; i++) {
      if (game.boss.eyeOpen && game.boss.state === 'eyeOpen' && i % 6 === 0) shootEye(game, 3);
      else game.step(STEP, 0, false);
      const state = game.boss.state;
      if (seen[seen.length - 1] !== state) seen.push(state);
      if (seen.filter(s => s === 'eyeOpen').length >= 2) break;
    }
    expect(seen[0]).toBe('eyeOpen');
    expect(seen).toContain('eyeClosing');
    expect(seen).toContain('attackPrep');
    expect(seen).toContain('recovery');
    expect(seen[seen.length - 1]).toBe('eyeOpen');
    // attackPrep is always followed by an attack, never by recovery directly.
    const prep = seen.indexOf('attackPrep');
    expect(Object.keys(NIMUSHI_ATTACKS)).toContain(seen[prep + 1]);
  });

  it('shuts the window on damage OR on time, whichever comes first', () => {
    const fast = fighting(31);
    for (let i = 0; i < 12 && fast.boss.state === 'eyeOpen'; i++) shootEye(fast, 4);
    expect(fast.boss.state).not.toBe('eyeOpen');
    expect(fast.boss.elapsed).toBeLessThan(NIMUSHI.eyeWindow.timeout);

    const slow = fighting(31);
    tick(slow, NIMUSHI.eyeWindow.timeout + 0.1);
    expect(slow.boss.state).not.toBe('eyeOpen');
  });

  it('keeps the damage window separate from the phase thresholds', () => {
    // Two different ideas, two different numbers: a window is worth far less than a phase.
    const perPhase = NIMUSHI.maxHp * (ABYSS_PHASES[0].from - ABYSS_PHASES[1].from);
    expect(NIMUSHI.eyeWindow.damage).toBeLessThan(perPhase);
  });

  it('never runs two attacks at once', () => {
    const game = fighting(32);
    const attackStates = Object.keys(NIMUSHI_ATTACKS);
    for (let i = 0; i < 60 / STEP; i++) {
      if (game.boss.eyeOpen && game.boss.state === 'eyeOpen' && i % 6 === 0) shootEye(game, 3);
      else game.step(STEP, 0, false);
      if (game.state !== 'boss') break;
      expect(attackStates.filter(s => s === game.boss.state).length).toBeLessThanOrEqual(1);
    }
  });
});

/**
 * Play until NIMUSHI actually uses `attack`, and hand back whatever it put in the world.
 *
 * It gets there by doing the only thing that moves the fight along -- putting rounds in the open
 * eye -- so the stretch that owns the attack is reached the way a player reaches it. The player is
 * held still and immune because what is under test is the attack, not the dodging.
 */
function reachAttack(game: GameModel, attack: 'cupSummon' | 'strawBeam' | 'nimushiClones', limit = 400) {
  const landed = () => attack === 'cupSummon' ? game.boss.cups.length > 0
    : attack === 'strawBeam' ? game.boss.beams.length > 0
    : game.enemies.length > 0;
  for (let i = 0; i < limit / STEP; i++) {
    game.player.invincible = 9;
    pin(game, 300);
    if (game.boss.eyeOpen && game.boss.state === 'eyeOpen' && i % 6 === 0) shootEye(game, 4);
    else game.step(STEP, 0, false);
    if (game.state !== 'boss' || game.boss.defeated) return false;
    if (landed()) return true;
  }
  return false;
}

describe('the five attacks', () => {
  it('always leaves a lane open in a TAPIOCA SHOWER', () => {
    const game = fighting(33);
    let previous: number[] = [];
    for (let wave = 0; wave < 200; wave++) {
      game.boss.tapiocas = [];
      const safe = game.boss.spawnShowerWave(seeded(100 + wave));
      expect(safe.length).toBeGreaterThan(0);
      const filled = new Set(game.boss.tapiocas.map(p => laneOf(p.x)));
      expect(filled.size).toBeLessThan(TAPIOCA_SHOWER.lanes);
      for (const lane of safe) expect(filled.has(lane)).toBe(false);
      // The gap is adjacent lanes, and it walks: a gap that jumped across the shaft between waves
      // could not be reached at walking speed, which is the same as having no gap at all.
      expect(Math.max(...safe) - Math.min(...safe)).toBe(safe.length - 1);
      if (previous.length) expect(Math.abs(safe[0] - previous[0])).toBeLessThanOrEqual(1);
      previous = safe;
    }
  });

  it('pours a shower that can actually hurt the player', () => {
    const game = fighting(34);
    let hurt = 0;
    for (let i = 0; i < 40 / STEP && game.state === 'boss'; i++) {
      pin(game, 300);
      game.player.x = game.boss.x;
      game.step(STEP, 0, false);
      for (const e of game.events) if (e.type === 'hurt') hurt++;
      game.events.length = 0;
      if (hurt > 0) break;
    }
    expect(hurt).toBeGreaterThan(0);
  });

  it('sends a CUP past the player, warns, then fires back at them', () => {
    const game = fighting(35);
    expect(reachAttack(game, 'cupSummon')).toBe(true);
    const cup = game.boss.cups[0];
    // It starts at NIMUSHI and travels AGAINST the pull -- down the screen, past the player.
    expect(cup.vy).toBeGreaterThan(0);
    const states = new Set<string>();
    let spat = 0;
    for (let i = 0; i < 20 / STEP; i++) {
      states.add(cup.state);
      const before = game.boss.tapiocas.length;
      game.step(STEP, 0, false);
      if (cup.state === 'firing' && game.boss.tapiocas.length > before) spat++;
      if (!cup.alive) break;
    }
    expect(states.has('warning')).toBe(true);
    expect(states.has('firing')).toBe(true);
    expect(spat).toBeGreaterThan(0);
    // And it is gone afterwards rather than left in the list.
    expect(game.boss.cups.includes(cup!)).toBe(false);
  });

  it('lets the player shoot a cup down', () => {
    const game = fighting(36);
    expect(reachAttack(game, 'cupSummon')).toBe(true);
    const cup = game.boss.cups[0];
    game.bullets.push(round(cup.x, cup.y, TAPIOCA_CUP.hp));
    game.step(STEP, 0, false);
    expect(game.boss.cups.includes(cup!)).toBe(false);
  });

  it('warns before the STRAW BEAM, and cannot hurt during the warning', () => {
    const game = fighting(37);
    expect(reachAttack(game, 'strawBeam')).toBe(true);
    const beam = game.boss.beams[0];
    expect(beam.state).toBe('warning');
    expect(STRAW_BEAM.warning).toBeGreaterThanOrEqual(0.7);
    // Standing squarely in the line while it is only a line costs nothing.
    const hp = game.hp;
    for (let i = 0; i < Math.floor(STRAW_BEAM.warning / STEP) - 4; i++) {
      game.player.x = beam.x;
      game.player.invincible = 0;
      game.step(STEP, 0, false);
      expect(beam.state).toBe('warning');
    }
    expect(game.hp).toBe(hp);
    // And then it does.
    for (let i = 0; i < 0.4 / STEP; i++) { game.player.x = beam.x; game.player.invincible = 0; game.step(STEP, 0, false); }
    expect(game.hp).toBeLessThan(hp);
    expect(game.health.lastDamage?.cause).toBe('bossSweep');
  });

  it('summons clones that are ordinary enemies in every way', () => {
    const game = fighting(38);
    game.upgrades.grant('knifeAndFork');
    // Drive to the LIMBO stretch, where にむし分身 is in the rotation, then wait for that attack.
    expect(reachAttack(game, 'nimushiClones')).toBe(true);
    expect(game.enemies.length).toBeGreaterThan(0);
    // LIMBO's clones cannot be stood on, exactly as the AREA 4 roster cannot.
    expect(game.enemies.every(e => !e.stompable)).toBe(true);
    const combo = game.combo, kills = game.kills, coins = game.coins.coins.length;
    const target = game.enemies[0];
    // A clone sways like any other enemy, so the round is aimed where it IS on the frame it is
    // fired -- which is what a player does, and what the sway is there to make them do.
    for (let i = 0; i < 40 && target.alive; i++) {
      game.bullets.push(round(target.x, target.y, 4));
      game.step(STEP, 0, false);
    }
    expect(target.alive).toBe(false);
    expect(game.kills).toBe(kills + 1);
    expect(game.combo).toBe(combo + 1);
    expect(game.coins.coins.length).toBeGreaterThan(coins);
    expect(game.corpses.length).toBeGreaterThan(0);
  });

  it('never seals the screen during FULL SCREEN TAPIOCA, and moves the way through', () => {
    const game = fighting(39);
    const corridors: number[][] = [];
    for (let wave = 0; wave < 40; wave++) {
      game.boss.tapiocas = [];
      const open = game.boss.spawnRageWave();
      corridors.push(open);
      expect(open.length).toBeGreaterThan(0);
      const filled = new Set(game.boss.tapiocas.map(p => laneOf(p.x, FULL_SCREEN_TAPIOCA.lanes)));
      expect(filled.size).toBeLessThan(FULL_SCREEN_TAPIOCA.lanes);
      for (const lane of open) expect(filled.has(lane)).toBe(false);
    }
    // The corridor walks rather than sitting still.
    expect(new Set(corridors.map(c => c[0])).size).toBeGreaterThan(1);
  });
});

describe('phases and FINAL RAGE', () => {
  it('declares four stretches in descending order with their own roles', () => {
    expect(ABYSS_PHASES.map(p => p.id)).toEqual([1, 2, 3, 4]);
    expect(ABYSS_PHASES.map(p => p.role)).toEqual(['cavern', 'catacomb', 'aquifer', 'limbo']);
    expect(ABYSS_PHASES.map(p => p.from)).toEqual([1, 0.75, 0.5, 0.25]);
    expect(abyssPhaseAt(1).id).toBe(1);
    expect(abyssPhaseAt(0.8).id).toBe(1);
    expect(abyssPhaseAt(0.75).id).toBe(2);
    expect(abyssPhaseAt(0.5).id).toBe(3);
    expect(abyssPhaseAt(0.1).id).toBe(4);
  });

  it('adds attacks as it goes rather than swapping them out', () => {
    for (let i = 1; i < ABYSS_PHASES.length; i++) {
      expect(ABYSS_PHASES[i].attacks.length).toBeGreaterThanOrEqual(ABYSS_PHASES[i - 1].attacks.length);
    }
    expect(ABYSS_PHASES[3].attacks.length).toBe(4);
  });

  it('hauls the arena upward at a stretch boundary, with the eye shut', () => {
    const game = fighting(40);
    let transitions = 0, bossMoved = 0;
    let previous = game.boss.y;
    for (let i = 0; i < 200 / STEP; i++) {
      game.player.invincible = 9;
      pin(game, 300);
      if (game.boss.eyeOpen && i % 6 === 0) shootEye(game, 4);
      else game.step(STEP, 0, false);
      if (game.boss.state === 'phaseTransition') {
        transitions++;
        expect(game.boss.eyeOpen).toBe(false);
        if (game.boss.y < previous) bossMoved++;
      }
      previous = game.boss.y;
      if (game.boss.phaseId === 2) break;
      if (game.state !== 'boss') break;
    }
    expect(transitions).toBeGreaterThan(0);
    expect(bossMoved).toBeGreaterThan(0);
    expect(game.boss.phaseId).toBe(2);
  });

  it('enters FINAL RAGE once, below a quarter, and still opens the eye afterwards', () => {
    const game = fighting(41);
    let rages = 0;
    for (let i = 0; i < 400 / STEP; i++) {
      game.player.invincible = 9;
      pin(game, 300);
      if (game.boss.eyeOpen && i % 6 === 0) shootEye(game, 4);
      else game.step(STEP, 0, false);
      for (const e of game.events) if (e.type === 'bossRage') rages++;
      game.events.length = 0;
      if (game.boss.defeated || game.state !== 'boss') break;
    }
    expect(rages).toBe(1);
    expect(game.boss.raged).toBe(true);
    expect(FINAL_RAGE_RATIO).toBe(0.25);
  });
});

describe('the rising deep', () => {
  it('closes on a player who stops climbing, and kills them', () => {
    const game = fighting(42);
    const start = game.boss.slack;
    for (let i = 0; i < 120 / STEP; i++) {
      // Immune to everything NIMUSHI throws, so the only thing left that can end the run is the
      // deep itself catching up. That is exactly what this test is about.
      game.player.invincible = 9;
      game.player.vy = 0;
      game.step(STEP, 0, false);
      if (game.state !== 'boss') break;
    }
    expect(game.boss.slack).toBeLessThan(start);
    expect(game.state).toBe('over');
    expect(game.health.deathCause?.cause).toBe('crush');
  });

  it('buys room back for hitting the eye', () => {
    const game = fighting(43);
    tick(game, 2);
    const slack = game.boss.slack, y = game.boss.y;
    shootEye(game, 3);
    expect(game.boss.slack).toBeGreaterThan(slack);
    // And NIMUSHI is visibly shoved further along the pull.
    expect(game.boss.y).toBeLessThan(y);
  });

  it('never overtakes NIMUSHI, and always leaves a playable band', () => {
    const game = fighting(44);
    for (let i = 0; i < 200 / STEP; i++) {
      game.player.invincible = 9;
      // A player doing nothing at all: the worst case for the boundary.
      game.player.vy = 0;
      game.step(STEP, 0, false);
      const room = (game.boss.face - game.boss.boundaryY) * game.gravitySign;
      expect(room).toBeGreaterThanOrEqual(ABYSS.minArena - 1e-6);
      expect(game.boss.boundaryY).toBeGreaterThan(game.boss.face);
      if (game.boss.defeated) break;
    }
  });

  it('hands the slack back during a stretch change', () => {
    const game = fighting(45);
    for (let i = 0; i < 200 / STEP; i++) {
      game.player.invincible = 9;
      pin(game, 300);
      if (game.boss.eyeOpen && i % 6 === 0) shootEye(game, 4);
      else game.step(STEP, 0, false);
      if (game.boss.state === 'phaseTransition') break;
      if (game.state !== 'boss') break;
    }
    expect(game.boss.state).toBe('phaseTransition');
    tick(game, 0.2);
    expect(game.boss.slack).toBe(ABYSS.maxSlack);
  });
});

describe('the four ABYSS environments', () => {
  const driveToPhase = (id: 1 | 2 | 3 | 4, seed = 50) => {
    const game = fighting(seed);
    for (let i = 0; i < 400 / STEP && game.boss.phaseId < id; i++) {
      game.player.invincible = 9;
      pin(game, 300);
      if (game.boss.eyeOpen && i % 6 === 0) shootEye(game, 4);
      else game.step(STEP, 0, false);
      if (game.state !== 'boss') break;
    }
    return game;
  };

  it('keeps PHASE 1 plain, with a heart in reach', () => {
    const game = atNimushi(51);
    expect(game.boss.phaseId).toBe(1);
    expect(game.oxygen.enabled).toBe(false);
    expect(game.heat.enabled).toBe(false);
    expect(game.platforms.some(row => row.spikePlatform)).toBe(false);
    expect(game.pickups.some(p => p.kind === 'heart')).toBe(true);
  });

  it('runs CATACOMB spikes under inverted gravity', () => {
    const game = driveToPhase(2, 52);
    expect(game.boss.phaseId).toBe(2);
    const spiked = game.platforms.find(row => row.spikePlatform);
    expect(spiked).toBeDefined();
    // Landing on its gravity-facing face -- the UNDERSIDE -- is what arms it.
    const face = spiked!.y + 16;
    game.player.x = spiked!.x + spiked!.width / 2;
    game.player.y = face - 15 * game.gravitySign;
    game.player.grounded = spiked!.id;
    game.step(STEP, 0, false);
    expect(spiked!.spikePlatform!.state).toBe('warning');
    const states = new Set<string>();
    for (let i = 0; i < 6 / STEP; i++) {
      states.add(spiked!.spikePlatform!.state);
      game.player.invincible = 9;
      game.step(STEP, 0, false);
      if (game.state !== 'boss') break;
    }
    expect(states.has('warning')).toBe(true);
    expect(states.has('active')).toBe(true);
    expect(states.has('cooldown')).toBe(true);
  });

  it('drowns in the AQUIFER, and only a shot opens an air container', () => {
    const game = driveToPhase(3, 53);
    expect(game.boss.phaseId).toBe(3);
    expect(game.oxygen.enabled).toBe(true);
    const air = game.oxygen.remaining;
    tick(game, 2);
    expect(game.oxygen.remaining).toBeLessThan(air);
    const box = game.containers.find(c => !c.broken);
    expect(box).toBeDefined();
    expect(box!.shotOnly).toBe(true);
    // Swimming into it does nothing at all.
    game.player.x = box!.x + box!.width / 2;
    game.player.y = box!.y + box!.height / 2;
    game.step(STEP, 0, false);
    expect(box!.broken).toBe(false);
    // A round opens it, and it releases bubbles rather than air.
    const drowning = game.oxygen.remaining;
    game.bullets.push(round(box!.x + box!.width / 2, box!.y + box!.height / 2, 1));
    game.step(STEP, 0, false);
    expect(box!.broken).toBe(true);
    // The container restores nothing by itself: what it does is release bubbles, and only touching
    // one is worth air. The player is standing in the burst, so the air arrives that way.
    expect(game.oxygen.remaining).toBeGreaterThan(drowning);
  });

  it('leaves LIMBO with nothing to stand on but a doodad', () => {
    const game = driveToPhase(4, 54);
    expect(game.boss.phaseId).toBe(4);
    const phase = ABYSS_PHASES[3];
    expect(phase.groundless).toBe(true);
    expect(phase.heart).toBe(false);
    // Nothing the arena lays in LIMBO is a floor.
    tick(game, 3);
    // Nothing ahead of the player along the pull is a floor. Rows already passed are still in the
    // list until the view leaves them behind, and those are behind the player by definition.
    const ahead = game.platforms.filter(row => (row.y - game.player.y) * game.gravitySign > 0);
    expect(ahead.length).toBe(0);
    expect(game.doodads.length).toBeGreaterThan(0);
    // And a doodad still reloads, arrived at from the side gravity brings the player in on.
    const doodad = game.doodads[0];
    game.ammo = 0;
    game.player.x = doodad.x + doodad.width / 2;
    game.player.y = doodad.y + doodad.height + 17;
    game.player.vy = -520;
    game.player.grounded = -1;
    game.step(STEP, 0, false);
    expect(game.ammo).toBe(game.stats.maxAmmo);
  });

  it('guarantees a heart in the first three stretches and none in LIMBO', () => {
    expect(ABYSS_PHASES.map(p => p.heart)).toEqual([true, true, true, false]);
  });
});

describe('the fight can be won, and won honestly', () => {
  it('goes down to real rounds through the eye', () => {
    const game = fighting(60);
    expect(defeatNimushi(game)).toBe(true);
    expect(game.boss.hp).toBe(0);
    expect(game.boss.phaseId).toBe(4);
    expect(game.boss.raged).toBe(true);
    tick(game, NIMUSHI.defeatDelay + 0.3);
    expect(game.state).toBe('clear');
  });

  it('can be taken down by every one of the seven weapons, with no upgrades', () => {
    for (const id of GUN_MODULE_IDS) {
      const game = atNimushi(61);
      game.gun.equip(id);
      expect(game.upgrades.acquired.length).toBe(0);
      let hits = 0;
      for (let i = 0; i < 400 / STEP && !game.boss.defeated; i++) {
        game.player.invincible = 9;
        pin(game, 260);
        game.player.x = game.boss.x;
        game.ammo = game.stats.maxAmmo;
        const before = game.boss.hp;
        // Pulsed rather than held: BURST and the other single-shot modules fire once per PRESS,
        // so holding the trigger would test one weapon's trigger rule instead of seven weapons.
        game.step(STEP, 0, i % 8 < 4);
        if (game.boss.hp < before) hits++;
        if (game.state !== 'boss') break;
      }
      expect(hits, `${id} never reached the eye`).toBeGreaterThan(0);
      expect(game.boss.defeated, `${id} could not finish the fight`).toBe(true);
    }
  });

  it('keeps every weapon firing along the pull, with its own pattern intact', () => {
    for (const id of GUN_MODULE_IDS) {
      const game = atNimushi(62);
      game.gun.equip(id);
      game.player.grounded = -1;
      game.bullets = [];
      game.shoot();
      expect(game.bullets.length, id).toBeGreaterThan(0);
      // Every round goes along the pull, and the recoil goes the other way.
      expect(game.bullets.every(b => b.vy < 0), id).toBe(true);
      expect(game.player.vy, id).toBeGreaterThan(0);
      // The horizontal half of the pattern is untouched by the inversion.
      const down = new GameModel(false, seeded(62));
      down.gun.equip(id);
      down.player.grounded = -1;
      down.bullets = [];
      down.shoot();
      expect(game.bullets.map(b => Math.round(b.vx)), id).toEqual(down.bullets.map(b => Math.round(b.vx)));
      expect(game.bullets.map(b => Math.round(Math.abs(b.vy))), id).toEqual(down.bullets.map(b => Math.round(Math.abs(b.vy))));
    }
  });
});

describe('BOSS TIME, CLEAR TIME and TOTAL DEPTH', () => {
  it('starts BOSS TIME at the first weak-point hit, not at the shop or the reversal', () => {
    const game = new GameModel(false, seeded(70));
    game.jumpToBoss();
    intoTheAbyss(game);
    tick(game, ABYSS.hold + ABYSS.reverse + 0.1);
    expect(game.abyssStage).toBe('fight');
    tick(game, 3);
    expect(game.bossTime).toBe(0);
    shootEye(game, 1);
    tick(game, 1);
    expect(game.bossTime).toBeGreaterThan(0.9);
    // CLEAR TIME is the whole run and is necessarily the longer of the two.
    expect(game.elapsed).toBeGreaterThan(game.bossTime);
  });

  it('keeps the clear time once the fight is torn down', () => {
    const game = fighting(71);
    expect(defeatNimushi(game)).toBe(true);
    const fightLength = game.bossTime;
    tick(game, NIMUSHI.defeatDelay + 0.3);
    expect(game.state).toBe('clear');
    expect(game.bossTime).toBeCloseTo(fightLength, 1);
  });

  it('never lets the ascent touch TOTAL DEPTH', () => {
    const game = fighting(72);
    expect(Math.round(game.totalDepth)).toBe(PLANNED_TOTAL_DEPTH);
    for (let i = 0; i < 60 / STEP; i++) {
      game.player.invincible = 9;
      game.step(STEP, 0, true);
      if (game.state !== 'boss') break;
    }
    expect(Math.round(game.totalDepth)).toBe(PLANNED_TOTAL_DEPTH);
    // The climb is reported on its own and only ever goes up.
    expect(game.bossAscent).toBeGreaterThanOrEqual(0);
  });
});

describe('the camera and the view', () => {
  it('travels upward with the player and keeps NIMUSHI in frame', () => {
    const game = atNimushi(80);
    const start = game.cameraY;
    tick(game, 2);
    expect(game.cameraY).toBeLessThan(start);
    // Player low in the frame, NIMUSHI above them, the deep below.
    const onScreen = (y: number) => y - game.cameraY;
    expect(onScreen(game.player.y)).toBeGreaterThan(400);
    expect(onScreen(game.boss.y)).toBeLessThan(onScreen(game.player.y));
  });

  it('only ever moves with the pull, in either direction', () => {
    const down = new GameModel(false, seeded(81));
    let last = down.cameraY;
    for (let i = 0; i < 3 / STEP; i++) { down.step(STEP, 1, false); expect(down.cameraY).toBeGreaterThanOrEqual(last); last = down.cameraY; }
    const up = atNimushi(82);
    last = up.cameraY;
    for (let i = 0; i < 3 / STEP; i++) { up.step(STEP, 1, false); expect(up.cameraY).toBeLessThanOrEqual(last); last = up.cameraY; }
  });
});

describe('a long fight does not fill up with entities', () => {
  it('bounds everything the fight puts in the air', () => {
    const game = fighting(90);
    let peak = 0;
    for (let i = 0; i < 240 / STEP; i++) {
      game.player.invincible = 9;
      pin(game, 300);
      if (game.boss.eyeOpen && i % 10 === 0) shootEye(game, 2);
      else game.step(STEP, 0, true);
      const total = game.boss.tapiocas.length + game.boss.cups.length + game.boss.beams.length
        + game.enemies.length + game.bullets.length + game.coins.coins.length + game.corpses.length
        + game.platforms.length + game.doodads.length + game.timeoutBubbles.length;
      peak = Math.max(peak, total);
      if (game.state !== 'boss') break;
    }
    expect(peak).toBeLessThan(600);
  });

  it('sweeps the arena clean at a stretch boundary', () => {
    const game = fighting(91);
    for (let i = 0; i < 300 / STEP; i++) {
      game.player.invincible = 9;
      pin(game, 300);
      if (game.boss.eyeOpen && i % 6 === 0) shootEye(game, 4);
      else game.step(STEP, 0, false);
      if (game.boss.state === 'phaseTransition') break;
      if (game.state !== 'boss') break;
    }
    expect(game.boss.state).toBe('phaseTransition');
    expect(game.boss.tapiocas.length).toBe(0);
    expect(game.boss.cups.length).toBe(0);
    expect(game.boss.beams.length).toBe(0);
  });
});
