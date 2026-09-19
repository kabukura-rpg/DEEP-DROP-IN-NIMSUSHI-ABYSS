import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { StageProgressionSystem } from '../src/systems/StageProgressionSystem';
import { StageGenerator } from '../src/systems/StageGenerator';
import { AREAS, TOTAL_SECTIONS, type AreaId, type SectionId, PLANNED_TOTAL_DEPTH } from '../src/data/areas';
import { WORLD, initialStats } from '../src/data/balance';
import { reachExit } from './exitHelper';
/** Reach the goal so the exit is laid, without entering it. */
function reachExitOnly(game: GameModel) {
  for (let i = 0; i < 40 && !game.exit; i++) { game.player.y = WORLD.startY + (game.sectionLength + 1 + i * 3) * WORLD.pixelsPerMeter; game.player.invincible = 99; game.step(1 / 120, 0, false); }
}

const atDepth = (metres: number) => WORLD.startY + metres * WORLD.pixelsPerMeter;
/** Descend to a section-local depth in one step, then take the choice the rest offers. */
function reachDepth(game: GameModel, metres: number) {
  game.player.y = atDepth(metres); game.player.invincible = 99; game.step(1 / 120, 0, false);
}
function clearSection(game: GameModel) {
  reachExit(game);
  const choice = game.upgrades.choices[0];
  game.selectUpgrade(choice.id);
  game.confirmUpgrade();
  return choice.id;
}

describe('stage data and progression bookkeeping', () => {
  it('describes four areas of three sections plus the final boss', () => {
    // SECTION length is a tuning value now; what must hold is the shape and that the run gets
    // longer as it goes on, so the opening stays cheap to retry and the end is a commitment.
    expect(AREAS.map(a => [a.id, a.sections])).toEqual([[1, 3], [2, 3], [3, 3], [4, 3]]);
    const lengths = AREAS.map(a => a.sectionLength);
    expect(lengths.every(n => n > 0)).toBe(true);
    for (let i = 1; i < lengths.length; i++) expect(lengths[i]).toBeGreaterThanOrEqual(lengths[i - 1]);
    expect(PLANNED_TOTAL_DEPTH).toBe(lengths.reduce((sum, n, i) => sum + n * AREAS[i].sections, 0));
    expect(AREAS.map(a => a.name)).toEqual(['SURFACE RUINS', 'SUNKEN RUINS', 'MAGMA DEPTHS', 'COLLAPSED REALM']);
    expect(TOTAL_SECTIONS).toBe(12);
  });
  it('walks 1-1 through 4-3 and then hands off to the boss exactly once', () => {
    const stage = new StageProgressionSystem();
    const visited = [stage.label];
    const areaBoundaries: string[] = [];
    for (let i = 0; i < TOTAL_SECTIONS; i++) {
      const advance = stage.advance();
      if (advance.areaCleared) areaBoundaries.push(`${advance.from}>${advance.to}`);
      visited.push(stage.label);
    }
    expect(visited).toEqual(['1-1', '1-2', '1-3', '2-1', '2-2', '2-3', '3-1', '3-2', '3-3', '4-1', '4-2', '4-3', 'FINAL BOSS']);
    expect(areaBoundaries).toEqual(['1-3>2-1', '2-3>3-1', '3-3>4-1', '4-3>FINAL BOSS']);
    expect([stage.boss, stage.clearedSections]).toEqual([true, 12]);
    expect(stage.advance()).toEqual({ from: 'FINAL BOSS', to: 'FINAL BOSS', areaCleared: null, boss: true });
  });
  it('reports the area finale and resets back to 1-1', () => {
    const stage = new StageProgressionSystem();
    expect(stage.isAreaFinale).toBe(false);
    stage.advance(); stage.advance();
    expect([stage.label, stage.isAreaFinale, stage.isFinalSection]).toEqual(['1-3', true, false]);
    stage.jumpTo(4, 3);
    expect([stage.label, stage.isAreaFinale, stage.isFinalSection, stage.clearedSections]).toEqual(['4-3', true, true, 11]);
    stage.reset();
    expect([stage.label, stage.boss, stage.clearedSections, stage.areaName]).toEqual(['1-1', false, 0, 'SURFACE RUINS']);
  });
  it('generates every section offset without running out of reachable platforms', () => {
    for (let seed = 1; seed <= 6; seed++) {
      let state = seed * 7919;
      const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
      for (let section = 0; section < TOTAL_SECTIONS; section++) {
        const generator = new StageGenerator(random, { depthOffset: section * 200 });
        for (let chunk = 0; chunk < 7; chunk++) expect(() => generator.chunk(chunk)).not.toThrow();
      }
    }
  });
});

