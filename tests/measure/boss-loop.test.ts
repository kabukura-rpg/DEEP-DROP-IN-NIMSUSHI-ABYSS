import { describe, it } from 'vitest';
import { fighting, round, seeded, STEP, tick } from '../nimushi';
import { GameModel } from '../../src/systems/GameModel';
import { WORLD } from '../../src/data/balance';
import { ARENA_FLOOR } from '../../src/data/abyss';

/** What the prototype loop actually does with no input, and with a player who stomps. */
describe('the core loop', () => {
  it('no input: the player is carried into NIMUSHI', () => {
    const g = fighting(500);
    let contact = -1;
    for (let i = 0; i < 20 / STEP && g.state === 'boss'; i++) {
      g.enemies = [];                      // nothing to stomp: the pure fall
      g.step(STEP, 0, false);
      if (contact < 0 && g.boss.reach(g.player.y) <= 0) contact = i * STEP;
    }
    console.log(`LOOP no input, no targets: body reached at ${contact < 0 ? 'never' : contact.toFixed(2) + 's'}, hp ${g.hp}, state ${g.state}`);
  });

  it('supply: how often a stompable target is available', () => {
    // NOT `fighting()`: that helper wipes `enemies` for test isolation, which deletes the arena's
    // own opening supply and makes the fight look like it starts empty when it does not.
    const g = new GameModel(false, seeded(501));
    g.jumpToNimushi();
    g.platforms = []; g.doodads = []; g.containers = [];
    g.bullets.push(round(g.boss.x, g.boss.eye.y + g.boss.eye.height / 2, 1));
    g.step(STEP, 0, false);
    tick(g, 1);
    let minTargets = 99, frames = 0, withNone = 0, gapStart = -1, longestGap = 0, firstGapAt = -1;
    for (let i = 0; i < 12 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.step(STEP, 0, false);
      const live = g.enemies.filter(e => e.alive && e.stompable).length;
      minTargets = Math.min(minTargets, live);
      if (live === 0) { withNone++; if (gapStart < 0) gapStart = i; longestGap = Math.max(longestGap, i - gapStart + 1); }
      else gapStart = -1;
      if (live === 0 && firstGapAt < 0) firstGapAt = i;
      frames++;
    }
    console.log(`LOOP stompable targets: fewest ${minTargets}, frames with none ${withNone}/${frames}, longest gap ${(longestGap * STEP).toFixed(2)}s, first gap at ${firstGapAt < 0 ? 'never' : (firstGapAt * STEP).toFixed(2) + 's'}`);
  });

  it('a player who stomps holds their height and keeps CHARGE', () => {
    const g = fighting(502);
    tick(g, 1);
    let stomps = 0, lowAmmo = 0;
    const startReach = g.boss.reach(g.player.y);
    let minReach = startReach;
    for (let i = 0; i < 25 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      // Steer toward the nearest stompable target: the whole of the bot's intelligence.
      const t = g.enemies.filter(e => e.alive && e.stompable)
        .sort((a, b) => Math.abs(a.y - g.player.y) - Math.abs(b.y - g.player.y))[0];
      const dir = t ? Math.sign(t.x - g.player.x) : 0;
      const before = g.kills;
      g.step(STEP, dir, false);
      if (g.kills > before) stomps++;
      if (g.ammo === 0) lowAmmo++;
      minReach = Math.min(minReach, g.boss.reach(g.player.y));
    }
    console.log(`LOOP stomping bot: ${stomps} stomps in 25s, closest to NIMUSHI ${Math.round(minReach)}px, frames empty ${lowAmmo}, state ${g.state}, hp ${g.hp}`);
  });

  it('the lower boundary', () => {
    const g = fighting(503);
    tick(g, 1);
    console.log(`LOOP arena floor: ${WORLD.height} + ${ARENA_FLOOR.margin}px past the view | player screen ${Math.round(g.player.y - g.cameraY)}`);
    g.player.y = g.cameraY + WORLD.height + ARENA_FLOOR.margin + 20;
    g.step(STEP, 0, false);
    console.log(`LOOP falling past it: state ${g.state}, cause ${g.health.deathCause?.cause ?? 'none'}`);
  });
});
