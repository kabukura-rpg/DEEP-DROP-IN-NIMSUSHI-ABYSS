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
  /**
   * Where NIMUSHI actually is inside the 256x224 cell: the sprite's alpha bounds, (16,16)-(232,208),
   * from its manifest (resolution-review-v1/manifest.json, `alphaBounds`). The pivot is the BODY'S
   * anchor, high on the hood; this is the silhouette, and its centre is what the eye reads as NIMUSHI.
   */
  silhouette: { x: 16, y: 16, width: 216, height: 192 },
} as const;

/** Where the image's top-left goes on screen, from the body the model reports (recoil included). */
export function nimushiArtPlacement(body: { x: number; y: number; width: number; height: number }, cameraY: number) {
  return {
    x: body.x + body.width / 2 - NIMUSHI_ART.pivot.x,
    y: body.y + body.height / 2 - cameraY - NIMUSHI_ART.pivot.y + NIMUSHI_ART.renderOffsetY,
  };
}

/**
 * The centre of NIMUSHI as drawn -- the middle of the silhouette -- in screen coordinates, from the
 * same placement the image uses. With the pivot (128,40), alignment B's -16 and the silhouette's
 * centre at (124,112), that lands 4px left of and 56px below the body's centre: the body is the
 * collision box high on the hood, the drawing hangs below it.
 */
export function nimushiArtVisualCenter(body: { x: number; y: number; width: number; height: number }, cameraY: number) {
  const at = nimushiArtPlacement(body, cameraY);
  return {
    x: at.x + NIMUSHI_ART.silhouette.x + NIMUSHI_ART.silhouette.width / 2,
    y: at.y + NIMUSHI_ART.silhouette.y + NIMUSHI_ART.silhouette.height / 2,
  };
}

/**
 * The TAPIOCA BARRIER's orbit around the drawing: centred on the silhouette, and never tighter than
 * the silhouette plus a pearl's clearance, so the ring goes AROUND NIMUSHI rather than across it.
 * The barrier's own radii stay the floor; only the drawing can widen them.
 */
export function nimushiArtBarrierOrbit(body: { x: number; y: number; width: number; height: number }, cameraY: number,
  barrier: { radiusX: number; radiusY: number; pearlSize: number }) {
  const centre = nimushiArtVisualCenter(body, cameraY);
  const clear = barrier.pearlSize;
  return {
    x: centre.x, y: centre.y,
    radiusX: Math.max(barrier.radiusX, NIMUSHI_ART.silhouette.width / 2 + clear),
    radiusY: Math.max(barrier.radiusY, NIMUSHI_ART.silhouette.height / 2 + clear),
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