describe('section clear conditions', () => {
  it('offers no exit before the goal, and reaching the goal does not end the section', () => {
    const game = new GameModel();
    reachDepth(game, game.sectionLength - 1);
    expect(game.exit).toBeNull();
    expect([game.state, game.stage.label]).toEqual(['playing', '1-1']);
    // The whole point of the change: 200m opens the way out, it does not take the run away.
    reachDepth(game, game.sectionLength);
    expect(game.exit).not.toBeNull();
    expect([game.state, game.stage.label]).toEqual(['playing', '1-1']);
    reachDepth(game, game.sectionLength + 5);
    expect(game.state).toBe('playing');
  });
  it('generates a reachable exit past the goal and clears exactly once when entered', () => {
    const game = new GameModel();
    const gate = reachExit(game);
    expect(gate.width).toBeGreaterThan(0);
    expect([game.state, game.stage.label]).toEqual(['upgrade', '1-1']);
    expect(game.events.filter(e => e.type === 'upgrade')).toHaveLength(1);
    game.step(1 / 120, 0, false); game.step(1 / 120, 0, false);
    expect(game.events.filter(e => e.type === 'upgrade')).toHaveLength(1);
    expect(game.completeSection()).toBe(false);
  });
  it('lays a floor across the shaft at the exit, so nothing can be farmed below it', () => {
    const game = new GameModel();
    reachExitOnly(game);
    expect(game.exit).not.toBeNull();
    const floor = game.platforms.reduce((low, f) => (f.y > low.y ? f : low), game.platforms[0]);
    expect(floor.width).toBeGreaterThan(WORLD.width - WORLD.wall * 2 - 2);
    const deepest = floor.y;
    // Nothing is generated below the floor, however long the player lingers.
    for (let i = 0; i < 240; i++) { game.player.invincible = 99; game.step(1 / 120, 0, false); }
    expect(game.platforms.every(f => f.y <= deepest)).toBe(true);
    expect(game.enemies.every(e => e.y <= deepest)).toBe(true);
  });
  it('announces the cleared section and the area finale on the clear event', () => {
    const game = new GameModel();
    reachExit(game);
    expect(game.events.find(e => e.type === 'upgrade')).toMatchObject({ stage: '1-1', areaCleared: null });
    clearSection(game); clearSection(game);
    expect(game.stage.label).toBe('1-3');
    game.events.length = 0;
    reachExit(game);
    expect(game.events.find(e => e.type === 'upgrade')).toMatchObject({ stage: '1-3', areaCleared: 'SURFACE RUINS' });
  });
  it('keeps section depth local while total depth accumulates', () => {
    const game = new GameModel();
    const past = game.sectionLength + 10;
    reachDepth(game, past);
    // Hunting below the goal for the gate is real descent, but it is never banked: a SECTION is
    // worth exactly its planned length, so a cleared run still totals 12 x 200m.
    expect(Math.round(game.sectionDepth)).toBe(past);
    expect(Math.round(game.totalDepth)).toBe(game.sectionLength);
    // Overshooting the goal by a frame must not leak into the run total, nor into the next section.
    clearSection(game);
    const banked = AREAS[0].sectionLength;
    expect([Math.round(game.sectionDepth), game.completedDepth, Math.round(game.totalDepth)]).toEqual([0, banked, banked]);
    reachDepth(game, 150);
    expect([Math.round(game.sectionDepth), Math.round(game.totalDepth)]).toEqual([150, banked + 150]);
  });
  it('banks the planned length however far past the goal the frame landed', () => {
    for (const overshoot of [200, 202, 260, 400]) {
      const game = new GameModel();
      // However deep the player went hunting for the gate, the SECTION is worth its plan.
      reachDepth(game, overshoot);
      reachExit(game);
      game.selectUpgrade(game.upgrades.choices[0].id); game.confirmUpgrade();
      expect(game.completedDepth).toBe(AREAS[0].sectionLength);
      expect(Math.round(game.totalDepth)).toBe(AREAS[0].sectionLength);
    }
  });
  it('reports the real depth reached when the run dies mid-section', () => {
    const game = new GameModel();
    for (let i = 0; i < 7; i++) clearSection(game);
    // Seven gates: all of AREA 1 and 2, then 3-1.
    const sevenSections = AREAS[0].sectionLength * 3 + AREAS[1].sectionLength * 3 + AREAS[2].sectionLength;
    expect([game.stage.label, game.completedDepth]).toEqual(['3-2', sevenSections]);
    reachDepth(game, 83);
    game.killInstantly('fall');
    expect([game.state, Math.round(game.totalDepth)]).toEqual(['over', sevenSections + 83]);
  });
});

