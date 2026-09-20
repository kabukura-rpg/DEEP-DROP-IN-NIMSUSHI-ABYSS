import { describe, it } from 'vitest';
import { fighting, STEP } from '../nimushi';
import { NIMUSHI } from '../../src/data/nimushi';
import { BOSS_PHYSICS } from '../../src/data/bossPhysics';

/**
 * BOSS KINEMATICS. What the gap between the player and NIMUSHI actually does, with no input at all
 * -- which is the case the human report is about: being pulled into the body by gravity alone.
 */
describe('player / NIMUSHI relative motion', () => {
  it('measures the gap over an unplayed fight', () => {
    const g = fighting(30);
    const face = () => g.boss.reach(g.player.y);
    const start = face();
    let tMin = -1, tBody = -1, tDead = -1, peakAscent = 0, minSeen = 1e9;
    const trace: string[] = [];
    for (let i = 0; i < 20 / STEP; i++) {
      g.step(STEP, 0, false);
      const gap = face();
      minSeen = Math.min(minSeen, gap);
      peakAscent = Math.max(peakAscent, Math.abs(g.player.vy));
      if (tMin < 0 && gap <= NIMUSHI.minGap) tMin = i * STEP;
      if (tBody < 0 && gap <= 0) tBody = i * STEP;
      if (tDead < 0 && g.state !== 'boss') { tDead = i * STEP; break; }
      if (i % 60 === 0 && trace.length < 10) {
        trace.push(`t${(i * STEP).toFixed(1)} gap${Math.round(gap)} pvy${Math.round(g.player.vy)} bvy?${Math.round(g.boss.y)}`);
      }
    }
    console.log(`GAP boss terminal ${BOSS_PHYSICS.maxFallSpeed} | NIMUSHI ascent ${NIMUSHI.ascentSpeed} retreat ${NIMUSHI.retreatSpeed}`);
    console.log(`GAP rest ${NIMUSHI.restGap} min ${NIMUSHI.minGap} max ${NIMUSHI.maxGap} | start gap ${Math.round(start)}`);
    console.log(`GAP closes at up to ${BOSS_PHYSICS.maxFallSpeed - NIMUSHI.ascentSpeed}px/s while NIMUSHI cruises, ${BOSS_PHYSICS.maxFallSpeed - NIMUSHI.retreatSpeed}px/s while it retreats`);
    console.log(`GAP peak player ascent ${Math.round(peakAscent)}px/s | closest ${Math.round(minSeen)}px`);
    console.log(`GAP reaches minGap at ${tMin < 0 ? 'never' : tMin.toFixed(2) + 's'} | body contact at ${tBody < 0 ? 'never' : tBody.toFixed(2) + 's'} | run ends at ${tDead < 0 ? 'still alive at 20s' : tDead.toFixed(2) + 's'}`);
    trace.forEach(t => console.log('GAP  ' + t));
  });

  it('measures the pressure boundary over the same window', () => {
    const g = fighting(31);
    let minSlack = 1e9;
    for (let i = 0; i < 10 / STEP && g.state === 'boss'; i++) {
      g.step(STEP, 0, false);
      minSlack = Math.min(minSlack, g.boss.slack);
    }
    console.log(`PRESSURE minimum slack over 10s of no input: ${Math.round(minSlack)}px (state ${g.state})`);
  });
});
