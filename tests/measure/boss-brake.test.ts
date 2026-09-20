import { describe, it } from 'vitest';
import { fighting, STEP } from '../nimushi';
import { NIMUSHI } from '../../src/data/nimushi';

/** Two ways to play the arena: never touch the trigger, or use the gunboots as a brake. */
describe('gap probe', () => {
  const run = (seed: number, brake: boolean, seconds: number) => {
    const g = fighting(seed);
    let minFace = 1e9, touched = -1;
    for (let i = 0; i < seconds / STEP && g.state === 'boss'; i++) {
      g.player.invincible = 9;
      g.ammo = g.stats.maxAmmo;                         // resources are not what is being measured
      g.step(STEP, 0, brake);
      const f = g.boss.reach(g.player.y);
      minFace = Math.min(minFace, f);
      if (touched < 0 && f <= 0) touched = i * STEP;
    }
    return { minFace: Math.round(minFace), touched, end: g.state };
  };
  it('compares a braking player with one who never fires', () => {
    for (const seed of [36, 40, 41]) {
      const drift = run(seed, false, 45);
      const held = run(seed, true, 45);
      console.log(`PB seed ${seed} | never fires: closest ${drift.minFace}px, body at ${drift.touched < 0 ? 'never' : drift.touched.toFixed(1) + 's'} (${drift.end})`);
      console.log(`PB seed ${seed} | brakes:      closest ${held.minFace}px, body at ${held.touched < 0 ? 'never' : held.touched.toFixed(1) + 's'} (${held.end})`);
    }
    console.log(`PB minGap ${NIMUSHI.minGap} restGap ${NIMUSHI.restGap}`);
  });
});
