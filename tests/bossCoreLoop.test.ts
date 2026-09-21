import { describe, expect, it } from 'vitest';
import { fighting, round, seeded, STEP, tick } from './nimushi';
import { GameModel } from '../src/systems/GameModel';
import { ABYSS_PHASES, ARENA_FLOOR } from '../src/data/abyss';
import { FINAL_RAGE_RATIO, FULL_SCREEN_TAPIOCA, NIMUSHI, TAPIOCA_SHOWER, TRANSITION_HAUL } from '../src/data/nimushi';
import { WORLD } from '../src/data/balance';
import { GUN_MODULES, GUN_MODULE_IDS, type GunModuleId } from '../src/data/gunModules';
import { BOSS_PHYSICS } from '../src/data/bossPhysics';

/**
 * NORMAL GAMEPLAY, ONLY GRAVITY IS REVERSED.
 *
 * This replaces two files of tests -- one for a velocity-matching gap controller, one for a pair of
 * screen bands -- that both held NIMUSHI at a safe distance FOR the player. Each of them removed
 * the reason to play: with the distance guaranteed, nothing the player did changed it.
 *
 * Now the player is pulled upward faster than NIMUSHI climbs. Do nothing and you are in the body.
 * The way out is the one AREA 1-4 teaches: stomp something and be thrown the other way.
 */
const along = (g: GameModel) => (g as unknown as { along(v: number): number }).along(g.player.vy);

/** A real arena, with the supply the fight actually lays. */
function arena(seed: number) {
  const g = new GameModel(false, seeded(seed));
  g.jumpToNimushi();
  g.platforms = []; g.doodads = []; g.containers = [];
  g.bullets.push(round(g.boss.x, g.boss.eye.y + g.boss.eye.height / 2, 1));
  g.step(STEP, 0, false);
  return g;
}

