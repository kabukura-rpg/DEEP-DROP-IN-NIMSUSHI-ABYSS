import { describe, expect, it } from 'vitest';
import { fighting, round, seeded, STEP, tick } from './nimushi';
import { GameModel } from '../src/systems/GameModel';
import { ABYSS_PHASES, ARENA_FLOOR } from '../src/data/abyss';
import { FINAL_RAGE_RATIO, FULL_SCREEN_TAPIOCA, NIMUSHI, TRANSITION_HAUL } from '../src/data/nimushi';
import { WORLD } from '../src/data/balance';
import { GUN_MODULES, type GunModuleId } from '../src/data/gunModules';
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
  it('has every attack disabled, and none deleted', () => {
    for (const phase of ABYSS_PHASES) expect(phase.attacks).toHaveLength(0);
    // Still whole enough to switch back on, one entry at a time.
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

  it('still enters the rage state, and pours nothing', () => {
    const g = arena(611);
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
    expect(pearls).toBe(0);
  });
});
