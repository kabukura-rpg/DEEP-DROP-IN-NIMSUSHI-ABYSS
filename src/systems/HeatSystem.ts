import { hazardHeat, HAZARD_TYPES, type Hazard } from '../data/hazards';

export interface HeatRules {
  max: number;
  /** Units per second gained in open air with nothing hot nearby. */
  ambient: number;
  /** Units per second shed once every heat source is out of range. */
  cooling: number;
  /** Seconds between HP hits while pinned at the top of the gauge. */
  damageInterval: number;
  /** Gauge thresholds, as percentages. */
  warm: number;
  hot: number;
  /** One block of ice. */
  iceRelief: number;
}
export const HEAT_RULES: HeatRules = { max: 100, ambient: 1, cooling: 0.9, damageInterval: 1, warm: 60, hot: 80, iceRelief: 60 };
export type HeatStage = 'cool' | 'warm' | 'hot' | 'overheat';
/**
 * How sharply a source's heat falls off with distance. Deliberately gentle: the design wants a wide
 * "warm" band the player sits in for much of a hot section, not a thin scalding shell they rarely
 * touch, because the player is always falling past a hazard rather than standing next to one.
 */
export const HEAT_FALLOFF = 2.2;

/**
 * AREA 3's risk meter. Unlike the air supply it is not a clock: the rate comes from how close the
 * player is standing to lava and vents, and it runs backwards when nothing hot is in range. It never
 * touches HP -- it only reports that an overheat hit is due, and GameModel routes that through the
 * ordinary HealthSystem path so invulnerability and death accounting behave as everywhere else.
 */
export class HeatSystem {
  value = 0;
  /** Units per second applied on the last tick; the HUD and tests read it to explain the gauge. */
  rate = 0;
  /** Heat from the hottest nearby source on the last tick, before ambient and cooling. */
  nearby = 0;
  private overheated = 0;
  constructor(public enabled = false, public readonly rules: HeatRules = HEAT_RULES) {}

  get ratio() { return this.enabled ? Math.max(0, Math.min(1, this.value / this.rules.max)) : 0; }
  get stage(): HeatStage {
    if (!this.enabled) return 'cool';
    if (this.value >= this.rules.max) return 'overheat';
    return this.value >= this.rules.hot ? 'hot' : this.value >= this.rules.warm ? 'warm' : 'cool';
  }
  get overheating() { return this.enabled && this.value >= this.rules.max; }

  /**
   * Heat contributed by one source: full strength at its edge, falling off with the square of the
   * distance so hugging lava is punishing while the guaranteed-clear lane stays comfortable. A
   * linear falloff blankets the whole shaft instead, which would leave no cool route at all.
   * Distance is measured to the rectangle, so a wide pool is hot along its length.
   */
  static contribution(hazard: Hazard, x: number, y: number) {
    const bounds = HAZARD_TYPES[hazard.kind];
    const dx = Math.max(hazard.x - x, 0, x - (hazard.x + hazard.width));
    const dy = Math.max(hazard.y - y, 0, y - (hazard.y + hazard.height));
    const distance = Math.hypot(dx, dy);
    if (distance >= bounds.heatRadius) return 0;
    // Rates land on the design bands: about +3-4%/s near lava, +6-8%/s hugging it, +8-12%/s in an
    // eruption, against +1%/s ambient.
    return hazardHeat(hazard) * (1 - distance / bounds.heatRadius) ** HEAT_FALLOFF;
  }

  /**
   * Advances the gauge. `sources` is expected to be only the hazards near the player -- GameModel
   * hands over the on-screen band rather than the whole run.
   */
  tick(dt: number, x: number, y: number, sources: readonly Hazard[]) {
    if (!this.enabled || !Number.isFinite(dt) || dt <= 0) return false;
    let hottest = 0;
    for (const hazard of sources) hottest = Math.max(hottest, HeatSystem.contribution(hazard, x, y));
    this.nearby = hottest;
    // Nothing hot in range: the shaft is survivable and the gauge falls, but never fast enough to
    // make ice pointless.
    this.rate = hottest > 0 ? this.rules.ambient + hottest : -this.rules.cooling;
    this.value = Math.max(0, Math.min(this.rules.max, this.value + this.rate * dt));
    if (this.value < this.rules.max) { this.overheated = 0; return false; }
    this.overheated += dt;
    // Epsilon: summing 1/120 steps lands a hair under a whole second otherwise.
    return this.overheated >= this.rules.damageInterval - 1e-9;
  }
  /** Called after a due hit was accepted by HealthSystem, so invulnerability delays but never cancels. */
  consumeDamage() { this.overheated = Math.max(0, this.overheated - this.rules.damageInterval); }

  /** Ice. Never below zero, and never a health change. */
  relieve(amount: number) {
    if (!this.enabled || !Number.isFinite(amount) || amount <= 0) return 0;
    const shed = Math.min(amount, this.value);
    this.value -= shed;
    if (this.value < this.rules.max) this.overheated = 0;
    return shed;
  }
  reset(enabled: boolean) { this.enabled = enabled; this.value = 0; this.rate = 0; this.nearby = 0; this.overheated = 0; }
}
