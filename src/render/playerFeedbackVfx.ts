import type Phaser from 'phaser';

/**
 * PLAYER FEEDBACK VFX V1 -- design A of output/player-feedback-vfx-v1 (claude-integration-spec.md).
 *
 * PRESENTATION ONLY. Every function here reads gameplay state (hp, the existing invul countdown,
 * the COIN HIGH flag, the model clock) and writes nothing back. No new PNG: integer rectangles on
 * the scene's existing Graphics layers plus the player image's own tint and alpha. All sizes are
 * native 450x800 world pixels.
 *
 * - HURT: four separated elbow fragments around the body for 100ms, a warm tint for the first 50ms.
 * - INVUL: the legacy blink phase, unchanged, now a pale see-through body instead of a hidden one,
 *   plus two short side strokes that swap height with the phase.
 * - COIN HIGH: two brass chips on a lower-body ellipse, six quantised positions, 125ms a step.
 */
export const PLAYER_VFX = {
  key: 0x17181e,
  hurt: { end: 0.1, tintEnd: 0.05, tint: 0xffd3c5, rose: 0xde8d8b, pale: 0xf2d4c4, near: 22, far: 25 },
  invul: { alpha: 0.68, tint: 0xd5e3d0, shimmer: 0xc6d9cc },
  high: { brass: 0xd6b46a, edge: 0xf1dda3, rx: 21, ry: 6, cy: 12, positions: 6, step: 0.125 },
} as const;

/** The d712b67 PlayerArt blink predicate, byte for byte: same countdown, same 1/16s slots, alive only. */
export function invulPhaseOdd(hp: number, invincible: number) {
  return hp > 0 && invincible > 0 && Math.floor(invincible * 16) % 2 !== 0;
}

export type PlayerTreatment = { alpha: number; tint: number | null };

/** What the player's body gets this frame. HURT wins the tint for its first 50ms; otherwise the invul phase. */
export function playerTreatment(hp: number, invincible: number, hurtAge: number): PlayerTreatment {
  if (hp > 0 && hurtAge < PLAYER_VFX.hurt.tintEnd) return { alpha: 1, tint: PLAYER_VFX.hurt.tint };
  if (invulPhaseOdd(hp, invincible)) return { alpha: PLAYER_VFX.invul.alpha, tint: PLAYER_VFX.invul.tint };
  return { alpha: 1, tint: null };
}

/** A multiply tint applied to a plain colour, for the procedural body the image falls back to. */
export function tintColor(color: number, tint: number | null) {
  if (tint === null) return color;
  const channel = (shift: number) => Math.round((((color >> shift) & 0xff) * ((tint >> shift) & 0xff)) / 255) << shift;
  return channel(16) | channel(8) | channel(0);
}

const rect = (g: Phaser.GameObjects.Graphics, x: number, y: number, dx: number, dy: number, w: number, h: number, color: number) =>
  g.fillStyle(color, 1).fillRect(x + Math.round(dx), y + Math.round(dy), w, h);
/** A motif piece on its 1px dark key, so it holds its shape over any background. */
const chip = (g: Phaser.GameObjects.Graphics, x: number, y: number, dx: number, dy: number, w: number, h: number, color: number) => {
  rect(g, x, y, dx - 1, dy - 1, w + 2, h + 2, PLAYER_VFX.key);
  rect(g, x, y, dx, dy, w, h, color);
};

/** HURT: four diagonal elbows, never a closed ring, radius 22 then 25, gone at 100ms. `x`/`y` are the player's integer screen point. */
export function drawHurtImpact(g: Phaser.GameObjects.Graphics, x: number, y: number, age: number) {
  const { end, tintEnd, near, far, rose, pale } = PLAYER_VFX.hurt;
  if (!(age >= 0 && age < end)) return;
  const r = age < tintEnd ? near : far;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    chip(g, x, y, sx * r - 2, sy * (r - 5) - 1, 4, 2, rose);
    chip(g, x, y, sx * (r - 3) - 1, sy * (r - 8) - 1, 2, 4, pale);
  }
}

/** INVUL: two 2x5 side strokes, staggered by the legacy phase. Alive and still protected only. */
export function drawInvulShimmer(g: Phaser.GameObjects.Graphics, x: number, y: number, hp: number, invincible: number) {
  if (!(hp > 0 && invincible > 0)) return;
  const dy = invulPhaseOdd(hp, invincible) ? 5 : -5;
  chip(g, x, y, -20, dy - 5, 2, 5, PLAYER_VFX.invul.shimmer);
  chip(g, x, y, 18, -dy + 2, 2, 5, PLAYER_VFX.invul.shimmer);
}

/** COIN HIGH: two opposite brass chips, six positions on the model clock -- so a frozen world holds them too. */
export function drawCoinHighChips(g: Phaser.GameObjects.Graphics, x: number, y: number, elapsed: number) {
  const { brass, edge, rx, ry, cy, positions, step } = PLAYER_VFX.high;
  const at = Math.floor(elapsed / step) % positions;
  for (let j = 0; j < 2; j++) {
    const a = (at / positions + j * 0.5) * Math.PI * 2;
    chip(g, x, y, Math.cos(a) * rx - 2, cy + Math.sin(a) * ry, 4, 2, brass);
    rect(g, x, y, Math.cos(a) * rx - 1, cy + Math.sin(a) * ry, 2, 1, edge);
  }
}
