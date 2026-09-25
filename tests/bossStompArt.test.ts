import { describe, expect, it } from 'vitest';
import animationMapRaw from '../output/player-sprites-v1/animation-map.json?raw';
import { PlayerAnimationState, BOSS_CONTACT_REBOUND_SECONDS, BOSS_ENEMY_STOMP_REBOUND_SECONDS, PLAYER_ANIMATIONS, type AnimationInput } from '../src/dev/playerAnimationState';
import { PLAYER_ART_ASSETS, type ArtMap } from '../src/render/playerArtAssets';
import { spawnEnemy, type EnemyKind } from '../src/data/enemies';
import { BALANCE } from '../src/data/balance';
import { BOSS_PHYSICS } from '../src/data/bossPhysics';
import { fighting, STEP } from './nimushi';

/**
 * PLAYER BOSS ENEMY STOMP REBOUND: the frame for a stomp on one of NIMUSHI's summons. Drawing only --
 * the stomp it illustrates is asserted unchanged here too.
 */
const MAP = JSON.parse(animationMapRaw) as ArtMap;
const arena = (patch: Partial<AnimationInput> = {}): AnimationInput =>
  ({ elapsed: 5, hp: 3, state: 'boss', inBossArena: true, wallSide: 0, player: { grounded: -1, vy: 210, vx: 0 }, ...patch });
const stomped = (s: PlayerAnimationState, m = arena()) => s.event({ type: 'kill', stomp: true }, m);

describe('the stomp frame', () => {
  it('ships as its own one-cell sheet, anchored at (24, 23), apart from the contact rebound', () => {
    expect(PLAYER_ANIMATIONS.boss_enemy_stomp_rebound).toEqual([1, 1, false]);
    expect(MAP.frames.boss_enemy_stomp_rebound_00).toMatchObject({ anchor: { x: 24, y: 23 }, group: 'stomp', index: 0 });
    expect(MAP.frames.boss_contact_rebound_00).toMatchObject({ anchor: { x: 24, y: 24 }, group: 'contact', index: 0 });
    expect(PLAYER_ART_ASSETS.sheets.stomp).not.toBe(PLAYER_ART_ASSETS.sheets.contact);
  });

  it('lasts as long as the stomp\'s throw: the bounce spent against the arena\'s pull', () => {
    expect(BOSS_ENEMY_STOMP_REBOUND_SECONDS).toBe(BALANCE.bounce / BOSS_PHYSICS.gravity);
    expect(BOSS_ENEMY_STOMP_REBOUND_SECONDS).toBeCloseTo(0.233, 3);
  });
});

describe('when it shows', () => {
  it('shows after a stomp kill in the arena, first of every pose, then hands back to the boss poses', () => {
    const s = new PlayerAnimationState();
    stomped(s);
    expect(s.pose(arena())).toBe('boss_enemy_stomp_rebound');
    s.event({ type: 'shot' }, arena({ elapsed: 5.05, player: { grounded: -1, vy: 0, vx: 0 } }));
    s.event({ type: 'hurt', cause: 'enemy' }, arena({ elapsed: 5.05 }));
    expect(s.pose(arena({ elapsed: 5.1, player: { grounded: -1, vy: 0, vx: 0 } }))).toBe('boss_enemy_stomp_rebound');
    const after = 5 + BOSS_ENEMY_STOMP_REBOUND_SECONDS + 0.01;
    expect(s.pose(arena({ elapsed: after, player: { grounded: -1, vy: -20, vx: 0 } }))).toBe('boss_ascend');
    s.event({ type: 'shot' }, arena({ elapsed: after, player: { grounded: -1, vy: -60, vx: 0 } }));
    expect(s.pose(arena({ elapsed: after + 0.01, player: { grounded: -1, vy: -60, vx: 0 } }))).toBe('boss_brake');
  });

  it('restarts on every stomp of a chain', () => {
    const s = new PlayerAnimationState();
    for (const t of [5, 5.2, 5.4]) {
      stomped(s, arena({ elapsed: t }));
      expect(s.pose(arena({ elapsed: t + 0.19 }))).toBe('boss_enemy_stomp_rebound');
    }
    expect(s.pose(arena({ elapsed: 5.4 + BOSS_ENEMY_STOMP_REBOUND_SECONDS + 0.01, player: { grounded: -1, vy: -10, vx: 0 } }))).toBe('boss_ascend');
  });

  it('never shows for a shaft stomp, a shot kill, a body contact, or a killing blow', () => {
    const shaft = new PlayerAnimationState();
    stomped(shaft, arena({ inBossArena: false, state: 'playing' }));
    expect(shaft.pose(arena({ inBossArena: false, state: 'playing' }))).not.toBe('boss_enemy_stomp_rebound');
    const shot = new PlayerAnimationState();
    shot.event({ type: 'kill', stomp: false }, arena());
    expect(shot.pose(arena())).not.toBe('boss_enemy_stomp_rebound');
    const contact = new PlayerAnimationState();
    contact.event({ type: 'hurt', cause: 'bossContact' }, arena());
    expect(contact.pose(arena())).toBe('boss_contact_rebound');
    const dead = new PlayerAnimationState();
    stomped(dead);
    expect(dead.pose(arena({ hp: 0, state: 'over' }))).toBe('death');
  });

  it('gives way to a body contact that comes after it, and the contact frame keeps its own length', () => {
    const s = new PlayerAnimationState();
    stomped(s);
    s.event({ type: 'hurt', cause: 'bossContact' }, arena({ elapsed: 5.1 }));
    expect(s.pose(arena({ elapsed: 5.15 }))).toBe('boss_contact_rebound');
    expect(s.pose(arena({ elapsed: 5.1 + BOSS_CONTACT_REBOUND_SECONDS - 0.01 }))).toBe('boss_contact_rebound');
  });
});

describe('in the fight itself', () => {
  /** Puts one summon of `kind` just past the player along the pull, and flies the player into it. */
  function meet(kind: EnemyKind) {
    const g = fighting(7);
    g.enemies = [];
    const pull = (g as unknown as { gravity: number }).gravity;
    const e = spawnEnemy(kind, -9001, g.player.x, g.player.y + 40 * pull, 0, 0, 'open');
    g.enemies.push(e);
    g.player.invincible = 99; g.player.vy = pull * BOSS_PHYSICS.maxFallSpeed; g.player.grounded = -1;
    const events: typeof g.events = [];
    for (let i = 0; i < 30 && !events.some(v => v.type === 'kill'); i++) { g.step(STEP, 0, false); events.push(...g.events); }
    return { g, e, events };
  }

  it('a stompable summon is killed by a stomp, and the throw is the ordinary bounce', () => {
    const { g, events } = meet('nimushiClone');
    expect(g.inBossArena).toBe(true);
    expect(events.find(v => v.type === 'kill')?.stomp).toBe(true);
    expect(Math.abs(g.player.vy)).toBeLessThanOrEqual(g.stats.bounce);
    expect(g.stats.bounce).toBe(BALANCE.bounce);
  });

  it('a NIMUSHI SHADE cannot be stomped, so it never raises the frame', () => {
    const { events } = meet('nimushiShade');
    expect(events.some(v => v.type === 'kill' && v.stomp)).toBe(false);
  });
});
