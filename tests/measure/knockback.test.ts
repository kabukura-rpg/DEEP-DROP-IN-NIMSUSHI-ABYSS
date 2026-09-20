import { describe, it } from 'vitest';
import { fighting, STEP, tick } from '../nimushi';
import { BOSS_PHYSICS } from '../../src/data/bossPhysics';

/**
 * WHICH WAY DOES THE KNOCKBACK ACTUALLY MOVE THE PLAYER?
 *
 * Reported as "away from NIMUSHI, and never toward the deep". In the inverted arena NIMUSHI is
 * ABOVE and the deep is BELOW, so those two cannot both be true. Measured rather than argued.
 */
describe('hazard knockback direction', () => {
  it('logs the real coordinates either side of a hit', () => {
    const g = fighting(80);
    tick(g, 2);
    const boss = g as unknown as { along(v: number): number };
    const deep = g.boss.deepY;
    const before = {
      gravity: g.gravitySign,
      playerY: Math.round(g.player.y),
      bossY: Math.round(g.boss.y),
      deepY: Math.round(deep),
      vy: Math.round(g.player.vy),
      toBoss: Math.round(g.boss.reach(g.player.y)),
      toDeep: Math.round(boss.along(g.player.y - deep)),
      slack: Math.round(g.boss.slack),
    };
    g.player.invincible = 0;
    g.damage(1, 'bossContact');
    const hitVy = Math.round(g.player.vy);
    // Let it actually move for a quarter second, which is what the player experiences.
    for (let i = 0; i < 0.25 / STEP; i++) { g.player.invincible = 9; g.step(STEP, 0, false); }
    const after = {
      playerY: Math.round(g.player.y),
      bossY: Math.round(g.boss.y),
      deepY: Math.round(g.boss.deepY),
      vy: Math.round(g.player.vy),
      toBoss: Math.round(g.boss.reach(g.player.y)),
      toDeep: Math.round(boss.along(g.player.y - g.boss.deepY)),
      slack: Math.round(g.boss.slack),
    };
    console.log(`KB gravity sign ${before.gravity} (NIMUSHI above = smaller y, deep below = larger y)`);
    console.log(`KB BEFORE player y${before.playerY} | NIMUSHI y${before.bossY} | deep y${before.deepY} | vy ${before.vy}`);
    console.log(`KB BEFORE distance to NIMUSHI ${before.toBoss}px | distance to deep ${before.toDeep}px | slack ${before.slack}`);
    console.log(`KB ON HIT  vy ${before.vy} -> ${hitVy}  (knockback constant ${BOSS_PHYSICS.hazardKnockback})`);
    console.log(`KB screen direction: vy ${hitVy > 0 ? 'POSITIVE = moving DOWN the screen' : 'NEGATIVE = moving UP the screen'}`);
    console.log(`KB AFTER 0.25s player y${after.playerY} (${after.playerY > before.playerY ? 'moved DOWN' : 'moved UP'} ${Math.abs(after.playerY - before.playerY)}px)`);
    console.log(`KB AFTER distance to NIMUSHI ${after.toBoss}px (${after.toBoss > before.toBoss ? '+' : ''}${after.toBoss - before.toBoss})`);
    console.log(`KB AFTER distance to deep ${after.toDeep}px (${after.toDeep > before.toDeep ? '+' : ''}${after.toDeep - before.toDeep})`);
    const middle = Math.round((g.boss.face + g.boss.deepY) / 2);
    console.log(`KB band middle y${middle}; the player started ${before.playerY < middle ? 'ABOVE it (crowding NIMUSHI)' : 'BELOW it (near the deep)'}`);
    console.log(`KB VERDICT: moves the player ${after.toBoss > before.toBoss ? 'AWAY FROM NIMUSHI' : 'TOWARD NIMUSHI'} and ${after.toDeep < before.toDeep ? 'TOWARD THE DEEP' : 'AWAY FROM THE DEEP'} -- toward the middle either way`);
  });

  it('lifts a player who is hit down near the deep', () => {
    const g = fighting(82);
    tick(g, 2);
    const boss = g as unknown as { along(v: number): number };
    // Put the player low in the band, which is where the old knockback was most dangerous.
    g.player.y = g.boss.deepY - 120 * g.gravitySign;
    const middle = Math.round((g.boss.face + g.boss.deepY) / 2);
    const beforeDeep = Math.round(boss.along(g.player.y - g.boss.deepY));
    console.log(`KB3 player y${Math.round(g.player.y)} | band middle y${middle} | deep y${Math.round(g.boss.deepY)} | distance to deep ${beforeDeep}px`);
    g.player.invincible = 0;
    g.damage(1, 'bossContact');
    console.log(`KB3 on hit vy -> ${Math.round(g.player.vy)} (${g.player.vy < 0 ? 'UP the screen, away from the deep' : 'DOWN the screen, into the deep'})`);
    for (let i = 0; i < 0.25 / STEP; i++) { g.player.invincible = 9; g.step(STEP, 0, false); }
    const afterDeep = Math.round(boss.along(g.player.y - g.boss.deepY));
    console.log(`KB3 distance to deep ${beforeDeep} -> ${afterDeep} (${afterDeep > beforeDeep ? 'SAFER' : 'closer to the deep'})`);
  });

  it('measures the worst case: repeated hits with the deep already close', () => {
    const g = fighting(81);
    tick(g, 2);
    const boss = g as unknown as { along(v: number): number };
    const toDeep = () => Math.round(boss.along(g.player.y - g.boss.deepY));
    console.log(`KB2 starting distance to deep ${toDeep()}px`);
    let worst = toDeep();
    for (let n = 0; n < 4 && g.state === 'boss'; n++) {
      g.player.invincible = 0;
      g.damage(1, 'bossContact');
      for (let i = 0; i < 0.4 / STEP && g.state === 'boss'; i++) { g.player.invincible = 9; g.step(STEP, 0, false); }
      worst = Math.min(worst, toDeep());
      console.log(`KB2 hit ${n + 1}: distance to deep ${toDeep()}px, state ${g.state}, hp ${g.hp}`);
    }
    console.log(`KB2 closest the deep ever got: ${worst}px | death cause ${g.health.deathCause?.cause ?? 'none'}`);
  });
});
