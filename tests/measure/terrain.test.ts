import { describe, it } from 'vitest';
import { GameModel } from '../../src/systems/GameModel';
import { AREAS } from '../../src/data/areas';
import { WORLD } from '../../src/data/balance';

/**
 * TERRAIN CENSUS -- measurement tooling, not an assertion suite.
 *
 * Every earlier count in this project used its own denominator, so two audits disagreed about how
 * many "rows" a SECTION has without either being wrong. The vocabulary is fixed here and every
 * later measurement uses these words:
 *
 *   PIECE          one entry in model.platforms. The atom the renderer and collision see.
 *   GATE BLOCK     a piece carrying `breakBlock`. A gate ROW is five of them sharing one y.
 *   GATE ROW       the五-block wall across the shaft, counted once.
 *   HAZARD PIECE   a piece carrying `limboHazard`. Never landable -- not a floor at all.
 *   CHAMBER FLOOR  a piece carrying `safeZone`. Landable, reloads, does not settle a chain.
 *   ROUTE LEDGE    an ordinary landable piece: not a gate block, not a hazard, not a chamber floor.
 *                  This is what "platform" meant in the first audit.
 *   TRAP LEDGE     a ROUTE LEDGE carrying `spikePlatform`. A subset of route ledges, not extra.
 *   LEVEL          a distinct y at which any piece sits.
 */
const seeded = (s: number) => () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
const SEEDS = 25;

describe('terrain census', () => {
  it('counts every category with one agreed vocabulary', () => {
    console.log('AREA-SEC | pieces | routeLedge | trapLedge | gateBlock | gateRow | hazardPiece | chamberFloor | levels | pieces/level | density');
    for (const a of AREAS) {
      for (let sec = 1; sec <= a.sections; sec++) {
        let pieces = 0, route = 0, trap = 0, gate = 0, hazard = 0, chamber = 0, levels = 0;
        for (let s = 0; s < SEEDS; s++) {
          const g = new GameModel(false, seeded(s * 131 + 5));
          g.jumpToStage(a.id, sec as 1 | 2 | 3);
          const seen = new Set<number>(); const ys = new Set<number>(); const gateYs = new Set<number>();
          // Generation runs a screen AHEAD of the camera, so driving the camera to the section end
          // lays rows past it. Count only pieces whose y is inside the section, or every figure here
          // is inflated by roughly one screen of the next one.
          const end = WORLD.startY + a.sectionLength * WORLD.pixelsPerMeter;
          while (g.cameraY < end) {
            g.cameraY += 240;
            (g as unknown as { generate(): void }).generate();
            for (const p of g.platforms) {
              if (seen.has(p.id)) continue; seen.add(p.id);
              if (p.y > end) continue;
              pieces++; ys.add(Math.round(p.y));
              if (p.breakBlock) { gate++; gateYs.add(Math.round(p.y)); continue; }
              if (p.limboHazard) { hazard++; continue; }
              if (p.safeZone !== undefined) { chamber++; continue; }
              route++; if (p.spikePlatform) trap++;
            }
          }
          levels += ys.size;
          gateYs.forEach(() => {});
        }
        const n = SEEDS, f = (v: number) => (v / n).toFixed(1).padStart(5);
        const per100 = (route / n) / (a.sectionLength / 100);
        console.log(`  ${a.id}-${sec}    |${f(pieces)} |${f(route)}      |${f(trap)}     |${f(gate)}     |${f(gate / 5)}    |${f(hazard)}       |${f(chamber)}        |${f(levels)} | ${(pieces / levels).toFixed(2)} | ${per100.toFixed(1)} ledges/100m`);
      }
    }
  });
});
