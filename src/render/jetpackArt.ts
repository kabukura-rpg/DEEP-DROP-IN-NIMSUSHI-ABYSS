import type Phaser from 'phaser';

/**
 * JETPACK PIXEL VFX V1 -- candidate A of output/jetpack-visual-design-v1 (claude-integration-spec.md,
 * assets/candidate-A-reference.ts).
 *
 * PRESENTATION ONLY. The three exhaust strips dc51d0b drew below the player, each as a dark side, a warm
 * flame and a bright core with a 2px tip, its length stepping through three frames. Every pixel stays inside
 * the old strips (-6,18,4,8) / (-1,19,4,11) / (4,20,4,14). When it shows is the scene's `m.jetpackActive`
 * gate, untouched; the frame and the flicker read the model clock only. No new PNG, no body, no particle,
 * no glow, no fade. All sizes are native 450x800 world pixels.
 */
export const JETPACK_ART = {
  /** The 14x16 envelope's top-left from the rounded player position, and its size. */
  originX: -6, originY: 18, width: 14, height: 16,
  /** One frame per 80ms of model time, three frames to a 240ms loop. */
  frameSeconds: 0.08,
  /** [dx, dy, w, h, colour] from the envelope's top-left, in draw order, per frame. */
  frames: [
    [
      [0, 0, 4, 4, 0x693e38], [1, 4, 2, 2, 0x693e38], [1, 0, 2, 4, 0xe99757], [1, 0, 2, 3, 0xffe6ae],
      [5, 1, 4, 7, 0x693e38], [6, 8, 2, 2, 0x693e38], [6, 1, 2, 7, 0xe99757], [6, 1, 2, 3, 0xffe6ae],
      [10, 2, 4, 10, 0x693e38], [11, 12, 2, 2, 0x693e38], [11, 2, 2, 10, 0xe99757], [11, 2, 2, 3, 0xffe6ae],
    ],
    [
      [0, 0, 4, 6, 0x693e38], [1, 6, 2, 2, 0x693e38], [1, 0, 2, 6, 0xe99757], [1, 0, 2, 3, 0xffe6ae],
      [5, 1, 4, 9, 0x693e38], [6, 10, 2, 2, 0x693e38], [6, 1, 2, 9, 0xe99757], [6, 1, 2, 3, 0xffe6ae],
      [10, 2, 4, 12, 0x693e38], [11, 14, 2, 2, 0x693e38], [11, 2, 2, 12, 0xe99757], [11, 2, 2, 3, 0xffe6ae],
    ],
    [
      [0, 0, 4, 5, 0x693e38], [1, 5, 2, 2, 0x693e38], [1, 0, 2, 5, 0xe99757], [1, 0, 2, 3, 0xffe6ae],
      [5, 1, 4, 8, 0x693e38], [6, 9, 2, 2, 0x693e38], [6, 1, 2, 8, 0xe99757], [6, 1, 2, 3, 0xffe6ae],
      [10, 2, 4, 11, 0x693e38], [11, 13, 2, 2, 0x693e38], [11, 2, 2, 11, 0xe99757], [11, 2, 2, 3, 0xffe6ae],
    ],
  ],
} as const;

/** The frame shown at model time `elapsed`; the epsilon only settles float ties on a frame boundary. */
export const jetpackFrame = (elapsed: number) => Math.floor((elapsed + 1e-8) / JETPACK_ART.frameSeconds) % 3;

/** The exhaust under the rounded player position `x`/`y` (screen space), with dc51d0b's flicker alpha. */
export function drawJetpackExhaust(g: Phaser.GameObjects.Graphics, x: number, y: number, elapsed: number) {
  const frame = JETPACK_ART.frames[jetpackFrame(elapsed)];
  const alpha = 0.5 + Math.abs(Math.sin(elapsed * 22)) * 0.5;
  // Indexed, not destructured: nothing is allocated per frame.
  for (let i = 0; i < frame.length; i++) {
    const r = frame[i];
    g.fillStyle(r[4], alpha).fillRect(x + JETPACK_ART.originX + r[0], y + JETPACK_ART.originY + r[1], r[2], r[3]);
  }
}
