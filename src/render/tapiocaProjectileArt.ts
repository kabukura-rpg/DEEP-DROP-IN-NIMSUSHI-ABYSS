import type Phaser from 'phaser';

/**
 * BOSS TAPIOCA PROJECTILE PIXEL ART V1 -- candidate A of output/next-visual-design-v1 (claude-integration-spec.md,
 * candidates/candidate-A.mjs).
 *
 * PRESENTATION ONLY. NIMUSHI's TRIPLE SHOT pearl as seventeen hard-edged rectangles inside the 22x22 square the
 * 959a5f4 rim circle (r11) covered: a stepped cream rim, the dark core over it, a small plum highlight up and to
 * the left. The same three colours and alphas as the three circles. Where a pearl is, how it flies, what it hits
 * and when it goes are the boss system's and GameModel's, untouched. No new PNG, no glow, trail, pulse or
 * rotation. All sizes are native 450x800 world pixels.
 */
export const TAPIOCA_PROJECTILE_ART = {
  /** The one pearl size the art is drawn for (TRIPLE SHOT). Any other size keeps the old circles. */
  size: 9,
  /** The square's top-left from the rounded pearl centre, and its size. */
  originX: -11, originY: -11, width: 22, height: 22,
  /** [colour, alpha, rects as [dx, dy, w, h] from the square's top-left], in draw order. */
  layers: [
    [0xffe9c4, 0.85, [[6, 0, 10, 2], [3, 2, 16, 2], [1, 4, 20, 3], [0, 7, 22, 8], [1, 15, 20, 3], [3, 18, 16, 2], [6, 20, 10, 2]]],
    [0x1b1016, 0.95, [[7, 2, 8, 2], [4, 4, 14, 2], [3, 6, 16, 2], [2, 8, 18, 6], [3, 14, 16, 2], [4, 16, 14, 2], [7, 18, 8, 2]]],
    [0x6b4a58, 0.8, [[7, 5, 6, 2], [5, 7, 6, 3], [5, 10, 3, 2]]],
  ],
} as const;

/**
 * Where the square's edge lands on screen, given its local edge `edge` and the Graphics' own translation `t` (the
 * scene's shake / cameraX offset, often fractional). WebGL fills a pixel when its centre is inside the rect, so the
 * rect at `edge + t` covers pixels from ceil(edge + t - 0.5); Canvas 2D would instead antialias a fractional edge into
 * the pixel before it. Drawing at that pixel boundary (minus `t`, which the renderer adds back) gives Canvas the same
 * hard-edged pixels WebGL already drew -- WebGL's coverage does not move -- and both stay inside the old rim circle's
 * raster square floor(c - 11 + t)..ceil(c + 11 + t). With no translation it is exactly round(c) - 11, as before.
 */
const snap = (edge: number, t: number) => Math.ceil(edge + t - 0.5) - t;

/** The pearl centred on `x`/`y` (screen space, floats: rounded here, as the candidate did). */
export function drawTapiocaProjectile(g: Phaser.GameObjects.Graphics, x: number, y: number) {
  const left = snap(Math.round(x) + TAPIOCA_PROJECTILE_ART.originX, g.x), top = snap(Math.round(y) + TAPIOCA_PROJECTILE_ART.originY, g.y);
  const layers = TAPIOCA_PROJECTILE_ART.layers;
  // Indexed, not destructured: nothing is allocated per frame.
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i], rects = layer[2];
    g.fillStyle(layer[0], layer[1]);
    for (let j = 0; j < rects.length; j++) {
      const r = rects[j];
      g.fillRect(left + r[0], top + r[1], r[2], r[3]);
    }
  }
}
