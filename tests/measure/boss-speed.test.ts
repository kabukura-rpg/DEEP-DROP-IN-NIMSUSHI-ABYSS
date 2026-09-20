import { describe, it } from 'vitest';
import { fighting, STEP } from '../nimushi';
import { NIMUSHI } from '../../src/data/nimushi';
import { BALANCE } from '../../src/data/balance';
import { BOSS_PHYSICS } from '../../src/data/bossPhysics';

describe('NIMUSHI under the new speed', () => {
  it('what happens to an unpinned player in the arena', () => {
    const g = fighting(30);
    const hp0 = g.hp;
    let firstHit = -1, ended = -1, minGap = 1e9;
    for (let i = 0; i < 30 / STEP; i++) {
      g.step(STEP, 0, false);
      const gap = Math.abs(g.player.y - g.boss.y);
      minGap = Math.min(minGap, gap);
      if (firstHit < 0 && g.hp < hp0) firstHit = i * STEP;
      if (ended < 0 && g.state !== 'boss') { ended = i * STEP; break; }
    }
    console.log(`BOSS arena physics ${BOSS_PHYSICS.gravity}/${BOSS_PHYSICS.maxFallSpeed}/${BOSS_PHYSICS.moveSpeed} (the run is ${BALANCE.gravity}/${BALANCE.maxFallSpeed}/${BALANCE.moveSpeed} and does not reach in here)`);
    console.log(`BOSS vs NIMUSHI ascent ${NIMUSHI.ascentSpeed} / retreat ${NIMUSHI.retreatSpeed} / minGap ${NIMUSHI.minGap}`);
    console.log(`BOSS first damage at ${firstHit < 0 ? 'never' : firstHit.toFixed(2) + 's'} | fight ended at ${ended < 0 ? 'still running' : ended.toFixed(2) + 's'} | hp ${g.hp}/${hp0} | closest gap ${minGap.toFixed(0)}px`);
    console.log(`BOSS player closes the ${NIMUSHI.restGap}px rest gap in ${(NIMUSHI.restGap / BOSS_PHYSICS.maxFallSpeed).toFixed(2)}s; retreat is ${(BOSS_PHYSICS.maxFallSpeed / NIMUSHI.retreatSpeed).toFixed(2)}x slower than the approach (was ${(BALANCE.maxFallSpeed / NIMUSHI.retreatSpeed).toFixed(2)}x while the run's physics leaked in, which killed an idle player in 3.94s)`);
  });
});
