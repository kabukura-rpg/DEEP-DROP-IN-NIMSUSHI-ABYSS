import { describe, expect, it } from 'vitest';
import { TOMATO_REVEAL, TOMATO_REVEAL_SECONDS, TOMATO_REVEAL_SKIP_DISTANCE, tomatoRevealFrame } from '../src/render/tomatoReveal';
import { pickupType } from '../src/data/pickups';
import { GameModel } from '../src/systems/GameModel';

/** THE TOMATO'S ENTRANCE: drawing only, and never in the way of taking it. */
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
