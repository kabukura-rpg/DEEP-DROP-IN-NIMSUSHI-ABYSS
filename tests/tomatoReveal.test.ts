import { describe, expect, it } from 'vitest';
import { TOMATO_REVEAL, TOMATO_REVEAL_SECONDS, TOMATO_REVEAL_SKIP_DISTANCE, tomatoRevealFrame, tomatoRevealStart } from '../src/render/tomatoReveal';
import { pickupType } from '../src/data/pickups';
import { GameModel } from '../src/systems/GameModel';

/** THE TOMATO'S ENTRANCE: it plays to the end once begun, and the TOMATO is taken only once it is out. */
describe('the entrance', () => {
  it('runs omen, open, emerge, close, in that order, and then rests', () => {
    const { omen, open, emerge } = TOMATO_REVEAL;
    const at = (t: number) => tomatoRevealFrame(t);
    // Omen: cracks only, no portal, no TOMATO yet.
    expect(at(omen / 2)).toMatchObject({ portal: 0, emerge: null, done: false });
    expect(at(omen / 2).omen).toBeGreaterThan(0);
    // Open: the portal widens, still empty.
    expect(at(omen + open / 2).emerge).toBeNull();
    expect(at(omen + open / 2).portal).toBeGreaterThan(0);
    // Emerge: out of the wall, towards its resting place.
    const mid = at(omen + open + emerge / 2);
    expect(mid.portal).toBe(1);
    expect(mid.emerge).toBeGreaterThan(0);
    expect(mid.emerge).toBeLessThan(1);
    // Close: in place, the portal shutting.
    const closing = at(omen + open + emerge + 0.1);
    expect(closing.emerge).toBe(1);
    expect(closing.portal).toBeLessThan(1);
    expect(at(TOMATO_REVEAL_SECONDS)).toEqual({ omen: 0, portal: 0, emerge: 1, done: true });
    expect(at(Infinity).done).toBe(true);
  });

  it('is short, so it is over before a falling player reaches the chamber', () => {
    expect(TOMATO_REVEAL_SECONDS).toBeCloseTo(1.5, 5);
  });

  it('gives way to the player well outside the reach that takes the TOMATO', () => {
    const tomato = pickupType('tomato');
    const reach = Math.hypot(tomato.radius + 12, tomato.radius + 17);
    expect(TOMATO_REVEAL_SKIP_DISTANCE).toBeGreaterThan(reach * 2);
  });

  it('leaves the TOMATO where the staging room lays it, takeable from the start', () => {
    const game = new GameModel();
    game.jumpToBoss();
    const tomato = game.pickups.find(p => p.kind === 'tomato')!;
    const zone = game.safeZones[0];
    expect(tomato.taken).toBe(false);
    expect(tomato.x).toBe(Math.round(zone.x + zone.width / 2));
    expect(tomato.y).toBe(zone.y + zone.height - 26);
  });
});

