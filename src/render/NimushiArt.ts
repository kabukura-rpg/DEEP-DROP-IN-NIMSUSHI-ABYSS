import nimushiIdleUrl from '../../output/nimushi-boss-art-v1/resolution-review-v1/nimushi_idle_256.png?url';

/**
 * NIMUSHI's approved look (docs/NIMUSHI-MASTER-CHARACTER-LOCK.md) -- in the shipped fight.
 *
 * The one gameplay sprite that exists: IDLE, from the LOCKED master, at the HIGH resolution
 * (256x224 source drawn 1:1 into the same 256x224 logical cell), placed by the approved GAMEPLAY
 * ALIGNMENT B -- its pivot on the body's centre, sixteen pixels up. The master's own two eyes are
 * baked in; there is no separate open/shut frame yet, so the states are told apart around it: the
 * TAPIOCA BARRIER's pearls and a dimmer body while it is up, the gold rim while it is down.
 *
 * VISUAL ONLY: body, contact box, weak point, HP, movement and every timing are the model's, read
 * through the same getters as before. If the image fails to load, the procedural body is drawn.
 */
export const NIMUSHI_ART = {
  url: nimushiIdleUrl,
  width: 256,
  height: 224,
  /** The source pixel that sits on the body's centre. */
  pivot: { x: 128, y: 40 },
  /** GAMEPLAY ALIGNMENT B (HUMAN APPROVED): the drawing sits sixteen logical pixels higher. */
  renderOffsetY: -16,
} as const;

/** Where the image's top-left goes on screen, from the body the model reports (recoil included). */
export function nimushiArtPlacement(body: { x: number; y: number; width: number; height: number }, cameraY: number) {
  return {
    x: body.x + body.width / 2 - NIMUSHI_ART.pivot.x,
    y: body.y + body.height / 2 - cameraY - NIMUSHI_ART.pivot.y + NIMUSHI_ART.renderOffsetY,
  };
}

/**
 * How the image is shaded for the fight's state. `fill` is a flat tint (the white hit flash); `tint`
 * multiplies. Barrier and window must read differently at a glance even with a single frame.
 */
export function nimushiArtShade(boss: { pose: string; barrier: boolean; hitFlash: number; rageActive: boolean; started: boolean }) {
  if (boss.pose === 'dead') return { tint: 0x8a7a88, fill: false, alpha: 0.55 };
  if (boss.hitFlash > 0.5) return { tint: 0xffffff, fill: true, alpha: 1 };
  if (boss.pose === 'rage' || boss.rageActive) return { tint: 0xff9aa8, fill: false, alpha: 1 };
  if (boss.barrier) return { tint: 0x8f86a3, fill: false, alpha: 1 };
  if (!boss.started) return { tint: 0xd6d0de, fill: false, alpha: 1 };
  return { tint: 0xffffff, fill: false, alpha: 1 };
}
