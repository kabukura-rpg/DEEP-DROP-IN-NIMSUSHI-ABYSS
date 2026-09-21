import { describe, expect, it } from 'vitest';
import { GameModel } from '../src/systems/GameModel';
import { PLAYER_ART_FRAMES, PlayerArtState, playerArtPlacement, type PlayerArtInput } from '../src/dev/playerArtState';

const falling = (patch: Partial<PlayerArtInput> = {}): PlayerArtInput => ({ elapsed: 1, hp: 4, state: 'playing', inBossArena: false, player: { grounded: -1, vy: 300 }, ...patch });
const ascend = (patch: Partial<PlayerArtInput> = {}) => falling({ state: 'boss', inBossArena: true, player: { grounded: -1, vy: -300 }, ...patch });

describe('temporary PLAYER art is a read-only view', () => {
  it('maps falling and ascending while missing poses fall back to legacy', () => {
    const art = new PlayerArtState();
    expect(art.pose(falling())).toBe('normal_fall');
    expect(art.pose(ascend())).toBe('boss_ascend');
    expect(art.pose(falling({ player: { grounded: 1, vy: 0 } }))).toBeNull();
    expect(art.pose(falling({ player: { grounded: -1, vy: -330 } }))).toBeNull();
    expect(art.pose(falling({ hp: 0, state: 'over' }))).toBeNull();
    expect(art.pose(falling({ state: 'clear' }))).toBeNull();
  });
  it('shows a short brake only after an actual shot, including the last round', () => {
    const art = new PlayerArtState();
    art.event({ type: 'empty' }, ascend());
    expect(art.pose(ascend())).toBe('boss_ascend');
    art.event({ type: 'shot' }, ascend());
    expect(art.pose(ascend({ elapsed: 1.1 }))).toBe('boss_brake');
    expect(art.pose(ascend({ elapsed: 1.15 }))).toBe('boss_ascend');
  });
  it('never connects the discarded downward thruster pose or mistakes a bounce for braking', () => {
    const art = new PlayerArtState();
    const bouncing = ascend({ player: { grounded: -1, vy: 340 } });
    art.event({ type: 'shot' }, bouncing);
    expect(art.pose(bouncing)).toBeNull();
    expect(art.pose(ascend())).toBe('boss_ascend');
    expect(Object.keys(PLAYER_ART_FRAMES)).not.toContain('boss_descend_thrust');
  });
  it('clears the shot pose on stomp, landing and run reset', () => {
    const art = new PlayerArtState();
    for (const event of [{ type: 'kill', stomp: true }, { type: 'land' }, { type: 'gravityFlip' }]) {
      art.event({ type: 'shot' }, ascend());
      art.event(event, ascend());
      expect(art.pose(ascend())).toBe('boss_ascend');
    }
    art.event({ type: 'shot' }, ascend()); art.reset();
    expect(art.pose(ascend())).toBe('boss_ascend');
  });
  it('holds the shot pose when simulation time is paused', () => {
    const art = new PlayerArtState();
    art.event({ type: 'shot' }, ascend());
    for (let frame = 0; frame < 300; frame++) expect(art.pose(ascend())).toBe('boss_brake');
  });
  it('aligns the calibrated body and eyes for every pose and horizontal flip', () => {
    for (const pose of Object.keys(PLAYER_ART_FRAMES) as (keyof typeof PLAYER_ART_FRAMES)[]) {
      for (const flip of [true, false]) for (const scale of [1, 2]) {
        const frame = PLAYER_ART_FRAMES[pose];
        const placement = playerArtPlacement(pose, 225, 400, scale, flip);
        expect(placement.x + (flip ? -1 : 1) * (frame.anchor.x - 24) * scale).toBe(225);
        expect(placement.y + (frame.anchor.y - 24) * scale).toBe(400);
        expect(placement.y + (frame.eyesY - 24) * scale).toBe(400 - 2 * scale);
        expect(frame.solesY - frame.anchor.y).toBeGreaterThanOrEqual(10);
        expect(frame.solesY - frame.anchor.y).toBeLessThanOrEqual(12);
      }
    }
  });
  it('observing events and poses does not alter any model state, camera, bullet or body', () => {
    const model = new GameModel(); model.jumpToNimushi();
    model.step(1 / 60, 0, false); model.shoot();
    const before = JSON.stringify(model);
    const art = new PlayerArtState();
    for (const event of model.events) art.event(event, model);
    for (let i = 0; i < 100; i++) art.pose(model);
    expect(JSON.stringify(model)).toBe(before);
  });
});