describe('once begun, the entrance plays to the end', () => {
  const STEP = 1 / 120;
  const phaseAt = (t: number) => {
    const f = tomatoRevealFrame(t);
    if (f.done) return 'done';
    if (f.emerge === null) return f.portal > 0 ? 'open' : 'omen';
    return f.portal === 1 && f.emerge < 1 ? 'emerge' : 'close';
  };
  /**
   * The scene's own rule, step for step: the start is decided on the first frame the TOMATO is on
   * screen (the pickup band, -30..830 of the view) and the model is told to hold it from there.
   */
  const watch = (game: GameModel, input: (t: number, game: GameModel) => number, seconds = 6) => {
    const tomato = game.pickups.find(p => p.kind === 'tomato')!;
    let decided: number | undefined;
    const seen: { phase: string; at: number }[] = [];
    let near: number | null = null, taken: number | null = null, last = 0;
    for (let i = 0; i < seconds / STEP && taken === null; i++) {
      game.step(STEP, input(i * STEP, game), false);
      const view = tomato.y - game.cameraY;
      const distance = Math.hypot(game.player.x - tomato.x, game.player.y - tomato.y);
      if (decided === undefined && view >= -30 && view <= 830) {
        decided = tomatoRevealStart(undefined, { inChamber: true, reducedMotion: false, distance, now: game.elapsed });
        if (decided !== -Infinity) game.holdTomatoForReveal(tomato, TOMATO_REVEAL_SECONDS);
      } else if (decided !== undefined) {
        // Every later frame asks again, with the player wherever they now are.
        expect(tomatoRevealStart(decided, { inChamber: true, reducedMotion: false, distance, now: game.elapsed })).toBe(decided);
      }
      if (near === null && distance < TOMATO_REVEAL_SKIP_DISTANCE) near = game.elapsed;
      if (decided !== undefined && decided !== -Infinity && !tomato.taken) {
        const phase = phaseAt(game.elapsed - decided);
        if (seen.at(-1)?.phase !== phase) seen.push({ phase, at: game.elapsed - decided });
        last = game.elapsed - decided;
      }
      if (tomato.taken) taken = game.elapsed;
    }
    return { start: decided!, seen, near, taken, last };
  };
  const staging = () => { const g = new GameModel(); g.jumpToBoss(); return g; };
  const towardTomato = (game: GameModel) => {
    const tomato = game.pickups.find(p => p.kind === 'tomato')!;
    return game.safeZone ? (tomato.x > game.player.x ? 1 : -1) : 1;
  };

  it('keeps a start once decided, whatever the player\'s distance', () => {
    expect(tomatoRevealStart(undefined, { inChamber: true, reducedMotion: false, distance: 400, now: 3 })).toBe(3);
    expect(tomatoRevealStart(3, { inChamber: true, reducedMotion: false, distance: 0, now: 3.4 })).toBe(3);
    // Still skipped when the player is already near the first time it is seen, or motion is reduced.
    expect(tomatoRevealStart(undefined, { inChamber: true, reducedMotion: false, distance: 60, now: 3 })).toBe(-Infinity);
    expect(tomatoRevealStart(undefined, { inChamber: true, reducedMotion: true, distance: 400, now: 3 })).toBe(-Infinity);
    expect(tomatoRevealStart(undefined, { inChamber: false, reducedMotion: false, distance: 400, now: 3 })).toBe(-Infinity);
  });

  const routes: [string, (t: number, game: GameModel) => number][] = [
    ['straight at it from NEXT', (_t, g) => towardTomato(g)],
    ['after a 0.35s pause', (t, g) => (t < 0.35 ? 0 : towardTomato(g))],
    ['slowly: step off, wait, then in', (t, g) => (t < 0.35 ? 0 : t < 0.75 ? 1 : g.player.grounded !== -1 || g.safeZone ? towardTomato(g) : 0)],
  ];
  for (const [name, input] of routes) {
    it(`plays omen, open, emerge and close in full, ${name}`, () => {
      const { start, seen, near, taken, last } = watch(staging(), input);
      expect(start).toBeGreaterThan(-Infinity);
      // Every phase, in order, and CLOSE drawn to its very end: the player standing on it takes it
      // on the frame the entrance completes, so the resting TOMATO is the next thing drawn.
      expect(seen.map(s => s.phase)).toEqual(['omen', 'open', 'emerge', 'close']);
      expect(last).toBeGreaterThan(TOMATO_REVEAL_SECONDS - 2 * STEP);
      expect(phaseAt(TOMATO_REVEAL_SECONDS)).toBe('done');
      // The player is inside the old skip distance before the end, and nothing is skipped...
      expect(near! - start).toBeLessThan(TOMATO_REVEAL_SECONDS);
      // ...and it is taken once the entrance is over, not a frame before.
      expect(taken! - start).toBeGreaterThanOrEqual(TOMATO_REVEAL_SECONDS - 1e-9);
      expect(taken! - start).toBeLessThan(TOMATO_REVEAL_SECONDS + 0.05);
    });
  }

  it('never stops the player: the run\'s speed through the held TOMATO, in ordinary time', () => {
    const game = staging();
    const tomato = game.pickups.find(p => p.kind === 'tomato')!;
    expect(game.physics.moveSpeed).toBe(350);
    expect(game.physics.gravity).toBe(1680);
    expect(game.physics.maxFallSpeed).toBe(930);
    game.holdTomatoForReveal(tomato, TOMATO_REVEAL_SECONDS);
    game.player.x = tomato.x - 20; game.player.y = tomato.y; game.player.vy = 0;
    game.step(STEP, 0, false);
    expect(tomato.taken).toBe(false);
    expect(game.safeZone).toBe(game.safeZones[0]);
    expect(game.timeFrozen).toBe(false);
    const x = game.player.x;
    for (let i = 0; i < 6; i++) game.step(STEP, 1, false);
    expect(game.player.x - x).toBeCloseTo(350 * 6 * STEP, 5);
    expect(tomato.taken).toBe(false);
    // A second notice never lengthens it.
    const until = tomato.revealUntil;
    game.holdTomatoForReveal(tomato, TOMATO_REVEAL_SECONDS);
    expect(tomato.revealUntil).toBe(until);
  });

  it('is takeable at once when no entrance was ever begun', () => {
    const game = staging();
    const tomato = game.pickups.find(p => p.kind === 'tomato')!;
    game.player.x = tomato.x; game.player.y = tomato.y; game.player.vy = 0;
    game.step(STEP, 0, false);
    expect(tomato.taken).toBe(true);
  });
});
