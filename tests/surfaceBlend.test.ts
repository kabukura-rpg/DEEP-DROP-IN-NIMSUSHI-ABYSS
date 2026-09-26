import { describe, expect, it } from 'vitest';
import { SURFACE_BLEND, surfaceLayerAlphas, surfaceWeight } from '../src/render/surfaceBlend';
import { GameModel } from '../src/systems/GameModel';

/** AREA 1's surface backdrop: full to 120m, crossfaded over 120-220m, gone from 220m. */
describe('the surface backdrop', () => {
  it('holds, crossfades and hands over on total depth', () => {
    expect(SURFACE_BLEND).toMatchObject({ holdTo: 120, fadeTo: 220 });
    expect(surfaceWeight(0, 1)).toBe(1);
    expect(surfaceWeight(120, 1)).toBe(1);
    expect(surfaceWeight(170, 1)).toBeCloseTo(0.5, 6);
    expect(surfaceWeight(220, 1)).toBe(0);
    expect(surfaceWeight(900, 1)).toBe(0);
    // Smooth at both ends and falling all the way.
    let last = 1;
    for (let d = 120; d <= 220; d += 5) { const w = surfaceWeight(d, 1); expect(w).toBeLessThanOrEqual(last); last = w; }
  });

  it('is AREA 1 only', () => {
    for (const area of [2, 3, 4, 'boss'] as const) expect(surfaceWeight(0, area)).toBe(0);
  });

  it('never returns on a later SECTION: 1-2 already starts below 220m', () => {
    const game = new GameModel();
    game.jumpToStage(1, 2);
    expect(game.totalDepth).toBeGreaterThanOrEqual(SURFACE_BLEND.fadeTo);
    expect(surfaceWeight(game.totalDepth, game.stage.config.id)).toBe(0);
  });

  it('keeps the underground at its own weight under the surface, so the fade never dips darker', () => {
    const under = 0.4;
    for (const w of [0, 0.25, 0.5, 0.75, 1]) {
      const { surface, underground } = surfaceLayerAlphas(w, under);
      expect(surface).toBeCloseTo(SURFACE_BLEND.alpha * w, 9);
      // What of the underground still shows through the surface layer drawn over it.
      expect(underground * (1 - surface)).toBeCloseTo(under * (1 - w), 9);
    }
  });
});
