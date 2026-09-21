import { describe, expect, it } from 'vitest';
import { fighting, round, seeded, STEP, tick } from './nimushi';
import { GameModel } from '../src/systems/GameModel';
import { ABYSS_PHASES, ARENA_FLOOR } from '../src/data/abyss';
import { NIMUSHI } from '../src/data/nimushi';
import { WORLD } from '../src/data/balance';
import { GUN_MODULES, type GunModuleId } from '../src/data/gunModules';

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
    expect(NIMUSHI.ascentSpeed).toBeLessThan(520);
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
