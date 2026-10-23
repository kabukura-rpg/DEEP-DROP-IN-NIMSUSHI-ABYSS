import type Phaser from 'phaser';

/**
 * DRONE PIXEL VFX V1 -- candidate A of output/upgrade-attachments-audit-v1 (claude-integration-spec.md).
 *
 * PRESENTATION ONLY. The companion's body as eight hard-edged rectangles in the 18x12 envelope the
 * three flat 7e4c59d rectangles covered: a dark key, two light faces, a cyan lens. Where it rides,
 * how it bobs, when it fires and from where are GameModel's and the scene's, untouched. No new PNG,
 * no glow, ring or trail, no flip or rotation. All sizes are native 450x800 world pixels.
 */
export const DRONE_ART = {
  /** The envelope's top-left from the drone's spot (before bob), and its size. */
  originX: -9, originY: -3, width: 18, height: 12,
  /** [dx, dy, w, h, colour] from the envelope's top-left, in draw order, all at alpha 1. */
  hull: [
    [7, 0, 4, 3, 0xc3d5d5],
    [2, 3, 14, 1, 0x172b35],
    [0, 4, 18, 5, 0x172b35],
    [1, 4, 16, 2, 0x789fae],
    [3, 4, 12, 1, 0xc3d5d5],
    [4, 9, 10, 3, 0x172b35],
    [5, 9, 8, 2, 0x426779],
    [8, 6, 2, 2, 0x6dbccd],
  ],
} as const;

/** The hull at the envelope's integer top-left `x`/`y` (screen space, bob already applied). */
export function drawDroneHull(g: Phaser.GameObjects.Graphics, x: number, y: number) {
  const hull = DRONE_ART.hull;
  // Indexed, not destructured: nothing is allocated per frame.
  for (let i = 0; i < hull.length; i++) {
    const r = hull[i];
    g.fillStyle(r[4], 1).fillRect(x + r[0], y + r[1], r[2], r[3]);
  }
}