describe('carrying the run across a section boundary', () => {
  it('keeps HP, MAX HP, overflow, upgrades AND the live chain while refilling ammo', () => {
    const game = new GameModel();
    game.heal(4); game.heal(3); game.damage(2);
    game.ammo = 1; game.combo = 7;
    const before = { hp: game.hp, maxHp: game.health.maxHp, overflow: game.health.overflowHealing };
    expect(before).toEqual({ hp: 3, maxHp: 5, overflow: 3 });
    reachExit(game);
    expect({ hp: game.hp, maxHp: game.health.maxHp, overflow: game.health.overflowHealing }).toEqual(before);
    expect(game.ammo).toBe(1);
    const choice = game.upgrades.choices.find(u => u.category !== 'health')!;
    game.selectUpgrade(choice.id); game.confirmUpgrade();
    expect({ hp: game.hp, maxHp: game.health.maxHp, overflow: game.health.overflowHealing }).toEqual(before);
    expect(game.upgrades.stacks[choice.id]).toBe(1);
    // COMBO survives the boundary: a rest point is not a landing and banks nothing.
    expect([game.ammo, game.combo, game.sectionDepth, game.state]).toEqual([game.stats.maxAmmo, 7, 0, 'playing']);
    expect([game.player.y, game.player.vy, game.player.grounded, game.cameraY]).toEqual([WORLD.startY, 0, -1, 0]);
    expect(game.platforms.length).toBeGreaterThan(1);
  });
  it('carries every upgrade stack across all twelve sections without an area-boundary reset', () => {
    const game = new GameModel();
    game.damage(1);
    const stages = ['1-1'];
    for (let i = 0; i < TOTAL_SECTIONS - 1; i++) { clearSection(game); stages.push(game.stage.label); }
    expect(stages).toEqual(['1-1', '1-2', '1-3', '2-1', '2-2', '2-3', '3-1', '3-2', '3-3', '4-1', '4-2', '4-3']);
    expect(Object.values(game.upgrades.stacks).reduce((sum, n) => sum + n, 0)).toBe(11);
    expect(game.hp).toBeLessThan(game.health.maxHp + 1);
    expect(game.health.currentHp).toBeGreaterThan(0);
  });
});

