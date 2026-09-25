import { describe, expect, it } from 'vitest';
import { PlayerAnimationState, BOSS_CONTACT_REBOUND_SECONDS, type AnimationInput } from '../src/dev/playerAnimationState';
import { NIMUSHI_ART, nimushiArtBarrierOrbit, nimushiArtPlacement, nimushiArtVisualCenter } from '../src/render/NimushiArt';
import { TAPIOCA_BARRIER } from '../src/data/nimushi';
import { BALANCE } from '../src/data/balance';
import { BOSS_PHYSICS } from '../src/data/bossPhysics';
import { fighting, STEP } from './nimushi';

/**
 * BOSS VISUAL FIX PASS: the locked contact-rebound frame, and the TAPIOCA BARRIER centred on the
 * drawing. Both are drawing only -- the rules they illustrate are asserted unchanged here too.
 */
const arena = (patch: Partial<AnimationInput> = {}): AnimationInput =>
  ({ elapsed: 5, hp: 3, state: 'boss', inBossArena: true, wallSide: 0, player: { grounded: -1, vy: 150, vx: 0 }, ...patch });

describe('PLAYER BOSS CONTACT REBOUND', () => {
  it('shows only after a SURVIVED body contact with NIMUSHI, first of every pose, for the rebound\'s length', () => {
    const s = new PlayerAnimationState();
    s.event({ type: 'hurt', cause: 'bossContact' }, arena());
    expect(s.pose(arena())).toBe('boss_contact_rebound');
    // Ahead of the damage flinch and of a shot's hover.
    s.event({ type: 'shot' }, arena({ player: { grounded: -1, vy: 0, vx: 0 } }));
    expect(s.pose(arena({ elapsed: 5.1, player: { grounded: -1, vy: 0, vx: 0 } }))).toBe('boss_contact_rebound');
    // ...and then the ordinary poses again.
    expect(s.pose(arena({ elapsed: 5 + BOSS_CONTACT_REBOUND_SECONDS + 0.01, player: { grounded: -1, vy: -20, vx: 0 } }))).toBe('boss_ascend');
  });

  it('lasts as long as the rebound it depicts', () => {
    expect(BOSS_CONTACT_REBOUND_SECONDS).toBeCloseTo(BALANCE.bounce / BOSS_PHYSICS.gravity, 2);
  });

  it('never shows for any other hurt, a killing contact, or a stomp', () => {
    for (const cause of ['enemy', 'bossShot', 'bossSweep', 'spike', undefined]) {
      const s = new PlayerAnimationState();
      s.event({ type: 'hurt', cause }, arena());
      expect({ cause, pose: s.pose(arena()) }).not.toEqual({ cause, pose: 'boss_contact_rebound' });
    }
    const dead = new PlayerAnimationState();
    dead.event({ type: 'hurt', cause: 'bossContact' }, arena({ hp: 0 }));
    expect(dead.pose(arena({ hp: 0, state: 'over' }))).toBe('death');
    const stomp = new PlayerAnimationState();
    stomp.event({ type: 'kill', stomp: true }, arena());
    expect(stomp.pose(arena())).not.toBe('boss_contact_rebound');
  });

  it('is told by the model which hurt it was, and the contact itself is unchanged', () => {
    const g = fighting(7);
    const box = g.boss.contactBox;
    const hearts = g.hp;
    g.player.x = box.x + box.width / 2; g.player.y = box.y + box.height / 2; g.player.vy = -BOSS_PHYSICS.maxFallSpeed;
    g.player.invincible = 0; g.ammo = 0;
    g.step(STEP, 0, false);
    const hurt = g.events.find(e => e.type === 'hurt');
    expect(hurt?.cause).toBe('bossContact');
    // One heart, thrown back at the ordinary bounce, CHARGE refilled: exactly as before.
    expect(g.hp).toBe(hearts - 1);
    expect(Math.abs(g.player.vy)).toBeCloseTo(g.stats.bounce, 6);
    expect(g.ammo).toBe(g.stats.maxAmmo);
  });
});

describe('TAPIOCA BARRIER around the drawing', () => {
  const body = { x: 141, y: 1000, width: 168, height: 112 };

  it('centres on NIMUSHI\'s silhouette: 4px left of and 56px below the body centre', () => {
    const c = nimushiArtVisualCenter(body, 700);
    expect(c).toEqual({ x: 141 + 84 - 4, y: 1000 + 56 - 700 + 56 });
    // Derived, not typed in: placement + the silhouette's own centre.
    const at = nimushiArtPlacement(body, 700);
    expect(c.x - at.x).toBe(NIMUSHI_ART.silhouette.x + NIMUSHI_ART.silhouette.width / 2);
    expect(c.y - at.y).toBe(NIMUSHI_ART.silhouette.y + NIMUSHI_ART.silhouette.height / 2);
  });

  it('follows NIMUSHI across the shaft and with the camera, one-for-one', () => {
    const a = nimushiArtBarrierOrbit(body, 700, TAPIOCA_BARRIER);
    const moved = nimushiArtBarrierOrbit({ ...body, x: body.x - 60, y: body.y + 25 }, 690, TAPIOCA_BARRIER);
    expect([moved.x - a.x, moved.y - a.y]).toEqual([-60, 35]);
  });

  it('rings the whole drawing, and keeps the barrier\'s own radii as the floor', () => {
    const o = nimushiArtBarrierOrbit(body, 700, TAPIOCA_BARRIER);
    expect(o.radiusX).toBeGreaterThanOrEqual(TAPIOCA_BARRIER.radiusX);
    expect(o.radiusY).toBeGreaterThanOrEqual(TAPIOCA_BARRIER.radiusY);
    expect(o.radiusX).toBeGreaterThanOrEqual(NIMUSHI_ART.silhouette.width / 2 + TAPIOCA_BARRIER.pearlSize);
    expect(o.radiusY).toBeGreaterThanOrEqual(NIMUSHI_ART.silhouette.height / 2 + TAPIOCA_BARRIER.pearlSize);
    // The pearls, their count and the barrier's rules are the barrier's own and are not moved.
    expect(TAPIOCA_BARRIER.pearls).toBe(12);
  });
});
