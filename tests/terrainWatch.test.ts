import { describe, it, expect } from 'vitest';
import { TerrainWatch } from '../src/dev/TerrainWatch';
import { BreakablePlatformSystem, BREAK_RULES } from '../src/systems/BreakablePlatformSystem';
import type { Platform } from '../src/systems/StageGenerator';

const ledge = (id: number, y: number, breakable = true): Platform =>
  ({ id, x: 100, y, width: 150, breakable, state: 'stable' } as Platform);

describe('terrain watch', () => {
  it('says nothing while the terrain behaves', () => {
    const w = new TerrainWatch();
    const rows = [ledge(1, 100), ledge(2, 300), ledge(3, 500)];
    for (let i = 0; i < 60; i++) w.observe(rows, 0, '1-1', i / 60);
    expect(w.events).toHaveLength(0);
  });

  it('ignores rows scrolling into view, which is what hid the signal before', () => {
    const w = new TerrainWatch();
    for (let i = 0; i < 40; i++) {
      // A fresh window of five rows every frame: everything is new, nothing has changed.
      w.observe([ledge(i * 5, 100), ledge(i * 5 + 1, 300), ledge(i * 5 + 2, 500)], i * 20, '1-1', i / 60);
    }
    expect(w.events).toHaveLength(0);
  });

  it('catches a geometry mutation, which must never happen', () => {
    const w = new TerrainWatch();
    const rows = [ledge(1, 100), ledge(2, 300)];
    w.observe(rows, 0, '1-1', 0);
    rows[1].width = 60;                       // the bug the report would imply
    w.observe(rows, 0, '1-1', 0.1);
    expect(w.events.map(e => e.kind)).toEqual(['GEOMETRY MUTATION']);
    expect(w.events[0].detail).toContain('-> 100,300,60');
  });

  it('catches a bulk restyle when several ledges change in one frame', () => {
    const w = new TerrainWatch();
    const collapse = new BreakablePlatformSystem();
    // Deliberately TIGHTER than the game's median so the shatter definitely spans rows -- this test
    // is about the watcher noticing, not about how often the game produces the arrangement.
    const rows = [ledge(1, 300), ledge(2, 400), ledge(3, 500), ledge(4, 560)];
    w.observe(rows, 0, '4-1', 0);
    const hit = collapse.shatter(rows, 175, 430);
    w.observe(rows, 0, '4-1', 0.02);
    expect(hit.length).toBeGreaterThanOrEqual(w.bulkThreshold);
    expect(w.events.map(e => e.kind)).toEqual(['BULK RESTYLE']);
    expect(w.events[0].detail).toContain('stable|B|-|-|-|- => cracking|B|-|-|-|-');
    // And it names the frame and the SECTION, so a dump can be lined up against what was on screen.
    expect(w.events[0].where).toBe('4-1');
  });

  it('a single ledge cracking under the player is gameplay, not a report', () => {
    const w = new TerrainWatch();
    const collapse = new BreakablePlatformSystem();
    const rows = [ledge(1, 200), ledge(2, 400), ledge(3, 600), ledge(4, 800)];
    w.observe(rows, 0, '4-1', 0);
    collapse.land(rows[0]);
    w.observe(rows, 0, '4-1', 0.02);
    expect(w.events).toHaveLength(0);
  });

  /**
   * This started life as an assertion that RUIN BREAKER routinely cracks several rows at once, which
   * was my explanation for the "blocks all change" report. Measuring the generator refuted it: the
   * median gap between levels is 245px and only about 3% of gaps are within the 190px radius, so a
   * kill almost always reaches its OWN row and no other. The test is kept, inverted, to pin the fact
   * that killed the hypothesis -- so that if someone later widens the radius or tightens the rows,
   * the candidate comes back into play loudly instead of silently.
   */
  it('a shatter at the MEASURED row spacing reaches one row, not three', () => {
    const collapse = new BreakablePlatformSystem();
    const rows = [ledge(1, 155), ledge(2, 400), ledge(3, 645)];   // 245px apart, the measured median
    expect(collapse.shatter(rows, 175, 400)).toHaveLength(1);
    expect(BREAK_RULES.shatterRadius).toBeLessThan(245);
  });
});
