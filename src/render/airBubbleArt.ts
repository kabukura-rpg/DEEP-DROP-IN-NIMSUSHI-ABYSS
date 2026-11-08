import type Phaser from 'phaser';

/**
 * AIR BUBBLES VISUAL DESIGN V1 -- candidate A, "Refined Original", of output/air-bubbles-visual-design-v1
 * (AIR_BUBBLES_DESIGN_COMPARISON_V1.md, harness/air-art.js), approved at Human Review.
 *
 * PRESENTATION ONLY. A released container bubble's 2px ring and white glint become a closed 20x20 ring of 2x2-pixel
 * steps in the same #9fe8f5, with a two-cell diagonal glint in #f0ffff at .9 of the ring. The centre stays clear.
 * Where a bubble is, how it climbs, when it can be caught, what it restores and when it goes are GameModel's,
 * untouched (the catch box is still |dx| < 24, |dy| < 28). No new texture, glow, scale, particle or animation: the
 * caller's fade (.92, or the end-of-life blink) is the only alpha. All sizes are native 450x800 world pixels.
 *
 *   ...rrrr...      each character one 2x2 cell, centred on the bubble:
 *   ..r....r..      r  ring   #9fe8f5 x 1
 *   .r.h....r.      h  glint  #f0ffff x .9
 *   r.h......r
 *   r........r
 *   r........r
 *   r........r
 *   .r......r.
 *   ..r....r..
 *   ...rrrr...
 */
export const AIR_BUBBLE_ART = {
  ring: 0x9fe8f5,
  glint: 0xf0ffff,
  /** The glint's alpha as a share of the ring's. */
  glintShare: 0.9,
} as const;

type Rect = readonly [dx: number, dy: number, w: number, h: number];

/** The cells above, same-colour runs merged down the rows, as [dx, dy, w, h] from the rounded centre. */
export const AIR_BUBBLE_GEOMETRY: { readonly ring: readonly Rect[]; readonly glint: readonly Rect[] } = {
  ring: [
    [-4, -10, 8, 2],
    [-6, -8, 2, 2], [4, -8, 2, 2],
    [-8, -6, 2, 2], [6, -6, 2, 2],
    [-10, -4, 2, 8], [8, -4, 2, 8],
    [-8, 4, 2, 2], [6, 4, 2, 2],
    [-6, 6, 2, 2], [4, 6, 2, 2],
    [-4, 8, 8, 2],
  ],
  glint: [[-4, -6, 2, 2], [-6, -4, 2, 2]],
};

function paint(g: Phaser.GameObjects.Graphics, x: number, y: number, rects: readonly Rect[], color: number, alpha: number) {
  g.fillStyle(color, alpha);
  // Indexed, not destructured: nothing is allocated per frame.
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    g.fillRect(x + r[0], y + r[1], r[2], r[3]);
  }
}

/**
 * One bubble centred on `cx`/`cy` (layer space: the caller has already taken the camera's scroll off), ring at `fade`
 * and glint at .9 * `fade`. Only the centre is snapped, to the pixel the Graphics' own translation (`g.x`/`g.y`:
 * shake and cameraX, often fractional) puts it on screen, without touching that translation.
 */
export function drawAirBubbleArt(g: Phaser.GameObjects.Graphics, cx: number, cy: number, fade: number) {
  const x = Math.round(cx + g.x) - g.x;
  const y = Math.round(cy + g.y) - g.y;
  paint(g, x, y, AIR_BUBBLE_GEOMETRY.ring, AIR_BUBBLE_ART.ring, fade);
  paint(g, x, y, AIR_BUBBLE_GEOMETRY.glint, AIR_BUBBLE_ART.glint, AIR_BUBBLE_ART.glintShare * fade);
}