describe('doing nothing carries the player into NIMUSHI', () => {
  it('reaches the body, and ends the run', () => {
    const g = arena(600);
    g.enemies = [];                                   // nothing to stomp: the pure fall
    let contact = -1;
    for (let i = 0; i < 12 / STEP && g.state === 'boss'; i++) {
      g.enemies = [];
      g.step(STEP, 0, false);
      if (contact < 0 && g.boss.reach(g.player.y) <= 0) contact = i * STEP;
    }
    expect(contact).toBeGreaterThan(0);
    expect(contact).toBeLessThan(6);
    expect(g.state).toBe('over');
  });

  it('climbs slower than the player falls, which is what makes that true', () => {
    expect(NIMUSHI.ascentSpeed).toBeLessThan(BOSS_PHYSICS.maxFallSpeed);
  });

  it('reaches the body in one to three seconds, which is the whole failure state', () => {
    for (const seed of [610, 611, 612, 613]) {
      const g = arena(seed);
      let contact = -1;
      for (let i = 0; i < 8 / STEP && contact < 0; i++) {
        g.enemies = [];                               // nothing to stomp: the pure fall
        g.player.invincible = 9;
        g.step(STEP, 0, false);
        if (g.boss.reach(g.player.y) <= 0) contact = i * STEP;
      }
      expect(contact).toBeGreaterThan(1);
      expect(contact).toBeLessThan(3);
    }
  });

  /**
   * ...and the success state. GOOD PLAY is distance-neutral.
   *
   * `ascentSpeed` is the only number that decides this, and it was chosen on it: over 12 seeds the
   * gap drifts -0.9px/s at 280 against -46.1px/s at the 150 this replaced, and 12/12 seeds hold
   * thirty seconds under either braking style rather than 0/12. What is asserted here is the
   * SHAPE of that, on a player who uses the three verbs AREA 1-4 teaches and nothing else.
   */
  it('can be held for thirty seconds by stomping, bouncing and braking', () => {
    const seeds = [620, 621, 622, 623, 624, 625, 626, 627, 628, 629];
    const drifts: number[] = [];
    let held = 0;
    for (const seed of seeds) {
      const g = arena(seed);
      const gaps: number[] = [];
      let contact = -1;
      for (let i = 0; i < 30 / STEP && g.state === 'boss'; i++) {
        // Steer at the nearest thing to stand on ahead along the pull, and hold the gunboots. No
        // boss-only verb: this is stomp, bounce, reload and brake, exactly as the shaft plays them.
        const target = g.enemies.filter(e => e.alive && e.y < g.player.y).sort((a, b) => b.y - a.y)[0];
        g.step(STEP, target ? Math.sign(target.x - g.player.x) as -1 | 0 | 1 : 0, g.ammo > 0);
        const reach = g.boss.reach(g.player.y);
        gaps.push(reach);
        if (contact < 0 && reach <= 0) contact = i * STEP;
      }
      if (contact < 0) held++;
      drifts.push((gaps[gaps.length - 1] - gaps[0]) / (gaps.length * STEP));
      // Whatever happens to the run, the distance is MANAGED rather than held: it swings.
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(200);
    }
    // MEASURED at 37/40 seeds over this same fixture and bot, so this is the property as it is
    // rather than as it would be tidy: most runs hold, and the ones that do not lose slowly.
    expect(held).toBeGreaterThanOrEqual(8);
    // ...and across seeds the gap goes nowhere in particular, which is what neutral means.
    expect(Math.abs(drifts.reduce((a, b) => a + b, 0) / drifts.length)).toBeLessThan(15);
  });

  /**
   * Every weapon can fire from outside the boss's danger zone, and the short ones by enough time to
   * line up in. MEASURED by firing real rounds: the furthest reach a press lands from, against the
   * reach at which contact starts, divided by how fast the gap closes.
   *
   *   weapon    window before C1    after      by hand before
   *   MACHINE      2.69s            2.85s      comfortable
   *   SHOTGUN      0.87s            1.15s      unusable
   *   PUNCHER      0.80s            1.08s      unusable
   *
   * The bar is one second, because crossing a quarter of the shaft to line up with a 60px eye
   * costs 0.55s and the shortest weapon's own fire interval is another 0.55s.
   */
  it('leaves every weapon a firing window it can be aimed in', () => {
    const closing = BOSS_PHYSICS.maxFallSpeed - NIMUSHI.ascentSpeed;
    const contactBegins = -15;                    // measured: `contactInset` puts it inside the face
    for (const id of GUN_MODULE_IDS) {
      const def = GUN_MODULES[id];
      // What a round can close on a face climbing away, plus the muzzle offset and the eye's reach.
      const far = 21 + NIMUSHI.eyeHeight + def.range * (1 - NIMUSHI.ascentSpeed / def.projectileSpeed);
      const window = (far - contactBegins) / closing;
      expect(window, `${id} has only ${window.toFixed(2)}s to fire in`).toBeGreaterThan(1);
    }
    // ...and the spread between them is kept: short range is still the risky way to play.
    const windowOf = (id: GunModuleId) => {
      const def = GUN_MODULES[id];
      return (21 + NIMUSHI.eyeHeight + def.range * (1 - NIMUSHI.ascentSpeed / def.projectileSpeed) - contactBegins) / closing;
    };
    expect(windowOf('shotgun')).toBeLessThan(windowOf('machine') * 0.6);
    expect(windowOf('puncher')).toBeLessThan(windowOf('shotgun'));
  });

  it('gives NIMUSHI one pace and no bursts of a second one', () => {
    // A stretch change used to haul it up by `transitionSpeed` on top of the ascent. At 280 that
    // would be 540px/s against a player whose terminal here is 520: uncatchable, whatever they do.
    expect(TRANSITION_HAUL.enabled).toBe(false);
    expect(NIMUSHI.ascentSpeed + NIMUSHI.transitionSpeed).toBeGreaterThan(BOSS_PHYSICS.maxFallSpeed);
    // ...and the number is still there, so the mechanic can come back if the pace ever changes.
    expect(NIMUSHI.transitionSpeed).toBeGreaterThan(0);
  });

  it('cannot be sailed straight past and left behind', () => {
    // Not the safe-distance controller returning: this does nothing until the player is already
    // inside the body. Without it a stomping player climbs through NIMUSHI and out of the fight.
    const g = arena(601);
    g.player.invincible = 9;
    for (let i = 0; i < 6 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.player.vy = -520;
      g.step(STEP, 0, false);
    }
    expect(g.boss.reach(g.player.y)).toBeGreaterThan(-NIMUSHI.bodyHeight);
  });
});

