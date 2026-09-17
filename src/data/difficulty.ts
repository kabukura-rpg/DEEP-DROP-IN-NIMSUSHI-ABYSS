import { BALANCE } from './balance';

export type DifficultyPhase = 'tutorial' | 'normal' | 'middle' | 'deep';
export interface Difficulty {
  phase: DifficultyPhase;
  minWidth: number; maxWidth: number; gap: number;
  enemyChance: number; spikeChance: number; tankChance: number; flyChance: number;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Evaluate each platform at its actual depth, not the start of its chunk. */
export function difficultyAt(depth: number): Difficulty {
  const d = Math.max(0, Number.isFinite(depth) ? depth : 0);
  if (d < 100) {
    const t = d / 100;
    return { phase: 'tutorial', minWidth: lerp(174, 156, t), maxWidth: lerp(194, 180, t), gap: lerp(235, 240, t), enemyChance: d < 30 ? 0 : lerp(0.08, 0.22, t), spikeChance: 0, tankChance: 0, flyChance: 0 };
  }
  if (d < 300) {
    const t = (d - 100) / 200;
    return { phase: 'normal', minWidth: lerp(156, 130, t), maxWidth: lerp(180, 154, t), gap: lerp(240, 245, t), enemyChance: lerp(0.22, 0.48, t), spikeChance: lerp(0, 0.2, t), tankChance: 0, flyChance: 0 };
  }
  if (d < 600) {
    const t = (d - 300) / 300;
    return { phase: 'middle', minWidth: lerp(130, 108, t), maxWidth: lerp(154, 134, t), gap: lerp(245, 255, t), enemyChance: lerp(0.48, 0.66, t), spikeChance: lerp(0.2, 0.34, t), tankChance: 0, flyChance: lerp(0, 0.3, t) };
  }
  const t = Math.min(1, (d - 600) / 1600);
  return { phase: 'deep', minWidth: lerp(108, 100, t), maxWidth: lerp(134, 124, t), gap: lerp(255, 280, t), enemyChance: lerp(0.66, 0.82, t), spikeChance: lerp(0.34, 0.4, t), tankChance: lerp(0, 0.24, t), flyChance: lerp(0.3, 0.46, t) };
}

/** Travel from a platform edge at rest, without firing; retain reaction/steering margin. */
export function fallTime(distance: number, gravityScale = 1) {
  const gravity = BALANCE.gravity * gravityScale;
  const accelerationTime = BALANCE.maxFallSpeed / gravity;
  const accelerationDistance = gravity * accelerationTime ** 2 / 2;
  return distance <= accelerationDistance ? Math.sqrt(2 * Math.max(0, distance) / gravity) : accelerationTime + (distance - accelerationDistance) / BALANCE.maxFallSpeed;
}
/**
 * Submerged falls last longer but start slower, because horizontal speed eases in instead of
 * snapping. Both effects are folded in here so platform placement stays provably reachable.
 */
export const horizontalReach = (gap: number, water?: { gravity: number; responsiveness: number }) =>
  Math.max(0, BALANCE.moveSpeed * (fallTime(gap, water?.gravity ?? 1) - 0.12) - 14 - (water ? BALANCE.moveSpeed / water.responsiveness : 0));
