import type Phaser from 'phaser';

const KEY = 0x3d1426, SHADE = 0xc85a7c, BODY = 0xf497ab, LIGHT = 0xffd2dd, SPECULAR = 0xfff4f6;

/**
 * HEART BALLOON PIXEL ART V1 -- candidate A of output/balloon-visual-selection-v1 (claude-integration-spec.md,
 * pixel map assets/balloon-A.json).
 *
 * PRESENTATION ONLY. The balloon's body as hard-edged rectangles inside the radius-13 circle the two 6d83590
 * fillCircles covered: a dark key, a lower-right shade, the old pink, the old highlight pink and a small
 * specular. Where it rides, how it follows, what touches it, when it pops and the tether are GameModel's and
 * the scene's, untouched. No new PNG, no glow, blur or gradient, no flip, rotation or animation. All sizes are
 * native 450x800 world pixels.
 */
export const BALLOON_ART = {
  /** The envelope's top-left from the balloon's centre, and its size (the old circle's 26x26 box). */
  originX: -13, originY: -13, width: 26, height: 26,
  /**
   * [dx, dy, w, h, colour] from the envelope's top-left, in draw order, all at alpha 1. Each colour paints
   * itself and every lighter level, the next one overwrites: 51 rectangles, exactly the 26x26 map.
   */
  body: [
    [9, 0, 8, 1, KEY], [7, 1, 12, 1, KEY], [5, 2, 16, 1, KEY], [4, 3, 18, 1, KEY], [3, 4, 20, 1, KEY],
    [2, 5, 22, 2, KEY], [1, 7, 24, 2, KEY], [0, 9, 26, 8, KEY], [1, 17, 24, 2, KEY], [2, 19, 22, 2, KEY],
    [3, 21, 20, 1, KEY], [4, 22, 18, 1, KEY], [5, 23, 16, 1, KEY], [7, 24, 12, 1, KEY], [9, 25, 8, 1, KEY],
    [9, 1, 8, 1, SHADE], [7, 2, 12, 1, SHADE], [5, 3, 16, 1, SHADE], [4, 4, 18, 1, SHADE], [3, 5, 20, 2, SHADE],
    [2, 7, 22, 2, SHADE], [1, 9, 24, 8, SHADE], [2, 17, 22, 2, SHADE], [3, 19, 20, 2, SHADE], [4, 21, 18, 1, SHADE],
    [5, 22, 16, 1, SHADE], [7, 23, 12, 1, SHADE], [9, 24, 8, 1, SHADE],
    [9, 1, 8, 1, BODY], [7, 2, 12, 1, BODY], [5, 3, 15, 1, BODY], [4, 4, 17, 1, BODY], [3, 5, 19, 2, BODY],
    [2, 7, 20, 1, BODY], [2, 8, 21, 1, BODY], [1, 9, 22, 4, BODY], [1, 13, 21, 3, BODY], [1, 16, 20, 1, BODY],
    [2, 17, 18, 2, BODY], [3, 19, 16, 1, BODY], [4, 20, 13, 1, BODY], [5, 21, 11, 1, BODY], [8, 22, 5, 1, BODY],
    [7, 5, 3, 1, LIGHT], [6, 6, 5, 1, LIGHT], [5, 7, 6, 1, LIGHT], [5, 8, 5, 1, LIGHT], [5, 9, 4, 1, LIGHT],
    [6, 10, 2, 1, LIGHT],
    [7, 6, 2, 1, SPECULAR], [6, 7, 2, 1, SPECULAR],
  ],
} as const;

/** The body at the envelope's integer top-left `x`/`y` (screen space). */
export function drawBalloonBody(g: Phaser.GameObjects.Graphics, x: number, y: number) {
  const body = BALLOON_ART.body;
  // Indexed, not destructured: nothing is allocated per frame.
  for (let i = 0; i < body.length; i++) {
    const r = body[i];
    g.fillStyle(r[4], 1).fillRect(x + r[0], y + r[1], r[2], r[3]);
  }
}