describe('the arena always has something to stand on', () => {
  it('never runs out of stompable targets', () => {
    const g = arena(602);
    tick(g, 1);
    let fewest = 99, empty = 0;
    for (let i = 0; i < 12 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.step(STEP, 0, false);
      const live = g.enemies.filter(e => e.alive && e.stompable).length;
      fewest = Math.min(fewest, live);
      if (live === 0) empty++;
    }
    expect(empty).toBe(0);
    expect(fewest).toBeGreaterThan(0);
  });

  it('lays them with variation rather than as a ladder', () => {
    const g = arena(603);
    tick(g, 6);
    const xs = g.enemies.filter(e => e.kind === 'bounceTapioca').map(e => Math.round(e.x));
    expect(xs.length).toBeGreaterThan(3);
    expect(new Set(xs).size).toBeGreaterThan(2);
  });

  it('starts the fight with one already in reach', () => {
    const g = arena(604);
    expect(g.enemies.some(e => e.kind === 'bounceTapioca' && e.alive)).toBe(true);
  });
});

describe('a player who stomps survives, on the run\'s own rules', () => {
  it('holds their height, keeps CHARGE, and stays in the fight', () => {
    const g = arena(605);
    tick(g, 1);
    let stomps = 0, empty = 0;
    for (let i = 0; i < 20 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      const target = g.enemies.filter(e => e.alive && e.stompable)
        .sort((a, b) => Math.abs(a.y - g.player.y) - Math.abs(b.y - g.player.y))[0];
      const dir = target ? Math.sign(target.x - g.player.x) : 0;
      const before = g.kills;
      g.step(STEP, dir, false);
      if (g.kills > before) stomps++;
      if (g.ammo === 0) empty++;
    }
    expect(g.state).toBe('boss');
    expect(stomps).toBeGreaterThan(5);
    expect(empty).toBe(0);
  });

  it('uses the run\'s own stomp: kill, bounce against the pull, full magazine, no landing', () => {
    const g = arena(606);
    tick(g, 1);
    const target = g.enemies.find(e => e.alive && e.stompable)!;
    expect(target).toBeDefined();
    g.ammo = 0;
    g.combo = 2;
    g.player.x = target.x;
    g.player.y = target.y - 26 * g.gravitySign;
    g.player.vy = -520;
    g.player.grounded = -1;
    for (let i = 0; i < 12 && target.alive; i++) g.step(STEP, 0, false);
    expect(target.alive).toBe(false);
    expect(g.ammo).toBe(g.stats.maxAmmo);
    expect(along(g)).toBeLessThan(0);
    expect(g.player.grounded).toBe(-1);
    expect(g.combo).toBe(3);
  });
});

describe('the drop below is the other edge', () => {
  it('ends the run when the player falls past the view', () => {
    const g = arena(607);
    tick(g, 1);
    g.player.y = g.cameraY + WORLD.height + ARENA_FLOOR.margin + 20;
    g.step(STEP, 0, false);
    expect(g.state).toBe('over');
    expect(g.health.deathCause?.cause).toBe('crush');
  });

  it('is a fixed rule, not something that chases the player', () => {
    const g = arena(608);
    tick(g, 1);
    // Comfortably inside the view: nothing happens, however long the player lingers there.
    const hp = g.hp;
    for (let i = 0; i < 6 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.player.y = g.cameraY + WORLD.height * 0.8;
      g.step(STEP, 0, false);
    }
    expect(g.state).toBe('boss');
    expect(g.hp).toBe(hp);
  });
});

