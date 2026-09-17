import type { Platform } from './StageGenerator';

/** Where a ledge is in its collapse. Drawing and collision read this; only this system writes it. */
export type PlatformState = 'stable' | 'cracking' | 'critical' | 'broken';
export interface BreakRules {
  /** Seconds from the first landing to the ledge giving way. */
  delay: number;
  /** Share of that delay spent in `cracking` before the louder `critical` warning begins. */
  criticalAt: number;
  /** How far a RUIN BREAKER's death reaches. */
  shatterRadius: number;
}
export const BREAK_RULES: BreakRules = { delay: 0.65, criticalAt: 0.55, shatterRadius: 190 };

/**
 * The sole owner of collapsing ledges. A breakable platform starts its timer the first time the
 * player lands on it and never stops: leaving and coming back does not buy more time. Nothing else
 * in the game keeps a collapse timer -- enemies and the renderer only read `state`.
 */
export class BreakablePlatformSystem {
  /** Remaining seconds per platform id, for the ledges that are already going. */
  private timers = new Map<number, number>();
  constructor(public delay = BREAK_RULES.delay, public readonly rules: BreakRules = BREAK_RULES) {}

  get counting() { return this.timers.size; }
  /** Starts the collapse on a first landing. A second landing is deliberately ignored. */
  land(platform: Platform) {
    if (!platform.breakable || platform.state !== 'stable') return false;
    platform.state = 'cracking';
    this.timers.set(platform.id, this.delay);
    return true;
  }
  /**
   * RUIN BREAKER's death. A ledge the player has already cracked gives way at once; an untouched one
   * only starts counting, so a kill can never delete a platform the route still depends on.
   */
  shatter(platforms: readonly Platform[], x: number, y: number) {
    const hit: Platform[] = [];
    for (const platform of platforms) {
      if (!platform.breakable || platform.state === 'broken') continue;
      const dx = Math.max(platform.x - x, 0, x - (platform.x + platform.width));
      if (Math.hypot(dx, platform.y - y) > this.rules.shatterRadius) continue;
      if (platform.state === 'stable') { platform.state = 'cracking'; this.timers.set(platform.id, this.delay); }
      else { platform.state = 'broken'; this.timers.delete(platform.id); }
      hit.push(platform);
    }
    return hit;
  }
  /** Advances every running collapse and reports the ledges that gave way on this step. */
  tick(dt: number, platforms: readonly Platform[]) {
    const broken: Platform[] = [];
    if (!Number.isFinite(dt) || dt <= 0 || !this.timers.size) return broken;
    for (const platform of platforms) {
      const remaining = this.timers.get(platform.id);
      if (remaining === undefined) continue;
      const left = remaining - dt;
      if (left <= 0) { platform.state = 'broken'; this.timers.delete(platform.id); broken.push(platform); continue; }
      this.timers.set(platform.id, left);
      platform.state = left <= this.delay * (1 - this.rules.criticalAt) ? 'critical' : 'cracking';
    }
    return broken;
  }
  reset(delay = this.delay) { this.timers.clear(); this.delay = delay; }
}
