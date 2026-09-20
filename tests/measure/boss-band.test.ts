import { describe, it } from 'vitest';
import { fighting, STEP, tick } from '../nimushi';
import { NIMUSHI } from '../../src/data/nimushi';
import { WORLD } from '../../src/data/balance';
import { GUN_MODULES } from '../../src/data/gunModules';

/** Where everything actually sits on screen once NIMUSHI holds a band. */
describe('the boss band', () => {
  it('reports the screen layout through a fight', () => {
    const g = fighting(120);
    tick(g, 2);
    const shot = (label: string) => {
      const scr = (y: number) => Math.round(y - g.cameraY);
      console.log(`BAND ${label}: NIMUSHI ${scr(g.boss.y)} (${Math.round((g.boss.y - g.cameraY) / WORLD.height * 100)}%) | face ${scr(g.boss.face)} | player ${scr(g.player.y)} (${Math.round((g.player.y - g.cameraY) / WORLD.height * 100)}%) | deep ${scr(g.boss.deepY)} | reach ${Math.round(g.boss.reach(g.player.y))}px`);
    };
    shot('settled');
    let minReach = Infinity, maxReach = 0, minPlayerScreen = Infinity;
    for (let i = 0; i < 25 / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.step(STEP, Math.sin(i / 70) > 0 ? 1 : -1, i % 200 < 60);
      const r = g.boss.reach(g.player.y);
      minReach = Math.min(minReach, r); maxReach = Math.max(maxReach, r);
      minPlayerScreen = Math.min(minPlayerScreen, g.player.y - g.cameraY);
    }
    shot('after 25s of play');
    console.log(`BAND reach over the fight: min ${Math.round(minReach)}px, max ${Math.round(maxReach)}px`);
    console.log(`BAND highest the player ever got on screen: ${Math.round(minPlayerScreen)} of ${WORLD.height}`);
    console.log(`BAND weapon reach: ${Object.values(GUN_MODULES).map(m => `${m.short} ${m.range}`).join(' | ')}`);
    console.log(`BAND attack ${NIMUSHI.attackBand} (${Math.round(NIMUSHI.attackBand * WORLD.height)}px) | damage ${NIMUSHI.damageBand} (${Math.round(NIMUSHI.damageBand * WORLD.height)}px)`);
  });
});