describe('the prototype runs on gravity and the weak point alone', () => {
  /**
   * ONE ROUND, ONE PEARL.
   *
   * The emergency exit from a shower the player did not read in time, and the reason the attack is
   * answerable by the run's own verbs rather than by dodging alone. It costs a round from the
   * magazine they were going to counterattack with, which is the price.
   *
   * Deliberately NOT a screen clear: the round dies on the pearl even with piercing left, or a
   * LASER would wipe a whole wave and the pattern would stop mattering.
   */
  it('lets one round take down one pearl, and no more', () => {
    const g = arena(630);
    const wave = (g.boss as unknown as { spawnShowerWave(r: () => number): number[] }).spawnShowerWave(seeded(9));
    const pearls = g.boss.tapiocas.filter(t => t.life > 0);
    expect(pearls.length).toBeGreaterThan(4);
    expect(wave.length).toBe(TAPIOCA_SHOWER.safeLanes);
    // A round with piercing to spare, placed on one pearl in a column of them.
    const aim = pearls[0];
    const near = pearls.filter(t => Math.abs(t.x - aim.x) < 1).length;
    expect(near).toBeGreaterThan(0);
    const shot = round(aim.x, aim.y, 1);
    shot.pierce = 9;
    g.bullets.push(shot);
    g.step(STEP, 0, false);
    expect(g.boss.tapiocas.filter(t => t.life > 0).length).toBe(pearls.length - 1);
    expect(shot.alive).toBe(false);
  });

  it('never builds a wave with no way through it', () => {
    const g = arena(631);
    const fight = g.boss as unknown as { spawnShowerWave(r: () => number): number[] };
    const roll = seeded(10);
    for (let i = 0; i < 40; i++) {
      g.boss.tapiocas = [];
      const safe = fight.spawnShowerWave(roll);
      expect(safe.length).toBe(TAPIOCA_SHOWER.safeLanes);
      // Adjacent, so the corridor is one place to stand rather than three slits.
      const sorted = [...safe].sort((a, b) => a - b);
      expect(sorted[sorted.length - 1] - sorted[0]).toBe(TAPIOCA_SHOWER.safeLanes - 1);
      // ...and nothing was spawned in it.
      const shaft = WORLD.width - WORLD.wall * 2;
      for (const t of g.boss.tapiocas) {
        const lane = Math.floor(((t.x - WORLD.wall) / shaft) * TAPIOCA_SHOWER.lanes);
        expect(safe.includes(lane)).toBe(false);
      }
    }
  });

  /**
   * C. Every weapon can reach the eye DURING a shower, not only between them.
   *
   * Driven by real rounds from each weapon's own firing distance, because the three that matter
   * here are exactly the three the C1 geometry was measured for: the long one that was always fine
   * and the two short ones that only just became usable.
   */
  it('lets MACHINE, SHOTGUN and PUNCHER all hit the weak point during a shower', () => {
    for (const [id, reach] of [['machine', 400], ['shotgun', 200], ['puncher', 190]] as const) {
      const g = arena(640);
      g.gun.equip(id as GunModuleId);
      g.reloadCharge();
      const machine = g.boss as unknown as { state: string; timer: number; pendingAttack: string; waveTimer: number };
      machine.pendingAttack = 'tapiocaShower';
      machine.state = 'tapiocaShower';
      machine.timer = 2.4;
      machine.waveTimer = 0;
      expect(g.boss.eyeOpen).toBe(true);
      const hp = g.boss.hp;
      let landed = false;
      for (let i = 0; i < 1.6 / STEP && !landed; i++) {
        g.player.invincible = 9;
        g.player.vy = 0;
        g.player.x = g.boss.x;
        g.player.y = g.boss.face + reach;
        g.ammo = g.stats.maxAmmo;
        g.step(STEP, 0, i % 8 < 4);
        if (g.boss.hp < hp) landed = true;
      }
      expect(landed, `${id} could not reach the eye during a shower`).toBe(true);
    }
  });

  /**
   * D. Shooting a pearl and shooting the boss are the same trigger, and neither eats the other.
   *
   * A round that meets a pearl dies on it; a round that meets nothing carries on to the eye. The
   * failure this guards against is a pearl pass that swallows every round in flight.
   */
  it('lets a round pass a shower and still reach the eye', () => {
    const g = arena(641);
    const machine = g.boss as unknown as { state: string; timer: number; waveTimer: number };
    machine.state = 'tapiocaShower'; machine.timer = 2.4;
    (g.boss as unknown as { spawnShowerWave(r: () => number): number[] }).spawnShowerWave(seeded(11));
    // Hold the next wave off, or the step under test would spawn one and the count would move for
    // a reason that has nothing to do with the round.
    machine.waveTimer = TAPIOCA_SHOWER.waveInterval;
    const before = g.boss.tapiocas.filter(t => t.life > 0).map(t => t.id);
    expect(before.length).toBeGreaterThan(0);
    // A round on the eye, in a frame where pearls are also in the air.
    const hp = g.boss.hp;
    g.bullets.push(round(g.boss.x, g.boss.eye.y + g.boss.eye.height / 2, 1));
    g.step(STEP, 0, false);
    expect(g.boss.hp).toBe(hp - 1);
    // ...and every pearl that was in the air still is: hitting the boss is not a screen clear.
    const after = new Set(g.boss.tapiocas.filter(t => t.life > 0).map(t => t.id));
    for (const id of before) expect({ id, alive: after.has(id) }).toEqual({ id, alive: true });
  });

  it('closes the eye again once the shower is over', () => {
    const g = arena(642);
    let sawShowerOpen = false, sawShutAfter = false, was = '';
    for (let i = 0; i < 40 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      if (g.player.y - g.cameraY > WORLD.height * 0.9) g.player.y = g.cameraY + WORLD.height * 0.6;
      const target = g.enemies.filter(e => e.alive && e.y < g.player.y).sort((a, b) => b.y - a.y)[0];
      g.step(STEP, target ? Math.sign(target.x - g.player.x) as -1 | 0 | 1 : 0, false);
      if (g.boss.state === 'tapiocaShower' && g.boss.eyeOpen) sawShowerOpen = true;
      if (was === 'tapiocaShower' && g.boss.state !== 'tapiocaShower') {
        // Back to the ordinary cycle: recovery, with the eye shut until it reopens.
        expect(g.boss.state).toBe('recovery');
        if (!g.boss.eyeOpen) sawShutAfter = true;
      }
      was = g.boss.state;
    }
    expect(sawShowerOpen).toBe(true);
    expect(sawShutAfter).toBe(true);
  });

  it('has SHOWER back, and only SHOWER', () => {
    for (const phase of ABYSS_PHASES) {
      expect({ id: phase.id, rotation: [...phase.attacks] }).toEqual({ id: phase.id, rotation: ['tapiocaShower'] });
    }
    // The other three are still whole enough to switch back on, one entry at a time.
    expect(NIMUSHI.eyeWindow.timeout).toBeGreaterThan(0);
  });

  it('still cycles the eye, so the weak point still has a window', () => {
    const g = arena(609);
    const seen = new Set<string>();
    // Read the HP DURING the fight. Losing the run tears the boss down and restores its HP, so a
    // reading taken afterwards says 120 whatever happened in between.
    let lowest: number = NIMUSHI.maxHp;
    for (let i = 0; i < 30 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      // Stomp what is there, so the player stays in the fight long enough to use the windows.
      const target = g.enemies.filter(e => e.alive && e.stompable)
        .sort((a, b) => Math.abs(a.y - g.player.y) - Math.abs(b.y - g.player.y))[0];
      const dir = target ? Math.sign(target.x - g.player.x) : 0;
      if (g.boss.eyeOpen && i % 10 === 0) g.bullets.push(round(g.boss.x, g.boss.eye.y + g.boss.eye.height / 2, 2));
      g.step(STEP, dir, false);
      seen.add(g.boss.state);
      lowest = Math.min(lowest, g.boss.hp);
    }
    expect(seen.has('eyeOpen')).toBe(true);
    expect(lowest).toBeLessThan(NIMUSHI.maxHp);
  });

  it('lets every weapon damage the eye', () => {
    for (const id of Object.keys(GUN_MODULES) as GunModuleId[]) {
      const g = arena(610);
      g.gun.equip(id);
      const before = g.boss.hp;
      g.bullets.push(round(g.boss.x, g.boss.eye.y + g.boss.eye.height / 2, 1));
      g.step(STEP, 0, false);
      expect({ id, hit: g.boss.hp < before }).toEqual({ id, hit: true });
    }
  });
});

