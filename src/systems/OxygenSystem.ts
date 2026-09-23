export interface OxygenRules {
  /** Seconds of air a full tank holds. */
  max: number;
  /** Seconds one bubble restores. */
  bubbleRecovery: number;
  /** Seconds between HP hits once the tank is empty. */
  damageInterval: number;
  /** Warning thresholds, in seconds remaining. */
  warning: number;
  critical: number;
}
export const OXYGEN_RULES: OxygenRules = { max: 12, bubbleRecovery: 5, damageInterval: 1, warning: 5, critical: 3 };
export type OxygenWarning = 'none' | 'low' | 'critical';

/**
 * The sole owner of SUNKEN RUINS' (AREA 3) air supply. It runs on simulation time handed to `tick` -- never on a
 * real-time timer -- and it never touches HP: it only reports that a drowning hit is due, and
 * GameModel routes that through the ordinary HealthSystem damage path.
 */
export class OxygenSystem {
  remaining: number;
  private starved = 0;
  constructor(public enabled = false, public readonly rules: OxygenRules = OXYGEN_RULES) {
    this.remaining = rules.max;
  }
  get max() { return this.rules.max; }
  get ratio() { return this.enabled ? Math.max(0, Math.min(1, this.remaining / this.rules.max)) : 1; }
  get empty() { return this.enabled && this.remaining <= 0; }
  get warning(): OxygenWarning {
    if (!this.enabled) return 'none';
    return this.remaining <= this.rules.critical ? 'critical' : this.remaining <= this.rules.warning ? 'low' : 'none';
  }
  /** A SECTION start hands back a full tank. This is never an HP change. */
  fill() { this.remaining = this.rules.max; this.starved = 0; }
  /** Adds a bubble's worth of air, capped at the tank size. */
  add(seconds: number) {
    if (!this.enabled || !Number.isFinite(seconds) || seconds <= 0) return 0;
    const restored = Math.min(seconds, this.rules.max - this.remaining);
    this.remaining += restored;
    if (this.remaining > 0) this.starved = 0;
    return restored;
  }
  /**
   * Advances the supply by one simulation step and reports whether a drowning hit is now due.
   * There is no sheltered state any more: nowhere in the shaft stops the drain, so the tank only
   * ever goes back up by catching a bubble a broken AIR CONTAINER released.
   * The caller consumes the hit only once the damage actually landed, so invulnerability frames
   * delay a hit rather than cancelling it forever.
   */
  tick(dt: number) {
    if (!this.enabled || !Number.isFinite(dt) || dt <= 0) return false;
    this.remaining = Math.max(0, this.remaining - dt);
    if (this.remaining > 0) { this.starved = 0; return false; }
    this.starved += dt;
    // Epsilon: summing 1/120 steps lands a hair under a whole second otherwise.
    return this.starved >= this.rules.damageInterval - 1e-9;
  }
  /** Called after a due hit was accepted by HealthSystem. */
  consumeDamage() { this.starved = Math.max(0, this.starved - this.rules.damageInterval); }
  reset(enabled: boolean) { this.enabled = enabled; this.fill(); }
}