describe('final boss and game clear', () => {
  it('reaches the boss only after the 4-3 rest, then clears the run', () => {
    const game = new GameModel();
    for (let i = 0; i < TOTAL_SECTIONS - 1; i++) clearSection(game);
    expect(game.stage.label).toBe('4-3');
    reachExit(game);
    expect([game.state, game.stage.boss]).toEqual(['upgrade', false]);
    game.selectUpgrade(game.upgrades.choices[0].id);
    expect(game.confirmUpgrade()).toBe(true);
    expect([game.state, game.stage.label]).toEqual(['boss', 'FINAL BOSS']);
    expect(game.events.filter(e => e.type === 'boss')).toHaveLength(1);
    expect(game.completeSection()).toBe(false);
    game.step(1, 1, true);
    expect(game.state).toBe('boss');
    expect(game.clearBoss()).toBe(true);
    expect(game.state).toBe('clear');
    expect(game.events.filter(e => e.type === 'clear')).toHaveLength(1);
    expect(game.clearBoss()).toBe(false);
  });
  it('cannot die or be damaged once the run is cleared', () => {
    const game = new GameModel();
    game.jumpToBoss(); game.clearBoss();
    expect(game.damage(1)).toBe(false);
    expect(game.killInstantly('lava')).toBe(false);
    expect(game.state).toBe('clear');
  });
  it('banks the final section depth into total depth at the boss hand-off', () => {
    const game = new GameModel();
    for (let i = 0; i < TOTAL_SECTIONS; i++) clearSection(game);
    expect(game.stage.boss).toBe(true);
    expect(Math.round(game.totalDepth)).toBe(PLANNED_TOTAL_DEPTH);
    expect(game.score).toBe(Math.floor(game.totalDepth) + game.killScore);
  });
});

describe('death and retry', () => {
  it('restarts a run that died in 3-2 from 1-1 with every run value reset', () => {
    const game = new GameModel();
    for (let i = 0; i < 7; i++) clearSection(game);
    game.heal(4); game.damage(1); game.combo = 9;
    expect(game.stage.label).toBe('3-2');
    expect(game.health.maxHp).toBeGreaterThanOrEqual(4);
    game.killInstantly('fall');
    expect(game.state).toBe('over');
    const retry = new GameModel();
    expect(retry.stage.progress).toEqual({ area: 1, section: 1, boss: false });
    expect([retry.stage.label, retry.stage.clearedSections]).toEqual(['1-1', 0]);
    expect([retry.sectionDepth, retry.totalDepth, retry.combo, retry.kills, retry.maxCombo]).toEqual([0, 0, 0, 0, 0]);
    expect([retry.hp, retry.health.maxHp, retry.health.overflowHealing]).toEqual([4, 4, 0]);
    expect([retry.ammo, retry.stats.maxAmmo, retry.state]).toEqual([initialStats().maxAmmo, initialStats().maxAmmo, 'playing']);
    expect(retry.upgrades.stacks).toEqual({});
  });
  it('play again after a clear starts a fresh 1-1 run', () => {
    const cleared = new GameModel();
    cleared.jumpToBoss(); cleared.clearBoss();
    const again = new GameModel();
    expect([again.stage.label, again.state, again.hp, again.totalDepth]).toEqual(['1-1', 'playing', 4, 0]);
  });
});

describe('development stage jump', () => {
  it.each([[2, 1], [3, 3], [4, 2]] as const)('jumps to %i-%i with a standard loadout', (area, section) => {
    const game = new GameModel();
    expect(game.jumpToStage(area as AreaId, section as SectionId)).toBe(true);
    expect(game.stage.label).toBe(`${area}-${section}`);
    expect([game.state, game.sectionDepth, game.combo, game.ammo]).toEqual(['playing', 0, 0, game.stats.maxAmmo]);
    expect([game.hp, game.health.maxHp]).toEqual([4, 4]);
    expect(game.player.y).toBe(WORLD.startY);
    expect(game.platforms.length).toBeGreaterThan(1);
  });
  it('keeps total depth consistent with the sections skipped and reaches the boss', () => {
    const game = new GameModel();
    game.jumpToStage(3, 1);
    expect(Math.round(game.totalDepth)).toBe(AREAS[0].sectionLength * 3 + AREAS[1].sectionLength * 3);
    reachExit(game);
    expect([game.state, game.stage.label]).toEqual(['upgrade', '3-1']);
    expect(game.jumpToBoss()).toBe(true);
    expect([game.state, game.stage.label, Math.round(game.totalDepth)]).toEqual(['boss', 'FINAL BOSS', PLANNED_TOTAL_DEPTH]);
  });
  it('is inert in practice mode', () => {
    const game = new GameModel(true);
    expect(game.jumpToStage(2, 1)).toBe(false);
    expect(game.jumpToBoss()).toBe(false);
    expect(game.stage.label).toBe('1-1');
  });
});