/**
 * FINAL RAGE: the curtain is off, the framework is not.
 *
 * The prototype is answering whether reversed gravity plus the run's own verbs is a fight, and a
 * screen of pearls below 25% HP would put a bullet-hell mechanic back into that answer. The rage
 * STATE still happens -- threshold, cut-in, line, pose -- so the shape of the fight is intact and
 * switching the pearls back on is one flag.
 */
describe('FINAL RAGE is framework-only in the prototype', () => {
  it('has the curtain switched off at the data', () => {
    expect(FULL_SCREEN_TAPIOCA.enabled).toBe(false);
    // ...and every number it needs to come back is still there.
    expect(FULL_SCREEN_TAPIOCA.corridor).toBeGreaterThanOrEqual(2);
    expect(FULL_SCREEN_TAPIOCA.lanes).toBeGreaterThan(FULL_SCREEN_TAPIOCA.corridor);
    expect(FULL_SCREEN_TAPIOCA.waveInterval).toBeGreaterThan(0);
  });

  it('still enters the rage state, and the curtain pours nothing of its own', () => {
    const g = arena(611);
    // Four waves of an ordinary shower can be in the air at once, two pearls per closed lane.
    const showerCeiling = 4 * (TAPIOCA_SHOWER.lanes - TAPIOCA_SHOWER.safeLanes) * 2;
    g.boss.hp = Math.round(NIMUSHI.maxHp * FINAL_RAGE_RATIO) - 1;
    let raged = false, pearls = 0;
    for (let i = 0; i < 20 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      const target = g.enemies.filter(e => e.alive && e.stompable)
        .sort((a, b) => Math.abs(a.y - g.player.y) - Math.abs(b.y - g.player.y))[0];
      if (g.boss.eyeOpen && i % 20 === 0) g.bullets.push(round(g.boss.x, g.boss.eye.y + g.boss.eye.height / 2, 1));
      g.step(STEP, target ? Math.sign(target.x - g.player.x) : 0, false);
      if (g.boss.raged) raged = true;
      pearls = Math.max(pearls, g.boss.tapiocas.filter(t => t.life > 0).length);
    }
    expect(raged).toBe(true);
    // The CURTAIN pours nothing. SHOWER is back in the rotation, so pearls do exist now -- what is
    // asserted is that FINAL RAGE adds none of its own, which is the switch being off.
    expect(FULL_SCREEN_TAPIOCA.enabled).toBe(false);
    expect(g.boss.rageActive).toBe(false);
    expect(pearls).toBeLessThanOrEqual(showerCeiling);
  });
});
