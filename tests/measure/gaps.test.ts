import { describe, it } from 'vitest';
import { GameModel } from '../../src/systems/GameModel';
import { AREAS } from '../../src/data/areas';
import { WORLD } from '../../src/data/balance';
import { BREAK_RULES } from '../../src/systems/BreakablePlatformSystem';

const seeded = (s: number) => () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };

/** The spacing between consecutive LEVELS (distinct y at which anything sits), not between pieces. */
describe('level spacing', () => {
  it('measures the real vertical gap distribution per AREA', () => {
    console.log('AREA | levels | gap min/p25/med/p75/max | share within shatterRadius(190) | share a 59px jump clears');
    for (const a of AREAS) {
      const gaps: number[] = [];
      for (let s = 0; s < 30; s++) {
        const g = new GameModel(false, seeded(s * 71 + 3));
        g.jumpToStage(a.id, 1);
        const ys = new Set<number>();
        const end = WORLD.startY + a.sectionLength * WORLD.pixelsPerMeter;
        while (g.cameraY < end) {
          g.cameraY += 240; (g as unknown as { generate(): void }).generate();
          for (const p of g.platforms) if (!p.limboHazard) ys.add(Math.round(p.y));
        }
        const sorted = [...ys].sort((x, y) => x - y);
        for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] > 0) gaps.push(sorted[i] - sorted[i - 1]);
      }
      gaps.sort((x, y) => x - y);
      const q = (p: number) => gaps[Math.floor(gaps.length * p)];
      const near = gaps.filter(v => v <= BREAK_RULES.shatterRadius).length / gaps.length;
      const jumpable = gaps.filter(v => v <= 59.13).length / gaps.length;
      console.log(`  ${a.id}  | ${String(gaps.length).padStart(5)} | ${q(0)}/${q(0.25)}/${q(0.5)}/${q(0.75)}/${gaps[gaps.length - 1]} | ${(near * 100).toFixed(1)}% | ${(jumpable * 100).toFixed(1)}%`);
    }
  });
});
