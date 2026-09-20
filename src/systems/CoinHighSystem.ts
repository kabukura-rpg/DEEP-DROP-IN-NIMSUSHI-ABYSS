import { activeDecayPerSecond, COIN_HIGH_RULES, type CoinHighRules } from '../data/coinHigh';

/**
 * The COIN HIGH meter and the state it switches on.
 *
 * It knows nothing about coins, weapons or chambers: value is pushed in by whoever collected it and
 * time is pushed in by whoever is stepping the world. That is what lets TIMEVOID stop the decay
 * without stopping collection -- the caller simply does not tick it while the world outside a
 * chamber is stopped, and still calls `earn` for anything picked up in there.
 *
 * The meter is the timer. A full meter means a HIGH that lasts `activeSeconds`; every coin taken
 * while it runs pushes the meter back up, which is exactly what "keep collecting to keep it going"
 * means. There is no second duration counter to fall out of step with it.
 */
export class CoinHighSystem {
  meter = 0;
  active = false;
  /** COIN SICK stretches a HIGH. The threshold and the boost it grants are untouched. */
  durationMultiplier = 1;
  /** Seconds since the last coin. Only an inactive meter waits this out before it starts falling. */
  private idle = 0;

  constructor(public readonly rules: CoinHighRules = COIN_HIGH_RULES) {}

  /** Credit collected value. Returns true on the step it switches the HIGH on. */
  earn(value: number) {
    if (!Number.isFinite(value) || value <= 0) return false;
    this.meter = Math.min(this.rules.threshold, this.meter + value);
    this.idle = 0;
    if (this.active || this.meter < this.rules.threshold) return false;
    this.active = true;
    return true;
  }

  /** Run the clock. Returns true on the step the HIGH runs out. */
  tick(dt: number) {
    this.idle += dt;
    if (this.active) {
      this.meter = Math.max(0, this.meter - (activeDecayPerSecond(this.rules) / this.durationMultiplier) * dt);
      if (this.meter > 0) return false;
      this.active = false;
      return true;
    }
    if (this.idle > this.rules.idleGrace) this.meter = Math.max(0, this.meter - this.rules.decayPerSecond * dt);
    return false;
  }

  /** Weapon multipliers. Exactly 1 when not active, so a HIGH ending restores the baseline. */
  get damageMultiplier() { return this.active ? this.rules.damageMultiplier : 1; }
  get rangeMultiplier() { return this.active ? this.rules.rangeMultiplier : 1; }
  /** 0..1, for the meter on the HUD. */
  get ratio() { return this.meter / this.rules.threshold; }

  reset() { this.meter = 0; this.active = false; this.idle = 0; }
}
